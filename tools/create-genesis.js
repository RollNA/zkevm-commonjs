/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable no-unused-expressions */
/* eslint-disable no-console */
/* eslint-disable multiline-comment-style */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */

const { Scalar } = require('ffjavascript');
const fs = require('fs');

const ethers = require('ethers');
const {
    Address, toBuffer,
} = require('ethereumjs-util');
const { defaultAbiCoder } = require('@ethersproject/abi');
const path = require('path');

const artifactsPath = path.join(__dirname, 'artifacts/contracts');

const {
    MemDB, ZkEVMDB, getPoseidon, processorUtils, smtUtils,
} = require('../index');

const genesisGenerator = require("./genesis-gen.json");

const contractsPolygonHermez = require('@polygon-hermez/contracts-zkevm');

async function main() {
    const genesisOutput = {};

    const globalExitRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const localExitRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

    const poseidon = await getPoseidon();
    const F = poseidon.F;
    const {
        genesis,
        txs,
        chainIdSequencer,
        sequencerAddress,
        timestamp,
    } = genesisGenerator;

    const db = new MemDB(F);

    // create a zkEVMDB to compile the sc
    const zkEVMDB = await ZkEVMDB.newZkEVM(
        db,
        poseidon,
        [F.zero, F.zero, F.zero, F.zero],
        smtUtils.stringToH4(localExitRoot),
        genesis,
    );

    // // Check evm contract params
    // for (const contract of genesis) {
    //     if (contract.contractName) {
    //         // Add contract interface for future contract interaction
    //         const contractInterface = new ethers.utils.Interface(contract.abi);
    //         contract.contractInterface = contractInterface;
    //         const contractAddres = new Address(toBuffer(contract.address));

    //         const contractAccount = await zkEVMDB.vm.stateManager.getAccount(contractAddres);
    //         expect(await contractAccount.isContract()).to.be.true;

    //         const contractCode = await zkEVMDB.vm.stateManager.getContractCode(contractAddres);
    //         expect(contractCode.toString('hex')).to.be.equal(contract.deployedBytecode.slice(2));

    //         for (const [key, value] of Object.entries(contract.storage)) {
    //             const contractStorage = await zkEVMDB.vm.stateManager.getContractStorage(contractAddres, toBuffer(key));
    //             expect(contractStorage.toString('hex')).to.equal(value.slice(2));
    //         }
    //     }
    // }

    /*
     * build, sign transaction and generate rawTxs
     * rawTxs would be the calldata inserted in the contract
     */
    const rawTxs = [];
    for (let j = 0; j < txs.length; j++) {
        const currentTx = txs[j];

        const tx = {
            to: currentTx.to || '0x',
            nonce: currentTx.nonce,
            value: processorUtils.toHexStringRlp(ethers.utils.parseUnits(currentTx.value, 'wei')),
            gasLimit: currentTx.gasLimit,
            gasPrice: processorUtils.toHexStringRlp(ethers.utils.parseUnits(currentTx.gasPrice, 'wei')),
            chainId: currentTx.chainId,
            data: currentTx.data || '0x',
        };

        if (currentTx.paramsDeploy) {
            // Contract deployment from tx
            let bytecode;
            if (contractsPolygonHermez[currentTx.contractName]) {
                bytecode = contractsPolygonHermez[currentTx.contractName].bytecode;
            } else {
                ({ bytecode } = require(`${artifactsPath}/${currentTx.contractName}.sol/${currentTx.contractName}.json`));
            }
            const params = defaultAbiCoder.encode(currentTx.paramsDeploy.types, currentTx.paramsDeploy.values);
            tx.data = bytecode + params.slice(2);
        }

        let customRawTx;
        const address = genesis.find((o) => o.address === currentTx.from);
        const wallet = new ethers.Wallet(address.pvtKey);
        if (tx.chainId === 0) {
            const signData = ethers.utils.RLP.encode([
                processorUtils.toHexStringRlp(Scalar.e(tx.nonce)),
                processorUtils.toHexStringRlp(tx.gasPrice),
                processorUtils.toHexStringRlp(tx.gasLimit),
                processorUtils.toHexStringRlp(tx.to),
                processorUtils.toHexStringRlp(tx.value),
                processorUtils.toHexStringRlp(tx.data),
                processorUtils.toHexStringRlp(tx.chainId),
                '0x',
                '0x',
            ]);
            const digest = ethers.utils.keccak256(signData);
            const signingKey = new ethers.utils.SigningKey(address.pvtKey);
            const signature = signingKey.signDigest(digest);
            const r = signature.r.slice(2).padStart(64, '0'); // 32 bytes
            const s = signature.s.slice(2).padStart(64, '0'); // 32 bytes
            const v = (signature.v).toString(16).padStart(2, '0'); // 1 bytes
            customRawTx = signData.concat(r).concat(s).concat(v);
        } else {
            const rawTxEthers = await wallet.signTransaction(tx);
            customRawTx = processorUtils.rawTxToCustomRawTx(rawTxEthers);
        }
        rawTxs.push(customRawTx);
    }
    const batch = await zkEVMDB.buildBatch(timestamp, sequencerAddress, chainIdSequencer, smtUtils.stringToH4(globalExitRoot));
    for (let j = 0; j < rawTxs.length; j++) {
        batch.addRawTx(rawTxs[j]);
    }

    // execute the transactions added to the batch
    await batch.executeTxs();
    // consolidate state
    await zkEVMDB.consolidate(batch);

    const newRoot = batch.currentStateRoot;
    genesisOutput.root = smtUtils.h4toString(newRoot);

    const touchedAcc = batch.getTouchedAccountsBatch();
    const currentVM = batch.vm;
    const accountsOutput = [];

    for (const item in touchedAcc) {
        const address = item;
        const account = touchedAcc[address];

        const currentAccountOutput = {};
        currentAccountOutput.balance = account.balance.toString()
        currentAccountOutput.nonce = account.nonce.toString()
        currentAccountOutput.address = address;

        // If account is a contract, update storage and bytecode
        if (account.isContract()) {
            const addressInstance = Address.fromString(address);
            const smCode = await currentVM.stateManager.getContractCode(addressInstance);
            const sto = await currentVM.stateManager.dumpStorage(addressInstance);
            const storage = {};
            console.log(address)
            console.log({ sto });
            const keys = Object.keys(sto).map((v) => `0x${v}`);
            const values = Object.values(sto).map((v) => `0x${v}`);
            for (let k = 0; k < keys.length; k++) {
                storage[keys[k]] = values[k];
            }

            currentAccountOutput.deployedBytecode = `0x${smCode.toString('hex')}`;
            currentAccountOutput.storage = storage;
        }
        else {
            currentAccountOutput.pvtKey = (genesis.find((o) => o.address.toLowerCase() == address.toLowerCase())).pvtKey;
        }
        accountsOutput.push(currentAccountOutput);
    }

    genesisOutput.genesis = accountsOutput;
    const genesisOutputPath = path.join(__dirname, './genesis.json');
    await fs.writeFileSync(genesisOutputPath, JSON.stringify(genesisOutput, null, 2));
}
// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
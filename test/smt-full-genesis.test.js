const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { argv } = require('yargs');

const {
    MemDB, SMT, stateUtils, getPoseidon,
} = require('../index');
const { pathTestVectors } = require('./helpers/test-utils');

describe('smt full-genesis', async function () {
    this.timeout(10000);

    const pathFullGenesis = path.join(pathTestVectors, 'merkle-tree/smt-full-genesis.json');

    let update;
    let poseidon;
    let F;
    let testVectors;

    before(async () => {
        poseidon = await getPoseidon();
        F = poseidon.F;
        testVectors = JSON.parse(fs.readFileSync(pathFullGenesis));

        update = argv.update === true;
    });

    it('Should check test vectors', async () => {
        // build tree and check root
        for (let i = 3; i < 4; i++) {
            const { addresses, expectedRoot } = testVectors[i];

            const db = new MemDB(F);
            const smt = new SMT(db, poseidon, poseidon.F);

            let tmpRoot = smt.empty;

            for (let j = 0; j < addresses.length; j++) {
                const {
                    address, balance, nonce,
                    bytecode, storage,
                } = addresses[j];

                // add balance and nonce
                tmpRoot = await stateUtils.setAccountState(address, smt, tmpRoot, balance, nonce);

                // add bytecode if defined
                if (typeof bytecode !== 'undefined') {
                    tmpRoot = await stateUtils.setContractBytecode(address, smt, tmpRoot, bytecode);
                }

                // add storage if defined
                if (typeof storage !== 'undefined') {
                    tmpRoot = await stateUtils.setContractStorage(address, smt, tmpRoot, storage);
                }
            }

            if (update) {
                testVectors[i].expectedRoot = F.toString(tmpRoot);
            } else {
                expect(F.toString(tmpRoot)).to.be.equal(expectedRoot);
            }
        }

        if (update) {
            fs.writeFileSync(pathFullGenesis, JSON.stringify(testVectors, null, 2));
        }
    });
});

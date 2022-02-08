const { ethers } = require('ethers');
const { Scalar } = require('ffjavascript');

/**
 * Extract an integer from a byte array
 * @param {Uint8Array} data - Byte array
 * @param {Number} offset - Offset of the data array
 * @param {Number} length - Length of the integer in bytes
 * @returns {Number} - Extracted integer
 */
function unarrayifyInteger(data, offset, length) {
    let result = 0;
    for (let i = 0; i < length; i++) {
        result = (result * 256) + data[offset + i];
    }
    return result;
}

/**
 * Convert a number type to a hex string starting with 0x and with a integer number of bytes
 * @param {Number | BigInt | BigNumber | Object} num - Number
 * @returns {Number} - Hex string
 */
function toHexStringRlp(num) {
    let numHex;
    if (typeof num === 'number' || typeof num === 'bigint' || typeof num === 'object') {
        numHex = Scalar.toString(Scalar.e(num), 16);
        // if it's an integer and it's value is 0, the standar is set to 0x, instead of 0x00 ( because says that always is codified in the shortest way)
        if (Scalar.e(num) === Scalar.e(0)) return '0x';
    } else if (typeof num === 'string') {
        numHex = num.startsWith('0x') ? num.slice(2) : num;
    }
    numHex = (numHex.length % 2 === 1) ? (`0x0${numHex}`) : (`0x${numHex}`);
    return numHex;
}

/**
 * Convert a standar rawTx of ethereum [rlp(nonce,gasprice,gaslimit,to,value,data,r,s,v)]
 * to our custom raw tx [rlp(nonce,gasprice,gaslimit,to,value,data,0,0)|r|s|v]
 * @param {String} rawTx - Standar raw transaction
 * @returns {String} - Custom raw transaction
 */
function rawTxToCustomRawTx(rawTx) {
    const tx = ethers.utils.parseTransaction(rawTx);
    const signData = ethers.utils.RLP.encode([
        toHexStringRlp(tx.nonce),
        toHexStringRlp(tx.gasPrice),
        toHexStringRlp(tx.gasLimit),
        toHexStringRlp(tx.to),
        toHexStringRlp(tx.value),
        toHexStringRlp(tx.data),
        toHexStringRlp(tx.chainId),
        '0x',
        '0x',
    ]);
    const r = tx.r.slice(2);
    const s = tx.s.slice(2);
    const v = (tx.v - tx.chainId * 2 - 35 + 27).toString(16).padStart(2, '0'); // 1 byte

    return signData.concat(r).concat(s).concat(v);
}

/**
 * Decode The next string in rlp, wich has 0-55 bytes long
 * @param {Uint8Array} data - Byte array
 * @param {Number} offset - Offset of the data array
 * @returns {Object} - Return the bytes consumed and the result encoded in hex string
 */
function decodeNextShortStringRLP(encodedTxBytes, offset) {
    if (encodedTxBytes[offset] >= 0xb8) {
        throw new Error('Should be a short string RLP');
    } else if (encodedTxBytes[offset] >= 0x80) {
        const length = encodedTxBytes[offset] - 0x80;
        const result = ethers.utils.hexlify(encodedTxBytes.slice(offset + 1, offset + 1 + length));
        return { consumed: (1 + length), result };
    } else {
        return { consumed: 1, result: ethers.utils.hexlify(encodedTxBytes[offset]) };
    }
}

/**
 * Decode The next string in rlp
 * @param {String} encodedTxBytes - Reduced array
 * @returns {Array} - Array of rawTxs
 */
function decodeNextStringRLP(encodedTxBytes, offset) {
    if (encodedTxBytes[offset] >= 0xb8) {
        const lengthLength = encodedTxBytes[offset] - 0xb7;
        const length = unarrayifyInteger(encodedTxBytes, offset + 1, lengthLength);
        const result = ethers.utils.hexlify(encodedTxBytes.slice(offset + 1 + lengthLength, offset + 1 + lengthLength + length));
        return { consumed: (1 + lengthLength + length), result };
    }
    return decodeNextShortStringRLP(encodedTxBytes, offset);
}

/**
 * Decode the BatchL2Data to an array of rawTxs using the prover method
 * @param {String} encodedTransactions - Reduced array
 * @returns {Object} - The object contain the  Array of rawTxs and the rlpSignData as the prover does
 */
function decodeCustomRawTxProverMethod(encodedTransactions) {
    // should check total len before read
    const encodedTxBytes = ethers.utils.arrayify(encodedTransactions);
    const txDecoded = {};

    let offset = 0; // in zkasm this is the p

    let txListLength = 0;

    // Decode list length
    if (encodedTxBytes[offset] < 0xc0) {
        throw new Error('headerList should be a list');
    } else if (encodedTxBytes[offset] >= 0xf8) {
        const lengthLength = encodedTxBytes[offset] - 0xf7;
        txListLength = unarrayifyInteger(encodedTxBytes, offset + 1, lengthLength);
        offset = offset + 1 + lengthLength;
    } else if (encodedTxBytes[offset] >= 0xc0) {
        txListLength = encodedTxBytes[offset] - 0xc0;
        offset += 1;
    }

    // Nonce read
    const decodedNonce = decodeNextShortStringRLP(encodedTxBytes, offset);
    offset += decodedNonce.consumed;
    txDecoded.nonce = decodedNonce.result;

    // GasPrice read
    const decodedGasPrice = decodeNextShortStringRLP(encodedTxBytes, offset);
    offset += decodedGasPrice.consumed;
    txDecoded.gasPrice = decodedGasPrice.result;

    // gas read
    const decodedGasLimit = decodeNextShortStringRLP(encodedTxBytes, offset);
    offset += decodedGasLimit.consumed;
    txDecoded.gasLimit = decodedGasLimit.result;

    // To READ
    if (encodedTxBytes[offset] === 0x80) {
        txDecoded.to = '0x';
        // isContract = true
    } else if (encodedTxBytes[offset] === 0x94) {
        const length = 20;
        txDecoded.to = ethers.utils.hexlify(encodedTxBytes.slice(offset + 1, offset + 1 + length));
        offset += 1 + length;
    } else {
        throw new Error('To should be an address or empty');
    }

    // Value READ
    const decodedValue = decodeNextShortStringRLP(encodedTxBytes, offset);
    offset += decodedValue.consumed;
    txDecoded.value = decodedValue.result;

    // Data READ
    const decodedData = decodeNextStringRLP(encodedTxBytes, offset);
    offset += decodedData.consumed;
    txDecoded.data = decodedData.result;

    // Value READ
    const decodedChainID = decodeNextShortStringRLP(encodedTxBytes, offset);
    offset += decodedChainID.consumed;
    txDecoded.chainID = decodedChainID.result;

    if ((encodedTxBytes[offset] !== 0x80) || encodedTxBytes[offset + 1] !== 0x80) {
        throw new Error('The last 2 values should be 0x8080');
    }
    offset += 2;

    if (txListLength + 1 !== offset) {
        throw new Error('Invalid list length');
    }

    const rlpSignData = ethers.utils.hexlify(encodedTxBytes.slice(0, offset));

    const lenR = 32;
    const lenS = 32;
    const lenV = 1;

    txDecoded.r = ethers.utils.hexlify(encodedTxBytes.slice(offset, offset + lenR));
    offset += lenR;
    txDecoded.s = ethers.utils.hexlify(encodedTxBytes.slice(offset, offset + lenS));
    offset += lenS;
    txDecoded.v = ethers.utils.hexlify(encodedTxBytes.slice(offset, offset + lenV));
    offset += lenV;

    return { txDecoded, rlpSignData };
}

module.exports = {
    decodeCustomRawTxProverMethod,
    rawTxToCustomRawTx,
    toHexStringRlp,
};

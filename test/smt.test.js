/* eslint-disable no-await-in-loop */
const { Scalar } = require('ffjavascript');
const { assert } = require('chai');

const {
    SMT, MemDB, getPoseidon,
} = require('../index');

describe('SMT', async function () {
    let poseidon;
    let F;
    this.timeout(100000);

    before(async () => {
        poseidon = await getPoseidon();
        F = poseidon.F;
    });

    it('It should add and remove an element', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const r1 = await smt.set(smt.empty, Scalar.e(1), Scalar.e(2));
        const r2 = await smt.set(r1.newRoot, Scalar.e(1), Scalar.e(0));

        assert(smt.nodeIsZero(r2.newRoot));
    });

    it('It should update an element 1', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const r1 = await smt.set(smt.empty, Scalar.e(1), Scalar.e(2));
        const r2 = await smt.set(r1.newRoot, Scalar.e(1), Scalar.e(3));
        const r3 = await smt.set(r2.newRoot, Scalar.e(1), Scalar.e(2));

        assert(smt.nodeIsEq(r1.newRoot, r3.newRoot));
    });

    it('It should add a shared element 2', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const r1 = await smt.set(smt.empty, Scalar.e(8), Scalar.e(2));
        const r2 = await smt.set(r1.newRoot, Scalar.e(9), Scalar.e(3));
        const r3 = await smt.set(r2.newRoot, Scalar.e(8), Scalar.e(0));
        const r4 = await smt.set(r3.newRoot, Scalar.e(9), Scalar.e(0));

        assert(smt.nodeIsZero(r4.newRoot));
    });

    it('It should add a shared element 3', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const r1 = await smt.set(smt.empty, Scalar.e(7), Scalar.e(2));
        const r2 = await smt.set(r1.newRoot, Scalar.e(15), Scalar.e(3));
        const r3 = await smt.set(r2.newRoot, Scalar.e(7), Scalar.e(0));
        const r4 = await smt.set(r3.newRoot, Scalar.e(15), Scalar.e(0));

        assert(smt.nodeIsZero(r4.newRoot));
    });

    it('It should add a shared element', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const r1 = await smt.set(smt.empty, Scalar.e(7), Scalar.e(107));
        const r2 = await smt.set(r1.newRoot, Scalar.e(15), Scalar.e(115));
        const r3 = await smt.set(r2.newRoot, Scalar.e(3), Scalar.e(103));
        const r4 = await smt.set(r3.newRoot, Scalar.e(7), Scalar.e(0));
        const r5 = await smt.set(r4.newRoot, Scalar.e(15), Scalar.e(0));
        const r6 = await smt.set(r5.newRoot, Scalar.e(3), Scalar.e(0));

        assert(smt.nodeIsZero(r6.newRoot));
    });

    it('Add-Remove 128 elements', async () => {
        const N = 128;
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        let r = {
            newRoot: smt.empty,
        };

        for (let i = 0; i < N; i++) {
            r = await smt.set(r.newRoot, Scalar.e(i), Scalar.e(i + 1000));
        }

        for (let i = 0; i < N; i++) {
            r = await smt.set(r.newRoot, Scalar.e(i), Scalar.e(0));
        }

        assert(smt.nodeIsZero(r.newRoot));
    });

    it('Should read random', async () => {
        //        const N = 64;
        const N = 3;
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const vals = {};

        let r = {
            newRoot: smt.empty,
        };

        let rr;

        for (let i = 0; i < N; i++) {
            /*
             *            const key = Math.floor(Math.random() * 64);
             *            const val = Math.floor(Math.random() * 2);
             */
            const key = i;
            const val = i;
            vals[key] = val;
            r = await smt.set(r.newRoot, Scalar.e(key), Scalar.e(val));
        }

        for (let i = 0; i < N; i++) {
            rr = await smt.get(r.newRoot, Scalar.e(i));
            const v = vals[i] ? vals[i] : 0;
            assert(Scalar.eq(rr.value, Scalar.e(v)));
        }
    });

    it('It should add elements with similar keys', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const expectedRoot = [
            1361534377311549574n, 6844553382454206922n, 8910524568890641498n, 5635536814180020910n,
        ];

        const r0 = await smt.set(smt.empty, Scalar.e(0), Scalar.e(2)); // 0x00
        const r1 = await smt.set(r0.newRoot, Scalar.e(4369), Scalar.e(2)); // 0x1111
        const r2 = await smt.set(r1.newRoot, Scalar.e(69905), Scalar.e(3)); // 0x11111

        assert(smt.nodeIsEq(expectedRoot, r2.newRoot));
    });

    it('It should update leaf with more than one level depth', async () => {
        const db = new MemDB(F);
        const smt = new SMT(db, poseidon, poseidon.F);

        const expectedRoot = [
            3334882532704216805n,
            16915253152413162423n,
            11172331835855761752n,
            13483617693646990367n,
        ];

        const r0 = await smt.set(
            smt.empty,
            Scalar.e('56714103185361745016746792718676985000067748055642999311525839752090945477479'),
            Scalar.e('8163644824788514136399898658176031121905718480550577527648513153802600646339'),
        );

        const r1 = await smt.set(
            r0.newRoot,
            Scalar.e('980275562601266368747428591417466442501663392777380336768719359283138048405'),
            Scalar.e('115792089237316195423570985008687907853269984665640564039457584007913129639934'),
        );

        const r2 = await smt.set(
            r1.newRoot,
            Scalar.e('53001048207672216258532366725645107222481888169041567493527872624420899640125'),
            Scalar.e('115792089237316195423570985008687907853269984665640564039457584007913129639935'),
        );

        const r3 = await smt.set(
            r2.newRoot,
            Scalar.e('60338373645545410525187552446039797737650319331856456703054942630761553352879'),
            Scalar.e('7943875943875408'),
        );

        const r4 = await smt.set(
            r3.newRoot,
            Scalar.e('56714103185361745016746792718676985000067748055642999311525839752090945477479'),
            Scalar.e('35179347944617143021579132182092200136526168785636368258055676929581544372820'),
        );

        assert(smt.nodeIsEq(expectedRoot, r4.newRoot));
    });
});

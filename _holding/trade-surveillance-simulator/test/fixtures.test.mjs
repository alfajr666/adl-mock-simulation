import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../engine/index.js';

/** FNV-1a over (seq, t, price, qty) of every trade: a compact fingerprint of the whole tape. */
function tapeChecksum(trades) {
  let h = 0x811c9dc5;
  for (const t of trades) for (const v of [t.seq, t.t, t.price, t.qty]) { h ^= v & 0xffffffff; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const row = (b) => [b.alerts, b.tp, b.fp, b.fn];
const near = (x, y, d = 1e-4) => assert.ok(Math.abs(x - y) < d, `${x} vs ${y}`);

const FIX = {
  equity: {
    tape: { orders: 16054, cancels: 11384, trades: 3507, band: 16, checksum: 2835264375 },
    byRule: { W1: [3, 3, 0, 0], W2: [2, 1, 1, 0], P1: [3, 2, 1, 0], P2: [1, 1, 0, 0] },
    overall: { alerts: 9, tp: 7, fp: 2, fn: 0, precision: 7 / 9, recall: 1 },
    causes: { 'W2:market-maker-subaccounts': 1, 'P1:benign-shock': 1 },
    wash: { internalQty: 157300, trades: 118, selfTrades: 4, instShare: 0.7399, ringShare: 0.9430 },
    pump: { pnl: 771400, closing: 0 },
    p2: { share: 0.8241, rampQty: 16400, netSell: 19000, pnl: 771400 },
    strict: { W2: [1, 0, 1, 1], clusters: 3 },
    loose: { clusters: 4 },
  },
  crypto: {
    tape: { orders: 12620, cancels: 9033, trades: 3145, band: 0, checksum: 3258154280 },
    byRule: { W1: [3, 3, 0, 0], W2: [3, 1, 2, 0], P1: [3, 2, 1, 0], P2: [1, 1, 0, 0] },
    overall: { alerts: 10, tp: 7, fp: 3, fn: 0, precision: 0.7, recall: 1 },
    causes: { 'W2:market-maker-subaccounts': 2, 'P1:benign-shock': 1 },
    wash: { internalQty: 29310, trades: 79, selfTrades: 5, instShare: 0.7973, ringShare: 0.9345 },
    pump: { pnl: 312120, closing: 0 },
    p2: { share: 1, rampQty: 1940, netSell: 3060, pnl: 333450 },
    strict: { W2: [2, 0, 2, 1], clusters: 3 },
    loose: { clusters: 4 },
  },
};

for (const id of ['equity', 'crypto']) {
  const f = FIX[id];
  test(`${id} seed 1: tape size and fingerprint`, () => {
    const r = runScenario(id, { seed: 1, fresh: true });
    assert.equal(r.tape.orders.length, f.tape.orders);
    assert.equal(r.tape.cancels.length, f.tape.cancels);
    assert.equal(r.tape.trades.length, f.tape.trades);
    assert.equal(r.stats.rejections.BAND, f.tape.band);
    assert.equal(tapeChecksum(r.tape.trades), f.tape.checksum);
  });

  test(`${id} seed 1: alerts per rule, TP/FP/FN, precision and recall`, () => {
    const r = runScenario(id, { seed: 1 });
    for (const [rule, exp] of Object.entries(f.byRule)) {
      const b = r.score.byRule[rule];
      assert.deepEqual(row(b), [exp[0], exp[1], exp[2], exp[3]], rule);
      assert.equal(b.fp, b.alerts - b.tp);
      assert.equal(b.precision, b.tp / b.alerts);
      assert.equal(b.recall, b.detected / b.episodes);
    }
    const o = r.score.overall;
    assert.deepEqual([o.alerts, o.tp, o.fp, o.fn, o.episodes, o.detected], [f.overall.alerts, f.overall.tp, f.overall.fp, f.overall.fn, 2, 2]);
    near(o.precision, f.overall.precision, 1e-12);
    assert.equal(o.recall, f.overall.recall);
    assert.deepEqual(r.score.fpCausesByRule, f.causes);
    assert.deepEqual(r.alerts.map((a) => a.rule).sort(), Object.entries(f.byRule).flatMap(([k, v]) => Array(v[0]).fill(k)).sort());
  });

  test(`${id} seed 1: planted wash ring internal volume share and pump cluster P&L`, () => {
    const r = runScenario(id, { seed: 1 });
    const wash = r.groundTruth.episodes.find((e) => e.type === 'wash');
    assert.equal(wash.stats.internalQty, f.wash.internalQty);
    assert.equal(wash.stats.internalTrades, f.wash.trades);
    assert.equal(wash.stats.selfTrades, f.wash.selfTrades);
    near(wash.stats.internalShareOfInstrumentVolume, f.wash.instShare);
    near(wash.stats.internalShareOfRingVolume, f.wash.ringShare);
    const pump = r.groundTruth.episodes.find((e) => e.type === 'pump');
    assert.equal(pump.stats.pnlTicksQty, f.pump.pnl);
    assert.equal(pump.stats.closingPosition, f.pump.closing);
    assert.ok(Number.isInteger(pump.stats.pnlTicksQty));
    const p2 = r.alerts.find((a) => a.rule === 'P2');
    near(p2.metrics.rampAggressiveBuyShare, f.p2.share);
    assert.equal(p2.metrics.rampAggressiveBuyQty, f.p2.rampQty);
    assert.equal(p2.metrics.followNetSellQty, f.p2.netSell);
    assert.equal(p2.metrics.pnlTicksQty, f.p2.pnl);
    assert.ok(p2.accounts.every((a) => pump.accounts.includes(a)) && p2.accounts.length === 3);
  });

  test(`${id} seed 1: linkage policy comparison`, () => {
    const strict = runScenario(id, { seed: 1, linkagePolicy: 'strong1' });
    assert.deepEqual(row(strict.score.byRule.W2), f.strict.W2);
    assert.equal(strict.score.byRule.W2.recall, 0);
    assert.equal(strict.linkage.clusters.length, f.strict.clusters);
    const loose = runScenario(id, { seed: 1, linkagePolicy: 'weak1' });
    assert.equal(loose.linkage.clusters.length, f.loose.clusters);
    assert.equal(runScenario(id, { seed: 1 }).linkage.clusters.length, 3);
  });
}

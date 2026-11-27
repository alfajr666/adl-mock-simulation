import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../engine/index.js';

/** FNV-1a over (seq, t, price, qty) of every trade: a compact fingerprint of the whole tape. */
function tapeChecksum(trades) {
  let h = 0x811c9dc5;
  for (const t of trades) for (const v of [t.seq, t.t, t.price, t.qty]) { h ^= v & 0xffffffff; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const near = (x, y, d = 1e-4) => assert.ok(Math.abs(x - y) < d, `${x} vs ${y}`);

const FIX = {
  equity: {
    tape: { orders: 15844, cancels: 11161, trades: 3518, band: 17, checksum: 2280383431 },
    alerts: { total: 6, match: 3, explainable: 1, unrelated: 2 },
    groups: { total: 6, episodeMatches: 3, explainable: 1, unrelated: 2 },
    byRuleAlerts: { W2: [2, 1, 1, 0], P1: [3, 1, 0, 2], P2: [1, 1, 0, 0] },        // total, match, explainable, unrelated
    precision: { gMatch: 0.5, gExpl: 2 / 3, aMatch: 0.5, aExpl: 2 / 3 },
    causes: { 'W2:same-owner-cross': 1, 'P1:natural-move': 1, 'P1:benign-shock': 1 },
    selfMatch: { alerts: 6, planted: 1, algo: 5, flagged: 3 },
    wash: { internalQty: 155100, trades: 113, selfTrades: 2, instShare: 0.7340, sideShare: 0.9527 },
    pump: { pnl: 813500 },
    p2: { share: 0.8950, rampQty: 19600, netSell: 22400, pnl: 813500, acc: 2300, accShare: 0.1825 },
    clusters: { weak2: '3,4,2,2,2,2,2', strongCount: 5, strongLargest: 3, weakCount: 2, weakLargest: 46 },
    strongEpisodes: 1, looseGroups: { total: 9, unrelated: 7, explainable: 0 },
  },
  crypto: {
    tape: { orders: 12277, cancels: 8691, trades: 3117, band: 0, checksum: 1115383056 },
    alerts: { total: 7, match: 4, explainable: 2, unrelated: 1 },
    groups: { total: 5, episodeMatches: 3, explainable: 1, unrelated: 1 },
    byRuleAlerts: { W2: [3, 1, 2, 0], P1: [3, 2, 0, 1], P2: [1, 1, 0, 0] },
    precision: { gMatch: 0.6, gExpl: 0.8, aMatch: 4 / 7, aExpl: 6 / 7 },
    causes: { 'W2:same-owner-cross': 2, 'P1:benign-shock': 1 },
    selfMatch: { alerts: 9, planted: 1, algo: 8, flagged: 3 },
    wash: { internalQty: 32630, trades: 83, selfTrades: 1, instShare: 0.8041, sideShare: 0.9470 },
    pump: { pnl: 307780 },
    p2: { share: 0.7184, rampQty: 2960, netSell: 3920, pnl: 307780, acc: 1680, accShare: 0.6176 },
    clusters: { weak2: '2,2,4,2,3,2,2', strongCount: 5, strongLargest: 3, weakCount: 4, weakLargest: 27 },
    strongEpisodes: 2, looseGroups: { total: 10, unrelated: 7, explainable: 0 },
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

  test(`${id} seed 1: alert-level and group-level score`, () => {
    const r = runScenario(id, { seed: 1 });
    const o = r.score.overall;
    assert.deepEqual(o.alerts, f.alerts);
    assert.deepEqual(o.groups, f.groups);
    assert.deepEqual(o.episodes, { planted: 2, found: 2, missed: 0 });
    near(o.precision.group.match, f.precision.gMatch, 1e-12);
    near(o.precision.group.matchOrExplainable, f.precision.gExpl, 1e-12);
    near(o.precision.alert.match, f.precision.aMatch, 1e-12);
    near(o.precision.alert.matchOrExplainable, f.precision.aExpl, 1e-12);
    assert.equal(o.recall, 1);
    for (const [rule, [total, match, expl, unrel]] of Object.entries(f.byRuleAlerts)) {
      assert.deepEqual(r.score.byRule[rule].alerts, { total, match, explainable: expl, unrelated: unrel }, rule);
    }
    assert.deepEqual(r.score.causesByRule, f.causes);
    assert.equal(r.score.byRule.W1, undefined, 'W1 is not a pattern rule');
    assert.deepEqual(Object.keys(r.score).sort(), ['byEpisode', 'byRule', 'causes', 'causesByRule', 'decoysAlerted', 'labels', 'overall', 'selfMatch']);
  });

  test(`${id} seed 1: self-match hygiene block is separate`, () => {
    const r = runScenario(id, { seed: 1 });
    const s = r.score.selfMatch;
    assert.deepEqual([s.alerts, s.onPlantedAccounts, s.onHonestAlgoAccounts, s.accountsFlagged], [f.selfMatch.alerts, f.selfMatch.planted, f.selfMatch.algo, f.selfMatch.flagged]);
    assert.equal(r.alerts.filter((a) => a.rule === 'W1').length, s.alerts);
    assert.equal(s.onOtherAccounts, 0);
  });

  test(`${id} seed 1: planted wash ring volume shares, pump P&L, and the P2 figures`, () => {
    const r = runScenario(id, { seed: 1 });
    const wash = r.groundTruth.episodes.find((e) => e.type === 'wash');
    assert.equal(wash.stats.internalQty, f.wash.internalQty);
    assert.equal(wash.stats.internalTrades, f.wash.trades);
    assert.equal(wash.stats.selfTrades, f.wash.selfTrades);
    near(wash.stats.internalShareOfInstrumentQty, f.wash.instShare);
    near(wash.stats.internalShareOfRingSideVolume, f.wash.sideShare);
    const pump = r.groundTruth.episodes.find((e) => e.type === 'pump');
    assert.equal(pump.stats.pnlTicksQty, f.pump.pnl);
    assert.equal(pump.stats.closingPosition, 0);
    const p2 = r.alerts.filter((a) => a.rule === 'P2');
    assert.equal(p2.length, 1);
    const m = p2[0].metrics;
    near(m.rampAggressiveBuyShare, f.p2.share);
    assert.equal(m.rampAggressiveBuyQty, f.p2.rampQty);
    assert.equal(m.followNetSellQty, f.p2.netSell);
    assert.equal(m.pnlTicksQty, f.p2.pnl);
    assert.equal(m.accumulationNetQty, f.p2.acc);
    near(m.accumulationBuyShareOfVolume, f.p2.accShare);
  });

  test(`${id} seed 1: linkage clusters under the three policies`, () => {
    const cl = (p) => runScenario(id, { seed: 1, linkagePolicy: p }).linkage.clusters;
    assert.equal(cl('weak2').map((c) => c.accounts.length).join(','), f.clusters.weak2);
    assert.equal(cl('strong1').length, f.clusters.strongCount);
    assert.equal(Math.max(...cl('strong1').map((c) => c.accounts.length)), f.clusters.strongLargest);
    assert.equal(cl('weak1').length, f.clusters.weakCount);
    assert.equal(Math.max(...cl('weak1').map((c) => c.accounts.length)), f.clusters.weakLargest);
    const strict = runScenario(id, { seed: 1, linkagePolicy: 'strong1' });
    assert.equal(strict.score.overall.episodes.found, f.strongEpisodes);
    const loose = runScenario(id, { seed: 1, linkagePolicy: 'weak1' });
    assert.deepEqual([loose.score.overall.groups.total, loose.score.overall.groups.unrelated, loose.score.overall.groups.explainable], [f.looseGroups.total, f.looseGroups.unrelated, f.looseGroups.explainable]);
  });
}

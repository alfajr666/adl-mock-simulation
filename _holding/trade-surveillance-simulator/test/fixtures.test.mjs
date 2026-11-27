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
    tape: { orders: 15845, cancels: 10960, trades: 3684, band: 18, checksum: 4106695170 },
    alerts: { total: 8, match: 3, matchDiluted: 0, explainable: 1, unrelated: 4 },
    groups: { total: 8, episodeMatches: 3, diluted: 0, explainable: 1, unrelated: 4 },
    cases: { cases: 7, episodeCases: 2, dilutedEpisodeCases: 0, trapCases: 2, explainableCases: 1, unrelatedCases: 3, shareMatchingEpisode: 2 / 7, shareMatchingOrExplainable: 3 / 7, episodesFound: 2, episodesMissed: 0 },
    byRuleAlerts: { W2: [5, 1, 0, 1, 3], P1: [2, 1, 0, 0, 1], P2: [1, 1, 0, 0, 0] },        // total, match, diluted, explainable, unrelated
    causes: { 'W2:honest-linked-trading': 3, 'W2:same-owner-cross': 1, 'P1:benign-shock': 1 },
    selfMatch: { alerts: 6, planted: 0, algo: 6, flagged: 2 },
    wash: { internalQty: 46400, trades: 80, selfTrades: 0, instShare: 0.3402, sideShare: 0.9289 },
    pump: { pnl: 765100 },
    p2: { share: 0.75, rampQty: 14100, netSell: 17300, pnl: 765100, acc: 1600, accShare: 0.1301 },
    clusters: { weak2: '4,4,2,2,2,2,3,2,3,3,4,2', strongCount: 10, strongLargest: 4, weakCount: 1, weakLargest: 49 },
    strong: { found: 1, diluted: 0 }, loose: { found: 1, diluted: 1 },
  },
  crypto: {
    tape: { orders: 12625, cancels: 8861, trades: 3310, band: 0, checksum: 2839599422 },
    alerts: { total: 11, match: 3, matchDiluted: 0, explainable: 2, unrelated: 6 },
    groups: { total: 11, episodeMatches: 3, diluted: 0, explainable: 2, unrelated: 6 },
    cases: { cases: 10, episodeCases: 2, dilutedEpisodeCases: 0, trapCases: 3, explainableCases: 2, unrelatedCases: 5, shareMatchingEpisode: 0.2, shareMatchingOrExplainable: 0.4, episodesFound: 2, episodesMissed: 0 },
    byRuleAlerts: { W2: [7, 1, 0, 2, 4], P1: [3, 1, 0, 0, 2], P2: [1, 1, 0, 0, 0] },
    causes: { 'W2:background-collision': 2, 'W2:same-owner-cross': 2, 'W2:honest-linked-trading': 2, 'P1:benign-shock': 1, 'P1:benign-burst': 1 },
    selfMatch: { alerts: 6, planted: 1, algo: 5, flagged: 3 },
    wash: { internalQty: 10000, trades: 59, selfTrades: 2, instShare: 0.5705, sideShare: 0.9474 },
    pump: { pnl: 307200 },
    p2: { share: 0.6667, rampQty: 1480, netSell: 2470, pnl: 340360, acc: 1800, accShare: 0.5788 },
    clusters: { weak2: '4,2,4,11,5,2,2,2,2', strongCount: 8, strongLargest: 11, weakCount: 5, weakLargest: 32 },
    strong: { found: 1, diluted: 0 }, loose: { found: 1, diluted: 1 },
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

  test(`${id} seed 1: alert-level, group-level and case-level score`, () => {
    const r = runScenario(id, { seed: 1 });
    const o = r.score.overall;
    assert.deepEqual(o.alerts, f.alerts);
    assert.deepEqual(o.groups, f.groups);
    assert.deepEqual(o.episodes, { planted: 2, found: 2, diluted: 0, missed: 0 });
    assert.equal(o.recall, 1);
    near(o.precision.group.match, f.groups.episodeMatches / f.groups.total, 1e-12);
    near(o.precision.alert.matchOrExplainable, (f.alerts.match + f.alerts.explainable) / f.alerts.total, 1e-12);
    const c = r.score.caseSummary;
    for (const [k, v] of Object.entries(f.cases)) near(c[k], v, 1e-12);
    assert.equal(r.score.cases.length, c.cases);
    for (const [rule, [total, match, dil, expl, unrel]] of Object.entries(f.byRuleAlerts)) {
      assert.deepEqual(r.score.byRule[rule].alerts, { total, match, matchDiluted: dil, explainable: expl, unrelated: unrel }, rule);
    }
    assert.deepEqual(r.score.causesByRule, f.causes);
    assert.equal(r.score.byRule.W1, undefined, 'W1 is not a pattern rule');
    assert.deepEqual(Object.keys(r.score).sort(), ['byEpisode', 'byRule', 'caseSummary', 'cases', 'causes', 'causesByRule', 'decoysAlerted', 'labels', 'overall', 'selfMatch']);
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
    assert.ok(wash.stats.internalShareOfInstrumentQty < 0.65, 'the ring is not most of the instrument any more');
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
    const e = (p) => runScenario(id, { seed: 1, linkagePolicy: p }).score.overall.episodes;
    assert.deepEqual([e('strong1').found, e('strong1').diluted], [f.strong.found, f.strong.diluted]);
    assert.deepEqual([e('weak1').found, e('weak1').diluted], [f.loose.found, f.loose.diluted]);
  });
}

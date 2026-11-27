import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, detectionContext, DEFAULTS } from '../engine/index.js';
import { makeBins } from '../engine/agents.js';

// ---- a tiny hand-built market: 40 bins of 5 s, one instrument X, lot size 1 -------------
const session = { days: 1, stepsPerDay: 200, stepMs: 1000, dayMs: 1e9, binSteps: 5, momentumSteps: 8, momentumK: 4 };
const market = {
  label: 'hand-built', session, binMs: 5000, bins: makeBins(session),
  instruments: [{ id: 'X', name: 'X', tickSize: 1, lotSize: 1, bandPct: null, refPrice0: 1000 }],
};
const register = {
  schema: [{ key: 's', label: 'S', strength: 'strong' }, { key: 'w', label: 'W', strength: 'weak' }],
  ownerAttribute: 's',
  rows: ['A', 'B', 'C', 'D', 'G1', 'G2', 'R1', 'R2', 'R3'].map((a) => ({
    acct: a, declaredOwner: a, type: 'individual',
    attributes: { s: a === 'B' ? 'SA' : a === 'A' ? 'SA' : a === 'G2' ? 'SG' : a === 'G1' ? 'SG' : `S-${a}`, w: `W-${a}` },
  })),
};
const TH = {
  ...DEFAULTS.thresholds.crypto,
  w2WindowBins: 2, w2MergeGapBins: 0, w2MinInternalLots: 1, w2ClusterShare: 0.5, w2InstrumentShare: 0.25, w2NetRatio: 0.6,
  p1WindowBins: 3, p1MergeGapBins: 0, p1BaselineBins: 10, p1MoveScore: 5, p1VolMult: 2, p1MinReturnBps: 300, p1Baseline: 'warmup',
  p2MinClusterSize: 2, p2RampShare: 0.25, p2RampEndFraction: 0.6, p2FollowBins: 6, p2NetSellRatio: 0.3, p2MinRampLots: 1, p2LookbackBins: 8,
};
let nextId = 1;
const trade = (bin, price, qty, buy, sell, aggressor = 'B', off = 100) => {
  const id = nextId++;
  return { seq: id, id, t: bin * 5000 + off + id % 50, kind: 'trade', inst: 'X', price, qty, side: aggressor, acct: aggressor === 'B' ? buy : sell, aggressor, buyAcct: buy, sellAcct: sell, buyOrderId: 1000 + 2 * id, sellOrderId: 1001 + 2 * id };
};
const run = (trades, th = {}, policy = 'weak2') => detect({ market, register, trades, thresholds: { ...TH, ...th }, linkagePolicy: policy });
const byRule = (alerts, r) => alerts.filter((a) => a.rule === r);

test('W2: an A-B internal burst in one bin is alerted with exact metrics and supporting trades', () => {
  nextId = 1;
  const t = [trade(10, 1000, 50, 'A', 'B'), trade(10, 1000, 50, 'B', 'A', 'S'), trade(10, 1000, 100, 'C', 'D')];
  const { alerts, linkage } = run(t);
  assert.deepEqual(linkage.clusters.map((c) => c.accounts), [['A', 'B'], ['G1', 'G2']]);
  const w2 = byRule(alerts, 'W2');
  assert.equal(w2.length, 1);
  const a = w2[0];
  assert.deepEqual(a.accounts, ['A', 'B']);
  assert.equal(a.metrics.internalQty, 100);
  assert.equal(a.metrics.externalQty, 0);
  assert.equal(a.metrics.clusterInternalShare, 1);
  assert.equal(a.metrics.instrumentInternalShare, 0.5);
  assert.equal(a.metrics.netChangeOverInternal, 0);
  assert.deepEqual(a.supportingTradeIds, [1, 2]);
  assert.deepEqual(a.window, { startMs: 9 * 5000, endMs: 12 * 5000 });
  assert.equal(a.thresholdsCrossed.w2InstrumentShare.threshold, 0.25);
});

test('W2: dilution by outside trading removes the alert (cluster share rule)', () => {
  nextId = 1;
  const t = [trade(10, 1000, 100, 'A', 'B'), trade(10, 1000, 250, 'A', 'C'), trade(10, 1000, 250, 'C', 'B')];   // internal 100 of 600 cluster volume
  assert.equal(byRule(run(t).alerts, 'W2').length, 0);
});

test('W2: the net-position rule bites (one-way outside flow is not a wash)', () => {
  const mk = (extra) => { nextId = 1; return [trade(10, 1000, 100, 'A', 'B'), trade(10, 1000, extra, 'A', 'C')]; };
  assert.equal(byRule(run(mk(40)).alerts, 'W2').length, 1);          // net 40 / internal 100 = 0.4 <= 0.6
  assert.equal(byRule(run(mk(80)).alerts, 'W2').length, 0);          // net 80 / internal 100 = 0.8 > 0.6
  assert.equal(byRule(run(mk(80), { w2NetRatio: 0.9 }).alerts, 'W2').length, 1);
});

test('W2: needs a linked cluster; strict policy cannot link weak-only pairs', () => {
  nextId = 1;
  const t = [trade(10, 1000, 100, 'C', 'D')];
  assert.equal(byRule(run(t).alerts, 'W2').length, 0);
  const weak = { ...register, rows: register.rows.map((r) => (r.acct === 'C' || r.acct === 'D' ? { ...r, attributes: { s: `S-${r.acct}`, w: 'W-shared' } } : r)) };
  const th = { ...TH };
  nextId = 1;
  const trades = [trade(10, 1000, 100, 'C', 'D')];
  assert.equal(byRule(detect({ market, register: weak, trades, thresholds: th, linkagePolicy: 'weak1' }).alerts, 'W2').length, 1);
  assert.equal(byRule(detect({ market, register: weak, trades, thresholds: th, linkagePolicy: 'weak2' }).alerts, 'W2').length, 0);
});

// ---- price tapes ---------------------------------------------------------------------------
function baselineTape(extra = []) {
  nextId = 1;
  const t = [];
  for (let b = 0; b < 10; b++) t.push(trade(b, b % 2 ? 1005 : 1000, 100, 'R1', 'R2'));
  return [...t, ...extra];
}
const rms = () => { let prev = 1000; const r2 = []; for (let b = 0; b < 10; b++) { const c = b % 2 ? 1005 : 1000; r2.push(((c - prev) / prev) ** 2); prev = c; } return Math.sqrt(r2.reduce((s, v) => s + v, 0) / r2.length); };

test('P1: a rise and a later crash are separate alerts, each with its own direction and score', () => {
  const extra = [];
  [[10, 1050], [11, 1100], [12, 1100]].forEach(([b, p]) => extra.push(trade(b, p, 500, 'R1', 'R2')));
  [[20, 1000], [21, 900], [22, 900]].forEach(([b, p]) => extra.push(trade(b, p, 500, 'R2', 'R1', 'S')));
  const { alerts } = run(baselineTape(extra));
  const p1 = byRule(alerts, 'P1');
  const up = p1.filter((a) => a.metrics.direction === 'up'), down = p1.filter((a) => a.metrics.direction === 'down');
  assert.ok(up.length >= 1 && down.length >= 1);
  assert.ok(up.every((a) => a.metrics.returnBps > 0) && down.every((a) => a.metrics.returnBps < 0));
  assert.ok(up[0].window.endMs <= down[0].window.startMs + 3 * 5000, 'the two are not merged into one');
  // independent arithmetic for the strongest rising window: start bin 10, prev close 1005
  const sigma = rms();
  const best = up.reduce((m, a) => (a.metrics.moveScore > m.metrics.moveScore ? a : m));
  assert.ok(best.metrics.moveScore > 5);
  assert.ok(Math.abs(best.metrics.baselineVolatility - sigma) < 1e-12);
  assert.deepEqual(best.metrics.baselineBins, { start: 0, end: 9 });
  assert.ok(best.metrics.returnBps > 940 && best.metrics.returnBps < 1005);
  assert.equal(best.metrics.baselineSource, 'warmup');
});

test('P1: a quiet tape and a small move raise nothing; a move without volume raises nothing', () => {
  assert.equal(byRule(run(baselineTape()).alerts, 'P1').length, 0);
  const small = [trade(10, 1010, 100, 'R1', 'R2'), trade(11, 1020, 100, 'R1', 'R2')];
  assert.equal(byRule(run(baselineTape(small)).alerts, 'P1').length, 0);
  const thin = [trade(10, 1100, 100, 'R1', 'R2'), trade(11, 1100, 100, 'R1', 'R2'), trade(12, 1100, 100, 'R1', 'R2')];
  assert.equal(byRule(run(baselineTape(thin)).alerts, 'P1').length, 0, 'volume multiple below threshold');
});

test('P1: trailing baseline is contaminated by a volatile regime, warm-up is not', () => {
  const regime = [];
  for (let b = 10; b < 30; b++) regime.push(trade(b, b % 2 ? 1050 : 1000, 300, 'R1', 'R2'));
  const move = [[30, 1150], [31, 1150], [32, 1150]].map(([b, p]) => trade(b, p, 300, 'R1', 'R2'));
  const tape = baselineTape([...regime, ...move]);
  const warm = byRule(run(tape, { p1Baseline: 'warmup' }).alerts, 'P1');
  const trail = byRule(run(tape, { p1Baseline: 'trailing' }).alerts, 'P1');
  assert.ok(warm.some((a) => a.metrics.endBin >= 32), 'warm-up baseline flags the late move');
  assert.ok(!trail.some((a) => a.metrics.endBin >= 32), 'trailing baseline has already seen the volatility');
  assert.ok(trail.every((a) => a.metrics.baselineSource === 'trailing' && a.metrics.baselineBins.end < a.metrics.startBin));
});

test('P2: a linked group that buys the ramp then sells the follow window is alerted with its accumulation and P&L', () => {
  const ex = [];
  for (const b of [6, 7, 8]) ex.push(trade(b, 1000, 20, 'G1', 'R2', 'S'));                       // quiet accumulation (passive buys)
  [[10, 1050], [11, 1100], [12, 1100]].forEach(([b, p]) => {
    ex.push(trade(b, p, 100, 'G1', 'R2'), trade(b, p, 100, 'G2', 'R2'), trade(b, p, 50, 'R3', 'R2'));
  });
  [[13, 1100], [14, 1090], [15, 1080]].forEach(([b, p]) => { ex.push(trade(b, p, 100, 'R3', 'G1', 'B'), trade(b, p, 100, 'R3', 'G2', 'B')); });
  const trades = baselineTape(ex);
  const { alerts } = run(trades);
  const p1 = byRule(alerts, 'P1'), p2 = byRule(alerts, 'P2');
  assert.equal(p2.length, 1);
  const a = p2[0];
  assert.deepEqual(a.accounts, ['G1', 'G2']);
  assert.equal(p1.find((x) => x.id === a.metrics.p1AlertId).metrics.direction, 'up');
  const inR = (w) => (x) => x.t >= w.startMs && x.t < w.endMs;
  const ramp = trades.filter((x) => inR(a.metrics.rampWindow)(x) && x.aggressor === 'B');
  const gAgg = ramp.filter((x) => ['G1', 'G2'].includes(x.buyAcct)).reduce((s, x) => s + x.qty, 0);
  const allAgg = ramp.reduce((s, x) => s + x.qty, 0);
  assert.equal(a.metrics.rampAggressiveBuyQty, gAgg);
  assert.ok(Math.abs(a.metrics.rampAggressiveBuyShare - gAgg / allAgg) < 1e-12);
  assert.ok(a.metrics.rampAggressiveBuyShare > 0.5);
  assert.ok(a.metrics.followNetSellQty > 0 && a.metrics.followNetSellRatio >= 0.3);
  // independent P&L over [lookback start, follow end)
  let cash = 0, pos = 0, mark = null;
  for (const x of trades.filter((x) => x.t >= a.metrics.lookbackWindow.startMs && x.t < a.metrics.followWindow.endMs)) {
    mark = x.price;
    if (['G1', 'G2'].includes(x.buyAcct)) { cash -= x.price * x.qty; pos += x.qty; }
    if (['G1', 'G2'].includes(x.sellAcct)) { cash += x.price * x.qty; pos -= x.qty; }
  }
  assert.equal(a.metrics.pnlTicksQty, cash + pos * mark);
  assert.ok(Number.isInteger(a.metrics.pnlTicksQty));
  assert.equal(a.metrics.accumulationNetQty, 60);
  assert.ok(a.metrics.accumulationBuyShareOfVolume > 0 && a.metrics.accumulationBuyShareOfVolume < 1);
});

test('P2: broad buying (no group dominates) or no later selling raises no P2 alert', () => {
  const broad = [];
  [[10, 1050], [11, 1100], [12, 1100]].forEach(([b, p]) => { for (const x of ['R1', 'R3', 'C', 'D']) broad.push(trade(b, p, 100, x, 'R2')); broad.push(trade(b, p, 100, 'G1', 'R2')); });
  assert.equal(byRule(run(baselineTape(broad)).alerts, 'P2').length, 0);
  const noSell = [];
  [[10, 1050], [11, 1100], [12, 1100]].forEach(([b, p]) => { noSell.push(trade(b, p, 100, 'G1', 'R2'), trade(b, p, 100, 'G2', 'R2')); });
  assert.equal(byRule(run(baselineTape(noSell)).alerts, 'P2').length, 0);
});

test('the detection context holds the market, trades and derived bars only: no scenario or truth fields', () => {
  nextId = 1;
  const ctx = detectionContext({ market, trades: [trade(1, 1000, 1, 'A', 'B')] });
  assert.deepEqual(Object.keys(ctx).sort(), ['market', 'prep', 'trades', 'tradesByInst']);
  const forbidden = /groundTruth|truth|scn|scenario|roles|episode|decoy|controller|planted|hype|news|pump|ring/i;
  const keys = (o, out = []) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push(k); if (!(o[k] instanceof Function)) keys(o[k], out); } return out; };
  const seen = keys({ ...ctx, prep: { bars: ctx.prep.bars } });
  assert.ok(!seen.some((k) => forbidden.test(k)), seen.filter((k) => forbidden.test(k)).join(','));
  assert.deepEqual(Object.keys(ctx.market).sort(), ['bins', 'binIndexOf', 'binMs', 'instrumentById', 'instruments', 'label', 'session'].sort());
});

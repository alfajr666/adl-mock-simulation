/*
 * Trade-surveillance simulator engine: public API.
 * Everything here is DOM-free, dependency-free and deterministic: the same
 * (configId, seed, thresholds, linkagePolicy) always yields the same result.
 * See ENGINE.md for the contract.
 */
import { simulate, makeBins, binIndexOf } from './agents.js';
import { buildLinkage, LINKAGE_POLICIES } from './linkage.js';
import { prepareBars, runRules } from './rules.js';
import { buildGroundTruth, scoreAlerts, RULES, RULE_TARGETS } from './score.js';
import { buildEquity } from './scenario-equity.js';
import { buildCrypto } from './scenario-crypto.js';

export const MODEL_VERSION = 'surv-model-1.0.0';
export { LINKAGE_POLICIES, RULES, RULE_TARGETS };

const BUILDERS = { equity: buildEquity, crypto: buildCrypto };
export const CONFIG_IDS = Object.keys(BUILDERS);

/** One plain object holds every threshold. Windows are counted in bins (see market.binMs). */
export const DEFAULTS = {
  seed: 1,
  linkagePolicy: 'weak2',
  thresholds: {
    equity: {
      w1MinCount: 1, w1MinLots: 1, w1MergeBins: 60,
      w2WindowBins: 4, w2MergeGapBins: 8, w2ClusterShare: 0.5, w2NetRatio: 0.25, w2InstrumentShare: 0.25, w2MinInternalLots: 10,
      p1Mode: 'instrument', p1WindowBins: 10, p1MergeGapBins: 4, p1BaselineBins: 10, p1ZRet: 5, p1VolMult: 2, p1MinReturnBps: 300,
      p2MinClusterSize: 2, p2RampShare: 0.25, p2RampEndFraction: 0.6, p2FollowBins: 20, p2NetSellRatio: 0.3, p2MinRampLots: 5, p2LookbackBins: 30,
    },
    crypto: {
      w1MinCount: 1, w1MinLots: 1, w1MergeBins: 90,
      w2WindowBins: 5, w2MergeGapBins: 6, w2ClusterShare: 0.5, w2NetRatio: 0.25, w2InstrumentShare: 0.25, w2MinInternalLots: 10,
      p1Mode: 'instrument', p1WindowBins: 5, p1MergeGapBins: 6, p1BaselineBins: 20, p1ZRet: 5, p1VolMult: 2, p1MinReturnBps: 300,
      p2MinClusterSize: 2, p2RampShare: 0.25, p2RampEndFraction: 0.6, p2FollowBins: 10, p2NetSellRatio: 0.3, p2MinRampLots: 5, p2LookbackBins: 40,
    },
  },
};

const cache = new Map();
export function clearCache() { cache.clear(); }

function buildMarket(scn) {
  const S = scn.session;
  const bins = makeBins(S);
  return {
    label: scn.label,
    session: { ...S },
    binMs: S.binSteps * S.stepMs,
    bins,
    instruments: scn.instruments.map((d) => ({ id: d.id, name: d.name, tickSize: d.tickSize, lotSize: d.lotSize, bandPct: d.bandPct, refPrice0: d.price0 })),
  };
}

/** Adds the non-serialisable helpers the rules need. */
function hydrate(market) {
  const instrumentById = {};
  for (const d of market.instruments) instrumentById[d.id] = d;
  return { ...market, instrumentById, binIndexOf: (t) => binIndexOf(market.session, t) };
}

function getSim(configId, seed, fresh) {
  const key = `${configId}:${seed}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  const build = BUILDERS[configId];
  if (!build) throw new Error(`Unknown config: ${configId}`);
  const scn = build(seed);
  const sim = simulate(scn, seed);
  const market = buildMarket(scn);
  const groundTruth = buildGroundTruth(scn, sim);
  const hm = hydrate(market);
  const trades = sim.tape.trades;
  const tradesByInst = {};
  for (const d of market.instruments) tradesByInst[d.id] = [];
  for (const t of trades) tradesByInst[t.inst].push(t);
  const entry = { scn, sim, market, hm, groundTruth, prep: prepareBars(hm, trades), tradesByInst };
  if (!fresh) cache.set(key, entry);
  return entry;
}

function resolveThresholds(configId, over) {
  return { ...DEFAULTS.thresholds[configId], ...(over || {}) };
}

/**
 * Run one configuration end to end: generate market, link accounts, run the
 * alert rules, score against the planted episodes.
 * @param {'equity'|'crypto'} configId
 * @param {{seed?:number, thresholds?:object, linkagePolicy?:string, fresh?:boolean}} [opts]
 */
export function runScenario(configId, opts = {}) {
  const seed = opts.seed ?? DEFAULTS.seed;
  const policy = opts.linkagePolicy ?? DEFAULTS.linkagePolicy;
  const th = resolveThresholds(configId, opts.thresholds);
  const e = getSim(configId, seed, !!opts.fresh);
  const linkage = buildLinkage(e.scn.register, policy);
  const ctx = { market: e.hm, trades: e.sim.tape.trades, prep: e.prep, tradesByInst: e.tradesByInst };
  const alerts = runRules(ctx, th, linkage);
  const score = scoreAlerts(alerts, e.groundTruth);
  return {
    modelVersion: MODEL_VERSION, configId, seed, linkagePolicy: policy, thresholds: th,
    market: e.market,
    register: e.scn.register,
    tape: e.sim.tape,
    ledger: e.sim.ledger,
    stats: {
      orders: e.sim.tape.orders.length, cancels: e.sim.tape.cancels.length, trades: e.sim.tape.trades.length,
      rejections: e.sim.stats.rejections, crossedBookEvents: e.sim.stats.crossedBookEvents,
    },
    linkage, alerts, score, groundTruth: e.groundTruth,
  };
}

/**
 * Independent recomputation of the market invariants from the tape alone.
 * Returns plain counters; a healthy run has every "violations" value at 0.
 */
export function checkInvariants(result) {
  const accts = new Set(result.register.rows.map((r) => r.acct));
  const pos = {}, cash = {};
  let badAccounts = 0, nonIntegerOrNonPositive = 0, selfTrades = 0;
  for (const t of result.tape.trades) {
    if (!accts.has(t.buyAcct) || !accts.has(t.sellAcct)) badAccounts++;
    if (!Number.isInteger(t.price) || !Number.isInteger(t.qty) || t.qty <= 0 || t.price <= 0) nonIntegerOrNonPositive++;
    if (t.buyAcct === t.sellAcct) selfTrades++;
    const n = t.price * t.qty;
    ((pos[t.buyAcct] ??= {})[t.inst] = ((pos[t.buyAcct] || {})[t.inst] || 0) + t.qty);
    ((pos[t.sellAcct] ??= {})[t.inst] = ((pos[t.sellAcct] || {})[t.inst] || 0) - t.qty);
    cash[t.buyAcct] = (cash[t.buyAcct] || 0) - n;
    cash[t.sellAcct] = (cash[t.sellAcct] || 0) + n;
  }
  const positionSum = {};
  let ledgerMismatch = 0;
  for (const a of Object.keys(pos)) {
    for (const [i, q] of Object.entries(pos[a])) {
      positionSum[i] = (positionSum[i] || 0) + q;
      if (((result.ledger.positions[a] || {})[i] || 0) !== q) ledgerMismatch++;
    }
    if ((result.ledger.cash[a] || 0) !== cash[a]) ledgerMismatch++;
  }
  const cashSum = Object.values(cash).reduce((s, v) => s + v, 0);
  return {
    crossedBookEvents: result.stats.crossedBookEvents,
    badAccounts, nonIntegerOrNonPositive, selfTrades, ledgerMismatch,
    positionSumByInstrument: positionSum, cashSum,
  };
}

function summarize(r) {
  const s = r.score;
  return { overall: s.overall, byRule: s.byRule, fpCauses: s.fpCauses };
}

function linkageSummary(r) {
  const gt = r.groundTruth;
  const ring = gt.episodes.find((e) => e.type === 'wash').accounts;
  const ringClusters = new Set(ring.map((a) => r.linkage.clusterOf[a]));
  const pair = gt.decoys.find((d) => d.type === 'coincidental-shared-attribute').accounts;
  const falseLinkFormed = r.linkage.clusterOf[pair[0]] === r.linkage.clusterOf[pair[1]];
  const falseAlerts = r.alerts.filter((a) => a.accounts.some((x) => pair.includes(x)) && r.score.labels[a.id].label === 'FP').length;
  return {
    clusters: r.linkage.clusters.length,
    ringFragments: ringClusters.size,
    ringWhole: ringClusters.size === 1,
    falseLinkFormed,
    falseLinkAlerts: falseAlerts,
  };
}

/**
 * Metric table for a range of one threshold (for charts), or for linkage policy.
 * The market is simulated once (cached); only detection is re-run per value.
 * @param {'equity'|'crypto'} configId
 * @param {string} param  a key of DEFAULTS.thresholds[configId], or 'linkagePolicy'
 * @param {Array} values
 * @param {{seed?:number, thresholds?:object, linkagePolicy?:string}} [opts] base settings
 */
export function sweep(configId, param, values, opts = {}) {
  const rows = [];
  for (const value of values) {
    const o = { ...opts };
    if (param === 'linkagePolicy') o.linkagePolicy = value;
    else o.thresholds = { ...(opts.thresholds || {}), [param]: value };
    const r = runScenario(configId, o);
    const row = { value, ...summarize(r) };
    if (param === 'linkagePolicy') row.linkage = linkageSummary(r);
    rows.push(row);
  }
  return { configId, param, seed: opts.seed ?? DEFAULTS.seed, rows };
}

export function linkageComparison(configId, opts = {}) {
  return sweep(configId, 'linkagePolicy', Object.keys(LINKAGE_POLICIES), opts);
}

export { caseView } from './caseview.js';

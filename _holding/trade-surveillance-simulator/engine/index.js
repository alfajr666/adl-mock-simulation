/*
 * Trade-surveillance simulator engine: public API.
 * Everything here is DOM-free, dependency-free and deterministic: the same
 * (configId, seed, thresholds, linkagePolicy) always yields the same result.
 * See ENGINE.md for the contract.
 */
import { simulate, makeBins, binIndexOf } from './agents.js';
import { buildLinkage, LINKAGE_POLICIES } from './linkage.js';
import { prepareBars, runRules } from './rules.js';
import { buildGroundTruth, scoreAlerts, RULES, RULE_TARGETS, PATTERN_RULES } from './score.js';
import { buildEquity } from './scenario-equity.js';
import { buildCrypto } from './scenario-crypto.js';

export const MODEL_VERSION = 'surv-model-1.1.0';
export { LINKAGE_POLICIES, RULES, RULE_TARGETS, PATTERN_RULES };

const BUILDERS = { equity: buildEquity, crypto: buildCrypto };
export const CONFIG_IDS = Object.keys(BUILDERS);

/** One plain object holds every threshold. Windows are counted in bins (see market.binMs). */
export const DEFAULTS = {
  seed: 1,
  linkagePolicy: 'weak2',
  thresholds: {
    equity: {
      w1MinCount: 1, w1MinLots: 1, w1MergeBins: 60,
      w2WindowBins: 4, w2MergeGapBins: 8, w2ClusterShare: 0.5, w2NetRatio: 0.6, w2InstrumentShare: 0.25, w2MinInternalLots: 10,
      p1Mode: 'instrument', p1Baseline: 'warmup', p1WindowBins: 10, p1MergeGapBins: 4, p1BaselineBins: 10, p1MoveScore: 5, p1VolMult: 2, p1MinReturnBps: 300,
      p2MinClusterSize: 2, p2RampShare: 0.25, p2RampEndFraction: 0.6, p2FollowBins: 20, p2NetSellRatio: 0.3, p2MinRampLots: 5, p2LookbackBins: 30,
    },
    crypto: {
      w1MinCount: 1, w1MinLots: 1, w1MergeBins: 90,
      w2WindowBins: 5, w2MergeGapBins: 6, w2ClusterShare: 0.5, w2NetRatio: 0.6, w2InstrumentShare: 0.25, w2MinInternalLots: 10,
      p1Mode: 'instrument', p1Baseline: 'warmup', p1WindowBins: 5, p1MergeGapBins: 6, p1BaselineBins: 20, p1MoveScore: 5, p1VolMult: 2, p1MinReturnBps: 300,
      p2MinClusterSize: 2, p2RampShare: 0.25, p2RampEndFraction: 0.6, p2FollowBins: 10, p2NetSellRatio: 0.3, p2MinRampLots: 5, p2LookbackBins: 40,
    },
  },
};

function deepFreeze(o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

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
  deepFreeze(sim.tape); deepFreeze(sim.ledger); deepFreeze(scn.register); deepFreeze(market); deepFreeze(groundTruth);
  const entry = { scn, sim, market, hm, groundTruth, prep: prepareBars(hm, trades), tradesByInst };
  if (!fresh) cache.set(key, entry);
  return entry;
}

function resolveThresholds(configId, over) {
  return { ...DEFAULTS.thresholds[configId], ...(over || {}) };
}

/**
 * The detection context: market description, trades and derived bars only. No scenario object,
 * no ground truth, no roles. (A structural test pins this shape.)
 */
export function detectionContext({ market, trades, prep, tradesByInst }) {
  const hm = hydrate(market);
  const byInst = tradesByInst || Object.fromEntries(market.instruments.map((d) => [d.id, trades.filter((t) => t.inst === d.id)]));
  return { market: hm, trades, prep: prep || prepareBars(hm, trades), tradesByInst: byInst };
}

/**
 * Run linkage and the alert rules on a tape. Usable on hand-built tapes.
 * @param {{market:object, register:object, trades:Array, thresholds:object, linkagePolicy:string}} input
 */
export function detect({ market, register, trades, thresholds, linkagePolicy = DEFAULTS.linkagePolicy, prep, tradesByInst }) {
  const linkage = buildLinkage(register, linkagePolicy);
  const alerts = runRules(detectionContext({ market, trades, prep, tradesByInst }), thresholds, linkage);
  return { alerts, linkage };
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
  const { alerts, linkage } = detect({ market: e.market, register: e.scn.register, trades: e.sim.tape.trades, thresholds: th, linkagePolicy: policy, prep: e.prep, tradesByInst: e.tradesByInst });
  const score = scoreAlerts(alerts, e.groundTruth);
  return deepFreeze({
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
  });
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

function linkageSummary(r) {
  const gt = r.groundTruth, roles = gt.accountRoles;
  const ring = gt.episodes.find((e) => e.type === 'wash').accounts;
  const ringClusters = new Set(ring.map((a) => r.linkage.clusterOf[a]));
  const pairDecoys = gt.decoys.filter((d) => ['coincidental-shared-attribute', 'unrelated-shared-strong-attribute', 'unrelated-shared-weak-attributes'].includes(d.type));
  const pair = pairDecoys[0].accounts;
  const honest = (a) => !(roles[a] || '').startsWith('planted-') && roles[a] !== 'market-maker';
  let falseLinkedPairs = 0;
  for (const c of r.linkage.clusters) {
    const h = c.accounts.filter(honest).length;
    falseLinkedPairs += (h * (h - 1)) / 2;               // unrelated honest accounts that share a cluster
  }
  return {
    clusters: r.linkage.clusters.length,
    largestCluster: Math.max(0, ...r.linkage.clusters.map((c) => c.accounts.length)),
    ringFragments: ringClusters.size,
    ringWhole: ringClusters.size === 1,
    falseLinkFormed: r.linkage.clusterOf[pair[0]] === r.linkage.clusterOf[pair[1]],       // the single-weak-attribute honest pair
    designedPairsLinked: pairDecoys.filter((d) => r.linkage.clusterOf[d.accounts[0]] === r.linkage.clusterOf[d.accounts[1]]).length,
    falseLinkedPairs,
    falseLinkAlerts: r.alerts.filter((a) => a.accounts.some((x) => pair.includes(x)) && r.score.labels[a.id].label === 'UNRELATED').length,
  };
}

/** Flat, chart-ready row for one run: group-level counts first, raw alert counts alongside. */
function row(r) {
  const o = r.score.overall;
  return {
    episodesFound: o.episodes.found, episodesMissed: o.episodes.missed,
    decoysAlerted: r.score.decoysAlerted.length,
    groups: o.groups, alerts: o.alerts,
    precision: o.precision, recall: o.recall,
    overall: o, byRule: r.score.byRule, selfMatch: r.score.selfMatch, causes: r.score.causes,
  };
}

/**
 * Metric table for a range of one threshold (for charts), or for linkage policy.
 * The market is simulated once (cached); only detection is re-run per value.
 * Plot `episodesFound`, `groups` and `decoysAlerted`, not raw alert counts: one episode can split into several alerts.
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
    const x = { value, ...row(r) };
    if (param === 'linkagePolicy') x.linkage = linkageSummary(r);
    rows.push(x);
  }
  return { configId, param, seed: opts.seed ?? DEFAULTS.seed, rows };
}

export function linkageComparison(configId, opts = {}) {
  return sweep(configId, 'linkagePolicy', Object.keys(LINKAGE_POLICIES), opts);
}

/** Do the designed detection targets hold in this run? (used by seedStudy and the tests) */
export function detectionTargets(r) {
  const gt = r.groundTruth;
  const shockInst = Object.entries(gt.instrumentRoles).find(([, v]) => v === 'benign-shock')[0];
  const t = {
    bothEpisodesFound: r.score.overall.episodes.missed === 0,
    explainablePresent: r.score.overall.alerts.explainable >= 1,
    shockAlertsOnP1: r.alerts.some((a) => a.rule === 'P1' && a.instrument === shockInst),
    shockQuietOnP2: !r.alerts.some((a) => a.rule === 'P2' && a.instrument === shockInst),
  };
  t.all = Object.values(t).every(Boolean);
  return t;
}

const med = (xs) => { const a = xs.filter((x) => x !== null && x !== undefined).sort((p, q) => p - q); const n = a.length; return n === 0 ? null : n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2; };

/**
 * Run many seeds. Returns per-seed rows and a summary (median / min / max) of group-level metrics.
 * @returns {{configId, seeds, opts, rows:Array, summary:Object, targetsPassing:number, failures:Array}}
 */
export function seedStudy(configId, seeds, opts = {}) {
  const rows = [];
  for (const seed of seeds) {
    const r = runScenario(configId, { ...opts, seed });
    const o = r.score.overall;
    const t = detectionTargets(r);
    const lk = linkageSummary(r);
    rows.push({
      seed,
      episodesFound: o.episodes.found,
      groups: o.groups.total, groupsMatch: o.groups.episodeMatches, groupsExplainable: o.groups.explainable, groupsUnrelated: o.groups.unrelated,
      alerts: o.alerts.total, alertsMatch: o.alerts.match, alertsExplainable: o.alerts.explainable, alertsUnrelated: o.alerts.unrelated,
      precisionGroupMatch: o.precision.group.match, precisionGroupMatchOrExplainable: o.precision.group.matchOrExplainable,
      precisionAlertMatch: o.precision.alert.match, precisionAlertMatchOrExplainable: o.precision.alert.matchOrExplainable,
      recall: o.recall,
      w2Found: r.score.byRule.W2.episodes.found, p1Found: r.score.byRule.P1.episodes.found, p2Found: r.score.byRule.P2.episodes.found,
      selfMatchAlerts: r.score.selfMatch.alerts,
      largestCluster: lk.largestCluster, falseLinkedPairs: lk.falseLinkedPairs, ringFragments: lk.ringFragments,
      targets: t,
    });
  }
  const cols = Object.keys(rows[0]).filter((k) => k !== 'seed' && k !== 'targets');
  const summary = {};
  for (const c of cols) {
    const v = rows.map((x) => x[c]).filter((x) => x !== null);
    summary[c] = { median: med(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  }
  const failures = rows.filter((x) => !x.targets.all).map((x) => ({ seed: x.seed, failed: Object.entries(x.targets).filter(([k, v]) => k !== 'all' && !v).map(([k]) => k) }));
  return { configId, seeds, opts, rows, summary, targetsPassing: rows.length - failures.length, failures };
}

export { caseView } from './caseview.js';

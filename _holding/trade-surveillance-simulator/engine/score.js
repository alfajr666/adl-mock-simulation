/*
 * Ground truth construction and alert scoring.
 * This is the ONLY module that reads ground truth; detectors never do.
 */
import { timeOfStep } from './agents.js';

export const RULE_TARGETS = { W1: 'wash', W2: 'wash', P1: 'pump', P2: 'pump' };
export const RULES = ['W1', 'W2', 'P1', 'P2'];
/** Pattern rules are scored against planted episodes; W1 is scored separately as self-match hygiene. */
export const PATTERN_RULES = ['W2', 'P1', 'P2'];

export function buildGroundTruth(scn, sim) {
  const S = scn.session, T = scn.truth, trades = sim.tape.trades;
  const episodes = [], decoys = [];

  // wash ring episode (window taken from the actual internal trades)
  const ring = new Set(scn.ring.accts);
  const wash = trades.filter((t) => ring.has(t.buyAcct) && ring.has(t.sellAcct));
  const wStart = wash[0].t, wEnd = wash[wash.length - 1].t + 1;
  const washInstQty = trades.filter((t) => t.inst === T.washInstrument && t.t >= wStart && t.t < wEnd).reduce((s, t) => s + t.qty, 0);
  const internalQty = wash.reduce((s, t) => s + t.qty, 0);
  const ringVolume = trades.filter((t) => t.inst === T.washInstrument && (ring.has(t.buyAcct) || ring.has(t.sellAcct))).reduce((s, t) => s + t.qty * ((ring.has(t.buyAcct) ? 1 : 0) + (ring.has(t.sellAcct) ? 1 : 0)), 0);
  episodes.push({
    id: 'EP-WASH-1', type: 'wash', instrument: T.washInstrument, controller: T.controller,
    accounts: [...scn.ring.accts], hubAccount: scn.ring.hub,
    weaklyLinkedAccounts: [scn.ring.hub],
    window: { startMs: wStart, endMs: wEnd },
    plantedTradeIds: wash.map((t) => t.id),
    stats: {
      internalQty, internalTrades: wash.length, selfTrades: wash.filter((t) => t.buyAcct === t.sellAcct).length,
      instrumentQtyInWindow: washInstQty,
      internalShareOfInstrumentQty: internalQty / washInstQty,          // internal qty (each trade once) / all qty in the instrument over the episode window
      internalShareOfRingSideVolume: (2 * internalQty) / ringVolume,    // internal volume counted on both sides / all volume on ring accounts' sides
      finalPositions: Object.fromEntries(scn.ring.accts.map((a) => [a, (sim.ledger.positions[a] || {})[T.washInstrument] || 0])),
    },
  });

  // pump episode
  const P = scn.pump, pumpSet = new Set(P.accts);
  const pTrades = trades.filter((t) => t.inst === P.inst);
  const lastPrice = pTrades[pTrades.length - 1].price;
  let cash = 0, pos = 0;
  for (const t of pTrades) {
    if (pumpSet.has(t.buyAcct)) { cash -= t.price * t.qty; pos += t.qty; }
    if (pumpSet.has(t.sellAcct)) { cash += t.price * t.qty; pos -= t.qty; }
  }
  const ph = (p) => ({ startMs: timeOfStep(S, p.from), endMs: timeOfStep(S, p.to - 1) + S.stepMs });
  episodes.push({
    id: 'EP-PUMP-1', type: 'pump', instrument: P.inst, controller: 'CTRL-2',
    accounts: [...P.accts],
    window: { startMs: ph(P.ramp).startMs, endMs: ph(P.distribute).endMs },
    phases: { accumulate: ph(P.accumulate), ramp: ph(P.ramp), distribute: ph(P.distribute) },
    signalMs: timeOfStep(S, P.ramp.from),            // the planted 'signal': the instant the ramp starts
    stats: { pnlTicksQty: cash + pos * lastPrice, cashTicksQty: cash, closingPosition: pos, markPrice: lastPrice },
  });

  // decoys: designed false-positive traps
  const mmSets = T.mmGroups.map((g) => new Set(g));
  let n = 0, cur = null;
  for (const t of trades) {
    if (t.inst !== T.transferInstrument) continue;
    for (const set of mmSets) {
      if (t.buyAcct !== t.sellAcct && set.has(t.buyAcct) && set.has(t.sellAcct)) {
        if (!cur || t.t - cur.endMs > 6 * S.binSteps * S.stepMs) {
          cur = { id: `DEC-MM-${++n}`, type: 'same-owner-cross', instrument: T.transferInstrument, accounts: [...set], window: { startMs: t.t, endMs: t.t + 1 }, tradeIds: [] };
          decoys.push(cur);
        }
        cur.window.endMs = t.t + 1; cur.endMs = t.t; cur.tradeIds.push(t.id);
      }
    }
  }
  for (const d of decoys) delete d.endMs;
  const news = scn.news[0];
  decoys.push({
    id: 'DEC-SHOCK-1', type: 'benign-news-shock', instrument: news.inst, accounts: [],
    window: { startMs: timeOfStep(S, news.step), endMs: timeOfStep(S, news.step + T.shockAftermathSteps) },
    jump: news.jump,
  });
  decoys.push({ id: 'DEC-LINK-1', type: 'coincidental-shared-attribute', accounts: [...T.falsePair], attribute: T.falseLinkAttribute, instrument: null, window: null });
  T.familyPairs.forEach((p, i) => decoys.push({ id: `DEC-FAMILY-${i + 1}`, type: 'unrelated-shared-strong-attribute', accounts: [...p], instrument: null, window: null }));
  T.householdPairs.forEach((p, i) => decoys.push({ id: `DEC-HOUSEHOLD-${i + 1}`, type: 'unrelated-shared-weak-attributes', accounts: [...p], instrument: null, window: null }));
  decoys.push({ id: 'DEC-ALGO-1', type: 'honest-self-match', accounts: [...T.algos], instrument: null, window: null });

  return {
    note: 'Ground truth for scoring and teaching only. The detector never reads this.',
    controllers: [{ id: T.controller, accounts: [...scn.ring.accts] }, { id: 'CTRL-2', accounts: [...P.accts] }],
    accountRoles: T.roles,
    instrumentRoles: T.roleOfInstrument,
    episodes, decoys,
  };
}

const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const LINK_DECOYS = new Set(['coincidental-shared-attribute', 'unrelated-shared-strong-attribute', 'unrelated-shared-weak-attributes']);

/** Label one alert. W1 is hygiene (SELF_MATCH); other rules are MATCH / EXPLAINABLE / UNRELATED. */
function mapAlert(alert, gt) {
  const roles = gt.accountRoles;
  if (alert.rule === 'W1') {
    const planted = alert.accounts.some((a) => (roles[a] || '').startsWith('planted-'));
    const algo = alert.accounts.some((a) => roles[a] === 'honest-algo');
    return { label: 'SELF_MATCH', episodeIds: [], decoyIds: planted ? [] : algo ? ['DEC-ALGO-1'] : [], cause: planted ? 'planted-account' : algo ? 'honest-algo' : 'other-account' };
  }
  const hits = [];
  for (const ep of gt.episodes) {
    if (RULE_TARGETS[alert.rule] !== ep.type || alert.instrument !== ep.instrument || !overlaps(alert.window, ep.window)) continue;
    const common = alert.accounts.filter((a) => ep.accounts.includes(a)).length;
    if (alert.rule === 'W2' && common < 2) continue;
    if (alert.rule === 'P2' && common < 1) continue;
    hits.push(ep.id);
  }
  if (hits.length) return { label: 'MATCH', episodeIds: hits, cause: null, decoyIds: [] };
  const decoyIds = [];
  for (const d of gt.decoys) {
    if (d.type === 'same-owner-cross' && alert.rule === 'W2' && d.instrument === alert.instrument && overlaps(alert.window, d.window)
      && alert.accounts.length >= 2 && alert.accounts.every((a) => d.accounts.includes(a))) decoyIds.push(d.id);
  }
  if (decoyIds.length) return { label: 'EXPLAINABLE', episodeIds: [], cause: 'same-owner-cross', decoyIds };
  let cause = 'unattributed';
  for (const d of gt.decoys) {
    if (d.type === 'benign-news-shock' && alert.rule !== 'W2' && d.instrument === alert.instrument && overlaps(alert.window, d.window)) { cause = 'benign-shock'; decoyIds.push(d.id); }
    if (LINK_DECOYS.has(d.type) && alert.accounts.length >= 2 && alert.accounts.every((a) => d.accounts.includes(a))) { cause = 'coincidental-link'; decoyIds.push(d.id); }
  }
  if (cause === 'unattributed') {
    if (alert.rule === 'P1') cause = 'natural-move';
    else if (alert.accounts.length >= 2 && alert.accounts.some((a) => !(roles[a] || '').startsWith('planted-'))) cause = 'background-collision';
  }
  return { label: 'UNRELATED', episodeIds: [], cause, decoyIds };
}

const ratio = (n, d) => (d === 0 ? null : n / d);

/** Alert-level and group-level counts for a set of alerts. Groups are (rule, episode | explainable-instrument | unrelated-instrument). */
function summarize(list, labels, plantedEpisodes) {
  const count = (l) => list.filter((a) => labels[a.id].label === l).length;
  const alerts = { total: list.length, match: count('MATCH'), explainable: count('EXPLAINABLE'), unrelated: count('UNRELATED') };
  const keys = { MATCH: new Set(), EXPLAINABLE: new Set(), UNRELATED: new Set() };
  for (const a of list) {
    const l = labels[a.id];
    keys[l.label].add(`${a.rule}|${l.label === 'MATCH' ? l.episodeIds.join('+') : a.instrument}`);
  }
  const groups = { total: keys.MATCH.size + keys.EXPLAINABLE.size + keys.UNRELATED.size, episodeMatches: keys.MATCH.size, explainable: keys.EXPLAINABLE.size, unrelated: keys.UNRELATED.size };
  const found = new Set(list.flatMap((a) => labels[a.id].episodeIds));
  const episodes = { planted: plantedEpisodes.length, found: found.size, missed: plantedEpisodes.length - found.size };
  return {
    alerts, groups, episodes,
    precision: {
      alert: { match: ratio(alerts.match, alerts.total), matchOrExplainable: ratio(alerts.match + alerts.explainable, alerts.total) },
      group: { match: ratio(groups.episodeMatches, groups.total), matchOrExplainable: ratio(groups.episodeMatches + groups.explainable, groups.total) },
    },
    recall: ratio(found.size, plantedEpisodes.length),
  };
}

export function scoreAlerts(alerts, gt) {
  const labels = {};
  for (const a of alerts) labels[a.id] = mapAlert(a, gt);
  const pattern = alerts.filter((a) => a.rule !== 'W1');
  const byRule = {};
  for (const rule of PATTERN_RULES) byRule[rule] = summarize(alerts.filter((a) => a.rule === rule), labels, gt.episodes.filter((e) => e.type === RULE_TARGETS[rule]));
  const overall = summarize(pattern, labels, gt.episodes);
  const w1 = alerts.filter((a) => a.rule === 'W1');
  const flagged = new Set(w1.flatMap((a) => a.accounts));
  const selfMatch = {
    note: 'Self-match hygiene (W1). Not part of overall, byRule or episode recall.',
    alerts: w1.length,
    onPlantedAccounts: w1.filter((a) => labels[a.id].cause === 'planted-account').length,
    onHonestAlgoAccounts: w1.filter((a) => labels[a.id].cause === 'honest-algo').length,
    onOtherAccounts: w1.filter((a) => labels[a.id].cause === 'other-account').length,
    accountsFlagged: flagged.size,
  };
  const causes = {}, causesByRule = {};
  for (const a of pattern) {
    const l = labels[a.id];
    if (l.label === 'MATCH') continue;
    causes[l.cause] = (causes[l.cause] || 0) + 1;
    const k = `${a.rule}:${l.cause}`; causesByRule[k] = (causesByRule[k] || 0) + 1;
  }
  const byEpisode = gt.episodes.map((e) => ({
    episodeId: e.id, type: e.type,
    detectedBy: PATTERN_RULES.filter((r) => pattern.some((a) => a.rule === r && labels[a.id].episodeIds.includes(e.id))),
    missed: !pattern.some((a) => labels[a.id].episodeIds.includes(e.id)),
  }));
  const decoysAlerted = [...new Set(pattern.flatMap((a) => labels[a.id].decoyIds))].sort();
  return { overall, byRule, selfMatch, byEpisode, decoysAlerted, causes, causesByRule, labels };
}

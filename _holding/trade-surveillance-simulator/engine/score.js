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
  const wash = trades.filter((t) => t.inst === T.washInstrument && ring.has(t.buyAcct) && ring.has(t.sellAcct));   // wash instrument only: cover activity elsewhere is not the episode
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
          cur = { id: `DEC-MM-${++n}`, designed: true, type: 'same-owner-cross', instrument: T.transferInstrument, accounts: [...set], window: { startMs: t.t, endMs: t.t + 1 }, tradeIds: [] };
          decoys.push(cur);
        }
        cur.window.endMs = t.t + 1; cur.endMs = t.t; cur.tradeIds.push(t.id);
      }
    }
  }
  for (const d of decoys) delete d.endMs;
  const news = scn.news[0];
  decoys.push({
    id: 'DEC-SHOCK-1', designed: true, type: 'benign-news-shock', instrument: news.inst, accounts: [],
    window: { startMs: timeOfStep(S, news.step), endMs: timeOfStep(S, news.step + T.shockAftermathSteps) },
    jump: news.jump,
  });
  decoys.push({ id: 'DEC-LINK-1', type: 'coincidental-shared-attribute', accounts: [...T.falsePair], attribute: T.falseLinkAttribute, instrument: null, window: null });
  T.familyPairs.forEach((p, i) => decoys.push({ id: `DEC-FAMILY-${i + 1}`, type: 'unrelated-shared-strong-attribute', accounts: [...p], instrument: null, window: null }));
  T.householdPairs.forEach((p, i) => decoys.push({ id: `DEC-HOUSEHOLD-${i + 1}`, type: 'unrelated-shared-weak-attributes', accounts: [...p], instrument: null, window: null }));
  // honest linked groups that cross against each other (seed-drawn, not designed traps)
  const gap = 6 * S.binSteps * S.stepMs;
  for (const g of T.honestGroups) {
    const set = new Set(g.accts);
    const cur2 = {};
    let k = 0;
    for (const t of trades) {
      if (t.buyAcct === t.sellAcct || !set.has(t.buyAcct) || !set.has(t.sellAcct)) continue;
      let c = cur2[t.inst];
      if (!c || t.t - c.last > gap) {
        c = cur2[t.inst] = { id: `DEC-GROUP-${g.id}-${++k}`, type: 'honest-linked-trading', instrument: t.inst, accounts: [...g.accts], window: { startMs: t.t, endMs: t.t + 1 }, tradeIds: [], last: t.t };
        decoys.push(c);
      }
      c.window.endMs = t.t + 1; c.last = t.t; c.tradeIds.push(t.id);
    }
  }
  for (const d of decoys) delete d.last;
  const after = 4 * S.binSteps * 10;                    // honest bursts and blocks keep moving the P1 windows for a while
  T.background.bursts.forEach((b, i) => decoys.push({ id: `DEC-BURST-${i + 1}`, type: 'honest-momentum-burst', instrument: b.inst, accounts: [], window: { startMs: timeOfStep(S, b.from), endMs: timeOfStep(S, b.to + after) } }));
  T.background.blocks.forEach((b, i) => decoys.push({ id: `DEC-BLOCK-${i + 1}`, type: 'honest-block-trade', instrument: b.inst, accounts: [b.acct], window: { startMs: timeOfStep(S, b.step), endMs: timeOfStep(S, b.step + after) } }));
  decoys.push({ id: 'DEC-ALGO-1', type: 'honest-self-match', accounts: [...T.algos], instrument: null, window: null });

  return {
    note: 'Ground truth for scoring and teaching only. The detector never reads this.',
    controllers: [{ id: T.controller, accounts: [...scn.ring.accts] }, { id: 'CTRL-2', accounts: [...P.accts] }],
    accountRoles: T.roles,
    instrumentRoles: T.roleOfInstrument,
    honestGroups: T.honestGroups.map((g) => ({ id: g.id, accounts: [...g.accts] })),
    episodes, decoys,
  };
}

const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
const TRAP_TYPES = new Set(['same-owner-cross', 'benign-news-shock']);
const MATCH_ACCOUNT_PRECISION = 0.5;

/** Label one alert. W1 is hygiene (SELF_MATCH); other rules are MATCH / MATCH_DILUTED / EXPLAINABLE / UNRELATED. */
function mapAlert(alert, gt) {
  const roles = gt.accountRoles;
  if (alert.rule === 'W1') {
    const planted = alert.accounts.some((a) => (roles[a] || '').startsWith('planted-'));
    const algo = alert.accounts.some((a) => roles[a] === 'honest-algo');
    return { label: 'SELF_MATCH', episodeIds: [], decoyIds: planted ? [] : algo ? ['DEC-ALGO-1'] : [], cause: planted ? 'planted-account' : algo ? 'honest-algo' : 'other-account', accountPrecision: null };
  }
  const hits = [];
  for (const ep of gt.episodes) {
    if (RULE_TARGETS[alert.rule] !== ep.type || alert.instrument !== ep.instrument || !overlaps(alert.window, ep.window)) continue;
    const common = alert.accounts.filter((a) => ep.accounts.includes(a)).length;
    if (alert.rule === 'W2' && common < 2) continue;
    if (alert.rule === 'P2' && common < 1) continue;
    hits.push({ id: ep.id, precision: alert.accounts.length === 0 ? null : common / alert.accounts.length });
  }
  if (hits.length) {
    // accountPrecision: planted episode accounts named by the alert / all accounts the alert names
    const best = hits.reduce((m, h) => ((h.precision ?? 1) > (m.precision ?? 1) ? h : m));
    const diluted = best.precision !== null && best.precision < MATCH_ACCOUNT_PRECISION;
    return { label: diluted ? 'MATCH_DILUTED' : 'MATCH', episodeIds: hits.map((h) => h.id), cause: null, decoyIds: [], accountPrecision: best.precision };
  }
  const near = (d) => d.instrument === alert.instrument && d.window && overlaps(alert.window, d.window);
  const subsetOf = (d) => alert.accounts.length >= 2 && alert.accounts.every((a) => d.accounts.includes(a));
  const ex = gt.decoys.filter((d) => d.type === 'same-owner-cross' && alert.rule === 'W2' && near(d) && subsetOf(d)).map((d) => d.id);
  if (ex.length) return { label: 'EXPLAINABLE', episodeIds: [], cause: 'same-owner-cross', decoyIds: ex, accountPrecision: null };
  const decoyIds = [];
  const first = (type) => gt.decoys.filter((d) => d.type === type && alert.rule !== 'W2' && near(d)).map((d) => d.id);
  let cause = 'unattributed';
  if (first('benign-news-shock').length) { cause = 'benign-shock'; decoyIds.push(...first('benign-news-shock')); }
  else if (alert.rule === 'P1' && first('honest-momentum-burst').length) { cause = 'benign-burst'; decoyIds.push(...first('honest-momentum-burst')); }
  else if (alert.rule === 'P1' && first('honest-block-trade').length) { cause = 'block-trade'; decoyIds.push(...first('honest-block-trade')); }
  else if (alert.accounts.length >= 2 && gt.honestGroups.some((g) => subsetOf(g))) {
    cause = 'honest-linked-trading';
    decoyIds.push(...gt.decoys.filter((d) => d.type === 'honest-linked-trading' && subsetOf(d) && near(d)).map((d) => d.id));
  } else if (alert.accounts.length >= 2 && gt.decoys.some((d) => d.type === 'coincidental-shared-attribute' && subsetOf(d))) cause = 'coincidental-link';
  else if (alert.rule === 'P1') cause = 'natural-move';
  else if (alert.accounts.length >= 2 && alert.accounts.some((a) => !(roles[a] || '').startsWith('planted-'))) cause = 'background-collision';
  return { label: 'UNRELATED', episodeIds: [], cause, decoyIds, accountPrecision: null };
}

const ratio = (n, d) => (d === 0 ? null : n / d);

/** Merge overlapping windows within keyed lists; returns the number of merged windows. */
function mergedCount(items, keyOf) {
  const byKey = new Map();
  for (const a of items) { const k = keyOf(a); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); }
  const out = [];
  for (const [k, list] of byKey) {
    list.sort((x, y) => x.window.startMs - y.window.startMs);
    let cur = null;
    for (const a of list) {
      if (cur && a.window.startMs < cur.endMs) { cur.endMs = Math.max(cur.endMs, a.window.endMs); cur.alerts.push(a); }
      else { cur = { key: k, startMs: a.window.startMs, endMs: a.window.endMs, alerts: [a] }; out.push(cur); }
    }
  }
  return out;
}
const clusterKey = (a) => (a.cluster ? a.cluster.id : '-');

/**
 * Episode status from a set of alerts. `clean`: a rule that names accounts (W2, P2) matches with accountPrecision >= 0.5.
 * `diluted`: such a rule matches but names mostly honest accounts. `priceOnly`: only P1 matched (the move was flagged, nobody was named).
 * `missed`: nothing matched.
 */
function episodeStatuses(list, labels, planted) {
  const out = {};
  for (const e of planted) {
    const mine = list.filter((a) => labels[a.id].episodeIds.includes(e.id));
    const naming = mine.filter((a) => a.rule !== 'P1');
    out[e.id] = naming.some((a) => labels[a.id].label === 'MATCH') ? 'clean'
      : naming.some((a) => labels[a.id].label === 'MATCH_DILUTED') ? 'diluted'
        : mine.some((a) => a.rule === 'P1') ? 'priceOnly' : 'missed';
  }
  return out;
}

/** Alert-level and rule-level group counts for a set of alerts. */
function summarize(list, labels, plantedEpisodes) {
  const count = (l) => list.filter((a) => labels[a.id].label === l).length;
  const alerts = { total: list.length, match: count('MATCH'), matchDiluted: count('MATCH_DILUTED'), explainable: count('EXPLAINABLE'), unrelated: count('UNRELATED') };
  const keys = { MATCH: new Set(), MATCH_DILUTED: new Set(), EXPLAINABLE: new Set() };
  for (const a of list) {
    const l = labels[a.id];
    if (l.label === 'MATCH' || l.label === 'MATCH_DILUTED') keys[l.label].add(`${a.rule}|${l.episodeIds.join('+')}`);
    else if (l.label === 'EXPLAINABLE') keys.EXPLAINABLE.add(`${a.rule}|${l.decoyIds[0]}`);
  }
  const unrelatedGroups = mergedCount(list.filter((a) => labels[a.id].label === 'UNRELATED'), (a) => `${a.rule}|${a.instrument}|${clusterKey(a)}`).length;
  const groups = { total: keys.MATCH.size + keys.MATCH_DILUTED.size + keys.EXPLAINABLE.size + unrelatedGroups, episodeMatches: keys.MATCH.size, diluted: keys.MATCH_DILUTED.size, explainable: keys.EXPLAINABLE.size, unrelated: unrelatedGroups };
  const st = episodeStatuses(list, labels, plantedEpisodes);
  const count2 = (k) => Object.values(st).filter((x) => x === k).length;
  const episodes = { planted: plantedEpisodes.length, found: count2('clean'), diluted: count2('diluted'), priceOnly: count2('priceOnly'), missed: count2('missed') };
  return {
    alerts, groups, episodes,
    precision: {
      alert: { match: ratio(alerts.match, alerts.total), matchOrExplainable: ratio(alerts.match + alerts.explainable, alerts.total) },
      group: { match: ratio(groups.episodeMatches, groups.total), matchOrExplainable: ratio(groups.episodeMatches + groups.explainable, groups.total) },
    },
    recall: ratio(episodes.found, plantedEpisodes.length),
  };
}

/** Rule-agnostic cases: one per planted episode found, one per designed trap that alerted, one per unrelated cluster window. */
function buildCases(pattern, labels, gt) {
  const list = [];
  const status = episodeStatuses(pattern, labels, gt.episodes);
  const KIND = { clean: 'episode', diluted: 'diluted-episode', priceOnly: 'price-only-episode' };
  for (const ep of gt.episodes) {
    if (status[ep.id] === 'missed') continue;
    const mine = pattern.filter((a) => labels[a.id].episodeIds.includes(ep.id));
    list.push({ id: `CASE-${ep.id}`, kind: KIND[status[ep.id]], key: ep.id, episodeId: ep.id, decoyId: null, instrument: ep.instrument,
      rules: [...new Set(mine.map((a) => a.rule))].sort(), alertIds: mine.map((a) => a.id), explainable: false });
  }
  const trapOf = (a) => labels[a.id].decoyIds.find((id) => TRAP_TYPES.has(gt.decoys.find((d) => d.id === id)?.type));
  const traps = new Map();
  for (const a of pattern) {
    const l = labels[a.id];
    if (l.label !== 'EXPLAINABLE' && l.label !== 'UNRELATED') continue;
    const t = trapOf(a);
    if (t) { if (!traps.has(t)) traps.set(t, []); traps.get(t).push(a); }
  }
  for (const [id, as] of [...traps].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    list.push({ id: `CASE-${id}`, kind: 'trap', key: id, episodeId: null, decoyId: id, instrument: as[0].instrument, rules: [...new Set(as.map((a) => a.rule))].sort(), alertIds: as.map((a) => a.id), explainable: as.every((a) => labels[a.id].label === 'EXPLAINABLE') });
  }
  const rest = pattern.filter((a) => labels[a.id].label === 'UNRELATED' && !trapOf(a));
  for (const m of mergedCount(rest, (a) => `${a.instrument}|${clusterKey(a)}`).sort((x, y) => (x.key + x.startMs < y.key + y.startMs ? -1 : 1))) {
    list.push({ id: `CASE-U-${m.key}-${m.startMs}`, kind: 'unrelated', key: m.key, episodeId: null, decoyId: null, instrument: m.alerts[0].instrument, rules: [...new Set(m.alerts.map((a) => a.rule))].sort(), alertIds: m.alerts.map((a) => a.id), explainable: false });
  }
  const n = (k) => list.filter((c) => c.kind === k).length;
  const total = list.length;
  const summary = {
    cases: total, episodeCases: n('episode'), dilutedEpisodeCases: n('diluted-episode'), priceOnlyEpisodeCases: n('price-only-episode'), trapCases: n('trap'), explainableCases: list.filter((c) => c.kind === 'trap' && c.explainable).length, unrelatedCases: n('unrelated'),
    shareMatchingEpisode: ratio(n('episode'), total),
    shareMatchingOrExplainable: ratio(n('episode') + list.filter((c) => c.kind === 'trap' && c.explainable).length, total),
    episodesFound: n('episode'), episodesPriceOnly: n('price-only-episode'), episodesMissed: gt.episodes.length - n('episode') - n('diluted-episode') - n('price-only-episode'),
  };
  return { summary, list };
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
    note: 'Self-match hygiene (W1). Not part of overall, byRule, cases or episode recall.',
    alerts: w1.length,
    onPlantedAccounts: w1.filter((a) => labels[a.id].cause === 'planted-account').length,
    onHonestAlgoAccounts: w1.filter((a) => labels[a.id].cause === 'honest-algo').length,
    onOtherAccounts: w1.filter((a) => labels[a.id].cause === 'other-account').length,
    accountsFlagged: flagged.size,
  };
  const causes = {}, causesByRule = {};
  for (const a of pattern) {
    const l = labels[a.id];
    if (l.label === 'MATCH' || l.label === 'MATCH_DILUTED') continue;
    causes[l.cause] = (causes[l.cause] || 0) + 1;
    const k = `${a.rule}:${l.cause}`; causesByRule[k] = (causesByRule[k] || 0) + 1;
  }
  const estatus = episodeStatuses(pattern, labels, gt.episodes);
  const byEpisode = gt.episodes.map((e) => ({
    episodeId: e.id, type: e.type,
    detectedBy: PATTERN_RULES.filter((r) => pattern.some((a) => a.rule === r && labels[a.id].label === 'MATCH' && labels[a.id].episodeIds.includes(e.id))),
    status: estatus[e.id],
    missed: estatus[e.id] === 'missed',
  }));
  const decoysAlerted = [...new Set(pattern.flatMap((a) => labels[a.id].decoyIds))].sort();
  const cases = buildCases(pattern, labels, gt);
  return { overall, byRule, selfMatch, caseSummary: cases.summary, cases: cases.list, byEpisode, decoysAlerted, causes, causesByRule, labels };
}

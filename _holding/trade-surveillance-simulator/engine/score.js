/*
 * Ground truth construction and alert scoring.
 * This is the ONLY module that reads ground truth; detectors never do.
 */
import { timeOfStep } from './agents.js';

export const RULE_TARGETS = { W1: 'wash', W2: 'wash', P1: 'pump', P2: 'pump' };
export const RULES = ['W1', 'W2', 'P1', 'P2'];

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
      internalShareOfInstrumentVolume: internalQty / washInstQty,
      internalShareOfRingVolume: (2 * internalQty) / ringVolume,
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
          cur = { id: `DEC-MM-${++n}`, type: 'market-maker-subaccount-transfer', instrument: T.transferInstrument, accounts: [...set], window: { startMs: t.t, endMs: t.t + 1 }, tradeIds: [] };
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

  return {
    note: 'Ground truth for scoring and teaching only. The detector never reads this.',
    controllers: [{ id: T.controller, accounts: [...scn.ring.accts] }, { id: 'CTRL-2', accounts: [...P.accts] }],
    accountRoles: T.roles,
    instrumentRoles: T.roleOfInstrument,
    episodes, decoys,
  };
}

const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;

function mapAlert(alert, gt) {
  const hits = [];
  for (const ep of gt.episodes) {
    if (RULE_TARGETS[alert.rule] !== ep.type || alert.instrument !== ep.instrument || !overlaps(alert.window, ep.window)) continue;
    const common = alert.accounts.filter((a) => ep.accounts.includes(a)).length;
    if (alert.rule === 'W1' && common < 1) continue;
    if (alert.rule === 'W2' && common < 2) continue;
    if (alert.rule === 'P2' && common < 1) continue;
    hits.push(ep.id);
  }
  if (hits.length) return { label: 'TP', episodeIds: hits, cause: null, decoyIds: [] };
  let cause = 'unattributed', decoyIds = [];
  const share = (d) => alert.accounts.filter((a) => d.accounts.includes(a)).length;
  for (const d of gt.decoys) {
    if (d.type === 'market-maker-subaccount-transfer' && alert.rule === 'W2' && d.instrument === alert.instrument && share(d) >= 2 && overlaps(alert.window, d.window)) { cause = 'market-maker-subaccounts'; decoyIds.push(d.id); }
    if (d.type === 'benign-news-shock' && alert.rule.startsWith('P') && d.instrument === alert.instrument && overlaps(alert.window, d.window)) { cause = 'benign-shock'; decoyIds.push(d.id); }
    if (d.type === 'coincidental-shared-attribute' && alert.rule === 'W2' && share(d) >= 2) { cause = 'coincidental-link'; decoyIds.push(d.id); }
  }
  if (cause === 'unattributed' && alert.rule === 'P1') cause = 'natural-volatility-or-volume';
  return { label: 'FP', episodeIds: [], cause, decoyIds };
}

const ratio = (n, d) => (d === 0 ? null : n / d);

export function scoreAlerts(alerts, gt) {
  const labels = {};
  for (const a of alerts) labels[a.id] = mapAlert(a, gt);
  const byRule = {};
  for (const rule of RULES) {
    const mine = alerts.filter((a) => a.rule === rule);
    const tp = mine.filter((a) => labels[a.id].label === 'TP');
    const targeted = gt.episodes.filter((e) => e.type === RULE_TARGETS[rule]);
    const detected = new Set(tp.flatMap((a) => labels[a.id].episodeIds));
    byRule[rule] = {
      alerts: mine.length, tp: tp.length, fp: mine.length - tp.length,
      episodes: targeted.length, detected: detected.size, fn: targeted.length - detected.size,
      precision: ratio(tp.length, mine.length), recall: ratio(detected.size, targeted.length),
    };
  }
  const tpAll = alerts.filter((a) => labels[a.id].label === 'TP');
  const detectedAll = new Set(tpAll.flatMap((a) => labels[a.id].episodeIds));
  const fpCauses = {};
  for (const a of alerts) if (labels[a.id].label === 'FP') { const c = labels[a.id].cause; fpCauses[c] = (fpCauses[c] || 0) + 1; }
  const byEpisode = gt.episodes.map((e) => ({
    episodeId: e.id, type: e.type,
    detectedBy: RULES.filter((r) => alerts.some((a) => a.rule === r && labels[a.id].episodeIds.includes(e.id))),
    missed: !detectedAll.has(e.id),
  }));
  const fpCausesByRule = {};
  for (const a of alerts) if (labels[a.id].label === 'FP') { const k = `${a.rule}:${labels[a.id].cause}`; fpCausesByRule[k] = (fpCausesByRule[k] || 0) + 1; }
  return {
    overall: {
      alerts: alerts.length, tp: tpAll.length, fp: alerts.length - tpAll.length,
      episodes: gt.episodes.length, detected: detectedAll.size, fn: gt.episodes.length - detectedAll.size,
      precision: ratio(tpAll.length, alerts.length), recall: ratio(detectedAll.size, gt.episodes.length),
    },
    byRule, byEpisode, fpCauses, fpCausesByRule, labels,
  };
}

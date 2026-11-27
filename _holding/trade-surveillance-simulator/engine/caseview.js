/*
 * Case-file view model for one alert. Pure function of a runScenario() result.
 * Everything a screen needs; planted truth is isolated under `groundTruth`.
 */
import { prepareBars } from './rules.js';
import { binIndexOf } from './agents.js';

const TOP_PARTICIPANTS = 6;

export function caseView(result, alertId) {
  const alert = result.alerts.find((a) => a.id === alertId);
  if (!alert) throw new Error(`Unknown alert: ${alertId}`);
  const { market, register, linkage, tape } = result;
  const inst = alert.instrument;
  const def = market.instruments.find((d) => d.id === inst);
  const tradeById = new Map();
  for (const t of tape.trades) tradeById.set(t.id, t);
  const instTrades = tape.trades.filter((t) => t.inst === inst);

  // ---- accounts shown on the case ------------------------------------------
  let accountIds = [...alert.accounts];
  let accountsNote = 'accounts named by the alert';
  const aggBuy = new Map(), aggSell = new Map();
  for (const t of instTrades) {
    if (t.t < alert.window.startMs || t.t >= alert.window.endMs) continue;
    if (t.aggressor === 'B') aggBuy.set(t.buyAcct, (aggBuy.get(t.buyAcct) || 0) + t.qty);
    else aggSell.set(t.sellAcct, (aggSell.get(t.sellAcct) || 0) + t.qty);
  }
  if (alert.rule === 'P1') {
    // a rising alert is explained by aggressive buyers, a falling one by aggressive sellers; both sides are listed
    accountsNote = `top aggressive ${alert.metrics.direction === 'down' ? 'sellers and buyers' : 'buyers and sellers'} in the alert window, with their clusters`;
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_PARTICIPANTS).map((x) => x[0]);
    const ranked = new Set([...top(aggBuy), ...top(aggSell)]);
    const set = new Set(ranked);
    for (const a of ranked) {
      const c = linkage.clusters.find((cl) => cl.id === linkage.clusterOf[a]);
      if (c) for (const m of c.accounts) set.add(m);
    }
    accountIds = [...set].sort();
  }
  const rowOf = new Map(register.rows.map((r) => [r.acct, r]));
  const accounts = accountIds.map((a) => ({
    ...rowOf.get(a),
    attributes: { ...rowOf.get(a).attributes },
    clusterId: linkage.clusterOf[a],
    finalPosition: (result.ledger.positions[a] || {})[inst] || 0,
    aggressiveBuyQty: aggBuy.get(a) || 0,
    aggressiveSellQty: aggSell.get(a) || 0,
  }));
  const idSet = new Set(accountIds);
  const edges = linkage.edges.filter((e) => idSet.has(e.a) && idSet.has(e.b));

  // ---- supporting trades ----------------------------------------------------
  const trades = alert.supportingTradeIds.map((id) => tradeById.get(id)).filter(Boolean)
    .map((t) => ({ ...t, notional: t.price * t.qty, selfTrade: t.buyAcct === t.sellAcct }));

  // ---- price / volume series per bin, alert window marked ---------------------
  const hm = { ...market, instrumentById: Object.fromEntries(market.instruments.map((d) => [d.id, d])), binIndexOf: (t) => binIndexOf(market.session, t) };
  const prep = prepareBars(hm, tape.trades);
  const bars = prep.bars[inst];
  const series = market.bins.map((b, i) => ({
    bin: i, startMs: b.t0, endMs: b.t1, open: bars.open[i], high: bars.high[i], low: bars.low[i], close: bars.close[i],
    qty: bars.qty[i], notional: bars.notional[i], trades: bars.count[i],
    inAlertWindow: b.t0 < alert.window.endMs && b.t1 > alert.window.startMs,   // any overlap
  }));

  // ---- cluster position and P&L over time (cash + position marked at bin close) --
  const groups = alert.cluster
    ? [{ clusterId: alert.cluster.id, accounts: alert.cluster.accounts }]
    : [...new Set(accountIds.map((a) => linkage.clusterOf[a]))].slice(0, 3).map((cid) => ({
      clusterId: cid, accounts: linkage.clusters.find((c) => c.id === cid)?.accounts ?? [cid.replace(/^CL-/, '')],
    }));
  const clusterSeries = groups.map((g) => {
    const set = new Set(g.accounts);
    const dPos = new Array(market.bins.length).fill(0), dCash = new Array(market.bins.length).fill(0);
    instTrades.forEach((t) => {
      const b = binIndexOf(market.session, t.t);
      if (set.has(t.buyAcct)) { dPos[b] += t.qty; dCash[b] -= t.price * t.qty; }
      if (set.has(t.sellAcct)) { dPos[b] -= t.qty; dCash[b] += t.price * t.qty; }
    });
    let pos = 0, cash = 0;
    const points = market.bins.map((b, i) => {
      pos += dPos[i]; cash += dCash[i];
      return { bin: i, endMs: b.t1, position: pos, cash, pnl: cash + pos * bars.close[i] };
    });
    return { clusterId: g.clusterId, accounts: g.accounts, points };
  });

  // ---- planted truth, kept apart ---------------------------------------------
  const label = result.score.labels[alert.id];
  const gt = result.groundTruth;
  const relevantEpisodes = gt.episodes.filter((e) => e.instrument === inst || e.accounts.some((a) => idSet.has(a)));
  const relevantDecoys = gt.decoys.filter((d) => d.instrument === inst || d.accounts.some((a) => idSet.has(a)));
  return {
    modelVersion: result.modelVersion,
    alert,
    instrument: def,
    linkagePolicy: linkage.policy,
    accountsNote,
    accounts,
    linkage: { edges, clusters: linkage.clusters.filter((c) => c.accounts.some((a) => idSet.has(a))) },
    trades,
    series,
    clusterSeries,
    groundTruth: {
      label: label.label, episodeIds: label.episodeIds, cause: label.cause, decoyIds: label.decoyIds,
      accountRoles: Object.fromEntries(accountIds.map((a) => [a, gt.accountRoles[a]])),
      episodes: relevantEpisodes.map((e) => ({ id: e.id, type: e.type, instrument: e.instrument, window: e.window, accounts: e.accounts, controller: e.controller, stats: e.stats })),
      decoys: relevantDecoys,
    },
  };
}

/*
 * Alert rules. The detector sees ONLY: market (instruments, session, bins),
 * register-derived linkage, and the tape. It never reads ground truth.
 *
 * Rules: W1 self-trade, W2 linked wash, P1 price-volume anomaly,
 * P2 accumulate-ramp-distribute. Every threshold comes from the `th` object
 * (see DEFAULTS in index.js); nothing is hard-coded in the rule functions.
 *
 * Windows are made of whole bins; consecutive flagged windows are merged into
 * one alert. Alerts are leads for review.
 */

// ---- prepared per-instrument bars (computed once per tape) -------------
export function prepareBars(market, trades) {
  const nBins = market.bins.length;
  const bars = {};
  for (const d of market.instruments) {
    bars[d.id] = {
      qty: new Array(nBins).fill(0), notional: new Array(nBins).fill(0), count: new Array(nBins).fill(0),
      open: new Array(nBins).fill(null), high: new Array(nBins).fill(null), low: new Array(nBins).fill(null), close: new Array(nBins).fill(null),
    };
  }
  const tradeBin = new Array(trades.length);
  trades.forEach((tr, i) => {
    const b = market.binIndexOf(tr.t);
    tradeBin[i] = b;
    const x = bars[tr.inst];
    x.qty[b] += tr.qty; x.notional[b] += tr.qty * tr.price; x.count[b]++;
    if (x.open[b] == null) { x.open[b] = tr.price; x.high[b] = tr.price; x.low[b] = tr.price; }
    if (tr.price > x.high[b]) x.high[b] = tr.price;
    if (tr.price < x.low[b]) x.low[b] = tr.price;
    x.close[b] = tr.price;
  });
  for (const d of market.instruments) {
    const x = bars[d.id];
    let prev = d.refPrice0;
    for (let b = 0; b < nBins; b++) {
      if (x.close[b] == null) { x.open[b] = prev; x.high[b] = prev; x.low[b] = prev; x.close[b] = prev; }
      prev = x.close[b];
    }
  }
  return { bars, tradeBin };
}

function median(arr) {
  const a = [...arr].sort((p, q) => p - q);
  const n = a.length;
  return n === 0 ? 0 : n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function mergeRuns(flags, gap = 0) {   // flags[i] = start index of a flagged window of w bins
  const runs = [];
  for (const i of flags) {
    const last = runs[runs.length - 1];
    if (last && i <= last.endStart + 1 + gap) last.endStart = i; else runs.push({ firstStart: i, endStart: i });
  }
  return runs;
}

// ---- W1: self-trade -----------------------------------------------------
export function ruleW1(ctx, th) {
  const { market, trades } = ctx;
  const binMs = market.binMs;
  const groups = new Map();
  for (const tr of trades) {
    if (tr.buyAcct !== tr.sellAcct) continue;
    const k = `${tr.buyAcct}|${tr.inst}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(tr);
  }
  const alerts = [];
  for (const [k, list] of groups) {
    const runs = [];
    for (const tr of list) {
      const last = runs[runs.length - 1];
      if (last && tr.t - last.end <= th.w1MergeBins * binMs) { last.trades.push(tr); last.end = tr.t; }
      else runs.push({ start: tr.t, end: tr.t, trades: [tr] });
    }
    const [acct, inst] = k.split('|');
    const lotSize = market.instrumentById[inst].lotSize;
    for (const r of runs) {
      const qty = r.trades.reduce((s, x) => s + x.qty, 0);
      const count = r.trades.length;
      if (count < th.w1MinCount || qty < th.w1MinLots * lotSize) continue;
      alerts.push({
        id: `W1|${inst}|${acct}|${r.start}`, rule: 'W1', instrument: inst,
        window: { startMs: r.start, endMs: r.end + 1 },
        accounts: [acct], cluster: null,
        metrics: { selfTradeCount: count, selfTradeQty: qty, selfTradeNotional: r.trades.reduce((s, x) => s + x.qty * x.price, 0) },
        thresholdsCrossed: { w1MinCount: { value: count, threshold: th.w1MinCount }, w1MinLots: { value: qty / lotSize, threshold: th.w1MinLots } },
        supportingTradeIds: r.trades.map((x) => x.id),
        supportingOrderIds: [...new Set(r.trades.flatMap((x) => [x.buyOrderId, x.sellOrderId]))].sort((a, b) => a - b),
      });
    }
  }
  return alerts;
}

// ---- W2: linked wash ----------------------------------------------------
export function ruleW2(ctx, th, linkage) {
  const { market, trades, prep } = ctx;
  const nBins = market.bins.length;
  const w = th.w2WindowBins;
  const alerts = [];
  const multi = new Set(linkage.clusters.map((c) => c.id));
  // per cluster+instrument per-bin sums
  const acc = new Map();
  const slot = (c, inst) => {
    const k = `${c}|${inst}`;
    let s = acc.get(k);
    if (!s) { s = { internal: new Array(nBins).fill(0), external: new Array(nBins).fill(0), buy: new Array(nBins).fill(0), sell: new Array(nBins).fill(0) }; acc.set(k, s); }
    return s;
  };
  trades.forEach((tr, i) => {
    const b = prep.tradeBin[i];
    const bc = linkage.clusterOf[tr.buyAcct], sc = linkage.clusterOf[tr.sellAcct];
    if (bc === sc) {
      if (!multi.has(bc)) return;
      const s = slot(bc, tr.inst);
      s.internal[b] += tr.qty; s.buy[b] += tr.qty; s.sell[b] += tr.qty;
    } else {
      if (multi.has(bc)) { const s = slot(bc, tr.inst); s.external[b] += tr.qty; s.buy[b] += tr.qty; }
      if (multi.has(sc)) { const s = slot(sc, tr.inst); s.external[b] += tr.qty; s.sell[b] += tr.qty; }
    }
  });
  const keys = [...acc.keys()].sort();
  for (const k of keys) {
    const [cid, inst] = k.split('|');
    const s = acc.get(k);
    const lotSize = market.instrumentById[inst].lotSize;
    const instQty = prep.bars[inst].qty;
    const flagged = [];
    const metricsAt = {};
    for (let i = 0; i + w <= nBins; i++) {
      let I = 0, E = 0, B = 0, S = 0, V = 0;
      for (let j = i; j < i + w; j++) { I += s.internal[j]; E += s.external[j]; B += s.buy[j]; S += s.sell[j]; V += instQty[j]; }
      if (I === 0 || I < th.w2MinInternalLots * lotSize) continue;
      const share = I / (I + E);
      const net = B + S === 0 ? 0 : Math.abs(B - S) / (B + S);
      const instShare = V === 0 ? 0 : I / V;
      if (share >= th.w2ClusterShare && net <= th.w2NetRatio && instShare >= th.w2InstrumentShare) {
        flagged.push(i);
        metricsAt[i] = { internalShareOfClusterVolume: share, netPositionRatio: net, internalShareOfInstrumentVolume: instShare, internalQty: I, externalQty: E };
      }
    }
    const cluster = linkage.clusters.find((c) => c.id === cid);
    for (const run of mergeRuns(flagged, th.w2MergeGapBins)) {
      const startBin = run.firstStart, endBin = run.endStart + w - 1;
      const t0 = market.bins[startBin].t0, t1 = market.bins[endBin].t1;
      let peak = flagged.find((i) => i >= run.firstStart);
      for (const i of flagged) if (i >= run.firstStart && i <= run.endStart && metricsAt[i].internalShareOfInstrumentVolume > metricsAt[peak].internalShareOfInstrumentVolume) peak = i;
      const set = new Set(cluster.accounts);
      const supTrades = trades.filter((tr) => tr.inst === inst && tr.t >= t0 && tr.t < t1 && set.has(tr.buyAcct) && set.has(tr.sellAcct));
      const sup = supTrades.map((tr) => tr.id);
      const supOrders = [...new Set(supTrades.flatMap((tr) => [tr.buyOrderId, tr.sellOrderId]))].sort((a, b) => a - b);
      const m = metricsAt[peak];
      alerts.push({
        id: `W2|${inst}|${cid}|${t0}`, rule: 'W2', instrument: inst,
        window: { startMs: t0, endMs: t1 },
        accounts: [...cluster.accounts], cluster: { id: cid, accounts: [...cluster.accounts] },
        metrics: { ...m, windowBins: w, peakWindowStartMs: market.bins[peak].t0 },
        thresholdsCrossed: {
          w2ClusterShare: { value: m.internalShareOfClusterVolume, threshold: th.w2ClusterShare },
          w2NetRatio: { value: m.netPositionRatio, threshold: th.w2NetRatio },
          w2InstrumentShare: { value: m.internalShareOfInstrumentVolume, threshold: th.w2InstrumentShare },
        },
        supportingTradeIds: sup, supportingOrderIds: supOrders,
      });
    }
  }
  return alerts;
}

// ---- P1: price-volume anomaly --------------------------------------------
export function baselines(ctx, th) {
  const { market, prep } = ctx;
  const nb = Math.min(th.p1BaselineBins, market.bins.length);
  const per = {};
  for (const d of market.instruments) {
    const x = prep.bars[d.id];
    const r2 = [], notional = [];
    let prev = d.refPrice0;
    for (let b = 0; b < nb; b++) {
      const r = (x.close[b] - prev) / prev;
      r2.push(r * r); notional.push(x.notional[b]); prev = x.close[b];
    }
    per[d.id] = { sigma: Math.sqrt(r2.reduce((s, v) => s + v, 0) / r2.length), medianNotional: median(notional) };
  }
  // one market-wide baseline: the typical (median) instrument, used for every instrument in 'global' mode
  const ids = Object.keys(per);
  const global = { sigma: median(ids.map((i) => per[i].sigma)), medianNotional: median(ids.map((i) => per[i].medianNotional)) };
  return { per, global };
}

export function ruleP1(ctx, th) {
  const { market, prep } = ctx;
  const nBins = market.bins.length;
  const w = th.p1WindowBins;
  const base = baselines(ctx, th);
  const alerts = [];
  for (const d of market.instruments) {
    const x = prep.bars[d.id];
    const bl = th.p1Mode === 'global' ? base.global : base.per[d.id];
    const sigma = bl.sigma > 0 ? bl.sigma : 1e-9;
    const v0 = bl.medianNotional > 0 ? bl.medianNotional : 1;
    const flagged = [], at = {};
    for (let i = 0; i + w <= nBins; i++) {
      const prev = i === 0 ? d.refPrice0 : x.close[i - 1];
      // largest close-to-start excursion inside the window (keeps a spike-and-reversal in one window)
      let ret = 0, N = 0;
      for (let j = i; j < i + w; j++) {
        const r = (x.close[j] - prev) / prev;
        if (Math.abs(r) > Math.abs(ret)) ret = r;
        N += x.notional[j];
      }
      const z = Math.abs(ret) / (sigma * Math.sqrt(w));
      const mult = N / (w * v0);
      if (z >= th.p1ZRet && mult >= th.p1VolMult && Math.abs(ret) * 10000 >= th.p1MinReturnBps) { flagged.push(i); at[i] = { returnBps: ret * 10000, zReturn: z, volumeMultiple: mult }; }
    }
    for (const run of mergeRuns(flagged, th.p1MergeGapBins)) {
      const startBin = run.firstStart, endBin = run.endStart + w - 1;
      const t0 = market.bins[startBin].t0, t1 = market.bins[endBin].t1;
      let peak = flagged.find((i) => i >= run.firstStart);
      for (const i of flagged) if (i >= run.firstStart && i <= run.endStart && at[i].zReturn > at[peak].zReturn) peak = i;
      const m = at[peak];
      const sup = ctx.tradesByInst[d.id].filter((tr) => tr.t >= t0 && tr.t < t1).map((tr) => tr.id);
      alerts.push({
        id: `P1|${d.id}|-|${t0}`, rule: 'P1', instrument: d.id,
        window: { startMs: t0, endMs: t1 },
        accounts: [], cluster: null,
        metrics: { ...m, direction: m.returnBps >= 0 ? 'up' : 'down', windowBins: w, baselineMode: th.p1Mode, baselineSigma: sigma, baselineMedianNotional: v0, startBin, endBin },
        thresholdsCrossed: {
          p1ZRet: { value: m.zReturn, threshold: th.p1ZRet },
          p1VolMult: { value: m.volumeMultiple, threshold: th.p1VolMult },
          p1MinReturnBps: { value: Math.abs(m.returnBps), threshold: th.p1MinReturnBps },
        },
        supportingTradeIds: sup, supportingOrderIds: [],
      });
    }
  }
  return alerts;
}

// ---- P2: accumulate - ramp - distribute ----------------------------------
export function ruleP2(ctx, th, linkage, p1Alerts) {
  const { market, prep } = ctx;
  const alerts = [];
  for (const a of p1Alerts) {
    const inst = a.instrument;
    const lotSize = market.instrumentById[inst].lotSize;
    const x = prep.bars[inst];
    const { startBin, endBin } = a.metrics;
    // ramp end: first bin that has covered `p2RampEndFraction` of the largest rise inside the P1 window
    const base0 = startBin === 0 ? market.instrumentById[inst].refPrice0 : x.close[startBin - 1];
    let peakBin = startBin;
    for (let b = startBin; b <= endBin; b++) if (x.close[b] > x.close[peakBin]) peakBin = b;
    const rise = x.close[peakBin] - base0;
    let rampEnd = peakBin;
    for (let b = startBin; b <= peakBin; b++) if (x.close[b] - base0 >= th.p2RampEndFraction * rise) { rampEnd = b; break; }
    const followEnd = Math.min(market.bins.length - 1, rampEnd + th.p2FollowBins);
    const rampT0 = market.bins[startBin].t0, rampT1 = market.bins[rampEnd].t1;       // ramp: window start .. end of ramp-end bin
    const folT0 = rampT1, folT1 = market.bins[followEnd].t1;
    const lookT0 = market.bins[Math.max(0, startBin - th.p2LookbackBins)].t0;
    const instTrades = ctx.tradesByInst[inst];

    const aggBuy = new Map();
    let aggTotal = 0;
    for (const tr of instTrades) {
      if (tr.t < rampT0 || tr.t >= rampT1 || tr.aggressor !== 'B') continue;
      const c = linkage.clusterOf[tr.buyAcct];
      aggBuy.set(c, (aggBuy.get(c) || 0) + tr.qty);
      aggTotal += tr.qty;
    }
    if (aggTotal === 0) continue;
    const cands = [...aggBuy.keys()].sort();
    for (const cid of cands) {
      const rampQty = aggBuy.get(cid);
      const share = rampQty / aggTotal;
      const members = linkage.clusters.find((c) => c.id === cid)?.accounts ?? [cid.replace(/^CL-/, '')];
      if (members.length < th.p2MinClusterSize || share < th.p2RampShare || rampQty < th.p2MinRampLots * lotSize) continue;
      let buy = 0, sell = 0;
      for (const tr of instTrades) {
        if (tr.t < folT0 || tr.t >= folT1) continue;
        if (linkage.clusterOf[tr.buyAcct] === cid && linkage.clusterOf[tr.sellAcct] !== cid) buy += tr.qty;
        if (linkage.clusterOf[tr.sellAcct] === cid && linkage.clusterOf[tr.buyAcct] !== cid) sell += tr.qty;
      }
      const netSell = sell - buy;
      const ratio = netSell / rampQty;
      if (ratio < th.p2NetSellRatio) continue;
      // realised P&L in ticks x qty over [lookback, follow end), open inventory marked at the last print
      let cash = 0, pos = 0, mark = null;
      const sup = [], supOrders = new Set();
      for (const tr of instTrades) {
        if (tr.t < lookT0 || tr.t >= folT1) continue;
        mark = tr.price;
        const bi = linkage.clusterOf[tr.buyAcct] === cid, si = linkage.clusterOf[tr.sellAcct] === cid;
        if (bi) { cash -= tr.price * tr.qty; pos += tr.qty; }
        if (si) { cash += tr.price * tr.qty; pos -= tr.qty; }
        if ((bi || si) && !(bi && si)) {
          if ((bi && tr.aggressor === 'B' && tr.t >= rampT0 && tr.t < rampT1) || (si && tr.t >= folT0)) {
            sup.push(tr.id);
            supOrders.add(bi ? tr.buyOrderId : tr.sellOrderId);
          }
        }
      }
      const accounts = members;
      alerts.push({
        id: `P2|${inst}|${cid}|${a.window.startMs}`, rule: 'P2', instrument: inst,
        window: { startMs: a.window.startMs, endMs: folT1 },
        accounts, cluster: { id: cid, accounts: [...accounts] },
        metrics: {
          rampAggressiveBuyShare: share, rampAggressiveBuyQty: rampQty, followNetSellQty: netSell, followNetSellRatio: ratio,
          pnlTicksQty: cash + pos * mark, cashTicksQty: cash, closingPosition: pos, markPrice: mark,
          p1AlertId: a.id, peakBin, rampEndBin: rampEnd, rampWindow: { startMs: rampT0, endMs: rampT1 }, followWindow: { startMs: folT0, endMs: folT1 },
        },
        thresholdsCrossed: {
          p2RampShare: { value: share, threshold: th.p2RampShare },
          p2NetSellRatio: { value: ratio, threshold: th.p2NetSellRatio },
        },
        supportingTradeIds: sup, supportingOrderIds: [...supOrders].sort((a, b) => a - b),
      });
    }
  }
  return alerts;
}

export function runRules(ctx, th, linkage) {
  const w1 = ruleW1(ctx, th);
  const w2 = ruleW2(ctx, th, linkage);
  const p1 = ruleP1(ctx, th);
  const p2 = ruleP2(ctx, th, linkage, p1);
  return [...w1, ...w2, ...p1, ...p2];
}

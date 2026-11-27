/*
 * Seeded participants and the step loop that drives the matching engine.
 *
 * Agents only ever call exchange.submit / exchange.cancel; every trade on the
 * tape is produced by the matcher. Agents may use floats to SAMPLE a price or
 * size; they round to integer ticks / lots before an order exists.
 *
 * Participants: retail (a subset follows momentum), market-maker groups (with
 * optional sub-accounts and scheduled inventory transfers between them), a
 * wash ring (hub-and-spoke, one hidden controller), a pump group, and
 * news-driven fair-value jumps.
 */
import { Exchange } from './book.js';
import { streams } from './prng.js';

export function timeOfStep(session, step) {
  const day = Math.floor(step / session.stepsPerDay);
  return day * session.dayMs + (step % session.stepsPerDay) * session.stepMs;
}

export function makeBins(session) {
  const binMs = session.binSteps * session.stepMs;
  const perDay = session.stepsPerDay / session.binSteps;
  const bins = [];
  for (let d = 0; d < session.days; d++) {
    for (let b = 0; b < perDay; b++) {
      const t0 = d * session.dayMs + b * binMs;
      bins.push({ index: d * perDay + b, day: d, t0, t1: t0 + binMs });
    }
  }
  return bins;
}

export function binIndexOf(session, t) {
  const binMs = session.binSteps * session.stepMs;
  const perDay = session.stepsPerDay / session.binSteps;
  const d = Math.floor(t / session.dayMs);
  return d * perDay + Math.floor((t - d * session.dayMs) / binMs);
}

function lotsFor(rng, max) { return 1 + Math.floor(rng.u() * rng.u() * max); }

export function simulate(scn, seed) {
  const R = streams(seed);
  const S = scn.session;
  const defs = {};
  for (const d of scn.instruments) defs[d.id] = d;
  const ex = new Exchange(scn.instruments.map((d) => ({ id: d.id, lotSize: d.lotSize, bandPct: d.bandPct, refPrice: d.price0 })));
  const world = {};
  for (const d of scn.instruments) world[d.id] = { fair: d.price0, heat: 0, heatDir: 0, closes: [], rng: R(`fair:${d.id}`) };
  const worldRng = R('world');
  const instIds = scn.instruments.map((d) => d.id);
  const wsum = instIds.reduce((s, id) => s + defs[id].retailWeight, 0);

  const ctx = {
    step: 0, ex, scn, rise: {}, hot: [],
    ref(inst) {
      const w = world[inst];
      const last = ex.last(inst);
      return Math.max(1, Math.round(last + defs[inst].fairPull * (w.fair - last)));
    },
  };

  // ---- agents -------------------------------------------------------
  const retail = scn.retail.accts.map((acct) => ({
    acct, rng: R(`retail:${acct}`), momentum: scn.retail.momentum.includes(acct), live: [], hold: {}, cool: {}, sens: 2 + 2 * R(`sens:${acct}`).u(),
  }));
  const mms = scn.mm.map((g) => ({ ...g, rng: R(`mm:${g.id}`), live: [] }));
  const ring = scn.ring ? { ...scn.ring, rng: R('ring'), cursor: 0 } : null;
  const pump = scn.pump ? { ...scn.pump, rng: R('pump'), live: [], rampP0: null } : null;
  const transfers = scn.transfers.map((x) => ({ ...x }));
  const log = { transfers: [] };

  function pickInstrument(rng) {
    let x = rng.u() * wsum;
    for (const id of instIds) { x -= defs[id].retailWeight; if (x <= 0) return id; }
    return instIds[instIds.length - 1];
  }

  function retailAct(a) {
    const rs = scn.retail;
    a.live = a.live.filter((o) => {
      if (!ex.isLive(o.id)) return false;
      if (ctx.step - o.step >= o.ttl) { ex.cancel(o.id, 'EXPIRED'); return false; }
      return true;
    });
    const rng = a.rng;
    let inst = null, mode = null;
    let held = [];
    const hype = scn.hype.find((h) => ctx.step >= h.from && ctx.step < h.to);
    if (hype && rng.chance(hype.p)) {
      inst = hype.inst; mode = 'hype';
    } else if (a.momentum) {
      // a sharp rise recruits this follower for `followHold` steps (late-arriving retail buying)
      for (const id of instIds) {
        if (a.hold[id] > ctx.step || a.cool[id] > ctx.step) continue;
        // each follower has its own sensitivity: later followers need a bigger rise (graded entry)
        const need = a.sens * S.momentumK * defs[id].volStep * Math.sqrt(S.momentumSteps);
        if (ctx.rise[id] >= need && rng.chance(rs.followTriggerP)) { a.hold[id] = ctx.step + rs.followHold; a.cool[id] = a.hold[id] + rs.followCooldown; }
      }
      held = instIds.filter((id) => a.hold[id] > ctx.step);
    }
    if (mode === 'hype') {
      /* crowd reacting to the promoted name */
    } else if (held.length && rng.chance(rs.followProb)) {
      inst = held[rng.int(0, held.length - 1)]; mode = 'follow';
    } else if (ctx.hot.length && rng.chance(rs.newsActProb)) {
      inst = ctx.hot[rng.int(0, ctx.hot.length - 1)]; mode = 'news';
    } else if (rng.chance(rs.actProb)) {
      inst = pickInstrument(rng); mode = 'normal';
    }
    if (!inst) return;
    const d = defs[inst];
    let side, type = 'L', price = null, lots;
    if (mode === 'hype') {
      side = 'B'; type = 'M'; lots = rng.int(hype.lots[0], hype.lots[1]);
    } else if (mode === 'follow') {
      side = 'B'; type = 'M'; lots = 1 + Math.floor(rng.u() * 2);
      if (ctx.followLeft[inst] < lots) return;          // per-instrument cap on follower demand per step
      ctx.followLeft[inst] -= lots;
    } else if (mode === 'news') {
      const dir = world[inst].heatDir;
      side = rng.chance(0.88) ? (dir > 0 ? 'B' : 'S') : (dir > 0 ? 'S' : 'B');
      price = Math.max(1, Math.round(world[inst].fair));
      lots = lotsFor(rng, d.retailLotsMax) + 1;
    } else {
      side = rng.chance(0.5) ? 'B' : 'S';
      lots = lotsFor(rng, d.retailLotsMax);
      const ref = ctx.ref(inst);
      if (rng.chance(rs.marketProb)) { type = 'M'; lots = 1 + (lots > 2 ? 1 : 0); }
      else {
        price = Math.max(1, ref + Math.round(rng.norm() * d.retailSpread));
        if (d.fatFinger && rng.chance(d.fatFinger)) price = Math.max(1, Math.round(ref * (side === 'B' ? 1.35 : 0.65)));
      }
    }
    // one live order per instrument: pull the old one first (also avoids accidental self-trades)
    for (const o of a.live) if (o.inst === inst && ex.isLive(o.id)) ex.cancel(o.id, 'REPLACED');
    a.live = a.live.filter((o) => ex.isLive(o.id));
    const r = ex.submit({ acct: a.acct, inst, side, type, price, qty: lots * d.lotSize });
    if (type === 'L' && (r.status === 'resting' || r.status === 'partial')) {
      a.live.push({ id: r.id, inst, step: ctx.step, ttl: rs.ttl[0] + rng.int(0, rs.ttl[1] - rs.ttl[0]) });
    }
  }

  function mmQuote(g) {
    // requote on schedule, or as soon as any of the group's quotes has been consumed
    if (ctx.step % g.refreshSteps !== 0 && !g.live.some((id) => !ex.isLive(id))) return;
    for (const id of g.live) ex.cancel(id, 'REQUOTE');
    g.live = [];
    for (const inst of g.instruments) {
      const d = defs[inst];
      const anchor = ctx.ref(inst);
      for (let k = 0; k < g.levels; k++) {
        for (const acct of g.accts) {
          const lots = Math.max(1, Math.round(d.mmLots * (0.7 + 0.6 * g.rng.u()) / g.accts.length));
          const qty = lots * d.lotSize;
          const off = d.mmHalf + k * d.mmGap;
          for (const side of ['B', 'S']) {
            let px = side === 'B' ? anchor - off : anchor + off;
            // market makers are post-only: a quote never takes liquidity
            if (side === 'B') { const a = ex.bestAsk(inst); if (a != null && px >= a) px = a - 1; }
            else { const b = ex.bestBid(inst); if (b != null && px <= b) px = b + 1; }
            if (px < 1) continue;
            const r = ex.submit({ acct, inst, side, type: 'L', price: px, qty });
            if (r.status === 'resting' || r.status === 'partial') g.live.push(r.id);
          }
        }
      }
    }
  }

  /** Cross two accounts inside the spread: `to` rests a bid, `from` sells into it. */
  function insidePrice(inst, rng, jitter = 1) {
    const bid = ex.bestBid(inst), ask = ex.bestAsk(inst);
    if (bid == null || ask == null || ask - bid < 2) return null;
    const mid = Math.floor((bid + ask) / 2);
    return Math.min(ask - 1, Math.max(bid + 1, mid + rng.int(-jitter, jitter)));
  }

  function crossPair(inst, buyer, seller, qty, restingSide, rng) {
    const p = insidePrice(inst, rng);
    if (p == null) return false;
    const first = restingSide === 'B' ? { acct: buyer, side: 'B' } : { acct: seller, side: 'S' };
    const second = restingSide === 'B' ? { acct: seller, side: 'S' } : { acct: buyer, side: 'B' };
    const r1 = ex.submit({ acct: first.acct, inst, side: first.side, type: 'L', price: p, qty });
    ex.submit({ acct: second.acct, inst, side: second.side, type: 'L', price: p, qty });
    if (r1.id && ex.isLive(r1.id)) ex.cancel(r1.id, 'UNFILLED_CROSS');
    return true;
  }

  function runTransfers() {
    for (const tr of transfers) {
      if (tr.step !== ctx.step) continue;
      const d = defs[tr.inst];
      const ok = crossPair(tr.inst, tr.to, tr.from, tr.lots * d.lotSize, 'B', mms[0].rng);
      log.transfers.push({ step: ctx.step, inst: tr.inst, ok });
      if (!ok) tr.step = ctx.step + 1;       // retry next step if the spread was too tight
    }
  }

  function ringAct() {
    const c = ring;
    if (ctx.step < c.fromStep || ctx.step >= c.toStep) return;
    if (!c.selfSteps.includes(ctx.step) && !c.rng.chance(c.actProb)) return;
    const d = defs[c.inst];
    const rng = c.rng;
    const spokes = c.accts.filter((a) => a !== c.hub);
    if (c.selfSteps.includes(ctx.step)) {
      const a = rng.pick(c.accts);
      crossPair(c.inst, a, a, rng.int(1, 2) * d.lotSize, 'B', rng);       // scheduled crude self-cross
    }
    const n = rng.int(1, c.maxTrades);
    for (let i = 0; i < n; i++) {
      const roll = rng.u();
      const qty = rng.int(c.lotsMin, c.lotsMax) * d.lotSize;
      if (roll < c.selfP) {
        const a = rng.pick(c.accts);
        crossPair(c.inst, a, a, rng.int(1, 2) * d.lotSize, 'B', rng);
      } else if (roll < c.selfP + c.leakP) {
        // one-sided market order by the member with the largest |position| (reduces it)
        let best = c.accts[0], bp = -1;
        for (const a of c.accts) { const p = Math.abs(ex.position(a, c.inst)); if (p > bp) { bp = p; best = a; } }
        const pos = ex.position(best, c.inst);
        ex.submit({ acct: best, inst: c.inst, side: pos > 0 ? 'S' : 'B', type: 'M', qty: Math.min(qty, Math.max(1, Math.abs(pos) / d.lotSize | 0) * d.lotSize) });
      } else {
        let x, y;
        if (rng.chance(c.spokeSpokeP)) {
          x = rng.pick(spokes); do { y = rng.pick(spokes); } while (y === x);
        } else { x = c.hub; y = spokes[c.cursor++ % spokes.length]; }
        const px = ex.position(x, c.inst), py = ex.position(y, c.inst);
        const buyer = px < py ? x : px > py ? y : (rng.chance(0.5) ? x : y);
        const seller = buyer === x ? y : x;
        crossPair(c.inst, buyer, seller, qty, rng.chance(0.5) ? 'B' : 'S', rng);
      }
    }
  }

  function pumpAct() {
    const c = pump;
    const d = defs[c.inst];
    const rng = c.rng;
    const s = ctx.step;
    const inAcc = s >= c.accumulate.from && s < c.accumulate.to;
    const inRamp = s >= c.ramp.from && s < c.ramp.to;
    const inDist = s >= c.distribute.from && s < c.distribute.to;
    if (!inAcc && !inRamp && !inDist) return;
    for (const id of c.live) ex.cancel(id, 'REPLACED');
    c.live = [];
    const keep = (r) => { if (r.status === 'resting' || r.status === 'partial') c.live.push(r.id); };
    const bid0 = ex.bestBid(c.inst), ask0 = ex.bestAsk(c.inst);        // quotes seen at the start of the step
    if (inAcc) {
      for (const acct of c.accts) {
        const bid = bid0;
        if (rng.chance(c.accumulate.p) && bid != null) {
          const px = ask0 != null && ask0 - bid >= 3 ? bid + 1 : bid;    // passive; quotes read once per step, so no ratchet
          keep(ex.submit({ acct, inst: c.inst, side: 'B', type: 'L', price: px, qty: rng.int(1, c.accumulate.lots) * d.lotSize }));
        }
        if (rng.chance(c.accumulate.marketP)) ex.submit({ acct, inst: c.inst, side: 'B', type: 'M', qty: rng.int(1, c.accumulate.lots) * d.lotSize });
      }
    } else if (inRamp) {
      if (c.rampP0 == null) c.rampP0 = ex.last(c.inst);
      // aggressive market buying until the price has risen by `gain` from where the ramp began
      if (ex.last(c.inst) < c.rampP0 * (1 + c.ramp.gain)) {
        for (const acct of c.accts) {
          if (rng.chance(c.ramp.p)) ex.submit({ acct, inst: c.inst, side: 'B', type: 'M', qty: rng.int(c.ramp.lots[0], c.ramp.lots[1]) * d.lotSize });
        }
      }
    } else {
      const cleanup = s >= c.distribute.cleanupFrom;
      for (const acct of c.accts) {
        const pos = ex.position(acct, c.inst);
        if (pos <= 0) continue;
        const bid = bid0, ask = ask0;
        let left = pos;
        if (ask != null && !cleanup) {
          const q = Math.min(left, c.distribute.passiveLots * d.lotSize);
          const px = bid != null && ask - bid >= 2 ? ask - 1 : ask;
          if (q > 0) { keep(ex.submit({ acct, inst: c.inst, side: 'S', type: 'L', price: px, qty: q })); left -= q; }
        }
        const q2 = Math.min(left, (cleanup ? c.distribute.cleanupLots : c.distribute.aggressiveLots) * d.lotSize);
        if (q2 > 0) ex.submit({ acct, inst: c.inst, side: 'S', type: 'M', qty: q2 });
      }
    }
  }

  // ---- step loop ------------------------------------------------------
  const total = S.days * S.stepsPerDay;
  const K = S.momentumSteps;
  for (let s = 0; s < total; s++) {
    ctx.step = s;
    const t = timeOfStep(S, s);
    ex.beginStep(t, S.stepMs);
    if (s % S.stepsPerDay === 0) for (const id of instIds) ex.setReference(id, ex.last(id));
    for (const id of instIds) {
      const w = world[id];
      w.fair = Math.max(1, w.fair * (1 + defs[id].volStep * w.rng.norm()));
    }
    for (const n of scn.news) {
      if (n.step === s) { world[n.inst].fair *= 1 + n.jump; world[n.inst].heat = n.heatSteps; world[n.inst].heatDir = Math.sign(n.jump); }
    }
    ctx.followLeft = {};
    for (const id of instIds) ctx.followLeft[id] = defs[id].followCap;
    ctx.hot = instIds.filter((id) => world[id].heat > 0);
    ctx.rise = {};
    for (const id of instIds) {
      const c = world[id].closes;
      ctx.rise[id] = c.length <= K ? 0 : ex.last(id) / c[c.length - 1 - K] - 1;
    }

    for (const g of mms) mmQuote(g);
    runTransfers();
    if (ring) ringAct();
    if (pump) pumpAct();
    const order = worldRng.shuffle(retail.map((_, i) => i));
    for (const i of order) retailAct(retail[i]);

    for (const id of instIds) {
      world[id].closes.push(ex.last(id));
      if (world[id].heat > 0) world[id].heat--;
    }
  }

  return {
    tape: { orders: ex.orders, cancels: ex.cancels, trades: ex.trades },
    ledger: { positions: ex.positions, cash: ex.cash },
    stats: { crossedBookEvents: ex.crossedEvents, rejections: ex.rejections, steps: total },
    log,
  };
}

/*
 * Minimal central limit order book (one book per instrument), price-time
 * priority, limit and market orders, cancels, partial fills.
 *
 * All money is integer: prices are integer ticks, quantities integers, so
 * notional = price * qty is an exact integer. Self-trades are NOT prevented:
 * whatever the matcher does is what the tape shows.
 *
 * Order side: 'B' | 'S'.  Order type: 'L' (limit) | 'M' (market, IOC).
 * Every event has a global sequence number `seq`; order id === its seq,
 * trade id === its seq.
 */

export class Exchange {
  /** @param {Array<{id:string,lotSize:number,bandPct:(number|null),refPrice:number}>} instruments */
  constructor(instruments) {
    this.books = {};
    for (const d of instruments) {
      this.books[d.id] = {
        def: d, bids: new Map(), asks: new Map(), bidPx: [], askPx: [],
        ref: d.refPrice, last: d.refPrice, lastTradeSeen: false,
      };
    }
    this.seq = 0;
    this.orders = [];
    this.cancels = [];
    this.trades = [];
    this.live = new Map();
    this.positions = {};
    this.cash = {};
    this.crossedEvents = 0;
    this.rejections = { BAND: 0, LOT: 0, PRICE: 0, QTY: 0 };
    this.clockBase = 0;
    this.clockN = 0;
    this.stepMs = 1;
  }

  /** Start a simulation step: events get t = base + k ms (k increments per event). */
  beginStep(t, stepMs) { this.clockBase = t; this.clockN = 0; this.stepMs = stepMs; }
  now() { return this.clockBase + Math.min(this.clockN++, this.stepMs - 1); }

  setReference(inst, price) { this.books[inst].ref = price; }
  last(inst) { return this.books[inst].last; }
  bestBid(inst) { const p = this.books[inst].bidPx; return p.length ? p[p.length - 1] : null; }
  bestAsk(inst) { const p = this.books[inst].askPx; return p.length ? p[0] : null; }
  isLive(id) { return this.live.has(id); }
  position(acct, inst) { const a = this.positions[acct]; return (a && a[inst]) || 0; }

  _insertPx(arr, price) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < price) lo = m + 1; else hi = m; }
    arr.splice(lo, 0, price);
  }
  _removePx(arr, price) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < price) lo = m + 1; else hi = m; }
    arr.splice(lo, 1);
  }

  /**
   * Submit an order. Returns { id, status, filled, trades } where status is
   * 'rejected' | 'filled' | 'partial' | 'resting' | 'unfilled'.
   */
  submit({ acct, inst, side, type, price = null, qty }) {
    const b = this.books[inst];
    const t = this.now();
    const id = ++this.seq;
    const base = { seq: id, id, t, inst, acct, side, type, price: type === 'M' ? null : price, qty };
    let reason = null;
    if (!Number.isInteger(qty) || qty <= 0) reason = 'QTY';
    else if (qty % b.def.lotSize !== 0) reason = 'LOT';
    else if (type === 'L' && (!Number.isInteger(price) || price <= 0)) reason = 'PRICE';
    else if (type === 'L' && b.def.bandPct != null) {
      const lo = Math.ceil(b.ref * (1 - b.def.bandPct));
      const hi = Math.floor(b.ref * (1 + b.def.bandPct));
      if (price < lo || price > hi) reason = 'BAND';
    }
    if (reason) {
      this.rejections[reason]++;
      this.orders.push({ ...base, status: 'rejected', reason });
      return { id, status: 'rejected', filled: 0, trades: [] };
    }
    this.orders.push({ ...base, status: 'accepted', reason: null });

    const o = { id, acct, inst, side, type, price, rem: qty, qty };
    const out = [];
    const oppMap = side === 'B' ? b.asks : b.bids;
    const oppPx = side === 'B' ? b.askPx : b.bidPx;
    while (o.rem > 0 && oppPx.length) {
      const bestPx = side === 'B' ? oppPx[0] : oppPx[oppPx.length - 1];
      if (type === 'L' && (side === 'B' ? bestPx > price : bestPx < price)) break;
      const lvl = oppMap.get(bestPx);
      const r = lvl[0];
      const q = Math.min(o.rem, r.rem);
      const tid = ++this.seq;
      const buy = side === 'B' ? o : r;
      const sell = side === 'B' ? r : o;
      const tr = {
        seq: tid, id: tid, t, kind: 'trade', inst, price: bestPx, qty: q,
        side, acct, aggressor: side, buyAcct: buy.acct, sellAcct: sell.acct,
        buyOrderId: buy.id, sellOrderId: sell.id,
      };
      this.trades.push(tr);
      out.push(tr);
      b.last = bestPx;
      this._post(buy.acct, sell.acct, inst, bestPx, q);
      r.rem -= q; o.rem -= q;
      if (r.rem === 0) {
        lvl.shift();
        this.live.delete(r.id);
        if (!lvl.length) { oppMap.delete(bestPx); this._removePx(oppPx, bestPx); }
      }
    }
    const filled = qty - o.rem;
    let status;
    if (o.rem === 0) status = 'filled';
    else if (type === 'L') {
      const map = side === 'B' ? b.bids : b.asks;
      const px = side === 'B' ? b.bidPx : b.askPx;
      let lvl = map.get(price);
      if (!lvl) { lvl = []; map.set(price, lvl); this._insertPx(px, price); }
      lvl.push(o);
      this.live.set(id, o);
      status = filled > 0 ? 'partial' : 'resting';
    } else {
      this.cancels.push({ seq: ++this.seq, t, orderId: id, inst, acct, side, price: null, qty: o.rem, reason: 'MARKET_REMAINDER' });
      status = filled > 0 ? 'partial' : 'unfilled';
    }
    const bb = this.bestBid(inst), ba = this.bestAsk(inst);
    if (bb != null && ba != null && bb >= ba) this.crossedEvents++;
    return { id, status, filled, trades: out };
  }

  cancel(orderId, reason = 'USER') {
    const o = this.live.get(orderId);
    if (!o) return false;
    const b = this.books[o.inst];
    const map = o.side === 'B' ? b.bids : b.asks;
    const px = o.side === 'B' ? b.bidPx : b.askPx;
    const lvl = map.get(o.price);
    lvl.splice(lvl.indexOf(o), 1);
    if (!lvl.length) { map.delete(o.price); this._removePx(px, o.price); }
    this.live.delete(orderId);
    this.cancels.push({ seq: ++this.seq, t: this.now(), orderId, inst: o.inst, acct: o.acct, side: o.side, price: o.price, qty: o.rem, reason });
    return true;
  }

  _post(buyAcct, sellAcct, inst, price, q) {
    const n = price * q;
    (this.positions[buyAcct] ??= {})[inst] = ((this.positions[buyAcct] || {})[inst] || 0) + q;
    (this.positions[sellAcct] ??= {})[inst] = ((this.positions[sellAcct] || {})[inst] || 0) - q;
    this.cash[buyAcct] = (this.cash[buyAcct] || 0) - n;
    this.cash[sellAcct] = (this.cash[sellAcct] || 0) + n;
  }
}

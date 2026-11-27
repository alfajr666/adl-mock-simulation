import test from 'node:test';
import assert from 'node:assert/strict';
import { Exchange } from '../engine/book.js';
import { Rng } from '../engine/prng.js';

function mk(opts = {}) {
  const ex = new Exchange([{ id: 'X', lotSize: opts.lotSize ?? 1, bandPct: opts.bandPct ?? null, refPrice: opts.ref ?? 100 }]);
  ex.beginStep(1000, 500);
  return ex;
}
const o = (acct, side, type, price, qty) => ({ acct, inst: 'X', side, type, price, qty });

test('price-time priority: best price first, then arrival order, trade at resting price', () => {
  const ex = mk();
  ex.submit(o('A', 'S', 'L', 102, 1));
  ex.submit(o('B', 'S', 'L', 101, 1));
  ex.submit(o('C', 'S', 'L', 101, 1));
  const r = ex.submit(o('D', 'B', 'L', 102, 3));
  assert.deepEqual(r.trades.map((t) => [t.sellAcct, t.price]), [['B', 101], ['C', 101], ['A', 102]]);
  assert.equal(r.status, 'filled');
  assert.ok(r.trades.every((t) => t.aggressor === 'B' && t.buyAcct === 'D'));
});

test('partial fill leaves the remainder resting; market order remainder is cancelled', () => {
  const ex = mk();
  ex.submit(o('A', 'S', 'L', 100, 10));
  const r1 = ex.submit(o('B', 'B', 'L', 100, 4));
  assert.equal(r1.status, 'filled');
  assert.equal(ex.bestAsk('X'), 100);
  const r2 = ex.submit(o('C', 'B', 'M', null, 20));
  assert.equal(r2.status, 'partial');
  assert.equal(r2.filled, 6);
  assert.equal(ex.bestAsk('X'), null);
  assert.equal(ex.cancels.at(-1).reason, 'MARKET_REMAINDER');
  assert.equal(ex.cancels.at(-1).qty, 14);
});

test('a limit order that does not cross rests; cancel removes it; unknown cancel is a no-op', () => {
  const ex = mk();
  const r = ex.submit(o('A', 'B', 'L', 99, 5));
  assert.equal(r.status, 'resting');
  assert.equal(ex.bestBid('X'), 99);
  assert.equal(ex.cancel(r.id), true);
  assert.equal(ex.bestBid('X'), null);
  assert.equal(ex.cancel(r.id), false);
  assert.equal(ex.cancel(999999), false);
});

test('self-trades are not prevented: the matcher records buyAcct === sellAcct', () => {
  const ex = mk();
  ex.submit(o('A', 'S', 'L', 100, 3));
  const r = ex.submit(o('A', 'B', 'L', 100, 3));
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].buyAcct, 'A');
  assert.equal(r.trades[0].sellAcct, 'A');
  assert.equal(ex.position('A', 'X'), 0);
});

test('band and lot-size rejections are logged on the tape', () => {
  const ex = mk({ bandPct: 0.2, lotSize: 100, ref: 1000 });
  const bad = ex.submit(o('A', 'B', 'L', 1300, 100));
  assert.equal(bad.status, 'rejected');
  const lot = ex.submit(o('A', 'B', 'L', 1000, 150));
  assert.equal(lot.status, 'rejected');
  const ok = ex.submit(o('A', 'B', 'L', 1200, 100));
  assert.equal(ok.status, 'resting');
  assert.deepEqual(ex.orders.map((x) => [x.status, x.reason]), [['rejected', 'BAND'], ['rejected', 'LOT'], ['accepted', null]]);
  assert.equal(ex.rejections.BAND, 1);
  assert.equal(ex.rejections.LOT, 1);
});

test('market orders respect the daily band; stale resting orders outside a new band are cancelled', () => {
  const ex = mk({ bandPct: 0.2, lotSize: 1, ref: 1000 });
  ex.submit(o('A', 'S', 'L', 1190, 5));
  ex.submit(o('A', 'S', 'L', 1250 > 1200 ? 1200 : 1250, 5));      // inside the band
  ex.setReference('X', 900);                                       // new band 720..1080: both asks are now stale
  assert.equal(ex.bestAsk('X'), null);
  assert.deepEqual(ex.cancels.map((c) => c.reason), ['BAND_REPRICE', 'BAND_REPRICE']);
  ex.setReference('X', 1000);
  ex.submit(o('A', 'S', 'L', 1100, 5));
  ex.setReference('X', 1000);
  const r = ex.submit(o('B', 'B', 'M', null, 3));
  assert.equal(r.filled, 3);
  assert.ok(r.trades.every((t) => t.price >= 800 && t.price <= 1200));
});

test('quantity conservation: filled + cancelled + still resting = submitted for every accepted order', () => {
  const ex = mk();
  const rng = new Rng(777);
  for (let i = 0; i < 2000; i++) {
    ex.beginStep(1000 + i * 10, 10);
    if (rng.chance(0.2) && ex.live.size) { ex.cancel([...ex.live.keys()][rng.int(0, ex.live.size - 1)]); continue; }
    ex.submit(o(rng.pick(['A', 'B', 'C']), rng.chance(0.5) ? 'B' : 'S', rng.chance(0.2) ? 'M' : 'L', 92 + rng.int(0, 16), rng.int(1, 9)));
  }
  const filled = new Map(), cancelled = new Map();
  for (const t of ex.trades) { filled.set(t.buyOrderId, (filled.get(t.buyOrderId) || 0) + t.qty); filled.set(t.sellOrderId, (filled.get(t.sellOrderId) || 0) + t.qty); }
  for (const c of ex.cancels) cancelled.set(c.orderId, (cancelled.get(c.orderId) || 0) + c.qty);
  let checked = 0;
  for (const ord of ex.orders) {
    if (ord.status !== 'accepted') continue;
    const resting = ex.live.has(ord.id) ? ex.live.get(ord.id).rem : 0;
    assert.equal((filled.get(ord.id) || 0) + (cancelled.get(ord.id) || 0) + resting, ord.qty, `order ${ord.id}`);
    checked++;
  }
  assert.ok(checked > 1000);
});

test('every trade prints within the limit prices of both orders', () => {
  const ex = mk();
  const rng = new Rng(4242);
  for (let i = 0; i < 2000; i++) {
    ex.beginStep(1000 + i * 10, 10);
    ex.submit(o(rng.pick(['A', 'B', 'C']), rng.chance(0.5) ? 'B' : 'S', rng.chance(0.2) ? 'M' : 'L', 92 + rng.int(0, 16), rng.int(1, 9)));
  }
  const byId = new Map(ex.orders.map((x) => [x.id, x]));
  for (const t of ex.trades) {
    const b = byId.get(t.buyOrderId), s = byId.get(t.sellOrderId);
    if (b.type === 'L') assert.ok(t.price <= b.price);
    if (s.type === 'L') assert.ok(t.price >= s.price);
  }
  assert.ok(ex.trades.length > 300);
});

test('every event carries account, side, price/qty, timestamp and a strictly increasing sequence', () => {
  const ex = mk();
  ex.submit(o('A', 'S', 'L', 100, 5));
  ex.submit(o('B', 'B', 'M', null, 2));
  ex.cancel(ex.orders[0].id);
  const all = [...ex.orders, ...ex.trades, ...ex.cancels].sort((a, b) => a.seq - b.seq);
  assert.deepEqual(all.map((e) => e.seq), all.map((_, i) => i + 1));
  for (const e of ex.orders) for (const k of ['acct', 'side', 'qty', 't', 'seq']) assert.notEqual(e[k], undefined);
  for (const t of ex.trades) for (const k of ['buyAcct', 'sellAcct', 'aggressor', 'price', 'qty', 't', 'seq', 'side', 'acct']) assert.notEqual(t[k], undefined);
  assert.ok(all.every((e, i) => i === 0 || e.t >= all[i - 1].t));
});

test('random order flow never crosses the book and conserves positions and cash', () => {
  const ex = mk();
  const rng = new Rng(12345);
  const accts = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < 3000; i++) {
    ex.beginStep(1000 + i * 10, 10);
    const roll = rng.u();
    if (roll < 0.15 && ex.live.size) { ex.cancel([...ex.live.keys()][rng.int(0, ex.live.size - 1)]); continue; }
    ex.submit(o(rng.pick(accts), rng.chance(0.5) ? 'B' : 'S', roll < 0.25 ? 'M' : 'L', 90 + rng.int(0, 20), rng.int(1, 9)));
    const b = ex.bestBid('X'), a = ex.bestAsk('X');
    if (b != null && a != null) assert.ok(b < a, `crossed book after order ${i}`);
  }
  assert.equal(ex.crossedEvents, 0);
  assert.ok(ex.trades.length > 200);
  let pos = 0, cash = 0;
  for (const a of accts) { pos += ex.position(a, 'X'); cash += ex.cash[a] || 0; }
  assert.equal(pos, 0);
  assert.equal(cash, 0);
});

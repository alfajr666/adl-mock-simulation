import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, checkInvariants, CONFIG_IDS } from '../engine/index.js';

for (const id of CONFIG_IDS) {
  for (const seed of [1, 2, 3]) {
    test(`${id} seed ${seed}: order book and ledger invariants`, () => {
      const r = runScenario(id, { seed });
      const inv = checkInvariants(r);
      assert.equal(inv.crossedBookEvents, 0, 'no crossed book after any matching step');
      assert.equal(inv.badAccounts, 0, 'every trade has two valid registered accounts');
      assert.equal(inv.nonIntegerOrNonPositive, 0, 'integer ticks and integer quantities');
      assert.equal(inv.ledgerMismatch, 0, 'ledger equals positions recomputed from the tape');
      for (const [i, sum] of Object.entries(inv.positionSumByInstrument)) assert.equal(sum, 0, `position changes sum to zero in ${i}`);
      assert.equal(inv.cashSum, 0, 'cash changes sum to zero');
      assert.ok(Number.isInteger(inv.cashSum));
    });
  }

  test(`${id}: tape fields, sequence and time order`, () => {
    const r = runScenario(id, { seed: 1 });
    const { orders, cancels, trades } = r.tape;
    const all = [...orders, ...cancels, ...trades].sort((a, b) => a.seq - b.seq);
    assert.deepEqual(all.map((e) => e.seq), all.map((_, i) => i + 1));
    assert.ok(all.every((e, i) => i === 0 || e.t >= all[i - 1].t), 'time is non-decreasing in sequence order');
    assert.ok(all.every((e) => Number.isInteger(e.t) && e.t >= 0));
    for (const t of trades) {
      assert.ok(t.aggressor === 'B' || t.aggressor === 'S');
      assert.ok(t.buyOrderId !== t.sellOrderId);
    }
    const trSize = orders.length + cancels.length + trades.length;
    assert.ok(trSize < 40000, `tape stays browser-sized (${trSize} events)`);
  });

  test(`${id}: self-trades and linked-account trades come out of the matcher`, () => {
    const r = runScenario(id, { seed: 1 });
    const ring = r.groundTruth.episodes.find((e) => e.type === 'wash');
    const trades = r.tape.trades;
    assert.ok(trades.some((t) => t.buyAcct === t.sellAcct), 'honest algo accounts self-match now and then');
    const self = trades.filter((t) => t.buyAcct === t.sellAcct);
    for (const t of self) {
      const buyOrder = r.tape.orders.find((o) => o.id === t.buyOrderId);
      const sellOrder = r.tape.orders.find((o) => o.id === t.sellOrderId);
      assert.equal(buyOrder.acct, sellOrder.acct);
      assert.equal(buyOrder.side, 'B');
      assert.equal(sellOrder.side, 'S');
    }
    const internal = trades.filter((t) => ring.accounts.includes(t.buyAcct) && ring.accounts.includes(t.sellAcct));
    assert.ok(internal.length > 30);
    for (const t of internal) {
      const resting = t.aggressor === 'B' ? r.tape.orders.find((o) => o.id === t.sellOrderId) : r.tape.orders.find((o) => o.id === t.buyOrderId);
      assert.equal(resting.type, 'L', 'the resting side of a wash trade is a real limit order');
      assert.equal(t.price, resting.price, 'trades print at the resting price');
    }
  });
}

test('every trade price sits inside the limits of both orders, and order quantities are conserved', () => {
  for (const id of CONFIG_IDS) {
    const r = runScenario(id, { seed: 2 });
    const byId = new Map(r.tape.orders.map((o) => [o.id, o]));
    const filled = new Map(), cancelled = new Map();
    for (const t of r.tape.trades) {
      const b = byId.get(t.buyOrderId), s = byId.get(t.sellOrderId);
      if (b.type === 'L') assert.ok(t.price <= b.price);
      if (s.type === 'L') assert.ok(t.price >= s.price);
      filled.set(b.id, (filled.get(b.id) || 0) + t.qty); filled.set(s.id, (filled.get(s.id) || 0) + t.qty);
    }
    for (const c of r.tape.cancels) cancelled.set(c.orderId, (cancelled.get(c.orderId) || 0) + c.qty);
    for (const o of r.tape.orders) {
      if (o.status !== 'accepted') continue;
      const done = (filled.get(o.id) || 0) + (cancelled.get(o.id) || 0);
      assert.ok(done <= o.qty, `order ${o.id} over-allocated`);
      if (o.type === 'M') assert.equal(done, o.qty, 'a market order is fully filled or its remainder cancelled');
    }
  }
});

test('equity: no trade prints outside the daily band (market orders included)', () => {
  for (const seed of [1, 2, 3]) {
    const r = runScenario('equity', { seed });
    const { stepsPerDay, stepMs, dayMs } = r.market.session;
    const lastBefore = {};
    for (const d of r.market.instruments) lastBefore[d.id] = d.refPrice0;
    let day = 0, ref = { ...lastBefore };
    for (const t of r.tape.trades) {
      const d = Math.floor(t.t / dayMs);
      if (d !== day) { day = d; ref = { ...lastBefore }; }
      const lo = Math.ceil(ref[t.inst] * 0.8), hi = Math.floor(ref[t.inst] * 1.2);
      assert.ok(t.price >= lo && t.price <= hi, `trade ${t.id} at ${t.price} outside ${lo}..${hi}`);
      lastBefore[t.inst] = t.price;
    }
    assert.ok(stepsPerDay * stepMs < dayMs);
  }
});

test('equity: lot size, tick units and the daily band are enforced and logged', () => {
  const r = runScenario('equity', { seed: 1 });
  assert.ok(r.market.instruments.every((d) => d.lotSize === 100 && d.bandPct === 0.2 && d.tickSize >= 1));
  assert.ok(r.tape.trades.every((t) => t.qty % 100 === 0));
  const rejected = r.tape.orders.filter((o) => o.status === 'rejected');
  assert.ok(rejected.length > 0);
  assert.ok(rejected.every((o) => o.reason === 'BAND'));
  assert.equal(r.stats.rejections.BAND, rejected.length);
  assert.doesNotMatch(r.market.label, /IDX/);
  assert.match(r.market.label, /daily-band/);
  assert.ok(r.market.instruments.every((d) => d.id.endsWith('.SIM')));
});

test('crypto: finer tick, no band, continuous single session', () => {
  const r = runScenario('crypto', { seed: 1 });
  assert.ok(r.market.instruments.every((d) => d.bandPct === null));
  assert.equal(r.market.session.days, 1);
  assert.equal(r.stats.rejections.BAND, 0);
  const eq = runScenario('equity', { seed: 1 });
  assert.ok(r.market.session.stepMs < eq.market.session.stepMs);
});

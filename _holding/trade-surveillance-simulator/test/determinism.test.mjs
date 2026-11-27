import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, MODEL_VERSION, CONFIG_IDS } from '../engine/index.js';
import { mulberry32, hashSeed } from '../engine/prng.js';

test('model version constant', () => assert.equal(MODEL_VERSION, 'surv-model-1.1.0'));

test('prng is reproducible and streams are independent of each other', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  assert.notEqual(hashSeed(1, 'retail:A001'), hashSeed(1, 'retail:A002'));
  assert.notEqual(hashSeed(1, 'x'), hashSeed(2, 'x'));
});

for (const id of CONFIG_IDS) {
  test(`${id}: same seed gives deep-equal, byte-identical output`, () => {
    const a = runScenario(id, { seed: 3, fresh: true });
    const b = runScenario(id, { seed: 3, fresh: true });
    assert.deepStrictEqual(a, b);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test(`${id}: a different seed changes the tape`, () => {
    const a = runScenario(id, { seed: 3, fresh: true });
    const b = runScenario(id, { seed: 4, fresh: true });
    assert.notDeepEqual(a.tape.trades.map((t) => [t.price, t.qty, t.buyAcct]), b.tape.trades.map((t) => [t.price, t.qty, t.buyAcct]));
  });

  test(`${id}: the cached path equals the fresh path`, () => {
    assert.deepStrictEqual(runScenario(id, { seed: 5 }), runScenario(id, { seed: 5, fresh: true }));
  });

  test(`${id}: re-running detection with other thresholds does not change the tape`, () => {
    const before = JSON.stringify(runScenario(id, { seed: 2 }).tape);
    runScenario(id, { seed: 2, thresholds: { p1ZRet: 2, w2InstrumentShare: 0.1 }, linkagePolicy: 'weak1' });
    assert.equal(JSON.stringify(runScenario(id, { seed: 2 }).tape), before);
  });
}

test('results returned to callers are deep-frozen (the cache cannot be corrupted)', () => {
  const r = runScenario('crypto', { seed: 2 });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.tape) && Object.isFrozen(r.tape.trades) && Object.isFrozen(r.tape.trades[0]));
  assert.ok(Object.isFrozen(r.register.rows[0].attributes) && Object.isFrozen(r.alerts) && Object.isFrozen(r.groundTruth));
  assert.throws(() => { r.tape.trades.push({}); }, TypeError);
  assert.throws(() => { r.alerts[0].metrics.x = 1; }, TypeError);
});

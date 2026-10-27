import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePolicies, createRun, runToEnd, viewModel } from '../simulator.js';

function final(id, policy) {
  return viewModel(runToEnd(createRun(id, policy)));
}

test('partial insurance allocates 100 = 40 insurance + 60 ADL', () => {
  const model = final('partial');
  assert.equal(model.stage, 'RESOLVED');
  assert.deepEqual(model.deficit, {
    gross: '100.00', remaining: '0.00', shortfallPerUnit: '10.00',
    marketQty: '4.000000', adlQty: '6.000000', adjustment: '60.00',
  });
  assert.equal(model.fund.contribution, '40.00');
  assert.equal(model.fund.remaining, '0.00');
  assert.equal(model.invariant.ok, true);
  assert.equal(model.invariant.equityTotal, '900.00');
  assert.equal(model.positions.find((p) => p.id === 'D').equity, '0.00');
});

test('sufficient insurance resolves without ADL', () => {
  const model = final('sufficient');
  assert.equal(model.stage, 'RESOLVED');
  assert.equal(model.deficit.adlQty, '0.000000');
  assert.equal(model.deficit.adjustment, '0.00');
  assert.equal(model.fund.remaining, '50.00');
  assert.equal(model.invariant.equityTotal, '1010.00');
});

test('zero insurance uses the full ADL tranche', () => {
  const model = final('none');
  assert.equal(model.stage, 'RESOLVED');
  assert.equal(model.deficit.adjustment, '100.00');
  assert.equal(model.invariant.ok, true);
});

test('the mirrored long default has the same balanced result', () => {
  const model = final('falling');
  assert.equal(model.stage, 'RESOLVED');
  assert.equal(model.bankruptcyPrice, '90.00');
  assert.equal(model.deficit.shortfallPerUnit, '10.00');
  assert.equal(model.invariant.equityTotal, '900.00');
});

test('capacity exhaustion remains unresolved and visible', () => {
  const model = final('unresolved');
  assert.equal(model.stage, 'UNRESOLVED');
  assert.equal(model.deficit.remaining, '10.00');
  assert.equal(model.positions.find((p) => p.id === 'D').equity, '-10.00');
  assert.equal(model.invariant.ok, true);
});

test('policy comparison changes allocation, not total deficit', () => {
  const { reference, leverage } = comparePolicies();
  const ref = viewModel(reference);
  const lev = viewModel(leverage);
  assert.equal(ref.stage, 'RESOLVED');
  assert.equal(lev.stage, 'RESOLVED');
  assert.equal(ref.deficit.adjustment, '60.00');
  assert.equal(lev.deficit.adjustment, '60.00');
  assert.equal(ref.positions.find((p) => p.id === 'A').quantity, '0.000000');
  assert.equal(lev.positions.find((p) => p.id === 'B').quantity, '0.000000');
  assert.equal(ref.invariant.equityTotal, '3080.00');
  assert.equal(lev.invariant.equityTotal, '3080.00');
});

test('a run is deterministic and cannot liquidate a healthy opening account', () => {
  const first = final('partial');
  const second = final('partial');
  assert.deepEqual(first, second);
  const setup = createRun('partial');
  setup.shockMark = setup.openingMark;
  const blocked = viewModel(runToEnd(setup));
  assert.equal(blocked.stage, 'BLOCKED');
  assert.match(blocked.blockedReason, /healthy/);
});

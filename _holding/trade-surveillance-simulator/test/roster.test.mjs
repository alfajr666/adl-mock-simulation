import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, CONFIG_IDS } from '../engine/index.js';

const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

test('account type does not leak roles: planted accounts are corporate at about the population rate', () => {
  for (const id of CONFIG_IDS) {
    let plantedCorp = 0, planted = 0, popCorp = 0, pop = 0;
    for (const seed of seeds) {
      const r = runScenario(id, { seed });
      const roles = r.groundTruth.accountRoles;
      for (const row of r.register.rows) {
        if (row.type === 'market_maker') continue;
        const isPlanted = /^planted-(wash|pump)/.test(roles[row.acct]);
        pop++; if (row.type === 'corporate') popCorp++;
        if (isPlanted) { planted++; if (row.type === 'corporate') plantedCorp++; }
      }
    }
    const pr = plantedCorp / planted, br = popCorp / pop;
    assert.ok(br > 0.08 && br < 0.2, `${id} population corporate rate ${br}`);
    assert.ok(Math.abs(pr - br) < 0.06, `${id}: planted ${pr} vs population ${br}`);
  }
});

test('only market makers carry the market_maker type; every other account is individual or corporate', () => {
  const r = runScenario('crypto', { seed: 1 });
  const roles = r.groundTruth.accountRoles;
  for (const row of r.register.rows) {
    if (row.type === 'market_maker') assert.ok(/maker/.test(roles[row.acct]));
    else assert.ok(['individual', 'corporate'].includes(row.type));
  }
});

test('background accounts share weak attributes through pools and a few unrelated accounts share a strong one', () => {
  for (const id of CONFIG_IDS) {
    const r = runScenario(id, { seed: 1 });
    const strongKeys = r.register.schema.filter((a) => a.strength === 'strong').map((a) => a.key);
    const weakKeys = r.register.schema.filter((a) => a.strength === 'weak').map((a) => a.key);
    const countShared = (keys) => {
      let shared = 0;
      for (const k of keys) {
        const m = new Map();
        for (const row of r.register.rows) m.set(row.attributes[k], (m.get(row.attributes[k]) || 0) + 1);
        shared += [...m.values()].filter((n) => n > 1).length;
      }
      return shared;
    };
    assert.ok(countShared(weakKeys) >= 8, `${id}: shared weak values`);
    const roles = r.groundTruth.accountRoles;
    const family = r.groundTruth.decoys.filter((d) => d.type === 'unrelated-shared-strong-attribute');
    assert.equal(family.length, 2);
    for (const f of family) {
      const rows = f.accounts.map((a) => r.register.rows.find((x) => x.acct === a));
      assert.ok(strongKeys.some((k) => rows[0].attributes[k] === rows[1].attributes[k] && k !== r.register.ownerAttribute));
      assert.ok(f.accounts.every((a) => roles[a] === 'honest-family-pair'));
    }
  }
});

test('ground-truth role strings for planted accounts carry the planted- prefix', () => {
  const r = runScenario('equity', { seed: 1 });
  const planted = Object.values(r.groundTruth.accountRoles).filter((x) => /wash|pump|maker-sub/.test(x));
  assert.ok(planted.length >= 9 && planted.every((x) => x.startsWith('planted-')));
});

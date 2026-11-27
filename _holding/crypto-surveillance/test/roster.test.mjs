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

// Register tells are MEASURED and pinned, not asserted away: the register is not an answer key for the
// simple rules in the 1.1 test, but structural rules do identify the planted groups (see ENGINE.md, "register tells").
const PINNED = {
  equity: {
    'weak2: cluster holds a strong link and a weak-only link': [0.795, 1.0],
    'weak2: has a strong partner and a weak-only partner': [0.810, 0.299],
    'weak2: cluster size >= 3': [0.319, 1.0],
    'strong1: cluster size >= 3': [0.173, 0.429],
    'shares device': [0.383, 0.610],
    'shares two or more attributes with one other account': [0.315, 0.686],
    'an attribute value used by exactly 2 accounts': [0.265, 0.684],
    'shares a value that is not from a background pool': [0.218, 0.963],
  },
  crypto: {
    'weak2: cluster holds a strong link and a weak-only link': [0.620, 1.0],
    'weak2: has a strong partner and a weak-only partner': [0.715, 0.294],
    'weak2: cluster size >= 3': [0.276, 1.0],
    'strong1: cluster size >= 3': [0.147, 0.429],
    'shares deviceFingerprint': [0.405, 0.600],
    'shares two or more attributes with one other account': [0.294, 0.601],
    'an attribute value used by exactly 2 accounts': [0.276, 0.996],
    'shares a value that is not from a background pool': [0.210, 0.989],
  },
};

test('register tells (100 seeds): ring+pump precision and recall match the documented values; makers are scored separately', async () => {
  const { tellStudy } = await import('../engine/index.js');
  const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
  for (const id of CONFIG_IDS) {
    const t = tellStudy(id, seeds.slice(0, 1)).register;           // shape check on one seed; the pooled values come from the register-only study below
    assert.ok(t.some((r) => r.target === 'makerSubs') && t.some((r) => r.target === 'ringPump'));
  }
  const { registerTellStudy } = await import('../engine/tells.js');
  const { buildEquity } = await import('../engine/scenario-equity.js');
  const { buildCrypto } = await import('../engine/scenario-crypto.js');
  for (const [id, build] of [['equity', buildEquity], ['crypto', buildCrypto]]) {
    const rows = registerTellStudy(build, seeds);
    const get = (rule, target) => rows.find((r) => r.rule === rule && r.target === target);
    for (const [rule, [p, rec]] of Object.entries(PINNED[id])) {
      const r = get(rule, 'ringPump');
      assert.ok(Math.abs(r.precision - p) < 0.02, `${id} "${rule}" precision ${r.precision.toFixed(3)} vs documented ${p}`);
      assert.ok(Math.abs(r.recall - rec) < 0.02, `${id} "${rule}" recall ${r.recall.toFixed(3)} vs documented ${rec}`);
      assert.ok(Math.abs(r.baseRate - 0.14) < 0.01);
    }
    // the structural tells are strong (this is a measurement, not a pass/fail on secrecy) but no register rule is perfect
    const best = Math.max(...rows.filter((r) => r.target === 'ringPump' && r.precision !== null && r.flagged > 100).map((r) => r.precision));
    assert.ok(best > 0.6 && best < 0.9, `best register tell precision ${best}`);
    const makers = rows.filter((r) => r.target === 'makerSubs' && r.precision !== null);
    assert.ok(Math.max(...makers.map((r) => r.precision)) < 0.35, 'maker sub-accounts are not singled out by any register rule');
  }
});

test('tape tell (40 seeds): busiest-instrument share separates ring+pump accounts; trade size and counterparty share also differ', async () => {
  const { tellStudy } = await import('../engine/index.js');
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const floors = { equity: [0.95, 0.9], crypto: [0.9, 0.75] };       // documented 100-seed values: equity 1.00 / 0.98, crypto 0.99 / 0.87
  for (const id of CONFIG_IDS) {
    const t = tellStudy(id, seeds).tape;
    const b = t.busiestInstrumentShare;
    assert.ok(b.precision >= floors[id][0], `${id} precision ${b.precision}`);
    assert.ok(b.recall >= floors[id][1], `${id} recall ${b.recall}`);
    assert.match(t.method, /Makers excluded by register type/);
    assert.ok(t.medians.plantedAccounts.busiestShare > t.medians.honestAccounts.busiestShare + 0.25);
    assert.ok(t.medians.plantedAccounts.meanTradeSizeLots > 1.5 * t.medians.honestAccounts.meanTradeSizeLots);
    assert.ok(t.medians.plantedAccounts.topCounterpartyShare > t.medians.honestAccounts.topCounterpartyShare);
  }
});

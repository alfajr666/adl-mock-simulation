import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, CONFIG_IDS, LINKAGE_POLICIES, seedStudy } from '../engine/index.js';
import { buildLinkage } from '../engine/linkage.js';

const reg = (rows) => ({
  schema: [{ key: 's', label: 'S', strength: 'strong' }, { key: 'w1', label: 'W1', strength: 'weak' }, { key: 'w2', label: 'W2', strength: 'weak' }],
  rows: rows.map(([acct, s, w1, w2]) => ({ acct, declaredOwner: acct, type: 'individual', attributes: { s, w1, w2 } })),
});

test('policies: strong1 needs a strong attribute, weak2 one strong or two weak, weak1 any', () => {
  const r = reg([['A', 's1', 'x', 'y'], ['B', 's1', 'p', 'q'], ['C', 's9', 'x', 'y'], ['D', 's8', 'x', 'z'], ['E', 's7', 'n', 'z']]);
  const ids = (p) => buildLinkage(r, p).clusters.map((c) => c.accounts.join(''));
  assert.deepEqual(ids('strong1'), ['AB']);                 // only the shared strong value links
  assert.deepEqual(ids('weak2'), ['ABC']);                  // C shares two weak attributes with A
  assert.deepEqual(ids('weak1'), ['ABCDE']);                // D shares w1 with A/C, E shares w2 with D
});

test('evidence edges keep the shared attribute, its strength and whether the policy linked the pair', () => {
  const r = reg([['A', 's1', 'x', 'y'], ['B', 's1', 'p', 'q'], ['D', 's8', 'x', 'z']]);
  const l = buildLinkage(r, 'weak2');
  const ab = l.edges.find((e) => e.a === 'A' && e.b === 'B');
  assert.deepEqual(ab.shared, [{ key: 's', strength: 'strong', value: 's1' }]);
  assert.equal(ab.linked, true);
  const ad = l.edges.find((e) => e.a === 'A' && e.b === 'D');
  assert.equal(ad.linked, false);
  assert.equal(ad.shared[0].strength, 'weak');
  assert.equal(l.clusters[0].edges.length, 1);
  assert.equal(l.clusterOf.A, l.clusterOf.B);
  assert.notEqual(l.clusterOf.A, l.clusterOf.D);
  assert.throws(() => buildLinkage(r, 'nope'));
});

test('three named policies are exported', () => assert.deepEqual(Object.keys(LINKAGE_POLICIES), ['strong1', 'weak2', 'weak1']));

for (const id of CONFIG_IDS) {
  test(`${id}: register classifies attributes, declares owners, and holds no hidden truth`, () => {
    const r = runScenario(id, { seed: 1 });
    const { schema, rows, ownerAttribute } = r.register;
    assert.ok(schema.every((a) => a.strength === 'strong' || a.strength === 'weak'));
    for (const a of schema) { assert.ok(a.rationale.length > 20, `${a.key} rationale`); assert.ok(a.caveat.length > 20, `${a.key} caveat`); }
    assert.ok(schema.filter((a) => a.strength === 'weak').length >= 2, 'two weak attribute types are needed for the weak2 policy');
    assert.ok(rows.length >= 45 && rows.length <= 60);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['acct', 'attributes', 'declaredOwner', 'type']);
      assert.equal(row.declaredOwner, row.attributes[ownerAttribute]);
      assert.deepEqual(Object.keys(row.attributes), schema.map((a) => a.key));
    }
    const text = JSON.stringify(r.register);
    for (const word of ['controller', 'ring-', 'pump-', 'planted', 'EP-', 'role', 'honest']) assert.ok(!text.includes(word), `register leaks "${word}"`);
  });

  test(`${id}: the designed accounts link the way the scenario says`, () => {
    const r = runScenario(id, { seed: 1 });
    const gt = r.groundTruth;
    const ring = gt.episodes.find((e) => e.type === 'wash');
    const hub = ring.hubAccount;
    const spokes = ring.accounts.filter((a) => a !== hub);
    const ownerOf = Object.fromEntries(r.register.rows.map((x) => [x.acct, x.declaredOwner]));
    assert.equal(new Set(ring.accounts.map((a) => ownerOf[a])).size, 4, 'four different declared owners');

    const edge = (policy, x, y) => runScenario(id, { seed: 1, linkagePolicy: policy }).linkage.edges.find((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x));
    // the hub shares only weak attributes with the rest of the ring
    const hubEdges = r.linkage.edges.filter((e) => (e.a === hub && spokes.includes(e.b)) || (e.b === hub && spokes.includes(e.a)));
    assert.ok(hubEdges.length >= 1);
    assert.ok(hubEdges.every((e) => e.shared.every((s) => s.strength === 'weak') && e.shared.length >= 2));
    assert.equal(edge('strong1', hub, spokes[0])?.linked ?? false, false);
    // under the default policy all four are one cluster; under strict the hub is alone
    const clusterIds = (p) => new Set(ring.accounts.map((a) => runScenario(id, { seed: 1, linkagePolicy: p }).linkage.clusterOf[a]));
    assert.equal(clusterIds('weak2').size, 1);
    assert.equal(clusterIds('strong1').size, 2);

    // legitimate market-maker sub-accounts: one declared owner
    const mm = gt.decoys.find((d) => d.type === 'same-owner-cross').accounts;
    assert.equal(ownerOf[mm[0]], ownerOf[mm[1]]);
    // coincidental pair: a single weak attribute, not linked until the loosest policy
    const pair = gt.decoys.find((d) => d.type === 'coincidental-shared-attribute').accounts;
    const pe = r.linkage.edges.find((e) => e.a === pair[0] && e.b === pair[1]) || r.linkage.edges.find((e) => e.a === pair[1] && e.b === pair[0]);
    assert.equal(pe.shared.length, 1);
    assert.equal(pe.shared[0].strength, 'weak');
    assert.equal(pe.linked, false);
    assert.notEqual(ownerOf[pair[0]], ownerOf[pair[1]]);
  });
}

test('register schema reframes identity and hosted attributes as the review asked', () => {
  const c = runScenario('crypto', { seed: 1 }).register.schema;
  const by = Object.fromEntries(c.map((a) => [a.key, a]));
  assert.ok(by.controllingPerson && !by.kycIdentity);
  assert.match(by.controllingPerson.caveat, /identity, not a link/);
  assert.equal(by.withdrawalAddress.strength, 'weak');
  assert.match(by.withdrawalAddress.caveat, /Hosted/);
  assert.match(by.apiKeyLineage.rationale, /master key/);
  const e = runScenario('equity', { seed: 1 }).register.schema;
  assert.match(e.find((a) => a.key === 'brokerBranch').caveat, /Very weak/);
});

test('linkage policy has a real cost in both directions (40 seeds each config)', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  for (const id of CONFIG_IDS) {
    const by = {};
    for (const p of ['strong1', 'weak2', 'weak1']) by[p] = seedStudy(id, seeds, { linkagePolicy: p });
    const col = (p, k) => by[p].rows.map((r) => r[k]).filter((x) => x !== null);
    // strict misses the ring cleanly far more often than the default (the hub is only weakly linked)
    assert.ok(mean(col('weak2', 'w2Found')) - mean(col('strong1', 'w2Found')) > 0.5, `${id} strict W2 recall`);
    // the default pays an alert cost strict does not: honest groups linked by weak attributes that trade each other
    assert.ok(mean(col('weak2', 'unrelatedCases')) > mean(col('strong1', 'unrelatedCases')) + 0.3, `${id} default unrelated vs strict`);
    // loose: giant clusters, more unrelated cases, planted alerts diluted by honest accounts
    assert.ok(mean(col('weak1', 'largestCluster')) >= 4 * mean(col('weak2', 'largestCluster')));
    assert.ok(mean(col('weak1', 'falseLinkedPairs')) > 5 * mean(col('weak2', 'falseLinkedPairs')));
    assert.ok(mean(col('weak1', 'unrelatedCases')) > mean(col('weak2', 'unrelatedCases')) + 1);
    assert.ok(mean(col('weak1', 'episodesDiluted')) > 0.4, 'planted episodes are found, diluted');
    assert.ok(mean(col('weak1', 'meanAccountsPerMatchingAlert')) > 3 * mean(col('weak2', 'meanAccountsPerMatchingAlert')));
    assert.ok(mean(col('weak1', 'episodesFound')) < mean(col('weak2', 'episodesFound')) - 0.5, 'clean finds drop under loose linkage');
  }
});

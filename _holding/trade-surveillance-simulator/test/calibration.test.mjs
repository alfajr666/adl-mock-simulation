import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, sweep, seedStudy, detectionTargets, DEFAULTS, CONFIG_IDS } from '../engine/index.js';

const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i + 1);
const SEEDS_20 = SEEDS_100.slice(0, 20);
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

for (const id of CONFIG_IDS) {
  test(`${id}: detection targets hold on at least 95 of seeds 1-100 (failures are listed, not tuned away)`, () => {
    const s = seedStudy(id, SEEDS_100);
    assert.ok(s.targetsPassing >= 95, `only ${s.targetsPassing}/100: ${JSON.stringify(s.failures)}`);
    assert.ok(s.rows.length === 100 && s.rows.every((r) => typeof r.targets.all === 'boolean'));
  });

  test(`${id} default seed: both episodes found by pattern rules, an EXPLAINABLE alert, shock on P1 and not on P2`, () => {
    const r = runScenario(id, { seed: DEFAULTS.seed });
    const t = detectionTargets(r);
    assert.deepEqual(t, { bothEpisodesFound: true, explainablePresent: true, shockAlertsOnP1: true, shockQuietOnP2: true, all: true });
    assert.deepEqual(r.score.byEpisode.map((e) => [e.type, e.missed]), [['wash', false], ['pump', false]]);
    const ex = r.alerts.filter((a) => r.score.labels[a.id].label === 'EXPLAINABLE');
    assert.ok(ex.every((a) => a.rule === 'W2' && r.score.labels[a.id].cause === 'same-owner-cross'));
    const shock = r.alerts.filter((a) => r.score.labels[a.id].cause === 'benign-shock');
    assert.ok(shock.length >= 1 && shock.every((a) => a.rule === 'P1'));
  });

  test(`${id}: a single global P1 baseline raises more unrelated groups than per-instrument baselines (20 seeds)`, () => {
    const per = seedStudy(id, SEEDS_20, {});
    const glob = seedStudy(id, SEEDS_20, { thresholds: { p1Mode: 'global' } });
    assert.ok(mean(glob.rows.map((r) => r.groupsUnrelated)) >= mean(per.rows.map((r) => r.groupsUnrelated)) + 0.8);
  });

  test(`${id}: W2 sweep rows carry episodes found, decoys alerted and group counts; trade-off visible at the group level`, () => {
    const s = sweep(id, 'w2InstrumentShare', [0.1, 0.25, 0.5, 0.7, 0.8, 0.95, 1.0], { seed: 1 });
    for (const row of s.rows) {
      assert.equal(typeof row.episodesFound, 'number');
      assert.equal(typeof row.decoysAlerted, 'number');
      assert.ok(row.groups.total >= 0 && 'unrelated' in row.groups && 'explainable' in row.groups && 'episodeMatches' in row.groups);
      assert.ok(row.alerts.total >= row.groups.total);
    }
    const w2 = s.rows.map((r) => r.byRule.W2);
    assert.equal(w2[0].episodes.found, 1);                                   // loose threshold: the ring is found ...
    assert.equal(w2.at(-1).episodes.found, 0);                               // ... a strict one loses it
    assert.ok(w2[0].groups.explainable >= 1);                                // and the same-owner crosses alert at the loose end
    assert.ok(s.rows.some((r) => r.byRule.W2.episodes.found === 1 && r.byRule.W2.groups.explainable === 0), 'a middle value keeps the ring and drops the crosses');
    assert.ok(w2.every((x, i) => i === 0 || x.groups.explainable <= w2[i - 1].groups.explainable));
  });

  test(`${id}: P1 sweep (p1MoveScore) trades unrelated groups against episodes found`, () => {
    const s = sweep(id, 'p1MoveScore', [2, 5, 10, 14, 18, 25, 50, 100], { seed: 1 });
    const p1 = s.rows.map((r) => r.byRule.P1);
    assert.equal(p1[0].episodes.found, 1);
    assert.equal(p1.at(-1).episodes.found, 0);
    assert.equal(p1.at(-1).groups.total, 0);
    assert.ok(p1[1].groups.unrelated >= 1);
    assert.ok(p1.every((x, i) => i === 0 || x.alerts.total <= p1[i - 1].alerts.total), 'raising the threshold never adds P1 alerts');
  });

  test(`${id}: the sweep helper leaves defaults and the cached tape untouched`, () => {
    const before = JSON.stringify(DEFAULTS);
    const s = sweep(id, 'p1VolMult', [1, 2, 4], { seed: 1 });
    assert.equal(s.rows.length, 3);
    assert.equal(JSON.stringify(DEFAULTS), before);
  });

  test(`${id}: a baseline that spans the planted episodes hides the pump; trailing and clean warm-up do not (20 seeds)`, () => {
    const long = id === 'equity' ? 55 : 80;
    const found = (th) => mean(seedStudy(id, SEEDS_20, { thresholds: th }).rows.map((r) => r.p1Found));
    assert.equal(found({ p1Baseline: 'warmup' }), 1);
    assert.equal(found({ p1Baseline: 'trailing' }), 1);
    assert.ok(found({ p1Baseline: 'warmup', p1BaselineBins: long }) < 0.8, 'contaminated warm-up baseline');
  });
}

test('seedStudy returns per-seed rows and a median/min/max summary', () => {
  const s = seedStudy('crypto', [1, 2, 3]);
  assert.equal(s.rows.length, 3);
  for (const k of ['groups', 'groupsUnrelated', 'precisionGroupMatch', 'precisionGroupMatchOrExplainable', 'recall', 'episodesFound']) {
    const v = s.summary[k];
    assert.ok(v.min <= v.median && v.median <= v.max);
  }
  assert.equal(s.targetsPassing + s.failures.length, 3);
});

test('where non-matching alerts come from: not only planted decoys once background collisions exist', () => {
  const planted = new Set(['benign-shock', 'same-owner-cross', 'coincidental-link']);
  let background = 0, decoy = 0;
  for (const id of CONFIG_IDS) for (const policy of ['weak2', 'weak1']) for (const seed of SEEDS_20.slice(0, 10)) {
    const r = runScenario(id, { seed, linkagePolicy: policy });
    for (const a of r.alerts) {
      const l = r.score.labels[a.id];
      if (l.label !== 'UNRELATED') continue;
      if (planted.has(l.cause)) decoy++; else background++;
    }
  }
  assert.ok(background > 0 && decoy > 0);
  assert.ok(background / (background + decoy) > 0.25, `background share ${background}/${background + decoy}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, sweep, seedStudy, detectionTargets, DEFAULTS, CONFIG_IDS } from '../engine/index.js';

const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i + 1);
const SEEDS_20 = SEEDS_100.slice(0, 20);
const SEEDS_40 = SEEDS_100.slice(0, 40);
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

for (const id of CONFIG_IDS) {
  test(`${id}: both planted episodes are found cleanly at defaults on at least 95 of seeds 1-100`, () => {
    const s = seedStudy(id, SEEDS_100);
    assert.ok(s.targetsPassing >= 95, `only ${s.targetsPassing}/100: ${JSON.stringify(s.failures)}`);
    assert.equal(s.rows.length, 100);
  });

  test(`${id}: designed traps are reported as rates, never required`, () => {
    const s = seedStudy(id, SEEDS_20);
    assert.deepEqual(Object.keys(s.trapRates).sort(), ['explainableAlert', 'shockAlertsOnP1', 'shockAlertsOnP2']);
    for (const v of Object.values(s.trapRates)) assert.ok(v >= 0 && v <= 1);
    const t = detectionTargets(runScenario(id, { seed: 1 }));
    assert.deepEqual(Object.keys(t).sort(), ['all', 'bothEpisodesFound', 'traps']);
    assert.equal(t.all, t.bothEpisodesFound, 'the only pass/fail target is the episodes');
  });

  test(`${id} default seed: both episodes found cleanly by pattern rules`, () => {
    const r = runScenario(id, { seed: DEFAULTS.seed });
    assert.deepEqual(r.score.byEpisode.map((e) => [e.type, e.status]), [['wash', 'found'], ['pump', 'found']]);
    assert.equal(r.score.overall.recall, 1);
    assert.equal(r.score.caseSummary.episodeCases, 2);
    assert.equal(r.score.caseSummary.dilutedEpisodeCases, 0);
  });

  test(`${id}: case-level share of matching cases varies across seeds at the default policy`, () => {
    const s = seedStudy(id, SEEDS_100);
    const values = s.rows.map((r) => Math.round(r.shareMatchingEpisode * 100) / 100);
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    assert.ok(Math.max(...counts.values()) <= 70, `most common value covers ${Math.max(...counts.values())} of 100 seeds`);
    assert.ok(counts.size >= 5, `${counts.size} distinct values`);
    for (const r of s.rows) assert.equal(r.cases, r.episodeCases + r.dilutedEpisodeCases + r.trapCases + r.unrelatedCases);
  });

  test(`${id}: unrelated alerts at the default policy come from more than the designed traps (40 seeds)`, () => {
    const designed = new Set(['benign-shock', 'same-owner-cross']);
    let other = 0, all = 0;
    for (const seed of SEEDS_40) {
      const r = runScenario(id, { seed });
      for (const a of r.alerts) {
        const l = r.score.labels[a.id];
        if (l.label !== 'UNRELATED') continue;
        all++; if (!designed.has(l.cause)) other++;
      }
    }
    assert.ok(all > 0 && other / all > 0.3, `${other}/${all} unrelated alerts are not designed traps`);
  });

  test(`${id}: a single global P1 baseline raises more unrelated cases than per-instrument baselines (20 seeds)`, () => {
    const per = seedStudy(id, SEEDS_20, {});
    const glob = seedStudy(id, SEEDS_20, { thresholds: { p1Mode: 'global' } });
    assert.ok(mean(glob.rows.map((r) => r.unrelatedCases)) >= mean(per.rows.map((r) => r.unrelatedCases)) + 0.5);
  });

  test(`${id}: sweep rows carry the case summary, episodes found and decoys alerted; W2 sweep loses the ring at the strict end`, () => {
    const s = sweep(id, 'w2InstrumentShare', [0.1, 0.25, 0.5, 0.7, 0.8, 0.95, 1.0], { seed: 1 });
    for (const row of s.rows) {
      assert.equal(typeof row.episodesFound, 'number');
      assert.equal(typeof row.decoysAlerted, 'number');
      assert.equal(row.caseSummary.cases, row.caseSummary.episodeCases + row.caseSummary.dilutedEpisodeCases + row.caseSummary.trapCases + row.caseSummary.unrelatedCases);
    }
    const w2 = s.rows.map((r) => r.byRule.W2);
    assert.equal(w2[0].episodes.found, 1);
    assert.equal(w2.at(-1).episodes.found, 0);
    assert.ok(w2.every((x, i) => i === 0 || x.episodes.found <= w2[i - 1].episodes.found), 'raising the threshold never finds more');
    assert.ok(s.rows.at(-1).caseSummary.episodesMissed >= 1);
  });

  test(`${id}: P1 sweep (p1MoveScore) loses the pump at a strict threshold`, () => {
    const s = sweep(id, 'p1MoveScore', [2, 5, 10, 14, 18, 25, 50, 100], { seed: 1 });
    const p1 = s.rows.map((r) => r.byRule.P1);
    assert.equal(p1[0].episodes.found, 1);
    assert.equal(p1.at(-1).episodes.found, 0);
    assert.equal(p1.at(-1).groups.total, 0);
    assert.ok(p1.every((x, i) => i === 0 || x.alerts.total <= p1[i - 1].alerts.total), 'raising the threshold never adds P1 alerts');
  });

  test(`${id}: a baseline that spans the planted episodes silences the shock alert (and weakens the pump); trailing and clean warm-up do not (20 seeds)`, () => {
    const long = id === 'equity' ? 55 : 80;
    const run = (th) => seedStudy(id, SEEDS_20, { thresholds: th });
    const clean = run({ p1Baseline: 'warmup' }), trail = run({ p1Baseline: 'trailing' }), contaminated = run({ p1Baseline: 'warmup', p1BaselineBins: long });
    assert.equal(clean.trapRates.shockAlertsOnP1, 1);
    assert.equal(trail.trapRates.shockAlertsOnP1, 1);
    assert.ok(contaminated.trapRates.shockAlertsOnP1 <= 0.1, 'the long warm-up also removes the shock alert: P1 is less sensitive across the board');
    assert.ok(mean(contaminated.rows.map((r) => r.p1Found)) <= mean(clean.rows.map((r) => r.p1Found)));
  });

  test(`${id}: the sweep helper leaves defaults untouched and unknown thresholds throw`, () => {
    const before = JSON.stringify(DEFAULTS);
    sweep(id, 'p1VolMult', [1, 2, 4], { seed: 1 });
    assert.equal(JSON.stringify(DEFAULTS), before);
    assert.throws(() => runScenario(id, { seed: 1, thresholds: { p1ZRet: 5 } }), /Unknown threshold: p1ZRet/);
    assert.throws(() => sweep(id, 'p1ZRet', [1, 2], { seed: 1 }), /Unknown threshold/);
    assert.throws(() => runScenario(id, { seed: 1, thresholds: { p1Mode: 'bogus' } }), /p1Mode/);
    assert.throws(() => runScenario(id, { seed: 1, thresholds: { p1Baseline: 'bogus' } }), /p1Baseline/);
  });
}

test('seedStudy returns per-seed rows, a median/min/max summary, trap rates and failures', () => {
  const s = seedStudy('crypto', [1, 2, 3]);
  assert.equal(s.rows.length, 3);
  for (const k of ['cases', 'unrelatedCases', 'shareMatchingEpisode', 'shareMatchingOrExplainable', 'groups', 'precisionGroupMatch', 'recall', 'episodesFound', 'meanAccountsPerMatchingAlert']) assert.ok(k in s.summary, k);
  assert.equal(s.targetsPassing + s.failures.length, 3);
});

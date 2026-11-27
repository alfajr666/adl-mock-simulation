import { runScenario, sweep, clearCache } from '../engine/index.js';

export const CONFIGS = ['equity', 'crypto'];

const fpCount = (r, rule) => r.score.byRule[rule].fp;

/** Evaluate every calibration target for one (config, seed). Returns booleans plus the numbers behind them. */
export function evaluateTargets(configId, seed) {
  const base = runScenario(configId, { seed });
  const gt = base.groundTruth;
  const shockInst = Object.entries(gt.instrumentRoles).find(([, v]) => v === 'benign-shock')[0];
  const ringAccts = gt.episodes.find((e) => e.type === 'wash').accounts;
  const pair = gt.decoys.find((d) => d.type === 'coincidental-shared-attribute').accounts;
  const detected = Object.fromEntries(base.score.byEpisode.map((e) => [e.type, !e.missed]));

  const strict = runScenario(configId, { seed, linkagePolicy: 'strong1' });
  const loose = runScenario(configId, { seed, linkagePolicy: 'weak1' });
  const glob = runScenario(configId, { seed, thresholds: { p1Mode: 'global' } });
  const ringFragments = (r) => new Set(ringAccts.map((a) => r.linkage.clusterOf[a])).size;
  const pairLinked = (r) => r.linkage.clusterOf[pair[0]] === r.linkage.clusterOf[pair[1]];
  const looseFalseAlerts = loose.alerts.filter((a) => a.accounts.some((x) => pair.includes(x))).length;

  const w2 = sweep(configId, 'w2InstrumentShare', [0.1, 0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0], { seed });
  const p1 = sweep(configId, 'p1ZRet', [2, 5, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 50], { seed });
  const col = (s, rule, k) => s.rows.map((r) => r.byRule[rule][k]);
  const distinct = (xs) => new Set(xs.filter((x) => x !== null)).size;

  const out = {
    washDetected: detected.wash, pumpDetected: detected.pump,
    mmFalsePositive: (base.score.fpCausesByRule['W2:market-maker-subaccounts'] || 0) >= 1,
    shockFalsePositive: (base.score.fpCausesByRule['P1:benign-shock'] || 0) >= 1,
    p2QuietOnShock: !base.alerts.some((a) => a.rule === 'P2' && a.instrument === shockInst),
    defaultRingWhole: ringFragments(base) === 1,
    strictRingSplit: ringFragments(strict) > 1,
    strictW2RecallDrops: strict.score.byRule.W2.recall < base.score.byRule.W2.recall,
    defaultNoFalseLink: !pairLinked(base),
    looseFalseLink: pairLinked(loose),
    looseFalseAlerts,
    globalMoreP1FalsePositives: fpCount(glob, 'P1') >= fpCount(base, 'P1') + 1,
    w2SweepRecallChanges: Math.max(...col(w2, 'W2', 'recall')) === 1 && Math.min(...col(w2, 'W2', 'recall')) === 0,
    w2SweepPrecisionChanges: distinct(col(w2, 'W2', 'precision')) >= 2,
    p1SweepRecallChanges: Math.max(...col(p1, 'P1', 'recall')) === 1 && Math.min(...col(p1, 'P1', 'recall')) === 0,
    p1SweepPrecisionChanges: distinct(col(p1, 'P1', 'precision')) >= 2,
    numbers: {
      p1Fp: { instrument: fpCount(base, 'P1'), global: fpCount(glob, 'P1') },
      w2Recall: { weak2: base.score.byRule.W2.recall, strong1: strict.score.byRule.W2.recall },
    },
  };
  clearCache();
  return out;
}

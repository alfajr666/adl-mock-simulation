import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAlerts } from '../engine/score.js';

const gt = {
  accountRoles: { R1: 'planted-wash-ring-hub', R2: 'planted-wash-ring-spoke', R3: 'planted-wash-ring-spoke', P1: 'planted-pump-group', P2: 'planted-pump-group',
    M1: 'planted-maker-sub-account', M2: 'planted-maker-sub-account', H1: 'retail', H2: 'honest-family-pair', H3: 'honest-family-pair', ALGO: 'honest-algo', C1: 'retail', C2: 'retail', C3: 'retail', C4: 'retail', C5: 'retail', C6: 'retail' },
  episodes: [
    { id: 'EP-W', type: 'wash', instrument: 'X', accounts: ['R1', 'R2', 'R3'], window: { startMs: 1000, endMs: 2000 } },
    { id: 'EP-P', type: 'pump', instrument: 'Y', accounts: ['P1', 'P2'], window: { startMs: 5000, endMs: 9000 } },
  ],
  honestGroups: [{ id: 'family-1', accounts: ['H2', 'H3'] }],
  decoys: [
    { id: 'DEC-MM-1', designed: true, type: 'same-owner-cross', instrument: 'Z', accounts: ['M1', 'M2'], window: { startMs: 3000, endMs: 3100 } },
    { id: 'DEC-SHOCK-1', designed: true, type: 'benign-news-shock', instrument: 'Y', accounts: [], window: { startMs: 20000, endMs: 30000 } },
    { id: 'DEC-BURST-1', type: 'honest-momentum-burst', instrument: 'Q', accounts: [], window: { startMs: 40000, endMs: 50000 } },
    { id: 'DEC-BLOCK-1', type: 'honest-block-trade', instrument: 'Q', accounts: ['H1'], window: { startMs: 60000, endMs: 70000 } },
    { id: 'DEC-LINK-1', type: 'coincidental-shared-attribute', instrument: null, accounts: ['C1', 'C2'], window: null },
  ],
};
let n = 0;
const A = (rule, instrument, accounts, startMs, endMs, clusterId = null) => ({ id: `${rule}#${++n}`, rule, instrument, accounts, window: { startMs, endMs }, cluster: clusterId ? { id: clusterId, accounts } : null });
const label = (a) => scoreAlerts([a], gt).labels[a.id];

test('window overlap is half-open: touching windows do not overlap, one ms of overlap does', () => {
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 0, 1000)).label, 'UNRELATED');        // ends exactly where the episode starts
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 0, 1001)).label, 'MATCH');
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 1999, 3000)).label, 'MATCH');
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 2000, 3000)).label, 'UNRELATED');
});

test('account-count rules: W2 needs two planted accounts, P2 one, P1 none; instrument and rule type must fit', () => {
  assert.equal(label(A('W2', 'X', ['R1', 'H1'], 1000, 2000)).label, 'UNRELATED');
  assert.equal(label(A('P2', 'Y', ['P1', 'H1'], 6000, 7000)).label, 'MATCH');                         // 1 of 2 accounts planted: precision 0.5
  assert.equal(label(A('P2', 'Y', ['H1', 'H2'], 6000, 7000)).label, 'UNRELATED');
  assert.equal(label(A('P1', 'Y', [], 6000, 7000)).label, 'MATCH');
  assert.equal(label(A('P1', 'X', [], 1000, 2000)).label, 'UNRELATED');                                // price alert on the wash instrument is not the pump
  assert.equal(label(A('W2', 'Y', ['R1', 'R2'], 6000, 7000)).label, 'UNRELATED');                     // wrong instrument
  assert.deepEqual(label(A('P1', 'Y', [], 6000, 7000)).episodeIds, ['EP-P']);
});

test('accountPrecision: an alert naming mostly honest accounts is MATCH_DILUTED, not MATCH', () => {
  const clean = label(A('W2', 'X', ['R1', 'R2', 'R3', 'C1'], 1000, 2000));
  assert.deepEqual([clean.label, clean.accountPrecision], ['MATCH', 0.75]);
  const edge = label(A('W2', 'X', ['R1', 'R2', 'C1', 'C2'], 1000, 2000));
  assert.deepEqual([edge.label, edge.accountPrecision], ['MATCH', 0.5]);                              // exactly 0.5 still matches
  const diluted = label(A('W2', 'X', ['R1', 'R2', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'], 1000, 2000));
  assert.deepEqual([diluted.label, diluted.accountPrecision, diluted.episodeIds], ['MATCH_DILUTED', 0.25, ['EP-W']]);
  assert.equal(label(A('P1', 'Y', [], 6000, 7000)).accountPrecision, null);
  const s = scoreAlerts([A('W2', 'X', ['R1', 'R2', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'], 1000, 2000, 'CL-1')], gt);
  assert.deepEqual(s.overall.episodes, { planted: 2, found: 0, diluted: 1, missed: 1 });
  assert.equal(s.overall.recall, 0, 'a diluted find is not a clean find');
  assert.equal(s.caseSummary.dilutedEpisodeCases, 1);
  assert.equal(s.caseSummary.episodeCases, 0);
  assert.equal(s.byEpisode[0].status, 'diluted');
  assert.equal(s.byEpisode[0].missed, false);
});

test('causes: same-owner cross is EXPLAINABLE only when every account is the maker group; others are UNRELATED with a cause', () => {
  const ex = label(A('W2', 'Z', ['M1', 'M2'], 3000, 3050));
  assert.deepEqual([ex.label, ex.cause, ex.decoyIds], ['EXPLAINABLE', 'same-owner-cross', ['DEC-MM-1']]);
  const diluted = label(A('W2', 'Z', ['M1', 'M2', 'H1'], 3000, 3050));
  assert.deepEqual([diluted.label, diluted.cause], ['UNRELATED', 'background-collision']);
  assert.equal(label(A('W2', 'Z', ['M1', 'M2'], 4000, 5000)).label, 'UNRELATED');                     // no cross happened then
  assert.equal(label(A('P1', 'Y', [], 21000, 25000)).cause, 'benign-shock');
  assert.equal(label(A('P1', 'Q', [], 41000, 45000)).cause, 'benign-burst');
  assert.equal(label(A('P1', 'Q', [], 61000, 65000)).cause, 'block-trade');
  assert.equal(label(A('P1', 'Q', [], 0, 10)).cause, 'natural-move');
  assert.equal(label(A('W2', 'Q', ['H2', 'H3'], 0, 10)).cause, 'honest-linked-trading');
  assert.equal(label(A('W2', 'Q', ['C1', 'C2'], 0, 10)).cause, 'coincidental-link');
  assert.equal(label(A('W2', 'Q', ['H1', 'H2', 'H3'], 0, 10)).cause, 'background-collision');
});

test('W1 is scored apart as self-match hygiene and never counts as a pattern alert or episode', () => {
  const alerts = [A('W1', 'X', ['R2'], 1100, 1101), A('W1', 'Q', ['ALGO'], 0, 1), A('W2', 'X', ['R1', 'R2'], 1000, 2000)];
  const s = scoreAlerts(alerts, gt);
  assert.equal(s.labels[alerts[0].id].label, 'SELF_MATCH');
  assert.deepEqual([s.selfMatch.alerts, s.selfMatch.onPlantedAccounts, s.selfMatch.onHonestAlgoAccounts], [2, 1, 1]);
  assert.equal(s.overall.alerts.total, 1);
  assert.equal(s.overall.episodes.found, 1);
  assert.equal(s.byRule.W1, undefined);
  assert.equal(scoreAlerts([alerts[0]], gt).overall.recall, 0);
});

test('cases: one per episode found, one per designed trap that alerted (by decoy id), one per unrelated cluster window', () => {
  const alerts = [
    A('P1', 'Y', [], 5000, 6000), A('P1', 'Y', [], 7000, 8000), A('P2', 'Y', ['P1', 'P2'], 6000, 9000, 'CL-P'), A('W2', 'X', ['R1', 'R2'], 1000, 2000, 'CL-R'),   // two episodes, found cleanly
    A('W2', 'Z', ['M1', 'M2'], 3000, 3050, 'CL-M'),                                                      // trap: explainable
    A('P1', 'Y', [], 21000, 25000), A('P1', 'Y', [], 24000, 28000),                                      // trap: the shock (two alerts, one case)
    A('P1', 'Q', [], 0, 10), A('P1', 'Q', [], 5, 30), A('P1', 'Q', [], 100, 120),                         // unrelated: windows 0-30 merge, 100-120 separate
    A('W2', 'Q', ['H2', 'H3'], 0, 10, 'CL-H'),                                                           // unrelated: other cluster key
  ];
  const s = scoreAlerts(alerts, gt);
  assert.deepEqual(s.caseSummary, {
    cases: 7, episodeCases: 2, dilutedEpisodeCases: 0, trapCases: 2, explainableCases: 1, unrelatedCases: 3,
    shareMatchingEpisode: 2 / 7, shareMatchingOrExplainable: 3 / 7, episodesFound: 2, episodesMissed: 0,
  });
  assert.deepEqual(s.cases.filter((c) => c.kind === 'trap').map((c) => c.decoyId), ['DEC-MM-1', 'DEC-SHOCK-1']);
  assert.equal(s.cases.find((c) => c.kind === 'episode' && c.episodeId === 'EP-P').rules.join(','), 'P1,P2');
  assert.equal(s.cases.find((c) => c.decoyId === 'DEC-SHOCK-1').alertIds.length, 2);
});

test('rule-level groups: duplicates of one episode are one group; explainable by decoy id; unrelated by (rule, instrument, cluster, merged window)', () => {
  const alerts = [
    A('P1', 'Y', [], 5000, 6000), A('P1', 'Y', [], 7000, 8000), A('P1', 'Y', [], 8000, 9000),
    A('W2', 'X', ['R1', 'R2'], 1000, 2000),
    A('W2', 'Z', ['M1', 'M2'], 3000, 3050),
    A('P1', 'Y', [], 21000, 25000), A('P1', 'Q', [], 0, 10), A('P1', 'Q', [], 5, 30), A('P1', 'Q', [], 100, 120),
  ];
  const o = scoreAlerts(alerts, gt).overall;
  assert.deepEqual(o.alerts, { total: 9, match: 4, matchDiluted: 0, explainable: 1, unrelated: 4 });
  assert.deepEqual(o.groups, { total: 6, episodeMatches: 2, diluted: 0, explainable: 1, unrelated: 3 });
  assert.equal(o.precision.alert.match, 4 / 9);
  assert.equal(o.precision.group.matchOrExplainable, 3 / 6);
  assert.deepEqual(o.episodes, { planted: 2, found: 2, diluted: 0, missed: 0 });
  const s = scoreAlerts(alerts, gt);
  assert.deepEqual(s.decoysAlerted, ['DEC-MM-1', 'DEC-SHOCK-1']);
});

test('no alerts: precision is null, recall 0, both episodes missed, no cases', () => {
  const s = scoreAlerts([], gt);
  assert.equal(s.overall.precision.group.match, null);
  assert.equal(s.overall.recall, 0);
  assert.equal(s.overall.episodes.missed, 2);
  assert.deepEqual([s.caseSummary.cases, s.caseSummary.shareMatchingEpisode, s.caseSummary.episodesMissed], [0, null, 2]);
});

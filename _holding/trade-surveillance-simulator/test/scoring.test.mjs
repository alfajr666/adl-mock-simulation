import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAlerts } from '../engine/score.js';

const gt = {
  accountRoles: { R1: 'planted-wash-ring-hub', R2: 'planted-wash-ring-spoke', R3: 'planted-wash-ring-spoke', P1: 'planted-pump-group', P2: 'planted-pump-group',
    M1: 'planted-maker-sub-account', M2: 'planted-maker-sub-account', H1: 'retail', H2: 'honest-family-pair', H3: 'honest-family-pair', ALGO: 'honest-algo' },
  episodes: [
    { id: 'EP-W', type: 'wash', instrument: 'X', accounts: ['R1', 'R2', 'R3'], window: { startMs: 1000, endMs: 2000 } },
    { id: 'EP-P', type: 'pump', instrument: 'Y', accounts: ['P1', 'P2'], window: { startMs: 5000, endMs: 9000 } },
  ],
  decoys: [
    { id: 'DEC-MM-1', type: 'same-owner-cross', instrument: 'Z', accounts: ['M1', 'M2'], window: { startMs: 3000, endMs: 3100 } },
    { id: 'DEC-SHOCK-1', type: 'benign-news-shock', instrument: 'Y', accounts: [], window: { startMs: 20000, endMs: 30000 } },
    { id: 'DEC-FAMILY-1', type: 'unrelated-shared-strong-attribute', instrument: null, accounts: ['H2', 'H3'], window: null },
  ],
};
let n = 0;
const A = (rule, instrument, accounts, startMs, endMs) => ({ id: `${rule}#${++n}`, rule, instrument, accounts, window: { startMs, endMs } });
const label = (a) => scoreAlerts([a], gt).labels[a.id];

test('window overlap is half-open: touching windows do not overlap, one ms of overlap does', () => {
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 0, 1000)).label, 'UNRELATED');        // ends exactly where the episode starts
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 0, 1001)).label, 'MATCH');
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 1999, 3000)).label, 'MATCH');
  assert.equal(label(A('W2', 'X', ['R1', 'R2'], 2000, 3000)).label, 'UNRELATED');
});

test('account-count rules: W2 needs two planted accounts, P2 one, P1 none; instrument and rule type must fit', () => {
  assert.equal(label(A('W2', 'X', ['R1', 'H1'], 1000, 2000)).label, 'UNRELATED');
  assert.equal(label(A('W2', 'X', ['R1', 'R2', 'H1', 'H2'], 1000, 2000)).label, 'MATCH');             // diluted by honest accounts but still the ring
  assert.equal(label(A('P2', 'Y', ['P1', 'H1'], 6000, 7000)).label, 'MATCH');
  assert.equal(label(A('P2', 'Y', ['H1', 'H2'], 6000, 7000)).label, 'UNRELATED');
  assert.equal(label(A('P1', 'Y', [], 6000, 7000)).label, 'MATCH');
  assert.equal(label(A('P1', 'X', [], 1000, 2000)).label, 'UNRELATED');                                // price alert on the wash instrument is not the pump
  assert.equal(label(A('W2', 'Y', ['R1', 'R2'], 6000, 7000)).label, 'UNRELATED');                     // wrong instrument
  assert.deepEqual(label(A('P1', 'Y', [], 6000, 7000)).episodeIds, ['EP-P']);
});

test('causes: same-owner cross is EXPLAINABLE only when every account is the maker group; others are UNRELATED with a cause', () => {
  const ex = label(A('W2', 'Z', ['M1', 'M2'], 3000, 3050));
  assert.deepEqual([ex.label, ex.cause, ex.decoyIds], ['EXPLAINABLE', 'same-owner-cross', ['DEC-MM-1']]);
  const diluted = label(A('W2', 'Z', ['M1', 'M2', 'H1'], 3000, 3050));
  assert.deepEqual([diluted.label, diluted.cause], ['UNRELATED', 'background-collision']);
  assert.equal(label(A('W2', 'Z', ['M1', 'M2'], 4000, 5000)).label, 'UNRELATED');                     // no cross happened then
  assert.equal(label(A('P1', 'Y', [], 21000, 25000)).cause, 'benign-shock');
  assert.equal(label(A('P2', 'Y', ['H2', 'H3'], 21000, 25000)).cause, 'coincidental-link');
  assert.equal(label(A('P2', 'Y', ['H1', 'H2', 'H3'], 100, 200)).cause, 'background-collision');   // a larger cluster is a collision, not the decoy pair
  assert.equal(label(A('W2', 'Q', ['H2', 'H3'], 0, 10)).cause, 'coincidental-link');
  assert.equal(label(A('W2', 'Q', ['H1', 'H2'], 0, 10)).cause, 'background-collision');
  assert.equal(label(A('P1', 'Q', [], 0, 10)).cause, 'natural-move');
});

test('W1 is scored apart as self-match hygiene and never counts as a pattern alert or episode', () => {
  const alerts = [A('W1', 'X', ['R2'], 1100, 1101), A('W1', 'Q', ['ALGO'], 0, 1), A('W2', 'X', ['R1', 'R2'], 1000, 2000)];
  const s = scoreAlerts(alerts, gt);
  assert.equal(s.labels[alerts[0].id].label, 'SELF_MATCH');
  assert.deepEqual([s.selfMatch.alerts, s.selfMatch.onPlantedAccounts, s.selfMatch.onHonestAlgoAccounts], [2, 1, 1]);
  assert.equal(s.overall.alerts.total, 1);
  assert.equal(s.overall.episodes.found, 1);
  assert.equal(s.byRule.W1, undefined);
  const onlyW1 = scoreAlerts([alerts[0]], gt);
  assert.equal(onlyW1.overall.episodes.found, 0);
  assert.equal(onlyW1.overall.recall, 0);
});

test('group-level counts: duplicates of one episode are one group; precision is reported both ways', () => {
  const alerts = [
    A('P1', 'Y', [], 5000, 6000), A('P1', 'Y', [], 7000, 8000), A('P1', 'Y', [], 8000, 9000),       // one episode, three alerts
    A('W2', 'X', ['R1', 'R2'], 1000, 2000),
    A('W2', 'Z', ['M1', 'M2'], 3000, 3050),
    A('P1', 'Y', [], 21000, 25000), A('P1', 'Q', [], 0, 10), A('P1', 'Q', [], 20, 30),               // unrelated: 3 alerts, 2 groups
  ];
  const o = scoreAlerts(alerts, gt).overall;
  assert.deepEqual(o.alerts, { total: 8, match: 4, explainable: 1, unrelated: 3 });
  assert.deepEqual(o.groups, { total: 5, episodeMatches: 2, explainable: 1, unrelated: 2 });
  assert.deepEqual(o.episodes, { planted: 2, found: 2, missed: 0 });
  assert.equal(o.precision.alert.match, 4 / 8);
  assert.equal(o.precision.alert.matchOrExplainable, 5 / 8);
  assert.equal(o.precision.group.match, 2 / 5);
  assert.equal(o.precision.group.matchOrExplainable, 3 / 5);
  assert.equal(o.recall, 1);
  const s = scoreAlerts(alerts, gt);
  assert.deepEqual(s.decoysAlerted, ['DEC-MM-1', 'DEC-SHOCK-1']);
  assert.equal(s.byRule.P1.groups.episodeMatches, 1);
  assert.deepEqual(s.byRule.P1.episodes, { planted: 1, found: 1, missed: 0 });
  assert.equal(s.byRule.W2.episodes.planted, 1);
});

test('no alerts: precision is null, recall 0, both episodes missed', () => {
  const o = scoreAlerts([], gt).overall;
  assert.equal(o.precision.group.match, null);
  assert.equal(o.recall, 0);
  assert.equal(o.episodes.missed, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, caseView, CONFIG_IDS } from '../engine/index.js';

for (const id of CONFIG_IDS) {
  test(`${id}: case view has everything a screen needs, truth only under groundTruth`, () => {
    const r = runScenario(id, { seed: 1 });
    for (const alert of r.alerts) {
      const v = caseView(r, alert.id);
      assert.deepEqual(Object.keys(v).sort(), ['accounts', 'accountsNote', 'alert', 'clusterSeries', 'groundTruth', 'instrument', 'linkage', 'linkagePolicy', 'modelVersion', 'series', 'trades'].sort());
      assert.equal(v.series.length, r.market.bins.length);
      assert.ok(v.series.some((s) => s.inAlertWindow));
      assert.ok(v.series.every((s) => s.inAlertWindow === (s.startMs < alert.window.endMs && s.endMs > alert.window.startMs)));
      assert.equal(v.trades.length, alert.supportingTradeIds.length);
      assert.ok(v.accounts.length >= 1);
      for (const a of v.accounts) { assert.ok(a.attributes && a.declaredOwner && a.clusterId); assert.equal('role' in a, false); }
      assert.ok(v.clusterSeries.length >= 1);
      assert.equal(v.clusterSeries[0].points.length, r.market.bins.length);
      assert.ok(['MATCH', 'EXPLAINABLE', 'UNRELATED', 'SELF_MATCH'].includes(v.groundTruth.label));
      // nothing about planted truth outside the groundTruth field
      const outside = JSON.stringify({ ...v, groundTruth: null });
      for (const word of ['EP-WASH', 'EP-PUMP', 'wash-ring', 'pump-group', 'controller', 'CTRL-']) assert.ok(!outside.includes(word), `leak: ${word}`);
    }
  });

  test(`${id}: case view numbers agree with the alert`, () => {
    const r = runScenario(id, { seed: 1 });
    const w2 = r.alerts.find((a) => a.rule === 'W2' && r.score.labels[a.id].label === 'MATCH');
    const v = caseView(r, w2.id);
    assert.equal(v.accounts.length, w2.accounts.length);
    assert.ok(v.trades.every((t) => t.inst === w2.instrument && w2.accounts.includes(t.buyAcct) && w2.accounts.includes(t.sellAcct)));
    const last = v.clusterSeries[0].points.at(-1);
    assert.ok(Math.abs(last.position) < 0.2 * v.trades.reduce((s, t) => s + t.qty, 0), 'a wash cluster ends near flat');
    assert.ok(v.linkage.edges.length >= 3, 'evidence edges are included');
    assert.equal(v.groundTruth.label, 'MATCH');
    assert.deepEqual(v.groundTruth.episodeIds, ['EP-WASH-1']);

    const p2 = r.alerts.find((a) => a.rule === 'P2');
    const pv = caseView(r, p2.id);
    const pnl = pv.clusterSeries[0].points.at(-1).pnl;
    assert.ok(pnl > 0);
    assert.equal(pv.groundTruth.label, 'MATCH');
    assert.ok(pv.accounts.every((a) => a.aggressiveBuyQty >= 0 && a.aggressiveSellQty >= 0));

    const p1 = r.alerts.find((a) => a.rule === 'P1' && r.score.labels[a.id].cause === 'benign-shock');
    const sv = caseView(r, p1.id);
    assert.equal(sv.groundTruth.cause, 'benign-shock');
    assert.ok(sv.accounts.length > 1, 'P1 case lists the top participants');
    assert.ok(sv.accounts.some((a) => a.aggressiveBuyQty > 0));
    assert.throws(() => caseView(r, 'nope'));
  });
}

test('a falling P1 case view lists the top aggressive sellers as well', () => {
  let found = 0;
  for (const id of CONFIG_IDS) for (let seed = 1; seed <= 12 && !found; seed++) {
    const r = runScenario(id, { seed });
    const down = r.alerts.find((a) => a.rule === 'P1' && a.metrics.direction === 'down');
    if (!down) continue;
    const v = caseView(r, down.id);
    assert.match(v.accountsNote, /sellers/);
    assert.ok(v.accounts.some((a) => a.aggressiveSellQty > 0));
    found++;
  }
  assert.ok(found >= 1, 'a falling P1 alert exists in the first seeds');
});

// Prints the 100-seed study for both configs as markdown.   usage: npm run seeds [-- --policy weak1 --n 100 --baseline trailing]
import { seedStudy, CONFIG_IDS, MODEL_VERSION } from '../engine/index.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const n = Number(arg('n', 100));
const policy = arg('policy', 'weak2');
const baseline = arg('baseline', 'warmup');
const seeds = Array.from({ length: n }, (_, i) => i + 1);
const f = (x) => (x === null || x === undefined ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(2));

console.log(`# Seed study (${MODEL_VERSION}), ${n} seeds, linkage ${policy}, P1 baseline ${baseline}\n`);
for (const id of CONFIG_IDS) {
  const s = seedStudy(id, seeds, { linkagePolicy: policy, thresholds: { p1Baseline: baseline } });
  console.log(`## ${id}\n`);
  console.log(`Both planted episodes found cleanly in ${s.targetsPassing} of ${n} seeds.` + (s.failures.length ? ` Failures: ${s.failures.map((x) => `${x.seed} (found ${x.episodesFound}, diluted ${x.episodesDiluted})`).join('; ')}.` : '') + '\n');
  console.log(`Designed trap rates: explainable alert ${f(s.trapRates.explainableAlert)}, shock alert on P1 ${f(s.trapRates.shockAlertsOnP1)}, shock alert on P2 ${f(s.trapRates.shockAlertsOnP2)}.\n`);
  const cols = ['episodesFound', 'episodesDiluted', 'cases', 'episodeCases', 'trapCases', 'unrelatedCases', 'shareMatchingEpisode', 'shareMatchingOrExplainable', 'groups', 'alerts', 'w2Found', 'p1Found', 'p2Found', 'selfMatchAlerts', 'largestCluster', 'falseLinkedPairs', 'meanAccountsPerMatchingAlert'];
  console.log('| metric | median | min | max |\n|---|---|---|---|');
  for (const c of cols) console.log(`| ${c} | ${f(s.summary[c].median)} | ${f(s.summary[c].min)} | ${f(s.summary[c].max)} |`);
  console.log('\n| seed | found | diluted | cases | episode | trap | unrelated | share(episode) | share(episode+explainable) | clean |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const r of s.rows) console.log(`| ${r.seed} | ${r.episodesFound} | ${r.episodesDiluted} | ${r.cases} | ${r.episodeCases} | ${r.trapCases} | ${r.unrelatedCases} | ${f(r.shareMatchingEpisode)} | ${f(r.shareMatchingOrExplainable)} | ${r.targets.all ? 'ok' : 'FAIL'} |`);
  console.log('');
}

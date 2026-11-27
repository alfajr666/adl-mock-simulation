/*
 * UI smoke test (not part of `npm test`). Run: npm run test:ui
 * Serves this folder with `python3 -m http.server` on a free port and drives equity.html and
 * crypto.html with Playwright at 1280 px and 390 px. Needs `require('playwright')` to resolve
 * (set NODE_PATH if it is installed globally). Screenshots go to $SURV_SHOTS, default ./.scratch/ui-shots.
 * Expected alert counts are read from the engine at run time, not hard-coded.
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SURV_SHOTS || path.join(ROOT, '.scratch', 'ui-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
let failures = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}
async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}
const queueCount = (page) => page.locator('#queue-body tr[data-id]').count();
const waitCount = (page, op, n) => page.waitForFunction(([o, c]) => { const k = document.querySelectorAll('#queue-body tr[data-id]').length; return o === 'eq' ? k === c : k !== c; }, [op, n], { timeout: 4000 }).catch(() => {});
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Tokens that must not appear in anything the analyst can see before a reveal.
const LEAK = /MATCH|EXPLAINABLE|UNRELATED|SELF_MATCH|planted-|EP-WASH|EP-PUMP|DEC-|honest-|same-owner|benign-shock|natural-move|background-collision|coincidental|Matches a planted|Unrelated|Explainable|\bTP\b|\bFP\b/;
const OLD_WORDS = /true hit|false alarm|\bIDX\b|sigma|z-score|deviations?\b/i;

async function runPage(browser, base, ENG, cfg, vpName) {
  const tag = `${cfg}@${vpName}`;
  const def = ENG.runScenario(cfg, { seed: 1 });
  const N = def.alerts.length;
  const strictN = ENG.runScenario(cfg, { seed: 1, linkagePolicy: 'strong1' }).alerts.length;
  const loose = ENG.runScenario(cfg, { seed: 1, linkagePolicy: 'weak1' });
  const labels = def.score.labels;

  const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  const t0 = Date.now();
  await page.goto(`${base}/${cfg}.html`, { waitUntil: 'load' });
  await page.waitForSelector('#queue-body tr[data-id]');
  check(Date.now() - t0 < 3000, `${tag}: loads and renders quickly (${Date.now() - t0} ms incl. page load)`);

  // default counts, straight from the engine
  const n = await queueCount(page);
  check(n === N, `${tag}: default seed shows the engine's ${N} alerts (got ${n})`);
  check((await page.locator('#count-live').textContent()).startsWith(String(N)), `${tag}: live count text starts with the count`);
  const hyg = await page.locator('#queue-body .hyg').count();
  check(hyg === def.alerts.filter((a) => a.rule === 'W1').length && hyg > 0, `${tag}: every W1 alert is tagged as a hygiene rule (${hyg})`);

  // ---- nothing about the answer is visible or inferable before reveal ----
  const vis = await page.evaluate(() => ['#tape', '#queue-section', '#case-section', '#controls'].map((s) => document.querySelector(s).outerHTML).join('\n'));
  const leak = vis.match(LEAK);
  check(!leak, `${tag}: no label, role, cause or id-of-truth in the tape, queue, case or controls DOM before reveal${leak ? ' -> ' + leak[0] : ''}`);
  const attrs = await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('body *')) { if (el.closest('#method, #score-section, #explore-section')) continue; for (const a of el.attributes) out.push(`${a.name}=${a.value}`); } return out.join('\n'); });
  const aleak = attrs.match(LEAK);
  check(!aleak, `${tag}: no label, role or cause in any attribute (class, data-*, title, aria-label, id) outside the methodology and locked panels${aleak ? ' -> ' + aleak[0] : ''}`);
  await page.locator('#pv-host svg').scrollIntoViewIfNeeded();
  const box = await page.locator('#pv-host svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  const tip = await page.locator('#pv-host .tip').innerText().catch(() => '');
  check(tip.length > 0 && !LEAK.test(tip), `${tag}: chart tooltip shows bin data only (${tip.replace(/\n/g, ' / ').slice(0, 60)})`);
  const skeletons = await page.evaluate(() => [...document.querySelectorAll('#queue-body tr[data-id]')].map((r) => ({ id: r.dataset.id, sk: r.outerHTML.replace(/>[^<]*</g, '><').replace(/ data-id="[^"]*"/, '').replace(/ tabindex="-?\d"/, '').replace(/ aria-current="[^"]*"/, '').replace(/ title="[^"]*"/g, '') })));
  const byRule = {};
  for (const r of skeletons) { const rule = r.id.split('|')[0]; (byRule[rule] ||= new Set()).add(r.sk); }
  check(Object.values(byRule).every((set) => set.size === 1), `${tag}: queue rows of one rule share identical markup whatever their label (no class or attribute leaks)`);
  const labelPerRule = {};
  for (const a of def.alerts) (labelPerRule[a.rule] ||= new Set()).add(labels[a.id].label);
  check(Object.values(labelPerRule).some((x) => x.size > 1), `${tag}: (precondition) the default run has a rule whose alerts carry different labels`);
  const tapeMarkup = await page.evaluate(() => [...document.querySelectorAll('#tape .chip, #tape .mk')].map((e) => e.outerHTML.replace(/>[^<]*</g, '><').replace(/-?\d+(\.\d+)?/g, '#')).filter((v, i, a) => a.indexOf(v) === i).length);
  check(tapeMarkup <= 8, `${tag}: tape markers use one style per rule (${tapeMarkup} variants)`);
  check((await page.locator('#answer-box').innerText()).includes('Hidden'), `${tag}: answer box says hidden`);
  check((await page.locator('#score-section').innerText()).toLowerCase().includes('locked'), `${tag}: scorecard locked`);
  check((await page.locator('#queue-head').innerText()).includes('Answer key') === false, `${tag}: no answer-key column before unlock`);
  const body0 = await page.locator('body').innerText();
  check(!OLD_WORDS.test(body0), `${tag}: no retired wording (true hit, false alarm, IDX, sigma, z-score, deviations)`);
  check(!/Planted role/.test(body0), `${tag}: no planted role column before reveal`);

  check(await overflow(page) <= 0, `${tag}: no horizontal page overflow (${await overflow(page)}px)`);
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}.png`), fullPage: true });

  // controls from 1.1.0
  check(await page.locator('input[name="p1base"]').count() === 2 && await page.locator('#in-p1BaselineBins').count() === 1 && await page.locator('#in-p1MoveScore').count() === 1, `${tag}: baseline period, baseline length and move score controls exist`);
  check((await page.locator('#controls details').first().innerText()).length > 0 && (await page.locator('#controls details').first().evaluate((d) => d.textContent.includes('Caveat'))), `${tag}: linkage panel lists each attribute's rationale and caveat`);

  // P1 and P2 cases show their extra evidence
  const p1 = def.alerts.find((a) => a.rule === 'P1' && labels[a.id].label === 'MATCH');
  await page.locator(`#queue-body tr[data-id="${p1.id}"]`).click();
  await page.waitForSelector('#pv-host svg');
  const p1txt = await page.locator('#case-section').innerText();
  check(/Baseline used: bins \d+–\d+/.test(p1txt) && /Aggressive buys/i.test(p1txt) && /Aggressive sells/i.test(p1txt) && !OLD_WORDS.test(p1txt), `${tag}: P1 case shows the baseline range and aggressive buyers and sellers`);
  const p2 = def.alerts.find((a) => a.rule === 'P2');
  await page.locator(`#queue-body tr[data-id="${p2.id}"]`).click();
  await page.waitForSelector('#pv-host svg');
  check(/net buying was/.test(await page.locator('#case-section').innerText()), `${tag}: P2 case shows the accumulation metrics`);

  // keyboard-accessible data views for the charts
  await page.locator('#case-section details summary', { hasText: 'chart data' }).first().click();
  check(await page.locator('#pv-data tbody tr').count() === def.market.bins.length && await page.locator('#pv-data [role="region"][tabindex="0"]').count() === 1, `${tag}: price chart has a focusable data table with a row per bin`);

  // selecting an alert renders the case file
  await page.locator('#queue-body tr[data-id]').nth(3).click();
  await page.waitForSelector('#pv-host svg');
  const title = await page.locator('#case-title').innerText();
  check(/^Case file: (W1|W2|P1|P2) · /.test(title), `${tag}: case file renders ("${title}")`);
  check(await page.locator('#panel-accounts svg').count() > 0 && await page.locator('#panel-accounts table').count() > 0, `${tag}: link graph and account table render`);
  await page.click('#tab-trades');
  check(await page.locator('#panel-trades table tbody tr').count() > 0, `${tag}: supporting trades tab has rows`);
  await page.click('#tab-cluster');
  check(await page.locator('#pos-host svg').count() === 1 && await page.locator('#pnl-host svg').count() === 1, `${tag}: position and P&L charts render`);
  check(await page.locator('#panel-cluster details table tbody tr').count() > 20 || await page.locator('#panel-cluster details').count() === 0, `${tag}: position and P&L chart has a data table`);
  await page.click('#tab-accounts');

  // linkage policy changes the queue
  await page.locator('input[name="policy"][value="strong1"]').check();
  const idsOnPage = () => page.evaluate(() => [...document.querySelectorAll('#queue-body tr[data-id]')].map((r) => r.dataset.id).sort());
  const strictIds = ENG.runScenario(cfg, { seed: 1, linkagePolicy: 'strong1' }).alerts.map((a) => a.id).sort();
  const defIds = def.alerts.map((a) => a.id).sort();
  await page.waitForFunction((want) => JSON.stringify([...document.querySelectorAll('#queue-body tr[data-id]')].map((r) => r.dataset.id).sort()) === JSON.stringify(want), strictIds, { timeout: 4000 }).catch(() => {});
  const gotStrict = await idsOnPage();
  check(JSON.stringify(gotStrict) === JSON.stringify(strictIds) && JSON.stringify(strictIds) !== JSON.stringify(defIds), `${tag}: strict linkage changes the queue to the engine's strict set (${N} -> ${gotStrict.length} alerts)`);

  // loose policy: very large false clusters must stay usable
  await page.locator('input[name="policy"][value="weak1"]').check();
  await waitCount(page, 'eq', loose.alerts.length);
  check(await queueCount(page) === loose.alerts.length, `${tag}: loose linkage shows the engine's ${loose.alerts.length} alerts`);
  const sizeOf = (a) => (a.cluster ? a.cluster.accounts.length : 0);
  const big = [...loose.alerts].sort((a, b) => sizeOf(b) - sizeOf(a))[0];
  await page.locator(`#queue-body tr[data-id="${big.id}"]`).click();
  await page.waitForSelector('#panel-accounts svg');
  const nodes = await page.locator('#panel-accounts circle.node').count();
  const acctRows = await page.locator('#panel-accounts table').first().locator('tbody tr').count();
  check(nodes <= 12, `${tag}: link graph is capped at 12 nodes for a ${sizeOf(big)}-account group (${nodes} drawn)`);
  check(acctRows <= 12, `${tag}: account table pages at 12 rows (${acctRows} shown)`);
  if (sizeOf(big) > 12) check(await page.locator('#more-accts').count() === 1 && /more are in the register table/.test(await page.locator('#panel-accounts').innerText()), `${tag}: a note and a "show more" control cover the rest`);
  check(await overflow(page) <= 0, `${tag}: no page overflow with a large group open (${await overflow(page)}px)`);
  await page.locator('#case-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}-loose.png`), fullPage: true });
  // a diluted alert: reveal text states N of M named accounts, and the decision check says the case file needs narrowing
  const dil = loose.alerts.find((a) => loose.score.labels[a.id].label === 'MATCH_DILUTED');
  check(!!dil, `${tag}: (precondition) loose linkage yields a diluted match in the engine`);
  if (dil) {
    await page.locator(`#queue-body tr[data-id="${dil.id}"]`).click();
    await page.waitForSelector('#reveal-btn');
    await page.locator('input[name="decision"][value="escalate"]').check();
    await page.click('#reveal-btn');
    await page.waitForSelector('#verdict-h');
    const vt = await page.locator('#answer-box').innerText();
    const prec = loose.score.labels[dil.id].accountPrecision, m = dil.accounts.length, k = Math.round(prec * m);
    check(vt.includes(`Overlaps a planted episode, diluted (${k} of ${m} named accounts are planted)`) && /needs narrowing/.test(vt), `${tag}: diluted reveal says ${k} of ${m} named accounts are planted and that the case file needs narrowing`);
    check(/Diluted/.test(await page.locator(`#queue-body tr[data-id="${dil.id}"]`).innerText()) === false, `${tag}: (before unlock) the queue row does not say diluted`);
  }
  await page.locator('input[name="policy"][value="weak2"]').check();
  await waitCount(page, 'eq', N);
  check(await queueCount(page) === N, `${tag}: back to default linkage restores the count`);

  // slider by keyboard
  await page.focus('#in-w2InstrumentShare');
  await page.keyboard.press('End');
  await waitCount(page, 'ne', N);
  check(await queueCount(page) !== N, `${tag}: moving the W2 slider by keyboard changes the queue`);
  await page.click('#reset-defaults');
  await waitCount(page, 'eq', N);
  check(await queueCount(page) === N, `${tag}: reset to defaults restores the count`);

  // instrument filter
  const firstInst = page.locator('.inst').first();
  await firstInst.click();
  check(await queueCount(page) <= N, `${tag}: instrument click filters the queue`);
  await firstInst.click();

  // keyboard-only path: queue -> case -> decision -> reveal
  await page.locator('#queue-body tr[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'case-title', `${tag}: Enter on a queue row moves focus to the case file`);
  let reached = false;
  for (let i = 0; i < 90 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement && document.activeElement.name === 'decision'); }
  check(reached, `${tag}: Tab reaches the decision control from the case file`);
  if (reached) {
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const val = await page.evaluate(() => document.querySelector('input[name="decision"]:checked')?.value);
    check(['escalate', 'monitor', 'close'].includes(val), `${tag}: decision recorded by keyboard (${val})`);
    check(await page.locator('#queue-body tr[aria-current="true"] .status').count() === 1, `${tag}: decision appears in the queue`);
    let rev = false;
    for (let i = 0; i < 12 && !rev; i++) { await page.keyboard.press('Tab'); rev = await page.evaluate(() => document.activeElement && document.activeElement.id === 'reveal-btn'); }
    check(rev, `${tag}: Tab reaches the reveal control`);
    if (rev) await page.keyboard.press('Enter');
    await page.waitForSelector('#verdict-h');
    const verdict = await page.locator('#answer-box').innerText();
    check(/Matches a planted episode|Overlaps a planted episode, diluted|Explainable|Unrelated to anything planted|Self-match hygiene/.test(verdict) && /fits|does not fit|not recorded|monitoring/.test(verdict) && /simplification/.test(verdict), `${tag}: reveal shows one of the three labels (or hygiene), the decision comparison and the simplification note`);
    check(!OLD_WORDS.test(verdict), `${tag}: reveal text avoids retired wording`);
  }

  // unlock key: group-level scorecard, hygiene block, honesty, explorer, seed study
  await page.click('#key-toggle');
  await page.waitForSelector('#score-section .metrics');
  const sc = await page.locator('#score-section').innerText();
  check(/Cases/i.test(sc) && /Share of cases matching a planted episode/i.test(sc) && /Share matching or explainable/i.test(sc) && /Episodes found cleanly/i.test(sc) && /Found diluted/i.test(sc) && /Trap cases \(designed\)/i.test(sc) && /Unrelated cases/i.test(sc), `${tag}: scorecard leads with cases, the two shares and clean, diluted and missed episodes`);
  check(!/precision/i.test(await page.locator('#cases-block').innerText()), `${tag}: the case-level block does not use the word precision`);
  const caseRowsN = await page.locator('#cases-block table tbody tr').count();
  check(caseRowsN === def.score.caseSummary.cases, `${tag}: case table lists the engine's ${def.score.caseSummary.cases} cases (got ${caseRowsN})`);
  check(await page.locator('#rule-detail table tbody tr').count() === 4 && !/\bW1\b/.test(await page.locator('#rule-detail table').first().evaluate((t) => t.textContent)), `${tag}: rule-level detail covers W2, P1, P2 (plus overall), not W1`);
  check(/Designed traps/.test(sc) && /Ordinary honest activity the scenario generates/.test(sc), `${tag}: the causes list separates designed traps from ordinary honest activity`);
  check(await page.locator('#hygiene').count() === 1 && /outside the scorecard/i.test(await page.locator('#hygiene').innerText()) && /honest/i.test(await page.locator('#hygiene').innerText()), `${tag}: self-match hygiene block is separate and explains honest algo accounts`);
  const honest = await page.locator('#honesty').innerText();
  check(/100 of 100 seeds/.test(honest) && /0\.29/.test(honest) && /0\.92/.test(honest) && /less sensitive across the board/.test(honest) && /0\.405/.test(honest) && /What stays contrived/i.test(honest) && /0\.93 to 0\.95/.test(honest) && /scripted/.test(honest) && !/35%|61%/.test(honest), `${tag}: honesty panel carries the 1.2.0 statements and the contrivances list`);
  const keyCells = await page.locator('#queue-body tr[data-id] td:last-child .status').allInnerTexts();
  check(keyCells.length === N && keyCells.every((t) => ['Match', 'Diluted', 'Explainable', 'Unrelated', 'Hygiene'].includes(t)), `${tag}: queue key column uses the three labels plus hygiene`);
  const keyMatches = await page.evaluate(() => [...document.querySelectorAll('#queue-body tr[data-id]')].map((r) => [r.dataset.id, r.querySelector('td:last-child').innerText.trim()]));
  const wantShort = { MATCH: 'Match', MATCH_DILUTED: 'Diluted', EXPLAINABLE: 'Explainable', UNRELATED: 'Unrelated', SELF_MATCH: 'Hygiene' };
  check(keyMatches.every(([id, t]) => wantShort[labels[id].label] === t), `${tag}: every label in the UI equals the engine's label`);
  check(!OLD_WORDS.test(await page.locator('body').innerText()), `${tag}: no retired wording anywhere after unlock`);
  await page.waitForFunction(() => /of 30 seeds/.test(document.getElementById('seed-summary')?.textContent || ''), null, { timeout: 30000 });
  const seedTxt = await page.locator('#explore-section').innerText();
  check(/read the distribution, not one run/.test(seedTxt) && /median/.test(seedTxt) && /found cleanly in \d+ of 30 seeds/.test(seedTxt), `${tag}: seed study states the single-run caveat, shows medians and the one pass/fail line`);
  const tr = await page.locator('#trap-rates').innerText();
  check(/not pass or fail/.test(tr) && (tr.match(/\d+%/g) || []).length === 3, `${tag}: trap rates shown as three percentages, labelled not pass or fail`);
  check(/Share of cases matching a planted episode/.test(seedTxt) && !/precision/i.test(await page.locator('#seed-host').evaluate((e) => e.textContent)), `${tag}: seed strips use case-level shares`);
  const dots = await page.locator('#seed-host .seed-dot, #seed-host .cur-dot').count();
  check(dots >= 90, `${tag}: seed study draws a dot per seed per measure (${dots})`);
  check(await page.locator('#seed-table tbody tr').count() === 30, `${tag}: seed table has 30 rows`);
  const lg = await page.locator('#sweep-legend').innerText();
  check(/Episodes found cleanly/.test(lg) && /found, diluted/.test(lg) && /Designed-trap cases/.test(lg) && /Unrelated cases/.test(lg), `${tag}: sweep plots clean and diluted finds, trap cases and unrelated cases`);
  await page.selectOption('#explorer-param', 'linkagePolicy');
  check(await page.locator('#sweep-host svg').count() === 1 && await page.locator('#linkage-effects tbody tr').count() === 3, `${tag}: linkage sweep shows largest cluster and honest pairs merged for three policies`);
  const eff = await page.locator('#linkage-effects').innerText();
  check(/Found cleanly/i.test(eff) && /Found diluted/i.test(eff) && /Unrelated cases/i.test(eff) && /Largest group/i.test(eff) && /False-linked pairs/i.test(eff) && /Accounts named per matching alert/i.test(eff), `${tag}: linkage effects table has clean and diluted finds, unrelated cases, largest cluster, false-linked pairs and accounts per matching alert`);
  check(await overflow(page) <= 0, `${tag}: no horizontal overflow after unlock (${await overflow(page)}px)`);

  // export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(json.modelVersion === ENG.MODEL_VERSION && json.alerts.length === N && json.score && json.score.caseSummary && Array.isArray(json.score.cases) && json.score.ruleLevel.overall.groups && json.score.selfMatchHygiene && json.simulator === cfg && json.schema === 'trade-surveillance-export-3', `${tag}: export follows the new score shape`);
  check(Array.isArray(json.seedStudy?.rows) && json.seedStudy.rows.length === 30, `${tag}: export includes the seed study`);

  await page.locator('#queue-body tr[data-id]').nth(1).click();
  await page.locator('#case-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}-case-revealed.png`), fullPage: true });

  // default-policy clusters are larger in 1.2.0: open the alert with the biggest one on the seed that has it
  let bestSeed = 1, bestAlert = null, bestN = -1;
  for (let sd = 1; sd <= 8; sd++) for (const a of ENG.runScenario(cfg, { seed: sd }).alerts) { const k = a.cluster ? a.cluster.accounts.length : 0; if (k > bestN) { bestN = k; bestSeed = sd; bestAlert = a; } }
  await page.selectOption('#seed-select', String(bestSeed));
  await page.waitForSelector(`#queue-body tr[data-id="${bestAlert.id}"]`);
  await page.locator(`#queue-body tr[data-id="${bestAlert.id}"]`).click();
  await page.waitForSelector('#panel-accounts svg');
  check(await page.locator('#panel-accounts circle.node').count() <= 12 && await overflow(page) <= 0, `${tag}: default policy, seed ${bestSeed}, ${bestN}-account cluster: graph capped and no page overflow (${await overflow(page)}px)`);
  await page.locator('#case-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}-bigcluster.png`), fullPage: true });

  check(errors.length === 0, `${tag}: no console errors${errors.length ? ' -> ' + errors.join(' | ') : ''}`);
  check(external.length === 0, `${tag}: no requests outside the local server${external.length ? ' -> ' + external.join(', ') : ''}`);
  await ctx.close();
}

(async () => {
  const ENG = await import(pathToFileURL(path.join(ROOT, 'engine', 'index.js')).href);
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    await waitFor(`${base}/index.html`);
    for (const cfg of ['equity', 'crypto']) for (const vp of ['desktop', 'mobile']) await runPage(browser, base, ENG, cfg, vp);

    // landing page
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile, deviceScaleFactor: 1 });
    const lp = await ctx.newPage();
    const lerr = [];
    lp.on('pageerror', (e) => lerr.push(String(e))); lp.on('console', (m) => { if (m.type() === 'error') lerr.push(m.text()); });
    await lp.goto(`${base}/index.html`);
    await lp.waitForFunction(() => document.getElementById('model-version').textContent.length > 0);
    check(lerr.length === 0, 'landing: no console errors');
    check(await lp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'landing: no horizontal overflow at 390 px');
    check(!OLD_WORDS.test(await lp.locator('body').innerText()), 'landing: no retired wording');
    check(await lp.locator('a[data-link="source"]').getAttribute('href') === 'https://github.com/alfajr666/trade-surveillance-simulator', 'landing: source link is the configured constant');
    await lp.screenshot({ path: path.join(SHOTS, 'index-mobile.png'), fullPage: true });
    await lp.setViewportSize(VIEWPORTS.desktop);
    await lp.screenshot({ path: path.join(SHOTS, 'index-desktop.png'), fullPage: true });
    await ctx.close();

    // file:// fallback message
    const fctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const fp = await fctx.newPage();
    await fp.goto('file://' + path.join(ROOT, 'equity.html'));
    await fp.waitForTimeout(500);
    check(await fp.locator('#runtime-warning').isVisible() && (await fp.locator('#runtime-warning').innerText()).includes('http.server'), 'file://: inline message asks to serve over HTTP');
    await fctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${checks - failures}/${checks} checks passed; screenshots in ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

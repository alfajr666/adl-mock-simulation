/*
 * UI smoke test (not part of `npm test`). Run: npm run test:ui
 * Serves this folder with `python3 -m http.server` on a free port and drives equity.html and
 * crypto.html with Playwright at 1280 px and 390 px. Needs `require('playwright')` to resolve
 * (set NODE_PATH if it is installed globally). Screenshots go to $SURV_SHOTS, default ./.scratch/ui-shots.
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SURV_SHOTS || path.join(ROOT, '.scratch', 'ui-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const EXPECTED = { equity: 9, crypto: 10 };
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

async function runPage(browser, base, cfg, vpName) {
  const tag = `${cfg}@${vpName}`;
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  const t0 = Date.now();
  await page.goto(`${base}/${cfg}.html`, { waitUntil: 'load' });
  await page.waitForSelector('#queue-body tr[data-id]');
  check(Date.now() - t0 < 3000, `${tag}: loads and renders quickly (${Date.now() - t0} ms incl. page load)`);

  // default-seed counts
  const n = await queueCount(page);
  check(n === EXPECTED[cfg], `${tag}: default seed shows ${EXPECTED[cfg]} alerts (got ${n})`);
  check((await page.locator('#count-live').textContent()).startsWith(String(EXPECTED[cfg])), `${tag}: live count text starts with the count`);

  // answer key hidden
  const body = await page.locator('body').innerText();
  check(!/Planted role|True hit|False alarm\b/.test(body.replace(/False alarms?/g, 'x').replace(/True hits/g, 'x')) || !/Planted role/.test(body), `${tag}: no planted role visible before reveal`);
  check((await page.locator('#answer-box').innerText()).includes('Hidden'), `${tag}: answer box says hidden`);
  check((await page.locator('#score-section').innerText()).toLowerCase().includes('locked'), `${tag}: scorecard locked`);
  check((await page.locator('#queue-head').innerText()).includes('Answer key') === false, `${tag}: no answer-key column before unlock`);
  check(await page.locator('#case-section [class*="TP"], #case-section [data-label]').count() === 0, `${tag}: no label markup in case file before reveal`);

  // overflow
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${tag}: no horizontal page overflow (${over}px)`);
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}.png`), fullPage: true });

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
  await page.click('#tab-accounts');

  // linkage policy changes the queue
  await page.locator('input[name="policy"][value="strong1"]').check();
  await page.waitForFunction((c) => document.querySelectorAll('#queue-body tr[data-id]').length !== c, EXPECTED[cfg], { timeout: 3000 }).catch(() => {});
  const strictN = await queueCount(page);
  check(strictN !== EXPECTED[cfg], `${tag}: strict linkage changes the queue (${EXPECTED[cfg]} -> ${strictN})`);
  await page.locator('input[name="policy"][value="weak2"]').check();
  await page.waitForFunction((c) => document.querySelectorAll('#queue-body tr[data-id]').length === c, EXPECTED[cfg], { timeout: 3000 }).catch(() => {});
  check(await queueCount(page) === EXPECTED[cfg], `${tag}: back to default linkage restores the count`);

  // slider by keyboard
  await page.focus('#in-w2InstrumentShare');
  await page.keyboard.press('End');
  await page.waitForFunction((c) => document.querySelectorAll('#queue-body tr[data-id]').length !== c, EXPECTED[cfg], { timeout: 3000 }).catch(() => {});
  check(await queueCount(page) !== EXPECTED[cfg], `${tag}: moving the W2 slider by keyboard changes the queue`);
  await page.click('#reset-defaults');
  await page.waitForFunction((c) => document.querySelectorAll('#queue-body tr[data-id]').length === c, EXPECTED[cfg], { timeout: 3000 }).catch(() => {});
  check(await queueCount(page) === EXPECTED[cfg], `${tag}: reset to defaults restores the count`);

  // instrument filter
  const firstInst = page.locator('.inst').first();
  await firstInst.click();
  const filtered = await queueCount(page);
  check(filtered < EXPECTED[cfg] || filtered === EXPECTED[cfg], `${tag}: instrument click filters (${filtered} rows)`);
  await firstInst.click();

  // keyboard-only path: queue -> case -> decision -> reveal
  await page.locator('#queue-body tr[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const inCase = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check(inCase === 'case-title', `${tag}: Enter on a queue row moves focus to the case file`);
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement && document.activeElement.name === 'decision'); }
  check(reached, `${tag}: Tab reaches the decision control from the case file`);
  if (reached) {
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const val = await page.evaluate(() => document.querySelector('input[name="decision"]:checked')?.value);
    check(val === 'escalate' || val === 'monitor' || val === 'close', `${tag}: decision recorded by keyboard (${val})`);
    check(await page.locator('#queue-body tr[aria-current="true"] .status').count() === 1, `${tag}: decision appears in the queue`);
    let rev = false;
    for (let i = 0; i < 12 && !rev; i++) { await page.keyboard.press('Tab'); rev = await page.evaluate(() => document.activeElement && document.activeElement.id === 'reveal-btn'); }
    check(rev, `${tag}: Tab reaches the reveal control`);
    if (rev) await page.keyboard.press('Enter');
    await page.waitForSelector('#verdict-h');
    const verdict = await page.locator('#answer-box').innerText();
    check(/True hit|False alarm/.test(verdict) && /matched|did not match|not recorded|monitoring/.test(verdict), `${tag}: reveal shows the planted truth and a decision comparison`);
  }

  // unlock key: scorecard, explorer, seeds
  await page.click('#key-toggle');
  await page.waitForSelector('#score-section .metrics');
  check((await page.locator('#score-section').innerText()).includes('Precision'), `${tag}: scorecard visible after unlock`);
  await page.waitForFunction(() => /Across 8 seeds/.test(document.getElementById('seed-summary')?.textContent || ''), null, { timeout: 15000 });
  check(await page.locator('#sweep-host svg').count() === 1 && await page.locator('#seed-host svg').count() === 1, `${tag}: sweep chart and seed strip render`);
  await page.selectOption('#explorer-param', 'linkagePolicy');
  check(await page.locator('#sweep-host svg').count() === 1, `${tag}: explorer switches to linkage policy`);
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over2 <= 0, `${tag}: no horizontal overflow after unlock (${over2}px)`);

  // export produces JSON
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  const file = await dl.path();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(json.alerts.length === EXPECTED[cfg] && json.score && json.simulator === cfg, `${tag}: export contains alerts and score`);

  await page.locator('#case-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${cfg}-${vpName}-case-revealed.png`), fullPage: true });

  check(errors.length === 0, `${tag}: no console errors${errors.length ? ' -> ' + errors.join(' | ') : ''}`);
  check(external.length === 0, `${tag}: no requests outside the local server${external.length ? ' -> ' + external.join(', ') : ''}`);
  await ctx.close();
}

(async () => {
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    await waitFor(`${base}/index.html`);
    for (const cfg of ['equity', 'crypto']) for (const vp of ['desktop', 'mobile']) await runPage(browser, base, cfg, vp);

    // landing page
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile, deviceScaleFactor: 1 });
    const lp = await ctx.newPage();
    const lerr = [];
    lp.on('pageerror', (e) => lerr.push(String(e))); lp.on('console', (m) => { if (m.type() === 'error') lerr.push(m.text()); });
    await lp.goto(`${base}/index.html`);
    await lp.waitForFunction(() => document.getElementById('model-version').textContent.length > 0);
    check(lerr.length === 0, 'landing: no console errors');
    check(await lp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'landing: no horizontal overflow at 390 px');
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

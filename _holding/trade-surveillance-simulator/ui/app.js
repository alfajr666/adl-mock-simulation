// Shared simulator UI. Each simulator page is a thin shell that calls startApp('equity' | 'crypto').
import { runScenario, sweep, seedStudy, caseView, MODEL_VERSION, DEFAULTS, LINKAGE_POLICIES } from '../engine/index.js';
import { esc, int, dec1, dec2, pct, makeTimeFormat, price as fmtPrice, money as fmtMoney, moneySigned, download } from './format.js';
import { TEXT, RULES, PATTERN_RULE_IDS, RULE_INFO, LABELS, DECISIONS, PARAMS, THRESHOLD_LABELS, METRICS, CAUSES, EPISODE_TEXT, HONESTY, methodRules, METHOD_GENERAL } from './text.js';
import { marker, tapeBars, tapeSpark, priceVolume, clusterChart, linkGraph, lineChart, distStrips, attachHover, binOf, COLORS } from './charts.js';
import { CASE_STUDY_URL, SOURCE_URL, HOME_URL } from './links.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const STUDY_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const MAX_NODES = 12, ACCOUNT_ROWS = 12, EDGE_ROWS = 14;
const POLICY_SHORT = { strong1: 'Strict', weak2: 'Default', weak1: 'Loose' };
const POLICY_RULE = { strong1: 'Counts one shared strong attribute.', weak2: 'Counts one strong attribute, or two weak ones.', weak1: 'Counts any shared attribute.' };
const POLICY_ORDER = ['strong1', 'weak2', 'weak1'];
const KEY_METRIC = { W1: 'w1MinCount', W2: 'w2InstrumentShare', P1: 'p1MoveScore', P2: 'p2RampShare' };
const TEXT_MAP = { warmup: 'warm-up (first bins of the session)', trailing: 'trailing (bins just before the window)', instrument: 'per instrument', global: 'one market-wide baseline', up: 'rising', down: 'falling' };
const TABS = [['accounts', 'Accounts and links'], ['trades', 'Supporting trades'], ['cluster', 'Position and P&L']];
const $ = (id) => document.getElementById(id);
const icon = (shape) => `<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">${marker(shape, 7, 7, 4)}</svg>`;
const compact = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export function startApp(configId) {
  const T = TEXT[configId];
  const root = $('app');
  const defs = DEFAULTS.thresholds[configId];

  const state = {
    seed: DEFAULTS.seed, thresholds: {}, policy: DEFAULTS.linkagePolicy, instFilter: null,
    sort: { key: 'time', dir: 1 }, selected: null, tab: 'accounts', tradeShown: 25, clusterId: null, acctShown: ACCOUNT_ROWS, edgesShown: EDGE_ROWS,
    decisions: new Map(), revealed: new Set(), unlocked: false, explorerParam: 'w2InstrumentShare',
  };
  let result, tf, bars, barsSeed = null, lastCaseKey = '', raf = 0, explorerTimer = 0, seedToken = 0, seedRows = [], seedDone = false, sweepCache = new Map(), lastWidth = 0;

  const sliderKeys = new Set(PARAMS.map((p) => p.key));
  const isChanged = (k) => state.thresholds[k] !== undefined && state.thresholds[k] !== defs[k];
  const th = (k) => (state.thresholds[k] !== undefined ? state.thresholds[k] : defs[k]);
  const wOf = (el, fallback = 600) => Math.max(280, Math.floor(el?.clientWidth || fallback));
  const instById = (id) => result.market.instruments.find((d) => d.id === id);

  /* ------------------------------------------------------------ compute */
  function compute() {
    result = runScenario(configId, { seed: state.seed, thresholds: state.thresholds, linkagePolicy: state.policy });
    if (!tf) tf = makeTimeFormat(result.market);
    if (barsSeed !== state.seed) { bars = tapeBars(result); barsSeed = state.seed; }
  }

  /* ------------------------------------------------------------ shell */
  function buildShell() {
    const other = configId === 'equity' ? ['crypto.html', 'Crypto spot venue'] : ['equity.html', 'Equity board'];
    root.innerHTML = `
    <a class="skip" href="#queue-section">Skip to the alert queue</a>
    <div class="shell">
      <header class="topline">
        <div>
          <nav class="topnav" aria-label="Simulators"><a class="badge" href="index.html">All simulators</a><a class="badge" href="${other[0]}">${esc(other[1])}</a></nav>
          <div class="eyebrow">${esc(T.kicker)} / trade surveillance</div>
          <h1>${esc(T.heading)}</h1>
          <p class="dek">${esc(T.scope)}</p>
        </div>
        <div class="badge" id="model-badge">Synthetic data, planted episodes</div>
      </header>
      <div class="notice">
        <div><strong>Model boundary.</strong> Alerts are leads, not findings. Every account, price and trade here is generated; the planted episodes are put there on purpose so you can check your judgement afterwards. ${esc(T.sessionNote)}</div>
        <div class="acts"><a class="button ghost" href="${esc(CASE_STUDY_URL)}" target="_blank" rel="noreferrer">Case study</a><a class="button ghost" href="${esc(SOURCE_URL)}" target="_blank" rel="noreferrer">Source</a></div>
      </div>
      <main id="main">
        <section aria-labelledby="start-h" class="panel" style="margin-top:0">
          <div class="panel-head"><h2 id="start-h">Run settings</h2><span class="tag" id="run-tag"></span></div>
          <div class="panel-body">
            <div class="intro-grid">
              <div>
                <div class="head-controls">
                  <label class="field" for="seed-select">Seed (which synthetic market)
                    <select id="seed-select">${SEEDS.map((s) => `<option value="${s}">Seed ${s}${s === DEFAULTS.seed ? ' · default' : ''}</option>`).join('')}</select>
                  </label>
                  <button class="button" id="reset-all" type="button">Reset everything</button>
                  <button class="button" id="key-toggle" type="button" aria-pressed="false" aria-describedby="key-hint">Show answer key</button>
                </div>
                <p class="muted" id="key-hint" style="margin-top:10px;font-size:.84rem">The answer key unlocks the scorecard and trade-off explorer. Each alert also has its own “Reveal what was planted” control in its case file, which you can use first.</p>
              </div>
              <div>
                <h3 style="margin-bottom:8px;font-size:.95rem">A way through</h3>
                <ol class="walk">
                  <li>Scan the <a href="#tape-h">tape</a>: what is busy, what moved?</li>
                  <li>Open an alert in the <a href="#queue-section">queue</a> and read it as a lead.</li>
                  <li>In the <a href="#case-section">case file</a>, check who the accounts are and how they are linked.</li>
                  <li>Record a decision, then reveal what was planted.</li>
                  <li>Change linkage or a threshold in the <a href="#controls-h">controls</a> and watch the queue move.</li>
                </ol>
              </div>
            </div>
            <p class="units"><strong>Units.</strong> ${esc(T.units)} ${esc(T.timeHelp)}</p>
          </div>
        </section>

        <section aria-labelledby="tape-h" class="panel">
          <div class="panel-head"><h2 id="tape-h">Market tape</h2><span class="tag">Select an instrument to filter the queue</span></div>
          <div class="panel-body">
            <div id="tape" class="tape-grid"></div>
            <div class="legend-row" aria-label="Chart key"><span><svg viewBox="0 0 22 10" style="width:22px"><path d="M1 8 L8 3 L14 6 L21 1" fill="none" stroke="${COLORS.blue}" stroke-width="2"/></svg>price (display units)</span><span><svg viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="10" fill="#6c7a8c"/></svg>traded quantity per bin</span>
              ${RULES.map((r) => `<span>${icon(RULE_INFO[r].shape)}${r} ${esc(RULE_INFO[r].full[0] + RULE_INFO[r].full.slice(1).toLowerCase())}</span>`).join('')}</div>
            <p class="muted" style="font-size:.8rem;margin-top:8px">Shapes along the top of each chart mark where an alert window starts. ${esc(T.timeHelp)}</p>
          </div>
        </section>

        <section aria-labelledby="controls-h" class="panel">
          <div class="panel-head"><h2 id="controls-h">Controls</h2><button class="button small" id="reset-defaults" type="button">Reset to defaults</button></div>
          <div class="panel-body"><div class="controls-grid" id="controls"></div></div>
        </section>

        <section aria-labelledby="queue-h" class="panel" id="queue-section">
          <div class="panel-head"><h2 id="queue-h">Alert queue</h2><p class="count-live" id="count-live" role="status" aria-live="polite" aria-atomic="true"></p></div>
          <div id="queue-filter" class="panel-body" style="padding-bottom:0" hidden></div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="Alert queue table (scrolls sideways on narrow screens)"><table class="queue" id="queue-table" aria-describedby="queue-help">
            <thead><tr id="queue-head"></tr></thead><tbody id="queue-body"></tbody></table></div>
          <p class="muted" id="queue-help" style="padding:12px 18px;font-size:.8rem">Use the up and down arrow keys to move between alerts. Press Enter to jump to the case file. Sort with the column headings. W1 self-match alerts are a hygiene rule: they stay in the queue but are reported apart from the scorecard.</p>
        </section>

        <section aria-labelledby="case-title" class="panel" id="case-section"></section>

        <section aria-labelledby="score-h" class="panel" id="score-section"></section>
        <section aria-labelledby="explore-h" class="panel" id="explore-section"></section>

        <details class="panel" id="method">
          <summary>Methodology and limits</summary>
          <div class="panel-body" id="method-body"></div>
        </details>

        <section aria-labelledby="export-h" class="panel">
          <div class="panel-head"><h2 id="export-h">Export</h2></div>
          <div class="panel-body">
            <p class="muted">Download this run as readable JSON: settings, every alert with its metrics, your decisions and, if the answer key is unlocked, the group-level score and the hygiene summary. Planted truth for an individual alert is included only if you revealed it.</p>
            <button class="button primary" id="export-btn" type="button">Download run as JSON</button>
          </div>
        </section>
      </main>
      <footer class="fineprint">Independent educational simulation · engine model ${esc(MODEL_VERSION)} · synthetic accounts and prices; instruments and tokens are fictional · <a href="${esc(HOME_URL)}" target="_blank" rel="noreferrer">Delomite</a></footer>
    </div>`;
  }

  /* ------------------------------------------------------------ controls */
  function sliderText(p, v) {
    if (p.kind === 'share') return `${Math.round(v * 100)}%`;
    if (p.kind === 'mult') return `${dec2(v)}×`;
    if (p.kind === 'bps') return `${int(v)} bps`;
    if (p.kind === 'ratio') return dec2(v);
    if (p.kind === 'int') return int(v);
    return dec1(v);
  }

  function buildControls() {
    const schema = result.register.schema;
    const strong = schema.filter((s) => s.strength === 'strong'), weak = schema.filter((s) => s.strength === 'weak');
    const names = (list) => list.map((s) => esc(T.attrs[s.key]?.short || s.label)).join(', ');
    $('controls').innerHTML = `
      <div>
        <fieldset class="policy"><legend class="field-label">Linkage policy</legend>
          ${POLICY_ORDER.map((id) => `<label class="opt"><input type="radio" name="policy" value="${id}" ${state.policy === id ? 'checked' : ''}><span><strong>${POLICY_SHORT[id]}</strong><small><em style="font-style:normal;color:var(--ink)">${esc(POLICY_RULE[id])}</em> ${esc(T.policyNotes[id])}</small></span></label>`).join('')}
        </fieldset>
        <p class="attr-lists" style="margin-top:12px"><b>Strong attributes here:</b> ${names(strong)}.<br><b>Weak attributes here:</b> ${names(weak)}.<br>${esc(T.lookFor)}</p>
        <details class="inner" style="margin-top:10px"><summary>Why each attribute is strong or weak</summary><div>
          <ul class="limits" style="margin-top:8px">${schema.map((a) => `<li><strong style="color:var(--ink)">${esc(a.label)}</strong> (${a.strength}). ${esc(a.rationale)} <em>Caveat: ${esc(a.caveat)}</em></li>`).join('')}</ul></div></details>
      </div>
      <div>
        <div class="sliders">${PARAMS.map((p) => `
          <div class="slider" id="sl-${p.key}">
            <div class="row"><label class="nm" for="in-${p.key}"><span class="rule-tag">${p.rule}</span>${esc(p.label)}</label><output id="out-${p.key}" for="in-${p.key}"></output></div>
            <input type="range" id="in-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" aria-describedby="help-${p.key}">
            <div class="meta"><span>${sliderText(p, p.min)}</span><span id="def-${p.key}">default ${sliderText(p, defs[p.key])}</span><span>${sliderText(p, p.max)}</span></div>
            <div class="help" id="help-${p.key}">${esc(p.help)}</div>
          </div>`).join('')}
        </div>
        <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:18px">
          <div><span class="field-label" id="p1mode-l">P1 baseline scope</span>
            <div class="seg" role="radiogroup" aria-labelledby="p1mode-l" style="margin-top:6px">
              <label><input type="radio" name="p1mode" value="instrument"> Per instrument</label>
              <label><input type="radio" name="p1mode" value="global"> One market-wide</label>
            </div></div>
          <div><span class="field-label" id="p1base-l">P1 baseline period</span>
            <div class="seg" role="radiogroup" aria-labelledby="p1base-l" style="margin-top:6px">
              <label><input type="radio" name="p1base" value="warmup"> Warm-up (first bins)</label>
              <label><input type="radio" name="p1base" value="trailing"> Trailing (bins before)</label>
            </div></div>
        </div>
        <p class="help muted" style="font-size:.78rem;margin-top:8px">Per-instrument compares each name with its own calm history; a market-wide baseline is simpler but treats a naturally volatile name as unusual. A warm-up baseline is clean by construction here because no planted activity touches it. Trailing re-measures before every window. Lengthen the baseline until it spans an episode and the price rule can lose it.</p>
      </div>`;
    syncControls();
  }

  function syncControls() {
    for (const p of PARAMS) {
      const v = th(p.key), input = $(`in-${p.key}`);
      input.value = v;
      input.setAttribute('aria-valuetext', sliderText(p, v));
      $(`out-${p.key}`).textContent = sliderText(p, v);
      $(`sl-${p.key}`).classList.toggle('changed', isChanged(p.key));
    }
    for (const r of document.querySelectorAll('input[name="policy"]')) r.checked = r.value === state.policy;
    for (const r of document.querySelectorAll('input[name="p1mode"]')) r.checked = r.value === th('p1Mode');
    for (const r of document.querySelectorAll('input[name="p1base"]')) r.checked = r.value === th('p1Baseline');
  }

  /* ------------------------------------------------------------ tape */
  function renderTape() {
    const host = $('tape');
    const W = host.clientWidth || 900, gap = 10;
    const cols = Math.max(1, Math.floor((W + gap) / (205 + gap)));
    const w = Math.max(170, Math.floor((W - gap * (cols - 1)) / cols) - 22);
    host.innerHTML = result.market.instruments.map((d) => {
      const al = result.alerts.filter((a) => a.instrument === d.id);
      const b = bars[d.id];
      const counts = RULES.map((r) => [r, al.filter((a) => a.rule === r).length]).filter((x) => x[1]);
      return `<button type="button" class="inst" data-inst="${esc(d.id)}" aria-pressed="${state.instFilter === d.id}">
        <div class="nm"><strong>${esc(d.id)}</strong><small>${al.length} alert${al.length === 1 ? '' : 's'}</small></div>
        <div class="fname">${esc(d.name)}</div>
        ${tapeSpark({ result, bars, inst: d.id, alerts: al, tf, w })}
        <div class="stats"><span>${int(b.trades)} trades</span><span>value ${compact(b.notional * d.tickSize)}</span><span>peak bin ${int(Math.max(...b.qty))} ${esc(T.qty)}</span></div>
        <div class="tags">${counts.length ? counts.map(([r, c]) => `<span class="chip" title="${esc(RULE_INFO[r].full)}">${icon(RULE_INFO[r].shape)}${r} ×${c}</span>`).join('') : '<span class="faint" style="font-size:.74rem">no alerts</span>'}</div>
      </button>`;
    }).join('');
  }

  /* ------------------------------------------------------------ queue */
  function keyMetric(a) {
    const k = KEY_METRIC[a.rule], c = a.thresholdsCrossed[k];
    if (!c) return { text: '–', ratio: 0 };
    const f = (v) => (a.rule === 'W2' || a.rule === 'P2' ? pct(v) : a.rule === 'P1' ? dec1(v) : int(v));
    const text = a.rule === 'P1' ? `move score ${f(c.value)} (min ${f(c.threshold)})` : `${f(c.value)} ${{ W1: 'self-matches', W2: 'of instrument volume', P2: 'of aggressive buying' }[a.rule]} (min ${f(c.threshold)})`;
    return { text, ratio: c.threshold ? c.value / c.threshold : c.value };
  }

  function accountsText(a) {
    if (a.rule === 'P1') return 'none (price only)';
    if (a.cluster) return `${a.cluster.accounts.length} in ${a.cluster.id}`;
    return `${a.accounts.length} (${a.accounts.join(', ')})`;
  }
  function sortedAlerts() {
    let list = result.alerts.filter((a) => !state.instFilter || a.instrument === state.instFilter);
    const { key, dir } = state.sort;
    const val = {
      rule: (a) => RULES.indexOf(a.rule), inst: (a) => a.instrument, time: (a) => a.window.startMs,
      accounts: (a) => (a.cluster ? a.cluster.accounts.length : a.accounts.length), metric: (a) => keyMetric(a).ratio,
    }[key];
    list = [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return c * dir || a.window.startMs - b.window.startMs || (a.id < b.id ? -1 : 1);
    });
    return list;
  }
  const COLS = [['rule', 'Rule'], ['inst', 'Instrument'], ['time', 'Window (session time)'], ['accounts', 'Accounts'], ['metric', 'Key metric vs threshold']];
  function renderQueue() {
    const list = sortedAlerts();
    const unlockedCol = state.unlocked;
    $('queue-head').innerHTML = COLS.map(([k, label]) => `<th scope="col" aria-sort="${state.sort.key === k ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k}">${esc(label)}<span aria-hidden="true">${state.sort.key === k ? (state.sort.dir === 1 ? '▲' : '▼') : ''}</span></button></th>`).join('') + `<th scope="col">Your decision</th>${unlockedCol ? '<th scope="col">Answer key</th>' : ''}`;
    const focusInBody = $('queue-body').contains(document.activeElement);
    $('queue-body').innerHTML = list.length ? list.map((a) => {
      const d = state.decisions.get(a.id);
      const lab = unlockedCol ? result.score.labels[a.id]?.label : null;
      const km = keyMetric(a);
      return `<tr data-id="${esc(a.id)}" tabindex="${a.id === state.selected ? 0 : -1}" aria-current="${a.id === state.selected}">
        <td><span class="rulecell" title="${esc(RULE_INFO[a.rule].full)}">${icon(RULE_INFO[a.rule].shape)}<strong>${a.rule}</strong><span class="muted">${esc(RULE_INFO[a.rule].hygiene ? 'Self-match' : RULE_INFO[a.rule].name)}</span>${RULE_INFO[a.rule].hygiene ? '<span class="hyg">hygiene rule</span>' : ''}</span></td>
        <td>${esc(a.instrument)}</td><td>${esc(tf.range(a.window.startMs, a.window.endMs))}</td>
        <td>${esc(accountsText(a))}</td><td>${esc(km.text)}</td>
        <td>${d ? `<span class="status ${d}">${esc(DECISIONS[d].label)}</span>` : '<span class="faint">not decided</span>'}</td>
        ${unlockedCol ? `<td><span class="status ${lab}">${esc(LABELS[lab]?.short || '')}</span></td>` : ''}</tr>`;
    }).join('') : `<tr><td colspan="${unlockedCol ? 7 : 6}" class="empty">No alerts at these settings${state.instFilter ? ` for ${esc(state.instFilter)}` : ''}. That is what a very strict threshold looks like: quiet, and unable to say what it missed.</td></tr>`;
    // tabindex: make sure at least one row is tabbable
    const rows = [...$('queue-body').querySelectorAll('tr[data-id]')];
    if (rows.length && !rows.some((r) => r.tabIndex === 0)) rows[0].tabIndex = 0;
    if (focusInBody) (rows.find((r) => r.dataset.id === state.selected) || rows[0])?.focus();
    const filt = $('queue-filter');
    filt.hidden = !state.instFilter;
    filt.innerHTML = state.instFilter ? `<p class="muted" style="font-size:.88rem">Showing ${esc(state.instFilter)} only. <button class="button small" id="clear-filter" type="button">Show all instruments</button></p>` : '';
    $('count-live').textContent = `${result.alerts.length} alert${result.alerts.length === 1 ? '' : 's'}${state.instFilter ? `, ${list.length} for ${state.instFilter}` : ''}`;
  }
  function selectAlert(id, { open = false } = {}) {
    state.selected = id; state.tradeShown = 25; state.clusterId = null; state.acctShown = ACCOUNT_ROWS; state.edgesShown = EDGE_ROWS;
    renderQueue(); renderCase(true);
    if (open) {
      const h = $('case-title');
      if (h) { h.focus({ preventScroll: true }); h.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    }
  }
  function ensureSelection() {
    const all = result.alerts;
    const vis = sortedAlerts();
    if (!all.some((a) => a.id === state.selected) || (state.instFilter && !vis.some((a) => a.id === state.selected))) state.selected = vis[0]?.id ?? null;
  }

  /* ------------------------------------------------------------ case file */
  function fmtMetric(key, v, def) {
    const kind = (METRICS[key] || [])[1];
    switch (kind) {
      case 'int': return int(v);
      case 'qty': return `${int(v)} ${T.qty}`;
      case 'money': return fmtMoney(v, def.tickSize);
      case 'moneySigned': return moneySigned(v, def.tickSize);
      case 'pct': return pct(v, 1);
      case 'pct2': return `${(v * 100).toFixed(2)}%`;
      case 'ratio': return dec2(v);
      case 'bps': return `${int(v)} bps`;
      case 'bpsSigned': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${int(Math.abs(v))} bps`;
      case 'x': return dec1(v);
      case 'mult': return `${dec1(v)}×`;
      case 'bins': return `${v} bins`;
      case 'time': return tf.time(v);
      case 'price': return fmtPrice(v, def.tickSize);
      case 'window': return tf.range(v.startMs, v.endMs);
      case 'binrange': { const b = result.market.bins; return `bins ${v.start}–${v.end} (${tf.range(b[v.start].t0, b[v.end].t1)})`; }
      default: return typeof v === 'object' ? JSON.stringify(v) : (TEXT_MAP[v] || String(v));
    }
  }

  function fmtThr(key, v) {
    if (['w2ClusterShare', 'w2InstrumentShare', 'p2RampShare'].includes(key)) return pct(v, 0);
    if (key === 'w2NetRatio' || key === 'p2NetSellRatio') return dec2(v);
    if (key === 'p1VolMult') return `${dec2(v)}×`;
    if (key === 'p1MinReturnBps') return `${int(v)} bps`;
    if (key === 'p1MoveScore') return dec1(v);
    return int(v);
  }

  function metricsHtml(a, def) {
    const rows = Object.entries(a.metrics).filter(([k]) => k !== 'p1AlertId');
    const crossed = Object.entries(a.thresholdsCrossed);
    let callout = '';
    if (a.rule === 'P1') callout = `<p class="muted" style="font-size:.82rem">Baseline used: ${esc(fmtMetric('baselineBins', a.metrics.baselineBins, def))}; ${esc(TEXT_MAP[a.metrics.baselineSource] || a.metrics.baselineSource)}, ${esc(TEXT_MAP[a.metrics.baselineMode] || a.metrics.baselineMode)}. The move was ${esc(fmtMetric('returnBps', a.metrics.returnBps, def))}, ${esc(TEXT_MAP[a.metrics.direction])}. The dotted band on the chart marks the baseline.</p>`;
    if (a.rule === 'P2') callout = `<p class="muted" style="font-size:.82rem">Before the move (${esc(fmtMetric('lookbackWindow', a.metrics.lookbackWindow, def))}) the group’s net buying was ${esc(fmtMetric('accumulationNetQty', a.metrics.accumulationNetQty, def))}, and buying made up ${esc(fmtMetric('accumulationBuyShareOfVolume', a.metrics.accumulationBuyShareOfVolume, def))} of the volume it traded.</p>`;
    return `<div class="sub"><h3>Metrics and thresholds</h3>${callout}
      <div class="table-wrap" tabindex="0" role="region" aria-label="Thresholds crossed"><table class="thr"><thead><tr><th scope="col">Test</th><th scope="col">Value</th><th scope="col">Limit</th><th scope="col"><span class="sr-only">Value against limit</span></th></tr></thead><tbody>
      ${crossed.map(([k, c]) => {
        const upper = k === 'w2NetRatio';
        const scale = Math.max(c.value, c.threshold) * 1.25 || 1;
        return `<tr><td class="wrap">${esc(THRESHOLD_LABELS[k] || k)}</td><td>${esc(fmtThr(k, c.value))}</td><td>${upper ? 'at most ' : 'at least '}${esc(fmtThr(k, c.threshold))}</td><td><div class="bullet" aria-hidden="true"><i style="width:${Math.min(100, (c.value / scale) * 100)}%"></i><b style="left:${(c.threshold / scale) * 100}%"></b></div></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted" style="font-size:.78rem">The tick on each bar is the limit. Crossing every test is what raised the alert; it does not say why the activity happened.</p>
      <details class="inner"><summary>All metrics for this alert</summary><div><dl class="kv" style="margin-top:8px">${rows.map(([k, v]) => `<dt>${esc((METRICS[k] || [k])[0])}</dt><dd>${esc(fmtMetric(k, v, def))}</dd>`).join('')}</dl></div></details></div>`;
  }

  let cvCache = { key: '', cv: null };
  function currentCv() {
    const a = result.alerts.find((x) => x.id === state.selected);
    if (!a) return null;
    const key = `${state.seed}|${state.policy}|${JSON.stringify(state.thresholds)}|${a.id}`;
    if (cvCache.key !== key) cvCache = { key, cv: caseView(result, a.id) };
    return cvCache.cv;
  }

  function renderCase(force = false) {
    const sec = $('case-section');
    const cv = currentCv();
    if (!cv) {
      lastCaseKey = '';
      sec.innerHTML = `<div class="panel-head"><h2 id="case-title" tabindex="-1">Case file</h2></div><div class="empty">No alert is selected. Raise or lower a threshold, or clear the instrument filter, to get a lead to open.</div>`;
      return;
    }
    const w = wOf(sec, 800);
    const key = `${cvCache.key}|${state.tab}|${state.tradeShown}|${state.clusterId}|${state.acctShown}|${state.edgesShown}|${state.revealed.has(state.selected)}|${Math.round(w / 40)}`;
    if (!force && key === lastCaseKey) return;
    lastCaseKey = key;
    const a = cv.alert, def = cv.instrument;
    const kv = { ...cv, qtyUnit: T.qty };
    sec.innerHTML = `
      <div class="panel-head case-head">
        <div><div class="case-title">${icon(RULE_INFO[a.rule].shape)}<h2 id="case-title" tabindex="-1">Case file: ${a.rule} · ${esc(a.instrument)}</h2></div>
          <p class="muted" style="margin-top:6px;font-size:.88rem">${esc(RULE_INFO[a.rule].full)}. ${esc(RULE_INFO[a.rule].blurb)} Window <span class="mono">${esc(tf.range(a.window.startMs, a.window.endMs))}</span>. ${esc(def.name)}.</p></div>
      </div>
      <div class="panel-body"><div class="case-layout">
        <div>
          <div class="sub"><h3>Price and volume</h3><div class="chart-host" id="pv-host"></div>
            <p class="muted" style="font-size:.78rem">Line: close per bin. Faint ticks: low to high within the bin. Hatched band: the alert window. Move over the chart for details.</p></div>
          <div class="tabs" role="tablist" aria-label="Case file sections" id="tabs" style="margin-top:14px">${TABS.map(([id, label]) => `<button type="button" role="tab" class="tab" id="tab-${id}" aria-selected="${state.tab === id}" aria-controls="panel-${id}" tabindex="${state.tab === id ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>
          <div class="tabpanel" role="tabpanel" id="panel-${state.tab}" aria-labelledby="tab-${state.tab}" tabindex="0"></div>
        </div>
        <div class="side">
          ${metricsHtml(a, def)}
          <div class="sub" id="decision-box"></div>
          <div id="answer-box"></div>
          <div class="sub"><h3>Actions a venue could take on escalation</h3>
            <p class="muted" style="font-size:.8rem">Described generically. These are not any real venue’s rules, and none is taken in this simulator.</p>
            <ul class="actions-list">${T.actions.map(([n, d]) => `<li><strong>${esc(n)}</strong>${esc(d)}</li>`).join('')}</ul></div>
        </div>
      </div></div>`;
    // price / volume
    const pv = priceVolume({ cv: kv, result, tf, w: wOf($('pv-host'), w), baseline: a.rule === 'P1' ? a.metrics.baselineBins : null });
    $('pv-host').innerHTML = pv.svg + '<div class="tip" hidden></div>';
    attachHover($('pv-host'), pv.cols);
    renderTab(cv);
    renderDecision(a);
    renderAnswer();
  }

  /** Adds the other members of each shown account's linked group (current policy), so a lone self-trading account still shows its links. */
  /** Which accounts the case shows. Large groups (loose linkage can build 40+) are capped in the graph; the table pages through all of them. */
  function caseAccounts(cv) {
    const a = cv.alert;
    const act = (x) => Math.max(x.aggressiveBuyQty || 0, x.aggressiveSellQty || 0);
    let core = a.accounts.length ? cv.accounts.filter((x) => a.accounts.includes(x.acct)) : [...cv.accounts].filter((x) => act(x) > 0).sort((x, y) => act(y) - act(x)).slice(0, 10);
    if (!core.length) core = cv.accounts.slice(0, 10);
    const coreIds = new Set(core.map((x) => x.acct));
    const rest = cv.accounts.filter((x) => !coreIds.has(x.acct));
    const shown = new Set(cv.accounts.map((x) => x.acct));
    const extra = [];
    // A lone account (e.g. a self-match) still gets its linked group, so linkage is visible.
    if (a.rule !== 'P1') {
      for (const x of core) {
        const cl = result.linkage.clusters.find((c) => c.id === x.clusterId);
        if (!cl) continue;
        for (const m of cl.accounts) {
          if (shown.has(m) || extra.length >= 8) continue;
          shown.add(m);
          const row = result.register.rows.find((r) => r.acct === m);
          extra.push({ ...row, clusterId: result.linkage.clusterOf[m], finalPosition: (result.ledger.positions[m] || {})[a.instrument] || 0, aggressiveBuyQty: 0, aggressiveSellQty: 0, added: true });
        }
      }
    }
    let all = [...core, ...rest, ...extra];
    if (a.rule === 'P1') all.sort((x, y) => act(y) - act(x) || (x.acct < y.acct ? -1 : 1));
    const ids = new Set(all.map((x) => x.acct));
    const edgesAll = result.linkage.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    const deg = {};
    for (const e of edgesAll) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; }
    const ordered = [...all].sort((x, y) => (coreIds.has(y.acct) - coreIds.has(x.acct)) || ((deg[y.acct] || 0) - (deg[x.acct] || 0)) || (x.acct < y.acct ? -1 : 1));
    const nodes = ordered.slice(0, MAX_NODES), nodeIds = new Set(nodes.map((x) => x.acct));
    const edges = edgesAll.filter((e) => nodeIds.has(e.a) && nodeIds.has(e.b));
    const sortedEdges = [...edgesAll].sort((x, y) => (y.linked - x.linked) || (y.shared.some((q) => q.strength === 'strong') - x.shared.some((q) => q.strength === 'strong')) || (x.a < y.a ? -1 : 1));
    return { all, nodes, edges, edgesAll: sortedEdges, added: extra.length, hidden: all.length - nodes.length };
  }

  function renderTab(cv) {
    const panel = document.querySelector('.tabpanel');
    const def = cv.instrument;
    if (state.tab === 'accounts') {
      const schema = result.register.schema;
      const ext = caseAccounts(cv);
      const vals = {};
      for (const acc of ext.all) for (const s of schema) { const v = acc.attributes[s.key]; if (v) (vals[`${s.key}|${v}`] ||= []).push(acc.acct); }
      const revealed = state.revealed.has(cv.alert.id);
      const roles = revealed ? { ...(result.groundTruth.accountRoles || {}), ...(cv.groundTruth.accountRoles || {}) } : {};
      const attrShort = Object.fromEntries(schema.map((s) => [s.key, T.attrs[s.key]?.short || s.key]));
      const showFlows = cv.alert.rule === 'P1' || cv.alert.rule === 'P2';
      const g = linkGraph({ accounts: ext.nodes, edges: ext.edges, attrShort, w: wOf(panel, 560) - 32, showLabels: ext.edges.length <= 14 });
      const rows = ext.all.slice(0, state.acctShown), edgeRows = ext.edgesAll.slice(0, state.edgesShown);
      panel.innerHTML = `
        <p class="muted" style="font-size:.86rem">${esc(cv.accountsNote.charAt(0).toUpperCase() + cv.accountsNote.slice(1))}. Underlined values are shared with another account shown here.${ext.added ? ` Accounts marked + are not named by the alert; they appear because the ${esc(POLICY_SHORT[state.policy])} policy puts them in the same group as an account that is.` : ''}${showFlows ? ' Aggressive buys and sells are market-order quantities inside the alert window.' : ''}</p>
        <div class="sub"><h3>Account register (${ext.all.length} account${ext.all.length === 1 ? '' : 's'})</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Account register"><table><thead><tr><th scope="col">Account</th><th scope="col">Type</th>${schema.map((s) => `<th scope="col">${esc(s.label)} <span class="faint">(${s.strength})</span></th>`).join('')}<th scope="col">Group</th><th scope="col">Final position (${esc(T.qty)})</th>${showFlows ? `<th scope="col">Aggressive buys (${esc(T.qty)})</th><th scope="col">Aggressive sells (${esc(T.qty)})</th>` : ''}${revealed ? '<th scope="col">Planted role</th>' : ''}</tr></thead><tbody>
          ${rows.map((acc) => `<tr><th scope="row" class="mono" style="color:var(--ink);font-size:13px;text-transform:none;letter-spacing:0">${esc(acc.acct)}${acc.added ? '<span title="Not named by the alert; shown because it is in the same linked group"> +</span>' : ''}</th><td>${esc(acc.type)}</td>${schema.map((s) => { const v = acc.attributes[s.key]; return `<td>${(vals[`${s.key}|${v}`] || []).length > 1 ? `<u><strong>${esc(v)}</strong></u>` : esc(v ?? '–')}</td>`; }).join('')}<td>${esc(acc.clusterId)}</td><td>${int(acc.finalPosition)}</td>${showFlows ? `<td>${int(acc.aggressiveBuyQty || 0)}</td><td>${int(acc.aggressiveSellQty || 0)}</td>` : ''}${revealed ? `<td>${esc(roles[acc.acct] || 'none')}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>
        ${ext.all.length > rows.length ? `<div class="pager"><span>Showing ${rows.length} of ${ext.all.length}.</span><button class="button small" id="more-accts" type="button">Show ${Math.min(ACCOUNT_ROWS, ext.all.length - rows.length)} more</button></div>` : ''}</div>
        <div class="sub"><h3>Link graph</h3>
          <p class="muted" style="font-size:.8rem">Edges join accounts that share a register attribute. Thick solid line: strong attribute. Thin dashed line: weak attribute. Violet: counted as linked under the <strong>${esc(POLICY_SHORT[state.policy])}</strong> policy. Grey, marked “not counted”: shared, but the policy ignores it.</p>
          ${ext.hidden > 0 ? `<p class="note">The graph shows ${ext.nodes.length} of ${ext.all.length} accounts: the alert’s own accounts first, then the most-linked others. ${ext.hidden} more are in the register table and the evidence table, not drawn.${ext.edges.length > 14 ? ' Edge labels are left off because there are too many; the evidence table lists them.' : ''}</p>` : ''}
          <div class="chart-host">${g.svg}</div>
          <div class="legend-groups">${g.legendGroups.map((x) => `<span><i style="border-color:${x.color};${x.dash ? 'border-style:dotted' : ''}"></i>${x.grouped ? `Group ${esc(x.cid)}` : `Alone: ${esc(x.cid)}`} (${x.members.length > 6 ? `${x.members.slice(0, 6).map(esc).join(', ')} and ${x.members.length - 6} more drawn` : x.members.map(esc).join(', ')})</span>`).join('')}</div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="Link evidence"><table><thead><tr><th scope="col">Pair</th><th scope="col">Shared</th><th scope="col">Counted under ${esc(POLICY_SHORT[state.policy])}?</th></tr></thead><tbody>
            ${edgeRows.length ? edgeRows.map((e) => `<tr><td>${esc(e.a)} – ${esc(e.b)}</td><td>${e.shared.map((x) => `${esc(attrShort[x.key] || x.key)} (${x.strength})`).join(', ')}</td><td>${e.linked ? 'Yes, linked' : 'No, ignored'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">None of the accounts shown share a register attribute.</td></tr>'}
          </tbody></table></div>
          ${ext.edgesAll.length > edgeRows.length ? `<div class="pager"><span>Showing ${edgeRows.length} of ${ext.edgesAll.length} pairs (linked and strong first).</span><button class="button small" id="more-edges" type="button">Show ${Math.min(EDGE_ROWS, ext.edgesAll.length - edgeRows.length)} more</button></div>` : ''}</div>`;
    } else if (state.tab === 'trades') {
      const trs = cv.trades, shown = trs.slice(0, state.tradeShown);
      panel.innerHTML = `<div class="sub"><h3>Supporting trades</h3>
        <p class="muted" style="font-size:.82rem">Showing ${shown.length} of ${trs.length}. Prices in display units; value = price × quantity.</p>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Supporting trades"><table><thead><tr><th scope="col">Time</th><th scope="col">Aggressor</th><th scope="col">Buyer</th><th scope="col">Seller</th><th scope="col">Price</th><th scope="col">Qty (${esc(T.qty)})</th><th scope="col">Value</th><th scope="col">Note</th></tr></thead><tbody>
        ${shown.map((t) => `<tr><td>${esc(tf.time(t.t))}</td><td class="${t.aggressor === 'B' ? 'buy' : 'sell'}">${t.aggressor === 'B' ? 'Buyer' : 'Seller'}</td><td>${esc(t.buyAcct)}</td><td>${esc(t.sellAcct)}</td><td>${fmtPrice(t.price, def.tickSize)}</td><td>${int(t.qty)}</td><td>${fmtMoney(t.notional, def.tickSize)}</td><td>${t.selfTrade ? 'same account both sides' : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="pager">${trs.length > shown.length ? `<button class="button small" id="more-trades" type="button">Show ${Math.min(25, trs.length - shown.length)} more</button>` : ''}</div></div>`;
    } else {
      const cs = cv.clusterSeries;
      if (!cs.length) { panel.innerHTML = '<div class="sub"><p class="muted">No linked group is attached to this alert.</p></div>'; return; }
      const wanted = state.clusterId || a_cluster(cv, cs);
      const cur = cs.find((c) => c.clusterId === wanted) || cs[0];
      state.clusterId = cur.clusterId;
      const w = wOf(panel, 560) - 32;
      const pos = clusterChart({ points: cur.points, kind: 'position', tf, result, cv: { ...cv, qtyUnit: T.qty }, w });
      const pnl = clusterChart({ points: cur.points, kind: 'pnl', tf, result, cv: { ...cv, qtyUnit: T.qty }, w });
      const last = cur.points[cur.points.length - 1];
      panel.innerHTML = `<div class="sub"><h3>Group position and profit and loss</h3>
        ${cs.length > 1 ? `<label class="field" for="cluster-select">Group<select id="cluster-select">${cs.map((c) => `<option value="${esc(c.clusterId)}" ${c.clusterId === cur.clusterId ? 'selected' : ''}>${esc(c.clusterId)} (${c.accounts.length} account${c.accounts.length === 1 ? '' : 's'})</option>`).join('')}</select></label>` : `<p class="muted" style="font-size:.84rem">Group ${esc(cur.clusterId)}: ${cur.accounts.length > 8 ? `${cur.accounts.slice(0, 8).map(esc).join(', ')} and ${cur.accounts.length - 8} more` : cur.accounts.map(esc).join(', ')}.</p>`}
        <div class="chart-host" id="pos-host">${pos.svg}<div class="tip" hidden></div></div>
        <div class="chart-host" id="pnl-host">${pnl.svg}<div class="tip" hidden></div></div>
        <p class="muted" style="font-size:.8rem">At the end of the run the group holds ${int(last.position)} ${esc(T.qty)} with profit and loss of ${moneySigned(last.pnl, def.tickSize)} display units (cash plus holdings marked at the last bin’s close). A group that ends flat with little profit and loss looks different from one that sold into a rally.</p></div>`;
      attachHover($('pos-host'), pos.cols); attachHover($('pnl-host'), pnl.cols);
    }
  }

  const a_cluster = (cv, cs) => (cv.alert.cluster && cs.some((c) => c.clusterId === cv.alert.cluster.id) ? cv.alert.cluster.id : [...cs].sort((x, y) => y.accounts.length - x.accounts.length)[0].clusterId);

  function renderDecision(a) {
    const cur = state.decisions.get(a.id) || '';
    $('decision-box').innerHTML = `<fieldset class="decision"><legend>Your decision on this lead</legend>
      ${Object.entries(DECISIONS).map(([id, d]) => `<label class="opt"><input type="radio" name="decision" value="${id}" ${cur === id ? 'checked' : ''}><span><strong>${esc(d.label)}</strong><small>${esc(d.hint)}</small></span></label>`).join('')}
      </fieldset><div><button class="button small" id="clear-decision" type="button" ${cur ? '' : 'disabled'}>Clear decision</button></div>`;
  }

  /** The simulator's simplification: which decision "fits" each label. */
  function fitting(label, cause) {
    if (label === 'MATCH') return 'escalate';
    if (label === 'SELF_MATCH' && cause === 'planted-account') return 'escalate';
    return 'close';
  }
  function matchText(label, cause, d) {
    if (!d) return 'You have not recorded a decision for this alert. Pick one above and this line will compare it with the key.';
    if (d === 'monitor') return 'You chose to keep monitoring: neither closed nor escalated. A real desk has to settle most leads one way or the other eventually.';
    const fit = fitting(label, cause);
    return d === fit ? `Your decision fits: ${DECISIONS[fit].label} is the fitting decision for this label.` : `Your decision does not fit: the simulator treats ${DECISIONS[fit].label} as the fitting decision for this label.`;
  }

  function renderAnswer() {
    const box = $('answer-box');
    const cv = currentCv();
    if (!box || !cv) return;
    const id = cv.alert.id;
    if (!state.revealed.has(id)) {
      box.innerHTML = `<div class="answer"><h3>Answer key</h3><p class="muted" style="font-size:.84rem" id="reveal-hint">Hidden. Make your decision first; nothing about this alert’s planted truth is shown until you ask.</p><button class="button" id="reveal-btn" type="button" aria-describedby="reveal-hint">Reveal what was planted</button></div>`;
      return;
    }
    const gt = cv.groundTruth;
    const label = gt.label;
    let what;
    if (label === 'MATCH') what = `This alert overlaps ${EPISODE_TEXT[gt.episodes[0]?.type] || 'a planted episode'}.`;
    else if (label === 'EXPLAINABLE') what = CAUSES['same-owner-cross'];
    else if (label === 'SELF_MATCH') what = `${CAUSES[gt.cause] || 'A self-match.'} This is a hygiene rule, so it sits outside the scorecard.`;
    else what = `No planted episode is involved. ${CAUSES[gt.cause] || 'No planted cause.'}`;
    const roles = Object.entries(gt.accountRoles || {});
    box.innerHTML = `<div class="answer"><h3 id="verdict-h" tabindex="-1">Answer key for this alert</h3>
      <p class="verdict"><strong>${esc(LABELS[label]?.long || label)}.</strong> ${esc(what)}</p>
      <p class="verdict">${esc(matchText(label, gt.cause, state.decisions.get(id)))}</p>
      <p class="muted" style="font-size:.78rem">The mapping from label to fitting decision (match → escalate; explainable or unrelated → close) is the simulator’s simplification. A real desk would document an explainable alert and might still escalate it.</p>
      ${roles.length ? `<p class="muted" style="font-size:.8rem">Planted roles of the accounts shown (also in the account table): ${roles.slice(0, 12).map(([a, r]) => `${esc(a)}: ${esc(r)}`).join('; ')}${roles.length > 12 ? ` and ${roles.length - 12} more` : ''}.</p>` : ''}
      </div>`;
  }

  /* ------------------------------------------------------------ scorecard */
  const honestyHtml = () => `<div class="sub" id="honesty"><h3>What these figures can and cannot tell you</h3><ul class="limits" style="margin-top:8px">${HONESTY.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>`;
  function renderScore() {
    const sec = $('score-section');
    if (!state.unlocked) {
      sec.classList.add('locked');
      sec.innerHTML = `<div class="panel-head"><h2 id="score-h">Scorecard</h2><span class="tag">Locked</span></div><div class="panel-body"><p>The scorecard compares every alert group with what was planted, so it stays locked until you show the answer key. Decide on a few alerts first.</p></div>`;
      return;
    }
    sec.classList.remove('locked');
    const s = result.score, o = s.overall, sm = s.selfMatch;
    const missedEp = s.byEpisode.filter((e) => e.missed);
    const decided = result.alerts.filter((a) => state.decisions.has(a.id));
    const fits = decided.filter((a) => { const d = state.decisions.get(a.id), l = s.labels[a.id]; return d !== 'monitor' && d === fitting(l?.label, l?.cause); });
    const tile = (l, v, sub) => `<div class="metric"><div class="label">${l}</div><div class="value">${v}</div>${sub ? `<div class="faint" style="font-size:.72rem;margin-top:6px">${sub}</div>` : ''}</div>`;
    const pc = (x) => (x === null ? 'no alerts' : pct(x));
    const rowOf = (name, x) => `<tr><th scope="row" style="color:var(--ink);text-transform:none;letter-spacing:0;font-size:13px">${name}</th><td>${x.groups.total}</td><td>${x.groups.episodeMatches}</td><td>${x.groups.explainable}</td><td>${x.groups.unrelated}</td><td>${x.episodes.found} of ${x.episodes.planted}</td><td>${pc(x.precision.group.match)}</td><td>${pc(x.precision.group.matchOrExplainable)}</td><td>${pct(x.recall)}</td></tr>`;
    const causes = Object.entries(s.causes);
    sec.innerHTML = `<div class="panel-head"><h2 id="score-h">Scorecard</h2><span class="tag">Answer key unlocked</span></div>
      <div class="panel-body">
        <p class="note">Alerts are counted as <strong>groups</strong>: one planted episode that splits into three alerts is one group. W2, P1 and P2 are scored; the W1 self-match hygiene rule is reported separately below.</p>
        <div class="metrics" role="group" aria-label="Overall score by alert group">${tile('Alert groups', o.groups.total)}${tile('Match a planted episode', o.groups.episodeMatches)}${tile('Explainable', o.groups.explainable)}${tile('Unrelated', o.groups.unrelated)}${tile('Episodes found', `${o.episodes.found} of ${o.episodes.planted}`, `${o.episodes.missed} missed`)}${tile('Recall', pct(o.recall), 'episodes found ÷ planted')}</div>
        <div class="metrics" role="group" aria-label="Precision">${tile('Precision, strict', pc(o.precision.group.match), 'share of alert groups that match a planted episode')}${tile('Precision, lenient', pc(o.precision.group.matchOrExplainable), 'share of alert groups that match or are explainable')}</div>
        <p class="note">These are counts over a handful of alert groups and two planted episodes in one synthetic run. One group more or fewer moves a percentage a lot; the explorer below shows other seeds.${missedEp.length ? ` Missed here: ${missedEp.map((e) => esc(e.type)).join(', ')}.` : ''} Alert-level counts, for reference: ${o.alerts.total} alerts (${o.alerts.match} match, ${o.alerts.explainable} explainable, ${o.alerts.unrelated} unrelated).</p>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Score by rule"><table class="score-table"><thead><tr><th scope="col">Rule</th><th scope="col">Groups</th><th scope="col">Match</th><th scope="col">Explainable</th><th scope="col">Unrelated</th><th scope="col">Episodes found</th><th scope="col">Precision, strict</th><th scope="col">Precision, lenient</th><th scope="col">Recall</th></tr></thead><tbody>
          ${PATTERN_RULE_IDS.map((r) => rowOf(`${r} ${esc(RULE_INFO[r].full)}`, s.byRule[r])).join('')}${rowOf('Overall', o)}</tbody></table></div>
        <div class="sub"><h3>Where the non-matching alert groups came from</h3>${causes.length ? `<ul class="limits" style="margin-top:8px">${causes.map(([c, n]) => `<li>${n} × ${esc(CAUSES[c] || c)}</li>`).join('')}</ul>` : '<p class="muted">Every alert group matches a planted episode at these settings. Check recall: tight thresholds that remove every distraction usually remove something real too.</p>'}</div>
        <div class="sub" id="hygiene"><h3>Self-match hygiene (W1), outside the scorecard</h3>
          <p class="muted" style="font-size:.86rem">W1 raised ${sm.alerts} alert${sm.alerts === 1 ? '' : 's'} on ${sm.accountsFlagged} account${sm.accountsFlagged === 1 ? '' : 's'}: ${sm.onPlantedAccounts} on planted-episode accounts, ${sm.onHonestAlgoAccounts} on honest algorithmic accounts, ${sm.onOtherAccounts} elsewhere. Honest algo accounts trade with themselves from time to time, so a self-match alone is weak evidence; it is useful for hygiene and as one more clue next to a linked group. It is not counted in the totals above and never in recall.</p></div>
        ${honestyHtml()}
        <p class="note">Your decisions: ${decided.length} of ${result.alerts.length} alerts decided; ${fits.length} fit the label${decided.some((a) => state.decisions.get(a.id) === 'monitor') ? ' (“keep monitoring” counts as neither)' : ''}. The simulator treats Escalate as fitting a match and Close — explained as fitting an explainable or unrelated alert; that is a simplification.</p>
      </div>`;
  }

  /* ------------------------------------------------------------ explorer */
  function explorerOptions() {
    return [...PARAMS.map((p) => ({ key: p.key, label: `${p.rule}: ${p.label}` })), { key: 'p1Mode', label: 'P1: baseline scope (per instrument or market-wide)' }, { key: 'p1Baseline', label: 'P1: baseline period (warm-up or trailing)' }, { key: 'linkagePolicy', label: 'Linkage policy (strict, default, loose)' }];
  }

  function sweepSpec(param) {
    if (param === 'linkagePolicy') return { categorical: true, values: POLICY_ORDER, labels: POLICY_ORDER.map((p) => POLICY_SHORT[p]), current: POLICY_ORDER.indexOf(state.policy), xLabel: 'Linkage policy' };
    if (param === 'p1Mode') return { categorical: true, values: ['instrument', 'global'], labels: ['Per instrument', 'Market-wide'], current: ['instrument', 'global'].indexOf(th('p1Mode')), xLabel: 'P1 baseline scope' };
    if (param === 'p1Baseline') return { categorical: true, values: ['warmup', 'trailing'], labels: ['Warm-up', 'Trailing'], current: ['warmup', 'trailing'].indexOf(th('p1Baseline')), xLabel: 'P1 baseline period' };
    const p = PARAMS.find((x) => x.key === param);
    const n = Math.round((p.max - p.min) / p.step);
    const stride = Math.max(1, Math.ceil(n / 30));
    const values = [];
    for (let i = 0; i <= n; i += stride) values.push(+(p.min + i * p.step).toFixed(6));
    if (values[values.length - 1] !== p.max) values.push(p.max);
    return { categorical: false, values, labels: values.map((v) => sliderText(p, v)), current: th(param), xLabel: p.label, p };
  }

  function renderExplorerShell() {
    const sec = $('explore-section');
    if (!state.unlocked) {
      sec.classList.add('locked');
      sec.innerHTML = `<div class="panel-head"><h2 id="explore-h">Trade-off explorer</h2><span class="tag">Locked</span></div><div class="panel-body"><p>Every threshold trades missed episodes against distracting alerts. The explorer plots that trade-off across a setting’s range and across thirty seeds. It uses the answer key, so it unlocks with it.</p></div>`;
      return;
    }
    sec.classList.remove('locked');
    if (!$('explorer-param')) {
      sec.innerHTML = `<div class="panel-head"><h2 id="explore-h">Trade-off explorer</h2><span class="tag">Answer key unlocked</span></div>
        <div class="panel-body">
          <p class="note">Pick a setting. The chart reruns detection on this seed across its range, holding everything else at your current settings. “Episodes found” counts planted episodes some pattern rule caught (at most 2). “Decoys alerted” counts designed look-alikes that raised an alert: the explainable market-maker crosses and the other planted traps. “Unrelated groups” counts alert groups with no planted cause.</p>
          <div class="explorer-bar"><label class="field" for="explorer-param">Setting to sweep<select id="explorer-param">${explorerOptions().map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}</select></label></div>
          <div class="swatches" id="sweep-legend"></div>
          <div class="chart-host" id="sweep-host"></div>
          <div id="linkage-effects"></div>
          <details class="inner"><summary>Show the numbers as a table</summary><div id="sweep-table"></div></details>
          <h3 style="margin-top:24px">The same settings across ${STUDY_SEEDS.length} seeds</h3>
          <p class="note" id="seed-note">Single-run numbers are over a handful of alert groups and two planted episodes; read the distribution, not one run. Each dot is one seed run with your current settings; the grey bar spans the minimum to the maximum and the dashed line is the median. The diamond is the seed you are viewing.</p>
          <p id="seed-progress" class="muted" style="font-size:.86rem" role="status" aria-live="polite"></p>
          <div class="chart-host" id="seed-host"></div>
          <div class="swatches" id="seed-legend"></div>
          <p id="seed-summary" class="muted" style="font-size:.88rem"></p>
          <details class="inner"><summary>Show the seed results as a table</summary><div id="seed-table"></div></details>
        </div>`;
    }
    $('explorer-param').value = state.explorerParam;
  }

  function renderSweep() {
    if (!state.unlocked || !$('sweep-host')) return;
    const param = state.explorerParam, spec = sweepSpec(param);
    const base = { ...state.thresholds }; delete base[param];
    const key = `${state.seed}|${state.policy}|${param}|${JSON.stringify(base)}`;
    let data = sweepCache.get(key);
    if (!data) { data = sweep(configId, param, spec.values, { seed: state.seed, thresholds: base, linkagePolicy: state.policy }); sweepCache.set(key, data); if (sweepCache.size > 40) sweepCache.delete(sweepCache.keys().next().value); }
    const series = [
      { key: 'found', short: 'Found', label: 'Episodes found (of 2)', color: COLORS.green, shape: 'square', dash: '', values: data.rows.map((r) => r.episodesFound) },
      { key: 'decoys', short: 'Decoys', label: 'Decoys alerted (explainable and designed traps)', color: COLORS.amber, shape: 'triangle', dash: '7 4', values: data.rows.map((r) => r.decoysAlerted) },
      { key: 'unrel', short: 'Unrelated', label: 'Unrelated groups', color: COLORS.blue, shape: 'circle', dash: '2 3', values: data.rows.map((r) => r.groups.unrelated) },
    ];
    const points = spec.values.map((v, i) => ({ value: spec.categorical ? i : v, label: spec.labels[i] }));
    const host = $('sweep-host');
    const w = wOf(host, 700);
    const ch = lineChart({ points, series, currentX: spec.current, xLabel: spec.xLabel, yLabel: 'Count in this run', categorical: spec.categorical, w, valueFmt: (v) => (spec.p ? sliderText(spec.p, v) : String(v)) });
    host.innerHTML = ch.svg + '<div class="tip" hidden></div>';
    attachHover(host, ch.cols);
    $('sweep-legend').innerHTML = series.map((s) => `<span><svg viewBox="0 0 34 12"><line x1="1" x2="33" y1="6" y2="6" stroke="${s.color}" stroke-width="2.25" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>${marker(s.shape, 17, 6, 3.6, `fill="${s.color}" stroke="${COLORS.panel}"`)}</svg>${esc(s.label)}</span>`).join('') + '<span><svg viewBox="0 0 34 12"><line x1="17" x2="17" y1="0" y2="12" stroke="' + COLORS.accent + '" stroke-width="1.5" stroke-dasharray="3 2"/></svg>your current setting</span>';
    const isLink = param === 'linkagePolicy';
    $('linkage-effects').innerHTML = isLink ? `<div class="sub" style="margin-top:12px"><h3>What each policy does to the groups</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Linkage effects"><table><thead><tr><th scope="col">Policy</th><th scope="col">Largest group (accounts)</th><th scope="col">Honest pairs merged</th><th scope="col">Ring kept whole</th></tr></thead><tbody>${data.rows.map((r, i) => `<tr><th scope="row" style="color:var(--ink);text-transform:none;letter-spacing:0;font-size:13px">${esc(spec.labels[i])}</th><td>${int(r.linkage.largestCluster)}</td><td>${int(r.linkage.falseLinkedPairs)}</td><td>${r.linkage.ringWhole ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:.8rem">“Honest pairs merged” counts pairs of unrelated honest accounts that end up in one group. Loose linkage builds very large false groups; strict linkage keeps them small but fragments the ring.</p></div>` : '';
    $('sweep-table').innerHTML = `<div class="table-wrap" tabindex="0" role="region" aria-label="Sweep values"><table><thead><tr><th scope="col">${esc(spec.xLabel)}</th>${series.map((s) => `<th scope="col">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${points.map((p, i) => `<tr><th scope="row" style="color:var(--ink);text-transform:none;letter-spacing:0;font-size:13px">${esc(p.label)}</th>${series.map((s) => `<td>${s.values[i]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderSeeds(done) {
    const host = $('seed-host');
    if (!state.unlocked || !host) return;
    $('seed-progress').textContent = done ? '' : `Running seed ${seedRows.length + 1} of ${STUDY_SEEDS.length}…`;
    if (!seedRows.length) { host.innerHTML = ''; return; }
    const col = (k) => seedRows.map((r) => ({ seed: r.seed, v: r[k] }));
    const maxU = Math.max(4, ...seedRows.map((r) => r.groupsUnrelated));
    const strips = distStrips({ currentSeed: state.seed, w: wOf(host, 700), rows: [
      { label: 'Share of alert groups that match a planted episode', values: col('precisionGroupMatch'), domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) },
      { label: 'Share of alert groups that match or are explainable', values: col('precisionGroupMatchOrExplainable'), domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => pct(v) },
      { label: 'Planted episodes found (of 2)', values: col('episodesFound'), domain: [0, 2], ticks: [0, 1, 2], fmt: (v) => String(+v.toFixed(1)) },
      { label: 'Unrelated alert groups', values: col('groupsUnrelated'), domain: [0, maxU], ticks: Array.from({ length: maxU + 1 }, (_, i) => i).filter((i) => maxU <= 8 || i % 2 === 0), fmt: (v) => String(+v.toFixed(1)) },
    ] });
    host.innerHTML = strips;
    $('seed-legend').innerHTML = `<span><svg viewBox="0 0 34 12"><circle cx="17" cy="6" r="3" fill="${COLORS.blue}"/></svg>one seed</span><span><svg viewBox="0 0 34 12"><rect x="13" y="2" width="8" height="8" fill="${COLORS.accent}" transform="rotate(45 17 6)"/></svg>the seed you are viewing</span><span><svg viewBox="0 0 34 12"><line x1="3" x2="31" y1="6" y2="6" stroke="${COLORS.faint}" stroke-width="5" stroke-linecap="round"/></svg>minimum to maximum</span><span><svg viewBox="0 0 34 12"><line x1="17" x2="17" y1="0" y2="12" stroke="${COLORS.accent}" stroke-width="2" stroke-dasharray="4 2"/></svg>median</span>`;
    const failing = seedRows.filter((r) => !r.targets.all).map((r) => r.seed);
    $('seed-summary').textContent = `${seedRows.length} seed${seedRows.length === 1 ? '' : 's'} run. The designed outcomes (both episodes found, an explainable alert present, the news shock caught by P1 but quiet on P2) hold in ${seedRows.length - failing.length} of ${seedRows.length}${failing.length ? `; they fail on seed${failing.length === 1 ? '' : 's'} ${failing.join(', ')} at these settings` : ''}.`;
    const f = (x) => (x === null ? '–' : pct(x));
    $('seed-table').innerHTML = `<div class="table-wrap" tabindex="0" role="region" aria-label="Results by seed"><table><thead><tr><th scope="col">Seed</th><th scope="col">Groups</th><th scope="col">Match</th><th scope="col">Explainable</th><th scope="col">Unrelated</th><th scope="col">Episodes found</th><th scope="col">Precision, strict</th><th scope="col">Precision, lenient</th></tr></thead><tbody>${seedRows.map((r) => `<tr><th scope="row" style="color:var(--ink);font-size:13px;text-transform:none;letter-spacing:0">${r.seed}${r.seed === state.seed ? ' (viewing)' : ''}</th><td>${r.groups}</td><td>${r.groupsMatch}</td><td>${r.groupsExplainable}</td><td>${r.groupsUnrelated}</td><td>${r.episodesFound}</td><td>${f(r.precisionGroupMatch)}</td><td>${f(r.precisionGroupMatchOrExplainable)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function runSeeds() {
    const token = ++seedToken;
    seedRows = []; seedDone = false;
    renderSeeds(false);
    let i = 0;
    const step = () => {
      if (token !== seedToken || !state.unlocked) return;
      // seedStudy on one seed at a time keeps each task short, so the page stays responsive.
      const one = seedStudy(configId, [STUDY_SEEDS[i]], { thresholds: state.thresholds, linkagePolicy: state.policy });
      seedRows.push(one.rows[0]);
      i++;
      seedDone = i >= STUDY_SEEDS.length;
      renderSeeds(seedDone);
      if (!seedDone) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function scheduleExplorer() {
    if (!state.unlocked) return;
    clearTimeout(explorerTimer);
    explorerTimer = setTimeout(() => { renderSweep(); runSeeds(); }, 220);
  }

  /* ------------------------------------------------------------ methodology */
  function renderMethod() {
    const rules = methodRules({ ...defs, ...state.thresholds }, defs);
    const schema = result.register.schema;
    $('method-body').innerHTML = `
      <p class="muted">Four rules look at the tape. W1 (self-match) is a hygiene rule; W2 looks at linked accounts; P1 and P2 look at price, volume and who drove a move. Values below follow your current settings; “default” shows where they started.</p>
      <ul class="rule-list">${rules.map(([id, name, text]) => `<li><span class="rulecell">${icon(RULE_INFO[id].shape)}<strong>${id} · ${esc(name)}</strong></span><br>${text}</li>`).join('')}</ul>
      <h3 style="margin-top:22px">How accounts get linked</h3>
      <p class="muted" style="max-width:90ch;font-size:.9rem">${esc(METHOD_GENERAL.linkage)}</p>
      <ul class="limits">${schema.map((s) => `<li><strong style="color:var(--ink)">${esc(s.label)}</strong> (${s.strength}): ${esc(T.attrs[s.key]?.plain || '')}</li>`).join('')}</ul>
      <h3 style="margin-top:22px">How to read the scores</h3>
      <p class="muted" style="font-size:.9rem;max-width:90ch">After the answer key is revealed an alert group is labelled “Matches a planted episode”, “Explainable” (an expected alert on a same-owner cross that needs a documented explanation) or “Unrelated to anything planted”. Precision is shown two ways: the share of groups that match an episode, and the share that match or are explainable.</p>
      <ul class="limits">${HONESTY.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <h3 style="margin-top:22px">What this does not model</h3>
      <ul class="limits">${METHOD_GENERAL.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  }

  /* ------------------------------------------------------------ export */
  function exportRun() {
    const decided = new Map(state.decisions);
    const alerts = result.alerts.map((a) => {
      decided.delete(a.id);
      const o = { id: a.id, rule: a.rule, hygieneRule: !!RULE_INFO[a.rule].hygiene, instrument: a.instrument, window: { startMs: a.window.startMs, endMs: a.window.endMs, display: tf.range(a.window.startMs, a.window.endMs) }, accounts: a.accounts, cluster: a.cluster, metrics: a.metrics, thresholdsCrossed: a.thresholdsCrossed, analystDecision: state.decisions.get(a.id) ? DECISIONS[state.decisions.get(a.id)].label : null };
      if (state.revealed.has(a.id)) { const cv = caseView(result, a.id); o.revealedAnswer = { label: LABELS[cv.groundTruth.label]?.long, cause: cv.groundTruth.cause, episodeIds: cv.groundTruth.episodeIds, decoyIds: cv.groundTruth.decoyIds }; }
      if (state.unlocked) o.keyLabel = LABELS[result.score.labels[a.id]?.label]?.long;
      return o;
    });
    const sc = result.score;
    const payload = {
      schema: 'trade-surveillance-export-2', modelVersion: MODEL_VERSION, exportedAt: new Date().toISOString(),
      note: 'Synthetic data. Alerts are leads for review, not conclusions.',
      simulator: configId, seed: state.seed, linkagePolicy: state.policy, thresholds: result.thresholds,
      alertCount: alerts.length, alerts,
      decisionsOnAlertsNoLongerRaised: [...decided].map(([id, d]) => ({ id, decision: DECISIONS[d].label })),
      answerKeyUnlocked: state.unlocked,
      score: state.unlocked ? { level: 'alert groups (W2, P1, P2)', overall: sc.overall, byRule: sc.byRule, causes: sc.causes, decoysAlerted: sc.decoysAlerted, selfMatchHygiene: sc.selfMatch } : null,
      seedStudy: state.unlocked && seedRows.length ? { seeds: seedRows.map((r) => r.seed), rows: seedRows.map(({ targets, ...r }) => r), complete: seedDone } : null,
    };
    download(`surveillance-${configId}-seed${state.seed}.json`, JSON.stringify(payload, null, 2));
  }

  /* ------------------------------------------------------------ update loop */
  function update() {
    compute();
    ensureSelection();
    renderTape(); renderQueue(); renderCase(); renderScore(); renderMethod();
    $('run-tag').textContent = `${configId} · seed ${state.seed} · ${POLICY_SHORT[state.policy]} linkage`;
    scheduleExplorer();
  }
  const scheduleUpdate = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };

  function setUnlocked(v) {
    state.unlocked = v;
    const b = $('key-toggle');
    b.setAttribute('aria-pressed', String(v));
    b.textContent = v ? 'Hide answer key' : 'Show answer key';
    renderQueue(); renderScore(); renderExplorerShell();
    if (v) { renderSweep(); runSeeds(); } else { seedToken++; }
  }

  /* ------------------------------------------------------------ events */
  function bind() {
    $('seed-select').addEventListener('change', (e) => {
      state.seed = Number(e.target.value); state.decisions.clear(); state.revealed.clear(); state.selected = null; state.instFilter = null; state.tradeShown = 25; state.clusterId = null;
      lastCaseKey = ''; update();
    });
    $('reset-all').addEventListener('click', () => {
      state.seed = DEFAULTS.seed; state.thresholds = {}; state.policy = DEFAULTS.linkagePolicy; state.instFilter = null; state.selected = null; state.tab = 'accounts';
      state.decisions.clear(); state.revealed.clear(); $('seed-select').value = String(state.seed);
      syncControls(); lastCaseKey = ''; update(); if (state.unlocked) setUnlocked(false);
    });
    $('key-toggle').addEventListener('click', () => setUnlocked(!state.unlocked));
    $('reset-defaults').addEventListener('click', () => { state.thresholds = {}; state.policy = DEFAULTS.linkagePolicy; syncControls(); update(); });
    $('export-btn').addEventListener('click', exportRun);

    $('tape').addEventListener('click', (e) => {
      const b = e.target.closest('.inst'); if (!b) return;
      state.instFilter = state.instFilter === b.dataset.inst ? null : b.dataset.inst;
      for (const x of document.querySelectorAll('.inst')) x.setAttribute('aria-pressed', String(x.dataset.inst === state.instFilter));
      ensureSelection(); renderQueue(); renderCase(true);
    });
    $('queue-section').addEventListener('click', (e) => {
      if (e.target.closest('#clear-filter')) { state.instFilter = null; for (const x of document.querySelectorAll('.inst')) x.setAttribute('aria-pressed', 'false'); renderQueue(); $('queue-h').scrollIntoView({ block: 'nearest' }); return; }
      const s = e.target.closest('[data-sort]');
      if (s) { const k = s.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderQueue(); $('queue-head').querySelector(`[data-sort="${k}"]`)?.focus(); return; }
      const tr = e.target.closest('tr[data-id]');
      if (tr) selectAlert(tr.dataset.id, { open: true });
    });
    $('queue-body').addEventListener('keydown', (e) => {
      const rows = [...$('queue-body').querySelectorAll('tr[data-id]')];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      let j = i;
      if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1);
      else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = rows.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAlert(rows[i].dataset.id, { open: true }); return; }
      else return;
      e.preventDefault();
      selectAlert(rows[j].dataset.id);
      $('queue-body').querySelector(`tr[data-id="${CSS.escape(rows[j].dataset.id)}"]`)?.focus();
    });

    $('controls').addEventListener('input', (e) => {
      const el = e.target;
      if (el.type === 'range') {
        const key = el.id.replace('in-', '');
        const v = Number(el.value);
        if (v === defs[key]) delete state.thresholds[key]; else state.thresholds[key] = v;
        const p = PARAMS.find((x) => x.key === key);
        $(`out-${key}`).textContent = sliderText(p, v); el.setAttribute('aria-valuetext', sliderText(p, v));
        $(`sl-${key}`).classList.toggle('changed', isChanged(key));
        scheduleUpdate();
      }
    });
    $('controls').addEventListener('change', (e) => {
      const el = e.target;
      if (el.name === 'policy') { state.policy = el.value; scheduleUpdate(); }
      if (el.name === 'p1base') { if (el.value === defs.p1Baseline) delete state.thresholds.p1Baseline; else state.thresholds.p1Baseline = el.value; syncControls(); scheduleUpdate(); }
      if (el.name === 'p1mode') { if (el.value === defs.p1Mode) delete state.thresholds.p1Mode; else state.thresholds.p1Mode = el.value; syncControls(); scheduleUpdate(); }
    });

    const caseSec = $('case-section');
    caseSec.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { state.tab = tab.dataset.tab; renderCase(true); $(`tab-${state.tab}`)?.focus(); return; }
      if (e.target.closest('#more-accts')) { state.acctShown += ACCOUNT_ROWS; renderCase(true); document.getElementById('more-accts')?.focus(); return; }
      if (e.target.closest('#more-edges')) { state.edgesShown += EDGE_ROWS; renderCase(true); document.getElementById('more-edges')?.focus(); return; }
      if (e.target.closest('#more-trades')) { state.tradeShown += 25; renderCase(true); document.getElementById('more-trades')?.focus(); return; }
      if (e.target.closest('#reveal-btn')) { state.revealed.add(state.selected); renderAnswer(); if (state.tab === 'accounts') renderTab(currentCv()); $('verdict-h')?.focus(); return; }
      if (e.target.closest('#clear-decision')) { state.decisions.delete(state.selected); renderDecision(currentCv().alert); renderAnswer(); renderQueue(); }
    });
    caseSec.addEventListener('change', (e) => {
      if (e.target.name === 'decision') { state.decisions.set(state.selected, e.target.value); $('clear-decision').disabled = false; renderAnswer(); renderQueue(); renderScore(); }
      if (e.target.id === 'cluster-select') { state.clusterId = e.target.value; renderCase(true); $('cluster-select')?.focus(); }
    });
    caseSec.addEventListener('keydown', (e) => {
      const tab = e.target.closest?.('[role="tab"]');
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const ids = TABS.map((t) => t[0]);
      let i = ids.indexOf(tab.dataset.tab);
      if (e.key === 'ArrowRight') i = (i + 1) % ids.length; else if (e.key === 'ArrowLeft') i = (i + ids.length - 1) % ids.length; else if (e.key === 'Home') i = 0; else i = ids.length - 1;
      e.preventDefault(); state.tab = ids[i]; renderCase(true); $(`tab-${state.tab}`)?.focus();
    });

    $('explore-section').addEventListener('change', (e) => { if (e.target.id === 'explorer-param') { state.explorerParam = e.target.value; renderSweep(); } });

    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { const w = document.documentElement.clientWidth; if (Math.abs(w - lastWidth) < 8) return; lastWidth = w; lastCaseKey = ''; renderTape(); renderCase(true); if (state.unlocked) { renderSweep(); renderSeeds(true); } }, 150);
    });
  }

  /* ------------------------------------------------------------ boot */
  buildShell();
  compute();
  buildControls();
  ensureSelection();
  bind();
  lastWidth = document.documentElement.clientWidth;
  renderTape(); renderQueue(); renderCase(true); renderScore(); renderExplorerShell(); renderMethod();
  $('run-tag').textContent = `${configId} · seed ${state.seed} · ${POLICY_SHORT[state.policy]} linkage`;
  document.documentElement.dataset.survReady = 'true';
  return { state };
}

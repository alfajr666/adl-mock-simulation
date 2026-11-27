// Hand-rolled inline SVG charts. No dependencies. Colour is never the only signal:
// every series also has a shape, a dash pattern, a text label, or all three.
import { esc, int, niceTicks, price as fmtPrice } from './format.js';

let uid = 0;
const nid = (p) => `${p}-${++uid}`;
const r1 = (n) => Math.round(n * 10) / 10;
/** Whole-number ticks from 0 that always reach max (counts never get fractional gridlines). */
function intTicks(max) {
  const step = [1, 2, 5, 10, 20, 50].find((c) => max / c <= 5) || 100;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const out = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}

export const COLORS = {
  blue: '#65a9ff', amber: '#f4b860', red: '#ff746b', green: '#66d5a0', accent: '#b9a4ff',
  ink: '#e9edf3', muted: '#8b99aa', faint: '#5d6a78', line: '#283340', panel: '#0e131a', panel2: '#151c25',
};
const CLUSTER_COLORS = [COLORS.accent, COLORS.blue, COLORS.amber, COLORS.green];

/** Marker per rule so alerts are identifiable without colour. */
export function marker(shape, cx, cy, r = 5, extra = '') {
  const common = `class="mk" ${extra}`;
  if (shape === 'circle') return `<circle ${common} cx="${r1(cx)}" cy="${r1(cy)}" r="${r}"/>`;
  if (shape === 'square') return `<rect ${common} x="${r1(cx - r)}" y="${r1(cy - r)}" width="${2 * r}" height="${2 * r}"/>`;
  if (shape === 'triangle') return `<polygon ${common} points="${r1(cx)},${r1(cy - r - 1)} ${r1(cx + r + 1)},${r1(cy + r)} ${r1(cx - r - 1)},${r1(cy + r)}"/>`;
  return `<polygon ${common} points="${r1(cx)},${r1(cy - r - 1)} ${r1(cx + r + 1)},${r1(cy)} ${r1(cx)},${r1(cy + r + 1)} ${r1(cx - r - 1)},${r1(cy)}"/>`;
}

export function binOf(market, ms) {
  const bins = market.bins;
  let lo = 0, hi = bins.length - 1;
  if (ms < bins[0].t0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bins[mid].t0 <= ms) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** One pass over the tape: per-instrument close / quantity / trade count by bin. */
export function tapeBars(result) {
  const { market, tape } = result;
  const n = market.bins.length;
  const out = {};
  for (const d of market.instruments) out[d.id] = { close: new Array(n).fill(null), qty: new Array(n).fill(0), count: new Array(n).fill(0), notional: 0, trades: 0 };
  for (const t of tape.trades) {
    const b = binOf(market, t.t);
    const o = out[t.inst];
    o.close[b] = t.price; o.qty[b] += t.qty; o.count[b] += 1; o.notional += t.price * t.qty; o.trades += 1;
  }
  for (const d of market.instruments) {
    const o = out[d.id];
    let last = o.close.find((c) => c !== null) ?? 0;
    for (let i = 0; i < n; i++) { if (o.close[i] === null) o.close[i] = last; else last = o.close[i]; }
  }
  return out;
}

function xAxisSvg({ market, tf, n, xOf, y, pw, l, withDays = true }) {
  const bins = market.bins;
  let s = `<line class="ax-line" x1="${l}" x2="${l + pw}" y1="${y}" y2="${y}"/>`;
  if (tf.multiDay) {
    let prevDay = -1;
    bins.forEach((b, i) => {
      if (b.day !== prevDay) {
        prevDay = b.day;
        let end = i; while (end + 1 < n && bins[end + 1].day === b.day) end++;
        const cx = (xOf(i) + xOf(end)) / 2;
        if (i > 0 && withDays) s += `<line class="grid-line" x1="${r1(xOf(i) - pw / n / 2)}" x2="${r1(xOf(i) - pw / n / 2)}" y1="${y - 1}" y2="${y + 4}"/>`;
        s += `<text class="ax-text" x="${r1(cx)}" y="${y + 14}" text-anchor="middle">Day ${b.day + 1}</text>`;
      }
    });
  } else {
    const per = pw / n;
    const step = [5, 10, 15, 20, 30].find((c) => c * per >= 64) || 30;
    for (let i = 0; i < n; i += step) {
      s += `<line class="ax-line" x1="${r1(xOf(i))}" x2="${r1(xOf(i))}" y1="${y}" y2="${y + 4}"/><text class="ax-text" x="${r1(xOf(i))}" y="${y + 14}" text-anchor="middle">${tf.time(bins[i].t0)}</text>`;
    }
  }
  return s;
}
const xTitle = (tf, market) => (tf.multiDay ? `Trading time by day (${market.binMs / 60000}-minute bins, overnight gaps removed)` : `Minutes since session start (${market.binMs / 60000}-minute bins)`);

/* ------------------------------------------------------------------ tape overview */
export function tapeSpark({ result, bars, inst, alerts, tf, w }) {
  const { market } = result;
  const n = market.bins.length;
  const def = market.instruments.find((d) => d.id === inst);
  const h = 128, l = 46, r = 4, pw = w - l - r;
  const xOf = (i) => l + ((i + 0.5) * pw) / n;
  const b = bars[inst];
  const cmin = Math.min(...b.close), cmax = Math.max(...b.close);
  const span = cmax - cmin || 1;
  const py = (c) => 20 + (1 - (c - cmin) / span) * 46;
  const qmax = Math.max(...b.qty, 1);
  const path = b.close.map((c, i) => `${i ? 'L' : 'M'}${r1(xOf(i))},${r1(py(c))}`).join('');
  let s = `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(inst)} price line and volume bars over the session; ${alerts.length} alert${alerts.length === 1 ? '' : 's'}">`;
  // day separators
  let prev = -1;
  market.bins.forEach((bn, i) => { if (bn.day !== prev) { prev = bn.day; if (i > 0) s += `<line class="grid-line" x1="${r1(xOf(i) - pw / n / 2)}" x2="${r1(xOf(i) - pw / n / 2)}" y1="16" y2="102"/>`; } });
  // volume bars
  b.qty.forEach((q, i) => {
    const bh = (q / qmax) * 28;
    if (bh > 0.3) s += `<rect class="vol-bar" x="${r1(xOf(i) - Math.max(pw / n - 1, 1) / 2)}" y="${r1(102 - bh)}" width="${r1(Math.max(pw / n - 1, 1))}" height="${r1(bh)}"/>`;
  });
  s += `<path class="price-line" d="${path}"/>`;
  s += `<text class="ax-text" x="${l - 4}" y="${r1(py(cmax)) + 3}" text-anchor="end">${fmtPrice(cmax, def.tickSize)}</text><text class="ax-text" x="${l - 4}" y="${r1(py(cmin)) + 3}" text-anchor="end">${fmtPrice(cmin, def.tickSize)}</text>`;
  s += `<line class="ax-line" x1="${l}" x2="${l + pw}" y1="102" y2="102"/>`;
  // axis labels
  if (tf.multiDay) {
    let pd = -1;
    market.bins.forEach((bn, i) => { if (bn.day !== pd) { pd = bn.day; s += `<text class="ax-text" x="${r1(xOf(i) + pw / n * 4.5)}" y="${h - 6}" text-anchor="middle">D${bn.day + 1}</text>`; } });
  } else {
    [0, Math.floor(n / 2), n - 1].forEach((i, k) => { s += `<text class="ax-text" x="${r1(xOf(i))}" y="${h - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${tf.time(market.bins[i].t0)}</text>`; });
  }
  // alert markers, grouped by bin
  const byBin = new Map();
  for (const a of alerts) { const bi = binOf(market, a.window.startMs); (byBin.get(bi) || byBin.set(bi, []).get(bi)).push(a); }
  for (const [bi, list] of byBin) {
    list.forEach((a, k) => {
      const dx = (k - (list.length - 1) / 2) * 11;
      s += marker(RULE_SHAPES[a.rule], xOf(bi) + dx, 8, 4);
    });
  }
  return s + '</svg>';
}
const RULE_SHAPES = { W1: 'circle', W2: 'square', P1: 'triangle', P2: 'diamond' };

/* ------------------------------------------------------------------ hover helper */
/** cols: [{x, html}] in svg px; moves a crosshair line and a tooltip inside `host`. */
export function attachHover(host, cols) {
  const svg = host.querySelector('svg');
  const line = svg && svg.querySelector('.hover-line');
  const tip = host.querySelector('.tip');
  if (!svg || !line || !tip || !cols.length) return;
  const hide = () => { tip.hidden = true; line.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((e.clientX - rect.left) / rect.width) * vb.width;
    let best = cols[0];
    for (const c of cols) if (Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
    line.setAttribute('x1', best.x); line.setAttribute('x2', best.x); line.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.innerHTML = best.html;
    const px = (best.x / vb.width) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tw, px + 10))}px`;
  });
  svg.addEventListener('pointerleave', hide);
}

/* ------------------------------------------------------------------ case file: price and volume */
export function priceVolume({ cv, result, tf, w, baseline }) {
  const { market } = result;
  const def = cv.instrument;
  const tick = def.tickSize;
  const series = cv.series;
  const n = series.length;
  const h = 330, l = 56, r = 10, pw = w - l - r;
  const priceTop = 22, priceBot = 190, volTop = 214, volBot = 286;
  const xOf = (i) => l + ((i + 0.5) * pw) / n;
  const cw = pw / n;
  let last = series.find((s) => s.close !== null)?.close ?? 0;
  const close = series.map((s) => { if (s.close !== null && s.close !== undefined) last = s.close; return last; });
  const lows = series.map((s, i) => (s.low ?? close[i]));
  const highs = series.map((s, i) => (s.high ?? close[i]));
  const pmin = Math.min(...lows), pmax = Math.max(...highs);
  const pad = (pmax - pmin || 1) * 0.06;
  const lo = pmin - pad, hi = pmax + pad;
  const py = (p) => priceBot - ((p - lo) / (hi - lo)) * (priceBot - priceTop);
  const qmax = Math.max(...series.map((s) => s.qty), 1);
  const vy = (q) => volBot - (q / qmax) * (volBot - volTop);
  const pat = nid('hatch');
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Price and traded quantity by bin for ${esc(def.id)}; the alert window is shaded and hatched">`;
  s += `<defs><pattern id="${pat}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${COLORS.accent}" fill-opacity=".10"/><line x1="0" y1="0" x2="0" y2="7" stroke="${COLORS.accent}" stroke-opacity=".55" stroke-width="1.5"/></pattern></defs>`;
  // y grid (price)
  for (const t of niceTicks(lo / tick, hi / tick, 4)) {
    const yy = py(t);
    s += `<line class="grid-line" x1="${l}" x2="${l + pw}" y1="${r1(yy)}" y2="${r1(yy)}"/><text class="ax-text" x="${l - 6}" y="${r1(yy) + 3}" text-anchor="end">${int(t * tick)}</text>`;
  }
  // alert window
  const flagged = series.filter((x) => x.inAlertWindow).map((x) => x.bin);
  if (flagged.length) {
    const a = Math.min(...flagged), b = Math.max(...flagged);
    const x0 = l + (a * pw) / n, x1 = l + ((b + 1) * pw) / n;
    s += `<rect x="${r1(x0)}" y="${priceTop - 6}" width="${r1(x1 - x0)}" height="${volBot - priceTop + 6}" fill="url(#${pat})" stroke="${COLORS.accent}" stroke-opacity=".6" stroke-dasharray="3 3"/>`;
    const lx = x0 + 4 + 90 > l + pw ? x1 - 4 : x0 + 4;
    s += `<text class="win-label" x="${r1(lx)}" y="${priceTop + 4}" text-anchor="${lx === x1 - 4 ? 'end' : 'start'}">alert window</text>`;
  }
  if (baseline && baseline.end >= baseline.start) {
    const bx0 = l + (baseline.start * pw) / n, bx1 = l + ((baseline.end + 1) * pw) / n;
    s += `<rect x="${r1(bx0)}" y="${priceTop - 6}" width="${r1(bx1 - bx0)}" height="${volBot - priceTop + 6}" fill="${COLORS.blue}" fill-opacity=".07" stroke="${COLORS.blue}" stroke-opacity=".5" stroke-dasharray="1 3"/>`;
    s += `<text class="base-label" x="${r1(bx0 + 4)}" y="${priceBot - 6}">baseline</text>`;
  }
  // low-high range per bin and close line
  series.forEach((b, i) => { s += `<line class="range-line" x1="${r1(xOf(i))}" x2="${r1(xOf(i))}" y1="${r1(py(highs[i]))}" y2="${r1(py(lows[i]))}"/>`; });
  s += `<path class="price-line" d="${close.map((c, i) => `${i ? 'L' : 'M'}${r1(xOf(i))},${r1(py(c))}`).join('')}"/>`;
  // volume
  series.forEach((b, i) => { const bh = volBot - vy(b.qty); if (bh > 0.3) s += `<rect class="vol-bar" x="${r1(xOf(i) - Math.max(cw - 1, 1) / 2)}" y="${r1(vy(b.qty))}" width="${r1(Math.max(cw - 1, 1))}" height="${r1(bh)}"/>`; });
  for (const t of niceTicks(0, qmax, 2)) s += `<line class="grid-line" x1="${l}" x2="${l + pw}" y1="${r1(vy(t))}" y2="${r1(vy(t))}"/><text class="ax-text" x="${l - 6}" y="${r1(vy(t)) + 3}" text-anchor="end">${int(t)}</text>`;
  s += `<text class="ax-title" x="${l}" y="12">Price (display units)</text><text class="ax-title" x="${l}" y="${volTop - 8}">Traded quantity per bin (${esc(cv.qtyUnit)})</text>`;
  s += xAxisSvg({ market, tf, n, xOf, y: volBot, pw, l });
  s += `<text class="ax-title" x="${l + pw}" y="${h - 4}" text-anchor="end">${esc(xTitle(tf, market))}</text>`;
  s += `<line class="hover-line" visibility="hidden" y1="${priceTop - 6}" y2="${volBot}"/></svg>`;
  const cols = series.map((b, i) => ({ x: xOf(i), html: `<strong>${esc(tf.time(b.startMs))}</strong><br>close ${int(close[i] * tick)} · range ${int(lows[i] * tick)}–${int(highs[i] * tick)}<br>qty ${int(b.qty)} · ${b.trades} trade${b.trades === 1 ? '' : 's'}${b.inAlertWindow ? '<br>inside alert window' : ''}` }));
  return { svg: s, cols };
}

/* ------------------------------------------------------------------ case file: cluster position or P&L */
export function clusterChart({ points, kind, tf, result, cv, w }) {
  const { market } = result;
  const tick = cv.instrument.tickSize;
  const n = points.length;
  const h = 170, l = 62, r = 10, pw = w - l - r, top = 22, bot = 130;
  const xOf = (i) => l + ((i + 0.5) * pw) / n;
  const vals = points.map((p) => (kind === 'position' ? p.position : p.pnl * tick));
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
  const pat = nid('hatch');
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${kind === 'position' ? 'Group net position' : 'Group profit and loss'} by bin">`;
  s += `<defs><pattern id="${pat}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${COLORS.accent}" fill-opacity=".10"/><line x1="0" y1="0" x2="0" y2="7" stroke="${COLORS.accent}" stroke-opacity=".55" stroke-width="1.5"/></pattern></defs>`;
  const fl = cv.series.filter((x) => x.inAlertWindow).map((x) => x.bin);
  if (fl.length) { const x0 = l + (Math.min(...fl) * pw) / n, x1 = l + ((Math.max(...fl) + 1) * pw) / n; s += `<rect x="${r1(x0)}" y="${top - 4}" width="${r1(x1 - x0)}" height="${bot - top + 4}" fill="url(#${pat})"/>`; }
  for (const t of niceTicks(lo, hi, 3)) s += `<line class="grid-line" x1="${l}" x2="${l + pw}" y1="${r1(y(t))}" y2="${r1(y(t))}"/><text class="ax-text" x="${l - 6}" y="${r1(y(t)) + 3}" text-anchor="end">${int(t)}</text>`;
  s += `<line class="zero-line" x1="${l}" x2="${l + pw}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`;
  const d = kind === 'position'
    ? vals.map((v, i) => { const x0 = l + (i * pw) / n, x1 = l + ((i + 1) * pw) / n; return `${i ? `L${r1(x0)},${r1(y(vals[i - 1]))}` : `M${r1(x0)},${r1(y(v))}`}L${r1(x0)},${r1(y(v))}L${r1(x1)},${r1(y(v))}`; }).join('')
    : vals.map((v, i) => `${i ? 'L' : 'M'}${r1(xOf(i))},${r1(y(v))}`).join('');
  s += `<path class="${kind === 'position' ? 'pos-line' : 'pnl-line'}" d="${d}"/>`;
  s += `<text class="ax-title" x="${l}" y="12">${kind === 'position' ? `Net position (${esc(cv.qtyUnit)}; below zero is short)` : 'Profit and loss (display units; cash + position at bin close)'}</text>`;
  s += xAxisSvg({ market, tf, n, xOf, y: bot, pw, l });
  s += `<line class="hover-line" visibility="hidden" y1="${top - 4}" y2="${bot}"/></svg>`;
  const cols = points.map((p, i) => ({ x: xOf(i), html: `<strong>${esc(tf.time(cv.series[i].startMs))}</strong><br>position ${int(p.position)} ${esc(cv.qtyUnit)}<br>P&amp;L ${int(p.pnl * tick)}` }));
  return { svg: s, cols };
}

/* ------------------------------------------------------------------ case file: link graph */
export function linkGraph({ accounts, edges, attrShort, w, showLabels = true }) {
  const n = accounts.length;
  const h = n <= 1 ? 140 : Math.min(360, Math.max(260, w * 0.8));
  const cx = w / 2, cy = h / 2;
  const R = n <= 1 ? 0 : Math.min(w / 2 - 54, h / 2 - 34);
  const clusterIds = [...new Set(accounts.map((a) => a.clusterId))];
  const size = Object.fromEntries(clusterIds.map((c) => [c, accounts.filter((a) => a.clusterId === c).length]));
  const multi = clusterIds.filter((c) => size[c] > 1);
  const order = [...accounts].sort((a, b) => (size[b.clusterId] - size[a.clusterId]) || (a.clusterId < b.clusterId ? -1 : a.clusterId > b.clusterId ? 1 : 0) || (a.acct < b.acct ? -1 : 1));
  const pos = {};
  order.forEach((a, i) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1); pos[a.acct] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }; });
  const colorOf = (cid) => (size[cid] > 1 ? CLUSTER_COLORS[multi.indexOf(cid) % CLUSTER_COLORS.length] : COLORS.faint);
  const dashOf = (cid) => (size[cid] > 1 ? ['', '2 3', '6 3', '1 3'][multi.indexOf(cid) % 4] : '');
  let s = `<svg ${edges.length > 14 ? 'class="dense" ' : ''}viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Link graph of ${n} account${n === 1 ? '' : 's'} with ${edges.length} shared-attribute edge${edges.length === 1 ? '' : 's'}; the table below lists every edge">`;
  const labels = [];
  edges.forEach((e, i) => {
    const a = pos[e.a], b = pos[e.b];
    if (!a || !b) return;
    const strong = e.shared.some((x) => x.strength === 'strong');
    const cls = `edge ${strong ? 'strong' : 'weak'} ${e.linked ? 'counted' : 'uncounted'}`;
    s += `<line class="${cls}" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}"/>`;
    const t = 0.34 + (i % 3) * 0.16;
    const names = e.shared.map((x) => attrShort[x.key] || x.key).join(' + ');
    labels.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, text: `${names}${e.linked ? '' : ' (not counted)'}`, strong, linked: e.linked });
  });
  for (const lb of showLabels ? labels : []) {
    const tw = lb.text.length * 5.4 + 10;
    s += `<g class="edge-label ${lb.linked ? 'counted' : 'uncounted'}"><rect x="${r1(lb.x - tw / 2)}" y="${r1(lb.y - 8)}" width="${r1(tw)}" height="15" rx="4"/><text x="${r1(lb.x)}" y="${r1(lb.y + 3)}" text-anchor="middle">${esc(lb.text)}</text></g>`;
  }
  for (const a of accounts) {
    const p = pos[a.acct];
    s += `<g><circle class="node" cx="${r1(p.x)}" cy="${r1(p.y)}" r="18" stroke="${colorOf(a.clusterId)}" ${dashOf(a.clusterId) ? `stroke-dasharray="${dashOf(a.clusterId)}"` : ''}/><text class="node-text" x="${r1(p.x)}" y="${r1(p.y) + 3.5}" text-anchor="middle">${esc(a.acct)}</text></g>`;
  }
  s += '</svg>';
  const legendGroups = clusterIds.map((cid) => ({ cid, color: colorOf(cid), dash: dashOf(cid), members: accounts.filter((a) => a.clusterId === cid).map((a) => a.acct), grouped: size[cid] > 1 }));
  return { svg: s, legendGroups };
}

/* ------------------------------------------------------------------ trade-off explorer */
export function lineChart({ points, series, currentX, xLabel, yLabel, categorical, w, valueFmt }) {
  const h = 290, l = 38, rLab = w < 520 ? 84 : 110, t = 36, b = 50;
  const pw = w - l - rLab, ph = h - t - b;
  const n = points.length;
  const xs = points.map((p) => p.value);
  const xmin = categorical ? 0 : Math.min(...xs), xmax = categorical ? n - 1 : Math.max(...xs);
  const xOf = (v) => l + (xmax === xmin ? pw / 2 : ((v - xmin) / (xmax - xmin)) * pw);
  const ymax = Math.max(1, ...series.flatMap((s) => s.values));
  const yt = intTicks(ymax);
  const yTop = Math.max(...yt);
  const y = (v) => t + ph - (v / yTop) * ph;
  const px = (i) => xOf(categorical ? i : xs[i]);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(yLabel)} against ${esc(xLabel)}; the data table below has every value">`;
  for (const v of yt) s += `<line class="grid-line" x1="${l}" x2="${l + pw}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="ax-text" x="${l - 6}" y="${r1(y(v)) + 3}" text-anchor="end">${v}</text>`;
  s += `<line class="ax-line" x1="${l}" x2="${l + pw}" y1="${t + ph}" y2="${t + ph}"/>`;
  // x ticks
  if (categorical) points.forEach((p, i) => { s += `<text class="ax-text" x="${r1(px(i))}" y="${t + ph + 16}" text-anchor="middle">${esc(p.label)}</text>`; });
  else for (const v of niceTicks(xmin, xmax, w < 520 ? 4 : 6)) s += `<line class="ax-line" x1="${r1(xOf(v))}" x2="${r1(xOf(v))}" y1="${t + ph}" y2="${t + ph + 4}"/><text class="ax-text" x="${r1(xOf(v))}" y="${t + ph + 16}" text-anchor="middle">${esc(valueFmt(v))}</text>`;
  s += `<text class="ax-title" x="${l}" y="12">${esc(yLabel)}</text><text class="ax-title" x="${l + pw / 2}" y="${h - 8}" text-anchor="middle">${esc(xLabel)}</text>`;
  // current marker
  if (currentX !== null && currentX !== undefined) {
    const cxp = categorical ? xOf(currentX) : xOf(Math.min(xmax, Math.max(xmin, currentX)));
    s += `<line class="current-line" x1="${r1(cxp)}" x2="${r1(cxp)}" y1="${t - 4}" y2="${t + ph}"/><text class="current-text" x="${r1(Math.min(cxp, l + pw - 4))}" y="${t - 8}" text-anchor="${cxp > l + pw - 70 ? 'end' : 'middle'}">current</text>`;
  }
  // series
  for (const se of series) {
    const d = se.values.map((v, i) => `${i ? 'L' : 'M'}${r1(px(i))},${r1(y(v))}`).join('');
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2.25" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} stroke-linejoin="round"/>`;
    if (n <= 12) se.values.forEach((v, i) => { s += marker(se.shape, px(i), y(v), 3.6, `fill="${se.color}" stroke="${COLORS.panel}" stroke-width="1.5"`); });
    else { const i = n - 1; s += marker(se.shape, px(i), y(se.values[i]), 3.6, `fill="${se.color}" stroke="${COLORS.panel}" stroke-width="1.5"`); }
  }
  // direct labels at the right edge, nudged apart
  const labs = series.map((se) => ({ se, y: y(se.values[n - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
  if (labs.length) { const maxY = t + ph + 2; if (labs[labs.length - 1].y > maxY) labs[labs.length - 1].y = maxY; for (let i = labs.length - 2; i >= 0; i--) if (labs[i + 1].y - labs[i].y < 13) labs[i].y = labs[i + 1].y - 13; }
  for (const lb of labs) s += `<text class="series-label" x="${l + pw + 9}" y="${r1(lb.y) + 4}">${esc(lb.se.short || lb.se.label)}</text>`;
  s += `<line class="hover-line" visibility="hidden" y1="${t - 4}" y2="${t + ph}"/></svg>`;
  const cols = points.map((p, i) => ({ x: px(i), html: `<strong>${esc(xLabel)}: ${esc(p.label)}</strong>${series.map((se) => `<br>${esc(se.label)}: ${se.values[i]}`).join('')}` }));
  return { svg: s, cols };
}

/* ------------------------------------------------------------------ seed distribution strips */
/** rows: [{label, values:[{seed,v}], domain:[lo,hi], ticks:[...], fmt}] -> dot strip per row with min, median, max. */
export function distStrips({ rows, currentSeed, w }) {
  const l = 14, r = 16, pw = w - l - r;
  const rowH = 104;
  const h = rows.length * rowH + 6;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Distribution across seeds: one dot per seed, with the minimum, median and maximum marked; the table below lists every value">`;
  rows.forEach((row, k) => {
    const y0 = k * rowH + 8;
    const [lo, hi] = row.domain;
    const x = (v) => l + ((v - lo) / (hi - lo || 1)) * pw;
    const axisY = y0 + 86;
    const vals = row.values.map((d) => d.v).filter((v) => v !== null).sort((a, b) => a - b);
    const mn = vals[0], mx = vals[vals.length - 1];
    const med = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    s += `<text class="ax-title" x="${l}" y="${y0 + 8}">${esc(row.label)}</text>`;
    s += `<text class="seed-cur" x="${l}" y="${y0 + 24}">${vals.length ? `median ${esc(row.fmt(med))} · min ${esc(row.fmt(mn))} · max ${esc(row.fmt(mx))}` : 'no values'}</text>`;
    s += `<line class="ax-line" x1="${l}" x2="${l + pw}" y1="${axisY}" y2="${axisY}"/>`;
    for (const t of row.ticks) s += `<line class="ax-line" x1="${r1(x(t))}" x2="${r1(x(t))}" y1="${axisY}" y2="${axisY + 4}"/><text class="ax-text" x="${r1(x(t))}" y="${axisY + 15}" text-anchor="${t === hi ? 'end' : t === lo ? 'start' : 'middle'}">${esc(row.fmt(t))}</text>`;
    if (vals.length) {
      s += `<rect x="${r1(x(mn))}" y="${axisY - 4}" width="${r1(Math.max(2, x(mx) - x(mn)))}" height="5" rx="2.5" fill="${COLORS.faint}" fill-opacity=".55"/>`;
      s += `<line x1="${r1(x(med))}" x2="${r1(x(med))}" y1="${y0 + 32}" y2="${axisY}" stroke="${COLORS.accent}" stroke-width="2" stroke-dasharray="4 2"/>`;
    }
    // dots: identical values stack five high, then spread sideways
    const stack = new Map();
    for (const d of row.values) {
      if (d.v === null) continue;
      const key = d.v;
      const c = stack.get(key) || 0; stack.set(key, c + 1);
      const rowIdx = c % 5, col = Math.floor(c / 5);
      const dx = col === 0 ? 0 : (col % 2 ? 1 : -1) * Math.ceil(col / 2) * 8;
      const cx = x(d.v) + dx, cy = axisY - 12 - rowIdx * 9;
      if (d.seed === currentSeed) s += `<rect class="cur-dot" x="${r1(cx - 4)}" y="${r1(cy - 4)}" width="8" height="8" transform="rotate(45 ${r1(cx)} ${r1(cy)})"/>`;
      else s += `<circle class="seed-dot" cx="${r1(cx)}" cy="${r1(cy)}" r="3.2"/>`;
    }
  });
  return s + '</svg>';
}

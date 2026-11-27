// Formatting helpers. Every string that reaches innerHTML goes through esc().
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : nf0.format(n));
export const dec1 = (n) => (n === null || n === undefined ? '–' : nf1.format(n));
export const dec2 = (n) => (n === null || n === undefined ? '–' : nf2.format(n));
export const pct = (x, d = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(d)}%`);
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + nf0.format(Math.abs(n));
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Time within the session, readable for the market. Equity shows the day; crypto shows minutes from the start. */
export function makeTimeFormat(market) {
  const S = market.session;
  const multiDay = S.days > 1;
  const parts = (ms) => {
    const day = multiDay ? Math.floor(ms / S.dayMs) : 0;
    const within = ms - day * S.dayMs;
    const totalSec = Math.floor(within / 1000);
    return { day, h: Math.floor(totalSec / 3600), m: Math.floor((totalSec % 3600) / 60), s: totalSec % 60 };
  };
  const clock = (p) => (multiDay ? `+${pad(p.h)}:${pad(p.m)}` : `+${pad(p.h * 60 + p.m)}:${pad(p.s)}`);
  const time = (ms) => { const p = parts(ms); return multiDay ? `D${p.day + 1} ${clock(p)}` : clock(p); };
  const range = (a, b) => {
    const pa = parts(a), pb = parts(b);
    if (multiDay && pa.day === pb.day) return `D${pa.day + 1} ${clock(pa)} → ${clock(pb)}`;
    return `${time(a)} → ${time(b)}`;
  };
  const day = (ms) => (multiDay ? Math.floor(ms / S.dayMs) : 0);
  return { time, range, day, multiDay };
}

/** Prices are engine ticks; displayed price = ticks × tickSize. Money = ticks×qty × tickSize. */
export const price = (ticks, tickSize) => int(ticks * tickSize);
export const money = (ticksQty, tickSize) => int(ticksQty * tickSize);
export const moneySigned = (ticksQty, tickSize) => signed(ticksQty * tickSize);

export function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

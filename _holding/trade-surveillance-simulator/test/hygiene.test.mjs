import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario, DEFAULTS, CONFIG_IDS } from '../engine/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('engine has no nondeterministic or DOM sources', () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of ['Math.random', 'Date.now', 'new Date', 'performance.now', 'document.', 'require(']) assert.ok(!src.includes(bad), `${f} uses ${bad}`);
    assert.ok(!/(^|[^.\w])window\./.test(src), `${f} touches window`);
  }
});

test('naming: alerts are leads, never findings; no claim of detected manipulation', () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/manipulation (detected|found|confirmed)/i.test(src), f);
    assert.ok(!/\bfindings?\b/i.test(src), `${f} says finding`);
  }
  for (const id of CONFIG_IDS) {
    const text = JSON.stringify(runScenario(id, { seed: 1 }).alerts);
    assert.ok(!/finding|manipulation|guilty|violation/i.test(text));
  }
});

test('no real exchange, broker, token or person is named in engine code or generated data', () => {
  const real = ['binance', 'coinbase', 'kraken', 'nasdaq', 'nyse', 'bitcoin', 'ethereum', 'tether', 'usdt', 'idx.co', 'bursa', 'robinhood', 'sec.gov', 'ojk'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
    for (const w of real) assert.ok(!src.includes(w), `${f} names ${w}`);
  }
  for (const id of CONFIG_IDS) {
    const r = runScenario(id, { seed: 1 });
    const text = JSON.stringify([r.market, r.register]).toLowerCase();
    for (const w of real) assert.ok(!text.includes(w));
    assert.ok(r.market.instruments.every((d) => /fictional/.test(d.name)), 'instrument names are marked fictional');
  }
});

test('every threshold lives in DEFAULTS and the rules read nothing else', () => {
  const rules = fs.readFileSync(path.join(dir, 'rules.js'), 'utf8');
  const used = new Set([...rules.matchAll(/\bth\.([A-Za-z0-9]+)/g)].map((m) => m[1]));
  for (const id of CONFIG_IDS) for (const k of used) assert.ok(k in DEFAULTS.thresholds[id], `${id} default missing: ${k}`);
  for (const id of CONFIG_IDS) for (const k of Object.keys(DEFAULTS.thresholds[id])) assert.ok(used.has(k), `${id} default never used: ${k}`);
});

test('performance: generate + detect + score one config fresh in under 1.5 s', () => {
  for (const id of CONFIG_IDS) {
    const t0 = process.hrtime.bigint();
    runScenario(id, { seed: 1, fresh: true });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1500, `${id} took ${ms} ms`);
  }
});

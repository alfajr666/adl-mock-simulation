/*
 * Measured "tells": simple rules that separate planted accounts from honest ones, measured over many seeds.
 * These are disclosed weaknesses of the scenario, not detector features. Nothing here is read by the rules.
 *
 *  registerTells: rules over the account register alone (and the linkage it implies).
 *  tapeTells:     rules over the trade tape alone.
 *
 * Targets are scored separately: `ringPump` (wash ring + pump group accounts) and `makerSubs` (the two same-owner
 * maker sub-accounts). Honest accounts are everything else. Makers are excluded from the tape tells by register
 * type (`market_maker`), not inferred from the tape.
 */
import { buildLinkage } from './linkage.js';

const POOL_VALUE = /-S\d/;                       // values drawn from the background pools carry this marker

function scoreRule(flaggedSet, targetSet, universe) {
  const flagged = [...flaggedSet];
  const tp = flagged.filter((a) => targetSet.has(a)).length;
  const base = [...universe].filter((a) => targetSet.has(a)).length;
  return { flagged: flagged.length, tp, base, universe: universe.size };
}

function registerRules(register, roles) {
  const rows = register.rows;
  const accts = rows.map((r) => r.acct);
  const rules = {};
  for (const policy of ['strong1', 'weak2', 'weak1']) {
    const l = buildLinkage(register, policy);
    for (let k = 2; k <= 5; k++) rules[`${policy}: cluster size >= ${k}`] = new Set(accts.filter((a) => l.clusters.some((c) => c.accounts.length >= k && c.accounts.includes(a))));
  }
  const count = {};
  for (const a of register.schema) {
    const m = new Map();
    for (const r of rows) m.set(r.attributes[a.key], (m.get(r.attributes[a.key]) || 0) + 1);
    count[a.key] = m;
    rules[`shares ${a.key}`] = new Set(rows.filter((r) => m.get(r.attributes[a.key]) > 1).map((r) => r.acct));
  }
  const l = buildLinkage(register, 'weak2');
  const weakOnly = (e) => e.shared.every((x) => x.strength === 'weak');
  const hasStrong = (e) => e.shared.some((x) => x.strength === 'strong');
  const linked = l.edges.filter((e) => e.linked);
  rules['weak2: cluster holds a strong link and a weak-only link'] = new Set(l.clusters.filter((c) => c.edges.some(hasStrong) && c.edges.some(weakOnly)).flatMap((c) => c.accounts));
  const strongPartner = new Set(linked.filter(hasStrong).flatMap((e) => [e.a, e.b]));
  const weakPartner = new Set(linked.filter(weakOnly).flatMap((e) => [e.a, e.b]));
  rules['weak2: has a strong partner and a weak-only partner'] = new Set(accts.filter((a) => strongPartner.has(a) && weakPartner.has(a)));
  rules['shares two or more attributes with one other account'] = new Set(l.edges.filter((e) => e.shared.length >= 2).flatMap((e) => [e.a, e.b]));
  for (const k of [2, 3, 4]) {
    rules[`an attribute value used by exactly ${k} accounts`] = new Set(rows.filter((r) => register.schema.some((a) => count[a.key].get(r.attributes[a.key]) === k)).map((r) => r.acct));
  }
  rules['shares a value that is not from a background pool'] = new Set(rows.filter((r) => register.schema.some((a) => count[a.key].get(r.attributes[a.key]) > 1 && !POOL_VALUE.test(r.attributes[a.key]))).map((r) => r.acct));
  return rules;
}

/** Register tells over seeds. `build(seed)` returns a scenario (register + truth), no simulation needed. */
export function registerTellStudy(build, seeds) {
  const acc = {};
  for (const seed of seeds) {
    const scn = build(seed);
    const roles = scn.truth.roles;
    const universe = new Set(scn.register.rows.map((r) => r.acct));
    const targets = {
      ringPump: new Set([...universe].filter((a) => /^planted-(wash|pump)/.test(roles[a]))),
      makerSubs: new Set([...universe].filter((a) => roles[a] === 'planted-maker-sub-account')),
    };
    for (const [rule, set] of Object.entries(registerRules(scn.register, roles))) {
      for (const [t, ts] of Object.entries(targets)) {
        const r = scoreRule(set, ts, universe);
        const k = `${rule}|${t}`;
        const a = (acc[k] ||= { rule, target: t, flagged: 0, tp: 0, base: 0, universe: 0 });
        a.flagged += r.flagged; a.tp += r.tp; a.base += r.base; a.universe += r.universe;
      }
    }
  }
  return Object.values(acc).map((a) => ({ rule: a.rule, target: a.target, flagged: a.flagged, precision: a.flagged ? a.tp / a.flagged : null, recall: a.base ? a.tp / a.base : null, baseRate: a.tp === undefined ? null : a.base / a.universe }));
}

/** Tape tells over seeds. `run(seed)` returns a full runScenario result. */
export function tapeTellStudy(run, seeds, { share = 0.65, floorTrades = 20 } = {}) {
  const acc = { busiest: { flagged: 0, tp: 0, base: 0, universe: 0 } };
  const stat = { planted: { size: [], top: [], busy: [] }, honest: { size: [], top: [], busy: [] } };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  for (const seed of seeds) {
    const r = run(seed);
    const roles = r.groundTruth.accountRoles;
    const maker = new Set(r.register.rows.filter((x) => x.type === 'market_maker').map((x) => x.acct));
    const per = new Map();
    for (const t of r.tape.trades) {
      for (const [a, other] of [[t.buyAcct, t.sellAcct], [t.sellAcct, t.buyAcct]]) {
        if (maker.has(a)) continue;
        let p = per.get(a);
        if (!p) { p = { n: 0, qty: 0, inst: new Map(), cp: new Map() }; per.set(a, p); }
        p.n++; p.qty += t.qty;
        p.inst.set(t.inst, (p.inst.get(t.inst) || 0) + t.qty);
        p.cp.set(other, (p.cp.get(other) || 0) + t.qty);
      }
    }
    const lot = Object.fromEntries(r.market.instruments.map((d) => [d.id, d.lotSize]));
    const universe = r.register.rows.map((x) => x.acct).filter((a) => !maker.has(a));
    let flagged = 0, tp = 0, base = 0;
    for (const a of universe) {
      const planted = /^planted-(wash|pump)/.test(roles[a]);
      if (planted) base++;
      const p = per.get(a);
      if (!p) continue;
      const busy = Math.max(...p.inst.values()) / p.qty;
      const top = Math.max(...p.cp.values()) / p.qty;
      const lotSize = lot[[...p.inst.keys()][0]];
      const g = planted ? stat.planted : stat.honest;
      if (p.n >= floorTrades) { g.busy.push(busy); g.top.push(top); g.size.push(p.qty / p.n / lotSize); }
      if (p.n >= floorTrades && busy >= share) { flagged++; if (planted) tp++; }
    }
    acc.busiest.flagged += flagged; acc.busiest.tp += tp; acc.busiest.base += base; acc.busiest.universe += universe.length;
  }
  const b = acc.busiest;
  return {
    method: `Makers excluded by register type. Each account's trades are counted on both sides. Floor: at least ${floorTrades} trades. Flag: busiest-instrument share of the account's quantity >= ${share}. Target: wash ring + pump group accounts.`,
    busiestInstrumentShare: { threshold: share, floorTrades, flagged: b.flagged, precision: b.flagged ? b.tp / b.flagged : null, recall: b.base ? b.tp / b.base : null, baseRate: b.base / b.universe },
    medians: {
      plantedAccounts: { busiestShare: med(stat.planted.busy), topCounterpartyShare: med(stat.planted.top), meanTradeSizeLots: med(stat.planted.size) },
      honestAccounts: { busiestShare: med(stat.honest.busy), topCounterpartyShare: med(stat.honest.top), meanTradeSizeLots: med(stat.honest.size) },
    },
  };
}

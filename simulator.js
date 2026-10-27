/*
 * ADL risk simulator
 *
 * This module is deliberately independent of the DOM. It is the only source
 * of financial truth for the browser walkthrough and the Node fixture tests.
 * Money, prices, and quantities use a small exact rational type so rounded UI
 * values never affect ranking or settlement.
 */

const MODEL_VERSION = 'adl-model-1.0.0';

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

export class Rat {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new Error('Division by zero');
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const divisor = gcd(numerator, denominator);
    this.n = numerator / divisor;
    this.d = denominator / divisor;
  }

  static from(value) {
    if (value instanceof Rat) return value;
    if (typeof value === 'bigint') return new Rat(value);
    const text = String(value).trim();
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid number: ${value}`);
    const negative = text.startsWith('-');
    const unsigned = text.replace(/^[-+]/, '');
    const [whole, fraction = ''] = unsigned.split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
    return new Rat(negative ? -numerator : numerator, denominator);
  }

  add(other) { other = Rat.from(other); return new Rat(this.n * other.d + other.n * this.d, this.d * other.d); }
  sub(other) { other = Rat.from(other); return new Rat(this.n * other.d - other.n * this.d, this.d * other.d); }
  mul(other) { other = Rat.from(other); return new Rat(this.n * other.n, this.d * other.d); }
  div(other) { other = Rat.from(other); return new Rat(this.n * other.d, this.d * other.n); }
  neg() { return new Rat(-this.n, this.d); }
  abs() { return this.n < 0n ? this.neg() : this; }
  isZero() { return this.n === 0n; }
  isNegative() { return this.n < 0n; }
  isPositive() { return this.n > 0n; }
  cmp(other) {
    other = Rat.from(other);
    const difference = this.n * other.d - other.n * this.d;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  min(other) { return this.cmp(other) <= 0 ? this : Rat.from(other); }
  max(other) { return this.cmp(other) >= 0 ? this : Rat.from(other); }
  toNumber() { return Number(this.n) / Number(this.d); }
  decimal(places = 2) {
    const scale = 10n ** BigInt(places);
    const negative = this.n < 0n;
    const absolute = this.n < 0n ? -this.n : this.n;
    const rounded = (absolute * scale + this.d / 2n) / this.d;
    const whole = rounded / scale;
    const fraction = String(rounded % scale).padStart(places, '0');
    return `${negative ? '-' : ''}${whole}${places ? `.${fraction}` : ''}`;
  }
  json() { return { n: this.n.toString(), d: this.d.toString() }; }
}

const r = Rat.from;
const ratFromJson = (value) => value ? new Rat(BigInt(value.n), BigInt(value.d)) : null;

const position = (id, label, side, qty, entry, collateral, extra = {}) => ({
  id, label, side, qty: String(qty), entry: String(entry), collateral: String(collateral), ...extra,
});

const F01_POSITIONS = [
  position('D', 'Designated default', 'SHORT', 10, 100, 100),
  position('M', 'Market counterparty', 'LONG', 4, 100, 160),
  position('A', 'ADL candidate A', 'LONG', 6, 100, 200),
  position('B', 'ADL candidate B', 'LONG', 4, 100, 200),
  position('H', 'Balancing short', 'SHORT', 4, 100, 200),
];

const F05_POSITIONS = [
  position('D', 'Designated default', 'SHORT', 10, 100, 100),
  position('M', 'Market counterparty', 'LONG', 4, 100, 160),
  position('A', 'ADL candidate A', 'LONG', 6, 80, 120),
  position('SA', 'A opening counterparty', 'SHORT', 6, 80, 1000),
  position('B', 'ADL candidate B', 'LONG', 4, 110, 60),
  position('SB', 'B opening counterparty', 'SHORT', 4, 110, 1000),
  position('C', 'ADL candidate C', 'LONG', 6, 100, 600),
];

const PRESETS = {
  partial: {
    id: 'partial', label: 'Partial insurance · guided example', shortLabel: 'Partial insurance',
    description: 'A 100 USDT shortfall is split between a 40 USDT insurance contribution and a 60 USDT ADL settlement adjustment.',
    openingMark: '100', shockMark: '120', fund: '40', positions: F01_POSITIONS,
    marketOrder: ['M', 'A', 'B'], defaultId: 'D', policy: 'reference',
  },
  sufficient: {
    id: 'sufficient', label: 'Insurance covers the loss', shortLabel: 'Sufficient insurance',
    description: 'The same liquidation is fully funded. ADL never needs to fire.',
    openingMark: '100', shockMark: '120', fund: '150', positions: F01_POSITIONS,
    marketOrder: ['M', 'A', 'B'], defaultId: 'D', policy: 'reference',
  },
  none: {
    id: 'none', label: 'No insurance available', shortLabel: 'No insurance',
    description: 'The full deficit is allocated through bankruptcy-price settlement.',
    openingMark: '100', shockMark: '120', fund: '0', positions: F01_POSITIONS,
    marketOrder: ['M', 'A', 'B'], defaultId: 'D', policy: 'reference',
  },
  falling: {
    id: 'falling', label: 'Falling market · long default', shortLabel: 'Long default',
    description: 'The mirrored case: a long defaults as the mark moves from 100 to 80.',
    openingMark: '100', shockMark: '80', fund: '40', positions: F01_POSITIONS.map((p) => ({
      ...p, side: p.side === 'LONG' ? 'SHORT' : 'LONG',
    })), marketOrder: ['M', 'A', 'B'], defaultId: 'D', policy: 'reference',
  },
  comparison: {
    id: 'comparison', label: 'Compare allocation policies', shortLabel: 'Policy comparison',
    description: 'Identical positions and deficit, with two queue policies shown side by side.',
    openingMark: '100', shockMark: '120', fund: '40', positions: F05_POSITIONS,
    marketOrder: ['M', 'C', 'A', 'B'], defaultId: 'D', policy: 'reference',
  },
  unresolved: {
    id: 'unresolved', label: 'Insufficient ADL capacity', shortLabel: 'Unresolved capacity',
    description: 'A named synthetic capacity cap leaves one unit and 10 USDT unresolved.',
    openingMark: '100', shockMark: '120', fund: '40', positions: F01_POSITIONS,
    marketOrder: ['M', 'A', 'B'], defaultId: 'D', policy: 'reference', caps: { A: '2', B: '3' },
  },
};

const clonePreset = (presetId) => {
  const source = PRESETS[presetId] || PRESETS.partial;
  return JSON.parse(JSON.stringify(source));
};

function sideSign(side) { return side === 'LONG' ? r(1) : r(-1); }
function positionPnl(pos, mark) { return sideSign(pos.side).mul(pos.remainingQty).mul(mark.sub(pos.entry)); }
function currentNotional(pos, mark) { return pos.remainingQty.mul(mark); }
function equity(pos, mark) { return pos.cash.add(positionPnl(pos, mark)); }
function maintenance(pos, mark, rate) { return currentNotional(pos, mark).mul(rate); }

function serializeRat(value) { return value instanceof Rat ? value.json() : value; }
function plainNumber(value, places = 2) { return Rat.from(value).decimal(places); }

function derivedPosition(run, pos) {
  const mark = run.mark;
  const pnl = positionPnl(pos, mark);
  const notional = currentNotional(pos, mark);
  const accountEquity = equity(pos, mark);
  const maint = maintenance(pos, mark, run.maintenanceRate);
  const effectiveLeverage = accountEquity.isPositive() && !pos.remainingQty.isZero()
    ? notional.div(accountEquity) : null;
  const profitRatio = notional.isPositive() ? pnl.div(notional) : null;
  const referenceScore = pnl.isPositive() && effectiveLeverage
    ? profitRatio.mul(effectiveLeverage) : null;
  const leverageScore = pnl.isPositive() && effectiveLeverage ? effectiveLeverage : null;
  return {
    ...pos,
    pnl, notional, equity: accountEquity, maintenance: maint,
    effectiveLeverage, profitRatio, referenceScore, leverageScore,
    healthy: accountEquity.cmp(maint) > 0,
    maintenanceBreached: accountEquity.cmp(maint) <= 0,
    status: pos.remainingQty.isZero() ? 'CLOSED' : pos.status,
  };
}

function refresh(run) {
  run.views = Object.fromEntries(run.positions.map((pos) => [pos.id, derivedPosition(run, pos)]));
  run.defaultView = run.views[run.defaultId];
  run.deficit = run.grossDeficit || r(0);
  run.fundRemaining = run.fund.cash;
  run.remainingDefaultQty = run.defaultView?.remainingQty || r(0);
  run.remainingDeficit = run.remainingDefaultQty.mul(run.shortfallPerUnit || r(0));
  run.ledgerBalance = run.positions.reduce((sum, pos) => sum.add(positionPnl(pos, run.mark)), r(0));
  return run;
}

function openingBookError(run) {
  const longQty = run.positions.filter((p) => p.side === 'LONG').reduce((sum, p) => sum.add(p.initialQty), r(0));
  const shortQty = run.positions.filter((p) => p.side === 'SHORT').reduce((sum, p) => sum.add(p.initialQty), r(0));
  const longValue = run.positions.filter((p) => p.side === 'LONG').reduce((sum, p) => sum.add(p.initialQty.mul(p.entry)), r(0));
  const shortValue = run.positions.filter((p) => p.side === 'SHORT').reduce((sum, p) => sum.add(p.initialQty.mul(p.entry)), r(0));
  if (longQty.cmp(shortQty) !== 0) return 'Opening long and short quantities must balance.';
  if (longValue.cmp(shortValue) !== 0) return 'Opening signed entry value must balance.';
  if (run.positions.some((p) => equity(p, run.openingMark).cmp(maintenance(p, run.openingMark, run.maintenanceRate)) <= 0)) {
    return 'Every opening position must be healthy at the opening mark.';
  }
  return null;
}

function snapshot(run) {
  return {
    stage: run.stage, mark: run.mark.json(), fundRemaining: run.fund.cash.json(),
    remainingDeficit: run.remainingDeficit.json(), positions: run.positions.map((pos) => ({
      id: pos.id, side: pos.side, qty: pos.remainingQty.json(), cash: pos.cash.json(), status: pos.status,
    })),
  };
}

function addEvent(run, type, title, detail, postings = []) {
  run.events.push({ id: `${run.events.length + 1}`, type, title, detail, postings, snapshot: snapshot(run) });
}

function moveCash(run, pos, amount) {
  pos.cash = pos.cash.add(amount);
}

function matchPositions(run, counterpartyId, quantity, settlementPrice, type) {
  const defaultPos = run.positions.find((p) => p.id === run.defaultId);
  const counterparty = run.positions.find((p) => p.id === counterpartyId);
  if (!defaultPos || !counterparty || quantity.isZero()) return r(0);
  const defaultDelta = sideSign(defaultPos.side).mul(quantity).mul(settlementPrice.sub(defaultPos.entry));
  const counterDelta = sideSign(counterparty.side).mul(quantity).mul(settlementPrice.sub(counterparty.entry));
  moveCash(run, defaultPos, defaultDelta);
  moveCash(run, counterparty, counterDelta);
  defaultPos.realized = defaultPos.realized.add(defaultDelta);
  counterparty.realized = counterparty.realized.add(counterDelta);
  defaultPos.remainingQty = defaultPos.remainingQty.sub(quantity);
  counterparty.remainingQty = counterparty.remainingQty.sub(quantity);
  const adjustment = counterparty.side === 'LONG'
    ? quantity.mul(run.mark.sub(settlementPrice))
    : quantity.mul(settlementPrice.sub(run.mark));
  addEvent(run, type, `${counterparty.label} matched ${plainNumber(quantity, 6)} units`,
    `${type === 'MARKET' ? 'Market settlement' : 'ADL settlement'} at ${plainNumber(settlementPrice)}.`, [
      { account: defaultPos.id, cashDelta: defaultDelta.json() },
      { account: counterparty.id, cashDelta: counterDelta.json() },
      { account: 'clearing', cashDelta: adjustment.neg().json(), markRelativeAdjustment: adjustment.json() },
    ]);
  if (type === 'ADL') run.adlAdjustment = run.adlAdjustment.add(adjustment);
  return adjustment;
}

function eligible(run) {
  const defaultPos = run.views[run.defaultId];
  if (!defaultPos) return [];
  return run.positions.map((p) => run.views[p.id]).filter((p) => p.id !== defaultPos.id && p.side !== defaultPos.side
    && !p.remainingQty.isZero() && p.pnl.isPositive() && p.equity.isPositive()
    && !p.maintenanceBreached && p.status === 'OPEN');
}

function rankCandidates(run) {
  const scoreKey = run.policy === 'leverage' ? 'leverageScore' : 'referenceScore';
  return eligible(run).sort((a, b) => {
    const scoreA = a[scoreKey] || r(0);
    const scoreB = b[scoreKey] || r(0);
    const comparison = scoreB.cmp(scoreA);
    return comparison || a.id.localeCompare(b.id);
  });
}

function calculateBankruptcyPrice(defaultPos) {
  const movement = defaultPos.collateral.div(defaultPos.initialQty);
  return defaultPos.side === 'SHORT' ? defaultPos.entry.add(movement) : defaultPos.entry.sub(movement);
}

function createRun(presetId = 'partial', policy) {
  const preset = clonePreset(presetId);
  const run = {
    modelVersion: MODEL_VERSION, presetId, policy: policy || preset.policy || 'reference',
    stage: 'SETUP', openingMark: r(preset.openingMark), mark: r(preset.openingMark), shockMark: r(preset.shockMark),
    maintenanceRate: r('0.01'), defaultId: preset.defaultId, marketOrder: preset.marketOrder,
    caps: Object.fromEntries(Object.entries(preset.caps || {}).map(([id, value]) => [id, r(value)])),
    fund: { opening: r(preset.fund), cash: r(preset.fund) },
    positions: preset.positions.map((source) => ({
      ...source, initialQty: r(source.qty), remainingQty: r(source.qty), entry: r(source.entry),
      collateral: r(source.collateral), cash: r(source.collateral), realized: r(0), status: 'OPEN',
    })), events: [], grossDeficit: r(0), fundContribution: r(0), adlAdjustment: r(0),
    bankruptcyPrice: null, shortfallPerUnit: r(0), marketQuantity: r(0), adlQuantity: r(0),
    initialResources: preset.positions.reduce((sum, pos) => sum.add(r(pos.collateral)), r(preset.fund)),
  };
  const error = openingBookError(run);
  if (error) {
    run.stage = 'BLOCKED'; run.blockedReason = error;
  }
  return refresh(run);
}

function shock(run) {
  if (run.stage !== 'SETUP') return run;
  run.mark = run.shockMark;
  refresh(run);
  const breached = run.positions.filter((p) => run.views[p.id].maintenanceBreached);
  const defaultPos = run.views[run.defaultId];
  if (breached.length !== 1 || breached[0].id !== run.defaultId) {
    run.stage = 'BLOCKED';
    run.blockedReason = breached.length > 1 ? 'This release models one designated default; the shock breaches multiple accounts.' : 'The designated account is healthy at this shock; no liquidation is available.';
    addEvent(run, 'BLOCKED', 'Settlement paused', run.blockedReason);
    return refresh(run);
  }
  run.bankruptcyPrice = calculateBankruptcyPrice(run.positions.find((p) => p.id === run.defaultId));
  run.shortfallPerUnit = defaultPos.side === 'LONG'
    ? run.bankruptcyPrice.sub(run.mark).max(r(0)) : run.mark.sub(run.bankruptcyPrice).max(r(0));
  run.grossDeficit = defaultPos.equity.isNegative() ? defaultPos.equity.neg() : r(0);
  run.stage = 'SHOCKED';
  addEvent(run, 'SHOCK', 'Market shock applied', `Mark moved to ${plainNumber(run.mark)}. ${defaultPos.label} equity is ${plainNumber(defaultPos.equity)}.`);
  return refresh(run);
}

function assess(run) {
  if (run.stage !== 'SHOCKED') return run;
  const defaultPos = run.positions.find((p) => p.id === run.defaultId);
  defaultPos.status = 'DEFAULTED';
  run.fundContribution = run.fund.cash.min(run.grossDeficit);
  run.marketQuantity = run.shortfallPerUnit.isZero() ? defaultPos.remainingQty : run.fundContribution.div(run.shortfallPerUnit).min(defaultPos.remainingQty);
  run.adlQuantity = defaultPos.remainingQty.sub(run.marketQuantity);
  run.stage = 'ASSESSED';
  addEvent(run, 'ASSESSMENT', 'Deficit assessed', `Gross deficit ${plainNumber(run.grossDeficit)}. Insurance plans ${plainNumber(run.fundContribution)}; ${plainNumber(run.adlQuantity, 6)} units remain for ADL.`);
  return refresh(run);
}

function settleInsurance(run) {
  if (run.stage !== 'ASSESSED') return run;
  if (!run.fundContribution.isZero()) {
    run.fund.cash = run.fund.cash.sub(run.fundContribution);
    moveCash(run, run.positions.find((p) => p.id === run.defaultId), run.fundContribution);
    addEvent(run, 'INSURANCE', 'Insurance contribution posted', `${plainNumber(run.fundContribution)} transferred to the default account.`, [
      { account: 'insurance-fund', cashDelta: run.fundContribution.neg().json() },
      { account: run.defaultId, cashDelta: run.fundContribution.json() },
    ]);
  }
  let remaining = run.marketQuantity;
  for (const id of run.marketOrder) {
    if (remaining.isZero()) break;
    const counterparty = run.positions.find((p) => p.id === id);
    if (!counterparty || counterparty.side === run.positions.find((p) => p.id === run.defaultId).side) continue;
    const quantity = remaining.min(counterparty.remainingQty);
    matchPositions(run, id, quantity, run.mark, 'MARKET');
    remaining = remaining.sub(quantity);
  }
  if (!remaining.isZero()) {
    run.stage = 'BLOCKED'; run.blockedReason = 'The declared market-counterparty schedule cannot fund the planned tranche.';
    addEvent(run, 'BLOCKED', 'Market capacity unavailable', run.blockedReason);
    return refresh(run);
  }
  run.stage = 'MARKET_SETTLED';
  addEvent(run, 'MARKET_SETTLED', 'Insurance-supported tranche settled', `${plainNumber(run.marketQuantity, 6)} units matched at the shocked mark.`);
  return refresh(run);
}

function prepareAdl(run) {
  if (run.stage !== 'MARKET_SETTLED') return run;
  run.stage = run.adlQuantity.isZero() ? 'RESOLVED' : 'ADL_READY';
  const scoreKey = run.policy === 'leverage' ? 'leverageScore' : 'referenceScore';
  run.queue = rankCandidates(run).map((p, index) => ({
    id: p.id,
    rank: index + 1,
    score: p[scoreKey]?.json() || null,
    leverage: p.effectiveLeverage?.json() || null,
  }));
  addEvent(run, run.adlQuantity.isZero() ? 'RESOLVED' : 'ADL_READY', run.adlQuantity.isZero() ? 'Insurance covered the deficit' : 'ADL queue frozen', run.adlQuantity.isZero() ? 'No counterparty adjustment was required.' : `${run.queue.length} eligible simulated accounts; ranking is frozen for this run.`);
  return refresh(run);
}

function settleNextAdl(run) {
  if (run.stage === 'ADL_READY') run.stage = 'ADL_IN_PROGRESS';
  if (run.stage !== 'ADL_IN_PROGRESS') return run;
  const defaultPos = run.positions.find((p) => p.id === run.defaultId);
  const candidates = rankCandidates(run);
  const next = candidates.find((p) => !p.remainingQty.isZero() && (run.caps[p.id] === undefined || run.caps[p.id].isPositive()));
  if (!next || defaultPos.remainingQty.isZero()) {
    run.stage = run.remainingDeficit.isZero() ? 'RESOLVED' : 'UNRESOLVED';
    addEvent(run, run.stage, run.stage === 'RESOLVED' ? 'ADL sequence complete' : 'ADL capacity exhausted', run.stage === 'RESOLVED' ? 'The deficit is fully allocated.' : `${plainNumber(run.remainingDefaultQty, 6)} default units and ${plainNumber(run.remainingDeficit)} remain unresolved.`);
    return refresh(run);
  }
  const cap = run.caps[next.id] || next.remainingQty;
  const quantity = cap.min(next.remainingQty).min(defaultPos.remainingQty).min(run.adlQuantity.sub(run.adlAdjustment.div(run.shortfallPerUnit).max(r(0))));
  if (quantity.isZero()) {
    run.caps[next.id] = r(0);
    return settleNextAdl(run);
  }
  matchPositions(run, next.id, quantity, run.bankruptcyPrice, 'ADL');
  if (run.caps[next.id] !== undefined) run.caps[next.id] = run.caps[next.id].sub(quantity);
  if (run.remainingDefaultQty.isZero() || run.remainingDeficit.isZero()) run.stage = 'RESOLVED';
  return refresh(run);
}

export function advance(run) {
  if (run.stage === 'SETUP') return shock(run);
  if (run.stage === 'SHOCKED') return assess(run);
  if (run.stage === 'ASSESSED') return settleInsurance(run);
  if (run.stage === 'MARKET_SETTLED') return prepareAdl(run);
  if (run.stage === 'ADL_READY' || run.stage === 'ADL_IN_PROGRESS') return settleNextAdl(run);
  return run;
}

export function runToEnd(run) {
  let guard = 0;
  while (!['RESOLVED', 'UNRESOLVED', 'BLOCKED'].includes(run.stage) && guard < 100) {
    advance(run); guard += 1;
  }
  return run;
}

export function comparePolicies(presetId = 'comparison') {
  const reference = runToEnd(createRun(presetId, 'reference'));
  const leverage = runToEnd(createRun(presetId, 'leverage'));
  return { reference, leverage };
}

export function checkInvariants(run) {
  const equityTotal = run.positions.reduce((sum, p) => sum.add(equity(p, run.mark)), r(0)).add(run.fund.cash);
  const opening = run.initialResources;
  const signedQty = run.positions.reduce((sum, p) => sum.add(sideSign(p.side).mul(p.remainingQty)), r(0));
  const issues = [];
  if (equityTotal.cmp(opening) !== 0) issues.push(`Resources do not reconcile: ${plainNumber(equityTotal)} vs ${plainNumber(opening)}.`);
  if (!run.fund.cash.isNegative() && !run.fund.cash.isZero()) {
    // no-op: this branch makes the non-negative condition explicit for readers
  } else if (run.fund.cash.isNegative()) issues.push('Insurance fund is negative.');
  if (signedQty.isNegative() || signedQty.isPositive()) issues.push(`Remaining signed quantity is ${plainNumber(signedQty, 6)}.`);
  return { ok: issues.length === 0, issues, equityTotal, signedQty };
}

export function viewModel(run) {
  refresh(run);
  const invariant = checkInvariants(run);
  const queue = run.queue?.length
    ? run.queue.map((item) => {
      const p = run.views[item.id];
      return { id: p.id, label: p.label, rank: item.rank, score: ratFromJson(item.score)?.decimal(6) || null, leverage: ratFromJson(item.leverage)?.decimal(4) || null, pnl: p.pnl.decimal(2), equity: p.equity.decimal(2), quantity: p.remainingQty.decimal(6) };
    })
    : rankCandidates(run).map((p, index) => {
      const score = run.policy === 'leverage' ? p.leverageScore : p.referenceScore;
      return { id: p.id, label: p.label, rank: index + 1, score: score?.decimal(6) || null, leverage: p.effectiveLeverage?.decimal(4) || null, pnl: p.pnl.decimal(2), equity: p.equity.decimal(2), quantity: p.remainingQty.decimal(6) };
    });
  return {
    modelVersion: run.modelVersion, presetId: run.presetId, policy: run.policy, stage: run.stage,
    mark: run.mark.decimal(2), openingMark: run.openingMark.decimal(2), shockMark: run.shockMark.decimal(2),
    fund: { opening: run.fund.opening.decimal(2), remaining: run.fund.cash.decimal(2), contribution: run.fundContribution.decimal(2) },
    deficit: { gross: run.grossDeficit.decimal(2), remaining: run.remainingDeficit.decimal(2), shortfallPerUnit: run.shortfallPerUnit.decimal(2), marketQty: run.marketQuantity.decimal(6), adlQty: run.adlQuantity.decimal(6), adjustment: run.adlAdjustment.decimal(2) },
    bankruptcyPrice: run.bankruptcyPrice?.decimal(2) || null, blockedReason: run.blockedReason || null,
    queue, events: run.events, invariant: { ok: invariant.ok, issues: invariant.issues, equityTotal: invariant.equityTotal.decimal(2), signedQty: invariant.signedQty.decimal(6) },
    positions: run.positions.map((p) => { const v = run.views[p.id]; return {
      id: p.id, label: p.label, side: p.side, status: v.status, initialQty: p.initialQty.decimal(6), quantity: p.remainingQty.decimal(6), matchedQuantity: p.initialQty.sub(p.remainingQty).decimal(6), entry: p.entry.decimal(2), cash: p.cash.decimal(2), pnl: v.pnl.decimal(2), equity: v.equity.decimal(2), maintenance: v.maintenance.decimal(2), leverage: v.effectiveLeverage?.decimal(4) || null, realized: p.realized.decimal(2),
    }; }),
  };
}

export { MODEL_VERSION, PRESETS, clonePreset, createRun, refresh, plainNumber };

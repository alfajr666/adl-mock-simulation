/*
 * "equity" configuration: a lot-100, daily-band equity board (loosely after Indonesian
 * market conventions; fictional names, codes end in .SIM). Lot size, tick units and a
 * +-20% daily band on the previous close, applied to limit and market orders alike.
 * Not a reproduction of any real exchange's rules.
 *
 * 6 sessions of 300 simulated minutes (5-minute steps, 30-minute bins).
 * Session 0 is a clean warm-up used as the baseline period.
 */
import { buildRoster } from './scenario-common.js';

export const EQUITY_SCHEMA = {
  ownerAttr: 'beneficialOwnerId',
  attributes: [
    { key: 'beneficialOwnerId', label: 'Declared beneficial owner', strength: 'strong', prefix: 'BO',
      rationale: 'Accounts declared under one beneficial owner are the same economic actor.',
      caveat: 'Sharing it is identity, not a link between two parties. Legitimate for market-maker sub-accounts; it says nothing about intent.' },
    { key: 'fundingAccount', label: 'Funding bank account', strength: 'strong', prefix: 'FA',
      rationale: 'Money for both accounts comes from one bank account.',
      caveat: 'Family members and employer or joint accounts also share a funding source and may be unrelated traders.' },
    { key: 'brokerBranch', label: 'Broker / branch', strength: 'weak', prefix: 'BR',
      rationale: 'Opened or serviced at the same branch.',
      caveat: 'Very weak: a handful of branches serve hundreds of unrelated clients. Alone it links almost everyone.' },
    { key: 'device', label: 'Trading device', strength: 'weak', prefix: 'DV',
      rationale: 'The same terminal or phone placed orders for both accounts.',
      caveat: 'Shared households, offices and internet cafes use one device for unrelated people.' },
  ],
};

export function buildEquity(seed) {
  const roster = buildRoster(seed, {
    schema: EQUITY_SCHEMA, retailCount: 40, momentumCount: 12, secondMm: false,
    link(reg, k) {
      // background collisions: 7 branches serve everyone; some devices are shared
      reg.drawPool(k.all, 'brokerBranch', 'BR', 0, [{ count: 7, weight: 1 }]);
      reg.drawPool(k.retail, 'device', 'DV', 0.88, [{ count: 4, weight: 1 }]);
      reg.share(['mm1-a', 'mm1-b'], 'beneficialOwnerId');                   // one declared owner: same-owner crosses
      reg.share(['ring-1', 'ring-2', 'ring-3'], 'fundingAccount');          // strong: same funding bank account
      reg.share(['ring-1', 'ring-4'], 'brokerBranch');                      // hub: weak + weak only
      reg.share(['ring-1', 'ring-4'], 'device');
      reg.share(['pump-1', 'pump-2', 'pump-3'], 'fundingAccount');
      reg.share(['retail-0', 'retail-1'], 'brokerBranch');                  // coincidence: one shared weak attribute
      reg.set('retail-0', 'device', 'DV-U00'); reg.set('retail-1', 'device', 'DV-U01');
      reg.share(['retail-4', 'retail-5'], 'fundingAccount');                // family pairs: unrelated traders, one strong attribute
      reg.share(['retail-6', 'retail-7'], 'fundingAccount');
      for (const pair of [['retail-8', 'retail-9'], ['retail-10', 'retail-11']]) { reg.share(pair, 'brokerBranch'); reg.share(pair, 'device'); }   // households
    },
  });

  const session = { days: 6, stepsPerDay: 60, stepMs: 300000, dayMs: 86400000, binSteps: 6, momentumSteps: 8, momentumK: 5 };
  const ins = (o) => ({ bandPct: 0.2, fatFinger: 0.004, followCap: 4, ...o });
  const instruments = [
    ins({ id: 'QFRO.SIM', name: 'Quefro Ironworks (fictional)', tickSize: 2, lotSize: 100, price0: 1200, volStep: 0.0012, fairPull: 0.35, retailWeight: 1.2, retailSpread: 3, retailLotsMax: 6, mmHalf: 2, mmGap: 2, mmLots: 8 }),
    ins({ id: 'VLDN.SIM', name: 'Valdane Thin Float Holdings (fictional)', tickSize: 1, lotSize: 100, price0: 1500, volStep: 0.0010, fairPull: 0.03, retailWeight: 0.8, retailSpread: 3, retailLotsMax: 4, mmHalf: 2, mmGap: 4, mmLots: 3, followCap: 3 }),
    ins({ id: 'TMRX.SIM', name: 'Tamarex Energy (fictional)', tickSize: 5, lotSize: 100, price0: 2100, volStep: 0.0015, fairPull: 0.35, retailWeight: 1.0, retailSpread: 4, retailLotsMax: 6, mmHalf: 3, mmGap: 3, mmLots: 8 }),
    ins({ id: 'NBLE.SIM', name: 'Nobile Foods (fictional)', tickSize: 5, lotSize: 100, price0: 3000, volStep: 0.0006, fairPull: 0.35, retailWeight: 0.5, retailSpread: 4, retailLotsMax: 5, mmHalf: 3, mmGap: 3, mmLots: 5 }),
    ins({ id: 'HZPK.SIM', name: 'Hazpak Mining (fictional)', tickSize: 5, lotSize: 100, price0: 2500, volStep: 0.0060, fairPull: 0.35, retailWeight: 2.5, retailSpread: 4, retailLotsMax: 6, mmHalf: 3, mmGap: 3, mmLots: 8 }),
  ];
  const allIds = instruments.map((i) => i.id);

  return {
    id: 'equity',
    label: 'Lot-100 daily-band equity board (synthetic, loosely after Indonesian market conventions)',
    session, instruments,
    register: roster.register,
    algos: roster.algos, algoP: 0.015,
    retail: { ...roster.retail, actProb: 0.3, newsActProb: 0.7, followProb: 0.5, followTriggerP: 0.3, followCooldown: 60, followHold: 18, marketProb: 0.12, ttl: [4, 14] },
    mm: [{ id: 'MM1', accts: roster.mmAccts.mm1, instruments: allIds, refreshSteps: 6, levels: 2 }],
    transfers: [
      { step: 140, inst: 'NBLE.SIM', from: roster.mmAccts.mm1[0], to: roster.mmAccts.mm1[1], lots: 7 },
      { step: 141, inst: 'NBLE.SIM', from: roster.mmAccts.mm1[1], to: roster.mmAccts.mm1[0], lots: 7 },
      { step: 335, inst: 'NBLE.SIM', from: roster.mmAccts.mm1[1], to: roster.mmAccts.mm1[0], lots: 7 },
    ],
    hype: [{ inst: 'VLDN.SIM', from: 235, to: 290, p: 0.15, lots: [1, 3] }],
    news: [{ inst: 'TMRX.SIM', step: 200, jump: 0.13, heatSteps: 12 }],
    ring: { accts: roster.ringAccts, hub: roster.ringHub, inst: 'QFRO.SIM', fromStep: 70, toStep: 290, actProb: 0.6, maxTrades: 2, lotsMin: 10, lotsMax: 18, spokeSpokeP: 0.15, selfP: 0.01, leakP: 0.08 },
    pump: {
      accts: roster.pumpAccts, inst: 'VLDN.SIM',
      accumulate: { from: 60, to: 150, p: 0.6, marketP: 0, lots: 4 },
      ramp: { from: 150, to: 240, gain: 0.3, p: 0.8, lots: [2, 3] },
      distribute: { from: 240, to: 340, passiveLots: 6, aggressiveLots: 0, cleanupFrom: 290, cleanupLots: 6 },
    },
    truth: {
      roles: roster.roles, controller: 'CTRL-1',
      falsePair: roster.falsePair, falseLinkAttribute: 'brokerBranch',
      familyPairs: roster.familyPairs, householdPairs: roster.householdPairs, algos: roster.algos,
      mmGroups: [roster.mmAccts.mm1],
      washInstrument: 'QFRO.SIM', pumpInstrument: 'VLDN.SIM', shockInstrument: 'TMRX.SIM', transferInstrument: 'NBLE.SIM',
      shockAftermathSteps: 90,
      roleOfInstrument: { 'QFRO.SIM': 'wash-target', 'VLDN.SIM': 'pump-target', 'TMRX.SIM': 'benign-shock', 'NBLE.SIM': 'clean-control-low-volatility', 'HZPK.SIM': 'clean-control-high-volatility' },
    },
  };
}

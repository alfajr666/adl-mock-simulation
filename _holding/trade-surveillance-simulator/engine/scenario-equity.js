/*
 * "equity" configuration: an IDX-style cash-equity market (fictional names).
 * Lot size, tick size and a daily price band relative to the previous close.
 * Not a reproduction of any real exchange's rules.
 *
 * 6 sessions of 300 simulated minutes (5-minute steps, 30-minute bins).
 * Session 0 is a clean warm-up used as the baseline period.
 */
import { buildRoster } from './scenario-common.js';

export const EQUITY_SCHEMA = {
  ownerAttr: 'beneficialOwnerId',
  attributes: [
    { key: 'beneficialOwnerId', label: 'Declared beneficial owner', strength: 'strong', prefix: 'BO' },
    { key: 'fundingAccount', label: 'Funding bank account', strength: 'strong', prefix: 'FA' },
    { key: 'brokerBranch', label: 'Broker / branch', strength: 'weak', prefix: 'BR' },
    { key: 'device', label: 'Trading device', strength: 'weak', prefix: 'DV' },
  ],
};

export function buildEquity(seed) {
  const roster = buildRoster(seed, {
    schema: EQUITY_SCHEMA, retailCount: 40, momentumCount: 12, secondMm: false,
    link(reg) {
      reg.share(['mm1-a', 'mm1-b'], 'beneficialOwnerId');                   // legitimate: one declared owner
      reg.share(['ring-1', 'ring-2', 'ring-3'], 'fundingAccount');          // strong: same funding bank account
      reg.share(['ring-1', 'ring-4'], 'brokerBranch');                      // weak + weak: hub linked only weakly
      reg.share(['ring-1', 'ring-4'], 'device');
      reg.share(['pump-1', 'pump-2', 'pump-3'], 'fundingAccount');
      reg.share(['retail-0', 'retail-1'], 'brokerBranch');                  // coincidence: same branch, nothing else
    },
  });

  const session = { days: 6, stepsPerDay: 60, stepMs: 300000, dayMs: 86400000, binSteps: 6, momentumSteps: 8, momentumK: 5 };
  const ins = (o) => ({ bandPct: 0.2, fatFinger: 0.004, followCap: 4, ...o });
  const instruments = [
    ins({ id: 'QFRO', name: 'Quefro Ironworks (fictional)', tickSize: 2, lotSize: 100, price0: 1200, volStep: 0.0012, fairPull: 0.35, retailWeight: 1.2, retailSpread: 3, retailLotsMax: 6, mmHalf: 2, mmGap: 2, mmLots: 8 }),
    ins({ id: 'VLDN', name: 'Valdane Thin Float Holdings (fictional)', tickSize: 1, lotSize: 100, price0: 1500, volStep: 0.0010, fairPull: 0.03, retailWeight: 0.8, retailSpread: 3, retailLotsMax: 4, mmHalf: 2, mmGap: 4, mmLots: 3, followCap: 3 }),
    ins({ id: 'TMRX', name: 'Tamarex Energy (fictional)', tickSize: 5, lotSize: 100, price0: 2100, volStep: 0.0015, fairPull: 0.35, retailWeight: 1.0, retailSpread: 4, retailLotsMax: 6, mmHalf: 3, mmGap: 3, mmLots: 8 }),
    ins({ id: 'NBLE', name: 'Nobile Foods (fictional)', tickSize: 5, lotSize: 100, price0: 3000, volStep: 0.0006, fairPull: 0.35, retailWeight: 0.5, retailSpread: 4, retailLotsMax: 5, mmHalf: 3, mmGap: 3, mmLots: 5 }),
    ins({ id: 'HZPK', name: 'Hazpak Mining (fictional)', tickSize: 5, lotSize: 100, price0: 2500, volStep: 0.0060, fairPull: 0.35, retailWeight: 2.5, retailSpread: 4, retailLotsMax: 6, mmHalf: 3, mmGap: 3, mmLots: 8 }),
  ];
  const allIds = instruments.map((i) => i.id);

  return {
    id: 'equity',
    label: 'IDX-style equity market (synthetic)',
    session, instruments,
    register: roster.register,
    retail: { ...roster.retail, actProb: 0.3, newsActProb: 0.7, followProb: 0.5, followTriggerP: 0.3, followCooldown: 60, followHold: 18, marketProb: 0.12, ttl: [4, 14] },
    mm: [{ id: 'MM1', accts: roster.mmAccts.mm1, instruments: allIds, refreshSteps: 6, levels: 2 }],
    transfers: [
      { step: 140, inst: 'NBLE', from: roster.mmAccts.mm1[0], to: roster.mmAccts.mm1[1], lots: 9 },
      { step: 141, inst: 'NBLE', from: roster.mmAccts.mm1[1], to: roster.mmAccts.mm1[0], lots: 9 },
      { step: 335, inst: 'NBLE', from: roster.mmAccts.mm1[1], to: roster.mmAccts.mm1[0], lots: 9 },
    ],
    hype: [{ inst: 'VLDN', from: 235, to: 290, p: 0.15, lots: [1, 3] }],
    news: [{ inst: 'TMRX', step: 200, jump: 0.13, heatSteps: 12 }],
    ring: { accts: roster.ringAccts, hub: roster.ringHub, inst: 'QFRO', fromStep: 70, toStep: 290, selfSteps: [100, 150, 210], actProb: 0.6, maxTrades: 2, lotsMin: 10, lotsMax: 18, spokeSpokeP: 0, selfP: 0.03, leakP: 0.08 },
    pump: {
      accts: roster.pumpAccts, inst: 'VLDN',
      accumulate: { from: 60, to: 150, p: 0.6, marketP: 0, lots: 4 },
      ramp: { from: 150, to: 240, gain: 0.3, p: 0.8, lots: [2, 3] },
      distribute: { from: 240, to: 340, passiveLots: 6, aggressiveLots: 0, cleanupFrom: 290, cleanupLots: 6 },
    },
    truth: {
      roles: roster.roles, controller: 'CTRL-1',
      falsePair: roster.falsePair, falseLinkAttribute: 'brokerBranch',
      mmGroups: [roster.mmAccts.mm1],
      washInstrument: 'QFRO', pumpInstrument: 'VLDN', shockInstrument: 'TMRX', transferInstrument: 'NBLE',
      shockAftermathSteps: 90,
      roleOfInstrument: { QFRO: 'wash-target', VLDN: 'pump-target', TMRX: 'benign-shock', NBLE: 'clean-control-low-volatility', HZPK: 'clean-control-high-volatility' },
    },
  };
}

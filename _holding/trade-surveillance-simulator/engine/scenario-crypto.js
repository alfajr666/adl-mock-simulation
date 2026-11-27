/*
 * "crypto" configuration: a continuous 24/7-style spot venue (fictional
 * tokens quoted in a fictional unit, SIMU). Finer tick, no price band.
 *
 * 90 simulated minutes (15-second steps, 1-minute bins). The first 20
 * minutes are a clean warm-up used as the baseline period.
 */
import { buildRoster } from './scenario-common.js';

export const CRYPTO_SCHEMA = {
  ownerAttr: 'kycIdentity',
  attributes: [
    { key: 'kycIdentity', label: 'KYC identity', strength: 'strong', prefix: 'KYC' },
    { key: 'fundingWallet', label: 'Funding wallet', strength: 'strong', prefix: 'FW' },
    { key: 'withdrawalAddress', label: 'Withdrawal address', strength: 'strong', prefix: 'WA' },
    { key: 'apiKeyLineage', label: 'API-key lineage', strength: 'strong', prefix: 'AK' },
    { key: 'deviceFingerprint', label: 'Device fingerprint', strength: 'weak', prefix: 'DF' },
    { key: 'ip', label: 'IP address', strength: 'weak', prefix: 'IP' },
  ],
};

export function buildCrypto(seed) {
  const roster = buildRoster(seed, {
    schema: CRYPTO_SCHEMA, retailCount: 40, momentumCount: 12, secondMm: true,
    link(reg) {
      reg.share(['mm1-a', 'mm1-b'], 'kycIdentity');                         // legitimate: one KYC identity, two sub-accounts
      reg.share(['ring-1', 'ring-2'], 'fundingWallet');                     // strong chain: wallet, then API-key lineage
      reg.share(['ring-2', 'ring-3'], 'apiKeyLineage');
      reg.share(['ring-1', 'ring-4'], 'deviceFingerprint');                 // hub: two weak attributes only
      reg.share(['ring-1', 'ring-4'], 'ip');
      reg.share(['pump-1', 'pump-2'], 'withdrawalAddress');
      reg.share(['pump-2', 'pump-3'], 'fundingWallet');
      reg.share(['retail-0', 'retail-1'], 'ip');                            // coincidence: same office IP, nothing else
    },
  });

  const session = { days: 1, stepsPerDay: 360, stepMs: 15000, dayMs: 86400000, binSteps: 4, momentumSteps: 8, momentumK: 4 };
  const ins = (o) => ({ bandPct: null, fatFinger: 0, lotSize: 10, followCap: 12, ...o });
  const instruments = [
    ins({ id: 'AQRL-SIMU', name: 'Aquarel token (fictional)', tickSize: 1, price0: 4000, volStep: 0.0008, fairPull: 0.35, retailWeight: 1.2, retailSpread: 6, retailLotsMax: 20, mmHalf: 3, mmGap: 3, mmLots: 40 }),
    ins({ id: 'BLXT-SIMU', name: 'Blixet token (fictional, low cap)', tickSize: 1, price0: 1200, volStep: 0.0015, fairPull: 0.03, retailWeight: 0.6, retailSpread: 4, retailLotsMax: 12, mmHalf: 3, mmGap: 4, mmLots: 4 }),
    ins({ id: 'DRNO-SIMU', name: 'Drenor token (fictional)', tickSize: 1, price0: 2500, volStep: 0.0010, fairPull: 0.35, retailWeight: 1.0, retailSpread: 5, retailLotsMax: 16, mmHalf: 3, mmGap: 3, mmLots: 30 }),
    ins({ id: 'ELVY-SIMU', name: 'Elvyn token (fictional)', tickSize: 1, price0: 900, volStep: 0.0005, fairPull: 0.35, retailWeight: 0.9, retailSpread: 3, retailLotsMax: 12, mmHalf: 2, mmGap: 2, mmLots: 16 }),
    ins({ id: 'FQRX-SIMU', name: 'Fenquor token (fictional)', tickSize: 1, price0: 2500, volStep: 0.0070, fairPull: 0.35, retailWeight: 4, retailSpread: 3, retailLotsMax: 16, mmHalf: 2, mmGap: 2, mmLots: 30 }),
  ];
  const allIds = instruments.map((i) => i.id);

  return {
    id: 'crypto',
    label: 'Continuous crypto spot venue (synthetic)',
    session, instruments,
    register: roster.register,
    retail: { ...roster.retail, actProb: 0.25, newsActProb: 0.7, followProb: 0.5, followTriggerP: 0.3, followCooldown: 120, followHold: 12, marketProb: 0.12, ttl: [4, 14] },
    mm: [
      { id: 'MM1', accts: roster.mmAccts.mm1, instruments: allIds, refreshSteps: 8, levels: 2 },
      { id: 'MM2', accts: roster.mmAccts.mm2, instruments: allIds, refreshSteps: 8, levels: 1 },
    ],
    transfers: [
      { step: 190, inst: 'ELVY-SIMU', from: roster.mmAccts.mm1[0], to: roster.mmAccts.mm1[1], lots: 14 },
      { step: 191, inst: 'ELVY-SIMU', from: roster.mmAccts.mm1[1], to: roster.mmAccts.mm1[0], lots: 14 },
      { step: 320, inst: 'ELVY-SIMU', from: roster.mmAccts.mm1[0], to: roster.mmAccts.mm1[1], lots: 14 },
    ],
    hype: [{ inst: 'BLXT-SIMU', from: 262, to: 292, p: 0.15, lots: [3, 9] }],
    news: [{ inst: 'DRNO-SIMU', step: 150, jump: 0.09, heatSteps: 8 }],
    ring: { accts: roster.ringAccts, hub: roster.ringHub, inst: 'AQRL-SIMU', fromStep: 90, toStep: 230, selfSteps: [120, 160, 200], actProb: 0.6, maxTrades: 2, lotsMin: 30, lotsMax: 50, spokeSpokeP: 0, selfP: 0.03, leakP: 0.08 },
    pump: {
      accts: roster.pumpAccts, inst: 'BLXT-SIMU',
      accumulate: { from: 100, to: 236, p: 0.25, marketP: 0.15, lots: 4 },
      ramp: { from: 240, to: 264, gain: 0.25, p: 0.8, lots: [5, 10] },
      distribute: { from: 264, to: 330, passiveLots: 6, aggressiveLots: 0, cleanupFrom: 300, cleanupLots: 12 },
    },
    truth: {
      roles: roster.roles, controller: 'CTRL-1',
      falsePair: roster.falsePair, falseLinkAttribute: 'ip',
      mmGroups: [roster.mmAccts.mm1],
      washInstrument: 'AQRL-SIMU', pumpInstrument: 'BLXT-SIMU', shockInstrument: 'DRNO-SIMU', transferInstrument: 'ELVY-SIMU',
      shockAftermathSteps: 48,
      roleOfInstrument: { 'AQRL-SIMU': 'wash-target', 'BLXT-SIMU': 'pump-target', 'DRNO-SIMU': 'benign-shock', 'ELVY-SIMU': 'clean-control-low-volatility', 'FQRX-SIMU': 'clean-control-high-volatility' },
    },
  };
}

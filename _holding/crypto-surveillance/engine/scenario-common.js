/* Shared roster construction for the scenario modules. */
import { RegisterBuilder } from './register.js';
import { streams } from './prng.js';

const CORPORATE_RATE = 0.13;

/**
 * Standard account keys:
 *   retail-0, retail-1        honest pair that shares exactly one weak attribute (DEC-LINK-1)
 *   retail-2, retail-3        honest algo accounts that occasionally self-match
 *   retail-4..7               two family pairs: unrelated people sharing one strong attribute (funding source)
 *   retail-8..11              two household pairs: share two weak attributes
 *   retail-12..14             honest trio (one funding source)
 *   retail-15..18, 19..22     two honest quads (colleagues funding from one source)
 *   retail-23,24 / 25..27     honest people with several accounts: one declared owner / controlling person
 *   retail-28..39             ordinary retail
 *   (momentum followers are drawn from retail-4..39)
 *   mm1-a, mm1-b, mm2         market makers (mm1: two sub-accounts, one declared owner)
 *   ring-1..3 (spokes), ring-4 (hub, weak links only)
 *   pump-1, pump-2 (strong link), pump-3 (weak links only)
 * Account `type` is drawn at random for every non-maker account, independent of role.
 */
export function buildRoster(seed, { schema, retailCount, momentumCount, secondMm, link }) {
  const reg = new RegisterBuilder(seed, schema);
  const typeRng = streams(seed)('types');
  const draw = () => (typeRng.u() < CORPORATE_RATE ? 'corporate' : 'individual');
  const retailKeys = [];
  for (let i = 0; i < retailCount; i++) { retailKeys.push(`retail-${i}`); reg.add(`retail-${i}`, draw()); }
  reg.add('mm1-a', 'market_maker');
  reg.add('mm1-b', 'market_maker');
  if (secondMm) reg.add('mm2', 'market_maker');
  const planted = ['ring-1', 'ring-2', 'ring-3', 'ring-4', 'pump-1', 'pump-2', 'pump-3'];
  for (const k of planted) reg.add(k, draw());
  const makers = ['mm1-a', 'mm1-b', ...(secondMm ? ['mm2'] : [])];
  const R = (a, b) => retailKeys.slice(a, b + 1);
  const honestGroups = [
    { id: 'family-1', keys: R(4, 5) }, { id: 'family-2', keys: R(6, 7) },
    { id: 'household-1', keys: R(8, 9) }, { id: 'household-2', keys: R(10, 11) },
    { id: 'trio-1', keys: R(12, 14) }, { id: 'quad-1', keys: R(15, 18) }, { id: 'quad-2', keys: R(19, 22) },
    { id: 'owner-1', keys: R(23, 24) }, { id: 'owner-2', keys: R(25, 27) },
  ];
  const keys = { retail: retailKeys, planted, makers, all: [...retailKeys, ...makers, ...planted], nonMaker: [...retailKeys, ...planted], honestGroups };
  link(reg, keys);
  const { idOf, register } = reg.finalize();

  const rng = streams(seed)('roster');
  const eligible = retailKeys.slice(4);
  rng.shuffle(eligible);
  const momentumKeys = eligible.slice(0, momentumCount);

  const roles = {};
  retailKeys.forEach((k, i) => {
    roles[idOf[k]] = i < 2 ? 'honest-coincidental-link' : i < 4 ? 'honest-algo' : i < 8 ? 'honest-family-pair'
      : i < 12 ? 'honest-household-pair' : i < 23 ? 'honest-colleague-group' : i < 28 ? 'honest-multi-account-person'
        : momentumKeys.includes(k) ? 'retail-momentum' : 'retail';
  });
  roles[idOf['mm1-a']] = 'planted-maker-sub-account'; roles[idOf['mm1-b']] = 'planted-maker-sub-account';
  if (secondMm) roles[idOf['mm2']] = 'market-maker';
  for (const k of ['ring-1', 'ring-2', 'ring-3']) roles[idOf[k]] = 'planted-wash-ring-spoke';
  roles[idOf['ring-4']] = 'planted-wash-ring-hub';
  for (const k of ['pump-1', 'pump-2', 'pump-3']) roles[idOf[k]] = 'planted-pump-group';

  const ids = (arr) => arr.map((k) => idOf[k]);
  return {
    register, idOf, roles,
    retail: { accts: ids(retailKeys), momentum: ids(momentumKeys) },
    algos: ids(['retail-2', 'retail-3']),
    mmAccts: { mm1: ids(['mm1-a', 'mm1-b']), mm2: secondMm ? ids(['mm2']) : null },
    ringAccts: ids(['ring-1', 'ring-2', 'ring-3', 'ring-4']),
    ringHub: idOf['ring-4'],
    pumpAccts: ids(['pump-1', 'pump-2', 'pump-3']),
    falsePair: ids(['retail-0', 'retail-1']),
    familyPairs: [ids(['retail-4', 'retail-5']), ids(['retail-6', 'retail-7'])],
    householdPairs: [ids(['retail-8', 'retail-9']), ids(['retail-10', 'retail-11'])],
    honestGroups: honestGroups.map((g) => ({ id: g.id, accts: ids(g.keys) })),
    coverAccts: ids(planted),
  };
}

/**
 * Seed-drawn benign background events (not hand-placed): linked honest groups that now and then
 * cross against each other, retail momentum bursts and large block orders in the control instruments.
 */
export function drawBackgroundEvents(seed, { totalSteps, warmSteps, groups, instruments, controlIds, retailAccts, burstLots }) {
  const rng = streams(seed)('background');
  const instIds = instruments.map((d) => d.id);
  const lotsOf = Object.fromEntries(instruments.map((d) => [d.id, d.retailLotsMax]));
  const lo = warmSteps + 5, hi = totalSteps - 25;
  const crosses = [], bursts = [], blocks = [];
  for (const g of groups) {
    if (rng.u() < 0.5) continue;                       // about half of the groups never cross
    const episodes = rng.int(1, 2);
    for (let e = 0; e < episodes; e++) {
      const inst = rng.pick(instIds);
      let step = rng.int(lo, hi);
      const k = rng.int(3, 7), lots = rng.int(2, 6);
      for (let i = 0; i < k; i++) {
        const a = rng.pick(g.accts); let b = rng.pick(g.accts);
        while (b === a) b = rng.pick(g.accts);
        crosses.push({ step, inst, from: a, to: b, lots, group: g.id, honest: true });
        step += rng.int(1, 3);
      }
    }
  }
  const nb = rng.int(0, 2);
  for (let i = 0; i < nb; i++) {
    const from = rng.int(lo + 5, hi - 10);
    bursts.push({ inst: rng.pick(controlIds), from, to: from + rng.int(5, 9), p: 0.07 + 0.12 * rng.u(), lots: burstLots, kind: 'burst' });
  }
  const nk = rng.int(0, 2);
  for (let i = 0; i < nk; i++) {
    const inst = rng.pick(controlIds);
    blocks.push({ step: rng.int(lo, hi), inst, acct: rng.pick(retailAccts), side: rng.chance(0.5) ? 'B' : 'S', lots: lotsOf[inst] * rng.int(3, 6) });
  }
  return { crosses, bursts, blocks };
}

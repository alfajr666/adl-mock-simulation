/* Shared roster construction for the scenario modules. */
import { RegisterBuilder } from './register.js';
import { streams } from './prng.js';

const CORPORATE_RATE = 0.13;

/**
 * Standard account keys:
 *   retail-0, retail-1        honest pair that shares exactly one weak attribute (kept from 1.0)
 *   retail-2, retail-3        honest algo accounts that occasionally self-match
 *   retail-4..7               two family pairs: unrelated people sharing one strong attribute (funding source)
 *   retail-8..11              two household pairs: share two weak attributes
 *   retail-12..               ordinary retail (a subset follows momentum)
 *   mm1-a, mm1-b, mm2         market makers (mm1: two sub-accounts, one declared owner)
 *   ring-1..3 (spokes), ring-4 (hub, weak links only)
 *   pump-1..3
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
  const keys = { retail: retailKeys, planted, all: [...retailKeys, 'mm1-a', 'mm1-b', ...(secondMm ? ['mm2'] : []), ...planted] };
  link(reg, keys);
  const { idOf, register } = reg.finalize();

  const rng = streams(seed)('roster');
  const eligible = retailKeys.slice(12);
  rng.shuffle(eligible);
  const momentumKeys = eligible.slice(0, momentumCount);

  const roles = {};
  retailKeys.forEach((k, i) => {
    roles[idOf[k]] = i < 2 ? 'honest-coincidental-link' : i < 4 ? 'honest-algo' : i < 8 ? 'honest-family-pair'
      : i < 12 ? 'honest-household-pair' : momentumKeys.includes(k) ? 'retail-momentum' : 'retail';
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
  };
}

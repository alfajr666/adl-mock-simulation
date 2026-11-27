/* Shared roster construction for the scenario modules. */
import { RegisterBuilder } from './register.js';
import { streams } from './prng.js';

/**
 * Standard account keys:
 *   retail-0 .. retail-(n-1)  (retail-0 and retail-1 are the coincidental-link honest pair)
 *   mm1-a, mm1-b              (market maker, two sub-accounts, one declared owner)
 *   mm2                       (optional second market maker, single account)
 *   ring-1, ring-2, ring-3    (spokes), ring-4 (hub, linked to the rest only weakly)
 *   pump-1 .. pump-3
 */
export function buildRoster(seed, { schema, retailCount, momentumCount, secondMm, link }) {
  const reg = new RegisterBuilder(seed, schema);
  for (let i = 0; i < retailCount; i++) reg.add(`retail-${i}`, 'individual');
  reg.add('mm1-a', 'market_maker');
  reg.add('mm1-b', 'market_maker');
  if (secondMm) reg.add('mm2', 'market_maker');
  reg.add('ring-1', 'individual'); reg.add('ring-2', 'individual'); reg.add('ring-3', 'corporate'); reg.add('ring-4', 'individual');
  reg.add('pump-1', 'individual'); reg.add('pump-2', 'individual'); reg.add('pump-3', 'corporate');
  link(reg);
  const { idOf, register } = reg.finalize();

  const rng = streams(seed)('roster');
  const eligible = [];
  for (let i = 2; i < retailCount; i++) eligible.push(`retail-${i}`);
  rng.shuffle(eligible);
  const momentumKeys = eligible.slice(0, momentumCount);

  const roles = {};
  for (let i = 0; i < retailCount; i++) {
    const k = `retail-${i}`;
    roles[idOf[k]] = i < 2 ? 'honest-coincidental-link' : momentumKeys.includes(k) ? 'retail-momentum' : 'retail';
  }
  roles[idOf['mm1-a']] = 'market-maker-sub'; roles[idOf['mm1-b']] = 'market-maker-sub';
  if (secondMm) roles[idOf['mm2']] = 'market-maker';
  for (const k of ['ring-1', 'ring-2', 'ring-3']) roles[idOf[k]] = 'wash-ring-spoke';
  roles[idOf['ring-4']] = 'wash-ring-hub';
  for (const k of ['pump-1', 'pump-2', 'pump-3']) roles[idOf[k]] = 'pump-group';

  const retailKeys = [];
  for (let i = 0; i < retailCount; i++) retailKeys.push(`retail-${i}`);
  return {
    register, idOf, roles,
    retail: { accts: retailKeys.map((k) => idOf[k]), momentum: momentumKeys.map((k) => idOf[k]) },
    mmAccts: { mm1: [idOf['mm1-a'], idOf['mm1-b']], mm2: secondMm ? [idOf['mm2']] : null },
    ringAccts: ['ring-1', 'ring-2', 'ring-3', 'ring-4'].map((k) => idOf[k]),
    ringHub: idOf['ring-4'],
    pumpAccts: ['pump-1', 'pump-2', 'pump-3'].map((k) => idOf[k]),
    falsePair: [idOf['retail-0'], idOf['retail-1']],
  };
}

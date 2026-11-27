// All market-specific and explanatory copy lives here, so app.js stays market-neutral.
// Wording rules: an alert is an alert or a lead; planted items are planted episodes; nothing here
// claims to reproduce any real venue's rules.

export const RULE_INFO = {
  W1: { full: 'Self-match (hygiene rule)', name: 'Self-match · hygiene', short: 'W1', shape: 'circle', hygiene: true, blurb: 'One account sits on both sides of a trade. This is a hygiene rule: honest algorithmic accounts self-match too, so it is kept apart from the scorecard.' },
  W2: { full: 'Linked accounts trading together', name: 'Linked group', short: 'W2', shape: 'square', blurb: 'A linked group trades mostly with itself and ends up with little net change.' },
  P1: { full: 'Price and volume move', name: 'Price move', short: 'P1', shape: 'triangle', blurb: 'A sharp move, up or down, on unusually heavy volume.' },
  P2: { full: 'Linked group rides the move', name: 'Group on move', short: 'P2', shape: 'diamond', blurb: 'A linked group supplies much of the buying during a rise, then sells afterwards.' },
};
export const RULES = ['W1', 'W2', 'P1', 'P2'];
export const PATTERN_RULE_IDS = ['W2', 'P1', 'P2'];

export const LABELS = {
  MATCH: { short: 'Match', long: 'Matches a planted episode' },
  MATCH_DILUTED: { short: 'Diluted', long: 'Overlaps a planted episode, diluted' },
  EXPLAINABLE: { short: 'Explainable', long: 'Explainable: needs a documented explanation' },
  UNRELATED: { short: 'Unrelated', long: 'Unrelated to anything planted' },
  SELF_MATCH: { short: 'Hygiene', long: 'Self-match hygiene (outside the scorecard)' },
};

export const DECISIONS = {
  close: { label: 'Close — explained', hint: 'You can explain it with ordinary activity.' },
  monitor: { label: 'Keep monitoring', hint: 'Not enough to act on; look again as more data arrives.' },
  escalate: { label: 'Escalate', hint: 'Worth a senior review and possibly venue action.' },
};

/** Sliders: every key is a real engine threshold. */
export const PARAMS = [
  { key: 'w2InstrumentShare', rule: 'W2', label: 'Group share of instrument volume', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'W2 needs the group’s internal trading to be at least this share of everything traded in the instrument in the window.' },
  { key: 'w2ClusterShare', rule: 'W2', label: 'Share of the group’s volume kept inside the group', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'W2 needs at least this share of the volume the group took part in to be between its own accounts.' },
  { key: 'w2NetRatio', rule: 'W2', label: 'Net position change allowed (W2)', min: 0, max: 2, step: 0.05, kind: 'ratio',
    help: 'The group’s buying from outsiders minus its selling to outsiders, as a share of its internal volume, must be at most this. A one-way internal transfer also scores 0.' },
  { key: 'p1MoveScore', rule: 'P1', label: 'Move score', min: 1, max: 30, step: 0.5, kind: 'num',
    help: 'The size of the move relative to the instrument’s own baseline volatility, scaled for window length. Higher means a bigger move than that instrument normally makes. It is a plain ratio, not a statistical test.' },
  { key: 'p1VolMult', rule: 'P1', label: 'Volume as a multiple of baseline', min: 1, max: 10, step: 0.25, kind: 'mult',
    help: 'P1 needs window turnover at least this many times the instrument’s normal level.' },
  { key: 'p1MinReturnBps', rule: 'P1', label: 'Smallest price move (basis points)', min: 0, max: 1500, step: 50, kind: 'bps',
    help: 'A floor, so tiny moves in quiet instruments do not alert. 100 basis points = 1%.' },
  { key: 'p1BaselineBins', rule: 'P1', label: 'Baseline length (bins)', min: 5, max: 80, step: 5, kind: 'int',
    help: 'How many bins of history define “normal” for each instrument. Longer baselines are steadier but can reach into the period you are trying to detect.' },
  { key: 'p2RampShare', rule: 'P2', label: 'Group share of aggressive buying', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'P2 needs the group to supply at least this share of the market-order buying during the rise.' },
  { key: 'p2NetSellRatio', rule: 'P2', label: 'Selling afterwards, relative to rise buying', min: 0, max: 1.5, step: 0.05, kind: 'ratio',
    help: 'P2 needs the group to sell at least this fraction of what it bought aggressively, in the following window.' },
];

export const THRESHOLD_LABELS = {
  w1MinCount: 'Self-matches (count)', w1MinLots: 'Self-match size (lots)',
  w2ClusterShare: 'Share of the group’s volume kept inside the group', w2NetRatio: 'External buys minus sells ÷ internal volume', w2InstrumentShare: 'Group share of instrument volume',
  p1MoveScore: 'Move score', p1VolMult: 'Volume vs baseline', p1MinReturnBps: 'Move (basis points)',
  p2RampShare: 'Group share of aggressive buying', p2NetSellRatio: 'Selling afterwards vs rise buying',
};

/** Metric label and display kind, per key. */
export const METRICS = {
  selfTradeCount: ['Self-matches', 'int'], selfTradeQty: ['Self-match quantity', 'qty'], selfTradeNotional: ['Self-match value', 'money'],
  clusterInternalShare: ['Share of the group’s volume kept inside the group', 'pct'], netChangeOverInternal: ['External buys minus external sells ÷ internal volume', 'ratio'], internalRoundTripShare: ['Internal round-trip share (two-way exchange)', 'pct'],
  instrumentInternalShare: ['Group trading as share of instrument volume', 'pct'], internalQty: ['Internal quantity', 'qty'], externalQty: ['Quantity traded with outsiders', 'qty'],
  windowBins: ['Window length', 'bins'], peakWindowStartMs: ['Peak window starts', 'time'],
  returnBps: ['Price move', 'bpsSigned'], moveScore: ['Move score', 'x'], volumeMultiple: ['Volume vs baseline', 'mult'], direction: ['Direction', 'text'],
  baselineMode: ['Baseline scope', 'text'], baselineSource: ['Baseline period', 'text'], baselineVolatility: ['Baseline volatility per bin', 'pct2'], baselineMedianNotional: ['Baseline value per bin (median)', 'money'],
  baselineBins: ['Baseline bins used', 'binrange'], startBin: ['First bin of the move', 'int'], endBin: ['Last bin of the move', 'int'],
  rampAggressiveBuyShare: ['Group share of market-order buying in the rise', 'pct'], rampAggressiveBuyQty: ['Group market-order buying', 'qty'],
  followNetSellQty: ['Group net selling afterwards', 'qty'], followNetSellRatio: ['Selling afterwards ÷ rise buying', 'ratio'],
  accumulationNetQty: ['Group net buying before the move (lookback)', 'qty'], accumulationBuyShareOfVolume: ['Group buying from outsiders as a share of instrument volume before the move', 'pct'],
  pnlTicksQty: ['Group profit and loss over the period', 'moneySigned'], cashTicksQty: ['Group cash flow', 'moneySigned'], closingPosition: ['Group position at the end', 'qty'],
  markPrice: ['Last price used for marking', 'price'], p1AlertId: ['Linked price-move alert', 'text'], peakBin: ['Peak bin', 'int'], rampEndBin: ['Rise ends at bin', 'int'],
  rampWindow: ['Rise window', 'window'], followWindow: ['Following window', 'window'], lookbackWindow: ['Lookback window', 'window'],
};

const COMMON_ACTIONS = [
  ['Escalate', 'Pass the case to a senior reviewer with the account links, supporting trades and your notes, so someone with more context decides what happens next.'],
  ['File a suspicious-order report', 'Record the activity in a formal report for the venue’s compliance function and, where its rules require it, a regulator. The report records a concern; it does not state a conclusion.'],
];

/** Only these two causes are designed teaching traps; everything else is ordinary honest activity the scenario generates. */
export const DESIGNED_CAUSES = new Set(['same-owner-cross', 'benign-shock']);
export const CAUSES = {
  'same-owner-cross': 'Sub-accounts of one market maker crossing trades to move inventory. Same-owner trades are a wash in form; the alert is expected and needs a documented explanation.',
  'benign-shock': 'A news-style price jump with broad participation.',
  'honest-linked-trading': 'Honest accounts that the linkage joins into one group (family, colleagues, one person with several accounts) trading with each other.',
  'benign-burst': 'An honest momentum burst: many ordinary accounts chasing a move.',
  'block-trade': 'An honest block order: one large trade that moved the price and volume.',
  'background-collision': 'A group of honest accounts joined only because their pooled register attributes collide.',
  'natural-move': 'An ordinary move in a busy instrument that happened to pass the price and volume tests.',
  'coincidental-link': 'Accounts of one honest pair that share a single register attribute by coincidence.',
  unattributed: 'No planted cause; the thresholds were simply loose enough to fire.',
  'honest-algo': 'An honest algorithmic account that occasionally trades with itself.',
  'planted-account': 'An account that belongs to a planted episode.',
};
export const GROUP_KINDS = { family: 'a family pair', household: 'a household', trio: 'a group of three people', quad: 'a group of colleagues', owner: 'one person with several accounts' };

export const EPISODE_TEXT = {
  wash: 'a planted wash-trading episode: a small ring of accounts under one controller trading among themselves to make an instrument look busier than it is',
  pump: 'a planted pump-style episode: a linked group built a position quietly, pushed the price up with market orders while a promotion-like crowd piled in, then sold into that demand',
};
export const DECOY_TEXT = {
    'benign-news-shock': 'unrelated: a news-style jump that drew broad, unlinked participation',
  'same-owner-cross': 'an expected alert: sub-accounts of one market maker crossed trades. Same-owner trades are a wash in form, so a real desk would need a documented explanation, but it is not a planted episode',
  'coincidental-shared-attribute': 'unrelated: two honest accounts share one register attribute by coincidence',
  'unrelated-shared-strong-attribute': 'unrelated: honest accounts such as family members share a strong attribute',
  'unrelated-shared-weak-attributes': 'unrelated: honest accounts in one household share weak attributes',
  'honest-self-match': 'unrelated: an honest algorithmic account traded with itself',
};

export const TEXT = {
  equity: {
    page: 'Equity board',
    kicker: 'Simulator 1 of 2',
    heading: 'Equity board: leads on a lot-sized, price-banded market',
    scope: 'You are an analyst on an exchange’s market-surveillance desk, with full account-level data. This is a synthetic equity board: a lot-100, daily-band equity board, loosely after Indonesian market conventions. Five fictional listed companies trade over six sessions, with one wash-trading ring and one pump-style group planted among ordinary retail flow, market makers, honest algorithmic accounts and a few look-alikes. It is an educational model and does not reproduce any real exchange’s rules. Alerts are leads for a human to review, not conclusions.',
    sessionNote: 'Six sessions of five hours, 30-minute bins. Session 1 is a clean warm-up that builds each instrument’s baseline.',
    timeHelp: 'Times read “D3 +02:30”: day 3, two hours thirty after the open.',
    qty: 'shares', qtyOne: 'share', lot: 'lot of 100 shares',
    units: 'Prices are shown in display units: the engine’s integer price ticks × the instrument’s tick size. Money is price × quantity in those units. There is no currency, and tick sizes differ by instrument, so compare money only within one instrument.',
    attrs: {
      beneficialOwnerId: { short: 'owner ID' },
      fundingAccount: { short: 'funding acct' },
      brokerBranch: { short: 'branch' },
      device: { short: 'device' },
    },
    policyNotes: {
      strong1: 'Two accounts are linked only if they share a strong attribute (owner ID or funding account). Few false links, but a ring that reaches its hub only through weak ties fragments.',
      weak2: 'Linked on one strong attribute, or on two weak ones together (for example branch and device). The balanced starting point.',
      weak1: 'Linked on any shared attribute, even a single broker branch. With only a handful of branches serving everyone, this merges honest accounts into very large groups.',
    },
    actions: [
      ['Unusual-activity notice', 'Publish a notice that trading in the instrument is showing unusual activity, so the market is aware and the issuer can respond.'],
      ['Suspension', 'Pause trading in the instrument for a short period while the desk gathers facts. This stops everyone trading, including honest participants, so it is reserved for serious cases.'],
      ['Move to call auction', 'Switch the instrument from continuous trading to periodic auctions so prices form from batches of orders rather than rapid-fire trades.'],
      ...COMMON_ACTIONS,
    ],
    lookFor: 'In this market, owner and funding links carry the weight; a shared broker branch or device is common among honest customers.',
  },
  crypto: {
    page: 'Crypto spot venue',
    kicker: 'Simulator 2 of 2',
    heading: 'Crypto spot venue: leads on a continuous, fast market',
    scope: 'You are an analyst on a trading venue’s market-surveillance desk, with full account-level data. This is a synthetic spot venue: five fictional tokens over ninety minutes, with one wash-trading ring and one pump-style group planted among ordinary retail flow, market makers, honest algorithmic accounts and a few look-alikes. It is an educational model and does not reproduce any real venue’s rules. Alerts are leads for a human to review, not conclusions.',
    sessionNote: 'One continuous session of ninety minutes, 1-minute bins. The first twenty minutes are a clean warm-up that builds each token’s baseline.',
    timeHelp: 'Times read “+25:45”: minutes and seconds since the session started.',
    qty: 'units', qtyOne: 'unit', lot: 'lot of 10 units',
    units: 'Prices are shown in display units: the engine’s integer price ticks × the token’s tick size (1 here). Money is price × quantity in those units. There is no currency, so compare money only within one instrument.',
    attrs: {
      controllingPerson: { short: 'controlling person' },
      fundingWallet: { short: 'funding wallet' },
      apiKeyLineage: { short: 'API-key lineage' },
      withdrawalAddress: { short: 'withdrawal addr.' },
      deviceFingerprint: { short: 'device' },
      ip: { short: 'IP' },
    },
    policyNotes: {
      strong1: 'Two accounts are linked only if they share a strong attribute (controlling person, funding wallet or API-key lineage). Few false links, but a ring that reaches its hub only through weak ties fragments.',
      weak2: 'Linked on one strong attribute, or on two weak ones together (for example device and IP). The balanced starting point.',
      weak1: 'Linked on any shared attribute, even a single IP address or hosted withdrawal address. Shared carrier addresses and hosted wallets merge honest accounts into large groups.',
    },
    actions: [
      ['Restrict account', 'Limit what the accounts can do, for example reduce-only trading or a withdrawal hold, while the desk reviews. Unlike a market-wide halt it affects only the accounts concerned.'],
      ['Widen monitoring', 'Keep the accounts and the instrument under closer watch: lower alert thresholds, more frequent reviews, and extra data capture, without restricting anyone yet.'],
      ...COMMON_ACTIONS,
    ],
    lookFor: 'In this market, funding-wallet and API-key links carry the weight; a shared IP address or hosted withdrawal address is common among honest users.',
  },
};

/** The rules in plain words, with live threshold values. */
export function methodRules(th, defs) {
  const v = (k, f = (x) => x) => `<strong>${f(th[k])}</strong>${th[k] !== defs[k] ? ` <span class="muted">(default ${f(defs[k])})</span>` : ''}`;
  const p = (x) => `${Math.round(x * 100)}%`;
  const base = th.p1Baseline === 'trailing' ? 'the bins just before each window (trailing)' : 'the first bins of the session (a clean warm-up)';
  return [
    ['W1', 'Self-match (hygiene)', `Raises an alert when the same account is on both sides of a trade: at least ${v('w1MinCount')} such trade(s) of at least ${v('w1MinLots')} lot(s); self-matches by one account in one instrument within ${v('w1MergeBins')} bins become one alert. It is cheap and precise about what it sees, but not about intent: honest algorithmic accounts self-match too. It is therefore reported as hygiene, outside the scorecard.`],
    ['W2', 'Linked accounts trading together', `Groups accounts using the linkage policy, then looks at windows of ${v('w2WindowBins')} bins. A group is flagged when at least ${v('w2ClusterShare', p)} of the volume it took part in was between its own accounts, its internal trading was at least ${v('w2InstrumentShare', p)} of all volume in the instrument, its external buying minus external selling was at most ${v('w2NetRatio', p)} of its internal volume (so a one-way internal transfer also scores 0), and it traded at least ${v('w2MinInternalLots')} lots internally. Flagged windows within ${v('w2MergeGapBins')} bins are merged.`],
    ['P1', 'Price and volume move', `Compares each window of ${v('p1WindowBins')} bins, rising and falling separately, with a baseline of ${v('p1BaselineBins')} bins taken from ${base}. Flags a move score of at least ${v('p1MoveScore')} (the move relative to the instrument’s own baseline volatility, scaled for window length), a move of at least ${v('p1MinReturnBps')} basis points, and turnover of at least ${v('p1VolMult')}× normal. The baseline is ${th.p1Mode === 'global' ? '<strong>one market-wide value</strong>' : 'each instrument’s own'}. It names no accounts: it only says that something moved.`],
    ['P2', 'Linked group rides the move', `Attached to a rising P1 alert. Looks at groups of at least ${v('p2MinClusterSize')} linked accounts and asks whether one group supplied at least ${v('p2RampShare', p)} of the market-order buying during the rise, bought at least ${v('p2MinRampLots')} lots that way, and then, within the next ${v('p2FollowBins')} bins, sold at least ${v('p2NetSellRatio', p)} of that amount. It also reports what the group bought from outsiders in the ${v('p2LookbackBins')} bins before the move, and, for W2, how much of the internal trading was a two-way round trip.`],
  ];
}

export const HONESTY = [
  'Detection at default settings (seeds 1–100): both planted episodes were found with accounts named in 100 of 100 seeds in equity and 97 of 100 in crypto. In the three crypto seeds that fail (31, 58 and 79) the linked-group rule matched the pump but named a group in which fewer than half the accounts were pump accounts, so the find is diluted; the price-and-volume rule flagged the move in all three. That rule alone always counts as “price move flagged, no accounts named”, because it names nobody. Recall is near 1 by design: these figures show how the rules react to designed situations, not real-world detection performance.',
  'The designed traps are reported, not required. The explainable market-maker alert fires in 95% (equity) and 98% (crypto) of seeds; the news-shock alert fires on P1 in 100% and 100%, and on P2 in 1% and 2%.',
  'At case level the share of cases matching a planted episode has a median of 0.29 in both markets (minimum 0.18 and 0.14, maximum 0.50 and 0.40), with 8 and 9 distinct values and the most common value in 27 of 100 seeds in each. The share matching or explainable has a median of 0.43 (equity) and 0.50 (crypto). It moves from seed to seed, so read the distribution, not one run.',
  'Almost all the unrelated cases that are not designed traps are alerts on scripted trades between linked honest accounts. The scenario sets the rate: each of 9 honest groups crosses in a given seed with probability 0.5, in 1 to 2 episodes of 3 to 7 trades. Over 100 seeds, unrelated alerts were: equity 291 on honest linked accounts (265 honest-linked trading, 26 background collisions) against 101 news shock, 0 bursts and 0 block trades; crypto 281 against 102 news shock, 4 bursts, 0 block trades and 2 natural moves. Honest momentum bursts and block trades therefore almost never alert. The share of matching cases is governed by that scripted rate, not by emergent behaviour.',
  'Linkage changes the picture. Strict linkage finds both episodes with accounts named in 2 (equity) and 16 (crypto) of 100 seeds. Loose linkage does so in 0 and 2, the rest being diluted or price-only (equity 1.01 diluted and 0.99 price-only per run; crypto 1.25 and 0.42), with a largest group of 48.8 and 35.0 accounts, 771 and 393 falsely linked pairs, 4.0 and 10.0 unrelated cases against 2.9 and 2.9 at the default, and 48.8 and 29.5 named accounts per matching alert against 3.7.',
  'Baseline length matters, but not as you might expect. A warm-up long enough to span the episodes also spans the news shock, so the price-and-volume rule becomes less sensitive across the board: both episodes with accounts named in 92 (equity) and 97 (crypto) of 100 seeds, the pump move flagged in 92 and 100, and the shock alert falling to 0.00 and 0.01. A trailing baseline and a clean warm-up keep the shock alert at 1.00.',
  'The ring’s internal trading is a median 0.43 (equity; 10th to 90th percentile 0.38 to 0.48) and 0.49 (crypto; 0.43 to 0.57) of its instrument’s quantity, against a threshold of 0.25. The pump group supplies a median 0.60 (0.53 to 0.68) and 0.62 (0.50 to 0.75) of aggressive buying in the rise, against a threshold of 0.25.',
  'Self-match hygiene (W1): honest algorithmic accounts alert in 100 of 100 runs; planted accounts alert in 62 (equity) and 30 (crypto). W1 is outside every headline figure.',
  'The register gives planted accounts away to a simple rule. A group that holds both a strong link and a weak-only link picks out ring and pump accounts with precision 0.795 (equity) and 0.620 (crypto) at recall 1.00, against a base rate of 0.14. Other structural rules reach 0.2 to 0.8. Maker sub-accounts are not singled out (precision at most 0.282).',
  'So does the tape. Flagging accounts whose busiest instrument holds at least 0.65 of their quantity (at least 20 trades, makers excluded) finds ring and pump accounts at precision 1.00 and 0.99 and recall 0.98 and 0.87. Planted accounts also trade about 2.2 and 2.4 times the honest mean size.',
];
export const CONTRIVANCES = [
  'The register and tape tells above: mixed strong and weak-only links, a busy-in-one-name pattern, and larger trades.',
  'The ramp-interest and promotion crowds are scripted, and the pump group’s profit from selling into them is assumed by the scenario, not emergent.',
  'The wash ring trades only inside the spread at a steady rate and ends near flat; its hub is reachable only through two weak attributes, which is why strict linkage loses it, by design.',
  'The honest cross rate that drives most unrelated cases is a scenario parameter, not an emergent result.',
  'The baseline period is clean by construction. A real desk builds baselines from history that may already be contaminated.',
  'The scenario sets honest volume in the wash target so the ring is 0.43 to 0.49 of its quantity at the median. That is a design choice, not a market fact.',
];
export const TELLS_FRAMING = 'A planted scenario is always easier than a real one; these are the shortcuts a real desk does not get.';
export const TELLS_TEXT = [
  'Register tell. The ring and the pump group are built from a mix of strong links (the ring’s spokes, the pump pair) and weak-only links (the ring’s hub, the pump’s third member). A group that holds both kinds picks out ring and pump accounts with precision 0.795 (equity) and 0.620 (crypto) at recall 1.00, against a base rate of 0.14.',
  'Tape tell. Planted accounts concentrate in one instrument: the busiest-instrument share has a median of 0.83 against 0.34 for honest accounts in equity, and 0.77 against 0.43 in crypto. They also trade about 2.2 (equity) and 2.4 (crypto) times the honest mean size, and lean harder on one counterparty (0.32 against 0.20). Flagging a busiest-instrument share of at least 0.65 finds them at precision 1.00 and 0.99, recall 0.98 and 0.87.',
];

export const METHOD_GENERAL = {
  linkage: 'Linkage uses only the attributes on the account register. Each pair of accounts that shares an attribute gets an edge. The policy decides which edges count: strict needs a strong attribute, the default needs one strong or two weak, loose accepts any. Counted edges join accounts into groups. Because the rules look at groups rather than single accounts, this step does most of the work. A threshold change moves a few alerts; a linkage change can make a whole episode vanish (strict) or merge dozens of honest accounts into one group (loose).',
  limits: [
    'The venue rules are simplified: no auctions, halts or circuit breakers, only limit and market orders, no iceberg or stop orders. The equity board has a lot size and a daily price band; the crypto venue has neither a band nor a halt. No self-trade prevention, margin, fees, settlement, or activity on other venues or in derivatives.',
    'No order-level behaviours such as spoofing or layering, and no marking the close, front-running or insider information.',
    'Linkage uses register attributes only; there is no behavioural similarity. The register has no data-quality noise beyond pooled attribute collisions. Counterparty-concentration rules (who trades with whom) are absent, which is why strict linkage can miss a hub-and-spoke ring.',
    'One wash episode and one pump episode per run, so every score rests on a handful of alert groups and two planted episodes. Detection works on whole bins, so timing is only as precise as one bin.',
    'Traders are simple rule-followers with random draws, and prices are a stylised random walk. Real flow is messier and real abusers adapt.',
  ],
};

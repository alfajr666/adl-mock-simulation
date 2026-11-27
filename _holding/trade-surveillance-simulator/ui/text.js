// All market-specific and explanatory copy lives here, so app.js stays market-neutral.
// Wording rules: an alert is an alert or a lead; planted items are planted episodes; nothing here
// claims to reproduce any real venue's rules.

export const RULE_INFO = {
  W1: { full: 'Self-trade', name: 'Self-trade', short: 'W1', shape: 'circle', blurb: 'One account sits on both sides of a trade.' },
  W2: { full: 'Linked accounts trading together', name: 'Linked group', short: 'W2', shape: 'square', blurb: 'A linked group trades mostly with itself and ends up roughly flat.' },
  P1: { full: 'Price and volume spike', name: 'Price spike', short: 'P1', shape: 'triangle', blurb: 'A sharp move on unusually heavy volume.' },
  P2: { full: 'Linked group rides the move', name: 'Group on spike', short: 'P2', shape: 'diamond', blurb: 'A linked group supplies much of the buying during a spike, then sells afterwards.' },
};
export const RULES = ['W1', 'W2', 'P1', 'P2'];

export const DECISIONS = {
  close: { label: 'Close — explained', hint: 'You can explain it with ordinary activity.' },
  monitor: { label: 'Keep monitoring', hint: 'Not enough to act on; look again as more data arrives.' },
  escalate: { label: 'Escalate', hint: 'Worth a senior review and possibly venue action.' },
};

/** Sliders: every key is a real engine threshold. */
export const PARAMS = [
  { key: 'w2InstrumentShare', rule: 'W2', label: 'Linked-group share of instrument volume', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'W2 needs the group’s internal trading to be at least this share of everything traded in the instrument in the window.' },
  { key: 'w2ClusterShare', rule: 'W2', label: 'Share of the group’s volume that stays inside the group', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'W2 needs at least this share of the group’s own volume to be between its own accounts.' },
  { key: 'w2NetRatio', rule: 'W2', label: 'Largest net position allowed (W2)', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'Net buying minus selling, relative to total, must be at most this: a group that stays near flat.' },
  { key: 'p1ZRet', rule: 'P1', label: 'Price move in baseline deviations', min: 1, max: 30, step: 0.5, kind: 'num',
    help: 'P1 needs the largest move in the window to be at least this many baseline deviations (scaled for window length).' },
  { key: 'p1VolMult', rule: 'P1', label: 'Volume as a multiple of baseline', min: 1, max: 10, step: 0.25, kind: 'mult',
    help: 'P1 needs window turnover at least this many times the instrument’s normal level.' },
  { key: 'p1MinReturnBps', rule: 'P1', label: 'Smallest price move (basis points)', min: 0, max: 1500, step: 50, kind: 'bps',
    help: 'A floor, so tiny moves in quiet instruments do not alert. 100 basis points = 1%.' },
  { key: 'p2RampShare', rule: 'P2', label: 'Linked group’s share of aggressive buying', min: 0, max: 1, step: 0.05, kind: 'share',
    help: 'P2 needs the group to supply at least this share of the market-order buying during the run-up.' },
  { key: 'p2NetSellRatio', rule: 'P2', label: 'Selling afterwards, relative to run-up buying', min: 0, max: 1.5, step: 0.05, kind: 'num',
    help: 'P2 needs the group to sell at least this fraction of what it bought aggressively, in the following window.' },
];

export const THRESHOLD_LABELS = {
  w1MinCount: 'Self-trades (count)', w1MinLots: 'Self-trade size (lots)',
  w2ClusterShare: 'Share of the group’s volume kept inside the group', w2NetRatio: 'Net position of the group (max)', w2InstrumentShare: 'Group share of instrument volume',
  p1ZRet: 'Move in baseline deviations', p1VolMult: 'Volume vs baseline', p1MinReturnBps: 'Move (basis points)',
  p2RampShare: 'Group share of aggressive buying', p2NetSellRatio: 'Selling afterwards vs run-up buying',
};

/** Metric label and display kind, per key. */
export const METRICS = {
  selfTradeCount: ['Self-trades', 'int'], selfTradeQty: ['Self-trade quantity', 'qty'], selfTradeNotional: ['Self-trade value', 'money'],
  internalShareOfClusterVolume: ['Group volume kept inside the group', 'pct'], netPositionRatio: ['Group net position (net ÷ total)', 'ratio'],
  internalShareOfInstrumentVolume: ['Group trading as share of instrument volume', 'pct'], internalQty: ['Internal quantity', 'qty'], externalQty: ['Quantity traded with outsiders', 'qty'],
  windowBins: ['Window length', 'bins'], peakWindowStartMs: ['Peak window starts', 'time'],
  returnBps: ['Price move', 'bps'], zReturn: ['Move in baseline deviations', 'x'], volumeMultiple: ['Volume vs baseline', 'x'], direction: ['Direction', 'text'],
  baselineMode: ['Baseline', 'text'], baselineSigma: ['Baseline deviation per bin', 'pct2'], baselineMedianNotional: ['Baseline value per bin (median)', 'money'],
  startBin: ['First bin of the move', 'int'], endBin: ['Last bin of the move', 'int'],
  rampAggressiveBuyShare: ['Group share of market-order buying in the run-up', 'pct'], rampAggressiveBuyQty: ['Group market-order buying', 'qty'],
  followNetSellQty: ['Group net selling afterwards', 'qty'], followNetSellRatio: ['Selling afterwards ÷ run-up buying', 'ratio'],
  pnlTicksQty: ['Group profit and loss over the period', 'moneySigned'], cashTicksQty: ['Group cash flow', 'moneySigned'], closingPosition: ['Group position at the end', 'qty'],
  markPrice: ['Last price used for marking', 'price'], p1AlertId: ['Linked spike alert', 'text'], peakBin: ['Peak bin', 'int'], rampEndBin: ['Run-up ends at bin', 'int'],
  rampWindow: ['Run-up window', 'window'], followWindow: ['Following window', 'window'],
};

const COMMON_ACTIONS = [
  ['Escalate', 'Pass the case to a senior reviewer with the account links, supporting trades and your notes, so someone with more context decides what happens next.'],
  ['File a suspicious-order report', 'Record the activity in a formal report for the venue’s compliance function and, where its rules require it, a regulator. The report records a concern; it does not state a conclusion.'],
];

export const FP_CAUSES = {
  'market-maker-subaccounts': 'Market-maker sub-accounts moving inventory between themselves',
  'benign-shock': 'A news-style price jump with broad participation',
  'coincidental-link': 'Two unrelated accounts that happen to share one attribute',
  'natural-volatility-or-volume': 'Ordinary volatility or volume in a busy instrument',
  unattributed: 'No planted cause: the threshold was simply too sensitive',
};

export const EPISODE_TEXT = {
  wash: 'a planted wash-trading episode: a small ring of accounts under one controller trading among themselves to make an instrument look busier than it is',
  pump: 'a planted pump-style episode: a linked group built a position quietly, pushed the price up with market orders while a promotion-like crowd piled in, then sold into that demand',
};
export const DECOY_TEXT = {
  'market-maker-subaccount-transfer': 'a benign cause: two sub-accounts of one market maker crossed trades to move inventory',
  'benign-news-shock': 'a benign cause: a news-style jump that drew broad, unlinked participation',
  'coincidental-shared-attribute': 'a benign cause: two honest accounts share one register attribute by coincidence',
};

export const TEXT = {
  equity: {
    page: 'IDX-style equity board',
    kicker: 'Simulator 1 of 2',
    heading: 'Equity board: leads on a lot-sized, price-banded market',
    scope: 'You are an analyst on an exchange’s market-surveillance desk, with full account-level data. This is a synthetic equity board: five fictional listed companies over six sessions, with one wash-trading ring and one pump-style group planted among ordinary retail flow, market makers and a few benign look-alikes. It is an educational model with an “IDX-style” flavour (round lots, a daily price band); it does not reproduce any real exchange’s rules. Alerts are leads for a human to review, not conclusions.',
    sessionNote: 'Six sessions of five hours, 30-minute bins. Session 1 is a clean warm-up that builds each instrument’s baseline.',
    timeHelp: 'Times read “D3 +02:30”: day 3, two hours thirty after the open.',
    qty: 'shares', qtyOne: 'share', lot: 'lot of 100 shares',
    units: 'Prices are shown in display units: the engine’s integer price ticks × the instrument’s tick size. Money is price × quantity in those units. There is no currency, and tick sizes differ by instrument, so compare money only within one instrument.',
    attrs: {
      beneficialOwnerId: { short: 'owner ID', plain: 'Declared beneficial owner on the account-opening form.' },
      fundingAccount: { short: 'funding acct', plain: 'Bank account used to fund the trading account.' },
      brokerBranch: { short: 'branch', plain: 'Broker branch that opened the account. Many honest customers share one.' },
      device: { short: 'device', plain: 'Trading device seen at login.' },
    },
    policyNotes: {
      strong1: 'Two accounts are linked only if they share a strong attribute (owner ID or funding account). Few false links, but a ring that hides the hub behind weak ties can fragment.',
      weak2: 'Linked on one strong attribute, or on two weak ones together (for example branch and device). The balanced starting point.',
      weak1: 'Linked on any shared attribute, even a single branch or device. Catches more hidden structure and pulls unrelated accounts into groups.',
    },
    actions: [
      ['Unusual-activity notice', 'Publish a notice that trading in the instrument is showing unusual activity, so the market is aware and the issuer can respond.'],
      ['Suspension', 'Pause trading in the instrument for a short period while the desk gathers facts. This stops everyone trading, including honest participants, so it is reserved for serious cases.'],
      ['Move to call auction', 'Switch the instrument from continuous trading to periodic auctions so prices form from batches of orders rather than rapid-fire trades.'],
      ...COMMON_ACTIONS,
    ],
    lookFor: 'In this market, ownership and funding links carry the weight; a shared broker branch or device is common among honest customers.',
  },
  crypto: {
    page: 'Crypto spot venue',
    kicker: 'Simulator 2 of 2',
    heading: 'Crypto spot venue: leads on a continuous, fast market',
    scope: 'You are an analyst on a trading venue’s market-surveillance desk, with full account-level data. This is a synthetic spot venue: five fictional tokens over ninety minutes, with one wash-trading ring and one pump-style group planted among ordinary retail flow, market makers and a few benign look-alikes. It is an educational model; it does not reproduce any real venue’s rules. Alerts are leads for a human to review, not conclusions.',
    sessionNote: 'One continuous session of ninety minutes, 1-minute bins. The first twenty minutes are a clean warm-up that builds each token’s baseline.',
    timeHelp: 'Times read “+25:45”: minutes and seconds since the session started.',
    qty: 'units', qtyOne: 'unit', lot: 'lot of 10 units',
    units: 'Prices are shown in display units: the engine’s integer price ticks × the token’s tick size (1 here). Money is price × quantity in those units. There is no currency, so compare money only within one instrument.',
    attrs: {
      kycIdentity: { short: 'KYC identity', plain: 'The verified person or entity behind the account.' },
      fundingWallet: { short: 'funding wallet', plain: 'Wallet that deposits funds into the account.' },
      withdrawalAddress: { short: 'withdrawal addr.', plain: 'Address the account withdraws to.' },
      apiKeyLineage: { short: 'API-key lineage', plain: 'Trading API keys created from one parent key.' },
      deviceFingerprint: { short: 'device', plain: 'Browser or device fingerprint at login.' },
      ip: { short: 'IP', plain: 'Network address at login. Shared offices and homes make this weak.' },
    },
    policyNotes: {
      strong1: 'Two accounts are linked only if they share a strong attribute (verified identity, funding wallet, withdrawal address or API-key lineage). Few false links, but a ring that hides its hub behind weak ties can fragment.',
      weak2: 'Linked on one strong attribute, or on two weak ones together (device and IP). The balanced starting point.',
      weak1: 'Linked on any shared attribute, even a single IP address. Catches more hidden structure and pulls unrelated accounts into groups.',
    },
    actions: [
      ['Restrict account', 'Limit what the accounts can do, for example reduce-only trading or a withdrawal hold, while the desk reviews. Unlike a market-wide halt it affects only the accounts concerned.'],
      ['Widen monitoring', 'Keep the accounts and the instrument under closer watch: lower alert thresholds, more frequent reviews, and extra data capture, without restricting anyone yet.'],
      ...COMMON_ACTIONS,
    ],
    lookFor: 'In this market, wallet and API-key lineage links carry the weight; a shared IP address is common among honest users.',
  },
};

/** The rules in plain words, with live threshold values. */
export function methodRules(th, defs) {
  const v = (k, f = (x) => x) => `<strong>${f(th[k])}</strong>${th[k] !== defs[k] ? ` <span class="muted">(default ${f(defs[k])})</span>` : ''}`;
  const p = (x) => `${Math.round(x * 100)}%`;
  return [
    ['W1', 'Self-trade', `Raises a lead when the same account is on both sides of a trade. Needs at least ${v('w1MinCount')} such trade(s) of at least ${v('w1MinLots')} lot(s); self-trades by one account in one instrument within ${v('w1MergeBins')} bins become one alert. It is cheap and precise, but a crude test: a careful operator avoids it.`],
    ['W2', 'Linked accounts trading together', `Groups accounts using the linkage policy, then looks at windows of ${v('w2WindowBins')} bins. A group is flagged when at least ${v('w2ClusterShare', p)} of the volume it took part in was between its own accounts, its net position stayed within ${v('w2NetRatio', p)} of its total, its internal trading was at least ${v('w2InstrumentShare', p)} of all volume in the instrument, and it traded at least ${v('w2MinInternalLots')} lots internally. Flagged windows within ${v('w2MergeGapBins')} bins are merged.`],
    ['P1', 'Price and volume spike', `Compares each window of ${v('p1WindowBins')} bins with a baseline built from the first ${v('p1BaselineBins')} bins. Flags a move of at least ${v('p1ZRet')} baseline deviations (scaled by window length), at least ${v('p1MinReturnBps')} basis points, on at least ${v('p1VolMult')}× normal turnover. The baseline is ${th.p1Mode === 'global' ? '<strong>one market-wide value</strong>' : 'each instrument’s own'}. It names no accounts: it only says that something happened.`],
    ['P2', 'Linked group rides the move', `Attached to a P1 alert. Looks at groups of at least ${v('p2MinClusterSize')} linked accounts and asks whether one group supplied at least ${v('p2RampShare', p)} of the market-order buying while the price rose, bought at least ${v('p2MinRampLots')} lots that way, and then, within the next ${v('p2FollowBins')} bins, sold at least ${v('p2NetSellRatio', p)} of that amount.`],
  ];
}

export const METHOD_GENERAL = {
  linkage: 'Linkage uses only the attributes on the account register. Each pair of accounts that shares an attribute gets an edge. The policy decides which edges count: strict needs a strong attribute, the default needs one strong or two weak, loose accepts any. Counted edges join accounts into groups. Because the rules look at groups rather than single accounts, this step does most of the work; a threshold change moves a handful of alerts, a linkage change can remove a whole episode from view.',
  limits: [
    'The venue rules are simplified: no auctions, halts or circuit breakers, only limit and market orders, no iceberg or stop orders. The equity board has a lot size and a daily price band; the crypto venue has neither a band nor a halt.',
    'No self-trade prevention, margin or borrowing limits, fees, settlement, or activity on other venues or in derivatives.',
    'No order-level behaviours such as spoofing or layering, and no marking the close, front-running, insider information or real news timing.',
    'Linkage uses register attributes only. There is no behavioural similarity, and no mistakes or gaps in the register, which real data always has.',
    'One wash episode and one pump episode per run, so every score rests on a handful of alerts. Detection works on whole bins, so timing is only as precise as one bin.',
    'Traders are simple rule-followers with random draws, and prices are a stylised random walk. Real flow is messier and real abusers adapt.',
    'Baselines come from a clean warm-up that the planted episodes avoid by construction. A real desk must build baselines from history that may already be contaminated.',
    'Precision and recall here are computed over a handful of alerts. Use several seeds before reading anything into one number.',
  ],
};

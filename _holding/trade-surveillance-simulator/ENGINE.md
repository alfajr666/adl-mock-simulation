# Trade-surveillance simulator: engine contract

Model `surv-model-1.2.1`. Plain ES modules, zero dependencies, no build step, no DOM, no `Math.random`, no `Date.now`.
All data is synthetic; company and token names are fictional (equity codes end in `.SIM`, crypto in `-SIMU`). The viewpoint is an
exchange surveillance desk with full account-level data. Alerts are leads for a human to review; nothing here says a participant
did something wrong.

`npm test` (Node 20+, 113 tests, about 8.5 s). `npm run seeds` prints the 100-seed study as markdown (`-- --policy weak1`, `-- --baseline trailing`, `-- --n 50`).

## API

```js
import { runScenario, sweep, seedStudy, linkageComparison, caseView, detect, detectionContext, detectionTargets,
         checkInvariants, MODEL_VERSION, DEFAULTS, LINKAGE_POLICIES, CONFIG_IDS, PATTERN_RULES, clearCache } from './engine/index.js';
```

| Call | Returns |
|---|---|
| `runScenario(configId, {seed?, thresholds?, linkagePolicy?, fresh?})` | one full result (below). `configId` is `'equity'` or `'crypto'`. Defaults: seed 1, `'weak2'`, `DEFAULTS.thresholds[configId]` with `thresholds` merged over it. **Unknown threshold keys throw**, as do bad `p1Mode` / `p1Baseline` values. The result is deep-frozen. |
| `sweep(configId, param, values, baseOpts?)` | `{configId, param, seed, rows}`; `param` is a threshold key or `'linkagePolicy'`. Row shape below. |
| `linkageComparison(configId, baseOpts?)` | `sweep` over `strong1, weak2, weak1`. |
| `seedStudy(configId, seeds, opts?)` | `{configId, seeds, opts, rows, summary, trapRates, targetsPassing, failures}`. `summary[column] = {median,min,max}`. `targetsPassing` = seeds where both planted episodes were found cleanly; `failures = [{seed, failed, episodesFound, episodesDiluted, episodesPriceOnly}]`; per-rule columns `w2Found`, `p1PriceOnly` (P1 only ever flags the move), `p2Found`; `trapRates = {explainableAlert, shockAlertsOnP1, shockAlertsOnP2}` (share of seeds where each designed trap fired). |
| `caseView(result, alertId)` | case-file view model (below). |
| `detect({market, register, trades, thresholds, linkagePolicy})` | `{alerts, linkage}` on any tape, including hand-built ones. |
| `detectionContext({market, trades})` | what the rules see: `{market, trades, prep, tradesByInst}`. Nothing from the scenario or ground truth (a test pins this). |
| `detectionTargets(result)` | `{bothEpisodesFound, all, traps:{explainableAlert, shockAlertsOnP1, shockAlertsOnP2}}`. The only pass/fail target is `bothEpisodesFound` = both planted episodes are `clean` (a rule that names accounts, W2 or P2, matches with accountPrecision >= 0.5); a pump flagged only by P1 is `priceOnly`, not clean. `all` equals it; `traps` is information. |
| `tellStudy(configId, seeds)` | `{configId, seeds, register:[{rule, target:'ringPump'\|'makerSubs', flagged, precision, recall, baseRate}], tape:{method, busiestInstrumentShare, medians}}`: measured tells that separate planted accounts from honest ones, pooled over `seeds` (see "Register tells and tape tells"). Disclosure, not a detector. |
| `checkInvariants(result)` | recomputes positions and cash from the tape. Healthy: `crossedBookEvents`, `badAccounts`, `nonIntegerOrNonPositive`, `ledgerMismatch` 0, `cashSum` 0, every `positionSumByInstrument` value 0. |
| `clearCache()` | drops cached simulations. |

The market is simulated once per `(configId, seed)` and cached; thresholds and linkage only re-run detection. Returned objects are
frozen (copy before mutating). `fresh: true` bypasses the cache. Time is integer ms from session start. Equity day `d` starts at
`d * market.session.dayMs`. `market.bins[i] = {index, day, t0, t1}` are half-open `[t0, t1)`; only trading time is listed. Every rule window is a run of whole bins.

### `runScenario` result

```js
{ modelVersion, configId, seed, linkagePolicy, thresholds,
  market:   { label, session:{days,stepsPerDay,stepMs,dayMs,binSteps,...}, binMs, bins:[...],
              instruments:[{id,name,tickSize,lotSize,bandPct|null,refPrice0}] },
  register: { schema:[{key,label,strength:'strong'|'weak',rationale,caveat}], ownerAttribute,
              rows:[{acct, declaredOwner, type:'individual'|'corporate'|'market_maker', attributes:{[key]:value}}] },
  tape:     { orders:[...], cancels:[...], trades:[...] },
  ledger:   { positions:{[acct]:{[inst]:int}}, cash:{[acct]:int} },
  stats:    { orders, cancels, trades, rejections:{BAND,LOT,PRICE,QTY}, crossedBookEvents },
  linkage:  { policy, clusters:[{id,accounts,edges:[{a,b,shared:[{key,strength,value}]}]}], clusterOf:{[acct]:id},
              singletonCount, edges:[{a,b,shared,linked}] },
  alerts:   [Alert], score: Score, groundTruth: GroundTruth }
```

Prices are integer ticks (display price = `ticks * tickSize`); quantities are integers (equity shares in multiples of 100, crypto units in
multiples of 10); notional = `price * qty`. Cluster ids are `CL-<first account id>`; singletons have ids in `clusterOf`. Account `type` is
drawn independently of role (about 13% corporate among non-makers); only makers are `market_maker`.
Tape records carry `seq, t, inst, acct`: orders (`status` `accepted|rejected`, rejection `reason` `BAND|LOT`), cancels (`REQUOTE, REPLACED,
EXPIRED, UNFILLED_CROSS, MARKET_REMAINDER, BAND_REPRICE`), trades (`side, acct` are the aggressor's; `buyAcct, sellAcct, buyOrderId, sellOrderId`; price is the resting order's).

### Register attributes (strength, meaning and caveat are in `register.schema`)

Equity: strong `beneficialOwnerId` (same declared owner: identity, not a link), `fundingAccount` (family, joint accounts); weak `brokerBranch`
(7 branches serve everyone), `device`. Crypto: strong `controllingPerson` (identity, not a link), `fundingWallet`, `apiKeyLineage` (keys under one master key;
bot platforms issue keys for unrelated customers); weak `withdrawalAddress` (hosted addresses), `deviceFingerprint`, `ip` (carrier or office NAT).
Honest structure in the register: pooled weak collisions over all non-maker accounts (planted ones included); random strong collisions among honest accounts;
honest groups of 2, 3 and 4 (family pairs, a trio, two colleague quads, people with several accounts) and two household pairs sharing two weak
attributes; about 15% of crypto retail on three shared bot master keys.

### Alert

```js
{ id: 'RULE|instrument|cluster-or-acct-or-direction|startMs', rule: 'W1'|'W2'|'P1'|'P2', instrument,
  window:{startMs,endMs}, accounts:[acct], cluster:{id,accounts}|null,       // P1: no accounts
  metrics:{...}, thresholdsCrossed:{[key]:{value,threshold}}, supportingTradeIds:[...], supportingOrderIds:[...] }
```
- W1 `selfTradeCount, selfTradeQty, selfTradeNotional`; merging counts bins (`w1MergeBins`).
- W2 (peak window of the merged run): `clusterInternalShare` (internal qty / all qty the cluster traded), `instrumentInternalShare` (internal qty / instrument qty),
  `netChangeOverInternal` = abs(external buys - external sells) / internal qty (so a one-way internal transfer also scores 0), `internalQty, externalQty, windowBins`,
  and over the merged window `memberRoundTrip [{acct, internalBought, internalSold, roundTripQty}]` (roundTripQty = min of the two) and `internalRoundTripShare`
  (round-trip volume / internal volume, counting both sides): high for a two-way exchange, 0 for a one-way transfer.
- P1 `returnBps` (signed), `moveScore`, `volumeMultiple`, `direction` `'up'|'down'`, `baselineMode`, `baselineSource`, `baselineVolatility`, `baselineMedianNotional`,
  `baselineBins {start,end}`, `startBin, endBin`. `moveScore` = largest excursion from the window start relative to the instrument's baseline volatility (RMS bin return)
  scaled by sqrt(window bins). It is not a statistical z-score.
- P2 `rampAggressiveBuyShare, rampAggressiveBuyQty, followNetSellQty, followNetSellRatio, accumulationNetQty, accumulationBuyShareOfVolume` (cluster buys in the lookback
  before the P1 window, **excluding trades inside the cluster**, over instrument volume then), `pnlTicksQty, cashTicksQty, closingPosition, markPrice, p1AlertId, peakBin,
  rampEndBin, rampWindow, followWindow, lookbackWindow`.

### Score, labels and cases

Pattern rules (W2, P1, P2) are scored against the planted episodes; W1 is scored apart. **The headline is the case level** (rule-agnostic); rule-level groups and
alert counts are detail.

```js
score = { overall, byRule:{W2,P1,P2}, selfMatch, caseSummary, cases, byEpisode, decoysAlerted:[ids], causes, causesByRule, labels }
labels[alertId] = {label:'MATCH'|'MATCH_DILUTED'|'EXPLAINABLE'|'UNRELATED'|'SELF_MATCH', episodeIds, cause, decoyIds, accountPrecision}
caseSummary = { cases, episodeCases, dilutedEpisodeCases, priceOnlyEpisodeCases, trapCases, explainableCases, unrelatedCases,
                shareMatchingEpisode, shareMatchingOrExplainable, episodesFound, episodesPriceOnly, episodesMissed }
cases[] = { id, kind:'episode'|'diluted-episode'|'price-only-episode'|'trap'|'unrelated', key, episodeId, decoyId, instrument, rules, alertIds, explainable }
overall | byRule[r] = { alerts:{total,match,matchDiluted,explainable,unrelated}, groups:{total,episodeMatches,diluted,explainable,unrelated},
                        episodes:{planted,found,diluted,priceOnly,missed}, precision:{alert:{match,matchOrExplainable}, group:{...}}, recall }
byEpisode = [{episodeId, type, detectedBy:[rules with a MATCH], status:'clean'|'diluted'|'priceOnly'|'missed', missed}]      // missed = status 'missed'
selfMatch = {alerts, onPlantedAccounts, onHonestAlgoAccounts, onOtherAccounts, accountsFlagged, note}
```
- `MATCH`: maps to a planted episode (same instrument, overlapping half-open window, rule type fits; W2 needs 2 episode accounts, P2 1, P1 none) **and** `accountPrecision`
  (planted episode accounts in the alert / accounts the alert names; null for P1) is at least 0.5. Below that the label is `MATCH_DILUTED`. Falling P1 alerts on the pump instrument
  count as matching the pump episode (P1 sees the move, not the direction's role).
- `EXPLAINABLE`: a W2 alert whose accounts are all one maker's sub-accounts, in the instrument and time of a same-owner cross (cause `same-owner-cross`; needs a documented explanation).
- `UNRELATED` causes: `benign-shock`, `benign-burst` (seed-drawn honest momentum burst), `block-trade` (seed-drawn honest block order), `honest-linked-trading` (alert accounts all inside one
  honest group), `coincidental-link` (inside the single-attribute honest pair), `background-collision` (a cluster of honest accounts), `natural-move` (P1, no cause), `unattributed`.
- Episode status: `clean` = a rule that names accounts (W2 or P2) has a MATCH alert; `diluted` = such a rule matches only with accountPrecision < 0.5; `priceOnly` = only P1 matched (the move was flagged, nobody was named); `missed`. Order of precedence: clean, diluted, priceOnly, missed. In `byRule`, P1's finds are always `priceOnly`, so `byRule.P1.recall` is 0 by construction.
- Cases: one per planted episode found by any pattern rule (`episode` if clean, `diluted-episode`, or `price-only-episode`), one per designed trap that alerted (by decoy id), one per unrelated cluster
  (instrument + cluster id + merged overlapping windows; P1 uses cluster `-`). `episodesFound` = clean finds; diluted and price-only finds are reported separately (`dilutedEpisodeCases`, `priceOnlyEpisodeCases`); `episodesMissed` = not found at all.
  `shareMatchingEpisode = episodeCases / cases`; `shareMatchingOrExplainable = (episodeCases + explainableCases) / cases`. Recall = clean finds / planted.
- Rule-level groups: MATCH by (rule, episode), EXPLAINABLE by (rule, decoy id), UNRELATED by (rule, instrument, cluster, merged window). Precision is `match` = MATCH / all and `matchOrExplainable`.

### Sweep rows

`{value, caseSummary, episodesFound, episodesDiluted, episodesPriceOnly, episodesMissed, decoysAlerted, groups, alerts, precision, recall, overall, byRule, selfMatch, causes, linkage?}`. Chart `caseSummary`,
`episodesFound` and `decoysAlerted`, not raw alert counts. For `'linkagePolicy'`, `linkage = {clusters, largestCluster, ringFragments, ringWhole, falseLinkFormed, designedPairsLinked,
falseLinkedPairs, meanAccountsPerMatchingAlert, falseLinkAlerts}`; `falseLinkedPairs` counts pairs of unrelated honest accounts sharing a cluster (designed honest groups included: 23 at the default policy).

### `caseView(result, alertId)`

```js
{ modelVersion, alert, instrument, linkagePolicy, accountsNote,
  accounts:[{acct,declaredOwner,type,attributes (a copy),clusterId,finalPosition,aggressiveBuyQty,aggressiveSellQty}],   // no roles
  linkage:{edges, clusters}, trades:[trade + {notional,selfTrade}],
  series:[{bin,startMs,endMs,open,high,low,close,qty,notional,trades,inAlertWindow}],     // inAlertWindow = bin overlaps the alert
  clusterSeries:[{clusterId,accounts,points:[{bin,endMs,position,cash,pnl}]}],             // pnl = cash + position * bin close
  groundTruth:{label,episodeIds,cause,decoyIds,accountRoles,episodes,decoys} }
```
A P1 case lists top aggressive buyers and sellers (a falling alert leads with sellers). Planted truth appears only under `groundTruth`. Planted roles start with `planted-`
(`planted-wash-ring-spoke`, `-hub`, `planted-pump-group`, `planted-maker-sub-account`); background roles: `retail`, `retail-momentum`, `honest-algo`, `honest-family-pair`,
`honest-household-pair`, `honest-colleague-group`, `honest-multi-account-person`, `honest-coincidental-link`, `market-maker`. Decoys carry `designed: true` for the two teaching traps
(`DEC-MM-n` same-owner crosses, `DEC-SHOCK-1`); others are seed-drawn background (`DEC-GROUP-*`, `DEC-BURST-n`, `DEC-BLOCK-n`) or register structure (`DEC-LINK-1`, `DEC-FAMILY-n`,
`DEC-HOUSEHOLD-n`, `DEC-ALGO-1`). Show it only in a separate answer-key panel.

## Rules and default thresholds

All thresholds are in `DEFAULTS.thresholds[configId]`; the rules read nothing else (tested). Windows are bins (equity 30 min, crypto 1 min). `eq / cr` where they differ.

| Key | Default | Meaning |
|---|---|---|
| `w1MinCount`, `w1MinLots` | 1, 1 | W1 self-match: same account both sides |
| `w1MergeBins` | 60 / 90 | self-matches by one account in one instrument within this many bins form one alert |
| `w2WindowBins`, `w2MergeGapBins` | 4, 8 / 5, 6 | W2 window and merge gap |
| `w2ClusterShare` | 0.5 | `clusterInternalShare` at least this |
| `w2NetRatio` | 0.6 | `netChangeOverInternal` at most this |
| `w2InstrumentShare` | 0.25 | `instrumentInternalShare` at least this |
| `w2MinInternalLots` | 10 | minimum internal volume (lots) |
| `p1Mode` | `'instrument'` | `'global'`: one baseline (the median instrument) for all instruments |
| `p1Baseline` | `'warmup'` | `'warmup'`: first N bins; `'trailing'`: the N bins before each window (excluded from it) |
| `p1BaselineBins` | 10 / 20 | N |
| `p1MinTrailingBins` | 4 | trailing baseline: minimum bins of history before a window can be flagged (fewer: the window is skipped) |
| `p1WindowBins`, `p1MergeGapBins` | 10, 4 / 5, 6 | window and merge gap; rising and falling windows are flagged and merged separately |
| `p1MoveScore` | 5 | move relative to the instrument's baseline volatility |
| `p1VolMult` | 2 | window notional over bins x median baseline notional |
| `p1MinReturnBps` | 300 | floor on the absolute move |
| `p2MinClusterSize` | 2 | linked groups only |
| `p2RampShare` | 0.25 | cluster share of aggressive buying from window start to ramp end |
| `p2RampEndFraction` | 0.6 | ramp ends at the first bin covering this fraction of the window's rise |
| `p2FollowBins` | 20 / 10 | following window length |
| `p2NetSellRatio` | 0.3 | net selling in the following window over aggressive ramp buying |
| `p2MinRampLots`, `p2LookbackBins` | 5, 30 / 5, 40 | minimum ramp buying; lookback for accumulation and P&L |

P2 runs only on rising P1 alerts. Linkage (`LINKAGE_POLICIES`): `strong1` one shared strong attribute; `weak2` one strong or two weak (default); `weak1` any shared attribute.
Counterparty-concentration rules are out of scope; hub-and-spoke concentration is why strict linkage can miss the ring.

## Scenario design

Both configs: 40 retail accounts (12 momentum followers with individual sensitivity and a cooldown; 2 honest algo accounts that now and then self-match; honest groups as above),
post-only makers (equity: 1 maker with 2 sub-accounts; crypto: that plus a single-account maker), 5 instruments, a 4-account wash ring and a 3-account pump group (two members strongly
linked, the third only through two weak attributes). Ids are shuffled. Planted accounts also trade other names at about a third of the retail rate (cover activity).
Seed-drawn benign background (not hand-placed, `drawBackgroundEvents`): about half the honest groups cross against each other in 1-2 episodes of 3-7 trades in a random instrument and
time; 0-2 honest momentum bursts and 0-2 block orders in the control instruments.

| | Equity (lot 100, tick units, daily band +-20% of previous close for limit and market orders; stale resting orders outside a new band are cancelled; "loosely after Indonesian market conventions") | Crypto (continuous, no band, finer tick) |
|---|---|---|
| Steps | 6 sessions x 60 steps of 5 min, bin 30 min; session 0 clean | 360 steps of 15 s, bin 1 min; first 20 min clean |
| Wash | QFRO.SIM steps 70-290, ring lots 3-9 (honest retail orders 1-6 lots, ring mean trade size is still about twice the honest mean: see tape tells); 15% spoke-spoke crosses, 1% random self-cross, 8% one-sided market orders | AQRL-SIMU steps 90-230, ring lots 8-28 (honest 1-20; same caveat) |
| Pump | VLDN.SIM: accumulate 60-150, ramp 150-240, distribute from 240 | BLXT-SIMU: accumulate 100-236, ramp 240-264 (signal at `episode.signalMs`), distribute from 264 |
| Shock | TMRX.SIM +13% at step 200 | DRNO-SIMU +9% at step 150 |
| Maker crosses | NBLE.SIM steps 140-141, 335 | ELVY-SIMU steps 190-191, 320 |
| Controls | NBLE.SIM low volatility, HZPK.SIM high | ELVY-SIMU, FQRX-SIMU |

The retail crowd is scripted: a low-rate `ramp-interest` crowd during the ramp and a `promotion` crowd after it (equity steps 235-290, crypto 262-292). The pump group trades its ramp after
the retail crowd within each step. The pump's profit from selling into the crowd is assumed by the scenario, not emergent.

## Measured results (seeds 1-100, defaults, linkage `weak2`, warm-up baseline; `npm run seeds` reproduces them)

Everything below is re-measured with 1.2.1 (wash-episode window and stats now use the wash instrument only; episode statuses `clean`, `diluted`, `priceOnly`, `missed`).

- **Detection (episode status at the default policy).**
  - Equity: wash clean 100, pump clean 100 (diluted 0, priceOnly 0, missed 0). Both clean in 100 of 100 seeds. Per rule: W2 finds the wash 100/100 (clean); P1 flags the pump move in 100/100 (always `priceOnly` by itself); P2 names the pump cleanly in 100/100.
  - Crypto: wash clean 100; pump clean 97, **diluted 3** (priceOnly 0, missed 0). Both clean in **97 of 100** seeds; failing seeds 31, 58 and 79: in each, P2 matched the pump but named a cluster in which fewer than half the accounts were pump accounts, so the find is `diluted`; P1 flagged the move in all three. Per rule: W2 100/100 clean; P1 flags the pump in 100/100; P2 97 clean, 3 diluted.
  - Counting a P1-only flag as a clean find would have given 100/100 in crypto; it no longer does, and nothing was tuned to restore that.
- **Designed traps (reported, not required; equity / crypto).** Explainable (same-owner cross) alert present 95% / 98%; shock alert on P1 100% / 100%; shock alert on P2 1% / 2%.
- **Case level.** `shareMatchingEpisode` (episode cases / cases): equity median 0.29, min 0.18, max 0.50, 8 distinct values, most common value 0.29 in 27 of 100 seeds; crypto median 0.29, min 0.14, max 0.40, 9 distinct values, most common 27 of 100.
  `shareMatchingOrExplainable`: equity median 0.43 (0.27-0.75), crypto 0.50 (0.29-0.80). Cases per run: median 7 (equity min 4, max 11; crypto 5-12): 2 episode cases, trap cases equity 1-2 and crypto 1-3, unrelated cases median 3 (0-7) in both.
- **What governs the case-level share.** Almost all non-trap unrelated cases are W2 alerts on scripted crosses between linked honest accounts. The rate is set in the scenario: each of 9 honest groups crosses in a given seed with probability 0.5, in 1-2 episodes of 3-7 trades of 2-6 lots at a random instrument and time. Measured over 100 seeds, unrelated alerts by cause:
  equity: honest-linked-trading 265, background-collision 26 (W2, clusters of honest accounts), benign-shock 101, benign-burst 0, block-trade 0, natural-move 0;
  crypto: honest-linked-trading 200, background-collision 81, benign-shock 102, benign-burst 4, block-trade 0, natural-move 2.
  Honest momentum bursts and block orders (0-2 each per seed, control instruments) therefore produce essentially no alerts. The share is governed by the scripted cross rate, not by emergent behaviour. Two calibration tests pin that rate as a scenario property
  (`calibration.test.mjs`: over 30% of unrelated alerts at the default policy are not designed traps; `linkage.test.mjs`: default unrelated cases exceed strict by more than 0.3).
- **Linkage table** (means per run; "both clean" = seeds out of 100):

| config | policy | clean | diluted | priceOnly | missed | both clean | unrelated cases | largest cluster | false-linked pairs | accounts named per matching alert |
|---|---|---|---|---|---|---|---|---|---|---|
| equity | strong1 | 1.02 | 0.00 | 0.00 | 0.98 | 2 | 2.11 | 4.1 | 21.9 | 2.0 |
| equity | weak2 | 2.00 | 0.00 | 0.00 | 0.00 | 100 | 2.91 | 4.6 | 25.4 | 3.7 |
| equity | weak1 | 0.00 | 1.01 | 0.99 | 0.00 | 0 | 4.02 | 48.8 | 770.7 | 48.8 |
| crypto | strong1 | 1.16 | 0.00 | 0.00 | 0.84 | 16 | 2.18 | 6.5 | 37.8 | 2.1 |
| crypto | weak2 | 1.97 | 0.03 | 0.00 | 0.00 | 97 | 2.87 | 7.0 | 44.1 | 3.7 |
| crypto | weak1 | 0.33 | 1.25 | 0.42 | 0.00 | 2 | 9.98 | 35.0 | 393.3 | 29.5 |

  Strict linkage misses the ring cleanly almost always; loose linkage finds both cleanly in 0 (equity) and 2 (crypto) of 100 seeds (the rest are diluted or price-only), loses the explainable alert (rate 0% equity, 28% crypto) and multiplies unrelated cases.
  The false-linked-pair counts include the designed honest groups (23 at the default policy).
- **Baseline.** The defaults coincide with the scenario's clean period. Both clean (of 100) / pump move flagged by P1 / shock alert on P1, equity then crypto: warm-up default N 100 / 100 / 1.00 and 97 / 100 / 1.00; trailing default N 100 / 100 / 1.00 and 97 / 100 / 1.00;
  warm-up with N spanning the episodes (55 / 80 bins) **92 / 92 / 0.00** and **97 / 100 / 0.01**; trailing with long N (30 / 40) 100 / 100 / 1.00 and 97 / 100 / 1.00. A long warm-up spans the shock as well as the pump, so it makes P1 less sensitive across the board
  (here it removes the shock alert and costs the equity pump 8 of 100 seeds); it is not specifically blind to the pump. (Crypto's 97 is the three diluted seeds, unrelated to the baseline.) Trailing is not contaminated here because the history before each planted episode is quiet.
- **Wash ring share.** Ring internal quantity / instrument quantity over the (wash-instrument) episode window: equity median 0.43 (q10-q90 0.38-0.48; min-max 0.35-0.51); crypto median 0.49 (q10-q90 0.43-0.57; min-max 0.38-0.65). The alert threshold is 0.25 (ring windows peak higher). The ring's side-volume share is at most 1 by construction after the 1.2.1 fix (it reached 1.005 before).
- **Pump ramp share** (group share of aggressive buying from the P1 window start to ramp end, matching P2 alerts; n = 100 equity, 97 crypto): equity median 0.60 (q10-q90 0.53-0.68; min-max 0.47-0.75); crypto median 0.62 (q10-q90 0.50-0.75; min-max 0.45-0.83). Threshold 0.25.
- **Self-match hygiene (W1).** Honest algo accounts alert in 100 of 100 runs (alerts per run, all accounts: equity median 6, range 2-11; crypto median 5, range 1-9). Planted accounts alert in 62 (equity) and 30 (crypto) of 100 runs. W1 is outside every headline figure.

## Register tells and tape tells (disclosure; `tellStudy`)

The register is not an answer key for simple rules (cluster size, "shares attribute X"), but it is not secret either. Measured over 100 seeds, target = wash ring + pump group accounts (base rate 0.14); maker sub-accounts are scored as a separate target
(no register rule exceeds precision 0.282 on them). Precision / recall, equity then crypto:

| register rule | equity | crypto |
|---|---|---|
| default-policy cluster holds a strong link and a weak-only link | 0.795 / 1.00 | 0.620 / 1.00 |
| has a strong partner and a weak-only partner (default policy) | 0.810 / 0.30 | 0.715 / 0.29 |
| default-policy cluster size >= 3 | 0.319 / 1.00 | 0.276 / 1.00 |
| strict-policy cluster size >= 3 | 0.173 / 0.43 | 0.147 / 0.43 |
| shares the most identifying weak attribute (`device` / `deviceFingerprint`) | 0.383 / 0.61 | 0.405 / 0.60 |
| shares two or more attributes with one other account | 0.315 / 0.69 | 0.294 / 0.60 |
| an attribute value used by exactly 2 accounts | 0.265 / 0.68 | 0.276 / 1.00 |
| shares a value that is not from a background pool | 0.218 / 0.96 | 0.210 / 0.99 |

The strongest structural tell is the planted mix of strong links (spokes, pump pair) with weak-only links (hub, third pump member). The 1.1.0 claim that no register rule exceeds 0.405 was wrong and is withdrawn; the roster test now pins these values within 0.02.

Tape tell (busiest-instrument share). Method: makers excluded by register type (`market_maker`), each account's trades counted on both sides, at least 20 trades, flag when the busiest instrument holds at least 0.65 of the account's quantity; target ring + pump accounts. Equity precision 1.00, recall 0.98;
crypto precision 0.99, recall 0.87. Medians over qualifying accounts, planted vs honest: busiest-instrument share 0.83 vs 0.34 (equity) and 0.77 vs 0.43 (crypto); top-counterparty share 0.32 vs 0.20 (both); mean trade size 3.2 vs 1.4 lots (equity) and 6.7 vs 2.8 lots (crypto), so planted accounts trade about 2.2x and 2.4x the honest mean size.
The planted accounts' order sizes overlap the honest range, but their means do not; the earlier statement that sizes "overlap" refers to the range only.

## Notes on behaviour you may see in charts

- Sweeps can look non-monotonic at alert level because raising a threshold can split one merged run into two alerts; chart cases and episodes.
- A one-step news jump can outscore a multi-bin pump ramp on `moveScore`: P1 is blind to cause, and blind to who traded.
- The W2 sweep on `w2InstrumentShare`: the ring (about 0.43-0.49 of the instrument over the episode, higher in its peak window) and the same-owner crosses (higher still) are not separated by this parameter; a strict value loses the ring first.
- Calibration is by seed scan, not by a claim that every seed holds.

## What this does not model, and what is still easy by design

- No real exchange rules (band, lot, tick are simplified); no auctions, halts, other order types, self-trade prevention, margin, fees, settlement, cross-venue or derivatives activity.
- No spoofing, layering, marking the close, front-running or insider information. Counterparty-concentration and behavioural-similarity rules are absent.
- One wash episode and one pump episode per config; timing resolution is one bin; agents are simple rules with random draws; price formation is a stylised random-walk fair value that quotes drift towards.
- Remaining tells, with measured values (disclosed, not hidden): the register tells above (mixed strong and weak-only clusters, 0.795 / 0.620 precision at recall 1.0); the tape tell (busiest-instrument share, 1.00 / 0.98 equity, 0.99 / 0.87 crypto); planted accounts' larger mean trade size (about 2.2-2.4x honest);
  the ring trades only inside the spread at a steady rate and ends near flat; the hub is reachable only through two weak attributes (the strict-linkage result, by design); the retail crowds are scripted and the pump's profit is assumed; the baseline period is clean by construction;
  the honest cross rate that drives the unrelated cases is a scenario parameter; the scenario sets honest volume in the wash target so the ring is 0.43-0.49 of its quantity at the median.
- Floats are used for sampling and statistics; money (prices, quantities, notional, cash, P&L) is integer.

## Statements a write-up must include

1. Detection (seeds 1-100, defaults): equity both episodes clean in 100/100 (wash 100 clean; pump 100 clean; per rule W2 100, P1 flags the move 100 but is price-only on its own, P2 100 clean). Crypto both clean in **97/100** (wash 100 clean; pump 97 clean, 3 diluted: seeds 31, 58, 79; priceOnly 0; missed 0; W2 100, P1 flags 100, P2 97 clean + 3 diluted).
2. Traps are reported, not required: explainable alert 95% / 98%, shock alert on P1 100% / 100%, on P2 1% / 2% (equity / crypto).
3. Case level: shareMatchingEpisode median 0.29 / 0.29, min 0.18 / 0.14, max 0.50 / 0.40; 8 / 9 distinct values; most common value in 27 / 27 of 100 seeds. shareMatchingOrExplainable median 0.43 / 0.50. It is governed by the scripted honest-cross rate (each of 9 honest groups crosses with probability 0.5 per seed, 1-2 episodes of 3-7 trades): of 100 seeds' unrelated alerts, equity 291 are W2 on honest accounts (265 honest-linked, 26 collision) vs 101 shock, 0 bursts, 0 blocks; crypto 281 vs 102 shock, 4 bursts, 0 blocks, 2 natural moves.
4. Linkage (table above): strict finds both cleanly in 2 / 16 seeds; loose in 0 / 2 (equity 1.01 diluted and 0.99 price-only per run; crypto 1.25 diluted and 0.42 price-only); largest cluster 48.8 / 35.0 accounts; false-linked pairs 771 / 393; unrelated cases 4.0 / 10.0 versus 2.9 / 2.9 at default; accounts named per matching alert 48.8 / 29.5 versus 3.7 / 3.7.
5. Baseline: warm-up spanning the episodes leaves both-clean at 92 (equity) / 97 (crypto) of 100, pump move flagged 92 / 100, shock alert 0.00 / 0.01; trailing and clean warm-up keep the shock alert at 1.00. P1 becomes less sensitive across the board.
6. Ring internal share of instrument quantity: median 0.43 (q10-q90 0.38-0.48; min-max 0.35-0.51) equity, 0.49 (0.43-0.57; 0.38-0.65) crypto. Pump ramp share: median 0.60 (q10-q90 0.53-0.68; min-max 0.47-0.75) equity, 0.62 (0.50-0.75; 0.45-0.83) crypto.
7. Self-match hygiene: honest algo accounts alert in 100/100 runs; planted accounts in 62 (equity) / 30 (crypto) of 100 runs; excluded from all headline figures.
8. Register tells: a default-policy cluster holding both a strong and a weak-only link identifies ring+pump accounts at precision 0.795 / 0.620 with recall 1.00 (base rate 0.14); other structural rules reach 0.2-0.8 (table). Maker sub-accounts are not singled out (precision at most 0.282).
9. Tape tells: busiest-instrument share >= 0.65 (>= 20 trades, makers excluded by register type) identifies ring+pump accounts at precision 1.00 / 0.99 and recall 0.98 / 0.87; planted mean trade size is about 2.2x / 2.4x honest; top-counterparty share 0.32 vs 0.20.
10. What stays contrived: the tells above, scripted crowds, assumed pump profit, clean baseline period, weak-only hub, steady-rate ring trading, a scenario-set honest cross rate.

## Changes from 1.2.0 (UI migration list)

- `MODEL_VERSION` `surv-model-1.2.1`; `package.json` version 1.2.1.
- Bug fix: wash episode window, `plantedTradeIds` and stats use only ring-to-ring trades in the wash instrument (cover activity elsewhere no longer stretches the window). Values change slightly (seed 1 equity ring share 0.340 -> 0.376, crypto 0.570 -> 0.569).
- Episode status values: `byEpisode[i].status` `found` -> `clean`; new `priceOnly`; `diluted` and `missed` unchanged. `missed` is true only for status `missed`.
- `episodes` objects (in `overall`, `byRule[r]`) gain `priceOnly`: `{planted, found, diluted, priceOnly, missed}`; `found` means clean (a rule naming accounts matched). P1 finds are `priceOnly`, so `byRule.P1.episodes.found` and `byRule.P1.recall` are always 0.
- `caseSummary` gains `priceOnlyEpisodeCases`, `episodesPriceOnly`; `episodesMissed` excludes price-only finds. `cases[].kind` gains `'price-only-episode'`. `shareMatchingEpisode` counts clean episode cases only.
- `detectionTargets().bothEpisodesFound` = both episodes clean. `seedStudy`: rows gain `episodesPriceOnly`, `priceOnlyEpisodeCases`; `p1Found` renamed `p1PriceOnly`; `failures[i]` gains `episodesPriceOnly`; `targetsPassing` counts both clean. Sweep rows gain `episodesPriceOnly`.
- New export `tellStudy(configId, seeds, opts?)` (new module `engine/tells.js`) and its output shape.
- `scripts/seeds.mjs` prints the new columns. The 1.1 register-classifier test is replaced by tests that pin the measured tells.

## Changes from 1.1.0 (UI migration list)

- `MODEL_VERSION` `surv-model-1.2.0`. New threshold `p1MinTrailingBins` (4). Unknown threshold keys and bad `p1Mode`/`p1Baseline` values now throw.
- Labels: new `MATCH_DILUTED`; `labels[id].accountPrecision` added (null for P1 and non-matches). `MATCH` requires accountPrecision >= 0.5.
- Causes: new `honest-linked-trading`, `benign-burst`, `block-trade`; honest family and household pairs now yield `honest-linked-trading` (not `coincidental-link`, which only the single-attribute pair keeps). `background-collision` unchanged.
- `overall` / `byRule[r]`: `alerts` adds `matchDiluted`; `groups` adds `diluted`; `episodes` adds `diluted` and `found` now means found cleanly; `recall` = clean finds / planted. Group keys changed: EXPLAINABLE by decoy id, UNRELATED by (rule, instrument, cluster, merged window).
- New `score.caseSummary` and `score.cases[]` (the headline). `byEpisode[i]` adds `status` (`found|diluted|missed`); `missed` is true only when not found at all; `detectedBy` lists rules with a MATCH.
- `sweep` rows add `caseSummary`, `episodesDiluted`. `linkage` summary adds `meanAccountsPerMatchingAlert`; the single-attribute pair is selected by id `DEC-LINK-1`.
- `seedStudy`: rows gain `episodesDiluted, episodesMissed, cases, episodeCases, dilutedEpisodeCases, trapCases, unrelatedCases, shareMatchingEpisode, shareMatchingOrExplainable, meanAccountsPerMatchingAlert`; result gains `trapRates`;
  `failures[i]` is `{seed, failed, episodesFound, episodesDiluted}`; `targetsPassing` counts clean finds of both episodes; row `targets` is `{bothEpisodesFound, all, traps:{explainableAlert, shockAlertsOnP1, shockAlertsOnP2}}`.
- `detectionTargets`: removed `explainablePresent`, `shockAlertsOnP1`, `shockQuietOnP2` at top level (now under `traps`, with `shockAlertsOnP2` replacing `shockQuietOnP2`, inverted); only `bothEpisodesFound` is a target.
- W2 metrics add `memberRoundTrip`, `internalRoundTripShare`; `netChangeOverInternal` wording corrected (external buys minus external sells over internal volume; definition unchanged). P2 `accumulationBuyShareOfVolume` now excludes trades inside the cluster.
- `caseView().accounts[].attributes` is a copy (mutable). `groundTruth.label` may be `MATCH_DILUTED`.
- Ground truth: new roles `honest-colleague-group`, `honest-multi-account-person`; new decoys `DEC-GROUP-<group>-<n>` (honest linked trading), `DEC-BURST-n`, `DEC-BLOCK-n`; `designed: true` on `DEC-MM-n` and `DEC-SHOCK-1`; new `groundTruth.honestGroups`.
- Register: honest groups of 3-4, random strong collisions, bot-key pool (crypto), weak pools over all non-maker accounts, pump-3 weak-only linked. Scenario: ring smaller and overlapping honest sizes, more honest volume in the wash target, cover activity for planted accounts, ramp-interest crowd, pump ramp trades after the crowd in each step, seed-drawn bursts, blocks and honest crosses.
- Tests removed or replaced: strict-pairs <= default-pairs, min <= median <= max, alerts >= groups, the re-implemented case-view window expression, the pooled-policy background-share test (replaced by a default-policy one), "explainable present" and "shock quiet on P2" as targets.

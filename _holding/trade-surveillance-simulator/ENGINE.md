# Trade-surveillance simulator: engine contract

Model `surv-model-1.1.0`. Plain ES modules, zero dependencies, no build step, no DOM, no `Math.random`, no `Date.now`.
All data is synthetic; company and token names are fictional (equity codes end in `.SIM`, crypto in `-SIMU`). The viewpoint is an
exchange surveillance desk with full account-level data. Alerts are leads for a human to review; nothing here says a participant
did something wrong.

`npm test` (Node 20+, 100 tests). `npm run seeds` prints the 100-seed study as markdown (`-- --policy weak1`, `-- --baseline trailing`, `-- --n 50`).

## API

```js
import { runScenario, sweep, seedStudy, linkageComparison, caseView, detect, detectionContext, detectionTargets,
         checkInvariants, MODEL_VERSION, DEFAULTS, LINKAGE_POLICIES, CONFIG_IDS, PATTERN_RULES, clearCache } from './engine/index.js';
```

| Call | Returns |
|---|---|
| `runScenario(configId, {seed?, thresholds?, linkagePolicy?, fresh?})` | one full result (below). `configId` is `'equity'` or `'crypto'`. Defaults: seed 1, `'weak2'`, `DEFAULTS.thresholds[configId]` with `thresholds` merged over it. The result is deep-frozen. |
| `sweep(configId, param, values, baseOpts?)` | `{configId, param, seed, rows}`; `param` is a threshold key or `'linkagePolicy'`. Row shape below. |
| `linkageComparison(configId, baseOpts?)` | `sweep` over `strong1, weak2, weak1`. |
| `seedStudy(configId, seeds, opts?)` | `{configId, seeds, opts, rows, summary, targetsPassing, failures}`; per-seed group-level rows and `summary[column] = {median,min,max}`. `failures = [{seed, failed:[target names]}]`. |
| `caseView(result, alertId)` | case-file view model (below). |
| `detect({market, register, trades, thresholds, linkagePolicy})` | `{alerts, linkage}` on any tape, including hand-built ones. |
| `detectionContext({market, trades})` | what the rules see: `{market, trades, prep, tradesByInst}`. Nothing from the scenario or ground truth (a test pins this). |
| `detectionTargets(result)` | `{bothEpisodesFound, explainablePresent, shockAlertsOnP1, shockQuietOnP2, all}`. |
| `checkInvariants(result)` | recomputes positions and cash from the tape. Healthy: `crossedBookEvents`, `badAccounts`, `nonIntegerOrNonPositive`, `ledgerMismatch` 0, `cashSum` 0, every `positionSumByInstrument` value 0. |
| `clearCache()` | drops cached simulations. |

The market is simulated once per `(configId, seed)` and cached; thresholds and linkage only re-run detection. Returned objects are
frozen, so callers cannot corrupt the cache (copy before mutating). `fresh: true` bypasses the cache.

Time is integer ms from session start. Equity day `d` starts at `d * market.session.dayMs`. `market.bins[i] = {index, day, t0, t1}` are
half-open `[t0, t1)`; only trading time is listed. Every rule window is a run of whole bins.

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
              singletonCount, edges:[{a,b,shared,linked}] },     // edges = every pair sharing anything; linked = policy satisfied
  alerts:   [Alert], score: Score, groundTruth: GroundTruth }
```

Prices are integer ticks (display price = `ticks * tickSize`). Quantities are integers (equity shares in multiples of 100; crypto units
in multiples of 10). Notional = `price * qty`, an integer. Cluster ids are `CL-<first account id>`; singletons have ids in `clusterOf` too.
Account `type` is drawn independently of role (about 13% corporate among non-makers); only makers carry `market_maker`.

Tape records carry `seq, t, inst, acct`:
- order `{id(=seq),side,type:'L'|'M',price|null,qty,status:'accepted'|'rejected',reason}`; rejections (`BAND`, `LOT`) are logged here.
- cancel `{orderId,side,price,qty(remaining),reason}`; reasons `REQUOTE, REPLACED, EXPIRED, UNFILLED_CROSS, MARKET_REMAINDER, BAND_REPRICE`.
- trade `{id,kind:'trade',price,qty,side,acct (aggressor's),aggressor,buyAcct,sellAcct,buyOrderId,sellOrderId}`; price is the resting order's.

### Register attributes (strength, meaning, caveat live in `register.schema`)

Equity: strong `beneficialOwnerId` (same declared owner: identity, not a link), `fundingAccount` (family members and joint accounts share
it); weak `brokerBranch` (very weak: 7 branches serve everyone), `device` (households, offices). Crypto: strong `controllingPerson`
(identity, not a link), `fundingWallet` (families, custodial wallets), `apiKeyLineage` (keys issued under one master key; bot platforms
issue keys for unrelated customers); weak `withdrawalAddress` (hosted addresses), `deviceFingerprint`, `ip` (carrier or office NAT).
Background accounts draw weak attributes from shared pools; two family pairs share a strong attribute; two household pairs share two weak ones.

### Alert

```js
{ id: 'RULE|instrument|cluster-or-acct-or-direction|startMs', rule: 'W1'|'W2'|'P1'|'P2', instrument,
  window:{startMs,endMs}, accounts:[acct], cluster:{id,accounts}|null,       // P1: no accounts
  metrics:{...}, thresholdsCrossed:{[key]:{value,threshold}}, supportingTradeIds:[...], supportingOrderIds:[...] }
```
- W1 `selfTradeCount, selfTradeQty, selfTradeNotional`. Merging counts bins (`w1MergeBins`), not wall-clock.
- W2 (peak window of the merged run) `clusterInternalShare` (internal qty / all qty the cluster traded), `instrumentInternalShare` (internal
  qty / instrument qty), `netChangeOverInternal` (abs(cluster buys - sells) / internal qty), `internalQty, externalQty, windowBins`.
- P1 `returnBps` (signed), `moveScore`, `volumeMultiple`, `direction` `'up'|'down'`, `baselineMode`, `baselineSource`, `baselineVolatility`,
  `baselineMedianNotional`, `baselineBins {start,end}`, `startBin, endBin`. `moveScore` = largest excursion from the window start, relative
  to the instrument's baseline volatility (RMS bin return) scaled by sqrt(window bins). It is not a statistical z-score.
- P2 `rampAggressiveBuyShare, rampAggressiveBuyQty, followNetSellQty, followNetSellRatio, accumulationNetQty` (cluster net buying in the
  lookback before the P1 window), `accumulationBuyShareOfVolume`, `pnlTicksQty, cashTicksQty, closingPosition, markPrice, p1AlertId,
  peakBin, rampEndBin, rampWindow, followWindow, lookbackWindow`. `pnlTicksQty` = cash flows over lookback + ramp + following window plus
  open inventory marked at the last print (integer ticks x qty).

### Score and labels

Pattern rules (W2, P1, P2) are scored against the planted episodes. W1 is scored apart as self-match hygiene.

```js
score = { overall, byRule:{W2,P1,P2}, selfMatch, byEpisode, decoysAlerted:[ids], causes, causesByRule, labels }
overall | byRule[r] = {
  alerts:  {total, match, explainable, unrelated},
  groups:  {total, episodeMatches, explainable, unrelated},
  episodes:{planted, found, missed},
  precision:{ alert:{match, matchOrExplainable}, group:{match, matchOrExplainable} },   // null when there are no alerts
  recall }                                                                              // episodes found / planted
selfMatch = {alerts, onPlantedAccounts, onHonestAlgoAccounts, onOtherAccounts, accountsFlagged, note}
byEpisode = [{episodeId, type, detectedBy:[rules], missed}]
labels[alertId] = {label:'MATCH'|'EXPLAINABLE'|'UNRELATED'|'SELF_MATCH', episodeIds, cause, decoyIds}
```
- `MATCH`: maps to a planted episode (same instrument, overlapping half-open window, rule type fits; W2 needs 2 episode accounts, P2 1, P1 none).
- `EXPLAINABLE`: a W2 alert whose accounts are all one maker's sub-accounts, in the instrument and time of a same-owner cross. Same-owner
  trades are a wash in form and a legitimate inventory transfer in fact; the alert is expected and needs a documented explanation. cause `same-owner-cross`.
- `UNRELATED`: no planted cause. causes: `benign-shock` (news jump, P1), `coincidental-link` (alert accounts all inside one honest pair),
  `background-collision` (a cluster of honest accounts built from pooled attributes), `natural-move` (P1 with no cause), `unattributed`.
- Groups: alerts are grouped by (rule, episode) for MATCH and by (rule, instrument) for EXPLAINABLE and UNRELATED. One episode that
  splits into three alerts is one group. Compare precision at group level; alert-level counts are kept alongside.
- Both precision pairs are reported: `match` = MATCH / all, `matchOrExplainable` = (MATCH + EXPLAINABLE) / all.

### Sweep rows

`{value, episodesFound, episodesMissed, decoysAlerted, groups, alerts, precision, recall, overall, byRule, selfMatch, causes, linkage?}`.
Chart `episodesFound`, `groups.*` and `decoysAlerted`, not raw alert counts. For `'linkagePolicy'`, `linkage = {clusters, largestCluster,
ringFragments, ringWhole, falseLinkFormed, designedPairsLinked, falseLinkedPairs, falseLinkAlerts}`; `falseLinkedPairs` counts pairs of
unrelated honest accounts sharing a cluster.

### `caseView(result, alertId)`

```js
{ modelVersion, alert, instrument, linkagePolicy, accountsNote,
  accounts:[{acct,declaredOwner,type,attributes,clusterId,finalPosition,aggressiveBuyQty,aggressiveSellQty}],   // no roles
  linkage:{edges, clusters}, trades:[trade + {notional,selfTrade}],
  series:[{bin,startMs,endMs,open,high,low,close,qty,notional,trades,inAlertWindow}],     // inAlertWindow = bin overlaps the alert
  clusterSeries:[{clusterId,accounts,points:[{bin,endMs,position,cash,pnl}]}],             // pnl = cash + position * bin close
  groundTruth:{label,episodeIds,cause,decoyIds,accountRoles,episodes,decoys} }
```
A P1 case lists the top aggressive buyers and sellers (with their clusters); a falling alert leads with sellers. Planted truth appears only
under `groundTruth`. Roles: planted ones start with `planted-` (`planted-wash-ring-spoke`, `-hub`, `planted-pump-group`,
`planted-maker-sub-account`); background ones are `retail`, `retail-momentum`, `honest-algo`, `honest-family-pair`,
`honest-household-pair`, `honest-coincidental-link`, `market-maker`. Show it only in a separate answer-key panel.

## Rules and default thresholds

All thresholds are in `DEFAULTS.thresholds[configId]`; the rules read nothing else (tested). Windows are bins (equity 30 min, crypto 1 min). `eq / cr` where they differ.

| Key | Default | Meaning |
|---|---|---|
| `w1MinCount`, `w1MinLots` | 1, 1 | W1 self-match: same account both sides; minimum count and lots |
| `w1MergeBins` | 60 / 90 | self-matches by one account in one instrument within this many bins form one alert |
| `w2WindowBins`, `w2MergeGapBins` | 4, 8 / 5, 6 | W2 window and merge gap |
| `w2ClusterShare` | 0.5 | `clusterInternalShare` at least this |
| `w2NetRatio` | 0.6 | `netChangeOverInternal` at most this (net position change small relative to the round-trip volume) |
| `w2InstrumentShare` | 0.25 | `instrumentInternalShare` at least this |
| `w2MinInternalLots` | 10 | minimum internal volume (lots) |
| `p1Mode` | `'instrument'` | `'global'`: one baseline (the median instrument) for all instruments |
| `p1Baseline` | `'warmup'` | `'warmup'`: first N bins; `'trailing'`: the N bins before each window (excluded from it) |
| `p1BaselineBins` | 10 / 20 | N |
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

P2 runs only on rising P1 alerts. Linkage (`LINKAGE_POLICIES`): `strong1` one shared strong attribute; `weak2` one strong or two weak (default);
`weak1` any shared attribute. Counterparty-concentration rules (who trades with whom) are out of scope; hub-and-spoke concentration is why
strict linkage can miss the ring.

## Scenario design

Both configs: 40 retail accounts (12 momentum followers with individual sensitivity and a cooldown; 2 honest algo accounts that now and
then self-match; 2 family pairs; 2 household pairs; 1 coincidence pair), makers (post-only; equity 1 maker with 2 sub-accounts, crypto
that plus a single-account maker), 5 instruments, a 4-account wash ring and a 3-account pump group. Ids are shuffled.

| | Equity (lot 100, tick units, daily band +-20% of previous close, applied to limit and market orders; stale resting orders outside a new band are cancelled; "loosely after Indonesian market conventions") | Crypto (continuous, no band, finer tick) |
|---|---|---|
| Steps | 6 sessions x 60 steps of 5 min, bin 30 min; session 0 clean | 360 steps of 15 s, bin 1 min; first 20 min clean |
| Wash | QFRO.SIM steps 70-290. Hub-and-spoke ring; 15% spoke-spoke crosses, 1% random self-cross, 8% one-sided market orders; hub reachable only by two weak attributes | AQRL-SIMU steps 90-230, same ring design |
| Pump | VLDN.SIM: accumulate 60-150, ramp 150-240, distribute from 240 | BLXT-SIMU: accumulate 100-236, ramp 240-264 (signal at `episode.signalMs`), distribute from 264 |
| Shock | TMRX.SIM +13% at step 200 | DRNO-SIMU +9% at step 150 |
| Maker crosses | NBLE.SIM steps 140-141, 335 | ELVY-SIMU steps 190-191, 320 |
| Controls | NBLE.SIM low volatility, HZPK.SIM high | ELVY-SIMU, FQRX-SIMU |

The promotion crowd is scripted: a `hype` event makes all retail accounts buy at market for a while after the ramp (equity steps 235-290,
crypto 262-292). The pump group's profit from selling into it is therefore assumed by the scenario, not an emergent result.

## Seed scan (100 seeds, defaults) and what it means

Detection targets (both episodes found by the pattern rules, an EXPLAINABLE alert, shock on P1 and quiet on P2): equity 99 of 100 (seed 76 has
no same-owner-cross alert), crypto 100 of 100. At group level: median 5 groups (3 MATCH, 1 EXPLAINABLE, 1 UNRELATED); precision(MATCH)
median 0.60, precision(MATCH+EXPLAINABLE) 0.80; recall 1.0. Across 100 seeds `npm run seeds` prints the full table. At the default policy,
unrelated alerts are almost all the news shock (a handful of `natural-move` alerts); background collisions show up under loose linkage.

Linkage policy distributions (100 seeds; mean, W2 = episodes found by W2):

| config | policy | W2 found | episodes found | unrelated groups | largest cluster | false-linked pairs |
|---|---|---|---|---|---|---|
| equity | strong1 | 0.12 | 1.12 | 1.02 | 3 | 2 |
| equity | weak2 | 1.00 | 2.00 | 1.02 | 4 | 4.4 |
| equity | weak1 | 1.00 | 2.00 | 5.30 | 42.8 | 596 |
| crypto | strong1 | 0.26 | 1.26 | 1.00 | 3 | 2 |
| crypto | weak2 | 1.00 | 2.00 | 1.01 | 4.0 | 4.4 |
| crypto | weak1 | 1.00 | 2.00 | 3.86 | 18.0 | 114 |

Strict linkage misses the ring most of the time, loose linkage merges honest accounts into giant clusters, loses the EXPLAINABLE
alert (the maker cluster is no longer only the maker) and raises unrelated groups.

Baseline honesty. The defaults coincide with the scenario's clean period: `warmup` uses the first N bins, which no planted episode touches. A
baseline that spans the episodes hides the pump. Measured over 100 seeds (mean pump found by P1; equity / crypto): warm-up default N 1.00 / 1.00;
trailing default N 1.00 / 1.00; warm-up with N covering the episodes (55 / 80 bins) 0.35 / 0.61; trailing with long N (30 / 40) 1.00 / 1.00.
Trailing is not contaminated here because the history before each planted episode is quiet; a real desk's history is not.

## Notes on behaviour you may see in charts

- Sweeps once looked non-monotonic because raising a threshold can split one merged run into two alerts. Group-level counting hides this; chart groups.
- A one-step news jump can outscore a multi-bin pump ramp on `moveScore`. P1 sees size and volume, not cause: it is blind to why a name moved.
- The W2 sweep on `w2InstrumentShare`: low values alert on same-owner crosses and the ring; a middle value keeps the ring only (equity about 0.8, crypto 0.7-0.9); 0.95+ loses the ring. The separation is narrow and seed dependent.
- Calibration is by seed scan (above), not by a claim that every seed holds.

## What this does not model

- No real exchange rules (band, lot, tick are simplified); no auctions, halts, other order types, self-trade prevention, margin, fees, settlement, cross-venue or derivatives activity.
- No spoofing, layering, marking the close, front-running or insider information.
- Linkage uses register attributes only; the register has no data-quality noise beyond the pooled collisions.
- One wash episode and one pump episode per config; timing resolution is one bin.
- Agents are simple rules with random draws; price formation is a stylised random-walk fair value that quotes drift towards.
- Counterparty-concentration and behavioural similarity rules are absent.
- Floats are used for sampling and statistics; money (prices, quantities, notional, cash, P&L) is integer.

## Changes from 1.0.0 (UI migration list)

- `MODEL_VERSION` is `surv-model-1.1.0`. `runScenario` results are deep-frozen.
- Equity instrument ids gain `.SIM` (`QFRO` -> `QFRO.SIM`). `market.label` no longer says IDX. The band now also limits market orders; new cancel reason `BAND_REPRICE`.
- `register.schema[]` gains `rationale`, `caveat`. Crypto: `kycIdentity` -> `controllingPerson` (and `ownerAttribute`); `withdrawalAddress` is now weak. Account `type` is random (`corporate` no longer marks planted accounts).
- `score` is replaced: removed `overall.{tp,fp,fn,precision,recall}` flat fields, `byRule.W1`, `fpCauses`, `fpCausesByRule`, `episodes` per rule as a number, `detected`. New: `overall`/`byRule` nested `alerts, groups, episodes, precision.{alert,group}.{match,matchOrExplainable}, recall`; `selfMatch`; `decoysAlerted`; `causes`; `causesByRule`. `byEpisode.detectedBy` never lists W1. `overall` covers W2, P1, P2 only.
- `labels[id].label`: `TP` -> `MATCH`; `FP` -> `EXPLAINABLE` (same-owner crosses, cause `same-owner-cross`, was `market-maker-subaccounts`) or `UNRELATED`; W1 alerts are `SELF_MATCH`. Causes: `natural-volatility-or-volume` -> `natural-move`; `coincidental-link`, `benign-shock` kept; new `background-collision`.
- Sweep rows: `{value, overall, byRule, fpCauses}` -> `{value, episodesFound, episodesMissed, decoysAlerted, groups, alerts, precision, recall, overall, byRule, selfMatch, causes, linkage?}`. Linkage summary adds `largestCluster, designedPairsLinked, falseLinkedPairs`; `falseLinkAlerts` counts UNRELATED alerts on the single-attribute pair.
- Alert metrics: W2 `internalShareOfClusterVolume` -> `clusterInternalShare`, `internalShareOfInstrumentVolume` -> `instrumentInternalShare`, `netPositionRatio` -> `netChangeOverInternal` (new definition). P1 `zReturn` -> `moveScore`, `baselineSigma` -> `baselineVolatility`, new `baselineBins`, `baselineSource`; id third segment `-` -> `up`/`down`; `direction` is per alert and rising and falling alerts are separate. P2 adds `accumulationNetQty`, `accumulationBuyShareOfVolume`, `lookbackWindow`; only on rising P1.
- Thresholds: `p1ZRet` -> `p1MoveScore`; new `p1Baseline`; `w2NetRatio` redefined (default 0.6); `w1MergeBins` now counts bins in the rule (values unchanged).
- Ground truth: roles of planted accounts get `planted-` (`wash-ring-spoke` -> `planted-wash-ring-spoke`, `market-maker-sub` -> `planted-maker-sub-account`, etc.); new roles `honest-algo`, `honest-family-pair`, `honest-household-pair`. Decoy type `market-maker-subaccount-transfer` -> `same-owner-cross`; new decoys `DEC-FAMILY-n`, `DEC-HOUSEHOLD-n`, `DEC-ALGO-1`. Wash stats `internalShareOfInstrumentVolume` -> `internalShareOfInstrumentQty`, `internalShareOfRingVolume` -> `internalShareOfRingSideVolume`.
- `caseView`: accounts add `aggressiveBuyQty`, `aggressiveSellQty`; P1 cases list sellers too; `groundTruth.label` uses the new labels.
- New exports: `seedStudy`, `detect`, `detectionContext`, `detectionTargets`, `PATTERN_RULES`; `npm run seeds`.
- Scenario: ring no longer has scheduled self-crosses (15% spoke-spoke crosses instead); honest algo accounts self-match occasionally; background attribute collisions, family and household pairs added.

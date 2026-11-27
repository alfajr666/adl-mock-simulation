# Trade-surveillance simulator: engine contract

Model `surv-model-1.0.0`. Plain ES modules, zero dependencies, no build step, no DOM, no `Math.random`, no `Date.now`.
All data is synthetic. Company and token names are fictional. The viewpoint is an exchange surveillance desk that holds
full account-level data. Alerts are leads for a human to review. Nothing here says a participant did something wrong.

Run `npm test` (Node 20+). Import from `engine/index.js`.

## API

```js
import { runScenario, sweep, linkageComparison, caseView, checkInvariants,
         MODEL_VERSION, DEFAULTS, LINKAGE_POLICIES, CONFIG_IDS, clearCache } from './engine/index.js';
```

| Call | Returns |
|---|---|
| `runScenario(configId, {seed?, thresholds?, linkagePolicy?, fresh?})` | one full result (below). `configId` is `'equity'` or `'crypto'`. Defaults: `seed` 1, `linkagePolicy` `'weak2'`, thresholds from `DEFAULTS.thresholds[configId]`; `thresholds` is merged over the defaults. |
| `sweep(configId, param, values, baseOpts?)` | `{configId, param, seed, rows:[{value, overall, byRule, fpCauses, linkage?}]}`. `param` is any threshold key or `'linkagePolicy'`. `linkage` is present only for `'linkagePolicy'`. |
| `linkageComparison(configId, baseOpts?)` | `sweep` over `strong1, weak2, weak1`. |
| `caseView(result, alertId)` | case-file view model (below). Throws on unknown id. |
| `checkInvariants(result)` | recomputes positions, cash and counters from the tape alone. Healthy: `crossedBookEvents`, `badAccounts`, `nonIntegerOrNonPositive`, `ledgerMismatch` all 0; `cashSum` 0; every `positionSumByInstrument` value 0. |
| `clearCache()` | drops cached simulations. |

The market is simulated once per `(configId, seed)` and cached; thresholds and linkage only re-run detection (a sweep of 10
values costs about 10 detection passes, not 10 simulations). Treat the returned `tape`, `register`, `market` as read-only because
they are shared with the cache. `fresh: true` bypasses the cache (used by the determinism tests).

Time is integer milliseconds from session start. Equity day `d` starts at `d * market.session.dayMs`.
`market.bins[i] = {index, day, t0, t1}` are half-open `[t0, t1)` intervals; only trading time is in the list.
Every window in the rules is a run of whole bins.

### `runScenario` result

```js
{ modelVersion, configId, seed, linkagePolicy, thresholds,          // thresholds = fully resolved
  market:   { label, session:{days,stepsPerDay,stepMs,dayMs,binSteps,...}, binMs, bins:[...],
              instruments:[{id,name,tickSize,lotSize,bandPct|null,refPrice0}] },
  register: { schema:[{key,label,strength:'strong'|'weak'}], ownerAttribute,
              rows:[{acct, declaredOwner, type, attributes:{[key]:value}}] },
  tape:     { orders:[...], cancels:[...], trades:[...] },            // each sorted by seq; seq is global
  ledger:   { positions:{[acct]:{[inst]:int}}, cash:{[acct]:int} },    // final, ticks x qty
  stats:    { orders, cancels, trades, rejections:{BAND,LOT,PRICE,QTY}, crossedBookEvents },
  linkage:  { policy, clusters:[{id,accounts,edges:[{a,b,shared:[{key,strength,value}]}]}],
              clusterOf:{[acct]:clusterId}, singletonCount,
              edges:[{a,b,shared,linked}] },                          // all shared-attribute pairs; linked = policy satisfied
  alerts:   [Alert], score: Score, groundTruth: GroundTruth }
```

Prices are integer ticks (display price = `ticks * tickSize`). Quantities are integers (equity: shares, multiples of `lotSize` 100;
crypto: units, multiples of `lotSize` 10). Notional is `price * qty`, an integer. Cluster ids are `CL-<first account id>`; singletons
have a cluster id too (`clusterOf` covers every account) but are not listed in `clusters`.

Tape records (all carry `seq`, `t`, `inst`, `acct`):
- order: `{seq,id,t,inst,acct,side:'B'|'S',type:'L'|'M',price|null,qty,status:'accepted'|'rejected',reason}`; `id === seq`. Rejections (`BAND`, `LOT`) are logged here.
- cancel: `{seq,t,orderId,inst,acct,side,price,qty(remaining),reason}`; reasons `REQUOTE, REPLACED, EXPIRED, UNFILLED_CROSS, MARKET_REMAINDER`.
- trade: `{seq,id,t,kind:'trade',inst,price,qty,side,acct,aggressor,buyAcct,sellAcct,buyOrderId,sellOrderId}`; `side/acct` are the aggressor's; price is the resting order's price.

### Alert

```js
{ id: 'RULE|instrument|clusterId-or-acct-or--|startMs', rule: 'W1'|'W2'|'P1'|'P2', instrument,
  window:{startMs,endMs}, accounts:[acct], cluster:{id,accounts}|null,   // P1 has no accounts (price/volume alert)
  metrics:{...}, thresholdsCrossed:{[thresholdKey]:{value,threshold}},
  supportingTradeIds:[...], supportingOrderIds:[...] }                     // P1: trades only
```
Metrics by rule: W1 `selfTradeCount, selfTradeQty, selfTradeNotional`. W2 `internalShareOfClusterVolume, netPositionRatio,
internalShareOfInstrumentVolume, internalQty, externalQty` (peak window of the merged run). P1 `returnBps, zReturn, volumeMultiple,
direction, baselineMode, baselineSigma, baselineMedianNotional, startBin, endBin`. P2 `rampAggressiveBuyShare, rampAggressiveBuyQty,
followNetSellQty, followNetSellRatio, pnlTicksQty, cashTicksQty, closingPosition, markPrice, p1AlertId, rampEndBin, rampWindow, followWindow`.
`pnlTicksQty` = cash flows of the cluster from `p2LookbackBins` before the P1 window to the end of the following window, plus open
inventory marked at the last print (ticks x qty, integer).

### Score

`score = {overall, byRule:{W1,W2,P1,P2}, byEpisode, fpCauses, fpCausesByRule, labels}`. Each of `overall`/`byRule[r]` is
`{alerts,tp,fp,episodes,detected,fn,precision,recall}` (`precision` is `null` with no alerts). An alert is TP if it maps to a planted
episode (same instrument, overlapping window, right episode type; W1 needs 1 ring account, W2 two, P2 one pump account), else FP.
Rule targets: W1/W2 -> wash, P1/P2 -> pump. Per-rule `recall` = episodes of the rule's target type that rule found / planted. `overall.recall`
= episodes found by any rule / 2. `fn` = planted episodes missed. `labels[alertId] = {label:'TP'|'FP', episodeIds, cause, decoyIds}`;
causes: `market-maker-subaccounts`, `benign-shock`, `coincidental-link`, `natural-volatility-or-volume`, `unattributed`.

### `caseView(result, alertId)`

```js
{ modelVersion, alert, instrument, linkagePolicy,
  accountsNote,                       // why these accounts are shown (P1 shows the top aggressive buyers and their clusters)
  accounts:[{acct,declaredOwner,type,attributes,clusterId,finalPosition}],   // register rows, no roles
  linkage:{ edges:[{a,b,shared,linked}], clusters:[...] },                   // evidence among the shown accounts
  trades:[trade + {notional,selfTrade}],                                     // = alert.supportingTradeIds
  series:[{bin,startMs,endMs,open,high,low,close,qty,notional,trades,inAlertWindow}],   // every bin of the instrument; inAlertWindow = overlaps the alert
  clusterSeries:[{clusterId,accounts,points:[{bin,endMs,position,cash,pnl}]}],          // pnl = cash + position * bin close
  groundTruth:{label,episodeIds,cause,decoyIds,accountRoles,episodes,decoys} }
```
Planted truth appears only under `groundTruth`, and `result.groundTruth` is the same kind of structure for the whole run
(`controllers, accountRoles, instrumentRoles, episodes[{id,type,instrument,accounts,window,stats,...}], decoys[...]`).
The detector never reads it. Show it only in a clearly separated "answer key" panel.

## Rules and default thresholds

All thresholds live in `DEFAULTS.thresholds[configId]`; the rule functions read nothing else (a test enforces this).
Windows are in bins (equity bin 30 min, crypto bin 1 min). Values differ per config only where noted (equity / crypto).

| Key | Default | Meaning |
|---|---|---|
| `w1MinCount`, `w1MinLots` | 1, 1 | W1 self-trade: trades with the same account on both sides; minimum count and size (lots) per alert |
| `w1MergeBins` | 60 / 90 | self-trades by one account in one instrument within this many bins form one alert |
| `w2WindowBins` | 4 / 5 | W2 window length |
| `w2MergeGapBins` | 8 / 6 | flagged windows separated by at most this many bins merge into one alert |
| `w2ClusterShare` | 0.5 | internal volume (both sides in the cluster) over all volume the cluster took part in |
| `w2NetRatio` | 0.25 | maximum of abs(buys - sells) / (buys + sells) for the cluster: near-flat net position |
| `w2InstrumentShare` | 0.25 | internal volume over total instrument volume in the window |
| `w2MinInternalLots` | 10 | minimum internal volume (lots) so tiny crosses do not alert |
| `p1Mode` | `'instrument'` | `'global'` uses one market-wide baseline (median instrument) instead of each instrument's own |
| `p1WindowBins` | 10 / 5 | P1 window length |
| `p1BaselineBins` | 10 / 20 | first N bins (clean warm-up) used for the baseline: RMS bin return, median bin notional |
| `p1ZRet` | 5 | largest close-to-start excursion in the window over `sigma * sqrt(bins)` |
| `p1VolMult` | 2 | window notional over `bins * median baseline notional` |
| `p1MinReturnBps` | 300 | floor on the absolute move so tiny moves in quiet names do not alert |
| `p1MergeGapBins` | 4 / 6 | merge gap for flagged P1 windows |
| `p2MinClusterSize` | 2 | P2 looks at linked groups only, not single accounts |
| `p2RampShare` | 0.25 | cluster's share of aggressive buy volume from the P1 window start to the end of the ramp |
| `p2RampEndFraction` | 0.6 | ramp ends at the first bin that covered this fraction of the window's largest rise |
| `p2FollowBins` | 20 / 10 | length of the following window |
| `p2NetSellRatio` | 0.3 | cluster's net selling in the following window over its aggressive ramp buying |
| `p2MinRampLots` | 5 | minimum aggressive ramp buying (lots) |
| `p2LookbackBins` | 30 / 40 | lookback for the P&L figure |

Linkage policies (`LINKAGE_POLICIES`): `strong1` any one shared strong attribute (strict); `weak2` one strong or two weak (default);
`weak1` any shared attribute (loose). Union-find over linked pairs. Strong/weak per attribute is in `register.schema`.
Equity: strong `beneficialOwnerId, fundingAccount`; weak `brokerBranch, device`. Crypto: strong `kycIdentity, fundingWallet,
withdrawalAddress, apiKeyLineage`; weak `deviceFingerprint, ip`.

## Scenario design (who is planted where)

Both configs: 40 retail accounts (12 momentum followers with individual sensitivity and a cooldown), market makers (post-only,
requote on schedule or when hit; equity 1 maker with 2 sub-accounts, crypto the same plus a second single-account maker),
5 instruments, a 4-account wash ring and a 3-account pump group. Account ids are shuffled so ids carry no information. Retail accounts have unique attribute values apart from the planted sharing.

| Role | Equity ("IDX-style": lot 100, tick units, daily band +-20% of previous close) | Crypto (continuous, no band, finer tick) |
|---|---|---|
| Steps | 6 sessions x 60 steps of 5 min, bin 30 min; session 0 is the clean baseline | 360 steps of 15 s (90 min), bin 1 min; first 20 min clean baseline |
| Wash target | QFRO, steps 70-290 | AQRL-SIMU, steps 90-230 |
| Ring | 4 accounts, 4 declared owners, one controller. Hub-and-spoke: the hub trades with each spoke in conspicuous sizes (equity 10-18 lots, crypto 30-50) inside the spread; the resting side is a real limit order; positions are steered back to flat; 3 scheduled crude self-crosses; 8% one-sided market orders. Spokes share a funding account (equity) / wallet + API-key lineage chain (crypto). The hub shares only two weak attributes with one spoke. |
| Pump target | VLDN (thin float): accumulate quietly (steps 60-150, passive bids), ramp (150-240, market buys, across sessions), distribute (from 240, passive offers then market sells) into a retail crowd | BLXT-SIMU: accumulate 100-236, ramp 240-264 starting at the "signal" (`episode.signalMs`), distribute from 264 |
| Pump group | 3 accounts, one funding account | 3 accounts, withdrawal address + funding wallet chain |
| Crowd | `hype`: all retail buy at market 235-290 (promotion crowd); momentum followers also join on sharp rises | `hype` 262-292 |
| Benign shock | TMRX, +13% news jump at step 200, broad retail participation | DRNO-SIMU, +9% at step 150 |
| Maker transfers | NBLE (quiet control): sub-accounts cross inside the spread at steps 140-141 and 335 | ELVY-SIMU at steps 190-191 and 320 |
| Controls | NBLE low volatility; HZPK high volatility and high volume | ELVY-SIMU; FQRX-SIMU |
| False link | two honest retail accounts share one `brokerBranch` | two share one `ip` |

Designed outcomes at default settings: both episodes alerted; W2 alerts on the maker transfers (false positive, cause
`market-maker-subaccounts`); P1 alerts on the news jump (cause `benign-shock`); P2 does not fire on it (no group dominates the buying).
Strict linkage leaves the hub as its own cluster and W2 finds nothing for the ring. The loosest linkage clusters the honest pair but
that pair never produces an alert, because they barely trade each other. A global P1 baseline adds several false alerts on the volatile control.
Overall recall stays 1.0 under strict linkage because the ring's crude self-trades still raise W1 alerts; the W2-specific recall is what drops.
The W2 sweep on `w2InstrumentShare` shows the trade-off: low values alert on maker transfers, about 0.7 keeps the ring only, 0.9+ loses the ring.
Maker transfers and the ring are close on this metric and separate only by linkage context and the cluster's other activity.

## Ground-truth structure

`episodes`: `EP-WASH-1` (accounts, hub, controller, `window` from the first to last internal trade, `plantedTradeIds`, stats:
`internalQty, internalTrades, selfTrades, internalShareOfInstrumentVolume, internalShareOfRingVolume, finalPositions`), `EP-PUMP-1`
(accounts, `window`, `phases`, `signalMs`, stats: `pnlTicksQty, cashTicksQty, closingPosition, markPrice`).
`decoys`: `DEC-MM-n` (maker sub-account transfers), `DEC-SHOCK-1` (news jump), `DEC-LINK-1` (honest pair and the shared attribute).

## What this does not model

- No real exchange rules: the band, lot and tick handling are a simplified "IDX-style" flavour. No auctions, halts, circuit breakers, order types beyond limit and market, iceberg, stop or post-only flags (maker post-only is agent behaviour).
- No self-trade prevention, no margin or borrowing limits (accounts can go short), no fees, no settlement, no cross-venue or derivatives activity.
- No order-level spoofing or layering, no marking the close, no front-running, no insider information, no real news timing.
- Linkage uses only the register attributes; no behavioural or graph-embedding similarity, no data-quality noise in the register.
- Only one wash episode and one pump episode per config; detection windows are whole bins, so timing resolution is one bin.
- Agents are simple rules with random draws (retail flow is memoryless apart from momentum followers); price formation is a stylised random-walk fair value that quotes drift towards.
- Baselines use a clean warm-up that the planted episodes avoid by construction; a real desk must build baselines from contaminated history.
- Precision and recall are over a handful of alerts per run: use many seeds before reading anything into one number.
- Floats are used for sampling and for statistics (z-scores, shares); money (prices, quantities, notional, cash, P&L) is integer throughout.

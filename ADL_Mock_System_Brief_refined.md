# ADL Mock System — Agent Build Brief v2.1
**Project:** Auto-Deleveraging Simulation Engine for Crypto Perpetual Futures  
**Output path:** `second-brain/adl-system/index.html`  
**Stack:** Single-file HTML + Vanilla JS. No framework. No build step.  
**Data:** Binance public REST API (unauthenticated)  
**Agent:** Antigravity in Zed  
**Source material:** @annanay (ak0/QFEX) X threads, Dec 2025 & Jun 2026  
**Design reference:** `second-brain/adl-system/reference/adl-explainer.html`

---

## READ THIS FIRST

Before writing a single line of code:

1. Read `second-brain/adl-system/reference/adl-explainer.html` — all design tokens, layout patterns, and base simulation logic carry over directly. Do not rebuild what's already there.
2. Read `second-brain/adl-system/reference/ak0_thread_1.md` and `ak0_thread_2.md` — these are the primary source material this system is built to simulate.
3. Deliver a single `index.html` file. No external JS, no external CSS, no secondary files. Google Fonts CDN is the only allowed external dependency.

---

## 1. Purpose

This tool simulates how a crypto perpetual futures exchange handles Auto-Deleveraging (ADL) — from first liquidation to full cascade resolution. It serves two audiences simultaneously:

- **Traders** who want to understand their ADL exposure and how ranking works
- **Technical readers** who want to understand why the current `PnL% × EffLev` heuristic is flawed and what a correct implementation looks like

It is not a trading interface. It is a simulation + educational explainer, self-contained, publishable as a single HTML file on delomite.com.

---

## 2. What This System Demonstrates

Five things, in order of importance:

1. **Why ADL is structurally necessary** — equivalent to TradFi "tear-ups" and VMGH. Not exchange greed. Not optional.
2. **Asymmetric settlement pricing** — why the loser closes at `bankruptPrice` and the winner closes at `currentMarkPrice`, and why any other combination is mathematically wrong.
3. **The ranking flaw in `PnL% × EffLev`** — formally demonstrable: a trader with lower % return can rank ahead of one with higher % return purely due to position size. Disproportionately hits new traders.
4. **The QFEX fix: `EffLev only`** — ADL's objective is systemic de-risking. Highest leverage = highest systemic risk = reduced first. Profit magnitude is irrelevant.
5. **Attack resistance** — why a split-account exploit (long + short before volatility, use ADL as backstop) fails under correct ADL design.

---

## 3. File Structure

```
second-brain/adl-system/
├── index.html                    ← deliverable (entire system)
└── reference/
    ├── adl-explainer.html        ← design + base logic reference (read-only)
    ├── ak0_thread_1.md           ← source: TradFi framing, attack resistance
    └── ak0_thread_2.md           ← source: QFEX ranking design, settlement pricing
```

---

## 4. Design System

Inherit exactly. Do not deviate.

```css
--bg:       #070b14
--surface:  #0d1420
--surface2: #131c2e
--border:   #1e2d45
--text:     #e2eaf7
--muted:    #5a7299
--accent:   #f7a928   /* amber  — ADL warnings, QFEX highlights */
--red:      #f03e3e   /* red    — liquidations, bad debt, critical states */
--green:    #22d17a   /* green  — profitable positions, healthy states */
--blue:     #3d8ef0   /* blue   — insurance fund */
--purple:   #9b6dff   /* purple — ADL queue, force-close events */

font-body: 'Space Grotesk', sans-serif
font-mono: 'Space Mono', monospace  ← all numbers, labels, log entries, formulas
```

---

## 5. Data Layer — Binance Public API

All fetches are unauthenticated. CORS-safe from browser. Poll every 15 seconds.

```
Spot prices:
  GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]
  Fields used: lastPrice, priceChangePercent

Funding rate:
  GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT
  Fields used: lastFundingRate (× 100 = %)

Open interest (optional, display only):
  GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT
  Fields used: openInterest
```

**Fallback if any fetch fails:**

```js
BTC: $65,000 | ETH: $3,400 | SOL: $145 | Funding: +0.0100%
```

Log entry on fallback: `[API] Binance unreachable. Running in demo mode.`  
Fallback activates silently. No error thrown to user. Try/catch on every fetch.

On each successful price tick, recalculate all position PnL, ADL scores, and queue rankings immediately.

---

## 6. Position Book — 8 Simulated Traders

**Entry price generation at init:**

```js
entry = livePrice × (1 + offset)

// LONG traders: offset is negative (entry below current = in profit)
// offset ∈ [-0.10, -0.02]  (2–10% below current price)

// SHORT traders: offset is positive (entry above current = in profit on down move)
// offset ∈ [+0.02, +0.10]  (2–10% above current price)

// Assign offsets procedurally so rankings are always interesting.
// Do not use pure Math.random() — use seeded values below.
```

**Seeded offsets (use these exact values every init):**

```js
const TRADERS = [
  { id:'T1', name:'whale_btc',     side:'LONG',  sizeUSD:500000, lev:20, entryOffset:-0.045 },
  { id:'T2', name:'algo_long',     side:'LONG',  sizeUSD:120000, lev:10, entryOffset:-0.028 },
  { id:'T3', name:'degen99',       side:'LONG',  sizeUSD:80000,  lev:25, entryOffset:-0.072 },
  { id:'T7', name:'perp_newbie',   side:'LONG',  sizeUSD:8000,   lev:5,  entryOffset:-0.031 },
  { id:'T4', name:'hedger_pro',    side:'SHORT', sizeUSD:300000, lev:5,  entryOffset:+0.038 },
  { id:'T5', name:'short_squeeze', side:'SHORT', sizeUSD:200000, lev:15, entryOffset:+0.055 },
  { id:'T6', name:'scalper_x',     side:'SHORT', sizeUSD:60000,  lev:30, entryOffset:+0.021 },
  { id:'T8', name:'attacker_long', side:'LONG',  sizeUSD:50000,  lev:20, entryOffset:-0.033 },
]
// T8 is hidden from default view. Only shown during attack scenario (simStep A).
```

**Why these specific values matter:**

- `perp_newbie` (T7): 5x leverage, small size, modest offset. Under `PnL% × EffLev`, this trader ranks #2 or #3 in the long queue — ahead of `whale_btc` (T1, 20x). This is the ranking flaw. Under `EffLev only`, T7 correctly ranks last.
- `scalper_x` (T6): 30x SHORT with smallest offset (only 2.1% above entry). This is the position that gets liquidated. Its proximity to current price makes it the most vulnerable short.
- `attacker_long` (T8): Paired with a shadow short account in the attack scenario. Hidden by default.

**Position status enum:**

```
OPEN          → active, PnL updating live
LIQUIDATED    → margin depleted, insurance fund absorbing loss
FORCE_CLOSED  → ADL fired, position terminated at currentMarkPrice
SOCIALIZED    → queue exhausted, residual loss deducted pro-rata
```

---

## 7. Core Math — All Formulas

Every formula must be implemented exactly as specified. No shortcuts.

```js
// ── BASE CALCULATIONS ──────────────────────────────────────────

// Quantity in base asset
qty = sizeUSD / entryPrice

// Unrealized PnL in USD
pnl = side === 'LONG'
  ? (currentPrice - entryPrice) * qty
  : (entryPrice - currentPrice) * qty

// Initial margin
margin = sizeUSD / leverage

// PnL as % of margin (e.g. 2.4 = 240%)
pnlPct = pnl / margin

// Effective leverage
// = how leveraged is this position RIGHT NOW given unrealized gains compressing equity
effectiveLev = sizeUSD / (sizeUSD - Math.abs(pnl))
// Hard cap: if (sizeUSD - Math.abs(pnl)) <= 0, return 999


// ── ADL SCORING ────────────────────────────────────────────────

// LEGACY HEURISTIC (Binance, Bybit, OKX standard)
adlScore_legacy = pnlPct * effectiveLev
// Flaw: profit magnitude distorts ranking. New traders with small positions
// can rank ahead of large leveraged positions.

// QFEX METHOD (ak0 / QFEX design — correct approach)
adlScore_qfex = effectiveLev
// Profit is irrelevant to systemic risk. Highest eff. leverage = closed first.

// Only winning positions are eligible (pnl > 0).
// Losing positions have adlScore = -Infinity (excluded from queue).


// ── ADL PIP COUNT (5-pip indicator) ──────────────────────────

// Per side (long queue and short queue ranked separately)
maxScore = Math.max(...scoresForThisSide)
pips = Math.ceil((score / maxScore) * 5)
// Range: 0 (not in profit) to 5 (highest ranked in queue)
```

---

## 8. Settlement Price Engine

This is the most important conceptual element of the system. It must be explicitly visualized and explained.

### Two prices per ADL event

| Position | Settlement Price | Why |
|---|---|---|
| **Liquidated (loser)** | `bankruptPrice` | Last mark price where their equity was ≥ 0. Restores account to exactly zero. |
| **ALP (winner being closed)** | `currentMarkPrice` | Converts unrealized PnL to realized at fair value. No haircut beyond what the gap requires. |

### Why every other combination is wrong

**Both at `currentMarkPrice`:**  
The loser's equity remains negative at current mark — that's why they were liquidated. Settling at current mark doesn't restore them to zero. The gap is unclosed. Nothing was solved.

**Both at `bankruptPrice`:**  
Reverting the ALP's position to a prior price removes profits they earned on unrelated trades. A trader long AAPL (profitable) should not have those profits clawed back because someone else blew up on TSLA. This creates arbitrary wealth transfers between unrelated counterparties. Strictly wrong.

**Asymmetric (loser at `bankruptPrice`, winner at `currentMarkPrice`):**  
The only mathematically correct approach. The loser is restored to zero. The winner converts their earned unrealized PnL to realized without penalty. The exchange absorbs the residual gap between the two prices — which is exactly the loss it couldn't recover from the loser.

### Implementation

```js
// Snapshot at moment of liquidation (simStep 1):
bankruptPrice = snapshotLastPositiveEquityPrice(scalper_x)
// Approximation: entryPrice + (margin / qty) in the correct direction
// For SHORT scalper_x: bankruptPrice = entryPrice - (margin / qty)

// At ADL fire (simStep 2→3):
scalper_x.closePrice = bankruptPrice       // restores their equity to 0
alp.closePrice = currentMarkPrice          // winner realizes at fair value

// Exchange absorbs: |bankruptPrice - currentMarkPrice| * qty_of_alp
```

Show both prices in:
- The position table row (add a "Close Price" column that appears after ADL fires)
- The event log entry for each force-close

---

## 9. Insurance Fund Engine

```js
let insuranceFund = 2_400_000
const INS_FUND_MAX = 2_400_000
```

**State transitions:**

```
On liquidation event (simStep 0→1):
  lossGap = estimated loss beyond bankruptcy price
  insuranceFund -= lossGap * 0.6
  // Exchange absorbs 60% via fund. Remaining 40% deferred.

On drain event (simStep 1→2):
  Decrease by $180,000 every 120ms until zero.
  This is animated — each decrement triggers a bar update.
  When insuranceFund reaches 0:
    log: "⚠️ INSURANCE FUND DEPLETED. ADL ARMED."
    simStep = 2

On reset:
  insuranceFund = INS_FUND_MAX
```

**Progress bar color thresholds:**

```
> 60%  → var(--blue)   label: "Healthy"
20-60% → var(--accent) label: "Depleting"
< 20%  → var(--red)    label: "Critical — ADL Armed"
= 0    → var(--red)    label: "DEPLETED — ADL ARMED" (pulsing)
```

---

## 10. Dual Ranking Engine

The centerpiece of this system. Always visible. Always live. Updates on every price tick.

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│  [02] THE RANKING FLAW                                        │
│                                                               │
│  LEGACY METHOD                    QFEX METHOD                 │
│  PnL% × Effective Leverage        Effective Leverage only     │
│  ──────────────────────           ──────────────────────      │
│  #1  degen99      89.4            #1  degen99       31.2x     │
│  #2  perp_newbie  71.8  ⚠         #2  whale_btc     24.1x     │
│  #3  whale_btc    58.3            #3  algo_long     11.4x     │
│  #4  algo_long    32.1            #4  perp_newbie    5.3x     │
│                                                               │
│  ⚠ perp_newbie ranks #2 under legacy, above whale_btc        │
│    despite lower effective leverage and smaller position.      │
│    QFEX correctly ranks them #4. This is the flaw ak0         │
│    formally identified: profit magnitude distorts priority.   │
└───────────────────────────────────────────────────────────────┘
```

### Mis-rank highlighting rules

A position is "mis-ranked" if its legacy rank is numerically lower (higher priority) than its QFEX rank.

When a mis-rank is detected:
- Apply `background: rgba(247,169,40,0.1)` to that row in both columns
- Add `⚠` indicator next to the position name in the legacy column
- Show the explanatory callout below the table (text from layout above)

The callout text updates dynamically — it names the specific mis-ranked position and both rank numbers.

### Method toggle

Above the simulator section:

```
Ranking method for ADL fire:
  [Legacy: PnL% × EffLev]   [QFEX: EffLev only ✓]
```

- Toggle state persists until reset
- Dual ranking comparison panel always shows both regardless of toggle state
- Toggle only controls which method the force-close cascade uses

---

## 11. Simulation Step Machine

**Strict enforcement:** Each button is disabled (`opacity: 0.4`, `cursor: not-allowed`, `pointer-events: none`) when not at the correct step. No skipping. No back-stepping.

```
simStep 0 — INIT
  State: All positions OPEN. Fund at 100%. Prices live.
  Active buttons: [💥 Trigger Liquidation]  [🎭 Run Attack Scenario]
  Disabled: [🔥 Drain Fund]  [⚡ Fire ADL]  [↺ Reset]

simStep 1 — LIQUIDATED
  State: scalper_x → LIQUIDATED. Fund partially reduced.
  Active buttons: [🔥 Drain Insurance Fund]  [↺ Reset]
  Disabled: [💥 Trigger Liquidation]  [⚡ Fire ADL]  [🎭 Run Attack Scenario]
  Log: "scalper_x (SHORT 30x) LIQUIDATED at [price]. Loss gap: $[X]. Fund absorbing."

simStep 2 — FUND DEPLETED
  State: Fund = $0. ADL armed. "DEPLETED — ADL ARMED" label pulsing.
  Active buttons: [⚡ Fire ADL]  [↺ Reset]
  Method toggle now visible and functional.
  Log: "⚠️ INSURANCE FUND DEPLETED. ADL ARMED. Method: [active method]."

simStep 3 — ADL FIRED
  State: Cascade runs. ALPs force-closed sequentially.
  All sim buttons disabled except [↺ Reset].
  Log: full cascade sequence (see Section 12).

simStep A — ATTACK SCENARIO (parallel track, only from simStep 0)
  State: T8 + shadow short visible. Separate sequence.
  [↺ Reset] always available during this track.
```

---

## 12. ADL Cascade — Force-Close Sequence

```js
async function fireADLCascade() {
  const bankruptPrice = state.bankruptPrice   // snapshotted at simStep 1
  const currentMark = state.currentPrice
  const lossGap = state.lossGap              // total gap insurance fund couldn't cover

  // Get queue sorted by active method (legacy or QFEX)
  // Only LONG positions (opposite side to liquidated SHORT scalper_x)
  const queue = getADLQueue('LONG', activeMethod)

  let covered = 0
  let step = 0

  for (const alp of queue) {
    if (covered >= lossGap) break

    alp.status = 'FORCE_CLOSED'
    alp.closePrice = currentMark
    const absorbed = Math.max(0, alp.pnl)
    covered += absorbed
    step++

    const remaining = Math.max(0, lossGap - covered)

    logEvent(
      `ADL step ${step}: ${alp.name} force-closed.` +
      ` ALP close price: $${fmt(currentMark)}.` +
      ` Loser close price: $${fmt(bankruptPrice)}.` +
      ` Absorbed: ${fmtUSD(absorbed)}.` +
      ` Gap remaining: ${fmtUSD(remaining)}.`,
      'adl'
    )

    renderTable()
    updateGapIndicator(remaining)
    await delay(900)
  }

  // Post-cascade resolution
  if (covered >= lossGap) {
    logEvent(`Loss gap fully covered after ${step} ALP(s). ADL sequence complete.`, 'ok')
  } else {
    // Queue exhausted — socialized loss kicks in
    const residual = lossGap - covered
    applySocializedLoss(residual)
    logEvent(
      `⚠️ ALP queue exhausted after ${step} position(s). Residual gap: ${fmtUSD(residual)}.` +
      ` Socialized loss applied pro-rata across ${getOpenPositions().length} remaining open positions.`,
      'warn'
    )
  }

  simStep = 3
  renderTable()
}
```

**Gap remaining indicator:** A live bar/number visible during cascade showing "Gap remaining: $X" that decrements after each ALP closure. Reaches zero when fully covered, or shows residual if queue is exhausted.

---

## 13. Socialized Loss Module

This activates only when the ALP queue is exhausted and a residual loss gap remains. It is a last-resort within the last resort.

### Logic

```js
function applySocializedLoss(residual) {
  const openPositions = positions.filter(p => p.status === 'OPEN')
  const totalEquity = openPositions.reduce((sum, p) => sum + (margin(p) + pnl(p)), 0)

  openPositions.forEach(p => {
    const share = (margin(p) + pnl(p)) / totalEquity
    const deduction = residual * share
    p.socializedDeduction = deduction
    p.status = 'SOCIALIZED'
  })
}
```

### UI

In the position table, add a `Deduction` column that appears only when socialized loss has been applied:

```
Trader         Side    Unr. PnL    Deduction    Status
whale_btc      LONG    +$84,200    -$1,340      SOCIALIZED
algo_long      LONG    +$18,100    -$288        SOCIALIZED
hedger_pro     SHORT   +$42,600    -$677        SOCIALIZED
```

Show an explanatory callout below the table:
> "ALP queue exhausted before the loss gap was fully covered. The remaining $X has been distributed pro-rata across all open positions based on their equity weight. This is the final backstop: the exchange cannot absorb unlimited liability."

---

## 14. Attack Resistance Scenario

Activated via `[🎭 Run Attack Scenario]` button at `simStep 0` only.

This runs on a separate state track (`simStep A`). It does not interfere with the main simulation.

### Setup

Show two additional rows in the position table:

```js
{ id:'T8',  name:'attacker_long',  side:'LONG',  sizeUSD:50000, lev:20, entryOffset:-0.033 }
{ id:'T8s', name:'attacker_short', side:'SHORT', sizeUSD:50000, lev:20, entryOffset:+0.033 }
// T8s is the "shadow account" — same notional, opposite side
// Before any move, the attacker is delta-neutral
```

### Scenario narrative (shown as stepped log entries)

```
Step 1: "Attacker holds LONG 20x ($50K) and SHORT 20x ($50K). Delta-neutral."
Step 2: "Price drops 8%. SHORT position profits. LONG position approaches liquidation."
Step 3: "attacker_long LIQUIDATED. Insurance fund absorbs loss."
Step 4 (Legacy): "Under PnL% × EffLev, attacker_short ranks #2 in SHORT queue.
                  ADL fires. attacker_short force-closed at currentMarkPrice.
                  Realized gain: $XX,XXX. Net extracted from mechanism: $XX,XXX."
Step 4 (QFEX):  "Under EffLev only, attacker_short ranks by leverage only.
                 ADL fires. attacker_short force-closed at currentMarkPrice.
                 Realized gain: $XX,XXX. Result is structurally identical —
                 the attack still generates profit. But QFEX design closes this
                 via asymmetric settlement: the attacker can only realize
                 currentMarkPrice, not an inflated price."
```

### Explanatory callout

Show a callout card after the scenario:

> **Why does this matter?**  
> Under a naive VMGH system without asymmetric settlement pricing, an attacker could engineer ADL events to extract more than they put in. Correct asymmetric settlement — loser at `bankruptPrice`, winner at `currentMarkPrice` — ensures the mechanism cannot be used to manufacture profits. The attacker realizes what the market gave them, nothing more. The exchange absorbs only the true gap.

### Toggle in attack scenario

Show both legacy and QFEX outcomes simultaneously, side by side, so the user sees the difference in how the queue ranked the attacker's short position under each method.

---

## 15. Personal Position Input Module

Collapsible panel. Title: "CHECK YOUR ADL RISK". Default: collapsed.

### Input fields

```
Pair:       [BTC/USDT ▾]  [ETH/USDT]  [SOL/USDT]
Side:       [LONG ▾]  [SHORT]
Entry:      [____________] USDT
Size:       [____________] USD notional
Leverage:   [____________] x

[Calculate ADL Score]
```

Use `div` elements with `contenteditable` or `input[type=text]` — never `<form>`. Bind `[Calculate]` to a click handler, not a submit event.

### Output

```
──────────────────────────────────────────
  YOUR POSITION vs. CURRENT BOOK
──────────────────────────────────────────

  Unrealized PnL:    +$48,200  (+241.0%)
  Effective Leverage: 18.3x

  LEGACY METHOD (Binance/Bybit)
  ADL Score:   12.47
  Queue Rank:  #2 / 4 longs    ████░  (4/5)
  Risk:        🟠 HIGH — Top 20% of queue

  QFEX METHOD
  ADL Score:   18.3x eff. lev
  Queue Rank:  #3 / 4 longs    ███░░  (3/5)
  Risk:        🟡 MODERATE — Mid-queue

  ↓ 1 rank safer under QFEX method
──────────────────────────────────────────
```

If the position is not in profit: show `✅ SAFE — Position is not in profit. No ADL exposure under either method.`

### Risk labels

```
5 pips → 🔴 CRITICAL  — First in queue. ADL fires on you first.
4 pips → 🟠 HIGH      — Top 20% of queue. Significant exposure.
3 pips → 🟡 MODERATE  — Mid-queue. Consider reducing leverage or taking partial profit.
2 pips → 🟢 LOW       — Lower half of queue. Monitor during volatility.
1 pip  → ✅ MINIMAL   — Very low ADL risk at current conditions.
0 pips → ✅ SAFE      — Not in profit. No ADL exposure.
```

### Pairs

Use prices already loaded from the market feed. No additional API calls. BTC/USDT, ETH/USDT, SOL/USDT.

---

## 16. Event Log

Fixed-height scrollable panel at the bottom of the simulator. Auto-scrolls to latest entry on every append.

```
Format: [HH:MM:SS] message
Font:   Space Mono, 11px
Height: max-height 130px, overflow-y: auto
```

**Color classes:**

```
.log-ok    → var(--green)  — system ready, gap covered, cascade complete
.log-liq   → var(--red)    — liquidation events, fund drain, gap opening
.log-adl   → var(--purple) — ADL queue activation, force-close steps
.log-ins   → var(--blue)   — insurance fund changes
.log-warn  → var(--accent) — ADL armed, socialized loss, queue exhausted
.log-muted → var(--muted)  — price updates, API polls (low-noise)
```

**Required log entries (in order):**

```
[init]     [OK]   System initialized. Insurance fund: $2,400,000. 7 positions open. Prices live.
[step 1]   [LIQ]  scalper_x (SHORT 30x) LIQUIDATED at $[price]. Loss gap: $[X]. Fund absorbing $[0.6×X].
[step 1]   [INS]  Insurance fund: $[new value] (was $2,400,000).
[step 2]   [LIQ]  Black swan cascade. Insurance fund draining...
[step 2]   [WARN] INSURANCE FUND DEPLETED. Total unmatched liability: $[lossGap]. ADL ARMED.
[step 3]   [ADL]  ADL firing. Method: [Legacy | QFEX]. Queue: [N] eligible ALPs.
[step 3]   [ADL]  ADL step 1: [name] force-closed. ALP close: $[mark]. Loser close: $[bankrupt]. Absorbed: $[X]. Gap remaining: $[Y].
[step 3+]  [ADL]  ADL step 2: [name] force-closed. ... (repeat per ALP)
[complete] [OK]   Loss gap fully covered after [N] ALP(s). ADL sequence complete.
  OR
[exhausted][WARN] ALP queue exhausted. Residual: $[X]. Socialized loss applied to [N] open positions.
```

---

## 17. Full Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  HEADER                                                 │
│  Logo "⚡ ADL Engine" + "Auto-Deleveraging for          │
│  Crypto Perps" + LIVE badge (green pulse dot)           │
├─────────────────────────────────────────────────────────┤
│  MARKET BAR  [BTC] [ETH] [SOL] [Funding Rate BTC]      │
│  Each card: label, price (Space Mono), 24h % change     │
├─────────────────────────────────────────────────────────┤
│  [01] WHAT IS ADL                                       │
│  Section label + title + subtitle                       │
│  ── 4-card explainer grid ──                            │
│     Card A: Tear-Ups (TradFi Origin)                    │
│     Card B: Variation Margin Gains Haircutting          │
│     Card C: Insurance Fund — First Line                 │
│     Card D: ADL — Structural Last Resort                │
│  ── ADL Trigger Flow (5-step horizontal diagram) ──     │
│  ── Settlement Price Explainer box ──                   │
│  ── Formula Comparison box (Legacy vs QFEX) ──          │
├─────────────────────────────────────────────────────────┤
│  [02] THE RANKING FLAW                                  │
│  Short prose explainer (3 sentences max)                │
│  ── Dual ranking table (live, auto-updates) ──          │
│     Left col: Legacy rankings                           │
│     Right col: QFEX rankings                            │
│     Mis-ranked rows highlighted amber                   │
│     Explanatory callout below                           │
├─────────────────────────────────────────────────────────┤
│  [03] LIVE SIMULATOR                                    │
│  Insurance fund progress bar                            │
│  Method toggle [Legacy] [QFEX ✓]                        │
│  Position table (7 rows default, 8 in attack mode)      │
│  Sim control buttons (step-gated)                       │
│  Gap remaining indicator (appears during cascade)       │
│  Event log                                              │
├─────────────────────────────────────────────────────────┤
│  [04] ADL QUEUE                                         │
│  LONG queue col + SHORT queue col                       │
│  Both methods shown per queue                           │
│  Rank #1 marked with ⚡                                 │
├─────────────────────────────────────────────────────────┤
│  [05] PERSONAL POSITION CHECK                           │
│  Collapsible panel                                      │
│  Input form → dual-method output                        │
├─────────────────────────────────────────────────────────┤
│  [06] KEY CONCEPTS                                      │
│  6-card grid:                                           │
│  ADL Indicator | Lower Leverage = Lower Risk |          │
│  Take Partial Profits | High Risk Periods |             │
│  Insurance Fund Size | No Slippage Protection           │
└─────────────────────────────────────────────────────────┘
```

---

## 18. Explainer Content — Exact Text

### Section 01 Cards

**Card A — Tear-Ups**  
*Title:* Tear-Ups (TradFi Origin)  
*Body:* In traditional futures markets, clearing houses use "tear-ups" to forcibly close offsetting positions when a participant can no longer meet obligations. ADL in crypto is the direct structural equivalent — not a punitive measure, but a necessity to prevent continued loss accumulation from an insolvent counterparty. It exists in every serious margin market in the world.

**Card B — VMGH**  
*Title:* Variation Margin Gains Haircutting  
*Body:* When a loser can't pay, someone must cover the gap. VMGH takes money from winners to cover bad debt. Exchanges must have this because losers may simply not have the means to pay, regardless of obligation. The regulated alternative — requiring FCM brokers to post their own capital — just kills leverage products entirely by disincentivizing brokers from offering them.

**Card C — Insurance Fund**  
*Title:* Insurance Fund: First Line of Defense  
*Body:* Exchanges build an insurance fund from liquidation fees and partial margin captures. When a position is closed at a price worse than the bankruptcy price, the fund absorbs the gap. The vast majority of liquidations never reach ADL. Only when the fund is depleted does the exchange reach into the ALP queue.

**Card D — ADL**  
*Title:* ADL: Structural Last Resort  
*Body:* ADL fires only when a position is liquidated AND the insurance fund cannot cover the resulting loss gap. The exchange forcibly closes profitable positions on the opposite side — ADL Liquidity Providers (ALPs) — at the bankrupt trader's last positive-equity price. No warning. No consent. Structurally necessary. Well-designed ADL aids market stability; poorly designed ADL creates exploitable edge cases.

### Settlement Price Explainer Box

```
WHY TWO SETTLEMENT PRICES?

  Liquidated position (loser)  →  closed at bankruptPrice
    = last mark price where their equity was ≥ 0
    = restores their account to zero, no more

  ALP position (winner forced closed)  →  closed at currentMarkPrice
    = converts unrealized PnL to realized at fair value
    = no haircut beyond what closing the gap requires

  ────────────────────────────────────────────────────────

  Both at currentMarkPrice:
    Loser remains negative. Gap is not closed. Nothing was solved.

  Both at bankruptPrice:
    ALP loses profits from unrelated trades.
    A trader long AAPL shouldn't lose gains because someone
    blew up on TSLA. Arbitrary wealth transfer. Wrong.

  Asymmetric (loser at bankruptPrice, winner at currentMarkPrice):
    The only mathematically correct approach.
    Exchange absorbs only the true gap: |bankruptPrice − currentMarkPrice| × qty.
```

### Formula Comparison Box

```
LEGACY HEURISTIC  (Binance · Bybit · OKX)
  ADL Priority = PnL% × Effective Leverage
  
  Flaw: profit magnitude distorts ranking independent of systemic risk.
  A new trader with a small position and high % gain can rank ahead
  of a large leveraged position. Disproportionately penalizes new traders.
  Formally: there exist cases where trader A (return < R) ranks ahead
  of trader B (return > R) purely due to position size interaction.

──────────────────────────────────────────────────────────────

QFEX METHOD  (ak0 · QFEX design)
  ADL Priority = Effective Leverage only
  
  Effective Leverage = Position Value / (Position Value − |Unrealized PnL|)
  
  Logic: ADL's objective is systemic de-risking. Highest effective
  leverage = highest contribution to systemic risk = reduced first.
  Profit magnitude is irrelevant to the risk engine's goal.
```

---

## 19. Behavioral Rules — Non-Negotiable

| Rule | Implementation |
|---|---|
| **Single file** | All HTML, CSS, JS inline in `index.html`. Google Fonts CDN is the only external dependency. |
| **No frameworks** | Vanilla JS only. No React, Vue, jQuery, Lodash, or npm packages. |
| **No form tags** | Use `div` + event listeners. Never `<form>`, never `onsubmit`. |
| **No localStorage** | All state in JS variables. Session-only. No persistence. |
| **Live price drives all calculations** | PnL, ADL scores, queue rankings, pip counts recalculate immediately on every price tick. |
| **Step machine is strict** | Buttons outside current simStep are disabled with opacity 0.4 + cursor not-allowed. No exceptions. |
| **Dual ranking always visible** | Section 02 updates live regardless of sim state or method toggle. |
| **Method toggle affects cascade only** | Comparison panel always shows both. Toggle controls only which method fires the cascade. |
| **bankruptPrice snapshotted once** | Captured the moment scalper_x is liquidated. Used throughout. Never recalculated. |
| **Cascade delay** | 900ms between each ALP force-close. Non-negotiable. Visual clarity is part of the educational purpose. |
| **API failure is graceful** | All fetches in try/catch. Demo mode on failure. No thrown errors. No broken UI. |
| **Poll interval** | 15 seconds. Do not reduce — Binance unauthenticated rate limit is ~1200 req/min across all connections. |
| **Seeded entry offsets** | Use the exact offsets in Section 6. The ranking flaw only manifests correctly with these specific values. |
| **Responsive** | Must render correctly at 768px minimum width. Market bar 2×2 on mobile. Single-column sections. |
| **No console errors** | Test all code paths. Catch all edge cases. Zero unhandled exceptions on load or during simulation. |

---

## 20. Deliverable Checklist

Agent marks each complete before submitting:

**Data & Init**
- [ ] BTC/ETH/SOL spot prices load from Binance on init
- [ ] BTC funding rate loads from Binance futures endpoint on init
- [ ] Fallback demo mode activates silently if any fetch fails
- [ ] All 8 positions initialize with correct entry prices from seeded offsets × live price
- [ ] PnL, effectiveLev, adlScore_legacy, adlScore_qfex all calculate correctly on init

**Dual Ranking**
- [ ] Section 02 dual ranking table renders on load with both methods
- [ ] Table auto-updates on every 15s price tick
- [ ] `perp_newbie` correctly appears mis-ranked (amber row + ⚠) under legacy vs QFEX
- [ ] Explanatory callout names the specific mis-ranked position dynamically

**Simulator**
- [ ] Step machine enforces correct button states at every simStep
- [ ] Method toggle functional (Legacy vs QFEX)
- [ ] Insurance fund bar animates correctly through drain sequence (180K decrements × 120ms)
- [ ] `bankruptPrice` snapshotted at simStep 1 and used in all subsequent log/table entries
- [ ] Both settlement prices (bankruptPrice + currentMarkPrice) shown in event log per ADL step
- [ ] ADL cascade closes ALPs sequentially with 900ms gap between each
- [ ] Gap remaining indicator updates after each cascade step
- [ ] Socialized loss applies and displays if queue exhausted before gap is covered

**Attack Scenario**
- [ ] `[🎭 Run Attack Scenario]` only available at simStep 0
- [ ] T8 + shadow short appear in table during scenario
- [ ] Scenario shows legacy vs QFEX outcomes side by side
- [ ] Explanatory callout renders after scenario completes

**Personal Position**
- [ ] Collapsible panel works (expand/collapse)
- [ ] All 3 pairs selectable
- [ ] Dual-method output renders (legacy rank + QFEX rank + pips + risk label for each)
- [ ] Risk label changes correctly across all 6 pip states
- [ ] "Safer under QFEX" / rank difference line renders correctly

**Polish**
- [ ] Responsive at 768px
- [ ] Zero console errors on load
- [ ] Zero console errors through full simulation sequence
- [ ] Event log auto-scrolls to latest entry
- [ ] All buttons correctly disabled/enabled per simStep

---

*Brief version: 2.1 — June 2026*  
*Source: @annanay (ak0/QFEX) — X threads, Dec 2025 & Jun 2026*  
*Author: Gilang Fajar Wijayanto*  
*Build target: `second-brain/adl-system/index.html`*

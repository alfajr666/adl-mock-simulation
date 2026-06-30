# ADL Mock System — Agent Build Brief
**Project:** Auto-Deleveraging Simulation Engine for Crypto Perpetual Futures  
**Output path:** `second-brain/adl-system/`  
**Stack:** Single-file HTML + Vanilla JS (no framework, no build step)  
**Data:** Binance public REST API (no auth required)  
**Agent:** Antigravity in Zed

---

## 1. What We're Building

A self-contained, browser-runnable mock ADL system that simulates how a real perpetual futures exchange handles the Auto-Deleveraging cascade. It is **not** a trading interface. It is a simulation + educational tool with the following modules:

| Module | Purpose |
|---|---|
| **Live Market Feed** | Real BTC/ETH/SOL prices + funding rate from Binance API |
| **Position Book** | Simulated pool of long/short positions anchored to live price |
| **Insurance Fund Engine** | Tracks fund level, drains on liquidation events |
| **ADL Queue Engine** | Ranks all open winning positions by ADL Score in real time |
| **ADL Trigger Engine** | Force-closes positions in rank order until loss gap is covered |
| **Event Log** | Timestamped audit trail of every system event |
| **Personal Position Input** | User inputs their own position → see live ADL score + pip count |

---

## 2. File Structure

```
second-brain/adl-system/
├── index.html          ← entire system, single file
└── README.md           ← this brief (optional copy)
```

No node_modules. No package.json. No bundler. Everything inline in `index.html`.

---

## 3. Design System

Inherit exactly from the existing `adl-explainer.html` design tokens:

```css
--bg: #070b14
--surface: #0d1420
--surface2: #131c2e
--border: #1e2d45
--text: #e2eaf7
--muted: #5a7299
--accent: #f7a928      /* amber — ADL warnings */
--red: #f03e3e         /* liquidations */
--green: #22d17a       /* profitable positions */
--blue: #3d8ef0        /* insurance fund */
--purple: #9b6dff      /* ADL queue / force close */
font: 'Space Grotesk' (body), 'Space Mono' (numbers, labels, monospace)
```

Dark terminal aesthetic. No light mode. No gradients beyond existing ones.

---

## 4. Data Layer — Binance Public API

All fetches are unauthenticated. CORS-safe from browser.

### 4a. Price Ticker (poll every 15s)
```
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]
```
Returns: `lastPrice`, `priceChangePercent` per symbol.

### 4b. Funding Rate
```
GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT
```
Returns: `lastFundingRate` (multiply × 100 for %).

### 4c. Open Interest (optional, for realism)
```
GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT
```
Returns: `openInterest` in BTC.

### Fallback
If any fetch fails (offline / CORS error), fall back to static demo values:
- BTC: $65,000 | ETH: $3,400 | SOL: $145
- Funding rate: +0.0100%
- Log: `[API] Binance unreachable. Running in demo mode.`

---

## 5. Position Book — Simulated Traders

### 5a. Default Position Pool

7 fixed traders. Entry prices are calculated at init as:
`entry = livePrice × (1 ± randomOffset)` where offset ∈ [2%, 10%]

Long traders get entry below current price (in profit).  
Short traders get entry above current price (in profit on down move, loss on up move).

Assign offsets procedurally so the book is always realistic regardless of BTC price.

```js
const TRADERS = [
  { id:'T1', name:'whale_btc',    side:'LONG',  sizeUSD:500000, lev:20 },
  { id:'T2', name:'algo_long',    side:'LONG',  sizeUSD:120000, lev:10 },
  { id:'T3', name:'degen99',      side:'LONG',  sizeUSD:80000,  lev:25 },
  { id:'T4', name:'hedger_pro',   side:'SHORT', sizeUSD:300000, lev:5  },
  { id:'T5', name:'short_squeeze',side:'SHORT', sizeUSD:200000, lev:15 },
  { id:'T6', name:'scalper_x',    side:'SHORT', sizeUSD:60000,  lev:30 },
  { id:'T7', name:'perp_newbie',  side:'LONG',  sizeUSD:20000,  lev:3  },
]
```

### 5b. Position Status States

```
OPEN          → active, PnL updating live
LIQUIDATED    → margin depleted, insurance fund absorbing
FORCE_CLOSED  → ADL fired, position terminated at bankrupt price
```

### 5c. PnL Calculations

```js
// Quantity in base asset
qty = sizeUSD / entryPrice

// Unrealized PnL in USD
pnl = side === 'LONG'
  ? (currentPrice - entryPrice) × qty
  : (entryPrice - currentPrice) × qty

// PnL as % of margin
margin = sizeUSD / leverage
pnlPct = pnl / margin

// Effective leverage (how leveraged are you right now, given gains)
effectiveLev = positionValue / (positionValue - |pnl|)
// cap at 999 if denominator ≤ 0

// ADL Score
adlScore = pnlPct × effectiveLev
// Only positive for winning positions. Negative = not at ADL risk.
```

---

## 6. Insurance Fund Engine

### State
```js
let insuranceFund = 2_400_000   // USD
const INS_FUND_MAX = 2_400_000
```

### Rules
- On liquidation: `fund -= lossGap × 0.6` (exchange absorbs 60% of gap via fund)
- On drain event: decrease by $180,000 every 120ms until zero
- When fund hits zero: arm ADL trigger
- Display: progress bar + dollar value + status label (Healthy / Depleting / Critical)

### Color thresholds for bar
```
> 60%  → blue   "Healthy"
20-60% → amber  "Depleting"
< 20%  → red    "Critical — ADL Armed"
```

---

## 7. ADL Queue Engine

Runs continuously whenever `simStep >= 1`. Re-ranks on every price tick.

### Ranking Logic
1. Filter: only `status === 'OPEN'` positions
2. Filter: only positions with `adlScore > 0` (winning positions)
3. Sort descending by `adlScore`
4. Separate into LONG queue and SHORT queue
5. Display rank, name, leverage, size, score
6. Rank #1 in each queue gets a `⚡` indicator

### ADL Pip Indicator (5-pip bar per position)
```js
// Normalize score within the same side
pips = Math.ceil((score / maxScoreInSide) × 5)
// 5 pips = highest risk, 1 pip = lowest
// 0 pips = losing position (no ADL risk)
```

Pip colors: lit = amber `#f7a928`, unlit = surface2 `#131c2e`

---

## 8. ADL Trigger Engine

### Trigger Conditions
ADL can only fire when ALL of these are true:
- `simStep === 2` (insurance fund depleted)
- At least one position is `LIQUIDATED`
- At least one opposite-side position has `adlScore > 0`

### Force Close Logic
```js
function fireADL() {
  const lossGap = calculateRemainingGap()  // USD not covered by insurance fund

  // Get sorted queue for the OPPOSITE side of the liquidated position
  const queue = getADLQueue(oppositeSide)

  let covered = 0
  for (const pos of queue) {
    pos.status = 'FORCE_CLOSED'
    pos.closePrice = bankruptPrice   // not market price
    covered += Math.abs(pos.pnl)
    logEvent(`ADL fired: ${pos.name} force-closed. PnL forfeited: $${pos.pnl}`, 'adl')

    if (covered >= lossGap) break
  }

  logEvent('Loss gap covered. ADL sequence complete.', 'ok')
  simStep = 3
}
```

### Key behavior to implement
- Force close happens at **bankruptcy price of the liquidated position**, NOT at market
- Winner does not choose. No warning. No confirmation.
- Multiple positions can be closed in one ADL event if one isn't enough to cover the gap
- Add 900ms delay between each force close for visual clarity

---

## 9. Personal Position Input Module (New vs. Explainer)

This is the key new feature not in the existing `adl-explainer.html`.

### UI
A collapsible panel below the position book:

```
─────────────────────────────────────────
  CHECK YOUR ADL RISK
─────────────────────────────────────────
  Pair:      [BTC/USDT ▾]
  Side:      [LONG ▾]  [SHORT ▾]
  Entry:     [___________] USDT
  Size:      [___________] USD
  Leverage:  [___________] x

  [Calculate ADL Score]
─────────────────────────────────────────
  ADL Score:    12.47
  ADL Pip:      ████░  (4/5)
  Risk Level:   ⚠️ HIGH — You'd be in top 20% of the queue
  Eff. Leverage: 18.3x
  Unr. PnL:    +$48,200 (+241%)
─────────────────────────────────────────
```

### Calculation
Same formulas as Section 5c. Use live price from the market feed.

### Risk level labels
```
5 pips → 🔴 CRITICAL — First in queue. ADL fires on you first.
4 pips → 🟠 HIGH — Top 20% of queue. Significant exposure.
3 pips → 🟡 MODERATE — Mid-queue. Reduce leverage or take partial profit.
2 pips → 🟢 LOW — Lower half of queue. Monitor during volatility.
1 pip  → ✅ MINIMAL — Very low ADL risk at current conditions.
0 pips → ✅ SAFE — Position is not in profit. No ADL exposure.
```

### Pair options
BTC/USDT, ETH/USDT, SOL/USDT (prices from live feed, no extra API call needed)

---

## 10. Simulation Flow — Step Machine

```
simStep 0 → INIT
  All positions OPEN. Insurance fund 100%. Price updating live.
  Buttons available: [💥 Trigger Liquidation]

simStep 1 → LIQUIDATION TRIGGERED
  scalper_x (SHORT 30x) moves to LIQUIDATED.
  Insurance fund absorbs partial loss.
  ADL queue starts ranking.
  Buttons available: [🔥 Drain Insurance Fund]

simStep 2 → FUND DEPLETED
  Insurance fund drains to $0 over ~3 seconds (animated).
  Status bar goes red. "ADL ARMED" label appears.
  Buttons available: [⚡ Fire ADL]

simStep 3 → ADL FIRED
  Top 1-2 positions force-closed.
  Event log shows sequence.
  Buttons available: [↺ Reset]
```

No skipping steps. Each button is only active at its correct simStep. Others are disabled/greyed.

---

## 11. Event Log

Fixed-height scrollable panel at bottom of simulator. Auto-scrolls to latest.

```
Format: [HH:MM:SS] message
```

Color classes:
```
log-ok     → green  — system events, completion
log-liq    → red    — liquidations, fund drain
log-adl    → purple — ADL queue activation, force closes
log-ins    → blue   — insurance fund changes
log-warn   → amber  — warnings, armed states
log-muted  → grey   — price updates, API polls (optional, reduce noise)
```

---

## 12. Layout Structure

```
┌─────────────────────────────────────────────┐
│ HEADER — Logo + Live badge                  │
├─────────────────────────────────────────────┤
│ MARKET BAR — BTC | ETH | SOL | Funding Rate │
├─────────────────────────────────────────────┤
│ [01] WHAT IS ADL — 4-card explainer         │
│      ADL Trigger Flow diagram               │
│      ADL Formula box                        │
├─────────────────────────────────────────────┤
│ [02] LIVE SIMULATOR                         │
│   Insurance Fund bar                        │
│   Position table (7 rows)                   │
│   Sim control buttons                       │
│   Event log                                 │
├─────────────────────────────────────────────┤
│ [03] ADL QUEUE — Long / Short columns       │
├─────────────────────────────────────────────┤
│ [04] PERSONAL POSITION CHECK (new)          │
│   Input form → live ADL score output        │
├─────────────────────────────────────────────┤
│ [05] KEY CONCEPTS — 6-card grid             │
└─────────────────────────────────────────────┘
```

---

## 13. Behavioral Rules

| Rule | Detail |
|---|---|
| **Single file** | All HTML, CSS, JS in one `index.html`. No external files except Google Fonts CDN. |
| **No frameworks** | Vanilla JS only. No React, Vue, jQuery, or npm dependencies. |
| **Live price drives everything** | Position PnL, ADL scores, queue rankings all recalculate on every price tick. |
| **No form tags** | Use `div` + event listeners for inputs, not `<form>` tags. |
| **API failure is graceful** | All API calls wrapped in try/catch. Demo mode activates silently. |
| **Price poll interval** | 15 seconds. Do not exceed — Binance rate limits unauthenticated at ~1200 req/min. |
| **No localStorage** | All state in JS variables. Session-only. |
| **Step machine is strict** | Buttons disabled if wrong simStep. No step skipping. |
| **ADL score recomputes on tick** | Queue ranking updates live even mid-simulation. |
| **Positions recalculate on reset** | New entry prices generated from fresh live price on reset. |

---

## 14. Sections to Carry Over from adl-explainer.html

The following are already built and should be ported directly (style + content):

- Header component (logo + live badge)
- Market bar (4 cards: BTC, ETH, SOL, Funding Rate)
- Section 01: 4-card explainer grid (What is ADL steps 1–4)
- ADL Trigger Flow diagram (5-step horizontal flow)
- ADL Formula box
- Section 02: Simulator (position table, insurance fund bar, log)
- Section 03: ADL Queue (long/short split columns)
- Section 05: Key Concepts 6-card grid

### What is NEW (not in explainer):
- Section 04: Personal Position Input form with live ADL score calculation
- Step machine enforcement (buttons disabled by simStep)
- Open Interest display (optional, from Binance API)
- Risk level labels on personal position output

---

## 15. Deliverable Checklist

Agent should confirm each before marking complete:

- [ ] Single `index.html` file under `second-brain/adl-system/`
- [ ] Live BTC/ETH/SOL prices loading from Binance on init
- [ ] Live funding rate loading from Binance futures endpoint
- [ ] Position table renders with correct PnL based on live price
- [ ] ADL Score and pip count calculating correctly for all 7 positions
- [ ] Insurance fund bar animating correctly through drain sequence
- [ ] Step machine enforcing correct button states at each simStep
- [ ] Force close animation and log entries firing in correct order
- [ ] Personal position input calculating ADL score + risk label correctly
- [ ] All 3 pairs (BTC/ETH/SOL) selectable in personal position input
- [ ] Graceful fallback to demo mode if Binance API unreachable
- [ ] No console errors on load
- [ ] Responsive down to 768px width minimum

---

## 16. Reference Files

| File | Location | Purpose |
|---|---|---|
| `adl-explainer.html` | `second-brain/adl-system/reference/adl-explainer.html` | Design + logic reference — port from this |
| `My_Profile.md` | `second-brain/job-matcher/.agent/rules/My_Profile.md` | Context only, not needed for build |

Agent should read `adl-explainer.html` first before writing any code. All existing logic is reusable.

---

*Brief version: 1.0 — June 2026*  
*Author: Gilang Fajar Wijayanto*  
*Project: ADL Mock System — delomite.com / portfolio*

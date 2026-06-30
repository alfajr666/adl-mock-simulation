# ⚡ Auto-Deleveraging (ADL) Mock Simulation System v2.1

**Portfolio Project by Gilang Fajar Wijayanto**  
Senior Treasury & Finance Operations Specialist | CFA Level I | FRM Part I  
[delomite.com](https://delomite.com) | [LinkedIn](https://www.linkedin.com/in/gilang-fajar-6973119a/)

---

## 📋 Overview

This repository demonstrates an interactive, educational simulation engine modeling the mechanics, flaws, and mathematical imperatives of Auto-Deleveraging (ADL) on cryptocurrency perpetual futures exchanges. 

The model visualizes how a severe black swan liquidation cascade burns through a crypto exchange's insurance fund, triggering the ADL risk engine as a structural last resort to prevent systemic insolvency. 

The architecture features a decoupled **Vanilla HTML/JS Frontend** backed by a **zero-dependency Python server** implementing a strict state-machine simulation. It exposes the critical flaws in legacy ADL formulas (like those used by Binance and Bybit) by proving how their heuristics mis-rank systemic risk, penalizing retail traders while protecting high-risk whales.

**[Live Dashboard →](#)** *(Local deployment via `app.py`)*

### Business Context
In crypto derivatives, when a losing trader's position is liquidated and their margin cannot cover the closing cost, the exchange's insurance fund absorbs the debt. If the insurance fund depletes to zero, the exchange MUST fire the ADL engine, forcibly closing the most profitable opposing traders to cover the bad debt. Understanding this mechanism is vital for risk operations, treasury management, and institutional portfolio hedging.

### Key Features
- ✅ **Live Market Polling**: Streams real-time prices for BTC, ETH, and SOL directly from Binance Futures via a background thread.
- ✅ **Tabbed Architecture**: Clean separation between the macro Exchange POV (engine view) and the micro User POV (retail impact).
- ✅ **The Ranking Flaw Proof**: Visually proves the mathematical failure of the Legacy `PnL% × EffLev` formula vs the mathematically correct `EffLev only` (QFEX) methodology.
- ✅ **Archetype Portfolios**: Tracks 3 retail archetypes (Conservative, Leveraged, Aggressive) dynamically as the cascade hits.
- ✅ **Asymmetric Settlement Logic**: Correctly implements dual-price settlement (`bankruptPrice` vs `currentMarkPrice`) to ensure the exchange only absorbs the true mathematical loss gap.

---

## 📊 Simulation Mechanics & Entities

| Archetype | Leverage | Position Size (USD) | Side | Description |
|-----------|----------|---------------------|------|-------------|
| **Conservative** | 2× | 2,000 | Long | Low leverage, modest capital, risk‑averse. Survives most market moves unless an extreme ADL cascade occurs. |
| **Leveraged** | 10× | 5,000 | Long | Medium leverage. Gains more on moderate moves but is vulnerable to >50% shocks. |
| **Aggressive** | 50× | 10,000 | Long | High leverage, large position. Wiped out almost instantly on a crash. |

### Trader Universe (Order Book)
| ID | Trader Name | Type | Currency | Initial Setup |
|----|-------------|------|----------|---------------|
| `T1` | whale_btc | Whale Long | BTCUSDT | High size, low risk |
| `T7` | perp_newbie | Retail Long | BTCUSDT | Small size, high PnL% |
| `T4` | hedger_pro | Institutional Short | BTCUSDT | Massive size, low risk |
| `T5` | short_squeeze | Degenerate Short | BTCUSDT | High leverage, doomed |

---

## 🗂️ Project Structure

```
adl-mock/
├── app.py              # Zero-dependency Python backend (http.server + background state threads)
├── index.html          # Web frontend styled with premium dark terminal theme (Tabbed layout)
├── agent.md            # LLM Agent instructions for running and maintaining this simulator
└── README.md           # Project documentation (this file)
```

---

## 🚀 Getting Started

### 1. Requirements
- Python 3.8+ (No external dependencies required)
- A modern web browser

### 2. Run the Engine
```bash
python3 app.py
```

### 3. Launch Dashboard
Open your browser and navigate to:
```
http://localhost:8000
```
*Note: On the Exchange Tab, click **Trigger Liquidation**, wait for the event log to settle, click **Drain Fund**, and finally click **Fire ADL**. Switch between tabs to see how the system reacts!*

---

## 📈 Business Logic & Methodology

### Asymmetric Settlement Pricing
The simulator proves why an exchange MUST use two different settlement prices when ADL fires:
- **The Loser (Liquidated Position)** is closed at the `bankruptPrice` (the exact price where their equity hits 0).
- **The Winner (ALP Position)** is closed at the `currentMarkPrice` (realizing their fair value profit).
Using asymmetric pricing ensures the exchange only absorbs the true loss gap (`|bankruptPrice - currentMarkPrice| × qty`). Forcing both to close at the same price creates massive synthetic math errors that break the exchange's balance sheet.

### The Ranking Flaw (Legacy vs QFEX)
Most legacy exchanges use a heuristic formula for ADL priority:
`ADL Priority = PnL% × Effective Leverage`
The simulator actively exposes the flaw in this formula: **Profit magnitude distorts systemic risk.** A small `$8,000` position can rank higher in the queue than a massive `$500,000` whale simply because it has a higher unrealized PnL percentage.

The **QFEX Method** solves this by ranking *solely* on `Effective Leverage`. ADL's core goal is systemic de-risking; therefore, positions with the highest effective leverage (highest risk contribution) must be closed first.

---

## 🎯 Use Cases
- **Risk Officers**: Quantifying exchange insolvency risks during black swan tail events.
- **Treasury Managers**: Understanding ADL risks when deploying house capital into Delta-Neutral strategies on perpetual DEXs.
- **Retail Traders**: Utilizing the Personal Position Calculator to audit live queue exposure and pip rankings.
- **Protocol Designers**: Proving the mathematical superiority of `Effective Leverage` based scoring over heuristic PnL% formulas.

---

## ⚠️ Design Decisions & Limitations
- **Mocked Volatility**: Real exchanges do not instantly step from 0 to 100% loss. The simulator uses a strict state machine (`INIT` → `LIQUIDATED` → `FUND DEPLETED` → `ADL FIRED`) to freeze the frame and let users inspect the math at each critical juncture.
- **Zero-Dependency Core**: Built purely in Python `http.server` and Vanilla JS to guarantee long-term stability without NPM rot or package deprecation.

---

## 🤝 Contact
**Gilang Fajar Wijayanto**  
Senior Treasury & Finance Operations Specialist  
📧 gilang.f@delomite.com  
🌐 [delomite.com](https://delomite.com)  
💼 [LinkedIn](https://www.linkedin.com/in/gilang-fajar-6973119a/)

**Certifications:**
- CFA Level I
- FRM Part I
- WMI & WPPE (OJK Indonesia)

---

**Built with:** Python, Vanilla JS, CSS3, HTML5  
**Designed for:** Exchange Risk Operations, Institutional Hedging, Quantitative Education

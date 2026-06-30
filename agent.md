# LLM Agent Developer Instructions: ADL Mock Simulator

This file provides system context, architectural guidelines, and codebase descriptions for AI coding assistants (like Antigravity) working on the **ADL Mock System**.

---

## 1. Stack & Architecture Overview
This project uses a client-server architecture designed to be lightweight, fast, and completely zero-dependency:
* **Backend (`app.py`):** Written in standard Python 3. It utilizes the built-in `http.server` module to host the web frontend and process REST endpoints, and `urllib.request` to poll live Binance market feeds. Multithreading is used to fetch price updates and run simulated steps in the background without blocking API endpoints.
* **Frontend (`index.html`):** Built with HTML, Vanilla JS, and Vanilla CSS. It connects to the `/api/status` endpoint once per second to draw the current simulation state, tables, logs, and queue columns.

No third-party libraries (such as Flask, FastAPI, or Node packages) should be introduced unless requested explicitly by the user, as the current configuration relies purely on native interpreters.

---

## 2. Core State Management (`app.py`)
State is protected by a thread-safe `Lock` (`state_lock`). The primary variables in `sim_state` include:
* `simStep` (integer):
  - `0`: Initialization / standard live monitoring.
  - `1`: Liquidation triggered (deficit hits Insurance Fund).
  - `2`: Insurance Fund fully drained (ADL system is armed).
  - `3`: ADL force-closes executed (loss gap covered).
* `insuranceFund` (integer): Max $2,400,000.
* `positions` (list): Simulated trader positions procedurally initialized from the active market prices.
* `logs` (list): System activity logs.

---

## 3. Mathematical Formulas

### Unrealized PnL (USD)
* **LONG:** `pnl = (currentPrice - entryPrice) * qty`
* **SHORT:** `pnl = (entryPrice - currentPrice) * qty`

### Effective Leverage
$$Effective\ Leverage = \frac{Position\ Value}{Position\ Value - |Unrealized\ PnL|}$$
* Implemented in Python as `pos["sizeUSD"] / (pos["sizeUSD"] - abs(pos["pnl"]))`.
* If the denominator drops below zero (insolvency), the value is capped at `999.0`.

### ADL Queue Score
$$ADL\ Score = PnL\ \% \times Effective\ Leverage$$
* Computed only for open, profitable positions. Negative PnL positions receive an ADL score of `0.0`.

---

## 4. Key Endpoints

* `GET /api/status`: Returns the complete `sim_state` dict in JSON.
* `POST /api/trigger-liq`: Marks trader `scalper_x` (id `T6`) as liquidated, and deducts $500,000 from the insurance fund.
* `POST /api/drain`: Spawns a background thread to drain the insurance fund to $0 (subtracting $180,000 every 120ms).
* `POST /api/fire-adl`: Spawns a thread to force-close the top opposing long positions one-by-one with a 900ms delay.
* `POST /api/reset`: Restores states and initializes positions using fresh offsets.
* `POST /api/calculate-personal`: Accepts a JSON payload of custom positions and returns computed PnL, effective leverage, and ADL scores.

---

## 5. Guidelines for Future Modifications
* **No external libraries:** Keep `app.py` dependency-free.
* **Preserve design styles:** The design elements (Space Grotesk typography, dark terminal theme, color indicators) are set inside `<style>` blocks in `index.html`. Do not remove or overwrite them during layout adjustments.
* **Keep polling clean:** Ensure the UI polling interval (`1000ms`) is maintained to prevent layout lag during animations (like the fund drain).

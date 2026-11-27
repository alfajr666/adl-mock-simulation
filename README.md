# Auto-Deleveraging: Who Bears the Loss When Liquidations Fail?

An interactive simulator that traces one liquidation shortfall through collateral, an insurance fund, and auto-deleveraging (ADL), and shows the ledger postings behind every step.

**[Open the simulator](https://alfajr666.github.io/adl-mock-simulation/)** · [Case study](https://delomite.com/work/adl-risk-simulator/) · model `adl-model-1.0.2`

It runs entirely in the browser. All positions are synthetic and prices are frozen per scenario: there is no market data, no account connection, and no server.

## The question

When a leveraged position loses more than its collateral, the remaining loss still has to land somewhere. The simulator makes that allocation inspectable for one linear USDT-margined perpetual market, in three layers:

1. The defaulted trader's collateral.
2. The insurance fund.
3. Settlement against profitable opposing positions through the ADL queue.

## The default example

A trader is short 10 units at 100 with 100 USDT of collateral. The mark jumps to 120.

| Step | Amount (USDT) |
|---|---:|
| Loss on the short | 200 |
| Absorbed by collateral | 100 |
| **Deficit** | **100** |
| Insurance fund contribution (closes 4 units at the 120 mark) | 40 |
| ADL settlement adjustment (6 units settle at the 110 bankruptcy price) | 60 |
| Residual | 0 |

The selected long still realizes a 60 USDT profit on those six units. At the 120 mark they showed 120, so it gives up 60 relative to the mark. That difference is inside the settlement price; nothing is debited a second time.

Total resources (account equity plus fund cash) are 900 USDT before and after.

## Scenarios

| Scenario | What it shows |
|---|---|
| Partial insurance | The guided default: 100 deficit = 40 insurance + 60 ADL |
| Sufficient insurance | The fund covers the deficit; ADL never fires |
| No insurance | The full 100 goes through ADL across two accounts |
| Long default | The mirrored falling-market case, same split |
| Policy comparison | Two ranking policies on one book: same 60, different payer |
| Insufficient ADL capacity | Hand-set capacity caps leave 10 USDT visibly unresolved |

## How the ledger works

Every match posts three legs: the defaulted account's realized PnL, the counterparty's realized PnL, and an offsetting clearing leg. Insurance contributions post two legs. Every event's cash postings sum to zero.

The clearing leg is zero when both sides entered at the same price. When entries differ it carries the gap: in the policy-comparison scenario the reference ADL match posts −60 to the default, +180 to candidate A (entered at 80), and −120 to clearing. After the run, the clearing balance equals the unrealized PnL still open in the book.

The 60 ADL adjustment is recorded as a memo field (`markRelativeAdjustment`) and moves no cash.

Models 1.0.0 and 1.0.1 posted the clearing leg incorrectly: ADL events did not sum to zero even though the aggregate resources check passed. Model 1.0.2 fixes this and adds a test for it.

## Ranking policies

Eligible candidates are open positions on the opposite side to the default with positive unrealized PnL and equity above maintenance. The queue is ranked once and frozen before settlement.

- **Profit-weighted reference:** unrealized PnL ÷ notional × effective leverage. Modelled on the profitable-position ranking described in exchange documentation ([Binance](https://www.binance.com/en/support/faq/detail/360033525471)).
- **Leverage-only (experimental):** effective leverage alone.

The comparison shows that a different ranking changes who bears the adjustment, not how large it is. It does not claim either policy is fairer or safer.

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Any static HTTP server works; no install is needed. Opening `index.html` from a `file://` URL shows the page but browsers block the module import, so use a server.

## Tests

```sh
npm test
```

Nine deterministic fixture tests (Node 18+, no dependencies) cover:

- the 100 = 40 + 60 waterfall, and the sufficient- and zero-insurance variants;
- long/short symmetry;
- visible capacity exhaustion;
- the policy comparison;
- replay determinism and refusal to liquidate a healthy account;
- execution of the frozen queue;
- per-event ledger balance and the clearing control balance, for every scenario under both policies.

Amounts are exact fractions on BigInt integers. Rounding happens only for display.

## What the model leaves out

- One market, one designated default, isolated single-position accounts.
- Constant 1% maintenance rate, zero fees and funding, one frozen mark per run.
- No order book, tiered margin, cross-margin, or correlated defaults.
- Settlement capacity is not derived from margin; the caps in the capacity scenario are set by hand.
- Export is download-only: a JSON file with the scenario, policy, exact postings, and invariant results. There is no import.
- Venue rules differ. [Bybit's ADL documentation](https://www.bybit.com/en/help-center/article/Auto-Deleveraging-ADL), for example, includes drawdown-based triggers, so this fund-first waterfall is not a general rule.

Results are never a live exchange rank, a trading signal, or a statement about any real account.

## Files

| File | Role |
|---|---|
| `simulator.js` | Financial engine: exact arithmetic, state transitions, matching, ledger events, invariants. No DOM dependency. |
| `index.html` | Walkthrough, position book, account inspector, queue, ledger, policy comparison, export |
| `test/simulator.test.mjs` | Fixture tests |
| `.github/workflows/pages.yml` | Runs the tests, then publishes `index.html` and `simulator.js` to GitHub Pages on pushes to `main` |
| `app.py` | Earlier Python prototype, kept for history. Not used by the simulator. |

## Deployment

GitHub Pages serves the site from the workflow above. In **Settings → Pages**, **Source** must be set to **GitHub Actions**; the workflow can also be started manually from the **Actions** tab.

---

Independent educational project by Gilang Fajar Wijayanto. It does not represent any exchange's internal state or a production risk engine.

# Crypto Surveillance Simulator: What Does the Exchange See?

An interactive simulator that puts you on an exchange's market-surveillance desk. A synthetic market is generated with wash trading and a pump-style scheme planted in it, alert rules run over the orders, trades and account data, and you can check your judgement against the answer key.

**[Open the simulator](https://alfajr666.github.io/crypto-surveillance/)** · [Case study](https://delomite.com/work/trade-surveillance-crypto-simulator/) · model `surv-model-1.2.1`

The market here is a continuous crypto spot venue with five fictional tokens over a 90-minute session. A sibling simulator runs the same engine on an equity board: [stock-surveillance](https://github.com/alfajr666/stock-surveillance).

Everything runs in the browser. All accounts, tokens, prices and trades are generated. Nothing here detects real manipulation, and an alert is a lead for a person to review, never a conclusion.

## What it teaches

1. **Alerts are leads.** A rule firing says what happened on the tape. It does not say why.
2. **Account linkage does the real work.** Wash trading is trading among accounts with one controller. Whether you see it depends on how you decide two accounts are linked.
3. **Every threshold is a trade-off.** Tighten it and you miss things. Loosen it and honest activity fills the queue.

## How it works

A small matching engine (price-time priority, limit and market orders, cancels, partial fills) produces the market from seeded agents:

- 40 retail accounts, some of which chase sharp rises;
- market makers quoting both sides;
- a **wash ring**: four accounts with different declared owners and one controller, trading among themselves;
- a **pump group**: three accounts that accumulate, push the price up, and sell into the buying that follows;
- two **designed traps**: a market maker's own sub-accounts trading with each other, and a genuine news-driven price jump;
- ordinary honest activity that can also trip alerts, such as linked honest accounts trading the same token, and unrelated users who share a trading-bot API key.

The surveillance side sees what an exchange would hold: the order and trade tape, and an account register with controlling person, funding wallet, withdrawal address, API key, device fingerprint and IP address. It never reads the answer key.

### Linking accounts

Each register attribute is classed as strong or weak evidence that two accounts are connected. Three policies turn shared attributes into groups:

| Policy | Two accounts are linked when they share |
|---|---|
| Strict | one strong attribute |
| Default | one strong attribute, or two weak ones |
| Loose | any attribute |

### Alert rules

| Rule | Fires when |
|---|---|
| W1 Self-match | one account is on both sides of a trade. A hygiene rule, scored separately. |
| W2 Linked accounts trading together | a linked group trades mostly with itself, is a large share of the instrument's volume, and ends with little net change |
| P1 Price and volume move | price and volume move far beyond the instrument's own baseline |
| P2 Group rides the move | within such a move, a linked group did much of the aggressive buying on the way up and sold afterwards |

All thresholds are adjustable on the page.

### Scoring

After you reveal the answer key, alerts are grouped into cases and each case is one of:

- **Planted episode**: found with accounts named, found diluted (fewer than half the accounts named belong to the episode), or flagged by price move only;
- **Designed trap**: the market maker's same-owner trades are labelled *explainable*. They are a wash trade in form, so the alert is expected and needs a documented explanation;
- **Unrelated**: honest activity that happened to cross the thresholds.

## What the numbers show, and what they don't

Measured over seeds 1–100 at default settings:

| | Result |
|---|---|
| Both planted episodes found with accounts named | 97 of 100 |
| Share of cases matching a planted episode, median (min–max) | 29% (14–40%) |
| Strict linkage: both found | 16 of 100 |
| Loose linkage: both found | 2 of 100 |
| Loose linkage: largest group, mean | 35.0 accounts |
| Loose linkage: pairs of honest accounts sharing a group, mean (includes the designed honest groups) | 393 |

Read these as how the rules react to a designed situation, not as detection performance.

**These planted accounts are easier to spot than real ones would be.** They can be picked out by shortcuts a real desk does not get:

- From the register alone: a default-policy group that contains both a strong link and a weak-only link identifies ring and pump accounts at precision 0.62 with full recall, against a base rate of 0.14.
- From the tape alone: an account doing at least 65% of its volume in one instrument identifies them at precision 0.99 and recall 0.87.

**What stays contrived:**

- The retail crowds that buy into the pump are scripted, so the pump group's profit is assumed, not emergent.
- Baselines come from a clean opening period that the planted activity avoids by construction.
- The ring's hub is linked to the others only through weak attributes. That is why strict linkage loses it. The model has no rule on who trades with whom, which would expose the hub without any register link.
- Most unrelated cases come from scripted trades between linked honest accounts, at a rate the scenario sets.
- The wash ring is a median 49% of its instrument's quantity. That is a design choice.

Not modelled: spoofing and layering, marking the close, insider trading, cross-venue or derivatives activity, auctions, halts, self-trade prevention, fees, and any real exchange's rules. `ENGINE.md` has the full list and every measured figure.

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Any static server works and nothing needs installing. Opening `index.html` from a `file://` URL will not work because browsers block the module imports.

## Tests

```sh
npm test          # 113 engine tests, Node 22, no dependencies
npm run seeds     # prints the 100-seed tables
npm run test:ui   # browser smoke test; needs Playwright available
```

The engine tests cover the matching engine (priority, partial fills, quantity conservation, price band), ledger and cash conservation, determinism, linkage policies, each rule against hand-built tapes with known answers, the alert-to-case mapping, a structural check that the rules cannot read the answer key, and the measured shortcuts above.

Prices and quantities are integers throughout. Floating point is used only for statistics.

## Files

| Path | Role |
|---|---|
| `engine/` | Matching engine, agents, account register, linkage, alert rules, scoring, case view. No DOM dependency. Shared with the sibling simulator, so it contains both market configurations and its tests and `ENGINE.md` cover both. |
| `ENGINE.md` | The engine's contract: API, thresholds, scenario design, measured results, limits |
| `ui/`, `index.html` | The simulator page for this market |
| `test/` | Engine tests and the browser smoke test |
| `scripts/seeds.mjs` | The multi-seed study |
| `.github/workflows/pages.yml` | Runs the tests and publishes to GitHub Pages on pushes to `main` |

## Deployment

In **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow then deploys on every push to `main`, and can be started manually from the **Actions** tab.

---

Independent educational project by Gilang Fajar Wijayanto. It does not represent any exchange's surveillance system, rules or data.

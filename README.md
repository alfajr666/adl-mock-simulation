# Auto-Deleveraging: Who Bears the Loss When Liquidations Fail?

An interactive, deterministic educational simulator for a single linear USDT-margined perpetual market.

This project shows how a liquidation shortfall moves through three layers:

1. The default trader's collateral.
2. The insurance fund.
3. Settlement with an opposing position through the modeled ADL queue.

The default walkthrough uses a small, reproducible example: a 100 USDT deficit is split into a 40 USDT insurance contribution and a 60 USDT ADL settlement adjustment. The app exposes the accounting ledger, affected quantities, position equity, and two allocation policies on identical inputs.

## Run locally

The public simulator is browser-only. No Python service, market API, account connection, package install, or network access is required.

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/` and choose a scenario. The Python `app.py` file is retained as the historical prototype; it is not the public runtime or a second source of financial truth.

Opening `index.html` directly with a `file://` URL will show the page shell but browsers block the module import, so the controls cannot run. Use the HTTP command above; the page also shows an inline diagnostic when its engine cannot load.

## Scenarios

- **Partial insurance** — the guided default: 100 deficit, 40 insurance, 60 ADL.
- **Sufficient insurance** — the deficit is fully funded, so ADL does not fire.
- **No insurance** — the complete deficit is allocated through bankruptcy-price settlement.
- **Long default** — the mirrored falling-market example.
- **Policy comparison** — reference profit-weighted ranking versus leverage-only ranking on the same snapshot.
- **Insufficient capacity** — a named synthetic capacity limit leaves a visible unresolved deficit.

## Scope and assumptions

The release models one market, one designated default, isolated single-position accounts, a constant maintenance rate, zero fees and funding, a frozen mark per run, and a fully paired synthetic opening book. It does not reproduce a production exchange's queue, cross-margin account, tiered maintenance, order-book execution, or venue-specific trigger. Exchange documentation is used as a reference for terminology and selected ranking/settlement descriptions; the project's policy comparison is explicitly experimental.

The tool never presents a result as a live exchange rank, a trading signal, or a guarantee of safety. Amounts are exact internally and rounded only for display.

## Validation

Run the deterministic financial fixtures with:

```sh
npm test
```

The tests cover the insurance waterfall, long/short symmetry, policy comparison, unresolved capacity, replay determinism, and the healthy-account guard. The specification and acceptance matrix live in Delomite at `docs/adl-simulator/`.

## Files

- `simulator.js` — exact-rational financial engine, state transitions, ledger events, invariants, and view model.
- `index.html` — accessible browser walkthrough and presentation layer.
- `test/simulator.test.mjs` — deterministic expected-value checks.
- `agent.md` — historical prototype maintenance notes; the browser engine supersedes its server instructions for the public release.
- `ADL_Mock_System_Brief*.md` — historical briefs retained for provenance.

This is an independent educational simulation. It does not represent an exchange's internal state or a production risk engine.

The **Export run** control downloads the current scenario, model version, policy, exact event postings, invariant results, and rounded presentation values as a human-readable JSON file. The export contains only synthetic scenario data.

# Certora Verification Notes

RateLoop's Certora lane lives under `packages/foundry/certora/` and is split into two practical tiers:

- `certora-check`: local compile and CVL type-check for every `.conf`. This is the drift guard that should run on PRs touching covered contracts or specs.
- `certora`: cloud prover runs for the supported matrix in `.github/workflows/certora.yaml`. It is informational until runtime and false-positive rates are stable enough to make it required.

Run the fast local gate with:

```bash
yarn foundry:certora:check
```

Run a single cloud proof manually from `packages/foundry` when `CERTORAKEY` is configured:

```bash
certoraRun certora/confs/<name>.conf --wait_for_results all
```

Current proof coverage is documented in `packages/foundry/certora/README.md`. Deferred properties and rationale live in `docs/testing/certora-followup.md` and `docs/testing/certora-security-findings.md`.

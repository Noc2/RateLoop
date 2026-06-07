# Certora formal verification

This directory holds the [Certora Prover](https://docs.certora.com/) workspace for
the RateLoop contracts. It runs from `packages/foundry` so `foundry.toml`,
`remappings.txt`, `contracts/`, and `lib/` resolve naturally.

The phased rollout, target properties, and non-goals live in
[`docs/testing/certora.md`](../../../docs/testing/certora.md). This README only
covers how to run what is wired up today.

## Layout

```text
certora/
  README.md
  confs/
    base.conf                   shared compiler + prover settings (no file targets)
    math.conf                   Phase 1: math-library harness + spec
    cluster-payout-oracle.conf  Phase 2: ClusterPayoutOracle
  harnesses/
    MathHarness.sol             external wrappers around the internal math libraries
  specs/
    Math.spec                   Phase 1 properties (conservation, bounds, monotonicity)
    ClusterPayoutOracle.spec    Phase 2 properties (verifyPayoutWeight guarantees)
```

`confs/base.conf` carries the compiler settings only. Each target conf inherits
them via an `"override_base_config": "certora/confs/base.conf"` key (the target's
own keys win on conflict), so compiler drift only has to be fixed in one place.
`certoraRun` takes a single conf file — pass the target conf, not `base.conf`.

## Prerequisites

The prover needs local tooling plus a cloud key:

```sh
python3 --version            # 3.x
java --version               # 21+
solc --version               # 0.8.35 (via solc-select)
certoraRun --version         # certora-cli
export CERTORAKEY=<personal_access_key>
```

Recommended setup if any are missing:

```sh
pip install certora-cli solc-select
solc-select install 0.8.35
solc-select use 0.8.35
# install a JDK 21+ (e.g. `brew install openjdk@21` on macOS)
```

> The harnesses also compile under plain Foundry (`forge build`), which is enough
> to catch import/signature breakage without the prover or a `CERTORAKEY`.

## Running

From `packages/foundry`:

```sh
# compile-only sanity check (no cloud run, still needs solc + certora-cli)
make certora-check

# full prover run (needs CERTORAKEY)
make certora

# target a different config
make certora CERTORA_CONF=certora/confs/math.conf

# pass extra flags through
make certora CERTORA_ARGS="--rule splitPoolConservesInput"
```

Or via yarn:

```sh
yarn workspace @rateloop/foundry certora         # full run
yarn workspace @rateloop/foundry certora:check    # compile-only
# from the repo root:
yarn foundry:certora
yarn foundry:certora:check
```

## Notes

- Remappings (including `@prb/math`) are read from `remappings.txt` automatically.
  If Certora fails to resolve an import, add the mapping under a `packages` key in
  `base.conf`.
- The Foundry build uses `via_ir = true`. certora-cli 8.13.1 only maps Yul
  optimizer steps through solc 0.8.34, so solc 0.8.35 + `via_ir` would error with
  "Yul Optimizer steps missing for requested Solidity version". 0.8.35 did not
  change the Yul optimizer, so `base.conf` passes 0.8.34's exact step string via
  `yul_optimizer_steps` — this verifies the real production solc + `via_ir` (used by
  the full-contract phases). `math.conf` overrides `solc_via_ir` to `false` since
  the pure-math harness compiles fine on the legacy pipeline and doesn't need IR.
- `make certora-check` (compile-only, no `CERTORAKEY` / no cloud) compiles the
  target and type-checks its spec. The full `make certora` run (solver proofs)
  needs `CERTORAKEY`.
- Status:
  - Phase 1 (`math.conf`) — **verified**: all `Math.spec` rules pass.
  - Phase 2 (`cluster-payout-oracle.conf`) — **verified (first slice)**: the
    `verifyPayoutWeight` safety rules pass. Lifecycle / bond / rejected-root
    properties are deferred (see `ClusterPayoutOracle.spec` header).
  - Verified under certora-cli 8.13.1 / solc 0.8.35 ("No errors found by Prover!").
- `.certora_internal/` (prover scratch output) is git-ignored.
- `RatingMath`'s logit/sigmoid paths use PRBMath `SD59x18` (`exp`/`ln`) and are out
  of scope for Phase 1; only its integer helpers are wrapped here.

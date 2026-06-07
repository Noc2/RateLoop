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
    base.conf            shared compiler + prover settings (no file targets)
    math.conf            Phase 1: math-library harness + spec
  harnesses/
    MathHarness.sol      external wrappers around the internal math libraries
  specs/
    Math.spec            Phase 1 properties (conservation, bounds, monotonicity)
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
- The Foundry build uses `via_ir = true`; `base.conf` mirrors it. `math.conf`
  overrides it to `false`: certora-cli 8.13.1 lacks the Yul optimizer step
  sequence for solc 0.8.35 + `via_ir` ("Yul Optimizer steps missing for requested
  Solidity version"). The pure-math harness compiles fine on the legacy pipeline,
  so this is safe. Phases 2–4 verify the real contracts, which need `via_ir`; that
  combination will need a certora-cli release that supports 0.8.35's IR steps (or a
  pinned older solc).
- `make certora-check` (compile-only, no `CERTORAKEY` / no cloud) passes today — it
  compiles the harness and type-checks `Math.spec`. The full `make certora` run
  (solver proofs) needs `CERTORAKEY`.
- `.certora_internal/` (prover scratch output) is git-ignored.
- `RatingMath`'s logit/sigmoid paths use PRBMath `SD59x18` (`exp`/`ln`) and are out
  of scope for Phase 1; only its integer helpers are wrapped here.

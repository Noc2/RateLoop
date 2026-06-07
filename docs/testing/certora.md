# Certora

This plan tracks a targeted Certora integration for the RateLoop smart contracts. The contracts are not deployed in production yet, so the first goal is to let formal verification shape the final pre-production contract surface without over-modeling the protocol.

## Goals

- Add a maintainable Certora workspace under the existing Foundry package.
- Prove high-value safety properties around accounting, claims, refunds, and oracle state transitions.
- Keep the first specs small enough to run and debug quickly.
- Use Certora as an additional security lane alongside Foundry tests, invariants, Slither, Aderyn, contract-size checks, and storage-layout checks.

## Non-goals

- Do not try to prove the whole protocol in one run.
- Do not encode `ClusterPayoutOracle` challenge bonds as payout-value coverage. Challenge bonds are anti-spam bonds; payout roots are optimistic and rely on public artifacts, recomputation, governance arbitration, and frontend-operator accountability.
- Do not rely on Certora's Foundry integration as the main path yet. Certora's Foundry mode is useful, but it is alpha and does not support Foundry `invariant_` tests.
- Do not try to prove off-chain scorer correctness unless the scorer is modeled separately.

## Proposed Layout

Run Certora from `packages/foundry` so `foundry.toml`, `remappings.txt`, `contracts/`, `test/`, and `lib/` resolve naturally.

```text
packages/foundry/certora/
  README.md
  confs/
    base.conf
    math.conf
    cluster-payout-oracle.conf
    round-rewards.conf
    question-reward-escrow.conf
  specs/
    Math.spec
    ClusterPayoutOracle.spec
    RoundRewards.spec
    QuestionRewardPoolEscrow.spec
  harnesses/
    *.sol
```

Each `.conf` should mirror the project compiler settings (verified against
`packages/foundry/foundry.toml` `[profile.default]`):

- `solc`: `0.8.35`
- `solc_evm_version`: `cancun`
- `solc_via_ir`: `true`
- `solc_optimize`: `100` (the optimizer-runs count; `--solc_optimize 100` on the CLI)
- remappings resolved from Foundry, or pinned explicitly if Certora needs them

Put these shared settings in `confs/base.conf` and let each target conf inherit
them via an `"override_base_config": "certora/confs/base.conf"` key (the target's
own keys win on conflict), so compiler drift only has to be fixed in one place.
`certoraRun` accepts a single conf file, so always pass the target conf — never
`base.conf` itself.

Caveat on `via_ir`: the Foundry build uses `via_ir = true`, so the base config
mirrors it for fidelity. Two wrinkles surfaced when the prover was actually run:

- certora-cli 8.13.1 only maps Yul optimizer steps through solc 0.8.34, so solc
  0.8.35 + `via_ir` errors with "Yul Optimizer steps missing for requested Solidity
  version". 0.8.35 did not change the Yul optimizer, so `base.conf` passes 0.8.34's
  exact step string via `yul_optimizer_steps` (lifted from certora-cli's
  `solc0_8_34_to_0_8_34` table). This lets the full contracts verify under the real
  production solc + `via_ir`. Revisit once certora-cli maps 0.8.35 natively.
- The pure-math harnesses do not depend on IR codegen and hit stack-too-deep on
  nothing, so `math.conf` overrides `solc_via_ir` to `false` to sidestep the issue
  entirely. The full contracts (e.g. `ClusterPayoutOracle`) genuinely need
  `via_ir` (legacy codegen hits stack-too-deep), hence the `yul_optimizer_steps`
  route above.

The three Phase 1 math libraries (`RewardMath`, `RatingMath`, `RobustBtsMath`)
expose only `internal` functions, so they cannot be verified directly. Each needs
a thin external harness contract under `certora/harnesses/` that re-exports the
target functions as `external`/`public` so CVL can call them `envfree`.

## Local Setup

Certora requires local tooling plus cloud authorization:

```sh
python3 --version
java --version
solc --version
certoraRun --version
export CERTORAKEY=<personal_access_key>
```

Current local prerequisite gap (verified 2026-06-07): `certoraRun`, `solc`, and
Java are not on PATH. `python3` (3.14.0) and Foundry (`forge` 1.5.1) are present.
This means the spec/harness/config artifacts can be authored and the harnesses
can be compile-checked with `forge build`, but the prover itself cannot be run
locally until `certora-cli`, `solc 0.8.35`, and Java 21+ are installed and a
`CERTORAKEY` is exported. CI is therefore the first place the proofs actually run.

Recommended setup:

```sh
pip install certora-cli
pip install solc-select
solc-select install 0.8.35
solc-select use 0.8.35
```

Install Java 21 or newer before running the prover.

## Phase 1: Smoke Specs For Math Libraries

Start with pure-library harnesses for:

- `contracts/libraries/RewardMath.sol`
- `contracts/libraries/RatingMath.sol`
- `contracts/libraries/RobustBtsMath.sol`

Target properties:

- pool splits conserve the input amount
- voter reward never exceeds the voter pool when effective stake is bounded by total weight
- negative score-spread forfeiture is capped by stake
- forfeiture is zero when score is at or above the mean
- ratings, score bps values, and shadow predictions remain in expected bounds
- monotonic inputs produce monotonic outputs where the protocol expects that behavior

Scope caveat for `RatingMath`: restrict Phase 1 to its pure integer helpers
(`clampRatingBps`, `displayRatingFromBps`, `evidenceRatingBps`). The logit/sigmoid
paths (`ratingBpsToLogitX18`, `logitX18ToRatingBps`, `applySettlement`) go through
PRBMath `SD59x18` `exp`/`ln`, which the prover cannot reason about precisely;
defer them or model them with summaries/`NONDET` in a later phase rather than
asserting bit-exact transcendental results.

This phase validates compiler settings, remappings, harness layout, config files, and CI wiring with minimal modeling burden.

## Phase 2: ClusterPayoutOracle

Target:

- `contracts/ClusterPayoutOracle.sol`

This is a good first state-machine target because it is security-sensitive, custom, and easier to isolate than the full voting/escrow system.

Target properties:

- only eligible frontend operators or authorized snapshot proposers can propose snapshots
- unchallenged snapshots finalize only after `challengeWindow`
- challenged snapshots require arbiter action
- rejected correlation roots cannot be re-proposed in the rejected-root path
- rejected payout roots and digests cannot be reused in the modes that explicitly blacklist them
- `verifyPayoutWeight` can return true only when:
  - caller is the pinned snapshot consumer
  - snapshot status is `Finalized`
  - parent correlation epoch is still current and finalized
  - total claim weight and weight root are nonzero
  - `independenceBps <= 10_000`
  - `effectiveWeight <= baseWeight`
  - the Merkle proof verifies for the exact payout leaf
- parent epoch rejection makes child payout snapshots unverifiable or non-finalizable
- bond credits are withdrawable once and cannot be over-withdrawn

Implementation status (`certora/specs/ClusterPayoutOracle.spec`): the
`verifyPayoutWeight` slice is **implemented and verified**. Four rules prove that a
`true` result implies the caller is the pinned consumer, the snapshot is currently
finalized (status `Finalized` + current correlation epoch, via
`isRoundPayoutSnapshotFinalized`), `independenceBps <= BPS_DENOMINATOR`, and
`effectiveWeight <= baseWeight`. These are pure view properties over arbitrary
state, so no harness or mocks are required for this slice. The remaining
properties (proposer authorization, finalization timing, rejected-root/digest
non-reuse, parent-epoch rejection cascade, single-use bond withdrawal) are the
next slice — they need state-transition rules and, for the bond path, an ERC20
model.

Modeling notes:

- Use mocks or summaries for `IFrontendRegistry` and `IRoundPayoutSnapshotConsumer`.
- Keep oracle specs focused on on-chain enforcement, not off-chain artifact correctness.
- Treat source readiness and consumption-status calls as explicit model inputs.

## Phase 3: RoundVotingEngine And RoundRewardDistributor

Targets:

- `contracts/RoundVotingEngine.sol`
- `contracts/RoundRewardDistributor.sol`

These specs should translate the strongest current Foundry invariants into CVL.

Target properties:

- round lifecycle is monotonic: terminal states do not reopen
- settled/tied/cancelled/reveal-failed rounds cannot be settled again
- cancelled, tied, and reveal-failed refunds are single-use
- refunds never exceed original stake
- reward claims are single-use by commit and voter
- aggregate claimed voter rewards do not exceed voter pool
- `transferReward` is callable only by authorized distributor paths
- `transferReward` decreases engine accounting by exactly the transferred amount
- content ratings remain bounded after settlement
- weighted UP-majority settlement cannot produce a below-neutral rating

Modeling notes:

- Expect harnesses for setup and round-state exposure.
- Summarize external identity/frontend/launch-credit calls where they are not the property under test.
- Split properties into small configs instead of one large cross-contract proof.

## Phase 4: QuestionRewardPoolEscrow Claim Slice

Target:

- `contracts/QuestionRewardPoolEscrow.sol`

Start with claim and qualification accounting. Defer full bundle semantics until the basic reward-pool proof is stable.

Target properties:

- reward-pool claimed amount never exceeds funded amount
- round snapshot claimed amount never exceeds allocation
- round snapshot claimed weight never exceeds total claim weight
- a commit can claim a question reward at most once
- cluster-backed claims bind to the pinned oracle/root/snapshot fields
- frontend fee reservation and redirection do not overdraw the pool
- rejected snapshot recovery returns allocation exactly once
- reopened recovered rounds cannot create duplicate claims against already paid allocations
- refund paths cannot bypass pending qualification or recovered-round state

Modeling notes:

- Use mocks or summaries for `RoundVotingEngine`, `IRaterIdentityRegistry`, `IClusterPayoutOracle`, and ERC20 behavior.
- Consider a harness that exposes selected internal accounting views rather than proving through the full public surface immediately.

## Scripts To Add After First Specs

Root package:

```json
"foundry:certora": "yarn workspace @rateloop/foundry certora",
"foundry:certora:check": "yarn workspace @rateloop/foundry certora:check"
```

Foundry package:

```json
"certora": "make certora",
"certora:check": "make certora-check"
```

Foundry `Makefile`:

```make
CERTORA_CONF ?= certora/confs/math.conf
CERTORA_ARGS ?=

certora:
	certoraRun $(CERTORA_CONF) $(CERTORA_ARGS)

certora-check:
	certoraRun $(CERTORA_CONF) --compilation_steps_only $(CERTORA_ARGS)
```

Also add `.certora_internal/` to the relevant `.gitignore` once Certora is first run.

## CI Plan

Add a separate `.github/workflows/certora.yaml` instead of folding Certora into existing unit or static-analysis workflows.

Initial mode:

- `workflow_dispatch`
- optional scheduled run
- no required PR gate until runtimes and false positives are understood

Later mode:

- path-filtered PR runs for changed contracts/specs
- matrix over selected `.conf` files
- nightly run for heavier configs

CI setup:

- checkout with submodules
- reuse `.github/actions/setup-foundry`
- install Python
- install Java 21
- install pinned `certora-cli`
- install/select `solc 0.8.35`
- set `CERTORAKEY` from GitHub secrets
- run `certoraRun certora/confs/<target>.conf`

## Suggested First PR Scope

Keep the first implementation PR deliberately small. As implemented on this branch
it is:

- add `packages/foundry/certora/README.md`
- add `packages/foundry/certora/confs/base.conf` (shared compiler settings)
- add `packages/foundry/certora/confs/math.conf` (inherits base, targets the math harness)
- add `packages/foundry/certora/harnesses/MathHarness.sol` (one harness re-exporting
  the `RewardMath` / `RatingMath` / `RobustBtsMath` pure helpers as external)
- add `packages/foundry/certora/specs/Math.spec` (conservation, bound, and
  monotonicity rules over the harness)
- wire `certora` / `certora:check` scripts (Makefile + `package.json`, root + foundry)
- ignore `.certora_internal/`
- add a non-gating `workflow_dispatch` CI lane (`.github/workflows/certora.yaml`)
- document how to run with `CERTORAKEY`

Phases 2–4 (ClusterPayoutOracle, RoundVotingEngine/RoundRewardDistributor,
QuestionRewardPoolEscrow) stay deferred until the math lane is green in CI, per the
"do not prove the whole protocol in one run" non-goal above.

Do not add PR-required CI until the first proof jobs are stable.


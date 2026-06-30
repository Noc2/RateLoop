# Certora formal verification

This directory holds the [Certora Prover](https://docs.certora.com/) workspace for
the RateLoop contracts. It runs from `packages/foundry` so `foundry.toml`,
`remappings.txt`, `contracts/`, and `lib/` resolve naturally.

The current formal-verification notes live in this workspace and the repo audit docs under
[`docs`](../../../docs). This README covers how to run what is wired up today.

## Layout

```text
certora/
  README.md
  confs/
    base.conf                   shared compiler + prover settings (no file targets)
    math.conf                   Phase 1: math-library harness + spec
    mul-div-lemma.conf          Track B/C: reusable (a*b)/c <= a bound (NIA)
    round-reward-distributor-conservation.conf  Track C: claimed-amount monotonicity
    cluster-payout-oracle.conf  Phase 2: ClusterPayoutOracle
    round-voting-engine.conf    Phase 3: RoundVotingEngine
    round-reward-distributor.conf  Phase 3: RoundRewardDistributor
    no-double-claim.conf        Phase 3: cross-contract no-double-claim
    round-voting-engine-lifecycle.conf  Phase 3b: refund state gates
    question-reward-escrow.conf Phase 4: QuestionRewardPoolEscrow refunded-pool gate
    launch-distribution-pool.conf  Phase 5: LaunchDistributionPool verified-bonus single-use
    frontend-registry.conf      Phase 6: FrontendRegistry stake conservation
    feedback-bonus-escrow.conf  Phase 7: FeedbackBonusEscrow conservation
  harnesses/
    MathHarness.sol             external wrappers around the internal math libraries
    RoundVotingEngineHarness.sol  exposes engine LREP accounting + round/commit state
    QuestionRewardPoolEscrowHarness.sol  exposes a reward pool's refunded flag
    FrontendRegistryHarness.sol exposes per-operator stake/operator/slashed scalars
    FeedbackBonusEscrowHarness.sol  exposes per-pool funded/remaining scalars
  specs/
    Math.spec                   Phase 1 properties (conservation, bounds, monotonicity)
    ClusterPayoutOracle.spec    Phase 2 properties (verifyPayoutWeight, non-reuse, bond)
    RoundVotingEngine.spec      Phase 3 properties (transferReward accounting/auth)
    RoundRewardDistributor.spec Phase 3 properties (claim-flag integrity)
    NoDoubleClaim.spec          Phase 3 cross-contract no-double-claim
    RoundVotingEngineLifecycle.spec  Phase 3b refund state gates
    QuestionRewardPoolEscrow.spec  Phase 4 refunded-pool claim gate
    LaunchDistributionPool.spec Phase 5 verified-bonus single-use
    FrontendRegistry.spec       Phase 6 stake conservation
    FeedbackBonusEscrow.spec    Phase 7 conservation + single-award
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
  - Phase 2 (`cluster-payout-oracle.conf`) — **verified**: `verifyPayoutWeight`
    safety, rejected-root non-reuse, and single-use bond withdrawal all pass. Full
    lifecycle monotonicity / finalization timing remain deferred (see
    `ClusterPayoutOracle.spec` header).
  - Phase 3 (`round-voting-engine.conf`) — **verified (first slice)**:
    `transferReward` decreases the engine's accounted LREP by exactly the transferred
    amount, never increases it, and rejects the zero recipient. Round lifecycle /
    refund / rating properties remain deferred.
  - Phase 3 (`round-reward-distributor.conf`) — **verified (first slice)**:
    `claimReward` never clears a recorded reward-claim flag (by voter or by commit).
    Aggregate-claimed <= pool remains deferred.
  - Phase 3 (`no-double-claim.conf`) — **verified (cross-contract)**: the same
    caller cannot claim a settled round's reward twice (the second `claimReward`
    reverts), and a successful claim records the commit flag. Spans the distributor
    (claim gate) and the engine (payout). See `NoDoubleClaim.spec` for the
    deterministic-resolution modeling note.
  - Phase 3b (`round-voting-engine-lifecycle.conf`) — **verified (refund gates)**:
    `claimCancelledRoundRefund` reverts on Open and on Settled rounds (refunds only in
    terminal-but-not-settled states). Lifecycle monotonicity and single-use refund stay
    deferred — see `RoundVotingEngineLifecycle.spec` and
    the repo audit docs for the via_ir tooling reasons.
  - Phase 4 (`question-reward-escrow.conf`) — **authored, proof deferred**: the spec
    (a refunded reward pool rejects claims) compiles and type-checks, but the solver run
    exceeds certora-cli's 15-minute no-output window on this 1,490-line + 11-library
    contract, so it is **not** in the CI matrix. Run manually with a longer prover budget.
    Per-commit no-double-claim and snapshot claimed<=allocation stay deferred
    (internal-resolution + contract size).
  - Phase 5 (`launch-distribution-pool.conf`) — **verified (first slice)**: the launch
    verified-bonus is single-use per account; a claim records the account flag. The
    per-rater paid<=cap invariant stays deferred (true but not self-inductive).
  - Phase 6 (`frontend-registry.conf`) — **verified**: no overstaking
    (stake <= STAKE_AMOUNT), single-use stake return, and exact bounded slash.
  - Phase 7 (`feedback-bonus-escrow.conf`) — **verified**: per-pool remaining <= funded
    (payouts bounded by funding), and a feedback hash is awarded at most once per pool.
  - Phase 8 (`loop-reputation.conf`) — **verified**: totalSupply <= MAX_SUPPLY, mint is
    MINTER_ROLE-gated, governance lock is governor-only, transfers respect the lock.
    (Pins `solc_via_ir=false` — ERC20Votes checkpoint function-pointers crash the prover
    under IR; the contract needs no IR.)
  - Phase 10 (`protocol-config.conf`) — **verified**: the address-book setters are
    role-gated (CONFIG / TREASURY / DEFAULT_ADMIN).
  - Phase 5b (`launch-distribution-pool-cap.conf`) — **verified (lemmas)**:
    `policyBpsBounded` + `capAssignedWhenPaid`. Headline paid<=cap deferred (nonlinear
    SMT).
  - Phase 5c (`launch-distribution-pool-conservation.conf`) — **verified**: earned-rater
    and verified-referral pool payouts never exceed their funded pools. Legacy-pool sweep
    deferred.
  - Phase 4a (`question-reward-escrow-claim.conf`) — **authored, proof deferred**: the
    claim-flag-never-cleared rule type-checks but the solver exceeds the 15-min window on
    this large contract; not in CI. Run manually with a larger budget.
  - Track B/C (`mul-div-lemma.conf`) — the reusable nonlinear bound `(a*b)/c <= a` for
    `b <= c` (enables `-smt_useNIA`). Underpins the per-claimant reward bound and the launch
    cap clamp.
  - Track C (`round-reward-distributor-conservation.conf`) — the per-round claimed-amount
    accumulators are monotone (no clawback/underflow). Full `claimed <= pool` upper bound
    deferred (needs the engine score-weight model).
  - Verified under certora-cli 8.13.1 / solc 0.8.35 ("No errors found by Prover!").
  - See the repo audit docs under [`docs`](../../../docs) for the phase plan, verification results,
    and deferral reasons.
- `.certora_internal/` (prover scratch output) is git-ignored.
- `RatingMath`'s logit/sigmoid paths use PRBMath `SD59x18` (`exp`/`ln`) and are out
  of scope for Phase 1; only its integer helpers are wrapped here.

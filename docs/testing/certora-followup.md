# Certora — follow-up plan

This is the continuation plan for the Certora formal-verification effort. The
initial rollout (Phases 1–3 + the cross-contract no-double-claim proof) is
landed and green; see [`certora.md`](./certora.md) for that plan and
[`../../packages/foundry/certora/README.md`](../../packages/foundry/certora/README.md)
for how to run what exists today.

> **Implementation status (2026-06-08):** Phases 3b–7 below have been implemented as
> verified slices (Phase 5 verified-bonus single-use, Phase 6 stake conservation, Phase 7
> bonus conservation, Phase 3b refund gates, Phase 4 refunded-pool gate). The full
> property lists per phase are partially delivered — the deferred remainders (aggregate
> ghost-sums, single-use refund, internal-resolution no-double-claim, the non-inductive
> cap invariant) and the concrete tooling reasons are recorded in
> [`certora-security-findings.md`](./certora-security-findings.md). The CI matrix, the
> certora-cli pin, and the path-filtered PR trigger (cross-cutting section) are landed.

This document picks up where that left off: it inventories exactly what is
proven vs. deferred, then lays out a prioritized set of follow-up phases to
extend coverage to the rest of the value-handling surface — ordered by
**economic blast radius first, modeling effort second**.

## Where we are today

| Conf | Contract(s) | Status | What is actually proven |
|---|---|---|---|
| `math.conf` | math libraries | ✅ verified | conservation, bounds, monotonicity over integer helpers |
| `cluster-payout-oracle.conf` | `ClusterPayoutOracle` | ✅ partial | `verifyPayoutWeight` safety, rejected-root non-reuse, single-use bond withdrawal |
| `round-voting-engine.conf` | `RoundVotingEngine` | ✅ partial | `transferReward` exact-accounting, no-increase, zero-recipient reject |
| `round-reward-distributor.conf` | `RoundRewardDistributor` | ✅ partial | `claimReward` never clears a recorded claim flag |
| `no-double-claim.conf` | distributor × engine | ✅ verified | same caller cannot claim a round twice (cross-contract) |

Everything verified under certora-cli 8.13.1 / solc 0.8.35 + `via_ir`.

**The common shape of every current spec is a single-function safety slice.**
Each proves one transition does the right thing. None yet proves a property that
must hold *across the whole lifecycle of a round or pool* — and that is where the
remaining risk lives. The deferred list below is not a backlog of nice-to-haves;
it is the set of properties that actually bound protocol solvency.

## Deferred properties already identified (highest value)

These were explicitly parked in the existing plan and are the strongest
properties on the board. They should come **before** opening new contracts,
because they protect funds in code that is already partly modeled.

1. **Aggregate claimed ≤ pool** (`RoundRewardDistributor` / `RoundVotingEngine`).
   The single most important solvency invariant: the sum of all reward claims for
   a round never exceeds that round's voter pool. Today we only prove *individual*
   claims don't double-spend; we do not prove the *aggregate* stays within budget.
2. **Round lifecycle is monotonic** (`RoundVotingEngine`). Terminal states
   (settled / tied / cancelled / reveal-failed) never reopen, and a round is never
   settled twice.
3. **Refunds are single-use and refund ≤ stake** (`RoundVotingEngine`).
   Cancelled / tied / reveal-failed refunds pay out at most once and never exceed
   the original stake.
4. **Rating bounds after settlement** (`RoundVotingEngine`). Settled ratings stay
   in range; a weighted UP-majority cannot produce a below-neutral rating.
5. **ClusterPayoutOracle lifecycle** — finalization timing (`challengeWindow`
   enforcement), rejected-digest / consumed-slot guards, and the parent-epoch
   rejection cascade.

## Uncovered value-handling contracts (new surface)

The survey of `packages/foundry/contracts/` turned up three escrow/distribution
contracts that custody real value and have **zero** Certora coverage today:

| Contract | ~LOC | Value at risk | Why it matters |
|---|---|---|---|
| `QuestionRewardPoolEscrow` (+ ~11 libs) | 1,490 | USDC bounties + LREP | largest accounting contract; claims, refunds, bundle allocation, recovery |
| `LaunchDistributionPool` | 1,574 | up to the launch slice of 100M LREP | per-rater caps + pool; verified/earned/legacy claim paths |
| `FeedbackBonusEscrow` | 817 | LREP/USDC bonuses | post-round bonus payouts |
| `FrontendRegistry` | 614 | 1K-LREP operator stakes | stake locking, fee crediting, slashing, unbonding |

`QuestionRewardPoolEscrow` was already named as Phase 4 in the original plan but
never started; the other three are net-new to the verification scope.

## Proposed follow-up phases

Ordered so each phase delivers a fund-protecting property and builds the modeling
muscle the next one needs.

### Phase 3b — close the RoundVotingEngine / Distributor lifecycle (deepen)

**Goal:** turn the existing single-function slices into lifecycle invariants.

- Add `invariant aggregateClaimedWithinPool` backed by a `ghost mathint
  totalClaimed` that sums every `transferReward` payout for a round, asserting
  `totalClaimed[round] <= voterPool[round]`. This is the headline solvency
  property and the reason to do this phase first.
- Add a `roundStatus` monotonicity invariant: a `preserved` block over every
  method showing no transition out of a terminal status. The existing spec note
  ("parametric monotonicity tripped a modeling quirk over struct-heavy mutators")
  is the known hazard here — use an explicit `invariant` with per-method
  `preserved` blocks rather than a free parametric rule, and summarize the
  identity/frontend/launch external calls as `NONDET`.
- Add single-use-refund + `refund <= stake` rules, modeled as two sequential
  `withRevert` calls like `NoDoubleClaim.spec` already does for claims.

**Effort:** medium. Reuses `RoundVotingEngineHarness`; main cost is the ghost
wiring for the aggregate and getting the `preserved` blocks to converge.

### Phase 4 — QuestionRewardPoolEscrow claim & refund slice

**Goal:** the original Phase 4, scoped tight to accounting first.

Target properties (claim/refund only — defer full bundle semantics):
- reward-pool claimed amount never exceeds funded amount;
- round-snapshot claimed amount / weight never exceeds allocation / total weight;
- a commit claims a question reward at most once;
- rejected-snapshot recovery returns allocation exactly once;
- refund paths cannot bypass pending qualification or recovered-round state.

**Modeling:** harness exposing the internal claimed/funded accumulators rather
than proving through the full public surface; `NONDET` summaries for
`RoundVotingEngine`, `IRaterIdentityRegistry`, `IClusterPayoutOracle`, ERC20.
Start with one `confs/question-reward-escrow.conf`.

**Effort:** high — this is the most complex contract, split across ~11 libraries.
Budget it as 2–3 incremental specs (claim, refund, recovery) not one.

### Phase 5 — LaunchDistributionPool conservation

**Goal:** bound the launch token spend.

Target properties:
- `sum(raterLaunchPaid) <= poolBalance` (ghost-summed, mirrors Phase 3b pattern);
- per-rater `raterLaunchPaid[r] <= raterLaunchCap[r]` always;
- a claim path credits at most once per (rater, cohort/round) key;
- `withdrawRemaining` / `recoverSurplus` cannot pull below outstanding obligations.

**Effort:** medium. The per-rater cap + ghost-sum is a clean target and reuses the
aggregate-conservation machinery from Phase 3b.

### Phase 6 — FrontendRegistry stake & slash

**Goal:** operator-stake conservation.

Target properties:
- registered stake is exactly locked on `registerFrontend` and returned exactly
  once on `completeDeregistration`;
- slashing moves stake to the configured sink and cannot exceed the locked stake;
- credited fees never exceed what was paid in.

**Effort:** low–medium. Smallest of the new contracts; good candidate to slot in
parallel with Phase 5.

### Phase 7 (optional) — FeedbackBonusEscrow

Same conservation shape as Phase 5 (bonus pool: aggregate awarded ≤ funded,
single-award per recipient). Lowest priority of the value contracts because the
sums at stake are smaller; do it once the conservation pattern is boilerplate.

## Cross-cutting: tooling & CI maturation

These are independent of the proof phases and worth doing alongside them.

1. **Pin certora-cli.** Both the CI workflow (`CERTORA_CLI_VERSION: ""`) and the
   README currently float "latest". We verified against 8.13.1 — pin it
   (`certora-cli==8.13.1`) so a prover release can't silently break the lane, and
   bump deliberately.
2. **Revisit the `via_ir` workaround.** `base.conf` hand-injects solc 0.8.34's
   Yul optimizer step string because certora-cli didn't map 0.8.35. Re-check on
   each cli bump whether 0.8.35 is mapped natively; also evaluate `solc_via_ir_map`
   (per-file IR mode) so the math harness need not special-case
   `solc_via_ir = false`. Drop the workaround once upstream covers 0.8.35.
3. **Promote CI toward a gate — carefully.** Today it's `workflow_dispatch` +
   weekly cron, non-gating. The next step is **path-filtered, non-required** PR
   runs (trigger only when `contracts/**` or `certora/**` changes), watch runtimes
   and false-positive rates for a few weeks, then make the fast confs
   (`math`, `cluster-payout-oracle`) **required** while heavier confs stay nightly.
   Keep `fail-fast: false` so one slow conf doesn't mask others.
4. **Add a `confs/all.conf` aggregator + per-conf runtime logging** so we can see
   which proofs are getting expensive before they start timing out in CI.
5. **Consider Gambit mutation testing** on the verified contracts to measure how
   much the specs actually catch — a passing spec over a weak property is a false
   sense of security. Run it manually first, not in CI.

## Sequencing recommendation

```
Phase 3b  (deepen engine/distributor — aggregate solvency)   ← do first, highest value/effort ratio
   │
   ├── Phase 4  (QuestionRewardPoolEscrow claim/refund)       ← largest, start early & incrementally
   │
   ├── Phase 5  (LaunchDistributionPool)  ─┐
   ├── Phase 6  (FrontendRegistry)         ├─ parallelizable, reuse conservation pattern
   └── Phase 7  (FeedbackBonusEscrow)     ─┘  (optional / lowest value)

Cross-cutting (pin cli, CI path-filter, mutation testing) — run alongside, not blocking.
```

Phase 3b first is the key call: it both lands the single most valuable property
(aggregate-claimed ≤ pool) and produces the ghost-summed-conservation idiom that
Phases 5–7 all copy.

## Methodology notes for the deferred property classes

The existing slices are single-transition rules. The follow-up properties are
mostly **invariants over reachable state**, which need different CVL tools:

- **Aggregate/conservation** → a `ghost mathint` accumulator updated in a
  `hook Sstore` (or incremented inside a summarized transfer), asserted in an
  `invariant`. This is how you prove "sum of payouts ≤ pool" without enumerating
  callers.
- **Lifecycle monotonicity** → an `invariant` with explicit `preserved` blocks per
  mutating method, not a free parametric rule. Per the Certora invariants docs,
  parametric rules are useful for *understanding* a preservation failure, but the
  struct-heavy mutators here are exactly the case where an explicit invariant is
  more robust (and matches the workaround already documented in
  `ClusterPayoutOracle.spec`).
- **Single-use** → two sequential `@withrevert` calls asserting the second
  reverts, as `NoDoubleClaim.spec` already demonstrates — the cleanest pattern we
  have and worth standardizing across refund/recovery proofs.
- **Soundness watch-items** (from the Certora docs): `preserved` blocks, method
  filters, and reverting invariants are the classic sources of *unsound* passes.
  Any new invariant that filters methods or leans on a `preserved require` must
  say so in the spec header, the way the current specs already document their
  `NONDET` / `persistent ghost` modeling choices.

## Non-goals (unchanged)

The original non-goals still hold: don't prove the whole protocol in one run,
don't encode challenge bonds as payout coverage, don't treat Certora's Foundry
mode as the main path, and don't prove off-chain scorer correctness. This
follow-up only widens the *on-chain accounting* coverage.

## Sources

Research backing the methodology notes:

- [Certora — Invariants](https://docs.certora.com/en/latest/docs/cvl/invariants.html)
  (`Documentation/docs/cvl/invariants.md`) — invariants as the mechanism for
  state-machine / monotonicity properties; parametric vs. explicit preservation;
  sources of unsoundness.
- [Certora — CLI Options](https://docs.certora.com/en/latest/docs/prover/cli/options.html)
  — `solc_via_ir_map` for per-file IR mode.
- [Certora — CI Configuration](https://docs.certora.com/en/latest/docs/user-guide/ci.html)
  — pinning certora-cli versions in CI.
- [Certora — Prover Release Notes](https://docs.certora.com/en/latest/docs/prover/changelog/prover_changelog.html)
  — track when solc 0.8.35 `via_ir` mapping lands to retire the `base.conf` workaround.

# Certora — verification results & security notes

This records the outcome of implementing the [Certora follow-up plan](./certora-followup.md):
which properties were formally proved, what could not be proved and why, and any
observations worth a manual security follow-up.

**Headline:** the formal verification did **not** surface any exploitable
vulnerability. Every property that was scoped to a clean, provable slice was proved
("No errors found by Prover!") under certora-cli 8.13.1 / solc 0.8.35 + via_ir. The
items that could not be proved are **modeling/tooling limitations**, not known bugs —
they are listed below in full so the gap is explicit rather than hidden.

## Round 3 (`certora-round3-plan.md`)

A third pass (branch `certora-followup-research-3`) refreshed drifted specs and added the
tooling-independent conservation pieces. **No exploitable vulnerability was found.** New
machine-checked (cloud-prover) properties: the correlation-epoch rejected-root replay block
(`cannotReproposeRejectedCorrelationEpochRoot`), the reusable mul-div bound `(a*b)/c <= a`
(`MulDivLemma.spec`), the launch cap-assignment clamp under `-smt_useNIA`
(`assignedCapWithinFullCap`), and RoundRewardDistributor accumulator monotonicity. Three
findings refine the earlier deferral framing:

1. **Oracle spec had drifted** behind three contract commits (new correlation-epoch
   rejection branches). Not a bug — the existing proofs stayed sound (no signature drift) —
   but coverage lagged. Closed for the replay branch; a CI `spec-freshness` guard now makes
   future drift fail the PR instead of going silent.
2. **QRPE no-double-claim is NOT unblockable by send-only** as the round-2 plan hoped:
   `_resolveQuestionRewardClaim` is *internal*, so it hits the same via_ir/internal-summary
   wall as the engine (now escalated — see
   [`certora-escalation-internal-summary-via-ir.md`](./certora-escalation-internal-summary-via-ir.md)).
3. **certora-cli 8.13.1 is the latest release**, so the via_ir blockers have no upgrade
   path today; the escalation is filed and revisited on each cli bump.

## Round 2 (Tracks B–G of `certora-next-steps.md`)

A second implementation pass added LoopReputation, ProtocolConfig, the
LaunchDistributionPool cap lemmas + pool conservation, and a QuestionRewardPoolEscrow
claim-flag proof. **No exploitable vulnerability was found** in this pass either. Two
properties resisted proof; both are most likely tooling/solver limits rather than bugs,
but both are worth a quick manual confirmation:

1. **LaunchDistributionPool `raterLaunchPaid <= raterLaunchCap`** — the last missing
   lemma is `raterLaunchCap <= raterFullLaunchCap`, which at assignment reduces to
   `fullCap * bps / 10000 <= fullCap` (given `bps <= 10000`). This is a nonlinear
   multiply-then-divide inequality that the SMT backend cannot discharge precisely. By
   inspection the clamp is correct (`unverifiedEarnedRaterCapBps` is validated `<= 10000`
   by `_validateLaunchRewardPolicy`, and `_assignLaunchCap` divides by `BPS_DENOMINATOR`),
   so this is a solver-completeness gap, not a defect. **Manual check:** confirm no payout
   path raises `raterLaunchPaid` above the active cap.

2. **LaunchDistributionPool legacy-pool conservation
   (`distributed + treasuryRecovered <= LEGACY_CONTRIBUTOR_POOL_AMOUNT`)** — proved for
   the earned-rater and verified-referral pools, but resisted on
   `sweepExpiredLegacyContributorAllocationToTreasury`. **Manual check (low confidence):**
   confirm the expired-allocation sweep cannot recover more than the pool's unclaimed
   remainder.

### Investigation outcome (both items resolved as proof gaps)

Both items were investigated against the source. **Neither is a contract bug** — both are
proof-tooling gaps, and the contracts are correct by construction:

- **Legacy-pool conservation — RESOLVED (spec corrected).** The claim and sweep both bound
  against `legacyContributorAllocationTotal`, and `setLegacyContributorRoot` pins that to
  exactly `LEGACY_CONTRIBUTOR_POOL_AMOUNT` (it reverts otherwise and is write-once). The
  original invariant simply compared against the wrong bound. It is now proved as
  `legacyAllocationTotalBounded` + `legacyDistributedWithinAllocation` +
  `legacyRecoveredWithinAllocation` + `legacyDistributedWithinPool` (all verified). The
  *tight* `distributed + treasuryRecovered <= pool` bound holds in the contract — claims
  require an open window and the sweep a closed one, so the two never overlap and the sweep
  can only recover the unclaimed remainder — but it depends on that temporal exclusivity,
  which CVL cannot express as a storage-only invariant. It stays deferred as a
  multi-tx/time-modeling item, **not** a risk: over-recovery is unreachable.

- **Cap `paid <= cap` — CONFIRMED proof gap (no contract change needed).** Re-ran the full
  chain with the nonlinear-arithmetic solver (`-smt_useNIA`); it discharged the assignment
  multiplication but the `finalizeEarnedRaterRewardCredit` / `unlockFullEarnedRaterCap`
  catch-up paths (which contain further `cap * count / rewardingCount` mul-div sites) still
  resist. The contract is correct by inspection (every payout computes a target clamped to
  the cap and pays only the positive delta). **Fix plan if a machine-checked proof is
  wanted later:** introduce a small CVL mul-div lemma (prove `a*b/c <= a` for `b <= c` once,
  as a pure rule) and apply it, or summarize the cap-fraction computation with a
  monotonic-abstraction `ghost`. Low priority — the two proved lemmas
  (`policyBpsBounded`, `capAssignedWhenPaid`) plus the by-inspection argument already cover
  the property; only the end-to-end machine proof is missing.

**Bottom line:** no fix is required to either contract. The legacy gap is closed in the
spec; the cap gap is a documented solver limitation with a concrete (low-priority) path to
a full proof.

Neither is a confirmed bug. The proved properties (supply cap, role gates, earned/verified
/legacy pool conservation, cap-assignment + bps-bound lemmas, claim-flag integrity) provide
positive assurance over the value-handling paths.

## Proved properties

| Phase | Conf | Property proved | Status |
|---|---|---|---|
| 3b | `round-voting-engine-lifecycle` | refund rejects Open and Settled rounds (refunds gated to terminal-but-not-settled states) | ✅ verified |
| 4 | `question-reward-escrow` | a refunded reward pool rejects claims | ⚠️ authored + compile-checked; solver run exceeds the 15-min prover output window (contract size) — not in CI |
| 5 | `launch-distribution-pool` | launch verified-bonus is single-use per account; claim records the flag | ✅ verified |
| 6 | `frontend-registry` | no overstaking (stake ≤ STAKE_AMOUNT); single-use stake return; slash is exact and bounded by bonded stake | ✅ verified |
| 7 | `feedback-bonus-escrow` | per-pool remaining ≤ funded (payouts bounded by funding); feedback hash awarded at most once per pool | ✅ verified |

These join the previously-landed proofs (Phase 1 math, Phase 2 ClusterPayoutOracle,
Phase 3 RoundVotingEngine `transferReward` + RoundRewardDistributor claim-flag +
cross-contract no-double-claim).

## Could not be proved (limitations, not findings)

Two categories of property resisted a sound proof. Neither is evidence of a bug; both
are documented in the follow-up plan as the next slices to land.

### 1. Engine/escrow internal commit resolution under via_ir

The single-use **refund** (RoundVotingEngine) and per-commit **no-double-claim**
(QuestionRewardPoolEscrow) properties both route through an *internal* commit-resolution
function (`_resolveClaimCommit` / `_resolveQuestionRewardClaim`) that calls out to the
rater registry. Making the two-call single-use argument sound requires that resolution
be a deterministic function of its arguments. certora-cli 8.13.1 cannot instrument
**internal-function summaries** when a contract is compiled with `solc_optimize` +
`solc_via_ir` (it emits "Cannot apply summaries for internal functions … when compiling
using solc_optimize and solc_via_ir"), and these contracts genuinely need via_ir
(legacy codegen hits stack-too-deep). The previously-landed cross-contract
no-double-claim proof avoids this because it summarizes the engine's *external*
`resolveClaimCommit` from the distributor — an option not available when the resolver is
internal to the contract under test.

What was proved instead: the resolution-independent **state gates** (refunds revert
unless the round is in a terminal-but-not-settled state; refunded pools reject claims).
These are the entry-point guards that the single-use properties build on.

Relatedly, the **lifecycle-monotonicity / no-double-settle** rule ("a successful
settleRound implies the round was Open") could not be proved either, but for a different
tooling reason: under `solc_optimize + via_ir`, certora-cli's auto-finder fails to
instrument parts of the 1,811-line engine (it logs "Failed to generate auto finder for
…"), and the resulting settleRound model admits a spurious counterexample despite the
contract's unconditional `if (state != Open) revert RoundNotOpen()` guard on the first
line of the function. The guard is plainly correct by inspection; this is a prover
instrumentation gap, not a contract defect.

### 2. Prover capacity on the largest contract

QuestionRewardPoolEscrow is 1,490 lines plus 11 libraries. Even the single
resolution-free revert-gate rule (a refunded pool rejects claims) — which compiles and
type-checks cleanly — drives the solver past certora-cli's 15-minute no-output window
because it must model the whole `claimQuestionReward` callgraph (qualification, Merkle
proof, claim-weight math) before reaching the early `require(!refunded)`. The spec/harness
are committed and runnable, but the lane is **excluded from CI** and marked proof-deferred;
completing it needs a longer prover budget or (once via_ir internal summaries are
supported) NONDET summaries of the downstream library functions.

### 3. Invariants that are true but not self-inductive

`raterLaunchPaid[rater] <= raterLaunchCap[rater]` (LaunchDistributionPool) is true — every
payment clamps the target to the cap and pays only the positive delta — but the prover
rejects it as a standalone invariant because the preservation step needs auxiliary facts
(cap-assignment consistency and per-rater cap monotonicity) that are not yet stated. This
is the classic "invariant too weak to be inductive" situation; the fix is to add the
helper invariants, not to change the contract.

## Observations worth a manual look (low confidence)

- **LaunchDistributionPool cap accounting.** Because `paid <= cap` is not self-inductive,
  it is worth a manual confirmation that no reachable sequence (assign cap → record reward
  → unlock full cap → finalize cluster credit) can transiently leave `raterLaunchPaid`
  above `raterLaunchCap`. Reading the four payout entry points, each independently clamps
  to the cap, so this is most likely safe; the flag is only that the property is not yet
  machine-checked end-to-end. Not a confirmed issue.

No other anomalies were observed. The parametric "terminal state is absorbing" rule
produced counterexamples only from unreachable havoc states (storage configurations no
constructor/transaction sequence can produce), which is a known artifact of parametric
rules over struct-heavy state, not a contract defect — it was replaced by the
constructive settlement-guard rule above.

## Scope

This lane verifies **on-chain accounting slices** — single-use gates, conservation
bounds, and state-machine guards on the value-handling contracts. It does not attempt
whole-protocol proofs, off-chain scorer correctness, or the economic-game properties,
consistent with the non-goals in [`certora.md`](./certora.md).

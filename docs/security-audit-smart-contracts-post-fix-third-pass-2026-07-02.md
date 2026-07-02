# Smart Contract Security Audit - Post-fix Third Pass - 2026-07-02

## Scope

This pass reviewed `main` at `30f7e788d` after the second post-fix audit and
the subsequent smart contract hardening commits:

- `d05dd8dbe contracts: harden recovered reward refunds`
- `30f7e788d contracts: enforce rating snapshot order`

The review assumes the next production rollout is a fresh redeploy and rewire:
old contracts, old proxy storage, and old live contract state will not continue
to be used. Findings that only affect a hot upgrade from old state are therefore
listed as redeploy-scoped notes rather than current findings.

No Solidity or test fixes were made in this pass. The only intended output is
this findings document.

The review used the project trust model in `AGENTS.md`: cluster payout roots
are optimistic and challengeable, challenge bonds are anti-spam bonds, and the
configured 60-minute `revealGracePeriod` is an accepted product/security
parameter.

## Methodology

- Manual review of recent diffs and the affected contract paths.
- Three parallel read-only reviewers focused on recovered reward-pool exits,
  public-rating snapshot ordering, and cluster payout oracle consumers.
- Static-analysis reruns from `packages/foundry`.
- Focused source comparison between consumer paths that already wait out the
  oracle finalization veto window and consumer paths that do not.
- External reference check against the official Solidity security guidance on
  gas limits and loops:
  <https://docs.soliditylang.org/en/latest/security-considerations.html#gas-limit-and-loops>.

## Summary

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| SC-3P-2026-07-02-1 | High | Cluster payout oracle consumers | New finding |
| SC-3P-2026-07-02-2 | Medium | Recovered reward-pool replacement snapshots | New finding |
| SC-3P-2026-07-02-3 | Medium | Public rating snapshot cursor | New finding |

## Findings

### SC-3P-2026-07-02-1: Question and bundle rewards can consume finalized payout roots during the oracle veto window

**Severity:** High

**Affected code:**

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
- `packages/foundry/contracts/ClusterPayoutOracle.sol`

**Issue:**

The public-rating and RBTS settlement consumers both wait until the cluster
payout oracle's finalized-snapshot veto window has elapsed before consuming a
finalized root:

- `ContentRegistryRatingSnapshotLib._validatedSnapshot` rejects a finalized
  public-rating snapshot while
  `block.timestamp <= finalizedAt + FINALIZATION_VETO_WINDOW`
  (`ContentRegistryRatingSnapshotLib.sol:303-313`).
- `RoundRbtsSettlementSnapshotLib.applySnapshotWeights` applies the same wait
  before accepting RBTS settlement weights
  (`RoundRbtsSettlementSnapshotLib.sol:49-54`).

The question reward path does not apply that same readiness rule on the
state-changing qualification path. `qualifyRoundWithClusterSnapshot` accepts
whatever `_finalizedQuestionPayoutSnapshot` returns
(`QuestionRewardPoolEscrowQualificationLib.sol:320-328`). That helper checks
that the snapshot status is `Finalized`, that the consumer matches, and that the
source was ready and pinned, but it does not check `finalizedAt` against the
oracle veto window (`QuestionRewardPoolEscrowQualificationLib.sol:799-822`).

The bundle reward path has the same issue. `_finalizedBundlePayoutSnapshot`
marks a snapshot ready when it is `Finalized`, has the expected root/claim
metadata, has the right consumer, and was proposed after the pinned/source-ready
times (`QuestionRewardPoolEscrowBundleActionsLib.sol:1668-1710`). It does not
wait out the veto window before `_qualifyBundleRoundSet` consumes the snapshot
(`QuestionRewardPoolEscrowBundleActionsLib.sol:1091-1115`).

Both libraries contain `_finalizedSnapshotWithinVetoWindow` helpers, but those
helpers are only used to delay certain "snapshot not good enough" reset paths
(`QuestionRewardPoolEscrowQualificationLib.sol:525-551` and
`QuestionRewardPoolEscrowBundleActionsLib.sol:1118-1126`). A snapshot with
enough effective participants and claim weight can still qualify immediately
inside the veto window.

After qualification, the first successful claim marks the snapshot as consumed:

- Question reward claims set `roundSnapshots[rewardPoolId][roundId].firstClaimPaid`
  (`QuestionRewardPoolEscrow.sol:606-619`).
- Bundle reward claims set
  `bundleRoundSetSnapshots[bundleId][roundSetIndex].firstClaimPaid`
  (`QuestionRewardPoolEscrowBundleActionsLib.sol:578-588`).

`QuestionRewardPoolEscrowSnapshotConsumerLib.isConsumed` reports those flags to
the oracle (`QuestionRewardPoolEscrowSnapshotConsumerLib.sol:107-123` and
`165-180`). The oracle's finalized-rejection path then rejects arbiter action if
the consumer reports the snapshot consumed
(`ClusterPayoutOracle.sol:645-692`).

**Impact:**

A globally bonded frontend operator can finalize an incorrect question or bundle
reward payout root, then immediately qualify and claim against it before the
oracle veto window has elapsed. Once the first claim is paid, the oracle's
`rejectFinalizedRoundPayoutSnapshot` path can no longer reject that root through
the normal finalized-snapshot remediation flow. The practical effect is that the
consumer path short-circuits the intended arbiter veto window for reward roots.

This matters under a fresh redeploy because it is current consumer behavior, not
legacy state.

**Recommendation:**

Centralize a "finalized and veto window elapsed" readiness helper for cluster
payout roots and use it consistently before any consumer can qualify, reopen as
ready, claim from, or otherwise consume a root.

At minimum:

- In `_finalizedQuestionPayoutSnapshot`, require
  `block.timestamp > payoutSnapshot.finalizedAt + oracle.FINALIZATION_VETO_WINDOW()`.
- In `_finalizedBundlePayoutSnapshot`, only set `ready = true` after the same
  veto-window check passes.
- Review `reopenRecoveredSnapshotRound` so a recovered round is not treated as
  replacement-ready before the replacement root is outside the veto window.
- Add regressions where a finalized reward root inside the veto window cannot
  qualify or be claim-consumed, but can qualify after the veto window elapses.

### SC-3P-2026-07-02-2: A recovered replacement snapshot can be abandoned before reopen marks the fresh grace window

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`

**Issue:**

The latest recovered-round fix correctly refreshes `claimDeadline` after
`reopenRecoveredSnapshotRound` succeeds
(`QuestionRewardPoolEscrowRecoveryLib.sol:268-274`). Once
`reopenedRecoveredRound[rewardPoolId][roundId]` is set, abandoned recovered
rounds also pass through `_requireRecoveredRefundGrace`
(`QuestionRewardPoolEscrowPoolActionsLib.sol:446-451`).

The remaining race is before `reopenRecoveredSnapshotRound` lands.

`refundExpiredRecoveredRewardPool` checks only the pool's existing
`claimDeadline + claimGrace`, then abandons all supplied recovered rounds
(`QuestionRewardPoolEscrowPoolActionsLib.sol:180-196`). Inside
`_abandonRecoveredRounds`, the extra fresh-grace check only runs if
`reopenedRecoveredRound[rewardPoolId][roundId]` is already true
(`QuestionRewardPoolEscrowPoolActionsLib.sol:446-451`).

That means a replacement snapshot can be finalized after the old claim grace has
already elapsed, but before anyone calls `reopenRecoveredSnapshotRound`. During
that interval, any caller can call `refundExpiredRecoveredRewardPool` with the
recovered round id. Because the round is not yet marked reopened, the refund
path deletes the parked allocation and clears the recovered latch without
checking that a valid replacement root is already available.

The inactive-content recovered refund has the same shape: it can abandon a
recovered round without checking for an available replacement root unless the
round was already marked reopened
(`QuestionRewardPoolEscrowPoolActionsLib.sol:220-238`).

**Impact:**

Claimants can lose the replacement-qualification opportunity for a recovered
round even though a replacement root has finalized. The failure mode is a
liveness/custody race between "someone reopens the recovered round" and
"someone refunds the recovered pool" after the original claim grace has elapsed.

This remains relevant under a fresh redeploy because it is introduced by the new
recovered-refund control flow, not by old state.

**Recommendation:**

Make recovered-round abandonment prove that no valid replacement is currently
ready, or require callers to explicitly process the replacement first.

Reasonable fix options:

- In recovered refund paths, check the pinned oracle for a finalized,
  unrejected replacement snapshot for each recovered round and revert with a
  "replacement available" error if one exists.
- Or, automatically mark the round reopened and start the fresh grace window
  when the refund path sees a valid replacement.
- Apply the same rule to both expired and inactive recovered refund paths.
- Add a regression where the original claim grace has elapsed, a replacement
  root is finalized, no reopen call has landed yet, and recovered refund cannot
  abandon the round before the fresh replacement path is honored.

### SC-3P-2026-07-02-3: Public rating snapshot cursor can gas-DoS on many skipped terminal rounds

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
- `packages/foundry/contracts/ContentRegistry.sol`

**Issue:**

The new public-rating snapshot cursor enforces round-order application by
advancing `nextRatingSnapshotRoundId[contentId]` before applying a later pending
rating snapshot (`ContentRegistryRatingSnapshotLib.sol:180-191`). To skip
earlier rounds that do not need rating snapshots, `_advanceRatingSnapshotCursor`
loops from the current expected round to the requested round
(`ContentRegistryRatingSnapshotLib.sol:225-255`). For each skipped round without
a pending settlement record, it performs an external `roundCore` read and allows
only `Cancelled`, `Tied`, `RevealFailed`, or already-applied `Settled` rounds to
be skipped (`ContentRegistryRatingSnapshotLib.sol:239-260`).

This makes the first later rating snapshot after a long run of skipped terminal
rounds pay for every skipped round in one transaction. If enough cancelled,
tied, or reveal-failed rounds accumulate before the next settled round with a
public-rating snapshot, applying that later snapshot can exceed the block gas
limit. Because the cursor update and the snapshot application are part of the
same transaction, a gas failure reverts the cursor progress, so retrying the
same application does not make incremental progress.

The official Solidity security guidance warns that loops whose iteration count
depends on storage can grow beyond the block gas limit and stall contract
actions. This cursor has exactly that storage-dependent shape.

**Impact:**

A content item can become unable to apply a later valid public-rating snapshot
if it has accumulated enough skipped terminal rounds. That can freeze future
rating updates, conservative rating state, and any downstream logic that depends
on applied public-rating snapshots for that content.

This is current behavior after a fresh redeploy. It does not depend on old
storage.

**Recommendation:**

Make cursor advancement bounded and externally progressable.

Options:

- Add a public `advanceRatingSnapshotCursor(contentId, maxRounds)` function that
  advances through skipped rounds in bounded batches.
- Or cap `_advanceRatingSnapshotCursor` to a fixed maximum and require callers
  to advance the cursor separately before applying a far-later snapshot.
- Ensure cursor progress is committed independently from snapshot application
  so one oversized application attempt does not revert all skipped-round
  progress.
- Add a regression that creates a large run of no-rating terminal rounds,
  advances the cursor in batches, and then applies the later settled snapshot.

## Conditional Notes and Reviewed Non-findings

### Registry-only engine rotation can still block public-rating cursor progress

This is not counted as a current finding under the requested fresh-redeploy
assumption and the `AGENTS.md` governance note that engine migration should be a
coordinated replacement-stack runbook, not a registry-only `setVotingEngine`
action.

If governance ever preserves `ContentRegistry`/content state while rotating only
the voting engine, the rating cursor can consult the wrong engine for old
rounds. `ContentRegistry.setVotingEngine` changes the canonical engine
(`ContentRegistry.sol:376-389`), while `reserveNextVotingRound` preserves
per-content round numbering (`ContentRegistry.sol:1343-1360`). The new cursor
uses the pending settlement's engine for the requested round, but it also asks
that same engine for prior skipped rounds in `_advanceRatingSnapshotCursor`
(`ContentRegistryRatingSnapshotLib.sol:182-190` and `239-245`). If round 1 was
terminal without a pending settlement on engine A and round 2 settles on engine
B, applying round 2 can ask engine B for round 1, see default/open data, and
block.

The safe operational answer remains: do not perform a registry-only engine
rotation for live state. Redeploy and rewire the replacement stack as already
documented.

### Repeated recovered-round reopen grace refresh did not reproduce for fresh one-round pools

One reviewer flagged a possible repeatable call to
`reopenRecoveredSnapshotRound` refreshing `claimDeadline` indefinitely. I do
not consider it a current finding for fresh deployments. New reward pools are
constrained to `requiredSettledRounds == 1`
(`QuestionRewardPoolEscrowPoolActionsLib.sol:332-356`), and the first reopen of
the recovered round rewinds `nextRoundToEvaluate` when the cursor is exactly one
past the recovered round (`QuestionRewardPoolEscrowRecoveryLib.sol:246-270`).
That makes a repeat reopen of the same fresh one-round pool fail the
`roundId < rewardPool.nextRoundToEvaluate` precondition.

### Legacy multi-round reward-pool refund concerns are out of scope for the redeploy

The previous audit documented a legacy multi-round recovered refund concern.
That is not a current fresh-deploy finding because new reward pools require
`requiredSettledRounds == 1`
(`QuestionRewardPoolEscrowPoolActionsLib.sol:349`). If legacy state will not be
used in any way, there is no multi-round stored pool to migrate through the new
refund path.

### Hot-upgrade storage-layout concerns are out of scope for the redeploy

The previous audit documented storage-layout risk for hot upgrades from a
populated pre-RBTS `RoundVotingEngine` proxy. That remains an important future
upgrade hygiene rule, but it is out of scope for the requested fresh redeploy
where old contract state is not reused.

### Static-analysis output

`slither . --config-file slither.config.json` exited nonzero with
`uninitialized-state` and `constable-states` findings on
`RoundVotingEngineStorage` fields as seen through the module/delegatecall
storage pattern. I treated those as known storage-base noise and did not promote
them to new findings.

`aderyn .` generated `report.md`, then crashed on this macOS environment with a
fatal `system-configuration` / `dynamic_store.rs` internal error. I treated that
run as inconclusive static-analysis evidence rather than a clean pass.

## Recommended Fix Plan

1. Fix SC-3P-2026-07-02-1 first. Gate every reward-root consumer path on
   `finalizedAt + FINALIZATION_VETO_WINDOW` before qualification, recovered
   reopen readiness, or claim-consumption can occur. Add question and bundle
   regressions for inside-window rejection and after-window success.
2. Fix SC-3P-2026-07-02-2 next. Make recovered refunds detect an available
   replacement root and either revert or open the fresh replacement grace window
   instead of abandoning it. Cover both expired and inactive refund paths.
3. Fix SC-3P-2026-07-02-3 by adding bounded, independently progressable
   public-rating cursor advancement. Add a large skipped-round regression.
4. Keep the engine-rotation note as a governance/runbook constraint rather than
   a Solidity fix unless future product requirements explicitly support
   preserving content state across a registry-only engine rotation.

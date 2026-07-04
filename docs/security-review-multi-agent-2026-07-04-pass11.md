# RateLoop Smart Contract Security Review - Multi-Agent Pass 11

Date: 2026-07-04
Base revision reviewed: `053b4c482` on `main`
Scope: `packages/foundry/contracts`
Status: 0 critical/high findings; 1 new low finding

No code remediation is included in this report commit. This pass was run after
the pass 10 fixes landed in:

- `b0e3b72f2` - `fix: block reward pool repoint during recovery`
- `053b4c482` - `fix: allow bundle repoint after rejected snapshots`

## Methodology

- Ran three read-only reviewer passes in parallel:
  - `QuestionRewardPoolEscrow`, reward-pool recovery, oracle repoint,
    pre-qualification rejected-snapshot skipping, bundle recovery, bundle
    refund, and cursor/refund liveness paths.
  - `FeedbackBonusEscrow`, `FeedbackRegistry`, `RoundVotingEngine`, RBTS
    settlement, pause/unpause, refund, award, identity, and confidentiality
    bond paths.
  - `ClusterPayoutOracle`, `ProtocolConfig`, `FrontendRegistry`,
    `ContentRegistry`, `RaterRegistry`, `RateLoopGovernor`,
    `LaunchDistributionPool`, X402/EIP-3009, and deployment/config paths.
- Rechecked returned leads against current source before inclusion.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
  - `docs/security-review-multi-agent-2026-07-04-pass4.md`
  - `docs/security-review-multi-agent-2026-07-04-pass5.md`
  - `docs/security-review-multi-agent-2026-07-04-pass6.md`
  - `docs/security-review-multi-agent-2026-07-04-pass7.md`
  - `docs/security-review-multi-agent-2026-07-04-pass8.md`
  - `docs/security-review-multi-agent-2026-07-04-pass9.md`
  - `docs/security-review-multi-agent-2026-07-04-pass10.md`
- Ran static-analysis triage:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: 0 results.
  - `yarn foundry:aderyn` from the repository root was blocked by the local
    Xcode license prompt.
  - `aderyn .` from `packages/foundry` generated a report with 0 high issues
    and 23 low/static-hygiene buckets, then Aderyn 0.6.8 crashed in its macOS
    system-configuration/network shutdown path. The generated low buckets were
    reviewed as checklist input and not promoted into additional findings.
- Ran focused validation:
  - `forge test --match-path test/QuestionRewardPoolEscrow.t.sol --match-test 'test(RepointRewardPoolOracleRejectsPendingRecoveredRound|RepointRewardPoolOracleRejectsPriorLiveSnapshotForCurrentRound|RepointRewardPoolOracleAllowsPriorRejectedSnapshotForCurrentRound|GovernanceCanRepointQuestionBundleClusterOracleAfterRejectedSnapshot|GovernanceCannotRepointQuestionBundleClusterOracleWithExistingSnapshot)' -vv`:
    5 passed.
  - `forge test --match-path test/FeedbackBonusEscrow.t.sol --match-test 'test(UnpauseReopensMinimumAwardWindow|RepeatedPausePreservesReopenedAwardWindow|ZeroRevealFailedRoundBonusRefundsFunder|RevealPresentRevealFailedRoundBonusCanAwardThenForfeitRemainder)' -vv`:
    4 passed.
  - `forge test --match-path test/ConfidentialityEscrow.t.sol --match-test 'test(EmptyOpenRoundKeepsBondLockedWhileContentActive|ReleaseBondBlocksMaturedBondWhilePaused|BondedEmptyOpenRoundKeepsReleasableBondLockedUntilCancelled)' -vv`:
    3 passed.
  - `bash scripts/check-storage-layouts.sh`: passed.

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL11-01 | Low | Question reward pool and bundle oracle repoint | Repointing back to an oracle with an old rejected pre-qualification snapshot can make the snapshot neither rejected-skippable nor snapshotless-skippable. |

## RL11-01: Stale Rejected Snapshots Can Become Unskippable After Oracle Repoint

Severity: Low

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
  - `repoint` allows a candidate single-question oracle when the target
    snapshot exists but is not live, then resets
    `rewardPoolClusterPayoutOraclePinnedAt` at lines 41-50.
  - `repointBundle` applies the same status-aware live-snapshot check to the
    bundle synthetic round and then resets
    `bundleRewardClusterPayoutOraclePinnedAt` at lines 74-82.
  - `_requireNoLiveRoundPayoutSnapshot` treats only `Proposed`, `Challenged`,
    and `Finalized` as blocking at lines 102-122.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
  - `skipPreQualificationRejectedSnapshotRound` requires the rejected
    snapshot's `proposedAt` to be at least the current oracle pin time at
    lines 84-100.
  - `skipPreQualificationSnapshotlessClusterRound` requires no oracle proposal
    to exist for the cursor round at lines 161-169.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
  - bundle rejected/missing snapshot handling has the same `proposedAt >=
    pinnedAt` requirement at lines 570-593.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
  and `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
  - expired unallocated reward-pool refunds still require the finished cursor
    round to be qualified or skipped first.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
  - bundle refund treats an unresolved cluster payout snapshot as pending
    before refunding.

The pass 10 fix correctly made repoint preflights status-aware: a rejected
snapshot is no longer treated as a live payout root that must permanently block
returning to a prior oracle. The follow-on edge is that repointing also updates
the oracle pin timestamp. If the rejected snapshot was proposed before the
fresh pin time, the later recovery/skip code cannot consume it as a rejected
snapshot, while the snapshotless skip path cannot be used because the oracle
still records a nonzero proposal timestamp.

Single-question scenario:

1. A cluster-backed reward pool is pinned to oracle A.
2. The current pre-qualification cursor round receives an oracle A payout
   snapshot.
3. That snapshot is rejected.
4. Governance repoints the pool from oracle A to oracle B.
5. Governance later repoints back from oracle B to oracle A.
6. The second repoint succeeds because the oracle A snapshot is `Rejected`, not
   `Proposed`, `Challenged`, or `Finalized`, and the pool pin time is refreshed.
7. `skipPreQualificationRejectedSnapshotRound` now reverts with
   `"Cluster source stale"` because the old rejected snapshot was proposed
   before the new pin time.
8. `skipPreQualificationSnapshotlessClusterRound` also reverts with
   `"Oracle snapshot exists"` because the old proposal timestamp remains
   nonzero.
9. Expired unallocated refund remains blocked until the cursor advances.

Bundle scenario:

1. A cluster-backed question bundle is pinned to oracle A.
2. The bundle's synthetic pre-qualification snapshot round receives an oracle A
   payout snapshot.
3. That snapshot is rejected.
4. Governance repoints the bundle from oracle A to oracle B, then later back to
   oracle A.
5. The second repoint succeeds for the same reason: the A snapshot is rejected,
   not live.
6. `skipPreQualificationRejectedSnapshotBundleRoundSet` now reaches the
   rejected snapshot path and reverts with `"Cluster source stale"` because the
   rejected proposal predates the fresh pin time.
7. Bundle refund continues to treat the unresolved bundle round-set
   qualification as pending.

This is not a theft path and requires governance/admin repointing. It is a
liveness and operator-surprise issue: a repoint preflight can approve a prior
oracle state that the cursor-recovery and refund paths cannot then consume.
Governance can still recover by repointing to a clean oracle or by obtaining a
fresh replacement proposal after the new pin time.

Recommendation:

- Choose one explicit policy for stale rejected snapshots during repoint:
  - Reject the repoint if the candidate oracle has any rejected target snapshot
    whose `proposedAt` is older than the new pin time and would have to be
    consumed by skip/recovery; or
  - Preserve a repoint-safe way to consume rejected snapshots that were already
    present on the candidate oracle before the fresh pin time.
- Add single-question and bundle regressions for the A -> B -> A rejected
  pre-qualification snapshot cycle. The tests should prove that after the final
  repoint the cursor can be skipped/refunded, or that the final repoint is
  intentionally rejected with a clear reason.

## False Positives And Non-Findings Checked

- The pass 10 recovered-round repoint fix remains effective for pending
  recovered single-question rounds. The focused
  `testRepointRewardPoolOracleRejectsPendingRecoveredRound` regression passed.
- The pass 10 live-snapshot repoint fix remains effective for current
  single-question and bundle target rounds. The focused tests for live
  snapshots and rejected snapshots passed, while also confirming that the
  current suite stops at repoint success and does not cover the post-repoint
  skip/refund edge described in RL11-01.
- The pass 9 feedback-bonus pause/deadline fixes still preserve reopened award
  windows across repeated pauses, and the pass 7 zero-reveal refund behavior is
  still covered by focused tests.
- Confidentiality bonds remain locked for active empty-open rounds and paused
  release paths continue to block matured bonds.
- No new confirmed issues were found in the feedback publication, RBTS
  settlement, identity/access/custody, X402/EIP-3009, public rating snapshot,
  `ProtocolConfig`, `FrontendRegistry`, `ClusterPayoutOracle`,
  `RateLoopGovernor`, `RaterRegistry`, `ContentRegistry`, or
  `LaunchDistributionPool` slices.
- Slither reported no findings. Aderyn's generated report remained limited to
  broad low/static-hygiene categories after manual triage.

## Limitations

This was a source review plus static-analysis triage and focused Foundry
validation, not formal verification or exhaustive fuzzing. The finding above
is confirmed against current source, but absence of additional findings should
not be read as a proof that no other issue exists.

# RateLoop Smart Contract Security Review - Multi-Agent Pass 9

Date: 2026-07-04
Base revision reviewed: `88564db0f` on `main`
Scope: `packages/foundry/contracts`
Status: 0 critical/high findings; 2 new low findings

No code remediation is included in this report commit. This pass was run after
the pass 8 fix landed in `88564db0f`.

## Methodology

- Ran three read-only reviewer passes in parallel:
  - latest feedback-bonus pause/deadline fix plus adjacent feedback,
    settlement, RBTS, advisory, and reward-distributor surfaces.
  - identity, access-control, config, custody, X402/EIP-3009, frontend, and
    launch-distribution surfaces.
  - `ClusterPayoutOracle`, `ContentRegistry` rating snapshot/repoint/recovery
    paths, `QuestionRewardPoolEscrow`, and all `QuestionRewardPoolEscrow*.sol`
    libraries.
- Rechecked every returned lead against current source before inclusion.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
  - `docs/security-review-multi-agent-2026-07-04-pass4.md`
  - `docs/security-review-multi-agent-2026-07-04-pass5.md`
  - `docs/security-review-multi-agent-2026-07-04-pass6.md`
  - `docs/security-review-multi-agent-2026-07-04-pass7.md`
  - `docs/security-review-multi-agent-2026-07-04-pass8.md`
- Ran static-analysis triage:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: 0 results.
  - `aderyn .` from `packages/foundry`: report generation completed with
    0 high issues and 23 low/static-hygiene buckets, then Aderyn 0.6.8
    crashed in its macOS system-configuration/network shutdown path. The
    generated low buckets were reviewed as checklist input and not promoted
    into findings.
- Ran focused validation for the latest feedback-bonus fix:
  - `forge test --match-contract FeedbackBonusEscrowTest --match-test 'testUnpauseReopensMinimumAwardWindow|testUnpauseDoesNotReopenAlreadyExpiredAwardWindow|testZeroRevealFailedRoundBonusRefundsFunder|testRevealPresentRevealFailedRoundBonusCanAwardThenForfeitRemainder' -vv`:
    4 passed.
  - `bash scripts/check-storage-layouts.sh`: passed.

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL9-01 | Low | Feedback bonus deadlines | A repeated pause can erase a still-live reopened feedback-bonus award window. |
| RL9-02 | Low | Question reward pool oracle repoint | Repointing a single-question pool back to a prior oracle can accept a stale live snapshot that blocks qualification. |

## RL9-01: Repeated Pause Can Erase A Reopened Feedback-Bonus Window

Severity: Low

Affected code:

- `packages/foundry/contracts/FeedbackBonusEscrow.sol`
  - `pause` overwrites `feedbackBonusPausedAt` at lines 417-419.
  - `unpause` overwrites `feedbackBonusLastUnpausedAt` at lines 422-424.
  - `_feedbackBonusAwardDeadline` recomputes each pool from its base deadline
    at lines 501-516.
  - `_feedbackBonusDeadlineAfterPause` only compares that base deadline with
    the latest `feedbackBonusPausedAt` at lines 519-525.
  - `awardFeedbackBonus` and `forfeitExpiredFeedbackBonus` enforce the computed
    deadline at lines 273-282 and 346-354.

The pass 8 fix correctly avoids reopening pools that were already expired
before a later unrelated pause. It still stores only the latest pause/unpause
pair globally. That means a second pause can overwrite the pause-start time for
a pool whose deadline was extended by the first unpause.

Impact scenario:

1. Pool base deadline is `D`.
2. Governance pauses at `D - 1`, then unpauses at `U1`.
3. The pool is correctly reopened until `R1 = U1 + MIN_FEEDBACK_AWARD_DECISION_SECONDS`.
4. Governance pauses again during that reopened window at `P2`, where
   `D < P2 < R1`, and then unpauses.
5. `_feedbackBonusAwardDeadline` recomputes from the original base deadline
   `D`; `_feedbackBonusDeadlineAfterPause` sees `D < P2` and returns `D`.
6. The pool is immediately expired even though it had not reached `R1` before
   the second pause. The awarder can no longer award feedback, and any caller
   can settle the remainder through `forfeitExpiredFeedbackBonus`.

No arbitrary caller can steal funds, and the path requires the pauser role.
The risk is deadline-finality and expected-settlement drift during operational
repeated pauses: an award window that was intentionally reopened can be closed
early by a later pause.

Recommendation:

- Preserve the effective reopened deadline across pause cycles, not only the
  base deadline. One implementation shape is a global `feedbackBonusPauseGraceDeadline`
  that stores the latest post-unpause grace deadline, and applies a future
  pause only if the effective deadline, after prior grace, was still live at
  the new pause start.
- Add a regression where a pool is paused before expiry, unpaused into a grace
  window, paused again during that grace window, and remains awardable until
  a fresh post-unpause grace deadline.

## RL9-02: Single-Question Oracle Repoint Can Accept A Stale Live Snapshot

Severity: Low

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
  - `repoint` checks `roundPayoutSnapshotProposedAt(..., roundId = 0)` before
    accepting a new oracle and resetting `rewardPoolClusterPayoutOraclePinnedAt`
    at lines 23-55.
  - `sourceReadyAt` only exposes nonzero readiness to the currently pinned
    oracle at lines 125-162.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
  - `_finalizedQuestionPayoutSnapshot` later requires the real round snapshot's
    proposal time to be at least the current `pinnedAt` at lines 823-846.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
  - `skipPreQualificationSnapshotlessClusterRound` refuses the snapshotless
    path when any snapshot exists for the real round at lines 122-179.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
  - `_refundUnallocatedRewardPool` blocks refund while the cursor round is
    finished but unadvanced at lines 483-505.

For single-question reward pools, oracle repointing probes only round `0` for
an existing snapshot. Real reward-pool snapshots are proposed for the settled
round id. If governance repoints away from an oracle and later repoints back
to that same oracle, a live snapshot for the real round can predate the new
pin time but still be missed by the round-0 preflight.

Impact scenario:

1. A cluster-backed reward pool is pinned to oracle A.
2. The pool's round settles, and oracle A receives a live snapshot proposal for
   `(domain, rewardPoolId, contentId, realRoundId)`.
3. Governance repoints the pool to oracle B before qualification.
4. Governance later repoints back to oracle A while the old A snapshot is still
   live.
5. `repoint` checks only `roundId = 0`, misses the real stale snapshot, and
   records a fresh `pinnedAt`.
6. Qualification against A's old snapshot now fails with `"Cluster source stale"`
   because `proposedAt < pinnedAt`.
7. A replacement proposal cannot occupy the same key while the stale snapshot
   remains live, the snapshotless skip path reverts with `"Oracle snapshot exists"`,
   and refund remains blocked while the settled cursor round has not advanced.

This is not a direct theft path and it requires governance/admin to repoint
back to a previously used oracle. It is also operationally recoverable by
repointing to a clean oracle that has no stale live snapshot for the real
round. The issue is that the repoint preflight can accept a known-bad oracle
state and strand the pool until another governance action.

Bundle repointing does not appear to share the same shape today:
`repointBundle` checks synthetic round `1`, which is the currently allowed
bundle snapshot round for `requiredSettledRounds == 1`.

Recommendation:

- For single-question reward pools, have `repoint` inspect the pool's current
  pending/evaluable real round, not round `0`, before accepting a new oracle.
  At minimum, reject repointing to an oracle with any live snapshot for
  `rewardPool.contentId` and `rewardPool.nextRoundToEvaluate`.
- Add a regression covering oracle A -> oracle B -> oracle A with an old live
  A snapshot on the real round, asserting the second repoint is rejected or the
  stale snapshot cannot block qualification/refund.

## False Positives And Non-Findings Checked

- The pass 8 single-cycle fix is effective: already-expired feedback bonus
  pools remain expired after a later unrelated pause/unpause, while pools
  paused before expiry still get a post-unpause grace window. The focused
  feedback-bonus tests above passed.
- The zero-reveal `RevealFailed` refund remains correctly scoped. Reveal-present
  `RevealFailed` pools are still awardable because `rbtsCommitState.scoringWeight`
  is the reveal-time participation weight.
- Identity and custody fixes from earlier passes remain present: v3 World ID
  proofs record replay keys, revoked-owner ban fallback is preserved, X402 and
  confidentiality-bond EIP-3009 nonces are payload-bound, and launch-credit
  finalization no longer reruns the configured-stack guard.
- The question bundle recovery fixes from passes 5 and 6 remain present:
  recovered bundle abandonment blocks in-flight replacements, snapshotless
  pre-qualification skips require live qualifiability, and recovered bundle
  reopen preserves original raw completer counts.
- Slither reported no findings. Aderyn's low buckets remained generic
  static-hygiene categories and did not add confirmed issues after source
  review.

## Limitations

This was a source review plus static-analysis triage and focused Foundry
validation, not formal verification or exhaustive fuzzing. The two findings
above are confirmed against current source, but absence of additional findings
should not be read as a proof that no other issue exists.

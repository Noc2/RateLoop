# RateLoop Smart Contract Security Review - Multi-Agent Pass 10

Date: 2026-07-04
Base revision reviewed: `04ad31c4e` on `main`
Scope: `packages/foundry/contracts`
Status: 0 critical/high findings; 2 new low findings

No code remediation is included in this report commit. This pass was run after
the pass 9 fixes landed in:

- `2c1d9af12` - `fix: preserve reopened feedback bonus pauses`
- `04ad31c4e` - `fix: reject stale reward pool oracle snapshots`

## Methodology

- Ran three read-only reviewer passes in parallel:
  - `FeedbackBonusEscrow`, `FeedbackRegistry`, `RoundVotingEngine`,
    RBTS settlement, pause/unpause, refund, award, and deadline paths.
  - `QuestionRewardPoolEscrow` and all `QuestionRewardPoolEscrow*.sol`
    qualification, recovery, snapshotless skip, oracle repoint, bundle,
    refund, and claim paths.
  - `ContentRegistry`, `ClusterPayoutOracle`, `ProtocolConfig`,
    `FrontendRegistry`, identity/access/custody, EIP-3009/X402,
    `LaunchDistributionPool`, and deployment/config assumptions.
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
- Ran static-analysis triage:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: 0 results.
  - `aderyn .` from `packages/foundry`: report generation completed with
    0 high issues and 23 low/static-hygiene buckets, then Aderyn 0.6.8
    crashed in its macOS system-configuration/network shutdown path. The
    generated low buckets were reviewed as checklist input and not promoted
    into additional findings.
- Ran focused validation:
  - `forge test --match-contract FeedbackBonusEscrowTest --match-test 'testUnpauseReopensMinimumAwardWindow|testRepeatedPausePreservesReopenedAwardWindow|testUnpauseDoesNotReopenAlreadyExpiredAwardWindow|testZeroRevealFailedRoundBonusRefundsFunder|testRevealPresentRevealFailedRoundBonusCanAwardThenForfeitRemainder' -vv`:
    5 passed.
  - `forge test --match-contract QuestionRewardPoolEscrowTest --match-test 'testGovernanceCanRepointUnqualifiedRewardPoolClusterOracle|testRepointRewardPoolOracleRejectsPriorLiveSnapshotForCurrentRound|testRepointRewardPoolOracleAllowsPriorRejectedSnapshotForCurrentRound|testReplacementRewardPoolOracleCannotPreSquatBeforeRepointAndPostPinCanClaimAfterVetoWindow|testSnapshotlessSkippedClusterRoundCanRepointAndClaimReplacementSnapshot' -vv`:
    5 passed.
  - `bash scripts/check-storage-layouts.sh`: passed.

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL10-01 | Low | Question reward pool oracle repoint | Repointing a recovered single-question pool back to a prior oracle can accept a stale replacement snapshot for the off-cursor recovered round. |
| RL10-02 | Low | Question bundle oracle repoint | Bundle repoint treats any historical round-1 proposal timestamp as blocking, even when the snapshot is already rejected. |

## RL10-01: Recovered Single-Question Oracle Repoint Can Miss A Stale Replacement Snapshot

Severity: Low

Affected code:

- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
  - `repointRewardPoolClusterPayoutOracle` delegates directly to the
    snapshot-consumer library at lines 449-461.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
  - `repoint` permits repointing when `qualifiedRounds == 0` and
    `claimedAmount == 0` at lines 23-50.
  - `_repointTargetRoundId` derives only from `nextRoundToEvaluate` and
    `pendingPreQualificationRejectedRounds` at lines 89-96.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
  - `recoverRejectedSnapshotRound` parks allocation, decrements
    `qualifiedRounds`, increments `pendingRecoveredRounds`, and intentionally
    leaves the cursor advanced past the recovered round at lines 224-236.
  - `reopenRecoveredSnapshotRound` later requires the replacement snapshot
    proposal time to be at least the current oracle pin time at lines 241-329,
    especially lines 275-288.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
  - refund/recovery cleanup paths still respect pending recovered rounds and
    replacement availability at lines 508-580.

The pass 9 repoint fix correctly checks the current single-question cursor
round, and adjusts for pre-qualification rejected rounds. Recovered rounds are
different: they are deliberately off-cursor. After a post-qualification
snapshot is rejected and recovered, the cursor remains past `roundId` while
`pendingRecoveredRounds` tracks that an older round still needs replacement or
abandonment.

Impact scenario:

1. A cluster-backed reward pool is pinned to oracle A.
2. Round `R` qualifies from an A snapshot, no claim has paid, and governance
   rejects the snapshot.
3. `recoverRejectedSnapshotRound` rolls back qualification, parks the
   allocation, increments `pendingRecoveredRounds`, and leaves
   `nextRoundToEvaluate > R`.
4. Oracle A receives a corrected live or finalized replacement snapshot for
   recovered round `R`.
5. Governance repoints the pool to oracle B, then later repoints back to A.
6. `repoint` checks the future cursor round, not recovered round `R`, and
   accepts A while resetting `pinnedAt`.
7. `reopenRecoveredSnapshotRound` now rejects A's replacement snapshot with
   `"Cluster source stale"` because the replacement was proposed before the
   fresh A pin time.

This is not a theft path and requires governance/admin repointing. It can be
recovered with another oracle/recovery action. The risk is liveness and
operator surprise: a repoint preflight can approve an oracle state that cannot
reopen an already recovered round.

Recommendation:

- Extend the repoint preflight to account for pending recovered rounds. For
  example, reject repointing while `pendingRecoveredRounds != 0` unless the
  candidate oracle is checked against each recovered round that may need
  reopening, or provide an explicit recovered-round-aware repoint flow.
- Add a regression where a round is qualified, rejected, recovered, receives a
  replacement snapshot on oracle A, is repointed A -> B -> A, and the second
  repoint is rejected or the recovered round remains reopenable.

## RL10-02: Bundle Repoint Blocks On Rejected Historical Snapshot Timestamps

Severity: Low

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`
  - `repointBundle` checks only
    `roundPayoutSnapshotProposedAt(..., roundId = 1) == 0` at lines 53-86.
  - The single-question `repoint` path now uses status-aware live-snapshot
    handling at lines 98-126.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
  - bundle recovery and reopen paths already distinguish rejected snapshots
    from live replacements at lines 240-376.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
  - bundle qualification treats a rejected snapshot as not-ready, not as a live
    payout root, at lines 1215-1243 and 1813-1857.

For bundle rewards, the repoint preflight correctly probes synthetic round `1`,
the snapshot round currently used for `requiredSettledRounds == 1`. However,
it still uses only the historical `proposedAt` timestamp. `ClusterPayoutOracle`
leaves `proposedAt` populated after a proposal is rejected, while the oracle's
own propose path permits replacement once the stored status is `Rejected`.

Impact scenario:

1. A bundle reward is pinned to oracle A.
2. Oracle A receives a bundle reward snapshot for synthetic round `1`.
3. That snapshot is rejected before claims are paid or before a replacement
   snapshot is needed.
4. Governance repoints the bundle to oracle B.
5. Governance later wants to repoint back to oracle A after the old A snapshot
   is already rejected.
6. `repointBundle` still sees a nonzero `proposedAt` and reverts with
   `"Oracle snapshot exists"`, even though there is no live A snapshot blocking
   replacement.

This does not let an attacker drain funds. It is a governance liveness footgun:
returning to a previously used oracle can be blocked by rejected historical
metadata that the rest of the bundle recovery/qualification code already treats
as non-live. Governance can still repoint to a clean oracle.

Recommendation:

- Reuse the status-aware live-snapshot check introduced for single-question
  repoints, so `repointBundle` rejects `Proposed`, `Challenged`, and
  `Finalized` snapshots but allows `Rejected` snapshots.
- Add a regression where a bundle snapshot on oracle A is rejected, the bundle
  is repointed A -> B -> A, and the second repoint succeeds or remains
  intentionally rejected with a live-status-specific reason.

## False Positives And Non-Findings Checked

- The pass 9 feedback-bonus fix still preserves a reopened award window across
  repeated pauses, and still does not reopen pools that were already expired
  before the relevant pause. The focused feedback-bonus tests above passed.
- The pass 9 single-question current-cursor repoint fix is effective for the
  tested pre-qualification target round and does not break snapshotless skipped
  replacement flows. The focused question-reward tests above passed.
- No new confirmed issues were found in the feedback publication, RBTS
  settlement, identity/access/custody, X402/EIP-3009, public rating snapshot,
  `ProtocolConfig`, `FrontendRegistry`, `ClusterPayoutOracle`, or
  `LaunchDistributionPool` slices.
- Slither reported no findings. Aderyn's generated report remained limited to
  broad low/static-hygiene categories after manual triage.

## Limitations

This was a source review plus static-analysis triage and focused Foundry
validation, not formal verification or exhaustive fuzzing. The findings above
are confirmed against current source, but absence of additional findings should
not be read as a proof that no other issue exists.

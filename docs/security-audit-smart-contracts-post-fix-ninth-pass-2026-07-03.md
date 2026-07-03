# Smart Contract Security Audit - Post-Fix Ninth Pass

Date: 2026-07-03
Audited head: `41bd6cb6a` (`main`, local; `origin/main` was `0dc78f6a2` when this pass began)
Primary recent smart-contract commit: `0dc78f6a2` (`contracts: harden recovered round reopen checks`)

Scope:

- Smart contracts under `packages/foundry/contracts`.
- The latest recovered question reward round reopen fix and adjacent recovery/refund paths.
- Question bundle reward cluster payout snapshot paths, because they share the same oracle/recovery model.
- Static-analysis output from Slither and Aderyn, triaged manually.

Assumptions:

- The protocol will be freshly redeployed; old contracts will not remain in use.
- Storage-layout movement is not treated as an upgrade-safety finding under this redeploy plan.
- The protocol should be decentralized from launch. Recommended fixes should be permissionless or governance-timelock compatible, not centralized operator workarounds.
- Fixes should not degrade normal protocol UX.
- The `ClusterPayoutOracle` optimistic-oracle trust model remains accepted: deterministic public artifacts are published, challengers/auditors can recompute during the challenge/veto window, and governance arbitrates challenged roots.
- `ClusterPayoutOracle` challenge bonds are anti-spam bonds, not payout-value coverage bonds.
- The 60-minute `revealGracePeriod` remains an accepted product/security parameter and is not raised as a finding here.

## Summary

Two new smart-contract issues were found.

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| M-9P-1 | Medium | Question bundle reward cluster snapshot recovery | Open |
| L-9P-2 | Low | Recovered question reward reopen/refund liveness | Open |

No new high-severity issue was found.

## Findings

### M-9P-1 - Bundle reward round sets have no permissionless no-snapshot escape

Affected files:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol` (contrast path)

Single-question reward pools have a permissionless no-snapshot escape for a cluster-backed round whose voting source is ready and whose oracle has not proposed a snapshot. `skipPreQualificationSnapshotlessClusterRound` checks that the round is settled and qualifying, that the source is ready, that the pinned oracle's current domain consumer is this escrow, and that `roundPayoutSnapshotProposedAt(...) == 0` before marking the round skipped and advancing evaluation. See `QuestionRewardPoolEscrowRecoveryLib.sol:122-170`.

Question bundle rewards do not have the equivalent path. Their pre-qualification skip entrypoint is `skipPreQualificationRejectedSnapshotRoundSet`, but it calls `_requireRejectedPreQualificationBundleSnapshot` and requires an actual rejected oracle snapshot. See `QuestionRewardPoolEscrowBundleRecoveryLib.sol:31-76` and the `SnapshotStatus.Rejected` requirement at `QuestionRewardPoolEscrowBundleRecoveryLib.sol:434-456`.

If the pinned cluster oracle never proposes the bundle payout snapshot:

- `_finalizedBundlePayoutSnapshot` never reports a ready finalized snapshot. See `QuestionRewardPoolEscrowBundleActionsLib.sol:1728-1757`.
- `_bundlePayoutSnapshotStatus` resolves the missing proposal to `SnapshotStatus.None`. See `QuestionRewardPoolEscrowBundleActionsLib.sol:1696-1710`.
- `_qualifyBundleRoundSet` treats the missing finalized snapshot as `qualificationPending` and returns true. See `QuestionRewardPoolEscrowBundleActionsLib.sol:1137-1158`.
- Expired bundle refund still calls `_qualifyPendingBundleRoundSet` and reverts with `BundleClusterPayoutSnapshotPending` while that pending flag is true. See `QuestionRewardPoolEscrowBundleActionsLib.sol:788-805`.
- Claiming also routes through the same pending qualification machinery before opening bundle claims. See `QuestionRewardPoolEscrowBundleActionsLib.sol:439-463`.

The result is a liveness lock for completed, otherwise-qualifying bundle round sets when an authorized proposer omits the bundle payout snapshot. Voters cannot claim, and the funder/treasury cannot refund after the normal grace period. The remaining on-chain escape is governance/admin repointing the bundle oracle with `repointQuestionBundleClusterPayoutOracle` at `QuestionRewardPoolEscrow.sol:502-514`, which is slower and more centralized than the single-question recovery path.

This is not a theft or double-claim issue. It is a funds-liveness and UX issue caused by omission rather than a bad finalized root. Severity is Medium because a failed or malicious proposer can indefinitely block bundle reward resolution without needing to submit an objectively rejectable payload.

Recommended fix:

- Add a permissionless bundle equivalent of `skipPreQualificationSnapshotlessClusterRound`.
- It should verify that:
  - the bundle is cluster-snapshot backed, incomplete, and not refunded,
  - `roundSetIndex == bundle.completedRoundSets`,
  - the bundle round set is complete and source-ready,
  - the pinned oracle is present and pinned,
  - the oracle's current domain consumer is this escrow, and
  - there is no proposal for `(PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD, bundleId, bundleId, snapshotRoundId)`.
- Add explicit state for snapshotless bundle skips rather than overloading the rejected-snapshot digest if that would make `SnapshotStatus.None` indistinguishable from a rejected replacement.
- Keep the replacement-snapshot path permissionless: if a valid replacement snapshot appears later, it should still be able to qualify the skipped round set before refund.

### L-9P-2 - Recovered question rounds can be reopened with finalized but non-qualifiable replacement snapshots

Affected files:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`

The latest fix correctly adds the missing consumer/source freshness gates to `reopenRecoveredSnapshotRound`: finalized snapshot, outside veto, proposal-time consumer equal to this escrow, nonzero `sourceReadyAt`, `proposedAt >= sourceReadyAt`, `proposedAt >= pinnedAt`, and non-rejected digest/root. See `QuestionRewardPoolEscrowRecoveryLib.sol:263-285`.

However, the reopen entrypoint still does not require the replacement snapshot to satisfy the full qualification checks before it mutates recovery state. The later qualifier requires:

- the voting round to be settled and cleanup complete,
- `payoutSnapshot.rawEligibleVoters == baseRawEligibleVoters`,
- enough raw eligible voters,
- enough effective participant units,
- `totalClaimWeight > 0`, and
- enough parked allocation for the effective units.

Those checks are in `QuestionRewardPoolEscrowQualificationLib.sol:318-361`.

Before a recovered round is reopened, the refund/abandonment path only treats a replacement as available when the full preview says it can qualify. `_hasRecoveredReplacementSnapshot` calls `previewRoundQualificationWithClusterSnapshot` and returns false when `canQualify` is false. See `QuestionRewardPoolEscrowPoolActionsLib.sol:623-690`.

After `reopenRecoveredSnapshotRound` succeeds, `_abandonRecoveredRounds` no longer runs that full preview for the round. It sees `reopenedRecoveredRound == true` and only requires `claimDeadline + 7 days` before abandonment. See `QuestionRewardPoolEscrowPoolActionsLib.sol:537-540`. The reopen path also sets `reopenedRecoveredRound` and can bump `claimDeadline` after the old deadline has passed. See `QuestionRewardPoolEscrowRecoveryLib.sol:287-293`.

Impact:

- A finalized, outside-veto replacement snapshot that passes the oracle freshness/rejection checks but fails the consumer's raw/effective/claim-weight/allocation checks can mark a recovered round as reopened even though later qualification will reject it.
- For a tail recovered round, this can add an unnecessary seven-day recovered-refund delay.
- For an older recovered round where `roundId + 1 != nextRoundToEvaluate`, the reopen path does not roll the cursor back. Because there is no `!reopenedRecoveredRound` guard, the same invalid replacement can be used to refresh `claimDeadline` again whenever the deadline has elapsed, extending refund liveness until the bad snapshot is rejected or superseded.

This is Low severity because it requires a finalized, outside-veto oracle snapshot that was not rejected during the normal challenge/review process, and it does not enable theft or double payment. It is still worth fixing because the permissionless reopen action should not be able to put the pool into the reopened/grace branch with evidence the canonical qualifier already knows is non-qualifying.

Recommended fix:

- Before setting `reopenedRecoveredRound` or updating `claimDeadline`, require the same full replacement-availability predicate used by `_hasRecoveredReplacementSnapshot`.
- Concretely, call or mirror `previewRoundQualificationWithClusterSnapshot` and require `canQualify == true`, including raw eligible voter equality, effective-unit floor, nonzero total claim weight, and allocation sufficiency.
- Add a guard against repeatedly reopening the same still-unqualified replacement, for example by requiring `!reopenedRecoveredRound[rewardPoolId][roundId]` or tracking the snapshot digest reopened for the round.
- Keep the path permissionless; honest finalized replacements that can actually qualify should still reopen without admin intervention.

## Recent Change Review

### `0dc78f6a2` recovered-round reopen hardening

The eighth-pass finding L-8P-1 is materially fixed:

- `reopenRecoveredSnapshotRound` now receives `votingEngine`.
- It checks the proposal-time consumer recorded by the oracle.
- It checks source readiness and rejects snapshots proposed before source readiness or before oracle pinning.
- The checks occur before cursor, claim-deadline, or reopened-state mutation.

`address(this)` is correct inside the external storage library call in this context: Solidity executes library functions operating on caller storage with the escrow as the execution context, so `address(this)` resolves to `QuestionRewardPoolEscrow`, matching the established qualification and bundle-recovery patterns.

The two new regression tests for consumer mismatch and stale source replacement pass.

### Bundle no-snapshot contrast

The single-question no-snapshot path exists and is covered by tests such as `testSnapshotlessSkippedClusterRoundCanRepointAndClaimReplacementSnapshot`. The bundle tests currently document the opposite behavior: `testBundleRefund_CompleteClusterRoundSetWaitsForFinalizedSnapshot` expects refund to revert until a finalized snapshot exists. That behavior is the basis for M-9P-1.

### Compiler Known Bugs

The project is pinned to `solc 0.8.35`, `via_ir = true`, and `evm_version = cancun` in `packages/foundry/foundry.toml`.

Solidity's official known-bugs page was reviewed, including the 2026 transient-storage clearing helper collision entry that applied to `viaIR` plus Cancun and was fixed in `0.8.34`. I did not identify a currently listed known compiler bug affecting the pinned 0.8.35 profile.

Reference: https://docs.soliditylang.org/en/latest/bugs.html

## Tooling And Triage

Commands run:

- `forge test --offline --match-contract QuestionRewardPoolEscrowTest --match-test "testReopenRecoveredSnapshotRoundRejectsReplacementConsumerMismatch|testReopenRecoveredSnapshotRoundRejectsSourceStaleReplacement|legacyReopenRecoveredSnapshotRound_AllowsHonestRequalification|legacyReopenRecoveredSnapshotRound_WaitsForReplacementVetoWindow" -vv`
  - 2 passed, 0 failed. The two `legacy...` names did not match the active test filter in this run.
- `forge test --offline --match-contract QuestionRewardPoolEscrowTest --match-test "testBundleRefund_CompleteClusterRoundSetWaitsForFinalizedSnapshot|testBundleRefund_PreQualificationRejectedSnapshotRoundSetCanBeSkipped|testBundleRefund_BelowFloorClusterRoundSetDoesNotPinFunds|testReopenRecoveredSnapshotRoundRejectsReplacementConsumerMismatch|testReopenRecoveredSnapshotRoundRejectsSourceStaleReplacement" -vv`
  - 5 passed, 0 failed.
- `make check-contract-sizes`
  - Passed. Deploy-profile sizes remain under EIP-170, though tight: `LaunchDistributionPool` is 24,575 bytes and `QuestionRewardPoolEscrow` is 24,570 bytes.
- `slither .`
  - Completed with 21 results and nonzero exit due findings.
  - Triage: same shape as prior passes: known/shared-storage false positives around `RoundVotingEngineRbtsSettlementModule` inheriting `RoundVotingEngineStorage`, plus constable-state suggestions. No new actionable issue from Slither beyond the manual findings above.
- `yarn foundry:aderyn`
  - Completed with 0 high issues and 23 low-pattern categories.
  - Triage: broad centralization, loop-cost, style, PUSH0, pragma, unchecked-return, and similar pattern output. No new high/medium actionable issue from Aderyn beyond the manual findings above. The generated `packages/foundry/report.md` was not committed.

Full `forge test --offline` was not rerun in this pass.

## Parallel Review Notes

Read-only subagents reviewed independent slices:

- The latest recovered-round reopen fix: no additional issue found; the consumer/source checks were judged sufficient for the specific stale/wrong-snapshot concern.
- Cross-contract recovery/qualification paths: found M-9P-1 in bundle no-snapshot recovery.
- A separate read-only notification also reported no issue in the L-8P-1 fix itself.

I manually rechecked the bundle no-snapshot finding, the single-pool reopen residual, static-analysis output, and focused test evidence before writing this report.

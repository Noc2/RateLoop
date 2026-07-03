# Smart Contract Security Audit - Post-Fix Tenth Pass

Date: 2026-07-03
Audited head: `93b0e51be` (`main`, `origin/main`)

Recent smart-contract commits reviewed:

- `01541baf3` - `fix contracts rating cursor engine history`
- `51740f329` - `fix contracts recovered snapshot reopens`
- `f6abfc797` - `fix contracts rejected rbts timeout`
- `93b0e51be` - `docs clarify audit residual economics`

Scope:

- Smart contracts under `packages/foundry/contracts`.
- Generated contract surfaces under `packages/contracts/src` touched by the recent oracle ABI change.
- Recent regression tests under `packages/foundry/test`.
- Documentation changes that clarify the accepted optimistic-oracle and residual-economics trust model.

Assumptions:

- The protocol will be freshly redeployed; old contracts will not remain in use.
- Storage-layout movement is not treated as an upgrade-safety finding under this redeploy plan.
- The protocol should be decentralized from launch. Recommended fixes should be permissionless or governance-timelock compatible, not centralized operator workarounds.
- Fixes should not degrade normal protocol UX.
- The `ClusterPayoutOracle` optimistic-oracle trust model remains accepted: deterministic public artifacts are published, challengers/auditors can recompute during the challenge/veto window, and governance arbitrates challenged roots.
- `ClusterPayoutOracle` challenge bonds are anti-spam bonds, not payout-value coverage bonds.
- The 60-minute `revealGracePeriod` remains an accepted product/security parameter and is not raised as a finding here.

## Summary

One new smart-contract issue was found.

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| M-10P-1 | Medium | RBTS settlement timeout / cluster payout oracle parent rejection | Open |

No new high-severity issue was found.

## Findings

### M-10P-1 - RBTS timeout grace can be bypassed after parent correlation epoch rejection

Affected files:

- `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol`
- `packages/foundry/contracts/ClusterPayoutOracle.sol`
- `packages/foundry/contracts/interfaces/IClusterPayoutOracle.sol`

The latest RBTS timeout fix correctly blocks the empty settlement-timeout path for one hour after a direct round-payout snapshot rejection. In `applyRbtsSettlementSnapshot`, the empty input branch waits until `roundClusterPayoutReadyAt + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT`, checks that no live RBTS payout snapshot is available, then calls `_requireNoRecentRejectedRbtsSettlementSnapshot` before returning RBTS stakes and completing settlement. See `RoundVotingEngineRbtsSettlementModule.sol:41-56`.

That helper derives the RBTS child snapshot key and only checks `ClusterPayoutOracle.roundPayoutSnapshotRejectedAt(snapshotKey)`. See `RoundVotingEngineRbtsSettlementModule.sol:172-183`.

Direct child rejections are stamped correctly. `ClusterPayoutOracle._markRoundPayoutSnapshotRejected` sets the child snapshot status to `Rejected` and writes `roundPayoutSnapshotRejectedAt[snapshotKey] = block.timestamp`. See `ClusterPayoutOracle.sol:1067-1070`.

However, a child round-payout snapshot can also become rejected through its parent correlation epoch. `getRoundPayoutSnapshot` returns a live child snapshot as `Rejected` when `_isLiveCorrelationEpoch(proposal.correlationEpochDigest, snapshot.correlationEpochId)` is false. See `ClusterPayoutOracle.sol:849-865`. Parent epoch rejection itself updates the parent epoch state and rejected parent digest, but it does not stamp `roundPayoutSnapshotRejectedAt` for child snapshots that now read as rejected through the parent. See `ClusterPayoutOracle.sol:458-473`.

Impact:

- After the original `readyAt + 1 hour` timeout has elapsed, an arbiter/governance rejection of the finalized parent correlation epoch can make the RBTS child snapshot stop counting as live.
- Because the child `roundPayoutSnapshotRejectedAt` timestamp remains zero, any caller can immediately submit the empty RBTS timeout path in the same block or soon after parent rejection.
- That can close RBTS settlement by returning stakes and completing with zero correlation-weighted settlement before an honest corrected parent/child snapshot can be proposed and finalized.
- This does not allow direct theft or double payment, and it depends on a parent epoch rejection path. Severity is Medium because it partially bypasses the newly added one-hour operator/reproposal grace and can skip valid RBTS rewards/forfeits in a permissionless settlement path.

Recommended fix:

- Make parent-derived child rejection visible to the RBTS timeout grace.
- One viable decentralized approach is to record a rejection timestamp for the finalized correlation epoch digest when `_rejectFinalizedCorrelationEpoch` runs, expose it through `IClusterPayoutOracle`, and have `_requireNoRecentRejectedRbtsSettlementSnapshot` treat a child that reads as rejected through its parent as recent until `parentRejectedAt + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT`.
- Another viable approach is to stamp affected child `roundPayoutSnapshotRejectedAt` values when the parent epoch is rejected, if the oracle maintains enough child indexing to do that without unbounded iteration.
- Keep the escape permissionless: after the grace expires and no live replacement exists, anyone should still be able to execute the empty timeout.

Recommended regression test:

- Create and finalize the RBTS child round-payout snapshot and its parent correlation epoch.
- Warp past `roundClusterPayoutReadyAt + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT`.
- Reject the parent correlation epoch during its veto window.
- Assert that `applyRbtsSettlementSnapshot(contentId, roundId, emptyWeights, emptyProofs)` reverts with `RoundNotExpired` until one hour after the parent rejection.
- Assert that the timeout path works after the parent-rejection grace expires when no replacement snapshot is live.

## False Positives And Verified Non-Issues

### Recovered single-question snapshot reopen

The recovered single-question reopen path now checks the current replacement snapshot against the recovered round and live voting state before mutating cursor/deadline/reopened state:

- `reopenRecoveredSnapshotRound` rejects already reopened rounds and stale source/consumer snapshots. See `QuestionRewardPoolEscrowRecoveryLib.sol:241-329`.
- It requires the replacement snapshot raw eligible voter count to match the recovered snapshot and the live voting engine raw eligible count. See `QuestionRewardPoolEscrowRecoveryLib.sol:294-312`.
- It requires the replacement to pass `previewRoundQualificationWithClusterSnapshot`, have enough parked allocation, and cover the effective participant units before reopening. See `QuestionRewardPoolEscrowRecoveryLib.sol:301-325`.

I did not find a new real issue in recovered single-question claimant replay, refund, or oracle-consumer matching paths.

### Recovered bundle snapshot reopen

The recovered bundle path now requires the replacement to be qualifiable before reopening:

- `_reopenRecoveredSnapshotRoundSet` rejects duplicate reopens and stale source/consumer snapshots. See `QuestionRewardPoolEscrowBundleRecoveryLib.sol:269-344`.
- It calls `QuestionRewardPoolEscrowBundleActionsLib.hasQualifiableRecoveredBundleReplacementSnapshot` before reopening. See `QuestionRewardPoolEscrowBundleRecoveryLib.sol:321-328`.

I did not find a new real issue in the recovered bundle reopen/refund path.

### Rating cursor engine history

The rating cursor now tracks the engine that opened each content round:

- `ContentRegistry` stores `contentRoundVotingEngine[contentId][roundId]` for new and initial rounds. See `ContentRegistry.sol:181`, `ContentRegistry.sol:1369`, and `ContentRegistry.sol:1378`.
- `advanceRatingSnapshotCursor` receives the per-content round-engine mapping and uses the originating round engine when skipping terminal rounds. See `ContentRegistryRatingSnapshotLib.sol:236-305` and `ContentRegistry.sol:1452-1458`.

I did not find a remaining cursor issue for old-engine terminal rounds under the fresh-redeploy assumption.

### ABI and storage surfaces

Generated ABI and deployment metadata include `roundPayoutSnapshotRejectedAt`; the unnamed concrete ABI input is consistent with the public mapping getter, while `IClusterPayoutOracle` names the parameter `snapshotKey`.

Storage movement in `ContentRegistry` would matter for in-place upgrades, but the stated deployment plan is a fresh redeploy with old contracts unused. Under that assumption, the current storage snapshots and tests are aligned.

### ProtocolConfig oracle interface probing

`ProtocolConfig._validateClusterPayoutOracle` does not currently probe the new `roundPayoutSnapshotRejectedAt` getter. Under a fresh redeploy with the new oracle this is not an issue. It would become a future-hardening item only if governance later allowed swapping to an older oracle, because the RBTS helper intentionally catches missing getter calls.

## Tooling And Research

Manual review:

- Reviewed the diff from `HEAD~4..HEAD` across smart contracts, tests, generated ABI/deployment metadata, README, and audit/remediation docs.
- Ran three parallel read-only agent reviews focused on:
  - recovered single-question and bundle snapshot reopen/refund paths,
  - rating cursor and RBTS recent changes,
  - ABI/storage/test/doc consistency after the fixes.
- All three agents independently identified M-10P-1. They did not identify another real issue.

Static analysis:

- `slither . --filter-paths 'lib|test|script|mocks' --exclude-dependencies`
  - Completed with nonzero exit due 21 reported items.
  - Triage: inherited storage/default mapping and constable-state reports on `RoundVotingEngineRbtsSettlementModule` and `RoundVotingEngineStorage`, matching the known false-positive shape from prior passes. No new actionable issue was identified from Slither beyond M-10P-1.

Compiler/security research:

- The repo is pinned to `solc = "0.8.35"`, `via_ir = true`, and `evm_version = 'cancun'` in `packages/foundry/foundry.toml`.
- Solidity's official known-bugs page was reviewed on 2026-07-03. The 2026 transient-storage clearing helper collision entry affects `viaIR` plus Cancun in Solidity `0.8.28` through `0.8.33` and is fixed in `0.8.34`, so the pinned `0.8.35` profile is not affected by that entry.
- Reference: https://docs.soliditylang.org/en/latest/bugs.html

Full `forge test --offline` was not rerun during this audit pass because no contract code was changed. It passed immediately before this read-only audit at the same recent-fix series with 1843 tests passing, along with `make check-contract-sizes` and `make check-storage-layouts`.

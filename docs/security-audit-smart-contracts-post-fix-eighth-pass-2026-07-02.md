# Smart Contract Security Audit - Post-Fix Eighth Pass

Date: 2026-07-02
Audited head: `1827f9196` (`origin/main`)
Primary recent contract commit: `5d33ba6a9` (`contracts: align child payout veto rejection timing`)

Scope:

- Smart contracts under `packages/foundry/contracts`.
- The latest `ClusterPayoutOracle` child/parent veto-window fix and its direct consumers.
- Adjacent RBTS settlement, question reward, bundle reward, launch credit, public-rating, and governance role wiring paths.
- Deployment scripts were reviewed only for role-handoff context; deployment-tooling ergonomics are not treated as smart-contract findings.

Assumptions:

- The protocol will be freshly redeployed; old contracts will not remain in use.
- Storage-layout movement is not itself an upgrade-safety finding under this redeploy plan.
- The protocol should be decentralized from launch; findings should not be fixed with centralized operators or off-chain-only escape hatches.
- Fixes should not degrade normal protocol UX.
- The `ClusterPayoutOracle` optimistic-oracle trust model remains accepted: globally bonded frontend operators publish deterministic public artifacts, challengers/auditors can recompute them during the challenge/veto window, and governance arbitrates challenged or vetoed roots.

## Summary

One new low-severity smart-contract issue was found.

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| L-8P-1 | Low | Question reward recovered-round reopen checks | Open |

No high- or medium-severity smart-contract issue was found in the recent `ClusterPayoutOracle` timing fix.

## Findings

### L-8P-1 - Recovered question reward rounds can be reopened with a snapshot the later qualifier rejects

Affected files:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol` (contrast path)

The post-qualification recovery flow lets a question reward pool roll back a round whose already-qualified cluster payout snapshot is later rejected, then reopen that recovered round if a replacement finalized snapshot appears.

`QuestionRewardPoolEscrowRecoveryLib.reopenRecoveredSnapshotRound` checks that:

- the round was previously recovered,
- the oracle snapshot is finalized and outside the veto window,
- the snapshot was proposed after the pool's oracle pin, and
- the replacement payload/root is not rejected.

Those checks are at `QuestionRewardPoolEscrowRecoveryLib.sol:250-278`.

However, the later qualification path applies stricter checks before it will actually qualify the reopened round:

- `roundPayoutSnapshotConsumerFor(...) == address(this)`, and
- `roundPayoutSnapshotProposedAt(...) >= sourceReadyAt`.

Those checks are at `QuestionRewardPoolEscrowQualificationLib.sol:839-846`.

The bundle recovery path already performs the stricter checks during reopen, before it marks a recovered bundle round set as reopened: source readiness at `QuestionRewardPoolEscrowBundleRecoveryLib.sol:296-299`, consumer match at `QuestionRewardPoolEscrowBundleRecoveryLib.sol:299-302`, and `proposedAt >= sourceReadyAt && proposedAt >= pinnedAt` at `QuestionRewardPoolEscrowBundleRecoveryLib.sol:303-306`.

Impact:

- Under oracle consumer misconfiguration/rotation, or any stale replacement edge where a finalized snapshot is outside veto but does not satisfy the qualification-time consumer/source-readiness gates, anyone can mark the recovered question round as reopened even though qualification will later reject it.
- Once `reopenedRecoveredRound` is true, abandonment takes the reopened branch at `QuestionRewardPoolEscrowPoolActionsLib.sol:537-540` instead of the replacement-availability branch at `QuestionRewardPoolEscrowPoolActionsLib.sol:540-553`.
- `reopenRecoveredSnapshotRound` can also bump `claimDeadline` when the old claim deadline has passed at `QuestionRewardPoolEscrowRecoveryLib.sol:280-286`; depending on the cursor state, this can delay abandonment/refund of the recovered pool allocation.

This is not a direct theft, double-claim, or double-settlement issue. The normal oracle proposal path asks the configured consumer for source readiness before accepting a snapshot, so the practical trigger surface is narrow. The issue is still worth fixing because the permissionless reopen entrypoint should not be able to set recovery state with a snapshot the canonical qualification path already knows it cannot consume.

Recommended fix:

- Make `reopenRecoveredSnapshotRound` mirror the qualification-time replacement checks before setting `reopenedRecoveredRound` or touching `claimDeadline`.
- Concretely, require:
  - `oracle.roundPayoutSnapshotConsumerFor(payoutDomain, rewardPoolId, rewardPool.contentId, roundId) == address(this)`, and
  - `(,,, uint48 sourceReadyAt) = votingEngine.roundLifecycleState(rewardPool.contentId, roundId)` is nonzero, then `proposedAt >= sourceReadyAt && proposedAt >= pinnedAt`.
- This can follow the bundle recovery pattern and should not harm UX: honest replacement snapshots that can actually qualify already satisfy these checks.

## Recent Change Review

### `ClusterPayoutOracle` veto timing

The seventh-pass high finding is fixed at current head:

- `rejectFinalizedRoundPayoutSnapshot` and `rejectFinalizedRoundPayoutSnapshotRoot` now reject until the same effective deadline used by consumers.
- `isRoundPayoutSnapshotOutsideVetoWindow` and finalized-child rejection both use `_effectiveRoundPayoutSnapshotVetoDeadline`, which is `max(child snapshot veto deadline, parent correlation epoch veto deadline)`.
- Boundary semantics are consistent: rejection is allowed before the effective deadline, and consumption begins at the effective deadline.

No new issue was found in the direct oracle fix.

### Consumers

Reviewed consumers of `isRoundPayoutSnapshotOutsideVetoWindow`:

- RBTS settlement: `RoundRbtsSettlementSnapshotLib.applySnapshotWeights`.
- Public rating: `ContentRegistryRatingSnapshotLib._validatedSnapshot`.
- Launch credit: `LaunchRaterRewardLib.launchPayoutSnapshotOutsideVetoWindow`.
- Question reward qualification and recovered replacement probes.
- Bundle reward qualification and recovered replacement probes.

The mutating consumers reviewed gate application on the oracle's effective outside-veto predicate rather than using the raw child-only veto deadline.

### Governance and Decentralization

No new on-chain centralization issue was found in the fresh non-local deployment path reviewed:

- deployer roles are handed to the timelock/governor path for non-local deploys,
- `ClusterPayoutOracle` config/arbiter/default-admin roles are transferred to governance,
- deployer roles are renounced after setup,
- the open-executor timelock pattern is documented in `Deploy.s.sol` and aligns with the accepted decentralized execution trade-off.

OpenZeppelin's current AccessControl/Timelock documentation was reviewed for role-admin and open-executor semantics. The reviewed contract wiring did not add a new centralized system.

Deployment tooling note: `packages/foundry/README.md` explicitly documents that checked-in production artifacts no longer block a fresh Base mainnet deployment. That is a production-process/UX risk if used accidentally, but it is not a smart-contract vulnerability and is not carried as a contract finding in this pass.

### Compiler Known Bugs

The project is pinned to `solc 0.8.35` with `via_ir = true` and `evm_version = cancun` in `packages/foundry/foundry.toml`. Solidity's official known-bugs page was reviewed, including the 2026 transient-storage clearing helper collision entry that was fixed in 0.8.34. I did not identify a currently listed known compiler bug affecting the pinned 0.8.35 profile.

Reference: https://docs.soliditylang.org/en/latest/bugs.html

## Tooling And Triage

Commands run:

- `slither .`
  - Completed with 21 results and nonzero exit due findings.
  - Triage: known false positives/noise around delegatecall storage in `RoundVotingEngineRbtsSettlementModule` inheriting `RoundVotingEngineStorage`, plus constable-state suggestions. No new actionable issue from this run.
- `yarn foundry:aderyn`
  - Completed with 0 high issues and 23 low-pattern categories.
  - Triage: broad centralization, loop-cost, style, PUSH0, pragma, unchecked-return, and similar pattern findings. No new high/medium actionable issue from this run. The generated `packages/foundry/report.md` was not committed.
- `forge test --offline --match-contract ClusterPayoutOracleTest -vv`
  - 92 passed, 0 failed.
- `forge test --offline --match-test "test_RoundPayoutSnapshotOutsideVetoWindowWaitsForParentEpochVetoDeadline|test_FinalizedRoundPayoutSnapshotRejectWaitsForParentEpochVetoDeadline|test_FinalizedRoundPayoutSnapshotRootRejectWaitsForParentEpochVetoDeadline|test_FinalizedRoundPayoutSnapshotRejectRevertsAfterVetoWindow" -vv`
  - 4 passed, 0 failed.
- `forge test --offline`
  - Attempted after the static-analysis rebuild.
  - Stopped manually after several minutes of no output beyond the initial `Compiling 70 files with Solc 0.8.35` line. No failure output was observed.

## Parallel Review Notes

Three read-only subagents reviewed independent slices:

- Recent `ClusterPayoutOracle` timing fix: no finding.
- Adjacent settlement/payout consumers: found L-8P-1; no RBTS stale-finality, double-settlement, or double-claim issue found.
- Governance/decentralization/fresh-deploy assumptions: no on-chain centralization finding; deployment-tooling note treated as out of scope for smart-contract severity.

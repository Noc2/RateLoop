# RateLoop Smart Contracts - Tenth-Pass Security Audit

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `60720ea7e` (`docs: add non-contract review report`)
**Last smart-contract changes reviewed:** `5bdc50f83` (`fix(foundry): release proposer state on pending cancel`) and `d65806e00` (`wip(oracle): track snapshot disputes and block frontend exits`)

## Scope

This was a read-only security pass over the committed smart-contract tree on current `main`. No contract code was changed. The review focused on the recent governance/proposer-cancel change, the oracle dispute/frontend-exit change, and the reward-pool, payout-consumption, voting, registry, x402, confidentiality, and settlement paths most likely to regress around those changes.

Three parallel read-only explorers covered separate surfaces:

- Governance, LREP locking, frontend/oracle accountability.
- Voting, registry, confidentiality, advisory, and x402 submission paths.
- Reward-pool and payout-consumption paths.

The lead pass re-checked current `main` after the branch advanced during the audit, so the findings below are against `60720ea7e`, not the earlier intermediate head.

## Executive Summary

No High or Medium issue was found.

One new Low issue remains in the governance proposer self-cancel fix: the cancel path releases the *current* proposal threshold, not the proposal threshold amount that was actually locked at proposal creation. This can over-release or under-release an aggregate governance lock if governance changes the threshold while the proposal is still pending.

The previously open frontend-fee/slash-latency item is no longer present on current `main`: `d65806e00` records open oracle disputes and blocks frontend fee-withdrawal completion and deregistration completion while a dispute is active.

## Findings

### 10P-1 (Low, confidence High). Pending proposer self-cancel releases the current threshold instead of the originally locked threshold

**Where:** `packages/foundry/contracts/governance/RateLoopGovernor.sol:306-316`, `packages/foundry/contracts/governance/RateLoopGovernor.sol:248-256`, `packages/foundry/contracts/governance/RateLoopGovernor.sol:179-183`, and `packages/foundry/contracts/LoopReputation.sol:84-99`.

`propose` reads `uint256 threshold = proposalThreshold()` and locks exactly that amount with `lockForGovernanceUntil`. The proposal id, created block, and next proposal block are stored, but the locked threshold amount is not. On pending self-cancel, `_cancel` clears `nextProposalBlock[proposer]` and calls:

```solidity
reputationToken.releaseGovernanceLock(proposer, proposalThreshold());
```

That second `proposalThreshold()` is evaluated at cancel time. Governance can change the threshold through `_setProposalThreshold`, and LREP governance locks are aggregate account locks rather than source-attributed locks.

**Scenario:** a proposer has 99,000 LREP already locked from governance voting and 1,000 LREP still transferable. While the proposal threshold is 1,000 LREP, they create a pending proposal, which locks 1,000 more. Before that pending proposal is self-cancelled, an already queued governance action raises the proposal threshold to 100,000 LREP. The proposer self-cancels. `_cancel` now releases 100,000 from the aggregate lock even though this proposal acquired only 1,000, potentially clearing the independent vote lock early. If the threshold is lowered between propose and cancel, the reverse happens and some proposal stake stays locked until the nominal unlock time.

**Impact:** narrow and opportunistic, so Low. It requires a threshold change during a pending proposal window and the proposer cancelling their own pending proposal. There is no direct theft path, but the behavior weakens the accounting symmetry of governance locks and can defeat the intended vote-lock duration for unrelated locked stake.

**Recommended fix:** store the amount acquired by each proposal and release exactly that amount on pending self-cancel, for example:

```solidity
mapping(uint256 => uint256) private proposalLockedAmount;

// after super.propose(...)
proposalLockedAmount[proposalId] = threshold;

// in pending proposer self-cancel
uint256 lockedAmount = proposalLockedAmount[proposalId];
delete proposalLockedAmount[proposalId];
if (lockedAmount != 0) {
    reputationToken.releaseGovernanceLock(proposer, lockedAmount);
}
```

If future lock semantics need more precision than this, split LREP governance locks by source instead of maintaining one aggregate account lock.

## Verified Fixes And Non-Findings

### Frontend dispute gating closes the prior 6P-5 issue on current main

The earlier concern was that an active oracle challenge did not freeze slashable frontend fees or exits. Current `main` now addresses that.

`ClusterPayoutOracle.challengeCorrelationEpoch` and `challengeRoundPayoutSnapshot` mark proposals as challenged and call `_recordSnapshotDisputeOpened` after state is written and before pulling the challenge bond (`ClusterPayoutOracle.sol:376-395`, `ClusterPayoutOracle.sol:611-633`). The oracle tracks per-frontend open disputes and calls `frontendRegistry.recordSnapshotDisputeOpened`.

`FrontendRegistry` records open dispute counts behind `SNAPSHOT_DISPUTE_RECORDER_ROLE` (`FrontendRegistry.sol:612-636`). `completeDeregister` now calls `_requireNoOpenSnapshotDispute` after the unbonding and fee-review windows mature (`FrontendRegistry.sol:346-363`), and `completeFeeWithdrawal` does the same before releasing a pending withdrawal (`FrontendRegistry.sol:414-425`, `FrontendRegistry.sol:810-812`). `requestFeeWithdrawal` may still move accrued fees into the pending bucket, but that bucket remains slashable until completion.

The regression suite includes `test_OpenSnapshotDisputeBlocksDeregisterCompletionUntilClosed` and `test_OpenSnapshotDisputeBlocksMaturedFeeWithdrawalUntilClosed` in `FrontendRegistryTest`; those passed in the focused run.

### Reward-pool and payout-consumption paths

No new reward-pool or payout-consumption issue was found. The explorer specifically rechecked:

- Recovered cluster snapshot reopening, including consumer, source-readiness, finalization/veto, oracle-pinning, and live qualification gates.
- Question reward qualification and claims, including ban checks, exclusion rules, double-claim accounting, and frontend-fee redirection.
- Snapshot consumer behavior for refunded/unrelated pools and question roots.
- Feedback bonus duplicate prevention and remaining-balance accounting.
- Launch credit finalization binding exact payout fields, source readiness, and one-shot consumption.
- RBTS reward distribution, including marking duplicate-prevention state before transfer, final-claimant remainder accounting, and banned-reward routing.

The prior recovered-snapshot reopen issue is not present on current code.

### Voting, registry, confidentiality, advisory, and x402 paths

No new issue was found in the voting/registry/x402 sweep. The pass rechecked commit/reveal timing, settlement cleanup, RBTS/oracle replay surfaces, dormancy/cancel transitions, identity and ban transitions, confidentiality escrow release/slash windows, x402 authorization binding, advisory votes, and known rotation hazards. No actionable regression was identified.

## Tooling And Verification

Commands were run from current `main` unless noted.

| Command | Result |
| --- | --- |
| `slither .` from `packages/foundry` | Passed: 168 contracts, 35 detectors, 0 results |
| `/opt/homebrew/bin/aderyn . --output /private/tmp/rateloop-aderyn-current-20260703.md` from `packages/foundry` | Generated a report with 0 High and 23 broad Low/static categories, then hit Aderyn 0.6.8's macOS internal `system-configuration` / `reqwest` panic; treated as partial static evidence |
| `forge test --offline --match-contract 'GovernanceTest\|LoopReputationTest\|RaterRegistryTest\|RoundIntegrationTest\|RoundVotingEngineBranchesTest\|RoundLibFuzzTest\|SecondPassRatingSnapshotOrderingTest\|RewardMathTest\|QuestionRewardPoolEscrowTest\|FrontendRegistryTest\|ClusterPayoutOracleTest' -vv` | 743 passed, 70 failed; all observed failures shared `AccessControlUnauthorizedAccount(... SNAPSHOT_DISPUTE_RECORDER_ROLE ...)` in oracle/snapshot-heavy test setup after the new dispute-recorder role gate |
| `forge test --offline --match-contract 'GovernanceTest\|LoopReputationTest\|RaterRegistryTest\|RoundIntegrationTest\|RoundVotingEngineBranchesTest\|RoundLibFuzzTest\|RewardMathTest\|FrontendRegistryTest\|ClusterPayoutOracleTest\|FeedbackBonusEscrowTest\|LaunchDistributionPoolTest\|RoundRewardDistributorBranchesTest\|RoundRewardDistributorBannedRewardTest\|QuestionRewardParticipantFloorTest\|SecondPassRecoveredRewardPoolTest' -vv` | Passed: 785 tests, 0 failed |

The 70-test failure cluster is not counted as a contract finding in this report because the revert is an authorization failure in test setup for the new `SNAPSHOT_DISPUTE_RECORDER_ROLE`, not an observed economic or permission bypass. It should still be fixed before treating the full contract suite as green.

## Priorities

1. Fix 10P-1 by storing and releasing the exact per-proposal locked amount.
2. Repair the oracle/snapshot-heavy test helpers so `QuestionRewardPoolEscrowTest` and `SecondPassRatingSnapshotOrderingTest` grant the snapshot-dispute recorder role correctly, then rerun the full Foundry suite.
3. Keep the frontend dispute-gating tests in the pre-deploy gate, because they now carry the regression coverage for the former 6P-5 issue.


# Repo Bug and Inconsistency Audit - Post-Remediation Pass - 2026-07-02

Scope: current `main` at `2ccbd232441e980fac2df549755b6f794bf40ba1`, with emphasis on the recent RBTS settlement, recovered reward-pool refund, storage snapshot, keeper/Ponder, frontend, docs, and generated ABI changes after `d37a77cd8`.

Deployment assumption: all smart contracts will be redeployed and old contract state/deployments will not be reused. Findings that only affect hot upgrades from old proxy state are out of scope unless a current repo artifact still directs operators toward that path.

Method: read-only manual review, three parallel subagent audit passes, targeted source searches, generated-artifact checks, and local verification commands. No product code was intentionally changed for this report.

## Summary

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| REPO-POST-2026-07-02-1 | High | Contracts / keeper | Feedback Bonus residue can be forfeited during `SettlementPending` before awards are possible. |
| REPO-POST-2026-07-02-2 | Medium | Contracts / oracle | Domain 1/2/4 payout roots can be consumed before the 7-day veto window, blocking arbiter rejection. |
| REPO-POST-2026-07-02-3 | Medium | Contracts / RBTS | The 14-day RBTS timeout can bypass an available forfeiting settlement snapshot. |
| REPO-POST-2026-07-02-4 | Medium | Generated artifacts | `QuestionRewardPoolEscrow` generated ABIs are stale for recovered-pool refund exits. |
| REPO-POST-2026-07-02-5 | Medium | Verification | The full Foundry gate is still red because gas fixtures call `settleRound` without a cluster payout oracle. |
| REPO-POST-2026-07-02-6 | Low | Docs | Frontend operator docs still describe `settleRound` as final settlement. |

## Findings

### REPO-POST-2026-07-02-1 - Feedback Bonus residue can be forfeited during `SettlementPending`

Severity: High

Evidence:

- `packages/foundry/contracts/FeedbackBonusEscrow.sol:345` exposes permissionless `forfeitExpiredFeedbackBonus`.
- `packages/foundry/contracts/FeedbackBonusEscrow.sol:353` only checks `block.timestamp > _feedbackBonusAwardDeadline(pool)`.
- `packages/foundry/contracts/FeedbackBonusEscrow.sol:491-505` returns the original `feedbackClosesAt` when `settledAt == 0` and the round is no longer `Open`. That includes normal non-tied `SettlementPending` rounds.
- `packages/foundry/contracts/FeedbackBonusEscrow.sol:518-522` only permits awards when the round is `Settled`, `Tied`, or `RevealFailed`, so awards are blocked during `SettlementPending`.
- `packages/ponder/src/api/routes/keeper-routes.ts:237-245` surfaces feedback-bonus forfeits for any pool whose round is not an active open round and whose indexed `awardDeadline` has passed.
- Public docs promise a later deadline: `packages/nextjs/public/docs/how-it-works.md:22` describes Feedback Bonuses as using the later of question close and 24 hours after settlement.

Impact:

For a normal RBTS-backed non-tied round, `settleRound` moves to `SettlementPending`. The feedback bonus awarder cannot pay while settlement is pending, but the keeper can discover and execute the forfeit path once the original feedback close has passed. That can sweep remaining bonus funds before the awarder gets the documented post-settlement decision window.

Recommendation:

Treat `SettlementPending` as non-expirable for Feedback Bonuses. In the contract, either return `type(uint256).max` from `_feedbackBonusAwardDeadline` for `Open` and `SettlementPending`, or require an awardable terminal state before forfeiture. In Ponder, exclude `SettlementPending` from feedback-bonus forfeit work. Add a regression where an expired-close `SettlementPending` bonus blocks both award and forfeit until RBTS settlement completes.

### REPO-POST-2026-07-02-2 - Domain 1/2/4 payout roots can be consumed before the veto window

Severity: Medium

Evidence:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:51-55` defines a 7-day `FINALIZATION_VETO_WINDOW`.
- `packages/foundry/contracts/ClusterPayoutOracle.sol:680-692` rejects arbiter veto once the configured consumer reports the snapshot consumed.
- Domain 3 public-rating snapshots wait past the veto window at `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:310-312`.
- Domain 5 RBTS settlement snapshots wait past the veto window at `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:51-53`.
- Domain 1 question reward snapshots can qualify/claim as soon as finalized through `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:816-820`.
- Domain 4 bundle rewards and domain 2 launch credits have first-use consumed paths in `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:587` and `packages/foundry/contracts/LaunchDistributionPool.sol:751`.

Impact:

A bad but structurally valid domain 1/2/4 root that survives the short challenge window can be self-consumed immediately. Once consumed, `rejectFinalizedRoundPayoutSnapshot` reverts `SnapshotConsumed`, so the 7-day arbiter backstop can collapse before the full veto window elapses. Under the redeploy assumption this is current behavior, not a legacy migration issue.

Recommendation:

Gate first-consuming actions for domains 1, 2, and 4 until `finalizedAt + FINALIZATION_VETO_WINDOW`, matching domains 3 and 5, or explicitly permit within-window rejection with a defined recovery path after first use. Add tests proving first claim/record cannot consume a finalized domain 1/2/4 root inside the veto window.

### REPO-POST-2026-07-02-3 - RBTS timeout can bypass an available forfeiting settlement snapshot

Severity: Medium

Evidence:

- `packages/foundry/contracts/RoundVotingEngine.sol:924-930` moves ordinary non-tied rounds to `SettlementPending` and pins the settlement oracle.
- `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol:39-47` lets empty `payoutWeights` and `proofs` trigger the timeout branch after `roundClusterPayoutReadyAt + RBTS_SETTLEMENT_SNAPSHOT_TIMEOUT`.
- The timeout branch returns RBTS stakes and completes settlement with zero forfeits.
- The normal branch at `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol:50-74` applies finalized domain-5 weights and can enable score-spread forfeits.

Impact:

After the 14-day timeout, a forfeit-liable voter can race the honest snapshot applier with `applyRbtsSettlementSnapshot(contentId, roundId, [], [])` and force participation-only settlement, even if a valid finalized domain-5 snapshot exists and would have enabled forfeits. The risk is a liveness/ops dependency: forfeiture enforcement depends on the correlation pipeline finishing and applying before timeout.

Recommendation:

Before allowing the timeout branch, query the pinned oracle for a viable finalized domain-5 snapshot and block timeout while such a snapshot, proposal, or challenge is live. Alternatively extend the timeout while the oracle path is active. Add keeper alerts well before the timeout edge.

### REPO-POST-2026-07-02-4 - Generated `QuestionRewardPoolEscrow` ABIs are stale

Severity: Medium

Evidence:

- Current Solidity declares `RecoveredSnapshotRoundAbandoned` at `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:214`.
- Current Solidity declares `refundExpiredRecoveredRewardPool` at `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1151`.
- Current Solidity declares `refundInactiveRecoveredRewardPool` at `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1170`.
- `rg` finds none of those names in `packages/contracts/src/abis/QuestionRewardPoolEscrowAbi.ts`, `packages/contracts/src/deployedContracts.ts`, or `packages/ponder/src/questionRewardPoolEscrowIndexerAbi.ts`.
- A read-only comparison against `packages/foundry/out/QuestionRewardPoolEscrow.sol/QuestionRewardPoolEscrow.json` showed the Foundry artifact has 103 ABI entries while the generated TS ABI has 100; the three missing entries are exactly the two new functions and one event above.
- `yarn workspace @rateloop/contracts test` still passes, so the current contracts-package ABI tests do not catch this specific drift.

Impact:

After redeploy, frontend, SDK, governance tooling, and indexers that import `@rateloop/contracts` or the checked-in indexer ABI cannot call the new recovered-pool refund exits or decode `RecoveredSnapshotRoundAbandoned`.

Recommendation:

Regenerate `packages/contracts/src/abis/QuestionRewardPoolEscrowAbi.ts`, `packages/contracts/src/deployedContracts.ts`, and `packages/ponder/src/questionRewardPoolEscrowIndexerAbi.ts` from the current Foundry artifact. Add ABI invariant tests for these recovered-pool functions/events.

### REPO-POST-2026-07-02-5 - Full Foundry gate is still red in gas fixtures

Severity: Medium

Evidence:

- `forge test --offline` from `packages/foundry` compiled successfully but exited nonzero: 1,810 passed, 6 failed.
- Failing tests:
  - `test/GasBudget.t.sol:GasBudgetTest.testGas_processUnrevealedVotes_underBudget`
  - `test/GasBudget.t.sol:GasBudgetTest.testGas_settleRound_100Voters_underWorldChainBlockLimit`
  - `test/GasBudget.t.sol:GasBudgetTest.testGas_settleRound_200Voters_underWorldChainBlockLimit`
  - `test/GasBudget.t.sol:GasBudgetTest.testGas_settleRound_maxEpochScan_underBudget`
  - `test/GasBudget.t.sol:GasBudgetTest.testGas_settleRound_underBudget`
  - `test/GasEstimatesReport.t.sol:UserTransactionGasEstimatesTest.testGasEstimate_settleRound_logs`
- A targeted `-vvv` rerun showed `settleRound` reading `ProtocolConfig.clusterPayoutOracle() == address(0)` and reverting `InvalidAddress()`.
- The deploy script does wire a cluster payout oracle for fresh deployments, so this is a test/gas-harness inconsistency rather than evidence of missing production deployment wiring.

Impact:

The full Solidity suite cannot be used as a clean release gate. The failure also leaves gas-budget coverage blind for the current settlement path, which now depends on the cluster payout oracle and `SettlementPending` lifecycle.

Recommendation:

Update the gas setup helpers to install the same test cluster payout oracle/module wiring used by the normal settlement helpers, then measure the intended calls. Add an assertion that the gas harness starts with a nonzero `clusterPayoutOracle` before measuring `settleRound`.

### REPO-POST-2026-07-02-6 - Frontend operator docs still call `settleRound` final settlement

Severity: Low

Evidence:

- `packages/nextjs/app/(public)/docs/frontend-codes/page.tsx:178-181` says the service calls `settleRound(contentId, roundId)` "to finalize the round, record pending public-rating evidence, and prepare rewards for claiming".
- Current `settleRound` moves non-tied rounds to `SettlementPending` at `packages/foundry/contracts/RoundVotingEngine.sol:924-930`.
- Actual final `Settled` state and settlement side effects happen later in `packages/foundry/contracts/libraries/RoundRbtsSettlementCompletionLib.sol:82-104`.

Impact:

Operator docs can lead keepers or manual operators to think payout snapshots are published after final settlement, when snapshots are now required to complete RBTS-backed final settlement.

Recommendation:

Rewrite that section to distinguish public-verdict closure from reward finality: `settleRound` closes the public verdict and enters `SettlementPending`; operators then publish/apply RBTS and public-rating snapshots; `applyRbtsSettlementSnapshot` completes LREP settlement and emits the final settlement side effects.

## Prior Findings Rechecked

The earlier `docs/repo-bug-inconsistency-audit-2026-07-02.md` contains several findings that now appear fixed on current `main`:

- Reward-pool cursors now treat `SettlementPending` as unfinished in `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:455-457`.
- Bundle terminal sync now excludes `SettlementPending` in `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:1858-1859`.
- RBTS candidate discovery includes finalized snapshots in `packages/ponder/src/api/routes/correlation-routes.ts:827-833`.
- Domain-5 RBTS settlement rejects zero effective payout leaves in `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:76-80`.
- Compact `roundCore` parsing now preserves the trailing `upWins` flag in `packages/nextjs/lib/contracts/roundVotingEngine.ts:225-236`, with a test in `packages/nextjs/lib/contracts/roundVotingEngine.test.ts:151-158`.
- The MCP bounty eligibility schema no longer materializes `default: 0` and now documents the conditional default at `packages/nextjs/lib/agent/schemas.ts:233-238`.
- Public agent docs now describe the threshold as `500 USDC/LREP (500,000,000 atomic units)`.
- `make check-storage-layouts` now passes for all pinned storage snapshots.
- `yarn dead-code` is clean.

## Verification Results

Passed:

- `git diff --check`
- `make check-storage-layouts` from `packages/foundry`
- `make check-contract-sizes` from `packages/foundry`
- `yarn dead-code`
- `yarn workspace @rateloop/contracts test` - 44 tests passed
- `yarn workspace @rateloop/nextjs check-types`
- `yarn workspace @rateloop/ponder check-types`
- `yarn workspace @rateloop/keeper check-types`

Failed / completed with findings:

- `forge test --offline` from `packages/foundry` - 1,810 passed, 6 failed; all failures are gas-budget/estimate tests whose measured settlement calls revert because the gas fixtures have no configured cluster payout oracle.
- Targeted rerun:
  `forge test --offline --match-contract "GasBudgetTest|UserTransactionGasEstimatesTest" --match-test "testGas_processUnrevealedVotes_underBudget|testGas_settleRound_100Voters_underWorldChainBlockLimit|testGas_settleRound_200Voters_underWorldChainBlockLimit|testGas_settleRound_maxEpochScan_underBudget|testGas_settleRound_underBudget|testGasEstimate_settleRound_logs" -vvv`
  reproduced the same 6 failures and showed the `InvalidAddress()` source.

## Non-Issues Checked

- Fresh deployment wiring for `RoundVotingEngineRbtsSettlementModule`, the cluster payout oracle, public-rating consumer, and RBTS settlement consumer exists in `packages/foundry/script/Deploy.s.sol`.
- Default-profile Forge code-size warnings are not deploy-profile blockers; `make check-contract-sizes` reports all checked deploy-profile contracts under EIP-170.
- Hot-upgrade storage compatibility from old deployed contracts is out of scope under the requested full-redeploy assumption.

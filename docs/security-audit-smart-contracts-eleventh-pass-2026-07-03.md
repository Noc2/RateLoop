# RateLoop Smart Contracts - Eleventh-Pass Security Audit

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `cc411f4f2` (`docs: keep only latest non-contract report`)
**Contract tree note:** no `packages/foundry/contracts` or `packages/foundry/test` files changed between the latest contract-review head `a732991cb` and `cc411f4f2`.
**Recent smart-contract changes reviewed:** the oracle/frontend dispute gate that closes 6P-5 and the governor proposer-lock hardening that closes 10P-1.

## Scope

This was a security-focused pass over the committed smart-contract tree under `packages/foundry`. No contract code was changed in this pass.

The review focused on the newest and highest-risk areas:

- `ClusterPayoutOracle` challenge/finalize/reject paths and the new frontend dispute recorder integration.
- `FrontendRegistry` fee withdrawal, deregistration, slashing, and snapshot-dispute accounting.
- `RateLoopGovernor` and `LoopReputation` proposer/voter lock behavior after the 10P-1 fix.
- `QuestionRewardPoolEscrow` cluster snapshot recovery/qualification, bundle recovery, and payout-consumer paths.
- `RoundVotingEngine`, RBTS settlement, registry/config wiring, X402 submission, confidentiality, launch distribution, and feedback bonus flows.

Three parallel read-only sub-agent sweeps were used as side-channel review over the oracle/frontend surface, reward-pool/snapshot consumers, and governance/config/non-oracle core paths. The lead pass independently rechecked every item included below.

## Executive Summary

No High-severity issue was found.

The 6P-5 fee-withdrawal/slash-latency gap is closed on current `main`: fee withdrawal completion and deregistration completion now fail while the operator has an open oracle snapshot dispute. That is the right accountability direction, but it leaves a new Medium-severity liveness/griefing risk: a cheap frivolous challenge can freeze the operator's fee withdrawal and exit until the arbiter resolves it, with no timeout or permissionless dismissal.

One governance-runbook Low and one governance-hardening Low were also found:

- Rotating the oracle's `FrontendRegistry` pointer or dispute-recorder role while disputes are open can strand existing dispute counts.
- `RoundVotingEngine.setRbtsSettlementModule` accepts any contract with code before later `delegatecall`ing it.

The prior 10P-1 proposer self-cancel accounting issue is fixed: current code stores `proposalLockedAmount[proposalId]` and releases that exact amount on pending self-cancel.

## Findings

### 11P-1 (Medium, confidence High). Frivolous oracle challenges can freeze frontend withdrawals and exits indefinitely

**Where:** `packages/foundry/contracts/ClusterPayoutOracle.sol:374-392`, `packages/foundry/contracts/ClusterPayoutOracle.sol:607-628`, `packages/foundry/contracts/ClusterPayoutOracle.sol:413-447`, `packages/foundry/contracts/ClusterPayoutOracle.sol:658-736`, `packages/foundry/contracts/FrontendRegistry.sol:347-364`, and `packages/foundry/contracts/FrontendRegistry.sol:415-424`.

`challengeCorrelationEpoch` and `challengeRoundPayoutSnapshot` allow any disinterested address to challenge a proposed snapshot during the challenge window by posting the proposal's challenge bond. The default bond is 5 USDC (`DEFAULT_CHALLENGE_BOND = 5e6`). Once challenged, the oracle increments `FrontendRegistry.openSnapshotDisputeCount` for the frontend operator.

`FrontendRegistry.completeFeeWithdrawal` and `completeDeregister` now call `_requireNoOpenSnapshotDispute`, so a challenged snapshot blocks completion of both a matured fee withdrawal and a matured deregistration. The issue is that the only normal challenge-resolution paths are arbiter-only: `finalizeChallengedCorrelationEpoch`, `rejectCorrelationEpoch*`, `finalizeChallengedRoundPayoutSnapshot`, and `rejectRoundPayoutSnapshot*`. `_challengeDeadline` only bounds when a challenge can be filed; it does not bound how long a challenged snapshot can remain challenged.

**Impact:** a competitor or other disinterested griefer can spend the anti-spam bond to freeze an honest frontend's earned-fee withdrawal and 14-day exit until the arbiter acts. If the arbiter is slow, unavailable, or operationally paused, the freeze is unbounded. The griefer forfeits only the challenge bond if dismissed. There is no direct theft path and governance can resolve the dispute, so this is Medium rather than High.

**Recommended fix:** make the new dispute freeze bounded. A robust shape is to store `challengedAt` and add a permissionless expiry after a governance-configured maximum resolution window. On expiry, close the frontend dispute and move the snapshot to a non-consuming terminal state, such as metadata-only rejected/expired without blacklisting the deterministic root, so an invalid challenged root is not silently consumed but an honest frontend is not frozen forever. Add tests that a frivolous challenge blocks completion during the resolution window and unblocks completion after expiry.

An emergency governance clear path can be useful too, but should not be the only protection; the current issue is specifically arbiter/governance liveness.

### 11P-2 (Low, confidence High). Oracle registry rotation can strand open dispute counts

**Where:** `packages/foundry/contracts/ClusterPayoutOracle.sol:275-276`, `packages/foundry/contracts/ClusterPayoutOracle.sol:1398-1404`, `packages/foundry/contracts/ClusterPayoutOracle.sol:1406-1432`, and `packages/foundry/contracts/FrontendRegistry.sol:613-629`.

`ClusterPayoutOracle` opens and closes disputes by calling the currently configured `frontendRegistry`. `setFrontendRegistry` can change that pointer through `CONFIG_ROLE` and does not check whether any challenges are open. If a challenge is open against registry A and governance/config rotates the oracle to registry B before the challenge is closed, the eventual close call routes to B, where the open count was never incremented and `recordSnapshotDisputeClosed` reverts `NoOpenSnapshotDispute`. A similar stranding can happen if registry A revokes the old oracle's `SNAPSHOT_DISPUTE_RECORDER_ROLE` before all challenges are drained.

**Impact:** privileged misconfiguration can permanently brick an operator's withdrawal/exit gate in the old registry. This is not an unprivileged attack, but it is a sharp governance-operation hazard with no on-chain recovery hook today.

**Recommended fix:** either prevent oracle/registry rotation while any snapshot dispute is open, or add an explicit governance-only `adminClearSnapshotDispute`/migration path with events and a runbook requirement to drain challenges before changing recorder wiring. If 11P-1 adds a global open-dispute counter or challenged-at expiry, reuse that state to make this rotation guard mechanical.

### 11P-3 (Low, confidence High). RBTS settlement module setter has no compatibility marker before delegatecall

**Where:** `packages/foundry/contracts/RoundVotingEngine.sol:785-807` and `packages/foundry/contracts/RoundVotingEngineStorage.sol:11-12`.

`RoundVotingEngine.setRbtsSettlementModule` is admin-only, but `_setRbtsSettlementModule` only checks that the address is nonzero and has code. Later RBTS settlement dispatches to the module with raw `delegatecall`. `RoundVotingEngineStorage` documents that the engine and settlement module share storage layout, so an incompatible or malicious module can corrupt storage, brick settlement, or move accounted LREP if configured by mistake or by compromised governance.

**Impact:** no public attacker path was found, so Low. The risk is deploy/governance safety around a delegatecall module with layout-sensitive authority.

**Recommended fix:** require a module compatibility marker before accepting it, such as a `moduleKind()`/`storageLayoutVersion()` getter returning a known constant, and add tests that an arbitrary contract with code is rejected. A stricter option is to make the module immutable or one-way-freezeable after deployment.

## Verified Fixes And Non-Findings

### 6P-5 fee-withdrawal/slash-latency gap is closed

Current `FrontendRegistry` tracks open snapshot disputes through `recordSnapshotDisputeOpened` and `recordSnapshotDisputeClosed` behind `SNAPSHOT_DISPUTE_RECORDER_ROLE` (`FrontendRegistry.sol:613-629`). `completeDeregister` calls `_requireNoOpenSnapshotDispute` after unbonding and fee review have matured (`FrontendRegistry.sol:347-364`), and `completeFeeWithdrawal` does the same after the one-hour withdrawal delay (`FrontendRegistry.sol:415-424`).

Focused regression tests cover both gates: `test_OpenSnapshotDisputeBlocksMaturedFeeWithdrawalUntilClosed` and `test_OpenSnapshotDisputeBlocksDeregisterCompletionUntilClosed` (`packages/foundry/test/FrontendRegistry.t.sol:1035-1098`). Those tests passed in the focused Foundry run.

This closes the original "earned fees leave before any slash can execute" issue for live challenged proposals. Finding 11P-1 is the remaining liveness tradeoff from that fix.

### 10P-1 proposer self-cancel release bug is fixed

`RateLoopGovernor` now stores the threshold locked at proposal creation in `proposalLockedAmount` (`RateLoopGovernor.sol:81-82`, `RateLoopGovernor.sol:300-324`). Pending proposer self-cancel reads and deletes that exact stored amount before releasing the governance lock (`RateLoopGovernor.sol:244-263`).

Regression tests cover cancellation after both proposal-threshold increases and decreases (`packages/foundry/test/Governance.t.sol:856-905`). Those tests passed in the focused Foundry run.

### Recovered cluster snapshot reopening did not produce a fresh finding

A sub-agent flagged recovered snapshot reopening as the main reward-pool area to recheck. Current code already performs the important alignment checks before reopening:

- `reopenRecoveredSnapshotRound` requires a finalized replacement snapshot, outside the veto window, with the correct consumer, non-stale source timing, unrejected digest/root, matching raw eligible voter count, and a successful `previewRoundQualificationWithClusterSnapshot` result (`QuestionRewardPoolEscrowRecoveryLib.sol:268-319`).
- The actual cluster qualification path repeats finalization, consumer, source, raw-voter, effective-unit, total-weight, and allocation checks before writing the qualified snapshot (`QuestionRewardPoolEscrowQualificationLib.sol:278-361`, `QuestionRewardPoolEscrowQualificationLib.sol:746-817`).

No direct loss, double-claim, or stuck-funds path was confirmed in the current implementation.

### Governance and X402 sweeps did not find a public bypass

The governance/config sub-agent found no public attacker path in the reviewed X402/EIP-3009 submission flow. The submitter checks USDC-only funding, exact payee/value/nonce, exact token receipt, stale escrow, and zero residual balance; the nonce binds chain, registry, gateway, escrow addresses, payment terms, payload, round config, confidentiality, and spec hashes.

The same sweep found no stale-engine bypass for fresh submissions or feedback-bonus creation, and no issue in `ConfidentialityEscrow.confidentialityEscrowConfigShape()`.

### External research

I reviewed the current OpenZeppelin Contracts security-advisory index and OpenZeppelin governance documentation. No new applicable High or Medium issue surfaced from dependency research. The known OpenZeppelin Governor proposal-creation front-run class remains relevant background, and RateLoop's enforced `#proposer=0x...` description suffix addresses that class in `RateLoopGovernor._isValidDescriptionForProposer` (`RateLoopGovernor.sol:332-359`).

Sources:

- OpenZeppelin Contracts advisories: https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories
- OpenZeppelin Governance docs: https://docs.openzeppelin.com/contracts/5.x/governance

## Tooling And Verification

Commands were run against the same contract tree reviewed here. The later `main` commits before this report were documentation-only.

| Command | Result |
| --- | --- |
| `slither .` from `packages/foundry` | Passed: 168 contracts, 35 detectors, 0 results |
| `forge test --offline --match-contract 'FrontendRegistryTest|ClusterPayoutOracleTest|GovernanceTest|LoopReputationTest' -vv` | Passed: 246 tests, 0 failed |
| `forge test --offline --match-contract 'QuestionRewardPoolEscrowTest|LaunchDistributionPoolTest|RoundRewardDistributorBranchesTest|RoundRewardDistributorBannedRewardTest|RaterRegistryTest|RoundIntegrationTest|RoundVotingEngineBranchesTest|FeedbackBonusEscrowTest|ConfidentialityEscrowTest|X402QuestionSubmitterTest|SecondPassRatingSnapshotOrderingTest|SecondPassRbtsSettlementOracleTest|SecondPassRecoveredRewardPoolTest' -vv` | Passed: 770 tests, 0 failed |
| `make check-storage-layouts` from `packages/foundry` | Passed: all pinned storage layouts matched |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` from `packages/foundry` | Passed after a serial rerun; checked deploy-profile contracts remained under EIP-170 |
| `yarn foundry:aderyn` | Completed with 0 High findings and broad Low/static categories only |
| `forge test --offline` from `packages/foundry` | Did not complete: full-suite compile hit the existing `FormalVerification_RoundLifecycle.t.sol:20` stack-too-deep/codegen error |

## Priorities

1. Bound challenged-snapshot freezes so fee withdrawals and exits cannot depend indefinitely on arbiter liveness.
2. Add a mechanical guard or recovery path for oracle/frontend-registry rotation while disputes are open.
3. Add an RBTS settlement module compatibility marker before accepting a delegatecall module.
4. Keep the focused dispute-gate, governor-lock, reward-pool, and oracle suites in the pre-deploy gate; separately fix the full-suite stack-too-deep compile blocker so `forge test --offline` can be used as the broad green gate.

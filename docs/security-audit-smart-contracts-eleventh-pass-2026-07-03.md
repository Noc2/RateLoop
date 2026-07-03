# RateLoop Smart Contracts - Eleventh-Pass Security Audit

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `ecef9d12f` (`chore(contracts): sync base deployment exports`)
**Last Solidity remediation reviewed:** `b0bb6adc5` (`fix(rewards): align bundle claimable completeness`)
**Post-remediation export sync:** `ecef9d12f` updated deployment/ABI exports and generation tests; no Solidity source changed after `b0bb6adc5`.
**Report status:** findings from this pass were remediated in separate commits before this final report update.

## Scope

This was a security-focused pass over the committed smart-contract tree under `packages/foundry`, with extra attention on the newest accountability changes:

- `ClusterPayoutOracle` challenge/finalize/reject paths and frontend dispute-recorder integration.
- `FrontendRegistry` fee withdrawal, deregistration, slashing, and snapshot-dispute accounting.
- `RateLoopGovernor` and `LoopReputation` governance lock behavior.
- `QuestionRewardPoolEscrow` cluster snapshot recovery, bundle recovery, bundle claimability, and payout consumers.
- `RoundVotingEngine` RBTS settlement module wiring.
- X402 submission, confidentiality, launch distribution, feedback bonus, and config/rotation paths.

Three parallel read-only sub-agent sweeps covered oracle/frontend, reward-pool/snapshot-consumer, and governance/config/non-oracle surfaces. The lead pass independently rechecked every reportable item and the remediation diffs.

## Executive Summary

No High-severity issue was found.

This pass found one Medium and three Low issues. All four were fixed before finalizing this report:

- **11P-1 Medium:** live snapshot challenges could freeze frontend fee withdrawals and exits indefinitely if the arbiter did not resolve them. Fixed in `1bae59ec4` by bounding challenged snapshot finalization.
- **11P-2 Low:** oracle/registry rotation or recorder-role revocation during live disputes could strand dispute counts. Fixed in `dc76f573d` plus storage/test sync in `e1a11c89c`.
- **11P-3 Low:** RBTS settlement module rotation accepted any contract with code before later `delegatecall`. Fixed in `7ac3ad169` with a module marker check.
- **11P-4 Low:** the unqualified bundle claimable view could preview a round set using nonzero round IDs instead of the same recorded-round-set completeness gate used by settlement. Fixed in `b0bb6adc5`.

The prior 10P-1 proposer self-cancel accounting issue is closed, and `336d89e6b` further hardens governance lock accounting by splitting proposal and vote locks instead of relying on one aggregate lock ledger.

## Remediated Findings

### 11P-1 (Medium, fixed). Frivolous oracle challenges could freeze frontend withdrawals and exits indefinitely

**Original issue:** `challengeCorrelationEpoch` and `challengeRoundPayoutSnapshot` incremented the frontend operator's open dispute count, and `FrontendRegistry.completeFeeWithdrawal` / `completeDeregister` correctly blocked while that count was nonzero. Before the fix, a challenged snapshot depended only on arbiter action for resolution, so a cheap frivolous challenge could freeze a frontend's matured fee withdrawal or exit indefinitely.

**Fix:** `1bae59ec4` makes challenged epoch and round payout finalization bounded. Arbiters can still resolve challenged snapshots immediately. A non-arbiter can finalize a challenged snapshot only after the proposal-scoped challenge window plus finalization-veto window has elapsed (`ClusterPayoutOracle.sol:397-417`, `ClusterPayoutOracle.sol:638-665`). This closes the unbounded freeze while preserving a deterministic challenge-resolution window.

**Residual tradeoff:** if a challenge is legitimate, the arbiter must reject before the resolution deadline or the optimistic proposer wins. That is an operational SLA, not an indefinite liveness dependency.

### 11P-2 (Low, fixed). Oracle/registry rotation could strand open dispute counts

**Original issue:** the oracle opened and closed disputes through its current `frontendRegistry` pointer. If config rotated the registry pointer, or if the registry revoked the old oracle's recorder role while that oracle still had open disputes, the close path could route to the wrong registry or lose permission to decrement the old count.

**Fix:** `dc76f573d` adds an oracle-side open dispute counter and blocks `setFrontendRegistry` while any dispute is open (`ClusterPayoutOracle.sol:1405-1423`). It also tracks open disputes by recorder in `FrontendRegistry`, requires a dispute to close through the recorder that opened it, and blocks recorder-role revoke/renounce while that recorder has open disputes (`FrontendRegistry.sol:107-114`, `FrontendRegistry.sol:181-196`, `FrontendRegistry.sol:623-642`). `e1a11c89c` syncs the storage-layout guard for the new registry slots.

### 11P-3 (Low, fixed). RBTS settlement module setter accepted arbitrary code before delegatecall

**Original issue:** `RoundVotingEngine.setRbtsSettlementModule` was admin-only but accepted any nonzero contract with code. Settlement later dispatches with `delegatecall`, so a mistaken module could corrupt shared storage or brick settlement.

**Fix:** `7ac3ad169` adds `RATELOOP_RBTS_SETTLEMENT_MODULE_MARKER` to the module and requires the marker before accepting a module address (`RoundVotingEngine.sol:30-60`, `RoundVotingEngine.sol:792-804`). The regression test rejects unmarked code.

### 11P-4 (Low, fixed). Bundle claimable preview used a weaker completeness gate than the bundle settlement path

**Original issue:** the unqualified bundle claimable preview checked for nonzero round IDs to decide whether a pending round set could be previewed. The settlement path uses recorded-round counters, which are stricter and represent the actual synced completion state. No payout bypass was confirmed, but the public view could overstate claimability for an incompletely recorded round set.

**Fix:** `b0bb6adc5` threads `bundleQuestionRecordedRounds` into `QuestionRewardPoolEscrowBundleClaimableLib` and uses `QuestionRewardPoolEscrowBundleLib.isRoundSetComplete` for pending previews (`contracts/libraries/QuestionRewardPoolEscrowBundleClaimableLib.sol:30-45`, `contracts/libraries/QuestionRewardPoolEscrowBundleClaimableLib.sol:142-164`).

## Verified Fixes And Non-Findings

### 6P-5 fee-withdrawal/slash-latency gap remains closed

`FrontendRegistry` tracks open snapshot disputes, and both fee-withdrawal completion and deregistration completion fail while an operator has a live dispute. The 11P-1 fix now bounds that freeze instead of leaving it fully arbiter-liveness-dependent.

### 10P-1 governance self-cancel accounting remains closed

The earlier exact-amount release issue is fixed, and the newer split-lock change makes proposal locks and vote locks source-aware. This avoids the aggregate-lock ambiguity that made the original threshold-change edge case possible.

### Recovered cluster snapshot reopening did not produce a fresh issue

`reopenRecoveredSnapshotRound` already requires finalized replacement snapshots, consumer/source readiness, unrejected digest/root, raw-voter agreement, and successful replacement qualification preview before reopening. The actual qualification path repeats the finalization, consumer, source, voter, effective-unit, total-weight, and allocation checks before writing a qualified snapshot.

### Governance and X402 sweeps did not find a public bypass

No public attacker path was found in the reviewed X402/EIP-3009 submission flow. The submitter checks USDC-only funding, exact payee/value/nonce, exact token receipt, stale escrow, and zero residual balance; the nonce binds chain, registry, gateway, escrow addresses, payment terms, payload, round config, confidentiality, and spec hashes.

### External research

I reviewed the current OpenZeppelin Contracts security-advisory index and OpenZeppelin governance documentation. No new applicable High or Medium issue surfaced from dependency research. The known OpenZeppelin Governor proposal-creation front-run class remains relevant background, and RateLoop's enforced `#proposer=0x...` description suffix addresses that class.

Sources:

- OpenZeppelin Contracts advisories: https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories
- OpenZeppelin Governance docs: https://docs.openzeppelin.com/contracts/5.x/governance

## Tooling And Verification

Post-remediation verification:

| Command | Result |
| --- | --- |
| `slither .` from `packages/foundry` | Passed: 169 contracts, 35 detectors, 0 results |
| `forge test --offline --match-contract 'FrontendRegistryTest|ClusterPayoutOracleTest' -vv` | Passed: 174 tests, 0 failed |
| `forge test --offline --match-contract RoundVotingEngineBranchesTest -vv` | Passed: 177 tests, 0 failed |
| `forge test --offline --match-contract 'QuestionRewardPoolEscrowTest|SecondPassRecoveredRewardPoolTest' -vv` | Passed: 213 tests, 0 failed |
| `forge test --offline --match-contract 'FrontendRegistryTest|ClusterPayoutOracleTest|GovernanceTest|LoopReputationTest' -vv` | Passed: 248 tests, 0 failed |
| `make check-storage-layouts` from `packages/foundry` | Passed after syncing the intentional `FrontendRegistry` layout snapshot |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` from `packages/foundry` | Passed; tightest contracts were `QuestionRewardPoolEscrow` at 24,576 bytes, `LaunchDistributionPool` at 24,555, `ContentRegistry` at 24,519, and `ClusterPayoutOracle` at 24,455 |
| `yarn foundry:generate-ts-abis:test` | Passed: 24 tests, 0 failed |
| `yarn foundry:aderyn` | Completed earlier in the audit with 0 High findings and broad Low/static categories only |

Known residual tooling caveat: full unfiltered `forge test --offline` still hits the existing `FormalVerification_RoundLifecycle.t.sol:20` stack-too-deep/codegen compile blocker, so the full suite is not yet usable as the broad green gate.

## Priorities

1. Keep the challenge-resolution deadline operationally monitored; valid challenges now need arbiter action before the optimistic timeout.
2. Watch contract-size headroom. `QuestionRewardPoolEscrow` is exactly at the EIP-170 limit in deploy profile.
3. Fix the full-suite stack-too-deep compile blocker so `forge test --offline` can return to being the broad contract verification gate.

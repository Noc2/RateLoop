# Repo Bug and Inconsistency Audit - 2026-07-02

Scope: current local `main` through `19407e82d` (the parent of this report commit), covering recent RBTS settlement, keeper/Ponder, app, agent, docs, and generated contract updates after `0b8ededc9`. During review, three follow-up commits landed ahead of the initial remote baseline: `523c1bf84 contracts: guard consumed child roots on parent veto`, `ee9b06bb8 keeper: advance reward qualification cursors`, and `19407e82d ponder: filter skipped reward qualification work`.

Method: read-only manual review plus parallel subagent passes over contracts, keeper/Ponder, and frontend/agent/docs. No source code was changed for this report.

## Summary

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| REPO-2026-07-02-1 | High | Contracts | `SettlementPending` rounds can be skipped by the reward-pool cursor before they become qualifiable. |
| REPO-2026-07-02-2 | High | Keeper/Ponder | Finalized RBTS settlement snapshots drop out of automatic keeper discovery before the keeper can apply them. |
| REPO-2026-07-02-3 | High | Verification | Current `main` has a red Solidity verification baseline: full Foundry and storage-layout checks fail. |
| REPO-2026-07-02-4 | Medium | Contracts | Zero effective RBTS snapshot leaves can strand revealed voters' principal if accepted on-chain. |
| REPO-2026-07-02-5 | Medium | Frontend/contracts | Compact `roundCore` parsing ignores the trailing `upWins` value and docs name the fifth tuple value incorrectly. |
| REPO-2026-07-02-6 | Medium | MCP/agents | MCP schema default can make recapture-sized asks fail even though omitted eligibility would succeed. |
| REPO-2026-07-02-7 | Low | Agent docs | Public/agent docs describe the 500-token threshold as "500 atomic units". |
| REPO-2026-07-02-8 | Low | Maintenance | Dead-code scan reports unused exports and a newly unused RBTS settlement module ABI file. |

## Findings

### REPO-2026-07-02-1 - `SettlementPending` rounds can be skipped before qualification

Severity: High

Evidence:

- `packages/foundry/contracts/RoundVotingEngine.sol:924` moves a round into `SettlementPending` after public verdict closure while RBTS waits for the oracle-backed settlement snapshot.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:455` returns `roundFinished=true, canQualify=false` for any state that is not `Open` and not `Settled`.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:153` advances `nextRoundToEvaluate` whenever `roundFinished && !canQualify`.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:192` later requires ordinary `qualifyRound` calls to match the cursor exactly.
- `ee9b06bb8` adds keeper support for expected `advanceQualificationCursor` calls, but the contract-side classification at `QuestionRewardPoolEscrowQualificationLib.sol:455-457` is unchanged and remains permissionless.
- `19407e82d` filters already-skipped reward-pool work in Ponder, but it does not change the contract cursor behavior above.

Scenario:

1. Round `N` reaches reveal quorum and `settleRound()` changes it from `Open` to `SettlementPending`.
2. Before the RBTS settlement snapshot is finalized/applied, anyone calls `advanceQualificationCursor(rewardPoolId, 1)`.
3. The cursor treats `SettlementPending` as finished but not qualifiable, then advances to `N + 1`.
4. Once RBTS settlement completes, `qualifyRound(rewardPoolId, N)` reverts with `"Round out of order"`.

Impact: a permissionless call can permanently skip an otherwise qualifying bounty round during the normal oracle wait. This can block voters from USDC bounty qualification for that round.

Recommendation: treat `SettlementPending` as unfinished for reward-pool cursor advancement, or add a dedicated state check that only skips truly terminal non-qualifying states. Add a regression test that tries to advance a reward-pool cursor while a round is `SettlementPending`.

### REPO-2026-07-02-2 - Finalized RBTS snapshots drop out before automatic apply

Severity: High

Evidence:

- `packages/ponder/src/api/routes/correlation-routes.ts:827` selects RBTS candidates only while rounds are `SettlementPending` and `rbtsSettlementStatus = "pending"`.
- `packages/ponder/src/api/routes/correlation-routes.ts:830` includes missing, proposed, and rejected snapshot rows, but omits `SNAPSHOT_STATUS_FINALIZED`.
- The public-rating candidate route does include finalized rows at `packages/ponder/src/api/routes/correlation-routes.ts:784`.
- The keeper waits for finalized RBTS snapshots and then waits out the veto window before applying at `packages/keeper/src/correlation-snapshots.ts:904` and `packages/keeper/src/correlation-snapshots.ts:914`.
- The actual apply call happens at `packages/keeper/src/correlation-snapshots.ts:967`.
- The veto window is 7 days in `packages/foundry/contracts/ClusterPayoutOracle.sol:57`.

Scenario:

1. A round enters `SettlementPending`.
2. Ponder surfaces it, and the keeper proposes/finalizes the domain-5 RBTS settlement snapshot.
3. The keeper skips immediate apply until `finalizedAt + FINALIZATION_VETO_WINDOW`.
4. After Ponder indexes `RoundPayoutSnapshotFinalized`, the same round no longer appears in `/correlation/rbts-settlement-round-candidates`.
5. Later automatic ticks have no candidate/artifact path to call `applyRbtsSettlementSnapshot`.

Impact: rounds can remain `SettlementPending` indefinitely unless an operator manually reuses an old artifact/file-mode path after the veto window.

Recommendation: include `SNAPSHOT_STATUS_FINALIZED` in the RBTS candidate query, as the public-rating route already does, and let `rbtsSettlementStatus` plus `isRoundPayoutSnapshotConsumed` stop rows after apply. Consider persisting enough finalized-artifact metadata for an apply-only queue.

### REPO-2026-07-02-3 - Current Solidity verification baseline is red

Severity: High

Evidence:

- `forge test --offline` compiled successfully but exited nonzero with 371 failing tests and 1,438 passing tests; a current-head `forge test --offline --rerun` still exits nonzero with 371 failing tests and 1,439 passing tests.
- Dominant failure classes include `InvalidAddress`, `RoundNotOpen`, `UnrevealedPastEpochVotes`, `Verified bounty required`, and a storage sentinel assertion in `test_VotingEngine_LateStorageLayoutSlotsStayStable`.
- Many settlement tests still assume `settleRound()` can finalize without a configured cluster payout oracle, but `packages/foundry/contracts/RoundVotingEngine.sol:926` now requires `protocolConfig.clusterPayoutOracle()` and reverts at `:927` when it is unset.
- The deploy script does wire the module and oracle for fresh deployments at `packages/foundry/script/Deploy.s.sol:128`, `:179`, `:382`, and `:396`, so this is mostly a repo verification/test-harness inconsistency rather than proof of a missing fresh-deploy step.
- `make check-storage-layouts` fails for `RoundVotingEngine` because current code inserts `roundRbtsSettlementOracle`, `roundRbtsSettlementSnapshotDigest`, and `rbtsSettlementModule` while `packages/foundry/scripts/expected-storage-layouts/RoundVotingEngine.json` still has the previous layout.
- The dedicated storage sentinel still writes old slots at `packages/foundry/test/UpgradeTest.t.sol:447`.
- `523c1bf84` adds contract tests for consumed child roots on parent veto, but does not update the expected storage layout snapshot or the stale settlement harness assumptions.
- `19407e82d` adds Ponder tests for skipped reward qualification work, but does not change the red Foundry/storage-layout baseline.

Impact: the repo cannot currently use the full Solidity test suite or storage-layout guard as a release gate. That makes the recent RBTS changes harder to verify and can hide real regressions behind stale harness failures.

Recommendation: split this into two follow-up commits: first update shared test setup so ordinary settlement tests install a valid test cluster payout oracle/module when they expect settlement to complete; second either snapshot the new `RoundVotingEngine` storage layout with a clear "fresh redeploy only" note or redesign the storage additions so the upgrade guard remains meaningful. Keep `make check-storage-layouts` red until one of those decisions is made intentionally.

### REPO-2026-07-02-4 - Zero effective RBTS leaves can strand principal

Severity: Medium

Evidence:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:829` rejects `effectiveWeight > baseWeight`, but permits `effectiveWeight == 0`.
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:77` only rejects zero `baseWeight`, mismatched base weight, or effective weight above base weight.
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:81` overwrites `commitRbtsWeight` with the oracle-proven effective weight.
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:276` returns principal only when `rbtsWeight > 0`.
- `packages/foundry/contracts/RoundRewardDistributor.sol:287` transfers returned principal only if `stakeReturned > 0`.

Normal-path note: current off-chain RBTS scoring and vote bounds make zero effective weights unlikely under the default 1-10 LREP stake and 100-voter cap, and the artifact verifier rejects zero effective weights for some domains. The on-chain boundary still accepts zero-weight leaves for RBTS settlement.

Impact: a finalized RBTS snapshot containing a revealed voter with `baseWeight > 0` and `effectiveWeight == 0` can leave that voter with no returned principal accounting. The claim path can then mark the claim while paying no stake return.

Recommendation: for `PAYOUT_DOMAIN_RBTS_SETTLEMENT`, reject zero `effectiveWeight` leaves, or decouple principal return from oracle scoring weight so every revealed commit receives its refundable principal even if its effective scoring weight is zero.

### REPO-2026-07-02-5 - Compact `roundCore` parser drops `upWins`

Severity: Medium

Evidence:

- `packages/foundry/contracts/RoundVotingEngine.sol:1349` defines compact `roundCore`.
- The ABI returns `startTime, state, voteCount, revealedCount, totalStake, thresholdReachedAt, settledAt, upWins` at `packages/contracts/src/abis/RoundVotingEngineAbi.ts:1283`.
- `packages/nextjs/lib/contracts/roundVotingEngine.ts:225` handles compact array tuples, but `:236` hard-codes `upWins: false` and never reads index 7.
- The docs say the compact tuple contains `upCount` at `packages/nextjs/app/(public)/docs/smart-contracts/page.tsx:520`, but the ABI returns `totalStake` in that slot.
- A local runtime probe of `parseRound([1000n, 1, 3, 3, 30n, 1200n, 1300n, 1])` returned `{"upWins":false,"settledAt":"1300","thresholdReachedAt":"1200"}`.

Impact: frontend/runtime paths that receive `roundCore` as an array can mislabel settled UP rounds as not-UP. This can affect round summaries, result interpretation, postconditions, and tests that depend on `parseRound`.

Recommendation: update the compact parser to require/read the eight-value tuple and parse `upWins` from index 7. Update the docs and add a compact tuple test where `upWins` is true.

### REPO-2026-07-02-6 - MCP default conflicts with recapture-sized bounty parser

Severity: Medium

Evidence:

- `packages/nextjs/lib/agent/schemas.ts:233` declares `bountyEligibility.default = 0`.
- `packages/agents/src/x402QuestionPayload.ts:863` treats omitted `bountyEligibility` differently from explicit `0`.
- `packages/agents/src/x402QuestionPayload.ts:896` rejects recapture-sized non-refundable bounties unless Proof-of-Human eligibility is set.
- MCP quote paths parse through this shared parser at `packages/nextjs/lib/mcp/tools.ts:3021` and `:3048`.

Scenario: an MCP client follows the JSON schema and materializes the default `bountyEligibility: 0` for a `500000000` atomic-unit bounty. The same request would succeed if the field were omitted, because the parser auto-upgrades omitted eligibility to Proof-of-Human at that amount. With the explicit schema default, it fails validation.

Impact: schema-following MCP clients can receive avoidable validation failures on high-value asks.

Recommendation: remove the `0` default from the MCP schema, make the default conditional in docs/schema text, or set the default to Proof-of-Human when the amount is at or above the recapture threshold.

### REPO-2026-07-02-7 - Threshold docs say "500 atomic units"

Severity: Low

Evidence:

- `packages/contracts/src/protocol.ts:98` sets `NON_REFUNDABLE_BOUNTY_RECAPTURE_PROTECTION_AMOUNT = 500_000_000`.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowEligibilityLib.sol:12` sets the same threshold as `500e6`.
- Agent/public docs say "500 USDC/LREP atomic units" at:
  - `packages/nextjs/public/llms.txt:105`
  - `packages/nextjs/public/skill.md:134`
  - `packages/nextjs/public/docs/ai.md:128`
  - `packages/agents/README.md:245`
  - `packages/nextjs/scripts/whitepaper/summary.ts:24`

Impact: because these docs also tell clients to send atomic units, an agent can infer the threshold is `amount=500` instead of `amount=500000000`, producing rejected or miscalibrated requests.

Recommendation: say "500 USDC/LREP (500,000,000 atomic units for 6-decimal assets)" or equivalent in all generated/public agent docs.

### REPO-2026-07-02-8 - Dead-code scan reports unused artifacts

Severity: Low

Evidence from `yarn dead-code`:

- Unused file: `packages/contracts/src/abis/RoundVotingEngineRbtsSettlementModuleAbi.ts`
- Unused exports:
  - `ERC20_INSUFFICIENT_BALANCE_SELECTOR` in `packages/nextjs/hooks/useConfidentialityBond.ts:71`
  - `NON_REFUNDABLE_BOUNTY_RECAPTURE_PROTECTION_AMOUNT` in `packages/nextjs/lib/bountyEligibility.ts:16`
- Unused exported types:
  - `UseAllClaimableRewardsOptions` in `packages/nextjs/hooks/useAllClaimableRewards.ts:23`
  - `PrivateContextRemovalImpactInput` in `packages/nextjs/lib/submission/privateContextRemovalImpact.ts:9`

Impact: low direct runtime risk, but the newly generated settlement-module ABI file being unused is a signal that the consumer/export path may not yet match the intended module integration.

Recommendation: either wire/export the module ABI where consumers need it, or remove generated/public artifacts that are not meant to be consumed yet. Clean up stale exports separately.

## Verification Results

Passed:

- `git diff --check 0b8ededc9..HEAD`
- `yarn workspace @rateloop/contracts test` - 44 tests passed.
- `yarn workspace @rateloop/keeper check-types`
- `yarn workspace @rateloop/keeper test -- resolve-rounds` - the keeper test command ran the package suite: 38 files passed, 549 tests passed, 2 skipped.
- `yarn workspace @rateloop/ponder check-types`
- `yarn workspace @rateloop/nextjs check-types`
- `make check-contract-sizes` from `packages/foundry` - all checked contracts within EIP-170; `RoundVotingEngine` 23,932 bytes and `LaunchDistributionPool` 24,503 bytes.

Completed with findings:

- `yarn dead-code` - completed and reported the unused file/exports listed in REPO-2026-07-02-8.

Failed:

- `forge test --offline` from `packages/foundry` - 371 failing tests, 1,438 passing tests.
- `forge test --offline --rerun` from `packages/foundry` after refreshing to current local `main` - 371 failing tests, 1,439 passing tests.
- `make check-storage-layouts` from `packages/foundry` - `RoundVotingEngine` layout drift against `scripts/expected-storage-layouts/RoundVotingEngine.json`.

Command mistake corrected:

- `make check-storage-layouts` from the repo root failed because the target lives under `packages/foundry`; the command was rerun there and produced the real layout-drift failure above.

## Non-Issues Checked

- The fresh deploy script wires `RoundVotingEngineRbtsSettlementModule`, the cluster payout oracle, the public-rating consumer, and the RBTS settlement consumer. The broad `InvalidAddress` test failures therefore look like stale tests or missing test helper setup, not an obvious fresh-deploy omission.
- The 5 USDC challenge bond remains treated as an anti-spam bond, not payout-value coverage.
- The 60-minute reveal grace period remains treated as an accepted product/security parameter.
- The keeper/app/docs now broadly distinguish public verdict closure from RBTS-backed reward readiness; the remaining issues are lifecycle/discovery and wording bugs, not a wholesale settlement-pending model mismatch.

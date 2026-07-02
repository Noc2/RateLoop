# RateLoop Smart Contracts Security Audit - Fifth Post-Fix Pass

Date: 2026-07-02
Branch: `main`
Head reviewed: `1f698ac3b`

## Scope

This was a read-only audit of the smart contracts after the latest remediation commits. I focused especially on the recent changes touching:

- `QuestionRewardPoolEscrow` recovered bundle refund exits and skipped prequalification refund gating.
- `RoundVotingEngine` / RBTS reveal entropy seed derivation and settlement snapshot application.
- Adjacent recent contract changes from the fourth-pass audit window, including payout snapshot veto handling, launch-credit snapshot finalization, and public-rating cursor advancement.

Assumption from the request: all contracts will be redeployed from scratch, and old deployed contracts/state are out of scope. I did not propose centralized keepers, trusted admin rescue paths, or centralized randomness systems as fixes.

## Summary

I found three confirmed issues:

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| SC-5P-1 | Medium | Open | RBTS reveal-entropy seed leaves pivotal revealers with a favorable-branch choice |
| SC-5P-2 | High | Open | Skipped prequalification replacement can be made unclaimable by later normal qualification |
| SC-5P-3 | Low | Open | Skipped prequalification abandonment must clear all pending rounds in one transaction |

The previous fourth-pass findings were materially improved. The remaining issues are residual edge cases introduced or exposed by those fixes, not migration issues for old deployments.

## Findings

### SC-5P-1: RBTS reveal-entropy seed leaves pivotal revealers with a favorable-branch choice

Severity: Medium

Affected code:

- `packages/foundry/contracts/RoundVotingEngine.sol:1278`
- `packages/foundry/contracts/RoundVotingEngine.sol:1312`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:177`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:182`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:277`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:292`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:543`

The latest fix removes settlement-time block/timestamp grinding by deriving the RBTS score seed from a deterministic closure marker plus the settlement-closed scoring set hash. That scoring set hash includes each revealed, weighted commit's `commitKey`, draw key, and reveal entropy derived from `(commitKey, salt)`.

This fixes the settlement caller's ability to pick a block/time. However, before scoring closure, a revealer whose vote is pivotal for reaching quorum or materially changes the scoring set can still compute the exact branch where they reveal:

1. Previous reveals expose their salts on-chain.
2. The pivotal revealer knows their own salt because it is part of their commit preimage.
3. The deterministic closure marker is predictable from chain id, engine address, content id, and round id.
4. The revealer can simulate the final `scoringSetHash`, `scoreSeed`, RBTS reference/peer draws, reward weight, and forfeits before submitting their reveal.
5. If the reveal branch is unfavorable, they can withhold and push the round toward reveal-failed/refund or a smaller scoring set.

Impact:

The issue does not let a settlement caller forge oracle weights, steal unrelated funds, or choose a centralized randomness source. It can still bias RBTS LREP reward/forfeit accounting and can give a pivotal rater a rational "reveal only if favorable" option that did not exist when unpredictable post-closure entropy was part of the seed.

Recommended decentralized fix:

Keep the settlement-closed scoring set, but mix in entropy that is unavailable until after reveal inclusion is no longer optional. Decentralized options include:

- A future drand round already aligned with the protocol's tlock flow.
- A future blockhash or EIP-2935-style historical blockhash path with permissionless re-arming if the hash becomes unavailable.
- A separate mandatory, economically secured entropy reveal phase that closes before RBTS scoring.

The fix should remain permissionless and should not depend on an admin, trusted keeper, or centralized randomness oracle.

Suggested test:

Add a regression where the final needed revealer can compute both the reveal and withhold branches before revealing. The test should prove the protocol cannot let that revealer choose between a known favorable RBTS seed and a reveal-failed/refund outcome.

### SC-5P-2: Skipped prequalification replacement can be made unclaimable by later normal qualification

Severity: High

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:109`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:117`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:517`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1466`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1459`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1645`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:142`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:417`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:570`

`skipPreQualificationRejectedSnapshotRound` marks a rejected prequalification round as pending and advances `rewardPool.nextRoundToEvaluate` to the next round. Normal refunds are now blocked while `pendingPreQualificationRejectedRounds != 0`, and the explicit prequalification refund path refuses to abandon a skipped round when a valid finalized replacement snapshot exists.

That protects the skipped round from immediate funder refund, but normal later-round qualification is still allowed while a skipped round is pending. The normal `_qualifyRound` path checks pending recovered rounds but does not block on pending prequalification skipped rounds. Because reward pools currently enforce `requiredSettledRounds == 1`, qualifying the next round can complete the entire pool.

Exploit / failure scenario:

1. Round `N` settles for a cluster-backed reward pool.
2. Its prequalification payout snapshot is rejected.
3. Anyone calls `skipPreQualificationRejectedSnapshotRound`, which marks `N` pending and advances the cursor to `N + 1`.
4. A valid replacement snapshot later finalizes for `N`.
5. Before anyone qualifies or claims `N`, anyone qualifies `N + 1`.
6. The pool reaches `qualifiedRounds == requiredSettledRounds`.
7. The skipped round `N` can no longer qualify because the public qualification gate rejects complete pools.
8. Normal refund remains blocked by `pendingPreQualificationRejectedRounds`.
9. The explicit skipped-round refund path refuses to abandon `N` because a valid replacement snapshot exists.

Impact:

The valid replacement-root payout for round `N` becomes unclaimable. Any unclaimed funds from the later qualified round can also be stuck after grace because final refund is blocked by the still-pending skipped round.

Recommended decentralized fix:

Prevent normal later-round qualification while any skipped prequalification round is pending, unless the call is qualifying that exact skipped round. A minimal rule is:

- If `rewardPool.pendingPreQualificationRejectedRounds != 0` and `!preQualificationRejectedRound[rewardPoolId][roundId]`, revert.
- Continue allowing the skipped round itself to qualify through the replacement snapshot path.
- Clear the pending counter only when the skipped round qualifies or is explicitly abandoned after proving no valid replacement is available.

This preserves permissionless liveness and gives the skipped replacement priority over later normal rounds without introducing any centralized decision point.

Suggested test:

Add a regression where round `N` is skipped, a valid replacement snapshot for `N` exists, and a caller attempts to qualify round `N + 1`. The later qualification should revert until `N` is resolved.

### SC-5P-3: Skipped prequalification abandonment must clear all pending rounds in one transaction

Severity: Low

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:109`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:115`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:564`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:570`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:588`

Skipped prequalification rounds increment `pendingPreQualificationRejectedRounds`. The explicit abandonment/refund helper loops over caller-supplied round ids and then requires the entire pending counter to be zero in the same transaction.

Current one-round reward pools can still accumulate multiple skipped prequalification rounds before any round qualifies: each rejected prequalification snapshot can be skipped, advancing the cursor while leaving `qualifiedRounds == 0`. If enough skipped rounds accumulate, a caller may be unable to fit all required round ids and oracle checks into one transaction. Normal refunds remain blocked while the counter is nonzero.

Impact:

This is a liveness risk rather than an immediate theft path. It requires repeated rejected prequalification snapshots, but if it occurs the unallocated balance can become gas-limited because no partial-progress abandonment is possible.

Recommended decentralized fix:

Make skipped-round abandonment batch-progressive:

- Clear each processed skipped flag and decrement the pending counter immediately.
- Allow callers to process bounded batches across multiple transactions.
- Only perform the final refund when the pending counter reaches zero, either in the same call or through a follow-up permissionless refund call.

Alternatively, cap the number of pending prequalification skips per pool to a small protocol bound and document the bound.

## Reviewed Non-Findings

The following areas were checked and did not produce additional confirmed findings:

- Recovered bundle round sets now have a permissionless abandon/refund exit, and the path rejects abandonment when a valid replacement snapshot is available.
- Normal single-pool refunds now block while recovered or skipped prequalification rounds are pending.
- Settlement-time RBTS caller grinding from block/timestamp choice was removed. SC-5P-1 is a distinct pivotal-revealer branch-choice issue.
- `RoundVotingEngine` rejects post-closure reveals once `roundRbtsSeedEntropy` is set, so the scoring set is stable after closure.
- `QuestionRewardPoolEscrow` and `RoundVotingEngine` remain below EIP-170 in the deploy profile after the latest size trims.
- No centralized rescue path, keeper-only action, or admin-only refund path was introduced by the recent fixes.

## Verification

Commands run:

- `forge test -q` from `packages/foundry` - passed.
- `make check-storage-layouts` from `packages/foundry` - passed.
- `make check-contract-sizes` from `packages/foundry` - passed. Relevant deploy-profile sizes included `QuestionRewardPoolEscrow` at `24496` bytes, `RoundVotingEngine` at `24109` bytes, and `LaunchDistributionPool` at `24575` bytes.
- `slither . --config-file slither.config.json --json /private/tmp/rateloop-slither-post-rbts-refund-audit-2026-07-02.json` from `packages/foundry` - completed with 21 results. Reported items were Slither `uninitialized-state` / `constable-states` findings on inherited storage used by the RBTS delegatecall module and read-only zero-default mappings; I did not classify those as new actionable findings from the recent diff.
- `yarn foundry:aderyn` from the repository root - completed, generated `packages/foundry/report.md`, and reported `0` high issues and `23` low categories. The generated report was not committed.

Parallel review:

- RBTS-focused reviewer found SC-5P-1 and passed targeted RBTS tests.
- Reward-pool/refund-focused reviewer found SC-5P-2 and SC-5P-3 and passed focused escrow tests.
- Broad regression reviewer found no additional confirmed issues and passed targeted contract slices plus `make check-contract-sizes`.

External references checked:

- Solidity security considerations, especially randomness, reentrancy, gas-limit loops, and checks-effects-interactions: https://docs.soliditylang.org/en/latest/security-considerations.html
- EIP-2935 historical blockhash source: https://eips.ethereum.org/EIPS/eip-2935
- OpenZeppelin Contracts 5.x utility/security guard documentation: https://docs.openzeppelin.com/contracts/5.x/api/utils

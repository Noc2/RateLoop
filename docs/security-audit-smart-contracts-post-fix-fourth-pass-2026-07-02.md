# RateLoop Smart Contracts Security Audit - Fourth Post-Fix Pass

Date: 2026-07-02
Branch: `main`
Head reviewed: `f4dca9720`

## Scope

This was a read-only follow-up audit of the smart contracts after the latest remediation commits. I focused especially on recent changes touching:

- `ClusterPayoutOracle` veto, rejection, replacement, and consumer-consumption semantics.
- `QuestionRewardPoolEscrow` direct and bundle reward recovery/refund paths.
- `LaunchDistributionPool` launch-credit payout snapshot finalization.
- `ContentRegistry` public-rating payout snapshot cursor advancement.
- `RoundVotingEngine` / RBTS settlement snapshot and scoring paths.

Assumption from the request: all contracts will be redeployed from scratch, and old deployed contracts/state are out of scope. I did not propose centralized keepers, trusted entropy, or admin-only rescue systems as fixes.

## Summary

I found three confirmed issues:

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| SC-4P-1 | High | Open | Recovered bundle round sets can permanently block bundle refunds |
| SC-4P-2 | Medium | Open | Skipped pre-qualification replacement roots can be bypassed by normal reward-pool refund |
| SC-4P-3 | Medium | Open | RBTS scoring seed is settlement-time grindable after delayed blockhash entropy removal |

No additional confirmed issue was found in the latest payout-veto wait logic, launch-credit finalization checks, or public-rating cursor ordering checks.

## Findings

### SC-4P-1: Recovered bundle round sets can permanently block bundle refunds

Severity: High

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:164`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:253`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:287`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:760`

`recoverOrReopenSnapshotBundleRoundSet` can recover a rejected qualified bundle round set before any claim. The recovery path returns the round-set allocation to `bundle.unallocatedAmount`, increments `bundle.pendingRecoveredRoundSets`, deletes the qualified snapshot, and marks the round set as recovered.

That is safe if a replacement snapshot later reopens and requalifies. However, bundle refund has only the normal `refundQuestionBundleReward` path, and that path unconditionally requires `bundle.pendingRecoveredRoundSets == 0`. Unlike single reward pools, bundles do not have an abandon/refund path equivalent to `refundExpiredRecoveredRewardPool` or `refundInactiveRecoveredRewardPool`.

Exploit / failure scenario:

1. A bundle round set qualifies under a cluster payout snapshot.
2. The finalized snapshot is rejected before the first claim.
3. Anyone calls `recoverOrReopenSnapshotBundleRoundSet`, which increments `pendingRecoveredRoundSets`.
4. No valid replacement snapshot is ever finalized, or the replacement remains unqualifiable.
5. Claims remain impossible because the round set was deleted and not requalified.
6. Refund remains impossible because `refundQuestionBundleReward` requires `pendingRecoveredRoundSets == 0`.

Impact:

Bundle funds can be locked indefinitely. This can affect refundable and non-refundable bundles, with the residue unable to return to the funder or treasury through the existing bundle refund path.

Recommended decentralized fix:

Add a permissionless bundle recovered-round-set abandon/refund path analogous to the single-pool recovered refund logic. The path should:

- Allow abandonment only after the normal claim/refund grace conditions.
- Decrement `pendingRecoveredRoundSets` and clear recovered/reopened flags.
- Preserve funder/treasury routing semantics already used by `refundQuestionBundleReward`.
- Refuse abandonment if a valid finalized replacement snapshot exists for the recovered round set, using the same consumer, source-ready, pinned-at, rejected-digest/root, and correlation rejection checks as single-pool recovered refunds.

No centralized override is needed.

### SC-4P-2: Skipped pre-qualification replacement roots can be bypassed by normal reward-pool refund

Severity: Medium

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:109`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:135`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:425`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1246`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1414`

`skipPreQualificationRejectedSnapshotRound` handles a rejected cluster snapshot before the reward round was qualified. It marks `preQualificationRejectedRound[rewardPoolId][roundId] = true` and advances `rewardPool.nextRoundToEvaluate`.

The skipped round is still intentionally claimable later: the claim/qualification path passes `bypassQualificationCursor` when `preQualificationRejectedRound` is true. Existing tests cover that a valid replacement root can qualify and pay before refund.

The normal expired refund path does not check those skipped rounds for a now-valid replacement snapshot. It only checks the current `nextRoundToEvaluate` via `requireNoPendingFinishedRound`. Because the skipped round advanced the cursor, a funder can refund after expiry even if a replacement snapshot for the skipped round has already finalized and can still qualify/payout.

Exploit / race scenario:

1. A reward-pool round settles and gets a cluster payout snapshot.
2. The snapshot is rejected before qualification.
3. `skipPreQualificationRejectedSnapshotRound` advances `nextRoundToEvaluate`.
4. A valid replacement root finalizes for the skipped round.
5. Before a claimant/keeper calls `qualifyRound` or `claimQuestionReward`, the funder calls `refundExpiredRewardPool`.
6. The refund path sees only the advanced cursor and refunds/forfeits unallocated funds, preventing the replacement-root payout from being honored.

Impact:

Raters in a valid replacement-root round can lose the reward-pool payout due to a refund race after the original rejected pre-qualification snapshot was skipped.

Recommended decentralized fix:

Track skipped pre-qualification rounds that can still qualify, and gate normal refunds on them. A minimal approach is to add a permissionless scan/abandon mechanism similar to recovered rounds:

- Before refunding unallocated funds, reject refund if any skipped pre-qualification round has a valid finalized replacement snapshot.
- Permit skipped-round abandonment after grace only if no valid replacement snapshot exists.
- Clear the skipped flag only when the round is either qualified or explicitly abandoned.

This keeps liveness permissionless and avoids a centralized funder/admin decision.

### SC-4P-3: RBTS scoring seed is settlement-time grindable after delayed blockhash entropy removal

Severity: Medium

Affected code:

- `packages/foundry/contracts/RoundVotingEngine.sol:924`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:297`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:314`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:537`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol:574`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:132`
- `packages/foundry/contracts/RoundRewardDistributor.sol:254`

The recent `fix: stabilize RBTS seed across expiry retries` change removed the delayed `Blockhash.blockHash(seedBlock)` input from `finalizeRbtsSeed`. The current seed entropy is derived from `originalBlock` and `capturedAt`, both chosen when settlement closes the RBTS scoring set.

Before the change, `finalizeRbtsSeed` mixed a future blockhash into the RBTS entropy. Now, after all reveals are public, the first settlement caller can simulate candidate settlement blocks/timestamps and choose whether to call `settleRound` based on the resulting deterministic RBTS reference/peer draws.

Exploit scenario:

1. Reveals are public and the settlement window is open.
2. A rater, frontend, or searcher simulates RBTS scoring outcomes for candidate settlement blocks/timestamps.
3. They submit `settleRound` only when the deterministic seed favors their position or allied raters.
4. The resulting RBTS `scoreBps`, `commitRbtsRewardWeight`, `stakeReturned`, and forfeits are biased.

Impact:

RBTS reward and forfeiture accounting can be biased by settlement timing. Honest callers can mitigate by settling first, but the protocol no longer gives the first settlement transaction delayed entropy protection.

Recommended decentralized fix:

Restore permissionless delayed entropy without reintroducing the previous expiry liveness failure:

- Capture a future seed block when the scoring set closes.
- Finalize only after that blockhash is available.
- If the seed expires before finalization, refresh to a new future seed block while preserving the closed scoring set.
- Keep the entropy source protocol-native, such as blockhash/EIP-2935 history where available; do not add a trusted centralized randomness oracle or keeper.

## Reviewed Non-Findings

The following areas were checked and did not produce confirmed findings:

- Direct question reward and bundle reward use of finalized payout roots now waits until after `FINALIZATION_VETO_WINDOW` before qualification/claim consumption.
- Launch-credit finalization waits until after the payout snapshot veto window and checks the pinned oracle proposal timestamp against the recorded source-ready timestamp.
- Public rating snapshot application is strict-order only, and the new `advanceRatingSnapshotCursor` only skips cancelled, tied, reveal-failed, or already-applied settled rounds.
- Recovered single reward-pool refunds now check for a valid replacement snapshot before abandoning recovered allocation.
- RBTS settlement snapshot application checks finalized-after-veto status, exact revealed/leaf counts, sorted unique commit keys, account/identity binding, base/effective weight bounds, aggregate total weight, and bounded independence leaves.

## Verification

Commands run from `packages/foundry`:

- `forge test -q` - passed.
- `make check-contract-sizes` - passed. `LaunchDistributionPool` deploy-profile bytecode was `24575` bytes, below the `24576` EIP-170 limit.
- `make check-storage-layouts` - passed.
- `slither . --config-file slither.config.json --json /private/tmp/rateloop-slither-post-fix-2026-07-02.json` - completed with findings. Reported items were Slither `uninitialized-state` / `constable-states` on `RoundVotingEngineStorage` and module-style inherited storage; I did not classify those as new actionable findings from the recent diff.
- `aderyn . -o /private/tmp/rateloop-aderyn-post-fix-2026-07-02.md` - generated a report with `0` high issues and `23` low categories, then crashed in Aderyn 0.6.8 after report generation on macOS. I treated this as partial static-analysis evidence, not a clean Aderyn pass.

Reference material checked:

- Solidity security considerations: reentrancy, bounded loops, and general recommendations: https://docs.soliditylang.org/en/latest/security-considerations.html
- OpenZeppelin Contracts 5.x `ReentrancyGuardTransient` documentation, including the EIP-1153 chain-support caveat: https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuardTransient

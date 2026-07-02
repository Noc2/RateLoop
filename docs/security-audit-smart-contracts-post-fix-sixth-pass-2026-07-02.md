# RateLoop Smart Contracts Security Audit - Sixth Post-Fix Pass

Date: 2026-07-02
Branch: `main`
Head reviewed: `f76b0ef13e6a683a70d5e307b25858739f478a2f`

## Scope

This was a read-only follow-up audit of the smart contracts after the latest fifth-pass remediations. I focused especially on recent changes in:

- `ClusterPayoutOracle` proposal-scoped challenge and finalization veto timing.
- `RoundVotingEngine` and `RoundVotingEngineRbtsSettlementModule` RBTS settlement entropy, timeout, and oracle liveness paths.
- `QuestionRewardPoolEscrow` skipped prequalification, recovered snapshot, refund, and claim qualification paths.
- `ContentRegistryRatingSnapshotLib` public-rating snapshot cursor liveness.
- `FrontendRegistry` fee-withdrawal review timing.

Assumption from the request: the launch will use a fresh redeploy, old contracts and state are out of scope, and fixes should not add centralized ordinary-operation systems or degrade the user experience of healthy flows.

## Summary

I found six confirmed issues in the recent smart-contract changes:

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| SC-6P-1 | High | Open | Partial skipped-prequalification abandonment can bypass expiry and reorder the reward opportunity |
| SC-6P-2 | Medium | Open | Child payout snapshots can be consumed before the parent correlation epoch veto window closes |
| SC-6P-3 | Medium | Open | Live replacement snapshots are invisible to abandonment checks until outside veto |
| SC-6P-4 | Medium | Open | Malformed RBTS settlement snapshots can unlock the no-forfeit timeout path |
| SC-6P-5 | Low | Open | Public-rating no-proposal skip can permanently discard late rating evidence |
| SC-6P-6 | Low | Open | Skipped-prequalification flags stay set after successful qualification |

The prior fifth-pass RBTS entropy issue appears materially fixed: scoring closes before future-block entropy is known, late reveals are rejected after seed capture, and missed blockhashes re-arm rather than settling with zero entropy.

## Findings

### SC-6P-1: Partial skipped-prequalification abandonment can bypass expiry and reorder the reward opportunity

Severity: High

Affected code:

- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1215`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:282`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:594`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:613`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:621`

`refundPreQualificationRejectedRewardPool` calls `_abandonPreQualificationRejectedRounds` before the non-inactive expiry check. The helper mutates each skipped flag and decrements the pending counter. If pending skipped rounds remain afterward, the public function returns `0` immediately and never reaches the later `Not expired` check.

Concrete path:

1. A pool accumulates two skipped prequalification rounds, `N` and `N + 1`.
2. Before the pool expires and while the content is still active, a caller invokes `refundPreQualificationRejectedRewardPool` with only `N`.
3. If no replacement snapshot for `N` is currently available, the helper clears `preQualificationRejectedRound[pool][N]` and decrements the pending counter.
4. Because `N + 1` remains pending, the function returns `0` before checking expiry.
5. A later corrected snapshot for `N` cannot qualify through the prequalification bypass because the skip flag was cleared and the cursor remains advanced.
6. The later skipped round becomes the new FIFO candidate and can capture the one-round reward opportunity.

Impact:

This breaks the FIFO guarantee added by the latest fixes. A caller can strand earlier voters and redirect the one-round reward opportunity toward a later skipped round without waiting for expiry or inactive content state. The direct qualification path correctly enforces FIFO; the partial abandonment path does not.

Recommended decentralized fix:

Move the inactive or expired gate before any skipped-prequalification state mutation. For `inactive == false`, require the pool to be expired before `_abandonPreQualificationRejectedRounds` can clear even a partial batch. Preserve the useful batch-progressive behavior after expiry or inactive state, but do not allow pre-expiry partial abandonment to burn a future replacement path.

Suggested regression:

Create two skipped prequalification rounds, call `refundPreQualificationRejectedRewardPool(pool, [oldest], false)` before expiry, and assert it reverts without clearing the oldest flag. Then prove the same batch can progress after expiry or inactive content state.

### SC-6P-2: Child payout snapshots can be consumed before the parent correlation epoch veto window closes

Severity: Medium

Affected code:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:785`
- `packages/foundry/contracts/ClusterPayoutOracle.sol:944`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:55`
- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:376`
- `packages/foundry/contracts/RoundVotingEngine.sol:1450`

`isRoundPayoutSnapshotOutsideVetoWindow` checks the child round-payout proposal's finalized status, current parent correlation digest, and the child proposal's own veto deadline. It does not also require the parent correlation epoch's proposal-scoped veto deadline to have elapsed.

Concrete path:

1. A correlation epoch is proposed and finalized while `finalizationVetoWindowAtProposal` is long.
2. Governance later lowers the oracle timing config.
3. A child payout snapshot is proposed and finalized under the shorter child veto window.
4. `isRoundPayoutSnapshotOutsideVetoWindow` returns true once the child deadline passes, even though the parent epoch is still in its own veto window.
5. A consumer applies and consumes the child snapshot.
6. Parent rejection is now blocked by `_revertIfAnyConsumedChildSnapshot`.

Impact:

A bad parent correlation root can become practically pinned by consuming any child snapshot before the parent veto period ends. The path depends on a timing-configuration change, so I am not rating it High, but it cuts across all child consumers that rely on the helper.

Recommended decentralized fix:

Make the child outside-veto helper require both deadlines:

- The child round-payout snapshot is finalized and outside its proposal-scoped veto window.
- The referenced parent correlation epoch is finalized, still current, and outside its own proposal-scoped veto window.

In effect, child consumption should wait until `max(childVetoDeadline, parentVetoDeadline)`. Add a regression where the parent was finalized under a longer veto window, the config is shortened, the child is finalized under the shorter window, and the child remains unconsumable until the parent veto deadline passes.

### SC-6P-3: Live replacement snapshots are invisible to abandonment checks until outside veto

Severity: Medium

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:541`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:598`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:639`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:660`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:788`

Recovered and skipped-prequalification abandonment both rely on `_hasRecoveredReplacementSnapshot` to decide whether a corrected replacement snapshot blocks refund/abandonment. That helper first calls `previewRoundQualificationWithClusterSnapshot`. The preview path only returns qualifiable when the oracle snapshot is finalized and outside veto. Proposed, challenged, and finalized-but-still-in-veto replacement snapshots are therefore treated the same as no replacement.

Concrete path:

1. A recovered or skipped-prequalification round has an honest replacement proposal in flight.
2. The replacement is Proposed, Challenged, or Finalized but still inside the veto window.
3. A refund/abandon caller reaches `_hasRecoveredReplacementSnapshot`.
4. The helper returns false because the replacement is not yet qualifiable through the normal preview path.
5. The caller clears recovered/skipped state or sweeps residue before the replacement can become usable.

Impact:

An honest replacement that is already visible on-chain can be raced during the challenge/veto window. This is an oracle-finality mismatch: users wait for finality before claiming, but abandonment can act as though the pending replacement does not exist.

Recommended decentralized fix:

Split "replacement exists and should block abandonment" from "replacement is currently claimable":

- Treat Proposed, Challenged, and Finalized-in-veto snapshots for the same key/consumer as blocking abandonment while they are live and not objectively stale or rejected.
- Keep final qualification/claiming gated on finalized-outside-veto status.
- Add objective invalidation or timeout rules for malformed/stale replacements so a bad proposal cannot freeze refunds forever.

Suggested regression:

For both recovered and skipped-prequalification paths, create an honest replacement snapshot that is finalized but still inside the veto window, then assert refund/abandonment reverts until the replacement is either rejected/invalidated or becomes outside veto and qualifiable.

### SC-6P-4: Malformed RBTS settlement snapshots can unlock the no-forfeit timeout path

Severity: Medium

Affected code:

- `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol:41`
- `packages/foundry/contracts/RoundVotingEngineRbtsSettlementModule.sol:141`
- `packages/foundry/contracts/ClusterPayoutOracle.sol:483`
- `packages/foundry/contracts/ClusterPayoutOracle.sol:1028`

The RBTS timeout path returns all RBTS stakes after one hour when `_hasLiveRbtsSettlementSnapshot` is false. That helper treats a Proposed, Challenged, or Finalized snapshot as not live when the snapshot is structurally unusable for the current round, for example when `rawEligibleVoters` does not match the revealed count.

The oracle's generic proposal validation can still accept a nonzero, wrong-shape RBTS payout snapshot. Once accepted, the proposal blocks a replacement for the same key while it remains live. If it is not challenged or corrected before the timeout, any caller can settle through the empty-input timeout branch, returning all stakes and bypassing RBTS forfeits and reward reweighting.

Impact:

A bonded frontend proposer can squat the RBTS snapshot key with a generically valid but consumer-invalid proposal. If the challenge/arbitration process does not resolve it before the timeout, settlement falls back to no-forfeit accounting. This is an economic liveness and incentive-integrity issue, not direct theft of unrelated funds.

Recommended decentralized fix:

Distinguish "no proposal exists" from "a proposal exists but is unusable":

- Timeout should not treat a live proposal for the correct key and consumer as absent merely because it is malformed for consumer accounting.
- Add a permissionless invalid-proposal rejection or invalidation path for objective shape mismatches such as wrong `rawEligibleVoters`, zero usable weight, or wrong consumer, then allow timeout or replacement after that objective invalidation.
- Alternatively, validate RBTS-specific shape at oracle proposal time using the registered consumer's source-readiness data so the unusable snapshot cannot occupy the key.

Suggested regression:

Propose an RBTS settlement snapshot whose `rawEligibleVoters` does not match the settled round's revealed count, wait past the timeout, and assert the empty-input timeout path cannot return stakes until the malformed proposal is rejected or invalidated.

### SC-6P-5: Public-rating no-proposal skip can permanently discard late rating evidence

Severity: Low

Affected code:

- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:50`
- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:271`
- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:161`
- `packages/foundry/contracts/ClusterPayoutOracle.sol:510`

The new public-rating cursor liveness path lets `advanceRatingSnapshotCursor` skip a pending public-rating snapshot after `RATING_SNAPSHOT_NO_PROPOSAL_GRACE` when no proposal exists. The skip marks the pending settlement as applied and stores a synthetic consumed digest.

After that, the registry source-readiness hook returns `0` for the skipped round because `pending.applied` is true. A late public-rating proposal then fails the oracle's source-readiness gate and the rating evidence for that round is permanently dropped.

Impact:

This is not a direct funds-loss path, and it does preserve later-round liveness. The risk is that a one-hour proposer outage can permanently remove otherwise valid public-rating evidence. Rejected public-rating snapshots also do not appear to have an analogous no-replacement timeout because the skip only handles the no-proposal case.

Recommended decentralized fix:

Keep the liveness benefit without making the first skip irrevocable:

- Represent no-proposal skips as a provisional skipped state until a later public-rating snapshot has actually applied.
- Allow a late valid snapshot to replace the provisional skip if no later rating application would be reordered.
- Add an explicit rejected-without-replacement path or timeout so challenged/rejected public-rating rounds do not freeze the cursor.

Suggested regressions:

- Skip a no-proposal public-rating round, then propose a valid late snapshot before any later rating applies and assert the evidence can still be applied.
- Reject a public-rating snapshot without replacement and assert the cursor has a bounded permissionless liveness path.

### SC-6P-6: Skipped-prequalification flags stay set after successful qualification

Severity: Low

Affected code:

- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1287`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1456`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:367`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:613`

When a skipped prequalification round successfully qualifies, `qualifyRoundWithClusterSnapshot` decrements `pendingPreQualificationRejectedRounds`, but it does not clear `preQualificationRejectedRound[rewardPoolId][roundId]`. The stale flag is still read by preview and qualification code as a cursor-bypass signal.

Impact:

Current launch pools require exactly one settled round, so the pool completes immediately after a successful skipped-round qualification and this stale flag appears low impact today. It is still fragile state hygiene: if multi-round reward pools are reintroduced, or if recovery paths evolve, stale bypass flags could reopen the same class of ordering bugs the latest fixes are trying to close.

Recommended decentralized fix:

Clear `preQualificationRejectedRound[rewardPoolId][roundId]` in the same transaction that successfully qualifies the skipped round. Add a regression asserting the flag is false after qualification and that preview/qualification bypass decisions are based on active pending state, not stale flags.

## Reviewed Non-Findings

- RBTS entropy: the latest future-block/EIP-2935 design closes the fifth-pass pivotal-revealer branch-choice issue. Scoring closes before the future block hash is known, post-closure reveals revert, and missed blockhashes re-arm instead of using settlement-time `prevrandao`.
- Skipped prequalification FIFO: direct qualification now enforces oldest-first resolution, and later normal qualification cannot complete the pool while skipped prequalification rounds are pending. SC-6P-1 is limited to the partial abandonment/refund path.
- Frontend fee withdrawals: shortening `FEE_WITHDRAWAL_DELAY` to one hour did not introduce an immediate bypass of fee slashing or deregistration review. Pending withdrawals remain inside the registry and are confiscated on slash.
- Deploy-profile bytecode sizes remain below EIP-170 after a clean artifact rebuild.
- Slither's reported findings were the known delegatecall-module inherited-storage and zero-default mapping noise around `RoundVotingEngineStorage`, plus constable-state suggestions. I did not classify them as new actionable findings.
- Aderyn reported `0` high categories and `23` low categories before crashing in its own macOS/network stack. Its low categories were broad style, centralization, loop, event, and ERC20 heuristics rather than new recent-change exploit paths.

## Verification

Commands run:

- `forge clean` from `packages/foundry` before rechecking deploy-profile sizes.
- `make check-contract-sizes` from `packages/foundry` - passed after the clean rebuild. Relevant sizes: `QuestionRewardPoolEscrow` 24,521 bytes, `RoundVotingEngine` 24,109 bytes, `LaunchDistributionPool` 24,575 bytes.
- `make check-storage-layouts` from `packages/foundry` - passed.
- `forge test -q` from `packages/foundry` - passed.
- `forge test --match-contract QuestionRewardPoolEscrowTest --match-test "testPreQualification|testSnapshotless|testRecovered|testRefund.*Recovered" -vv` - passed, 12 tests.
- `forge test --match-contract RoundVotingEngineBranches --match-test "test_Rbts" -vv` - passed, 23 tests.
- `forge test --match-contract FrontendRegistry --match-test "test_" -q` - passed.
- `make slither` from `packages/foundry` - completed analysis with 21 Slither results and exited nonzero because results were present. Results were reviewed as non-actionable for this pass.
- `yarn foundry:aderyn` from the temp worktree - not run because the clean worktree had no Yarn install state.
- `make aderyn` from `packages/foundry` - generated `report.md` with `0` high and `23` low categories, then crashed in Aderyn 0.6.8 with a `system-configuration` / `reqwest` macOS panic.

Additional research:

- Solidity Security Considerations: https://docs.soliditylang.org/en/latest/security-considerations.html
- EIP-2935 historical block hashes: https://eips.ethereum.org/EIPS/eip-2935
- OpenZeppelin Contracts 5.x utility/security guards: https://docs.openzeppelin.com/contracts/5.x/api/utils
- OpenZeppelin Contracts 5.x access control: https://docs.openzeppelin.com/contracts/5.x/api/access

Parallel review:

- RBTS/oracle review identified SC-6P-2 and the challenged-snapshot timeout test gap.
- Registry/reward-pool review identified SC-6P-1, SC-6P-3, SC-6P-4, SC-6P-5, and SC-6P-6.
- No subagent edited files.

## Test Gap

The RBTS timeout tests cover usable proposed/finalized snapshots blocking timeout. I did not find an explicit challenged-snapshot timeout regression, even though `_hasLiveRbtsSettlementSnapshot` treats `Challenged` as live. Add a test that a challenged RBTS settlement snapshot blocks the one-hour timeout until arbiter resolution, so the intended oracle-arbitration liveness tradeoff stays explicit.

# Smart Contract Follow-up Security Audit - 2026-07-02

## Scope

This follow-up audit reviewed the smart-contract and contract-facing automation changes on `main` from
`aa46f13d4` through `2624b97b8`, with emphasis on the fixes for
`docs/design-review-2026-07.md` Part 1 - Smart contracts.

Recent commits reviewed:

- `7014231b7` - canonicalize `roundCore` consumers
- `14917f3d1` - emit content registry treasury updates
- `471ea7133` - block consumed payout snapshot rejection
- `ec6b57aba` - derive reveal quorum structurally
- `9b3c069a9` - type missing reward lookup errors
- `c2ea90a9e` - add snapshotless cluster recovery
- `f46add953` - guard escrow event schemas
- `ff0d0216b` - prequalify reward work proactively
- `58f2d5478` - align smart contract recovery docs
- `2624b97b8` - enforce RBTS quorum at round snapshot

The review intentionally did not change code. Current deployment migration risk was not considered a blocker because
the next rollout is a full smart-contract redeploy.

## Methodology

- Manual diff review of `packages/foundry/contracts`, `packages/foundry/test`, generated ABI consumers, keeper reward
  qualification changes, Ponder keeper discovery, and updated docs.
- Three parallel read-only reviewer agents:
  - Oracle and snapshotless recovery paths.
  - Voting and round-lifecycle quorum paths.
  - Keeper/Ponder contract-liveness paths.
- Static analysis: `slither . --config-file slither.config.json` from `packages/foundry`.
- Targeted Foundry tests:

```sh
forge test --offline --match-contract ClusterPayoutOracleTest --match-test 'test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification|test_FinalizedRoundPayoutSnapshotRejectRevertsWithinVetoWindowWhenConsumed|test_FinalizedRoundPayoutSnapshotRejectUsesSnapshottedConsumerAfterRotation'
```

Results:

- Slither: 0 findings.
- Targeted Foundry tests: 3 passed.
- No Critical or High severity issues found.

## Findings

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| SC-2026-07-02-1 | Low | Real residual issue | Parent correlation-epoch rejection can still invalidate already-consumed child payout roots. |
| SC-2026-07-02-2 | Medium | Real operational liveness gap | Keeper reward qualification does not advance non-qualifying cursor rounds. |
| SC-2026-07-02-3 | Low | Real monitoring gap | Pending cluster snapshots are logged as unexpected keeper failures. |
| SC-2026-07-02-4 | Low | Real operational liveness gap | Ponder discovery does not model pre-qualification skip state. |
| SC-2026-07-02-5 | Informational | Fresh redeploy non-issue | Legacy below-floor round snapshots are not rescued, but fresh deployments cannot create them. |
| SC-2026-07-02-6 | Informational | Policy note | Future quorum ratchets do not rewrite stored question configs. |

## SC-2026-07-02-1: Parent Correlation-epoch Rejection Can Still Invalidate Consumed Child Roots

Severity: Low

Status: Real residual issue. This is not a new externally exploitable bug, but the recent direct child-root fix does not
fully close the partially-claimed-root liveness scenario when the parent correlation epoch is rejected.

Where:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:413` rejects finalized correlation epochs during
  `FINALIZATION_VETO_WINDOW`.
- `packages/foundry/contracts/ClusterPayoutOracle.sol:818` makes `verifyPayoutWeight` depend on
  `_isCurrentCorrelationEpoch`.
- `packages/foundry/contracts/ClusterPayoutOracle.sol:1091` defines current as parent status `Finalized` plus matching
  digest.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:192` blocks recovery after
  `firstClaimPaid`.

Scenario:

1. A correlation epoch finalizes.
2. A child round payout snapshot finalizes.
3. At least one claimant consumes the child root, setting the consumer's `firstClaimPaid` state.
4. During the parent epoch's veto window, the arbiter calls `rejectFinalizedCorrelationEpoch`.
5. The child proposal remains stored, but `verifyPayoutWeight` returns false because the parent epoch is no longer
   current.
6. Later claimants cannot claim through the same root, and the escrow recovery path refuses to roll back the round
   after `firstClaimPaid`.

Why the recent fix is still incomplete:

- `rejectFinalizedRoundPayoutSnapshot` now correctly checks the proposal-time consumer and reverts with
  `SnapshotConsumed` once that consumer reports first use.
- The parent epoch rejection path has no equivalent child-consumption check, so it can indirectly invalidate a consumed
  child root.

Risk:

- Trusted-role liveness/custody risk. The arbiter can strand remaining claimant shares until an off-chain operational
  remedy, residue sweep, or manual compensation path is used.
- No untrusted attacker can trigger this path without the arbiter role.

Recommendation:

- Treat parent epoch rejection after any child root is consumed as unsafe.
- Before rejecting a finalized correlation epoch, enumerate covered child round-payout snapshots and block rejection if
  any proposal-time consumer reports consumed.
- If full on-chain enumeration is too expensive, add an explicit operational invariant: the arbiter must only reject a
  finalized parent epoch after proving no child consumer has consumed any dependent root.

Existing regression evidence:

- `test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification` confirms the parent rejection makes future
  child payout verification fail.
- `test_FinalizedRoundPayoutSnapshotRejectRevertsWithinVetoWindowWhenConsumed` and
  `test_FinalizedRoundPayoutSnapshotRejectUsesSnapshottedConsumerAfterRotation` confirm the direct child rejection path
  now blocks consumed-root invalidation.

## SC-2026-07-02-2: Keeper Reward Qualification Does Not Advance Non-qualifying Cursor Rounds

Severity: Medium

Status: Real operational liveness gap in the contract-facing automation.

Where:

- `packages/ponder/src/api/routes/keeper-routes.ts:245` returns settled unqualified reward-pool rounds broadly.
- `packages/keeper/src/keeper.ts:1960` only calls `qualifyRound` for reward-pool candidates.
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:515` exposes the separate
  `advanceQualificationCursor` entrypoint.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:127` implements cursor
  advancement.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:329` blocks refunds while a
  finished cursor round still needs qualification or advancement.

Scenario:

1. A reward pool's current cursor round settles but is not qualifiable, for example because it has too few eligible
   voters.
2. A later round settles and would qualify.
3. Ponder returns both rounds, but the keeper only attempts `qualifyRound`.
4. The first round reverts with an expected non-qualifying reason, and later rounds revert `Round out of order`.
5. Because nobody calls `advanceQualificationCursor`, later payouts and expired/inactive refunds can remain blocked by
   the on-chain cursor.

Risk:

- No direct fund theft or incorrect payout.
- Funds can remain pinned behind a permissionless manual maintenance call, defeating the intent of the new proactive
  reward-qualification automation.

Recommendation:

- Add keeper support for `advanceQualificationCursor(rewardPoolId, maxRounds)` when a settled cursor round is finished
  but non-qualifying.
- Prefer using an on-chain read or indexed cursor state so Ponder can return the current cursor explicitly instead of
  returning all settled unqualified rounds.
- Track a specific metric for cursor advancement attempts and successes.

## SC-2026-07-02-3: Pending Cluster Snapshots Are Logged As Unexpected Keeper Failures

Severity: Low

Status: Real monitoring gap.

Where:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:811` reverts with
  `Cluster snapshot pending` when the oracle snapshot is not finalized.
- `packages/keeper/src/keeper.ts:1938` classifies benign reward-qualification reverts.
- `packages/keeper/src/keeper.ts:1950` lists `Cluster snapshot unavailable`, but not `Cluster snapshot pending`.

Scenario:

1. Ponder returns a settled reward-pool round before its cluster payout snapshot finalizes.
2. The keeper calls `qualifyRound`.
3. The contract reverts `Cluster snapshot pending`.
4. The keeper treats this as an unexpected failure and increments warning/failure telemetry.

Risk:

- No direct smart-contract state corruption.
- Normal oracle lag can create noisy keeper warnings and mask genuinely unexpected reward-qualification failures.

Recommendation:

- Classify `Cluster snapshot pending` as expected.
- Consider separating expected liveness wait states from true transaction failures in metrics.

## SC-2026-07-02-4: Ponder Discovery Does Not Model Pre-qualification Skip State

Severity: Low

Status: Real operational liveness gap.

Where:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:117` implements
  `skipPreQualificationSnapshotlessClusterRound`.
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:170` marks
  `preQualificationRejectedRound` and advances `nextRoundToEvaluate`.
- `packages/ponder/src/api/routes/keeper-routes.ts:261` filters out only rounds present in
  `questionRewardPoolRound`.
- `packages/keeper/src/keeper.ts:1987` bounds per-tick reward qualification attempts.

Scenario:

1. Governance skips a source-ready snapshotless cluster cursor round to recover or refund.
2. The skip advances the on-chain cursor but does not create a qualified round row.
3. Until a replacement snapshot qualifies the skipped round or the pool is refunded, Ponder can keep rediscovering the
   skipped old round.
4. The keeper spends bounded per-tick slots on stale candidates that revert benignly.

Risk:

- No custody bypass: the skip is governance-only and claims still require a finalized replacement snapshot.
- Repeated stale candidates can slow real qualification work for the same or other pools.

Recommendation:

- Index `PreQualificationSnapshotlessClusterRoundSkipped` and
  `PreQualificationRejectedSnapshotRoundSkipped`.
- Exclude skipped rounds from ordinary keeper qualification discovery unless a replacement snapshot is finalized and
  the round is intentionally requalifiable.

## SC-2026-07-02-5: Legacy Below-floor Round Snapshots Are Not Rescued

Severity: Informational

Status: Fresh redeploy non-issue.

Where:

- `packages/foundry/contracts/RoundVotingEngine.sol:985` uses snapshotted `minVoters` directly for reveal-failed quorum.
- `packages/foundry/contracts/RoundVotingEngine.sol:1391` uses snapshotted `minVoters` in cancel logic.
- `packages/foundry/contracts/RoundVotingEngine.sol:1475` still requires `MIN_RBTS_PARTICIPANTS` for RBTS settlement.
- `packages/foundry/contracts/libraries/RoundCreationLib.sol:40` now rejects new below-floor snapshots.

Scenario:

If an already-running deployment had an open round snapshotted with `minVoters = 2`, two reveals could still put the
round in the old dead zone: settlement reaches the raw quorum, RBTS scoring still requires three participants, and both
reveal-failed/cancel paths treat threshold as reached.

Why this is not a next-deployment blocker:

- The user plans a full smart-contract redeploy, so there are no legacy malformed round snapshots to migrate.
- Fresh snapshots below three are rejected before stake enters a round.

Recommendation:

- No code action needed for the redeploy path.
- If a future hot upgrade ever reuses live round state, add a migration/runbook check for open rounds with
  `minVoters < 3`.

## SC-2026-07-02-6: Future Quorum Ratchets Do Not Rewrite Stored Question Configs

Severity: Informational

Status: Policy note.

Where:

- `packages/foundry/contracts/ContentRegistry.sol:825` stores per-content round config at submission/config time.
- `packages/foundry/contracts/ContentRegistry.sol:1101` validates config updates through current bounds.
- `packages/foundry/contracts/libraries/RoundCreationLib.sol:40` only enforces the absolute RBTS participant floor.
- `packages/foundry/contracts/ProtocolConfig.sol:69` stores the live protocol bounds, and
  `packages/foundry/contracts/ProtocolConfig.sol:1127` validates new configs against those bounds.

Scenario:

If governance later raises `minSettlementVoters` from three to five, new submissions must respect the higher bound, but
older questions with stored `minVoters = 3` can continue opening future rounds at three because the round-creation guard
only enforces the absolute RBTS floor.

Assessment:

- This appears consistent with immutable per-question config and avoids surprising UX changes for existing questions.
- It is only a security issue if governance expects emergency quorum ratchets to affect already-created content.

Recommendation:

- Document that quorum bound changes apply to newly validated content configs, not automatically to existing content.
- If emergency ratchets must cover existing questions, add a separate governed migration or per-content update flow.

## Checked Non-issues

- Direct child payout snapshot rejection now uses the proposal-time consumer and blocks rejection after consumption.
- Consumer rotation does not bypass the consumed-root guard because proposals snapshot the consumer address.
- Snapshotless cluster skip is governance-only and only advances the cursor; it does not allocate funds or make claims
  payable without a finalized replacement snapshot.
- Snapshotless skip cannot be used after refund finality because repointing rejects `refunded` and
  `unallocatedRefunded` pools.
- `roundCore` canonicalization is safe in current Solidity consumers and generated ABI tests cover the 8-return shape.
- The L-5 quorum fix does not increase normal user wait time or raise the product's default minimum voters. It rejects
  below-RBTS snapshots only when a malformed or stale config would otherwise open a bad round.
- Bundle terminal sync does not bypass payout gates; it records terminal rounds, while qualification still requires a
  complete round set and finalized cluster snapshot.

## Suggested Fix Order

1. Fix SC-2026-07-02-1 in contracts before deployment if arbiter parent-epoch veto remains enabled after child payouts
   can begin.
2. Fix SC-2026-07-02-2 in keeper/Ponder before relying on proactive reward qualification for production liveness.
3. Fix SC-2026-07-02-3 and SC-2026-07-02-4 together as keeper observability/indexing hardening.
4. Decide whether SC-2026-07-02-6 is accepted policy or should become a governed migration feature.

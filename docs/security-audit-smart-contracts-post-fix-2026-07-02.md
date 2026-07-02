# Smart Contract Security Audit - Post-fix Pass - 2026-07-02

## Scope

This follow-up reviewed the smart contract changes on `main` after the earlier
2026-07-02 smart contract audit, with emphasis on:

- `523c1bf84 contracts: guard consumed child roots on parent veto`
- `ee9b06bb8 keeper: advance reward qualification cursors`
- `19407e82d ponder: filter skipped reward qualification work`
- The recent oracle-backed RBTS settlement stack introduced around
  `c87880aae`, `94cfa99d7`, `da8641417`, and `52f44d6c1`

The review was code-read only for contracts. No Solidity fixes were made in this
pass. Three parallel read-only reviewers inspected the oracle parent-veto path,
question reward recovery/cursor paths, and RBTS settlement paths respectively.

The audit applies the project trust model in `AGENTS.md`: cluster payout roots
are optimistic and challengeable, and the challenge bond is treated as an
anti-spam bond rather than payout-value coverage.

## Summary

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| SC-POST-2026-07-02-1 | Medium | RBTS settlement | New finding |
| SC-POST-2026-07-02-2 | Medium | Question reward recovery | New finding |
| SC-POST-2026-07-02-3 | Informational | Regression coverage | Verification gap |

The recent parent-veto fix in `ClusterPayoutOracle` checked out cleanly in both
manual review and targeted tests. I did not find a new issue in that change.

## Findings

### SC-POST-2026-07-02-1: Zero effective RBTS leaves can strand revealed voters' principal

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/ClusterPayoutOracle.sol`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol`
- `packages/foundry/contracts/libraries/RoundRevealLib.sol`
- `packages/foundry/contracts/RoundRewardDistributor.sol`

**Issue:**

`ClusterPayoutOracle.verifyPayoutWeight` rejects leaves whose
`effectiveWeight > baseWeight`, but it accepts a leaf with `baseWeight > 0` and
`effectiveWeight == 0`. `RoundRbtsSettlementSnapshotLib.applySnapshotWeights`
also accepts that zero effective weight, then overwrites
`commitRbtsWeight[payout.commitKey]` with zero.

RBTS settlement later uses `commitRbtsWeight > 0` as the condition for returning
principal:

- `RoundRevealLib.returnRbtsStakes` only sets `commitRbtsStakeReturned` for
  revealed commits whose `rbtsWeight > 0`.
- `RoundRevealLib.scoreRbtsRewards` builds its scoring set from revealed commits
  whose `commitRbtsWeight > 0`, so zero-weight revealed commits are excluded
  from both scoring and stake-return accounting.
- `RoundRewardDistributor.claimReward` marks the commit claimed before the
  RBTS reward transfer branch, and `_claimRbtsReward` only transfers principal
  when `stakeReturned > 0`.

That means a finalized RBTS root can include a revealed commit with nonzero
base stake but zero effective weight; the commit can then be claim-finalized
without returning its principal. The LREP remains accounted in the voting
engine, so `recoverSurplusLrep` does not provide a cleanup path.

This requires a bad, malicious, or buggy optimistic payout artifact to finalize
unchallenged. It is still a contract-side custody issue because the consumer
accepts the leaf and then treats zero scoring weight as no refundable stake.

**Impact:**

A revealed voter included in an accepted RBTS settlement root can lose access to
their staked principal even though their base stake is nonzero. In mixed roots,
nonzero-weight voters can settle normally while zero-weight voters are stranded.
If the finalized root leaves too few nonzero-weight participants for scoring,
settlement can also be delayed until the timeout path, which has the same
zero-weight stake-return condition.

**Recommendation:**

Decouple principal refund eligibility from scoring weight, or reject zero
effective RBTS leaves on-chain. A conservative fix is to require
`payout.effectiveWeight > 0` in the RBTS settlement consumer when
`baseWeight > 0`. If zero effective scoring weight is a valid oracle outcome,
store enough independent principal-return state so every revealed commit with
nonzero base stake can claim its stake even when its scoring weight is zero.

Add tests covering:

- Mixed RBTS roots with one zero-effective revealed voter and at least one
  nonzero-effective voter.
- The no-forfeit stake-return branch.
- The scored branch and the timeout fallback branch.

### SC-POST-2026-07-02-2: Rejected-snapshot recovery can convert eventual refunds into a pending-recovery lock

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol`

**Issue:**

`recoverRejectedSnapshotRound` is permissionless once a qualified cluster
snapshot is rejected and no first claim has paid. It returns the qualified
allocation to `unallocatedAmount`, decrements `qualifiedRounds`, increments
`pendingRecoveredRounds`, deletes the qualified snapshot, stores the parked
allocation, and marks `rejectedRecoveredRound[rewardPoolId][roundId] = true`.

After that transition, both refund entrypoints block before reaching their
normal refund logic:

- `refundExpiredRewardPool` calls `_requireNoPendingRecoveredRounds`.
- `refundInactiveRewardPool` calls `_requireNoPendingRecoveredRounds`.

Normal qualification also blocks while a recovered round is pending; the only
pool-local way out is to reopen and requalify the recovered round. Reopen
requires a finalized, non-rejected replacement snapshot for the same round from
the currently pinned oracle.

Before recovery, the rejected qualified snapshot is inconvenient but eventually
refundable: after the claim grace, `refundExpiredRewardPool` can process the
complete-pool residue because `pendingRecoveredRounds == 0`. After any caller
invokes recovery, that refund path is no longer reachable unless an oracle
replacement finalizes and the round is requalified.

Current new pool creation requires one settled round, so this is primarily a
custody/liveness lock on the pool residue rather than a multi-round cursor
ordering issue for freshly created pools. Governance repointing can help only
when its preconditions hold and a replacement oracle/proposer path is available;
there is no timeout, cancel, or refund escape that clears
`pendingRecoveredRounds` when replacement settlement does not arrive.

**Impact:**

After an arbiter rejects a qualified cluster snapshot, any account can move the
pool into a pending-recovery state that blocks the eventual expired/inactive
refund path. If the replacement oracle path is unavailable, misconfigured, or
never produces a finalized replacement root, the reward pool funds remain
locked.

**Recommendation:**

Add an explicit exit for recovered rounds that cannot be requalified. Options:

- Allow refund/cancel of recovered rounds after the original claim-grace or
  bounty-expiry condition, clearing `pendingRecoveredRounds` and
  `rejectedRecoveredRound`.
- Allow the funder/governance to abandon a recovered round and refund or
  protocol-route the parked allocation, subject to the pool's refundable versus
  non-refundable policy.
- If recovery should always prefer replacement, restrict who can trigger
  `recoverRejectedSnapshotRound` or require a finalized replacement snapshot in
  the same transaction family.

Add a regression test where a qualified cluster snapshot is rejected, a third
party calls `recoverRejectedSnapshotRound`, no replacement snapshot finalizes,
time passes beyond the normal refund grace, and the pool can still be exited
without leaving `pendingRecoveredRounds` latched.

### SC-POST-2026-07-02-3: Existing RBTS/recovery regression slices are not currently green

**Severity:** Informational

**Affected code:**

- `packages/foundry/test/RoundVotingEngineBranches.t.sol`
- `packages/foundry/test/QuestionRewardPoolEscrow.t.sol`

**Issue:**

The existing targeted regression slices for the recently changed areas are not
green on current `main`.

Command:

```sh
forge test --offline --match-contract RoundVotingEngineBranchesTest --match-test test_Rbts
```

Result: 6 passed, 11 failed. Most failures reverted with `RoundNotOpen()` in
seed-expiry/scoring tests; one failed `ck1 RBTS score: 0 <= 0`.

Command:

```sh
forge test --offline --match-contract QuestionRewardPoolEscrowTest --match-test RecoveredSnapshot
```

Result: 0 passed, 4 failed. A verbose sample showed the test calling
`ClusterPayoutOracle.setFinalizedRoundPayoutSnapshot(...)`, which the real
`ClusterPayoutOracle` does not expose, so at least that slice has stale helper
coverage against the current oracle-backed path.

**Impact:**

The failing slices reduce confidence that RBTS settlement and rejected-snapshot
recovery are covered by executable regression tests. This also makes future
security fixes in these areas harder to validate quickly.

**Recommendation:**

Refresh the affected tests to use the current oracle proposal/finalization
helpers and settlement-pending flow. Add dedicated tests for the two findings
above before changing production code.

## Validated Areas

### Parent correlation-epoch veto guard

No issue found in `523c1bf84`.

The new parent-veto path computes the current correlation epoch digest before
rejection, scans the bounded `correlationEpochSnapshotKeys[epochId]` set, and
reverts when a finalized child snapshot for that digest is known consumed by
its proposal-time consumer. The source set is bounded by
`MAX_CORRELATION_EPOCH_SOURCES`, and stale coverage entries do not let a child
proposal bind to a different current parent because proposal acceptance compares
against the current coverage digest.

Targeted test result:

```sh
forge test --offline --match-contract ClusterPayoutOracleTest --match-test 'test_FinalizedCorrelationEpochRejectRevertsWhenChildSnapshotConsumed|test_RejectedFinalizedCorrelationEpochBlocksFuturePayoutVerification|test_FinalizedRoundPayoutSnapshotRejectRevertsWithinVetoWindowWhenConsumed|test_FinalizedRoundPayoutSnapshotRejectUsesSnapshottedConsumerAfterRotation'
```

Result: 4 passed, 0 failed.

### Slither

Command:

```sh
slither . --config-file slither.config.json
```

Result: nonzero exit with 21 detector results. The reported items were
`uninitialized-state` and `constable-states` findings on
`RoundVotingEngineStorage` fields as analyzed through
`RoundVotingEngineRbtsSettlementModule`. This is expected noise for the
delegatecall storage module shape, but it should remain documented because a
plain Slither run is not clean.

## Follow-up Plan

1. Fix SC-POST-2026-07-02-1 by either rejecting zero-effective RBTS settlement
   leaves or returning principal independently from effective scoring weight.
2. Fix SC-POST-2026-07-02-2 by adding a timeout/cancel/refund escape for pending
   recovered reward-pool rounds.
3. Refresh the stale RBTS and recovered-snapshot regression tests, then add
   focused tests for both fixes.
4. Re-run the targeted RBTS, reward-pool recovery, oracle, and Slither checks.

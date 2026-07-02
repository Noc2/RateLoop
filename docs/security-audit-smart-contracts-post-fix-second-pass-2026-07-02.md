# Smart Contract Security Audit - Post-fix Second Pass - 2026-07-02

## Scope

This pass reviewed `main` at `8867711ea` after the 2026-07-02 post-fix work,
with emphasis on the recent smart contract and storage-layout changes:

- `530508713 contracts: add recovered reward pool refund exits`
- `d2748f9ab test: align RoundVotingEngine storage layout`
- `9b9109c5d test: refresh RBTS settlement regressions`
- `8867711ea test: align cluster oracle config fixtures`
- The earlier RBTS settlement hardening in `186432fff`

No contract or test fixes were made in this pass. The only intended output is
this findings document.

The review used the project trust model in `AGENTS.md`: cluster payout roots
are optimistic and challengeable, challenge bonds are anti-spam bonds, and the
configured 60-minute `revealGracePeriod` is an accepted product/security
parameter.

## Methodology

- Manual review of recent diffs and the affected contract paths.
- Three parallel read-only reviewers for recovered reward-pool exits, RBTS
  settlement, and config/storage/oracle surfaces.
- Focused Foundry regression runs in the primary workspace.
- Slither and Aderyn static-analysis runs from `packages/foundry`.
- External reference check against the official OpenZeppelin Upgrades guidance
  on storage layout rules and storage gaps:
  <https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#modifying-your-contracts>
  and
  <https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#storage-gaps>.

## Summary

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| SC-2P-2026-07-02-1 | High | Upgradeability / storage layout | New finding |
| SC-2P-2026-07-02-2 | Medium | Recovered reward-pool refunds | New finding |
| SC-2P-2026-07-02-3 | Medium | Legacy reward-pool refunds | New finding, legacy-state conditional |
| SC-2P-2026-07-02-4 | Medium | Public rating settlement | New finding |

The earlier zero-effective RBTS settlement issue appears fixed by the
`payout.effectiveWeight == 0` rejection in
`RoundRbtsSettlementSnapshotLib.applySnapshotWeights`. The earlier
no-replacement recovered-round liveness issue is improved by the new recovered
refund entrypoints, but those entrypoints introduce the narrower findings below.

## Findings

### SC-2P-2026-07-02-1: RBTS settlement fields shift existing `RoundVotingEngine` storage slots

**Severity:** High for hot upgrades from a populated pre-RBTS proxy. Fresh
deployments from the current layout are unaffected.

**Affected code:**

- `packages/foundry/contracts/RoundVotingEngineStorage.sol`
- `packages/foundry/scripts/expected-storage-layouts/RoundVotingEngine.json`
- `packages/foundry/test/UpgradeTest.t.sol`

**Issue:**

The oracle-backed RBTS settlement refactor introduced
`roundRbtsSettlementOracle` and `roundRbtsSettlementSnapshotDigest` at
`RoundVotingEngineStorage.sol` slots 20 and 21, before existing fields such as
`roundThresholdReachedBlock`, `commitPredictedUpBps`, and `commitRbtsWeight`.

Comparing the pre-RBTS expected storage snapshot from `c87880aae^` with the
current snapshot shows:

- Before: `roundThresholdReachedBlock` at slot 20.
- Current: `roundRbtsSettlementOracle` at slot 20,
  `roundRbtsSettlementSnapshotDigest` at slot 21, and
  `roundThresholdReachedBlock` shifted to slot 22.
- Every later field is similarly shifted by two slots until the append/gap
  area.

`make check-storage-layouts` passes because the expected JSON was updated to
match the current layout. That confirms fixture consistency, but it does not
prove upgrade compatibility from the previous implementation.

OpenZeppelin's upgrade guidance is explicit that upgraded contracts must not
change state-variable order, type, or introduce new variables before existing
ones, because doing so mixes up stored values. The same guidance recommends
using storage gaps for future additions.

**Impact:**

If this implementation is installed behind a `RoundVotingEngine` proxy that has
state from a pre-RBTS implementation, existing mappings after slot 19 are read
through different storage keys. In-flight round threshold blocks, commit score
weights, claim accounting, frontend pools, cleanup state, and later fields can
become inaccessible or interpreted as different data. That can break settlement,
claims, refunds, cleanup, and rating side effects for already-populated state.

**Recommendation:**

Move the new RBTS settlement storage into the append/gap area instead of slots
20 and 21. In practice, preserve all pre-RBTS slots through the old final field,
append `roundRbtsSettlementOracle`, `roundRbtsSettlementSnapshotDigest`, and
`rbtsSettlementModule` before the gap, then shrink the gap by the consumed slot
count.

Add an upgrade-compatibility test that asserts the pre-RBTS critical slots stay
stable, and run OpenZeppelin Foundry Upgrades `validateUpgrade` against the
actual deployed baseline before any proxy upgrade. If an incompatible
implementation has already been installed on a populated proxy, treat recovery
as a migration/redeploy-and-rewire event rather than a normal upgrade.

### SC-2P-2026-07-02-2: Reopened recovered rounds can be abandoned before claimants get a fresh replacement window

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol`

**Issue:**

`reopenRecoveredSnapshotRound` verifies a finalized replacement snapshot and
sets `reopenedRecoveredRound[rewardPoolId][roundId] = true`, but it does not
extend `claimDeadline` or otherwise reserve a fresh replacement qualification
window.

The new `refundExpiredRecoveredRewardPool` entrypoint only checks the pool's
existing `claimDeadline + BUNDLE_CLAIM_GRACE`, then abandons every supplied
`rejectedRecoveredRound`. `_abandonRecoveredRounds` does not distinguish a
parked recovered round with no replacement from a recovered round that already
has a finalized replacement snapshot and is waiting for `qualifyRound`.

That means if a replacement snapshot finalizes near or after the old refund
eligible time, any caller can race `qualifyRound` with
`refundExpiredRecoveredRewardPool`, clear `reopenedRecoveredRound`, delete the
parked snapshot, and route the remaining residue through the refund path.

**Impact:**

A valid replacement snapshot can be made unusable before voters get a full
post-replacement claim opportunity. The practical result is a liveness/custody
race between replacement qualification and recovered-pool refund after the old
claim grace has elapsed.

**Recommendation:**

Give reopened recovered rounds their own grace window. Options:

- Extend `claimDeadline` when `reopenRecoveredSnapshotRound` succeeds.
- Track a separate `reopenedAt`/`replacementReadyAt` timestamp and prevent
  abandonment until that replacement grace expires.
- Split abandonment into "no replacement" and "replacement opened but unclaimed"
  paths with different timing rules.

Add a regression where a rejected round is recovered, a replacement snapshot is
finalized after the original refund-eligible time, `reopenRecoveredSnapshotRound`
succeeds, and `refundExpiredRecoveredRewardPool` cannot beat qualification or
claims until the replacement grace expires.

### SC-2P-2026-07-02-3: Expired recovered refund can over-refund legacy multi-round pools

**Severity:** Medium, legacy-state conditional

**Affected code:**

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowTypes.sol`

**Issue:**

New pool creation now requires `requiredSettledRounds == 1`, so current newly
created reward pools are one-round pools. However, the stored `RewardPool` type
still supports `requiredSettledRounds > 1`, and legacy state may contain such
pools.

`refundExpiredRecoveredRewardPool` abandons the supplied recovered rounds,
sets `rewardPool.unallocatedAmount = 0`, then calls `_refundCompleteRewardPool`.
That complete refund path returns `rewardPool.fundedAmount -
rewardPool.claimedAmount` and does not enforce the incomplete-pool checks in
`_refundUnallocatedRewardPool`, including:

- `qualifiedRounds < requiredSettledRounds`
- `requireNoPendingFinishedRound(...)`
- refunding only the currently unallocated amount

For one-round pools, this matches the intended complete-pool exit. For a legacy
multi-round pool, one recovered round can satisfy the recovered-abandonment
precondition even though later required rounds may still be unevaluated or
qualifiable.

**Impact:**

A legacy multi-round pool can be treated as complete and refunded in full after
abandoning recovered rounds, potentially bypassing later-round qualification or
the normal incomplete-pool cursor checks.

**Recommendation:**

Gate the complete refund path on actual completion semantics, for example:

- Use `_refundCompleteRewardPool` only when
  `qualifiedRounds + pendingRecoveredRounds >= requiredSettledRounds` before
  abandonment, or when the pool is otherwise known to be complete.
- For incomplete legacy pools, clear the recovered-round latch and then follow
  the normal unallocated refund path with `requireNoPendingFinishedRound`.
- Add a legacy-state regression by manually constructing or migrating a
  `requiredSettledRounds > 1` pool, recovering one round, leaving a later round
  pending/qualifiable, and asserting the recovered refund cannot drain the full
  pool.

### SC-2P-2026-07-02-4: Public rating snapshots can apply out of round order after RBTS-pending settlement

**Severity:** Medium

**Affected code:**

- `packages/foundry/contracts/libraries/RoundLib.sol`
- `packages/foundry/contracts/RoundVotingEngine.sol`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementCompletionLib.sol`
- `packages/foundry/contracts/ContentRegistry.sol`
- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
- `packages/foundry/contracts/libraries/RatingMath.sol`

**Issue:**

`RoundLib.isTerminal` treats `SettlementPending` as terminal, so a later round
can open and settle while an earlier round is still waiting for its RBTS
settlement snapshot. The public-rating side effect is recorded only when RBTS
settlement completes, via `RoundRbtsSettlementCompletionLib.complete`.

`ContentRegistry.applyRatingPayoutSnapshot` applies whichever pending
settlement is supplied. `ContentRegistryRatingSnapshotLib.applyRatingPayoutSnapshot`
marks that round applied and computes the next rating from the current rating
state, the pending round's adjusted evidence, and that round's snapshotted
rating config. There is no per-content cursor requiring round N's pending public
rating settlement to apply before round N+1.

The raw up/down evidence totals are additive, but the whole rating state is not
strictly order-independent:

- `confidenceMass` and `conservativeRatingBps` are recomputed using the
  applying round's snapshotted rating config.
- `lowSince` depends on the sequence of low and recovery transitions.
- `lastUpdatedAt` follows the applied snapshot timestamp.

If round 1 remains `SettlementPending`, round 2 completes and applies its public
rating snapshot first, and round 1 applies later, the final rating state can
differ from canonical round order, especially across rating-config changes or
slash-threshold boundaries.

**Impact:**

Content rating, conservative rating, low-rating timers, and downstream dormancy
or slashing decisions can become order-dependent on oracle finalization and
caller timing rather than voting-round order.

**Recommendation:**

Add a per-content public-rating application cursor, or require earlier pending
public-rating settlements to be applied, skipped, or explicitly cancelled before
later ones can apply.

Add a regression where:

1. Round 1 enters `SettlementPending`.
2. Round 2 opens and completes before round 1's RBTS snapshot is applied.
3. Round 2's public-rating snapshot attempts to apply first and is rejected.
4. Applying round 1 then round 2 yields the only accepted ordering.

## Validated Areas

### RBTS zero-effective settlement rejection

No new issue found in the zero-effective RBTS leaf fix. The settlement consumer
now rejects any payout where `baseWeight == 0`, `payout.baseWeight !=
baseWeight`, `payout.effectiveWeight == 0`, or `payout.effectiveWeight >
baseWeight`.

Targeted command:

```sh
forge test --offline --match-contract RoundVotingEngineBranchesTest --match-test test_Rbts -vv
```

Primary workspace result: 18 passed, 0 failed. This includes
`test_RbtsSettlementRejectsZeroEffectiveWeightLeaf`.

### Recovered refund no-replacement exits

The no-replacement exits added for recovered reward-pool rounds cover the core
lock from the previous audit: after the original claim grace or inactive-content
condition, a pool can clear recovered-round latches and refund residue without a
replacement oracle snapshot.

Targeted command:

```sh
forge test --offline --match-contract QuestionRewardPoolEscrowTest --match-test Recovered -vv
```

Primary workspace result: 10 passed, 0 failed.

### ProtocolConfig oracle/consumer alignment

The focused oracle/consumer fixture checks pass.

Command:

```sh
forge test --offline --match-contract ProtocolConfigBranchesTest --match-test 'ClusterPayoutOracle|PayoutOracle|RewardDistributor' -vv
```

Primary workspace result: 29 passed, 0 failed.

### General audit-gap and upgrade regression slices

Commands:

```sh
forge test --offline --match-contract AuditGapTests -vv
forge test --offline --match-contract UpgradeTest -vv
```

Primary workspace results:

- `AuditGapTests`: 16 passed, 0 failed.
- `UpgradeTest`: 47 passed, 0 failed.

`UpgradeTest` checks current-code proxy behavior and the pinned current layout,
but it does not disprove SC-2P-2026-07-02-1 because the storage snapshot was
already updated to the shifted layout.

### Storage layouts and contract sizes

Commands:

```sh
make check-storage-layouts
make check-contract-sizes
```

Primary workspace results:

- `make check-storage-layouts`: passed; all checked layouts match the current
  pinned snapshots.
- `make check-contract-sizes`: passed on a clean rerun; all checked deployed
  bytecode sizes are within the EIP-170 limit. An earlier parallel run failed
  because concurrent artifact rebuilds mixed deploy/non-deploy profiles, then
  the standalone rerun passed.

## Static Analysis

### Slither

Command:

```sh
slither . --config-file slither.config.json
```

Result: nonzero exit with 21 detector results. The results were
`uninitialized-state` and `constable-states` reports on
`RoundVotingEngineStorage` fields as seen through
`RoundVotingEngineRbtsSettlementModule`. This matches the known delegatecall
storage-module noise from the previous audit and did not produce a new finding
by itself.

### Aderyn

Command:

```sh
aderyn .
```

Result: Aderyn 0.6.8 generated `report.md` with `High: 0` and Low issue
categories only, then crashed with a fatal internal macOS/system-configuration
panic. I treated this as inconclusive static-analysis evidence rather than a
clean pass.

## Verification Caveat

The focused successful verification above was run in the primary workspace. A
separate clean detached worktree at `8867711ea` was attempted to cross-check the
same suites, but it could not compile because the temporary worktree did not
have a complete Foundry dependency checkout after dependency auto-install
failed. No production Solidity changes were made as part of this audit pass.

## Recommended Fix Plan

1. Fix `RoundVotingEngine` storage layout before any hot upgrade: preserve the
   pre-RBTS slots, append new RBTS settlement fields into the gap, add a
   compatibility regression, and run OZ upgrade validation against the deployed
   baseline.
2. Add replacement-grace semantics for reopened recovered reward-pool rounds so
   a valid replacement cannot be abandoned immediately after the old claim grace.
3. Harden `refundExpiredRecoveredRewardPool` for any legacy multi-round pool
   state by using complete-pool refunds only when the pool is actually complete.
4. Add a public-rating application cursor so pending rating snapshots apply in
   voting-round order.

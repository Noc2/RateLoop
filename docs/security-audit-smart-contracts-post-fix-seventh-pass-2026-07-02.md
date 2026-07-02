# Smart Contract Security Audit - Post-Fix Seventh Pass

Date: 2026-07-02
Audited head: `f1d3ade77` (`origin/main`)
Scope: smart contracts and generated contract surfaces changed by the sixth-pass remediations.

## Context

This pass reviewed the latest `main` after the sixth-pass fixes:

- `4e874ac6f` - `contracts: harden prequalification recovery exits`
- `76de684ab` - `contracts: harden RBTS payout snapshot liveness`
- `03d32a144` - `contracts: keep rating snapshot skips recoverable`
- `f1d3ade77` - `contracts: refresh generated ABIs`

Audit assumptions:

- The protocol will be freshly redeployed; old contracts will not remain in use.
- Storage-layout movement is therefore not itself an upgrade safety finding, though pinned layouts were still checked.
- The protocol should remain decentralized from launch; fixes should not add centralized operators or off-chain-only escape hatches.
- UX should not be degraded by forcing ordinary users through extra manual recovery steps.
- `ClusterPayoutOracle` remains an optimistic oracle by design: deterministic public artifacts are recomputed off-chain, disputed during challenge/veto windows, and arbitrated by governance. This pass treats that trust model as accepted and only flags mismatches inside the on-chain state machine.

## Summary

One new actionable issue was found.

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| H-7P-1 | High | `ClusterPayoutOracle` finalization veto timing | Open |

## Findings

### H-7P-1 - Finalized child payout snapshots stop being rejectable before they become consumable

Affected files:

- `packages/foundry/contracts/ClusterPayoutOracle.sol`
- `packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol`
- Other consumers that gate application with `isRoundPayoutSnapshotOutsideVetoWindow`

The sixth-pass fix correctly changed `isRoundPayoutSnapshotOutsideVetoWindow` so a finalized round payout snapshot becomes consumable only after both deadlines have passed:

- the child round payout snapshot veto deadline, and
- the parent correlation epoch veto deadline.

That check is implemented at `ClusterPayoutOracle.sol:831-845`.

However, finalized child rejection still uses only the child snapshot deadline. `rejectFinalizedRoundPayoutSnapshot` delegates to `_rejectFinalizedRoundPayoutSnapshot`, which reverts once `block.timestamp >= _roundPayoutSnapshotVetoDeadline(proposal)` at `ClusterPayoutOracle.sol:740-748`.

This creates a gap when the parent epoch veto deadline is later than the child snapshot veto deadline. That can occur if the parent epoch was proposed with a longer `finalizationVetoWindowAtProposal` and the child snapshot was proposed after governance shortened the oracle timing config. The parent stores its proposal-scoped veto window at `ClusterPayoutOracle.sol:327-333`; the child stores its proposal-scoped veto window at `ClusterPayoutOracle.sol:537-555`.

During the gap:

1. Consumers cannot apply the child snapshot because `isRoundPayoutSnapshotOutsideVetoWindow` still returns false while the parent veto window is open.
2. Governance/arbiter cannot reject the finalized child snapshot because `_rejectFinalizedRoundPayoutSnapshot` already considers the child veto deadline expired.
3. If the child root or metadata is discovered bad during this still-reviewable parent window, the protocol cannot reject only the child before it becomes consumable.

For RBTS settlement, this matters because `RoundRbtsSettlementSnapshotLib.applySnapshotWeights` requires the combined outside-veto predicate before accepting proofs at `RoundRbtsSettlementSnapshotLib.sol:53-57`. The same timing mismatch also affects public-rating and reward consumers that rely on the oracle's outside-veto predicate.

Impact:

- A bad finalized child payout root can pass from "not yet consumable" directly to "consumable and no longer child-rejectable" when the parent deadline arrives.
- The issue weakens the purpose of the parent veto extension introduced in the previous fix: reviewers get extra parent review time, but not an equivalent ability to reject a bad child found during that time.
- This is not an added centralization concern; the problem is that the existing arbiter/governance rejection window is shorter than the consumer finality window.

Recommended fix:

- Make finalized child rejection use the same effective deadline as consumption.
- Concretely, `_rejectFinalizedRoundPayoutSnapshot` should remain available until:
  - `block.timestamp >= _roundPayoutSnapshotVetoDeadline(proposal)`, and
  - `block.timestamp >= _correlationEpochVetoDeadline(parentEpoch)`.
- Add a regression where:
  - parent epoch has a longer proposal-scoped finalization veto window,
  - child round payout snapshot has a shorter proposal-scoped finalization veto window,
  - the child veto deadline passes but the parent veto deadline has not,
  - `isRoundPayoutSnapshotOutsideVetoWindow(...) == false`, and
  - `rejectFinalizedRoundPayoutSnapshot(...)` still succeeds.

This fix should not hurt normal UX: users still wait until the same finality predicate before consuming roots, and the only behavior change is preserving review/rejection authority until the snapshot is actually usable.

## Triage Notes

### RBTS shape-valid but semantically invalid roots

One audit lane considered whether a finalized RBTS root with the correct revealed count but invalid leaves could permanently block timeout settlement. I did not carry this forward as a new finding because it is the accepted optimistic-oracle trust model: deterministic artifacts are public, challengers recompute during the challenge/veto windows, and governance arbitrates invalid roots. The actionable issue above is narrower: the child root may become non-rejectable while still inside the parent-enforced review window.

### Rating provisional skips

The public-rating provisional skip logic was reviewed for ordering, consumed-digest, and source-ready regressions:

- provisional skips do not set `applied = true`,
- provisional skips do not write a consumed digest,
- late valid evidence can still apply before a later rating is applied,
- later applied ratings close older provisional skips.

No actionable issue was found under the intended policy.

### Prequalification recovery exits

The prequalification/reward escrow recovery changes were reviewed for premature refunds, oldest-first abandonment, live replacement snapshot blocking, and skipped-flag clearing after successful replacement qualification. No actionable issue was found.

### Storage layout

`ContentRegistry` gained `latestAppliedRatingSnapshotRoundId`, shifting later storage slots. Because this deployment is fresh and old contracts will not be used, this was not treated as a vulnerability. The pinned storage-layout snapshots were still updated and verified.

### Generated ABIs

Generated ABIs and `deployedContracts.ts` were refreshed after the Solidity surface changed. The contracts package tests confirmed standalone ABIs match shared deployment ABIs.

### Compiler known bugs

The project is pinned to `solc 0.8.35` with via-IR. I checked Solidity's official known-bugs list and did not identify a currently listed compiler bug affecting this compiler/profile combination. Reference: https://docs.soliditylang.org/en/latest/bugs.html

## Verification

Commands run:

- `slither .`
  - Completed with 21 results.
  - Triage: known/shared-storage false positives around `RoundVotingEngineRbtsSettlementModule` delegatecall storage, and low-value constable-state noise.
- `yarn foundry:aderyn`
  - Completed with 0 high issues and 23 low-pattern categories.
  - Triage: broad centralization, loop, style, PUSH0, pragma, and similar low-pattern output; no new actionable issue from the recent changes.
- `forge test --offline --match-contract SecondPassRatingSnapshotOrderingTest -vv`
  - 7 passed, 0 failed.
- `make check-storage-layouts`
  - All checked storage layouts matched pinned snapshots.
- `make check-contract-sizes`
  - All checked deploy-profile contracts were within the EIP-170 limit.
- `forge test --offline`
  - 1832 passed, 0 failed, 0 skipped.

Note: running `make check-storage-layouts` and `make check-contract-sizes` in parallel caused artifact-profile interference on the first size check attempt. Re-running `make check-contract-sizes` by itself passed.

# RateLoop Smart Contract Security Review - Multi-Agent Pass 6

Date: 2026-07-04
Base revision reviewed: `15a61c5cd` on `main`
Scope: `packages/foundry/contracts`
Status: 0 critical/high findings; 2 new medium findings

No code remediation is included in this report commit. This pass was run after
the RL5-01 bundle-recovery refund fix landed in `15a61c5cd`.

## Methodology

- Ran three parallel read-only review slices:
  - `ClusterPayoutOracle`, correlation-epoch rejection, finalized veto
    windows, and direct oracle consumers.
  - `QuestionRewardPoolEscrow` bundle/single-question reward qualification,
    pre-qualification skipping, recovery, reopen, claim, and refund paths.
  - Access control, custody, role rotation, X402 payment binding, feedback
    bonuses, frontend fee credits, deploy handoff, and governance wiring.
- Rechecked every returned lead against current source before inclusion and
  deduplicated against the 2026-07-03 and 2026-07-04 pass 2-5 review docs.
- Used official references as audit checklists, especially Solidity's security
  considerations for reentrancy, gas-bounded loops, `tx.origin`, and
  authorization pitfalls:
  https://docs.soliditylang.org/en/latest/security-considerations.html
- Cross-checked role/custody assumptions against OpenZeppelin access-control
  and reentrancy-guard guidance:
  https://docs.openzeppelin.com/contracts/5.x/access-control
  https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard
- Ran static-analysis triage:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: 0 results.
  - `yarn foundry:aderyn`: 0 high findings, 23 low/static-hygiene findings
    triaged as not changing this report's security conclusions.
- Ran focused verification:
  - `forge test --match-contract 'ContentRegistryRepointTest|SecondPassRatingSnapshotOrderingTest|SecondPassRbtsSettlementOracleTest|ClusterPayoutOracleTest' -vv`:
    120 passed.
  - `forge test --match-contract QuestionRewardPoolEscrowTest --match-test 'testRecoveredBundle|testBundleRefund|legacyRecoveredBundle|testRecoveredBundleRefund|testPreQualificationRejected|testRecoveredSnapshotBundle' -vv`:
    27 passed.
  - `make check-contract-sizes`: passed.
  - `make check-storage-layouts`: passed.
- Additional subagent verification passed `ClusterPayoutOracleTest` (99 tests),
  targeted oracle-consumer boundary checks (7 tests), `UpgradeTest` (47 tests),
  governance tests (69 tests), and scoped frontend/config/rater/launch/feedback
  distributor suites (510 tests).

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL6-01 | Medium | Bundle reward recovery | Snapshotless pre-qualification skip can pin a non-qualifying bundle round set and force refund/forfeit. |
| RL6-02 | Medium | Bundle reward recovery | Recovered bundle round sets lose the original raw completer count, allowing requalification after claimant-set shrinkage. |

## RL6-01: Snapshotless Bundle Skip Can Pin A Non-Qualifying Round Set

Severity: Medium

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
  - `skipPreQualificationRejectedSnapshotRoundSet` (lines 31-80)
  - `_requireRejectedOrMissingPreQualificationBundleSnapshot` (lines 514-558)
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
  - `_qualifyPendingBundleRoundSet` (lines 1045-1079)
  - `_qualifyBundleRoundSet` (lines 1080-1242)
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleLib.sol`
  - `resetRoundSet` (lines 254-279)

`skipPreQualificationRejectedSnapshotRoundSet` only requires the bundle round
set to be complete before it records a rejected or missing pre-qualification
snapshot. In the missing-snapshot branch,
`_requireRejectedOrMissingPreQualificationBundleSnapshot` returns
`(bytes32(0), bytes32(0))` after checking only oracle pinning, source readiness,
and consumer binding. It does not check that the round set has enough common
eligible completers or that it would qualify if a payout snapshot existed.

After the skipped marker is set, `_qualifyPendingBundleRoundSet` treats the
round set as `preQualificationSkipped`. `_qualifyBundleRoundSet` then returns
`false` without calling `resetRoundSet` when the live completer count is below
`requiredCompleters`, when the cluster snapshot is missing/rejected, or when
the later snapshot is otherwise not qualifiable. The reset is the mechanism
that rewinds `bundleQuestionRecordedRounds` and lets the bundle try a later
round set, so the skipped marker can permanently pin the bundle to a failed
round set.

Impact scenario:

1. A bundle round set becomes complete because each underlying question has a
   settled round, but fewer than `requiredCompleters` identities completed
   every bundled question.
2. Before the ordinary sync path resets the failed set, any caller invokes
   `skipPreQualificationRejectedSnapshotRoundSet` while no oracle snapshot has
   been proposed for the bundle's synthetic snapshot round.
3. The skipped marker prevents the normal reset path from running. The bundle
   cannot qualify the current set, cannot advance to a replacement set, and the
   refund path later sees no pending snapshot work.
4. If no earlier round set qualified, the remaining bundle funds can be
   refunded or forfeited immediately after the refund sync. If earlier round
   sets qualified, the same refund/forfeit path opens after the claim grace.

This is a permissionless griefing issue. It does not let the caller steal the
reward directly, but it can permanently deny future valid bundle completion and
redirect the reward residue away from intended claimants.

Recommendation:

- Before setting `preQualificationSnapshotlessSkipped`, compute the live bundle
  completer count and require the round set is actually qualifiable under the
  same minimum-completer, effective-unit, allocation, and snapshot constraints
  used by normal qualification.
- For rejected snapshots, require the rejected snapshot's raw eligible voter
  count and effective-unit fields to match a live qualifiable round set before
  pinning the skip.
- If those checks fail, reset the non-qualifying round set instead of marking
  it skipped.
- Add a regression where every bundled question settles, the intersection of
  completers is below `requiredCompleters`, snapshotless skip is attempted, and
  later rounds remain available after the attempted skip.

## RL6-02: Recovered Bundle Sets Lose Original Raw Completer Count

Severity: Medium

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol`
  - Normal qualification stores `rawEligibleCompleters` (line 1242).
  - `hasQualifiableRecoveredBundleReplacementSnapshot` compares the replacement
    snapshot only to the current completer count (lines 696-750).
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`
  - `_recoverRejectedSnapshotRoundSet` deletes the snapshot and restores only
    `allocation` (lines 205-267).
  - `_reopenRecoveredSnapshotRoundSet` passes only the recovered allocation into
    the replacement-snapshot check (lines 269-335).
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowTypes.sol`
  - `BundleRoundSetSnapshot` already has a `rawEligibleCompleters` field
    (lines 114-130).
- Contrast: `QuestionRewardPoolEscrowRecoveryLib` preserves and rechecks the
  original single-question `rawEligibleVoters` during recovery and reopen
  (lines 220-318).

Normal bundle qualification records `rawEligibleCompleters`, but bundle
recovery deletes the snapshot and restores only the returned allocation. The
reopen path then checks the replacement oracle snapshot against the current
bundle completer count, not against the original recovered count. If the
claimant set shrinks after the rejected snapshot is recovered, a smaller
replacement snapshot can pass as long as it still meets `requiredCompleters`
and the current recomputed count.

Impact scenario:

1. A bundle round set originally qualifies with four eligible completers.
2. Its cluster payout snapshot is rejected before any first claim, and recovery
   moves the allocation back to `unallocatedAmount`.
3. The identity/eligibility set later drifts down to three eligible completers,
   while `requiredCompleters` is three.
4. A replacement snapshot with `rawEligibleVoters = 3` can reopen and requalify
   the recovered round set, reallocating the recovered funds among the smaller
   claimant set and excluding an originally qualified completer.

The single-question recovery path already avoids this by preserving
`rawEligibleVoters` and requiring the replacement snapshot to match both the
stored original count and the live recomputation. Bundle recovery should have
the same invariant.

Recommendation:

- Preserve `rawEligibleCompleters` when recovering a rejected bundle round set,
  alongside the preserved allocation.
- Require replacement `rawEligibleVoters` to match both the recovered raw count
  and the live recomputed completer count before `reopenRecoveredSnapshotRoundSet`
  can succeed.
- Add a regression where the original bundle snapshot qualified above the
  minimum, recovery preserves the raw count, the live claimant set later shrinks
  to the minimum, and replacement reopen is rejected.

## Non-Findings Checked

- RL5-01 remains fixed in `15a61c5cd`: direct recovered bundle refunds are
  blocked during replacement, and the focused recovered-bundle/refund tests
  passed after this review.
- `ClusterPayoutOracle` effective veto behavior was rechecked. Both
  `rejectFinalizedRoundPayoutSnapshot` and
  `isRoundPayoutSnapshotOutsideVetoWindow` use the effective deadline that
  accounts for child snapshot and parent correlation-epoch veto windows.
- Mutating oracle consumers reviewed in this pass gate use of finalized roots
  through outside-veto, source-ready, pinned-oracle, and consumer-binding
  checks before irreversible state updates.
- Single-question recovered snapshot reopen now preserves and checks original
  raw voter counts and live qualification constraints; the bundle issue above
  is the remaining sibling mismatch.
- Question and bundle claim paths bind claims to the current finalized
  digest/root and rejected-root state before accepting payout proofs; no
  double-claim or stale-root claim bypass was confirmed.
- Ordinary reward refund paths remain blocked by pending recovered or
  pre-qualification snapshot work where those pending counters are set.
- Access-control and custody review found no concrete bypass in deploy
  handoff, X402 USDC custody/residue handling, feedback-bonus award authority,
  frontend fee-creditor grants, registry/module rotation, or historical
  advisory recorder authorization.

## Limitations

This was a source review plus static analysis and focused Foundry testing, not
formal verification or exhaustive fuzzing. The two findings above are
confirmed against current code, but the absence of additional findings should
not be read as a proof that no other issue exists.

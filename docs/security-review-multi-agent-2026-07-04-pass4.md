# RateLoop Smart Contract Security Review - Multi-Agent Pass 4

Date: 2026-07-04
Base revision reviewed: `524312e90` on `main`
Scope: `packages/foundry/contracts`
Status: 2 new confirmed findings, 0 high/critical findings

This pass reviewed the current smart-contract code after the pass3 findings
were fixed in:

- `82e99685f fix: refresh rating settlement skip clock`
- `524312e90 fix: resolve advisory availability credentials`

No code remediation is included in this report commit.

## Methodology

- Ran three read-only reviewer passes in parallel:
  - public rating, RBTS settlement, reward distribution, and oracle ordering
  - launch distribution, question rewards, feedback bonuses, confidentiality,
    recovery/refund/surplus, and treasury flows
  - identity, delegation, advisory voting, frontend registry, profile, and
    protocol-config guardrails
- Performed parent review of returned leads against current source.
- Deduplicated against:
  - `docs/security-review-multi-agent-2026-07-03.md`
  - `docs/security-review-multi-agent-2026-07-04-pass2.md`
  - `docs/security-review-multi-agent-2026-07-04-pass3.md`
- Ran static analysis:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`
    - Result: `0 result(s) found`
  - `yarn foundry:aderyn`
    - Result: 0 high issues; 23 broad low categories reviewed as triage input,
      with no additional confirmed issue promoted
- Ran focused Foundry regression baselines:
  - `forge test --match-contract 'ContentRegistryRepointTest|SecondPassRatingSnapshotOrderingTest' -vv`
    - Result: 14 passed, 0 failed
  - `forge test --match-contract RoundIntegrationTest --match-test test_SettlementSideEffectFailure_CanReplayPendingRatingSettlement -vv`
    - Result: 1 passed, 0 failed
  - `forge test --match-path test/RoundVotingEngineBranches.t.sol --match-test 'test_AdvisoryVoteCapsUnverifiedCommitsFromLaunchPolicy|test_VerifiedAdvisoryVoteBypassesUnverifiedCommitCap|test_DelegatedVerifiedAdvisoryAvailabilityBypassesUnverifiedCommitCap|test_AdvisoryVoteUsesCorePreflightAndRaterIdentityDedupe' -vv`
    - Result: 4 passed, 0 failed

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL4-01 | Medium | Public rating snapshot recovery | Rejected public-rating roots can be provisionally skipped without a fresh replacement window after rejection. |
| RL4-02 | Medium | Public rating snapshot recovery | Repointing an already provisionally skipped public-rating round does not reopen the cursor or fresh replacement window. |

## RL4-01: Rejected Public-Rating Roots Can Be Skipped Without A Fresh Replacement Window

Severity: Medium

### Affected Code

- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
  - `_pendingRatingSnapshotSkipReason`, lines 320-355
- `packages/foundry/contracts/ClusterPayoutOracle.sol`
  - `roundPayoutSnapshotCorrelationEpochRejectedAt`, lines 916-921
  - `_markRoundPayoutSnapshotRejected`, lines 1110-1113
  - `_markCorrelationEpochSnapshotRejected`, lines 1115-1118

### Description

`ContentRegistryRatingSnapshotLib._pendingRatingSnapshotSkipReason` waits for
`pending.readyAt + RATING_SNAPSHOT_NO_PROPOSAL_GRACE`, then checks the pinned
oracle's `roundPayoutSnapshotProposedAt`. If a proposal exists, it only waits
until `proposedAt + RATING_SNAPSHOT_NO_PROPOSAL_GRACE`.

After that proposal-age check passes, the library loads the current snapshot
and returns `canSkip = true` as soon as `snapshot.status == Rejected`. The
skip decision does not wait on the actual rejection time recorded by
`ClusterPayoutOracle.roundPayoutSnapshotRejectedAt`, and it does not account
for the parent correlation-epoch rejection timestamp exposed by
`roundPayoutSnapshotCorrelationEpochRejectedAt`.

If a public-rating root remains live for more than one hour and is then
rejected, the old `proposedAt` is already outside the grace period. Any caller
can immediately advance the rating snapshot cursor before a corrected root has
a fresh window to be proposed and finalized. Once a later round's public-rating
snapshot is applied, `latestAppliedRatingSnapshotRoundId` blocks the skipped
older round through the out-of-order guard.

### Impact

An attacker or overly eager keeper can convert a just-rejected public-rating
root into permanent loss of that round's rating evidence:

1. Round `N` has a pending public-rating settlement.
2. A frontend proposes a public-rating root.
3. More than one hour passes.
4. The root is rejected, directly or through its parent correlation epoch.
5. Before a corrected replacement is available, anyone calls
   `advanceRatingSnapshotCursor`.
6. Round `N` is provisionally skipped immediately.
7. A later round applies, permanently closing round `N`.

This does not directly transfer funds, but it can permanently omit valid
settled-round evidence from the canonical content rating history.

### Recommendation

Treat rejection as the beginning of a fresh replacement window. For direct
snapshot rejection, query `roundPayoutSnapshotRejectedAt(snapshotKey)` and
block skip until `rejectedAt + RATING_SNAPSHOT_NO_PROPOSAL_GRACE`. For parent
correlation-epoch rejection, also query
`roundPayoutSnapshotCorrelationEpochRejectedAt(snapshotKey)` and wait until the
later rejection timestamp has had the same fresh grace.

Add a regression test where an old public-rating proposal is rejected after the
proposal-age grace has elapsed, `advanceRatingSnapshotCursor` is called
immediately, and the cursor does not skip until the fresh post-rejection grace
has elapsed.

## RL4-02: Repointing An Already Skipped Public-Rating Round Does Not Reopen The Cursor

Severity: Medium

### Affected Code

- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
  - `repointPendingRatingClusterPayoutOracle`, lines 140-168
  - `applyRatingPayoutSnapshot`, lines 201-236
  - `advanceRatingSnapshotCursor`, lines 256-281
  - `_canAdvanceRatingSnapshotCursor`, lines 292-310

### Description

The pass3 RL3-01 fix refreshes `pending.readyAt` when governance repoints a
pending public-rating settlement to a new oracle. That fixes repointing before
the round has been skipped.

However, `repointPendingRatingClusterPayoutOracle` also allows repointing an
unapplied pending settlement that is already `provisionallySkipped`. In that
state, `advanceRatingSnapshotCursor` has already advanced
`nextRatingSnapshotRoundId` past the skipped round. The repoint path updates
`pending.clusterPayoutOracle` and `pending.readyAt`, but it does not clear
`pending.provisionallySkipped` or rewind/reopen the cursor.

If a later round's snapshot is already available, anyone can apply the later
round as the expected round immediately after the repoint. That updates
`latestAppliedRatingSnapshotRoundId`; after that, the older repointed round is
permanently blocked by the out-of-order guard even though governance just
pointed it at a replacement oracle.

### Impact

Governance can perform a recovery repoint that appears to give the skipped
round a replacement oracle, but the round can still be closed permanently
before that replacement oracle has a practical chance to publish:

1. Round `N` is pending and gets provisionally skipped.
2. The rating cursor advances to round `N + 1`.
3. Governance repoints round `N` to a replacement oracle.
4. The cursor remains advanced and `pending.provisionallySkipped` remains true.
5. A caller applies round `N + 1`.
6. `latestAppliedRatingSnapshotRoundId >= N`, permanently blocking round `N`.

This is a recovery-flow integrity issue rather than a direct fund-loss issue,
but it can cause permanent omission of settled-round rating evidence after a
governance recovery action.

### Recommendation

Make recovery repointing of skipped public-rating rounds reopen the round for
replacement processing. Reasonable approaches include:

- disallow repointing when `pending.provisionallySkipped` is already true and
  require a separate explicit recovery function, or
- when repointing a skipped round, clear `pending.provisionallySkipped` and
  safely rewind `nextRatingSnapshotRoundId[contentId]` if no later rating
  snapshot has been applied, or
- introduce a dedicated "reopened skipped settlement" state that blocks later
  applications until the fresh replacement window expires or the replacement
  snapshot is applied.

Add regression tests covering both sides of the intended policy:

- repointing a skipped round before any later apply reopens the fresh
  replacement window and prevents immediate later-round closure
- repointing after a later apply is either rejected or explicitly documented as
  unrecoverable

## False Positives And Non-Findings Checked

- RL3-01 replay/repoint before provisional skip is fixed: first pending record
  stores `max(block.timestamp, readyAt)` as the no-proposal skip anchor, and
  repoint refreshes `readyAt`.
- RL3-02 advisory availability is fixed: the view now resolves the caller's
  identity credential before enforcing the unverified advisory cap.
- RBTS timeout stake return was checked and not reproduced as a bug: revealed
  commits initialize RBTS weights before timeout/refund logic uses them.
- Child/parent veto-window mismatch was not reproduced: direct public-rating
  and RBTS consumers gate on the oracle's effective outside-veto predicate.
- Launch surplus/recovery and earned-rater cap accounting were rechecked; no
  new issue was found.
- Question reward, bundle reward, feedback bonus, confidentiality bond,
  protocol-asset recovery, and refund/recovery flows were reviewed; no new
  confirmed issue was found.
- Identity/delegation/banning, frontend delegated proposer, frontend fee
  claims, profile migration, and ProtocolConfig guardrails were reviewed; no
  new confirmed issue was found.

## Limitations

- This was a source review plus focused static-analysis and Foundry regression
  pass, not formal verification or exhaustive fuzzing.
- The report does not include remediation patches. The two findings above need
  separate implementation and regression tests. Because the affected contracts
  are close to the EIP-170 bytecode limit, remediation should include
  `make check-contract-sizes`; any storage-bearing change should include
  `make check-storage-layouts`.

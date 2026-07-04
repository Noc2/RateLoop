# RateLoop Smart Contract Security Review - Multi-Agent Pass 3

Date: 2026-07-04
Base revision reviewed: `9078cb646` on `main`
Scope: `packages/foundry/contracts`
Status: 2 new confirmed findings, 0 high/critical findings

This pass reviewed the current smart-contract code after the findings from
`docs/security-review-multi-agent-2026-07-03.md` and
`docs/security-review-multi-agent-2026-07-04-pass2.md` had been addressed. The
goal was to find new issues, not to re-report already fixed pass1/pass2 items.
No code remediation is included in this report commit.

## Methodology

- Ran three read-only reviewer passes in parallel:
  - rating settlement, rating snapshot ordering, and reward-distributor paths
  - escrow, launch distribution, recovery, surplus, and treasury paths
  - identity, delegation, advisory voting, banning, and frontend registry paths
- Performed parent review of the reported leads against current source.
- Deduplicated findings against the July 3 and July 4 pass2 reports.
- Ran static analysis:
  - `slither . --exclude-dependencies --filter-paths 'lib|node_modules|test|script|mocks'`
    from `packages/foundry`: `0 result(s) found`
  - `yarn foundry:aderyn`: reviewed as triage input; no additional finding was
    promoted from the broad low-signal output
- Ran focused Foundry baselines:
  - `forge test --match-path test/RoundVotingEngineBranches.t.sol --match-test 'test_AdvisoryVoteCapsUnverifiedCommitsFromLaunchPolicy|test_VerifiedAdvisoryVoteBypassesUnverifiedCommitCap|test_AdvisoryVoteUsesCorePreflightAndRaterIdentityDedupe' -vv`
    - Result: 3 passed, 0 failed
  - `forge test --match-path test/SecondPassRatingSnapshotOrdering.t.sol -vv`
    - Result: 7 passed, 0 failed
  - `forge test --match-path test/ContentRegistryRepoint.t.sol -vv`
    - Result: 6 passed, 0 failed

## Findings

| ID | Severity | Area | Summary |
| --- | --- | --- | --- |
| RL3-01 | Medium | Public rating settlement snapshots | Replayed or repointed pending rating settlements can be skipped with a stale no-proposal grace clock. |
| RL3-02 | Low | Advisory vote preflight | `advisoryCommitAvailability` false-negatives delegated verified raters once the unverified advisory cap is reached. |

## RL3-01: Replayed Or Repointed Pending Rating Settlements Can Be Skipped With A Stale Grace Clock

Severity: Medium

### Affected Code

- `packages/foundry/contracts/RoundVotingEngine.sol`
  - `replayPendingRatingSettlement`, lines 778-788
  - `_recordPendingRatingSettlement`, lines 943-951
- `packages/foundry/contracts/ContentRegistry.sol`
  - `recordPendingRatingSettlement`, lines 1383-1408
  - `_pendingRatingSettlementReadyAt`, lines 1411-1422
  - `repointPendingRatingClusterPayoutOracle`, lines 1465-1472
- `packages/foundry/contracts/libraries/ContentRegistryTypes.sol`
  - `PendingRatingSettlement`, lines 24-34
- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol`
  - `recordPendingRatingSettlement`, lines 76-132
  - `repointPendingRatingClusterPayoutOracle`, lines 135-162
  - `applyRatingPayoutSnapshot`, lines 195-230
  - `advanceRatingSnapshotCursor`, lines 242-275
  - `_pendingRatingSnapshotSkipReason`, lines 314-350

### Description

When a settled round fails to notify `ContentRegistry` during settlement,
`RoundVotingEngine.replayPendingRatingSettlement` lets anyone replay the
pending rating settlement record later. The registry derives
`pending.readyAt` from the original round `settledAt` when available, not from
the replay time.

`advanceRatingSnapshotCursor` can provisionally skip a pending settlement when
`block.timestamp >= pending.readyAt + RATING_SNAPSHOT_NO_PROPOSAL_GRACE` and
the pinned oracle has no proposal for the public-rating snapshot. Because the
replayed pending settlement can be recorded with an already-expired
`readyAt`, the cursor can skip it immediately after replay, before the newly
visible oracle path has a fresh one-hour window to publish.

The same stale-clock condition exists when governance repoints an in-flight
pending rating settlement to a replacement `ClusterPayoutOracle`. The repoint
path validates the replacement oracle and updates `pending.clusterPayoutOracle`,
but it does not refresh any skip-grace anchor for the new oracle.

After a later round's rating snapshot is applied, the out-of-order guard in
`applyRatingPayoutSnapshot` prevents applying the skipped earlier round. That
can permanently exclude that round's rating evidence from the canonical rating
history.

### Impact

An attacker or keeper can accelerate a recovery edge case into permanent
rating-evidence loss:

1. A round settles, but the registry-side pending rating settlement record is
   missing or later has its oracle repointed.
2. More than the one-hour no-proposal grace has elapsed since the original
   settlement timestamp.
3. The pending record is replayed, or governance repoints it to a replacement
   oracle that has no proposal yet.
4. Anyone calls `advanceRatingSnapshotCursor`.
5. The round is provisionally skipped immediately.
6. A later round applies, making the older skipped round no longer applicable.

This does not directly move funds, but it can permanently omit a settled
round's public rating evidence and distort future content rating state.

### Recommendation

Track a distinct skip-grace anchor for pending rating settlements, separate from
the source settlement time used for oracle source readiness. For example:

- add `recordedAt` or `skipGraceStartedAt` to `PendingRatingSettlement`
- set it to `block.timestamp` on first pending record and on replay recovery
- reset it to `block.timestamp` when `repointPendingRatingClusterPayoutOracle`
  changes the pinned oracle
- require the no-proposal skip to wait until
  `max(pending.readyAt, pending.skipGraceStartedAt) + RATING_SNAPSHOT_NO_PROPOSAL_GRACE`

Add regression tests covering:

- delayed `replayPendingRatingSettlement` cannot be skipped until a fresh
  no-proposal grace has elapsed after replay
- `repointPendingRatingClusterPayoutOracle` gives the replacement oracle a
  fresh grace window before no-proposal skip is allowed

## RL3-02: Advisory Availability False-Negatives Delegated Verified Raters After The Unverified Cap

Severity: Low

### Affected Code

- `packages/foundry/contracts/AdvisoryVoteRecorder.sol`
  - `advisoryCommitAvailability`, lines 190-295
  - `recordAdvisoryVote`, lines 297-335
  - `_hasActiveHumanCredentialForRound`, lines 923-934
  - `_validateAdvisoryCommitter`, lines 936-967

### Description

`advisoryCommitAvailability` checks the unverified advisory cap using
`_hasActiveHumanCredentialForRound(contentId, roundId, msg.sender)`. That
helper asks the round's rater registry whether `msg.sender` directly has an
active human credential.

The mutating `recordAdvisoryVote` path uses a different identity model:
`_validateAdvisoryCommitter` resolves `msg.sender` through
`VotePreflightLib.validateVoterAndContent`. If `msg.sender` is an accepted
delegate for a verified holder, the resolved identity context can have
`hasActiveHumanCredential == true` even though the delegate address itself has
no credential.

Once `roundUnverifiedAdvisoryCommitCount` reaches the launch-policy cap, the
view can therefore report `UnverifiedAdvisoryCapReached` for a delegated
verified rater while `recordAdvisoryVote` would still allow the same caller to
commit.

### Impact

This is a preflight/view inconsistency, not an on-chain authorization failure.
Valid delegated verified raters can still call `recordAdvisoryVote` directly,
but clients that trust `advisoryCommitAvailability` may hide or block the
advisory commit flow after the unverified cap is reached.

### Recommendation

Make `advisoryCommitAvailability` use the same resolved identity path as
`recordAdvisoryVote` for the cap check. The availability view should resolve
`msg.sender` through the round rater registry and test the resolved
`hasActiveHumanCredential` value rather than testing only the raw caller
address.

Add a regression test where:

1. the unverified advisory cap is filled,
2. a verified holder delegates to an uncredentialed delegate,
3. the delegate calls `advisoryCommitAvailability`, and
4. the view returns `Available`, matching `recordAdvisoryVote`.

## False Positives And Non-Findings Checked

- Pass2 `LaunchDistributionPool.recoverSurplus` was rechecked and now requires
  `owner() == governance` before surplus recovery.
- Pass2 launch-cap counting was rechecked and first-time earned-rater
  assignment now increments `eligibleRaterCount` even when the assigned cap is
  zero.
- Pass2 `ConfidentialityEscrow` EIP-3009 authorization nonces now bind the
  chain id, escrow address, content id, bond asset and amount, transfer fields,
  and validity window.
- Pass2 rating activity replay regression was rechecked; current code uses
  monotonic guards for `lastActivityAt` and `dormancyAnchorAt`.
- Pass2 banned last-claimant reward dust was rechecked; current code sweeps the
  banned claimant remainder to the protocol path.
- Question reward and bundle recovery paths were reviewed around reopened
  snapshots, replacement snapshots, pending-recovery gates, and protocol-asset
  sweeps. No new confirmed issue was found.
- Feedback bonus expiry and recovery paths were reviewed around refundable
  terminal states, awardable leftovers, and protocol-asset recovery blocks. No
  new confirmed issue was found.
- Identity, delegation, banning, frontend fee-claim, and frontend operator
  delegation paths were reviewed for stale delegation and alias-bypass issues.
  No new confirmed issue was found beyond RL3-02.

## Limitations

- This was a source review plus focused Foundry/static-analysis pass, not a
  full formal verification or exhaustive fuzzing engagement.
- The report does not include remediation patches. The two findings above need
  separate implementation, regression tests, and the usual contract-size and
  storage-layout checks.

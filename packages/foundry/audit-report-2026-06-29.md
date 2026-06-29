# RateLoop Smart Contract Security Audit - 2026-06-29

## Scope

This review covered the smart-contract workspace under `packages/foundry/contracts` on the local
`main` branch as of 2026-06-29. The worktree already contained unrelated Next.js handoff edits, so
those files were excluded from this audit. No contract code was changed during this review.

Production note: RateLoop contracts are already deployed on Base mainnet. The recommendation below is
written as an upgrade/backlog item unless the issue manifests in production and cannot be mitigated
with an honest replacement oracle snapshot.

## Methodology

- Manual review of reward escrow, bundle reward, oracle snapshot, commit/reveal, confidentiality,
  rater identity, x402 submitter, governance/admin, and deployment-wiring paths.
- Parallel read-only subagent passes over governance/admin/upgrade wiring, escrow/accounting, and
  voting/oracle/commit-reveal logic.
- Regression review against `packages/foundry/audit-report-2026-06-10.md` and
  `docs/testing/certora-security-findings.md`.
- Tooling:
  - `forge test --offline`
  - `slither . --config-file slither.config.json`
  - `make check-contract-sizes`
- External advisory research:
  - Solidity known bugs and compiler advisories: https://docs.soliditylang.org/en/latest/bugs.html
  - Solidity transient storage clearing helper collision advisory:
    https://www.soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug/
  - OpenZeppelin Contracts security advisories:
    https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories

## Executive Summary

One new Medium severity liveness finding was identified. It affects cluster-snapshot-backed question
reward pools and bundle reward pools when an oracle snapshot is rejected before the escrow has applied
the snapshot during qualification. Funds are not directly stealable, but voter claims, refunds, and
treasury recovery can remain pinned until an eligible oracle proposer supplies a replacement finalized
snapshot.

No new critical or high severity findings were identified in this pass.

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| M-1 | Medium | Open | Rejected cluster snapshots can pin reward funds before escrow qualification |

## Findings

### M-1: Rejected cluster snapshots can pin reward funds before escrow qualification

Severity: Medium

Status: Open

Affected areas:

- `contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:29-31`
- `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:95-124`
- `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:127-155`
- `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:521-538`
- `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:760-767`
- `contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:85-111`
- `contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:793`
- `contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:1687-1692`

#### Description

Cluster-snapshot reward pools have a recovery path for rejected oracle snapshots, but the recovery path
requires an already-qualified escrow snapshot:

- `recoverRejectedSnapshotRound` loads `roundSnapshots[rewardPoolId][roundId]` and requires
  `snapshot.qualified`.
- Bundle recovery has the same shape: `_recoverRejectedSnapshotRoundSet` requires
  `snapshot.qualified`.

That covers the case where the escrow already consumed a finalized oracle snapshot and the snapshot is
later rejected. It does not cover the pre-qualification case:

1. A cluster-backed question round or bundle round set settles with enough eligible participants.
2. The cluster oracle finalizes a payout snapshot.
3. The arbiter rejects that snapshot before anyone calls the escrow qualification path.
4. The escrow has no stored qualified snapshot, so recovery reverts with `"Round not qualified"` or
   `"Round set not qualified"`.
5. The qualification preview treats a non-finalized or rejected oracle snapshot as not finished, so
   `advanceQualificationCursor` stops instead of skipping the rejected round.
6. Refund/forfeit paths remain blocked by the pending cursor round. Bundle refunds similarly revert
   through `BundleClusterPayoutSnapshotPending`.

The same root issue exists in both question pools and bundles because both require a qualified escrow
snapshot for rejection recovery while their pending/finished checks only treat finalized oracle
snapshots as ready.

#### Impact

Funds are not transferred to an attacker, but liveness can be lost for the affected reward pool or
bundle:

- Qualified voter claims cannot proceed because the escrow never applied the snapshot.
- Funder refund and treasury recovery paths can remain blocked by the cursor round.
- The only current practical recovery is for an eligible snapshot proposer to supply a replacement
  finalized snapshot that the escrow can then qualify. If no proposer does so, funds can remain pinned.

This is especially relevant because `ClusterPayoutOracle` intentionally supports post-finalization
rejection of bad or stale snapshots, and the escrow already has post-qualification recovery logic. The
pre-qualification branch should have an equivalent escape hatch.

#### Recommendation

Add an explicit pre-qualification rejected-snapshot escape path for both question pools and bundle
reward pools. Two reasonable designs:

1. Treat a rejected oracle snapshot as a terminal, non-qualifying finished state once it is no longer
   live for challenge/veto purposes, allowing the cursor to advance and unallocated funds to be
   refunded or recovered.
2. Add a gated skip/recovery function that verifies the rejected oracle snapshot, records that the
   cursor round or round set is terminal, and advances/unblocks the pool without requiring
   `snapshot.qualified`.

Add regression tests for both variants of the affected surface:

- A question reward pool with a finalized cluster snapshot rejected before `qualifyRound`.
- A bundle reward pool with a finalized bundle snapshot rejected before bundle round-set
  qualification.

Each test should assert that the fixed path can advance, refund, or recover without waiting for a
replacement finalized snapshot.

## Prior Finding Recheck

### 2026-06-10 M-1: World ID v4 presence freshness

Current status: Not reproduced in current code.

`RaterRegistry.attestHumanPresenceWithV4Proof` now reverts `UnsupportedCredentialKind()`
unconditionally, and `hasRecentCredentialRecheck` returns false while `credentialStatusBits` always
returns a zero fresh mask. The current active v4 credential path is a proof-of-human credential path,
not the older recent-presence freshness path.

Relevant current code:

- `contracts/RaterRegistry.sol:982-984`
- `contracts/RaterRegistry.sol:1259-1268`

### 2026-06-10 M-2: Snapshot challenger censorship by live proposer rotation

Current status: Fixed.

`ClusterPayoutOracle._requireDisinterestedChallenger` is now pure and only rejects the proposer,
frontend operator, and proposal-time snapshot proposer. It no longer live-reads the current frontend
snapshot proposer assignment when a challenge is submitted.

Relevant current code:

- `contracts/ClusterPayoutOracle.sol:1161-1173`

### 2026-06-10 L-1: Advisory cooldown lost on recorder rotation

Current status: Fixed.

`AdvisoryVoteRecorder` now merges its local cooldown maps with durable timestamps in `ProtocolConfig`,
and `ProtocolConfig.recordAdvisoryCooldown` persists both address and identity cooldown timestamps.
The regression test `test_AdvisoryCooldownSurvivesRecorderRotationFromOpenRoundSnapshot` passed in the
full Forge run.

Relevant current code:

- `contracts/AdvisoryVoteRecorder.sol:680-694`
- `contracts/ProtocolConfig.sol:374-388`

## Verification Results

### Static analysis

Command:

```bash
slither . --config-file slither.config.json
```

Result: pass. Slither analyzed 162 contracts with 35 detectors and reported 0 results.

### Deploy bytecode size

Command:

```bash
make check-contract-sizes
```

Result: pass. The deploy profile build succeeded with Solidity 0.8.35, and all checked deployed
bytecode sizes were below the EIP-170 24576-byte limit. Closest contracts:

- `LaunchDistributionPool`: 24561 bytes
- `RoundVotingEngine`: 24562 bytes
- `ContentRegistry`: 24146 bytes

### Foundry tests

Command:

```bash
forge test --offline
```

Result: fail, with 1417 passing tests and 18 failing tests.

The failures appear to be stale test assumptions rather than the Medium finding above:

- 16 failures revert with `InvalidConfig()`. Targeted traces show tests setting round configs with
  `maxDuration != epochDuration` or overly long max durations, while
  `ProtocolConfig._validateRoundConfig` now requires `maxDuration == epochDuration`
  (`contracts/ProtocolConfig.sol:1105-1118`).
- `ConfidentialityEscrowTest.testOldEngineCannotRecordGatedNexusForUntrackedContentAfterRotation`
  fails before exercising the intended revert because the submitted gated question already has its
  initial round tracked to the old engine. `ConfidentialityEscrow` only authorizes a tracked prior
  engine when it still has an open round (`contracts/ConfidentialityEscrow.sol:553-575`), so this is
  a stale assertion in the test scenario.
- `SettlementEdgeCasesTest.test_Cancel_OneSecondBeforeMaxDuration_Reverts` warps to seven days while
  the fixture configures a one-hour round duration. The cancel is therefore valid under the current
  fixture.

Recommended follow-up: fix the stale fixtures so `forge test --offline` returns to green, then add the
M-1 regression tests described above.

## Advisory Research Notes

- The repo pins `solc = "0.8.35"` with `via_ir = true` in `foundry.toml`. The Solidity transient
  storage clearing helper collision bug affected earlier 0.8.28-0.8.33 compiler builds and was fixed
  before this pinned compiler.
- OpenZeppelin Contracts sources in `packages/foundry/lib/openzeppelin-contracts` report version
  `5.6.0`. No reviewed OpenZeppelin advisory mapped to the imported primitives in this pass.

## Non-Findings Honored From Project Trust Model

These were intentionally not re-raised:

- `ClusterPayoutOracle` challenge bonds are anti-spam bonds, not payout-value coverage bonds.
- The 60-minute `revealGracePeriod` is an accepted product/security parameter.
- Routine production remediation should not assume a full contract redeploy unless the issue cannot be
  solved through governance/admin actions, operator action, service rewiring, or off-chain fixes.

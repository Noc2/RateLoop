# RateLoop Smart Contract Security Audit - 2026-06-30

## Scope

This review covered the smart-contract workspace under
`packages/foundry/contracts` on local `main` at commit `63408f6b4`.

Focus areas:

- `ClusterPayoutOracle`, rejected parent/child snapshot states, replacement
  snapshots, and reward escrow recovery paths.
- `QuestionRewardPoolEscrow` single-pool and bundle cluster-payout flows,
  pre-qualification skip paths, refund gates, claim proofs, and source-ready
  consumer hooks.
- `ConfidentialityEscrow`, `ContentRegistry` confidentiality flags, gated
  voting preflight, bond release, slash, and identity sanction paths.
- `ProtocolConfig`, `AdvisoryVoteRecorder`, `LaunchDistributionPool`,
  `RoundRewardDistributor`, `FrontendRegistry`, and deployment/governance
  wiring for admin rotation and reward accounting.
- Recent fixed findings from the 2026-06-29 reports, to avoid carrying stale
  findings forward without current evidence.

No contract code was changed during this audit. The only intended workspace
change from this pass is this report.

Production note: RateLoop contracts are already deployed on Base mainnet.
The recommendations below should be treated as upgrade/backlog or governance
runbook items unless a finding manifests in production and cannot be mitigated
with governance/admin actions, operator action, service rewiring, or off-chain
controls.

## Methodology

- Manual source review of oracle, escrow, confidentiality, advisory, identity,
  governance, launch, and token-accounting surfaces.
- Three parallel read-only audit agents:
  - Oracle, reward-root, bundle, and rejected-snapshot recovery flows.
  - Launch distribution, protocol config, governance/admin, storage, and token
    accounting flows.
  - Voting, confidentiality, identity, X402, advisory, and media-gated flows.
- Static and repo gates:
  - `yarn foundry:aderyn`
  - `yarn foundry:slither`
  - `make check-storage-layouts`
  - `make check-contract-sizes`
  - `forge test --offline -vv`
- External advisory sanity checks:
  - Solidity known bugs: https://docs.soliditylang.org/en/latest/bugs.html
  - Solidity transient storage clearing helper collision advisory:
    https://www.soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug/
  - OpenZeppelin Contracts advisories:
    https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories

## Executive Summary

This pass identified one Medium severity liveness/fund-lock finding and two Low
severity policy or configuration findings. No new critical or high severity
findings were identified.

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| M-1 | Medium | Fixed | Parent correlation-epoch rejection can leave pre-qualification escrow snapshots unskippable |
| L-1 | Low | Open | `PRIVATE_FOREVER` does not extend confidentiality bond slashability |
| L-2 | Low | Open | Advisory recorder rotation can install a recorder that cannot claim advisory launch credits |

## Findings

### M-1: Parent correlation-epoch rejection can leave pre-qualification escrow snapshots unskippable

Severity: Medium

Status: Fixed

Affected code:

- `contracts/ClusterPayoutOracle.sol:781-797`
- `contracts/ClusterPayoutOracle.sol:823-840`
- `contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol:85-101`
- `contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:338-353`
- `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:521-537`
- `contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:315-337`
- `contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:777-795`

#### Description

`ClusterPayoutOracle.getRoundPayoutSnapshot` reports a live child round payout
snapshot as `Rejected` when the snapshot's parent correlation epoch is no
longer live:

```solidity
if (
    _isLiveRoundPayoutStatus(snapshot.status)
        && !_isLiveCorrelationEpoch(proposal.correlationEpochDigest, snapshot.correlationEpochId)
) {
    snapshot.status = SnapshotStatus.Rejected;
}
```

That view-level downgrade is intentional: proofs against a child snapshot whose
parent correlation epoch was rejected must stop verifying. The escrow recovery
paths, however, require a round-level rejection marker before they can skip a
pre-qualification snapshot:

- Single-pool skip requires
  `rejectedRoundPayoutSnapshotDigests(snapshotKey, snapshotDigest)` or
  `rejectedRoundPayoutSnapshotRoots(snapshotKey, weightRoot)`.
- Bundle skip has the same requirement.

When the only rejection is inherited from the parent correlation epoch, those
round-level rejected digest/root flags are not set. The oracle reports the
snapshot as `Rejected`, but the escrow skip path reverts with
`"Snapshot rejection missing"`.

The ordinary qualification cursor does not advance either. The cluster
qualification status treats any non-`Finalized` snapshot returned by the oracle
as not finished, returning `(false, false, 0)` instead of a terminal
non-qualifying state. That blocks single-pool refund paths through
`RewardPoolCursorNeedsAdvance` and blocks bundle refunds through
`BundleClusterPayoutSnapshotPending`.

The state is repairable if an eligible frontend proposer later proposes and
finalizes a replacement child snapshot under a live replacement correlation
epoch. Oracle tests already cover stale child reproposal after parent rejection.
The issue is that escrow-side refund/recovery cannot use the oracle's own
`Rejected` status until that replacement operator action happens.

#### Impact

Funds are not transferred to an attacker, and a valid replacement oracle
snapshot can repair the state. The practical impact is liveness and fund access:

- Voters cannot claim from the rejected child snapshot.
- The funder or treasury cannot refund/recover the unallocated escrow balance
  while the cursor is stuck.
- Bundle reward refunds stay blocked by the pending cluster snapshot state.
- Recovery depends on an online eligible oracle proposer and replacement
  artifact pipeline rather than the existing permissionless escrow skip path.

Severity is Medium because the affected state can pin reward funds and block
claims/refunds after a valid arbiter action, but it is not a direct theft path
and is recoverable with coordinated proposer/operator action.

#### Recommendation

Make parent-epoch rejection a first-class, escrow-verifiable rejection reason.

Reasonable implementation paths:

1. Extend `IClusterPayoutOracle` with a view that proves a round payout snapshot
   is rejected because its stored parent correlation epoch is rejected or stale.
   The escrow skip paths can then accept either the existing round digest/root
   rejection markers or the new parent-rejection proof.
2. Expose a richer round snapshot status/reason from the oracle, for example
   `getRoundPayoutSnapshotStatus(...) -> (status, rejectionKind)`, where
   `rejectionKind` distinguishes direct round rejection from parent correlation
   rejection.
3. Alternatively, have the oracle mark the child snapshot digest as rejected
   when a parent correlation epoch is rejected. This is broader and should be
   reviewed carefully because a metadata-only parent rejection may still be
   replacement-compatible.

For either interface approach, update both escrow paths:

- `skipPreQualificationRejectedSnapshotRound`
- `skipPreQualificationRejectedSnapshotBundleRoundSet`

Add regression tests for:

- A single question pool where a child round payout snapshot is finalized, the
  parent correlation epoch is rejected before `qualifyRound`, and the escrow
  can skip/refund without waiting for child reproposal.
- A bundle round set with the same parent-rejection shape and a successful
  skip/refund.
- A replacement finalized child snapshot still taking precedence when it is
  available before refund.

#### Resolution

Fixed on 2026-06-30 by exposing an oracle view that identifies child round
payout snapshots rejected through their parent correlation epoch and allowing
both pre-qualification escrow skip paths to accept that proof alongside direct
child digest/root rejection markers. Regression coverage was added for
single-pool and bundle parent-rejection skip/refund flows, plus a
single-pool replacement-before-refund flow.

### L-1: `PRIVATE_FOREVER` does not extend confidentiality bond slashability

Severity: Low

Status: Open

Affected code:

- `contracts/ContentRegistry.sol:84`
- `contracts/ContentRegistry.sol:1205-1216`
- `contracts/ConfidentialityEscrow.sol:214-230`
- `contracts/ConfidentialityEscrow.sol:293-307`
- `contracts/ConfidentialityEscrow.sol:513-519`
- `packages/nextjs/components/submit/ContentSubmissionSection.tsx:141-143`
- `packages/nextjs/components/submit/ContentSubmissionSection.tsx:2386-2394`

#### Description

`ContentRegistry` accepts a `CONFIDENTIALITY_FLAG_PRIVATE_FOREVER` flag for
gated content and forwards it into `ConfidentialityEscrow.configure`.
The submit UI also maps the `"private_forever"` disclosure policy to that flag.

The escrow stores the flag, but bond release ignores it. `releaseBond` only
checks `_isBondReleasable`, whose predicate is based on:

- `postedAt + evidenceWindow`
- content inactivity
- current round terminal state
- `postedAt + maxBondLockDuration + evidenceWindow`

As a result, a rater can access private-forever content, wait until the normal
bond release condition is satisfied, recover the bond, and later leak without
any escrowed bond remaining to slash. The historical confidentiality nexus and
identity-ban path still exist, so this is not a complete accountability bypass.

The internal private-context plan does say the max lock duration is a hard stop
to avoid stranding, so this may be a product-terminology mismatch rather than a
contract bug. It is still worth tracking because the flag and UI policy name
imply a longer-lived confidentiality obligation than the escrow can financially
enforce.

#### Impact

No direct fund drain, vote bypass, or credential bypass was identified.
The risk is deterrence mismatch:

- Askers may believe private-forever content remains bond-backed indefinitely.
- A late leak after bond release cannot be punished by slashing the released
  bond.
- Governance can still impose identity sanctions using the recorded
  confidentiality nexus and broader ban powers.

#### Recommendation

Choose and document one of these semantics:

1. If `PRIVATE_FOREVER` should mean ongoing financial slashability, block
   `releaseBond` for flagged content or require an explicit governance/operator
   release after a final evidence process.
2. If `PRIVATE_FOREVER` only controls disclosure policy and identity sanctions,
   rename or document the flag/UI copy so users understand that bond
   slashability still expires under `evidenceWindow` and
   `maxBondLockDuration`.

Add a regression test either way:

- If fixed on-chain, prove `releaseBond` reverts for flagged content until the
  chosen release authority/condition is satisfied.
- If accepted as current semantics, add an explicit test proving private-forever
  bonds release under the normal predicate and document the trust model.

### L-2: Advisory recorder rotation can install a recorder that cannot claim advisory launch credits

Severity: Low

Status: Open

Affected code:

- `contracts/ProtocolConfig.sol:341-355`
- `contracts/ProtocolConfig.sol:910-930`
- `contracts/AdvisoryVoteRecorder.sol:581-601`
- `contracts/LaunchDistributionPool.sol:215-218`
- `contracts/LaunchDistributionPool.sol:612-623`
- `script/Deploy.s.sol:392-396`

#### Description

`ProtocolConfig.setAdvisoryVoteRecorder` validates the new recorder's protocol
config, engine, registry, and shape. It also authorizes the recorder for
`ProtocolConfig.recordAdvisoryCooldown`.

It does not validate or configure the separate authorization needed by
`LaunchDistributionPool`. Advisory launch-credit claims call
`LaunchDistributionPool.recordAdvisoryRaterRewardWithSourceReady`, which is
guarded by `onlyAuthorized`. The deploy script confirms this is an independent
wiring step:

```solidity
protocolConfig.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));
launchDistributionPool.setAuthorizedCaller(address(advisoryVoteRecorder), true);
```

If governance rotates the advisory recorder and forgets the launch-pool
authorization call, advisory cooldown recording can work while advisory launch
credits revert until the new recorder is authorized in the launch pool.

#### Impact

This is a recoverable configuration liveness issue, not theft:

- Staked voting and ordinary reward distribution are not directly affected.
- Advisory launch-credit claims from the new recorder can revert.
- Governance/owner can repair the state by calling
  `LaunchDistributionPool.setAuthorizedCaller(newRecorder, true)`.

Severity is Low because the issue requires a governance/configuration mistake
and has an admin recovery path, but it can break a user-facing claim path after
rotation.

#### Recommendation

Make recorder rotation atomic or add a preflight guard:

- Preferred contract-side fix: when `ProtocolConfig.setAdvisoryVoteRecorder`
  receives a nonzero recorder and `launchDistributionPool` is configured,
  validate that `LaunchDistributionPool.authorizedCallers(value)` is already
  true. This prevents installing a recorder that cannot claim advisory credits.
- Alternative operational fix: add a governance runbook/test that always pairs
  `setAdvisoryVoteRecorder(newRecorder)` with
  `LaunchDistributionPool.setAuthorizedCaller(newRecorder, true)` in the same
  proposal batch.

Add tests that prove:

- A recorder lacking launch-pool authorization cannot be installed, or
- The governance action composer/runbook emits both calls in the same batch.

## Reviewed Non-Findings

### NF-1: Direct pre-qualification rejected snapshot skip remains fixed

The 2026-06-29 direct child-snapshot issue was rechecked. Direct round payout
snapshot rejection now has pre-qualification skip paths for both single pools
and bundles, and current tests cover direct child rejection before
qualification. The new M-1 above is narrower: inherited rejection from the
parent correlation epoch does not set the same child rejection markers.

### NF-2: Replacement-root claims against already-qualified snapshots are blocked

Qualified single-pool and bundle snapshots store both the cluster weight root
and the cluster snapshot digest. Claim paths verify the current oracle proposal
matches the stored digest/root and is not rejected before accepting payout
weights. I did not find a path where a replacement root can retroactively
capture claims from an already-qualified snapshot.

### NF-3: `nullifierHasBond` persistence after release/slash is historical, not active access

The confidentiality escrow keeps historical nexus state after a bond is
released or slashed. The live gated voting path uses `hasActiveBond` for bond
requirements, while `hasConfidentialityNexus` supports evidence/sanction
history. Persistence does not let a released bond satisfy gated voting.

### NF-4: Advisory/staked double participation is still blocked

Advisory commits record rater, holder, and identity aliases. Advisory validation
checks existing staked commits by those aliases, staked commit preflight checks
advisory aliases, and advisory launch-credit claim logic rejects counted
staked participation. I did not find a current double-participation path.

### NF-5: RBTS seed capture does not leave the scoring set mutable

The first settlement call can capture delayed RBTS entropy and return, but
later reveals are rejected once `roundRbtsSeedEntropy` is set. I did not find a
path where a rater can reveal after seed capture and alter the scored cohort.

### NF-6: X402 question payload substitution appears blocked

The EIP-3009 nonce binds payer, gateway, registry, reward escrow, payload,
media/details, round config, confidentiality config, spec, payer/payee/value,
and validity window. The registry submitter is the authorization payer. I did
not find a payload-substitution path in the reviewed X402 question flows.

### NF-7: Recent launch deposit exact-receipt fix remains fixed

`LaunchDistributionPool.depositPool` now requires an exact balance increase
before incrementing `poolBalance`. The current production LREP-style token
model and local exact-receipt pattern do not show the prior short-transfer
accounting mismatch.

### NF-8: Reward distributor and frontend fee rotation do not reopen historical claims

Distributor revocation/replacement is blocked once claim accounting has
started, per-engine distributor slots are pinned, engine reward transfers
require the authorized distributor for that engine, and frontend fee crediting
checks both role authorization and the engine-to-creditor binding.

## Tool Results

- `yarn foundry:aderyn`: completed. Aderyn analyzed 75 source files and 24,335
  nSLOC, reported 0 high issues and 23 low-class issue categories. The low
  categories were triaged as admin, style, deploy-size, or known-pattern
  warnings unless covered by the findings above.
- `yarn foundry:slither`: completed. Slither analyzed 162 contracts with 35
  detectors and reported 0 results.
- `make check-storage-layouts`: passed for the configured upgradeable
  contracts.
- `make check-contract-sizes`: passed for the deploy profile. Largest checked
  deployable contracts included `RoundVotingEngine` at 24,562 bytes and
  `LaunchDistributionPool` at 24,503 bytes, both below the EIP-170 limit.
- `forge test --offline -vv`: passed, 1,782 tests, 0 failed, 0 skipped.

Compilation still emits default-profile code-size warnings for some contracts
and scripts, but the deploy-profile size gate passed.

## External Advisory Notes

- `packages/foundry/foundry.toml` pins Solidity `0.8.35`. The reviewed
  Solidity transient storage clearing helper collision advisory affected
  earlier 0.8.x compiler versions with `via_ir`, so it was not applicable to
  this pinned compiler.
- The OpenZeppelin advisory check did not identify a relevant current
  dependency issue in the reviewed contract code. In particular, no
  `Bytes.lastIndexOf` or `Bytes.` usage was found in the contract workspace
  during this pass.

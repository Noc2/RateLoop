# RateLoop Smart Contract Security Audit Follow-up - 2026-06-29

## Scope

This follow-up review covered the smart-contract workspace under
`packages/foundry/contracts` on local `main` at commit `0e558a830`.

This pass focused on areas most likely to regress after the previous reward
escrow/oracle recovery fix:

- `QuestionRewardPoolEscrow`, bundle reward pools, cluster payout oracle
  consumers, rejected-snapshot recovery, and claim/refund accounting.
- `ClusterPayoutOracle` proposal, challenge, finalization, rejection, consumer
  freshness, and proof-verification flows.
- Voting, advisory, confidentiality, identity, reveal, settlement, and cleanup
  state machines.
- Governance/admin rotation, storage-layout pinning, launch distribution,
  token-transfer accounting, and deployment wiring.

No contract code was changed during this audit. The only file created by this
work is this report.

Production note: RateLoop contracts are already deployed on Base mainnet.
Recommendations below should be treated as upgrade/backlog items unless a
finding manifests in production and cannot be mitigated with governance/admin
actions, operator action, service rewiring, or off-chain controls.

## Methodology

- Manual source review of the reward escrow, oracle, advisory-voting,
  confidentiality, identity, governance, launch, and token-accounting surfaces.
- Three parallel read-only audit agents:
  - Oracle/reward-root/recovery flows.
  - Voting/confidentiality/identity lifecycle.
  - Governance/admin/upgrade/accounting/token-transfer surfaces.
- Static and repo gates:
  - `yarn foundry:slither`
  - `yarn foundry:aderyn`
  - `make check-storage-layouts`
  - `yarn workspace @rateloop/foundry check:sizes`
  - `forge test --offline -vv`
- Version/advisory sanity checks:
  - `foundry.toml` pins Solidity `0.8.35`, `via_ir = true`, optimizer enabled.
  - OpenZeppelin contracts and upgradeable contracts are vendored at `5.6.0`.
  - Official references checked for context:
    - https://docs.soliditylang.org/en/latest/bugs.html
    - https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories

## Executive Summary

This pass found one new Medium severity liveness/fairness issue and one Low
severity accounting-hardening issue.

No new critical or high severity findings were identified.

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| M-1 | Medium | Fixed | Bundle rejected-snapshot skip abandons same-source replacement claims |
| L-1 | Low | Fixed | Launch pool deposits trust the requested amount instead of exact received tokens |

## Remediation Update

2026-06-30:

- M-1 fixed by preserving the completed bundle round-set source when skipping a
  rejected pre-qualification snapshot. The rejected snapshot digest/root now
  marks the unqualified snapshot slot, allowing refunds while the slot remains
  rejected and allowing a corrected replacement snapshot to qualify before
  refund.
- L-1 fixed by requiring `LaunchDistributionPool.depositPool` to receive exactly
  the requested token amount before increasing tracked `poolBalance`.
- Regression coverage added for replacement qualification after a skipped bundle
  snapshot and for short-transfer launch pool deposits.

## Findings

### M-1: Bundle rejected-snapshot skip abandons same-source replacement claims

Severity: Medium

Status: Open

Affected code:

- `contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:23-73`
- `contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:324-359`
- `contracts/libraries/QuestionRewardPoolEscrowBundleLib.sol:254-284`
- `contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:1666-1708`
- `contracts/libraries/QuestionRewardPoolEscrowSnapshotConsumerLib.sol:190-216`

#### Description

The new single-question pre-qualification rejected-snapshot path records a
cursor-bypass marker:

- `QuestionRewardPoolEscrowRecoveryLib.skipPreQualificationRejectedSnapshotRound`
  sets `preQualificationRejectedRound[rewardPoolId][roundId] = true` and
  advances `nextRoundToEvaluate`.
- `_qualifyRound` later admits that same `roundId` with a corrected finalized
  replacement snapshot while using normal, non-recovered allocation math.

The bundle path does not have an equivalent replacement qualification mode.
`skipPreQualificationRejectedSnapshotBundleRoundSet` validates that the
current bundle snapshot was rejected, then calls
`QuestionRewardPoolEscrowBundleLib.resetRoundSet` and deletes the
`bundleRoundSetSnapshots[bundleId][roundSetIndex]` slot.

`resetRoundSet` rewinds each bundle question cursor past the rejected source
round and sets `bundleQuestionRecordedRounds[bundleId][i] = roundSetIndex`.
After that reset, the bundle source-ready view returns `0` for the old logical
round set because `isRoundSetComplete(...)` is false and the old `roundId`s are
no longer recorded. A corrected same-source snapshot therefore cannot be
proposed through the oracle source-ready gate or qualified by the escrow.

#### Impact

For bundle reward pools, any caller can turn a metadata-only rejected snapshot
into an abandon-and-refund/next-round-set outcome by calling the skip function.
That preserves fund safety and unblocks refunds, but it can deny claims to
honest completers of the original bundle round set even if an eligible frontend
operator could have supplied a corrected replacement snapshot before refund.

This is especially visible because the single-question path already preserves
the corrected-replacement option, while the bundle path does not. Current
registry-created bundles require one settled round set, so abandoning the first
completed set can make the entire bundle refundable after grace instead of
payable to the original completers.

This is not a direct fund theft issue. Severity is Medium because the gap is a
permissionless liveness/fairness loss on a payout path after oracle rejection.
If the product decision is that bundle skips should intentionally abandon the
old source set, this should be documented as an accepted semantic difference
from question pools and the severity can be downgraded.

#### Recommendation

Mirror the single-question semantics for bundles, or document the intentional
difference explicitly.

If claim preservation is desired:

- Preserve the skipped bundle round IDs in a dedicated pre-qualification
  rejected bundle state, or avoid deleting them until refund.
- Add a `preQualificationRejectedBundleRoundSet`-style marker that lets
  `_qualifyBundleRoundSet` qualify a later finalized, non-rejected replacement
  snapshot for the same logical round set before refund.
- Keep accounting untouched until qualification: do not increment
  `completedRoundSets`, do not change `pendingRecoveredRoundSets`, and do not
  move allocation into a snapshot on skip.
- Add a regression test analogous to
  `testPreQualificationRejectedClusterSnapshotRoundCanQualifyReplacementBeforeRefund`,
  but for bundle round sets.

If abandon-and-refund is intended:

- Rename or document the bundle skip as an abandonment path rather than a
  replacement-compatible recovery path.
- Add tests that prove a same-source replacement is impossible after skip and
  that later terminal rounds, if any, are the only way to refill the logical
  round set.

### L-1: Launch pool deposits trust the requested amount instead of exact received tokens

Severity: Low

Status: Open

Affected code:

- `contracts/LaunchDistributionPool.sol:222-229`
- `contracts/LaunchDistributionPool.sol:355-359`
- `contracts/LaunchDistributionPool.sol:1628-1632`

#### Description

`LaunchDistributionPool.depositPool` transfers `amount` from the caller and
then increments `poolBalance` by that requested `amount`:

```solidity
lrepToken.safeTransferFrom(msg.sender, address(this), amount);
poolBalance += amount;
```

Other token-ingress paths in the repo use an exact-pull balance-delta pattern.
For example:

- `QuestionRewardPoolEscrowTransferLib.pullExactToken` measures the pre/post
  balance and requires `receivedAmount == amount`.
- `FeedbackBonusEscrow._pullExactToken` does the same.

The launch pool constructor accepts any token address that satisfies the
constructor checks. If a deployment, migration, or test token has fee-on-transfer
or short-transfer behavior, `poolBalance` can exceed the contract's actual
token balance. Later payouts rely on `poolBalance`, decrement it, and then call
`safeTransfer`, which can revert or leave accounting overstated.

#### Impact

Current production LREP appears to be a plain ERC20Votes-style token, so this
is primarily hardening against misconfiguration or future token-behavior drift.
It does not create a known exploit against the current LREP token.

#### Recommendation

Use the same exact-receipt pattern used elsewhere in the repo:

```solidity
uint256 balanceBefore = lrepToken.balanceOf(address(this));
lrepToken.safeTransferFrom(msg.sender, address(this), amount);
uint256 received = lrepToken.balanceOf(address(this)) - balanceBefore;
if (received != amount) revert InvalidAmount();
poolBalance += received;
```

Add a regression test with the existing short-transfer mock to prove
`depositPool` rejects partial receipt.

## Reviewed Non-Findings

### NF-1: Stale advisory recorders cannot record advisory votes for new rounds

A read-only subagent flagged a possible stale-recorder rotation issue because
`ProtocolConfig.setAdvisoryVoteRecorder` keeps the old recorder authorized when
rotating to a nonzero replacement, and authorized recorders can write durable
advisory cooldowns.

Manual review did not reproduce this as a concrete finding. `recordAdvisoryVote`
calls `_validateAdvisoryRoundForCommit`, and that helper resolves the round's
advisory recorder from `RoundVotingEngine.advisoryRoundContext` and requires it
to equal `address(this)`.

Relevant code:

- `contracts/AdvisoryVoteRecorder.sol:319-320`
- `contracts/AdvisoryVoteRecorder.sol:721-724`
- `contracts/RoundVotingEngine.sol:1342-1347`
- `contracts/libraries/RoundCreationLib.sol:75-77`

The existing rotation tests also cover the intended behavior:

- Open rounds keep their snapshotted old advisory recorder.
- New rounds snapshot the replacement recorder.
- Replacement recorders see shared durable cooldowns from pre-rotation advisory
  votes.

No action recommended from this pass.

### NF-2: Cluster payout oracle optimistic trust model

This pass did not re-raise the accepted trust-model assumptions around
`ClusterPayoutOracle`:

- Challenge bonds are anti-spam bonds, not payout-value coverage bonds.
- Public deterministic artifacts, challenger recomputation, governance
  arbitration, operator reputation, future fees, and the frontend LREP bond are
  the economic/security model.

## Verification Results

### Slither

Command:

```bash
yarn foundry:slither
```

Result: pass. Slither analyzed 162 contracts with 35 detectors and reported
0 results.

### Aderyn

Command:

```bash
yarn foundry:aderyn
```

Result: pass for high/medium triage. Aderyn wrote `packages/foundry/report.md`
and reported 0 high issues. The report contained low-class
centralization/maintainability/tooling items; none were promoted to active
security findings in this pass without manual evidence.

### Storage layouts

Command:

```bash
make check-storage-layouts
```

Result: pass. All pinned storage layouts matched.

### Deploy bytecode sizes

Command:

```bash
yarn workspace @rateloop/foundry check:sizes
```

Result: pass. All checked deployed contracts were under the EIP-170 limit in
the deploy profile. Closest contracts:

- `LaunchDistributionPool`: 24561 bytes
- `RoundVotingEngine`: 24562 bytes
- `ContentRegistry`: 24146 bytes
- `QuestionRewardPoolEscrow`: 23199 bytes

### Foundry tests

Command:

```bash
forge test --offline -vv
```

Result: fail, with 1420 passing tests and 18 failing tests.

The failures match the stale-fixture pattern already seen in the previous pass:

- Multiple suites fail during setup with `InvalidConfig()`, consistent with
  tests still constructing round configs that violate the current
  single-duration invariant.
- `ConfidentialityEscrowTest.testOldEngineCannotRecordGatedNexusForUntrackedContentAfterRotation`
  fails an assertion before proving the intended old-engine rejection.
- `SettlementEdgeCasesTest.test_Cancel_OneSecondBeforeMaxDuration_Reverts`
  expects a revert but the current fixture makes cancellation valid.

Recommended follow-up: repair these stale test fixtures so the full Foundry
suite returns to green before relying on it as a release gate.

## Follow-up Checklist

- [x] Fix or explicitly accept M-1's bundle skip semantics.
- [x] Harden `LaunchDistributionPool.depositPool` with exact-receipt accounting.
- [x] Add regression tests for the chosen M-1 behavior and for short-transfer launch
  pool deposits.
- Clean up the stale full-suite Foundry failures.

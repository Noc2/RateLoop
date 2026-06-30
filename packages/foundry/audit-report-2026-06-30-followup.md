# RateLoop Smart Contract Security Audit Follow-Up - 2026-06-30

## Scope

This follow-up reviewed the smart-contract workspace under
`packages/foundry/contracts` on `main` at commit `049811937`.

The pass focused on fresh evidence only. Previously fixed issues from
`audit-report-2026-06-30.md` and `docs/security-review-2026-06-30.md` were
rechecked for regression but not reopened as findings without new evidence.

Production note: RateLoop contracts are already deployed on Base mainnet. This
report does not recommend a routine production redeploy.

## Executive Summary

No new actionable smart-contract security findings were identified in this
follow-up pass.

| Severity | New Findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

The prior June 30 contract findings remain fixed in current `main`:

- Parent correlation-epoch rejection can now be used by escrow skip paths.
- `PRIVATE_FOREVER` bond semantics are explicitly documented and tested.
- Advisory recorder configuration now preflights launch-pool authorization.

## Methodology

Manual review covered:

- Oracle, escrow, payout, recovery, replacement, and bundle refund flows.
- Voting, advisory voting, confidentiality gating, bond lifecycle, identity
  bans, and governance locks.
- Token transfer accounting, X402 gateway payment authorization, media
  validation, deployment/export wiring, and generated metadata boundaries.

Three read-only subagents independently reviewed:

- Escrow, oracle, payout, launch-credit, reward-distributor, and feedback
  escrow paths.
- Voting, protocol config, confidentiality, content registry, rater registry,
  frontend registry, and governance paths.
- Token/accounting, X402, media validation, deployment scripts, export scripts,
  and ABI-generation surfaces.

All three subagents reported no actionable findings.

## Commands And Checks

Passed:

- `git status --short --branch`
- `yarn foundry:slither`
  - Result: `0 result(s) found` across 162 contracts and 35 detectors.
- `yarn foundry:aderyn`
  - Result: completed successfully. Generic low detector output was manually
    triaged and not accepted as actionable security findings.
- `forge test --offline --match-contract "(Security|AuditGap|ClusterPayoutOracle|ConfidentialityEscrow|LaunchDistributionPool|ProtocolConfigBranches|QuestionRewardPoolEscrow|X402QuestionSubmitter)" -vv`
  - Result: 538 passed, 0 failed.
- `make check-storage-layouts`
  - Result: all checked storage layouts match pinned snapshots.
- `make check-contract-sizes`
  - Result: all checked deployed contracts are within the EIP-170 limit.

Additional research:

- Solidity known bugs list:
  <https://docs.soliditylang.org/en/latest/bugs.html>
- Solidity transient-storage clearing helper collision advisory:
  <https://www.soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug/>
- OpenZeppelin Contracts security advisories:
  <https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories>

Current `foundry.toml` pins `solc = "0.8.35"` with `via_ir = true`, which is
past the Solidity 0.8.28-0.8.33 transient-storage helper collision bug range
noted in the repo comments.

## Findings

No new actionable findings.

## Reviewed Non-Findings

### NF-1: Parent-Rejected Snapshot Recovery Remains Fixed

`ClusterPayoutOracle.isRoundPayoutSnapshotRejectedByCorrelationEpoch` is present
and both single-pool and bundle pre-qualification skip paths consume it:

- `contracts/ClusterPayoutOracle.sol`
- `contracts/libraries/QuestionRewardPoolEscrowRecoveryLib.sol`
- `contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol`

Regression tests cover direct rejection, parent correlation-epoch rejection,
refund after skip, and replacement-before-refund paths.

### NF-2: Bundle Pre-Qualification Skip Preserves Replacement Liveness

The bundle skip path records the rejected snapshot marker without deleting the
round-set source. `QuestionRewardPoolEscrowBundleActionsLib` then treats the
already-rejected snapshot as non-pending for refunds, while still allowing a
valid replacement snapshot to qualify before refund.

This avoids the earlier liveness concern where a skip could erase the source
needed for corrected oracle replacement.

### NF-3: Advisory Recorder Launch-Pool Authorization Remains Guarded

`ProtocolConfig` checks launch-pool authorization when setting a nonzero
advisory recorder and when installing a launch pool after a recorder already
exists. The deploy script and broadcast-export completion model authorize the
recorder in `LaunchDistributionPool` before recording it in `ProtocolConfig`.

### NF-4: Exact Token Receipt Checks Are Present

Reviewed transfer/accounting boundaries require exact receipts where short or
fee-on-transfer behavior would otherwise corrupt accounting:

- `LaunchDistributionPool.depositPool`
- `ConfidentialityEscrow` bond posting paths
- `X402QuestionSubmitter` USDC authorization paths
- `TokenTransferLib.tryTransfer`
- `QuestionRewardPoolEscrowTransferLib`

### NF-5: X402 Gateway Nonce And Escrow Binding Remain Tight

X402 payment nonces bind chain id, registry, gateway address, configured
escrow, payer, payee, value, validity window, submission payload, reward terms,
round config, confidentiality terms, and spec hashes. Submission paths also
reject stale escrows, short receipts, and residual gateway token balances.

### NF-6: Compiler Advisory Not Applicable To Current Build Pin

The reviewed contracts use `ReentrancyGuardTransient`, but the project pins
Solidity 0.8.35. That is outside the 0.8.28-0.8.33 transient-storage helper
collision range documented by the Solidity advisory and already captured in
`foundry.toml` comments.

### NF-7: Accepted Oracle Trust Model Was Not Reopened

This pass did not treat optimistic payout roots, challenge bonds, or the
60-minute reveal grace period as findings. Those are accepted product/security
parameters under the current RateLoop trust model unless future code changes
create a distinct exploit path.

## Residual Risk

No audit can prove absence of vulnerabilities. The highest-complexity areas
remain the oracle/escrow replacement state machine, bundle qualification/refund
flow, and governance/configuration rotations. Current code has targeted
regression coverage and fresh static-analysis coverage for the specific paths
reviewed in this pass.

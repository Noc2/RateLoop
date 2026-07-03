# Smart Contract Security Audit - Post-Fix Eleventh Pass

Date: 2026-07-03
Audited head: `090603fe8730c776f0be11ad8449a7ff5c5eaf19` (`main`, `origin/main`)
Last smart-contract change reviewed: `22ff5e3c1` (`fix contracts rbts parent rejection timeout`)

Recent changes reviewed:

- `22ff5e3c1` - `fix contracts rbts parent rejection timeout`
- `090603fe8` - `docs: add post-remediation non-contract review`

Scope:

- Smart contracts under `packages/foundry/contracts`.
- Recent regression tests under `packages/foundry/test`.
- Generated contract surfaces under `packages/contracts/src` touched by the recent `ClusterPayoutOracle` ABI change.
- The recent smart-contract diff from the tenth-pass audit to current `main`, with extra focus on the RBTS settlement/oracle parent-rejection fix.

Assumptions:

- The protocol will be freshly redeployed; old contracts will not remain in use.
- Storage-layout movement is not treated as an upgrade-safety finding under this redeploy plan.
- The protocol should be decentralized from launch. Recommended fixes should be permissionless or governance-timelock compatible, not centralized operator workarounds.
- Fixes should not degrade normal protocol UX.
- The `ClusterPayoutOracle` optimistic-oracle trust model remains accepted: deterministic public artifacts are published, challengers/auditors can recompute during the challenge/veto window, and governance arbitrates challenged roots.
- `ClusterPayoutOracle` challenge bonds are anti-spam bonds, not payout-value coverage bonds.
- The 60-minute `revealGracePeriod` remains an accepted product/security parameter and is not raised as a finding here.

## Summary

No new actionable smart-contract issue was found.

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| None | - | - | - |

The prior tenth-pass issue `M-10P-1` appears fixed in `22ff5e3c1` for fresh deployments that use the new `ClusterPayoutOracle` and generated contract metadata.

## Resolution Review

### M-10P-1 - RBTS timeout grace after parent correlation epoch rejection

Status: Fixed for fresh redeployments.

The fix records the exact rejected correlation-epoch proposal digest and exposes a child-oriented timestamp getter for RBTS settlement:

- `ClusterPayoutOracle` now records `correlationEpochSnapshotRejectedAt[epochId][correlationEpochDigest]` when either pre-finalized or finalized correlation epochs are rejected.
- `roundPayoutSnapshotCorrelationEpochRejectedAt(snapshotKey)` only reports a timestamp when the child round-payout proposal is still storage-live but its pinned parent digest is no longer live.
- `RoundVotingEngineRbtsSettlementModule._requireNoRecentRejectedRbtsSettlementSnapshot` takes the later of direct child rejection and parent-derived rejection before allowing the empty RBTS timeout path.
- Regression tests cover direct child rejection, finalized-parent rejection, and pre-finalized-parent rejection.

I did not find a way to bypass the one-hour empty-settlement grace after a parent correlation epoch rejection in the new deployment shape. Same-digest parent re-proposals remain blocked by the rejected digest mapping, while a corrected parent digest does not silently revive stale children because child proposals pin the original `correlationEpochDigest`.

## Informational Notes

### Old-oracle compatibility is assumption-bound

`RoundVotingEngineRbtsSettlementModule` catches failures from `roundPayoutSnapshotCorrelationEpochRejectedAt` so old or non-conforming oracles fall back to the older direct-child rejection timestamp behavior. `ProtocolConfig._validateClusterPayoutOracle` currently probes the older oracle shape and consumer pins, but does not require the new parent-derived rejection getter.

Under the stated plan that everything will be redeployed and old contracts will not remain in use, this is not an actionable smart-contract issue. It would become a future deployment/governance hardening item only if the protocol later allowed swapping in an older or non-conforming oracle while keeping an RBTS settlement engine that expects the new getter.

### Deploy-profile bytecode headroom is very tight

`make check-contract-sizes` passed, but several contracts are close to the EIP-170 deployed-bytecode limit:

- `LaunchDistributionPool`: 24,575 bytes, leaving 1 byte.
- `ClusterPayoutOracle`: 24,570 bytes, leaving 6 bytes.
- `QuestionRewardPoolEscrow`: 24,568 bytes, leaving 8 bytes.
- `ContentRegistry`: 24,519 bytes, leaving 57 bytes.

This is not a security finding and does not require a protocol behavior change. It is a release-engineering constraint: future contract fixes in these files may need bytecode reduction work before they can be deployed.

### Static-analysis reports are unchanged false positives

Slither still reports 21 items, all in the same categories as prior passes:

- inherited/default storage reports on `RoundVotingEngineStorage` as seen through `RoundVotingEngineRbtsSettlementModule`,
- constable-state suggestions for storage inherited by the module.

I did not identify an actionable issue from those reports.

## Tooling And Research

Manual review:

- Reviewed the smart-contract diff from `c91c25e52..HEAD`.
- Confirmed the only smart-contract diff since the tenth-pass audit is the RBTS parent rejection timeout fix in `22ff5e3c1`.
- Reviewed the new oracle getter, parent rejection timestamp writes, RBTS empty-timeout gating, generated ABIs, generated deployment metadata, and regression tests.
- Ran three parallel read-only agent reviews:
  - RBTS/oracle digest and timestamp edge cases.
  - Generated contract surfaces, deployment metadata, and oracle compatibility assumptions.
  - Broader recent smart-contract changes from `c91c25e52..HEAD`, including recovered reward and rating-cursor surfaces.
- Agent consensus: no new actionable smart-contract issue under the fresh redeploy assumption.

Commands run:

- `forge test --offline --match-contract SecondPassRbtsSettlementOracleTest -vv`
  - 3 passed, 0 failed.
- `forge test --offline`
  - 1845 passed, 0 failed.
- `make check-contract-sizes`
  - Passed; all checked deploy-profile contracts are within EIP-170.
- `make check-storage-layouts`
  - Passed; all checked storage layouts match pinned snapshots.
- `yarn workspace @rateloop/contracts test`
  - 44 passed, 0 failed.
- `slither . --filter-paths 'lib|test|script|mocks' --exclude-dependencies`
  - Completed with nonzero exit due the 21 triaged items described above; no new actionable issue found.

Compiler/security research:

- The repo is pinned to `solc = "0.8.35"`, `via_ir = true`, and `evm_version = 'cancun'` in `packages/foundry/foundry.toml`.
- Solidity's official known-bugs page was reviewed on 2026-07-03. The 2026 transient-storage clearing helper collision entry affects `viaIR` plus Cancun in Solidity `0.8.28` through `0.8.33` and is fixed in `0.8.34`, so the pinned `0.8.35` profile is not affected.
- Solidity's official security considerations were used as a checklist for common review areas including authorization, reentrancy, gas/liveness, and compiler-version risk.
- References:
  - https://docs.soliditylang.org/en/latest/bugs.html
  - https://docs.soliditylang.org/en/latest/security-considerations.html

# RateLoop Repo Re-Audit - Main Follow-Up (2026-06-18)

Read-only re-audit of current `main` at `15d9193b` (`Refresh bug report
environment examples`). Scope: bugs, inconsistencies, stale operational gates,
docs drift, and regressions after the latest fix batch.

Three read-only subagents reviewed independent slices in parallel:

- Solidity/governance/Foundry contracts
- Next.js/frontend/E2E/docs
- SDK/Keeper/Ponder/ops/package consistency

The source tree was clean at the start. One delegated protocol pass produced an
unrequested local fix patch in the main workspace; that patch was inspected and
restored before this report was written. This document is the only intended repo
change.

## Verification snapshot

| Check | Result |
| --- | --- |
| `git status --short --branch` | Clean before document creation |
| `node scripts/check-base-sepolia-readiness.mjs --json` | Pass; Base Sepolia `84532` artifact and generated contracts are aligned |
| `node scripts/check-base-mainnet-readiness.mjs --json` | Expected fail: missing `packages/foundry/deployments/8453.json` |
| `make check-contract-sizes` | Fail: no root `Makefile` target exists |
| `yarn workspace @rateloop/foundry check:sizes` | Pass; all deploy-profile contracts are below EIP-170 |

Tightest deploy-profile size headroom from the passing size gate:

| Contract | Size (B) | Headroom (B) |
| --- | ---: | ---: |
| `LaunchDistributionPool` | 24,561 | 15 |
| `ContentRegistry` | 24,509 | 67 |
| `QuestionRewardPoolEscrow` | 24,503 | 73 |
| `RoundVotingEngine` | 24,092 | 484 |
| `RaterRegistry` | 22,900 | 1,676 |

No High-severity issue was confirmed in this pass.

## Medium

### M1 - External-wallet `sendCallsSync` waits with a string instead of a status predicate

**Severity:** Medium (submitted wallet-call batches can be reported as failures
instead of waiting for success)

**Status:** Open

**Paths:** `packages/nextjs/hooks/useThirdwebSponsoredSubmitCalls.ts:531-541`,
`packages/contracts/node_modules/viem/_types/actions/wallet/waitForCallsStatus.d.ts:32-36`,
`packages/contracts/node_modules/viem/_esm/actions/wallet/waitForCallsStatus.js:56-57`

The external-wallet path calls `sendCallsSyncAsync` with `status: "success"` and
casts the whole argument object as `never`. The local Viem type for
`WaitForCallsStatusParameters.status` is a predicate function, and the runtime
poller calls it as `status(result)`.

**Impact:** The wallet batch can be submitted, then polling throws because the
string is not callable. That makes the UI treat the external-wallet EIP-5792
path as failed even when the wallet eventually includes the calls.

**Suggested fix/test:** Restore a helper such as
`isSuccessfulCallsStatus(status) => status.status === "success"` and pass that
function to `sendCallsSyncAsync`. Add a unit test that verifies pending/failure
statuses return false and success returns true.

### M2 - Oracle challenge window and bond remain mutable for already proposed snapshots

**Severity:** Medium (governance/config changes can alter open proposal terms)

**Status:** Open

**Paths:** `packages/foundry/contracts/ClusterPayoutOracle.sol:73-88`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:91-108`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:314-325`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:335-342`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:536-550`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:560-567`

Correlation epoch and round payout proposals store `proposedAt`, but not the
challenge window or bond that were active when the proposal was made. Challenge
and finalization paths read the current global `challengeWindow` and
`challengeBond`.

**Impact:** A later `setOracleConfig` can shorten or extend an already-open
window, or change the bond challengers must post against a proposal made under
different terms. This is a governance rotation footgun, not a challenge-bond
coverage finding.

**Suggested fix/test:** Snapshot `challengeWindow` and `challengeBond` into both
proposal structs when they are proposed, and use the stored values for challenge
and finalization checks. Add tests that shrink, expand, and reprice config after
proposal for both correlation epochs and round payout snapshots.

### M3 - `ProtocolConfig` does not validate question reward payout consumers

**Severity:** Medium (reward oracle/distributor rotations can be accepted while
question payout domains are miswired)

**Status:** Open

**Paths:** `packages/foundry/contracts/ProtocolConfig.sol:39-40`,
`packages/foundry/contracts/ProtocolConfig.sol:243-260`,
`packages/foundry/contracts/ProtocolConfig.sol:495-573`,
`packages/foundry/contracts/ProtocolConfig.sol:709-727`,
`packages/foundry/contracts/ProtocolConfig.sol:790-800`

`ProtocolConfig` validates the launch-credit consumer and the public-rating
consumer on `ClusterPayoutOracle`, but it does not validate the question reward
domain (`1`) or question bundle reward domain (`4`) against
`QuestionRewardPoolEscrow` during `setClusterPayoutOracle`,
`setRewardDistributor`, or `replaceRevokedRewardDistributor`.

**Impact:** Governance can accept a replacement oracle or distributor that
passes public-rating checks while question reward and bundle payout roots are
pointed at the wrong consumer. The mistake then surfaces later as failed payout
previews, claims, or oracle proposal flow.

**Suggested fix/test:** Teach `ProtocolConfig` to read the configured question
reward escrow from the content registry/reward distributor integration and
require oracle domains `1` and `4` to point at it. Add branch tests for oracle
replacement, reward distributor replacement, and revoked-distributor replacement.

### M4 - `ProtocolConfig` does not cross-check the oracle frontend registry

**Severity:** Medium (configured frontend registry can diverge from oracle
proposer eligibility)

**Status:** Open

**Paths:** `packages/foundry/contracts/ProtocolConfig.sol:594-598`,
`packages/foundry/contracts/ProtocolConfig.sol:709-727`,
`packages/foundry/contracts/ClusterPayoutOracle.sol:107-112`

`ClusterPayoutOracle` has its own `frontendRegistry`, while `ProtocolConfig`
also stores the protocol `frontendRegistry`. Rotating either side does not
verify they agree.

**Impact:** The protocol can advertise one frontend registry while the oracle
checks proposer eligibility and proposal-time snapshot proposers against another
registry. That makes coordinated governance rotations easier to miswire.

**Suggested fix/test:** Require `setFrontendRegistry` to reject if a configured
oracle still points at the old registry, and require `setClusterPayoutOracle` to
reject an oracle whose `frontendRegistry()` does not match the configured
protocol registry.

## Low

### L1 - Reopened recovered cluster reward previews can return zero before claim

**Severity:** Low (quote/UI mismatch; direct claim can still succeed)

**Status:** Open

**Paths:** `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1269-1294`,
`packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1423-1474`,
`packages/foundry/contracts/libraries/QuestionRewardPoolEscrowClaimLib.sol:30-36`,
`packages/foundry/contracts/libraries/QuestionRewardPoolEscrowClaimLib.sol:241-255`,
`packages/foundry/contracts/libraries/QuestionRewardPoolEscrowClaimLib.sol:581-586`,
`packages/foundry/test/QuestionRewardPoolEscrow.t.sol:4235-4243`,
`packages/foundry/test/QuestionRewardPoolEscrow.t.sol:4441-4446`

The claim path handles reopened recovered rounds by checking
`reopenedRecoveredRound` and allowing qualification. The view path
`claimableQuestionRewardWithPayoutWeight` does not pass reopened-round context
into the claim library, and `_canPreviewNewQualification` returns false while
`pendingRecoveredRounds != 0`.

**Impact:** UI/API quote surfaces can show `0` for a reopened recovered round
that would pay if the user called `claimQuestionReward` directly.

**Suggested fix/test:** Pass reopened-round context into
`ClaimableQuestionRewardParams` and preview with the recovered allocation. Add a
regression assertion that `claimableQuestionRewardWithPayoutWeight(...) > 0`
immediately after `reopenRecoveredSnapshotRound(...)` and before the claim.

### L2 - Ponder path-prefixed URLs are preserved in SDK tests but not Keeper/readiness probes

**Severity:** Low / conditional (only affects path-mounted Ponder deployments)

**Status:** Open

**Paths:** `packages/sdk/src/read.test.ts:408-416`,
`packages/sdk/src/agent.test.ts:535-542`,
`packages/keeper/src/keeper.ts:568-577`,
`packages/keeper/src/correlation-ponder-freshness.ts:79-85`,
`scripts/check-worldchain-sepolia-readiness.mjs:785-788`,
`docs/env-parity.md:47-55`

The SDK has tests asserting that a path-prefixed `apiBaseUrl` such as
`https://api.example/ponder` is preserved. Keeper and readiness code build
root-absolute URLs like `new URL("/keeper/work", baseUrl)`,
`new URL("/rounds", ponderBaseUrl)`, and `new URL("/status", ponderUrl)`, which
drop any path prefix from the base URL.

**Impact:** If Ponder is mounted under a path prefix, SDK reads can work while
Keeper work discovery, correlation freshness, and live readiness probes hit the
host root. If origin-only Ponder URLs are the intended ops contract, the docs
should say that explicitly.

**Suggested fix/test:** Either switch Keeper/readiness URL construction to
append paths without discarding the base pathname, or validate/document that
Ponder URLs must be origin-only. Add URL-construction tests for both contracts.

### L3 - Protocol design review still carries World Chain launch-gate and stale size-command wording

**Severity:** Low (operator/docs drift during Base-first rollout)

**Status:** Open

**Paths:** `docs/protocol-design-review-2026-06.md:46-49`,
`docs/protocol-design-review-2026-06.md:603-615`

The design review says the World Chain mainnet readiness script correctly fails
until the first chain `480` production artifact exists. Current `main` already
has World Chain artifacts, and the active live rollout is Base Sepolia first.
The same section still frames launch gates as the first World Chain mainnet
deployment, asks for chain `480` start blocks, and references
`make check-contract-sizes` even though the root make target does not exist.

**Impact:** Operators following this document can prepare the wrong launch
evidence bundle or run the wrong contract-size command while Base Sepolia is the
current gate.

**Suggested fix/test:** Mark the World Chain section historical or rewrite it
for Base Sepolia/Base mainnet. Replace root `make check-contract-sizes` wording
with the active monorepo command:
`yarn workspace @rateloop/foundry check:sizes`.

## Non-findings

- Base Sepolia readiness is no longer blocked by a missing `84532` artifact; the
  offline check passed and required addresses match generated contracts.
- Base mainnet remains intentionally blocked by the absent `8453` deployment
  artifact.
- `packages/agents/dist` is ignored and not tracked (`git ls-files
  packages/agents/dist` returns nothing). The current agents `test` script
  builds before reading dist, so the earlier stale-committed-dist concern is not
  a confirmed repo bug.
- Recent fixes for the public mobile header data attributes, responsive beta
  banner pre-dismissal, Keeper address override docs, and bug-report environment
  examples are present on `main`.

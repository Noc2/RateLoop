# Non-Contract Current Worktree Review - Second Pass (2026-07-03)

## Scope

- Reviewed current `main` at `ebbeaf387820` plus the existing dirty worktree as of `2026-07-03T13:43:48Z`.
- Excluded Solidity smart-contract implementation and Foundry tests from the review. Contract ABI files were referenced only when checking whether a non-contract UI path exposes an available action.
- Reviewed Next.js UI/API/docs, agent SDK/CLI docs, Ponder API helpers, keeper config/docs, and operational docs/config.
- Used three parallel read-only subagents for independent passes over frontend/runtime/API, agents/sdk/keeper/ponder, and docs/config/workflows; findings below were rechecked locally before inclusion.

## Findings

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| NC-WT-2026-07-03-1 | Medium | Open | Governance action composer lacks the challenger-bounty slash path documented for payout-root challenges. |
| NC-WT-2026-07-03-2 | Medium | Open | Frontend deregistration completion UI and docs do not reflect the active-dispute fee freeze. |
| NC-WT-2026-07-03-3 | Low | Open | Frontend fee-withdrawal claim flows treat unknown dispute status as unblocked. |

## NC-WT-2026-07-03-1 - Governance composer cannot build challenger-bounty slash proposals

Severity: Medium

Evidence:

- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:319-337` exposes only a `frontend-slash` template that calls `FrontendRegistry.slashFrontend(frontend, amount, reason)`.
- `packages/nextjs/app/(public)/docs/governance/page.tsx:132-139` tells governance that successful payout-root challenge batches can use `slashFrontendWithBounty` so the recorded challenger receives the fixed 50% share of confiscated value.
- `packages/contracts/src/abis/FrontendRegistryAbi.ts:1008-1033` includes `slashFrontendWithBounty(frontend, amount, reason, bountyRecipient)`, but the composer does not offer that action.

Impact:

Governance users following the UI for a successful payout-root challenge can create only the plain slash proposal. That path disables or penalizes the frontend, but it does not encode the challenger-bounty recipient that the public governance docs describe. The result is an operator-facing governance UI that can underpay challengers and weaken the "correct challenges are directly profitable" incentive.

Suggested fix:

Add a `slashFrontendWithBounty` governance template with `frontend`, `amount`, `reason`, and `bountyRecipient` fields. Keep the existing plain slash template, but label it as the non-bounty path so oracle-challenge slash batches pick the right action.

## NC-WT-2026-07-03-2 - Deregistration completion ignores the active-dispute freeze in UI and docs

Severity: Medium

Evidence:

- `packages/nextjs/components/governance/FrontendRegistration.tsx:271` computes `canCompleteDeregister` from only the exit timestamp.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:293` computes `feeWithdrawalBlockedByDispute`, and `:534-539` uses it to block `completeFeeWithdrawal()`.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:461-484` submits `completeDeregister()` without a dispute guard, and `:1281-1289` does not disable the "Complete Deregistration" button when a payout-root dispute is active.
- `packages/nextjs/app/(public)/docs/frontend-codes/page.tsx:115-121` correctly says `completeFeeWithdrawal()` pays only once no payout-root challenge is active, but then says `completeDeregister()` sweeps stake and all fees after the 14-day unbonding period without mentioning the same dispute freeze.
- `packages/nextjs/app/(public)/docs/governance/page.tsx:146-152` describes frontend fees as challenge-frozen while active payout-root challenges exist.

Impact:

The contract layer should still reject the fee-release leg during an active dispute, but the UI currently invites the operator to submit a transaction that is expected to fail or behave differently than the docs imply. This is most confusing at the exact moment an operator is trying to exit after a challenge, and it makes the fresh fee-freeze accountability model harder to reason about.

Suggested fix:

Apply the same dispute-aware state used for `completeFeeWithdrawal()` to `completeDeregister()`: disable or relabel the button while a dispute is active, guard the handler before submitting, and update the frontend-operator docs to state that deregistration completion cannot release pending fees while a payout-root challenge is active unless a separate stake-only exit path is intentionally supported.

## NC-WT-2026-07-03-3 - Fee-withdrawal claim flows fail open while dispute status is unknown

Severity: Low

Evidence:

- `packages/nextjs/hooks/useClaimableFrontendRewards.ts:198-199` treats only `hasOpenSnapshotDispute === true` as blocked. While the dispute read is loading, refetching, or errored, `undefined` is treated as unblocked.
- The same hook reports `hasOpenSnapshotDisputeLoading` in `isLoading` at `packages/nextjs/hooks/useClaimableFrontendRewards.ts:267-274`.
- `packages/nextjs/components/shared/ClaimRewardsButton.tsx:282-285` does not disable the claim-all button while `claimablesLoading` is true, so a stale matured `frontend_registry_withdrawal` item can still be submitted by `useClaimAll`.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:217-225` reads `hasOpenSnapshotDispute`, but the component does not track loading/error state for that read; `:534-539` blocks only when the value is exactly `true`.

Impact:

This should not release frozen funds because the contract remains the source of truth. The user-facing problem is avoidable failed transactions or sponsored-call attempts while the frontend has not yet proven that no active challenge exists.

Suggested fix:

Fail closed in frontend fee completion paths: require `hasOpenSnapshotDispute === false` before adding a matured pending withdrawal to claim-all, before freeing the request slot, and before enabling the manual complete-withdrawal action. Surface a short "checking dispute status" or retry state while the read is loading or failed.

## Rechecked Prior Candidates Not Carried Forward

- AI docs now include the Feedback Bonus follow-up after ask confirmation: `packages/nextjs/app/(public)/docs/ai/page.tsx:479-482` and `packages/nextjs/public/docs/ai.md:178-180`.
- Next.js env docs now list `PONDER_METADATA_SYNC_TOKEN` and `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET`: `packages/nextjs/README.md:82-83` and `:111-112`.
- Database migration guidance now distinguishes numbered migrations from local/dev `db:push`: `README.md:126`, `packages/nextjs/README.md:40`, and `packages/nextjs/drizzle/README.md:3-5`.
- Ponder query parsing now uses strict unsigned decimal parsing and tests reject blank, signed, hex, fractional, and partial strings: `packages/ponder/src/api/utils.ts:21-22` and `packages/ponder/tests/api-utils.test.ts:30-34`.
- Invalid `PONDER_REPLICA_COUNT` now warns instead of being partially parsed: `packages/ponder/src/api/index.ts:80-95` and `packages/ponder/tests/api-index.test.ts:85-101`.
- The MCP handoff schema now accepts either flat handoff inputs or wrapped `{ request }` inputs: `packages/nextjs/lib/agent/schemas.ts:541-558`.
- Content-feedback list and count paths now merge protocol-indexed feedback with local rows, including local-storage-unavailable fallback: `packages/nextjs/lib/feedback/contentFeedback.ts:1249-1255` and `:1335-1343`.
- Agent CLI and SDK lookup chain IDs now require positive base-10 safe integers before URL construction: `packages/agents/src/cliOptions.ts:4-22` and `packages/sdk/src/agent.ts:1923-1930`.
- Published-package agent docs now show `npx rateloop-agents ...` commands separately from monorepo Yarn scripts: `packages/agents/README.md:89-95`.
- Keeper public file artifacts now require the metrics/artifact server to be enabled when auto snapshots publish file artifacts, and the Railway config exposes `/live`: `packages/keeper/src/config.ts:901-905` and `packages/keeper/railway.toml:19-21`.

## Verification

- Rechecked the current worktree with targeted `rg`, `awk`, and `git status` probes across Next.js, agents, SDK, Ponder, keeper, and docs.
- No source code was modified by this report pass.

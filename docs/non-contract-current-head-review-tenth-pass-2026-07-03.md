# Non-Contract Current-Head Review - Tenth Pass (2026-07-03)

Reviewed head: `2422c82b4` on `main`.

Scope: non-Solidity application code, Next.js app/API/client surfaces, public docs, Ponder APIs, keeper runtime/config/deploy metadata, agents, SDK-facing examples, scripts, package metadata, env references, tests, and CI/config. Smart contracts, Solidity implementation review, Foundry Solidity tests, and contract security findings were excluded. Contract-facing docs and TypeScript ABI metadata were referenced only where non-contract tooling or UX depends on them.

The worktree was clean before this report was added. The branch had one local unpushed docs commit, `2422c82b4` (`docs: add tenth-pass multi-agent design review`), which was preserved.

Three read-only agents reviewed separate non-contract slices in parallel:

- Next.js app, hooks, claim UX, governance UI, and frontend operator flows.
- Agents, SDK, keeper, scripts, readiness, and deployment tooling.
- Docs, reports, package metadata, generated metadata consumers, and CI/config.

## Summary

No critical or high-severity non-contract issues were found. Four medium issues remain because they can make readiness checks disagree with runtime behavior, hide degraded fee state from users, or leave governance operators without the context needed to clear fee freezes promptly. Six low issues are UX/status and documentation consistency gaps.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-10P-2026-07-03-1 | Medium | Open | Live readiness reads payout-finality env vars that the keeper never reads. |
| NC-10P-2026-07-03-2 | Medium | Open | Claimable frontend fee lookup failures render as empty fee state. |
| NC-10P-2026-07-03-3 | Medium | Open | Base Sepolia routine readiness does not fail the known stale one-shot x402 submitter. |
| NC-10P-2026-07-03-4 | Medium | Open | Oracle epoch rejection composer actions omit the child-snapshot freeze caveat. |
| NC-10P-2026-07-03-5 | Low | Open | Global claim UI hides dispute-paused matured frontend withdrawals. |
| NC-10P-2026-07-03-6 | Low | Open | Manual frontend completion handlers trust cached dispute status. |
| NC-10P-2026-07-03-7 | Low | Open | Public AI docs use a monorepo-only example path after `npm install`. |
| NC-10P-2026-07-03-8 | Low | Open | Keeper docs still describe correlation snapshot candidates as USDC-only. |
| NC-10P-2026-07-03-9 | Low | Open | Retired World Chain Sepolia readiness can still report green when run directly. |
| NC-10P-2026-07-03-10 | Low | Open | Historical use-case report still says the published npm packages 404. |

## Findings

### NC-10P-2026-07-03-1 - Live readiness reads payout-finality env vars that the keeper never reads

Severity: Medium

Evidence:

- `scripts/readiness-core.mjs:1269` through `:1279` reads `PAYOUT_FINALITY_OPS_LAG_BUDGET_SECONDS` and `PAYOUT_FINALITY_OVERLAP_PROOF`.
- `packages/keeper/src/config.ts:729` through `:740` reads `KEEPER_PAYOUT_FINALITY_OPS_LAG_BUDGET_SECONDS` and `KEEPER_PAYOUT_FINALITY_OVERLAP_PROOF`.
- `packages/keeper/src/index.ts:64` through `:67` enforces the keeper's computed payout-finality budget at startup.
- A repo-wide search found no non-test runtime reader for the unprefixed `PAYOUT_FINALITY_*` names outside `scripts/readiness-core.mjs`.

Impact:

A rollout can pass live readiness using one set of env names while the keeper starts with another set of values. For non-default deployments this can either let readiness under-report an over-budget keeper configuration, or make the keeper fail startup after readiness has already gone green.

Suggested fix:

Make readiness read the same `KEEPER_PAYOUT_FINALITY_*` variables as the keeper, optionally retaining the unprefixed names only as deprecated aliases. Add a parity test that overrides the keeper-prefixed values and verifies readiness and keeper startup budget math agree.

### NC-10P-2026-07-03-2 - Claimable frontend fee lookup failures render as empty fee state

Severity: Medium

Evidence:

- `packages/nextjs/app/api/frontend/claimable-fees/route.ts:78` through `:80` catches lookup failures and returns HTTP 200 with `items: []` plus `degraded: true`.
- `packages/nextjs/hooks/useFrontendClaimableFees.ts:42` through `:47` treats every 2xx response as a successful page and does not surface `degraded`.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:1152` through `:1159` shows loading only while the query is loading, and otherwise renders no unavailable state when the list is empty.

Impact:

An indexer or lookup failure can look identical to "no claimable round fees" in the frontend operator page. Operators lose a retry/status signal and may conclude there are no fees to claim when the fee scanner is degraded.

Suggested fix:

Either return a non-2xx status for lookup failure, or propagate the `degraded` field through `useFrontendClaimableFees` and render a visible "fee scan unavailable, retry" state. Add route and hook/UI tests for degraded lookup responses.

### NC-10P-2026-07-03-3 - Base Sepolia routine readiness does not fail the known stale one-shot x402 submitter

Severity: Medium

Evidence:

- `scripts/check-base-sepolia-readiness.mjs:107` through `:116` detects the known stale `X402QuestionSubmitter` and fails only when `requireOneShotFeedbackBonusX402` is enabled.
- `.github/workflows/base-sepolia-readiness.yaml:96` through `:99` adds `--require-one-shot-feedback-bonus-x402` only for manual `workflow_dispatch` with the strict input enabled.
- `node scripts/check-base-sepolia-readiness.mjs --require-one-shot-feedback-bonus-x402 --json` fails on the current checked-in Base Sepolia artifact with the stale submitter message.

Impact:

Scheduled and normal live readiness can stay green while the staging one-shot Feedback Bonus x402 path remains explicitly disabled. That was previously tolerable as a staging warning, but it conflicts with the current fresh-redeploy posture where old contracts should not be used as launch behavior.

Suggested fix:

Make scheduled Base Sepolia readiness strict by default, or invert the flag so a stale submitter requires an explicit `--allow-stale-x402-submitter` escape hatch. Keep a manual non-strict mode only for historical diagnostics.

### NC-10P-2026-07-03-4 - Oracle epoch rejection composer actions omit the child-snapshot freeze caveat

Severity: Medium

Evidence:

- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:675` through `:697` builds a standalone `rejectCorrelationEpoch` action.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:723` through `:740` builds a standalone finalized-epoch rejection action.
- `packages/nextjs/app/(public)/docs/governance/page.tsx:135` through `:137` says parent-epoch rejection batches should explicitly reject challenged child round snapshots that need their fee-withdrawal freeze cleared immediately.

Impact:

Governance users can follow the composer for an epoch rejection without seeing the operational caveat that some child round snapshot disputes may need explicit rejection in the same batch. That can leave frontend fee-withdrawal freezes active longer than intended after a governance rejection.

Suggested fix:

Add helper text or an inline warning to the epoch rejection templates, and consider a bundled proposal template that collects affected child snapshot keys. Add a governance composer regression that asserts the warning is present.

### NC-10P-2026-07-03-5 - Global claim UI hides dispute-paused matured frontend withdrawals

Severity: Low

Evidence:

- `packages/nextjs/hooks/useClaimableFrontendRewards.ts:217` through `:230` drops a matured `frontend_registry_withdrawal` item unless dispute status is known clear.
- `packages/nextjs/hooks/useClaimableFrontendRewards.ts:298` exposes `feeWithdrawalBlockedByDispute`, but `packages/nextjs/hooks/useAllClaimableRewards.ts:84` through `:89` does not propagate it.
- `packages/nextjs/components/shared/ClaimRewardsButton.tsx:226` through `:234` returns `null` when no visible claimable items remain.

Impact:

This avoids failed claim-all transactions, but a user with a matured frontend withdrawal paused by a payout-root challenge may see no global claim status at all. The operator page has better dispute copy; the global wallet claim surface does not.

Suggested fix:

Propagate a "frontend withdrawal paused by dispute" status through `useAllClaimableRewards` and render a compact disabled/status label in the global claim button area. Keep the actual claim item hidden until the contract status is known clear.

### NC-10P-2026-07-03-6 - Manual frontend completion handlers trust cached dispute status

Severity: Low

Evidence:

- `packages/nextjs/components/governance/FrontendRegistration.tsx:244` through `:247` caches `hasOpenSnapshotDispute` for 30 seconds.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:492` through `:503` uses that cached state before sending `completeDeregister`.
- `packages/nextjs/components/governance/FrontendRegistration.tsx:574` through `:584` uses that cached state before sending `completeFeeWithdrawal`.

Impact:

A challenge opened after the last cached read can leave a manual completion button enabled until the transaction reverts. The contract still enforces the freeze, so this is a UX/race issue rather than a safety failure.

Suggested fix:

Refetch `hasOpenSnapshotDispute` inside both completion handlers immediately before `executeSponsoredCalls` or `writeFrontendRegistry`, and treat refetch failure as "checking/retry" rather than submitting.

### NC-10P-2026-07-03-7 - Public AI docs use a monorepo-only example path after npm install

Severity: Low

Evidence:

- `packages/nextjs/app/(public)/docs/ai/page.tsx:184` through `:187` tells users to `npm install @rateloop/sdk @rateloop/agents`, then runs `npx rateloop-agents sandbox --file packages/agents/examples/questions/landing-pitch-review.json`.
- `packages/agents/README.md:38` through `:45` uses the published-package path `node_modules/@rateloop/agents/examples/questions/landing-pitch-review.json`.

Impact:

Users following the rendered public docs outside the monorepo can install the package successfully and then hit a missing file path on the next command.

Suggested fix:

Use the `node_modules/@rateloop/agents/...` example path in the published-package snippet, and keep `packages/agents/...` only in a monorepo checkout snippet. Mention Node 24 in the public docs snippet to match package engines.

### NC-10P-2026-07-03-8 - Keeper docs still describe correlation snapshot candidates as USDC-only

Severity: Low

Evidence:

- `packages/keeper/README.md:91` says `KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK` controls settled USDC bounty rounds.
- `packages/keeper/README.md:169` says auto mode asks Ponder for settled USDC bounty rounds.
- `README.md:43` describes current wallet-call bounties and Feedback Bonuses as LREP or USDC.

Impact:

Operators can incorrectly infer that keeper-built payout artifacts only cover USDC bounty rounds, even though current product/docs describe LREP or USDC bounty payouts through the same payout-root pipeline.

Suggested fix:

Reword the keeper docs to "settled LREP or USDC bounty rounds" or "settled question-reward rounds" where the path is asset-agnostic.

### NC-10P-2026-07-03-9 - Retired World Chain Sepolia readiness can still report green when run directly

Severity: Low

Evidence:

- `.github/workflows/worldchain-sepolia-readiness.yaml:1` through `:18` is retired and only prints the Base-first rollout notice.
- `scripts/check-worldchain-mainnet-readiness.mjs:3` through `:8` hard-exits as retired.
- `scripts/check-worldchain-sepolia-readiness.mjs:20` through `:39` still runs offline/live validation against the old World Chain Sepolia config.
- `node scripts/check-worldchain-sepolia-readiness.mjs --json` currently reports `ok: true` for the old 4801 deployment artifacts.

Impact:

The workflow is safely retired, but the direct script can still produce a green readiness result for a legacy deployment path. That is confusing while old contracts are explicitly not intended to be used for the fresh redeploy.

Suggested fix:

Retire the World Chain Sepolia script the same way mainnet was retired, or require an explicit `--legacy` flag before validating the old 4801 stack.

### NC-10P-2026-07-03-10 - Historical use-case report still says the published npm packages 404

Severity: Low

Evidence:

- `docs/use-cases-2026-06.md:62` says the SDK/agents packages are built but still 404 on npm.
- `docs/use-cases-2026-06.md:264` through `:265` repeats that `@rateloop/sdk` / `@rateloop/agents` still 404.
- `npm view @rateloop/sdk version`, `npm view @rateloop/agents version`, `npm view @rateloop/contracts version`, and `npm view @rateloop/node-utils version` all returned `0.1.0` during this review.

Impact:

The file is historical, but these remaining lines are written as adoption blockers rather than snapshot-only constraints. A reader can miss the status note and think package publication is still a current launch blocker.

Suggested fix:

Mark the package-publication statements as snapshot-time historical, or update the adoption-blocker list to remove the npm 404 blocker.

## Rechecked Prior Candidates Not Carried Forward

- The second-pass worktree findings around `slashFrontendWithBounty`, deregistration dispute freezes, and unknown dispute status are resolved in current source. Focused tests for the governance composer, frontend registration dispute state, and frontend fee withdrawal plan passed.
- Prior latest-head findings around standalone Ponder keeper work, MCP unsafe numeric coercion, unreadable public artifacts, prefixed hosted attachment URLs, cleanup cron scheduling, keeper Railway liveness, Gemini MCP headers, keeper Railway watch patterns, Ponder health wording, agents Node compatibility, and generic bounty copy are fixed or explicitly documented in current source.
- Older non-contract report text was treated as historical review input, not current evidence, unless the underlying source or public docs still showed the issue.

## Verification

Passed:

- `yarn dead-code`
- `node ../../scripts/run-node-tests.mjs components/governance/GovernanceActionComposer.test.ts components/governance/FrontendRegistration.test.ts hooks/useClaimableFrontendRewards.test.ts components/shared/ClaimRewardsButton.test.ts` from `packages/nextjs` - 20 tests.
- `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs scripts/readiness-workflows.test.mjs scripts/check-base-mainnet-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 84 tests.
- `yarn workspace @rateloop/nextjs check-types`
- `yarn workspace @rateloop/ponder check-types`
- `yarn workspace @rateloop/keeper check-types`
- `yarn workspace @rateloop/agents check-types`
- `yarn workspace @rateloop/sdk check-types`
- `yarn workspace @rateloop/node-utils check-types`
- `npm view @rateloop/sdk version && npm view @rateloop/agents version && npm view @rateloop/contracts version && npm view @rateloop/node-utils version` - all returned `0.1.0`.

Expected failure used as evidence:

- `node scripts/check-base-sepolia-readiness.mjs --require-one-shot-feedback-bonus-x402 --json` fails because the checked-in Base Sepolia `X402QuestionSubmitter` is the known stale staging submitter.

Not run:

- Foundry/Solidity tests and smart-contract review, because smart contracts were explicitly out of scope.
- Full Playwright/browser E2E.
- Live external readiness probes.

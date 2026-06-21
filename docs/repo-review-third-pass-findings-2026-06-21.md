# Repo Review Findings - 2026-06-21

Read-only review of the current RateLoop repo after the prior follow-up fixes. Four parallel agents reviewed Next.js/API hooks, Ponder/keeper, ops/tooling/docs, and agents/MCP/local signer paths; I then cross-checked the reported code paths locally.

Production Base mainnet contracts are treated as durable deployed infrastructure. None of the findings below require a production contract redeploy; the remediation paths are deployment tooling, indexer/keeper logic, app/API behavior, SDK/MCP validation, and operator copy.

## P1 Findings

### P1 - Direct `make deploy` bypasses the production redeploy guard

The JS deploy wrapper validates `RATELOOP_CONFIRM_PRODUCTION_REDEPLOY` / `--confirm-production-redeploy` for protected production networks in `packages/foundry/scripts-js/parseArgs.js:109`, then invokes Make in `packages/foundry/scripts-js/parseArgs.js:281`. The underlying `packages/foundry/Makefile:31` still broadcasts any non-local `RPC_URL` with `ETH_KEYSTORE_ACCOUNT` and no equivalent guard.

Impact: an operator can bypass the break-glass check by running `make deploy RPC_URL=base ETH_KEYSTORE_ACCOUNT=...` or an RPC URL directly from `packages/foundry`. That conflicts with the durable-production deployment policy and raises accidental redeploy risk.

Suggested fix: move the production redeploy guard into the Make/Forge entrypoint as well, or make live `make deploy` refuse production-like targets unless invoked by the guarded wrapper with an explicit internal confirmation. Add a focused test/preflight that production `DEPLOY_TARGET_NETWORK=base` exits before Forge unless the current `<chainId>:<deploymentBlockNumber>` token is supplied.

### P1 - Launch-credit artifact reconstruction excludes the raw submitter, not the submitter identity

The off-chain launch-credit route filters anchors against `content.submitter` in `packages/ponder/src/api/routes/correlation-routes.ts:858` and returns the same raw submitter from the settled-round query at `packages/ponder/src/api/routes/correlation-routes.ts:982`. The on-chain launch policy excludes `registry.getSubmitterIdentity(contentId)` in `packages/foundry/contracts/libraries/LaunchRaterRewardLib.sol:31`.

Impact: delegated submissions can produce off-chain launch-credit artifacts with a different anchor set than the contract used when the pending credit was recorded. This can wrongly include or exclude anchors and make launch-credit finalization depend on an off-chain identity mismatch.

Suggested fix: index or derive the submitter identity used by `ContentRegistry.getSubmitterIdentity(contentId)` and use that identity in launch anchor filtering. Add a delegated-submitter route test where raw submitter and identity holder differ.

### P1 - Launch ban drift is missed after unban or expiry

`getActiveCorrelationIdentityBanState` only selects bans that are currently active and unexpired before computing `latestUpdatedAt` in `packages/ponder/src/api/routes/correlation-routes.ts:121`. Unbans update the row with `active: false` and a fresh `updatedAt` in `packages/ponder/src/RaterRegistry.ts:177`. The drift guard only compares the active-ban `latestUpdatedAt` against pending-credit `recordedAt` at `packages/ponder/src/api/routes/correlation-routes.ts:1149`.

Impact: if identity-ban state changes after a pending launch credit is recorded, then later becomes inactive or expired, the route can miss the drift and build an artifact from post-record identity state instead of forcing manual verification.

Suggested fix: compute launch drift from all relevant ban rows updated after the pending credit timestamp, while still using only currently active bans for exclusion. Add route tests for inactive/unbanned and expired ban rows with `updatedAt > recordedAt`, expecting `launch_identity_ban_drift`.

## P2 Findings

### P2 - Feedback eligibility hard-fails on Ponder errors before using the on-chain fallback

`assertContentFeedbackVoterEligibility` awaits `ponderApi.getVotes(...)` in `packages/nextjs/lib/feedback/contentFeedback.ts:767` before it reaches `hasOnchainFeedbackEligibleVote` at `packages/nextjs/lib/feedback/contentFeedback.ts:787`. The challenge and submit routes only translate `ContentFeedbackVoterEligibilityError`; other errors from Ponder bubble as 500s through `packages/nextjs/app/api/feedback/challenge/route.ts:70` and `packages/nextjs/app/api/feedback/route.ts:186`.

Impact: valid voters can be blocked from saving feedback during a Ponder outage, deployment mismatch, or transient Ponder failure even though the code already has an on-chain eligibility fallback.

Suggested fix: catch and log Ponder vote lookup failures inside `assertContentFeedbackVoterEligibility`, then try `hasOnchainFeedbackEligibleVote`. Only return 403 when both indexed and on-chain checks fail. Add a unit test where `getVotes` throws and `hasOnchainFeedbackEligibleVote` returns true.

### P2 - Mixed-asset Feedback Bonuses are counted against one scalar `maxPaymentAmount`

MCP accepts `feedbackBonus.asset` as USDC or LREP in `packages/nextjs/lib/mcp/tools.ts:762`, but `feedbackBonusPaymentCapAmount` returns the raw bonus amount regardless of asset at `packages/nextjs/lib/mcp/tools.ts:811`. Both public and managed `rateloop_ask_humans` add that value to the quote before checking `maxPaymentAmount` in `packages/nextjs/lib/mcp/tools.ts:3308` and `packages/nextjs/lib/mcp/tools.ts:3617`. The local signer does the same scalar sum in `packages/agents/src/localSigner.ts:773`.

Impact: a valid USDC bounty plus LREP Feedback Bonus can be rejected unless the caller sets a nonsensical USDC cap large enough to cover LREP atomics. It also makes spend caps ambiguous for mixed LREP/USDC wallet-call flows.

Suggested fix: make payment caps asset-aware. A narrow fix is to add a Feedback Bonus to the scalar cap only when it matches the bounty/payment asset; a clearer fix is to introduce per-asset caps and reject mixed-asset requests that only provide the scalar cap. Add MCP and local signer tests for USDC bounty + LREP bonus with a cap equal to the USDC bounty.

### P2 - Keeper hides permanent launch drift 409s as generic Ponder freshness lag

The Ponder launch route returns explicit 409 drift reasons such as `launch_identity_ban_drift` in `packages/ponder/src/api/routes/correlation-routes.ts:1156`. The keeper freshness helper throws on non-2xx in `packages/keeper/src/correlation-ponder-freshness.ts:66`, then `fetchPonderJsonOptional` catches all failures and returns `null` at `packages/keeper/src/correlation-ponder-freshness.ts:72`. The caller logs only generic indexing deferral at `packages/keeper/src/correlation-ponder-freshness.ts:234`.

Impact: when manual artifact review is required, the keeper can spin indefinitely as if Ponder were merely lagging, with no operator-visible drift reason.

Suggested fix: preserve non-2xx status and bounded response bodies in the freshness check, and log/metric 409 drift reasons distinctly. Add keeper freshness tests for launch drift 409 responses.

### P2 - Deployment-scoped vote caches are invalidated with old query keys

Recent-vote live queries include `deploymentKey` in `packages/nextjs/hooks/useRecentUserVotes.ts:33`, but `invalidateRecentUserVotes` omits it in `packages/nextjs/hooks/useRecentUserVotes.ts:20`. Vote-history live queries include `deploymentKey` in `packages/nextjs/hooks/useVoteHistoryQuery.ts:182`, but `getVoteHistoryQueryKey` omits it in `packages/nextjs/hooks/useVoteHistoryQuery.ts:25`. The old helpers are still used after vote/reveal in `packages/nextjs/hooks/useRoundVote.ts:770` and `packages/nextjs/hooks/useManualRevealVotes.ts:547`.

Impact: after voting or revealing, UI state keyed by deployment can stay stale until interval refetch because invalidation targets a key that no longer matches the live query.

Suggested fix: pass `deploymentKey` through the invalidation helpers, or invalidate with a predicate/prefix that matches all deployment keys for the wallet and chain. Update query-key tests to cover the deployment-keyed shape.

### P2 - Some Ponder-backed wallet/vote state remains deployment-unscoped

`useVotingStakes` keys by chain and address only and calls `ponderApi.getVotingStakes` without an expected deployment in `packages/nextjs/hooks/useVotingStakes.ts:35`; the client method at `packages/nextjs/services/ponder/client.ts:1885` has no deployment options. `useVoterStreak` has no chain/deployment key in `packages/nextjs/hooks/useVoterStreak.ts:24`, and its Ponder method at `packages/nextjs/services/ponder/client.ts:2140` is also unscoped.

Impact: in multi-target or stale-Ponder setups, these hooks can show voting stake/streak data for the wrong deployment while newer feed/vote hooks correctly guard against deployment mismatches.

Suggested fix: mirror the recent-votes pattern: resolve `resolveProtocolDeploymentScope(targetNetwork.id)`, include chain and deployment key in query keys, and pass expected deployment into the Ponder client methods. Add a mismatch test proving stake/streak fall back empty when Ponder serves the wrong deployment.

### P2 - Bare Base Sepolia readiness fails locally unless a hidden env var is set

`package.json:75` exposes `yarn base-sepolia:check` as `node scripts/check-base-sepolia-readiness.mjs`. The script only reads the Next.js staging env from `BASE_SEPOLIA_NEXT_ENV_FILE` in `scripts/check-base-sepolia-readiness.mjs:76`, and the PR checklist tells contributors to run the bare command in `.github/pull_request_template.md:17`. CI wires the fixture explicitly in `.github/workflows/base-sepolia-readiness.yaml:28`.

Impact: local PR checklist validation false-fails even though CI has the committed fixture. I reproduced this: `node scripts/check-base-sepolia-readiness.mjs --json` fails on the missing env source, while `BASE_SEPOLIA_NEXT_ENV_FILE=docs/testing/base-sepolia-next-env.fixture node scripts/check-base-sepolia-readiness.mjs --json` passes.

Suggested fix: default the script to `docs/testing/base-sepolia-next-env.fixture` when the env var is unset, or set the env var directly in the package script and docs. Keep a negative test for an explicitly bad staging env file.

## P3 Findings

### P3 - Feedback counts API is narrower than the feedback list API

`listContentFeedback` merges protocol-indexed Ponder feedback at `packages/nextjs/lib/feedback/contentFeedback.ts:1223`, then reports a merged public count. `listContentFeedbackCounts` only counts local DB rows at `packages/nextjs/lib/feedback/contentFeedback.ts:1276`, and `/api/feedback/counts` returns that directly from `packages/nextjs/app/api/feedback/counts/route.ts:42`.

Impact: API consumers can see lower counts from `/api/feedback/counts` than from `/api/feedback` when feedback exists on-chain/Ponder but not in local storage.

Suggested fix: either merge protocol counts by content ID, or mark the counts endpoint as local-only/deprecated. Add a counts test with Ponder-only feedback rows.

### P3 - Some active operator copy still points production issues toward contract deployment

The durable-production guidance in `packages/foundry/README.md:55` says Base mainnet contract addresses should be preserved by default. Some active operator-facing paths still say to deploy contracts: `packages/keeper/README.md:155` says "For production, deploy contracts, Ponder, Next.js, and the keeper"; `packages/ponder/ponder.config.ts:233` says to run `yarn deploy --network <network>` when a shared artifact is missing; `packages/nextjs/utils/env/public.ts:92` and `packages/nextjs/utils/env/public.ts:100` say `Run yarn deploy` for missing target deployment metadata.

Impact: production artifact/package/env skew on Base mainnet can send operators toward redeployment instead of restoring generated artifacts, updating the contracts package, or running readiness checks against the existing deployment.

Suggested fix: make the messages chain-aware. For Base mainnet, say to restore or refresh shared artifacts for the existing deployment and run `yarn base-mainnet:check`; reserve deploy wording for Base Sepolia or truly new networks.

## Verification Notes

- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` failed on the missing local env fixture, confirming the Base Sepolia readiness finding.
- `BASE_SEPOLIA_NEXT_ENV_FILE=docs/testing/base-sepolia-next-env.fixture node scripts/check-base-sepolia-readiness.mjs --json` passed.
- Focused Next.js node tests could not run in this checkout because the test harness could not resolve built `@rateloop/contracts` CJS exports and `~~/*` aliases. I did not use those failed test runs as evidence for the findings.

## Notes On Non-Findings

- I did not treat LREP quote metadata using 6 decimals as a bug: `LoopReputation` defines `DECIMALS = 6` in `packages/foundry/contracts/LoopReputation.sol:18`.
- I did not find a current Base Sepolia one-shot Feedback Bonus bypass in the agent/browser-signing path.
- Older follow-up findings around public-rating artifact verification, correlation candidate pagination across domains, keeper/Ponder deployment identity checks, browser signing bounty asset labels, and contract README chain examples appear fixed in this tree.

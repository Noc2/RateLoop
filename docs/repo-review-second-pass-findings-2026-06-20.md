# RateLoop Repo Second-pass Findings - 2026-06-20

## Scope

- Branch reviewed: `main`.
- Review mode: read-only local review plus three focused explorer agents across app/API, keeper/Ponder/tooling, and deployment/docs.
- Repository change from this pass: this findings document only.
- Production posture: Base mainnet contracts are treated as deployed production infrastructure. The suggested repairs below avoid routine production contract redeploys and focus on app, Ponder, keeper, readiness tooling, and documentation.

## Verification

Passed:

- `yarn workspace @rateloop/keeper test src/__tests__/correlation-artifact-builder.test.ts`: 17 tests passed.
- `yarn workspace @rateloop/node-utils test`: 38 tests passed.
- `node scripts/check-base-mainnet-readiness.mjs --json`: passed.

Failed:

- `yarn workspace @rateloop/ponder test`: 33 test files passed, 1 failed; 357 tests passed, 1 skipped, 1 failed.
- `node scripts/check-base-sepolia-readiness.mjs --json`: failed only on the Base Sepolia Next.js env-source checks:
  - `Base Sepolia Next.js env source is configured via BASE_SEPOLIA_NEXT_ENV_FILE`
  - `Next.js staging env targets Base Sepolia`

Not run: full root test gate, Foundry suite, browser/e2e, or live RPC probes.

## Findings

### P1 - Automatic correlation artifacts can reuse stale cached roots

Fix scope: keeper/off-chain only. No contract redeploy.

Evidence:

- `packages/keeper/src/correlation-artifact-builder.ts:371-407` builds `correlationSnapshotCandidateFingerprint` from chain ID, oracle address, default scoring parameters, and each candidate's `{ domain, rewardPoolId, contentId, roundId }`.
- `packages/keeper/src/correlation-snapshots.ts:1005-1027` uses that fingerprint for rejected-candidate suppression and cache lookup.
- `packages/keeper/src/correlation-snapshots.ts:1036-1067` restores cached canonical JSON and skips rebuilding from current Ponder vote pages when a cached artifact exists.
- The inputs that affect the produced root include dynamic state outside the candidate list. For example, `packages/ponder/src/api/routes/correlation-routes.ts:117-124` loads active ban state, and `packages/ponder/src/api/routes/correlation-routes.ts:996-1005` reads the current launch reward policy.

Impact:

If active bans, launch policy, credentials, route logic, excluded votes, or vote-page contents change while the candidate set remains the same, the keeper can reuse a previously cached artifact and propose stale roots. The rejected-root suppression has the same shape: it can skip a rebuild for a candidate fingerprint even when the rebuilt artifact root would differ.

Fix direction:

Key cache and suppression by an input fingerprint derived from the actual fetched vote pages, excluded votes, round context, and policy/ban version data, or re-fetch and recompute before using cached artifacts. Rejected suppression should be artifact-root aware rather than candidate-list-only.

### P1 - Ponder launch reward policy indexing writes `NaN` and breaks the package test suite

Fix scope: Ponder/test/schema only. No contract redeploy.

Evidence:

- `packages/ponder/src/LaunchDistributionPool.ts:163-165` and `:178-180` coerce `policy.minAnchorCredentialAgeSeconds` with `Number(...)` on insert and update.
- `packages/ponder/tests/launch-distribution-pool-handlers.test.ts:232-237` still has a policy event fixture without `minAnchorCredentialAgeSeconds`.
- `packages/ponder/ponder.schema.ts:1002` stores the field as `t.integer().notNull()`.
- `yarn workspace @rateloop/ponder test` fails in `tests/launch-distribution-pool-handlers.test.ts` because the recorded `launchRewardPolicyState` contains `minAnchorCredentialAgeSeconds: NaN`.

Impact:

The Ponder package is currently red on `main`, and the handler can persist an invalid numeric value if an event fixture, older replay shape, or mocked event omits the new field. Because the schema column is non-null, this is also a migration/backfill risk for existing Ponder databases unless the deployment path is known to rebuild from scratch or provide a safe default.

Fix direction:

Add a single normalization helper for launch policy fields. It should reject invalid event data or fall back to the protocol default intentionally, not by `Number(undefined)`. Update the test fixture to include and assert `minAnchorCredentialAgeSeconds`. Decide whether the Ponder schema needs a nullable/backfill-safe migration path or a documented reindex requirement for existing deployments.

### P2 - Base Sepolia readiness CI fails before it can validate staging

Fix scope: GitHub Actions/tooling/docs only. No contract redeploy.

Evidence:

- `.github/workflows/base-sepolia-readiness.yaml:26-29` sets `BASE_SEPOLIA_APP_URL`, `BASE_SEPOLIA_PONDER_URL`, and `BASE_SEPOLIA_RPC_URL`, but not `BASE_SEPOLIA_NEXT_ENV_FILE`.
- `.github/workflows/base-sepolia-readiness.yaml:42-43` runs `node scripts/check-base-sepolia-readiness.mjs`.
- `scripts/check-base-sepolia-readiness.mjs:71-78` loads `appEnvSource` from `BASE_SEPOLIA_NEXT_ENV_FILE`.
- `scripts/check-base-sepolia-readiness.mjs:88-91` requires that env source to be configured.
- Local `node scripts/check-base-sepolia-readiness.mjs --json` failed on the env source and `NEXT_PUBLIC_TARGET_NETWORKS=84532` checks. Local `node scripts/check-base-mainnet-readiness.mjs --json` passed.

Impact:

Push, PR, or scheduled Base Sepolia readiness checks can fail even when the deployment artifact and generated contract artifacts are consistent.

Fix direction:

Set `BASE_SEPOLIA_NEXT_ENV_FILE` in the workflow, likely to a committed staging env fixture or a generated temp env file containing `NEXT_PUBLIC_TARGET_NETWORKS=84532`. Document the required staging env source in `docs/env-parity.md`.

### P2 - Launch-credit vote pagination reports normal next-page state as truncation

Fix scope: Ponder/keeper only. No contract redeploy.

Evidence:

- `packages/ponder/src/api/routes/correlation-routes.ts:1103-1106` slices eligible launch credits in memory after loading all matching rows.
- `packages/ponder/src/api/routes/correlation-routes.ts:1109` sets `truncated = eligibleSeen > offset + items.length`.
- `packages/keeper/src/correlation-artifact-builder.ts:646-654` passes page offsets to Ponder and throws immediately when `response.truncated` is true.

Impact:

A launch-credit round with more than one page of eligible credits can return a valid first page plus `truncated: true`, causing the keeper to abort instead of requesting the next page. Large rounds also make each page load all pending credits and all anchor votes.

Fix direction:

Make `truncated` mean "Ponder could not complete the scan" consistently, not "there is another page". Add DB-level pagination or a stable cursor for launch credits, and let the keeper paginate until the returned page is shorter than the requested limit.

### P2 - Launch-credit artifacts are rebuilt from current state rather than pending-credit state

Fix scope: off-chain artifact/indexing flow first. No production contract redeploy recommended.

Evidence:

- `packages/foundry/contracts/LaunchDistributionPool.sol:844-846` stores `PendingEarnedRaterCredit` with the policy at record time.
- `packages/foundry/contracts/LaunchDistributionPool.sol:704-708` finalizes using the pending policy and stored pending anchor IDs.
- `packages/ponder/src/api/routes/correlation-routes.ts:996-1005` reads only the current indexed launch policy.
- `packages/ponder/src/api/routes/correlation-routes.ts:1083-1098` recomputes anchor features from current indexed vote, credential, and ban state.

Impact:

If policy, bans, credentials, or anchor reservations change after a credit is staged as pending, the automatic Ponder/keeper artifact path can exclude a still-finalizable credit or compute a different launch-credit feature set than the pending-credit state implies.

Fix direction:

Index enough pending-time state to reproduce launch artifacts, or fail closed for automatic launch-credit snapshots when pending credits predate the policy/anchor state Ponder can prove. For current deployments, prefer an operator/file artifact path over silently recomputing from drift-prone current state.

### P2 - Feedback APIs mix requested chain writes with default-scope Ponder reads

Fix scope: app/API and Ponder client only. No contract redeploy.

Evidence:

- `packages/nextjs/app/api/feedback/challenge/route.ts:55-64` validates `chainId`, resolves a deployment for that chain, and passes the chain into feedback round-context resolution.
- `packages/nextjs/lib/feedback/contentFeedback.ts:466-469` ignores that deployment scope for indexed reads and calls `ponderApi.getContentById(contentId)` and `ponderApi.getAllRounds({ contentId })`.
- `packages/nextjs/lib/feedback/contentFeedback.ts:900-903`, `:974-979`, and `:1013-1017` fetch feedback, active bonus pools, and awards without deployment options.

Impact:

In multi-target or staging setups, the API can validate/write against one chain while reading round, feedback, or Feedback Bonus state from the default Ponder deployment. That can block valid feedback, issue challenges for the wrong round, or show and award against stale pool metadata.

Fix direction:

Extend the relevant Ponder client methods with deployment options. Pass the resolved `chainId` and deployment key from feedback routes and fail closed on deployment mismatch.

### P2 - Vote and reward hooks cache by active chain but fetch unscoped Ponder data

Fix scope: app/Ponder client only. No contract redeploy.

Evidence:

- `packages/nextjs/hooks/useRecentUserVotes.ts:31-35` includes `targetNetwork.id` in the query key but fetches `ponderApi.getAllVotes({ voter })` without deployment scope.
- `packages/nextjs/hooks/useVoteHistoryQuery.ts:180-206` has the same chain-keyed cache but calls unscoped `getVotesWindow` and `getAllVotes`.
- `packages/nextjs/hooks/useClaimableQuestionRewards.ts:107-128` keys claimable question and bundle reward candidates by `targetNetwork.id` but calls unscoped Ponder candidate APIs.

Impact:

The UI can store default-chain Ponder results under a non-default chain cache key. That can hide valid active-chain votes or claims, display stale candidates that disappear during target-chain RPC reads, and make vote history or cooldowns inconsistent.

Fix direction:

Add deployment options to votes, cooldowns, and reward-candidate Ponder methods. Resolve the active target's deployment key in these hooks, pass it into the request and query key, and fail closed when the configured Ponder endpoint cannot prove the requested deployment.

### P2 - Production deploy wrapper exposes Base mainnet redeploy as a normal path

Fix scope: deploy tooling/docs only. No contract redeploy.

Evidence:

- `packages/foundry/scripts-js/deployArgs.js:8-10` lists `yarn deploy --network base --keystore my-account` as a normal example.
- `packages/foundry/scripts-js/deployArgs.js:14-18` allows `base`, and `:28` classifies it as a production deploy network.
- `packages/foundry/scripts-js/parseArgs.js:143-146` blocks only the default keystore on live networks.
- `packages/foundry/scripts-js/parseArgs.js:237-241` then invokes `make deploy-and-generate-abis`.
- `packages/foundry/Makefile:31-35` broadcasts for non-local RPC URLs.
- `packages/foundry/README.md:55-56` says Base mainnet is the current production boundary and addresses should be preserved by default.

Impact:

An operator can accidentally deploy and export a fresh production stack, creating off-chain artifact drift against the durable deployed Base mainnet stack.

Fix direction:

Add a break-glass confirmation for production redeploys, such as `--confirm-production-redeploy` or `RATELOOP_CONFIRM_PRODUCTION_REDEPLOY=8453:<current-block>`. Move mainnet deploy examples out of ordinary help and into an incident/governance runbook.

### P3 - Explicit Ponder deployment checks bypass the browser proxy and shared cache

Fix scope: app/Ponder client only. No contract redeploy.

Evidence:

- `packages/nextjs/services/ponder/client.ts:409-421` calls `checkPonderAvailabilityDirect` whenever an explicit deployment key is present.
- `packages/nextjs/services/ponder/client.ts:424-430` only uses the shared cached availability path after that explicit-key branch.
- `packages/nextjs/services/ponder/client.ts:561-566` repeats deployment availability checks before every `ponderGet`.

Impact:

New chain-safe callers can perform repeated `/health` and `/deployment` probes and, in the browser, bypass the Next proxy/cached path. This is mainly a reliability and performance regression, but it can also produce inconsistent availability behavior when browser direct preflight differs from server-side preflight.

Fix direction:

Cache availability by expected deployment key, add deployment-key support to the `/api/ponder/availability` proxy path, and make browser checks use the proxy consistently.

### P3 - Historical docs still read like pre-mainnet instructions

Fix scope: docs only. No contract redeploy.

Evidence:

- `docs/protocol-design-review-2026-06.md:48-49` says Base mainnet readiness is expected to fail until the first `8453` artifact exists.
- `docs/protocol-design-review-2026-06.md:604-632` describes Base mainnet start blocks and the engine-rotation runbook as future pre-mainnet work.
- `packages/foundry/deployments/8453.json:32-35` now contains a production Base mainnet deployment artifact.
- `packages/foundry/README.md:50` still says to monitor `SettlementSideEffectFailed` "before mainnet launch", while `:55-56` identifies Base mainnet as the current production boundary.

Impact:

Operators may treat stale launch-gate docs as current, expect wrong readiness behavior, or mentally bucket production alerts as launch prep instead of ongoing operations.

Fix direction:

Mark historical review/plan docs as snapshots at the top and point current operators to `packages/foundry/README.md`, `docs/env-parity.md`, and the Base readiness scripts. Reword the settlement side-effect note as a standing production alert/runbook requirement.

## Suggested fix order

1. Fix the correlation artifact cache/suppression keying first because it can reuse stale payout roots without touching contracts.
2. Fix the Ponder launch reward policy `NaN` regression and decide the migration/backfill posture, because the Ponder package is currently red.
3. Patch Base Sepolia readiness CI so staging checks become useful again.
4. Normalize launch-credit pagination semantics, then revisit pending-time launch-credit artifact inputs.
5. Extend deployment scoping across feedback, vote history, and reward-candidate Ponder reads.
6. Add production redeploy break-glass tooling and clean up stale docs/copy.

# Non-Contract Current-Head Review - Latest Pass - 2026-07-03

Reviewed head: `4d8d27e8861317ae3ab1cecad44d156261fe8103` on `main`.

Scope: non-Solidity application code, Next.js app/API/client surfaces, public docs, Ponder APIs, keeper runtime/config/deploy metadata, agents, SDK-facing examples, scripts, package metadata, env references, tests, and CI/config. Smart contracts, Solidity implementation review, Foundry Solidity tests, and generated contract metadata were excluded. Public documentation that mentions contracts was reviewed only for documentation consistency, not as a smart-contract audit.

The local branch matched `origin/main` before this report was written, and the worktree was clean before this report file was added.

Four read-only agents checked separate non-contract slices in parallel:

- Next.js app/API/hooks/db/auth/agent/feedback surfaces: no actionable findings.
- Agents, SDK, MCP examples, and CLI flows: 2 actionable findings.
- Ponder, keeper, backend/indexer/runtime surfaces: 4 actionable findings.
- Repo tooling, docs, package/workspace config, CI/deploy metadata: 5 actionable findings.

## Verification

- `yarn dead-code` - passed.
- `yarn workspace @rateloop/nextjs check-types` - passed.
- `yarn workspace @rateloop/ponder check-types` - passed.
- `yarn workspace @rateloop/keeper check-types` - passed.
- `yarn workspace @rateloop/agents check-types` - passed.
- `yarn workspace @rateloop/sdk check-types` - passed.
- `yarn workspace @rateloop/agents lint:questions` - passed for all bundled question examples.
- `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs scripts/readiness-workflows.test.mjs scripts/check-base-mainnet-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 83 passed.
- From `packages/nextjs`: `node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts app/api/mcp/route.test.ts lib/feedback/contentFeedback.test.ts lib/feedback/postconditions.test.ts hooks/useClaimableQuestionRewards.test.ts` - 126 passed.

## Summary

No critical issues were found. One high-severity non-contract issue remains because it can make normal standalone content disappear from keeper-discovered liveness work. Five medium issues can block or degrade production operations, rating preparation, artifact application, privacy redaction, or cleanup automation. Six low issues are documentation/config consistency gaps.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-LATEST-2026-07-03-1 | High | Open | Standalone content is filtered out of Ponder keeper work when `bundleId` is null. |
| NC-LATEST-2026-07-03-2 | Medium | Open | MCP rating parsers can silently coerce unsafe numeric IDs before wallet-call preparation. |
| NC-LATEST-2026-07-03-3 | Medium | Open | Bad public artifact URIs can abort keeper snapshot application instead of being skipped. |
| NC-LATEST-2026-07-03-4 | Medium | Open | Ponder hosted-attachment URL handling is narrower than Next.js producers/parsers. |
| NC-LATEST-2026-07-03-5 | Medium | Open | Repo-managed attachment cleanup jobs are documented but not scheduled. |
| NC-LATEST-2026-07-03-6 | Medium | Open | Keeper Railway deploy metadata misses the liveness healthcheck. |
| NC-LATEST-2026-07-03-7 | Low | Open | Gemini MCP examples are inconsistent and omit the protocol-version header. |
| NC-LATEST-2026-07-03-8 | Low | Open | Keeper deployment verification cache is documented but never read. |
| NC-LATEST-2026-07-03-9 | Low | Open | Keeper Railway rebuild triggers omit a shared build script it executes. |
| NC-LATEST-2026-07-03-10 | Low | Open | Ponder deploy health and release-readiness guidance use different signals. |
| NC-LATEST-2026-07-03-11 | Low | Open | Agents public install docs overstate Node compatibility. |
| NC-LATEST-2026-07-03-12 | Low | Open | One public how-it-works paragraph still says "USDC claim weights" for generic bounty claims. |

## Findings

### NC-LATEST-2026-07-03-1 - Standalone content is filtered out of Ponder keeper work

Standalone `ContentSubmitted` rows leave `content.bundleId` null unless a bundle link exists. The `/keeper/work` proactive-open and dormant-content queries require `content.bundleId = 0`, but SQL `NULL = 0` is false.

Impact: normal unbundled content can disappear from proactive `openRound` discovery and dormant-content discovery. That can hurt liveness for the default question path without changing any contract behavior.

Evidence:

- `packages/ponder/ponder.schema.ts:75` declares `content.bundleId` as nullable.
- `packages/ponder/src/ContentRegistry.ts:323` only sets `bundleId`/`bundleIndex` when `bundleQuestion` exists.
- `packages/ponder/src/api/routes/keeper-routes.ts:146` filters proactive-open candidates with `content.bundleId = 0`.
- `packages/ponder/src/api/routes/keeper-routes.ts:194` applies the same filter to dormant-content discovery.

Suggested fix:

1. Treat unbundled content as `bundleId is null OR bundleId = 0` in `/keeper/work`, or normalize standalone content rows to `0` consistently at ingestion.
2. Add route tests for proactive-open and dormant discovery where `bundleId` is null.

### NC-LATEST-2026-07-03-2 - MCP rating parsers can silently coerce unsafe numeric IDs

The SDK rating request types allow `string | number | bigint` for values such as `contentId`, `roundId`, `stakeWei`, and `targetRound`. The MCP parser accepts `number` values by stringifying them before `BigInt`, so an already-rounded JavaScript number can pass validation as the wrong integer. `chainId` and `roundReferenceRatingBps` also use `Number(value)`, accepting loose forms such as `8453.0` or scientific notation.

Impact: a schema-driven MCP client passing JS numbers for large content or round IDs can prepare transactions for the wrong content/round instead of failing closed.

Evidence:

- `packages/sdk/src/agent.ts:207` through `:214` permits `number` for rating lookup and stake fields.
- `packages/nextjs/lib/mcp/tools.ts:1308` through `:1314` parses `chainId` with `Number(value)`.
- `packages/nextjs/lib/mcp/tools.ts:1338` through `:1353` stringifies `number` inputs before `BigInt`.
- `packages/nextjs/lib/mcp/tools.ts:1356` through `:1361` parses rating BPS with `Number(value)`.

Suggested fix:

1. Require safe integers for `number` inputs and exact unsigned base-10 integer strings for string inputs.
2. Reject decimal, signed, scientific, unsafe, and non-finite values before preparing rating wallet calls.
3. Mirror the SDK's existing safe integer guard style for rating helpers and add MCP parser regressions.

### NC-LATEST-2026-07-03-3 - Bad public artifact URIs can abort snapshot application

`readPublicCorrelationArtifact` awaits `readArtifactCanonicalJson` outside a try/catch. Malformed percent-encoded data URIs can throw inside `decodeURIComponent`, and network fetch can reject before the existing response-body catch runs. The callers appear to expect a null result and skip behavior.

Impact: one unavailable or malformed finalized artifact can fail the whole keeper correlation tick and block other rating/RBTS snapshot applications in that tick.

Evidence:

- `packages/keeper/src/correlation-snapshots.ts:617` awaits `readArtifactCanonicalJson` before any error handling in `readPublicCorrelationArtifact`.
- `packages/keeper/src/correlation-snapshots.ts:648` can throw for malformed percent-encoded data URI payloads.
- `packages/keeper/src/correlation-snapshots.ts:664` can throw on fetch rejection/timeout.
- `packages/keeper/src/correlation-snapshots.ts:877` and `:989` expect unreadable artifacts to become `null` and be skipped with a warning.

Suggested fix:

1. Wrap canonical artifact decode/fetch failures and return `null` while incrementing the existing artifact failure counter.
2. Add keeper tests for malformed non-base64 data URIs and fetch rejection.

### NC-LATEST-2026-07-03-4 - Ponder hosted-attachment URL handling is narrower than producers/parsers

Next.js can produce hosted attachment URLs under an app base path, and the shared frontend parser accepts optional path prefixes. Ponder redaction and fallback media detection only match root `/api/attachments/...` URLs.

Impact: prefixed hosted attachment URLs can remain in `url`/`canonicalUrl` for gated undisclosed content, and public prefixed image URLs may not render as fallback media.

Evidence:

- `packages/nextjs/lib/attachments/imageAttachmentUrls.ts:4` accepts optional path prefixes before `/api/attachments/images/...`.
- `packages/nextjs/lib/attachments/imageAttachments.test.ts:88` through `:90` expects `/rateloop/api/attachments/images/...` URLs to be produced.
- `packages/ponder/src/api/confidentiality-redaction.ts:20` only matches root `/api/attachments/...`.
- `packages/ponder/src/api/routes/content-routes.ts:879` through `:880` only matches root `/api/attachments/images/...`.

Suggested fix:

1. Reuse the shared attachment URL parser shape in Ponder or allow an optional path prefix in both Ponder patterns.
2. Add Ponder redaction and fallback-media tests with `/rateloop/api/attachments/...` URLs.

### NC-LATEST-2026-07-03-5 - Repo-managed cleanup jobs are documented but not scheduled

The Next.js README documents image and question-details sweep secrets, and the sweep routes are POST-only protected handlers. `packages/nextjs/vercel.json` schedules confidentiality and callback jobs, but it does not schedule these cleanup routes.

Impact: operators can set the documented secrets and deploy the repo-managed Vercel config, while stale unattached images and failed/blocked Details rows are never swept by a repo-managed cron path.

Evidence:

- `packages/nextjs/vercel.json:3` through `:16` schedules confidentiality and agent-callback jobs only.
- `packages/nextjs/README.md:113` through `:114` documents `RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET` and `RATELOOP_QUESTION_DETAILS_SWEEP_SECRET`.
- `packages/nextjs/app/api/attachments/images/sweep/route.ts:27` defines the image sweep as `POST`.
- `packages/nextjs/app/api/attachments/details/sweep/route.ts:22` defines the Details sweep as `POST`.

Suggested fix:

1. Add scheduled cron wrappers or route entries for the two sweeps, with the right secret source.
2. If an external scheduler is required instead, state that explicitly beside the env vars and deployment checklist.

### NC-LATEST-2026-07-03-6 - Keeper Railway deploy metadata misses the liveness healthcheck

The keeper Docker image and README define `/live` as the liveness endpoint, but `packages/keeper/railway.toml` does not configure a Railway `healthcheckPath`.

Impact: Railway deploys can be treated as healthy on process start without using the keeper's own liveness endpoint, making metrics/server startup failures less likely to block rollout.

Evidence:

- `packages/keeper/railway.toml:17` through `:18` sets only `startCommand`.
- `packages/keeper/Dockerfile:53` through `:54` probes `/live`.
- `packages/keeper/README.md:104` through `:106` documents `/live` and `/health`.

Suggested fix:

1. Add `healthcheckPath = "/live"` and an appropriate timeout to keeper Railway deploy metadata.
2. Keep `/health` for readiness/diagnostic checks, not platform liveness.

### NC-LATEST-2026-07-03-7 - Gemini MCP examples are inconsistent

The Gemini CLI markdown example shows a placeholder `https://rateloop.example/api/mcp`, while the adjacent checked-in JSON uses production `https://www.rateloop.ai/api/mcp`. The JSON also omits `MCP-Protocol-Version`, which the server requires after initialization for post-initialize MCP methods.

Impact: users copying the markdown hit a dead origin, while users copying the JSON can hit missing-version errors depending on Gemini's transport behavior.

Evidence:

- `packages/agents/examples/gemini-cli.md:13` uses `https://rateloop.example/api/mcp`.
- `packages/agents/examples/gemini-cli.mcpServers.json:4` uses `https://www.rateloop.ai/api/mcp`.
- `packages/agents/examples/gemini-cli.mcpServers.json:6` through `:9` omits `MCP-Protocol-Version`.
- MCP route tests verify post-initialize methods reject missing `MCP-Protocol-Version`.

Suggested fix:

1. Align the markdown and JSON on production URL, or clearly label the placeholder as replace-before-use.
2. Add `"MCP-Protocol-Version": "2025-11-25"` unless Gemini reliably injects it.

### NC-LATEST-2026-07-03-8 - Keeper deployment verification cache is documented but never read

The keeper declares and writes `verifiedPonderDeploymentCacheKey`, and the README says successful `/deployment` verification is cached for the process lifetime. The assertion function still fetches `/deployment` on every call and never checks the cached key before fetching.

Impact: operators are told there is cache behavior that does not exist. Transient `/deployment` failures can stop production ticks even after a prior successful verification.

Evidence:

- `packages/keeper/src/keeper.ts:171` declares `verifiedPonderDeploymentCacheKey`.
- `packages/keeper/src/keeper.ts:664` through `:716` always fetches `/deployment`, then assigns the cache key.
- `packages/keeper/src/keeper.ts:757` and `:1152` call this assertion before keeper work and ciphertext fetches.
- `packages/keeper/README.md` documents process-lifetime deployment verification caching.

Suggested fix:

1. Either return early when the computed expected cache key matches the verified key, or remove the variable/docs and make fail-closed per-request verification explicit.
2. Add a keeper test for the chosen behavior.

### NC-LATEST-2026-07-03-9 - Keeper Railway rebuild triggers omit a shared build script

Keeper's build path runs `../../scripts/with-workspace-dist-lock.mjs`, but the keeper Railway watch patterns omit that script. Ponder includes it in its watch list.

Impact: a fix to the shared workspace-dist lock wrapper can affect Keeper builds without triggering a Keeper Railway redeploy when that script is the only changed file.

Evidence:

- `packages/keeper/package.json:7` runs `node ../../scripts/with-workspace-dist-lock.mjs`.
- `packages/keeper/railway.toml:4` through `:15` omits `scripts/with-workspace-dist-lock.mjs`.
- `packages/ponder/railway.toml:9` through `:12` includes the same script.

Suggested fix:

1. Add `scripts/with-workspace-dist-lock.mjs` to keeper Railway watch patterns.
2. Consider a small config test that important shared build scripts are included for each Railway service that executes them.

### NC-LATEST-2026-07-03-10 - Ponder deploy health and readiness guidance use different signals

Railway checks Ponder's native `/health`, while the docs and readiness tooling treat `/health/indexer` as the richer release-readiness signal. The custom route can return JSON status `degraded` or `attention`, and readiness fails `degraded` separately.

Impact: platform health and release readiness can disagree. That may be intentional, but current docs do not make the distinction explicit.

Evidence:

- `packages/ponder/railway.toml:20` sets `healthcheckPath = "/health"`.
- `packages/ponder/README.md:128` says custom indexer health is `GET /health/indexer`.
- `packages/ponder/src/api/index.ts:187` through `:190` computes a `degraded` status.
- `scripts/readiness-core.mjs:1588` through `:1598` parses `/health/indexer` and fails anything except `ok`/`attention`.

Suggested fix:

1. Document `/health` as process/liveness only and `/health/indexer` as release readiness, or add a deployment-ready endpoint with HTTP failure semantics and configure the platform to use it.

### NC-LATEST-2026-07-03-11 - Agents public install docs overstate Node compatibility

The agents README says the package works in "any Node runtime", but the package itself requires Node `>=24 <25`, matching the repo prerequisite.

Impact: npm consumers on Node 20, 22, or 26 can follow the quickstart and hit engine/runtime failures.

Evidence:

- `packages/agents/README.md:38` says "any Node runtime".
- `packages/agents/package.json:133` through `:135` requires `node >=24 <25`.
- `README.md:94` lists Node.js 24.x as the repo prerequisite.

Suggested fix:

1. Replace "any Node runtime" with "a Node 24 runtime" in the published package quickstart.

### NC-LATEST-2026-07-03-12 - One public how-it-works paragraph still says "USDC claim weights"

Most current docs now say LREP or USDC bounty claims use finalized payout snapshots. One how-it-works paragraph still says "USDC claim weights" in a generic bounty explanation.

Impact: users can infer that only USDC bounty claims use snapshot weights, even though current bounty docs describe LREP or USDC.

Evidence:

- `packages/nextjs/app/(public)/docs/how-it-works/page.tsx:188` through `:190` says "USDC claim weights".
- `README.md:32` and `README.md:44` describe LREP or USDC bounty payouts through correlation snapshots.

Suggested fix:

1. Reword the paragraph to "LREP or USDC claim weights" or "bounty claim weights".
2. Extend public-copy drift coverage to catch this specific wording.

## Rechecked Prior Candidates Not Carried Forward

The following prior report candidates were rechecked against current head and appear fixed or intentionally clarified:

- Ponder viewer reward status now counts payout-root waits without filtering out LREP asset `0`.
- Browser-handoff quickstart now warns that the bundled Base Sepolia payload needs a staging origin or Base mainnet payload before production handoff.
- The treasury grant warning now reads the ProtocolConfig treasury source.
- `/api/agent/policies/recent` uses the shared strict query number parser.
- Public handoff `ttlMs` parsing rejects malformed values and has route coverage.
- `agents:lint` now validates both bounty and Feedback Bonus reward assets.
- Keeper Base mainnet runbook now references owner-directed fresh deployment artifacts.
- Historical design/use-case docs now mark delayed-blockhash and gated-AI constraints as superseded or snapshot-time context.

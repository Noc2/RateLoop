# Non-Contract Current-Worktree Review - 2026-07-03

Reviewed head: `39b96430bd38ad4db727e873289237d690953290` on `main`.

Scope: non-Solidity application code, Next.js app/API/client surfaces, Ponder and keeper runtime/config, agents, SDK-facing examples, public docs, node-utils, repo scripts, tests, package metadata, and CI/deploy config. Smart contracts, Solidity implementation review, Foundry Solidity tests, and generated contract metadata were excluded. Contract-facing public documentation was reviewed only for consistency with the non-contract app/operator surfaces.

The local branch matched `origin/main` before this report was written. The checkout already contained unrelated dirty files before the review started, including smart-contract changes and in-progress docs/frontend/keeper changes. Those files were treated as current local context for the review but were not staged by this report commit.

Three read-only agents reviewed separate non-contract slices in parallel:

- Next.js app/API/client, browser handoff, cron, and route surfaces.
- Ponder, keeper, backend/runtime, readiness, deployment metadata, and migrations.
- Agents package, SDK-facing examples, CLI/lint flows, node-utils, and public docs.

## Verification

- `yarn dead-code` - passed with no output.
- `yarn workspace @rateloop/keeper check-types` - passed.
- `yarn workspace @rateloop/nextjs check-types` - passed.
- From `packages/nextjs`: `node ../../scripts/run-node-tests.mjs hooks/useAllClaimableRewards.test.ts hooks/useClaimableQuestionRewards.test.ts` - 10 passed.
- `yarn workspace @rateloop/keeper test -- src/__tests__/frontend-fees.test.ts` - Vitest ran the keeper suite; 38 files passed, 563 tests passed, 2 skipped.

Not run: Foundry/Solidity checks, full workspace test matrix, Playwright/browser E2E, and live deployment probes.

## Summary

No critical or high-severity non-contract issues were found. Four medium-severity issues remain because they can make production/staging boundaries, scheduled processing, or agent ask preparation fail in confusing ways. Five low-severity issues are legacy workflow, parser, and documentation consistency gaps.

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| NC-CW-2026-07-03-1 | Medium | Open | Legacy World Chain is still accepted as a production app target. |
| NC-CW-2026-07-03-2 | Medium | Open | Agent callback lifecycle sweep can fail open on malformed production target chains. |
| NC-CW-2026-07-03-3 | Medium | Open | Agent local authoring validation misses live spend/chain fields and `quote` bypasses lint. |
| NC-CW-2026-07-03-4 | Medium | Open | Agent examples still pair production/default origins with Base Sepolia asks in copyable paths. |
| NC-CW-2026-07-03-5 | Low | Open | Some authenticated maintenance endpoints partially parse malformed numeric limits. |
| NC-CW-2026-07-03-6 | Low | Open | Public voter-floor copy says USDC while validation is asset-neutral by amount. |
| NC-CW-2026-07-03-7 | Low | Open | SDK MCP URL derivation contradicts its README warning about Ponder URLs. |
| NC-CW-2026-07-03-8 | Low | Open | Node-utils rater type parsing accepts non-canonical numeric strings. |
| NC-CW-2026-07-03-9 | Low | Open | Legacy World Chain Sepolia live readiness workflow is structurally unwired. |

## Findings

### NC-CW-2026-07-03-1 - Legacy World Chain is still accepted as a production app target

The app target-network resolver still includes World Chain mainnet and World Chain Sepolia in `AVAILABLE_TARGET_NETWORKS`, and production resolution rejects only the local Foundry chain. The target-network test explicitly asserts that World Chain mainnet is an available production target. This conflicts with the current repo-level deployment boundary, where Base mainnet is production, Base Sepolia is staging, and World Chain is legacy.

Impact: a redeployed production app can still boot with a legacy World Chain target if `NEXT_PUBLIC_TARGET_NETWORKS=480` is supplied. That creates a stale production surface for deployments the current protocol no longer intends to use.

Evidence:

- `packages/nextjs/utils/env/targetNetworks.ts:8` and `:9` include `worldchain` and `worldchainSepolia`.
- `packages/nextjs/utils/env/targetNetworks.ts:60` through `:61` only reject Foundry in production.
- `packages/nextjs/utils/env/targetNetworks.test.ts:16` through `:21` asserts World Chain mainnet is production-available.
- `README.md:9` through `:10` and `docs/env-parity.md:9` through `:14` describe Base as the active production/staging boundary and World Chain as legacy.

Suggested fix:

1. Remove World Chain from production-resolvable app targets, or gate it behind an explicit legacy override that cannot be enabled accidentally.
2. Update the target-network tests and Next.js docs to make Base mainnet/Base Sepolia the default live app boundary.
3. Keep historical World Chain deployment artifacts readable without advertising them as active production targets.

### NC-CW-2026-07-03-2 - Agent callback lifecycle sweep can fail open on malformed production target chains

The lifecycle sweep reparses `NEXT_PUBLIC_TARGET_NETWORKS` with `Number.parseInt`. Values such as `8453abc` become `8453`, and an all-invalid production value returns `null`, which removes the SQL chain filter entirely. The scheduled sweep then processes all submitted managed/public lifecycle candidates instead of failing closed.

Impact: malformed production chain configuration can widen callback lifecycle processing to legacy or unintended chains. This is especially risky while retiring old deployments because a bad allowlist should stop the job, not remove the allowlist.

Evidence:

- `packages/nextjs/lib/agent-callbacks/lifecycle.ts:75` through `:84` uses `Number.parseInt` and returns `null` when no valid target remains.
- `packages/nextjs/lib/agent-callbacks/lifecycle.ts:147` through `:153` applies chain SQL filters only when the normalized target chain list is non-null.
- `packages/nextjs/vercel.json:21` through `:22` schedules the callback sweep route.
- `packages/nextjs/utils/env/targetNetworks.ts:23` through `:37` already has a stricter target-chain parser.

Suggested fix:

1. Reuse the strict target-network resolver or equivalent exact decimal parser for lifecycle sweep targets.
2. In production, fail closed when `NEXT_PUBLIC_TARGET_NETWORKS` is malformed or empty instead of returning `null`.
3. Add a lifecycle test for malformed target-network env and all-invalid target-network env.

### NC-CW-2026-07-03-3 - Agent local authoring validation misses live spend/chain fields and `quote` bypasses lint

`agents:lint`, `agents:ask`, and `agents:handoff` validate the core ask payload, but the lint function does not validate top-level `maxPaymentAmount` or `chainId`. The CLI `quote` command reads and submits a payload without running lint at all. Public docs describe `maxPaymentAmount` as a required ask field, and downstream runtime paths validate the same fields later.

Impact: authors can get a clean local lint/handoff authoring loop for a payload that later fails at quote, handoff, local signer, or server validation. This does not create custody risk, but it hurts the preferred non-custodial ask UX.

Evidence:

- `packages/agents/src/cli.ts:408` through `:415` implements `quote` without calling `lintAgentAskRequest`.
- `packages/agents/src/cli.ts:428` and `:452` call lint for `ask`/`sandbox` and `handoff`.
- `packages/agents/src/questions/lint.ts:730` through `:768` validates `clientRequestId`, `bounty`, amount, and voters but not top-level `chainId` or `maxPaymentAmount`.
- `packages/nextjs/public/llms.txt:105` says required ask fields include `maxPaymentAmount`.

Suggested fix:

1. Add strict positive safe-integer validation for top-level `chainId` where live payloads require it.
2. Validate `maxPaymentAmount` as a safe non-negative atomic amount for live, handoff, and local-signer asks.
3. Run `lintAgentAskRequest` before `agents:quote`, while allowing intentionally non-spending sandbox shapes only where documented.

### NC-CW-2026-07-03-4 - Agent examples still pair production/default origins with Base Sepolia asks

Most agents README copy now warns that Base Sepolia examples need a staging origin, but copyable example paths still mix production or default app origins with Base Sepolia. The OpenClaw local signer snippet exports `RATELOOP_API_BASE_URL=https://www.rateloop.ai` together with `RATELOOP_RPC_URL=https://sepolia.base.org` and `RATELOOP_CHAIN_ID=84532`. The TypeScript landing-pitch example defaults to a placeholder origin but hardcodes `chainId = 84532` and can create a browser handoff from that payload.

Impact: users can copy an example that submits a staging-chain ask to the production app host, then see a late rejection or confusing handoff/local-signer failure. This is a UX problem, not a centralization or custody problem.

Evidence:

- `packages/agents/examples/openclaw.md:29` through `:31` pairs the production app origin with Base Sepolia RPC and chain ID.
- `packages/agents/examples/landing-pitch-review.ts:9` defaults to a placeholder app origin, while `:116` hardcodes Base Sepolia and `:141` creates a browser handoff.
- `packages/agents/README.md:57` through `:60` warns that production handoffs need Base mainnet or a staging origin, but not every copyable example carries that guard beside the command.

Suggested fix:

1. Split production/mainnet and staging/testnet snippets so no executable block pairs `https://www.rateloop.ai` with `84532`.
2. Keep local-signer practice on Base Sepolia, but require an explicit staging app origin in that block.
3. Add a docs-copy regression that catches production app URLs near Base Sepolia chain IDs in executable examples.

### NC-CW-2026-07-03-5 - Some authenticated maintenance endpoints partially parse malformed numeric limits

Several protected maintenance routes still parse `limit` or `scanLimit` with `Number.parseInt`, so values such as `10abc` silently become `10`. A strict shared query parser already exists.

Impact: the affected routes are authenticated or scheduled, so the blast radius is limited. The inconsistency still makes operator errors harder to notice and diverges from newer strict route parsing.

Evidence:

- `packages/nextjs/app/api/agent-callbacks/deliver/route.ts:20` through `:21` uses `Number.parseInt`.
- `packages/nextjs/app/api/agent-callbacks/sweep/route.ts:22` through `:23` uses `Number.parseInt`.
- `packages/nextjs/app/api/confidentiality/disclosure/reconcile/route.ts:20` through `:24` uses `Number.parseInt` for `limit` and `scanLimit`.
- `packages/nextjs/app/api/attachments/images/sweep/route.ts:28` through `:29` uses `Number.parseInt`.
- `packages/nextjs/lib/http/queryNumbers.ts:15` exposes `parseStrictPositiveQueryNumber`.

Suggested fix:

1. Switch these route-local parsers to the shared strict helper.
2. Preserve defaults only when the query value is absent or blank.
3. Return `400` for supplied-but-invalid numeric values and add route regressions for `limit=10abc`.

### NC-CW-2026-07-03-6 - Public voter-floor copy says USDC while validation is asset-neutral by amount

Public agent docs describe launch voter floors as `1000 USDC` and `10000 USDC` tiers. The local lint, x402 payload normalization, and Next.js server submission checks apply the floor to the atomic bounty amount without considering the selected bounty asset.

Impact: LREP-funded asks are supported, but the docs make the policy sound USDC-specific. If the intended policy is asset-neutral by amount, the docs should say that. If it is intended to be USDC-equivalent, the validators need asset-aware logic.

Evidence:

- `packages/agents/src/questions/lint.ts:762` applies `requiredQuestionRewardParticipants(amount)` without asset context.
- `packages/agents/src/x402QuestionPayload.ts:881` through `:884` applies the same amount-only floor.
- `packages/nextjs/lib/x402/questionSubmission.ts:1493` through `:1498` checks `requiredQuestionRewardVotersForAmount(params.payload.bounty.amount)`.
- `packages/nextjs/public/skill.md:59`, `packages/nextjs/public/docs/ai.md:128`, `packages/nextjs/public/docs/sdk.md:137`, `packages/nextjs/lib/agent/schemas.ts:241`, `packages/nextjs/lib/agent/installSnippets.ts:18`, and `packages/nextjs/public/llms.txt:105` describe the thresholds as USDC tiers.

Suggested fix:

1. Decide whether voter floors are asset-neutral atomic thresholds or USDC-equivalent thresholds.
2. If asset-neutral, reword public copy to avoid USDC-only language for LREP-capable wallet-call asks.
3. If USDC-equivalent, make lint/server validation asset-aware and add LREP/USDC regression cases.

### NC-CW-2026-07-03-7 - SDK MCP URL derivation contradicts its README warning about Ponder URLs

The SDK README tells users not to derive MCP URLs from a Ponder `apiBaseUrl` and to pass `mcpApiUrl` explicitly for `createRateLoopAgentClient`. The SDK implementation still auto-derives `/api/mcp/public` or `/api/mcp` from any `apiBaseUrl` when `mcpApiUrl` is omitted.

Impact: a caller who passes the hosted Ponder URL as `apiBaseUrl` can get MCP requests pointed at `https://ponder.rateloop.ai/api/mcp/public`, which fails late. This is an SDK ergonomics/documentation contradiction.

Evidence:

- `packages/sdk/README.md:23` warns not to derive MCP from a Ponder `apiBaseUrl`.
- `packages/sdk/src/agent.ts:1665` through `:1681` derives `mcpApiUrl` from `apiBaseUrl` whenever `mcpApiUrl` is not set.
- `packages/sdk/src/agent.ts:1500` through `:1502` then treats that derived URL as satisfying MCP operation requirements.

Suggested fix:

1. Require explicit `mcpApiUrl` for MCP operations when the agent client is configured with a Ponder-style `apiBaseUrl`.
2. Alternatively clarify that `apiBaseUrl` in `createRateLoopAgentClient` means the Next.js app origin, not the Ponder origin, and reject known Ponder hosts.
3. Add SDK tests for Ponder `apiBaseUrl` plus omitted `mcpApiUrl`.

### NC-CW-2026-07-03-8 - Node-utils rater type parsing accepts non-canonical numeric strings

`normalizeRaterType` uses `Number(trimmed)` for string values. That accepts forms such as `2e0`, `0x2`, or `2.0` and normalizes them to the same enum as canonical `"2"`. The tests cover canonical strings and numbers but not non-canonical numeric strings.

Impact: self-report/profile data can accept unexpectedly loose rater-type values. This is low-risk data quality drift, but exact parsing would make profile import/export behavior easier to reason about.

Evidence:

- `packages/node-utils/src/profileSelfReport.ts:338` through `:347` parses string rater types with `Number(trimmed)`.
- `packages/node-utils/src/profileSelfReport.test.ts:98` through `:101` covers canonical `"Human"`, `"2"`, numeric `3`, and `"bogus"` only.

Suggested fix:

1. Accept exact `/^[0-4]$/` numeric strings or canonical labels for string inputs.
2. Keep numeric enum inputs accepted only when they are safe integers in range.
3. Add tests for `2e0`, `2.0`, `0x2`, signed values, and whitespace around canonical values.

### NC-CW-2026-07-03-9 - Legacy World Chain Sepolia live readiness workflow is structurally unwired

The World Chain Sepolia live readiness workflow exports app and Ponder URLs at the job level, and only RPC for the live probe step. The shared live readiness checker also expects keeper URL and production off-chain runtime env such as keeper token, keeper DB URL, CORS/rate-limit config, metadata sync token, and metrics/auth env. Tests already codify that missing required targets should fail.

Impact: if someone manually runs the legacy World Chain Sepolia live workflow with required live targets, it fails because the workflow is not wired like the Base readiness workflows. Since World Chain is legacy, this should likely be retired rather than polished.

Evidence:

- `.github/workflows/worldchain-sepolia-readiness.yaml:19` through `:20` exports only app and Ponder URLs at job scope.
- `.github/workflows/worldchain-sepolia-readiness.yaml:39` exports only RPC for the live probe step.
- `scripts/check-worldchain-sepolia-readiness.mjs:34` through `:40` passes app, keeper, Ponder, and RPC env into live readiness.
- `scripts/readiness-core.mjs:432` defines required production off-chain env checks.
- `scripts/check-worldchain-sepolia-readiness.test.mjs:946` through `:970` asserts missing required live targets fail.

Suggested fix:

1. Retire or disable the World Chain Sepolia workflow now that World Chain is legacy.
2. If it must remain runnable for historical validation, wire it like the Base readiness workflows with keeper URL, keeper/metadata tokens, `KEEPER_DATABASE_URL`, `NODE_ENV=production`, CORS/rate-limit env, artifact env, and `METRICS_AUTH_TOKEN`.

## Important Non-Findings

- The in-progress dispute-gated frontend-fee work in the dirty checkout appears internally consistent on the reviewed paths: keeper code reads `hasOpenSnapshotDispute` before `completeFeeWithdrawal`, the frontend hook hides the withdrawal completion item while a dispute is active, and keeper tests for the new path passed.
- Handoff tokens are still carried through URL fragments, cleaned from browser history, sent as headers, and checked by token hash; no token-in-query regression was found in the reviewed paths.
- API JSON body handling in the reviewed Next.js API surface continues to use capped `parseJsonBody` helpers; no direct uncapped `request.json()` path was found in the reviewed API routes.
- Cron entries in `packages/nextjs/vercel.json` had matching GET-compatible handlers for the scheduled jobs reviewed.
- Previously reported non-contract issues around Ponder malformed chain IDs, keeper `/live`, MCP reward asset labels, notification cron, capless dry-run asks, and public/managed MCP README separation appear fixed at the current head.

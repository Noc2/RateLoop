# Non-Contract Review Report - 2026-07-03

Reviewed commit: `3d755b65d17d7fd62eccd534473c850c922d128e`

## Scope

This pass reviewed non-smart-contract surfaces on `main`: Next.js app/API/client code, MCP and SDK integrations, agent examples/docs, Ponder API/runtime wiring, Keeper runtime/configuration, repo readiness scripts, deployment config, and operator docs.

Excluded from this pass: Solidity contract logic, Foundry scripts/tests, and generated contract ABI/deployment correctness. Contract metadata was only referenced where non-contract readiness or API behavior depends on it.

## Summary

The review found six actionable non-contract issues:

- 4 medium severity issues
- 2 low severity issues

No files were changed during the review except this report.

## Findings

### Medium: Malformed `PONDER_CHAIN_ID` Can Pass Startup But Break Keeper Deployment Checks

`packages/ponder/scripts/start.mjs` and `packages/ponder/scripts/databaseSchema.mjs` parse `PONDER_CHAIN_ID` with `Number.parseInt`, so values like `8453junk` are accepted as `8453`. The Ponder `/deployment` runtime path uses stricter whole-string parsing in `packages/ponder/src/protocol-deployment.ts`, and `packages/ponder/src/api/index.ts` calls it without catching parser failures. Keeper then fails closed when `/deployment` is non-OK in `packages/keeper/src/keeper.ts`.

Impact: a malformed hosted environment can launch with derived schema/RPC assumptions from the numeric prefix, then fail Keeper deployment verification and stop settlement/reveal automation.

Suggested fix: share one strict decimal parser across Ponder startup, schema resolution, and deployment metadata; add launcher/schema tests for trailing junk and partial numeric inputs.

Evidence:

- `packages/ponder/scripts/start.mjs:37`
- `packages/ponder/scripts/databaseSchema.mjs:46`
- `packages/ponder/src/protocol-deployment.ts:29`
- `packages/ponder/src/api/index.ts:205`
- `packages/keeper/src/keeper.ts:644`

### Medium: Keeper Railway `/live` Healthcheck Conflicts With Default Loopback Bind

`packages/keeper/railway.toml` configures Railway to healthcheck `/live`, and `.env.example` says to leave `METRICS_PORT` unset on Railway so the keeper listens on Railway's injected `PORT`. However, non-artifact keeper deployments still default `METRICS_BIND_ADDRESS` to `127.0.0.1` in `packages/keeper/src/config.ts`, while the server listens on that bind in `packages/keeper/src/metrics.ts`.

Impact: a Railway deployment that follows the documented defaults can bind `/live` only to loopback, while Railway expects the healthcheck endpoint on the hosted port.

Suggested fix: for hosted `PORT` deployments, either default to `0.0.0.0` with required `METRICS_AUTH_TOKEN`, or document and set `METRICS_BIND_ADDRESS=0.0.0.0` in Railway env. Add config coverage for the non-artifact Railway case.

Evidence:

- `packages/keeper/railway.toml:18`
- `packages/keeper/.env.example:62`
- `packages/keeper/src/config.ts:487`
- `packages/keeper/src/config.ts:505`
- `packages/keeper/src/metrics.ts:559`

### Medium: MCP Ask/Status Responses Can Mislabel LREP Payments As USDC

The x402 question submission builder preserves the bounty asset label in `payment.asset`, but `normalizeMcpPayment` in `packages/nextjs/lib/mcp/tools.ts` overwrites every payment response with `asset: "USDC"` and USDC decimals. That normalizer is used by public/managed ask, confirm, and status response bodies.

Impact: an LREP-funded wallet-call ask can be displayed or accounted for as USDC by agents consuming MCP responses.

Suggested fix: preserve the payment asset from the submission response, or derive it from the submitted bounty asset/token address while keeping token address and decimals explicit.

Evidence:

- `packages/nextjs/lib/x402/questionSubmission.ts:1757`
- `packages/nextjs/lib/x402/questionSubmission.ts:1807`
- `packages/nextjs/lib/mcp/tools.ts:2489`

### Medium: Email Notification Delivery Has No Vercel Cron Wiring

`packages/nextjs/README.md` documents `NOTIFICATION_DELIVERY_SECRET` as the secret for an email delivery cron endpoint, and `.env.example` includes Resend/email delivery variables. The only Vercel crons in `packages/nextjs/vercel.json` are confidentiality, attachment cleanup, and agent callback sweep jobs; none call `/api/notifications/email/deliver`. The delivery route only exports `POST`, while Vercel cron invokes `GET`.

Impact: notification email configuration can look complete in production, but queued notification emails will not be delivered unless an undocumented external POST scheduler exists.

Suggested fix: add a Vercel-compatible `GET` handler plus a `vercel.json` cron entry, or explicitly document/configure an external POST scheduler. Add a test that documented cron endpoints are scheduled and Vercel-callable.

Evidence:

- `packages/nextjs/README.md:83`
- `packages/nextjs/.env.example:109`
- `packages/nextjs/vercel.json:3`
- `packages/nextjs/app/api/notifications/email/deliver/route.ts:35`
- `packages/nextjs/app/api/notifications/email/deliver/route.test.ts:28`

### Low: SDK README Shows A Managed Token Sent To The Public MCP Endpoint

The SDK README example uses `https://www.rateloop.ai/api/mcp/public` while also passing `RATELOOP_MCP_TOKEN`. The SDK sends that bearer token, but the public route dispatches to public tools and does not authenticate managed policy scope.

Impact: copied code can appear protected by managed caps/scopes while actually using the public endpoint behavior.

Suggested fix: split the examples: public endpoint without a token, managed endpoint with `RATELOOP_MCP_TOKEN`.

Evidence:

- `packages/sdk/README.md:90`
- `packages/sdk/README.md:93`
- `packages/sdk/src/agent.ts:1517`
- `packages/nextjs/app/api/mcp/public/route.ts:258`

### Low: MCP Dry-Run Copy Says No Payment, But `maxPaymentAmount` Is Still Required

Public docs tell agents to run a no-payment dry run with `dryRun: true` or `mode: "dry_run"`. Both public and managed `rateloop_ask_humans` paths parse `maxPaymentAmount` before returning dry-run fixtures, and missing values throw `maxPaymentAmount must be a non-negative integer string`.

Impact: agents following the dry-run wording can hit a budget-cap validation error before receiving sandbox validation.

Suggested fix: skip `maxPaymentAmount` parsing for dry runs, or make the docs/schema explicit that dry runs still require a cap.

Evidence:

- `packages/nextjs/public/docs/ai.md:242`
- `packages/nextjs/lib/mcp/tools.ts:748`
- `packages/nextjs/lib/mcp/tools.ts:3431`
- `packages/nextjs/lib/mcp/tools.ts:3753`

## Checked Clean / Not Reopened

- The Next.js app/API/client review found no additional actionable issues beyond the MCP/cron/docs findings above.
- Ponder route validation, API tests, and deployment metadata tests passed on current `main`.
- Keeper correlation snapshot and round resolution tests passed on current `main`.
- Agent examples/docs tests passed on current `main`.
- SDK agent tests passed on current `main`.

## Verification

Commands run on current `main`:

- `yarn dead-code`
- `node scripts/run-node-tests.mjs scripts/docs-public-copy.test.mjs scripts/readiness-workflows.test.mjs scripts/check-base-mainnet-readiness.test.mjs scripts/check-worldchain-mainnet-readiness.test.mjs scripts/check-worldchain-sepolia-readiness.test.mjs` - 84 passed
- `node ../../scripts/run-node-tests.mjs app/api/agent/routes.test.ts app/api/mcp/route.test.ts lib/feedback/contentFeedback.test.ts lib/feedback/postconditions.test.ts hooks/useClaimableQuestionRewards.test.ts app/api/attachments/images/sweep/route.test.ts app/api/attachments/details/sweep/route.test.ts` from `packages/nextjs` - 133 passed
- `yarn workspace @rateloop/ponder test -- tests/route-validation.test.ts` - 35 files passed, 433 passed, 1 skipped
- `yarn workspace @rateloop/keeper test -- src/__tests__/correlation-snapshots.test.ts src/__tests__/resolve-rounds.test.ts` - 38 files passed, 561 passed, 2 skipped
- `yarn workspace @rateloop/agents test -- src/__tests__/examplesDocs.test.ts` - 15 files passed, 163 passed
- `node ../../scripts/run-node-tests.mjs src/agent.test.ts` from `packages/sdk` - 42 passed

The Next.js and SDK node-test runs emitted expected Node deprecation warnings for `module.register()`. The Next.js feedback tests also emitted expected fallback logs for unavailable Ponder/RPC calls while still passing.

## Residual Risk

This review did not audit Solidity behavior, Foundry tests/scripts, on-chain economic assumptions, or generated ABI/deployment correctness. It also did not perform a full end-to-end browser or deployed-service run.

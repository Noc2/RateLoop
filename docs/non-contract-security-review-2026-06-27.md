# RateLoop Non-Contract Security Rereview - 2026-06-27

## Scope

This rereview covered the committed non-contract code and configuration at `origin/main`
commit `4860b6605cdf4ec7aaac2d7ae6dbe10e4406fddc`. Smart contracts,
Solidity, Foundry tests, and contract deployment strategy were intentionally out
of scope.

The primary checkout had unrelated uncommitted Next.js/social changes during
the review, so this report was prepared from a clean temporary worktree at
`origin/main`.

Reviewed surfaces included:

- Next.js API routes, middleware, auth/session helpers, CSP, public URL
  construction, upload/image handling, and World ID routes.
- MCP and agent handoff/signing flows, callback delivery, browser-token flows,
  and secret handling.
- Ponder, Keeper, agent CLI, SDK, background scripts, RPC/Ponder URL validation,
  artifact fetching, and CI/CD workflows.
- Tracked examples/configuration for likely committed production secrets.

## Verification Performed

- Spawned two read-only review agents for parallel coverage of app/API surfaces
  and automation/service surfaces, then manually checked their current findings.
- Compared this tree against:
  - `docs/non-contract-security-review-2026-06-26.md`
  - `docs/non-contract-security-review-2026-06-26-second-pass.md`
- Ran dependency audits:
  - `yarn npm audit --recursive --environment production` -> no audit
    suggestions.
  - `yarn npm audit --recursive --environment development` -> no audit
    suggestions.
- Searched tracked content for likely production secrets and long private-key
  shaped values. The hits reviewed were placeholders, tests, deterministic local
  keys, generated example hashes, or runtime variable names; no high-confidence
  committed production credential was identified.
- Rechecked previously reported non-contract findings to separate fixed/stale
  issues from still-actionable residual risk.

## Executive Summary

No critical or high-severity non-contract issue was found. One current medium
issue and three low-severity hardening issues remain actionable. No finding in
this report requires or suggests redeploying production smart contracts.

Current actionable items:

1. Production app URL normalization still accepts remote plaintext `http:` and
   userinfo-bearing URLs.
2. Two public World ID diagnostic/context endpoints still parse JSON without the
   repo's bounded JSON reader.
3. Agent `webhookSecret` values are redacted from responses, but can still be
   duplicated in generic persisted request-body JSON.
4. The existing low-severity CSP residual risk remains: `style-src` still allows
   inline styles.

Most medium issues from the June 26 reports appear fixed in current `origin/main`,
including browser-visible handoff/signing secret exposure, PR readiness secret
exposure, host-derived MCP token config, plaintext production RPC/Ponder URL
validators, npm publish ref guards, Vercel install pinning, Keeper Docker runtime
hardening, Certora hashed Python dependencies, and Ponder payout artifact bounds.

## Findings

### RL-NCS3-01: Production app URL validation allows remote HTTP and userinfo URLs

Severity: Medium

`resolveAppUrl` accepts both `http:` and `https:` URLs in production and only
rejects localhost when `allowLocalhostInProduction` is false:

- `packages/nextjs/lib/env/server.ts:60-79`

That shared helper feeds production app-base resolution for agent links:

- `packages/nextjs/lib/agent/appBaseUrl.ts:14-24`
- `packages/nextjs/lib/agent/appBaseUrl.ts:43-46`

The resulting base URL is used to build token-fragment browser links:

- `packages/nextjs/lib/agent/handoffs.ts:417-420`
- `packages/nextjs/lib/agent/signingIntents.ts:144-153`

It also feeds notification email URL construction:

- `packages/nextjs/lib/notifications/emailUrls.ts:13-25`

Impact: a misconfigured production value such as `APP_URL=http://rateloop...`
would downgrade token-bearing links to plaintext transport. A value such as
`https://rateloop.example@evil.example` is syntactically valid and can look
deceptive in logs or dashboards while actually targeting the attacker-controlled
host. This is configuration-dependent, but the current validator accepts the
unsafe shape instead of failing closed.

Recommended fix:

- In production, require `https:` for canonical app URLs unless an explicit local
  E2E production-build escape hatch is enabled.
- Reject URL username/password components.
- Reject localhost, private/IP literal, and single-label hosts for production
  canonical app URLs, matching the stricter posture used by server-side public
  fetch helpers where practical.
- Add tests for `APP_URL`, `NEXT_PUBLIC_APP_URL`, and Vercel-derived fallback
  values covering `http:`, userinfo, localhost, and a valid production HTTPS
  origin.

Contract redeploy required: No.

### RL-NCS3-02: World ID routes bypass bounded JSON parsing

Severity: Low

The repo has a bounded JSON reader that checks `Content-Length` and cancels the
stream after a byte cap:

- `packages/nextjs/lib/http/jsonBody.ts:24-47`
- `packages/nextjs/lib/http/jsonBody.ts:75-82`

Two public World ID routes still call `request.json()` directly:

- `packages/nextjs/app/api/world-id/rp-context/route.ts:13-15`
- `packages/nextjs/app/api/world-id/diagnostics/route.ts:82-87`

Both routes are rate-limited, and the parsed payloads are small, which keeps the
severity low. Still, direct `request.json()` allows an oversized request body to
be buffered and parsed before app-level validation.

Impact: a public caller can spend avoidable memory/CPU on oversized JSON bodies
against endpoints that should only need a tiny payload.

Recommended fix:

- Replace direct `request.json()` calls with `parseJsonBody`.
- Use a small route-specific cap, for example 4-8 KiB for these payloads.
- Return the existing `413` envelope via `jsonBodyErrorResponse` when the cap is
  exceeded.

Contract redeploy required: No.

### RL-NCS3-03: Agent webhook secrets remain duplicated in persisted request bodies

Severity: Low

The browser-visible leak from `RL-NCS2-01` appears fixed: handoff and signing
responses now redact sensitive request fields before returning them:

- `packages/nextjs/lib/agent/requestRedaction.ts:3-14`
- `packages/nextjs/lib/agent/handoffs.ts:811-812`
- `packages/nextjs/lib/agent/signingIntents.ts:242-255`

However, the same `webhookSecret` input is still part of the accepted ask field
set and callback parser:

- `packages/node-utils/src/x402QuestionFields.ts:26-28`
- `packages/nextjs/lib/mcp/tools.ts:2211-2220`

Handoff creation still persists the normalized and original request bodies:

- `packages/nextjs/lib/agent/handoffs.ts:868-870`
- `packages/nextjs/lib/agent/handoffs.ts:912-944`

Signing-intent creation still persists the raw request body:

- `packages/nextjs/lib/agent/signingIntents.ts:290-293`
- `packages/nextjs/lib/agent/signingIntents.ts:308-334`

Impact: a DB export, support/debug dump, read-only SQL compromise, or future
unredacted response path could expose callback HMAC secrets. An attacker with
one of those secrets could forge callback deliveries to an agent webhook that
trusts RateLoop callback signatures.

Recommended fix:

- Redact `webhookSecret` before storing generic request-body and
  original-request-body JSON.
- Keep callback signing material only in the callback subscription/signing
  record, preferably encrypted or separately access-controlled.
- Add tests that create handoffs/signing intents with `webhookUrl` plus
  `webhookSecret`, then assert create/get/patch/prepare/signing responses and
  stored generic request-body JSON omit the secret.

Contract redeploy required: No.

### RL-NCS3-04: CSP still permits inline styles

Severity: Low

This is an existing documented residual issue from
`docs/non-contract-security-review-2026-06-26.md` (`RL-NCS-09`), not a newly
introduced regression.

The script CSP is nonce-based, but style CSP still includes `'unsafe-inline'`:

- `packages/nextjs/lib/security/contentSecurityPolicy.ts:98-100`

Impact: this is not direct script execution. It does preserve more room for UI
redress overlays or limited CSS-based impact if a future HTML/style injection
bug is introduced.

Recommended fix:

- Inventory inline style dependencies from React/component libraries.
- Move toward nonce/hash-based styles where practical.
- Keep this as an accepted documented residual risk until inline style support
  can be removed.

Contract redeploy required: No.

## Fixed or Stale June 26 Findings

The following previously reported issues appear fixed or stale against current
`origin/main`:

- `RL-NCS-01`: Private account read sessions now bind scope into the signed
  payload and set only the requested scope cookie.
- `RL-NCS-02`: Ponder payout artifact `data:` payloads are bounded before and
  after decode in the event handler and payout-proof API paths.
- `RL-NCS-03`: Ponder and Keeper live-network RPC validation now rejects
  plaintext remote HTTP outside local/hardhat cases.
- `RL-NCS-04`: Vercel install/build paths use immutable installs and a
  lockfile-managed Vercel CLI.
- `RL-NCS-05`: Keeper Docker runtime now builds `dist`, focuses production
  dependencies, and runs the built output as the non-root user.
- `RL-NCS-06`: Certora workflow installs Python requirements with
  `--require-hashes`.
- `RL-NCS2-01`: Browser-visible handoff/signing `webhookSecret` response
  exposure is fixed; `RL-NCS3-03` tracks the remaining at-rest duplication.
- `RL-NCS2-02`: Base readiness workflows split offline PR checks from
  secret-backed live checks.
- `RL-NCS2-03`: Agent policy token config generation uses canonical app-base URL
  handling rather than the request URL trust source.
- `RL-NCS2-04`: Next.js public env, Ponder URL, RPC override, and local signer
  validators now reject plaintext remote HTTP in production/live contexts.
- `RL-NCS2-05`: npm publish workflow now gates publishable refs/tags.
- `RL-NCS2-06`: The checked E2E/deploy supply-chain edges are now pinned or
  lockfile-backed.

## Residual Operational Checks

This was a repo/code review, not a live production configuration audit. Before
treating the environment as fully rechecked, verify the deployed configuration
still matches the code assumptions:

- Production `APP_URL`/`NEXT_PUBLIC_APP_URL`/Vercel project URL values are
  canonical HTTPS RateLoop origins with no userinfo.
- Live workflow secrets remain limited to protected main/scheduled/manual
  contexts.
- OpenAI moderation, Vercel Blob, database, callback delivery, and metrics
  secrets are present only in the intended deployed environments.
- Dependency and container digest audits continue to run on a regular cadence.

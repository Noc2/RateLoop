# RateLoop Security Re-Review Findings - 2026-06-25

## Scope

This follow-up review rechecked the repository after the fixes documented in
`docs/repo-review-findings-2026-06-25.md`. The review was read-only except for
this document. It focused on security issues that can be fixed without
redeploying the already-deployed production smart contracts.

Current review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch: `main`
- Reviewed HEAD: `a0da04fbd` (`Add Ponder Railway readiness healthcheck`)
- Date: 2026-06-25

## Verification Performed

- Ran `yarn npm audit --recursive --environment production`: no audit suggestions.
- Ran `yarn npm audit --recursive`: no audit suggestions.
- Ran `yarn foundry:slither`: 161 contracts analyzed with 35 detectors, 0 results.
- Searched tracked files for common secret/key/token patterns. The hits were
  expected CI secret references, example variables, test fixtures, or local E2E
  deterministic keys; no committed production credential was identified.
- Rechecked the previously documented keeper lock, thumbnail relay, Ponder E2E
  artifact, SDK webhook docs, build-error bypass, public callback status, and CSP
  fixes.
- Used three parallel code-review agents covering Next.js/API/auth surfaces,
  off-chain Ponder/keeper/SDK/config surfaces, and Solidity/deploy/governance
  boundaries.

## Executive Summary

No critical or high-severity issue was found. No finding below requires a
production smart contract redeploy. The remaining issues are off-chain
application, configuration, SDK, or operator-tooling fixes.

The highest-priority items are:

1. Agent token URLs are built from request-derived origins.
2. Gated confidential attachment reads can be repeatedly invoked without a route
   or resource-level limiter.
3. Next.js still honors local E2E production escape-hatch flags in real
   production builds if those flags leak into the environment.

## Findings

### RL-SEC-FU-01: Agent token URLs trust the incoming request origin

Severity: Medium

The public agent signing and handoff creation routes derive `appBaseUrl` from
the incoming request URL:

- `packages/nextjs/app/api/agent/signing-intents/route.ts:23-40`
- `packages/nextjs/app/api/agent/handoffs/route.ts:26-50`
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/route.ts:73-75`
- `packages/nextjs/lib/url/appRelative.ts:25-36`

The returned URLs then embed bearer-like handoff/signing tokens in the URL
fragment:

- `packages/nextjs/lib/agent/signingIntents.ts:143-152`
- `packages/nextjs/lib/agent/signingIntents.ts:359-360`
- `packages/nextjs/lib/agent/handoffs.ts:414-417`
- `packages/nextjs/lib/agent/handoffs.ts:989-990`

Fragments are a good improvement over query-string tokens, but the origin itself
is still request-derived. If production, a reverse proxy, or a deployment domain
accepts attacker-controlled `Host`/forwarded-host input, an unauthenticated
caller can cause RateLoop to issue a valid user-facing URL on an attacker-chosen
origin. That creates phishing and token-capture risk for signing-intent and
handoff flows.

Recommended fix:

- In production, build all user-facing agent URLs from a configured canonical app
  URL, not from `request.url`.
- Fail closed during startup/build when the canonical app URL is missing in a
  production deployment that enables agent signing/handoff routes.
- For non-production, keep request-derived base URLs available for local
  app-prefix and preview testing.
- Add regression tests with hostile request origins to confirm production ignores
  the request origin.

Contract redeploy required: No.

### RL-SEC-FU-02: Gated confidential attachment reads are expensive and not route-throttled

Severity: Medium

Gated image and details reads go from request parsing into database/blob work and
authorization checks without an up-front route limiter:

- `packages/nextjs/app/api/attachments/images/[attachmentId]/route.ts:47-58`
- `packages/nextjs/app/api/attachments/details/[detailsId]/route.ts:44-56`

When a gated image read is authorized, it logs access and watermarks image bytes:

- `packages/nextjs/app/api/attachments/images/[attachmentId]/route.ts:125-157`
- `packages/nextjs/app/api/attachments/images/[attachmentId]/route.ts:210-230`

Gated details reads also log every authorized view:

- `packages/nextjs/app/api/attachments/details/[detailsId]/route.ts:78-115`
- `packages/nextjs/lib/confidentiality/context.ts:932-959`

An authorized wallet/session can repeatedly fetch the same gated resource and
force blob reads, in-memory buffering, Sharp watermarking, and database writes.
This is a practical CPU, memory, blob, and DB-amplification path.

Recommended fix:

- Add a first-stage IP/fingerprint limiter to image/details `GET` routes before
  attachment lookup.
- Add a tighter gated-resource limiter keyed by wallet/content/resource after
  authorization.
- Deduplicate access logs per wallet/content/resource over a short window, while
  preserving enough auditability for confidentiality access trails.
- Add tests for repeated gated image/detail reads returning rate-limit responses.

Contract redeploy required: No.

### RL-SEC-FU-03: Production can still honor local E2E escape-hatch flags

Severity: Medium

The Next.js app treats either `RATELOOP_E2E_PRODUCTION_BUILD=true` or
`NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD=true` as enabling local E2E behavior:

- `packages/nextjs/utils/env/e2eProduction.ts:16-17`

That flag relaxes several production safety checks:

- Production URL validation allows localhost when the flag is true:
  `packages/nextjs/utils/env/public.ts:61-63`
- Ponder availability preflight can be bypassed for loopback HTTP Ponder URLs:
  `packages/nextjs/services/ponder/client.ts:34-48`
- Localhost requests can be trusted for rate-limit identity in production:
  `packages/nextjs/utils/rateLimit.ts:126-132`
- Localhost details and image origins can be accepted in production:
  `packages/nextjs/lib/attachments/questionDetails.ts:144-145`
  and `packages/nextjs/lib/attachments/imageAttachmentUrls.ts:48-49`

Ponder now rejects local E2E artifacts on live networks, but the Next.js app does
not appear to have an equivalent fail-closed guard. If the E2E flag leaks into a
real production deployment, the app can run with weakened production checks.

Recommended fix:

- Reject these E2E flags when `VERCEL_ENV=production`, when live target networks
  are configured, or when the deployment host is not localhost.
- Prefer a server-only local E2E flag; do not make the escape hatch a
  `NEXT_PUBLIC_*` value in production bundles.
- Mirror the Ponder live-network guard in `next.config.ts` or a shared build
  guard.
- Add tests proving production/live-network builds fail when either flag is set.

Contract redeploy required: No.

### RL-SEC-FU-04: Some public lookup rate limits use attacker-controlled key parts

Severity: Low

The shared rate limiter includes all `extraKeyParts` in the final bucket key:

- `packages/nextjs/utils/rateLimit.ts:225-230`

Several public routes add user-controlled values to those key parts before the
database or service lookup:

- Email verification token prefix:
  `packages/nextjs/app/api/notifications/email/verify/route.ts:17-20`
- Attachment status ID:
  `packages/nextjs/app/api/attachments/images/[attachmentId]/status/route.ts:10-15`
- Claimable-fee frontend and chain ID:
  `packages/nextjs/app/api/frontend/claimable-fees/route.ts:10-20`

Because the attacker can vary those values, they can create fresh buckets and
partially bypass the intended per-IP/fingerprint throttle for public lookups.

Recommended fix:

- Add a first-stage route limiter with no attacker-controlled `extraKeyParts`.
- Keep optional per-resource secondary limits after basic validation and
  normalization.
- Add tests that vary the public parameter while keeping the same client identity
  and still hit the first-stage limit.

Contract redeploy required: No.

### RL-SEC-FU-05: Email settings disclose whether an email belongs to another wallet

Severity: Low

After a wallet-signed settings update, the email API returns a precise conflict
when the target email is already linked to another wallet:

- `packages/nextjs/app/api/notifications/email/route.ts:161-204`
- `packages/nextjs/lib/notifications/emailSettings.ts:74-85`

Any wallet holder can use this to test whether arbitrary email addresses are
already subscribed or linked in RateLoop.

Recommended fix:

- Replace the conflict response with a generic accepted/generic failure response.
- Move specific disclosure behind mailbox verification, for example "if this
  email can be used, a verification email was sent."
- Keep server-side logs specific enough for support/debugging.

Contract redeploy required: No.

### RL-SEC-FU-06: The generic SDK webhook verifier still allows replay-prone usage

Severity: Low

The SDK now documents `buildReplayProtectedWebhookVerifier`, which is good. The
generic `buildWebhookVerifier` path still returns a verifier with only
`verify`/`assertValid` when `replayProtection` is omitted:

- `packages/sdk/src/agent.ts:775-789`
- `packages/sdk/src/agent.ts:1360-1437`
- `packages/sdk/src/agent.ts:1472-1482`
- `packages/sdk/README.md:242-268`

Integrators who choose the generic builder and omit replay storage can accept
replayed callbacks within the timestamp window if their handler is not
idempotent.

Recommended fix:

- Make replay-safe construction the default path, or make unsafe construction
  require an explicit `allowReplay: true` option on the generic builder.
- Consider warning or throwing in production when replay storage is omitted.
- Keep a deliberately named signature-only helper for idempotent handlers and
  diagnostics.

Contract redeploy required: No.

### RL-SEC-FU-07: Foundry deploy wrapper passes an unquoted keystore account through Make

Severity: Low

The live deploy wrapper validates that the selected keystore path exists, then
passes the name through `ETH_KEYSTORE_ACCOUNT`:

- `packages/foundry/scripts-js/parseArgs.js:57-69`
- `packages/foundry/scripts-js/parseArgs.js:151-161`

The Make deploy recipe expands the account value unquoted:

- `packages/foundry/Makefile:34-40`

This requires local/operator influence over a keystore name or environment
value, so the impact is limited. Still, the affected workflow is high-value
deployment tooling, and unquoted shell expansion can split arguments or enable
unexpected shell interpretation.

Recommended fix:

- Restrict deploy keystore names to a conservative character set.
- Quote the Make variable in the `forge script --account` argument.
- Longer term, replace the shell/Make hop with a Node `spawnSync("forge", args,
  { shell: false })` invocation for deploy commands.

Contract redeploy required: No.

## Hardening Notes

These were not raised as primary findings, but they are worth considering while
touching nearby code.

- Ponder keeper and metadata-sync bearer checks use direct string equality:
  `packages/ponder/src/api/routes/keeper-routes.ts:21-29` and
  `packages/ponder/src/api/routes/content-routes.ts:687-701`. Remote timing
  exploitation is likely noisy, but a shared constant-time bearer helper would be
  cleaner.
- CSP still permits inline styles through `style-src 'self' 'unsafe-inline'` at
  `packages/nextjs/lib/security/contentSecurityPolicy.ts:102-107`. Script
  execution is nonce-protected now, so this is not the previous CSP finding, but
  reducing inline style dependence would further narrow injection blast radius.

## Previously Reported Issues That Remain Addressed

- Keeper readiness now fails closed when the required DB lock/health path is not
  available.
- Thumbnail relay quota and URL/host validation controls are present.
- Ponder E2E local artifact support is rejected on live networks.
- SDK docs promote replay-protected webhook handling.
- `NEXT_PUBLIC_IGNORE_BUILD_ERROR=true` is rejected during Next.js config load.
- Public callback delivery status is redacted.
- Script CSP uses nonces and no longer relies on script `unsafe-inline`.


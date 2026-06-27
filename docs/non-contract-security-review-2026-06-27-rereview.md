# Non-Contract Security Re-Review - 2026-06-27

## Scope

Reviewed commit: `a2ecb4f33 fix(deps): force patched undici for vercel tooling`.

This pass reviewed non-contract code only:

- Next.js API routes, attachment handling, MCP/agent routes, callback routes, confidentiality routes, public read routes, rate limits, CSP, and app-origin helpers.
- Agent SDK/local signer/x402 payload parsing and hosted attachment validation paths.
- Ponder API routes, Keeper service auth/metrics, scripts, GitHub workflows, env examples, and dependency advisory state.

Explicitly out of scope: Solidity contracts, Foundry tests, contract deployment artifacts, and production contract redeployment guidance.

## Method

- Ran dependency checks:
  - `yarn npm audit --recursive --environment production`
  - `yarn npm audit --recursive --environment development`
- Checked open GitHub Dependabot alerts through `gh api repos/Noc2/RateLoop/dependabot/alerts?state=open`.
- Ran repo-wide secret and auth-surface searches excluding smart contracts and generated/vendor-heavy paths.
- Enumerated Next.js API routes and manually reviewed public reads, writes, sweep jobs, attachment gates, confidentiality routes, MCP routes, agent routes, and callback delivery.
- Reviewed Ponder/keeper service auth, production fail-closed config, CORS/rate-limit posture, and body parsing behavior.
- Ran three parallel reviewer agents over:
  - Next.js API/auth/rate-limit/header/CSP/public URL surfaces.
  - Agent/MCP/x402/handoff/signing/local-signer surfaces.
  - Dependency/workflow/env/keeper/ponder/script surfaces.

## Summary

No Critical or High findings were found in this non-contract pass.

Open findings:

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| RL-NCS4-01 | Medium | Hosted attachment provenance | Open |
| RL-NCS4-02 | Low | Public GET availability/cost controls | Open |
| RL-NCS4-03 | Low | Ponder metadata sync body limit | Open |

Dependency/advisory checks were clean at review time:

- Production Yarn audit: no audit suggestions.
- Development Yarn audit: no audit suggestions.
- GitHub Dependabot open alerts: none returned.

The prior low-severity CSP residual remains unchanged: `style-src` still allows `'unsafe-inline'` for third-party UI/runtime compatibility while script CSP is nonce-based. This review does not reclassify that accepted residual as a new finding.

## Findings

### RL-NCS4-01: Hosted attachment URL trust bypasses hardened app-origin validation

Severity: Medium

Affected code:

- `packages/nextjs/lib/attachments/imageAttachments.ts:376-385`
- `packages/nextjs/lib/attachments/imageAttachments.ts:471-476`
- `packages/nextjs/lib/attachments/questionDetails.ts:121-137`
- `packages/nextjs/lib/attachments/questionDetails.ts:198-218`
- `packages/nextjs/lib/attachments/imageAttachmentUrls.ts:52-63`
- `packages/nextjs/lib/x402/questionPayload.ts:37-47`
- `packages/agents/src/x402QuestionPayload.ts:516-531`
- `packages/nextjs/lib/attachments/imageAttachments.ts:1166-1208`

The central app-link helpers now reject unsafe production origins, but hosted attachment and question-details helpers still read `APP_URL`, `NEXT_PUBLIC_APP_URL`, and `VERCEL_URL` directly. Those helpers accept any syntactically valid `http:` or `https:` origin in several places:

- Generating image attachment URLs.
- Generating hosted question-details URLs.
- Building allowed hosted attachment origins for image/details parsing.
- Parsing x402 image URLs accepted from agent submissions.

Image submission validation verifies the attachment id, digest, DB status, and owner/agent identity, but it does not prove that the browser-visible URL host is the canonical RateLoop app once that host has already passed the raw env-origin allowlist. Browser image loads also do not enforce the `#sha256=...` fragment.

Impact:

If production app URL env is misconfigured or poisoned to an attacker-controlled HTTPS origin, a submitted question can reference a real approved RateLoop attachment id/digest while causing voters' browsers to fetch the image or details from the attacker-controlled host. That weakens RateLoop-hosted media provenance and can enable post-submission media swaps, voter tracking, or misleading rendered context.

Recommended fix plan:

1. Route image attachment base URL generation, hosted details base URL generation, and allowed hosted attachment origins through the hardened canonical app URL helper in `packages/nextjs/lib/env/server.ts`.
2. In production, reject userinfo, remote `http:`, localhost, IP/private/internal/single-label hosts, and malformed Vercel hostnames consistently across image and details helpers.
3. Prefer canonical RateLoop production origins plus the validated canonical deployment origin. Do not include raw env origins that fail validation.
4. Add regression tests covering unsafe `APP_URL`, `NEXT_PUBLIC_APP_URL`, and `VERCEL_URL` values for:
   - generated image attachment URLs,
   - generated question-details URLs,
   - allowed image/details attachment origins,
   - x402 image URL parsing.

### RL-NCS4-02: Public GET availability/list routes skip route-level rate limits

Severity: Low

Affected code:

- `packages/nextjs/app/api/ponder/availability/route.ts:6-14`
- `packages/nextjs/services/ponder/client.ts:301-307`
- `packages/nextjs/services/ponder/client.ts:425-470`
- `packages/nextjs/services/ponder/client.ts:477-493`
- `packages/nextjs/app/api/confidentiality/breaches/route.ts:81-122`

`/api/ponder/availability` accepts an arbitrary `deploymentKey` and immediately calls `getPonderAvailabilityStatus`. The key is normalized into an availability cache key, but arbitrary unique values can bypass the cache and force repeated Ponder `/health` and `/deployment` probes.

`/api/confidentiality/breaches` validates `contentId`, then performs an unauthenticated DB query without a route-level rate limit. The route limits returned rows to 50, so this is not a data-volume issue, but callers can still create uncapped read load by varying content ids.

Impact:

Unauthenticated callers can create avoidable DB/upstream Ponder load and cost. This is an availability/cost-control issue, not an authorization bypass.

Recommended fix plan:

1. Add stable first-stage route-wide `checkRateLimit` calls to both GET handlers before request-specific cache keys or DB lookups are used.
2. For Ponder availability, validate `deploymentKey` against configured deployment keys when possible, or at least cap length/shape before it is used as a cache key.
3. Bound or evict `availabilityCache` entries so arbitrary deployment keys cannot grow the process map without limit.
4. Add regression tests showing that varying `deploymentKey` or `contentId` still hits the route-level limit.

### RL-NCS4-03: Authenticated Ponder metadata sync parses request bodies without a byte limit

Severity: Low

Affected code:

- `packages/ponder/src/api/routes/content-routes.ts:687-701`
- `packages/ponder/src/api/routes/content-routes.ts:717-719`
- `packages/ponder/src/api/routes/content-routes.ts:1041-1055`

`POST /question-metadata` requires `PONDER_METADATA_SYNC_TOKEN` in production unless local/dev open mode is explicitly enabled, and production rejects `PONDER_METADATA_SYNC_ALLOW_OPEN=true`. However, after auth it calls `await c.req.json()` before applying application-level item limits. The route caps metadata item count only after the full JSON body has already been buffered and parsed.

Impact:

An attacker would need the metadata sync bearer token in production, but a compromised or over-privileged integration with that token can send oversized JSON bodies that consume Ponder memory/CPU before application limits apply. The IP rate limiter reduces request count, but does not cap per-request bytes.

Recommended fix plan:

1. Add a bounded JSON reader or Hono middleware for this route before `c.req.json()`.
2. Reject `Content-Length` above the expected metadata batch cap.
3. Enforce a streaming byte limit for missing or dishonest `Content-Length` values and return `413`.
4. Size the limit to the expected production batch, for example 128 KiB to 1 MiB unless real metadata batches require more.
5. Add tests for oversized valid JSON and oversized invalid JSON.

## Notes On Previously Reviewed Areas

- Confidentiality log-root publication is now POST-only; GET returns `405`, and the cron adapter delegates through the same authenticated POST handler.
- Agent callback delivery and sweep routes require configured bearer secrets and route-level rate limits.
- Gated image/details reads validate attachment ids, content linkage, confidentiality state, and wallet/context auth while gated; gated responses are private/no-store.
- Public feedback/count/follows/OG vote reads now have route/resource rate limits.
- Ponder production API startup fails closed when trusted rate-limit headers or CORS origins are missing, except for deployment probes and bearer-authorized keeper-internal routes.
- Keeper metrics still refuse non-loopback binds without a sufficiently long `METRICS_AUTH_TOKEN`.

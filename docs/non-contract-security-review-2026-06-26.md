# RateLoop Non-Contract Security Review - 2026-06-26

## Scope

This review covered RateLoop surfaces outside smart contract code: Next.js API
routes and auth, agent/MCP/handoff flows, Ponder indexer/API paths, Keeper
runtime/configuration, CI/deployment configuration, dependency posture, and
committed secret hygiene. Solidity and Foundry contract logic were intentionally
out of scope.

Current review baseline:

- Branch: `main`
- Reviewed HEAD: `cd34ecc82`
- Date: 2026-06-26

This document is a report only. No application code, configuration, or contract
deployment artifact was changed.

## Verification Performed

- Ran `yarn npm audit --recursive --environment production`: no audit
  suggestions.
- Ran `yarn npm audit --recursive --environment development`: no audit
  suggestions.
- A JSON audit attempt with `--all --json` returned a Yarn registry 400 before
  producing advisory data; the narrower production/development audits above
  completed successfully.
- Searched tracked and repo-resident files for common secret/key/token patterns.
  Hits were examples, tests, deterministic local/E2E keys, CI secret references,
  or ignored local environment files. No committed production credential was
  identified.
- Reviewed the existing June 25 and June 26 repo-review documents to avoid
  re-reporting issues that the current code already addresses.
- Used three parallel read-only review agents focused on Next.js/API auth,
  off-chain runtime packages, and supply-chain/deployment configuration, then
  manually verified included findings against source line references.

## Executive Summary

No critical or high-severity issue was found. No finding below requires a
production smart contract redeploy. The most important fixes are off-chain:

1. Narrow the broad account-read signature that currently mints every private
   read-session scope.
2. Bound `data:` payout artifact decoding in Ponder before allocating/decoding.
3. Enforce HTTPS/WSS for non-local production RPC URLs.
4. Tighten production supply-chain controls for Vercel installs, the Keeper
   Docker runtime, and the Certora secret-backed workflow.

## Findings

### RL-NCS-01: Generic account-read signature mints every private read session

Severity: Medium

The private account access payload hashes only the wallet address:

- `packages/nextjs/lib/auth/privateAccountAccess.ts:29-31`

The issued challenge message includes the generic account-access action,
wallet, payload hash, nonce, and expiry, but no requested read scopes:

- `packages/nextjs/lib/auth/privateAccountAccess.ts:33-46`
- `packages/nextjs/lib/auth/signedActions.ts:44-53`

After one successful POST to `/api/account/private-session`, the route sets all
private read-session cookies:

- `packages/nextjs/app/api/account/private-session/route.ts:88-107`
- `packages/nextjs/lib/auth/signedReadSessions.ts:14-20`
- `packages/nextjs/lib/auth/signedReadSessions.ts:54-59`

Most scopes last 365 days; `gated_context` lasts 12 hours:

- `packages/nextjs/lib/auth/signedReadSessions.ts:11-12`
- `packages/nextjs/lib/auth/signedReadSessions.ts:32-36`

Impact: if a victim signs this broad "RateLoop account access" challenge, a
malicious site or backend that receives the signed response can submit it to
RateLoop, capture the returned bearer-like session cookie values, and use them
server-to-server. Those cookies authorize private reads such as agent policies,
notification email settings, watchlist entries, and the first gated-context
session check:

- `packages/nextjs/app/api/agent/policies/route.ts:36-49`
- `packages/nextjs/app/api/notifications/email/route.ts:54-64`
- `packages/nextjs/app/api/watchlist/content/route.ts:134-146`
- `packages/nextjs/lib/confidentiality/context.ts:816-823`

Gated context still enforces terms, credential, and bond checks after the signed
session check, so this is not a direct bypass of all gated-access rules. The
issue is that one generic signature has broader and longer read authority than
the message makes clear.

Recommended fix:

- Issue per-scope sessions from per-scope challenges, or include the requested
  scopes and TTLs in the signed message.
- Avoid issuing `gated_context` from the generic private account-read flow.
- Consider reducing default read-session TTLs for sensitive scopes such as
  notification email and agent policies.
- Add tests proving a signature for one read scope cannot mint another scope.

Contract redeploy required: No.

### RL-NCS-02: Ponder decodes `data:` payout artifacts before enforcing the size cap

Severity: Medium

Ponder enforces `ARTIFACT_MAX_BYTES` for HTTP payout artifacts by checking
`content-length` and streaming byte totals:

- `packages/ponder/src/ClusterPayoutOracle.ts:13-14`
- `packages/ponder/src/ClusterPayoutOracle.ts:86-117`

The `data:` path bypasses those checks and immediately decodes/parses the full
payload:

- `packages/ponder/src/ClusterPayoutOracle.ts:79-84`
- `packages/ponder/src/ClusterPayoutOracle.ts:141-155`

Impact: a malicious or compromised snapshot proposer can emit an on-chain
artifact URI containing a very large `data:` payload. When the Ponder indexer
processes the event, it can allocate and decode the payload before any size
rejection, potentially stalling indexing or exhausting process memory/CPU.
Artifact hashes still protect payout content integrity, but they do not protect
indexer availability before the hash is computed.

Recommended fix:

- Reject `data:` URIs whose encoded payload is above a conservative pre-decode
  threshold.
- Enforce `ARTIFACT_MAX_BYTES` again after base64 or percent decoding and before
  `JSON.parse`.
- Add tests for oversized base64 and percent-encoded `data:` artifacts.

Contract redeploy required: No.

### RL-NCS-03: Production RPC URL validation permits plaintext remote RPC

Severity: Medium

Ponder rejects localhost RPC URLs in production but does not reject remote
`http://` RPC URLs:

- `packages/ponder/ponder.config.ts:166-190`

Keeper's required `RPC_URL` validator checks URL shape and production localhost,
but not production HTTPS:

- `packages/keeper/src/config.ts:55-77`
- `packages/keeper/src/config.ts:578`

The Keeper client then uses that URL for public and wallet clients:

- `packages/keeper/src/client.ts:26-29`
- `packages/keeper/src/client.ts:40-46`

By contrast, Keeper already requires HTTPS for `PONDER_BASE_URL`, showing the
expected production pattern is available but unevenly applied:

- `packages/keeper/src/config.ts:80-112`
- `packages/keeper/src/config.ts:512-515`

Impact: if an operator accidentally configures a non-local plaintext RPC
endpoint in production, a network-path attacker can observe or tamper with
JSON-RPC reads and transaction submission. Signatures still limit direct fund
theft, but poisoned RPC responses can skew indexing, keeper decisions, receipt
handling, liveness checks, and transaction timing.

Recommended fix:

- Require `https:` or `wss:` for non-local RPC URLs whenever `NODE_ENV=production`
  or a live network is configured.
- If a private-network plaintext exception is needed, require an explicit
  break-glass env var and log it loudly at startup.
- Share one URL validator across Next.js, Ponder, Keeper, and agent CLI paths.

Contract redeploy required: No.

### RL-NCS-04: Vercel deploy helper can disable immutable installs

Severity: Medium

The Next.js deploy helper passes `YARN_ENABLE_IMMUTABLE_INSTALLS=false` to
Vercel:

- `packages/nextjs/package.json:16`

The Vercel project install command is plain `yarn install`:

- `packages/nextjs/vercel.json:2`

Impact: when this helper is used for production or preview deploys, dependency
installation can drift from the reviewed lockfile instead of failing closed.
A manifest-only dependency change, package range resolution, or accidental
lockfile mismatch can reach the build environment as unreviewed package code.

Recommended fix:

- Remove `YARN_ENABLE_IMMUTABLE_INSTALLS=false` from deploy helpers used for
  shared environments.
- Make the Vercel install command explicitly immutable, for example
  `YARN_ENABLE_IMMUTABLE_INSTALLS=true yarn install --immutable`.
- Keep any non-immutable install path as a local-only troubleshooting command
  with a visibly unsafe name and documentation.

Contract redeploy required: No.

### RL-NCS-05: Keeper production Docker image runs through dev tooling

Severity: Medium

The Keeper Dockerfile focuses the workspace without `--production`:

- `packages/keeper/Dockerfile:24-25`

The runtime command invokes `start:built-workspace-deps`:

- `packages/keeper/Dockerfile:48-49`

That script runs `tsx src/index.ts`, and `tsx` is a dev dependency:

- `packages/keeper/package.json:9-10`
- `packages/keeper/package.json:25-30`

Impact: the production Keeper container depends on dev-only tooling and a
runtime TypeScript loader. A compromise or vulnerability in dev-only dependency
code becomes production Keeper code execution, and the production dependency set
is larger than it appears.

Recommended fix:

- Compile Keeper to JavaScript during the image build and run it with `node`
  from `dist`.
- Use `yarn workspaces focus @rateloop/keeper --production` in the runtime stage,
  or use a multi-stage image that copies only built output and production
  dependencies.
- Add a CI check that the production image does not require `tsx`.

Contract redeploy required: No.

### RL-NCS-06: Certora secret-backed workflow installs unhashed PyPI packages

Severity: Medium when `CERTORAKEY` is configured

The Certora workflow pins `certora-cli` by version, but installs from PyPI
without hashes or a locked constraints file:

- `.github/workflows/certora.yaml:31-35`
- `.github/workflows/certora.yaml:162-173`

The same job later exposes `CERTORAKEY` to the prover step:

- `.github/workflows/certora.yaml:175-186`

Impact: if `certora-cli`, `solc-select`, or a transitive PyPI dependency is
compromised, code installed earlier in the job can persist into the secret-backed
prover step and exfiltrate `CERTORAKEY`. Pull requests from forks generally do
not receive repository secrets, so this is primarily a scheduled/manual/mainline
workflow risk.

Recommended fix:

- Install Certora tooling from a hash-locked requirements file with
  `--require-hashes`, or use a pinned container image controlled by the project.
- Split no-secret install/typecheck work from secret-backed prover execution
  where possible.
- Consider a restricted GitHub environment for the cloud prover secret.

Contract redeploy required: No.

### RL-NCS-07: Maintenance secret endpoints use inconsistent throttling and comparison

Severity: Low

The question-details sweep route compares secret strings directly and has no
shared route limiter:

- `packages/nextjs/app/api/attachments/details/sweep/route.ts:7-14`
- `packages/nextjs/app/api/attachments/details/sweep/route.ts:16-22`

The notification email delivery route uses constant-time comparison, but it also
lacks the shared route limiter before running delivery work:

- `packages/nextjs/app/api/notifications/email/deliver/route.ts:6-14`
- `packages/nextjs/app/api/notifications/email/deliver/route.ts:32-48`

Nearby maintenance routes already show the stronger pattern: rate limit first
and use `timingSafeEqual` for bearer/header secrets.

- `packages/nextjs/app/api/attachments/images/sweep/route.ts:16-41`
- `packages/nextjs/app/api/agent-callbacks/deliver/route.ts:25-43`

Impact: with strong random secrets this is unlikely to become practical secret
recovery, but attackers can make unlimited guesses or floods against these
maintenance endpoints. The details sweep route also exposes avoidable timing
differences in auth comparison.

Recommended fix:

- Add `checkRateLimit` to both routes before protected work.
- Use constant-time bearer/header secret comparison in the details sweep route.
- Keep response bodies generic for unauthorized requests.

Contract redeploy required: No.

### RL-NCS-08: Local E2E wallet hook is reachable from write plumbing

Severity: Low

The local E2E wallet hook supports Foundry and Base Sepolia:

- `packages/nextjs/hooks/scaffold-eth/useLocalE2ETestWalletClient.ts:13-19`

It reads a private key and optional RPC/chain selection from browser
`localStorage`:

- `packages/nextjs/hooks/scaffold-eth/useLocalE2ETestWalletClient.ts:21-31`
- `packages/nextjs/hooks/scaffold-eth/useLocalE2ETestWalletClient.ts:86-118`

The production write helper calls the hook unconditionally:

- `packages/nextjs/hooks/scaffold-eth/useScaffoldWriteContract.ts:142-158`

The hook does require the stored key's account to match the connected address,
and Base mainnet is not in the supported local E2E chains. This keeps mainnet
impact low.

Impact: on a public Base Sepolia or staging deployment, if same-origin script or
leftover test setup writes the expected localStorage keys, contract writes can
use the stored E2E key through app write plumbing instead of the normal wallet
confirmation path.

Recommended fix:

- Gate the hook behind an explicit local E2E flag plus localhost host checks.
- Refuse to create a local E2E wallet client when `VERCEL_ENV=production` or
  the page origin is not localhost.
- Add tests proving the hook returns `undefined` on non-localhost origins.

Contract redeploy required: No.

### RL-NCS-09: CSP still permits inline styles

Severity: Low

Script CSP is nonce-based and no longer includes `script-src 'unsafe-inline'`,
but style CSP still allows inline styles:

- `packages/nextjs/lib/security/contentSecurityPolicy.ts:93-106`

Impact: this is not direct script execution. If a future HTML/style injection
bug appears, inline styles leave more room for UI redress, clickjacking-like
overlays inside the page, and limited CSS-based data exposure than a nonce/hash
style policy would.

Recommended fix:

- Inventory remaining inline style requirements from React/component libraries.
- Move toward nonce/hash-based style CSP where practical.
- Keep `style-src 'unsafe-inline'` documented as an accepted residual risk until
  it can be removed.

Contract redeploy required: No.

## Non-Findings and Positive Controls

- Next.js response hardening includes HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and stricter referrer policy on token-bearing agent
  sign/handoff pages:
  `packages/nextjs/next.config.ts:11-19` and
  `packages/nextjs/next.config.ts:42-54`.
- The global middleware creates a CSP nonce per request and applies the policy
  to both request and response headers:
  `packages/nextjs/middleware.ts:8-26`.
- Image upload routes validate signed wallet/MCP ownership, declared size/MIME,
  daily quota, Vercel Blob token TTL, magic bytes, Sharp processing, and
  moderation before serving approved images:
  `packages/nextjs/app/api/attachments/images/upload/route.ts:97-180` and
  `packages/nextjs/lib/attachments/imageAttachments.ts:331-365`.
- Ponder custom API routes fail closed in production when trusted rate-limit IP
  headers or CORS origins are missing, while bearer-authenticated keeper routes
  remain available:
  `packages/ponder/src/api/index.ts:55-150`.
- Ponder metadata sync requires a bearer token in production and rejects the
  open-sync escape hatch in production:
  `packages/ponder/src/api/routes/content-routes.ts:687-702`.
- Keeper metrics and health endpoints require a bearer token when bound to a
  non-loopback address:
  `packages/keeper/src/config.ts:879-887` and
  `packages/keeper/src/metrics.ts:236-389`.
- `yarn.lock` uses npm/workspace/builtin patch resolutions in the checked
  sample; no git/http/file/portal/link package sources were identified in the
  lockfile search.
- Existing local working-tree changes were present before this review:
  `packages/nextjs/config/nextConfigCsp.test.ts` and
  `tmp/rateloop-rating-system-handoff/`. They were not modified or included in
  this report commit.

# Security Review Findings - 2026-06-25

> **Superseded historical snapshot.** This report records the first 2026-06-25
> security review pass. Several findings were fixed or reclassified after this
> snapshot. Use
> [`repo-review-findings-2026-06-25-followup.md`](repo-review-findings-2026-06-25-followup.md)
> for the same-day re-review and
> [`repo-review-findings-2026-06-26.md`](repo-review-findings-2026-06-26.md)
> for the latest non-contract review baseline.

## Scope

This was a no-fix security review across the RateLoop monorepo. I reviewed the
Solidity contracts, deployment artifacts, Next.js API routes, sponsored/free
transaction paths, MCP/agent handoff surfaces, Ponder artifact fetching, keeper
liveness, SDK webhook verification, dependency state, and committed secret
hygiene.

The review treats the already deployed Base mainnet contract stack as durable
production infrastructure. I did not find a contract-level issue that warrants a
production redeploy.

## Verification Performed

- `yarn npm audit --recursive --environment production` returned no audit
  suggestions.
- `yarn npm audit --recursive` returned no audit suggestions.
- `yarn foundry:slither` analyzed 161 contracts with 35 detectors and reported
  0 findings.
- Contract-focused subagent verification ran:
  - `forge test --match-contract 'ClusterPayoutOracleTest|ProtocolConfigBranchesTest|FrontendRegistryTest|FrontendRegistryCoverageTest|RaterRegistryTest'`
    and passed 380 tests.
  - `forge test --match-contract 'LaunchDistributionPoolTest|QuestionRewardPoolEscrowTest'`
    and passed 310 tests.
- Tracked env-file scan found only examples and the public production template:
  `packages/agents/.env.example`, `packages/foundry/.env.example`,
  `packages/keeper/.env.example`, `packages/nextjs/.env.example`,
  `packages/nextjs/.env.production`, and `packages/ponder/.env.example`.
- Targeted secret-pattern scan found test fixtures, examples, generated local
  helper output, and public config references, but no apparent committed private
  deployment secret.
- Parallel subagent reviews covered frontend/API, Solidity/deployment, and
  off-chain agents/keeper/Ponder/SDK surfaces.

## Findings

### RL-SEC-01 - Medium - Required keeper lock failures can look like healthy successful runs

When `KEEPER_MAIN_LOOP_LOCK_REQUIRED=true`, `runWithKeeperMainLoopLock` returns
the successful fallback if schema initialization fails or if the advisory lock is
unavailable:

- `packages/keeper/src/keeper-state.ts:184-196`
- `packages/keeper/src/keeper-state.ts:211-223`

The caller increments `keeper_main_loop_lock_skips_total` when the main loop did
not run, but still calls `recordRun`:

- `packages/keeper/src/index.ts:178-225`

`recordRun` updates `keeper_last_successful_run_timestamp`, resets
`consecutiveErrors`, and makes the health check depend on the new successful run
timestamp:

- `packages/keeper/src/metrics.ts:91-110`
- `packages/keeper/src/metrics.ts:190-204`

Impact: a DB outage, schema initialization failure, or lock subsystem failure
can make every keeper skip settlement, reveal, dormancy, fee sweep, and snapshot
work while `/health` continues to return healthy. This is a liveness failure
that can suppress alerting.

Fix direction: distinguish "busy, another keeper owns the lock" from
"unavailable, the required lock subsystem failed." Required-lock unavailable
states should throw or return an error status that calls `recordError` and
degrades health.

### RL-SEC-02 - Medium - Public thumbnail endpoint can be abused as an outbound fetch relay

`POST /api/thumbnails` is unauthenticated, allows 60 requests per minute per
rate-limit key, and accepts up to 40 URLs per request:

- `packages/nextjs/app/api/thumbnails/route.ts:7-35`

The implementation does apply meaningful SSRF controls: `isSafeUrl` filters
unsafe URLs, and metadata fetching uses a pinned public HTTPS request helper:

- `packages/nextjs/app/api/thumbnails/route.ts:27-35`
- `packages/nextjs/lib/contentMetadata/server.ts:78-103`
- `packages/nextjs/utils/safeFetch.ts:44-90`

Impact: this is not a private-network SSRF finding based on the current checks.
It is still an unauthenticated outbound-fetch relay against arbitrary public
HTTPS pages, with enough volume for scanning, egress abuse, or reputation damage
if attackers rotate clients.

Fix direction: require a signed/sessioned context or bind thumbnail fetches to a
submitted content flow, lower anonymous quotas, add host/cardinality controls,
and cache URL metadata aggressively.

### RL-SEC-03 - Medium - Local/E2E flags widen Ponder payout artifact fetching to localhost

Ponder payout artifact fetching normally accepts data URIs, allowlisted HTTPS
origins, IPFS through `ipfs.io`, and Arweave through `arweave.net`. Local HTTP
artifact URLs are only intended for hardhat/local use, but the local HTTP gate
also opens when either production-style E2E flag is set:

- `packages/ponder/src/ClusterPayoutOracle.ts:172-213`
- `packages/ponder/src/api/payout-proofs.ts:261-303`

The fetches are real outbound requests:

- `packages/ponder/src/ClusterPayoutOracle.ts:79-92`
- `packages/ponder/src/api/payout-proofs.ts:176-214`

Docs correctly describe the flags as local E2E-only and production Ponder as
`PONDER_NETWORK=base` with `NODE_ENV=production`:

- `docs/env-parity.md:103-105`
- `packages/ponder/README.md:58-63`
- `packages/ponder/.env.example:4-8`

Impact: if `RATELOOP_E2E_PRODUCTION_BUILD=true` or
`NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD=true` leaks into a deployed Ponder
environment, a payout artifact URI can make the indexer/API fetch
`localhost`, `127.0.0.1`, or `[::1]`. Artifact hashes still protect payout
content integrity, but the request itself can hit local services and can produce
unexpected indexer/API behavior.

Fix direction: gate local HTTP artifacts only on `PONDER_NETWORK=hardhat` or a
Ponder-specific server-only dev flag that is rejected when `NODE_ENV=production`
or a live-chain network is active. Add startup validation that fails live Ponder
when E2E production-build flags are present.

### RL-SEC-04 - Medium - SDK webhook verifier default path allows replay within the timestamp window

`buildWebhookVerifier` makes replay protection optional:

- `packages/sdk/src/agent.ts:775-782`
- `packages/sdk/src/agent.ts:1360-1380`

Without `replayProtection`, `assertValid` only verifies event id, timestamp
freshness, and HMAC signature, then returns success for repeated deliveries
until the default 300-second tolerance expires:

- `packages/sdk/src/agent.ts:1382-1424`

The replay-safe `handleOnce` path exists only when a replay store is configured:

- `packages/sdk/src/agent.ts:1427-1457`

The README shows `assertValid` before introducing the replay-safe verifier:

- `packages/sdk/README.md:241-254`

Impact: integrations that follow the first verifier pattern and do
non-idempotent work after `assertValid` can double-process a captured callback
within the freshness window.

Fix direction: make replay-safe handling the default example and API path for
webhooks. Consider renaming the current behavior to an explicit
signature-only verifier, or require an `allowReplay: true` opt-in.

### RL-SEC-05 - Low - Production deploy bypass flag can hide TypeScript and ESLint failures

The Next.js build ignores TypeScript and ESLint failures whenever
`NEXT_PUBLIC_IGNORE_BUILD_ERROR=true`:

- `packages/nextjs/next.config.ts:160-165`

The production deploy helper exposes this through `yarn vercel:yolo`:

- `packages/nextjs/package.json:16-18`

The example env file also documents the flag:

- `packages/nextjs/.env.example:158-162`

Impact: this is an operator/supply-chain footgun rather than a direct runtime
exploit. If the bypass is used for production, route-handler or security-check
type failures can ship unnoticed. The `NEXT_PUBLIC_` prefix also makes the flag
easy to cargo-cult into environments.

Fix direction: remove or preview-gate the script, use a server-only unsafe flag,
and fail production builds if the bypass is set.

### RL-SEC-06 - Low - Public operation status exposes callback delivery metadata to anyone holding the operation key

Public operation lookup accepts a 32-byte `operationKey` and loads callback
delivery status for public wallet-mode operations:

- `packages/nextjs/lib/mcp/tools.ts:2616-2627`
- `packages/nextjs/lib/mcp/tools.ts:2669-2675`
- `packages/nextjs/lib/mcp/tools.ts:3588-3595`

The normalized delivery response includes callback URL, attempt count, last
error, status, and timing fields:

- `packages/nextjs/lib/mcp/tools.ts:2470-2482`

Impact: guessing the key is not practical, but anyone who sees it can retrieve
callback diagnostics. If a callback URL or error message contains sensitive query
tokens or internal details, those details leak to the key holder.

Fix direction: redact `callbackUrl` and `lastError` from public status, or
require submitter proof/bearer auth for delivery diagnostics.

### RL-SEC-07 - Low - Global CSP still allows inline scripts and styles

The production CSP includes `unsafe-inline` in `script-src` and `style-src`:

- `packages/nextjs/next.config.ts:75-84`

Impact: this does not create an XSS by itself, but it makes a future injection
bug easier to turn into script execution.

Fix direction: move toward nonce/hash-based CSP for Next bootstrap scripts and
keep inline allowances only where strictly required.

## Hardening Notes and Non-Findings

- No Solidity finding from this pass requires a production contract redeploy.
- `yarn foundry:slither` was clean, and targeted Foundry tests passed.
- The thirdweb sponsored transaction verifier fails closed when
  `THIRDWEB_SERVER_VERIFIER_SECRET` is unset and uses timing-safe secret
  comparison. `packages/nextjs/.env.production` intentionally leaves that secret
  blank while dashboard env remains authoritative.
- The direct agent handoff image API revalidates MIME signature, decoded byte
  length, SHA-256, and processability before staging uploaded/generated images.
  The local CLI's extension fallback is worth tightening, but the server path
  prevents accepting arbitrary non-image bytes as staged handoff images.
- MCP CORS defaults fail closed when `RATELOOP_MCP_ALLOWED_ORIGINS` is unset.
  This is not data exposure, but production docs/startup validation should keep
  operators from overcorrecting to `*`.
- `FrontendRegistry.slashFrontendWithBounty` intentionally relies on governance
  process to pass the recorded ClusterPayoutOracle challenger as the bounty
  recipient. A runbook/helper check would reduce operator error, but this is not
  a public exploit.
- Deployment artifacts record the current production deployment, but they are not
  full live state attestations. A read-only post-deploy/state-attestation script
  for role holders, proxy admins, key config pointers, and code hashes would be
  useful defense in depth.

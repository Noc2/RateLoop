# RateLoop Non-Contract Re-Review Follow-Up - 2026-06-27

## Scope

This follow-up reviewed `origin/main` at commit
`a2ecb4f33f6cb007019debe1c74197cf4b68455c` from a clean temporary
worktree. The primary checkout had unrelated local edits, so it was not pulled
or modified.

Smart contracts, Solidity, Foundry tests, and production contract deployment
strategy were intentionally out of scope. The deployed Base mainnet contract
stack was treated as durable production infrastructure. None of the findings
below requires or suggests a production contract redeploy.

Reviewed areas:

- Next.js API routes, confidentiality routes, agent handoff/signing paths,
  thirdweb/free-transaction flows, and shared validation.
- SDK, agents, local signer, node-utils integration, and package scripts.
- Ponder, Keeper, service runtime configs, Railway/Docker health behavior, and
  operator docs.
- CI/workflow/package-script consistency outside smart contracts.

## Verification Performed

- Ran four read-only parallel subreviews covering app/API security, runtime
  services, SDK/agent tooling, and CI/docs hygiene.
- Manually verified each carried-forward finding against the current code.
- Ran `node scripts/run-node-tests.mjs scripts/release-package-metadata.test.mjs`
  successfully.
- Ran targeted static searches for route auth/rate limiting, JSON parsing,
  deployment-scope handling, Base/World Chain documentation drift, and
  workspace dist-lock usage.

## Executive Summary

Current main is materially cleaner than the earlier June 27 reports: app URL
validation, bounded World ID JSON parsing, webhook-secret sealing, publish
workflow guards, root `yarn test`, and several prior dependency/workflow issues
are already fixed.

The fresh issues are mostly off-chain correctness and operator consistency
bugs. The highest-impact finding is that valid LREP wallet-call agent
submissions can be executed on-chain and then fail local confirmation because
the expected reward asset is stored as USDC. The most important operational
finding is that deployment-scoped confidentiality state still seals a single
epoch-only log root, which can mix evidence across deployments sharing one app
database.

## Findings

### RL-NC-FU-01: LREP wallet-call submissions store USDC as the expected reward asset

Severity: High

`serializeExpectedRewardTerms` records the planned reward asset as USDC for
every permissionless wallet-call submission:

- `packages/nextjs/lib/x402/questionSubmission.ts:529-537`

The actual wallet-call plan correctly derives the reward asset from
`payload.bounty.asset`:

- `packages/nextjs/lib/x402/questionSubmission.ts:1635-1646`

Confirmation later compares the stored expected terms to indexed reward
attachments, including `asset`:

- `packages/nextjs/lib/x402/questionSubmission.ts:756-767`
- `packages/nextjs/lib/x402/questionSubmission.ts:2578-2587`

Impact: a valid LREP-funded wallet-call ask can submit successfully on-chain,
but the confirmation step can reject it with "Confirmed submission did not
attach the planned bounty terms." That leaves the agent/browser flow reporting
failure after a real transaction and can block follow-up automation that depends
on a confirmed operation.

Recommended fix:

- Store `submissionRewardAssetId(payload.bounty.asset).toString()` in
  `serializeExpectedRewardTerms`.
- Add a regression test for LREP wallet-call confirmation that proves indexed
  LREP reward attachments match the stored expected terms.

Contract redeploy required: No.

### RL-NC-FU-02: Confidentiality log roots are still epoch-only while confidentiality rows are deployment-scoped

Severity: Medium

The deployment-scope migration added `deployment_key`, `chain_id`, and
`content_registry_address` to confidentiality acceptances, access logs, and
breach reports:

- `packages/nextjs/drizzle/0011_confidentiality_deployment_scope.sql:18-44`

However `confidentiality_log_roots` is still keyed only by `epoch`:

- `packages/nextjs/lib/db/schema.ts:595-616`

Publishing selects all acceptances and access logs for the day without a
deployment filter, then seals the resulting artifact under that single epoch:

- `packages/nextjs/lib/confidentiality/context.ts:1246-1308`
- `packages/nextjs/lib/confidentiality/context.ts:1325-1398`

Artifact reads and breach evidence lookup also select roots by epoch only:

- `packages/nextjs/app/api/confidentiality/log-roots/[epoch]/artifact/route.ts:17-25`
- `packages/nextjs/app/api/confidentiality/breaches/route.ts:201-214`

Impact: if one app database holds rows for multiple deployments, a log root can
mix unrelated deployment evidence. A breach report for one deployment can then
reference an epoch artifact whose Merkle root also commits to accesses from
another deployment, making the evidence boundary ambiguous.

Recommended fix:

- Add deployment scope columns to `confidentiality_log_roots` and key roots by
  deployment plus epoch.
- Filter root publication inputs by deployment and include the deployment key in
  artifact/hash material.
- Require breach evidence to resolve the root for the same deployment as the
  matching access log.

Contract redeploy required: No.

### RL-NC-FU-03: Ponder Railway healthcheck path is not aligned with the repo's declared health endpoints

Severity: Medium

Railway probes `/ready`:

- `packages/ponder/railway.toml:5-7`

The Ponder API bootstrap and README document `/health` and `/status` as the
reserved framework health/status routes, and the Next.js availability client
checks `/health`:

- `packages/ponder/src/api/index.ts:168`
- `packages/ponder/README.md:126`
- `packages/nextjs/services/ponder/client.ts:482-486`

Impact: the repo does not codify `/ready` as the Ponder service health
contract. If the deployed Ponder runtime does not serve that route, Railway can
mark the indexer unhealthy even while `/health`, `/status`, and app-side
availability checks would pass.

Recommended fix:

- Change `packages/ponder/railway.toml` to probe `/health` or `/status`, or add
  an explicit `/ready` route and tests/docs that make `/ready` a real supported
  endpoint.

Contract redeploy required: No.

### RL-NC-FU-04: Free transaction confirmation returns success when no reservation was confirmed

Severity: Medium

`confirmFreeTransactionReservation` records non-success outcomes such as
`missing_reservation`, `already_confirmed`, `ignored_*`, and `update_skipped`,
but it does not return those outcomes to the caller:

- `packages/nextjs/lib/thirdweb/freeTransactions.ts:2331-2384`

The API route always returns `{ ok: true }` whenever the helper does not throw:

- `packages/nextjs/app/api/transactions/free/confirm/route.ts:31-38`

Impact: if the client recomputes the wrong `operationKey`, confirms after
reservation state has diverged, or hits a race where no pending row is updated,
the caller sees success even though quota accounting was not actually confirmed.
That can leave pending/consumed quota state stuck while hiding the condition
from the browser or operator tooling.

Recommended fix:

- Return the confirmation outcome from `confirmFreeTransactionReservation`.
- Have the route surface `missing_reservation`, `reservation_mismatch`,
  `ignored_*`, and `update_skipped` as explicit non-success responses.
- Consider returning the canonical reservation key from the verifier so the
  client does not have to recompute it independently.

Contract redeploy required: No.

### RL-NC-FU-05: Keeper Docker healthcheck conflicts with lock-skipped standby replicas

Severity: Medium

Production docs recommend replicas with the advisory main-loop lock enabled:

- `packages/keeper/README.md:67`
- `packages/keeper/README.md:203`

When another keeper holds the lock, the process records a lock skip and returns
without refreshing successful run health:

- `packages/keeper/src/keeper-state.ts:390-396`
- `packages/keeper/src/index.ts:219-222`

The metrics server exposes `/live` for process liveness, but Docker probes
`/health`, which only returns healthy after recent successful runs:

- `packages/keeper/src/metrics.ts:205-240`
- `packages/keeper/src/metrics.ts:357-365`
- `packages/keeper/Dockerfile:52-53`

Impact: a standby/contending keeper replica can be behaving correctly by
skipping work while another replica owns the lock, yet still fail the container
healthcheck and get restarted by hosts that honor Docker health checks.

Recommended fix:

- Use `/live` for container liveness and keep `/health` as active-worker
  readiness, or report a distinct healthy standby state for recent lock skips.
- Update the Dockerfile, README, and metrics tests together.

Contract redeploy required: No.

### RL-NC-FU-06: Workspace dist lock can be stolen from an active long-running command

Severity: Medium

The workspace dist lock uses a lock directory with a default stale timeout:

- `scripts/with-workspace-dist-lock.mjs:7-9`

The directory mtime is written only when acquired and is not refreshed while the
child command runs:

- `scripts/with-workspace-dist-lock.mjs:46-57`

After `STALE_LOCK_MS`, another waiting process can remove the directory and
start its own dist-mutating command even if the first process is still running:

- `scripts/with-workspace-dist-lock.mjs:61-68`

Impact: long `test:ts`, `next:build`, or workspace package checks can exceed the
default 10 minute stale window. A second process can then delete an active lock,
reintroducing the shared `dist` race the lock was meant to prevent.

Recommended fix:

- Add a heartbeat file or periodically refresh the lock directory mtime while
  the child process is alive.
- Before removing a stale lock, verify owner PID/host liveness where possible.
- Add a regression test for an old lock timestamp with a still-live owner.

Contract redeploy required: No.

### RL-NC-FU-07: Confidentiality bond validation misses the `uint64` upper bound

Severity: Low

The shared agent parser accepts a non-negative confidentiality bond and enforces
the minimum nonzero amount, but it does not cap the value at `uint64.max`:

- `packages/agents/src/x402QuestionPayload.ts:656-667`

The same amount is later ABI-encoded as `uint64` when computing the
confidentiality hash:

- `packages/agents/src/x402QuestionPayload.ts:688-699`
- `packages/agents/src/localSigner.ts:429-443`
- `packages/nextjs/lib/x402/questionSubmission.ts:147-156`

Impact: an oversized value such as `18446744073709551616` can pass the friendly
input parser and then fail later with a low-level ABI encoding error. This is
not a bypass, but it produces inconsistent error handling and weaker client
feedback.

Recommended fix:

- Add a shared max check of `2^64 - 1` beside the existing minimum check.
- Cover the limit in agent parser, local signer, and server-side x402 tests.

Contract redeploy required: No.

### RL-NC-FU-08: Signing-intent completion accepts malformed or unbounded transaction hash arrays before downstream rejection

Severity: Low

The signing-intent path accepts any array of strings as `transactionHashes`:

- `packages/nextjs/lib/agent/signingIntents.ts:87-95`
- `packages/nextjs/lib/agent/signingIntents.ts:513-521`

The handoff completion path has a tighter route-boundary contract with max
count and 32-byte hex validation:

- `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:23-38`

Downstream confirmation still rejects malformed hashes, so this is not a
transaction-verification bypass. The inconsistency means malformed or huge
arrays can reach deeper confirmation logic and be persisted in failure state.

Recommended fix:

- Reuse the handoff transaction-hash validator for signing-intent completion.
- Reject malformed hashes before invoking confirmation or storing failure
  details.

Contract redeploy required: No.

### RL-NC-FU-09: Confidentiality job-auth routes count rate limits only after successful auth

Severity: Low

The confidentiality log-root publish route authenticates before rate limiting:

- `packages/nextjs/app/api/confidentiality/log-roots/publish/route.ts:30-34`

The disclosure reconciliation route has the same ordering:

- `packages/nextjs/app/api/confidentiality/disclosure/reconcile/route.ts:26-31`

Other protected job-style routes generally rate-limit unauthorized guesses
before doing secret comparison. Here, bad-secret probes are rejected without
being counted by the app's DB-backed limiter.

Impact: brute forcing a strong bearer secret remains impractical, so severity is
low. The inconsistency reduces visibility and allows unlimited unauthenticated
probing of these job endpoints at the app limiter layer.

Recommended fix:

- Add a pre-auth route-wide limiter before `requireConfidentialityJobAuth`, or
  wrap the job-auth helper so failed attempts are counted consistently.

Contract redeploy required: No.

### RL-NC-FU-10: Ponder schema env example still points operators at static schemas

Severity: Low

The runtime prefers deployment-derived schemas for live networks when deployment
artifacts are present:

- `packages/ponder/scripts/databaseSchema.mjs:164-228`
- `packages/ponder/scripts/start.mjs:220-242`

Readiness checks expect the live Ponder database schema to match the deployment
artifact:

- `scripts/readiness-core.mjs:1308-1318`

`packages/ponder/README.md` mostly explains the newer behavior, but
`packages/ponder/.env.example` still describes the default as a static
network-owned schema such as `rateloop_ponder_base_sepolia`:

- `packages/ponder/.env.example:73-78`

Impact: an operator following the env example can set a static override that
fights the deployment-scoped startup/readiness model, especially during
incident/governance migrations where content IDs or contract addresses can
restart under a new deployment key.

Recommended fix:

- Update `.env.example` to say live networks default to protocol-deployment
  schemas when artifacts are available.
- Keep static schema examples only as explicit overrides/fallbacks and link to
  the README's production schema collision guidance.

Contract redeploy required: No.

## Not Carried Forward

- Earlier findings about app URL validation, bounded World ID JSON parsing,
  browser-visible webhook secrets, publish workflow guards, and the narrow root
  `yarn test` signal appear fixed on current main.
- The broad `with-workspace-dist-lock` `shell: true` concern was not carried as a
  separate finding because current package scripts pass fixed internal commands
  to the wrapper. The active stale-lock issue above is the concrete reliability
  risk in current usage.
- The promo-video copy previously flagged as World Chain stale now references
  Base mainnet where relevant.

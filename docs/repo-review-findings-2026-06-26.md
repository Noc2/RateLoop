# RateLoop Non-Contract Repo Review Findings - 2026-06-26

## Scope

This was a read-only review of the RateLoop monorepo outside the smart contracts.
The review focused on production bugs, off-chain security boundaries, deployment
configuration, agent handoff paths, Ponder/Keeper wiring, shared packages, and
test coverage gaps. Solidity and Foundry contract logic were intentionally out
of scope.

Current review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch: `main`
- Reviewed HEAD: `6b26460f5`
- Date: 2026-06-26

## Verification Performed

- Reviewed prior 2026-06-25 report and follow-up notes to avoid re-reporting
  issues that current code already addresses.
- Ran four parallel read-only review agents covering:
  - Next.js app/API/env/service paths.
  - Agent CLI, handoff, MCP, x402, and browser-signing paths.
  - Ponder, Keeper, readiness workflows, and chain/env wiring.
  - Shared TypeScript packages, package metadata, scripts, and cross-package
    imports.
- Manually verified each included finding against current source line references.
- Did not run live service probes or full build/test suites for this report.
- Did not change application code.

## Executive Summary

No critical issue was found, and no finding requires a production contract
redeploy. The highest-priority issues are off-chain validation and operational
isolation problems:

1. Browser x402 signing validates the prepared typed data shape but does not
   recompute the payload-bound RateLoop nonce or enforce the 24-hour validity
   cap used by the local signer.
2. Ponder database schema overrides can point a Base deployment at stale or
   foreign-network tables even while deployment metadata reports the expected
   chain.
3. Base readiness workflows can pass live probes without checking that the
   Keeper service is actually alive or healthy.

## Findings

### RL-NC-01: Browser x402 signing is not bound back to the visible ask payload

Severity: Medium

The browser handoff path validates that the returned x402 authorization matches
its EIP-712 typed data, uses the expected chain, USDC token, submitter, wallet,
amount, and that `validBefore > validAfter`:

- `packages/nextjs/lib/agent/browserSigningValidation.ts:215-251`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2532-2567`

The local signer performs two additional checks before signing:

- It caps `validBefore` to 24 hours from now:
  `packages/agents/src/localSigner.ts:1348-1367`
- It recomputes the expected RateLoop ask nonce from the question payload,
  reward terms, round config, escrow addresses, submitter, and Feedback Bonus
  terms, then requires the authorization nonce to match:
  `packages/agents/src/localSigner.ts:3942-3981`

Impact: a buggy or compromised prepare response could get a browser wallet to
sign an EIP-3009 authorization that is internally consistent with the returned
typed data but not proven to correspond to the handoff draft the user is seeing,
or one with an unexpectedly long authorization window.

Recommended fix:

- Reuse or share the canonical x402 nonce builder in browser signing
  validation.
- Include the one-shot Feedback Bonus nonce variant and uploaded-image/details
  inputs in the browser-side expected nonce calculation.
- Reject authorizations whose `validBefore` exceeds the same 24-hour cap used by
  the local signer.
- Add tests proving mutated nonce and long-validity authorizations are rejected
  before `signTypedDataAsync`.

Contract redeploy required: No.

### RL-NC-02: Ponder schema override can mix Base data with stale network data

Severity: Medium

`resolvePonderDatabaseSchema` prefers `RATELOOP_PONDER_DATABASE_SCHEMA` and a
non-legacy `DATABASE_SCHEMA` over protocol-deployment-derived and
Railway-derived schemas:

- `packages/ponder/scripts/databaseSchema.mjs:129-151`

Only two old canary schema names are ignored when a replacement schema can be
derived:

- `packages/ponder/scripts/databaseSchema.mjs:11-15`
- `packages/ponder/scripts/databaseSchema.mjs:136-143`

Impact: if a live Base deployment carries a stale explicit schema such as a
World Chain or old staging schema, Ponder can index and serve from the wrong
tables while `/deployment` and other deployment metadata still report the
expected Base deployment. Since core Ponder tables are not all chain-scoped,
schema isolation is part of the runtime chain boundary.

Recommended fix:

- For non-local `PONDER_NETWORK` values, reject known foreign-network static
  schemas unless a deliberate break-glass flag is set.
- Prefer protocol-deployment-derived schemas over generic static overrides for
  live networks, or require an explicit override reason.
- Add tests for `PONDER_NETWORK=base` with stale
  `RATELOOP_PONDER_DATABASE_SCHEMA` and `DATABASE_SCHEMA` values.
- Add readiness validation that the active schema source and value match the
  expected deployment-derived schema in production.

Contract redeploy required: No.

### RL-NC-03: Base readiness does not verify Keeper liveness or health

Severity: Medium

The Base mainnet and Base Sepolia readiness workflows provide app, Ponder, RPC,
database, and metrics-related environment variables, but no Keeper URL:

- `.github/workflows/base-mainnet-readiness.yaml:26-57`
- `.github/workflows/base-sepolia-readiness.yaml:26-58`

The shared live readiness function probes RPC, Ponder, and the app, but has no
Keeper target parameter and does not call Keeper `/live` or `/health`:

- `scripts/check-worldchain-sepolia-readiness.mjs:1019-1055`

The Keeper service already exposes `/live` without auth and `/health` behind the
metrics auth check:

- `packages/keeper/src/metrics.ts:339-371`

Impact: scheduled or manually triggered Base readiness can pass while the Keeper
is down, crash-looping, or stuck unhealthy. That can leave reveal, settlement,
dormancy, Feedback Bonus forfeits, frontend fee claims, and correlation snapshot
automation stalled despite a green readiness workflow.

Recommended fix:

- Add `BASE_KEEPER_URL` and `BASE_SEPOLIA_KEEPER_URL` workflow variables.
- Probe `/live` whenever live readiness targets are required.
- In strict live mode, probe `/health` with `METRICS_AUTH_TOKEN` when configured
  and require `status: "ok"`, recent `lastRun`, and `consecutiveErrors === 0`.
- Add tests for missing Keeper URLs when `--live --require-live-targets` is set.

Contract redeploy required: No.

### RL-NC-04: Agent parser rejects local HTTP attachment URLs that the app allows

Severity: Low

The agent x402 parser exposes an `allowLocalhostAttachmentOrigins` option and
enables it outside production or in local E2E production builds:

- `packages/agents/src/x402QuestionPayload.ts:132-149`

However, uploaded image URLs still require `https:`:

- `packages/agents/src/x402QuestionPayload.ts:399-414`
- `packages/agents/src/x402QuestionPayload.ts:420-430`

The Next.js attachment helper allows `http://localhost` when localhost origins
are enabled:

- `packages/nextjs/lib/attachments/imageAttachmentUrls.ts:48-92`

Impact: local MCP or browser-handoff flows can produce localhost image URLs that
the app-side attachment layer treats as valid, while agent linting/parsing
rejects the same URLs. This creates a local development and E2E inconsistency,
especially around file-backed handoffs and generated image flows.

Recommended fix:

- Move attachment URL normalization into shared code, or mirror the app helper's
  protocol rule in the agent parser.
- Add tests that `http://localhost` image/details URLs are accepted only when
  localhost attachment origins are explicitly allowed.
- Keep production behavior HTTPS-only.

Contract redeploy required: No.

### RL-NC-05: Multi-image staged handoff upload relies on unstable asset ordering

Severity: Low

The file-backed handoff CLI uploads each generated image to `assets[index]` from
the handoff creation response:

- `packages/agents/src/handoffUpload.ts:305-334`

Server-side asset rows are inserted in a loop with the same handoff-level
timestamp value:

- `packages/nextjs/lib/agent/handoffs.ts:949-965`

Assets are later listed by `created_at ASC` only:

- `packages/nextjs/lib/agent/handoffs.ts:749-756`

Impact: repeated `--image` staged uploads can depend on database tie-breaking
for rows with identical timestamps. If returned asset order differs from request
order, the CLI can upload image A to asset B and hit filename, size, or SHA
mismatch failures.

Recommended fix:

- Persist an explicit asset position and order by it.
- Alternatively, have the CLI match assets by duplicate-safe metadata instead of
  positional index.
- Add a regression test where the API returns two staged assets in reverse order.

Contract redeploy required: No.

### RL-NC-06: npm publish-order test does not guard node-utils

Severity: Low

The publish workflow currently publishes in the correct order:

- `.github/workflows/publish-npm.yaml:86-89`

But the metadata test only checks `contracts -> sdk -> agents`; it does not
assert that `rateloop-node-utils.tgz` remains before SDK and agents:

- `scripts/release-package-metadata.test.mjs:101-115`

Impact: this is not a current release break, but a future workflow edit could
move `node-utils` after packages that depend on it without the release metadata
test catching the regression.

Recommended fix:

- Assert `contracts < node-utils < sdk < agents` in the publish-order test.
- Verify with `node --test scripts/release-package-metadata.test.mjs`.

Contract redeploy required: No.

## Notes and Non-Findings

- The Next.js app/API review did not identify a new high-confidence
  production-impacting finding beyond the issues above.
- Several 2026-06-25 findings appear addressed in current code: Ponder local
  artifact fetching is hardhat-only, the generic SDK webhook verifier now
  requires replay protection unless `allowReplay: true` is explicit,
  `NEXT_PUBLIC_IGNORE_BUILD_ERROR=true` is rejected by config guards, and public
  callback delivery status is redacted.
- Existing local working-tree changes were present before this report:
  `packages/nextjs/config/nextConfigCsp.test.ts` and
  `tmp/rateloop-rating-system-handoff/`. They were not part of this review
  report and should not be included in the report commit.

# RateLoop Non-Contract Repo Re-Review Findings - 2026-06-26

## Scope

This was a read-only re-review of the RateLoop monorepo outside smart contract
code. The review focused on off-chain production bugs, agent/MCP handoff flows,
SDK and agent payload normalization, Ponder/Keeper runtime wiring, readiness
checks, CI/deployment configuration, and cross-package inconsistencies. Solidity
and Foundry contract logic were intentionally out of scope.

Current review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch: `main`
- Reviewed HEAD: `0e003afb2`
- Date: 2026-06-26

This document is a report only. No application code, configuration, deployment
artifact, or smart contract file was changed.

## Verification Performed

- Re-read the June 25 and June 26 non-contract review reports to avoid
  re-reporting items already fixed on current `main`.
- Used three parallel read-only review agents covering:
  - Next.js app/API, browser handoffs, and client-side agent flows.
  - Agent CLI, SDK, node-utils, x402 payload normalization, and local signer
    behavior.
  - Ponder, Keeper, readiness scripts, workflow wiring, and deployment
    consistency.
- Manually verified each included finding against current source line
  references.
- Checked the previous request-derived agent URL fix and confirmed that the
  handoff/signing routes now use a canonical production app base URL, while one
  policy-token response path still does not.
- Did not run full build/test suites or live service probes for this report.
- Existing local working-tree changes were present before the review. They were
  not modified for this report and should not be included with this report
  commit.

## Executive Summary

No critical or high-severity issue was found, and no finding below requires a
production smart contract redeploy. The highest-priority items are off-chain
correctness and operational guardrails:

1. Generated-image browser handoffs can prepare an x402 authorization for one
   ask body and then validate the browser signature against another.
2. The policy-token rotation endpoint still emits a bearer-token MCP config URL
   derived from the request origin.
3. Ponder can still be launched with an explicit `--schema` that bypasses the
   live deployment schema guard.
4. Strict live readiness can still skip Keeper `/health` if the metrics token is
   absent.

## Findings

### RL-NC-RR-01: Generated-image x402 handoffs can reject their own prepared authorization

Severity: Medium

Single-question USDC browser handoffs default to `x402_authorization`:

- `packages/nextjs/lib/agent/handoffs.ts:271-279`

When generated handoff images are staged, creation validates the request using
temporary validation image URLs, but the stored `requestBody` remains the draft
body:

- `packages/nextjs/lib/agent/handoffs.ts:890-905`

During prepare, the server builds the actual ask by adding the uploaded image
URLs and sends that image-inclusive body to `rateloop_ask_humans`:

- `packages/nextjs/app/api/agent/handoffs/[handoffId]/prepare/route.ts:296-312`
- `packages/nextjs/lib/agent/handoffs.ts:1234-1243`

The prepare response then returns the serialized handoff, whose `requestBody` is
still the stored draft:

- `packages/nextjs/app/api/agent/handoffs/[handoffId]/prepare/route.ts:356-367`
- `packages/nextjs/lib/agent/handoffs.ts:835-849`

The browser-side x402 validation recomputes the expected nonce from
`prepared.requestBody ?? handoff?.requestBody`, not from the exact ask body used
by the server to prepare the authorization:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2558-2570`

Impact: a generated-image handoff can receive an x402 authorization request for
the image-inclusive ask, then fail browser validation with
`EIP-3009 authorization.nonce does not match the RateLoop ask payload.` This
blocks the intended file-backed/generated-image browser handoff path unless the
operator avoids x402 or the image URLs are persisted before validation.

Recommended fix:

- Return the exact server-built ask body used for `rateloop_ask_humans` from the
  prepare route and validate the browser x402 nonce against that body.
- Alternatively, persist approved generated image URLs into the handoff draft
  before returning the authorization.
- Add a regression test for generated images plus default USDC
  `x402_authorization` proving the expected nonce includes uploaded image URLs.

Contract redeploy required: No.

### RL-NC-RR-02: Policy-token rotation still returns a request-origin MCP URL with the bearer token

Severity: Medium

The previous request-derived agent URL issue is mostly fixed: handoff and
signing-intent routes now resolve production URLs through
`resolveAgentAppBaseUrl` and fail closed when a canonical app URL is missing:

- `packages/nextjs/lib/agent/appBaseUrl.ts:43-49`
- `packages/nextjs/app/api/agent/handoffs/route.ts:27-35`
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/route.ts:62-69`
- `packages/nextjs/app/api/agent/signing-intents/route.ts:24-32`

The policy-token rotation endpoint still builds the returned MCP config URL from
the incoming request URL:

- `packages/nextjs/app/api/agent/policies/token/route.ts:16-30`
- `packages/nextjs/app/api/agent/policies/token/route.ts:80-89`

That same object includes the freshly rotated bearer token in the
`Authorization` header:

- `packages/nextjs/app/api/agent/policies/token/route.ts:20-26`

Impact: if production proxy or host handling ever accepts attacker-controlled
request origins, a successful policy-token rotation can return a ready-to-use MCP
config whose bearer token is attached to an attacker-origin `url`. The signature
requirement limits who can rotate the policy token, but the response still
encourages a user or automation to paste a valid token into a hostile MCP
endpoint.

Recommended fix:

- Build the MCP config URL from `resolveAgentAppBaseUrl`, using the policy-token
  route path as the base-stripping suffix.
- Fail closed in production when the canonical app URL is missing, matching the
  signing-intent and handoff routes.
- Add a hostile-host regression test for `/api/agent/policies/token` that proves
  production ignores the incoming request origin.

Contract redeploy required: No.

### RL-NC-RR-03: Explicit Ponder `--schema` bypasses the live schema guard

Severity: Medium

`buildPonderStartArgs` injects the deployment-derived schema when no schema flag
is present, and mirrors that schema into `DATABASE_SCHEMA`:

- `packages/ponder/scripts/databaseSchema.mjs:231-249`

However, any explicit `--schema` or `--schema=...` returns early and skips both
the resolved schema and the environment mirror:

- `packages/ponder/scripts/databaseSchema.mjs:227-237`

The Ponder API `/deployment` endpoint reports the schema derived from
`process.env`, not the explicit CLI schema that may actually be in use:

- `packages/ponder/src/api/index.ts:169-182`

Impact: an operator can start a live Base Ponder process with a stale or
foreign-network explicit `--schema`. The process may read/write one schema while
`/deployment` reports the expected protocol deployment schema, recreating the
schema/data mismatch class the previous env-override fixes were meant to close.

Recommended fix:

- On live networks, reject explicit `--schema` unless it equals the resolved
  protocol-deployment schema.
- If a break-glass override is truly needed, require an explicit flag/env var and
  expose the effective CLI schema in `/deployment`.
- Add tests for `PONDER_NETWORK=base` and `PONDER_NETWORK=baseSepolia` with
  stale explicit `--schema` arguments.

Contract redeploy required: No.

### RL-NC-RR-04: Strict live readiness can pass while Keeper health is skipped

Severity: Medium

Live readiness now supports Keeper targets and probes `/live`:

- `scripts/check-base-mainnet-readiness.mjs:12-22`
- `scripts/check-base-sepolia-readiness.mjs:15-25`
- `scripts/readiness-core.mjs:1041-1049`
- `scripts/readiness-core.mjs:1360-1376`

Keeper `/health` is only probed when `METRICS_AUTH_TOKEN` is set:

- `scripts/readiness-core.mjs:1378-1414`

If the token is absent, the check records a passing skip even in
`--live --require-live-targets` mode:

- `scripts/readiness-core.mjs:1415-1421`

Impact: scheduled or manually triggered strict live readiness can pass after
only verifying that Keeper `/live` returns `status: "ok"`. It can skip the
stronger `/health` assertions for recent `lastRun`, database-backed state, and
zero `consecutiveErrors`, which are the checks that catch a reachable but stuck
or failing Keeper.

Recommended fix:

- In strict live readiness, require `METRICS_AUTH_TOKEN` whenever a Keeper URL is
  required.
- Fail, rather than pass, if `/health` cannot be checked in strict live mode.
- Add tests covering `--live --require-live-targets` with Keeper URL present and
  `METRICS_AUTH_TOKEN` missing.

Contract redeploy required: No.

### RL-NC-RR-05: Atomic numeric fields can be rounded before signing or submission

Severity: Medium

The public SDK types allow atomic amounts and timing/count fields as
`string | number | bigint`:

- `packages/sdk/src/agent.ts:63-72`

The SDK JSON replacer only special-cases `bigint`; ordinary JavaScript numbers
are serialized after any runtime rounding has already happened:

- `packages/sdk/src/agent.ts:1998-2000`

The shared agent parser and local signer accept numbers by converting them with
`String(value)` before parsing as `bigint`:

- `packages/agents/src/x402QuestionPayload.ts:271-279`
- `packages/agents/src/localSigner.ts:674-682`
- `packages/agents/src/questions/lint.ts:149-158`

Impact: a caller that passes an unsafe integer number such as
`9007199254740993` can have it rounded before the payload hash, x402
authorization, max-payment cap, or lint calculation sees the value. The system
then signs or submits the rounded atomic value, not the caller's intended one.

Recommended fix:

- Reject numeric atomic fields unless `Number.isSafeInteger(value)` and the
  field-specific range checks pass.
- Prefer `string | bigint` for public atomic amount, timestamp, duration, and
  count inputs in SDK docs and examples.
- Add regression tests around unsafe numeric inputs such as
  `9007199254740993`.

Contract redeploy required: No.

### RL-NC-RR-06: Missing public rating `epochIndex` is discounted but reported as epoch 0

Severity: Low

`CorrelationVoteInput` documents `stake` and `epochIndex` as required for the
public rating domain:

- `packages/node-utils/src/correlationScoring.ts:94-99`

The rating evidence calculation gives full evidence only when
`vote.epochIndex === 0`; missing or null `epochIndex` falls into the discounted
branch:

- `packages/node-utils/src/correlationScoring.ts:581-589`

The reasons emitted for each vote report a missing `epochIndex` as `0`:

- `packages/node-utils/src/correlationScoring.ts:342-351`

Impact: if an upstream ingestion or test fixture bug omits `epochIndex` for a
public rating vote, the scoring output underweights the vote by 75% while the
explainability artifact says `epoch_index=0`. Current Ponder vote rows normally
persist `epochIndex`, so this is primarily a fail-closed and artifact-integrity
gap in the shared scoring package.

Recommended fix:

- Validate public rating inputs and reject missing or invalid `epochIndex` and
  `stake`.
- If defaulting is intended, default consistently in both scoring and emitted
  reasons.
- Add a missing-`epochIndex` public rating scoring test.

Contract redeploy required: No.

### RL-NC-RR-07: `roundConfig` values are not bounded before uint32/uint16 hash encoding

Severity: Low

The shared x402 parser accepts `roundConfig` values as arbitrary non-negative
`bigint`s, then only checks positivity and voter ordering:

- `packages/agents/src/x402QuestionPayload.ts:888-912`

The hash builder later encodes those values as `uint32`, `uint32`, `uint16`, and
`uint16` after casting to `Number`:

- `packages/agents/src/x402QuestionPayload.ts:1278-1288`

The local signer repeats the same ABI-width encoding:

- `packages/agents/src/localSigner.ts:1513-1528`

Impact: invalid `roundConfig` values can pass canonical payload normalization
and fail later during nonce/signing/hash construction with lower-quality errors.
For very large inputs, the `Number(...)` cast also loses precision before the
ABI encoder rejects or encodes the value.

Recommended fix:

- Validate `epochDuration` and `maxDuration` as `1..2**32 - 1`.
- Validate `minVoters` and `maxVoters` as `1..65535`.
- Reuse the same bounds in linting and local signing, and add tests for
  one-over-limit values.

Contract redeploy required: No.

### RL-NC-RR-08: Artifact allowlist parity does not verify the public artifact base URL

Severity: Low

The readiness helper compares Keeper and Ponder artifact allowlists when both are
set:

- `scripts/readiness-core.mjs:495-508`

The same readiness code separately requires
`KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` to be present and HTTPS when
automatic file-backed correlation artifacts are enabled:

- `scripts/readiness-core.mjs:538-555`

Docs say the allowlists should match the Keeper's public artifact base URL:

- `docs/env-parity.md:152-162`

The Base readiness workflows hard-code matching allowlists but do not wire
`KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` into the job environment:

- `.github/workflows/base-mainnet-readiness.yaml:23-40`
- `.github/workflows/base-sepolia-readiness.yaml:23-41`

Impact: readiness can verify that the two allowlists match each other without
verifying that they include the actual public URL Keeper publishes. In the
current workflows, the public URL is not wired at all, so file-backed artifact
readiness either fails before checking the intended production URL or depends on
operators keeping an unverified value aligned elsewhere.

Recommended fix:

- Wire `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` into Base mainnet and Base
  Sepolia readiness workflows.
- Extend `validateArtifactAllowlistParity` to assert that both allowlists contain
  the normalized public artifact base URL whenever file-backed public artifacts
  are enabled.
- Add tests for allowlists that match each other but omit or differ from
  `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL`.

Contract redeploy required: No.

## Notes and Non-Findings

- The previously reported RL-NC-01 through RL-NC-06 paths appear addressed on
  current `main`: browser x402 nonce/validity validation, live Ponder schema env
  overrides, Keeper readiness target coverage, localhost attachment parsing,
  staged handoff image ordering, and node-utils publish-order coverage all have
  corresponding fixes or tests.
- The MCP OAuth protected-resource metadata URL is still request-derived in the
  auth challenge path, but it does not carry a bearer token. I did not elevate it
  without a stronger client-following or token-exposure failure mode.
- Confidentiality breach evidence artifact links are also built from
  `request.url`. They are public artifact links and do not carry bearer tokens,
  so I treated them as a lower-priority canonical-URL hardening item rather than
  a security finding in this pass.
- No finding in this report implies redeploying the production contract stack.
  The recommended fixes are application, package, readiness, or deployment
  workflow changes.

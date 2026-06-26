# RateLoop Non-Contract Security Review - 2026-06-26 Second Pass

## Scope

This pass reviewed the committed code/config state at `0e003afb2` on `main`; a docs-only rereview report commit, `1e2b2b018`, was already present on `main` before this report was committed. Smart contracts and Solidity logic were out of scope. The review focused on Next.js/API routes, MCP and agent flows, Keeper/Ponder/runtime configuration, CI/CD, release automation, supply chain settings, secrets handling, and deployment scripts.

The local working tree contained unrelated uncommitted changes during the review. I avoided them by reviewing a clean `git archive` snapshot and by using `git show HEAD:...` for targeted checks.

## Verification Performed

- Spawned three read-only review agents for parallel coverage of Next.js/API routes, runtime services and agents, and CI/CD/supply-chain configuration.
- Reviewed the prior non-contract security reports and checked whether the earlier findings were still present.
- Ran dependency audits:
  - `yarn npm audit --recursive --environment production` -> no audit suggestions.
  - `yarn npm audit --recursive --environment development` -> no audit suggestions.
- Swept tracked content for likely committed production secrets. No high-confidence production credential was found.
- Reviewed workflow triggers, secret usage, release/publish paths, deployment scripts, public agent routes, handoff/signing flows, URL construction, RPC/Ponder URL validation, and local signer execution.

## Executive Summary

No critical or high-severity non-contract issue was found. No production contract redeploy is required for any item below.

This second pass found three medium-severity non-contract issues and three low-severity hardening issues:

1. Browser handoff/signing responses can expose agent callback `webhookSecret` values.
2. Base readiness pull-request jobs place live secrets in the environment of PR-controlled scripts.
3. Agent policy token rotation builds copy-paste MCP configs from the request URL instead of the canonical app URL.
4. Next.js and local signer production RPC/Ponder URL validation still allows plaintext remote HTTP.
5. Manual npm publishing can run from arbitrary workflow-dispatch refs and dist-tags.
6. Deploy and E2E helper paths still use a few mutable or lockfile-bypassing supply-chain edges.

## Findings

### RL-NCS2-01: Browser handoff/signing responses expose `webhookSecret`

Severity: Medium

`webhookSecret` is accepted as a top-level ask field in `packages/node-utils/src/x402QuestionFields.ts:26-29`. The MCP tool parser requires it when `webhookUrl` is supplied in `packages/nextjs/lib/mcp/tools.ts:2211-2221`, and that secret is used as callback signing key material.

For browser handoffs, `createAgentAskHandoff` stores both `request_body` and `original_request_body` directly from the incoming request in `packages/nextjs/lib/agent/handoffs.ts:865-941`. The public response builder then returns `originalRequestBody` and `requestBody` in `packages/nextjs/lib/agent/handoffs.ts:811-848`. The handoff GET/PATCH routes return that response to anyone with the handoff token in `packages/nextjs/app/api/agent/handoffs/[handoffId]/route.ts:40-53` and `packages/nextjs/app/api/agent/handoffs/[handoffId]/route.ts:59-90`.

For browser signing intents, `createAgentSigningIntent` stores the raw `requestBody` in `packages/nextjs/lib/agent/signingIntents.ts:288-331`, `signingIntentResponse` returns it in `packages/nextjs/lib/agent/signingIntents.ts:241-260`, and the create/get paths return that response in `packages/nextjs/lib/agent/signingIntents.ts:359-366`.

Impact: anyone who can read a browser handoff or signing-intent response can recover the callback HMAC secret and forge RateLoop-style callback deliveries to the agent's webhook endpoint. This does not let them sign on-chain transactions, but it can compromise downstream agent automation that trusts callback signatures.

Recommended fix: redact `webhookSecret` before storing any browser-visible request body and before returning handoff/signing-intent responses. Keep the secret only in the server-side callback/subscription record used for signing. Add tests that create handoffs and signing intents with `webhookUrl` plus `webhookSecret`, assert all public create/get/prepare responses omit the secret, and assert callback signing still uses the stored secret.

Contract redeploy required: No.

### RL-NCS2-02: Pull-request readiness jobs expose live secrets to PR-controlled scripts

Severity: Medium

The Base mainnet readiness workflow runs on `pull_request` in `.github/workflows/base-mainnet-readiness.yaml:3-12`, defines live secrets at job scope in `.github/workflows/base-mainnet-readiness.yaml:26-40`, and then runs `node scripts/check-base-mainnet-readiness.mjs` from the checked-out PR workspace in `.github/workflows/base-mainnet-readiness.yaml:53-58`.

The Base Sepolia readiness workflow has the same pattern: `pull_request` trigger in `.github/workflows/base-sepolia-readiness.yaml:3-12`, live secrets at job scope in `.github/workflows/base-sepolia-readiness.yaml:26-41`, and PR-controlled script execution in `.github/workflows/base-sepolia-readiness.yaml:54-59`.

Fork pull requests normally do not receive repository secrets, but same-repository PRs and compromised collaborator branches can modify the checked-out scripts that run with `BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `KEEPER_DATABASE_URL`, `METRICS_AUTH_TOKEN`, `PONDER_METADATA_SYNC_TOKEN`, and `PONDER_KEEPER_WORK_TOKEN` in the environment. The live probe steps are gated away from PR events, but the secrets are already present for the offline PR step.

Impact: a malicious or compromised same-repo PR could exfiltrate live service credentials from CI. The highest-value exposure is the keeper database URL and service tokens rather than the public RPC URLs.

Recommended fix: split readiness into a no-secret PR job and a live secret-backed job that runs only on `schedule`, `workflow_dispatch`, or protected main-branch events. Move `secrets.*` values from job-level `env` to live-only steps. Prefer a protected GitHub Environment for the live job. Add workflow tests that fail if a `pull_request` job has `secrets.*` in job-level or step-level env while checking out and running PR code.

Contract redeploy required: No.

### RL-NCS2-03: Agent policy token configs use request URL as trust source

Severity: Medium

`buildMcpConfig` embeds a freshly rotated bearer token in a copy-paste MCP config in `packages/nextjs/app/api/agent/policies/token/route.ts:16-30`. The config URL is built with `new URL("/api/mcp", request.url)` in `packages/nextjs/app/api/agent/policies/token/route.ts:26`, and the token plus config are returned together in `packages/nextjs/app/api/agent/policies/token/route.ts:80-89`.

Impact: if the app is reachable through an alternate Host/origin or a proxy forwards an untrusted request URL, the generated MCP config can point to an attacker-controlled origin. A user who copies that config would send the fresh bearer token to the wrong MCP endpoint.

Recommended fix: build the MCP URL from the canonical app URL helper used by other agent link routes. In production, fail closed when `APP_URL`, `NEXT_PUBLIC_APP_URL`, or `VERCEL_PROJECT_PRODUCTION_URL` cannot supply a canonical base URL. Add a route test that rotates a token with a hostile request URL while canonical `APP_URL` is configured and asserts the generated MCP URL uses the canonical origin.

Contract redeploy required: No.

### RL-NCS2-04: Production URL validators still allow plaintext remote RPC/Ponder URLs

Severity: Low to Medium

Next.js public env validation rejects localhost in production, but it does not require HTTPS. `requireUrl` checks localhost only in `packages/nextjs/utils/env/public.ts:54-73`, `resolvePonderUrlValue` accepts any valid URL after its localhost check in `packages/nextjs/utils/env/ponderUrl.ts:7-33`, and `normalizeHttpUrl` explicitly accepts both `http:` and `https:` in `packages/nextjs/utils/rpcUrls.ts:19-33`.

The server path reuses those RPC overrides in `packages/nextjs/lib/env/server.ts:120-140`, and x402 submission confirmation reads the selected RPC URL from the target network in `packages/nextjs/lib/x402/questionSubmission.ts:1315-1320`. The agent local signer also accepts `RATELOOP_RPC_URL` without scheme validation in `packages/agents/src/localSigner.ts:3329-3330`, probes it in `packages/agents/src/localSigner.ts:3500-3508`, and uses it for public and wallet clients in `packages/agents/src/localSigner.ts:3598-3607`.

Impact: a production misconfiguration can route Ponder reads, browser RPC reads, server-side x402 receipt/preflight reads, or local signer transaction submission over plaintext remote HTTP. Signatures still protect transaction authorization, but network-path tampering can affect availability, confirmation logic, displayed state, and local signer execution reliability.

Recommended fix: require `https:` for production `NEXT_PUBLIC_PONDER_URL`, `NEXT_PUBLIC_RPC_URL_*`, and live `RATELOOP_RPC_URL` values. Allow `http://localhost`, `http://127.0.0.1`, and `http://[::1]` only for local hardhat/anvil or explicit local E2E production builds. Add tests for remote `http://` rejection, `https://` acceptance, and localhost exceptions.

Contract redeploy required: No.

### RL-NCS2-05: Manual npm publish can run from arbitrary dispatch refs and dist-tags

Severity: Low

`.github/workflows/publish-npm.yaml:3-17` supports manual `workflow_dispatch` with caller-provided `dry_run` and `npm_tag`. The publish job is protected by `environment: npm-production` in `.github/workflows/publish-npm.yaml:27-33`, but there is no in-workflow guard that a real publish is running from `refs/heads/main` or a release tag, and `NPM_TAG` is passed straight to `npm publish --tag` in `.github/workflows/publish-npm.yaml:71-89`.

Impact: an authorized manual dispatch can accidentally publish packages from a selected non-release ref or with an unintended dist-tag. This is more release-integrity risk than direct exploitation because the workflow still requires environment approval and npm credentials.

Recommended fix: add a preflight guard that permits real publishes only from `main` or versioned release tags, and allowlist intended dist-tags such as `latest`, `next`, and `canary`. Keep dry runs available on arbitrary refs. Extend release metadata tests to assert the guard and tag allowlist remain present.

Contract redeploy required: No.

### RL-NCS2-06: Remaining deploy/E2E supply-chain edges bypass lockfile or digest pinning

Severity: Low

The Next.js deploy scripts run `yarn dlx vercel@54.0.0` and `yarn dlx vercel@54.0.0 login` in `packages/nextjs/package.json:16-17`, so the deploy CLI is resolved outside the reviewed `yarn.lock` during deploy/login.

The scheduled/manual browser-compat E2E job uses mutable container tags in `.github/workflows/e2e.yaml:246-259`, including `mcr.microsoft.com/playwright:v1.58.2-noble` and `postgres:16`. The job later checks out the repo and runs project code inside that container.

Impact: deploy and E2E infrastructure still depends on mutable external resolution at execution time. A compromised or changed upstream CLI/container image could observe deployment credentials, npm/GitHub tokens available to that job, or test-time secrets. Current workflow permissions and secret exposure reduce the blast radius, so this is a hardening item.

Recommended fix: add `vercel` as a locked dev dependency and call it through the project install. Pin CI container images by digest, or add workflow lint tests that intentionally track approved image digests.

Contract redeploy required: No.

## Positive Controls and Non-Findings

- The June 26 findings around private account read-session scoping, x402 browser signing nonce/validity binding, Ponder schema override guardrails, Ponder/Keeper HTTPS RPC enforcement, Keeper metrics public binding, handoff asset ordering, readiness Keeper liveness checks, maintenance route throttling, and E2E wallet gating appear fixed at the reviewed commit.
- GitHub Actions are mostly pinned to action commit SHAs and use least-privilege `contents: read` permissions.
- Ponder and Keeper now reject plaintext live RPC URLs; the remaining plaintext URL gap is in Next.js public/server env resolution and the agent local signer.
- Handoff image upload paths validate MIME type, size, SHA-256 metadata, upload tokens, and image processing bounds.
- MCP routes enforce bearer auth, protocol version checks, per-tool scope checks, origin constraints, and request size limits.
- Public callback delivery paths use outbound URL safety checks and HMAC signatures.
- Dependency audit reported no production or development audit suggestions.

## Suggested Fix Order

1. Redact `webhookSecret` from browser-visible handoff and signing-intent storage/responses.
2. Split PR readiness workflows from live secret-backed readiness jobs.
3. Build MCP token configs from canonical app URLs.
4. Add HTTPS-only production URL validation for Next.js public/server RPC/Ponder config and the agent local signer.
5. Add npm publish ref/tag guardrails.
6. Lock the Vercel CLI and digest-pin mutable CI images.

# RateLoop Repository Security Review - 2026-06-30

## Scope

This review covered the current `main` branch across Solidity contracts,
deployment/export tooling, Next.js/API surfaces, agent handoff and callback
flows, keeper/ponder operations, CI, dependency advisories, and committed
secrets. The deeper contract-focused report lives in
`packages/foundry/audit-report-2026-06-30.md`.

Parallel review slices:

- Contracts and governance configuration.
- Web/API, x402, gated context, image upload, handoff, callback, and session
  flows.
- Supply chain, local helper scripts, CI, deployment manifests, and secrets.

## Commands And Checks

- `yarn npm audit --recursive --environment production`
- `yarn npm audit --recursive --environment development`
- `yarn security:audit`
- `gh api 'repos/Noc2/RateLoop/dependabot/alerts?state=open'`
- `git grep -n -I -E '0x[0-9a-fA-F]{64}' -- ...`
- `yarn workspace @rateloop/foundry test --match-test 'testPreQualificationParentRejectedClusterSnapshotRoundCanBeSkippedAndRefunded|testPreQualificationParentRejectedClusterSnapshotRoundCanQualifyReplacementBeforeRefund|testBundleRefund_PreQualificationParentRejectedSnapshotRoundSetCanBeSkipped'`
- `yarn workspace @rateloop/foundry test --match-test 'test_SetAdvisoryVoteRecorder_RequiresLaunchPoolAuthorization|test_SetLaunchDistributionPool_RequiresExistingAdvisoryRecorderAuthorization'`
- `node scripts/run-node-tests.mjs packages/foundry/scripts-js/accountHelpers.test.js packages/foundry/scripts-js/deployArgs.test.js scripts/readiness-workflows.test.mjs`
- `node scripts/run-node-tests.mjs packages/foundry/scripts-js/exportDeploymentFromBroadcast.test.js`
- `(cd packages/nextjs && node ../../scripts/run-node-tests.mjs app/api/agent-callbacks/routes.test.ts)`
- `yarn workspace @rateloop/keeper test --run src/__tests__/resolve-rounds.test.ts`
- `make generate-abis-only`
- `yarn contracts:check-types`
- `git diff --check`

The live dependency checks returned no audit suggestions and no open Dependabot
alerts at review time.

## Findings

| ID | Severity | Status | Summary |
| --- | --- | --- | --- |
| RL-SEC-1 | Medium | Fixed | Parent correlation-epoch rejection could leave escrow pre-qualification snapshots unskippable. |
| RL-SEC-2 | Medium | Fixed | Foundry account helper scripts shell-parsed selected keystore names. |
| RL-SEC-3 | Medium | Fixed | Dependency audits were manual rather than enforced in CI. |
| RL-SEC-4 | Low | Fixed | Advisory recorder rotation could install a recorder that was not authorized to claim launch credits. |
| RL-SEC-5 | Low | Fixed / documented | `PRIVATE_FOREVER` confidentiality keeps context private forever but does not extend bond slashability past release. |
| RL-SEC-6 | High | Fixed | Agent callback sweep did not drain queued deliveries and could reject Vercel Cron in split-secret deployments. |
| RL-SEC-7 | Medium | Fixed | Keeper Ponder work discovery reused timeout budget consumed by deployment verification. |
| RL-SEC-8 | Low | Fixed | Ponder Railway deployment uses mutable `RAILPACK` builder selection. |
| RL-SEC-9 | Low | Fixed | Local dev Postgres uses a tag-pinned Docker image rather than a digest-pinned image. |
| RL-SEC-10 | Low | Fixed | Yarn suppresses a broad peer dependency warning pattern. |

### RL-SEC-1: Parent-Rejected Snapshot Skip

`ClusterPayoutOracle` can reject finalized round payout snapshots indirectly when
their finalized correlation epoch is rejected. The escrow pre-qualification
skip paths previously accepted direct snapshot digest/root rejections but missed
this parent-rejection case for single reward pools and bundles.

Status: fixed. The oracle now exposes
`isRoundPayoutSnapshotRejectedByCorrelationEpoch(...)`, both escrow recovery
libraries accept that parent-rejection signal, generated contract metadata was
updated, and Foundry tests cover single and bundle recovery.

### RL-SEC-2: Foundry Account Helper Shell Parsing

`account:import`, `account`, and `account:reveal-pk` accepted keystore names
from prompts or files and passed them through shell-parsed commands. A hostile
local keystore filename could be interpreted as shell syntax during local
operator workflows.

Status: fixed. The helpers now reuse the deploy keystore name allowlist, filter
unsafe filenames from interactive selection, use `execFileSync`/argv arrays for
`cast`, and avoid unnecessary `shell: true`. New Node tests cover reserved and
shell-unsafe names.

### RL-SEC-3: Dependency Audit CI Gate

Production and development dependency audits were being run manually during
maintenance, but there was no CI job enforcing them for pushes and PRs.

Status: fixed. Root `security:audit` now runs both production and development
Yarn audits, and `.github/workflows/static-analysis.yaml` runs it in a pinned
Node 24 job after an immutable install. A workflow regression test keeps this
gate wired.

### RL-SEC-4: Advisory Recorder Launch-Pool Authorization

`ProtocolConfig` could record a nonzero advisory vote recorder while the active
`LaunchDistributionPool` had not authorized that recorder. That configuration
would make launch-credit claiming fail even though the protocol config looked
complete.

Status: fixed. `ProtocolConfig` now preflights launch-pool authorization in
both configuration orders, the deploy script and broadcast-export completion
model authorize the recorder before setting it in `ProtocolConfig`, and branch
tests cover both rejected misconfiguration paths.

### RL-SEC-5: `PRIVATE_FOREVER` Bond Semantics

`PRIVATE_FOREVER` prevents the context from becoming public, but the bond still
only remains slashable until the configured release timestamp.

Status: fixed / documented. The contract/interface documentation and tests now
make this explicit, so future callers do not infer perpetual bond slashability
from perpetual privacy.

### RL-SEC-6: Agent Callback Sweep Delivery Drain

The agent callback sweep route handled lifecycle callback discovery and expired
handoffs, but did not process the due callback delivery queue. It also selected
only one of `RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET` or `CRON_SECRET`, so a
production split-secret setup could reject Vercel Cron even when the cron secret
was valid.

Status: fixed. The sweep route now accepts either configured secret, retains
constant-time comparison per candidate secret, and drains due callback
deliveries with a bounded `sweep:` worker id. Route tests cover split-secret
Vercel Cron auth and the sweep delivery call.

### RL-SEC-7: Keeper Ponder Work Timeout Budget

The keeper started the `/keeper/work` timeout before awaiting Ponder deployment
verification. A slow-but-successful `/deployment` check could leave the actual
work request with little or no timeout budget.

Status: fixed. The keeper now gives `/keeper/work` a fresh timeout after
deployment verification completes, and the focused keeper test asserts the
deployment check and work request use separate abort signals.

### RL-SEC-8: Mutable Railway Builder

`packages/ponder/railway.toml` used `builder = "RAILPACK"`. This delegated
build image/runtime selection to Railway's current Railpack behavior.

Status: fixed. Ponder now uses `builder = "DOCKERFILE"` with
`packages/ponder/Dockerfile`, which pins the Node 24 Alpine base image by digest,
does an immutable focused workspace install, builds required workspace
artifacts, and focuses production dependencies. Static analysis also builds the
Ponder Docker image.

### RL-SEC-9: Local Dev Postgres Image Pinning

`docker-compose.dev.yml` used `postgres:16-alpine`. The CI Postgres services
were already digest-pinned, but the local dev stack still tracked the mutable
Alpine tag.

Status: fixed. The local dev Postgres service now uses the same
`postgres:16@sha256:287eced1f33b59ed265ed13a60d3680dd7646d70c4dc0e785f59a470ebc03eeb`
image already exercised by CI.

### RL-SEC-10: Broad Peer Warning Suppression

`.yarnrc.yml` suppressed several known peer warning patterns and also suppressed
`Some peer dependencies are incorrectly met*`, which can hide new peer drift.

Status: fixed. The broad peer-warning filter was removed. `yarn install
--immutable` completed cleanly without replacement filters.

## Verified Non-Findings

- No exploitable web/API issue was confirmed in the reviewed SSRF, open
  redirect, gated context, upload, handoff, session, CSRF, or x402 status paths.
- Gated questions reject external context/video URLs, require RateLoop-hosted
  details URLs, and require hash-bound RateLoop image upload URLs.
- Upload and handoff image flows enforce metadata, MIME, size, hash, and Sharp
  input-pixel limits.
- Agent signing and handoff tokens are hash-stored, redacted, and protected by
  `Referrer-Policy: no-referrer` on the relevant pages.
- Agent callback and metadata fetch paths use public-HTTPS URL validation,
  localhost/internal IP rejection, DNS pinning, manual redirects, and zero-byte
  callback response reads.
- Signed action/session routes are wallet/action/payload-bound, atomically
  consume challenges where relevant, and use `httpOnly`, `sameSite: "lax"`, and
  production `secure` cookies.
- GitHub Actions use pinned action SHAs in the reviewed workflows, and custom
  Foundry/Aderyn downloads verify expected checksums.
- Secret scanning found only Anvil/test keys, fixture hashes, and example
  values, not production-looking committed private keys or tokens.
- The accepted `ClusterPayoutOracle` optimistic trust model and 60-minute
  `revealGracePeriod` remain treated as product/security parameters, not open
  findings.

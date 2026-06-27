# RateLoop Non-Contract Repo Review Findings - 2026-06-27

## Scope

This was a non-contract review of the RateLoop monorepo. Solidity, Foundry
contract logic, and production contract redeploy questions were intentionally
out of scope. The deployed Base mainnet contract stack was treated as durable
production infrastructure.

Current review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch used for the report commit: `codex/non-contract-report-2026-06-27`
- Base commit: `4860b6605` (`fix(nextjs): refine vote OG question copy`)
- Date: 2026-06-27

This document is a report only. No application code, workflow, configuration,
deployment artifact, or smart contract file was changed.

## Verification Performed

- Reviewed prior June 25 and June 26 non-contract/security review reports and
  rechecked the still-relevant items against current source.
- Used three parallel read-only review agents covering:
  - Next.js app/API/social/OG/client-server boundaries.
  - Off-chain services, agents, SDK, Keeper, Ponder, and shared utilities.
  - Repo configuration, workflows, env defaults, package scripts, and docs.
- Manually verified included findings against current source line references.
- Ran targeted non-contract tests:
  - `yarn workspace @rateloop/nextjs test` - 1719 passed.
  - `yarn workspace @rateloop/agents test` - 129 passed.
  - `yarn workspace @rateloop/keeper test` - 516 passed, 2 skipped.
  - `yarn workspace @rateloop/ponder test` - 400 passed, 1 skipped.
  - `yarn workspace @rateloop/node-utils test` - 45 passed.
  - `yarn workspace @rateloop/sdk test` - first failed during concurrent
    package builds with a missing generated contracts ESM file, then passed
    serially with 55 passed.
- Ran `yarn dead-code:scan`; it reported advisory unused exports/dependencies
  listed in the notes below.
- Did not run live service probes, browser E2E, production deployments, or
  smart-contract audit tooling for this report.
- Existing local uncommitted Next.js/social-card changes were present before
  this report work and were not included in this report commit.

## Executive Summary

No critical issue was found, and no finding below requires a production smart
contract redeploy. The most important current issues are off-chain correctness
and operational guardrails:

1. Client share/deep-link flows drop `chainId` and `deploymentKey`, so shared
   URLs for non-default deployments can resolve the wrong content or metadata.
2. Standby Keeper processes that skip because another instance holds the lock
   still refresh successful health metrics.
3. Legacy and PR workflows expose secrets to steps that do not need them.
4. Several public/read endpoints still split their primary rate-limit bucket by
   attacker-controlled resource identifiers.
5. Local package build scripts are not safe to run in parallel because they
   clean shared workspace `dist` directories.

## Findings

### RL-NC-2026-06-27-01: Client share/deep links drop deployment scope

Severity: Medium

Ponder content items carry deployment scope:

- `packages/nextjs/services/ponder/client.ts:632-637`

The server metadata path can consume the scope from `chainId` and
`deploymentKey` query parameters:

- `packages/nextjs/app/(app)/rate/page.tsx:13-18`

However, the client share modal constructs both fallback share links and rated
share metadata without passing that scope:

- `packages/nextjs/components/shared/ShareContentModal.tsx:62-84`

The shared route helper only supports `content` and `waitForContent`, not
deployment scope:

- `packages/nextjs/constants/routes.ts:48-56`

The current vote page and feed callers pass only content/rating fields to the
share modal:

- `packages/nextjs/components/vote/VotePageClient.tsx:2381-2399`
- `packages/nextjs/components/vote/VoteFeedCards.tsx:771-789`

The selected-content URL updater also only preserves the `content` parameter:

- `packages/nextjs/lib/vote/location.ts:25-35`

Impact: if the app is viewing or sharing content from a non-default deployment,
the copied link, tweet URL, and OG metadata can resolve against the default
deployment instead. That can produce missing content, wrong social cards, or a
link that silently points at a same-numbered content ID on another deployment.

Recommended fix:

- Thread `chainId` and `deploymentKey` through vote item selection,
  `ShareContentModal`, `buildRateContentHref`, and `buildVoteLocation`.
- Make `ShareContentModal` pass scope into `buildContentShareData`; the social
  helper already knows how to add scoped params when they are present.
- Add tests for sharing a Base Sepolia or alternate deployment item and verify
  the copied URL, OG URL, and selected-content URL all include the scope.

Contract redeploy required: No.

### RL-NC-2026-06-27-02: Keeper lock skips refresh successful health

Severity: Medium

The Keeper main-loop lock now throws when a required lock is unavailable, but a
busy lock still returns the successful fallback result:

- `packages/keeper/src/keeper-state.ts:390-395`

The caller records a skip counter when the main loop did not run, but then still
calls `recordRun` on the fallback result:

- `packages/keeper/src/index.ts:219-225`

`recordRun` increments total runs, updates
`keeper_last_successful_run_timestamp`, resets `consecutiveErrors`, and sets
`lastRunTime`:

- `packages/keeper/src/metrics.ts:92-110`

`/health` only checks whether `lastRunTime` is recent and reports total runs and
zero consecutive errors from that state:

- `packages/keeper/src/metrics.ts:190-204`

Impact: when multiple Keepers are deployed, a standby process can skip every
tick because another instance holds the lock while still reporting fresh
successful health. If the lock holder wedges after acquiring the lock, healthy
standbys can mask the absence of real settlement, reveal, fee, dormancy, or
snapshot work.

Recommended fix:

- Treat `mainLoopRan === false` as a standby/skip state, not a successful run.
- Avoid calling `recordRun` for lock-busy fallback results, or track a distinct
  `recordSkippedRun` that does not refresh `lastRunTime`.
- Expose `lastMainLoopRun`, skip age, and skip counts in `/health` and alert on
  prolonged lock skips.

Contract redeploy required: No.

### RL-NC-2026-06-27-03: Legacy World Chain Sepolia readiness gives the offline job the live RPC secret

Severity: Medium

The legacy World Chain Sepolia readiness workflow sets the live RPC secret at
job scope:

- `.github/workflows/worldchain-sepolia-readiness.yaml:18-21`

The offline readiness step runs unconditionally in that same environment:

- `.github/workflows/worldchain-sepolia-readiness.yaml:34-35`

The live probe step is gated separately:

- `.github/workflows/worldchain-sepolia-readiness.yaml:37-39`

Impact: a manually dispatched workflow on a same-repo branch can run modified
offline readiness code with `WORLDCHAIN_SEPOLIA_RPC_URL` available, even when
the `live` input is false. This unnecessarily exposes a paid/private RPC secret
to a step that should not need it.

Recommended fix:

- Move `WORLDCHAIN_SEPOLIA_RPC_URL` from job-level env to only the live probe
  step, mirroring the Base readiness workflow split.
- If World Chain Sepolia is no longer operationally relevant, retire the
  workflow like the World Chain mainnet readiness path.
- Add a workflow regression test that the offline step does not reference
  `secrets.*`.

Contract redeploy required: No.

### RL-NC-2026-06-27-04: PR-triggered local deploy steps receive `ETHERSCAN_API_KEY`

Severity: Low

The lint workflow runs on `pull_request` and passes `ETHERSCAN_API_KEY` into a
local Anvil deploy step:

- `.github/workflows/lint.yaml:3-9`
- `.github/workflows/lint.yaml:46-54`

The E2E workflow also passes the same repository secret into the local Anvil
deploy step:

- `.github/workflows/e2e.yaml:141-149`

Impact: local Anvil deployment does not need a real explorer API key. On
same-repo PRs or compromised collaborator branches, modified repo code in those
steps could read a secret that should be reserved for trusted verification jobs.
Forked PRs generally do not receive repository secrets, so this is mainly a
same-repo/collaborator hardening issue.

Recommended fix:

- Remove `ETHERSCAN_API_KEY` from PR/local Anvil deploy steps.
- Use a dummy local value if the deploy tooling requires the variable.
- Restrict real explorer credentials to trusted push/manual verification jobs.

Contract redeploy required: No.

### RL-NC-2026-06-27-05: Some public read endpoints split the primary rate-limit bucket by attacker-controlled params

Severity: Low

The shared limiter hashes all `extraKeyParts` into the bucket key:

- `packages/nextjs/utils/rateLimit.ts:227-230`

Several public or read-heavy routes still include caller-controlled resource
parameters in that first-stage bucket. Examples:

- Feedback count lookups include arbitrary `contentIds` and `chainId`:
  `packages/nextjs/app/api/feedback/counts/route.ts:16-19`
- Public follow reads include arbitrary `address` and `chainId`:
  `packages/nextjs/app/api/follows/profiles/route.ts:26-29`
- Vote OG image generation includes `content`, `chainId`, and `deploymentKey`:
  `packages/nextjs/app/api/og/vote/route.tsx:448-450`

Some sibling routes now use a route-wide first-stage limiter followed by a
resource-specific limiter, so the safer pattern already exists elsewhere in the
repo.

Impact: a caller can vary resource identifiers to create fresh buckets and get
more backend work per IP/fingerprint window than the visible route limit
suggests. This mostly affects cost and availability: Ponder reads, feedback
count aggregation, and OG image generation can be amplified by rotating query
values.

Recommended fix:

- Add a route-wide first-stage `checkRateLimit` with a stable `routeKey` and no
  user-controlled `extraKeyParts`.
- Keep resource-specific secondary limits after parsing and normalization.
- Add tests that vary the resource parameters while the client identity stays
  constant and still hit the first-stage limit.

Contract redeploy required: No.

### RL-NC-2026-06-27-06: SDK vote stake helper silently rounds unvalidated display numbers

Severity: Low

The public SDK vote helper converts display-token stake values with
`Math.round(stakeAmount * 1e6)`:

- `packages/sdk/src/vote.ts:28-30`

`buildCommitVoteParams` accepts `stakeAmount: number` and uses that conversion
directly:

- `packages/sdk/src/vote.ts:61-75`

Impact: callers can pass negative, tiny, imprecise, `NaN`, or infinite numbers.
Depending on the input, this can throw late, round a tiny positive stake to zero,
or build a negative atomic stake value before downstream validation catches it.
The `stakeWei` name also obscures that this is 6-decimal LREP atomic units, not
wei.

Recommended fix:

- Prefer decimal string parsing or bigint atomic units for public stake inputs.
- Reject non-finite, negative, and unsafe numeric values before commit payload
  construction.
- Rename `stakeWei` in SDK-facing helpers/docs or add a clear alias for
  6-decimal atomic LREP.

Contract redeploy required: No.

### RL-NC-2026-06-27-07: Workspace package builds race when run in parallel

Severity: Low

Package build scripts clean their own `dist` directories before rebuilding:

- `scripts/clean-package-dist.mjs:1-7`
- `packages/contracts/package.json:99-103`

Many test/build scripts rebuild shared workspace dependencies as part of their
own command:

- `packages/sdk/package.json:100-105`
- `packages/agents/package.json:96-112`
- `packages/keeper/package.json:7-18`
- `packages/ponder/package.json:7-22`

During this review, running several package tests concurrently caused
`yarn workspace @rateloop/sdk test` to fail once with:

```text
Cannot find module ... packages/sdk/node_modules/@rateloop/contracts/dist/esm/voting.js
```

The same SDK test passed when rerun serially.

Impact: local or CI attempts to parallelize workspace package checks can delete
generated shared package outputs while another package is importing them. This
creates flaky failures and can hide real regressions behind nondeterministic
build artifacts.

Recommended fix:

- Keep the top-level serial `test:ts` sequencing for shared-dist checks, or add
  a workspace build lock around packages that clean shared outputs.
- Consider moving generated outputs to per-command temp dirs or using package
  manager/task-runner dependency ordering instead of each package rebuilding its
  dependencies independently.
- Add a short note in contributor docs warning that package tests that rebuild
  workspace deps are not parallel-safe until the build graph is made isolated.

Contract redeploy required: No.

### RL-NC-2026-06-27-08: Root `yarn test` still skips non-contract tests

Severity: Low

The root default test script runs only Foundry tests:

- `package.json:61`

The comprehensive suite is `test:all`, and the off-chain suite is under
`test:ts`:

- `package.json:62`
- `package.json:105`

Impact: for a repo where most production runtime and UI code is off-chain,
`yarn test` gives a misleadingly narrow signal. A local reviewer can run the
obvious command and miss Next.js, SDK, Ponder, Keeper, agent, and node-utils
tests.

Recommended fix:

- Rename the current root `test` to `contracts:test` or make root `test` run
  `test:all`.
- If runtime cost is a concern, make `test` run non-contract tests and keep
  contract-heavy checks under explicit names.

Contract redeploy required: No.

### RL-NC-2026-06-27-09: Confidentiality log-root publication is exposed as a side-effecting GET

Severity: Low

The GET route authenticates and then publishes/seals a confidentiality log root
from query parameters:

- `packages/nextjs/app/api/confidentiality/log-roots/publish/route.ts:37-55`

A POST variant exists for the same mutation:

- `packages/nextjs/app/api/confidentiality/log-roots/publish/route.ts:62-80`

Impact: the route requires job auth, so this is not an unauthenticated write.
Still, GET mutations are easier to trigger accidentally through monitors,
prefetchers, copied URLs, or replayed links, and they blur cache/safety
expectations for an operation that can publish artifacts and anchor state.

Recommended fix:

- Make publication POST-only.
- If cron infrastructure needs GET, make GET a dry-run/status endpoint and move
  mutation behind POST.
- Add a test proving GET cannot mutate state once the migration is made.

Contract redeploy required: No.

## Previously Reported Items That Appear Addressed

The following June 26 findings were rechecked and appear fixed or materially
mitigated on the current tree, so they are not repeated as current findings:

- Generated-image x402 handoffs now return the exact prepared ask body and have
  tests around uploading signed generated images before prepare.
- Policy-token rotation now resolves the returned MCP config URL through the
  canonical app base URL.
- Explicit live Ponder `--schema` now validates against the resolved protocol
  deployment schema and mirrors `DATABASE_SCHEMA`.
- SDK atomic amount fields now reject unsafe numeric inputs before transport.
- x402 `roundConfig` values now enforce uint32/uint16 upper bounds before hash
  encoding.
- Public rating scoring now rejects missing/invalid `epochIndex`.
- The generic SDK webhook verifier now rejects implicit replay-prone use.
- Production Ponder/Next RPC URL validation rejects remote plaintext HTTP.
- Next config rejects local E2E production flags in production/mainnet/non-local
  builds.
- CSP tests now assert nonce-based `script-src` without `unsafe-inline`.

## Notes

- `yarn dead-code:scan` reported:
  - Unused dev dependency: `vercel` in `packages/nextjs/package.json`.
  - Unused export:
    `SPONSORED_TRANSACTION_DELAY_DESCRIPTION` in
    `packages/nextjs/lib/ui/sponsoredTransactionNotice.ts`.
  - Unused exported types:
    `TransactionFlowBatchOptions`, `FlowSponsoredBatchOptions`, and
    `TransactionFlowStatusCopy`.
- `.github/workflows/static-analysis.yaml` has a `ponder-docker` job name, but
  that job runs Ponder type/build checks rather than building a Ponder Docker
  image. This is a naming/expectation mismatch, not a direct runtime bug.
- No finding in this report implies redeploying the production contract stack.

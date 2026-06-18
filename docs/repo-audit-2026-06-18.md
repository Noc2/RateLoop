# RateLoop Repo Audit - Bugs & Inconsistencies (18 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `354beab3`
(`Cover wallet funding prompts`).

Scope: concrete bugs, inconsistencies, release blockers, and drift. No
application code was changed during the review; this document is the only
intended repository change.

## TL;DR

The broad test signal is green: Node/script tests, package type checks,
Next.js unit tests, service Vitest suites, Foundry tests, and deploy-profile
contract-size checks all passed.

The highest-confidence issues are:

1. `@rateloop/agents` is published publicly but still imports the private,
   unpublished `@rateloop/node-utils` package from its built output.
2. Approved question details can be re-linked from one content ID to another,
   unlike image attachments, which are protected against cross-content moves.

Other meaningful follow-ups:

3. Confidentiality breach listing is not deployment-scoped, even though breach
   rows now store deployment scope.
4. Tracked production env defaults to Base mainnet before tracked Base
   deployment artifacts exist, which conflicts with the Base Sepolia-first
   rollout path and can fail production builds.
5. Some keeper remote JSON/body reads check `Content-Length` but still buffer
   unbounded chunked responses before enforcing the size limit.

## Method

Three explorer agents reviewed disjoint areas in parallel:

| Agent | Scope |
| --- | --- |
| Contracts/deploy | `packages/foundry`, `packages/contracts`, deployment readiness |
| Next.js/API/db | `packages/nextjs`, attachments, confidentiality, notifications |
| Services/tooling | `packages/ponder`, `packages/keeper`, `packages/agents`, `packages/sdk`, `packages/node-utils`, scripts |

Load-bearing findings were re-checked in the main workspace against source and
test output. A generated untracked `packages/foundry/deployments/84532.json`
appeared during the review/test pass and was removed before this document was
created; it is not part of the tracked repository state.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `yarn test:node` | 131 pass, 0 fail |
| `yarn contracts:check-types` | Pass |
| `yarn node-utils:check-types` | Pass |
| `yarn sdk:check-types` | Pass |
| `yarn keeper:check-types` | Pass |
| `yarn agents:check-types` | Pass |
| `yarn workspace @rateloop/ponder test` | 340 pass, 1 skip |
| `yarn workspace @rateloop/keeper test` | 217 pass, 1 skip |
| `yarn workspace @rateloop/agents test` | 70 pass |
| `yarn contracts:test` | 37 pass |
| `yarn node-utils:test` | 38 pass |
| `yarn sdk:test` | 51 pass |
| `yarn next:test` | 1,372 pass |
| `yarn foundry:test` | 1,750 pass |
| `yarn workspace @rateloop/foundry check:sizes` | Pass; all deploy-profile bytecode under EIP-170 |
| `yarn dead-code:scan` | Reports cleanup candidates only |

Deploy-profile size headroom is tight but passing: `LaunchDistributionPool`
24,538 bytes, `QuestionRewardPoolEscrow` 24,424 bytes, and `ContentRegistry`
24,387 bytes.

## High

### H1 - Public `@rateloop/agents` package depends on private `@rateloop/node-utils`

**Severity:** High (public package release blocker)

`packages/agents/package.json:109` depends on `@rateloop/node-utils`, but
`packages/node-utils/package.json:4` marks that package private. The npm publish
workflow packs/publishes only contracts, SDK, and agents
(`.github/workflows/publish-npm.yaml:56-59`), and the release metadata test
models `@rateloop/agents` as depending only on contracts and SDK
(`scripts/release-package-metadata.test.mjs:16-22`).

This is not just manifest drift: the built package still imports private
subpaths:

- `packages/agents/dist/esm/questionSpecs.js:1-2`
- `packages/agents/dist/esm/questions/lint.js:12`
- `packages/agents/dist/esm/x402QuestionPayload.js:2-4`
- `packages/agents/dist/esm/localSigner.js:9`
- matching CJS files under `packages/agents/dist/cjs`

**Impact:** `npm install @rateloop/agents` consumers can receive a package whose
runtime imports cannot be resolved from npm.

**Suggested fix/test:** publish `@rateloop/node-utils`, move or bundle those
helpers into a published package, or remove the private dependency. Add a
pack/install smoke test that installs the generated tarballs into a temp project
and imports the public agents entrypoints.

### H2 - Question details can be re-linked across content IDs

**Severity:** High (private/gated context integrity)

`attachQuestionDetailsToContent` updates an approved details row whenever the
caller identity matches:

`packages/nextjs/lib/attachments/questionDetails.ts:524`

The predicate does not require the row to be currently unlinked or already
linked to the same `contentId`. Image attachments have that guard:

`packages/nextjs/lib/attachments/imageAttachments.ts:1181`

```ts
or(isNull(questionImageAttachments.contentId), eq(questionImageAttachments.contentId, params.contentId))
```

**Impact:** A caller who owns an approved details record can move it from one
question to another after submission. For gated/private details, access checks
and evidence can then apply to the wrong content.

**Suggested fix/test:** add `contentId IS NULL OR contentId = params.contentId`
to the question-details attach predicate. Add a regression test that attaches a
details row to content `42`, attempts to attach the same row to content `43`,
returns false, and leaves `contentId = 42`.

## Medium

### M1 - Confidentiality breach listing is not deployment-scoped

**Severity:** Medium (cross-deployment data mixing)

`GET /api/confidentiality/breaches` filters by `contentId` only:

`packages/nextjs/app/api/confidentiality/breaches/route.ts:89-90`

But POST stores deployment scope on the row:

`packages/nextjs/app/api/confidentiality/breaches/route.ts:267-274`

and migration `0011_confidentiality_deployment_scope.sql:35-38` added
deployment-scoped columns plus a deployment/content/status index for breach
reports.

Related edge: confidentiality log roots are still keyed by `epoch` only
(`packages/nextjs/lib/db/schema.ts:575-598`), and POST evidence lookup also
reads roots by epoch only (`route.ts:203-204`). That may be intentional if a
single deployment owns the database, but it conflicts with the deployment-scope
columns now present on access logs and breach reports.

**Impact:** Reused ContentRegistry-local IDs across deployments can mix breach
reports and evidence metadata in the governance UI/API.

**Suggested fix/test:** resolve or require the current deployment scope for GET
and filter by `deploymentKey + contentId`. Add a test with two breach reports
sharing the same `contentId` across different deployment keys. Decide whether
log roots also need deployment scoping before multiple live deployments share
one app database.

### M2 - `.env.production` targets Base mainnet before tracked Base artifacts exist

**Severity:** Medium (build/rollout inconsistency)

`packages/nextjs/.env.production:3` sets:

```env
NEXT_PUBLIC_TARGET_NETWORKS=8453
```

`packages/nextjs/utils/env/public.ts:84-91` fails closed if a selected target
network has no generated contract definitions. The tracked shared deployments
currently include World Chain and local entries, but no tracked `8453` or
`84532` deployment artifacts or `deployedContracts` entries.

This also conflicts with the repo-level Base rollout note: deploy and verify
Base Sepolia first, then consider Base mainnet only after testnet verification.

**Impact:** A production build using the tracked production env can fail before
Base artifacts are intentionally promoted. Once Base mainnet artifacts appear,
the default can also steer a deployment directly to mainnet unless the hosting
environment overrides it.

**Suggested fix/test:** remove the tracked production target default, set it
only in deployment environment config, or use a Base Sepolia production-preview
env until promotion. Add a config test that every tracked `.env.production`
target ID exists in shared deployments and matches the rollout policy.

### M3 - Keeper remote JSON/body reads can buffer oversized chunked responses

**Severity:** Medium (keeper memory/resource exhaustion from misconfigured or hostile endpoints)

`packages/keeper/src/correlation-ponder-freshness.ts:58-78` checks
`Content-Length`, but then calls `response.json()`. A chunked response without
`Content-Length` can still be buffered before the 5 MB cap is enforced.

`packages/keeper/src/correlation-snapshots.ts:433-439` has the same pattern for
artifact fetches: it checks `Content-Length`, then `await response.text()`, then
checks the byte length after buffering.

**Impact:** A bad Ponder URL or allowed artifact host can make the keeper buffer
oversized responses during correlation snapshot work.

**Suggested fix/test:** factor and reuse a bounded stream reader like the one in
`packages/keeper/src/correlation-artifact-builder.ts:684`. Add tests for
oversized chunked responses that omit `Content-Length`.

## Low

### L1 - Confidentiality notification preference columns are not wired into app preferences

**Severity:** Low (incomplete feature surface)

`packages/nextjs/lib/db/schema.ts:145-147` defines
`contextNowPublic`, `breachReported`, and `cohortBreachAnnouncement` on
`notification_preferences`, but the shared preference state in
`packages/nextjs/lib/notifications/shared.ts:1-12` exposes only
`roundResolved`, `settlingSoonHour`, `settlingSoonDay`, `followedSubmission`,
and `followedResolution`.

**Impact:** Users cannot view or toggle the confidentiality-specific DB-backed
defaults if delivery code starts honoring them.

**Suggested fix/test:** either remove the unused columns until the feature is
ready, or add them to normalization, API read/write, UI state, email
subscription state, and preference tests.

### L2 - Base support exists in code, but service docs and CI still steer toward World Chain

**Severity:** Low (operator drift)

Code supports Base in `packages/ponder/ponder.config.ts` and
`packages/keeper/src/config.ts`, and `.env.example` files mention Base IDs.
However:

- `packages/ponder/README.md:37-41` lists only `hardhat`,
  `worldchainSepolia`, and `worldchain`.
- `packages/keeper/README.md:27` says live supported chains are `4801` and
  `480`.
- GitHub workflows include World Chain readiness checks, but no Base readiness
  workflow files.

**Impact:** Base Sepolia rollout operators can follow stale setup paths or miss
Base readiness gates.

**Suggested fix/test:** update README env tables for `baseSepolia`/`base`
(`84532`/`8453`) and add CI coverage for `base-sepolia:check` and the later
Base mainnet readiness check when artifacts are intentionally promoted.

### L3 - Ponder Vitest mock cleanup is hoisted out of `afterEach`

**Severity:** Low (future test breakage)

`yarn workspace @rateloop/ponder test` passes, but Vitest warns that
`vi.unmock("../src/api/shared.js")` in
`packages/ponder/tests/route-validation.test.ts:543` is hoisted even though it
is nested in `afterEach`. Vitest says this will become an error in a future
version.

**Suggested fix/test:** move the unmock to top-level setup or switch to a
non-hoisted cleanup pattern that matches the intended per-test lifecycle.

### L4 - Dead-code scanner reports cleanup candidates

**Severity:** Low (cleanup / public surface hygiene)

`yarn dead-code:scan` reports:

- unused file: `packages/promo-video/remotion.config.ts`
- unused export: `X402_WORLD_CHAIN_USDC_BY_CHAIN_ID` from
  `packages/nextjs/lib/x402/questionPayload.ts`
- unused exported types: `WalletFundingAsset` and `WalletFundingRequest` from
  `packages/nextjs/components/shared/WalletFundingProvider.tsx`

These do not currently appear to be runtime bugs. The x402 alias may be a
temporary compatibility export, and the wallet funding types are used
internally even if not imported elsewhere.

## Non-findings / Notes

- No high-confidence Solidity invariant or fund-loss bug was found in this pass.
- The accepted `ClusterPayoutOracle` optimistic trust model was not raised as a
  finding.
- Default-profile Foundry compile emitted code-size warnings, but the
  deploy-profile size check passed and is the relevant deployment gate.
- Tracked Base deployment artifacts are absent today. That is acceptable while
  Base has not been intentionally promoted, but it makes the tracked
  `.env.production` Base-mainnet default a real configuration inconsistency.

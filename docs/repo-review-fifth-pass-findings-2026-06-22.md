# Repo Review Findings - Fifth Pass

Date: 2026-06-22
Base revision reviewed: `82a5a3c53`

## Scope

This pass focused on bugs and inconsistencies that remain after the earlier review passes. I kept the review read-only apart from this document and treated the deployed Base mainnet contracts as durable production infrastructure.

Four parallel read-only sweeps covered:

- Next.js, Ponder, MCP, and public app surfaces.
- Agents, SDK, handoff tooling, and keeper runtime behavior.
- Deployment artifacts, generated ABIs, readiness scripts, and Foundry deployment/export tooling.
- Ops, CI, environment, and README/docs consistency.

Verification run during this pass:

- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` passed.
- Subagent checks also reported `yarn base:check -- --json`, `yarn base-sepolia:check -- --json`, World Chain Sepolia readiness, artifact/dist consistency checks across `31337`, `480`, `4801`, `8453`, and `84532`, and ABI comparisons against Foundry artifacts passed.

None of the findings below require a production contract redeploy. The recommended fixes are application, SDK, indexer scoping, keeper, readiness, and documentation changes.

## Findings

### P1: SDK result lookup can detach `contentId` from `operationKey`

The SDK result URL builder checks `contentId` before `operationKey` in `packages/sdk/src/agent.ts`, so a caller that supplies both is routed to `/api/agent/results/by-content/:contentId`. That route forwards only `{ contentId }` into `rateloop_get_result` from `packages/nextjs/app/api/agent/results/by-content/[contentId]/route.ts`. The MCP result builder only enforces ask membership when it has an operation record, so the membership check in `buildQuestionResultForRecord` is skipped on the by-content route.

Impact: bundle or ask result automation can fetch a result for a content id unrelated to the operation it believes it is resolving. This is especially risky for multi-question asks where callers naturally carry both the operation key and a selected content id.

Recommended fix: prefer `operationKey` when both identifiers are supplied, pass `contentId` as a query parameter, and keep the server-side membership check mandatory when both are present. Add a regression test for a mismatched operation/content pair.

### P2: MCP and agent reads ignore the requested chain after resolving transaction context

The rating flow resolves a chain-specific transaction context in `packages/nextjs/lib/mcp/tools.ts`, but then reads content and votes from the default Ponder deployment:

- `getMcpToolDependencies()` maps `getAllVotes` and `getContentById` directly to `ponderApi` without deployment options.
- `buildRatingContext()` and `prepareRatingTransactions()` call `dependencies.getContentById(contentId.toString())` after resolving `args.chainId`.
- `getRatingStatusFromIndex()` parses `chainId`, but calls `dependencies.getAllVotes(...)` without passing it.
- `buildQuestionResultForRecord()`, `loadBountyEligibleVotes()`, and related result packaging read content, feedback, votes, and rater status without deployment scope.
- `packages/nextjs/lib/mcp/audits.ts` loads live ask guidance with `ponderApi.getContentById(contentId)` without chain options.

Impact: on a multi-target deployment, hosted MCP can prepare or confirm wallet calls against Base mainnet while validation, status, results, or audit guidance comes from the default Ponder deployment. Overlapping content ids across Base mainnet and Base Sepolia would make this difficult to spot from the client side.

Recommended fix: thread `{ chainId, deploymentKey }` from `resolveProtocolDeploymentScope()` through `McpToolDependencies`, result/audit builders, `loadBountyEligibleVotes()`, `listContentFeedback()`, and rater participation reads. Add tests where requested chain differs from the configured default Ponder deployment.

### P2: Chain-aware UI panels still use default Ponder data and unscoped query keys

Several browser panels are target-network aware through scaffold hooks or public chain state, but the Ponder queries do not include the selected chain or deployment key:

- `packages/nextjs/hooks/useCategoryRegistry.ts` uses query key `["categories"]` and calls `ponderApi.getCategories()` without deployment options.
- `packages/nextjs/hooks/useCategoryPopularity.ts` uses query key `["categoryPopularity"]` and calls `ponderApi.getCategoryPopularity()` without deployment options.
- `packages/nextjs/components/governance/GetLrepOnboarding.tsx` keys only by address and calls `ponderApi.getRaterParticipationStatus(address)`.
- `packages/nextjs/components/leaderboard/AccuracyLeaderboard.tsx` calls `getAccuracyLeaderboard()` and `getEarningsLeaderboard()` without deployment options, and the effect dependencies omit the target network.
- `packages/nextjs/services/ponder/client.ts` exposes `getCategories()`, `getCategoryPopularity()`, `getAccuracyLeaderboard()`, and `getEarningsLeaderboard()` without `PonderDeploymentOptions`, unlike nearby scoped methods such as `getVoterAccuracy()`.

Impact: switching between Base mainnet and Base Sepolia can render leaderboard, category, popularity, or onboarding data from the default Ponder deployment while the surrounding UI and contract reads target another chain.

Recommended fix: add optional deployment options to these Ponder client methods, resolve the active deployment from `targetNetwork.id`, pass it from the hooks/components, and include chain/deployment key in query keys and effect dependencies.

### P2: Explicit `chainId` can silently fall back to the default Ponder deployment

`getExpectedPonderDeploymentScope(options)` in `packages/nextjs/services/ponder/client.ts` resolves `options.chainId`, but if no deployment scope is found it falls back to `getDefaultExpectedPonderDeploymentScope()`. Callers that pass `deployment?.deploymentKey` can therefore turn an explicit but unconfigured chain into a default-chain read instead of failing closed.

Impact: missing deployment configuration can be masked as valid default deployment data, which compounds the cross-chain read issues above.

Recommended fix: distinguish "no deployment options were provided" from "an explicit chain was requested but is not configured." For the latter, throw or return `deployment_unconfigured`. Add a focused regression test.

### P2: File-backed handoff uploads break behind path-prefixed API bases

`packages/agents/src/handoffUpload.ts` builds staged-upload URLs with leading `/api/...` paths. With WHATWG `new URL(pathname, base)`, a leading slash discards any path prefix in `RATELOOP_API_BASE_URL`. The SDK has the safer relative-path pattern elsewhere.

Impact: small inline-image handoffs can work while larger file-backed handoffs fail only in proxied or path-mounted deployments such as `https://host/prefix`.

Recommended fix: strip leading slashes in the helper, share the SDK URL builder, and add a test with `RATELOOP_API_BASE_URL=https://host/prefix`.

### P2: Redundant keeper instances run without the advisory lock when Postgres is unhealthy

`runWithKeeperMainLoopLock()` in `packages/keeper/src/keeper-state.ts` falls through to `run()` when schema setup or lock acquisition is unavailable. The main loop wraps settlement, fee sweeps, and correlation publication in that lock, while `packages/keeper/README.md` recommends running 2+ instances for redundancy.

Impact: during a DB outage or lock unavailability, multiple keeper replicas can broadcast duplicate public-wallet operations, causing gas waste, nonce pressure, noisy expected reverts, or harder incident triage.

Recommended fix: add a production/replica mode that skips public-wallet work when the configured lock is unavailable, or make the liveness fallback explicit with an environment flag and operator warning.

### P2: Browser confidentiality escrow override can bypass deployed artifact parity

`getConfiguredConfidentialityEscrowAddress()` in `packages/nextjs/hooks/useConfidentialityBond.ts` trusts `NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS` before the shared deployment artifact. That address is then used for bond checks, approvals, and `postBond` calls, and round voting reuses it before commit.

Impact: a stale Base Sepolia or Base mainnet value can make users approve or call the wrong escrow while readiness checks and generated contract artifacts still appear correct.

Recommended fix: remove the global override for live networks, or mirror the production parity guard used for `QuestionRewardPoolEscrow` so public env cannot silently diverge from the deployed artifact.

### P2: Base Sepolia readiness can look green while the documented one-shot Feedback Bonus path is blocked

`packages/foundry/deployments/84532.json` still points `X402QuestionSubmitter` at the address that `packages/nextjs/lib/x402/questionSubmission.ts` marks as the stale Base Sepolia submitter. The app blocks one-shot USDC Feedback Bonus support for that address, but `scripts/check-base-sepolia-readiness.mjs` still reports offline readiness as green. The limitation is documented in `docs/base-signing-ux.md`, but not surfaced by the readiness gate.

Impact: staging can pass "readiness" while a production-relevant agent/payment flow is intentionally disabled.

Recommended fix: make `base-sepolia:check` emit a specific known-partial-readiness warning or fail unless an accepted-limitation flag is provided. Add the same warning near agent/local signer docs.

### P2: Live readiness can pass with broken `ClusterPayoutOracle` consumer routing

The deploy script wires payout domains to specific consumers, but live readiness checks focus on exported addresses and `ClusterPayoutOracle.frontendRegistry()`. It does not verify `roundPayoutSnapshotConsumer(domain)` for the configured payout domains.

Impact: a governance/config action could leave a consumer unset or stale, and payout proposals would fail at the oracle consumer lookup while readiness still appears green.

Recommended fix: add live checks for domains `1`, `2`, `3`, and `4`, comparing `roundPayoutSnapshotConsumer(uint8)` to `QuestionRewardPoolEscrow`, `LaunchDistributionPool`, `ContentRegistry`, and `QuestionRewardPoolEscrow`.

### P3: Claimable frontend fees cache transient Ponder outages as empty results

`buildClaimableFrontendFeeSnapshot()` in `packages/nextjs/lib/frontendFees/server.ts` returns `emptySnapshot()` when Ponder is unavailable, then `getClaimableFrontendFeeSnapshot()` stores that snapshot in the normal cache. The public API can therefore serve "no claimable fees" for the full TTL after the indexer recovers.

Impact: frontend operators can see a false zero-claimable balance during or after a transient Ponder outage.

Recommended fix: do not cache outage fallback snapshots, or tag the snapshot source and use a shorter negative TTL or a 503 for availability failures.

### P3: Bounty timing fields are optional in types/lint but required at submission time

SDK and agent question types mark `bountyStartBy` and `bountyWindowSeconds` optional, and the lint path checks amount and voter constraints but not those timing fields. The parser defaults missing values to `0n`, then `assertSupportedX402BundleBounty()` rejects them.

Impact: payloads can pass TypeScript and local lint, then fail at ask or handoff time with a misleading bundle-submission error.

Recommended fix: make the fields required in types, lint, and docs, or supply safe defaults before validation. Update the error text so missing timing fields are called out directly.

### P3: Handoff TTL is silently clamped

The agents CLI accepts any positive safe integer for `--ttl-ms`, but the server clamps handoff TTL to `PUBLIC_HANDOFF_MAX_TTL_MS` without returning an effective TTL warning.

Impact: browser handoffs can expire earlier than the operator requested, which is surprising during long-running manual review or image-heavy handoffs.

Recommended fix: enforce the same max in the CLI/SDK or return `effectiveTtlMs` plus a warning from the server.

### P3: File-backed handoff upload requests can hang without request timeouts

`packages/agents/src/handoffUpload.ts` uses bare `fetch` in its JSON request helper. SDK requests use timeout-aware plumbing, but upload token, status, and create calls can hang before the normal staged-upload polling timeout is reached.

Impact: a stalled network request can leave the CLI hanging indefinitely during large file-backed handoffs.

Recommended fix: use `AbortSignal.timeout()` or shared SDK request plumbing, with retries only for clearly idempotent token/status reads.

### P3: Beta banner points to a removed governance anchor and revives release-candidate wording

`packages/nextjs/constants/protocolRelease.ts` sets `PROTOCOL_RELEASE_CANDIDATE_LABEL = "Release Candidate 1"` and links to `/docs/governance#mainnet-beta-release-candidates`. The governance page now exposes `#mainnet-beta`, and the current governance copy frames the Base mainnet contracts as live production infrastructure rather than a redeploy-oriented release-candidate phase.

Impact: the banner link misses the intended section, and public copy again suggests a release-candidate phase that conflicts with the deployed-contract posture.

Recommended fix: update the href to `/docs/governance#mainnet-beta`, remove or reword the release-candidate label, and extend the public-copy test to cover the banner constants.

### P3: Deployment export completeness misses one intended initialization call

`Deploy.s.sol` grants `RaterRegistry.LAUNCH_CONSUMER_ROLE` to `LaunchDistributionPool`, but the broadcast export verifier does not require that grant when deciding `deploymentComplete=true`. Today that role is declared/administered but not consumed by contract logic, so this is an artifact-integrity gap rather than a live break.

Impact: the exported deployment can be marked complete even if not every intended initialization call from the deploy script ran.

Recommended fix: either remove the unused grant from the deploy script or add it to the broadcast completion requirements.

### P4: Root docs have several consistency problems

The root README currently has a malformed test command fence: the E2E commands render as Markdown text/headings, and a later stray fence changes how the CI/dead-code sections render. The same README tells keeper operators to set "contract addresses" for live keeper config even though `packages/keeper/README.md` says live chains read addresses from `@rateloop/contracts` and non-local overrides should not be used. The root and Next.js README CI summaries also omit the current `api` and `world-id` E2E suites from `.github/workflows/e2e.yaml`.

Impact: setup and CI reproduction docs are confusing, and the keeper setup copy can encourage stale live-chain address overrides.

Recommended fix: repair the README fences, clarify that keeper address overrides are local `31337` only, and add `api` plus `world-id` to CI coverage summaries.

## Non-Findings From This Pass

- The Base mainnet and Base Sepolia offline readiness scripts passed in this checkout.
- Earlier stale governance copy about redeploying production contracts appears to have been corrected in the public governance page.
- No reviewed issue requires changing already-deployed Base mainnet contracts. Some checks may reveal governance/config drift in live environments, but the fixes proposed here are guardrails, app/indexer scoping, SDK behavior, keeper policy, or documentation.

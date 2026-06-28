# RateLoop Repo Audit Findings — 2026-06-28

## Scope

Full-repo audit of the RateLoop monorepo covering smart contracts, Next.js
app/API, Keeper, Ponder, agents, CI/workflows, and documentation consistency.
Production Base mainnet contracts were treated as durable infrastructure; no
redeploy recommendations appear below unless a contract-level defect is
identified.

Review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch: `main`
- Base commit: `61476f264` (`fix: stabilize unrevealed cleanup e2e setup`)
- Date: 2026-06-28

This document is a report only. No application code, workflow, configuration,
deployment artifact, or smart contract file was changed as part of this audit.

## Verification Performed

- Ran four parallel read-only review agents covering:
  - Foundry smart contracts and static-analysis configuration.
  - Next.js app/API, hooks, and agents package boundaries.
  - CI/CD, workspaces, test tooling, and dependency alignment.
  - Keeper and Ponder off-chain services.
- Manually verified key findings and regression fixes against current source.
- Cross-checked prior June 2026 review documents for resolved vs open items.
- Ran targeted test suites on `main`:
  - `yarn workspace @rateloop/nextjs test` — 1762 passed.
  - `yarn workspace @rateloop/keeper test` — 518 passed, 2 skipped.
  - `yarn workspace @rateloop/ponder test` — 401 passed, 1 skipped.
  - `yarn test:node` — 219 passed.
- Did not run Foundry contract tests, Playwright E2E, live service probes, or
  production deployments for this report.

## Executive Summary

No critical exploitable bug was found that would require an emergency production
contract redeploy or an immediate hotfix. The codebase is generally well-tested
and hardened, with strong patterns around signed wallet challenges, SSRF-safe
fetching, keeper reveal-failed safeguards, and deployment-scoped indexing.

The most important **open** issues fall into three buckets:

1. **Off-chain auth/consistency gaps** — question-details sweep auth diverges
   from the image-attachment sweep when the secret is unset; rate limiting
   fail-open during DB outages affects write routes.
2. **Operational liveness hazards** — production Keeper halts entirely when
   Ponder is unavailable; stale `humanVerifiedCommitCount` after migration can
   skew work discovery until backfill.
3. **Client race conditions and doc/tooling drift** — wallet-switch races in
   long async vote flows; README/CI documentation lag behind the actual E2E
   matrix and package count.

Several medium-severity items from the June 27 non-contract review are **fixed**
on current `main` (share deployment scope, keeper standby health metrics,
workflow secret scoping, SDK stake validation, feedback route-wide rate limits,
advisory cooldown persistence across recorder rotation).

## Resolved Since Prior Reviews

| Prior ID | Topic | Status on `main` |
|----------|-------|------------------|
| RL-NC-2026-06-27-01 | Share/deep links drop deployment scope | **Fixed** — `ShareContentModal`, `buildRateContentHref`, and vote callers thread `chainId` / `deploymentKey`. |
| RL-NC-2026-06-27-02 | Keeper lock skips refresh successful health | **Fixed** — `packages/keeper/src/index.ts` returns early when `!mainLoopRan` without calling `recordRun`. |
| RL-NC-2026-06-27-03 | World Chain Sepolia RPC secret on offline step | **Fixed** — `WORLDCHAIN_SEPOLIA_RPC_URL` scoped to the live probe step only. |
| RL-NC-2026-06-27-04 | PR deploy steps receive real `ETHERSCAN_API_KEY` | **Fixed** — lint/E2E use `local-anvil-dummy`. |
| RL-NC-2026-06-27-05 | Public reads split primary rate-limit bucket | **Fixed** for feedback counts — route-wide limiter precedes resource limiter. |
| RL-NC-2026-06-27-06 | SDK stake helper silently rounds bad numbers | **Fixed** — finite/negative validation and `stakeAtomicUnits` naming. |
| RL-NC-2026-06-27-07 | Parallel workspace builds race on shared `dist` | **Mitigated** — `with-workspace-dist-lock.mjs` wraps `test:ts` and `build:workspace-deps`; manual parallel package runs outside the lock can still race. |
| Foundry L-1 (Jun 10 audit) | Advisory cooldown lost on recorder rotation | **Fixed** — `ProtocolConfig.recordAdvisoryCooldown` persists cooldown across rotation; regression test in `RoundVotingEngineBranches.t.sol`. |
| Foundry M-2 (Jun 10 audit) | Challenger censorship via live proposer check | **Fixed** — removed from `_requireDisinterestedChallenger`; tests in `ClusterPayoutOracle.t.sol`. |

---

## Findings

### RL-AUDIT-2026-06-28-01: Question-details sweep allows unauthenticated access when secret is unset

**Severity:** High (misconfigured non-production deployments)

**Location:** `packages/nextjs/app/api/attachments/details/sweep/route.ts:22-27`

When `RATELOOP_QUESTION_DETAILS_SWEEP_SECRET` is missing and
`NODE_ENV !== "production"`, any caller can trigger orphan cleanup. The
image-attachment sweep route correctly returns 503 when unconfigured
(`packages/nextjs/app/api/attachments/images/sweep/route.ts:28-31`).

**Impact:** Internet-exposed staging/dev deployments without the secret can have
question-detail attachments deleted by unauthenticated POST requests.

**Recommended fix:** Align details sweep with image sweep — return 503 when the
secret is missing in all environments. Add a test for the no-secret path.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-02: Rate limiting fail-open on DB outage for write routes

**Severity:** High (availability/abuse policy)

**Location:** `packages/nextjs/utils/rateLimit.ts:264-279`; used on write and
abuse-prone routes including feedback, free-transaction session, sweep jobs, and
claimable-fees reads with `allowOnStoreUnavailable: true`.

When the rate-limit backing store is unavailable in production, affected routes
skip limiting entirely rather than returning 503.

**Impact:** During Postgres incidents, write endpoints lose their primary abuse
guardrail. This is an intentional resilience tradeoff but creates a known abuse
window.

**Recommended fix:** Fail closed on write/abuse-prone routes; reserve
`allowOnStoreUnavailable: true` for low-risk read endpoints only. Document the
policy per route class.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-03: Production Keeper halts all work when Ponder is unavailable

**Severity:** High (operational liveness)

**Location:** `packages/keeper/src/keeper.ts` (Ponder work/deployment paths);
`packages/keeper/src/index.ts:271-276`

In production, Ponder `/keeper/work`, `/deployment`, or auth failures throw and
fail the entire tick. Non-production correctly falls back to chain enumeration.

**Impact:** Ponder outage or misconfigured `PONDER_KEEPER_WORK_TOKEN` stops
settlement, reveals, cleanup, forfeits, and correlation snapshot publication
until Ponder recovers. This is likely intentional for deployment safety but is
a single point of failure.

**Recommended fix:** Document the tradeoff explicitly in keeper runbooks. Consider
a governed chain-only fallback for reveal/settlement when Ponder is down but
on-chain deployment verification has already succeeded.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-04: Stale `humanVerifiedCommitCount` can skew Keeper work discovery

**Severity:** High (operational, if backfill skipped)

**Location:** `packages/ponder/src/api/routes/keeper-routes.ts:158-187`;
`packages/ponder/ponder.schema.ts`; `packages/ponder/README.md:144-149`

Dormant-candidate SQL uses `humanVerifiedCommitCount`. Existing Postgres rows
default to `0` after schema migration unless backfilled. Ponder may return
incorrect dormant/`reveal_failed` candidates until re-index/backfill.

**Impact:** Keeper re-derives tx actions on-chain, but work discovery can be
incomplete until counts are backfilled.

**Recommended fix:** Treat backfill as a required migration step before keeper
cutover; add a runtime health signal when counts look stale.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-05: Wallet-switch race in long async vote flow

**Severity:** Medium

**Location:** `packages/nextjs/hooks/useRoundVote.ts`

`commitVote()` reads `address`, chain, and wallet capabilities from hook state
throughout a multi-step flow (open round → commit → reveal, sponsored batch
paths, postcondition polling). There is no snapshot of the initiating wallet at
entry and no abort if the connected wallet or network changes mid-flight.

**Impact:** Wallet/network switch mid-vote can produce failed transactions or
inconsistent UI vs on-chain state.

**Recommended fix:** Capture `{ address, chainId }` at start; abort completion if
they change; disable UI during in-flight vote.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-06: Wallet-switch race in signed collection toggles

**Severity:** Medium

**Location:** `packages/nextjs/hooks/useSignedCollection.ts`

`toggleItem()` uses `config.address` dynamically through challenge creation,
signing, and fetch without snapshotting the initiating wallet.

**Impact:** Disconnect/switch during async path breaks signed writes and causes
confusing optimistic rollback.

**Recommended fix:** Snapshot `address` at toggle start; bail if it changes.
Add unit tests (no dedicated test file exists today).

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-07: Thirdweb sponsorship sync lacks cancellation on wallet change

**Severity:** Medium

**Location:** `packages/nextjs/hooks/useFreeTransactionAllowance.ts` (~466-564)

The effect that runs `autoConnect` + `setActiveWallet` for sponsorship mode has
no abort/cleanup. A slow sync for wallet A can complete after the user switches
to wallet B.

**Recommended fix:** Track a sync generation; ignore stale completions; abort on
dependency change/unmount.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-08: Inconsistent env var resolution for app URLs

**Severity:** Medium

**Location:** Centralized helpers in `packages/nextjs/lib/env/server.ts` and
`packages/nextjs/utils/env/public.ts`; direct `process.env` reads in
`lib/x402/questionPayload.ts`, `lib/mcp/tools.ts`,
`lib/confidentiality/context.ts`, and `lib/attachments/gatedContextFetchUrls.ts`.

**Impact:** Preview/staging misconfiguration where server and client resolve
different origins; gated attachment URL trust checks may fail on preview domains.

**Recommended fix:** Route all server URL resolution through centralized helpers;
add `NEXT_PUBLIC_APP_URL` to the client env module.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-09: Correlation snapshot lock bypass allows duplicate publication attempts

**Severity:** Medium

**Location:** `packages/keeper/src/keeper-state.ts:294-338`;
`packages/keeper/src/correlation-snapshots.ts`

When schema init fails or lock acquisition is `unavailable`,
`runWithCorrelationSnapshotPublishLock` runs publication without the advisory
lock. Multiple keeper replicas can publish overlapping proposals concurrently.

**Impact:** Wasted gas and violated single-writer semantics; on-chain calls may
revert idempotently but operational noise increases.

**Recommended fix:** Fail closed when lock is required but unavailable, mirroring
main-loop lock behavior.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-10: Ponder deployment verification cached for process lifetime

**Severity:** Medium

**Location:** `packages/keeper/src/keeper.ts:148, 607-671`

`verifiedPonderDeploymentCacheKey` is set after first successful `/deployment`
match and never invalidated. Repointing Ponder to a new deployment without
restarting the keeper leaves ciphertext fetch and work discovery on the old
verified endpoint.

**Recommended fix:** Invalidate cache on deployment mismatch or periodic
re-verification; document restart requirement in migration runbooks.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-11: Engine migration requires coordinated escrow/registry redeploy

**Severity:** Medium (governance/ops)

**Location:** `QuestionRewardPoolEscrow.sol`, `FeedbackBonusEscrow.sol`,
`FeedbackRegistry.sol`; documented in `AGENTS.md`

Escrows pin `votingEngine` at initialization with no setter. New pool creation
fail-closes with `"Stale engine"` when registry engine differs. `FeedbackRegistry`
sets engine only in `initialize`.

**Impact:** Rotating `ContentRegistry.setVotingEngine` alone blocks new work and
leaves historical pools on the old engine. Matches AGENTS.md runbook but remains
an easy production footgun.

**Recommended fix:** Enforce runbook in ops docs; optionally add governed
`setVotingEngine` on escrows/registry with shape checks.

**Contract redeploy required:** Only for a full coordinated migration stack — not
for routine config/UI/indexer fixes.

---

### RL-AUDIT-2026-06-28-12: Aderyn static-analysis blind spots

**Severity:** Medium (tooling confidence)

**Location:** `packages/foundry/aderyn.toml`

`ContentRegistryDormancyLib.sol` is fully excluded (Aderyn 0.6.8 panic).
Global `reentrancy-state-change` exclusion hides missing `nonReentrant` on future
paths. Comment on line 11 says `abi-encode-packed-collision` but excluded
detector is `abi-encode-packed-hash-collision`.

**Recommended fix:** Re-enable dormancy lib when Aderyn supports it; run Slither
periodically without global reentrancy suppression; fix comment/detector name
alignment.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-13: Free-transaction confirm endpoint is unauthenticated

**Severity:** Medium (by design, residual risk)

**Location:** `packages/nextjs/app/api/transactions/free/confirm/route.ts`

Any caller with `{ address, operationKey, transactionHashes }` can confirm a
reservation. Protection relies on existing pending reservation + on-chain receipt
verification.

**Impact:** Leaked `operationKey` values allow third parties to interfere with
reservation lifecycle (not steal quota without valid txs).

**Recommended fix:** Bind confirmation to a server-issued session token from
reservation time, or require a wallet-signed payload.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-14: Ponder internal routes share one bearer token with broad bypass

**Severity:** Medium (security surface)

**Location:** `packages/ponder/src/api/index.ts`; `/keeper/work`, `/votes`,
`/advisory-votes`, `/correlation/*`, `/rounds/*`

Valid `PONDER_KEEPER_WORK_TOKEN` bypasses rate limiting and CORS blocks for all
internal read surfaces, not just work discovery.

**Impact:** Token leakage exposes large internal read APIs.

**Recommended fix:** Scope tokens per route class or add secondary authorization
for sensitive correlation/vote exports.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-15: Keeper env documentation gaps

**Severity:** Medium (config footguns)

**Location:** `packages/keeper/.env.example`, `packages/ponder/.env.example`,
`packages/keeper/src/config.ts`

Several runtime-required vars are commented or missing from examples:
`PONDER_KEEPER_WORK_TOKEN`, `KEEPER_DATABASE_URL`, `METRICS_AUTH_TOKEN`,
`PONDER_REPLICA_COUNT`, World Chain dev RPC guidance vs defaults.

**Recommended fix:** Align `.env.example` and README tables with runtime
requirements; fix World Chain dev defaults that still point at 10-block-cap public
endpoints when `PONDER_RPC_URL_*` is unset.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-16: E2E conditional `test.skip()` vs strict skip reporter

**Severity:** Medium (CI flake vector)

**Location:** `packages/nextjs/e2e/support/no-unexpected-skips.ts`; specs including
`profile.spec.ts`, `content-moderation.spec.ts`, `frontend-lifecycle.spec.ts`

CI fails any skipped test unless `E2E_ALLOW_SKIPS=1`. Specs use conditional
`test.skip()` when chain/Ponder state is missing.

**Impact:** Flaky infra can surface as "Unexpected Playwright skips" rather than
actionable test failures.

**Recommended fix:** Monitor skip-reporter failures; extend `playwright.config.test.ts`
skip checks to high-traffic CI projects if flakes persist.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-17: Documentation drift (README vs CI reality)

**Severity:** Medium

**Location:** `README.md` (E2E suite list, "eight packages" count);
`CONTRIBUTING.md` (nine packages including `promo-video`)

PR E2E matrix also runs **api, submit, confidential, world-id** suites beyond
what README lists. `forge coverage` and Knip are advisory-only in CI
(`continue-on-error` / `--no-exit-code`) without contributor-facing documentation.

**Recommended fix:** Update README package count and CI suite list; document
advisory static-analysis lanes in CONTRIBUTING.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-18: Dead storage in `RaterRegistry`

**Severity:** Low

**Location:** `packages/foundry/contracts/RaterRegistry.sol` (~127)

`_worldPresenceNullifierOwner` is declared but never read/written.
`attestHumanPresenceWithV4Proof` is disabled (`UnsupportedCredentialKind`).

**Recommended fix:** Remove dead mapping or wire it if presence recheck returns.

**Contract redeploy required:** Only if removing storage in a future upgrade.

---

### RL-AUDIT-2026-06-28-19: Unused domain constant in `FeedbackRegistry`

**Severity:** Low

**Location:** `packages/foundry/contracts/FeedbackRegistry.sol` (~14, 123-125)

`CONTENT_FEEDBACK_HASH_DOMAIN` is public but unused; `buildContentFeedbackHash`
uses inline string in `abi.encode`.

**Recommended fix:** Use one canonical domain representation.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-20: Inconsistent Solidity error handling styles

**Severity:** Low

**Location:** Mix across `FeedbackRegistry`, escrows (string `require`), engine/oracle
(custom errors), and bare assembly reverts in
`QuestionRewardPoolEscrow._requireRegistryVotingEngine`.

**Recommended fix:** Standardize on custom errors for integrator consistency.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-21: `RoundVotingEngine` does not formally implement `IRoundVotingEngine`

**Severity:** Low

**Location:** `packages/foundry/contracts/RoundVotingEngine.sol`,
`interfaces/IRoundVotingEngine.sol`

Public mappings satisfy interface selectors implicitly, but there is no `is
IRoundVotingEngine` compile-time check. Extended surface is outside the interface.

**Recommended fix:** Add explicit interface implementation and extend interface if
third parties need extra views.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-22: Keeper write path lacks transient RPC retry

**Severity:** Low

**Location:** `packages/keeper/src/keeper.ts` (`writeContractAndConfirm`)

Single broadcast with pre-broadcast gas estimation; no retry on transient
RPC/nonce/receipt errors unlike Ponder's bounded read retries.

**Recommended fix:** Add bounded retry for transient write failures.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-23: Indexed ciphertext pagination discards partial results

**Severity:** Low

**Location:** `packages/keeper/src/keeper.ts:978-1038`

Non-OK page response returns `null`, discarding earlier successful pages and
forcing full `eth_getLogs` fallback.

**Recommended fix:** Return partial results when later pages fail.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-24: Minor dependency version skew

**Severity:** Low

**Location:** `packages/nextjs/package.json`

Examples: `eslint-config-next ~15.5.12` vs `next ~15.5.18`; `@types/react ~19.0.7`
vs `react ~19.2.3`; Foundry CI uses `forge test` without `--offline` while local
`package.json` uses `--offline`.

**Recommended fix:** Align versions and CI/local Foundry flags.

**Contract redeploy required:** No.

---

### RL-AUDIT-2026-06-28-25: Test coverage gaps

**Severity:** Low (quality)

Notable gaps:

- No dedicated `FeedbackRegistry.t.sol` (only escrow/upgrade coverage).
- No `useSignedCollection.test.ts` or `useRoundVote` unit tests.
- Keeper: no tests for `artifact-uri.ts`, `bounded-response.ts`, shutdown path.
- Ponder: no tests for `moderation.ts`, `urlCanonicalization.ts`,
  `confidentiality-redaction.ts`, or integrated `api/index` middleware auth.

**Recommended fix:** Add targeted tests for the highest-risk gaps (sweep auth,
wallet-change races, keeper artifact URI allowlist).

**Contract redeploy required:** No.

---

## Positive Observations

- **Contracts:** Commit–reveal/RBTS sampler fixes, oracle disinterested-challenger
  path, X402 nonce binding, exact-balance USDC/LREP pulls, and extensive branch/
  adversarial/invariant test suites.
- **Next.js:** Signed wallet challenge framework, SSRF-safe fetching, CSP nonce
  middleware, structured API error envelopes, and broad agent/MCP route tests.
- **Keeper:** Block-time cache, reveal-failed finalization blocked on infrastructure
  failure, pre-broadcast gas estimation, main-loop lock skip no longer masquerades
  as success.
- **Ponder:** Deployment key alignment with keeper, dormancy SQL matching on-chain
  `isDormancyBlocked`, bounded RPC read retries.
- **Tooling:** Workspace dist lock with regression tests; Playwright project
  isolation guards; digest-pinned CI container images.

## Recommended Priority

1. **RL-AUDIT-2026-06-28-01** — Align question-details sweep auth with image sweep.
2. **RL-AUDIT-2026-06-28-04** — Ensure `humanVerifiedCommitCount` backfill before
   keeper cutover (ops).
3. **RL-AUDIT-2026-06-28-02** — Revisit fail-open rate-limit policy on write routes.
4. **RL-AUDIT-2026-06-28-03** — Document or design Ponder-down keeper behavior.
5. **RL-AUDIT-2026-06-28-05 / 06 / 07** — Wallet snapshot guards in vote and
   collection hooks.
6. **RL-AUDIT-2026-06-28-17** — README/CONTRIBUTING drift cleanup.
7. **Contract cleanup (Low)** — dead storage, error style, interface adoption,
   Aderyn comment fix.

## References

- Prior non-contract review: `docs/repo-review-findings-2026-06-27.md`
- Prior contract audit: `packages/foundry/audit-report-2026-06-10.md`
- Governance rotation runbook: `AGENTS.md`

# Repo Review Ninth Pass Findings — 2026-06-25

Scope: full-repository read-only audit of **off-chain** code and operations — Next.js frontend, Ponder indexer, Keeper service, agents/SDK/node-utils packages, CI/CD, scripts, and documentation. **Solidity smart contracts (`packages/foundry`) are explicitly excluded.** The existing Base mainnet contract deployment is treated as durable production infrastructure.

This pass re-validates eighth-pass off-chain findings after the fix batch pushed earlier today (`8cfa686fd` → `af22d377b`), then searches for remaining bugs and inconsistencies.

Current working tree at review time:

- Clean except untracked `tmp/rateloop-rating-system-handoff/` (not reviewed)

## Checks Run

| Check | Result |
|-------|--------|
| `yarn test:ts` (full pipeline) | **2,385 passed**, 0 failed (2 skipped across keeper + ponder) |
| `yarn next:check-types` | Passed |
| `yarn next:lint --max-warnings=0` | Passed |
| `yarn workspace @rateloop/ponder test` | **381 passed**, 1 skipped |
| `yarn build:workspace-deps` | Passed |

Not run in this pass: full E2E (`yarn e2e:full`), local chain spin-up, `yarn base-mainnet:check`, Slither/Certora (contract scope excluded).

### Test breakdown (`yarn test:ts`)

| Package | Tests |
|---------|-------|
| Next.js (`yarn next:test`) | 1,636 |
| Keeper | 248 (+ 1 skipped) |
| Agents | 120 |
| Ponder | 381 (+ 1 skipped) |
| Contracts / node-utils / SDK | Included in pipeline (all green) |

---

## Executive Summary

| Severity | Count | Themes |
|----------|-------|--------|
| **P1 (High)** | 3 | Keeper auth on `/votes`, delegated vote claim discovery, Ponder-down empty fallbacks |
| **P2 (Medium)** | 14 | Settlement notifier gaps, claim loading UX, indexer counters, env/docs drift |
| **P3 (Low)** | 11 | Dust labels, MCP copy, knip gaps, stale README fence |
| **P4 (Info)** | 8 | Intentional design, positive coverage, eighth-pass items now resolved |

**Eighth-pass off-chain fixes are largely landed and verified.** Remaining high-impact gaps are concentrated in keeper→Ponder authentication for ciphertext fetches, delegation-aware round claim discovery, and silent empty fallbacks when Ponder is unavailable.

---

## Eighth-Pass Off-Chain Fixes — Verification Status

| Eighth ID | Topic | Status after today's fixes |
|-----------|-------|----------------------------|
| P1-1–3, P2-1 | Claim optimistic UI | **Fixed** — batch key clear, in-flight guard, early `onComplete` on abort |
| P2-3 | Convergent polling | **Fixed** — `pollClaimableRewardsRefresh` `shouldStop` |
| P2-4 | SettlementNotifier question keys | **Partially fixed** — `question_reward` aliased; bundles still open (see P2-4) |
| P3-2 | RewardNotifier USDC | **Fixed** |
| P1-5 | Metadata sync production guard | **Fixed** |
| P1-6, P2-7 | Keeper route exemptions | **Partially fixed** — exemptions require bearer; keeper only sends bearer on `/keeper/work` |
| P1-7 | Artifact allowlist aliases | **Fixed** |
| P1-8 | README E2E markdown | **Fixed** |
| P2-5, P2-8, P2-9 | Keeper/Ponder consistency | **Fixed** (reason ordering, startup token, shared grace constant) |
| P2-11, P2-12 | CI lint / Ponder smoke | **Fixed** — root `yarn lint` includes `agents:lint`; static-analysis runs ponder typecheck |
| P2-15 | Question reward cap 200 | **Improved** — limit raised to 500 |
| P2-16–17 | Dependency version splits | **Fixed** — `@types/node`, `pg`, `tsx`, `dotenv` aligned |
| P3-14 | LREP holder exclusions | **Fixed** — `ClusterPayoutOracle`, `ConfidentialityEscrow` excluded |

---

## P1 — High

### P1-1 — Keeper bearer token not sent on `/votes` and related Ponder fetches

**Fix scope:** Keeper HTTP client. No contract change.

**Files:**
- `packages/keeper/src/keeper.ts` — `fetchKeeperWorkFromPonder()` sends `Authorization: Bearer` (lines ~708–711)
- `packages/keeper/src/keeper.ts` — `fetchIndexedCiphertextsForRound()` calls `assertPonderDeploymentMatchesKeeper(baseUrl, {})` and `fetch(url)` **without** bearer (lines ~997–1015)
- `packages/ponder/src/api/index.ts` — rate-limit and misconfig exemptions require `hasValidKeeperWorkAuthorization(c)`

**Impact:** Ponder exempts `/keeper/work`, `/votes`, and `/advisory-votes` from the 120 req/min IP limiter only when the keeper work token is present. Ciphertext paging can issue up to six `/votes` requests per round per tick without auth. Production keeper can hit 429s during reveal ticks despite today's partial exemption fix.

**Suggested fix:** Central `ponderRequestHeaders()` used by all keeper→Ponder fetches (work, deployment, votes, advisory-votes, correlation).

---

### P1-2 — Delegated votes missing from round LREP/refund claim discovery

**Fix scope:** Next.js hooks. No contract change.

**Files:**
- `packages/nextjs/hooks/useAllClaimableRewards.ts` — uses `useRecentUserVotes(address)` only
- `packages/nextjs/hooks/useRecentUserVotes.ts` — Ponder query `{ voter: normalizedVoter }` for connected wallet only
- `packages/nextjs/hooks/useClaimableQuestionRewards.ts` — correctly expands via `buildClaimableQuestionRewardCandidateVoters` + `useDelegation`

**Impact:** Users who vote through delegation (`delegateTo` / `delegateOf`) can see question USDC/LREP bounties but miss round LREP rewards and stake refunds in `ClaimRewardsButton` / governance claim UI. Ponder indexes votes under the committing wallet (often the delegate).

**Suggested fix:** Reuse `buildClaimableQuestionRewardCandidateVoters` (or multi-voter `getAllVotes`) in `useAllClaimableRewards` / `useRecentUserVotes`.

---

### P1-3 — Ponder outage returns empty claimables with no user signal

**Fix scope:** Next.js Ponder query layer. No contract change.

**Files:**
- `packages/nextjs/hooks/useRecentUserVotes.ts` — `rpcFn: async () => []`
- `packages/nextjs/hooks/useClaimableQuestionRewards.ts` — same empty-array RPC fallback pattern
- `packages/nextjs/hooks/usePonderQuery.ts` — supports `rpcFn` / `rpcEnabled` but claim hooks do not implement meaningful RPC fallback

**Impact:** When Ponder is down, rate-limited, or deployment-mismatched, claim discovery silently returns empty arrays. On-chain claims still exist; users see no claim button and no error.

**Suggested fix:** Surface indexer-unavailable state in UI, or implement minimal on-chain/RPC fallback for terminal-round claim reads.

---

## P2 — Medium

### P2-1 — Settled rewards hidden while `rewardClaimed` multicall is loading

**File:** `packages/nextjs/hooks/useAllClaimableRewards.ts`

During `claimedLoading`, settled votes are excluded (`return claimedLoading ? false : true`). RBTS reward items are also gated on `!rbtsRewardsLoading`. Transient loading can briefly hide claimables (less severe after optimistic UI fixes, but still flickers).

---

### P2-2 — Post-success claim button can re-enable before indexer converges

**Files:** `packages/nextjs/components/shared/ClaimRewardsButton.tsx`, `packages/nextjs/hooks/useClaimAll.ts`

`onComplete` clears optimistic keys immediately, then polls. If reads still show claimables, the button re-enables before convergence. `failedItems` are not surfaced to the user (only `console.error` in `useClaimAll`).

---

### P2-3 — Metadata sync schema resolution can diverge from indexer schema

**Files:**
- `packages/ponder/src/api/routes/content-routes.ts` — `resolveWritablePonderSchema()`
- `packages/ponder/scripts/databaseSchema.mjs` — Railway / protocol-deployment-key fallbacks

Metadata sync resolves schema from `RATELOOP_PONDER_DATABASE_SCHEMA` → `DATABASE_SCHEMA` → network default. It does not mirror all `databaseSchema.mjs` fallbacks (`RAILWAY_DEPLOYMENT_ID`, `RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY`). Safe when `yarn ponder:start` injects `DATABASE_SCHEMA`; fragile on misconfigured deploys.

---

### P2-4 — Settlement “reward ready to claim” toast misses bundle bounties

**File:** `packages/nextjs/components/SettlementNotifier.tsx`

`claimableRoundKeys` aliases `contentId-roundId` for `question_reward` only. `question_bundle_reward` uses `question-bundle-reward:bundleId-roundSetIndex` in `getClaimableRoundKey`. Pending notifications from `RoundSettled` use `contentId-roundId` and never match bundle claimables.

---

### P2-5 — Non-RBTS settled rounds produce no reward claim items

**File:** `packages/nextjs/hooks/useAllClaimableRewards.ts`

Only votes with `roundRbtsRewardWeight != null` become reward items. Settled votes missing RBTS indexer metadata are dropped. Low incidence if production indexer always populates RBTS fields; worth monitoring.

---

### P2-6 — `VoteCommitted` handler can inflate round counters on replay

**File:** `packages/ponder/src/RoundVotingEngine.ts`

Vote insert uses `.onConflictDoNothing()` but round `voteCount` / `humanVerifiedCommitCount` increment unconditionally. Re-indexing or duplicate event processing can inflate quorum fields without a matching vote row.

**Impact:** Wrong keeper hints, dormancy blocks, correlation eligibility until repair.

---

### P2-7 — Reveal-failed gate: Ponder SQL vs keeper branch mismatch

**Files:** `packages/ponder/src/api/routes/keeper-routes.ts`, `packages/keeper/src/keeper.ts`

Ponder labels `reveal_failed` only when `humanVerifiedCommitCount >= revealQuorum`. Keeper enters reveal-failed branch on `voteCount >= rbtsRevealQuorum` + `isDormancyBlocked()`. On-chain finalize is still gated; impact is extra gas attempts and misleading `/keeper/work` reasons for external consumers.

---

### P2-8 — Multi-instance keeper without Postgres duplicates work

**Files:** `packages/keeper/src/keeper-state.ts`, `packages/keeper/src/config.ts`

Without `KEEPER_DATABASE_URL`, advisory locks are skipped. Documented; production should configure DB + `KEEPER_MAIN_LOOP_LOCK_REQUIRED=true` (default in production).

---

### P2-9 — Ponder deployment verification cache never invalidated

**File:** `packages/keeper/src/keeper.ts` — `verifiedPonderDeploymentCacheKey`

After Ponder redeploy at the same URL with different contracts, keeper skips re-verification until process restart.

---

### P2-10 — Question reward candidate cap still truncates heavy wallets

**File:** `packages/nextjs/hooks/useClaimableQuestionRewards.ts`

Ponder queries use `limit: "500"` with no pagination loop (unlike frontend fee discovery). Wallets with >500 candidates silently miss bounties.

---

### P2-11 — Agent runtime env surface missing from `docs/env-parity.md`

**Files:** `docs/env-parity.md`, `packages/agents/README.md`, `packages/agents/src/config.ts`, `packages/agents/src/localSigner.ts`

Parity doc covers USDC aliases and correlation allowlists but not primary agent vars (`RATELOOP_API_BASE_URL`, `RATELOOP_MCP_TOKEN`, `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL`, keystore vars, contract overrides). Operators using only `env-parity.md` can misconfigure production agents.

---

### P2-12 — Agents x402 parser defaults to Next.js-prefixed env

**File:** `packages/agents/src/x402QuestionPayload.ts`

Default metadata base URL resolves from `NEXT_PUBLIC_PONDER_URL ?? NEXT_PUBLIC_APP_URL` rather than agent-scoped `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL`. Surprising when agents run outside Next.js (CLI, external hosts).

---

### P2-13 — Readiness scripts do not verify artifact allowlist parity

**Files:** `scripts/check-base-mainnet-readiness.mjs`, `scripts/check-base-sepolia-readiness.mjs`, `docs/env-parity.md`

Documented that `KEEPER_ARTIFACT_HTTPS_ALLOWLIST` and `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` must match; no readiness script validates prefix equality when both are set.

---

### P2-14 — Silent artifact fetch failures in Ponder indexer

**File:** `packages/ponder/src/ClusterPayoutOracle.ts` — `cachePayoutArtifact()` empty catch

Failed artifact fetch/indexing is swallowed. Missing `payoutArtifactCache` until reproposal; payout proofs incomplete.

---

## P3 — Low

| ID | Area | Description |
|----|------|-------------|
| P3-1 | Claim UI | Dust rewards hidden in button label but still claimed (`MIN_VISIBLE_*` thresholds) |
| P3-2 | Claim paths | Sponsored vs self-funded bundle claim address paths differ in `useClaimAll.ts` |
| P3-3 | Claim paths | `frontend_registry_fee` zero-reward skip is silent (no toast) |
| P3-4 | Frontend | `useClaimableFrontendRewards` maturity uses static `Date.now()` in memo — up to 60s delay |
| P3-5 | MCP | `validateHandoffWebMcpDraft` error says “categories” but validates `tags` |
| P3-6 | MCP | `isAgentEligibleForBountyMode` still models recheck flag; on-chain recheck disabled |
| P3-7 | Docs | README dead-code section still has quadruple-backtick fence (line ~241) |
| P3-8 | Docs | SDK README “Planned Surface” section stale vs “Available Today” |
| P3-9 | Docs | `node-utils` README omits `profileSelfReport` export; npm tarball excludes README |
| P3-10 | Env | Dead `RATELOOP_REWARD_POOL_EXPIRES_AT` in `packages/agents/.env.example` |
| P3-11 | Env | Agents `.env.example` missing vars documented in agents README |

---

## P4 — Informational

| ID | Area | Description |
|----|------|-------------|
| P4-1 | Vote flow | `useRoundVote` commit double-submit guard is sound (`commitLock` ref) |
| P4-2 | Notifications | `RewardNotifier` and `SettlementNotifier` share 30-minute claim cooldown (intentional dedup) |
| P4-3 | Ponder | `/votes` exposes ciphertext publicly (by design for keeper reveals) |
| P4-4 | Ponder | In-memory rate limiter not replica-safe (documented; `PONDER_REPLICA_COUNT` warning) |
| P4-5 | Ponder | Dormancy discovery uses `lastActivityAt`, not `dormancyAnchorAt` (documented noise) |
| P4-6 | CI | Knip dead-code scan is advisory (`--no-exit-code`) |
| P4-7 | CI | World Chain Sepolia readiness is manual-dispatch only |
| P4-8 | Tests | No integration tests for `ClaimRewardsButton` optimistic lifecycle, `useClaimAll`, or notifier components |

---

## What Looks Healthy

- **All off-chain automated tests green** at review time (`yarn test:ts`).
- **Dependency pins aligned** across TS workspaces: `viem@2.39.0`, `typescript@~5.8.2`, `@types/node@^24`, `pg@^8.20.0`, `tsx@^4.21.0`, Node 24 engines.
- **Root `yarn lint`** now matches CI (`next:lint` + `foundry:lint` + `agents:lint`).
- **Ponder production guards** for metadata sync, keeper work token, and CORS/rate-limit misconfig (with bearer) are in place.
- **Claim rewards eighth-pass regressions** addressed with convergent polling and in-flight guards.
- **Publish workflow** enforces dependency order with OIDC provenance; agents (120), sdk, contracts, node-utils covered in `test:ts`.
- **E2E workflow** sets both `RATELOOP_E2E_PRODUCTION_BUILD` and `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD` per env-parity guidance.

---

## Test Coverage Gaps (Off-Chain)

| Area | Gap |
|------|-----|
| `ClaimRewardsButton.tsx` | Label builders tested; no optimistic UI / polling / in-flight tests |
| `useClaimAll.ts` | No dedicated tests (batch ordering, gas abort, sponsored path) |
| `useAllClaimableRewards.ts` | No tests for loading suppression, delegation, RBTS filter |
| `SettlementNotifier.tsx` / `RewardNotifier.tsx` | No component tests |
| Ponder `api/index.ts` | No tests for authenticated `/votes` rate-limit exemption |
| Next.js API routes | ~81 handlers; ~28 dedicated test files — notifications, watchlist, feedback routes largely untested |
| Keeper `fetchIndexedCiphertextsForRound` | No test asserting bearer header propagation |

---

## Suggested Fix Order

1. **P1-1** — Shared Ponder auth headers on all keeper fetches (unblocks rate-limit exemption intent).
2. **P1-2** — Delegation-aware vote discovery for round claims.
3. **P1-3** — Indexer-unavailable UX or minimal RPC fallback for claim discovery.
4. **P2-4** — Extend `SettlementNotifier` keys for `question_bundle_reward`.
5. **P2-2** — Toast on partial `claimAll` failure; keep button disabled until poll converges.
6. **P2-3** — Unify metadata sync schema resolver with `databaseSchema.mjs`.
7. **P2-6** — Atomic vote insert + counter increment in Ponder indexer.
8. **P2-11–13** — Extend `env-parity.md` and readiness scripts for agent + artifact allowlist parity.
9. **P3-7** — Fix README dead-code fence.
10. **P4-8** — Add regression tests for claim optimistic lifecycle.

---

## Prior Pass Cross-Reference

- **Eighth pass** (`docs/repo-review-eighth-pass-findings-2026-06-25.md`): off-chain items above marked fixed/partial; contract-only items (RECENT_RECHECK on-chain, named errors) remain out of scope for this pass.
- **Seventh pass** Ponder Railway/RPC items: `packages/ponder/railway.toml` uses `start:built-workspace-deps`; `packages/ponder/scripts/start.mjs` includes `assertProductionRpcChainId` — addressed in prior commits.

---

*Generated by automated multi-agent off-chain repository audit. No source files were modified in this pass.*

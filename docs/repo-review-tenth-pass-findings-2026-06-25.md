# Repo Review Tenth Pass Findings — 2026-06-25

Scope: full-repository read-only audit of **off-chain** code and operations — Next.js frontend, Ponder indexer, Keeper service, agents/SDK/node-utils packages, CI/CD, scripts, and documentation. **Solidity smart contracts (`packages/foundry`) are explicitly excluded.** The existing Base mainnet contract deployment is treated as durable production infrastructure.

This pass re-validates ninth-pass off-chain findings after the fix batch pushed earlier today (`9b8e27481` → `03276c82d`), then searches for remaining bugs and inconsistencies.

Current working tree at review time:

- Clean except untracked `tmp/rateloop-rating-system-handoff/` (not reviewed)

## Checks Run

| Check | Result |
|-------|--------|
| `yarn build:workspace-deps` | Passed |
| `yarn test:ts` (full pipeline) | **Passed** — see breakdown below |
| `yarn next:lint --max-warnings=0` | Passed |
| `yarn foundry:test` | **1,810 passed**, 0 failed (contract tests run for CI signal; findings exclude Solidity) |

Not run in this pass: full E2E (`yarn e2e:full`), local chain spin-up, `yarn base-mainnet:check --live`, Slither/Certora (contract scope excluded).

### Test breakdown (`yarn test:ts`)

| Package / area | Tests |
|----------------|-------|
| Root `scripts/` (`yarn test:node`) | 206 |
| `@rateloop/contracts` | 37 |
| `@rateloop/node-utils` | 38 |
| `@rateloop/sdk` | 51 |
| Next.js (`yarn next:test`) | 1,637 |
| Keeper | 250 (+ 1 skipped) |
| Agents | 120 |
| Ponder | 382 (+ 1 skipped) |
| **Approx. TS total** | **~2,721** |

All package typechecks in the `test:ts` pipeline passed (`contracts`, `node-utils`, `sdk`, `ponder`, `agents`, `keeper`, `next:check-types`).

---

## Executive Summary

| Severity | Count | Themes |
|----------|-------|--------|
| **P1 (High)** | 3 | Claim abort UX, Ponder `/deployment` under CORS misconfig, indexer column backfill |
| **P2 (Medium)** | 16 | Keeper correlation auth, settlement notifier regression, claim loading gates, env/docs drift |
| **P3 (Low)** | 12 | Silent Ponder fallbacks, dust UI, test/doc hygiene |
| **P4 (Info)** | 10 | Intentional design, positive coverage, ninth-pass items now resolved |

**Ninth-pass off-chain fixes are largely landed and verified.** New high-impact gaps are a claim-batch abort regression in optimistic UI, keeper correlation artifact fetches without bearer/service auth, and production Ponder `/deployment` probes blocked when `CORS_ORIGIN` is unset.

---

## Ninth-Pass Off-Chain Fixes — Verification Status

| Ninth ID | Topic | Status after today's fixes |
|----------|-------|----------------------------|
| P1-1 | Keeper bearer on `/votes` | **Fixed** — `buildPonderRequestHeaders()` in `keeper.ts`, `correlation-ponder-freshness.ts`; test in `ponder-headers.test.ts` |
| P1-2 | Delegated vote claim discovery | **Fixed** — `useRecentUserVotes` multi-voter merge + test |
| P1-3 | Ponder-down empty claimables | **Fixed** — `rpcEnabled: false`, `ponderUnavailable`, indexer-unavailable UI |
| P2-1 | Settled rewards hidden during claimed multicall | **Partially fixed** — incomplete multicall still treats votes as unclaimed (see P2-3) |
| P2-2 | Post-success claim button before convergence | **Partially fixed** — polling + failure toasts; abort path and key clearing still open (P1-1, P2-2) |
| P2-3 | Metadata sync schema drift | **Fixed** — `content-routes.ts` uses `databaseSchema.mjs` resolver |
| P2-4 | Settlement bundle notification keys | **Partially fixed** — aliases added; over-broad vote loop introduced (see P2-1) |
| P2-5 | Non-RBTS settled rounds | **Open** — low incidence; monitor |
| P2-6 | VoteCommitted counter replay | **Partially fixed** — early return on existing vote; crash-between-steps still open (P2-5) |
| P2-7 | Reveal-failed SQL vs keeper | **Partially fixed** — `cancel` before `reveal`, `reveal_failed` before `reveal`; keeper branch still omits human-verified quorum (P2-4) |
| P2-8 | Multi-instance keeper without Postgres | **Documented** — ops requirement |
| P2-9 | Deployment verification cache | **Fixed** — cache keyed by `deploymentKey` |
| P2-10 | Question reward candidate cap | **Fixed** — `getAllQuestionRewardClaimCandidates` paginates at 200 |
| P2-11–13 | Agent env / readiness / allowlist | **Partially fixed** — env-parity agent table added; allowlist parity only when both vars set; CI does not exercise |
| P2-14 | Silent artifact fetch failures | **Fixed** — `ClusterPayoutOracle` logs warnings |
| P3-4–11 | Low-priority copy/docs | **Mostly fixed** — README fence, MCP tags, SDK/node-utils docs, agents `.env.example` |

---

## P1 — High

### P1-1 — Gas/RPC abort leaves unattempted claim items optimistically hidden

**Fix scope:** Next.js claim UI. No contract change.

**Files:**
- `packages/nextjs/components/shared/ClaimRewardsButton.tsx` — `handleClaimAll` optimistic key lifecycle (lines ~112–160)
- `packages/nextjs/hooks/useClaimAll.ts` — `break` on gas shortage / RPC overload (lines ~583–588) without reporting skipped items

**Impact:** When `claimAll` aborts mid-batch, only the failed item is removed from `optimisticallyClaimedKeys`. Remaining unattempted items stay hidden from `visibleClaimableItems`. The claim button can disappear or stay disabled with no retry path until wallet address changes (which clears optimistic state).

**Suggested fix:** On abort, push all unattempted items into `failedItems`, or restore optimistic keys for `itemsToClaim \ (claimedItems ∪ failedItems)` in `onComplete`.

---

### P1-2 — `/deployment` blocked when `CORS_ORIGIN` unset in production

**Fix scope:** Ponder API bootstrap. No contract change.

**Files:**
- `packages/ponder/src/api/index.ts` — rate-limit middleware exempts `/deployment` (lines ~80–88); CORS misconfig middleware does **not** (lines ~132–141)
- `packages/keeper/src/keeper.ts` — `assertPonderDeploymentMatchesKeeper()` calls `GET /deployment` before work/ciphertext fetches (lines ~607–621, ~998)

**Impact:** Production Ponder without `CORS_ORIGIN` returns 503 on `/deployment` even when `PONDER_KEEPER_WORK_TOKEN` is valid. Keeper deployment verification fails → reveal/correlation ticks fail fatally. Rate-limit misconfig alone does not cause this; CORS misconfig does.

**Suggested fix:** Exempt `/deployment` from the CORS-misconfig 503 gate (server-to-server probe), mirroring the rate-limit exemption.

**Test gap:** `api-index.test.ts` covers `/deployment` under rate-limit misconfig with `CORS_ORIGIN` set; no test for CORS-misconfig + `/deployment`.

---

### P1-3 — `humanVerifiedCommitCount` backfill required for correct keeper hints

**Fix scope:** Operations / indexer migration. No contract change.

**Files:**
- `packages/ponder/README.md` — documents backfill requirement
- `packages/ponder/src/api/routes/keeper-routes.ts` — `reveal_failed` and dormant SQL use `humanVerifiedCommitCount` (lines ~84–88, ~177–182)
- `packages/ponder/ponder.schema.ts` — column default `0` for pre-migration rows

**Impact:** Stale Postgres rows without backfill under-report human-verified quorum. `/keeper/work` may omit `reveal_failed` / dormant candidates until reindex; on-chain state can be ahead of indexer hints.

**Suggested fix:** Run documented backfill or full reindex before relying on Ponder work discovery in production.

---

## P2 — Medium

### P2-1 — Settlement toast fires prematurely when any bundle bounty exists

**Fix scope:** Next.js notifications. No contract change.

**File:** `packages/nextjs/components/SettlementNotifier.tsx` (lines ~81–99)

When `hasBundleClaimable`, **every** vote’s `contentId-roundId` is added to `claimableRoundKeys`, not only bundle-related rounds. Pending `RoundSettled` notifications can match before round LREP/USDC items appear in `claimableItems`.

**Impact:** “Reward Ready to Claim” toast links to `/governance` before rewards are actually discoverable.

**Suggested fix:** Remove the `hasBundleClaimable` vote loop (lines ~94–98). Rely on `getClaimableRoundKey`, `question_reward` alias, and `payoutWeight` content-round keys only.

---

### P2-2 — Optimistic claim keys cleared after poll even if indexer has not converged

**File:** `packages/nextjs/components/shared/ClaimRewardsButton.tsx` (lines ~142–157)

Succeeded keys are removed from the optimistic set after `pollClaimableRewardsRefresh` regardless of whether `shouldStop` became true. Button can re-enable while stale claimables remain in underlying reads.

**Suggested fix:** Clear succeeded keys only when `shouldStop()` is true; keep button disabled until convergence.

---

### P2-3 — Transient over-display during `rewardClaimed` multicall

**File:** `packages/nextjs/hooks/useAllClaimableRewards.ts` (lines ~138–151)

While `claimedResults` is incomplete, terminal votes are treated as unclaimed. Claim button can flash amounts that multicall then removes.

**Suggested fix:** Gate `unclaimedVotes` on `!claimedLoading` or exclude incomplete multicall from claimable totals.

---

### P2-4 — Combined `isLoading` omits vote-index fetch

**File:** `packages/nextjs/hooks/useAllClaimableRewards.ts` (lines ~67, ~313–314)

`isLoading` does not include `useRecentUserVotes` loading. `ClaimRewardsButton` can render before round claimables are known.

**Suggested fix:** Include votes loading/delegation loading in combined `isLoading`.

---

### P2-5 — `VoteCommitted` not atomic across crash recovery

**File:** `packages/ponder/src/RoundVotingEngine.ts` (lines ~708–840)

Early return on existing vote protects full replays (tested). Round counters increment **before** vote insert; handler crash between steps can inflate counters without a vote row on retry.

**Suggested fix:** Transactional insert-first pattern or counter updates gated on successful vote insert.

---

### P2-6 — `correlation-artifact-builder` omits bearer on Ponder fetches

**Files:**
- `packages/keeper/src/correlation-artifact-builder.ts` — `fetchJson()` sends only `accept: application/json` (lines ~694–707)
- `packages/ponder/src/api/index.ts` — `/correlation/*` and `/rounds` are outside `KEEPER_INTERNAL_PATH_PREFIXES`

**Impact:** Automatic correlation snapshot builds hit 120 req/min IP limits or 503 when `RATE_LIMIT_TRUSTED_IP_HEADERS` is unset. Unlike `/votes`, bearer does not exempt these paths.

**Suggested fix:** Route through `buildPonderRequestHeaders()` and extend keeper-internal path exemptions (with bearer check) to correlation routes, or add dedicated service auth.

---

### P2-7 — Keeper reveal-failed branch omits human-verified commit quorum

**Files:**
- `packages/ponder/src/api/routes/keeper-routes.ts` — SQL requires `humanVerifiedCommitCount >= revealQuorum` for `reveal_failed`
- `packages/keeper/src/keeper.ts` — reveal-failed branch on `voteCount >= rbtsRevealQuorum` only (~lines 1427–1432)

**Impact:** Extra RPC/gas on rounds that cannot finalize on-chain; SQL `reason` hints and keeper behavior diverge.

**Suggested fix:** Align keeper gate with Ponder SQL / on-chain dormancy semantics.

---

### P2-8 — Settled non-RBTS rounds produce no round reward items

**File:** `packages/nextjs/hooks/useAllClaimableRewards.ts`

Only votes with `roundRbtsRewardWeight != null` become LREP reward items. Missing indexer RBTS metadata drops rewards silently.

**Suggested fix:** Monitor in production; optional on-chain RBTS fallback reads.

---

### P2-9 — Multi-voter question bounty dedup may drop proof-bearing candidate

**File:** `packages/nextjs/hooks/useClaimableQuestionRewards.ts` (lines ~136–141)

Merged candidates dedupe on `rewardPoolId-roundId` only. Delegate + holder candidates for the same pool/round with different payout proofs can collapse incorrectly.

**Suggested fix:** Dedupe on `(rewardPoolId, roundId, voter)` or prefer candidate with complete `payoutProof`.

---

### P2-10 — Frontend fee API errors not surfaced in claim UI

**Files:** `packages/nextjs/hooks/useClaimableFrontendRewards.ts`, `packages/nextjs/app/api/frontend/claimable-fees/route.ts`

`roundFeesQuery` errors leave `roundFeeItems` empty with no user-visible signal.

**Suggested fix:** Expose `isError` through `useAllClaimableRewards` or status copy in `ClaimRewardsButton`.

---

### P2-11 — `docs/env-parity.md` incomplete vs agent runtime code

**Files:** `docs/env-parity.md`, `packages/agents/src/localSigner.ts`, `packages/agents/.env.example`

Agent runtime table omits several vars the code reads: local-signer contract overrides (`CONTENT_REGISTRY`, `QUESTION_REWARD_POOL_ESCROW`, `FEEDBACK_BONUS_ESCROW`, `LREP`), `RATELOOP_LOCAL_SIGNER_PASSWORD_ENV`, polling timeouts, `RATELOOP_CHAIN_NAME`, legacy metadata URL, attachment-origin fallbacks (`APP_URL`, `VERCEL_URL`).

**Suggested fix:** Extend env-parity with “Local signer contract overrides” and “Agent attachment-origin fallbacks” subsections.

---

### P2-12 — Agents README env table out of sync with `.env.example`

**File:** `packages/agents/README.md` vs `packages/agents/.env.example`

README configuration table omits `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL`, `RATELOOP_LOCAL_SIGNER_FEEDBACK_BONUS_ESCROW_ADDRESS`, `RATELOOP_LOCAL_SIGNER_LREP_ADDRESS` (shown elsewhere in README but not in the table).

---

### P2-13 — SDK README documents nonexistent `PONDER_URL` env var

**File:** `packages/sdk/README.md` (line ~41)

Example uses `process.env.PONDER_URL`. Canonical browser env is `NEXT_PUBLIC_PONDER_URL`; agents use explicit `apiBaseUrl` / `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL`.

---

### P2-14 — `PONDER_METADATA_SYNC_TOKEN` not in live readiness required-env gate

**Files:** `docs/env-parity.md`, `scripts/check-worldchain-sepolia-readiness.mjs`

env-parity documents production requirement; `validateOffchainRuntimeEnv` does not require the token when `--require-live-targets` is set (unlike `PONDER_KEEPER_WORK_TOKEN`).

---

### P2-15 — Artifact allowlist parity not exercised in CI

**Files:** `docs/env-parity.md`, `.github/workflows/base-*-readiness.yaml`

`validateArtifactAllowlistParity` no-ops when either allowlist env is unset. CI workflows do not set paired fixture values, so parity is never validated on push/PR.

---

### P2-16 — `X402_QUESTION_TOP_LEVEL_FIELDS` only enforced in agents

**Files:** `packages/node-utils/src/x402QuestionFields.ts`, `packages/agents/src/x402QuestionPayload.ts`, `packages/nextjs/lib/x402/questionSubmission.ts`

Shared field set documented for parity; Next.js parser does not import it → silent field drift risk between agents and app.

---

## P3 — Low

| ID | Area | Description |
|----|------|-------------|
| P3-1 | Claim UI | Dust rewards below `MIN_VISIBLE_*` thresholds remain claimable in data but button returns null |
| P3-2 | Notifications | `RewardNotifier` ignores `ponderUnavailable`; outage/recovery can cause extra toasts |
| P3-3 | Ponder fallbacks | `useViewerRewardStatuses`, `useDiscoverSignals`, `useVotingStakes` still use empty RPC fallbacks |
| P3-4 | MCP | `isRaterEligibleForBounty` returns false for `RECENT_RECHECK_FLAG` (on-chain recheck disabled) |
| P3-5 | Claims | Refund postcondition polling uses `item.voter` not connected wallet (delegation edge) |
| P3-6 | Frontend fees | `useUnixTime(60_000)` — up to 60s delay on matured withdrawal detection |
| P3-7 | Claims | Zero `frontend_registry_fee` skip is silent (no toast) |
| P3-8 | Ponder | Bearer comparison not timing-safe (`api/index.ts`) — low practical risk |
| P3-9 | Ponder | `/votes` ciphertext fetchable without scoped `contentId`+`roundId` (rate-limited public design) |
| P3-10 | node-utils | No direct tests for `identityKeys`, `contentModeration`, `x402QuestionFields` |
| P3-11 | SDK | `config.ts` / `errors.ts` thin modules untested directly |
| P3-12 | CI | Lint workflow omits `sdk`/`node-utils`/`agents` typecheck (covered only in `test:ts`) |

---

## P4 — Informational

| ID | Area | Description |
|----|------|-------------|
| P4-1 | Dependencies | `viem@2.39.0`, Node `>=24`, `typescript@~5.8.2`, `@types/node@^24` aligned across TS workspaces |
| P4-2 | Claim flow | Delegation-aware discovery, `ponderUnavailable` UX, convergent polling, failure toasts landed |
| P4-3 | Keeper | Bearer on work/deployment/votes/correlation-freshness paths; `ponder-headers.test.ts` added |
| P4-4 | Ponder | Metadata sync production guard, keeper work token startup validation, rate-limit fail-closed |
| P4-5 | Ponder | `/keeper/work` SQL now orders `cancel` and `reveal_failed` before generic `reveal` |
| P4-6 | Agents | x402 metadata base URL precedence fixed (`RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL` first) |
| P4-7 | Agents | `handoffUpload.ts` path-prefix bug fixed with tests |
| P4-8 | CI | Root `yarn lint` includes `agents:lint`; `test:ts` runs all package typechecks |
| P4-9 | Design | `RewardNotifier` + `SettlementNotifier` share 30-minute claim cooldown (intentional dedup) |
| P4-10 | Tests | No component tests for optimistic claim lifecycle, `useClaimAll` batch abort, or notifier components |

---

## What Looks Healthy

- **All off-chain automated tests green** at review time (`yarn test:ts`, `yarn next:lint`, `yarn foundry:test` for CI signal).
- **Ninth-pass claim/indexer fixes** materially improved delegation discovery, Ponder outage signaling, question-reward pagination, and keeper→Ponder auth on primary paths.
- **Publish workflow** and dependency pins remain consistent across `@rateloop/contracts`, `node-utils`, `sdk`, `agents`, `nextjs`, `ponder`, `keeper`.
- **Readiness infrastructure** (`check-base-*-readiness.mjs`, workflow matrices, `validateArtifactAllowlistParity` helper) is in good shape; gaps are enforcement coverage, not missing scripts.
- **Env bootstrapping** in Next.js fails fast on missing deployments and invalid `NEXT_PUBLIC_FRONTEND_CODE`.

---

## Test Coverage Gaps (Off-Chain)

| Area | Gap |
|------|-----|
| `ClaimRewardsButton.tsx` | No tests for gas-abort optimistic recovery or poll convergence gating |
| `useClaimAll.ts` | No tests for mid-batch `break` / skipped items reporting |
| `correlation-artifact-builder.ts` | No assertion that Ponder fetches send bearer headers |
| Ponder `api/index.ts` | No CORS-misconfig + `/deployment` integration test |
| `SettlementNotifier.tsx` | No tests for bundle key aliasing / premature toast regression |
| `useAllClaimableRewards.ts` | No tests for multicall loading gates or votes loading in `isLoading` |
| node-utils | `identityKeys`, `contentModeration`, `x402QuestionFields` untested |
| Readiness | `PONDER_METADATA_SYNC_TOKEN` not in required-env unit tests |

---

## Suggested Fix Order

1. **P1-1** — Restore optimistic keys / report skipped items on gas/RPC abort.
2. **P1-2** — Exempt `/deployment` from CORS-misconfig 503.
3. **P2-1** — Remove over-broad bundle vote-key aliasing in `SettlementNotifier`.
4. **P2-6** — Bearer + path exemptions for correlation artifact builder.
5. **P2-2 / P2-3 / P2-4** — Claim loading and convergence gates.
6. **P2-7** — Align keeper reveal-failed gate with Ponder SQL.
7. **P2-5** — Harden `VoteCommitted` idempotency for crash recovery.
8. **P2-11–16** — Env/docs/readiness/parser parity.
9. **P1-3** — Ops: `humanVerifiedCommitCount` backfill before production cutover.

---

## Prior Pass Cross-Reference

- **Ninth pass** (`docs/repo-review-ninth-pass-findings-2026-06-25.md`): items marked fixed/partial above; this pass confirms the fix batch and surfaces regressions (P2-1 bundle aliasing) and remaining gaps.
- **Eighth pass** (`docs/repo-review-eighth-pass-findings-2026-06-25.md`): contract-only items (on-chain `RECENT_RECHECK`, named errors) remain out of scope.

---

*Generated by automated multi-agent off-chain repository audit. No source files were modified in this pass.*

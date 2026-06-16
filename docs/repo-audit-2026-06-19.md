# RateLoop Repo Audit — Bugs & Inconsistencies (19 June 2026)

Multi-agent read-only audit of the RateLoop monorepo at HEAD `8e79e8d6` (`Fail closed on remaining agent audit and export read routes`), following the [18 June audit](repo-audit-2026-06-18.md) remediation batch (`0868b564`..`8e79e8d6`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/API, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, Ponder tests).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **June 18 remediation batch closed almost all prior High/Medium items**: partial correlation epochs, gated-context docs, signing-intent empty plans, HRC commit quorum, rating vote bans, oracle pinning, consumer-revert liveness, keeper discovery merge, cleanup every tick, env-parity docs, and canary CI.

**Dominant remaining risks** are narrower and mostly operational:

1. **Correlation freshness** compares `revealedCount` via unpaginated `GET /rounds?limit=200` — high round-count content can defer builds indefinitely (N1).
2. **Public-rating oracle repoint** exists in a library but is **not callable** on `ContentRegistry`, while the foundry runbook says it is (M5-B / SOL-NEW-1).
3. **Signing-intent prepare** does not persist `transactionPlan` — page reload loses executable calls (M-API-1).
4. **Ponder `humanVerifiedCommitCount`** needs reindex/backfill on existing DBs after schema deploy (M2-R).

No new High-severity fund-loss Solidity paths were found. Contracts are not on production mainnet yet.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | June M5/M6/M8 fixes landed; repoint doc mismatch; tight EIP-170 on ContentRegistry |
| 2 | Next.js / API | June M4/L1–L4/H3 fixed; signing-intent persistence gap; M12/M13 partial |
| 3 | Keeper + Ponder | June H2/M2–M3/M10/L5 fixed; freshness pagination gap; migration backfill |
| 4 | Cross-package | env-parity, canary CI, skill.md aligned; residual ai.md/sdk.md drift |

Prior audit: [`repo-audit-2026-06-18.md`](repo-audit-2026-06-18.md).

---

## Verification snapshot (HEAD `8e79e8d6`)

| Check | Result |
| --- | --- |
| `packages/foundry/scripts/check-contract-sizes.sh` | **Pass** — all contracts ≤ 24,576 B; `ContentRegistry` 24,514 B (62 B headroom) |
| `packages/ponder` `yarn test` | **315 pass, 1 skip** (local) |
| `deployedContracts.ts` chains | `480`, `4801`, `31337` |
| Partial epoch publish | Skipped when `sawNextEpoch` + oversized epoch |
| Correlation Ponder freshness | `correlation-ponder-freshness.ts` gates on `revealedCount` |
| HRC quorum SQL | `humanVerifiedCommitCount >= greatest(minVoters, 3)` |
| Gated `detailsUrl` in skill.md | Required; optional `imageUrls` |
| `docs/env-parity.md` | Present; linked from nextjs/agents README |
| Canary CI workflow | `.github/workflows/worldchain-mainnet-canary-readiness.yaml` |

---

## 1. High

### H1 — Correlation freshness fragile for high round-count content

**Severity:** High at scale (indefinite defer); Medium for typical content  
**Status:** Open (residual of 18 Jun H1)  
**New**

`areCorrelationCandidatesPonderFresh` fetches Ponder `revealedCount` via `GET /rounds?contentId=&limit=200`, ordered by `desc(startTime)`, then scans for a matching `roundId`. Content with **>200 rounds** where the candidate round is outside the newest 200 returns `null` → artifact build deferred every tick.

**Locations:** `packages/keeper/src/correlation-ponder-freshness.ts` (~44–62); `packages/ponder/src/api/routes/content-routes.ts` (`GET /rounds`).

**Impact:** Correlation artifacts never auto-build for old rounds on high-activity content; manual CLI build may still proceed.

**Fix:** Add `roundId` filter to `/rounds` (or dedicated round endpoint); paginate until match; optionally gate on vote-row parity or indexed block ≥ settlement block.

---

## 2. Medium

### M1 — Correlation freshness is revealedCount-only

**Severity:** Medium  
**Status:** Open (residual)

Freshness passes when Ponder `revealedCount` ≥ chain, but correlation vote payloads (RBTS weights, ban exclusions) may still be indexing. No settlement-block or vote-count parity check.

**Locations:** `correlation-ponder-freshness.ts`; `correlation-snapshots.ts` (freshness runs after one-tick defer).

**Fix:** Extend gate with vote fetch stability signal or indexed-block check; add multi-tick integration test.

---

### M2 — Public-rating oracle repoint not exposed on ContentRegistry

**Severity:** Medium (governance/ops)  
**Status:** Open (18 Jun M5 partial)  
**New / carry-over**

`repointPendingRatingClusterPayoutOracle` exists in `ContentRegistryRatingSnapshotLib` but has **no external wrapper** on `ContentRegistry`. Foundry README runbook step lists `ContentRegistry.repointPendingRatingClusterPayoutOracle` — **that function does not exist on the contract**.

Oracle **pinning at record time** works (`testPublicRatingSnapshotUsesPinnedOracleAfterConfigRotation`).

**Locations:** `ContentRegistryRatingSnapshotLib.sol` (~92–119); `packages/foundry/README.md` (~167); `ContentRegistry.sol` (no wrapper).

**Fix:** Thin `CONFIG_ROLE` wrapper or delegate contract (EIP-170 blocks in-contract addition — 62 B headroom); correct runbook until shipped.

---

### M3 — Ponder `humanVerifiedCommitCount` needs backfill on existing DBs

**Severity:** Medium (ops); Low for safety  
**Status:** Open  
**New**

New column defaults to `0` on migration. Pre-existing rows with `hasHumanVerifiedCommit=true` keep `humanVerifiedCommitCount=0` until **full reindex**. `/keeper/work` reveal_failed hints are false negatives (safer than old false positives).

**Locations:** `ponder.schema.ts` (~199); `RoundVotingEngine.ts` handler; `keeper-routes.ts` SQL.

**Fix:** One-time SQL backfill from vote rows or documented reindex procedure in Ponder deploy notes.

---

### M4 — Signing-intent prepare does not persist transaction plan

**Severity:** Medium (UX/integration)  
**Status:** Open  
**New**

`prepareAgentSigningIntent` validates non-empty `transactionPlan.calls` but does not persist the plan. GET returns DB row without `transactionPlan`; browser signing page breaks on reload. Prepare response spreads MCP body (`status: "awaiting_wallet_signature"`) over DB `status: "prepared"`.

**Locations:** `lib/agent/signingIntents.ts`; `components/agent/BrowserSigningPage.tsx`; `lib/db/schema.ts` (no `transaction_plan` column).

**Contrast:** Handoffs persist `transaction_plan` and idempotently return cached plan.

**Fix:** Persist plan/authorization on prepare (mirror handoffs) or document reload requires re-prepare.

---

### M5 — Keeper discovery liveness still bounded at scale

**Severity:** Medium (High at >500 active urgent items)  
**Status:** Partial (improved)

June fix merges bounded chain scan (`chainScanPerTick`, default ~5) with Ponder `/keeper/work` (cap 500). Content outside Ponder top-500 **and** not hit by rotating cursor waits until full reconciliation (default 120 ticks ≈ 60 min).

**Locations:** `keeper.ts` (`discoverKeeperWorkCandidates`, `scanBoundedChainContentIds`); `keeper/README.md`.

**Fix:** Urgency-based prioritization; larger scan budget; or document strict SLA.

---

### M6 — ClusterPayoutOracle reproposal when consumption unknown

**Severity:** Medium (governance/liveness)  
**Status:** Partial (rejection fixed; reproposal open)

Post-veto **rejection** no longer blocks on catch-path `consumed=true` when `!consumedKnown` (`ClusterPayoutOracle.sol` ~682). **Reproposal** still reverts `SnapshotExists` when finalized + `!consumedKnown` (~446–451).

**Fix:** Document arbiter 7-day SLA; optional allow stale finalized replacement when `!consumedKnown`.

---

### M7 — Engine rotation footguns

**Severity:** Medium (governance/ops)  
**Status:** Documented; code unchanged

Only `ContentRegistry` + `FrontendRegistry` expose `setVotingEngine`. Escrows pin engine at init. Runbook in `packages/foundry/README.md` §Governance Runbooks.

**Fix:** Coordinated replacement-stack redeploy mandatory pre-mainnet.

---

### M8 — x402 submit-time economics not mirrored offline

**Severity:** Medium  
**Status:** Partial (documented)

`lintAgentAskRequest` covers structure, gated `detailsUrl`, attachment origins, static floors. Submit-only: on-chain `minSubmissionUsdcPool`, coverage vs `maxVoters`, moderation approval, `validateRoundConfig` in `questionSubmission.ts`. Documented in `packages/agents/README.md`.

---

### M9 — USDC env split across browser/server/agents

**Severity:** Medium  
**Status:** Partial

Three USDC names; mismatch throw only when **both** `NEXT_PUBLIC_USDC_ADDRESS` and `RATELOOP_X402_USDC_ADDRESS` set and differ. `docs/env-parity.md` documents aliases.

---

### M10 — Residual wall-clock in some Ponder routes

**Severity:** Low–Medium  
**Status:** Partial

Correlation, discovery, content voteable paths accept `?now=`. `data-routes.ts`, `leaderboard-routes.ts` still default to `Date.now()`.

---

## 3. Low

### L1 — Residual gated-context doc drift in `ai.md`

`public/docs/ai.md` line 231: “`imageUrls` **or** `detailsUrl`” — parser requires `detailsUrl` for gated. `skill.md` and `how-it-works.md` are aligned.

### L2 — Mixed error envelopes on a few routes

Policy `session`, signing-intent token validation, and `jsonBodyErrorResponse` still return `{ error: string }`. Most agent/handoff/policy mutation routes use normalized envelopes.

### L3 — Signing-intent idempotent prepare always re-calls MCP

Unlike handoffs, no short-circuit when already `prepared` with valid artifacts.

### L4 — Client E2E flag reads `NEXT_PUBLIC_*` only in `public.ts`

Server paths honor both `RATELOOP_E2E_PRODUCTION_BUILD` and `NEXT_PUBLIC_*`; client bundle may diverge if only server flag set.

### L5 — Lint error copy still says “imageUrls and/or detailsUrl”

`packages/agents/src/questions/lint.ts` external-context error wording; enforcement requires `detailsUrl` for gated.

### L6 — Chain ID example asymmetry

SDK README uses `4801`; public `sdk.md` / `ai.md` examples use `480`. Documented in SDK README legend.

### L7 — Dead `RaterRegistry` follow counters

`followingCount` / `followerCount` unused; documented in `env-parity.md`.

### L8 — Interface drift (carry-over)

Partial interfaces vs implementations; no canonical `IContentRegistry`.

### L9 — EIP-170 headroom tight on several contracts

`ContentRegistry` 62 B; `RoundVotingEngine` 14 B; `RaterRegistry` 36 B; `LaunchDistributionPool` 38 B. Table in foundry README.

### L10 — Settlement side-effect failures swallowed silently

`RoundSettlementSideEffectsLib` try/catch on `recordPendingRatingSettlement`; emits `SettlementSideEffectFailed` only — no tests, no on-chain recovery.

### L11 — Manual correlation CLI skips freshness and `now`

`build-correlation-artifact.ts` ops path bypasses Ponder freshness gate and chain-time ban checks.

### L12 — `hasHumanVerifiedCommit` boolean still in API surface

Sticky boolean (`count > 0`) exposed alongside count; can mislead UI after migration.

---

## 4. Fixed since 18 June audit

| ID (18 Jun) | Title | Fix evidence |
| --- | --- | --- |
| H2 | Partial correlation epochs | `selectCompleteEpochCandidates` skips when `sawNextEpoch` (`0868b564`) |
| H3 | Gated docs vs parser | `skill.md`, `how-it-works.md` require `detailsUrl` (`5b1dd055`) |
| H1 | Stale Ponder votes | `correlation-ponder-freshness.ts` + defer (`58c3dfa0`) — **residual → H1/M1** |
| M1 | Keeper discovery | Bounded chain scan merge (`589cf595`) — **residual → M5** |
| M2 | HRC boolean vs quorum | `humanVerifiedCommitCount` + SQL (`da602f5a`) — **migration → M3** |
| M3 | Rating vote bans | `rating-round-votes` ban filter (`ca5497a6`) |
| M4 | Signing-intent empty plan | `signingIntents.ts` guard (`08b9f63b`) — **persistence → M4** |
| M5 | Oracle pinning | Pending rating pins oracle (`9e201459`) — **repoint → M2** |
| M6 | Consumer revert liveness | Post-veto rejection fix (`acece013`) — **reproposal → M6** |
| M7 | Engine rotation | Runbook (`1d3fa364`) |
| M8 | Public-rating consumer validation | `ProtocolConfig` (`20c01092`) |
| M9 | Wall clock | `resolveApiNowSeconds` on discovery/content (`0a371ed6`) — **partial → M10** |
| M10 | Cleanup only on reconcile | Every-tick cleanup (`589cf595`) |
| M11 | Canary CI | Workflow (`f78c146e`) |
| M12/M13 | Lint/env parity | `env-parity.md`, agents README (`f4f50db6`) |
| L1–L6, L11 | E2E flag, envelopes, fail-closed, handoff idempotency, ROUND_STATE, submitter alias | Commits `b023db88`..`8e79e8d6` |

---

## 5. Test coverage gaps

| Gap | Risk |
| --- | --- |
| No unit tests for `correlation-ponder-freshness.ts` | H1 |
| No multi-tick defer → freshness → build integration test | M1 |
| No test: `/rounds` limit hides target `roundId` | H1 |
| No handler test: `humanVerifiedCommitCount` accumulates to quorum | M3 |
| No signing-intent empty-plan regression test | M4 (guard exists, untested) |
| No test for reproposal `SnapshotExists` when `!consumedKnown` | M6 |
| No test for `SettlementSideEffectFailed` | L10 |
| No integration test for discovery cap worst-case latency | M5 |

---

## 6. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **H1** — Round-targeted Ponder freshness query | Small |
| 2 | **M2** — Expose or document oracle repoint; fix runbook | Small–medium |
| 3 | **M4** — Persist signing-intent transaction plan | Medium |
| 4 | **M3** — Ponder reindex/backfill runbook | Small (ops) |
| 5 | **M1** — Stronger freshness signal + integration test | Medium |
| 6 | **L1** — Align `ai.md` gated wording | Trivial |
| 7 | **M5/M6/M8–M10** — Discovery, reproposal, lint, env, wall clock | Small–medium |
| 8 | **L2–L12** — Hygiene | Small |

---

## 7. Notes

- **Working tree:** Unrelated UI component edits (`LandingPageActions.tsx`, `HumanSignInButton.tsx`) were present at audit time — not part of this audit scope.
- **June 18 doc** is stale for open-item status; this document supersedes it.
- **Trust model:** Optimistic oracle per `AGENTS.md` (challenge bonds anti-spam, 60-minute reveal grace, 7-day arbiter veto).
- **Canary vs production:** `480.json` is `mainnet-canary`; promotion uses `yarn worldchain:check --production`.

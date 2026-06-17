# RateLoop Repo Audit — Bugs & Inconsistencies (21 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `a5660afa` (`docs: align agent README and public SDK/AI docs with current routes`), following the [20 June audit](repo-audit-2026-06-20.md) remediation batch (`e1d693a5`..`a5660afa`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/API, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, targeted test runs).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **June 20 remediation batch closed most prior High/Medium items**: correlation defer removed, repoint exposed on `ContentRegistry`, finalized reproposal with live parent epoch, 16 MB agent HTTP limits, signing-intent GET header-only, keeper reconciliation merge, handler tests, gas budget restored, and HRC quorum types on `openRound`.

**New dominant risk** (keeper, introduced by M1 freshness extension):

1. **Public-rating correlation freshness calls the wrong Ponder endpoint** — vote-row gate always hits `/correlation/round-votes?rewardPoolId=0`, which Ponder rejects with **400**; can fail keeper ticks and block public-rating auto-build (H1-new).

**Other notable open items:**

2. Freshness vote gate uses question-reward endpoint semantics for all domains; bundle/public-rating paths diverge from artifact builder (M1 carry-over).
3. Documented HRC backfill SQL references a **nonexistent** `human_credential` column (M4 ops).
4. Browser USDC reads still ignore server-only `RATELOOP_X402_USDC_ADDRESS` (M9 partial).
5. `sdk.md` misdocuments signing-intent prepare/complete auth (header vs body).

No new High-severity fund-loss Solidity paths were found. Contracts are not on production mainnet yet.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | June M2/M6/L10/L11 fixed; 1,745 tests green; M6 partial on Proposed/Challenged |
| 2 | Next.js / API | June M4/L1 largely fixed; USDC/HRC/errors partial; sdk.md auth drift |
| 3 | Keeper + Ponder | June H1 defer fixed; **freshness endpoint regression** for domain 3; bad backfill SQL |
| 4 | Cross-package | SDK read URL wrong; chain ID 480 vs 4801 drift; CI/local script gaps |

Prior audits: [`repo-audit-2026-06-20.md`](repo-audit-2026-06-20.md), [`repo-audit-2026-06-19.md`](repo-audit-2026-06-19.md).

---

## Verification snapshot (HEAD `a5660afa`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — all contracts ≤ 24,576 B; `ContentRegistry` 24,394 B (182 B headroom); tightest: `RoundVotingEngine` 24,562 B (14 B) |
| Default-profile size check (no deploy profile) | **3 oversized** — `LaunchDistributionPool`, `QuestionRewardPoolEscrow`, `RoundVotingEngine`; deploy profile is authoritative |
| `packages/foundry` `forge test --summary` | **1,745 pass, 0 fail** (CI runs without `DEPLOY_PROFILE`) |
| `packages/ponder` vitest | **324 pass, 1 skip** |
| `packages/keeper` vitest | **206 pass, 1 skip**; freshness unit tests **3 pass** |
| `GasBudgetTest.testGas_submitContent_underBudget` | **Pass** — ~896,833 gas vs 952,000 limit |
| June 20 defer removal | **Verified** — no `deferPonderArtifactBuild` in keeper |
| June 20 repoint wrapper | **Verified** — `ContentRegistry.repointPendingRatingClusterPayoutOracle` + tests |

---

## 1. High

### H1 — Public-rating freshness hits invalid Ponder endpoint (`rewardPoolId=0`)

**Severity:** High on deployments with public-rating correlation auto-build; Medium if rating candidates are absent from batches  
**Status:** Open (**new regression** from M1 freshness extension)  
**Prior:** June 20 M1 added vote-row gate; June 20 H1 defer fix exposes this path on every tick

The vote-row freshness gate in `correlation-ponder-freshness.ts` always calls `/correlation/round-votes` with `candidate.rewardPoolId`. Public-rating candidates use `rewardPoolId=0` (domain 3). Ponder rejects `rewardPoolId=0` via `validPositiveBigIntParam` (requires `> 0`) — confirmed in `route-validation.test.ts` (400).

The artifact **builder** correctly routes by domain (`/correlation/rating-round-votes` without `rewardPoolId`; `/correlation/bundle-round-votes` for bundles). Freshness does not.

**Locations:** `packages/keeper/src/correlation-ponder-freshness.ts` (~19–40, ~171–197); `packages/ponder/src/api/routes/correlation-routes.ts` (~234–237, ~521–524); `packages/keeper/src/correlation-artifact-builder.ts` (~605–615).

**Impact:** Settled public-rating rounds with `revealedCount > 0` cause `fetchPonderJson` to throw on 400; keeper tick may log run failure; public-rating correlation artifacts never auto-build.

**Fix:** Mirror builder endpoint selection by `candidate.domain`; handle non-OK responses without failing the whole tick.

---

## 2. Medium

### M1 — Freshness vote-row gate ignores candidate domain (bundle path)

**Severity:** Medium  
**Status:** Open (partial June 20 M1)

Same root cause as H1 for domain 1 vs 2 vs 3: freshness always uses question-reward `/correlation/round-votes` SQL joins. Bundle candidates need `/correlation/bundle-round-votes`.

**Locations:** `correlation-ponder-freshness.ts`; contrast `correlation-artifact-builder.ts` (~605–610).

**Impact:** Bundle-domain rounds may never pass freshness even when fully indexed.

---

### M2 — Freshness compares chain `revealedCount` to correlation-eligible rows only

**Severity:** Medium  
**Status:** Open

Gate requires `ponderCorrelationVotes >= chainRound.revealedCount`. `/correlation/round-votes` excludes funder, submitter, and bounty-ineligible votes before formatting. Those votes still increment on-chain `revealedCount`.

**Locations:** `correlation-ponder-freshness.ts` (~182–185); `correlation-routes.ts` vote SQL filters.

**Impact:** Rounds with correlation-excluded revealed votes can stall auto-build indefinitely.

---

### M3 — Freshness vote fetch omits chain-time `now`

**Severity:** Medium (consistency)  
**Status:** Open

Auto keeper passes `ponderNowSeconds` (block timestamp) to artifact build but not to `areCorrelationCandidatesPonderFresh`. Ban filtering in correlation routes uses `resolveApiNowSeconds` (wall clock when `?now` omitted).

**Locations:** `correlation-snapshots.ts` (~828 vs ~886); `correlation-ponder-freshness.ts`; `shared.ts`.

---

### M4 — HRC backfill SQL references nonexistent column

**Severity:** Medium (ops)  
**Status:** Open

README backfill uses `WHERE human_credential = true`. Vote table uses `credentialMask`; handler checks `(credentialMask & (1 << 3)) !== 0`.

**Locations:** `packages/ponder/README.md` (~138–148); `ponder.schema.ts`; `RoundVotingEngine.ts` handler.

**Impact:** Documented backfill fails on deploy; stale `humanVerifiedCommitCount` until reindex.

---

### M5 — USDC single-sided override (M9 carry-over)

**Severity:** Medium  
**Status:** Partial

Server `getX402UsdcAddressOverride()` accepts either env var alone; browser `getDefaultUsdcAddress()` reads only `NEXT_PUBLIC_USDC_ADDRESS`.

**Locations:** `packages/nextjs/lib/env/server.ts`; `packages/nextjs/lib/questionRewardPools.ts`; `docs/env-parity.md`.

---

### M6 — `sdk.md` misdocuments signing-intent prepare/complete auth

**Severity:** Medium (integrator footgun)  
**Status:** Open (regression in doc-alignment commit `a5660afa`)

Docs claim prepare/complete use `x-rateloop-signing-intent-token` header. Implementation: GET header-only; prepare/complete use JSON body `token` (matches SDK).

**Locations:** `packages/nextjs/public/docs/sdk.md` (~54); prepare/complete route handlers; `packages/sdk/src/agent.ts`.

---

### M7 — SDK read client example uses Next.js app URL, not Ponder

**Severity:** Medium  
**Status:** Open

`createRateLoopReadClient` calls Ponder paths (`/content`, `/rounds`). SDK README example uses `apiBaseUrl: "https://www.rateloop.ai"`.

**Locations:** `packages/sdk/README.md` (~40–43); `packages/sdk/src/read.ts`; `packages/nextjs/utils/env/ponderUrl.ts`.

---

### M8 — Chain ID examples disagree (480 vs 4801)

**Severity:** Medium  
**Status:** Open

Production `.env.production` defaults `NEXT_PUBLIC_TARGET_NETWORKS=4801`; public `ai.md` / `sdk.md` examples use `480`; MCP dry-run defaults to `480`.

**Locations:** `packages/nextjs/public/docs/ai.md`; `sdk.md`; `lib/mcp/tools.ts`; `packages/nextjs/.env.production`.

---

### M9 — ClusterPayoutOracle Proposed/Challenged blocked on live parent epoch

**Severity:** Medium (governance/liveness)  
**Status:** Partial (finalized path fixed in `dfeb19e1`)

Direct reproposal still reverts `SnapshotExists` for Proposed/Challenged snapshots when parent correlation epoch is live. Finalized unconsumed replacement works.

**Locations:** `ClusterPayoutOracle.sol` (~441–457); `ClusterPayoutOracle.t.sol`.

---

### M10 — Freshness single-request cap at 1000 votes (no pagination)

**Severity:** Medium at scale  
**Status:** Open

Freshness uses one fetch with `limit = min(revealedCount, 1000)`. Builder paginates to 50×1000.

**Locations:** `correlation-ponder-freshness.ts` (~29–40); `correlation-artifact-builder.ts`.

---

### M11 — Keeper discovery cap / reconciliation SLA (carry-over, improved)

**Severity:** Medium (High at >500 concurrent urgent items)  
**Status:** Partial

Ponder `/keeper/work` cap 500; rotating chain scan; reconciliation now merges Ponder hints (`eca1137d`).

**Locations:** `keeper.ts`; `keeper-routes.ts`; `keeper/README.md`.

---

### M12 — Migration 0012 / HRC backfill ops (carry-over)

**Severity:** Medium (ops)  
**Status:** Open until Neon deploy + backfill

Checklist added in `packages/nextjs/drizzle/README.md` and `nextjs/README.md`; backfill SQL wrong (M4).

---

## 3. Low

### L1 — Handoff PATCH body limit 1 MB vs create 16 MB

**Locations:** `handoffs/route.ts` vs `handoffs/[handoffId]/route.ts` PATCH.

---

### L2 — Legacy `{ error }` envelopes on attachment challenges and rate limits

**Locations:** `attachments/images/challenge/route.ts`; `attachments/details/challenge/route.ts`; `utils/rateLimit.ts`; MCP managed auth in `mcp/route.ts`.

---

### L3 — SDK test mock uses `?token=` signing URL

**Locations:** `packages/sdk/src/agent.test.ts` (~708, ~795).

---

### L4 — SDK `RateLoopRoundItem` over-types `/rounds` API (HRC fields)

**Locations:** `packages/sdk/src/read.ts`; Ponder `GET /rounds` in `content-routes.ts` (no HRC columns).

---

### L5 — Drizzle meta snapshot stale vs 12 migrations

**Locations:** `packages/nextjs/drizzle/meta/`; documented in `drizzle/README.md`.

---

### L6 — Default-profile bytecode oversize footgun

Three contracts oversize on `FOUNDRY_PROFILE=default`; deploy profile passes. Plain `forge build` artifacts must not be used for size gates.

---

### L7 — Duplicate dormancy event declarations (ABI noise)

**Locations:** `ContentRegistry.sol` (~290–292) declares events; `ContentRegistryDormancyLib.sol` emits them.

---

### L8 — Repoint / M6 test coverage gaps

No tests for repoint `InvalidState` paths; no test for Proposed snapshot + live parent `SnapshotExists`.

---

### L9 — Settlement side-effect failures still silent on-chain

Integration test added (`RoundIntegration.t.sol`); no governance retry path.

---

### L10 — Doc / CI hygiene

| Item | Location |
| --- | --- |
| `sdk.md` invalid `/uploads/` image URL | `public/docs/sdk.md` ~162 |
| Next.js README broken scripts table (0012 note) | `packages/nextjs/README.md` ~32 |
| Next.js README `RATELOOP_DEV_STACK_ALLOW_REMOTE_DB_PUSH` (nonexistent) | vs `scripts/dev-stack.mjs` `--allow-remote-db-push` |
| Root `yarn test:ts` omits `next:check-types` | `package.json` vs `lint.yaml` |
| Root `yarn lint` ≠ CI lint workflow | `.github/workflows/lint.yaml` |
| `env-parity.md` stale E2E cross-reference | ~line 47 |
| `env-parity.md` Sepolia profile label `testnet` vs artifact `default` | `deployments/4801.json` |
| `PONDER_CHAIN_ID` undocumented in Ponder README | supported in `start.mjs` |
| Keeper `.env.example` omits `KEEPER_WORK_DISCOVERY_*` | documented in keeper README only |

---

## 4. Fixed since 20 June audit

| ID (20 Jun) | Title | Fix evidence |
| --- | --- | --- |
| **H1** | Correlation defer on reveal/settle ticks | `e1d693a5` — defer removed; freshness gate always runs |
| **M1** (partial) | Aggregate-only freshness | `e0033ead` — vote-row gate added (endpoint bugs remain — H1/M1) |
| **M2** | Oracle repoint not on ContentRegistry | `bb61a23e` — wrapper + `ContentRegistryDormancyLib` + tests |
| **M4** | HTTP 128 KB vs MCP 16 MB | `9650edf3` — `AGENT_JSON_BODY_MAX_BYTES` |
| **M5/M11** (partial) | Keeper discovery / reconciliation | `eca1137d` — batched scan + Ponder hint merge |
| **M6** (partial) | Finalized reproposal with live parent | `dfeb19e1` + tests |
| **M9** (partial) | USDC single-sided override | `1398e2de` — server-side only |
| **M12** (partial) | HRC quorum types | `8dfa1fb0` — SDK + Next.js `openRound` |
| **L1** | Signing-intent token query leak | `b318875b` — GET header-only + test |
| **L2** (partial) | Error envelopes | `dcadaee9` — signed routes; attachment/rate-limit residual |
| **L7** | CLI chain `now` | `420377d9` |
| **L8** | Correlation routes wall clock helper | `550a0315` — shared `resolveApiNowSeconds` |
| **L10** | Foundry README size table | `bb61a23e` README update |
| **L11** | Gas budget regression | `65ff6065` — 952k limit |
| **L13** (partial) | Handler test gaps | `baddf90d` — three handler test files |
| **L9** (partial) | Settlement side-effect test | `b4f6fed1` — engine integration test |

---

## 5. Test coverage gaps

| Gap | Related | Risk |
| --- | --- | --- |
| No test: public-rating freshness with `rewardPoolId=0` / wrong endpoint | **H1** | High |
| No test: bundle-domain freshness endpoint | M1 | Medium |
| No test: correlation-excluded votes vs `revealedCount` parity | M2 | Medium |
| No integration: reveal tick → fresh → auto-build | M1/H1 | Medium |
| No test: server-only USDC env vs browser divergence | M5 | Medium |
| No test: handoff PATCH > 1 MB after 16 MB create | L1 | Low |
| SDK signing URL mock still uses `?token=` | L3 | Low |

---

## 6. AGENTS.md trust model vs implementation

| Claim | Status |
| --- | --- |
| Optimistic oracle roots; challengers recompute in challenge window | **Aligned** |
| Challenge bonds anti-spam (default 5 USDC) | **Aligned** |
| 60-minute `revealGracePeriod` accepted | **Aligned** |
| Engine rotation requires coordinated stack redeploy | **Aligned** — runbook includes repoint step |

No material trust-model contradictions found.

---

## 7. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **H1 + M1** — Route freshness vote fetch by domain; match builder endpoints | Small, high leverage |
| 2 | **M2** — Compare eligible vote count, not raw `revealedCount` | Small–medium |
| 3 | **M4** — Fix HRC backfill SQL + deploy checklist | Small (ops) |
| 4 | **M3 + M10** — Thread `ponderNowSeconds` into freshness; paginate or count endpoint | Small |
| 5 | **M5, M6, M7, M8** — USDC guard, sdk.md auth, SDK read URL, chain ID docs | Small |
| 6 | **L1–L10** — Error envelopes, handoff PATCH limit, CI/doc hygiene | Small |

---

## 8. Notes

- **June 20 audit doc** (`repo-audit-2026-06-20.md`) is stale for items marked Open that were fixed in `e1d693a5`..`a5660afa`; this document supersedes it for current HEAD.
- **Contracts not deployed to production mainnet**; EIP-170 deploy profile remains the authoritative size gate (`RoundVotingEngine` 14 B headroom).
- **Out of scope:** Thirdweb sign-in UI (`LandingPageActions.tsx`, `HumanSignInButton.tsx`).

# RateLoop Repo Audit — Bugs & Inconsistencies (22 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `36211e6c` (`Fix stake capacity tooltip clipping`), following the [21 June audit](repo-audit-2026-06-21.md) remediation batch (`95eb9aef`..`e4ca55d4`) and subsequent fixes through `36211e6c`.

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/SDK, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, targeted test runs).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **21 June remediation batch closed the dominant keeper regression** (H1 public-rating freshness hitting `/correlation/round-votes?rewardPoolId=0`). Freshness now routes by domain, paginates eligible votes, threads chain-time `now`, and has **7 unit tests** passing.

**New dominant risk:**

1. **`ContentRegistry` ABI drift** — exported `@rateloop/contracts` ABI is stale after `beeca748`: missing `repointPendingRatingClusterPayoutOracle`, still lists dormancy events removed from the contract surface; `PendingRatingClusterPayoutOracleRepointed` is absent everywhere (M-F1 / M-F2).

**Other notable open items:**

2. Ponder correlation vote scan budget can silently truncate artifacts at high eligible offsets (F2).
3. Signing-intent prepare/complete still use **128 KB** default while create uses **16 MB** (M-N1).
4. Attachment challenge routes return `apiErrorEnvelope` (`message`); `ImageAttachmentUploader` still reads `json.error` (M-N2).
5. Docs/test drift: React AI docs page and `ai/errors.md` still use mainnet `480` and legacy `/uploads/` URLs; Next.js README line 119 contradicts `.env.production` (`4801`).
6. Scale edge: exactly **50,000** eligible correlation votes fail pagination (F1).

No new High-severity fund-loss Solidity paths were found. Contracts are not on production mainnet yet.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | ABI drift on `ContentRegistry`; M9 partial; 1,747 tests green |
| 2 | Next.js / API / SDK | Signing-intent 128 KB gap; USDC env partial; chain/doc drift |
| 3 | Keeper + Ponder | H1 closed; scan-budget truncation; discovery cap semantics |
| 4 | Cross-package | Error envelope residual; `/rounds` omits HRC quorum fields |

Prior audits: [`repo-audit-2026-06-21.md`](repo-audit-2026-06-21.md), [`repo-audit-2026-06-20.md`](repo-audit-2026-06-20.md).

---

## Verification snapshot (HEAD `36211e6c`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — all contracts ≤ 24,576 B |
| Tightest contracts | `RoundVotingEngine` **24,562 B** (14 B headroom); `LaunchDistributionPool` 24,538 B; `ContentRegistry` 24,394 B |
| Default-profile size check (no deploy profile) | **Not re-run** — README warns default profile is not deploy-safe (`70eea35a`) |
| `packages/foundry` `forge test --summary` | **1,747 pass, 0 fail** |
| `packages/ponder` vitest | **324 pass, 1 skip** |
| `packages/keeper` vitest | **210 pass, 1 skip** |
| `correlation-ponder-freshness` unit tests | **7 pass** |
| June 21 H1 freshness endpoint fix | **Verified** — `correlationVotesPathForDomain()` in `correlation-ponder-freshness.ts` |
| June 21 remediation commits on `main` | **24 commits** from `8e6915b4` through `36211e6c` |

---

## 1. High

*None identified at HEAD.*

---

## 2. Medium

### M-F1 — `ContentRegistry` exported ABI drift (repoint missing, stale dormancy events)

**Severity:** Medium (integrator / indexer footgun)  
**Status:** Open (**new / regressed** by `beeca748`)  
**Prior:** June 21 did not track ABI sync; June 20 M2 fixed Solidity wrapper only

| Surface | `repointPendingRatingClusterPayoutOracle` | Dormancy events |
| --- | --- | --- |
| On-chain `ContentRegistry.sol` | Present | Emitted from `ContentRegistryDormancyLib` only |
| Forge artifact ABI | **Present** | **Absent** (removed from contract ABI) |
| `packages/contracts/ContentRegistryAbi.ts` | **Absent** | **Present** (stale) |
| Ponder handlers | N/A | Still registered on `ContentRegistry:ContentDormant` / `ContentRevived` |

**Impact:** Governance tooling using `@rateloop/contracts` cannot encode repoint. Ponder dormancy indexing works only because the **stale** exported ABI still lists dormancy events; running `generate-abis` without a strategy would drop dormancy events and break handlers in `packages/ponder/src/ContentRegistry.ts` (~420–432).

**Locations:** `packages/foundry/contracts/ContentRegistry.sol`; `packages/contracts/src/abis/ContentRegistryAbi.ts`; `packages/foundry/scripts-js/generateTsAbis.js`.

**Fix:** Regenerate ABIs with explicit policy (re-declare lib events on contract surface, merge lib events in generator, or point Ponder at lib ABIs); add CI parity gate.

---

### M-F2 — `PendingRatingClusterPayoutOracleRepointed` not in any exported ABI

**Severity:** Medium (observability)  
**Status:** Open

Event declared and emitted in `ContentRegistryRatingSnapshotLib.sol` but absent from forge `ContentRegistry.json`, `ContentRegistryAbi.ts`, and Ponder handlers.

**Impact:** Engine-migration repoint is not indexable via standard ABI exports.

---

### F2 — Ponder scan budget vs eligible vote offsets (silent truncation)

**Severity:** Medium–High at scale  
**Status:** Open  
**Prior:** Not in June 21 audit

**Issue:** Keeper paginates **eligible** votes with offsets 0, 1000, …, 49000 (50 pages). Ponder's per-request scan budget counts **raw DB rows** (`MAX_VOTE_SCAN_PAGES × VOTE_SCAN_PAGE_SIZE = 50,000`), while client `offset` counts post-filter eligible rows. Ban/correlation exclusions advance raw scan without incrementing eligible offset.

When scan budget exhausts before the requested eligible offset, Ponder returns a **partial page with no error** (`correlation-routes.ts`). The artifact builder treats `items.length < 1000` as the last page and **silently truncates** the artifact.

**Locations:** `packages/ponder/src/api/routes/correlation-routes.ts`; `packages/keeper/src/correlation-artifact-builder.ts` (~603–658).

**Fix:** Return explicit truncation flag or error when scan exhausts; align budget with eligible semantics; add high-offset + exclusion integration test.

---

### M-N1 — Signing-intent prepare/complete use 128 KB default (create uses 16 MB)

**Severity:** Medium  
**Status:** Open  
**Prior:** June 21 M4 fixed create/asks/handoffs; prepare/complete not updated

`parseJsonBody(request)` defaults to `DEFAULT_JSON_BODY_MAX_BYTES = 128 * 1024` in `jsonBody.ts`. Create route passes `AGENT_JSON_BODY_MAX_BYTES` (16 MB); prepare and complete do not.

**Locations:** `packages/nextjs/app/api/agent/signing-intents/[intentId]/prepare/route.ts`; `complete/route.ts`; `lib/http/jsonBody.ts`.

**Impact:** Large `paymentAuthorization` payloads can 413 on prepare after successful create.

---

### M-N2 — Attachment challenge UI reads legacy `error` field

**Severity:** Medium (UX / error surfacing)  
**Status:** Open (partial regression after `f84fa3c2`)  
**Prior:** June 21 L2 marked attachment routes as residual

Challenge routes return `apiErrorEnvelope` with top-level `message`. `ImageAttachmentUploader.readJson` (~63–68) only checks `json.error` on non-OK responses, falling back to generic `"Image upload failed."`

**Locations:** `packages/nextjs/components/submit/ImageAttachmentUploader.tsx`; `app/api/attachments/images/challenge/route.ts`.

---

### M-N3 — x402 USDC env parity still incomplete

**Severity:** Medium  
**Status:** Partial  
**Prior:** June 21 M5/M9; `634641f5` added browser alias

| Env var | Server x402 | Browser bounty validation |
| --- | --- | --- |
| `RATELOOP_X402_USDC_ADDRESS` | ✅ | ❌ |
| `NEXT_PUBLIC_USDC_ADDRESS` | ✅ | ✅ |
| `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS` | ❌ | ✅ |

Mismatch guard in `server.ts` only compares `NEXT_PUBLIC_USDC_ADDRESS` ↔ `RATELOOP_X402_USDC_ADDRESS`. `.env.example` documents the first two but not `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS`.

**Impact:** Server-only USDC override can diverge from browser signing UI.

---

### M-N4 — Chain ID and docs drift (480 vs 4801)

**Severity:** Medium  
**Status:** Partial  
**Prior:** June 21 M8; `922bb8f2` fixed `public/docs/ai.md`

| Location | Value | Expected for pre-prod |
| --- | --- | --- |
| `.env.production` | `4801` | ✅ |
| `public/docs/ai.md` | `4801` examples | ✅ |
| `app/(public)/docs/ai/page.tsx` | `chainId: 480`, `/uploads/` image URL | ❌ |
| `public/docs/ai/errors.md` | audit URL `chainId=480` | ❌ |
| `app/(public)/docs/ai/errors/page.tsx` | same | ❌ |
| `packages/nextjs/README.md:119` | claims mainnet default in `.env.production` | ❌ contradicts file |
| `app/api/agent/routes.test.ts` | many fixtures use `chainId=480` while env is `4801` | Stale |

**Impact:** Integrators copy mainnet examples; tests may miss Sepolia-only regressions.

---

### M-N5 — MCP managed origin rejection uses legacy envelope

**Severity:** Medium (integrator inconsistency)  
**Status:** Open  
**Prior:** June 21 L2 partial

Managed `/api/mcp` returns HTTP 403 `{ error: "Origin is not allowed…" }` (`route.ts:209`). Public `/api/mcp/public` uses JSON-RPC `{ error: { code, message } }` with HTTP 200. Other managed auth errors use `apiErrorEnvelope`.

No test coverage for origin rejection on either endpoint.

---

### F1 — Vote pagination 50×1000 off-by-one at boundary

**Severity:** Medium (scale edge)  
**Status:** Open

Both keeper and Ponder cap at pages 0–49 × 1000 rows. If page 49 returns a full 1000-item page, keeper throws; exactly **50,000** eligible votes fail instead of succeeding. Test in `correlation-artifact-builder.test.ts` (~845–886) expects this throw.

**Locations:** `correlation-artifact-builder.ts`; `correlation-ponder-freshness.ts`; `correlation-routes.ts`.

---

### F3 — Keeper work discovery cap 500 per category (not global)

**Severity:** Medium (liveness under load)  
**Status:** Open (partially mitigated by chain scan merge)

`/keeper/work?limit=500` applies `limit` separately to open rounds, cleanup, dormant content, and forfeit hints — up to ~2,000 items per response. Keeper README implies 500 total.

**Locations:** `packages/ponder/src/api/routes/keeper-routes.ts`; `packages/keeper/README.md` (~147–149).

---

### F4 — Keeper work token auth fails silently to chain fallback

**Severity:** Medium (ops)  
**Status:** Open

Ponder prod requires `PONDER_KEEPER_WORK_TOKEN` (503 if unset). Keeper sends Bearer token only when env is set; on auth failure logs warning and falls back to chain enumeration. No prod auth tests in `route-validation.test.ts`.

---

### M-F3 — M9: Proposed/Challenged snapshot blocked on live parent epoch (partial tests)

**Severity:** Medium (governance liveness)  
**Status:** Partial — by design, now documented  
**Prior:** June 21 M9

`ClusterPayoutOracle` blocks direct reproposal when parent correlation epoch is live and child is not `Finalized`. Test added for **Proposed** child (`a02fb11b`); **Challenged** child + live parent path untested.

---

### M-F4 — Settlement side-effect failures silent on-chain

**Severity:** Medium (rating pipeline consistency)  
**Status:** Partial — tested, no retry  
**Prior:** June 21 L9

`RoundSettlementSideEffectsLib` emits `SettlementSideEffectFailed` but settlement completes. Integration test exists; no governance/keeper retry path.

---

### M-X1 — `/rounds` API omits HRC quorum fields; SDK `RateLoopRoundItem` partial

**Severity:** Medium (API consistency)  
**Status:** Open (intentional split unclear)

Ponder `/content` open-round payloads include `humanVerifiedCommitQuorumMet` and `humanVerifiedCommitCount` (`shared.ts`). `/rounds` select (~1474–1510) omits these fields. SDK `RateLoopOpenRoundSummary` includes quorum fields; `RateLoopRoundItem` (used by `read.getRounds()`) has only sticky `hasHumanVerifiedCommit` after `389148fa`.

**Impact:** SDK consumers using `/rounds` cannot distinguish quorum-met vs any-commit sticky flag.

---

## 3. Low

### L-F1 — Duplicate rating event declarations on `ContentRegistry.sol`

Dormancy duplicates removed (`beeca748`); `RatingReviewPending` / `RatingSnapshotApplied` still duplicated between contract and lib.

### L-F2 — Repoint negative test coverage incomplete

Same-oracle revert covered (`91561450`); missing pending-settlement, applied snapshot, invalid oracle cases. Escrow repoint: happy path only.

### L-F3 — Default-profile oversize list vs June 21 audit table

README names `ContentRegistry`, `LaunchDistributionPool`, `QuestionRewardPoolEscrow`; June 21 verification named `RoundVotingEngine` instead of `ContentRegistry`. Deploy profile remains authoritative.

### L-F4 — `RoundVotingEngine` 14 B EIP-170 headroom

Unchanged; any in-contract addition risks deploy failure without library extraction.

### F5 — Duplicated domain → endpoint routing in keeper

`correlationVotesPathForDomain()` in freshness vs inline ternary in artifact builder.

### F6 — Fetch timeout mismatch (15s freshness vs 5s builder/keeper)

Freshness uses 15,000 ms; artifact builder, keeper work, and correlation snapshots use 5,000 ms.

### F7 — Dormancy indexing: lib events, stale ABI, missing handler

`DormantSubmissionKeyReleased` has no Ponder handler. No dormancy handler tests in `content-registry-handlers.test.ts`.

### L-N1 — SDK README read client host still ambiguous

Commit `a8c170af` changed `www.rateloop.ai` → `api.rateloop.ai`; hosted reads target Ponder `/content` and `/rounds`, not documented as `NEXT_PUBLIC_PONDER_URL` / `ponder.rateloop.ai`.

### L-N2 — SDK / route tests still default `chainId: 480`

Fixtures predate Sepolia-first posture; not a runtime bug.

### L-N3 — Managed MCP GET SSE 405 may use legacy `{ error }` shape

Minor inconsistency with `apiErrorEnvelope` migration on agent routes.

---

## 4. Fixed since 21 June audit

| ID (21 Jun) | Title | Fix evidence @ HEAD |
| --- | --- | --- |
| **H1** | Public-rating freshness invalid endpoint | `95eb9aef` — domain routing + pagination; **7 tests pass** |
| **M1** | Freshness endpoint semantics vs builder | **Closed** with H1 |
| **M2** | Eligible vs `revealedCount` parity | **Intentionally changed** — defers on incomplete pagination, not raw count mismatch |
| **M3** | Wall clock vs chain time in freshness | `95eb9aef` + `ponderNowSeconds` threading |
| **M4** | HRC backfill SQL | `d7e52f65` |
| **M6** | sdk.md signing-intent auth | `1323bdec` |
| **M8** (partial) | `public/docs/ai.md` chain ID | `922bb8f2` — React pages still drift (M-N4) |
| **M10** | Freshness pagination / truncation | `95eb9aef` |
| **M11** | Handoff PATCH 1 MB limit | `19c3b26d` — 16 MB aligned |
| **M12** (partial) | HRC quorum on openRound | Next.js + `RateLoopOpenRoundSummary`; dropped from `RateLoopRoundItem` (`389148fa`) |
| **L1** | Signing-intent GET query token | Prior batch; still closed |
| **L2** (partial) | Error envelopes on routes | `f84fa3c2` — client uploader residual (M-N2) |
| **L6** | MCP dry-run default chain | `3f849dc4` — `4801` |
| **L8** | Foundry README deploy warning | `70eea35a` |
| **L10** | CI `next:check-types` | `e4ca55d4` |
| **M7** (partial) | SDK read URL | `a8c170af` — still not Ponder-specific (L-N1) |
| **M5** (partial) | Browser USDC alias | `634641f5` — server-only gap remains (M-N3) |
| **M9** (partial) | Proposed reproposal test | `a02fb11b` |
| **L8** (foundry) | Repoint InvalidState same-oracle | `91561450` |

---

## 5. Test coverage gaps

| Gap | Related | Risk |
| --- | --- | --- |
| ABI parity CI for `repointPending` + dormancy events | M-F1 | Medium |
| High eligible offset + exclusions exhausts scan budget | F2 | Medium–High |
| Exact 50,000 eligible votes should succeed | F1 | Medium |
| Attachment uploader reads `message` from challenge 400 | M-N2 | Medium |
| Signing-intent prepare/complete 413 at >128 KB | M-N1 | Medium |
| `/keeper/work` prod auth 401/503 | F4 | Medium |
| MCP origin rejection both endpoints | M-N5 | Low–Medium |
| `ContentDormant` / `ContentRevived` handler indexing | F7 | Low–Medium |
| Challenged child reproposal + live parent | M-F3 | Low |
| Server-only vs browser USDC divergence | M-N3 | Medium |

---

## 6. AGENTS.md trust model vs implementation

| Claim | Status |
| --- | --- |
| Optimistic oracle roots; challengers recompute in challenge window | **Aligned** |
| Challenge bonds anti-spam (default 5 USDC) | **Aligned** |
| 60-minute `revealGracePeriod` accepted | **Aligned** |
| Engine rotation requires coordinated stack redeploy | **Aligned** — repoint on `ContentRegistry` exists in Solidity; ABI export lag (M-F1) |

No material trust-model contradictions found.

---

## 7. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **M-F1 + F7** — Regenerate/sync `ContentRegistry` ABI; dormancy handler strategy | Small–medium, high leverage |
| 2 | **F2** — Scan budget vs eligible offset; explicit truncation | Medium |
| 3 | **M-N1 + M-N2** — Align signing-intent limits; fix uploader error read | Small |
| 4 | **M-N4** — Normalize docs/tests to `4801` or label mainnet explicitly | Small |
| 5 | **M-N3, M-N5** — USDC env guard + MCP origin envelope | Small |
| 6 | **F1, F3, F4** — Pagination boundary, discovery cap docs, keeper token hard-fail | Small–medium |
| 7 | **M-X1** — `/rounds` HRC quorum fields or document intentional omission | Small |

---

## 8. Notes

- **June 21 audit doc** is stale for H1/M1/M3/M10 and most remediation items; this document supersedes it for HEAD `36211e6c`.
- **Contracts not deployed to production mainnet**; EIP-170 deploy profile remains the authoritative size gate (`RoundVotingEngine` 14 B headroom).
- **Out of scope:** Thirdweb sign-in UI (`LandingPageActions.tsx`, `HumanSignInButton.tsx`); tooltip clipping fix in `36211e6c` (cosmetic, not audited).

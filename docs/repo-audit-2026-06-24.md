# RateLoop Repo Audit — Bugs & Inconsistencies (24 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `1e5f7389` (`ci: run generateTsAbis parity tests in contract-size job`), following the [23 June audit](repo-audit-2026-06-23.md) remediation batch (`17edfaed`..`1e5f7389`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/SDK, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, targeted test runs).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **23 June remediation batch closed all 11 targeted audit items** (dormancy SQL parity, keeper discovery errors, settlement runbook, public MCP envelopes, SDK docs page, content HRC quorum, handler tests, correlation truncation, ABI CI, dead error cleanup, `AuditGapTests` wiring).

**New dominant risks (none High):**

1. **`/correlation/bundle-round-votes` loads all bundle votes unbounded** — no pagination or `truncated` flag; keeper correlation freshness cannot defer on bundle domains (M-P1).
2. **Agent handoff 16 MB JSON cap vs docs allowing four 10 MB images** — multi-image `generatedImages` handoffs can fail at ingress before validation (M-N1).
3. **Browser USDC resolution bypasses server triple-env guard** — conflicting public USDC vars can break server x402 while the browser silently picks the first override (M-N2).

**Other notable open items:**

4. Settlement side effects still complete on failure by design — runbook exists; verify prod monitoring (M-F4).
5. `LaunchDistributionPool` has **38 B** EIP-170 headroom on deploy profile (ongoing deploy constraint).
6. Docs drift: `public/docs/sdk.md` still points reads at `www.rateloop.ai`; `env-parity.md` omits Ponder URL env mapping.
7. `GET /content/:id` rounds have HRC quorum field but still differ from `/rounds` projection shape.

No new High-severity fund-loss Solidity paths were found. Contracts are not deployed to production mainnet yet.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | June 23 fixes verified; 1,750 tests green; tight EIP-170 headroom |
| 2 | Next.js / API / SDK | Handoff body limit vs multi-image docs; browser USDC guard gap |
| 3 | Keeper + Ponder | Bundle correlation unbounded load; content-detail round shape drift |
| 4 | Cross-package | June 23 items closed; env-parity + static SDK doc residuals |

Prior audits: [`repo-audit-2026-06-23.md`](repo-audit-2026-06-23.md), [`repo-audit-2026-06-22.md`](repo-audit-2026-06-22.md).

---

## Verification snapshot (HEAD `1e5f7389`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — all contracts ≤ 24,576 B |
| Tightest contracts | `LaunchDistributionPool` **24,538 B** (38 B headroom); `ContentRegistry` **24,387 B** (189 B); `RoundVotingEngine` **23,911 B** (665 B) |
| `packages/foundry` `forge test` | **1,750 pass, 0 fail** (per prior HEAD run; not re-run in full for this audit) |
| `packages/ponder` vitest | **334 pass, 1 skip** |
| `packages/keeper` vitest | **211 pass, 1 skip** |
| `packages/node-utils` tests | **38 pass** |
| `yarn foundry:generate-ts-abis:test` | Wired in CI (`unit-tests.yaml:41–42`) |
| June 23 remediation commits on `main` | **11 commits** from `17edfaed` through `1e5f7389` |

---

## 1. High

*None identified at HEAD.*

---

## 2. Medium

### M-P1 — `/correlation/bundle-round-votes` loads all votes unbounded; no `truncated`

**Severity:** Medium (OOM/latency on large bundles; keeper cannot defer bundle indexing)  
**Status:** Open (**new**)  
**Paths:** `packages/ponder/src/api/routes/correlation-routes.ts` (~797–949), `packages/keeper/src/correlation-ponder-freshness.ts:140–141`, `packages/keeper/src/correlation-artifact-builder.ts`

`/correlation/round-votes` and `/correlation/rating-round-votes` paginate with scan budget, post-budget probe, and `truncated`. `bundle-round-votes` runs one unbounded `db.select()` over all bundle rounds, materializes `firstVotes` in memory, then slices for `offset`/`limit`. Response omits `truncated`.

Keeper checks `response.truncated` for all domains via `correlationVotesPathForDomain()` — bundle responses never set it, so truncation/deferral logic never fires for bundle correlation artifacts.

**Impact:** Large bundle epochs can stress Ponder memory. Keeper may hit page caps and error, or operate on a fully materialized in-memory set with no early truncation signal.

---

### M-N1 — Handoff 16 MB JSON body limit vs four 10 MB `generatedImages`

**Severity:** Medium (multi-image handoffs fail at ingress despite docs)  
**Status:** Open (**new**)  
**Paths:** `packages/nextjs/lib/agent/http.ts` (`AGENT_JSON_BODY_MAX_BYTES = 16 * 1024 * 1024`), `packages/nextjs/lib/agent/handoffs.ts`, `packages/nextjs/lib/auth/imageUploadChallenge.shared.ts` (`MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024`), docs (`public/docs/sdk.md`, `public/llms.txt`, MCP tool descriptions)

Per-image validation allows up to 10 MB raw bytes and up to four images. Agent/handoff/MCP routes parse JSON bodies with a **16 MB total** cap (`parseJsonBody`). Base64 inflates ~4/3×, so one 10 MB image ≈ 13.3 MB encoded — near the ceiling. Two max-size images cannot fit in one request.

**Impact:** Agents following docs for multi-mockup handoffs hit `413 Request body is too large` before `generatedImages` validation runs.

---

### M-N2 — Browser `getDefaultUsdcAddress()` bypasses triple-env USDC guard

**Severity:** Medium (misconfigured env → wrong on-chain USDC in UI)  
**Status:** Open (**new**)  
**Paths:** `packages/nextjs/lib/questionRewardPools.ts:117–123`, `packages/nextjs/lib/env/server.ts:222–245`

Server `getX402UsdcAddressOverride()` throws when `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS`, and `RATELOOP_X402_USDC_ADDRESS` disagree. Browser `getDefaultUsdcAddress()` prefers `NEXT_PUBLIC_USDC_ADDRESS` then `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS` **without** cross-check.

**Impact:** Conflicting public USDC vars can fail server x402 paths while the browser silently uses the first override for approvals/display.

---

### M-F4 — Settlement side-effect failures do not block settlement

**Severity:** Medium (rating/index desync until manual repair)  
**Status:** Open (intentional; runbook added `00ddaad3`)  
**Paths:** `packages/foundry/contracts/libraries/RoundSettlementSideEffectsLib.sol`, `packages/foundry/README.md:50`, `packages/keeper/README.md:137–143`

`recordSettlement` wraps rating updates in try/catch. Failure emits `SettlementSideEffectFailed` but settlement still completes. No on-chain retry queue.

**Impact:** Operators must monitor the event and manually call `recordPendingRatingSettlement` (or repoint tooling). Verify prod alerting is wired.

---

### M-OPS1 — EIP-170 headroom critically tight on `LaunchDistributionPool`

**Severity:** Medium (deployment blocker on next bytecode growth)  
**Status:** Open (ongoing)  
**Paths:** `packages/foundry/contracts/LaunchDistributionPool.sol`, `packages/foundry/README.md:36–44`

Deploy profile: `LaunchDistributionPool` **24,538 B** (38 B headroom). `foundry/README.md` size table is stale for `RoundVotingEngine` (lists 24,562 B / 14 B; actual **23,911 B** / 665 B).

**Impact:** Any non-trivial feature on size-tight contracts risks EIP-170 failure without library extraction.

---

### M-P2 — `humanVerifiedCommitCount` backfill still an ops prerequisite

**Severity:** Medium (ops — wrong dormancy / reveal_failed hints if stale)  
**Status:** Open  
**Paths:** `packages/ponder/README.md` (HRC backfill section), `packages/ponder/src/api/routes/keeper-routes.ts`

Pre-backfill rows default `humanVerifiedCommitCount = 0`. `/keeper/work` dormancy blocking and `reveal_failed` hints depend on that column. Handlers index new events correctly; legacy DB rows without backfill/reindex can misclassify candidates.

**Impact:** Keeper may miss dormancy/reveal-failed work from Ponder until post-RC backfill or full reindex.

---

## 3. Low

### L-P1 — `GET /content/:id` rounds still diverge from `GET /rounds` shape

**Severity:** Low (API inconsistency; HRC quorum field fixed in `221e7b60`)  
**Status:** Open (partial)  
**Paths:** `packages/ponder/src/api/routes/content-routes.ts` (1410–1436 vs 1480–1547)

Detail `rounds[]` uses `select *` + `humanVerifiedCommitQuorumMet`. `/rounds` uses curated projection, `formatConfidentialContentPreview`, joined content fields, `scoreSpreadEconomics`, `estimatedSettlementTime`, etc.

---

### L-P2 — Dormancy discovery uses `lastActivityAt`; chain uses `dormancyAnchorAt`

**Severity:** Low (documented approximation)  
**Status:** Open  
**Paths:** `packages/ponder/src/api/routes/keeper-routes.ts:135`, `packages/keeper/src/keeper.ts` (~1454–1485), `ContentRegistryDormancyLib.sol`

Vote commits bump indexed `lastActivityAt` but not `dormancyAnchorAt`. Ponder SQL and keeper pre-check use `lastActivityAt + dormancyPeriod`; contract gates on `dormancyAnchorAt`. Keeper README acknowledges benign extra `markDormant` attempts.

---

### L-K1 — `PONDER_FETCH_TIMEOUT_MS` duplicated in `keeper.ts`

**Severity:** Low (config drift risk)  
**Status:** Open  
**Paths:** `packages/keeper/src/keeper.ts:128` (hardcoded `15_000`), `packages/keeper/src/correlation-artifact-builder.ts` (imports `PONDER_HTTP_FETCH_TIMEOUT_MS` from `@rateloop/node-utils`)

Same value today; `/keeper/work` fetch does not share the node-utils constant.

---

### L-P3 — `/submission-stakes` is a stub; `/voting-stakes` is real

**Severity:** Low (integrator drift)  
**Status:** Open  
**Paths:** `packages/ponder/src/api/routes/content-routes.ts:1599–1611`, `packages/nextjs/services/ponder/client.ts`

`/submission-stakes` always returns `{ activeCount: 0, submitter }`. Next.js still calls it; `/voting-stakes` queries the DB.

---

### L-K2 — `/keeper/work` `reason` hints unused by keeper logic

**Severity:** Low (telemetry-only)  
**Status:** Open  
**Paths:** `packages/ponder/src/api/routes/keeper-routes.ts`, `packages/keeper/src/keeper.ts:542–554`

Ponder returns `settle`/`reveal`/`dormant` reasons; keeper uses candidates only for `contentId` union + gauge metrics. Processing re-derives from chain.

---

### L-N3 — `public/docs/sdk.md` stale vs fixed React SDK page

**Severity:** Low  
**Status:** Open  
**Paths:** `packages/nextjs/public/docs/sdk.md:193` (`apiBaseUrl: "https://www.rateloop.ai"`), `app/(public)/docs/sdk/page.tsx` (Ponder + MCP split fixed in `34867811`)

---

### L-N4 — MCP transport error envelope residual (post-partial-fix)

**Severity:** Low  
**Status:** Partially closed (`c5711743`)  
**Paths:** `packages/nextjs/app/api/mcp/route.ts`, `packages/nextjs/app/api/mcp/public/route.ts`

Origin rejection and GET 405 aligned. Residual: rate-limit responses use flat `apiErrorEnvelope` mid-JSON-RPC POST; public `tools/call` errors nest `normalizeToolError` in JSON-RPC `result` (protocol-required). Public OPTIONS returns 403 on disallowed origin vs managed 204.

---

### L-N5 — SDK README `apiBaseUrl` guidance conflates read vs agent MCP hosts

**Severity:** Low  
**Status:** Open  
**Paths:** `packages/sdk/README.md`, `packages/sdk/src/agent.ts:1633–1637`

When `mcpApiUrl` is unset, agent client derives MCP from `apiBaseUrl` → `{apiBaseUrl}/api/mcp/public`. README says reads should use Ponder, not Next.js — integrators using one `apiBaseUrl` for both clients misroute MCP.

---

### L-N6 — SDK README mainnet profile label stale

**Severity:** Low  
**Status:** Resolved
**Paths:** `packages/sdk/README.md:23`, `packages/foundry/deployments/480.json`

Mainnet profile references now consistently point at the production deployment profile.

---

### L-N7 — `docs/env-parity.md` USDC guard description incomplete

**Severity:** Low  
**Status:** Open  
**Paths:** `docs/env-parity.md:30`, `packages/nextjs/lib/env/server.ts:232–238`

Doc implies two-way guard; code validates **three** vars including `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS`.

---

### L-N8 — No unit tests for USDC triple-env guard

**Severity:** Low  
**Status:** Open  
**Paths:** `packages/nextjs/lib/env/server.ts`, `packages/nextjs/lib/env/server.test.ts`

`getX402UsdcAddressOverride` mismatch throw has no test coverage.

---

### L-T1 — Correlation budget probe lacks route-level integration test

**Severity:** Low  
**Status:** Open  
**Paths:** `packages/ponder/src/api/routes/correlation-routes.ts:683–688`, `packages/ponder/tests/correlation-vote-scan.test.ts`

Unit tests cover `isCorrelationVoteScanTruncated` helper only, not the post-budget probe path.

---

### L-T2 — `AuditGapTests` duplicates `VotingTestBase` fixture wiring

**Severity:** Low (maintainability)  
**Status:** Open  
**Paths:** `packages/foundry/test/AuditGapTests.t.sol:47–134`

Inherits `VotingTestBase` but reimplements full proxy deployment in local `setUp()`. Tests pass (16/16); future base wiring changes may not propagate.

---

## 4. Info

### I-D1 — `env-parity.md` omits Ponder URL env mapping

Next.js uses `NEXT_PUBLIC_PONDER_URL`; keeper uses `PONDER_BASE_URL`; Ponder uses `PONDER_RPC_URL_480` / `PONDER_RPC_URL_4801`. E2E sets both consistently (`.github/workflows/e2e.yaml`).

### I-D2 — Agents package Sepolia-default vs production mainnet `480`

`packages/agents/.env.example` and `examples/questions/*.json` use `4801`; `.env.production` uses `NEXT_PUBLIC_TARGET_NETWORKS=480`.

### I-D3 — `yarn test` runs Foundry only

Root `package.json:61` — `yarn test` → `yarn foundry:test`. TS/ABI checks require `yarn test:ts` or CI.

### I-D4 — Foundry README contract-size table stale

Lists `RoundVotingEngine` at 24,562 B / 14 B headroom; deploy profile is **23,911 B** / 665 B.

### I-D5 — `humanVerifiedCommitQuorumMet` uses `max(minVoters, 3)` while dormancy uses raw `minVoters`

Consistent across API routes (`shared.ts:27–31`). Harmless while protocol enforces `minVoters >= 3`.

### I-D6 — SDK tests use `api.rateloop.ai`; docs use `ponder.rateloop.ai`

`packages/sdk/src/read.test.ts` fixtures — clarify whether `api.rateloop.ai` is a supported read alias.

---

## 5. Fixed since 23 June audit

| ID (23 Jun) | Title | Fix evidence @ HEAD |
| --- | --- | --- |
| **M1** | Ponder dormancy SQL stricter than `isDormancyBlocked` | `17edfaed` |
| **M2** | Keeper discovery mislabeled as chain failure | `a200da86` |
| **M-F4 (partial)** | Settlement side-effect runbook | `00ddaad3` |
| **L-N4 (partial)** | Public MCP error envelope | `c5711743` |
| **L-D1 (partial)** | SDK docs page host/chain drift | `34867811` |
| **L-P1 (partial)** | `GET /content/:id` HRC quorum | `221e7b60` |
| **L-P2** | Dormancy/repoint handler tests | `b10e0cc8` |
| **L-K1** | Correlation truncation false negative | `aee39679` |
| **L-F5** | `generateTsAbis.test.js` not in CI | `1e5f7389` |
| **L-F6** | Dead `RbtsSeedUnavailable` | `6eaed01f` |
| **L-F7** | `AuditGapTests` setUp drift | `9d19a2a4` |

---

## 6. Test coverage gaps

| Gap | Related | Risk |
| --- | --- | --- |
| Bundle-round-votes pagination/truncation | M-P1 | Medium |
| Handoff multi-image at 16 MB JSON boundary | M-N1 | Medium |
| Browser USDC mismatch vs server guard | M-N2 | Medium |
| USDC triple-env guard unit tests | L-N8 | Low |
| Correlation route probe integration | L-T1 | Low |
| Public MCP origin rejection JSON-RPC shape | L-N4 | Low |
| `GET /content/:id` round projection parity | L-P1 | Low |
| Settlement side-effect operator alerting | M-F4 | Medium (ops) |

---

## 7. AGENTS.md trust model vs implementation

| Claim | Status |
| --- | --- |
| Optimistic oracle roots; challengers recompute in challenge window | **Aligned** |
| Challenge bonds anti-spam (default 5 USDC) | **Aligned** |
| 60-minute `revealGracePeriod` accepted | **Aligned** |
| Settlement side effects may fail without blocking settlement | **Aligned** — runbook at `packages/keeper/README.md:137–143` |
| Contracts not on production mainnet yet | **Aligned** — `.env.production` targets `480` for frontend; on-chain deploy pending |

No material trust-model contradictions found.

---

## 8. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **M-P1** — Paginate or cap `bundle-round-votes`; add `truncated` parity | Medium |
| 2 | **M-N1** — Align handoff JSON limit with multi-image docs (raise cap or document 1–2 image practical limit) | Small–medium |
| 3 | **M-N2** — Browser USDC guard parity with server triple-check | Small |
| 4 | **M-F4** — Verify prod monitoring on `SettlementSideEffectFailed` | Small |
| 5 | **M-P2** — Confirm post-RC Ponder HRC backfill on Railway | Ops |
| 6 | **L-N3, L-N5, L-N6, L-N7** — Docs/env-parity cleanup | Small |
| 7 | **L-P1, L-P3, L-K1, L-T1, L-N8** — API shape, stub route, constants, tests | Small |

---

## 9. Notes

- **23 June audit doc** open-item table is stale for HEAD `1e5f7389`; this document supersedes it.
- **Production network:** `.env.production` targets mainnet `480`; SDK/agents examples remain Sepolia-first (`4801`) — intentional split.
- **Contract headroom:** `RoundVotingEngine` has **665 B** deploy-profile headroom; `LaunchDistributionPool` remains the tightest at **38 B**.
- **Out of scope:** Thirdweb sign-in UI; cosmetic formatting.

# RateLoop Repo Audit — Bugs & Inconsistencies (20 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `7527d1fc` (`Update World Chain Sepolia deployment pointers`), following the [19 June audit](repo-audit-2026-06-19.md) remediation batch (`a4aedd40`..`b5001ca2`) and subsequent World ID v3 / Sepolia deployment work (`b5001ca2`..`7527d1fc`).

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/API, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, test runs).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **June 19 remediation batch closed most prior High/Medium items**: round-targeted Ponder freshness (`roundId` + `limit=1`), signing-intent plan persistence, vote-count parity in correlation freshness, normalized JSON error envelopes, HRC handler tests, settlement side-effect unit test, and Ponder `?now=` on data/leaderboard routes.

**New dominant risk** (keeper):

1. **Correlation auto-build is skipped on every tick that reveals or settles** — `deferPonderArtifactBuild` returns before the Ponder freshness gate, so busy chains may never auto-build correlation artifacts (H1-new).

**Carry-over operational risks** (unchanged in substance):

2. **Public-rating oracle repoint** exists in a library but is **not callable** on `ContentRegistry` (EIP-170 headroom; delegate contract required).
3. **Ponder `humanVerifiedCommitCount`** still needs reindex/backfill on existing DBs after schema deploy.
4. **SDK/Next.js types** omit `humanVerifiedCommitQuorumMet`; sticky `hasHumanVerifiedCommit` boolean still exposed.

No new High-severity fund-loss Solidity paths were found. Contracts are not on production mainnet yet. World ID v3 attestation/router work landed since the last audit batch without introducing new fund-loss paths in reviewed code.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | June M2/M6/L10 partial; gas budget regression; deploy-profile sizes pass with tight headroom |
| 2 | Next.js / API | June M4/L1–L4 fixed; HTTP vs MCP body limit mismatch; signing-intent token query leak |
| 3 | Keeper + Ponder | June H1 fixed; **new reveal-tick defer blocks auto-build**; discovery caps; HRC backfill ops |
| 4 | Cross-package | env-parity gaps; SDK HRC field drift; canary CI offline-only; USDC single-sided override |

Prior audits: [`repo-audit-2026-06-19.md`](repo-audit-2026-06-19.md), [`repo-audit-2026-06-18.md`](repo-audit-2026-06-18.md).

---

## Verification snapshot (HEAD `7527d1fc`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — all contracts ≤ 24,576 B; tightest: `RoundVotingEngine` 24,562 B (14 B); `ContentRegistry` 24,510 B (66 B); `LaunchDistributionPool` 24,538 B (38 B) |
| Default-profile `forge build` + size check | **4 oversized** — deploy profile is authoritative for CI; default profile artifacts must not be used for size gates |
| `packages/foundry` `forge test --summary` | **1,740 pass, 1 fail** — `GasBudgetTest.testGas_submitContent_underBudget` (951,204 > 951,000 gas) |
| `packages/ponder` vitest | **321 pass, 1 skip** |
| `packages/keeper` freshness unit tests | **2 pass** (`correlation-ponder-freshness.test.ts`) |
| `packages/nextjs` agent routes tests | **44 pass** |
| Deployed chains in `deployedContracts.ts` | `480`, `4801`, `31337` |
| Partial epoch publish | Skipped when `sawNextEpoch` + oversized epoch |
| Correlation Ponder freshness | `roundId` + `limit=1`; `revealedCount`, `voteCount`, settled-state gates |
| Signing-intent prepare persistence | `transaction_plan` / `x402_authorization_request` columns + idempotent prepare |
| Railway Ponder schema | `railway_<deployment_id>` when `RAILWAY_DEPLOYMENT_ID` set; deprecated static canary schema ignored |

---

## 1. High

### H1 — Correlation auto-build deferred on every reveal/settle tick

**Severity:** High on busy deployments; Medium for typical load  
**Status:** Open (**new**)  
**Prior:** Residual M1 defer logic, not covered in June 19 audit

Every keeper tick that reveals ≥1 vote or settles ≥1 round sets `deferPonderArtifactBuild: true`. `publishAutomaticCorrelationSnapshots` returns **before** `areCorrelationCandidatesPonderFresh`, so automatic artifact build never runs on active chains until a tick with zero reveals and zero settlements.

**Locations:** `packages/keeper/src/index.ts` (~202–212); `packages/keeper/src/correlation-snapshots.ts` (~829–834).

**Impact:** Correlation artifacts and payout-oracle proposals stall indefinitely on chains with continuous reveal activity (~30s ticks). Manual CLI build (`build-correlation-artifact.ts`) still works.

**Evidence:**

```typescript
const ponderStaleRisk = result.roundsSettled > 0 || result.votesRevealed > 0;
// ...
{ deferPonderArtifactBuild: ponderStaleRisk, ponderNowSeconds: runContext.blockTimestamp }
```

Freshness gate at line 836 is never reached when defer is true. No test covers continuous-reveal defer.

**Fix:** Remove blanket defer and rely on `areCorrelationCandidatesPonderFresh` (now round-targeted with vote-count parity), or replace with a one-tick latch keyed per candidate round. Add integration test: reveal → defer → fresh → build.

---

## 2. Medium

### M1 — Correlation freshness is aggregate-only (M1 carry-over, improved)

**Severity:** Medium  
**Status:** Open (improved)

Freshness now checks Ponder `revealedCount`, `voteCount`, and settled `state` via targeted `/rounds?roundId=&limit=1`. Still no vote-row parity, RBTS weight readiness, or indexed-block ≥ settlement block check.

**Locations:** `packages/keeper/src/correlation-ponder-freshness.ts`; `packages/keeper/src/correlation-snapshots.ts`.

**Fix:** Extend gate with vote fetch stability or min indexed block; multi-tick integration test. **Blocked in practice by H1** until defer logic is fixed.

---

### M2 — Public-rating oracle repoint not exposed on `ContentRegistry`

**Severity:** Medium (governance/ops)  
**Status:** Open

`repointPendingRatingClusterPayoutOracle` exists in `ContentRegistryRatingSnapshotLib` but has **no external wrapper** on `ContentRegistry`. Foundry README now documents the gap and suggests a governance helper (June 19 doc drift partially fixed).

**Locations:** `ContentRegistryRatingSnapshotLib.sol` (~92–119); `ContentRegistry.sol`; `packages/foundry/README.md` (~153–158).

**Fix:** Thin `CONFIG_ROLE` delegate contract (EIP-170 blocks in-contract addition — 66 B headroom on deploy profile).

---

### M3 — Ponder `humanVerifiedCommitCount` needs backfill on existing DBs

**Severity:** Medium (ops); Low for safety  
**Status:** Open

New column defaults to `0`. Pre-existing rows with `hasHumanVerifiedCommit=true` keep `humanVerifiedCommitCount=0` until reindex or documented SQL backfill. Handler test now covers forward accumulation.

**Locations:** `ponder.schema.ts`; `RoundVotingEngine.ts`; `keeper-routes.ts` SQL; `packages/ponder/README.md` (~133–149).

**Fix:** Run documented backfill on deploy; add Railway runbook checklist.

---

### M4 — Direct HTTP agent routes 128 KB vs MCP/handoffs 16 MB

**Severity:** Medium  
**Status:** Open (**new**)

`jsonBodyErrorResponse` default is 128 KB. MCP public/managed routes and handoffs use 16 MB. Direct HTTP `POST /api/agent/asks`, `/quote`, `/signing-intents` reject payloads MCP accepts.

**Locations:** `packages/nextjs/lib/http/jsonBody.ts`; `app/api/agent/asks/route.ts`; `app/api/mcp/public/route.ts`; `app/api/agent/handoffs/route.ts`.

**Fix:** Align limits on agent write routes that mirror MCP tools, or document “use MCP/handoffs for large payloads”.

---

### M5 — Keeper discovery liveness still bounded at scale

**Severity:** Medium (High at >500 concurrent urgent items)  
**Status:** Partial

Ponder `/keeper/work` cap 500 + rotating chain scan (~10 IDs/tick) + 120-tick reconciliation. Feedback bonus forfeits come from Ponder only (not chain scan). Reconciliation ticks skip Ponder hints entirely.

**Locations:** `packages/keeper/src/keeper.ts`; `packages/ponder/src/api/routes/keeper-routes.ts`; `packages/keeper/README.md`.

**Fix:** Urgency-weighted ordering; forfeits on reconciliation ticks; document SLA.

---

### M6 — ClusterPayoutOracle reproposal when parent epoch live

**Severity:** Medium (governance/liveness)  
**Status:** Partial

Post-veto **rejection** works when consumer view reverts (`!consumedKnown`). **Direct reproposal** still reverts `SnapshotExists` when parent correlation epoch is live, even if consumption unknown.

**Locations:** `ClusterPayoutOracle.sol` (~441–451, ~656–696); test `test_FinalizedRoundPayoutSnapshotReproposalAllowedWhenConsumerViewReverts` requires parent epoch rejection first.

**Fix:** Document arbiter SLA; optional stale-finalized replacement when `!consumedKnown`; regression test for direct reproposal path.

---

### M7 — Engine rotation footguns

**Severity:** Medium (governance/ops)  
**Status:** Documented; code unchanged

Only `ContentRegistry` + `FrontendRegistry` expose `setVotingEngine`. Escrows pin engine at init.

**Fix:** Coordinated replacement-stack redeploy mandatory pre-mainnet (runbook exists).

---

### M8 — x402 submit-time economics not mirrored offline

**Severity:** Medium  
**Status:** Partial (documented)

`agents:lint` covers structure and gated `detailsUrl`; submit-only gates remain in `questionSubmission.ts`. Documented in `packages/agents/README.md`.

---

### M9 — USDC env split: single-sided override uncaught

**Severity:** Medium  
**Status:** Partial

Mismatch throw only when **both** `NEXT_PUBLIC_USDC_ADDRESS` and `RATELOOP_X402_USDC_ADDRESS` are set and differ. Setting only one side can diverge browser bounty reads from server x402 paths.

**Locations:** `packages/nextjs/lib/env/server.ts`; `packages/nextjs/lib/questionRewardPools.ts`; `docs/env-parity.md`.

**Fix:** Extend guard when either override is set; unify resolution helper.

---

### M10 — Migration 0012 required for signing-intent prepare in production

**Severity:** Medium (ops)  
**Status:** Open until Neon migration applied

Code writes `transaction_plan` / `x402_authorization_request`; migration `0012_agent_signing_intent_prepared_artifacts.sql` must be applied on app DB.

**Locations:** `packages/nextjs/drizzle/0012_*.sql`; `lib/agent/signingIntents.ts`.

**Fix:** Apply Drizzle migration on deploy; add deploy checklist (mirror handoff draft migration messaging).

---

### M11 — Full reconciliation is O(all content IDs) per tick

**Severity:** Medium at scale  
**Status:** Open (**new**)

Every 120th tick enumerates all `contentId`s from 1 to `nextContentId` with no chunking — risk of tick overrun and memory spikes as content grows.

**Locations:** `packages/keeper/src/keeper.ts` (`discoverKeeperWorkFromChain`, ~534–537).

**Fix:** Chunk reconciliation across ticks with cursor + budget.

---

### M12 — SDK / Next.js types omit `humanVerifiedCommitQuorumMet`

**Severity:** Medium (integrator drift)  
**Status:** Open

Ponder API returns `humanVerifiedCommitQuorumMet` alongside sticky `hasHumanVerifiedCommit`. SDK `RateLoopRoundItem` and Next.js `PonderOpenRoundSummary` omit typed quorum fields; UI may rely on misleading boolean.

**Locations:** `packages/ponder/src/api/shared.ts`; `packages/sdk/src/read.ts`; `packages/nextjs/services/ponder/client.ts`.

**Fix:** Add typed fields; migrate consumers; deprecate boolean in docs.

---

## 3. Low

### L1 — Signing-intent GET accepts token in query string

**Severity:** Low–Medium  
**Status:** Open (**new**)

Create flow puts token in URL fragment only; GET still accepts `?token=` — leaks via Referer/proxy logs. Handoffs are header-only.

**Locations:** `app/api/agent/signing-intents/[intentId]/route.ts` (~15–16); contrast `lib/agent/handoffs.ts`.

**Fix:** Remove query-param fallback; require header.

---

### L2 — Legacy `{ error }` envelopes on signed-action paths

**Severity:** Low  
**Status:** Open (June 19 L2 residual)

`verifySignedActionChallenge` and policy/attachment challenge routes return `{ error: string }`. Agent/MCP routes use normalized `{ code, message, recoverWith, retryable, status }`. `jsonBodyErrorResponse` normalized in `01f28244`.

**Locations:** `lib/auth/signedRouteHelpers.ts`; agent policy routes.

---

### L3 — agents README gated-context wording

**Severity:** Low  
**Status:** Open

README still says “`imageUrls` and/or `detailsUrl`”; lint requires `detailsUrl` for gated. `ai.md` and `lint.ts` are aligned.

**Locations:** `packages/agents/README.md` (~128); `packages/agents/src/questions/lint.ts`.

---

### L4 — `ai.md` public example uses invalid image URL path

**Severity:** Low  
**Status:** Open (**new**)

Example uses `/uploads/example-generated-concept.webp`; parser requires `/api/attachments/images/att_*.webp`.

**Locations:** `packages/nextjs/public/docs/ai.md` (~225); `packages/agents/src/x402QuestionPayload.ts`.

---

### L5 — Signing-intents REST surface missing from public agent docs

**Severity:** Low  
**Status:** Open (**new**)

Handoffs documented in `sdk.md`; signing-intent routes (`/api/agent/signing-intents`, `/agent/sign/{id}#token=…`) not documented.

---

### L6 — `PONDER_KEEPER_WORK_TOKEN` undocumented in `.env.example`

**Severity:** Low–Medium (ops)  
**Status:** Open (**new**)

Keeper sends token to Ponder `/keeper/work`; Ponder requires it in production. Neither keeper nor ponder `.env.example` lists it. Missing token → silent fallback to full chain discovery.

**Locations:** `packages/keeper/src/keeper.ts` (~572); `packages/ponder/src/api/routes/keeper-routes.ts`.

---

### L7 — Manual correlation CLI omits chain-time `now` for ban checks

**Severity:** Low–Medium  
**Status:** Partial

CLI runs Ponder freshness by default (`--skip-ponder-freshness` escape hatch). Still does not pass `ponderNowSeconds`; auto keeper path uses chain timestamp.

**Locations:** `packages/keeper/src/build-correlation-artifact.ts`; `correlation-artifact-builder.ts`.

---

### L8 — Wall-clock default in `correlation-routes.ts`

**Severity:** Low  
**Status:** Partial

`resolveCorrelationNowSeconds` defaults to `Date.now()` when `?now` omitted. `data-routes` / `leaderboard-routes` migrated to shared `resolveApiNowSeconds`; correlation routes use duplicate helper.

---

### L9 — Settlement side-effect failures swallowed; no on-chain recovery

**Severity:** Low–Medium  
**Status:** Partial

`RoundSettlementSideEffectsLib` try/catch emits `SettlementSideEffectFailed` only. Unit test added (`RoundSettlementSideEffectsLib.t.sol`); no engine integration test or governance retry.

**Locations:** `RoundSettlementSideEffectsLib.sol`; `RoundVotingEngine.sol` (~1072–1079).

---

### L10 — Foundry README contract-size table stale

**Severity:** Low  
**Status:** Open

Table lists outdated byte counts (e.g. `RaterRegistry` 24,540 B vs deploy-profile 22,900 B). `ContentRegistry` absent despite being size-critical for M2.

**Locations:** `packages/foundry/README.md` (~34–41).

---

### L11 — Gas budget test regression

**Severity:** Low  
**Status:** Open (**new** since World ID / recent changes)

`testGas_submitContent_underBudget` fails by 204 gas (951,204 > 951,000). Not a mainnet block limit issue; CI heavy suite gate fails.

**Locations:** `packages/foundry/test/GasBudget.t.sol`.

---

### L12 — Drizzle meta snapshot stale vs 12 migrations

**Severity:** Low  
**Status:** Open (**new**)

Journal lists through `0012`; only `0000_snapshot.json` on disk. `schema.ts` matches 0012; drift risk for `drizzle-kit generate`.

**Locations:** `packages/nextjs/drizzle/meta/_journal.json`.

---

### L13 — Handler test gaps (Ponder)

**Severity:** Low  
**Status:** Open

No dedicated handler tests for `AdvisoryVoteRecorder`, `RoundRewardDistributor`, `FeedbackRegistry`.

---

### L14 — Informational carry-over

Dead `RaterRegistry` follow counters; partial interface drift (no `IContentRegistry`); EIP-170 tight headroom on deploy profile; malformed `Authorization` header routes to managed path (by design).

---

## 4. Fixed since 19 June audit

| ID (19 Jun) | Title | Fix evidence |
| --- | --- | --- |
| **H1** | Freshness via unpaginated `/rounds?limit=200` | `roundId` + `limit=1` in keeper + Ponder filter; tests in `correlation-ponder-freshness.test.ts`, `route-validation.test.ts` |
| **M4** | Signing-intent plan not persisted | `9db182e4` — migration 0012 + `signingIntents.ts` persist + reload tests |
| **M1** (partial) | revealedCount-only freshness | `8c6ecfa5` — voteCount + settled-state gates + unit tests |
| **L1** | ai.md gated drift | `6be7bef3` |
| **L2** (partial) | Mixed error envelopes | `01f28244` — `jsonBodyErrorResponse` normalized; agent signing routes |
| **L3** | Idempotent prepare re-calls MCP | Short-circuit in `signingIntents.ts` (~365–367) |
| **L4** | Client E2E flag split | `81295d18` — `public.ts` server fallback |
| **L5** (code) | Lint “and/or” copy | `lint.ts` requires `detailsUrl` |
| **L10** (partial) | Settlement side-effect test | `32784799` — `RoundSettlementSideEffectsLib.t.sol` |
| **L11** (partial) | Manual CLI skips freshness | Freshness gate by default; `--skip-ponder-freshness` flag |
| **L12** (partial) | Sticky HRC boolean | Comment in `shared.ts`; handler test `e9b92765` |
| **M10** (partial) | Wall clock in data/leaderboard | `412d1b21` — `?now=` on data/leaderboard routes |
| **M5** (partial) | Discovery scan budget | `91f84e6c` — default chain scan 10; CLI freshness gate |
| **Ponder Railway** | Schema collision | `a4aedd40` — deployment-scoped schema |

---

## 5. Test coverage gaps

| Gap | Related | Risk |
| --- | --- | --- |
| No test: continuous reveal → defer blocks auto-build forever | **H1** | High on busy chains |
| No multi-tick defer → freshness → build integration | M1 | Medium |
| No test: direct reproposal → `SnapshotExists` with live parent | M6 | Medium |
| No integration test for discovery cap worst-case latency | M5 | Medium |
| No test: reconciliation tick empty forfeits | M5 | Low |
| No test: signing-intent GET rejects `?token=` | L1 | Low |
| No test: HTTP vs MCP body limit for same payload | M4 | Low |
| No handler tests: AdvisoryVoteRecorder, RoundRewardDistributor, FeedbackRegistry | L13 | Low |
| Gas budget not green | L11 | CI only |

---

## 6. AGENTS.md trust model vs implementation

| Claim | Status |
| --- | --- |
| Optimistic oracle roots; challengers recompute in challenge window | **Aligned** |
| Challenge bonds anti-spam (default 5 USDC), not payout coverage | **Aligned** — `DEFAULT_CHALLENGE_BOND = 5e6` |
| 60-minute `revealGracePeriod` accepted | **Aligned** — `DEFAULT_REVEAL_GRACE_PERIOD_SECONDS = 3600` |
| 7-day arbiter veto window | **Aligned** — `FINALIZATION_VETO_WINDOW = 7 days` |
| Bad proposers lose LREP bond / reputation | **Aligned** — `FrontendRegistry` |
| Engine rotation requires coordinated stack redeploy | **Aligned** — documented runbook |

No material trust-model contradictions found.

---

## 7. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **H1** — Fix reveal-tick defer blocking correlation auto-build | Small, high leverage |
| 2 | **M10** — Apply migration 0012 on app DB | Small (ops) |
| 3 | **M12** — SDK/Next.js HRC quorum types | Small |
| 4 | **M2** — Oracle repoint delegate contract | Small–medium |
| 5 | **M3** — Ponder HRC backfill on deploy | Small (ops) |
| 6 | **M1** — Stronger freshness + integration test (after H1) | Medium |
| 7 | **M4, L1, L3, L4, L6** — HTTP limits, token leak, doc fixes | Small |
| 8 | **M5, M11, M9, L2, L7–L13** — Scaling, env, hygiene | Small–medium |

---

## 8. Notes

- **World ID v3** commits (`accf8b66`..`7527d1fc`) restored v3 proof flow, attestation ABI, and Sepolia deployment pointers. Contract-size CI (deploy profile) still passes; default-profile artifacts overshoot EIP-170 and must not be used for size gates.
- **June 19 audit doc** is stale for open-item status; this document supersedes it for current HEAD.
- **Trust model:** Optimistic oracle per `AGENTS.md` (challenge bonds anti-spam, 60-minute reveal grace, 7-day arbiter veto).
- **Out of scope:** Thirdweb sign-in UI (`LandingPageActions.tsx`, `HumanSignInButton.tsx`) — not reviewed.

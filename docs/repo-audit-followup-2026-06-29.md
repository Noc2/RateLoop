# RateLoop Repo Audit Follow-Up — 2026-06-29

## Scope

Second-pass audit of the RateLoop monorepo after the June 28 remediation commits
(`d691eccee`–`302778298` and follow-on maintenance through `06e145257`). Focus:
verify prior fixes, find regressions or incomplete implementations, and document
remaining bugs and inconsistencies.

Review baseline:

- Repository: `/Users/david/Documents/source/RateLoop`
- Branch: `main`
- Base commit: `06e145257` (`Remove transaction timing console logs`)
- Date: 2026-06-29

This document is a report only. No application code, workflow, configuration,
deployment artifact, or smart contract file was changed as part of this audit.

## Verification Performed

- Ran three parallel read-only review agents covering Foundry contracts, Next.js
  (including post-remediation free-tx and wallet-guard paths), and
  Keeper/Ponder/CI/docs.
- Manually verified the highest-impact findings against current source.
- Cross-checked `docs/repo-audit-findings-2026-06-28.md` remediation claims.
- Ran targeted test suites on `main`:
  - `yarn workspace @rateloop/nextjs test` — 1775 passed.
  - `yarn workspace @rateloop/keeper test` — 529 passed, 2 skipped.
  - `yarn workspace @rateloop/ponder test` — 404 passed, 1 skipped.
- Did not run Foundry contract tests, Playwright E2E, live service probes, or
  production deployments for this report.

## Executive Summary

The June 28 remediation landed correctly for most targeted items: sweep auth,
write-route rate-limit fail-closed, wallet-switch guards, keeper correlation
lock, Ponder bearer bypass scoping, partial ciphertext pagination, write retries,
and documentation drift fixes.

**One high-severity functional gap** stands out: the free-transaction confirm
session-token binding is implemented server-side but **never wired on the
client**, so sponsored transactions skip `/api/transactions/free/confirm` in
production and reservations remain `pending` without recording `tx_hashes`.
Quota is still consumed at verifier reservation time.

No new critical on-chain exploit was found. Remaining issues are mostly
incomplete migrations, operational wiring, documentation drift, and test gaps.

---

## June 28 Remediation — Verified Fixed

| Audit ID | Topic | Status on `main` |
|----------|-------|------------------|
| RL-AUDIT-01 | Question-details sweep auth | **Fixed** — 503 when secret unset; test in `route.test.ts` |
| RL-AUDIT-02 | Write-route rate-limit fail-closed | **Fixed** — feedback POST, sweeps, free session, timing fail closed; reads intentionally fail-open |
| RL-AUDIT-03 | Keeper Ponder dependency docs | **Fixed** — `packages/keeper/README.md` production fail-closed section |
| RL-AUDIT-04 | `humanVerifiedCommitCount` health | **Partially fixed** — Ponder exposes signal; keeper does not consume it (see F-04) |
| RL-AUDIT-05/06/07 | Wallet / sponsorship guards | **Fixed** — `walletContext.ts`, `useSignedCollection`, `useFreeTransactionAllowance` |
| RL-AUDIT-08 | App URL centralization | **Mostly fixed** — x402, MCP, confidentiality, gated attachments; residual `VERCEL_*` reads remain |
| RL-AUDIT-09 | Correlation snapshot lock | **Fixed** — fail-closed when `lockRequired` in production |
| RL-AUDIT-10 | Ponder deployment cache invalidation | **Fixed** — cache cleared on mismatch; regression test in `resolve-rounds.test.ts` |
| RL-AUDIT-12 | Aderyn comment | **Fixed** |
| RL-AUDIT-14 | Scoped Ponder bearer bypass | **Fixed** — only `GET /keeper/work`; `api-index.test.ts` |
| RL-AUDIT-16 | E2E skip guard extension | **Fixed** — `playwright.config.test.ts` allowlist |
| RL-AUDIT-17 | README / CONTRIBUTING drift | **Fixed** — nine packages, full E2E matrix, advisory CI lanes |
| RL-AUDIT-18 | RaterRegistry dead storage | **Documented** — `@dev reserved` natspec |
| RL-AUDIT-19 | FeedbackRegistry domain constant | **Preserved** — string encoding unchanged for production compatibility |
| RL-AUDIT-22/23 | Keeper write retry / partial ciphertext | **Fixed** — tested |

---

## Findings

### RL-FU-2026-06-29-01: Free-transaction confirm never runs in the browser

**Severity:** High (functional regression)

**Location:**
- `packages/nextjs/lib/thirdweb/freeTransactionReservationSession.ts`
- `packages/nextjs/hooks/useThirdwebSponsoredSubmitCalls.ts:907-948`
- `packages/nextjs/app/api/thirdweb/verify-transaction/route.ts`

**Description:** RL-AUDIT-13 added `reservationSessionToken` storage and made
`/api/transactions/free/confirm` require it. `cacheFreeTransactionReservationSession()`
exists but has **zero production callers**. After a successful sponsored batch,
the client calls `readCachedFreeTransactionReservationSession(operationKey)`,
finds nothing, logs `free-transaction-confirm-skipped` with
`missing_reservation_session_token`, and never POSTs confirm.

The token is generated during `evaluateFreeTransactionAllowance` and returned
only from the server-to-server thirdweb verifier route — the browser never
receives or caches it.

**Impact:** Legitimate sponsored txs do not confirm; reservations stay `pending`,
`tx_hashes` are not recorded, and quota lifecycle state diverges from on-chain
reality. Quota is still consumed at reservation time (by design in
`freeTransactions.test.ts`), so users can be charged without a completed confirm
lifecycle.

**Recommended fix:** Wire the token into the client before confirm — e.g. cache
from a client-visible reserve path, extend the allowance/session API to return
`operationKey` + `reservationSessionToken` before `sendCalls`, or move confirm
server-side when the verifier succeeds (token stays server-only).

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-02: Migration `0016` orphaned from Drizzle journal

**Severity:** Medium (ops / deploy drift)

**Location:**
- `packages/nextjs/drizzle/0016_free_transaction_reservation_session_token.sql`
- `packages/nextjs/drizzle/meta/_journal.json` (stops at `0015`)
- `packages/nextjs/drizzle/README.md`

**Description:** `reservation_session_token` is in `lib/db/schema.ts` and the
SQL file exists, but `0016` is not registered in `_journal.json` or the deploy
checklist. Production relies on `db:push` (schema-driven), which works in dev/E2E,
but SQL-only migration paths and fresh installs from `0000` baseline miss the
column.

**Recommended fix:** Add `0016` to `drizzle/README.md` deploy checklist and
register in `_journal.json` via `db:generate`, or document push-only workflow
explicitly for this column.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-03: Incomplete `StaleEngine` error migration

**Severity:** Medium (consistency)

**Location:**
- `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1372-1374` (uses `StaleEngine()`)
- `packages/foundry/contracts/FeedbackBonusEscrow.sol:593-595` (still `require(..., "Stale engine")`)
- `packages/foundry/test/` — no `StaleEngine.selector` assertions

**Description:** June 28 remediation claimed `StaleEngine()` custom error, but
only `QuestionRewardPoolEscrow._requireRegistryVotingEngine` was migrated.
`FeedbackBonusEscrow` still uses string reverts. No tests assert the custom
error selector.

**Recommended fix:** Add `error StaleEngine()` to `FeedbackBonusEscrow`, migrate
the require, add selector tests in engine-rotation paths.

**Contract redeploy required:** Only if changing live contract bytecode (not for
off-chain/docs fixes).

---

### RL-FU-2026-06-29-04: Bare assembly revert for stale registry escrow

**Severity:** Medium (integrator / debugging)

**Location:** `packages/foundry/contracts/QuestionRewardPoolEscrow.sol:1376-1387`

**Description:** `_requireCurrentRegistryEscrow()` still uses assembly
`staticcall` + `revert(0, 0)` on mismatch, inconsistent with the new
`StaleEngine()` style in the sibling guard one function above.

**Recommended fix:** Replace with high-level `registry.questionRewardPoolEscrow()`
comparison and `error StaleEscrow()`.

**Contract redeploy required:** Only on contract upgrade.

---

### RL-FU-2026-06-29-05: Keeper ignores Ponder human-verified-commit health

**Severity:** Medium (operational)

**Location:**
- `packages/ponder/src/api/routes/keeper-routes.ts` (returns `health.humanVerifiedCommitCount`)
- `packages/keeper/src/keeper.ts:743-779` (`parseKeeperWorkPayload` strips `health`)

**Description:** RL-AUDIT-04 added the health signal on Ponder, but the keeper
discards the `health` field when parsing `/keeper/work`. Operators must poll
Ponder `/health/indexer` separately; stale `humanVerifiedCommitCount` can still
skew dormant discovery without keeper-visible warning.

**Recommended fix:** Log or metric when `health.humanVerifiedCommitCount.status === "warning"`;
treat backfill as a release gate before keeper cutover.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-06: Ponder deployment validation skipped on cache hit

**Severity:** Low–Medium (operational nuance)

**Location:** `packages/keeper/src/keeper.ts:619-640`

**Description:** Every call still fetches `/deployment`, but when
`verifiedPonderDeploymentCacheKey` matches, address/chain validation is skipped.
Safe if `deploymentKey` is authoritative; stale metadata with an unchanged key
would not be re-detected until the key changes.

**Recommended fix:** Re-validate fields on cache hit periodically, or document
that operators must restart keeper after Ponder repoint even when key is stable.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-07: Root README still describes keeper as stateless

**Severity:** Medium (documentation)

**Location:** `README.md:165,199`

**Description:** README says the keeper is “stateless” with “no coordination” and
that duplicate transactions “revert harmlessly.” `packages/keeper/README.md`
documents Postgres advisory locks, `KEEPER_DATABASE_URL`, and correlation snapshot
lock requirements. Operators following only the root README may misconfigure
multi-replica deployments.

**Recommended fix:** Align root README keeper section with persistence/lock behavior
and point to `packages/keeper/README.md`.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-08: Residual env URL bypasses

**Severity:** Low

**Location:**
- `packages/nextjs/utils/scaffold-eth/getMetadata.ts` — direct `VERCEL_*` reads
- `packages/nextjs/lib/social/contentShare.server.ts` — `VERCEL_*` fallbacks after `getOptionalAppUrl()`

**Description:** RL-AUDIT-08 centralized most server URL reads; metadata and
share-origin paths still bypass trusted hostname rules.

**Recommended fix:** Route through `getOptionalAppUrl()` / `getTrustedRateLoopAppUrl()`.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-09: Vote wallet guard gap on early async RPCs

**Severity:** Low

**Location:** `packages/nextjs/hooks/useRoundVote.ts` (~475-627)

**Description:** `walletSnapshot` guards signing and submit paths, but early awaits
(`isContentActive`, cooldown, allowance) run before the first `guardWalletContext()`
call (~634). A mid-flight wallet switch could use the wrong account on those reads.

**Recommended fix:** Call `guardWalletContext()` before each long async segment or
use `walletSnapshot.voterAddress` in RPC args consistently.

**Contract redeploy required:** No.

---

### RL-FU-2026-06-29-10: Foundry consistency and test gaps

**Severity:** Low

**Items:**
- `FeedbackRegistry.t.sol` — only 2 hash/domain tests; behavioral coverage remains in `FeedbackBonusEscrow.t.sol`
- `FeedbackRegistry` stores `votingEngineSnapshot` write-only (`FeedbackRegistry.sol:88`)
- `CONFIG_ROLE` granted but no governed `setVotingEngine` on `FeedbackRegistry`
- `RoundVotingEngine` `is IRoundVotingEngine` was largely pre-existing; June 28 commit was cosmetic
- Aderyn exclusions unchanged (`ContentRegistryDormancyLib`, global reentrancy suppression)
- No delegate `publishFeedback` path tests

**Recommended fix:** Expand registry unit tests; finish error-style migration incrementally; document or enforce snapshot field semantics.

**Contract redeploy required:** No (unless removing dead storage in a future upgrade).

---

### RL-FU-2026-06-29-11: June 28 remediation doc overstatements

**Severity:** Info

**Location:** `docs/repo-audit-findings-2026-06-28.md` remediation section

**Description:** Claims `StaleEngine()` and `IRoundVotingEngine` adoption and
“FeedbackRegistry tests” are partially overstated relative to what landed (QRPE
only for `StaleEngine`; interface inheritance pre-dated the commit; hash-only
registry tests).

**Recommended fix:** Treat this follow-up doc as the current post-remediation truth.

---

## Positive Observations

- Prior high-severity off-chain auth and rate-limit gaps from June 28 are closed.
- Keeper correlation lock, write retry, partial ciphertext, and Ponder scoped bypass
  have solid unit/regression tests.
- Wallet-switch guards and sponsorship sync cancellation follow clear, testable patterns.
- Workflow secret scoping (`ETHERSCAN_API_KEY` dummy, World Chain RPC step scoping)
  remains correct.
- Production feedback hash encoding was correctly preserved during domain-constant cleanup.

## Recommended Priority

1. **RL-FU-2026-06-29-01** — Wire free-tx session token to client confirm path.
2. **RL-FU-2026-06-29-02** — Register/document migration `0016`.
3. **RL-FU-2026-06-29-05** — Keeper consume or alert on HRC health warnings.
4. **RL-FU-2026-06-29-07** — Fix root README keeper description.
5. **RL-FU-2026-06-29-03/04** — Finish `StaleEngine` / `StaleEscrow` error migration.
6. **RL-FU-2026-06-29-08/09/10** — Env URLs, vote guard tightening, Foundry test expansion.

## Remediation (2026-06-29)

All follow-up findings above were addressed on `main` in separate commits after this
report. Highlights:

- **RL-FU-01:** `GET /api/transactions/free/reservation-session` plus client fetch/cache
  in `useThirdwebSponsoredSubmitCalls` so sponsored confirms receive the session token.
- **RL-FU-02:** Registered migration `0016` in `drizzle/meta/_journal.json` and deploy checklist.
- **RL-FU-03/04:** `StaleEngine()` in `FeedbackBonusEscrow`; `StaleEscrow()` in
  `QuestionRewardPoolEscrow._requireCurrentRegistryEscrow()` with selector tests.
- **RL-FU-05/06:** Keeper logs/metrics on Ponder HRC health warnings; deployment fields
  re-validated on every `/deployment` fetch.
- **RL-FU-07:** Root README keeper section aligned with `packages/keeper/README.md`.
- **RL-FU-08:** Shared `lib/env/appUrl.ts`; metadata and content-share origins use
  `resolveOptionalAppUrl`.
- **RL-FU-09:** Vote wallet guards before early async RPC segments; allowance/cooldown
  reads pin `walletSnapshot.voterAddress`.
- **RL-FU-10:** Delegate `publishFeedback` regression test in `FeedbackBonusEscrow.t.sol`.
- **RL-FU-11:** June 28 remediation doc corrected; this section added.

## References

- Prior audit: `docs/repo-audit-findings-2026-06-28.md`
- Contract audit: `packages/foundry/audit-report-2026-06-10.md`
- Governance rotation: `AGENTS.md`

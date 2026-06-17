# RateLoop Repo Audit — Bugs & Inconsistencies (23 June 2026)

Multi-agent read-only re-audit of the RateLoop monorepo at HEAD `e412bfb5` (`Format foundry sources`), following the [22 June audit](repo-audit-2026-06-22.md) remediation batch (`51a8086e`..`e14c2e03`) and subsequent fixes through `e412bfb5`.

Four agents audited disjoint subsystems in parallel (Solidity, Next.js/SDK, keeper/Ponder, cross-package consistency). Load-bearing findings were re-verified against source (grep, contract-size check, targeted test runs).

Scope: **bugs, inconsistencies, and drift** — not style, gas, or UX polish.

**No application code was changed for this audit** (documentation only).

---

## TL;DR

The **22 June remediation batch closed the dominant June 22 risks**: `ContentRegistry` ABI sync, correlation vote pagination/truncation, signing-intent 16 MB limits, USDC triple-env guard, managed MCP `apiErrorEnvelope`, `/rounds` HRC quorum fields, keeper prod work-token hard-fail, and dormancy Ponder handlers.

**Post-remediation commits also landed:**

- `862143a3` — expired RBTS seed settlement no longer bricks rounds (`refreshExpiredRbtsSeed` path).
- `00176583` — dormant revival stake pull anchored to `msg.sender`.
- `cd874c1e` — production `.env.production` targets World Chain mainnet (`480`).
- `7a750785` / `96d42ce6` — browser voting helper build + ABI generator test path fixes.

**New dominant risks (none High):**

1. **Settlement side-effect failures are silent on-chain by design** — `RoundSettlementSideEffectsLib` emits `SettlementSideEffectFailed` but settlement still finalizes; no automatic retry (M-F4).
2. **Ponder `/keeper/work` dormancy SQL is stricter than on-chain `isDormancyBlocked`** — sub-quorum open rounds block Ponder dormancy candidates but not chain dormancy (M1).
3. **Keeper discovery catch-all mislabels Ponder failures** — outer `discoverKeeperWorkCandidates` errors surface as `Could not connect to chain` (M2).

**Other notable open items:**

4. Public MCP (`/api/mcp/public`) uses JSON-RPC nested `{ error: { code, message } }` while managed `/api/mcp` uses `apiErrorEnvelope` (L-N4).
5. Docs drift: SDK docs page still uses `www.rateloop.ai` + mainnet `480`; SDK README uses `ponder.rateloop.ai` + Sepolia `4801` (L-D1).
6. `GET /content/:id` returns raw `rounds` rows without `humanVerifiedCommitQuorumMet` (inconsistent with `/rounds`) (L-P1).
7. `generateTsAbis.test.js` ABI parity tests exist locally but are not wired into CI (L-F5).

No new High-severity fund-loss Solidity paths were found. Production config now targets mainnet `480`.

---

## Method

| Agent | Scope | Headline |
| --- | --- | --- |
| 1 | Solidity (`packages/foundry`) | RBTS seed fix verified; settlement side effects by design; 1,750 tests green |
| 2 | Next.js / API / SDK | USDC guard closed; SDK docs page drift; public MCP envelope residual |
| 3 | Keeper + Ponder | Dormancy SQL vs chain mismatch; discovery error message; correlation truncation edge |
| 4 | Cross-package | ABI sync closed; `/content/:id` vs `/rounds` HRC field gap; handler test gaps |

Prior audits: [`repo-audit-2026-06-22.md`](repo-audit-2026-06-22.md), [`repo-audit-2026-06-21.md`](repo-audit-2026-06-21.md).

---

## Verification snapshot (HEAD `e412bfb5`)

| Check | Result |
| --- | --- |
| `make check-contract-sizes DEPLOY_PROFILE=deploy` | **Pass** — all contracts ≤ 24,576 B |
| Tightest contracts | `LaunchDistributionPool` **24,538 B** (38 B headroom); `ContentRegistry` **24,387 B** (189 B); `RoundVotingEngine` **23,911 B** (665 B) |
| `packages/foundry` `forge test` | **1,750 pass, 0 fail** |
| `packages/ponder` vitest | **328 pass, 1 skip** |
| `packages/keeper` vitest | **211 pass, 1 skip** |
| `packages/node-utils` tests | **38 pass** |
| June 22 remediation commits on `main` | **25 commits** from `51a8086e` through `e412bfb5` (includes post-remediation RBTS/dormancy/mainnet fixes) |

---

## 1. High

*None identified at HEAD.*

---

## 2. Medium

### M-F4 — Settlement side-effect failures do not block settlement (operational monitoring required)

**Severity:** Medium (rating/index desync until manual repair)  
**Status:** Open (intentional design, documented in `packages/foundry/README.md`)

`RoundSettlementSideEffectsLib.recordSettlement` wraps `ContentRegistry` rating updates in try/catch. Failure emits `SettlementSideEffectFailed` but settlement still completes (`RoundIntegration.t.sol:test_SettlementSideEffectFailure_DoesNotBlockSettlement`).

**Impact:** Operators must monitor logs and manually call `recordPendingRatingSettlement` (or repoint tooling) when side effects fail. No on-chain retry queue.

---

### M1 — Ponder `/keeper/work` dormancy candidate SQL stricter than `isDormancyBlocked`

**Severity:** Medium (keeper may miss dormant content chain would allow)  
**Status:** Open

Ponder `keeper-routes.ts` excludes content when **any** open round has `voteCount > 0` and `totalStake > 0`:

```136:142:packages/ponder/src/api/routes/keeper-routes.ts
          sql`not exists (
            select 1 from ${round}
            where ${round.contentId} = ${content.id}
              and ${round.state} = ${ROUND_STATE.Open}
              and ${round.voteCount} > 0
              and ${round.totalStake} > 0
          )`,
```

On-chain `RoundVotingReadLib.isDormancyBlocked` returns `true` only when the open round meets quorum thresholds (`revealedCount >= minVoters`, or `voteCount >= minVoters` with sufficient human-verified commits). Sub-quorum sybil rounds **do not** block dormancy on-chain (`RoundVotingEngineDormancy.t.sol`).

**Impact:** Ponder may omit dormant candidates that the keeper could process via chain enumeration fallback — but when Ponder discovery succeeds, those candidates are never surfaced.

---

### M2 — Keeper discovery errors mislabeled as chain connection failures

**Severity:** Medium (misleading ops telemetry)  
**Status:** Open

`packages/keeper/src/keeper.ts` wraps all `discoverKeeperWorkCandidates` failures:

```1128:1131:packages/keeper/src/keeper.ts
  } catch (err) {
    throw new Error(
      `Could not connect to chain: ${err instanceof Error ? err.message : String(err)}`,
    );
```

Inner failures can include Ponder auth/HTTP errors (production now hard-fails on missing `PONDER_KEEPER_WORK_TOKEN` at `keeper.ts:570–572`). The comment at `1116–1118` notes Ponder failures normally fall back inside discovery, but any thrown error still gets the chain-connect label.

**Impact:** Run logs and alerts attribute Ponder/config outages to RPC connectivity.

---

## 3. Low

### L-N4 — Public MCP error shape differs from managed MCP `apiErrorEnvelope`

**Severity:** Low (integrator inconsistency)  
**Status:** Open

Managed `/api/mcp` (`route.ts`) uses `apiErrorEnvelope` from `lib/http/jsonBody.ts`. Public `/api/mcp/public` (`public/route.ts:85–96`) returns JSON-RPC `{ error: { code, message, data } }` via `normalizeToolError` in `lib/mcp/tools.ts`.

Managed MCP origin rejection and GET 405 were migrated (`7b67f81d`); public route was not.

---

### L-D1 — SDK docs page vs README host/chain drift

**Severity:** Low (integrator confusion)  
**Status:** Open

| Surface | `apiBaseUrl` / read host | Default `chainId` |
| --- | --- | --- |
| `packages/sdk/README.md` | `https://ponder.rateloop.ai` | `4801` (Sepolia) |
| `app/(public)/docs/sdk/page.tsx` | `https://www.rateloop.ai` | `480` (mainnet) |
| `.env.production` | N/A | `NEXT_PUBLIC_TARGET_NETWORKS=480` (`cd874c1e`) |

Production now intentionally targets mainnet `480`, but the SDK docs page still points reads at the Next.js origin rather than Ponder, and mixes mainnet chain ID with non-Ponder API host.

---

### L-P1 — `GET /content/:id` rounds omit `humanVerifiedCommitQuorumMet`

**Severity:** Low (API inconsistency)  
**Status:** Open

`/rounds` maps items with `humanVerifiedCommitQuorumMet` (`content-routes.ts:1531–1535`). `GET /content/:id` returns raw `round` table rows without that derived field (`content-routes.ts:1410–1431`), while open-round summary on the content object includes quorum fields via `attachOpenRoundSummary` / `shared.ts`.

---

### L-P2 — Dormancy handler test gaps; repoint handler only bumps `lastActivityAt`

**Severity:** Low  
**Status:** Open

Handlers exist for `ContentDormant`, `ContentRevived`, `DormantSubmissionKeyReleased`, and `PendingRatingClusterPayoutOracleRepointed` (`ContentRegistry.ts:420–447`). `content-registry-handlers.test.ts` covers `ContentDormant` only — no tests for `DormantSubmissionKeyReleased` or repoint events.

`PendingRatingClusterPayoutOracleRepointed` handler only updates `lastActivityAt`; no oracle-address column is indexed (may be intentional if reads are chain-sourced).

---

### L-K1 — `isCorrelationVoteScanTruncated` false negative at scan-budget boundary

**Severity:** Low  
**Status:** Open

When the scan page budget exhausts on a full page (`rows.length === CORRELATION_VOTE_PAGE_SIZE`) **and** the response fills `limit` items, `truncated` stays `false` even though more eligible votes may exist beyond the budget (`correlation-vote-scan.ts:6–16`, `correlation-routes.ts:683–689`).

The `truncated` flag was added in remediation (`99bd6aa7`); this edge case remains.

---

### L-F5 — `generateTsAbis.test.js` not in CI

**Severity:** Low  
**Status:** Open

`packages/foundry/scripts-js/generateTsAbis.test.js` includes ABI/deployment parity checks (path fix in `96d42ce6`). No workflow or `package.json` script references it — ABI drift could regress without CI signal.

---

### L-F6 — Dead `RbtsSeedUnavailable` error declaration

**Severity:** Low (cleanup)  
**Status:** Open

`RoundRevealLib.sol:34` declares `error RbtsSeedUnavailable()` but no `revert RbtsSeedUnavailable()` remains after `862143a3` replaced hard-revert with `refreshExpiredRbtsSeed` permissionless recovery.

---

### L-F7 — `AuditGapTests.t.sol` import/header drift

**Severity:** Low (maintainability)  
**Status:** Open

File header/imports do not match current test organization (noted by Solidity agent; no functional test failures).

---

## 4. Fixed since 22 June audit

| ID (22 Jun) | Title | Fix evidence @ HEAD |
| --- | --- | --- |
| **M-F1** | `ContentRegistry` ABI drift (repoint missing, stale dormancy events) | `a39609cd` — `ContentRegistryAbi.ts` includes `repointPendingRatingClusterPayoutOracle`, `DormantSubmissionKeyReleased`, `PendingRatingClusterPayoutOracleRepointed` |
| **M-F2** | `PendingRatingClusterPayoutOracleRepointed` absent | Same as M-F1 |
| **F1** | Exactly 50,000 eligible votes pagination failure | `51a8086e` — shared `CORRELATION_VOTE_PAGE_SIZE` / scan budget in `@rateloop/node-utils` |
| **F2** | Silent correlation scan truncation | `99bd6aa7` — `truncated` flag on Ponder correlation routes |
| **F3** | Keeper discovery cap semantics undocumented | `077bfeae` — README + prod token behavior |
| **F4** | Keeper prod missing work token silent fallback | `077bfeae` — hard-fail when `NODE_ENV=production` and token unset |
| **F5** | Duplicated domain → endpoint routing | `51a8086e` / `99bd6aa7` — shared `correlationVotesPathForDomain()` |
| **F6** | Fetch timeout mismatch (5s vs 15s) | `PONDER_HTTP_FETCH_TIMEOUT_MS = 15_000` in `node-utils`; keeper + artifact builder import it |
| **F7** | Dormancy indexing gaps | `c15bda49` + `888a5ee1` handlers for dormancy/repoint events |
| **M-N1** | Signing-intent 128 KB vs 16 MB create limit | `077bfeae` — `AGENT_JSON_BODY_MAX_BYTES = 16 * 1024 * 1024` |
| **M-N2** | `ImageAttachmentUploader` reads `json.error` not `message` | `783c1801` — `readJson` prefers `record.message` |
| **M-N3** | Server-only vs browser USDC divergence | `723a2892` — triple-var match guard in `server.ts` |
| **M-N4** | Docs/tests mainnet `480` vs Sepolia `4801` | `888a5ee1` — AI docs + README default to `4801` (SDK docs page residual: L-D1) |
| **M-N5** | MCP origin rejection legacy envelope | `7b67f81d` — managed MCP; public residual: L-N4 |
| **M-X1** | `/rounds` omits HRC quorum fields | `e14c2e03` — `humanVerifiedCommitQuorumMet` on `/rounds` items |
| **M-F3** | Challenged reproposal test gap | `077bfeae` / prior — `test_ChallengedRoundPayoutSnapshotDirectReproposalRevertsSnapshotExistsWithLiveParent` |
| **L-N2** | SDK test fixtures `chainId: 480` | `d1ec8530` — Sepolia defaults in agent route tests |
| **L-N3** | Managed MCP GET 405 legacy shape | `7b67f81d` |

### New fixes since remediation batch (not in 22 Jun audit)

| Commit | Title |
| --- | --- |
| `862143a3` | Expired RBTS seed settlement — permissionless refresh instead of bricking |
| `00176583` | Dormant revival transfers anchored to caller (`msg.sender`) |
| `cd874c1e` | Production config → World Chain mainnet deployment (`480`) |
| `7a750785` | Browser voting helper build (`voting.ts` / `votingCore`) |
| `96d42ce6` | ABI generator test path resolution |
| `9e272a22` / `20e23190` | Next.js tests expect structured rate-limit / service errors |

---

## 5. Test coverage gaps

| Gap | Related | Risk |
| --- | --- | --- |
| `DormantSubmissionKeyReleased` / repoint handler indexing | L-P2 | Low |
| `isCorrelationVoteScanTruncated` full-page-at-budget edge | L-K1 | Low |
| `generateTsAbis.test.js` in CI | L-F5 | Low–Medium |
| Settlement side-effect failure operator runbook automation | M-F4 | Medium (ops) |
| Ponder dormancy SQL parity with `isDormancyBlocked` | M1 | Medium |
| `GET /content/:id` round HRC quorum field | L-P1 | Low |

---

## 6. AGENTS.md trust model vs implementation

| Claim | Status |
| --- | --- |
| Optimistic oracle roots; challengers recompute in challenge window | **Aligned** |
| Challenge bonds anti-spam (default 5 USDC) | **Aligned** |
| 60-minute `revealGracePeriod` accepted | **Aligned** |
| Engine rotation / repoint on `ContentRegistry` | **Aligned** — ABI export now synced (M-F1 closed) |
| Settlement side effects may fail without blocking settlement | **Aligned** — documented; monitor `SettlementSideEffectFailed` (M-F4) |

No material trust-model contradictions found.

---

## 7. Remediation priority

| Priority | Item | Effort |
| --- | --- | --- |
| 1 | **M1** — Align Ponder dormancy candidate SQL with `isDormancyBlocked` quorum logic | Small–medium |
| 2 | **M2** — Propagate discovery error source in keeper (Ponder vs RPC) | Small |
| 3 | **M-F4** — Operator alert/runbook for `SettlementSideEffectFailed` (if not already in prod monitoring) | Small |
| 4 | **L-D1** — Normalize SDK docs page to Ponder URL + label mainnet vs Sepolia explicitly | Small |
| 5 | **L-P1** — Add `humanVerifiedCommitQuorumMet` to `GET /content/:id` rounds or document omission | Small |
| 6 | **L-F5** — Wire `generateTsAbis.test.js` into CI | Small |
| 7 | **L-N4, L-K1, L-F6, L-P2** — Public MCP envelope, truncation edge, dead error cleanup, handler tests | Small |

---

## 8. Notes

- **22 June audit doc** TL;DR and open-item tables are stale for HEAD `e412bfb5`; this document supersedes it for post-remediation state.
- **Production network:** `.env.production` targets mainnet `480` (`cd874c1e`). SDK README and most agent tests remain Sepolia-first (`4801`) — intentional split; document clearly for integrators (L-D1).
- **Contract headroom:** `RoundVotingEngine` improved from 14 B (22 Jun) to **665 B** at HEAD — RBTS seed refactor reduced bytecode size.
- **Out of scope:** Thirdweb sign-in UI; formatting-only commits (`e412bfb5`).

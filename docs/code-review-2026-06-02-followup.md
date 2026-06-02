# RateLoop Repo Review — Follow-up (new surfaces) — 2026-06-02

Scope: the work merged **after** the prior review baseline `7656c806` (the PR that remediated
[`docs/code-review-2026-06-02.md`](./code-review-2026-06-02.md)), up to `main` HEAD `21eccfba`.
Local `main` was first fast-forwarded to `origin/main` (9 commits) before review.

The new commits in range are:

| Commit | Subject |
| ------ | ------- |
| `258c9348` | Sync reputation avatar cache with voter stats |
| `71013cef` | Add agent ask handoff MCP flow |
| `3415daa8` | Add browser ask handoff page |
| `e4bf7b60` | Clarify handoff-first agent workflow |
| `5e85e173` | fix feedback bonus award deadline |
| `dc6532a8` | index feedback bonus award deadlines |
| `2d10ef30` | clarify feedback bonus payout UI |
| `ca2ac1f7` | document feedback bonus award window |
| `21eccfba` | add rateloop context image |

The three dominant new surfaces are: the **agent ask handoff** flow (agent creates a server-side
handoff so a human completes a wallet-signed submission in the browser), the **feedback bonus award
deadline** (a 24h post-settlement award window on `FeedbackBonusEscrow`, indexed as `awardDeadline`),
and the **reputation-avatar cache-buster sync**.

Method: three parallel scope-focused review agents, each told to verify every claim against source and
change nothing. The High finding and the contract↔indexer divergence were then re-verified by hand
against source (control-flow trace + `settledAt` write-site audit) for this document.

**Severity framing.** Nothing is deployed to mainnet. Severities are "impact-if-this-shipped-as-is."

## Summary

| Severity | Count | Items |
| -------- | ----- | ----- |
| High | 1 | H-1 |
| Medium | 2 | M-1, M-2 |
| Low | 4 | L-1 … L-4 |
| Informational | 4 | I-1 … I-4 |

Overall the new code is in good shape. The handoff token is a 256-bit random bearer secret stored only
as a SHA-256 hash (unique index), every read/prepare/complete requires the `id + token_hash` pair, the
token travels in the URL fragment (never the query string — covered by tests), and the signed payload is
bound server-side via the DB-stored `operationKey` so the browser cannot alter the bounty. The
`FeedbackBonusEscrow` award/forfeit boundaries are value-conserving and `nonReentrant`, the deadline
operators are off-by-one-clean, and the ABI matches the contract with no drift. The avatar "cache key"
is a cache-buster query param, not a data selector — avatars are always rendered by `address`, so there
is **no cross-wallet avatar leak**.

### Test / typecheck status observed
- **nextjs:** `check-types` clean (route types generated, no errors).
- **Foundry:** `FeedbackBonusEscrow` suite 41/41 pass.
- **Ponder:** feedback-bonus handler tests 16/16; round-voting-engine + route-validation suites pass (66 total in the touched range).

---

## High

### H-1 — Handoff completion writes status with no concurrency guard, so a racing/stale request can revert `submitted` → `prepared` and overwrite `transaction_hashes`

- **Files:** `packages/nextjs/lib/agent/handoffs.ts:549-580` (`updateAgentAskHandoffStatus`), `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:54-70`.
- **Mechanism.** The UPDATE in `updateAgentAskHandoffStatus` is keyed `WHERE id = ?` only — no status precondition. The `complete` route guards the *sequential* case (line 50-52 short-circuits when the row is already `submitted`), but two concurrent `complete` calls both read `prepared` and pass the line-54 gate. The first sets `submitted`; the second writes `status = result.status === "submitted" ? "submitted" : "prepared"` (line 68) — if its `rateloop_confirm_ask_transactions` response is momentarily not `"submitted"`, it clobbers the terminal `submitted` state back to `prepared` and overwrites `transaction_hashes`.
- **Impact.** The on-chain submission itself is idempotent on `operationKey`, so funds are safe, but the handoff row's terminal state, `transaction_hashes`, and `completed_at` can regress — a client polling `rateloop_get_handoff_status` can see a confirmed ask flip back to "prepared." Read-modify-write with no optimistic concurrency.
- **Suggested fix.** Add a status precondition to the UPDATE, e.g. `WHERE id = ? AND status NOT IN ('submitted','expired')`, and never downgrade to `prepared` once `submitted` (use a `CASE`/conditional rather than an unconditional write). Confidence: high (mechanism verified in source).

---

## Medium

### M-1 — Cancelled rounds: the contract does **not** extend the feedback-bonus award deadline, but the indexer does (contract↔indexer divergence)

- **Files:** `packages/foundry/contracts/FeedbackBonusEscrow.sol:500-515` (`_feedbackBonusAwardDeadline`); `packages/foundry/contracts/RoundVotingEngine.sol:778-782` (`_markRoundCancelled`); `packages/ponder/src/RoundVotingEngine.ts:1283`; `packages/ponder/src/feedback-bonus-deadlines.ts:25-42`.
- **Mechanism.** The contract gates its 24h extension on `settledAt != 0 && state != Open`. Verified against source: `_markRoundCancelled` sets `state = Cancelled` but **never** writes `round.settledAt` (unlike Settled `:933`, Tied `:914`, and RevealFailed via `RoundCleanupLib`). So a Cancelled round has `settledAt == 0`, branch 1 is skipped, branch 2 (Open) is skipped, and the function returns the un-extended `feedbackClosesAt`. The indexer, however, fires `extendFeedbackBonusAwardDeadlinesForTerminalRound` on `RoundCancelled` and unconditionally sets `awardDeadline = max(feedbackClosesAt, cancelBlockTime + 1 day)`.
- **Impact.** Divergence between the on-chain deadline and the indexed `awardDeadline`. For a Cancelled round whose `feedbackClosesAt` has already passed, the contract permits `forfeitExpiredFeedbackBonus` immediately, while the indexer keeps the pool listed "active" for up to 24h and the UI surfaces it as awardable. No fund loss — awards on Cancelled rounds always revert anyway (`_requireRevealedIndependentRater` accepts only Settled/Tied/RevealFailed) — but the active-pool count and "award by" display are wrong for cancelled rounds.
- **Suggested fix.** Make the two agree — cheapest is to have the indexer mirror the contract: skip the extension on `RoundCancelled` (or pass `settledAt: 0` so the helper falls through to `feedbackClosesAt`). Add a Foundry + ponder regression test for the Cancelled-round deadline (currently untested — this is the exact gap). Confidence: high.

### M-2 — `transactionHashes` array length is unbounded at completion

- **File:** `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:28-37` (`readTransactionHashes`).
- **Mechanism.** Each entry is validated as a 32-byte hex hash and at least one is required, but there is no maximum count. The body falls under the default `parseJsonBody` limit (~128 KiB), which still permits ~2000 hashes; the array is JSON-stringified verbatim into the `transaction_hashes` TEXT column.
- **Impact.** A token holder can store an oversized blob — minor DoS / unbounded-storage amplifier.
- **Suggested fix.** Cap the array length to the prepared `transactionPlan.calls.length` (natural bound) or a small constant. Confidence: high.

---

## Low

### L-1 — Dead/confusing ternary with identical branches signals a missing handoff state

- **File:** `packages/nextjs/lib/agent/handoffs.ts:479` — `assets.length > 0 ? "pending" : "pending"`.
- Both branches yield `"pending"`. The intent was almost certainly to set an `awaiting_image_signatures`-style status when image assets are staged. Currently harmless but it flags a missed initial-state distinction for image handoffs. **Fix:** either collapse to the literal `"pending"` or implement the intended asset-pending status. Confidence: high.

### L-2 — `markHandoffExpired` is a non-atomic read-then-write (no SQL guard)

- **File:** `packages/nextjs/lib/agent/handoffs.ts:335-347, 367-371`.
- `loadAgentAskHandoffByToken` checks expiry then issues a separate UPDATE with no `WHERE status NOT IN (...)` guard, so a `prepare` arriving in the same window can race the expiry write. Low impact (expiry is recomputed in memory and returned), but persisted state can briefly disagree. **Fix:** guard the expiry UPDATE the same way as H-1. Confidence: medium.

### L-3 — Active-window boundary inconsistency between ponder API and the nextjs client filter

- **Files:** `packages/ponder/src/api/shared.ts:157,168`, `content-routes.ts:134`, `data-routes.ts:129` use inclusive `awardDeadline >= now`; `packages/nextjs/lib/vote/discoverFeedFilter.ts:154,164` use exclusive `closesAt <= now → not active`.
- At the exact second `now == awardDeadline`, the API counts the pool active while the client treats it closed — a one-second cosmetic disagreement. **Fix:** pick one convention (client `closesAt < now`, or API `> now`). Confidence: high. *(Mirrors I-5 in the prior review — same one-second boundary style.)*

### L-4 — `imageUrls` merge copies unvalidated agent input into the cloned request before validation

- **File:** `packages/nextjs/lib/agent/handoffs.ts:293-326` (`cloneWithImageUrls`).
- The spread `...(Array.isArray(question.imageUrls) ? question.imageUrls : [])` carries whatever the agent placed in `imageUrls` (objects, numbers) into the merged array / `Set` before `parseX402QuestionRequest` runs. Downstream validation should reject bad entries, so risk is low; tighten by filtering to strings first. Confidence: medium.

---

## Informational

- **I-1 — `nextFeedbackAwardDeadline` and `nextFeedbackClosesAt` now return byte-identical SQL** (`packages/ponder/src/api/shared.ts:168-169`): both aggregate `min(... awardDeadline ...)`. The legacy `nextFeedbackClosesAt` field no longer reflects `feedbackClosesAt`. Harmless internally (all repo consumers read `nextFeedbackAwardDeadline ?? nextFeedbackClosesAt`), but misleading for any external consumer and dead-weight SQL. Drop the legacy field or comment it.
- **I-2 — Open-round feedback window not reflected by the indexer** (`FeedbackBonusEscrow.sol:510-512` returns `type(uint256).max` for a started Open round; the indexer leaves `awardDeadline = feedbackClosesAt`). If a round stays Open past `feedbackClosesAt`, the indexer hides the pool as expired even though the contract still considers it live and will extend on settlement. No fund risk (awards require a terminal state). Align or comment.
- **I-3 — Handoff token is a bearer capability with no per-wallet read restriction.** Anyone holding the fragment token can `GET` the full request data (including base64 images via `includeImageData: true`); the wallet match (`prepare/route.ts:223-225`) only gates prepare/complete. This is by design — the token *is* the secret — but worth documenting. No XSS sink found: React escapes all agent-controlled strings, images use mime-constrained `data:`/server `imageUrl` `src`, and `<Link href={handoff.publicUrl}>` uses a server-derived URL.
- **I-4 — Avatar cache safety confirmed.** `app/api/reputation-avatar/route.ts:51-56` returns `Cache-Control: public` keyed by the full URL (address + chainId + accent + size + cache-buster `v`); no wallet/auth data is embedded and `address` is part of the URL, so shared/CDN caching cannot serve one wallet's avatar for another. Address validated by `isAddress`, chainId checked against supported networks, `v` is `encodeURIComponent`'d — no SSRF/path issue. Schema/migration/type consistency for `agent_ask_handoffs` and the `awardDeadline` migration verified end-to-end with no drift.

---

## Recommended fix order

1. **H-1** — add the status guard to the handoff completion UPDATE (correctness; one-line WHERE clause + `CASE`).
2. **M-1** — make the indexer stop extending the deadline on `RoundCancelled`, add the regression test.
3. **M-2 / L-1** — cap `transactionHashes`; resolve the identical-branch ternary.
4. The Low/Info items are cosmetic or defense-in-depth and can be batched.

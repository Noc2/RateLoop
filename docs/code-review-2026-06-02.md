# RateLoop Repo Review — Bugs & Inconsistencies — 2026-06-02

Scope: the whole repository at `main` HEAD `7aeddb97`, with attention concentrated on everything that changed since the last clean contract audit baseline `b9d8a3b4` (~208 files, +13.8k/−3.8k). The dominant new surfaces in that window are: the **bounty activation/eligibility windows** feature (new `QuestionRewardPoolEscrowWindowLib`, heavy changes to the escrow + qualification libs, ponder, sdk, nextjs), the **`RatingMath` "cumulative bounded evidence"** rewrite, **delegated snapshot proposer/keeper** wiring (`FrontendRegistry`, `ClusterPayoutOracle`, keeper), and MCP image uploads.

Method: six parallel scope-focused review agents (bounty-window contracts; other changed contracts incl. RatingMath; ponder indexer + API routes; sdk + nextjs x402/signing; keeper + cross-package ABI consistency; nextjs vote-feed + MCP image upload). Each was told to verify against source before reporting and to change nothing. The one High finding was then **re-verified by hand against source** (baseline-vs-HEAD diff + control-flow trace) for this document. Typecheck/test status captured per package below.

**Severity framing.** Nothing is deployed to mainnet. Severities are "impact-if-this-shipped-as-is." Several indexer items are flagged as *pre-existing* (the diff refactored around them without introducing them) — called out so they are weighted correctly.

## Remediation status (this PR)

All findings were re-verified and addressed; each was committed separately (severity-then-file order). Tests pass per package (foundry escrow/rating/settlement suites, ponder 198, sdk 37, keeper 115, nextjs x402/vote/socialProof).

| Finding | Resolution |
| ------- | ---------- |
| **H-1** | Fixed — refund now always runs the cursor guard; added an empty-leading-round regression test. |
| L-1 | Fixed — per-vote bounty-window predicate added to both claim-candidate routes. |
| L-2 | Fixed — SDK bounty type renamed to the window fields. |
| L-3 | Fixed — removed the unused per-settlement `observedGapX18` computation. |
| L-4 | Fixed — windowless pools/bundles index `bountyOpensAt` at creation time. |
| L-5 | Fixed — bundle create handler uses `onConflictDoNothing` (no window clobber). |
| L-6 | Documented — `round.startTime` pre-activation proxy noted at the predicate sites (precise per-round first-stake index deferred as a feature). |
| L-7 | Documented — landing "Verified Humans" over-count bound noted; precise dedupe needs an API change for a ≤9 cosmetic figure. |
| I-1 | Fixed — removed the dead confidence-model helpers. |
| I-2 | Documented — inert `RatingConfig` fields commented; the memoryless-cumulative model change still merits explicit product sign-off (fields kept, not removed). |
| I-3 | Fixed — removed unused `committedByBountyClose`. |
| I-4 | Documented — `feedbackClosesAt`/`feedbackWindowSeconds` marked informational-only. |
| I-5 | Fixed — active/expired classifiers match the contract's strict boundary. |
| I-6 | Documented — intentional cursor preview/execute divergence noted. |
| I-7 | Fixed — keeper artifact dir resolved to absolute; public artifact route documented. |

The findings below are the original review, retained for the record.

---

## Summary

| Severity | Count | Items |
| -------- | ----- | ----- |
| High | 1 | H-1 |
| Low / Medium | 7 | L-1 … L-7 |
| Informational | 7 | I-1 … I-7 |

The protocol is in good shape overall — the delegated snapshot-proposer feature is well-guarded against opt-in/opt-out-on-behalf and 1000-LREP bond bypass, the RatingMath rewrite is arithmetically sound (bounded, monotone, overflow-safe), the local-signer payload→calldata binding is provably tight, and the MCP image-upload path is hardened against size/MIME/SSRF/path-traversal. The one item that warrants a fix before deploy is **H-1**, a value-conservation regression in the windowed reward-pool refund path. Test suites pass across packages.

### Test / typecheck status observed
- **Foundry:** `forge build` clean; `QuestionRewardPoolEscrow` suite 150/150 pass; other in-scope suites pass.
- **Ponder:** tests 198 passed / 2 skipped; `check-types` clean.
- **SDK:** `check-types` clean; tests 37/37.
- **nextjs:** `check-types` clean; x402 tests 35/35; vote/socialProof/MCP tests 31/31.
- **keeper:** `check-types` clean; tests 115 passed / 3 skipped.
- **agents:** `check-types` clean (after `yarn install`); localSigner binding tests 18/18.

---

## High

### H-1 — `refundExpiredRewardPool` skips the pending-finished-round guard when the qualification cursor sits on an empty leading round, draining funds owed to a later qualifiable round's voters

> **Independently verified against source** (baseline `b9d8a3b4` vs HEAD diff + control-flow trace).

- **Files:** `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:165-171` (`refundExpiredRewardPool`) and the guard at `_refundUnallocatedRewardPool:335-339`; `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowWindowLib.sol:107-118` (`rewardPoolExpired`), `:44-53` (`activateRewardPoolWindowForRound`), `:182-189` (`_firstStakedAtForRound`); guard body `QuestionRewardPoolEscrowQualificationLib.sol:95-106` (`requireNoPendingFinishedRound`).
- **What changed.** At baseline, `_refundUnallocatedRewardPool` **unconditionally** called `requireNoPendingFinishedRound(...)` before refunding (baseline `:326-328`). The window refactor made that call conditional: `if (bountyClosesAt != 0) { requireNoPendingFinishedRound(...) }` (`:335`). The `bountyClosesAt` passed in `refundExpiredRewardPool` comes from `rewardPoolExpired`, which returns `bountyClosesAt = 0` whenever the window was never activated, while still reporting `expired = true` once `block.timestamp > bountyStartBy` (`WindowLib:116-117`).
- **Why the window fails to activate.** `refundExpiredRewardPool` calls `activateRewardPoolWindowForRound(votingEngine, rewardPool, rewardPool.nextRoundToEvaluate)` — it only inspects the **cursor** round. `_firstStakedAtForRound` returns 0 when that round has `commitCount == 0` (`WindowLib:187-188`), so activation returns early and sets nothing; `bountyClosesAt` stays 0. It never looks at later rounds.
- **Impact (value conservation break).** If the round at the cursor is empty (settled/finished with zero commits) but a **later** round was staked and is qualifiable within its window, the refund path sees `bountyClosesAt == 0`, treats the pool as expired, **skips the cursor guard entirely**, and refunds the unallocated balance — the exact funds that would have paid the later round's voters. At baseline this path reverted with `RewardPoolCursorNeedsAdvance` (the guard's whole purpose; the cursor-is-staked-round case is covered by `testSettledRoundCanQualifyAfterPoolExpires`), but the existing tests don't cover the **empty-leading-round** case, so the regression is uncaught.
- **Reachability.** Rounds are sequential per content, the cursor only advances via `qualifyRound`/`advanceQualificationCursor`, and a round can finish with zero commits (cancelled/reveal-failed). So a cursor lagging on an empty round N while a later round M is staked-and-qualifiable is reachable. `refundExpiredRewardPool` is permissionless. Precondition is somewhat narrow (empty leading round before a staked later round, before anyone advances the cursor), hence not Critical.
- **Trigger.**
  1. Create a windowed reward pool (`bountyWindowSeconds > 0`), `requiredSettledRounds = 1`.
  2. First round (= `startRoundId` = cursor) settles with **zero commits**.
  3. A later round receives qualifying votes within its window and settles — before `bountyStartBy`.
  4. Warp past `bountyStartBy`; do **not** call `advanceQualificationCursor`.
  5. Call `refundExpiredRewardPool` → activation anchors only to the empty cursor round → `bountyClosesAt` stays 0 → `rewardPoolExpired` returns `(true, 0)` → `requireNoPendingFinishedRound` skipped → unallocated funds refunded; the qualifiable round's voters can no longer be paid.
- **Suggested fix.** Always run `requireNoPendingFinishedRound` (don't gate it on `bountyClosesAt != 0`); when `bountyClosesAt == 0`, pass `bountyStartBy` as the cutoff so the finished-round check still fires. Alternatively, advance/validate the cursor to the first *staked* round before computing expiry, so window activation can anchor correctly. Add a regression test for the empty-leading-round case.
- **Confidence.** High on the mechanism (verified in source); medium on real-world frequency.

---

## Low / Medium

### L-1 — Ponder claim-candidate endpoints omit the per-vote bounty-window predicate the chain enforces *(partly pre-existing)*
- **Files:** `packages/ponder/src/api/routes/data-routes.ts:1130-1141` (pool), `:325-331` (bundle).
- On-chain `claimQuestionReward` requires the vote's commit/reveal time to fall within `[bountyOpensAt, bountyClosesAt]` (`QuestionRewardPoolEscrowVoterLib.committedWithinBountyWindow`). `/correlation/round-votes` mirrors this correctly (`correlation-routes.ts:461-476`), but `/question-reward-claim-candidates` only checks pool-level window activeness and `/question-bundle-claim-candidates` applies **no** window filter. Result: voters whose commit/reveal landed outside the window are surfaced as claim candidates and their on-chain claim reverts. **Fix:** add the same per-vote window-bound predicate used in `correlation-routes.ts` to both claim-candidate WHERE clauses. Confidence: medium.

### L-2 — SDK `RateLoopAgentBounty` type advertises removed bounty fields
- **File:** `packages/sdk/src/agent.ts:48-57` (`rewardPoolExpiresAt` :53, `feedbackClosesAt` :54).
- The wire schema was renamed to activation windows (`bountyStartBy`, `bountyWindowSeconds`, `feedbackWindowSeconds`), and the server validates with `additionalProperties: false` (`packages/nextjs/lib/agent/schemas.ts:101-139`). The SDK's public bounty type still declares the old `rewardPoolExpiresAt?`/`feedbackClosesAt?` and declares none of the three new fields. An SDK consumer relying on the types will set rejected fields and omit required ones; it only works today via the `[key: string]: unknown` index signature. Fails loudly (validation throws), not silently. **Fix:** update the interface to `bountyStartBy?`/`bountyWindowSeconds?`/`feedbackWindowSeconds?`. (Leave `RateLoopAgentFeedbackBonus.feedbackClosesAt` — that object legitimately still uses an absolute timestamp.) Confidence: high.

### L-3 — RatingMath computes `observedGapX18` (a `ln` + division) on every settlement but never uses it
- **File:** `packages/foundry/contracts/libraries/RatingMath.sol:62`; sole consumer discards it (`RoundSettlementSideEffectsLib._applyBinarySettlement`, `(nextState,,)`).
- After the cumulative-evidence rewrite, rating/confidence/lowSince derive from cumulative evidence; `observedGapX18` no longer feeds `nextState`. It's wasted PRB-math gas on the settlement hot path plus a misleading return. **Fix:** drop it from the hot path (keep only if an off-chain consumer needs it; none on-chain does). Confidence: high.

### L-4 — Ponder stores `bountyOpensAt = 0` for windowless pools instead of the creation timestamp
- **File:** `packages/ponder/src/QuestionRewardPoolEscrow.ts:86` (pool), `:405` (bundle).
- When `bountyWindowSeconds == 0` the contract sets `bountyOpensAt = block.timestamp` at creation and never emits a `WindowActivated` event; the indexer always writes `0n`. No query is affected (window SQL branches short-circuit on `bountyWindowSeconds = 0`), so it's a returned-field accuracy issue. **Fix:** `bountyOpensAt: bountyWindowSeconds === 0n ? event.block.timestamp : 0n`. Confidence: high.

### L-5 — Ponder bundle `QuestionBundleRewardCreated` conflict-update can clobber an activated window *(asymmetric with pool handler)*
- **File:** `packages/ponder/src/QuestionRewardPoolEscrow.ts:416-443`.
- The bundle create handler uses `onConflictDoUpdate` and unconditionally rewrites `expiresAt: bountyStartBy` while leaving the activated `bountyOpensAt/bountyClosesAt` untouched; a replayed `QuestionBundleRewardCreated` after `QuestionBundleWindowActivated` would reset `expiresAt` back to `bountyStartBy` (internally inconsistent). The sibling **pool** handler uses `onConflictDoNothing`. **Fix:** preserve window fields in the conflict branch, or align with the pool handler. Confidence: medium (depends on whether re-emission can occur).

### L-6 — Ponder `round.startTime` proxy over-approximates the pre-activation window *(pre-existing approximation)*
- **Files:** `correlation-routes.ts:447-452, 469-475`; `data-routes.ts:1136-1140`.
- Before activation the contract anchors to `firstStakedAt`; the indexer has no per-round first-stake column and uses `round.startTime` (≤ `firstStakedAt`), so a not-yet-activated late bounty can be transiently reported eligible. Self-corrects on the activation event. **Fix:** acceptable as a documented approximation, or index per-round first-stake. Confidence: medium.

### L-7 — Possible double-count of re-verified legacy humans in landing "Verified Humans" stat
- **File:** `packages/nextjs/lib/home/socialProof.ts:60` (+ `data-routes.ts:1286-1297`).
- `buildLandingPageSocialProofItems` always adds `LEGACY_VERIFIED_HUMAN_COUNT` (9 addresses) on top of the live `count(*)` of current non-revoked credentials; if any of the 9 legacy addresses re-verify on the new contract they're counted twice. Cosmetic marketing stat only. **Fix:** dedupe (union address sets) or confirm-and-comment that the sets are disjoint. Confidence: low (the additive behavior is intentional per the commit; double-count depends on set overlap).

---

## Informational

- **I-1 — RatingMath dead code from the cumulative-evidence rewrite.** `computeDeltaLogitX18`, `computeStepX18`, `computeNextConfidenceMass` (`RatingMath.sol:112-158`) are no longer reachable from production; several `RatingConfig` fields (`confidenceGainBps`, `confidenceReopenBps`, `surpriseReferenceX18`, `maxDeltaLogitX18`, `maxAbsLogitX18`, `observationBetaX18`, `smoothingAlpha/Beta`) are now inert. Remove or re-wire; carrying validated-but-unused params can mislead future auditors. Confidence: high.
- **I-2 — RatingMath model is now memoryless cumulative (design-intent note).** The public score is now `up*10000/(up+down)` over lifetime evidence (clamped `[100,9900]`), independent of the prior anchor (`referenceRatingBps` is only a zero-state bootstrap). This is a deliberate departure from the audited anchor-relative model — large accumulated down-evidence effectively rating-locks an item. Worth explicit product sign-off; update docs and reconsider whether `ratingLogitX18` storage is still needed. Confidence: medium (intent, not a defect).
- **I-3 — Window dead code:** `QuestionRewardPoolEscrowVoterLib.committedByBountyClose` (`:39-47`) is now unreferenced (replaced by `committedWithinBountyWindow`). Delete. Confidence: high.
- **I-4 — `feedbackClosesAt`/`feedbackWindowSeconds` are write-only on the question reward-pool path** (`QuestionRewardPoolEscrowTypes.sol`; set in `WindowLib`): computed, stored, emitted, but never read by any eligibility logic (also true at baseline). Either wire feedback windows into a check or document them as informational-only. Confidence: high.
- **I-5 — Ponder one-second boundary mismatch active/expired** (`api/shared.ts:104-120`, mirrored in `content-routes.ts`): SQL uses `bountyClosesAt > now` for active while the contract uses `block.timestamp > bountyClosesAt` for expired, so at exactly `now == bountyClosesAt` the indexer reports expired while the chain still allows action. Cosmetic; pre-existing comparison style. Use `>=`/`<` to match. Confidence: high.
- **I-6 — Cursor preview vs execute divergence on a start-by-missed pool** (`QuestionRewardPoolEscrowQualificationLib.sol:449` returns `(true,false,0)` vs `qualifyRound` reverting "Bounty not started" at `:173-176`): no value moves on cursor advance and refunds still succeed, so benign, but the two paths model the same state differently. Confidence: medium.
- **I-7 — Keeper operational notes:** the correlation-artifact route is intentionally unauthenticated (content-addressed, immutable, published via a public base URL; filename constrained by `^0x[a-fA-F0-9]{64}\.json$` so no path traversal) — document as intentional; and `artifactStorage.outputDir` defaults to a CWD-relative `"correlation-artifacts"` (`config.ts:536-538`) — consider requiring an absolute path in production. Confidence: high.

---

## Areas reviewed and found sound (recorded so the next pass can build on them)

- **Delegated snapshot proposer (FrontendRegistry, +132 LOC).** No opt-in/opt-out on another wallet's behalf: `setSnapshotProposer` requires the target be unregistered and to have pre-approved this frontend; `approveSnapshotFrontend` requires the caller be unregistered; clear/renounce only touch the caller's own mapping. The two-way maps stay consistent on every mutation, and `register`/`slashFrontend`/`_requestDeregister` clear stale delegations. The 1000-LREP backing cannot be bypassed — `authorizedSnapshotFrontend` re-runs `_isEligible` at read time. Storage gap correctly reduced 44→41 for 3 new mappings.
- **ClusterPayoutOracle delegated-proposer accountability.** Records the bonded `frontendOperator` (not the delegate) for slashing while crediting the bond to the actual `proposer`; `verifyPayoutWeight` still enforces `msg.sender==consumer`, finalized status, current-epoch digest, `effectiveWeight<=baseWeight`, `independenceBps<=BPS_DENOMINATOR`. Keeper's authorization read matches the on-chain gate exactly.
- **RatingMath arithmetic.** `up*10000` fits uint256; floor-division monotone; result clamped; no div-by-zero (`totalEvidence==0`/`confidenceMass==0` guarded); conservative penalty non-increasing in confidence (fuzz-verified). Cumulative `up/downEvidence` propagate as bigint with no lossy casts through all three ponder sinks.
- **Local-signer payload→calldata binding (`packages/agents/src/localSigner.ts`).** Recomputes canonical payload → payloadHash → operationKey → salt → reveal commitment → x402 nonce → reward-terms/round-config hashes from the user's ask payload, then `decodeFunctionData` on the server-returned plan and asserts every field (incl. chainId, verifyingContract, amount) before signing. No display/sign divergence path. Canonical bounty key order matches server byte-for-byte.
- **MCP image upload.** Inline base64 / data-URL only (no remote fetch → no SSRF); size bounded at multiple layers; MIME enforced via allowlist + magic-byte check + re-encode; no path traversal (`attachmentId` `^att_[A-Za-z0-9_-]{16,80}$`, root-prefix containment); sha256 integrity + signed challenge for public callers.
- **Vote feed filtering/ranking.** Expired-bounty items kept and deprioritized consistently across `feedModes.sortDiscoverFeed` and `forYouRanker.rankForYouFeed`; comparators stable (tiebreak on id), no NaN/div-by-zero; default feed mode resolves correctly.
- **`lib/http/jsonBody.ts`.** Byte limit via content-length pre-check + streaming accumulation with `reader.cancel()` on overflow; 413/400 handling; `isJsonObjectBody` rejects arrays/null.
- **New window events fully indexed.** `RewardPoolWindowActivated` and `QuestionBundleWindowActivated` (the only newly-emitted events in the diff) both have ABI-aligned handlers — no F-3-style un-indexed-event drift introduced.
- **Cross-package ABI/address consistency.** Regenerated ABIs match current Solidity signatures across keeper/ponder/sdk/nextjs; World Chain Sepolia (4801) addresses match between `deployments/4801.json` and `deployedContracts.ts`. The "stabilize keeper config test" change is legitimate env hygiene, not bug masking.

---

## Caveat

Static + compile/test-checked review focused on the post-`b9d8a3b4` diff; not a substitute for a full third-party audit before mainnet. Only H-1 was independently hand-verified for this document; the remaining items carry the reviewing agent's stated confidence.

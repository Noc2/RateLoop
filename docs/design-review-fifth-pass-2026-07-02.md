# RateLoop Smart Contracts — Fifth-Pass Multi-Agent Design Review

**Date:** 2026-07-02
**Branch:** `main`
**Head reviewed:** `1f698ac3b` ("contracts: derive rbts seed from reveal entropy")
**Requested by:** the repository owner, on his own work, to keep improving the contracts.

## Provenance & authorship

Git history re-confirmed single-author development at review time: all substantive commits resolve to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2`; remote `git@github.com:Noc2/RateLoop.git`), with only `Cursor Agent` (16) and `dependabot[bot]` (9) as other committers. Every finding below is about the owner's own design.

### Which model did what

The owner asked for this to be recorded explicitly.

- **All research and analysis in this pass was performed by Claude Fable 5**: the lead orchestrator, all three parallel review subagents (settlement/seed, escrow refund-exits, perimeter/registries), the lead's independent code spot-verification of the headline findings, and the external web research (drand/tlock production status).
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used at any point in this pass.** All three subagents completed and returned full reports; no transport or capability failures occurred.
- Tooling caveat, unrelated to model choice: `forge` is not available in the review sandbox, so the Foundry suite was not re-run here. The fourth-pass audit recorded `forge test -q`, contract-size, and storage-layout checks passing at `f4dca9720`; the four contract commits since then should be re-verified locally with `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` before deployment (the seed commit changes `RoundVotingEngineStorage` layout — a mid-insert with a matching `__gap` 14→12 reduction that was verified by hand and is safe for the fresh-redeploy assumption only).

## Scope and method

This pass targeted (a) the four contract commits that landed after the fourth-pass audit head `f4dca9720` — `60342f489` (recovered bundle refund exit, SC-4P-1), `ffbfe4b83` + `961b66b99` (skipped-prequalification refund gates, SC-4P-2), `1f698ac3b` (reveal-entropy RBTS seed, SC-4P-3) — and (b) the perimeter contracts prior passes covered least (registries, oracle, governance, media validator, advisory recorder, confidentiality/feedback escrows, x402 submitter). Three read-only review agents ran in parallel with disjoint scopes; every finding they reported was re-read at the cited lines before inclusion, and the lead independently re-verified the two highest-impact findings (5P-1, 5P-2) directly against the code.

Accepted-design constraints from `AGENTS.md` were honored (optimistic payout roots, 5-USDC anti-spam challenge bonds, 60-minute `revealGracePeriod`, LREP transferability, stale-engine fail-closed rotation model) and are not re-litigated; findings are flagged where a change is *internally inconsistent* with those stated assumptions.

## Fix-verification matrix (prior findings at HEAD)

| Prior finding | Verdict at `1f698ac3b` |
| --- | --- |
| SC-4P-1 (bundle recovered round sets block refunds, High) | **Substantially fixed** by `refundRecoveredQuestionBundleReward` + `abandonRecoveredRoundSets`; two residual gaps → 5P-3, 5P-5 |
| SC-4P-2 (skipped prequalification rounds bypassable by refund, Medium) | **Incomplete** — the new gate is correct but two refund exits bypass it → 5P-1 |
| SC-4P-3 / F-4 (grindable RBTS seed, Medium) | **Substantially fixed** — no block/timestamp/expiry dependence remains; bounded last-revealer residual → 5P-7 |
| F-1 (consumed-root veto asymmetry) | **Fixed** — within-window rejection allowed after consumption; domains 1/4 now defer consumption past the veto window; boundary semantics exact-complementary |
| F-2 (RBTS timeout ignores available snapshots) | **Fixed** — empty-args timeout reverts `SnapshotAvailable()` when a usable finalized domain-5 snapshot exists (`RoundVotingEngineRbtsSettlementModule.sol:41-56`) |
| F-3 (unbounded `correlationEpochSnapshotKeys`) | **Fixed** — `delete` before re-populate; hard-bounded at 256 per epoch (`ClusterPayoutOracle.sol:1027`) |
| F-5 (conflicting `SettlementPending` terminality) | **Material case fixed** — bundle `_isTerminalRound` now excludes `SettlementPending`, matching qualification; `RoundLib.isTerminal` intentionally still counts it for round-advance/read discovery only |
| F-6 (per-leaf `independenceBps` unbounded) | **Fixed** — leaf bound at `RoundRbtsSettlementSnapshotLib.sol:73` |
| Rating snapshots out of round order (own-audit item) | **Fixed on-path** by the strict cursor (`b173ade5d`): apply requires `roundId == nextRatingSnapshotRoundId`, skip classes verified sound and fail-closed; two off-path wedges remain → 5P-2, 5P-4 |

## New findings

### 5P-1 (High impact / Medium likelihood, confidence High). Recovered-round refund exits bypass the skipped-prequalification gate — SC-4P-2 fix is incomplete

- **Where:** `libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:177-219` (`refundExpiredRecoveredRewardPool`) and `:221-257` (`refundInactiveRecoveredRewardPool`) — verified: neither calls `_requireNoPendingPreQualificationRejectedRounds` (present in the plain refunds at `:142` and `:166`), and neither abandons or replacement-checks skipped prequalification rounds.
- **Setup:** the two pending states can coexist. `skipPreQualificationRejectedSnapshotRound` does not require `pendingRecoveredRounds == 0`, and `recoverRejectedSnapshotRound` does not require `pendingPreQualificationRejectedRounds == 0` (the bundle-side skip *does* require no pending recovered sets — the single-pool side lacks the mirror check).
- **Scenario:** Round A qualifies, its snapshot is rejected and recovered (`pendingRecoveredRounds = 1`). Round B is skipped pre-qualification (`pendingPreQualificationRejectedRounds = 1`, cursor advances). A valid replacement root for B finalizes — but B's raters structurally cannot qualify it while any recovered round is pending (`QuestionRewardPoolEscrow.sol:1471-1473`). The funder calls `refundExpiredRecoveredRewardPool(poolId, [A])`: A is abandoned, then the pool refunds — the `completeRecoveredExit` branch sets `unallocatedAmount = 0` and takes the full residue, and the fallback `_refundUnallocatedRewardPool` inspects only the cursor round, not the skipped round behind it. `unallocatedRefunded` is now set; B's late qualification is permanently blocked, B's raters lose the payout SC-4P-2 intended to protect, and `pendingPreQualificationRejectedRounds` sticks at 1 forever.
- **Fix:** add `_requireNoPendingPreQualificationRejectedRounds(rewardPool)` to both recovered exits (forcing the funder through `refundPreQualificationRejectedRewardPool` semantics, which abandon with the replacement check), or accept a second `roundIds` array and run `_abandonPreQualificationRejectedRounds` inline. Additionally consider mirroring the bundle rule (skip requires no pending recovered rounds) to prevent the state coexistence outright.

### 5P-2 (Medium, confidence High). Public-rating cursor permanently wedges after a voting-engine rotation for refund-terminal rounds

- **Where:** `ContentRegistry.sol:1442-1452` (`advanceRatingSnapshotCursor` passes the *current* `votingEngine`); `ContentRegistryRatingSnapshotLib.sol:258-276` — verified.
- **Mechanism:** for a round with no recorded pending settlement, the skip predicate reads `roundCore` from the current engine. Round IDs are global per content, so a round that lived on a previous engine reads as an empty slot on the new engine, which decodes as `RoundState.Open` (enum zero) — never skippable. Terminal rounds on the old engine do not trip the `ActiveRoundOnPreviousEngine` rotation guard, so rotation proceeds cleanly and only fails later.
- **Scenario:** round 5 ends `Cancelled`/`Tied`/`RevealFailed` on engine A before the cursor passes it; governance rotates to engine B; round 6 settles on B. `applyRatingPayoutSnapshot(…, 6, …)` reverts `RatingSnapshotOutOfOrder(5)` forever, `advanceRatingSnapshotCursor` sees round 5 as `Open` forever, and the content's canonical rating, `lowSince` timer, and slash eligibility freeze permanently. There is no cursor setter or governance override.
- **Inconsistency:** the record/apply paths deliberately support pinned stale engines (settled old-engine rounds flow end-to-end); only the skip classes consult a single engine. This contradicts the `AGENTS.md` coordinated-rotation runbook's implicit assumption that a full redeploy-and-rewire leaves no stranded state.
- **Fix (redeploy is free):** in `_canAdvanceRatingSnapshotCursor`, fall back to `contentRoundTrackingEngine[contentId]` (or a per-round owning-engine record) when the current engine reports non-terminal; or add a CONFIG_ROLE `skipRatingSnapshotRound` that verifies terminal state against a caller-supplied engine with an authorized callback generation, with an event.

### 5P-3 (Medium, confidence Medium-High). Bundle reopen skips the claim-grace restart that protects single pools

- **Where:** `libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:150-164` (reopened sets abandonable without the replacement check), `:248-299` (`_reopenRecoveredSnapshotRoundSet` does not bump `claimDeadline`) — vs. single-pool `RecoveryLib.sol:286-288` (reopen restarts the grace) and `PoolActionsLib.sol:529-530`.
- **Scenario:** if rejection/recovery/replacement all land after `claimDeadline + BUNDLE_CLAIM_GRACE` has already elapsed, a round set that is reopened-but-unqualified due to a *transient* qualification failure (e.g. a lapsed `BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG` credential that recovers on re-verification) can be abandoned + refunded by the funder in a single transaction, with zero window for permissionless requalification. The funder can even create the reopened state themselves, since the escrow wrapper reopens and then attempts qualification, and a `false` return leaves the flag set.
- **Fix:** bump `bundle.claimDeadline` to `block.timestamp` in `_reopenRecoveredSnapshotRoundSet`; the refund body already enforces `claimDeadline + BUNDLE_CLAIM_GRACE`, so every reopen then buys claimants 7 days — exact parity with the single-pool design.

### 5P-4 (Low–Medium, confidence High). The public-rating pipeline has no zero-proposer liveness escape — every sibling pipeline got one

- **Where:** `ContentRegistryRatingSnapshotLib.sol:167-218, 258-276`; contrast the RBTS 14-day timeout and the escrow's `skipPreQualificationSnapshotlessClusterRound`.
- **Mechanism:** a settled round's `PendingRatingSettlement` blocks the cursor until a domain-3 snapshot is finalized, past the veto window, and applied. With no bonded proposer, the block is permanent; `repointPendingRatingClusterPayoutOracle` swaps the oracle but still needs a willing proposer. The visible rating and the slash clock freeze at the pre-round value while later rounds keep queueing.
- **Incentive note:** a content owner whose rating is about to cross `slashThresholdBps` benefits from proposer *inaction* — the cheapest attack is doing nothing, which anti-spam bonds do not price. Also, a round whose scorer output is all-zero effective weight has no proposable representation at all (oracle rejects empty payloads; consumer requires `totalClaimWeight != 0`) — unlikely given scorer floors, but the floors are off-chain parameters, not an on-chain invariant.
- **Fix:** mirror the escrow pattern — governance-only `skipSnapshotlessRatingRound(contentId, roundId)`, allowed only when the pinned oracle has no domain-3 proposal for the round (optionally after a long timeout), marking the pending applied without rating movement, with a dedicated event.

### 5P-5 (Low–Medium, confidence Medium). A valid-but-unqualifiable replacement snapshot deadlocks the recovered exit until governance rejects the root

- **Where:** `BundleActionsLib.sol:1113` / `QualificationLib.sol:329` (`"Cluster snapshot mismatch"` requires the snapshot's `rawEligibleVoters` to equal the *live-recomputed* eligible count) vs. `_hasRecoveredReplacementSnapshot` (`BundleRecoveryLib.sol:363-405`, `PoolActionsLib.sol:592-636`), which does not model eligible-voter drift.
- **Scenario:** a voter is banned (or a recheck credential lapses) after the replacement root was proposed. Requalification now reverts on the count mismatch — and because the wrapper reopens and qualifies atomically, the revert rolls back the reopen too. Meanwhile the replacement predicate still returns `true` (Finalized, not rejected), so abandonment reverts with `...ReplacementSnapshotAvailable` and plain refund reverts on the pending counter. All exits stay closed until the drift reverses or the arbiter rejects the (unconsumed) root — a governance action, not a permissionless one.
- **Fix:** have `_hasRecoveredReplacementSnapshot` return `false` when the snapshot's `rawEligibleVoters` no longer matches the currently computable eligible count (i.e. treat a snapshot the qualification path would reject as "no replacement available"), or soften the qualification `require` for the recovered/skipped paths.

### 5P-6 (Low, confidence High). `RatingSnapshotApplied` event schema drift between library and registry ABI

- **Where:** `ContentRegistryRatingSnapshotLib.sol:19-26` (`snapshotKey` **not** indexed — this is what lands on-chain, since the external library emits via delegatecall) vs. `ContentRegistry.sol:297-304` (mirror declares `bytes32 indexed snapshotKey`). Topic0 is identical, so an indexer using the registry ABI silently fails to match/decode. `RatingSnapshotCursorAdvanced` exists only in the library (no registry mirror). All other mirrors checked match.
- **Fix:** align the declarations and add the pair to the existing generated-ABI event-schema guard test (the I-2 machinery exists for exactly this class).

### 5P-7 (Low residual, confidence High). New RBTS seed: bounded last-revealer set-membership grind remains; NatSpec slightly oversells

- The new seed (`RoundRevealLib._rbtsScoreSeed:543-555`) is fully independent of block number, hash, and timestamp, and per-commit reveal entropy is blind-precommitted via the tlock ciphertext — settlement-caller grinding (SC-4P-3) and expiry re-rolls (F-4) are gone. The residual lever is **scoring-set membership**: an actor with k ≥ 2 committed wallets can wait for honest reveals, then atomically reveal a chosen subset and settle in one transaction, grinding pairings over 2^k membership choices. Each withheld wallet forfeits its stake and rewards, and the lever affects only peer/reference *pairings* (an information-score effect) — never votes, the verdict, or a payout forge. Same class as the previously accepted "weak PRNG pairing" Low, now strictly more expensive than before the fix.
- **Fix:** none required beyond documentation — correct the comment at `RoundRevealLib.sol:539-541` ("make the seed fixed after closure" holds against non-scoring commits, not against a multi-wallet settler choosing set membership) and fold the residual into the accepted Low.

### 5P-8 (Informational). `CLAIM_GRACE` duplicated after the `961b66b99` trim

- `QuestionRewardPoolEscrowPoolActionsLib` now hardcodes `CLAIM_GRACE = 7 days` while `QuestionRewardPoolEscrow.sol:67` retains `BUNDLE_CLAIM_GRACE = 7 days` and still passes its copy into bundle refunds. Two constants that must move together — same class as the known quorum-constant coupling. One-line consolidation.

### 5P-9 (Informational–Low). Governor vote lock is all-or-nothing against current balance; proposal lock hardcodes a 2 s block time

- `RateLoopGovernor._castVote` locks the full snapshot weight and `_lockForGovernanceUntil` requires current `balanceOf ≥ amount` (`LoopReputation.sol:85`): an account that transferred any LREP after the snapshot cannot vote at all (revert, not partial lock). Self-inflicted and it does close the vote-then-dump gap, but it diverges from standard ERC20Votes semantics and will surface as unexplained `castVote` failures. Separately, `_proposalLockUntil` hardcodes a 2 s block time; fine on Base (max lock ~37 days < 40-day cap), but a redeploy to a slower chain would under-lock proposers relative to the voting window. Document both, or lock `min(weight, balance)`.

## External research (Claude Fable 5, web)

- **drand / tlock dependency:** the blind phase depends on League of Entropy `quicknet` liveness for reveal decryption. Research confirms quicknet and tlock remain production networks with a long uptime record and **no announced deprecation plans** as of mid-2026 (`evmnet`, BN254-based, also active; its fate is a collective LoE decision with "no plan to wind it down"). A formal audit of the tlock scheme exists (Kudelski) and the scheme has an academic basis (eprint 2023/189). Residual risk is availability, not forgery: if drand halted permanently, unrevealed commits could never decrypt — the protocol's reveal-failure/cancel paths (stake return without scoring) are the correct fallback and already exist. No action needed beyond keeping the drand chain-hash config governance-rotatable, which it is.
  Sources: [drand timelock docs](https://docs.drand.love/docs/timelock-encryption/), [quicknet launch](https://docs.drand.love/blog/2023/10/16/quicknet-is-live/), [BLS verification on Ethereum / evmnet status](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum/), [Kudelski audit](https://kudelskisecurity.com/research/audit-of-drand-timelock-encryption), [tlock paper](https://eprint.iacr.org/2023/189.pdf), [drand/tlock repo](https://github.com/drand/tlock).
- Peer-prediction (RBTS/COCM) literature research was already performed and recorded in `docs/design-review-2026-07.md` and is not repeated here; nothing in this pass changes those conclusions (truthfulness remains BNE-only; the correlation-snapshot architecture is the mitigation, not a proof of independence).

## Notable non-findings (checked, no issue)

Status note, 2026-07-02: the FrontendRegistry fee-withdrawal observation below was made before the one-hour launch-default remediation. Earned operator fee withdrawals now use a 1-hour slashable review window, while frontend stake exits still keep the separate 14-day unbonding period.

`X402QuestionSubmitter` (EIP-3009 nonce binds chain, registries, payload, terms; gateway-restricted extraction; exact-sweep assertion; stale-escrow fail-closed). `FeedbackBonusEscrow` (funds conserved; every pool has a terminal exit; double-award blocked at hash and identity granularity). `ConfidentialityEscrow` (single-shot bond lifecycle; unconditional exit at ≤ 210 d independent of external availability). `ClusterPayoutOracle` state machine (every state has an exit; bond conservation on all paths; overlapping epochs cannot double-consume). World ID handling (proof bound to sender; replay keys include full config + nonce + TTL floor; bans stick through re-attestation). FrontendRegistry pre-remediation fee review (no sequencing found that shortened the then-configured fee slashability window). `ProtocolConfig` cross-clamps (no governance-settable combination found that bricks a live flow). Launch-pool size-trim `26f901563` (helpers moved verbatim; dropped zero-oracle check unreachable). SC-4P-2's counter machinery itself (all increments/decrements flag-guarded and symmetric; abandoned rounds cannot later pay). RBTS snapshot leaf validation (comprehensive: sort/dedupe, scope, proof, identity binding, weight bounds, aggregate equality). Storage layout of the seed commit (mid-insert with matching gap reduction; safe for fresh deployment).

## Priorities

1. **5P-1** — gate the two recovered-refund exits; it re-opens SC-4P-2's exact loss scenario through a different door and permanently strands the pending counter.
2. **5P-2** — make the rating-cursor skip predicate rotation-safe before any engine rotation is ever exercised; it is the only permanent no-override wedge found.
3. **5P-3** — one-line grace bump on bundle reopen (parity with single pools).
4. **5P-4** — decide the rating-pipeline zero-proposer policy (governance skip vs timeout) and document the slash-freeze incentive.
5. **5P-5 / 5P-6 / 5P-8** — cheap hardenings: replacement-predicate drift check, event-ABI alignment + guard test, constant consolidation.
6. **5P-7 / 5P-9** — documentation-level: seed NatSpec correction; governor lock semantics.
7. Re-run `forge test`, size, and storage-layout checks locally at HEAD (not possible in the review sandbox).

---

*Prepared 2026-07-02 by a Claude Fable 5 multi-agent review at HEAD `1f698ac3b`: lead orchestrator + three parallel read-only subagents (settlement/seed, escrow refund-exits, perimeter/registries), all on Claude Fable 5, with lead code re-verification of 5P-1 and 5P-2 and Fable 5 web research on the drand/tlock dependency. No fallback to Claude Opus 4.8 (or any other model) occurred at any point.*

# RateLoop second-pass audit — 2026-05-20 follow-up

Adversarial review on branch `claude-audit-4`, HEAD `400628e0` (post-PR#20 merge). Six parallel agents probed RoundVotingEngine + Tlock, QuestionRewardPoolEscrow, ClusterPayoutOracle, RaterRegistry, LaunchDistributionPool / ParticipationPool, plus a web survey of Q1-Q2 2026 Solidity / EVM / DeFi disclosures. All findings deduped against the May 4 / 16 / 17 / 18 / 19 audit reports stored under `packages/foundry/audit-report-*.md`.

## Summary

| Severity | New | Follow-up | Total |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 1 | 0 | 1 |
| Low | 4 | 1 | 5 |
| Informational | 11 | 0 | 11 |
| Toolchain | 1 | 0 | 1 |

The Medium (RR-1) is a regression-class side-effect of the M-Identity-2 sticky-canonical fix landed on May 20: under a `revoke → clearRevokedHumanNullifier → seed-different-rater → re-seed-original-rater` sequence, the original rater retains the original nullifier as its canonical identity key while the new rater simultaneously receives the same canonical, producing two distinct addresses with identical `identityKey`. Downstream this enables silent profile theft via `ProfileRegistry._migrateProfileForIdentityKey`, cross-rater vote-commit DoS, and bonus-award shadowing. Trust-bounded (requires SEEDER_ROLE) but the cascade is broad; fix is one-line at the revoke site.

The other findings are non-obvious second-order edges of fully implemented features. The toolchain finding is the [Solidity 0.8.28-0.8.33 via_ir transient/persistent storage clearing helper collision](https://www.soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug/), which the project's pragma + foundry profile + ReentrancyGuardTransient usage all match.

---

## Medium findings

### RR-1 — Sticky canonical key + nullifier-reuse via `clearRevokedHumanNullifier` creates identityKey collisions across distinct raters

**Files:** `contracts/RaterRegistry.sol:309-326` (`revokeHumanCredential`), `:328-336` (`clearRevokedHumanNullifier`), `:461-473` (canonical first-set guard inside `_attestHumanCredential`), `:348-361` (`rotateCanonicalIdentityKey`).

**Pre-conditions.** Requires `SEEDER_ROLE` actions. Trust-bounded; rated Medium because the cascade hits per-identity state in `ProfileRegistry`, `RoundVotingEngine`, `FeedbackBonusEscrow`, `AdvisoryVoteRecorder`, and `LaunchDistributionPool`, none of which observe a re-mapping signal beyond `CanonicalHumanIdentityKeyRotated`.

**State sequence.**
1. SEEDER seeds rater A with anchorId N → `_humanNullifierOwnerByProvider[SeededHuman][N] = A`, `_canonicalHumanIdentityKey[A] = N`.
2. A acquires per-identity state under key N: ProfileRegistry name "alice" → `_profileOwnerByIdentityKey[N] = A`; cooldown / exclusion state tracked under N in RoundVotingEngine / FeedbackBonusEscrow.
3. SEEDER calls `revokeHumanCredential(A)`. The owner slot is cleared and the revoke flag is set, but `_canonicalHumanIdentityKey[A]` is intentionally preserved (per the M-Identity-2 stickiness contract).
4. SEEDER calls `clearRevokedHumanNullifier(SeededHuman, N)`. Revoke flag flipped back to false.
5. SEEDER calls `seedHumanCredential(B, ..., anchorId = N, ...)`. Owner slot is now unowned, so this succeeds. First attestation for B, so the guard at `:471` writes `_canonicalHumanIdentityKey[B] = N`.
6. SEEDER (or a normal credential refresh) later re-seeds A with anchorId M ≠ N. The owner-equality check at `:455` correctly refuses to clear B's slot. New slot `[SeededHuman][M] = A`. Canonical guard at `:471` sees `_canonicalHumanIdentityKey[A] = N` (non-zero) → NOT updated. A's record: `nullifierHash=M`, `canonical=N`.

**Result:** `resolveRater(A).identityKey == N == resolveRater(B).identityKey`. `_identityForHolder` (`:510-514`) returns the canonical, which is now shared between A and B.

**Downstream amplification.**
- **ProfileRegistry profile steal** (`:288-319`): when B calls `setProfile`, `_optionalDirectHumanIdentityKey(B)` returns canonical N, `_migrateProfileForIdentityKey(B, N)` sees `previousOwner = A`, and (if A has a profile and B does not) **moves A's name, selfReport, createdAt, avatar accent into B's slot** and rebinds `_nameToAddress[hash("alice")] = B`. A loses their username silently.
- **Vote-commit collision** (`RoundVotingEngine` `:611-703`, `voterCommitHash[identityKey]`): whichever of A or B commits first in a round occupies key N; the second is rejected with the "identity already committed" guard. Permanent per-round DoS of the loser.
- **Bonus award shadowing** (`FeedbackBonusEscrow.sol:199-209` `identityKeyAwarded[poolId][identityKey]`): whichever resolves first locks the slot for the second.
- **Advisory cooldown shadowing** (`AdvisoryVoteRecorder.sol:730-732`, `RaterRegistry.lastVoteTimestampByIdentity`): cooldowns interleave between two unrelated raters.

**Why M-Identity-2 missed this.** The original M-Identity-2 fix locked canonical to first-attestation to preserve identity continuity for legitimate users across SEEDER credential refreshes. It assumed monotonic rater identity. But `clearRevokedHumanNullifier` deliberately recycles a nullifier to a different address — and the stale `_canonicalHumanIdentityKey[A]` survives revocation, recycle, and A's re-attestation.

**Fix (minimal).** In `revokeHumanCredential` (`:309-326`), also `delete _canonicalHumanIdentityKey[rater]` alongside the owner-slot clearance. This forces the next `_attestHumanCredential` for that rater to re-seed canonical from the new nullifier. Emit a `CanonicalHumanIdentityKeyCleared(rater, oldKey)` event so off-chain indexers detach state.

**Test gap.** `test/RaterRegistry.t.sol` has no coverage for the "revoke → clearRevoked → seed second rater → re-seed first rater" sequence. Add a regression assertion that `resolveRater(A).identityKey != resolveRater(B).identityKey` after that path.

---

## Low findings

### FV-1 — `_getRoundReferenceRatingBps` live-fallback can desync commit hash if snapshot stores 0
**File:** `RoundVotingEngine.sol:1148-1154` (combined with `ContentRegistry.sol:1198-1202`, `RoundCreationLib.sol:39`).

`_getRoundReferenceRatingBps` returns the per-round snapshot if non-zero, otherwise falls back to live `registry.getRating(contentId)`. The snapshot is set once at round creation via `roundReferenceRatingBpsSnapshot[contentId][roundId] = registry.getRating(contentId)` in `RoundCreationLib.snapshotRoundVotingConfig:39`. Standard content path returns `c.rating = 50` (= 5000 BPS) so the snapshot is never 0 in production. **However**, any code path that produces content with both `_ratingState.ratingBps == 0` AND `c.rating == 0` at round-creation time will store 0 in the snapshot. On the next settlement of that contentId's previous round, `updateRatingState` could move `state.ratingBps` to a non-zero value — and from that moment, `_getRoundReferenceRatingBps` for the open round silently switches from "snapshot=0" to "live=non-zero", invalidating every commit hash already submitted for that round.

**Fix.** Either (a) require `roundReferenceRatingBpsSnapshot[contentId][roundId] != 0` at snapshot time (revert if `getRating` returns 0), or (b) remove the live fallback in `_getRoundReferenceRatingBps` and trust the snapshot unconditionally. Option (b) is safer.

### FE-1 — `recoverRejectedSnapshotRound` permanently orphans honest voters of the rejected round
**File:** `QuestionRewardPoolEscrow.sol:898-933` (esp. comment at `:894-897`).

After arbiter rejects a finalized snapshot, `recoverRejectedSnapshotRound` returns the allocation to `unallocatedAmount` and deletes the snapshot but intentionally leaves `nextRoundToEvaluate` advanced. The cited reason is replay protection. The side-effect: an honestly re-proposed and re-finalized snapshot for the same `roundId` (different `weightRoot`) can never be re-qualified — `qualifyRound` reverts with "Round out of order" because `roundId < nextRoundToEvaluate`. Voters who legitimately participated in that round are permanently excluded from this pool's payout, even though the oracle now has a valid replacement snapshot for them.

**Exploit posture.** Combined with M-Oracle-1 family considerations, an adversarial proposer racing every snapshot proposal can force arbiter rejection. Once the escrow runs `recoverRejectedSnapshotRound`, voters lose access to this pool's reward for that round even after honest re-proposal. Funds are not stuck (they refund into `unallocatedAmount` and re-allocate to the next round) but voter payouts are.

**Fix.** Add an admin `reopenRecoveredSnapshotRound(rewardPoolId, roundId)` that requires the oracle has a new finalized snapshot with a different `weightRoot` not on the rejected set, then re-decrements `nextRoundToEvaluate`; or store rejected `roundId`s in a per-pool set so `qualifyRound` allows out-of-order re-qualification for that specific round.

### FE-2 — `refundExpiredRewardPool` complete-pool path uses qualification-time `claimDeadline`, not `bountyClosesAt`
**File:** `libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:290-307`; `libraries/QuestionRewardPoolEscrowQualificationLib.sol:197-200`.

`_refundCompleteRewardPool` requires `block.timestamp > claimDeadline + BUNDLE_CLAIM_GRACE` (7 days). `claimDeadline` is initially set to `bountyClosesAt` at create time but during qualification is overwritten to `max(block.timestamp, settledAt)`. If `requiredSettledRounds > 1` and the final round qualifies long after `bountyClosesAt`, the funder's refund clock is reset to last-qualified-round + 7 days. Not a fund-loss bug, but a documented expectation mismatch: bounty creators expect 7 days after `bountyClosesAt`, not after the last qualifying round.

**Fix.** Pin `claimDeadline` to `bountyClosesAt` at create time and only advance to qualification time when `block.timestamp > bountyClosesAt` AND the bounty is not yet complete; or document in the create-function NatSpec that "claim grace runs from the LATER of `bountyClosesAt` and last qualification".

### LP-1 — Pool-depleted-at-settlement leaves round participation rewards in unreachable limbo
**Files:** `RoundRewardDistributor.sol:1075-1092`; `ParticipationPool.sol:214-234` (reserve path); `RoundRewardDistributor.sol:659-720` (claim).

`_syncParticipationRewardSnapshot` is called from `runSettlementSideEffects`. If `ParticipationPool.poolBalance == 0` at settlement time, `reserveReward` returns 0. The non-`requireFullReservation` branch at `:1089-1091` returns `(totalReward, reservedReward=0, fullyReserved=false)` before the assignments at `:1094-1099`. Consequently `roundParticipationRewardPool[contentId][roundId]` remains `address(0)`. Any subsequent `claimParticipationReward(contentId, roundId)` reverts on `revert NoPool();` (`:676`). The admin-only `backfillParticipationRewards` is the only recovery path, and it itself reverts with `PoolDepleted` if the pool is still empty (`:649`). If governance never refills the participation pool, every winning voter of every round settled while the pool was empty silently forfeits — only `ParticipationRewardSnapshotFailed` fires, with no enforceable reservation.

**Fix.** Either (a) persist `roundParticipationRewardOwed` and the pool address even on partial-or-zero reservation so a later `backfillParticipationRewards` can finish the reservation, or (b) emit an explicit `RoundParticipationRewardForfeited` event when the pool is permanently drained and document the operational expectation.

### RR-2 (follow-up to RR-1) — `rotateCanonicalIdentityKey` cannot repair a stale canonical when the rater has no active credential
**File:** `contracts/RaterRegistry.sol:348-361`.

`rotateCanonicalIdentityKey` reverts with `InvalidCredential` if the rater's credential is `revoked` or expired. Combined with RR-1, after revocation A's stale canonical = N is un-repairable until SEEDER re-attests A first — there is no governance escape hatch for "clear the canonical of a rater whose credential is gone." If RR-1 is fixed at the revoke site (recommended), this becomes moot; otherwise add an explicit `clearCanonicalIdentityKey(rater)` SEEDER-gated path.

---

## Toolchain finding

### TC-1 — `pragma ^0.8.24` + `via_ir = true` matches the Solidity 0.8.28-0.8.33 transient/persistent storage clearing helper-name collision

**Files:** `foundry.toml` (no `solc` pin, `[profile.default] via_ir = true, optimizer = true, optimizer_runs = 100`), `contracts/*.sol` (all `pragma ^0.8.24`).

CI compiles with `solc 0.8.28` (confirmed in `foundry` and `foundry-heavy` job logs). The project uses `ReentrancyGuardTransient` in `ContentRegistry`, `FeedbackBonusEscrow`, `FrontendRegistry`, `AdvisoryVoteRecorder`, `ParticipationPool`, and others. Disclosure: "[Transient Storage Clearing Helper Collision Bug](https://www.soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug/)" — when a contract clears both a persistent and a transient state var of the same value type with `delete`, the Yul IR pipeline emits the wrong opcode (SSTORE in place of TSTORE or vice versa) because two generated helpers share a name. Affects 0.8.28-0.8.33; fixed in 0.8.34.

**Action.** Pin `solc = "0.8.34"` (or later) in `foundry.toml` and bump the pragma floor to `^0.8.34`. Verify any contract that both holds a `ReentrancyGuardTransient` (or other transient state) and has explicit `delete` on a persistent state var of matching value type — the colliding helper only fires when both are present in the same compilation unit. The fix is the version bump regardless of whether the trigger appears today.

---

## Informational

### FV-2 — Same-block reveal/settle ordering depends on sequencer; no cryptographic defense
**File:** `RoundRevealLib.sol:140-142, 220-232`; `RoundVotingEngine.sol:1356-1370`.

`thresholdReachedAt = block.timestamp` is set on the reveal that pushes `revealedCount >= minVoters`. Same-block reveals after that one bypass `commitRbtsWeight` initialization (engine `:1368`'s `if (!thresholdAlreadyReached)`), so they get `revealableAfter` recorded but zero RBTS scoring weight. This is intentional (commit `abccc7c8`, documented in L-Vote-B). On World Chain (centralized sequencer), the sequencer alone decides which reveal closes threshold and which are frozen out. The trust-model carve-out for "honest sequencer" is documented and accepted.

### FV-3 — `_validateTargetRound` admits drand targets up to 2 periods past epoch end
**File:** `TlockVoteLib.sol:166-182`; `RoundCleanupLib.sol:242-258`.

`maxTargetRound = _roundAt(revealableAfter + 2 * period, ...)`. A voter who picks the maximum-allowed target round adds up to 2 drand periods (~6s mainnet) to `effectiveRevealableAfter`, which feeds `lastCommitRevealableAfter[contentId][roundId]` — the base of `_getRevealFailedFinalizationTime`. A single late voter can defer reveal-failed finalization by 2 drand periods. Negligible economically (~6s).

### FV-4 — Commit hash does NOT bind `address(engine)` or `block.chainid`
**File:** `TlockVoteLib.sol:114-140`.

The 10-input preimage to `_commitHashFromCiphertextHash` lacks chainid and engine address. This is structurally safe because the commit hash is not a signature — it is only used as a stored value compared with itself at reveal. Cross-chain replay would require duplicating the commit's `(voter, commitHash)` storage tuple on the target chain via the user's own commitVote call, which already enforces per-round validity. No exploitable replay vector. The `_rbtsScoreSeed` (RoundRevealLib:542-554) DOES bind chainid + engine address, which is the load-bearing defense for sampler entropy. No fix recommended — adding chainid/address to the hash would increase Yul stack pressure without changing the security posture.

### FV-5 — Advisory recorder constructor pins `protocolConfig` immutably to the engine's initial `protocolConfig`
**File:** `AdvisoryVoteRecorder.sol:163`.

`protocolConfig = ProtocolConfig(RoundVotingEngine(_votingEngine).protocolConfig())`. The recorder's `protocolConfig` is `immutable`. If the engine's `protocolConfig` slot is ever rotated by an upgrade or governance reset, the recorder is permanently desynchronized — it will read drand config, advisory recorder address, treasury, etc. from the OLD ProtocolConfig while the engine reads from the new one. Document the hard upgrade constraint in the deploy/upgrade runbook.

### RR-3 — Provider switch leaves the old provider's nullifier reusable without revoke flag
**File:** `contracts/RaterRegistry.sol:448-459`.

When a rater switches provider (e.g., WorldId → SeededHuman), `_attestHumanCredential` correctly clears the old provider's owner slot but does NOT mark the old nullifier as revoked. Combined with WorldID self-attestation re-checking only the owner slot (`:280-281`), a third party in possession of a valid WorldID proof for that exact nullifier (i.e., the original holder of that WorldID identity) can re-attest under the cleared slot. In practice the original holder IS the rater (WorldID proof is bound to `msg.sender` via `worldIdSignalHash`), so not exploitable for impersonation. Flagged for documentation only — the asymmetry vs. `revokeHumanCredential` is non-obvious.

### RR-4 — `seedHumanCredential` accepts unbounded `expiresAt`
**File:** `contracts/RaterRegistry.sol:300-307`, `:437`.

SEEDER can pass `expiresAt = type(uint64).max`. Only `expiresAt <= block.timestamp` is rejected. WorldID self-attest path clamps via `worldIdCredentialTtl` (immutable, set at deploy). Trust-bounded — SEEDER is governance. Recommend a `maxSeededCredentialTtl` storage parameter, governance-tunable, mirroring `worldIdCredentialTtl`.

### RR-5 — `HumanCredential.scope` is recorded but never verified anywhere downstream
**File:** `contracts/RaterRegistry.sol:39-48, 76-85, 287-294, 304-305`.

`scope` is stored on every credential and emitted in `HumanCredentialVerified`, but no consumer reads `_humanCredentials[r].scope` from any contract in the tree. Single-protocol use means cross-scope replay isn't a current risk, but if this registry is ever read by a sibling protocol (the README hints at multi-protocol reuse), nothing today binds scope to context. Either remove the field, or add `IRaterIdentityRegistry.credentialScope(rater)` and document the expected per-consumer scope check.

### RR-6 — `clearRevokedHumanNullifier` event omits the prior rater binding
**File:** `contracts/RaterRegistry.sol:89, 328-336`.

`HumanNullifierRevocationCleared(nullifierHash, provider)` has no field identifying which rater originally owned this nullifier. Combined with RR-1, this makes the dangerous primitive harder to monitor off-chain. Add an indexed `address prevOwner` parameter (resolvable by reading prior `HumanCredentialRevoked` events, but on-chain inclusion would let alerts fire on a single log).

### FE-3 — `DefaultFrontendFeeBpsUpdated` event is unreachable; `defaultFrontendFeeBps` has no setter
**File:** `QuestionRewardPoolEscrow.sol:155` (event), `:89` (storage), `:239` (init).

No corresponding setter exists. The default is locked to 300 bps (3%) forever. Either remove the event and treat the constant as immutable for clarity, or add a `CONFIG_ROLE`-gated setter (`setDefaultFrontendFeeBps`) that emits this event.

### FE-4 — `recoverRejectedSnapshotRound` does NOT restore voters' `claimDeadline` runway
**File:** `QuestionRewardPoolEscrow.sol:898-933`.

When a rejected-snapshot round is recovered, `qualifiedRounds--` but `claimDeadline` set during the (now-recovered) qualification remains. If that recovered round was the only qualified one, `claimDeadline` is now `max(block.timestamp, settledAt)` from when it was qualified, not `bountyClosesAt`. Mostly cosmetic. Worth a comment: "recovery leaves claimDeadline at last-qualified-round timestamp, which only matters if the pool subsequently completes."

### FE-5 — Bundle path's `eligibleCompleters` cast uses raw `uint32(completerCount)` instead of `toUint32()`
**File:** `libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:853`.

`completerCount` is bounded by `commitCount` (`uint16` from voting engine), so this cannot overflow today. The raw cast bypasses the safe-cast policy used elsewhere. Cheap consistency fix: use `completerCount.toUint32()`.

### FE-6 — `_recordBundleQuestionTerminal` returns silently on bundle-ID/cursor mismatch with no event
**File:** `libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:611-646`.

Multiple early `return` paths (`:622, 626, 632, 633, 634, 637, 641`) with no logging. When called from the engine's try/catch during settlement, indexers receive no signal that the round was rejected for bundle accounting. Defense-in-depth: emit a `QuestionBundleTerminalSkipped(bundleId, contentId, roundId, reasonCode)` event on each early return so off-chain monitors can detect stuck bundle progression.

### LP-I1 — Tier transition uses pre-transition rate for the entire crossing reservation
**File:** `ParticipationPool.sol:185-195` (read once at `RoundSettlementSideEffectsLib.sol:66`).

A round whose `reserveReward` amount straddles a tier boundary reserves the entire amount at the OLD rate; the transition only applies to the NEXT round's snapshot. Single-round reservation magnitude bounded by `maxStake * maxVoters * rateBps / 10000 ≤ 9 K LREP`. Tier-0 budget is 1.5M LREP, so a single round can cross at most ~0.6% of a tier. No economic differential extraction available to any voter. Documented for awareness.

### LP-I2 — Earned-rater cap boundary uses pre-increment read; first-come gets higher cap
**File:** `LaunchDistributionPool.sol:625-630`.

The 100,000th unique rater (read-side `eligibleRaterCount == 99_999`) receives cap = 10 LREP. The 100,001st drops to 5 LREP. `raterLaunchCapAssigned` ensures one-shot assignment per address; no front-run of one's own cap. Budget arithmetic (100K × 10 LREP = 1M LREP from earned-rater pool) is consistent. Documented as intentional.

### LP-I3 — `_isDuplicatePendingAnchor` is O(n²) on storage reads, bounded only by `maxVoters`
**File:** `LaunchDistributionPool.sol:1081-1091, 711-718`.

At 1000 anchors per pending entry (governance cap `maxVoterCap`): ~500K SLOADs ≈ 10M gas — within block limit but expensive. Use a transient-storage bitmap or sorted-input requirement to deduplicate in O(n log n) or O(n). Not security-critical given the maxVoters governance cap.

---

## Items checked and confirmed sound (this pass)

**RoundVotingEngine + Tlock**: commit-reveal replay impossible across content/round/voter; drand chain hash snapshot is per-round and pinned at first commit; reveal-time MEV gives no upside to selective non-reveal (forfeits ≥1 LREP); sampler seed frozen at threshold (M-Vote-2); ±12s sequencer drift insufficient to flip any settlement (smallest timer is 20 min); LREP RBAC-controlled with no transfer hooks → no cross-function reentry via approvals; struct truncations all bounded under governance caps; preview/cachedRoundContext drift produces clean revert never silent corruption; epoch weighting math is clean integer division with no exploitable residue; reveal failure refund routes 100% of stake to forfeitedToTreasury with no dust.

**QuestionRewardPoolEscrow**: `rewardClaimed` and `bundleRoundSetRewardClaimed` storage-disjoint; `firstClaimPaid` flip atomic in CEI with claim state; reward asset resolved from pool storage only (not caller input); reservation `_reservationKey(revealCommitment, submitter)` scopes by submitter; `recoverNonAssetToken` blocks LREP/USDC explicitly; `repointRewardPoolClusterPayoutOracle` gated on zero qualified rounds and zero claimed; FrontendFeeDustLib socializes residue to protocol via `_routeRewardToProtocol`; bundle claim operates on one bundle per call (no multi-pool batch); all claim entrypoints `nonReentrant`; `frontendFeeBps` locked to 300; bundle creation gated to registry caller; pull-token allowance never drained beyond consenting funder.

**ClusterPayoutOracle** (own review, after agent failures): M-Oracle-1 source-ready gate is in place at `:346-355`; M-Oracle-2 finalization-veto window (7 days) correctly two-tiers consumed-vs-unconsumed rejection at `:496-564`; `proposal.consumer` captured at propose time, so mid-flight consumer rotation (`setRoundPayoutSnapshotConsumer`) cannot strand pending proposals (only the captured consumer can `verifyPayoutWeight`); merkle leaf encoding binds chainid + oracle address + 12 fields, no malleability; bond clawback uses pull pattern (`pendingBondWithdrawals[proposer]`) with `ProposerBondUnrecoverable` event on shortfall; `_validateRoundPayoutInput` enforces `effectiveParticipantUnits ≤ rawEligibleVoters * BPS_DENOMINATOR` and empty-payout consistency; consumer cross-checks `snapshot.totalClaimWeight == expectedTotalClaimWeight` against the engine-computed value at `ClaimLib:582`, blocking proposer-side total-claim-weight tampering; `rejectedRoundPayoutSnapshotConsumed` only set when consumer call SUCCEEDED and returned true (catch path leaves slot reusable). Note: `proposerBond` is uniformly 0 today; protocol relies on frontend eligibility + arbiter veto + public artifacts for proposer-side discipline — already documented as the trust model.

**RaterRegistry / ProfileRegistry**: delegation chain blocking (commit `0ff2f786`) verified at `setDelegate:186-190` and `acceptDelegate`; revocation tx-order strict; re-attestation full struct replacement; `resolveRater` address-fallback `identityKey != 0` post-revoke is by design (no consumer treats `== 0` as "no identity"); provider-namespaced nullifier (L-Identity-1, commits `f714d525` + `27f9ffc4`) verified end-to-end; profile claim multiplicity 1:1 via `_migrateProfileForIdentityKey`.

**LaunchDistributionPool / ParticipationPool**: tier boundary `>=` semantics match `test_GetCurrentRateBps_ExactBoundary_*`; M-Funds-2 cap fix (`!raterVerified` unconditional increment) covers all paths; M-Funds-3 deletes pending storage on finalize; `rescueStalePendingEarnedRaterCredit` repoints oracle + supports `newReadyAt` reset for L-Oracle-C edge case; rate snapshot per round prevents intra-round sandwich; identity rotation between commit and claim correctly redirects rewards to current SBT holder via `rewardRecipient`; `withdrawRemaining` / `recoverSurplus` cannot touch `reservedBalance`; integer divisions all have validated non-zero denominators; conservation invariant `totalDistributed + poolBalance + (deposited - withdrawn) = initial` holds across the reserved-reward extension.

---

## Cross-cutting 2026 attack-pattern survey (new since May 19)

| # | Pattern | Applies to RateLoop? | Notes |
|---|---------|----------------------|-------|
| 1 | Solidity 0.8.28-0.8.33 via_ir TSTORE/SSTORE helper-collision | **Yes** | See TC-1. |
| 2 | UMA-MOOV2-style optimistic-oracle dispute griefing | Partial | M-Oracle-1 source-ready gate + frontend eligibility + arbiter veto + ProposerBondUnrecoverable event already define the response model. Bond ratios (5 USDC challenge, 0 proposer) intentional under documented trust-model. |
| 3 | UMIP-189 consumer-pinned oracle capture | No | Consumer pin is set once on EscrowEnv; `setClusterPayoutOracle` requires consumer un-pin first (post-M-Oracle-1). |
| 4 | EIP-7702 delegated-EOA voter griefing | No | No `tx.origin` or `extcodesize` based checks anywhere in `contracts/`. Confirmed by grep. |
| 5 | TSTORE low-gas reentrancy | Sound | All transient guards use OZ `ReentrancyGuardTransient` which is the audited implementation; no custom transient slot reuse. |
| 6 | Blockhash on OP-stack sequencer | Documented | `RoundRevealLib.finalizeRbtsSeed` uses the future-block commit-then-reveal pattern; ±12s drift << smallest timer (20 min). Already acknowledged in `audit-report-claude-2026-05-19.md` items-checked. |
| 7 | L2 sequencer-down blockhash returns 0 | Sound | `bh == bytes32(0)` reverts with `RevealGraceActive`, forcing retry. |
| 8 | Cross-chain L1→L2 message replay | N/A | No cross-domain messengers in scope. All signed digests via solidity-only flows. |
| 9 | OWASP SC10:2026 Proxy & Upgradeability | Verified | All upgradeable impls call `_disableInitializers()` in constructor; `__gap` arrays present on parent contracts; storage-layout CI gate enforces no drift. |
| 10 | UUPS-on-Transparent admin escalation | N/A | Only `TransparentUpgradeableProxy` is used (verified by grep — no UUPSUpgradeable in contracts). |
| 11 | Initializer front-run on fresh L2 deploy | Verified | Deploy scripts encode init data in `ERC1967Proxy` constructor; no two-step impl+init pattern. |
| 12 | Circle USDC blocklist DoS in pull-payment escrows | Sound | All USDC transfers in claim paths use per-recipient pull pattern with frontend-fee redirect-on-revert (TransferLib:38-48). No push-in-loop. |
| 13 | Cross-decimal rounding (USDC 6dp vs LREP 18dp) | Sound | All `mulDiv` calls use `Math.Rounding.Floor` on user-credit (per FrontendFeeDustLib + ClaimLib audited paths). |
| 14 | Native USDC upgrade pin | Verified | Repo references USDC via the proxy address only; no hardcoded implementation. |
| 15 | Drand chain-hash impersonation | Sound | `drandChainHash` is governance-set in `ProtocolConfig`, snapshotted per-round at first commit, and verified at reveal against the in-ciphertext metadata via `_extractTlockMetadata`. |
| 16 | Late-reveal griefing on tlock voting | Sound | `markRoundRevealFailed` + `processUnrevealedVotes` route all unrevealed stake to forfeit and run cleanup-incentive payout; partial reveals are scored via `RoundRevealLib`'s `_scoreRbtsRevealedSet` (frozen sampler set per L-Vote-B). |

---

## Recommended remediation order

1. **RR-1** — one-line fix at `revokeHumanCredential` deleting the canonical key. Add regression test for revoke→clearRevoked→reseed sequence.
2. **TC-1** — pin `solc = "0.8.34"` in `foundry.toml` and bump pragma floor. Re-run storage-layout CI gate.
3. **FE-1** — add `reopenRecoveredSnapshotRound` admin entry (or rework `nextRoundToEvaluate` cursor for recovered rounds).
4. **FV-1** — make `_getRoundReferenceRatingBps` trust the snapshot unconditionally; reject round opens with rating=0.
5. **LP-1** — persist `roundParticipationRewardPool` even on zero reservation, or emit `RoundParticipationRewardForfeited`.
6. **FE-2** — pin `claimDeadline` semantics in `_qualifyRound` or document the expectation.
7. **RR-2 / RR-3 / RR-4 / RR-5 / RR-6** — bundle as identity-system polish; each is small.
8. **FE-3 / FE-5 / FE-6 / FV-5 / LP-I3** — code hygiene; defer to next housekeeping PR.

## Suggested test additions

- `test/RaterRegistry.t.sol` — `test_RevokeThenClearThenReseedDifferentRater_DoesNotCollideCanonical` (regression for RR-1).
- `test/QuestionRewardPoolEscrow.t.sol` — `test_RecoverRejectedSnapshotRound_BlocksHonestRequalification` (regression for FE-1).
- `test/RoundVotingEngine.t.sol` — `test_ZeroRatingSnapshot_LiveFallback_RevealMatchesSnapshot` (regression for FV-1).
- `test/RoundRewardDistributor.t.sol` — `test_ParticipationPoolEmptyAtSettlement_RewardsRecoverable` (regression for LP-1).

---

## File path reference

- RR-1, RR-2: `contracts/RaterRegistry.sol:309-326, 348-361, 461-473`; `contracts/ProfileRegistry.sol:288-319`.
- FV-1: `contracts/RoundVotingEngine.sol:1148-1154`; `contracts/ContentRegistry.sol:1198-1202`; `contracts/libraries/RoundCreationLib.sol:39`.
- FE-1, FE-4: `contracts/QuestionRewardPoolEscrow.sol:898-933`.
- FE-2: `contracts/libraries/QuestionRewardPoolEscrowPoolActionsLib.sol:290-307`; `contracts/libraries/QuestionRewardPoolEscrowQualificationLib.sol:197-200`.
- LP-1: `contracts/RoundRewardDistributor.sol:1075-1092, 659-676`; `contracts/ParticipationPool.sol:214-234`.
- TC-1: `packages/foundry/foundry.toml`; `contracts/*.sol` pragma.
- Other findings: see per-section anchors above.

---

**Method note.** Read-only audit. Six parallel agents (1 web research, 5 contract-scope adversarial reviews) plus direct review of `ClusterPayoutOracle` after API-overload retries. All findings cross-referenced against the five prior audit reports to dedupe. No source modifications made on this branch. Branch ready for review at `claude-audit-4`.

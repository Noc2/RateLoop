# RateLoop Smart Contract Security Audit — 2026-05-18 (Claude independent pass)

**Scope.** ~11.2k LOC of Solidity across `packages/foundry/contracts/` (17 top-level contracts + libraries). Full re-walk of funds-flow, voting / game theory, identity / governance, and oracle / integrations layers on branch `main` (HEAD `6d26e14`). All May 17 remediation commits (`fd78723`, `6e45943`, `0c85d0a`, `adff4f1`, `28105c7`) are present and were re-verified in place.

**Method.** Five parallel agents — one per security domain plus an independent 2026 exploit-pattern research pass — read the contracts directly and were instructed to FIND issues the May 17 report missed or to FALSIFY its "checked and confirmed sound" list, not to rehash prior findings. Agents were told the optimistic trust model of `ClusterPayoutOracle` is intentional (per `AGENTS.md`) and not to re-flag it.

**Baselines.**
- `packages/foundry/audit-report-2026-05-04.md` (0 H/C/M/L)
- `packages/foundry/audit-report-2026-05-16.md` (0 H/C, 8 M, 12 L, 16 I — all addressed in `security-fixes-from-audit-2026-05-16`)
- `packages/foundry/audit-report-2026-05-17.md` (0 H/C, 2 M, 9 L, 14 I — Mediums and Lows addressed in `security-fixes-from-audit-2026-05-17`)

This pass excludes findings already covered there unless the fix is incomplete or has a clear sibling case.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| **Medium** | **3** |
| Low | 11 |
| Informational | 12 |
| Research patterns flagged | 5 |

The three Mediums are **regression-twins of prior Mediums** — the May 17 fixes landed in their primary call sites but a structurally-identical sibling was missed:

1. **M-Vote-5** — `AdvisoryVoteRecorder._findRevealedCommitKey` is the un-fixed twin of M-Vote-4. The forward-scan sampler in the main engine was rewritten to index a pre-built revealed-only array (`0c85d0a`); the same pattern in the advisory recorder still walks the *committed* set with skip-unrevealed, reproducing the M-Vote-4 sybil-cluster sampler bias against advisory launch-credit payouts.
2. **M-Funds-2** — `LaunchDistributionPool.recordEarnedRaterReward` bypasses the `maxUnverifiedCreditsPerRound` cap *at record time* when a cluster oracle is configured. The cap is re-enforced at finalize, but storage growth from unfinalizable pending entries is unbounded.
3. **M-Funds-3** — `pendingEarnedRaterCredits` is never cleared on finalize, and `LaunchDistributionPool.setClusterPayoutOracle` does not rewrite outstanding entries (carried forward as I-Oracle-3 in the May 17 report). After a governance-mandated oracle rotation, partially-recorded credits become permanently un-finalizable while their `raterRoundCreditRecorded` flag blocks re-record.

None of the Mediums is exploitable today (no mainnet). All are correctness/economic gaps in the path between the May 17 fix set and the mainnet target.

The Lows cluster around four themes: (a) **rotation-gap parity** between the engine, escrow, and frontend-registry — the May 17 fix for `setVotingEngine` first-set was not mirrored on `setQuestionRewardPoolEscrow`, and engine rotation strands fee crediting between the `ADMIN_ROLE`-gated set and the `GOVERNANCE_ROLE`-gated re-creditor; (b) **BTS edge cases** at `predictedUpBps ∈ {0, 10000}` and the threshold-flip race that lets keepers exclude specific honest voters from scoring; (c) **bookkeeping omissions** — `rejectCorrelationEpoch` does not record the rejected `clusterRoot`, allowing identical re-proposal; (d) **dead code in the IOU layer** — `processUnrevealedVotes`'s `deferredCleanupBounty` return is never assigned, leaving `claimDeferredCleanupBounty` permanently inert.

---

## Medium findings

### M-Vote-5 — `AdvisoryVoteRecorder._findRevealedCommitKey` forward-scan biases advisory BTS sampling (twin of M-Vote-4)

**File:** `AdvisoryVoteRecorder.sol:638-655`. Mirror site fixed in `0c85d0a` at `libraries/RoundRevealLib.sol:341-372`.

The May 17 M-Vote-4 remediation replaced the forward-scan sampler in `_scoreRbtsCommitAt` with a direct-indexed sample over a pre-built `revealedKeysMem` array. The advisory recorder's claim path was not updated. `_findRevealedCommitKey` still does:

```solidity
uint256 startIndex = uint256(seed) % voteCount;
for (uint256 offset = 0; offset < voteCount; offset++) {
    uint256 index = (startIndex + offset) % voteCount;
    bytes32 candidate = votingEngine.getRoundCommitKey(contentId, roundId, index);
    if (candidate == excludedKey) continue;
    (, uint64 stakeAmount,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, candidate);
    if (revealed && stakeAmount > 0) return candidate;
}
```

`voteCount` is the engine's total committed count, not the revealed subset. The seed-modulo selects a start index uniformly over committed positions, but the forward scan hands all sampler probability mass for any contiguous unrevealed run to the **first revealed commit after that run** — the exact M-Vote-4 sybil-cluster pattern.

**Attack.** 9 commits. Attacker controls 3 min-stake non-HRC voter commits at indices 0,1,2 plus one adversarial commit at index 3 (a real HRC voter they coordinate or a non-HRC commit before L-Vote-4 lockout). Honest advisory voter A claims credit; A's deterministic seed lands on {0,1,2,3} ≈ 44% of the time, all of which forward-scan into index 3. `P(reference = 3) = 4/9` vs. uniform `1/9`. Cost: 3 LREP forfeited on non-reveals + ordinary stake on the index-3 commit. Impact: `AdvisoryVoteRecorder.claimAdvisoryLaunchCredit` `scoreBps` reduction → `LaunchDistributionPool.recordAdvisoryRaterReward` payout reduction.

**Fix.** Mirror the M-Vote-4 fix — build the revealed-commit array once (filter on `revealed && stakeAmount > 0`), require `revealedCount >= 3`, then index directly via `seed % revealedCount` with the two-exclusion shift pattern from `_rbtsPeerIndex`. Cleaner alternative: expose a view on the engine returning the `revealedKeys` snapshot frozen at `thresholdReachedAt` and have the advisory recorder consume that view.

Add a sampler-distribution fuzz test paralleling the recommendation for M-Vote-4.

### M-Funds-2 — `LaunchDistributionPool.recordEarnedRaterReward` bypasses `maxUnverifiedCreditsPerRound` cap when cluster oracle is configured

**File:** `LaunchDistributionPool.sol:341-352` (parallel block in `recordAdvisoryRaterReward` at `:386-397`).

The cap-check at `:341-346` reads `roundUnverifiedLaunchCreditCount[contentId][roundId]`, but the counter is **only incremented** at `:350-352` when `!raterVerified && !clusterProofRequired`. When a cluster oracle is configured (the live mainnet shape), `clusterProofRequired = true`, the counter is never incremented at record time, and every unverified rater passes the `>=` check against a stale 0. The cap is re-enforced at `finalizeEarnedRaterRewardCredit` (`:434-439`), so only `maxUnverifiedCreditsPerRound` (default 3) unverified raters can finalize — but `pendingEarnedRaterCredits` storage growth from unfinalizable entries is unbounded.

**Attack.** Per-round storage growth bounded by `maxVoters` (200), but across many rounds this is an open denial-of-storage-pressure path. Fairness gap: at finalize time, the first N to call win the cap slots while the (N+1)-th legitimate finalizer's tx reverts on race ordering.

**Fix.** Increment `roundUnverifiedLaunchCreditCount` at record time regardless of `clusterProofRequired`:

```solidity
if (!raterVerified) {
    roundUnverifiedLaunchCreditCount[contentId][roundId] += 1;
}
```

Remove the re-check at finalize. Regression test: 4 unverified raters with cluster oracle configured — the 4th call must return 0 with no pending entry written.

### M-Funds-3 — `pendingEarnedRaterCredits` storage never reclaimed; stuck oracle pin survives governance rotation

**File:** `LaunchDistributionPool.sol:440-455`. Related I-Oracle-3 (May 17): `setClusterPayoutOracle` does not rewrite pending entries.

`finalizeEarnedRaterRewardCredit` sets `earnedRewardCreditFinalized[contentId][roundId][commitKey] = true` (`:440`) but never clears `pendingEarnedRaterCredits[contentId][roundId][commitKey]`. The `pending.oracle` address is captured at record time.

**Impact.**
1. Storage griefing — sibling to M-Funds-2. Each unfinalized credit is a permanent storage slot.
2. **Operational forfeit.** After a governance-mandated oracle rotation, every unfinalized credit is permanently un-finalizable: the new oracle won't accept proofs against the old root, the old oracle pin is fixed in `pending.oracle`, and the rater's `raterRoundCreditRecorded` flag blocks re-record. Qualifying credits silently dropped.
3. The `earnedRaterRoundPayoutSnapshotConsumed[contentId][roundId] = true` write at `:445` flips on the *first* finalize per round, mirroring the M-Oracle-2-Followup "first paid wei" semantics — which is correct for the launch-pool consumer, but tight against the 7-day arbiter veto window if many commits remain unfinalized when round-level consumption is asserted.

**Fix.**
- `delete pendingEarnedRaterCredits[contentId][roundId][commitKey];` at the end of `finalizeEarnedRaterRewardCredit`.
- Governance-only rescue function to drop stale pending entries and reset `raterRoundCreditRecorded` so the rater can re-record after oracle rotation.

---

## Low findings

### Voting / game theory

- **L-Vote-8** — `RobustBtsMath.shadowPredictionBps` collapses to peer-signal-only when `referencePredictionBps ∈ {0, 10000}`. `delta = min(ref, 10000-ref) = 0`, so `shadow == referencePredictionBps` regardless of voter's own signal; information score becomes `quadraticScoreBps(0, peerIsUp)`. Single attacker with two commits (one predicting 0%, one voting opposite-of-majority) can wipe the information half of honest voters whose sampler draws them. **Fix:** clamp `predictedUpBps` to `[100, 9900]` inside `requireValidPrediction`. `libraries/RobustBtsMath.sol:15-21, 33-42`.

- **L-Vote-9** — `round.thresholdReachedAt` snapshot-set excludes any reveal landing post-threshold. A keeper observing pending honest reveals can submit a competing reveal in the same/earlier block, flipping the threshold so the target's reveal lands in `_accountPostThresholdReveal` — stake handled but **no `commitRbtsRewardWeight` write**, no share of `roundVoterPool`. Selective exclusion of latency-disadvantaged honest voters at gas cost only. **Fix:** extend the scoring set to include reveals within the reveal grace window after threshold (sampler seed binds the same committed-set hash), or document the exclusion explicitly. `RoundVotingEngine.sol:1287-1322`; `libraries/RoundRevealLib.sol:134-136, 192-219`.

- **L-Vote-10** — `processUnrevealedVotes` declares a `deferredCleanupBounty` named return but never assigns it. `processUnrevealedVotesForEngine` writes `roundDeferredCleanupBounty[cleanupCaller] += deferredCleanupBounty` — always 0. `claimDeferredCleanupBounty` is permanently inert; the entire IOU layer (storage, events, claim function) is dead code in an upgradeable contract. The May 17 L-Vote-2 entry attributed an IOU mechanism for refund-only batches to `5a79b05`; current refund-only branch contributes nothing to `forfeitedToTreasury + addedToConsensusReserve`, so `_cleanupIncentive` returns 0. **Fix options:** (a) re-arm the L-Vote-2 IOU math (0.25% sliver on refunded LREP, capped against 5-LREP envelope); (b) delete the dead surface to reclaim layout slots. `libraries/RoundCleanupLib.sol:505-608`; `RoundVotingEngine.sol:291-305, 1491-1493`.

### Funds flow

- **L-Funds-5** — `LaunchDistributionPool._recordEarnedRaterReward` consumes a slot even when the pool is depleted. If `paidAmount > 0` but `< remaining`, `rewardedRatingCount[rater] = targetRewardedCount` advances even when only a fraction of the cap was paid; subsequent calls hit the `targetRewardedCount <= rewardedCount` guard and return 0. Remaining cap permanently locked if the pool was depleted at the moment of the partial pay. **Fix:** advance `rewardedRatingCount` only to the slot count corresponding to `raterLaunchPaid + paidAmount`. `LaunchDistributionPool.sol:499-519`.

- **L-Funds-6** — `RoundSettlementDistributionLib.distribute` writes `roundWinningStake[contentId][roundId]` twice — once inside the `losingPool > 0` branch (`:52`), once unconditionally at function end (`:88`). Dead inner write; harmless today, but masks future intent if the branches diverge. **Fix:** remove the inner write.

- **L-Funds-7** — `FeedbackBonusEscrow.awardFeedbackBonus` redirect path inlines the absorb-fee logic with a different invariant than `_settleClaimPayout` in `QuestionRewardPoolEscrow`. Today both branches conserve LREP correctly, but the divergent shape is fragile. **Fix:** lift to a shared helper or document the asymmetry. `FeedbackBonusEscrow.sol:212-217`.

### Identity / Governance

- **L-Identity-7** — `setQuestionRewardPoolEscrow` first-set in `Deploy.s.sol` runs **unpaused**. The May 17 L-Identity-5 fix bracketed the first `setVotingEngine` call with `pause/unpause` at `script/Deploy.s.sol:218-220`. The sibling `setQuestionRewardPoolEscrow` at `:223` was missed. Same window during which deployer holds `CONFIG_ROLE`; deployer-key compromise between the first `unpause` and `:223` lets a malicious escrow address front-run. **Fix:** bracket the second first-set with the same pattern, or fold both writes into one paused region. `ContentRegistry.sol:378-385`; `script/Deploy.s.sol:218-223`.

- **L-Identity-8** — `LoopReputation.delegateBySig` shares nonce space with `permit`. Inherited from OZ `ERC20Permit` + `ERC20Votes`, both consume from the same `Nonces` storage. The `_delegate` override forces self-delegation, so `delegateBySig` is functionally useless to users — but a captured `delegateBySig` signature burns the signer's next permit nonce. **Same grief class as L-Vote-7** (May 17), through the delegate-signature side door. Wallet UIs that auto-prompt `delegateBySig` after credential mint generate the attack signature for free. **Fix:** disable the function — the self-delegation override makes it useless for users:
  ```solidity
  function delegateBySig(address, uint256, uint256, uint8, bytes32, bytes32) public pure override {
      revert("delegateBySig disabled");
  }
  ```
  `LoopReputation.sol:108-127`.

- **L-Identity-9** — `RaterRegistry._attestHumanCredential` clears inbound delegation but not outbound. If holder A has `delegateTo[A] = B` (active) and refreshes their credential, no event fires — `delegateOf[A]` was already zero so the inbound clear is a no-op, and the outbound `delegateTo[A]` survives silently. Asymmetric vs. the case where the delegate B refreshes (cleanly dissolves the pair). Event-observability drift for off-chain wallets. **Fix:** emit a synthetic `DelegateUnchanged` log or document the asymmetry. `RaterRegistry.sol:218-253, 417-428`.

### Oracle / Integrations

- **L-Oracle-4** — `ClusterPayoutOracle.rejectCorrelationEpoch` does not blacklist the rejected `clusterRoot`. Round-payout rejection records the bad root in `rejectedRoundPayoutSnapshotRoots[snapshotKey][weightRoot]` and the re-propose gate (`:309`) reverts on exact re-submission. The correlation-epoch path has no equivalent — after `Rejected` status is set (`:288-298`), re-propose with the **same** `(clusterRoot, parameterHash, artifactHash)` is allowed (`:215-218` is purely status-based). A bad-faith proposer can re-submit the same poisoned root indefinitely, burning arbiter time per rejection at gas cost only, and risking a missed re-rejection within the 12 h challenge window. **Fix:** add `mapping(uint64 => mapping(bytes32 => bool)) rejectedCorrelationEpochRoots`, populate inside `rejectCorrelationEpoch`, gate inside `proposeCorrelationEpoch`. Mirror the round-payout pattern exactly. `ClusterPayoutOracle.sol:215-218, 288-298, 309`.

- **L-Frontend-1** — `FrontendRegistry.setVotingEngine` is `ADMIN_ROLE`-gated and unconditionally zeroes `feeCreditor`; replacement requires `addFeeCreditor`, which is `GOVERNANCE_ROLE`-gated. The two role boundaries prevent a single timelock proposal from bundling both calls atomically unless both roles share an address. Between the two transactions, `creditFees` reverts on `feeCreditor == address(0)`; `RoundRewardDistributor._creditFrontendFee` gracefully catches and routes the fee to protocol treasury — so settlement does not revert, but **every frontend fee accrued during the rotation gap is silently re-routed to protocol**. **Fix:** document the atomic batch runbook (mirrors L-Identity-6 governor rotation), align role admins, or pause-around-rotation. `FrontendRegistry.sol:343-354, 358-369, 384-392`.

---

## Informational

### Voting

- **I-Vote-5** — `commitVoteWithPermit` allowance check uses raw `stakeAmount` without epsilon. Documentation only; no upstream pre-deducts today. `libraries/VotePreflightLib.sol:99-117`.
- **I-Vote-6** — `_rbtsDrawKey` dual domain (identity-keccak vs. address-keccak prefix) is structurally safe by 2nd-preimage hardness, but the duality is easy to miss when adding new drawKey consumers. Document. `libraries/RoundRevealLib.sol:480-488`.
- **I-Vote-7** — `roundCleanupIncentivePaid` write at `RoundCleanupLib.sol:586` includes the `deferredCleanupBounty` term that is permanently 0 under L-Vote-10. If L-Vote-10 is re-armed without revisiting this branch the cap accounting will silently drift.

### Funds flow

- **I-Funds-3** — `QuestionRewardPoolEscrowBundleActionsLib.sol:379-390` bundle redirect path discards `bundleRedirectedFrontendFee` with a bare statement, mirrors May 17 L-Funds-4. Add a unit test asserting the absorption path; the silent discard becomes a bug if/when a weighted bundle path lands.

### Identity / Governance

- **I-Identity-6** — `ContentRegistry.markDormant` and `releaseDormantSubmissionKey` lack the `contentBundleId == 0` guard that `cancelContent` has. A bundle member's submission key can be released and reused as a standalone content post-dormancy, fragmenting the bundle's narrative integrity. **Fix:** `require(contentBundleId[contentId] == 0, "Bundled content")` on both. `ContentRegistry.sol:982-997, 1028-1042, 692`.
- **I-Identity-7** — `revokeRewardDistributor` zeros `rewardDistributorAuthorized[value]` but does NOT clear `rewardDistributorVotingEngine[value]` or `rewardDistributorForVotingEngine[engine]`. After revocation, a fresh distributor for the same engine cannot be registered without redeploying the engine. Intentional per the comment at `:191-193`, but the constraint is hidden. **Fix:** document explicitly or expose a guarded `forceClearEnginePin(engine)`. `ProtocolConfig.sol:189-195, 362-377`.
- **I-Identity-8** — `RaterRegistry.setDelegate` permits a pending outbound request to coexist with an active outbound delegation. Handled correctly on-chain at `acceptDelegate`, but off-chain UIs reading `getPendingDelegate(A)` separately from `getDelegate(A)` will show two delegates for one holder. Document or block `setDelegate` while `delegateTo[msg.sender] != address(0)`. `RaterRegistry.sol:172-189`.
- **I-Identity-9** — Adding a new `CategoryRegistry` category requires a full Governor cycle (~9 days). UX gap; consider a `CATEGORY_CURATOR_ROLE` admined by governance for faster taxonomy growth. `CategoryRegistry.sol:42-73`.

### Oracle / Integrations

- **I-Oracle-5** — `recoverRejectedSnapshotRound` (the L-Oracle-1 fix at `QuestionRewardPoolEscrow.sol:857-892`) intentionally does not roll back `nextRoundToEvaluate`. Each successfully-poisoned round burns one qualification slot. The defense is the 1000 LREP stake + reputation loss on the proposer; flagged so operations escalates on consecutive rejections within a single pool.
- **I-Frontend-2** — `completeDeregister` refunds `lrepFees` even though `canReceiveHistoricalFees` returns false during the 14-day unbonding window. Intentional (the slashable cooldown is the review period; misbehavior triggers `slashFrontend` and confiscates accrued fees), but the asymmetry is worth in-line documenting. `FrontendRegistry.sol:207-232, 235-251, 310-322`.
- **I-X402-1** — `X402QuestionSubmitter._hashStringArray` uses `abi.encodePacked` over a `bytes32[]`. Safe today (homogeneous fixed-32-byte elements; no concatenation ambiguity), but the established anti-pattern is risky for future heterogeneous edits. **Recommendation:** switch to `keccak256(abi.encode(valueHashes))` for the outer hash — defensive against future maintainers and consistent with the rest of `computeX402QuestionPaymentNonce`. `X402QuestionSubmitter.sol:220-229`.

---

## Cross-cutting research findings (2026 Q1-Q2 attack patterns)

Independent survey of Q1-Q2 2026 incidents (Wasabi UUPS admin-key, Drift permissionless-signer, Moonwell governance, OpenZeppelin Governor cancel-DoS, KelpDAO bridge, Hyperbridge MMR), OWASP SC Top 10 2026 (SC10 Proxy/Upgrade promoted), Polymarket UMA-whale disputes (Mar 2025 Ukraine, Dec 2025 UFO), and academic work on Merkle-airdrop second-preimage.

Patterns from the May 17 cross-cutting table are still current; status unchanged. The five new patterns below are NOT in the May 17 table and have concrete applicability:

| # | Pattern | Applicability | Manifestation |
|---|---|---|---|
| **N-1** | Wasabi-style sole-EOA admin → UUPS-upgrade drain (Apr 30 2026, $4.55M; no timelock/multisig on `ADMIN_ROLE`) | Audit confirms `DEFAULT_ADMIN_ROLE` is renounced post-deploy and `UPGRADER_ROLE` flows through timelock, but no automated post-deploy invariant test asserts this across all 8 upgradeable contracts. L-Identity-5 already shows the deploy script has unpaused windows. **Recommend:** post-deploy assertion that on every UUPS contract, `getRoleMemberCount(DEFAULT_ADMIN_ROLE) == 1 && getRoleMember(DEFAULT_ADMIN_ROLE, 0) == timelock` and likewise for `UPGRADER_ROLE`. | All `*.sol` upgradeable contracts + `Deploy.s.sol`. |
| **N-2** | OpenZeppelin Governor cancel-front-run via `proposalId` collision (Coinspect → OZ 4.9.1, opt-in mitigation: `#proposer=<addr>` description suffix or `_validateDescriptionForProposer` override). | `CuryoGovernor.propose` calls `super.propose(...)` with no override and no enforced suffix. A griefer can front-run an honest proposer's submission, compute the same `hashProposal(...)`, submit first, then `cancel` — denying the proposer their slot AND triggering the 1-day `PROPOSAL_COOLDOWN_BLOCKS` against them plus a 7-day `lockForGovernance` against the proposal they didn't create. **Fix:** override `_validateDescriptionForProposer` (OZ 5.x) or document a frontend-enforced suffix. | `governance/CuryoGovernor.sol:264-285`. |
| **N-3** | Moonwell-style lock re-anchor (vote-time lock duration set unconditionally, never `max(old, new)`). | `LoopReputation.lockForGovernance` sets `lock.unlockTime = block.timestamp + 7 days` on every call. `CuryoGovernor._castVote` calls it on every cast vote. An honest voter who participates in adjacent proposals at any cadence `< 7d` is effectively permanently semi-locked. Not a theft vector — UX/economic grief surface a hostile proposer pipeline can weaponize against active voters. **Fix:** ~3 lines, `lock.unlockTime = max(lock.unlockTime, newUnlockTime)` and gate amount update on `amount > lock.amount`. | `LoopReputation.sol:62-83`. |
| **N-4** | EIP-712 hard-fork chain split: cached `chainid` vs. live (recurring Sherlock/Cantina finding for permit / 3009 / typed-data systems). | `RoundRevealLib.sol:475`, `X402QuestionSubmitter.sol:162`, `RaterRegistry.sol:281` all bind `block.chainid` **live** — good. `LoopReputation` inherits OZ `ERC20Permit`, whose domain separator is cached at deploy unless `block.chainid` changes (OZ ≥4.4 rebuilds live). World Chain is an OP-Stack L2; verify OZ version in `package.json` is ≥4.4 for live chainid rebuild. **Recommend:** extend L-Oracle-3 defense-in-depth nonce binding to `Governor.castVoteBySig` and confirm the OZ contracts version. | `LoopReputation.sol:34`. |
| **N-5** | `selfdestruct` ETH force-feed despite `receive() revert` (legal pre-Cancun; EIP-6780 only restricts contracts deployed in the same tx). | `ClusterPayoutOracle.sol:173-175` is `receive() external payable { revert InvalidBond(); }`. Today no logic reads `address(this).balance`, so the force-fed ETH is dead weight. Defense-in-depth; the `receive() revert` signals an intent that is false in practice. **Fix:** either remove the `receive()` (calls to non-existent function already revert) or add a governance sweep-to-treasury path. | `ClusterPayoutOracle.sol:173-175`. |

Patterns reviewed and dismissed: Drift permissionless-signer (no permissionless signer authority in RateLoop, `pullExactToken` enforces exact-balance), KelpDAO LayerZero bridge (no bridge surface), Hyperbridge MMR (per-leaf merkle verification only), ERC777/1363 reentrancy (USDC and LREP have no transfer hooks; LREP confirmed in May 17), flash-loan voting (ERC20Votes checkpoints + 7-day governance lock + `_delegate` self-only override closes this), signature malleability (no raw `ecrecover`; OZ ECDSA / typed-data throughout).

---

## Items checked and confirmed sound

A non-exhaustive list of areas re-verified on this pass. Findings already covered in the May 17 audit that remain intact:

**Funds flow**
- `pullExactToken` balance-delta enforcement on rebasing / fee-on-transfer tokens.
- `recoverNonAssetToken` excludes LREP and USDC on both escrows.
- CEI ordering in `_claimQuestionReward` with transient `ReentrancyGuard`.
- M-Oracle-2-Followup `firstClaimPaid` flag is set inside `_claimQuestionReward` (`QuestionRewardPoolEscrow.sol:721-723`), read by `_snapshotHasPaidClaim` (`:1082-1084`). Day-8 reject-after-qualify-no-claim path opens correctly.
- L-Oracle-1 `recoverRejectedSnapshotRound` (`:857-892`) — guards `!_snapshotHasPaidClaim`, requires root in `rejectedRoundPayoutSnapshotRoots`, returns allocation, decrements `qualifiedRounds`, deletes slot.
- `_settleClaimPayout` frontend-redirect: when frontend transfer fails or `frontendFee = 0`, amount absorbed into voter share; `redirectedFrontendFee` is reported back; caller decrements both `frontendFeeClaimedAmount` and `frontendFeeAllocation` in lockstep. Solvency invariant holds.
- `_nextWeightedShare` final-claimant terminal branch returns `totalAmount - claimedAmount` exactly. No precision-loss leakage.
- `ParticipationPool` reserved/withdrawable separation: `withdrawRemaining` cannot touch `reservedBalance`; `recoverSurplus` only sweeps beyond `poolBalance + reservedBalance`.
- `RoundRewardDistributor` dust finalization sorted-input invariant `voter <= previous` prevents double-counting; dust routed to treasury or back into consensus reserve.
- `_pay` underflow safety on `LaunchDistributionPool.sol:861-866`.
- `FeedbackBonusEscrow._pullUsdc` balance-delta enforcement matches `pullExactToken`.
- `forfeitExpiredFeedbackBonus` treasury-fallback to funder when treasury unset.

**Voting**
- M-Vote-4 fix on the main engine path: `revealedKeysMem` is built once over commits with `revealableAfter <= thresholdReachedAt`, every sampler call indexes directly via `_rbtsOtherIndex` and `_rbtsPeerIndex` with the two-exclusion shift. Distribution uniform over revealed commits.
- M-Vote-2 seed binding via `committedSetHash` (folded over full `commitKeys` in commit order, reveal-independent).
- Delayed-seed pattern (`RBTS_SEED_BLOCK_FLAG`): seedBlock is the threshold-flip block; `blockhash(seedBlock)` consumed at `finalizeRbtsSeed`. Sequencer grinding bounded by single-sequencer block-skipping.
- HRC lockout (L-Vote-4) + cancel path (L-Vote-6): both jointly correct; `roundHasHumanVerifiedCommit` sticky once flipped.
- Cross-round commit replay impossible (`commitKey = keccak256(voter, commitHash)` with commitHash binding contentId, roundId, voter, salt, drand metadata, ciphertext hash).
- Per-identity stake cap (`identityRoundStake`) prevents stake-stacking across delegate/holder addresses (MAX_STAKE = 10 LREP per identity per round).
- `processUnrevealedVotes` LREP conservation across refund / forfeit / treasury / consensus-reserve fallback.
- AdvisoryVoteRecorder cooldown migration (`b3b429e`) covers both `lastAdvisoryVoteTimestamp` and `lastAdvisoryVoteTimestampByIdentity`.

**Identity / Governance**
- `_disableInitializers()` present on all upgradeable contracts in scope.
- Deployer never receives `DEFAULT_ADMIN_ROLE` (constructors grant only to `governance`).
- Transparent proxy admin is timelock across all proxies.
- Timelock role hygiene: PROPOSER to governor only; CANCELLER granted dual, deployer's revoked; DEFAULT_ADMIN_ROLE renounced.
- `replaceExcludedHolder` requires `newHolder.code.length != 0` and cap of 64.
- `_castVote` / `propose` gate on `_requireNonExcludedGovernor`.
- Nullifier per-provider namespacing in `RaterRegistry`.
- LoopReputation self-delegation override; auto-self-delegation on first balance receipt.
- MAX_SUPPLY enforcement on mint; MINTER_ROLE renounced post-deploy.
- ProtocolConfig setter bounds (revealGracePeriod clamped to `[epochDuration, maxRoundDuration + 1d]`; rating config `minWadLowerBound = 1e16`; penalty cap 5000 BPS).
- `_authorizeEngineCallback` canonical-only check.

**Oracle / Integrations**
- Merkle leaf double-hashing (`payoutWeightLeaf:574-597`) — `keccak256(bytes.concat(keccak256(abi.encode(...))))` with `MerkleProof.verifyCalldata` (commutative sorted-pair) defends against 64-byte secondary-preimage.
- Domain separation: `CORRELATION_EPOCH_DOMAIN`, `ROUND_SNAPSHOT_DOMAIN`, `PAYOUT_WEIGHT_DOMAIN` are distinct constants; `payoutWeightLeaf` binds `block.chainid` and `address(this)` per-leaf.
- Round-payout rejected-root replay blocked via `rejectedRoundPayoutSnapshotRoots`.
- Bond lifecycle: CEI with `pendingBondWithdrawals`; `nonReentrant` on both withdraw methods; partial-withdraw clawback emits `ProposerBondUnrecoverable` without reverting.
- Challenge-window arithmetic correct at boundaries; uint256 no overflow.
- EIP-3009 nonce binding completeness covers domain + chainid + registry + escrow + gateway + payer + payee + value + validity + payload hashes.
- `paymentAuthorization.to == address(this)` enforced.
- `SubmissionMediaValidator` host hardening: 2048 length cap, printable-ASCII-only, rejects `@` / `\` / `%`-in-host / IPv6 brackets / userinfo. YouTube IDs exact 11 chars; attachment IDs 16-80 from `[A-Za-z0-9_-]`. Image URL must end exactly in `.webp` with `att_` prefix.
- L2 sequencer drift (~20s) far below smallest oracle window (12 h challenge / 7 d veto).
- Frontend bond / fee accounting: `feeCreditor` + `authorizedFeeCreditors[creditor]` + `_requireFeeCreditorForEngine` triple-check; `MAX_FEE_CREDIT = 50_000e6` clamp; slashing routes via `forceApprove`.
- No L1 → L2 bridge surface on these contracts.

---

## Recommended remediation order

1. **Before mainnet** — M-Vote-5 (mirror M-Vote-4 fix into `AdvisoryVoteRecorder._findRevealedCommitKey`). M-Funds-2 (move counter increment to record time). M-Funds-3 (delete pending entry on finalize + governance rescue). All three are 3-to-10-line fixes.
2. **Before mainnet** — L-Identity-7 (2-line deploy script pause-bracket for `setQuestionRewardPoolEscrow`). N-2 (override `_validateDescriptionForProposer` on `CuryoGovernor`). N-3 (3-line `max(oldUnlock, newUnlock)` in `lockForGovernance`).
3. **Before opening proposer set** — L-Oracle-4 (correlation-epoch rejected-root blacklist). L-Frontend-1 (atomic engine-rotation runbook or role-admin alignment).
4. **Anytime, low cost** — L-Vote-8 (clamp `predictedUpBps` to `[100, 9900]`). L-Vote-9 (extend scoring set within grace window OR document). L-Vote-10 (re-arm IOU math OR delete dead surface). L-Funds-5/6/7 (slot-consumption fairness, dead-write removal, redirect helper refactor). L-Identity-8 (disable `delegateBySig`). L-Identity-9 (`DelegateUnchanged` event).
5. **Anytime, defense-in-depth** — N-1 (post-deploy admin-set invariant test). N-4 (confirm OZ version ≥4.4 for live-chainid rebuild). N-5 (remove `ClusterPayoutOracle.receive()` or add sweep). I-X402-1 (switch `abi.encodePacked` → `abi.encode` in `_hashStringArray`).
6. **Documentation** — I-Identity-6/7/8/9, I-Oracle-5, I-Frontend-2, I-Funds-3, I-Vote-5/6/7.

## Suggested test additions

- Sampler-distribution fuzz for the **advisory** recorder, paralleling the M-Vote-4 fuzz: attacker sybils at indices 0..k of an N-commit round, non-reveal, measure reference-draw distribution against uniform over the revealed set. Assert max deviation ≤ small tolerance (M-Vote-5).
- 4 unverified raters with cluster oracle configured: first 3 record successfully and finalize, 4th record must return 0 with no pending entry written (M-Funds-2).
- Oracle rotation between record and finalize: governance rotates `clusterPayoutOracle`; unfinalized pending entries must be re-finalizable against the new oracle after rescue (M-Funds-3).
- `_recordEarnedRaterReward` against a depleted pool: rater whose 10th qualifying credit hits an empty pool must NOT consume slot 10 (L-Funds-5).
- BTS edge case: voter with `predictedUpBps ∈ {0, 10000}` rejected (L-Vote-8 post-fix).
- Front-run propose with identical `descriptionHash`, assert honest re-submit succeeds (N-2 post-fix).
- Two adjacent proposals 6 days apart: voter's effective unlock must be `T_first_lock + 7d`, not `T_second_lock + 7d` (N-3 post-fix).
- Post-deploy invariant test asserting `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` are held only by timelock across all UUPS contracts (N-1).
- Deploy script integration: assert registry is paused during `setQuestionRewardPoolEscrow` first-set (L-Identity-7).
- Reject correlation epoch, immediately re-propose same `(clusterRoot, parameterHash, artifactHash)` → revert (L-Oracle-4 post-fix).
- Layout-stability tests for `QuestionRewardPoolEscrow`, `ContentRegistry`, `ProfileRegistry`, `FrontendRegistry`, `ProtocolConfig`, `LaunchDistributionPool` mirroring the `RoundVotingEngine` test added in `eab1bd2` (carryover from I-Funds-2 May 17).

---

## File path reference

All paths relative to `packages/foundry/contracts/`.

- M-Vote-5: `AdvisoryVoteRecorder.sol:638-655`; mirror at `libraries/RoundRevealLib.sol:341-372`.
- M-Funds-2: `LaunchDistributionPool.sol:341-352, 386-397, 434-439`.
- M-Funds-3: `LaunchDistributionPool.sol:440-455, 528-542, 588-597`.
- L-Vote-8: `libraries/RobustBtsMath.sol:15-21, 33-42`.
- L-Vote-9: `RoundVotingEngine.sol:1287-1322`; `libraries/RoundRevealLib.sol:134-136, 192-219`.
- L-Vote-10: `libraries/RoundCleanupLib.sol:505-608`; `RoundVotingEngine.sol:291-305, 1491-1493`.
- L-Funds-5: `LaunchDistributionPool.sol:499-519`.
- L-Funds-6: `libraries/RoundSettlementDistributionLib.sol:52, 88`.
- L-Funds-7: `FeedbackBonusEscrow.sol:212-217, 391`.
- L-Identity-7: `ContentRegistry.sol:378-385`; `script/Deploy.s.sol:218-223`.
- L-Identity-8: `LoopReputation.sol:108-127`.
- L-Identity-9: `RaterRegistry.sol:218-253, 417-428`.
- L-Oracle-4: `ClusterPayoutOracle.sol:215-218, 288-298, 309`.
- L-Frontend-1: `FrontendRegistry.sol:343-354, 358-369, 384-392`.
- N-1: all upgradeable `*.sol` + `script/Deploy.s.sol`.
- N-2: `governance/CuryoGovernor.sol:264-285`.
- N-3: `LoopReputation.sol:62-83`.
- N-4: `LoopReputation.sol:34`.
- N-5: `ClusterPayoutOracle.sol:173-175`.

---

**Method note.** This audit was conducted by an independent set of five parallel agents (four domain-focused — funds flow, voting / game theory, identity / governance, oracle / integrations — and one research pass over Q1–Q2 2026 exploits). Each agent was instructed to find issues the prior audit missed or to falsify "checked and confirmed sound" claims. Findings were synthesized into this single report without re-running the prior audit's checks. Severity reflects impact and current-day exploitability against `main` HEAD; all three Mediums are pre-mainnet correctness gaps.

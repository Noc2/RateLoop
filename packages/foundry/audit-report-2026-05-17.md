# RateLoop / RateLoop Smart Contract Security Audit — 2026-05-17

> Status note, 2026-05-18: this is a point-in-time engineering audit artifact. The Medium findings
> called out below have follow-up remediation code and tests in later commits; check the current
> contracts and test suite before treating any finding here as still open.

**Scope:** ~17.5k LOC of Solidity across `packages/foundry/contracts/`, focused on the delta since the May 16 audit (`982369d..HEAD` on `main`) — HREP→LREP rename, struct-packing refactors, SafeCast adoption, storage-placeholder removals, and the security-fix branch that closed all May 16 Mediums/Lows.
**Method:** 4 parallel domain-focused review agents (funds-flow, voting/game-theory/MEV, identity/governance/upgrade, oracle/integrations/exploit-chains) plus a research agent surveying 2025-2026 exploit patterns relevant to commit-reveal voting / optimistic merkle oracles / EIP-3009 / UUPS proxies / L2 sequencer MEV.
**Baseline:** prior audits at `audit-report-2026-05-04.md` (0 H/C/M/L) and `audit-report-2026-05-16.md` (0 H/C, 8 M, 12 L, 16 I — all addressed in `security-fixes-from-audit-2026-05-16`). Findings already covered there are excluded except where the corresponding fix is broken or incomplete.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| **Medium** | **2** |
| Low | 9 |
| Informational | 14 |

Both Mediums are **regressions introduced by May 16 remediation commits**, not fresh discoveries on previously-audited code. The remediation set was correct in intent but two of the fixes have load-bearing edge cases that the original finding's framing didn't surface:

1. **M-Vote-4** — the `5b0ecdc` fix for M-Vote-2 closed the selective-reveal *seed-grinding* attack, but the helper that maps committed-set indices onto revealed commits is a pure forward scan. A sybil cluster placed immediately before an HRC commit absorbs the sampler probability of every unrevealed position they hold (≈4× uniform on the worst-positioned target). This is a *sampler bias*, not a seed bias — orthogonal to M-Vote-1's prevrandao defense.
2. **M-Oracle-2-Followup** — the `277ced9` 7-day veto-window fix is correct for the `LaunchDistributionPool` consumer (which flips its consumed flag on actual paid claim) but **silently undermined for the `QuestionRewardPoolEscrow` consumer**, whose `isRoundPayoutSnapshotConsumed` returns `roundSnapshots[...].qualified` — and qualification flips before any claim has paid out. After day 7, the arbiter can no longer reject a poisoned snapshot for question-reward pools once *anyone* has called `qualifyRound`.

Both fixes are one-to-three-line changes. Neither is exploitable today (no mainnet deployment), but they are pre-mainnet correctness gaps in the explicit security-fix set.

The remaining Lows and Informationals cluster around defense-in-depth (permit-front-run, nonReentrant on bond withdrawal), economic-attack amplification by the L-Vote-4 lockout gate, deferred-cleanup IOU ergonomics, and governor-rotation operational concerns. The HREP→LREP rename, storage-placeholder removals, SafeCast adoption, struct-packing refactors, and the IOU mechanism itself survive the attack-tree walks.

---

## Medium findings

### M-Vote-4 — `_advanceToRevealed` forward-scan produces non-uniform peer/reference distribution; sybils placed before HRC commits absorb sampler weight

**File:** `libraries/RoundRevealLib.sol:341-372` (introduced by `5b0ecdc` fixing M-Vote-2)

The M-Vote-2 fix broadens the sampler over `committedCount` and resolves an unrevealed-index draw via `_advanceToRevealed` — a *purely forward* modular scan that skips unrevealed positions and `excludeA`/`excludeB`. The seed is now reveal-independent (good, M-Vote-2 closes), but the on-miss-advance hands all skipped probability mass to **the first revealed commit immediately after a contiguous unrevealed run.**

**Concrete attack.** 9 commits; attacker controls 3 min-stake non-HRC commits at indices 0,1,2; honest HRC voters at indices 3..8. Attacker non-reveals 0,1,2 (forfeits 3 LREP). For honest voter at index 4:
- `_rbtsOtherIndex` draws uniformly over {0..8}\{4} (8 indices).
- Draws of 0, 1, 2, or 3 all map to index 3 after forward scan.
- Net: `P(reference = 3) = 4/8 = 50%` vs. uniform `1/8 = 12.5%`.

The same skew applies to peer draws. A colluding attacker who controls position 3 (a real HRC commit, or a non-HRC commit before the round HRC-lockouts via L-Vote-4) can vote opposite-of-truth there and depress ≈50% of honest voters' BTS scores at a cost of 3 LREP forfeit + 1 LREP on the revealed adversarial position. M-Vote-1's prevrandao mix does not defend — the bias lives in the index→commit *mapping*, not the seed.

**Fix.** Replace forward-scan with one of:
- **Resample-and-reject** (preferred): if `_rbtsOtherIndex` lands on an unrevealed/excluded index, rehash `(seed, drawKey, ownIndex, domain, attempt)` and retry. Bounded attempts, uniform distribution over revealed.
- **Reindex over revealed set**: build the `revealedKeys` array as before but keep the *seed* hashed over the committed set so the seed is still reveal-independent. Sampler then ranges over `revealedCount` and is uniform. This was the explicit M-Vote-2 fix recommendation in the May 16 report ("sampler indices then map positionally into the revealed subset").

Add a fuzz test asserting reference-draw distribution stays within a small tolerance of uniform across attacker positions.

### M-Oracle-2-Followup — `QuestionRewardPoolEscrow.isRoundPayoutSnapshotConsumed` flips at *qualification*, not at *first paid claim*; arbiter veto window narrows for the USDC consumer

**File:** `QuestionRewardPoolEscrow.sol:1059-1070`; `ClusterPayoutOracle.sol:452-497`; cf. `LaunchDistributionPool.sol:582-591`.

The M-Oracle-2 fix is `block.timestamp <= finalizedAt + 7 days` → reject unconditionally; otherwise reject only if `!isRoundPayoutSnapshotConsumed`. **`LaunchDistributionPool` honors the documented "first paid wei" semantics** — its consumed flag flips only after an actual `paidAmount > 0`. **`QuestionRewardPoolEscrow` does not.** It returns `roundSnapshots[rewardPoolId][roundId].qualified`, which is flipped to `true` inside `_qualifyRound` (`QuestionRewardPoolEscrowQualificationLib.sol:120, 196`) *before any claim has paid out*.

**Exploit chain.**
1. Eligible frontend proposes a poisoned merkle root for round R of high-value reward pool P. 12 h optimistic window elapses without challenge; `finalizeRoundPayoutSnapshot` flips status to `Finalized`.
2. The proposer (or any keeper) immediately calls `qualifyRound(P, R)`. `roundSnapshots[P][R].qualified = true`. **No claim has paid out a wei.**
3. Day 8 (outside the 7-day veto window). Off-chain forensic analysis surfaces the bad root.
4. `rejectFinalizedRoundPayoutSnapshot` reverts with `SnapshotConsumed` — consumer reports consumed even though no funds have moved.
5. Bad-faith claimants drain the round's allocation against the inflated tree.

The asymmetry hits the **higher-value domain** (USDC) while the lower-value domain (LREP launch credits) is correctly protected. Long-tail forensic discovery is exactly the use case M-Oracle-2's 7-day window was sized for.

**Fix.** Track per-round paid-claim count in the escrow:
```solidity
return roundSnapshots[rewardPoolId][roundId].firstClaimPaid;
```
flip `firstClaimPaid = true` inside `_claimQuestionReward` after the existing `rewardClaimed[...] = true` write. Mirror the comment in `LaunchDistributionPool.isRoundPayoutSnapshotConsumed:586-590`.

Add a negative test: rejection after `qualifyRound` but before any claim must succeed on day 8.

---

## Low findings

### Voting / Game theory

- **L-Vote-6** — `cancelExpiredRound` min-stake flood amplified by L-Vote-4. The `7a0b3e3` lockout gate (`roundHasHumanVerifiedCommit`) closed the 3-sybil RevealFailed cycle, but made it free to fill all `maxVoters` (default 200) with min-stake non-HRC commits and refund-cancel at expiry. Per-content grief is now rate-limited only by round-cycle latency, at gas cost only. **Fix:** charge a small protocol fee on commits cancel-refunded from non-HRC rounds, or admit only the first `K << maxVoters` non-HRC commits until at least one HRC voter participates. `RoundVotingEngine.sol:779-798`.
- **L-Vote-7** — `commitVoteWithPermit` permit-front-run grief. Standard EIP-2612 pattern: observer extracts the signed permit, fires `lrepToken.permit(...)` bare, consuming the voter's nonce. Voter's `commitVoteWithPermit` reverts. Low impact (allowance still set, voter retries via `commitVote`), but timing-weaponized against round-fill races (interacts with L-Vote-6). **Fix:** `try` the permit and fall through on revert; verify allowance afterwards. Universal Router pattern. `RoundVotingEngine.sol:418-446`; `libraries/VotePreflightLib.sol:90-101`.

### Oracle / Integrations

- **L-Oracle-1** — Stuck round allocation after arbiter rejection of a qualified-but-unclaimed snapshot. The post-Followup fix above prevents the rejection in the worst case; even with the fix landed, the rare case of rejection-after-qualify-no-claim leaves `allocation` deducted from `unallocatedAmount` with no rollback path. Eventually reachable via `refundExpiredRewardPool` on bounty expiry, but operationally painful. **Fix:** arbiter-callable `recoverRejectedSnapshotRound` that resets the snapshot slot and returns allocation. `QuestionRewardPoolEscrow.sol:1130-1156`.
- **L-Oracle-2** — `withdrawBondCreditTo` lacks `nonReentrant`. CEI ordering is correct (`pendingBondWithdrawals[msg.sender] = 0` precedes transfer), so reentrant calls into the same function find zero and revert. But the bond token's transfer hook could re-enter `proposeCorrelationEpoch` / `proposeRoundPayoutSnapshot` (neither of which has `nonReentrant` since they don't transfer tokens). USDC is safe today; symmetric hardening matches the `9e04c96` change. **Fix:** add `nonReentrant` to both `withdrawBondCredit*` methods. `ClusterPayoutOracle.sol:499-510`.
- **L-Oracle-3** — EIP-3009 X402 nonce binding does not include any per-session value. If governance ever rotates `ContentRegistry.questionRewardPoolEscrow()` to a new escrow and back to the original (e.g., emergency rollback), an unconsumed pre-rotation authorization is structurally replayable on the X402 gateway. USDC's own nonce store currently blocks the actual transfer; the defense-in-depth gap matters if the asset token ever changes to a re-usable-nonce ERC-3009 variant. **Fix:** mix `block.number` (commit-time) into the X402 nonce, or maintain a per-gateway `usedNonces` mapping. `X402QuestionSubmitter.sol:109, 159-178`.

### Funds flow

- **L-Funds-3** — M-Funds-1 fix re-routes the recouped fee to the *last claimant's frontend*, not to the last claimant directly. Pool stays solvent; the redirected fee is recouped from the last weighted claimant's voter share and forwarded to their frontend operator. Worked: 4 equal claimants, allocation 1000, fee 2.5%: V2 redirect → V4's frontend gets 12.5 (vs. fair 6.25), V4 gets 237.5 (vs. fair 243.75). Adversarial extraction if the same party controls both V2's blocklisted frontend and V4's frontend; otherwise stochastic socialization. **Fix:** subtract `redirectedFrontendFee` from `snapshot.frontendFeeAllocation` so the residue stays with the voter, OR document the socialization explicitly. `QuestionRewardPoolEscrow.sol:718-731`; `libraries/QuestionRewardPoolEscrowClaimLib.sol:107-113, 432-436`.
- **L-Funds-4** — Bundle path discards `bundleRedirectedFrontendFee` with a bare `bundleRedirectedFrontendFee;` no-op statement. Today the bundle equal-share path has no `frontendFeeClaimedAmount` mapping, so this is sound. The statement is fragile: a future shift to weighted bundle math will inherit silently-broken accounting because the redirect is never surfaced. **Fix:** define the bundle snapshot to carry a `frontendFeeClaimedAmount` slot and apply the same M-Funds-1 decrement uniformly, or wrap the discard in an `assert`/explicit comment. `libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:374-386`.

### Identity / Governance

- **L-Identity-5** — `setVotingEngine` first-set runs unpaused. The `paused()` requirement applies only to rotations (`votingEngine != address(0)`). On first-set during `Deploy.s.sol`, the engine is wired without the pause guard. Deployer holds only `CONFIG_ROLE`, which is renounced at deploy end — exposure window is the deploy script itself. **Fix:** pause-then-unpause around the first `setVotingEngine` in `Deploy.s.sol`. `ContentRegistry.sol:335-347`.
- **L-Identity-6** — Governor rotation requires an atomic three-step proposal (grant timelock roles to new governor; revoke from old; `LREP.setGovernor(new)`). Splitting these creates either a window where the old governor can still schedule on the timelock (steps 1+3 only) or where in-flight proposals on the old governor freeze at vote time (steps 2+3 only). **Fix:** document the runbook; consider an on-chain helper that bundles the three calls.

---

## Informational

### Voting

- **I-Vote-3** — `replayBundleObserverNotify` accepts `settled` as a parameter but does not cross-check against `Round.state`. Admin-role abuse only; derive `settled` from `rounds[contentId][roundId].state == Settled` instead of accepting it from caller. `RoundVotingEngine.sol:760-769`.
- **I-Vote-4** — IOU under `claimDeferredCleanupBounty` has no time limit. The IOU competes with subsequent consensus-subsidy draws from the same `consensusReserve`; no FIFO/priority guarantee. Not exploitable in isolation; document the race or add a 90-day claim window with treasury reaping of unclaimed IOUs. `RoundVotingEngine.sol:301-319`.

### Oracle / Integrations

- **I-Oracle-1** — `unslashFrontend` has no cooldown / no re-stake requirement. Cyclical griefing under governance abuse: stake → grief → slash → unslash → top-up → grief. Governance hazard, not a contract flaw. Document in governance playbook. `FrontendRegistry.sol:327-334`.
- **I-Oracle-2** — `finalizeChallengedRoundPayoutSnapshot` credits the dismissed challenger's bond 100% to the proposer. Single-arbiter (`DEFAULT_ADMIN_ROLE`) governance centralization concern: a malicious arbiter can collude with a proposer to extract 5 USDC per dismissed challenge from honest defenders. Migrate `ARBITER_ROLE` to a multi-sig or DAO vote before opening the proposer set. `ClusterPayoutOracle.sol:403-424`.
- **I-Oracle-3** — `LaunchDistributionPool` pending credits pin to the oracle address at record time (carried forward from May 16 I-Funds-3). `setClusterPayoutOracle` does not rewrite outstanding pending entries. Either accept oracle immutability post-launch (and document) or add a migration tool that re-pins open keys. `LaunchDistributionPool.sol:528-542, 416-430`.
- **I-Oracle-4** — `proposeRoundPayoutSnapshot` first-writer-wins on identical-payload races. No value extracted today (proposer slot is informational), but any future fee-rebate-to-proposer mechanism turns this into an MEV vector. Flag before any such mechanism lands.

### Funds flow

- **I-Funds-1** — `processUnrevealedVotes` emits `DeferredCleanupBountyAccrued` but no immediate keeper-pay event when a refund-only batch defers 100% of the bounty (reserve empty). Off-chain keeper dashboards may show "unpaid" unless they also index the deferred event. Document.
- **I-Funds-2** — Storage layout shifts in `b18a0f3` (escrow placeholder removal) and `64b5aeb` (registry placeholder removal) are correct under the fresh-redeploy assumption (only chainId 31337 deployments exist in `packages/contracts/src/deployedContracts.ts`). Recommend a layout-stability foundry test on all funds-flow contracts (one exists for `RoundVotingEngine` per `eab1bd2`, but the pattern is not uniform).

### Identity / Governance

- **I-Identity-1** — `LoopReputation.PREDICTION_LOCKER_ROLE` + `predictionVotingEngine` + `predictionRewardDistributor` are write-only dead state (carried forward from May 16). Either wire a consumer or remove.
- **I-Identity-2** — `HumanCredentialRevoked` / `HumanNullifierRevocationCleared` events lack `provider` field. Off-chain attribution requires joining against the prior verify event. Add `HumanCredentialProvider indexed provider` to both events. `RaterRegistry.sol:85-86, 316, 326`.
- **I-Identity-3** — SEEDER_ROLE can cyclically recycle a nullifier across raters (seed → revoke → clearRevoked → seed). Each cycle requires a separate transaction; no single tx mints two valid credentials for one nullifier. Governance hazard only. Recommend off-chain alerting on `(provider, nullifier)` observed in revoke→verify within a short window. `RaterRegistry.sol:300-327`.
- **I-Identity-4** — `FrontendRegistry.FEE_CREDITOR_ROLE` admin still `DEFAULT_ADMIN_ROLE` (carried forward). Today both roles held only by timelock so not exploitable; the `creditFees` double-check is defense-in-depth. Set `_setRoleAdmin(FEE_CREDITOR_ROLE, GOVERNANCE_ROLE)` in `initialize`. `FrontendRegistry.sol:23-24, 84-99`.

---

## Items checked and confirmed sound

A non-exhaustive list of areas the agents specifically validated this pass:

**Funds flow**
- IOU mechanism (`b39907b`, `5afe02b`): keeper cannot inflate own IOU; cross-keeper drain blocked by `msg.sender` gating; cap-tracking (`roundCleanupIncentivePaid`) correctly counts immediate + deferred so deferral cannot bypass the 5-LREP envelope; `accountedLrepBalance` increments/decrements balanced; no reentrancy (LREP has no transfer hook).
- M-Funds-1 fix solvency invariant `sum(payouts) == sum(grossAmounts)` holds across redirect cases; total drainable ≤ `fundedAmount`.
- Bundle vs. pool independence: `rewardClaimed` and `bundleRoundSetRewardClaimed` truly separate keys, no double-payout path.
- `recoverNonAssetToken` (`6a6942b`): admin-gated, `nonReentrant`, asset tokens excluded on both escrows.
- `pullExactToken`: rebasing / zero-transfer / approve-zero-then-approve cases bounded by exact balance-delta enforcement; protocol assets don't rebase; foreign tokens can't reach the pool.
- SafeCast adoption (`240a8c4`, `cbf861d`): call sites are non-user-controlled (compile-time bps constant; uint48 timestamp overflow in year ~8918787). No DoS in critical paths.
- Struct-packing refactors (`2997193`, `e9589b9`, `1f52952`): pure ABI shape changes; storage layouts untouched; no caller passes legacy unpacked args.
- `forge fmt` merge (`043738e`): pure whitespace; no semantic reordering.

**Voting**
- M-Vote-1 (`508800d`): `block.prevrandao` captured at *commit time* into `roundLastCommitPrevrandao`, not read live at reveal/settle. Miner reorg of last commit's block is the only remaining attack — out of scope for the target L2s with single sequencer.
- M-Vote-2 (`5b0ecdc`) **seed component**: `committedSetHash` chained over full committed set in commit order, reveal-independent. (Note: sampler-mapping bug is M-Vote-4 above.)
- M-Vote-3 (`26b66d1`): replay path admin-role gated; idempotent on `roundId` monotonicity; clears `pendingBundleObserverReplay` on success.
- L-Vote-1 (`f04376b`): `epochEndKey` correctly cached before `revealed = true` flip.
- L-Vote-2/IOU layer (`5a79b05`): refund-only cleanup incentive math (0.25% of refunded, capped against 5 LREP envelope shared with forfeit branch), `accountedLrepBalance` debited only at claim time.
- L-Vote-3 (`6289862`): `usedChainHashAtCommit` per-commit; cross-round replay impossible.
- L-Vote-5 (`b3b429e`): cooldown migration is one-way; cannot erase a cooldown.
- L-Vote-4 (`7a0b3e3`): `roundHasHumanVerifiedCommit` is sticky once flipped; credential revocation after commit doesn't retroactively unset. (Amplification concern is L-Vote-6 above.)
- Tlock keeper griefing: `revealVoteByCommitKey` permissionless with no in-protocol reward; no contract-level front-running incentive.
- `accountedHrepBalance` → `accountedLrepBalance` invariant maintained post-rename.
- Storage layout (`64b5aeb`, `b18a0f3`, `4fb26b0`, `eab1bd2`): `__gap` accounting balanced (`mappings + gap` invariant preserved). Safe under fresh-redeploy.

**Identity / Governance**
- HREP → LREP rename complete: zero residual `HumanReputation`/`HREP`/`hrep` references in `packages/foundry/contracts/`.
- `LoopReputation` self-delegation override (`_delegate`) preserved.
- M-Identity-1 (`30fc891`): `revokeVotingEngine` zeros `votingEngineCallbackGeneration`; `_authorizeEngineCallback` is canonical-only; revoked engines cannot mutate state on fresh content.
- M-Identity-2: `MAX_EXCLUDED_HOLDERS = 64`.
- L-Identity-1 (`f714d52`, `27f9ffc`): nullifier per-provider namespacing covers all write paths; cleanup on cross-provider switch.
- L-Identity-2 (`88654c5`): `MODERATOR_ROLE` granted only to governance.
- L-Identity-3: `setRaterRegistry`/`setLaunchDistributionPool`/`setClusterPayoutOracle` all validate interface.
- L-Identity-4: `replaceExcludedHolder` requires `newHolder.code.length == 0`.
- I-Identity-5: `revealGracePeriod` clamped both ways against `maxRoundDuration + 1 day`.
- DEFAULT_ADMIN_ROLE: confirmed renounced or never held by deployer across all in-scope contracts after `Deploy.s.sol`.
- `_disableInitializers()` present on every upgradeable contract.

**Oracle / Integrations**
- M-Oracle-2 (`277ced9`) **for the launch-pool consumer**: 7-day window correct (the escrow consumer is the regression — see M-Oracle-2-Followup).
- M-Oracle-3: `setOracleConfig` enforces `newChallengeBond >= MIN_CHALLENGE_BOND` (1 USDC); constructor default (5 USDC) above floor.
- L-Integrations-3 (`9e04c96`): `nonReentrant` + CEI on both `challengeCorrelationEpoch` and `challengeRoundPayoutSnapshot`.
- L-Integrations-2 (`4821228`): `rescueToken` is `Ownable`-gated; gateway holds no balance between receive-and-forward, so no asset-exclusion needed.
- L-Integrations-1 (`4c2127a`): proposer-bond clawback handles partial-withdraw case via `ProposerBondUnrecoverable` event without reverting.
- `SubmissionMediaValidator`: image URLs restricted to exact `/api/attachments/images/att_*.webp`; host-confusion chars rejected; loopback/private-IP risk bounded.
- X402 EIP-3009 nonce: chainid + registry + escrow + gateway + payer + payee + value + payload-hash bound. (L-Oracle-3 is a defense-in-depth gap on rotation, not a current vulnerability.)
- X402 submitter identity propagates intact from `paymentAuthorization.from` through to the escrow's `_snapshotSubmitterIdentity`.
- L2 sequencer timestamp drift (~20s) not weaponizable: smallest oracle window is 12h challenge, 7d veto — both far above drift bound.
- `ClusterPayoutOracle` and `LaunchDistributionPool` non-upgradeable; no storage-migration concern.
- `roundPayoutSnapshotKey` chainid-free is structurally safe: `payoutWeightLeaf` binds `block.chainid` and `address(this)` per-leaf.

---

## Cross-cutting research findings (2025-2026 attack-pattern checklist)

The research agent surveyed recent post-mortems and audit findings. Patterns flagged as **highly applicable** to this protocol, with status:

| Pattern | Source | Status |
|---|---|---|
| UMA whale-capture of optimistic resolution (Polymarket-Ukraine, March 2025) | theblock.co / orochi.network | Mitigated by 1000-LREP frontend stake + arbiter veto; oracle has only one open vector (M-Oracle-2-Followup). |
| Polymarket whitelisted-proposer migration | UMA Medium | Eligible-frontend allowlist already in place via `FrontendRegistry`. |
| SIR.trading transient-storage residue ($355K, March 2025) | rekt.news | Reviewed `ReentrancyGuardTransient` usage; no slot reuse across functions; no custom TSTORE/TLOAD. |
| EIP-3009 `transferWithAuthorization` flow-hijack (x402, 2025) | tlay.io / openzeppelin.com | X402 path uses gateway-controlled flow; payload binding is comprehensive (verified May 16, re-verified here). L-Oracle-3 covers the rotation edge case. |
| RANDAO/prevrandao 1-bit bias / forking attacks (eprint 2025/037) | eprint.iacr.org | `block.prevrandao` only used as one input among many in the sampler seed; captured at commit time. L1 prevrandao reaches L2 via single-sequencer transport, not currently bias-grindable on Optimism/Base/World Chain. |
| Merkle 64-byte secondary-preimage attack | sciencedirect.com | `payoutWeightLeaf` is constructed inside the contract from typed fields; user never supplies a 64-byte leaf. Safe. |
| Merkle-drop "bad leaf locks tree" | sciencedirect.com | Per-claim `verifyPayoutWeight` isolates bad leaves; non-blocking. |
| UUPS slot-collision / OWASP SC10:2026 | owasp.org | `_disableInitializers()` present on all upgradeable contracts; `__gap` accounting balanced; layout-stability tests partial (see I-Funds-2). |
| L2 sequencer ordering against time-window protocols | PAROLE / Flashblocks | Smallest contract window is 12h; far above sequencer manipulation bounds. |
| drand keeper-threshold trust assumption | drand.love | Documented in protocol design; voter can always self-reveal with their own salt. |

Patterns flagged as **tangentially applicable** were also reviewed; none surfaced new issues beyond what is already covered above.

---

## Recommended remediation order

1. **Before mainnet** — M-Vote-4 (sampler bias) and M-Oracle-2-Followup (1-line escrow consumer fix). Both are corrections to the May 16 fix-set, not new code.
2. **Before mainnet** — L-Identity-6: write the atomic three-step governor-rotation runbook.
3. **Before opening proposer set** — L-Oracle-1 (stuck-allocation recovery path); I-Oracle-3 (pending-credit migration tool or operational doc); I-Oracle-2 (consider multi-sig arbiter migration).
4. **Anytime** — L-Vote-6 (commit-flood pricing), L-Vote-7 (`try` permit), L-Oracle-2 (`nonReentrant` on bond withdrawal), L-Oracle-3 (defense-in-depth nonce binding), L-Funds-3/L-Funds-4 (fee accounting + bundle hardening), L-Identity-5 (pause around first-set).
5. **Anytime, low cost** — I-Identity-2 (`provider` on revoke events), I-Identity-1 (remove dead prediction state), I-Identity-4 (`_setRoleAdmin(FEE_CREDITOR_ROLE, GOVERNANCE_ROLE)`).

## Suggested test additions

- Sampler-distribution fuzz: place attacker sybils at indices 0..k of an N-commit round, non-reveal, measure reference-draw distribution against uniform over the revealed set. Assert max deviation ≤ small tolerance (M-Vote-4).
- Reject-after-qualify-no-claim must succeed on day 8 for `QuestionRewardPoolEscrow` consumer (M-Oracle-2-Followup).
- `maxVoters` flood from non-HRC commits, no HRC voter, `cancelExpiredRound` refund-cancellable at gas cost only (L-Vote-6).
- EIP-3009 nonce-replay across `setQuestionRewardPoolEscrow` rotation (L-Oracle-3).
- Frontend-fee redirect end-to-end: V1 OK / V2 redirect / V3 OK / V4 LAST, assert V4 voter share vs. V4 frontend (L-Funds-3).
- Per-leaf challenge: arbiter rejection after qualification but before any claim returns allocation to `unallocatedAmount` (L-Oracle-1, after fix).
- Layout-stability tests for `QuestionRewardPoolEscrow`, `ContentRegistry`, `ProfileRegistry`, `FrontendRegistry`, `ProtocolConfig`, mirroring the `RoundVotingEngine` test added in `eab1bd2` (I-Funds-2).

---

## File path reference

All paths relative to `packages/foundry/contracts/`:

**Funds flow:** `QuestionRewardPoolEscrow.sol`, `FeedbackBonusEscrow.sol`, `ParticipationPool.sol`, `LaunchDistributionPool.sol`, `RoundRewardDistributor.sol`, `libraries/QuestionRewardPoolEscrow*Lib.sol` (8 files), `libraries/RoundSettlement*Lib.sol`, `libraries/TokenTransferLib.sol`, `libraries/FrontendFee*Lib.sol`, `libraries/RewardMath.sol`, `libraries/LaunchRaterRewardLib.sol`.

**Voting:** `RoundVotingEngine.sol`, `AdvisoryVoteRecorder.sol`, `libraries/RoundLib.sol`, `libraries/VotePreflightLib.sol`, `libraries/TlockVoteLib.sol`, `libraries/RoundRevealLib.sol`, `libraries/RoundCleanupLib.sol`, `libraries/RatingLib.sol`, `libraries/RatingMath.sol`, `libraries/RobustBtsMath.sol`.

**Identity / Governance:** `governance/RateLoopGovernor.sol`, `LoopReputation.sol`, `RaterRegistry.sol`, `ProfileRegistry.sol`, `FrontendRegistry.sol`, `ContentRegistry.sol`, `CategoryRegistry.sol`, `ProtocolConfig.sol`, plus interfaces.

**Integrations:** `X402QuestionSubmitter.sol`, `ClusterPayoutOracle.sol`, `SubmissionMediaValidator.sol`, plus interfaces.

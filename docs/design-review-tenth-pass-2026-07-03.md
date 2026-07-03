# RateLoop Smart Contracts — Tenth-Pass Multi-Agent Design Review

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `cd9690433` ("fix(oracle): keep dispute gate deployable"); this is the latest smart-contract change.
**Requested by:** the repository owner, on his own work, to keep improving the contracts.

## Provenance & authorship

Git history re-confirmed single-author development: all substantive commits resolve to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2`; remote `git@github.com:Noc2/RateLoop.git`), with only `Cursor Agent` (16) and `dependabot[bot]` (9) as other committers. Every finding below is about the owner's own design.

### Which model did what

The owner asked for this to be recorded explicitly.

- **All research and analysis in this pass was performed by Claude Fable 5**: the lead orchestrator, all three parallel review subagents (the new snapshot-dispute / frontend-exit-blocking feature; the reward-pool and bundle-claimable surface; the voting/registry/governance diff plus external research), the lead's independent source re-verification of the two headline findings (the aggregate governance-lock over-release and the no-timeout dispute griefing path), and the external web research (UMA/Kleros optimistic-oracle dispute design, OpenZeppelin Governor lifecycle, ERC20Votes lock accounting).
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used at any point in this pass.** All three subagents completed and returned full reports; no transport or capability failures occurred.
- Tooling caveat, unrelated to model choice: `forge` is not available in the review sandbox, so the Foundry suite was not re-run here. The dispute-gate and proposer-cancel commits both ship regression tests; re-run `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` locally before deployment, since the dispute gate touches the frontend-exit and oracle challenge hot paths.

## Scope and calibration

Since the seventh-pass review (`5a971adba`), the owner shipped the eighth- and ninth-pass design reviews, a tenth-pass security audit, and a large batch of contract changes: the seventh-pass identity findings were remediated (`92ff53d09` "fail closed on resolved bans", `6e8b816da` "resolve expired credential bans"), the fenced two-tier epoch dead code was deleted (`4d8d27e88`, closing 7P-7), the bundle claimable-view was rewritten (~300 lines, targeting 7P-8), the RBTS scoring weights were realigned (`d8bca9753`), and two genuinely new features landed: a governor proposer self-cancel state-release path (`5bdc50f83`, then hardened for 10P-1) and a **snapshot-dispute gate that blocks frontend fee-withdrawal and deregistration while an oracle challenge is open** (`d65806e00`, `cd9690433`). This pass concentrated on that newest, least-reviewed surface plus regression-checking the remediations.

Accepted-design constraints from `AGENTS.md` and prior passes were honored and not re-litigated: optimistic `ClusterPayoutOracle` payout roots with 5-USDC anti-spam challenge bonds and governance (ARBITER) arbitration; the 60-minute `revealGracePeriod`; the 14-day frontend unbonding period and 1-hour fee-withdrawal / finality launch posture; fresh redeploy (storage-layout movement not treated as an upgrade finding); stale-engine fail-closed rotation; RBTS single-task truthfulness as BNE-only; the `maxDuration == epochDuration` single-blind-window bound.

## Summary

The remediations verify clean, and the two new features are structurally sound — but the newest feature introduces one **Medium** griefing interaction, and the proposer-cancel lock release has a residual **Low** accounting hazard beyond the 10P-1 fix.

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| 10D-1 | Medium | ClusterPayoutOracle / FrontendRegistry | A frivolous challenge blocks a competitor frontend's exit with no timeout and no permissionless resolution — only the arbiter can clear it |
| 10D-2 | Low | LoopReputation / RateLoopGovernor | Proposer self-cancel releases proposal stake from an aggregate lock that may also be backing a live vote-lock, freeing up to `proposalThreshold` of vote-locked LREP early |
| 10D-3 | Low | ClusterPayoutOracle / FrontendRegistry | Oracle/registry rewiring or recorder-role revocation while a dispute is open permanently strands `openSnapshotDisputeCount`, with no on-chain recovery |
| 10D-4 | Low (latent) | QuestionRewardPoolEscrowBundleClaimableLib | Pending bundle preview reads a stale round-ID mapping after `resetRoundSet`, diverging from the counter that qualification actually uses |

Verified fixed / no regression, not re-raised: 7P-1 and 7P-2 (identity ban resolution now fail-closed across credential keys, delegate address keys, and expired credentials — traced end-to-end through commit/reveal/advisory/launch paths), 7P-7 (epoch dead code deleted, three behavioral deltas confirmed bit-identical), 7P-8 (dead preview branch removed and qualified-branch preview now matches actual claim), 10P-1 (proposer-cancel now releases the originally-locked `proposalLockedAmount`, not the current threshold).

## Findings

### 10D-1 — Frivolous challenge blocks a competitor frontend's exit indefinitely (no timeout, no permissionless resolution) (Medium, confidence: certain)

**Where:** `ClusterPayoutOracle.sol` `challengeCorrelationEpoch` (374–394) and `challengeRoundPayoutSnapshot` (607–630), each calling `_recordSnapshotDisputeOpened(frontendOperator)`; `FrontendRegistry.sol` `_requireNoOpenSnapshotDispute` gating `completeFeeWithdrawal` (424) and `completeDeregister` (364).

Any disinterested address (anyone who is not the proposer, the frontend operator, or the delegated proposer) can challenge a `Proposed` snapshot by posting the 5-USDC challenge bond. The challenge sets status `Challenged` and increments `openSnapshotDisputeCount[frontendOperator]`; while that count is greater than zero the operator cannot complete a fee withdrawal or deregistration. The only transitions out of `Challenged` are the ARBITER_ROLE finalize/reject functions (verified: `finalizeChallengedCorrelationEpoch`, `finalizeChallengedRoundPayoutSnapshot`, the six `reject*` variants — all `onlyRole(ARBITER_ROLE)`), plus `invalidateObjectivelyInvalidRoundPayoutSnapshot`, which is permissionless but applies only to the RBTS domain and only to *objectively* invalid snapshots. There is **no challenge timeout and no permissionless resolution for a validly-proposed-but-challenged snapshot** — I confirmed `_challengeDeadline` bounds only the window in which a challenge can be *filed*, not its resolution.

Consequence: a competitor can freeze an honest frontend's accrued fees and staked bond for as long as the arbiter takes to rule — unbounded in the worst case — and can renew the grief for 5 USDC per snapshot, since every new round snapshot the frontend proposes is an independently challengeable object. Each requires a separate arbiter action to clear. The griefer forfeits only their bond if the challenge is dismissed, which is cheap relative to freezing a competitor's capital. This overrides the accepted 14-day unbonding / 1-hour fee posture with an arbiter-dependent hold those windows were not designed to bound. Note the block is on *completion* only (`requestFeeWithdrawal` / `requestDeregister` remain ungated, so the timer can start but never finish).

**Fix:** add a bounded auto-resolution — a `challengeArbitrationDeadline` after which anyone can call a permissionless resolver that finalizes the snapshot and awards the challenger's bond to the proposer if the arbiter never ruled (mirroring UMA's permissionless `settleAssertion` so a bonded party's exit can never be stranded by counterparty or arbiter inaction). Alternatively escalate the challenge bond per concurrent open dispute against the same operator, or cap the fee/stake an open dispute can hold. This preserves the exit-block during a *reasonable* arbitration window without letting an absent arbiter or a spam challenger brick exits.

### 10D-2 — Proposer self-cancel frees vote-locked stake via the aggregate governance lock (Low, confidence: high)

**Where:** `LoopReputation.sol` `releaseGovernanceLock` (84–100) and `_lockForGovernanceUntil` (102–130); `RateLoopGovernor.sol` `_cancel` (244–266).

`LoopReputation` keeps a **single aggregate** `GovernanceLock {amount, unlockTime}` per account. Proposal-threshold locks and vote-weight locks merge into the same `lock.amount`: `_lockForGovernanceUntil` raises the amount by `additionalLock` (overlapping obligations share the same tokens rather than summing), and `releaseGovernanceLock` blindly decrements `lock.amount` with no record of which obligation the freed portion backed. The 10P-1 fix correctly made `_cancel` release the originally-locked `proposalLockedAmount[proposalId]` rather than the current threshold — but it releases from this shared ledger.

Scenario (traced in source): a proposer holds 100k LREP. (1) `propose(B)` locks the 1k threshold (`lock.amount = 1k`). (2) During B's `Pending` window the proposer votes on an unrelated live proposal A with full self-delegated weight; `_lockForGovernanceUntil` raises `lock.amount` to 100k — the same tokens now back both obligations. (3) The proposer self-cancels B while still `Pending`; `_cancel` calls `releaseGovernanceLock(proposer, 1k)`, dropping `lock.amount` to 99k. The vote on A is immutable and still counts at full weight, but only 99k is now transfer-locked — the proposer can move ~`proposalThreshold` LREP that the 7-day vote-lock invariant was meant to hold. `nextProposalBlock` is also reset to 0, enabling immediate re-propose/re-cancel cycling.

The leak per cycle is bounded by `proposalThreshold` (1k–100k LREP) and does not retroactively change recorded vote weight (the Governor has no un-vote), so this is a liquidity/anti-flash-governance weakening rather than vote inflation — hence Low. It is the classic ERC20Votes double-lock-accounting pitfall: one token backs both a vote-lock and a proposal-lock in a single ledger, and releasing one obligation silently frees tokens still owed to the other.

**Fix:** track proposal and vote obligations in separate sub-ledgers and release only from the proposal sub-ledger; or in `_cancel` clamp the release to stake not currently backing a vote-lock (release only when the proposal stake is the sole outstanding obligation). The existing N-3 comment already shows awareness of the shared-ledger timer hazard; this extends that reasoning to the release path.

### 10D-3 — Oracle/registry rewiring mid-dispute strands the dispute counter (Low, confidence: likely)

**Where:** `ClusterPayoutOracle.sol` `setFrontendRegistry` (275, CONFIG_ROLE) and `_recordSnapshotDisputeClosed` (1402); `FrontendRegistry.sol` `recordSnapshotDisputeClosed` (621, requires `SNAPSHOT_DISPUTE_RECORDER_ROLE`); `Deploy.s.sol` (360–362).

If a dispute is open against registry R and governance then either (a) swaps in a new oracle and revokes the old oracle's `SNAPSHOT_DISPUTE_RECORDER_ROLE`, or (b) repoints the oracle's `frontendRegistry` via `setFrontendRegistry`, the eventual close call cannot land: in (a) the old oracle's close reverts on the missing role and the new oracle has no record of the in-flight dispute; in (b) the close routes to the new registry, which reverts `NoOpenSnapshotDispute` because it never saw the open. Either way R's `openSnapshotDisputeCount` for that operator never decrements, permanently bricking that operator's exit. Only privileged roles can trigger this, so it is a governance-runbook hazard, not an unprivileged attack — but there is no on-chain recovery (no admin force-clear).

**Fix:** document a hard invariant that the oracle↔registry wiring and the recorder-role grant must not change while any `openSnapshotDisputeCount > 0` (drain disputes first), and add a governance-gated `adminClearSnapshotDispute(address frontend)` on the registry (event-emitting) so a stranded counter is recoverable without redeploy.

### 10D-4 — Pending bundle preview diverges from qualification after `resetRoundSet` (Low, latent; confidence: likely structural, exploitability speculative)

**Where:** `QuestionRewardPoolEscrowBundleClaimableLib.sol` `_hasRecordedRoundSet` / `_equalSharePreview` (157–193) vs. `QuestionRewardPoolEscrowBundleActionsLib.sol` `_qualifyPendingBundleRoundSet` → `isRoundSetComplete`.

The rewritten pending-preview branch gates on the **round-ID mapping** (`bundleRoundIds[...][roundSetIndex] != 0`), while the authoritative qualification path gates on the **recorded-rounds counter** (`bundleQuestionRecordedRounds[...] > roundSetIndex`). These agree normally, but `resetRoundSet` rewinds the counter while leaving the *current* index's stale round ID in place (it only deletes indices above `roundSetIndex`). So after a reset, `_hasRecordedRoundSet` can return true while `isRoundSetComplete` returns false, letting the preview compute a non-zero claimable that the actual `claimQuestionBundleReward` would reject with `"Bundle not claimable"`. This is a false-positive view, not fund loss, and today it is defused in practice by the completer/window/allocation guards (each reset trigger is independently blocked from producing a non-zero preview). It is worth fixing because it is exactly the 7P-8 divergence class and would resurface if a future guard change made a reset path reachable.

**Fix:** make the preview gate on the same completeness source as qualification — call `isRoundSetComplete(...)` (threading `bundleQuestionRecordedRounds` into the view) rather than `_hasRecordedRoundSet`, so preview and actual cannot diverge on this axis.

## Verified sound in this pass (so the next pass need not re-derive)

- **7P-1 / 7P-2 remediations are complete and correct.** `_identityForHolder` now surfaces a banned credential key into the resolved `identityKey` independent of credential expiry (the `hasActiveCredential` guard removed in `6e8b816da`), and every consumer gate (`VotePreflightLib._resolveUnbannedRater`, `validateCommittedRaterUnbanned`, `LaunchDistributionPool`, `LaunchRaterRewardLib`) fails closed on the resolved key, the actor address key, and the holder address key across both the round-snapshot registry and the current registry. A banned delegate activated before its ban, and a banned-but-expired credential, are both caught. One non-exploitable nit: `hasActiveCredential` is left stale-`true` on the credential-ban branch, but the ban gate reverts before any consumer reads it — clear it for defense in depth if the flag's contract is ever documented as trustworthy without a separate ban check.
- **7P-7 epoch dead-code removal is behavior-preserving.** All three deltas (`computeEpochEnd` simplification, `_pastEpochUnrevealedCount` loop→single-lookup, `settleRound` `scoringClosed`/`revert RoundNotOpen` removal) are bit-identical under the enforced `maxDuration == epochDuration` bound; the `Commit.epochIndex` storage field was retained (only its comment changed), so no slot moved.
- **Dispute-gate open/close pairing is balanced.** Every path that reaches `Challenged` (the only state that opens a dispute) has a guaranteed close on all reachable terminal transitions, each gated on the pre-write `wasChallenged` status so a close fires exactly when an open preceded it. No double-open (no `Challenged → Proposed` transition), no underflow (`recordSnapshotDisputeClosed` reverts on `count == 0` before the unchecked decrement), no reentrancy (challenge functions are `nonReentrant`, CEI-ordered, and the registry callbacks only mutate a counter and emit). Role wiring in `Deploy.s.sol` is correct and rotation-capable.
- **RBTS scoring-weight realignment (`d8bca9753`) preserves budget conservation.** `calculateNegativeScoreSpreadForfeit` now bases the forfeit on `commitRbtsWeight` (≤ `stakeAmount` on both writers), so `maxForfeit < stakeAmount` and `stakeReturned = stakeAmount − forfeitedStake` cannot underflow. (Note: this narrows but does not eliminate the 7P-6 raw-stake-vs-discounted-weight asymmetry, which remains an accept/document decision.)
- **Bundle solvency and double-claim.** `requiredSettledRounds == 1` guarantees a single round set; qualification deducts `allocation ≤ unallocatedAmount`; equal-share splits give the last claimant the exact remainder, so Σ claims = allocation ≤ funded. Re-claim is blocked by an identity-scoped `bundleRoundSetRewardClaimed` flag, so aliases/delegates resolving to the same identity resolve to the same commit key. Auto-qualification never pays against an unfinalized cluster snapshot (the pending-preview branch is restricted to non-cluster equal-share bundles).
- **Governor↔token clock and self-delegation.** `LoopReputation` forces self-delegation via the `_update`/`_delegate` overrides and disables `delegateBySig`; the block-denominated clock is consistent across all Governor bounds; the mandatory `#proposer=` description suffix mitigates the OZ 4.9.1 frontrun-cancel DoS.

## Research notes

- **Optimistic-oracle dispute design (UMA, Kleros)** — grounds 10D-1. UMA bounds disputes to one time-limited DVM escalation with **permissionless `settleAssertion`**, so a bonded party's exit is never stranded by counterparty or arbiter inaction, and uses loser-pays split bonds to deter frivolous/self-disputes. Kleros escalates appeal cost asymmetrically with an appellant stake that compensates the griefed party. RateLoop's dispute gate has the exit-block but lacks the time-bounded permissionless backstop these designs treat as essential.
  - https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work
  - https://docs.uma.xyz/developers/optimistic-oracle-v3
  - https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters
  - https://blog.kleros.io/kleros-decentralized-token-listing-appeal-fees/
  - https://kleros.io/whitepaper.pdf
- **OpenZeppelin Governor lifecycle / lock accounting (2025–2026)** — no new Governor advisory in this window; the canonical bugs (frontrun-cancel DoS GHSA-5h3x-9wvq-w4m2 / CVE-2023-34234, retroactive-quorum GHSA-xrc4-737v-9q75, TimelockController GHSA-fg47-3c2x-m2wr) remain, and RateLoop already mitigates the frontrun-cancel one. The 2025 feature set (`GovernorProposalGuardian`, `GovernorSuperQuorum`, `GovernorCountingOverridable`) complicates exactly the custom `_cancel` lock-accounting surface that 10D-2 concerns.
  - https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-5h3x-9wvq-w4m2
  - https://www.coinspect.com/blog/openzeppelin-governor-dos/
  - https://docs.openzeppelin.com/contracts/5.x/changelog
- **ERC20Votes self-delegation + governance-lock pitfalls** — grounds 10D-2. The safe pattern is a single source of truth tying voting checkpoints to the lock ledger (as veToken designs bind lock amount and voting power to one position); RateLoop uses a single aggregate lock but releases from it without distinguishing vote vs. proposal obligations.
  - https://forum.openzeppelin.com/t/self-delegation-in-erc20votes/17501
  - https://rareskills.io/post/erc20-votes-erc5805-and-erc6372
  - https://eips.ethereum.org/EIPS/eip-5805

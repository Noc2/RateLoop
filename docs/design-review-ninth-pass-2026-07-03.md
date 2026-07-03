# RateLoop Smart Contracts — Ninth-Pass Multi-Agent Design Review

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `466cd2b8b` ("docs: add latest non-contract review report"); the two smart-contract changes since the eighth pass are `6e8b816da` ("fix(foundry): resolve expired credential bans") and `4d8d27e88` ("fix(foundry): remove fenced epoch dead code").
**Requested by:** the repository owner, on his own work, to keep improving the contracts.

## Provenance & authorship

Git history re-confirmed single-author development: all substantive commits resolve to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2`; remote `git@github.com:Noc2/RateLoop.git`), with only `Cursor Agent` (16) and `dependabot[bot]` (9) as other committers. Every finding below is about the owner's own design.

### Which model did what

The owner asked for this to be recorded explicitly.

- **All research and analysis in this pass was performed by Claude Fable 5**: the lead orchestrator, all three parallel review subagents (epoch dead-code removal regression review; 8P-1 fix verification + identity/ban surface sweep; fresh review of the least-covered contracts — governance, LREP, registries, media validator, advisory recorder, ProtocolConfig), the lead's independent source re-verification of the one new finding (9P-1) and the 8P-1 fix line, and the external web research (OpenZeppelin Governor cancel/lifecycle semantics).
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used at any point in this pass.** All three subagents completed and returned full reports; no transport or capability failures occurred.
- Tooling caveat, unrelated to model choice: `forge` is not available in the review sandbox, so the Foundry suite was not re-run here. Both remediation commits ship regression tests; because `4d8d27e88` is a broad refactor of the settlement/reward hot path with matching test edits, re-run `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` locally before deployment.

## Scope and calibration

This is a verification-and-hunt pass. Since the eighth-pass review, exactly two contract commits landed: `6e8b816da` (remediating my eighth-pass finding 8P-1) and `4d8d27e88` (removing the fenced two-tier epoch dead code that 7P-7 flagged across the seventh and eighth passes). No fee-withdrawal / dispute-gate change landed, so the 6P-5 item remains open (a concrete remediation plan for it was delivered separately). Two subagents verified those two commits at the cited lines and hunted for regressions they might have introduced; a third took a fresh deep pass over the contracts the prior eight reviews covered least, since the marginal value now lies in the less-trodden surface.

Accepted-design constraints from `AGENTS.md` were honored and not re-litigated: optimistic `ClusterPayoutOracle` payout roots with 5-USDC anti-spam challenge bonds and governance arbitration; the 60-minute `revealGracePeriod`; fresh redeploy (storage-layout movement not treated as an upgrade finding); stale-engine fail-closed rotation; the 1-hour finality launch posture; single-task RBTS truthfulness as BNE-only; and the `maxDuration == epochDuration` single-blind-window bound (the only valid config).

## Summary

**The contract layer remains converged.** Both remediations verify clean, and the fresh sweep of the least-covered contracts surfaced only one new **Low** state-machine gap plus two informational confirmations that the classic Governor traps are absent. No High or Medium issue was found.

| Item | Verdict |
| --- | --- |
| 8P-1 (ban substitution gated on `hasActiveCredential`; expired credential relied on the downstream backstop) | **Fixed** by `6e8b816da` — substitution is now credential-expiry-independent; scenario traced end-to-end |
| 7P-7 (fenced two-tier epoch dead code / inverted tiebreak / misleading NatSpec) | **Resolved** by `4d8d27e88` — dead code deleted; verified no live behavior changed (item-by-item regression check) |
| 9P-1 (new) | Governor proposer self-cancel leaves the ~1-day propose cooldown and the proposal-stake governance lock stranded — **Low**, self-inflicted |

## Fix verification

### 8P-1 — expired-credential ban resolution (`6e8b816da`) — Fixed

The commit removes the `if (hasActiveCredential)` guard that previously wrapped the entire ban-substitution block in `RaterRegistry._identityForHolder`. At HEAD (`RaterRegistry.sol:1508-1516`), `hasActiveCredential = credential.expiresAt > block.timestamp` is now informational only, and the three ban checks — aliased `credentialKey`, the resolved canonical `identityKey`, and the holder `addressIdentityKey` — run unconditionally.

Scenario traced (the exact 8P-1 case): a canonical key seeded from an earlier attestation (sticky, never rotated), the current credential now expired, and governance having banned the current credential's nullifier. Old code skipped the substitution because the credential was expired and returned the (unbanned) canonical key; the pure address-key-only variant leaked an unbanned key. New code: `isIdentityKeyBanned(credentialKey)` is checked first; if that is clean, the canonical key is checked; if that is clean, the holder address-key backstop substitutes the banned key. The resolved key is now the banned key in every variant. The active-credential path (7P-1) is unchanged because the removed guard was always true on that path, and no false-positive ban was introduced — every substitution requires a key *derived from this holder* to be banned, and `isIdentityKeyBanned` short-circuits on `bytes32(0)`. The committed test `test_ExpiredVerifiedCredentialStillResolvesToDerivedBanAfterRotation` asserts exactly this. Lead-verified against source.

### 7P-7 — fenced epoch dead-code removal (`4d8d27e88`) — Resolved, no regression

The commit deletes the provably-dead two-tier epoch machinery (which was unreachable under the `maxDuration == epochDuration` bound: `epochWeightBps` always returned `10000`, `computeEpochIndex` always `0`, so `effectiveStake == stakeAmount` always). Because every removed weight was exactly 100%, each substitution of `effectiveStake(commit) → commit.stakeAmount` and `weight * 10000 / 10000 → weight` is bit-identical to the prior reachable behavior. The subagent verified item-by-item and the lead concurs:

1. `computeEpochIndex` / `epochWeightBps` / `effectiveStake` collapse to constants with **zero surviving callers** expecting a sub-100% weight; the remaining `effectiveStake` locals are assigned raw stake and used as the RBTS/pool weight — no unit change.
2. The RBTS leaf-validation invariant `baseWeight == commit.stakeAmount` (was `effectiveStake(commit)`) is behavior-identical; no numeric bound in `RoundRbtsSettlementSnapshotLib` was altered.
3. `RoundCleanupLib._pastEpochUnrevealedCount` — the always-empty multi-epoch loop became a single keyed read whose key exactly matches the commit-time write key (`round.startTime + epochDuration`) and the reveal-time decrement key, so single-window unrevealed forfeiture is net-of-reveals with no off-by-one.
4. `settleRound` — the removed `scoringClosed` branch and trailing `revert RoundNotOpen()` were genuinely unreachable (the entry guard plus atomic `captureRbtsSeed`/`SettlementPending` transition mean no `Open && seedEntropy != 0` state exists); the `Tied` / `SettlementPending` terminal transitions and the non-inverted `upWins` tiebreak remain correct.
5. Storage: `Commit.epochIndex` was **retained** (only its comment changed; now always written `0`), so no slot was removed and no dangling write or engine/module slot aliasing was introduced; only a memory-struct field was dropped.
6. Budget conservation is preserved by construction (the pre-refactor weighted pools already equalled the raw pools).

The two `_ratingEvidenceWeight` implementations that must agree for snapshot validation (reveal-time in `RoundRevealLib`, oracle-claim-time in `ContentRegistryRatingSnapshotLib`) were edited in lockstep and still produce identical values. No new issue was introduced.

## New finding

### 9P-1 (Low, confidence High). Governor proposer self-cancel strands the propose cooldown and the proposal-stake governance lock

- **Where:** `governance/RateLoopGovernor.sol` — `propose` (`:289-305`) unconditionally sets `nextProposalBlock[msg.sender] = block.number + PROPOSAL_COOLDOWN_BLOCKS` (43,200 blocks ≈ 1 day at 2 s) and calls `reputationToken.lockForGovernanceUntil(msg.sender, threshold, _proposalLockUntil())`, locking the ~1,000 LREP proposal threshold through the full nominal voting window. The `_cancel` override (`:241-247`) only calls `super._cancel` — it never clears `nextProposalBlock` nor releases the governance lock. Lead-verified against source; external research confirms OpenZeppelin 5.x lets the proposer cancel while the proposal is `Pending`.
- **Scenario:** an honest proposer submits a proposal, notices a mistake (wrong target/calldata) a block later, and cancels it while `Pending`. They are now locked out of proposing for ~1 day and have their threshold stake frozen for the entire voting window against a proposal that will never execute. There is no compensating release on the "proposal abandoned" transition.
- **Assessment:** self-inflicted, not attacker-inflicted — the `#proposer=` suffix binding already blocks the front-run-then-cancel grief against a *different* proposer, and the cooldown/lock is a deliberate anti-spam mechanism. So this is friction, not a vulnerability, which is why it is Low. But it is a genuine state-machine asymmetry: `propose` acquires two pieces of proposer state that no path ever releases early.
- **Fix (or explicit accept):** on proposer self-cancel while `Pending`, clear `nextProposalBlock[proposer]` and early-release the governance lock (the governor is the sole locker, so it can call `lockForGovernanceUntil(proposer, threshold, block.timestamp + 1)`); or document the friction as accepted so operators understand a cancelled proposal does not refund the cooldown or unlock the stake.

## Informational confirmations (classic Governor traps checked, absent)

- **Governor ↔ token clock consistency.** `LoopReputation` does not override `clock()`/`CLOCK_MODE`, so ERC20Votes defaults to `block.number`, and every Governor bound (voting delay/period, cooldown, quorum snapshots via `getPastVotes`/`getPastTotalSupply`) is block-denominated — the classic Governor↔token block-vs-timestamp mismatch is **not** present. The one fragility worth a comment: `_proposalLockUntil()` converts block windows to seconds with a hard-coded `WORLD_CHAIN_BLOCK_TIME_SECONDS = 2` while the LREP lock is timestamp-denominated; at max voting settings the computed lock is ≈ 37 days, under the 40-day `MAX_GOVERNANCE_LOCK_DURATION` cap, so `propose` does not brick today — but a future timestamp-clock migration or block-time drift could push the two out of alignment. Bind the 2 s constant and the 40-day cap to the block-clock assumption in a comment.
- **Excluded-holder set — no disenfranchisement vector.** `replaceExcludedHolder` gates on `getVotes(newHolder) == 0` and a non-empty codehash; because LREP forces self-delegation on inbound transfers, a zero-balance contract passes, and the exclusion only removes that holder's *future* votes from circulating-supply quorum (the intended behavior of an excluded protocol pool). No existing voting power is disenfranchised. The quorum loop is bounded at `MAX_EXCLUDED_HOLDERS = 64` and mutable only by governance.

## External research (Claude Fable 5, web)

- **OpenZeppelin Governor cancel/lifecycle semantics (grounding 9P-1).** In OZ 5.x, a proposal is cancellable by the proposer while it is in the `Pending` state (before voting starts), and in any state other than `Canceled`/`Expired`/`Executed` via the optional proposal guardian. This confirms the self-cancel path 9P-1 depends on is a supported, reachable transition, and that RateLoop's `_cancel` override inherits it without releasing the cooldown/lock it added in `propose`. Sources: [OZ Governor.sol (master)](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/governance/Governor.sol), [OZ Governance API docs](https://docs.openzeppelin.com/contracts/5.x/api/governance), [OZ governance README](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/governance/README.adoc).
- Prior passes already grounded the seed/BLOCKHASH (OP-Stack, EIP-2935), drand/tlock, RBTS/COCM, World ID, EIP-3009, and Merkle second-preimage angles; nothing in this pass's two commits touches those, so they are not re-researched.

## Notable non-findings (checked, no issue)

The identity/ban/credential surface is internally consistent after the two consecutive fixes (`92ff53d09` then `6e8b816da`): ban write/clear symmetry holds (every `_write*` has a matching `_clear*`, across the address key, canonical key, and both World-ID provider slots); the provider alias (`WorldIdV4 → WorldId`) is consistent between ban write, resolution, and launch-key derivation; World ID replay keys bind the full proof tuple with separate credential/presence maps and cross-holder nullifier-reuse guards; the downstream `VotePreflightLib` triple-key check (resolved key, actor address key, holder address key, across both round and current registries) is defense-in-depth over the resolver fix; and reward-claim resolution intentionally has no ban gate because enforcement is upstream at commit/vote time. The settlement hot path after the dead-code removal is arithmetically equivalent to before (forfeit 50% cap, ≥8-effective-unit gate, LOO benchmark degenerate-input guards all unchanged and clean). On the least-covered contracts: the proposer-suffix binding correctly closes the OZ 4.9.1 front-run/cancel grief; the LREP governance lock enforces `value <= getTransferableBalance` on transfer and disables `delegateBySig`; the `SubmissionMediaValidator` emitter is one-shot and factory-bound with no anchored-event spoofing; `AdvisoryVoteRecorder` caps, post-settlement reveal exclusion, revealed-key sampler, and triple ban-check hold; and `ProtocolConfig` cross-clamps (reveal-grace floored to `epochDuration` and capped to `maxRoundDuration + 1 day`, `minSettlementVoters >= 3`, WAD lower bounds, wiring shape-probes) admit no single-parameter brick found.

## Items that remain open by design — decision requested, not another patch

Carried forward from prior passes; none is a new bug, each wants an explicit accept-or-fix decision before deployment:

1. **6P-5 — 1-hour frontend fee withdrawal vs. multi-day slash latency.** Still open at HEAD. A concrete, UX-preserving remediation plan (dispute-gated fee withdrawal: freeze `completeFeeWithdrawal` while the operator has an open oracle challenge, keep `FEE_WITHDRAWAL_DELAY ≥ challengeWindow + finalizationVetoWindow` via the readiness gate, and reconcile the README/NatSpec claim) was delivered separately and is ready to implement or ratify.
2. **9P-1 — governor self-cancel friction** (this pass): fix or document.
3. **6P-6 — seed v4 residuals** (Base-sequencer grind; ~4.5 h re-roll ratchet): document as named trust assumptions and/or derive re-armed blocks deterministically.
4. **Governor lock cliff** (fifth pass): `castVote` reverts if current balance < snapshot weight; `min(weight, balance)` or a documented behavior.
5. **Mechanism addendum** (seventh pass): the bounded leave-one-out benchmark externality (largest at n = 3–10) and the exactly-costless herding equilibrium — accepted residuals of the single-task tournament transform, worth stating in the whitepaper alongside the independence-oracle and ≥8-effective-units controls that compensate for them.

## Priorities

1. **9P-1** — release the cooldown + stake lock on proposer self-cancel, or document the friction (the one new item; Low, cheap).
2. **6P-5 / 6P-6 / governor-lock / mechanism-addendum** — ratify each as an explicit accept-or-fix decision and reconcile the docs; none needs a large code change.
3. Re-run `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` locally at HEAD — especially for `4d8d27e88`, whose broad refactor and test edits should be confirmed green on a clean checkout (not possible in the review sandbox).

---

*Prepared 2026-07-03 by a Claude Fable 5 multi-agent review at HEAD `466cd2b8b`: lead orchestrator + three parallel read-only subagents (epoch dead-code regression review; 8P-1 fix verification + identity/ban sweep; fresh review of governance/LREP/registries/media/advisory/ProtocolConfig), all on Claude Fable 5, with lead source re-verification of finding 9P-1 and the 8P-1 fix line, plus Fable 5 web research on OpenZeppelin Governor cancel/lifecycle semantics. No fallback to Claude Opus 4.8 (or any other model) occurred at any point.*

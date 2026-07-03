# RateLoop Smart Contracts — Seventh-Pass Multi-Agent Design Review

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `6ad8b66ab` ("fix(ponder): show LREP bounty payout waits"); last smart-contract change at this head is `22ff5e3c1` ("fix contracts rbts parent rejection timeout").
**Requested by:** the repository owner, on his own work, to keep improving the contracts.

## Provenance & authorship

Git history re-confirmed single-author development: 3,886 substantive commits resolve to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2`; remote `git@github.com:Noc2/RateLoop.git`), with only `Cursor Agent` (16) and `dependabot[bot]` (9) as other committers. Every finding below is about the owner's own design.

### Which model did what

The owner asked for this to be recorded explicitly.

- **All research and analysis in this pass was performed by Claude Fable 5**: the lead orchestrator, all four parallel review subagents (voting-engine core and round lifecycle libraries; escrows and token flows; registries, governance, and oracle; math/mechanism libraries plus external literature research), the lead's independent re-verification in source of every finding published below, and the external web research (RBTS literature, drand/tlock spec, World ID, EIP-3009).
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used at any point in this pass.** All four subagents completed and returned full reports; no transport or capability failures occurred.
- Tooling caveat, unrelated to model choice: `forge` is not available in the review sandbox, so the Foundry suite was not re-run here. The internal eleventh-pass audit recorded `forge test --offline` (1845 passed, 0 failed) at `090603fe8`; nothing contract-side changed since except docs, but any remediation of the findings below should be re-verified locally with `forge test`, `make check-contract-sizes`, and `make check-storage-layouts` before deployment.

## Scope and calibration

This pass deliberately took a design/mechanism angle rather than re-walking the diff-driven ground the eleven internal security-audit passes (`docs/security-audit-smart-contracts-post-fix-*.md`) already cover. All contracts under `packages/foundry/contracts` were read in full across the four subagents, with additional external research on the mechanism literature and integrated protocols.

Accepted-design constraints from `AGENTS.md` and the prior audit assumptions were honored and not re-litigated: optimistic `ClusterPayoutOracle` payout roots with 5-USDC anti-spam challenge bonds and governance arbitration; the 60-minute `revealGracePeriod`; fresh redeploy (storage-layout movement not treated as an upgrade finding); stale-engine fail-closed rotation requiring a coordinated redeploy. Findings are flagged where behavior is internally inconsistent with the protocol's own docs or where a path appears not to have been considered.

Two prior-pass items re-confirmed at HEAD before this review looked for anything new: the tenth-pass `M-10P-1` RBTS parent-rejection timeout fix holds (`_requireNoRecentRejectedRbtsSettlementSnapshot` defers the empty-settlement timeout past both direct-child and parent-derived rejection timestamps, and same-digest parent re-proposals stay blocked), and the sixth-pass `6P-1` rating-cursor rotation wedge is closed (`advanceRatingSnapshotCursor` now reads `roundCore` on the per-round owning engine).

## Summary

No High-severity issue was found. The material new findings are one Medium in identity ban resolution and a cluster of Low-severity value-loss, fail-open, and signed-payload gaps, plus a mechanism-design asymmetry that deserves an explicit accept/fix decision.

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| 7P-1 | Medium | RaterRegistry | Ban resolution only fail-closes on the holder's *address* key; stale canonical keys can sidestep credential-nullifier bans |
| 7P-2 | Low | RaterRegistry | A delegate banned *after* activation keeps acting through the holder's identity |
| 7P-3 | Low | FeedbackBonusEscrow / X402 | Feedback bonuses on rounds that end `Cancelled` are unawardable and sweep to the treasury instead of refunding the funder |
| 7P-4 | Low | LaunchDistributionPool | `_isVerifiedAnchorBanned` assembly decodes short returndata as "banned" and is fail-open on revert — opposite polarity to `_isRaterBanned` |
| 7P-5 | Low | X402QuestionSubmitter | `feedbackClosesAt` is execution-time-derived and not covered by the signed EIP-3009 nonce |
| 7P-6 | Low (mechanism) | RBTS settlement | Forfeits are charged on raw stake while rewards accrue on oracle-discounted weight — negative expected value for honest-but-correlated voters |
| 7P-7 | Low (latent) | RoundLib / ProtocolConfig | Two-tier epoch weighting, the 25% tier, and the inverted settlement tiebreak are unreachable under every valid config, yet advertised in NatSpec |
| 7P-8 | Low (view-only) | QuestionRewardPoolEscrow | Bundle claimable view returns 0 for auto-qualifiable claims; a dead preview branch diverges from actual recovered-allocation math |
| 7P-9 | Informational | ProtocolConfig | `minSlashEvidence` is entirely unvalidated in `_setSlashConfig` |
| 7P-10 | Informational | ClusterPayoutOracle | Split setters force re-supplying `challengeWindow` on bond-only rotations |
| 7P-11 | Informational | LaunchDistributionPool | Legacy-contributor sweep pays `governance` while the event names the recipient `treasury` |
| 7P-12 | Informational | ConfidentialityEscrow | `releaseBond` is pausable while escrow claims elsewhere deliberately are not; a long pause converts into an unconditional release |

## Findings

### 7P-1 — Ban resolution only fail-closes on the holder's address key (Medium, confidence: likely)

`RaterRegistry._identityForHolder` (lines 1452–1474) resolves an active-credential holder to `_canonicalHumanIdentityKey[holder]` (falling back to `credentialIdentityKey(provider, nullifier)`), and substitutes a banned key only when `isIdentityKeyBanned(addressIdentityKey(holder))` is true. When governance bans by credential nullifier (`banIdentity` → `_banCredentialNullifier`, lines 625–680), the active ban is written on the credential key and *derived* address-key bans propagate only to the current owner and the last-revoked owner recorded at ban time.

Two gaps follow. First, a holder whose canonical key was seeded from an earlier, different credential and never rotated resolves to that stale canonical key, which is not the banned key — downstream consumers (`ContentRegistry` submission gating, `AdvisoryVoteRecorder`) check the *resolved* key, so the ban does not bite. Second, `credentialIdentityKey` aliases `WorldIdV4 → WorldId`, but `_humanNullifierOwnerByProvider` and the derived-ban propagation are keyed on the raw, un-aliased provider, so a ban issued under one provider slot does not propagate address-key bans for an owner recorded under the aliased slot. Exploitability depends on a specific revoke/re-attest ordering, hence "likely" rather than "certain" — but the asymmetry is structural.

**Fix:** in `_identityForHolder`, when a credential is active, also test `isIdentityKeyBanned` on the aliased credential key and on `_canonicalHumanIdentityKey[holder]`, returning the banned key if any is set; and/or have `banIdentity` additionally write the ban on the current owner's *resolved canonical* key.

### 7P-2 — Delegate banned after activation keeps acting as the holder (Low, confidence: likely)

`setDelegate` / `acceptDelegate*` reject a delegate whose address key is banned *at activation time* (`RaterRegistry.sol` lines 796–814, `_validateDelegateActivation` 1487–1500), but `resolveRater(delegate)` thereafter resolves actor → holder and returns the holder's key with no re-check of the delegate address's ban status. Banning a misbehaving delegate wallet therefore does nothing while the delegation stands; governance must ban the holder's credential, over-penalizing the holder.

**Fix:** in resolution, when `delegated` is true, also test `isIdentityKeyBanned(addressIdentityKey(actor))` and fail closed to the banned address key.

### 7P-3 — Feedback bonuses on `Cancelled` rounds sweep to the treasury, not the funder (Low, confidence: certain)

`awardFeedbackBonus` requires round state ∈ {Settled, Tied, RevealFailed} (`FeedbackBonusEscrow._requireRevealedIndependentRater`, lines 518–523). `_markRoundCancelled` (`RoundVotingEngine.sol`) never sets `settledAt`, so for a `Cancelled` round `_feedbackBonusAwardDeadline` (lines 491–506) collapses to the original `feedbackClosesAt`, after which `forfeitExpiredFeedbackBonus` (lines 345–370) permissionlessly routes the full bonus to the treasury; the funder is refunded only in the treasury-unset fallback. In the x402 one-shot flow the payer attaches the bonus in the same signed payment as the question; if the question simply never attracts `minVoters` commits, the payer loses the bonus through no fault and with no anti-spam rationale (unlike the documented non-refundable bounty). Verified against `roundCore` state layout and both Tied/RevealFailed paths (which do set `settledAt`).

**Fix:** in `forfeitExpiredFeedbackBonus`, refund `pool.funder` when the target round terminated `Cancelled` (or never reached an awardable state); or document the sweep as intentional.

### 7P-4 — `_isVerifiedAnchorBanned` mis-decodes short returndata and is fail-open on revert (Low, confidence: certain)

`LaunchDistributionPool._isVerifiedAnchorBanned` (lines ~1453–1461) staticcalls `isIdentityKeyBanned(bytes32)` writing output over scratch `0x00` without checking `returndatasize()`. Scratch `0x00` holds the non-zero selector word, so a successful call returning fewer than 32 bytes (e.g. a rotated registry proxy with an empty-success fallback) decodes as `banned = true` for **every** anchor, silently zeroing distinct-anchor counting and dropping honest launch credits with no event. A reverting registry yields `banned = false` — the opposite polarity of `_isRaterBanned`, which is fail-closed. `setRaterRegistry` shape validation mitigates at set-time but not against post-set behavior changes.

**Fix:** require `returndatasize() == 32` before decoding, and unify failure polarity with `_isRaterBanned`.

### 7P-5 — `feedbackClosesAt` is not covered by the signed x402 nonce (Low, confidence: certain)

`X402QuestionSubmitter` derives `feedbackClosesAt = block.timestamp + roundConfig.maxDuration` at execution time (lines 392–393), while `_hashFeedbackBonusTerms` (lines 616–618) binds only `amount` and `awarder` into the deterministic EIP-3009 nonce. Whoever holds the payer's signature — facilitator or any front-runner, since the gateway entrypoints are permissionless — chooses *when* to execute within `[validAfter, validBefore]` and thereby shifts the feedback window the payer thought they were buying. All other payload fields are correctly nonce-bound (verified field-by-field).

**Fix:** include an absolute `feedbackClosesAt` (or a max-execution deadline) in `FeedbackBonusTerms` and the nonce preimage.

### 7P-6 — Forfeit base is raw stake; reward base is oracle-discounted weight (Low mechanism, confidence: certain on code, likely on impact)

In `RoundRevealLib._accumulateRbtsCommitScore` (lines 366–411), positive score-spread weight is computed from `commitRbtsWeight[commitKey]` — which the `PAYOUT_DOMAIN_RBTS_SETTLEMENT` snapshot replaces with the oracle's independence-discounted `effectiveWeight` — while the forfeit is computed from `roundCommits[commitKey].stakeAmount`, the raw stake. A heavily discounted voter keeps 100% of the downside (up to 50% of raw stake at 1.5× intensity) with upside earned only on the discounted weight: strictly negative expected value even under truthful play, and unknowable pre-commit because the snapshot lands post-reveal. As anti-sybil posture this is defensible (sybils get full downside, diluted upside), but honest-but-correlated voters — colleagues rating through one frontend — sit in the same bucket, and nothing in the docs prices this in for raters.

**Fix:** either scale the forfeit base by `effectiveWeight / baseWeight` (symmetric discount), or document the asymmetry explicitly as deliberate anti-sybil design so raters and frontend SDKs can surface it.

### 7P-7 — The two-tier epoch machinery is dead code advertised as live economics (Low latent, confidence: certain)

`ProtocolConfig._validateRoundConfig` (line 1128) requires `maxDuration == epochDuration` for every acceptable config, so `RoundLib.computeEpochIndex` can only return 0: every commit is epoch-1 at 100% weight. Consequently the 25% informed-voter tier (`RoundLib.epochWeightBps`), the `weightedUpPool != upPool` divergence, and the "smaller raw pool wins" inverted tiebreak in `settleRound` (`RoundVotingEngine.sol` lines 909–923) are all unreachable — with all-epoch-1 votes, equal weighted pools imply equal raw pools, so only the `Tied` branch can fire. Two subagents converged on this independently. NatSpec in `RoundLib`, `RewardMath` (the "4:1 reward ratio" header), and `RoundVotingEngine` describes economics that cannot occur, and if the config bound is ever relaxed, never-exercised settlement paths would silently activate — interacting badly with 7P-6 (epoch-2 voters would carry a 100% forfeit base at 25% reward weight, a 6× asymmetry before any independence discount). Related dead code: the unreachable `scoringClosed` branch and trailing `revert RoundNotOpen()` in `settleRound`, and the always-empty second epoch bucket iterated by `RoundCleanupLib._pastEpochUnrevealedCount` (lines 190–201).

**Fix:** either delete the tier and inverted tiebreak, or fence the NatSpec as "reserved for future multi-epoch configs" and add a regression test pinning `computeEpochIndex == 0` for all valid configs — decided *before* any future relaxation of the bound.

### 7P-8 — Bundle claimable view diverges from actual claim; dead preview branch (Low view-only, confidence: certain)

`QuestionRewardPoolEscrowBundleClaimableLib.claimableQuestionBundleReward` (lines 29–62) returns 0 whenever the round-set snapshot is not yet qualified, while the actual `claimQuestionBundleReward` (`BundleActionsLib` lines 462–479) auto-qualifies a complete pending round set and pays — integrators gating on the view will show 0 for claimable rewards (the pool-side view *does* simulate pending qualification, making the asymmetry surprising). Separately, `QuestionRewardPoolEscrowClaimLib._previewRoundAllocation` (lines 656–674) contains an unreachable `reopened && unallocatedRefunded` branch whose math does not match the live recovered-allocation logic in `QualificationLib` — dead code that will silently diverge if ever wired up.

**Fix:** simulate `_qualifyPendingBundleRoundSet` in the bundle claimable view; delete or align the dead preview branch.

### 7P-9 — `minSlashEvidence` unvalidated (Informational, confidence: certain)

`ProtocolConfig._setSlashConfig` bounds `slashThresholdBps`, `minSlashSettledRounds`, and `minSlashLowDuration`, but applies no validation to `minSlashEvidence` — governance can set 0 (slash-eligibility with essentially no evidence mass) or an unreachable extreme. Timelocked and governance-only, so a foot-gun rather than a vulnerability, but it is an asymmetry with `_setRatingConfig`'s careful lower bounds, and `contentSlashConfigSnapshot` freezes a bad value into all content created afterward. **Fix:** add floor/ceiling bounds matching the rigor of `_setRatingConfig`.

### 7P-10 — Oracle split-setter drift hazard (Informational, confidence: certain)

`setOracleConfig` (bond, recipient, *and* `challengeWindow`) and `setOracleTimingConfig` (both windows, no bond) partition the config such that a bond-only rotation must re-supply `challengeWindow`; a stale scripted value silently changes challenge timing for all future proposals, and no on-chain guard couples the windows to the 1-hour finality budget (enforced off-chain in `scripts/readiness-core.mjs`, an accepted control-plane choice). **Fix:** independent single-field setters, or read-current defaults.

### 7P-11 — Legacy sweep recipient naming (Informational, confidence: certain)

`sweepExpiredLegacyContributorAllocationToTreasury` (`LaunchDistributionPool.sol` lines 419–437) transfers to `governance` while emitting `LegacyContributorUnclaimedSwept(address indexed treasury, ...)`; other escrows read `protocolConfig.treasury()`. Fine if intended; the naming will mislead indexers.

### 7P-12 — `releaseBond` pausability asymmetry (Informational, confidence: certain)

`ConfidentialityEscrow.releaseBond` and `slashBond` both carry `whenNotPaused`, so a pause spanning `postedAt + maxBondLockDuration + evidenceWindow` freezes both sides while the evidence clock runs, converting into an unconditional release afterwards. `QuestionRewardPoolEscrow` deliberately leaves claims un-pausable. **Fix:** drop `whenNotPaused` from `releaseBond`, or document the asymmetry.

## Mechanism addendum — tournament transform (documented deviation, new nuances)

The core deviation — paying `max(0, score − LOO benchmark)` and slashing below-benchmark raters, rather than the positive-affine payment RBTS's Theorem 9 assumes — is already documented in `docs/design-review-2026-07.md` and is not re-raised as a finding. Two nuances from this pass's literature check are worth appending to that record:

- **Report externality on the benchmark.** The leave-one-out construction removes voter *i*'s own score from *i*'s benchmark but cannot remove *i*'s influence on *others'* scores — *i*'s revealed signal is the scoring outcome for whoever drew *i* as peer, and *i*'s prediction is the shadow base for whoever drew *i* as reference. Depressing peers' scores lowers *i*'s benchmark. In expectation each voter is peer/reference for ~1 other, so the distortion is bounded — but it is largest at exactly the small round sizes (n = 3–10) RBTS was chosen for. A two-group scoring split (score group A against group B's reports and vice versa) would restore the no-externality property at modest gas cost.
- **The herding equilibrium is exactly costless.** A coordinated all-identical-report round produces zero spread → zero forfeits, zero rewards, full stake return, while a truthful minority reporter bears forfeit risk. The independence-weight oracle and the ≥8-effective-units forfeit gate are the compensating controls; worth stating in the whitepaper that this equilibrium exists and what breaks it.

## Verified sound in this pass (so the next pass need not re-derive)

- **RBTS numerical core matches Witkowski–Parkes exactly** in BPS fixed point (shadow `y′ = y_j ± δ`, `δ = min(y_j, 1−y_j)`, binary quadratic rule, averaged — a positive-affine, IC-preserving change), with seeded-random distinct reference/peer and `MIN_RBTS_PARTICIPANTS = 3` matching the paper's small-population bound. The `[100, 9900]` prediction clamp is a strengthening (keeps δ ≥ 100 bps and strict signal incentives).
- **Math libraries are clean**: no division-by-zero on degenerate inputs (guards verified for 1-voter, all-identical, zero-weight cases), no overflow within parameter bounds, all divisions floor with no compounding bias, and per-round budget conservation is exact — Σ payouts = stake returns + caller incentive + 1% treasury + 3% platform + 96% voter pool, with the last claimant absorbing rounding residue so Σ claims ≤ pool always.
- **tlock/drand integration is correct against the drand spec**: `_roundAtOrAfter(revealableAfter)` is exactly the first beacon at/after epoch end (no early decryption), the +2-period cap prevents privately extended blindness, and per-round drand-config snapshots make a governance chain rotation (the fastnet-sunset scenario) safe for in-flight commits. Residual trust assumptions to document: League-of-Entropy threshold collusion breaks vote confidentiality (never fund safety), and a well-formed garbage ciphertext retains a reveal-or-abstain option at full-stake cost (existing L-Vote-1 note; README should state tlock reveal is best-effort).
- **World ID paths conform to ecosystem best practice** (on-chain signal from `msg.sender`, `keccak >> 8` hash-to-field, per-kind nullifier→owner maps, replay key over the full proof tuple). **EIP-3009 usage conforms** (`receiveWithAuthorization` payee-only defense; deterministic payload-bound nonce — note for SDK docs: two submissions differing only in salt must use distinct salts or the second authorization is unusable).
- **Escrow solvency invariants hold** through qualify → claim → recover → reopen → abandon → refund (double-spend blocked by pending-round guards; claim flags digest-keyed and cleared on recovery; CEI ordering with transient reentrancy guards at every token exit; griefing bounded by bundle/voter caps and minimum-funding floors).
- **Terminal-state liveness of the voting engine** rests on two `ContentRegistry` invariants — dormancy blocked once `revealedCount >= minVoters`, and `hasCommits` never cleared (blocking cancellation of committed content). Sound today; worth an explicit cross-contract invariant test, since a future change to either reopens a permanent fund-lock.
- **Previously reported, still open by design:** the governor lock cliff (`castVote` reverts if current balance < snapshot weight; fifth-pass note) is unchanged — the `min(weight, balance)` suggestion stands.

## Research sources

- Witkowski & Parkes, *A Robust Bayesian Truth Serum for Small Populations*, AAAI 2012 — https://cdn.aaai.org/ojs/8261/8261-13-11789-1-2-20201228.pdf
- Prelec, *A Bayesian Truth Serum for Subjective Data*, Science 2004 — https://www.science.org/doi/10.1126/science.1102081
- drand specification (round↔time mapping) — https://docs.drand.love/docs/specification/ ; timelock encryption — https://docs.drand.love/docs/timelock-encryption/ ; quicknet launch — https://docs.drand.love/blog/2023/10/16/quicknet-is-live/ ; fastnet sunset — https://docs.drand.love/blog/fastnet-to-be-sunset/
- tlock paper, ePrint 2023/189 — https://eprint.iacr.org/2023/189.pdf ; reference implementations — https://github.com/drand/tlock , https://github.com/drand/tlock-js
- World ID contracts reference — https://docs.world.org/world-id/reference/contracts ; World ID 4.0 spec — https://github.com/worldcoin/world-id-protocol/blob/main/docs/world-id-4-specs/README.md
- EIP-3009 — https://eips.ethereum.org/EIPS/eip-3009 ; Coinbase reference implementation — https://github.com/CoinbaseStablecoin/eip-3009/blob/master/contracts/lib/EIP3009.sol

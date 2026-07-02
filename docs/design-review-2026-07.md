# RateLoop Multi-Agent Design Review — July 2026

**Date:** 2026-07-01
**Scope:** Full protocol — Solidity contracts (`packages/foundry/contracts`, excluding vendored `lib/`), incentive/game-theoretic mechanism design, and off-chain infrastructure (`keeper`, `ponder`, `nextjs`, `sdk`, `agents`, `node-utils`, `contracts`).
**Method:** Three parallel read-only review agents (contracts, incentives, off-chain) plus external literature research, synthesized and spot-verified against the code by the lead agent.

---

## Provenance & authorship note

This review was requested by the repository owner on their own work, to keep improving RateLoop. Git history confirms single-author development: of ~3,800 commits, all substantive authorship resolves to David Hawig (`davidhawig@gmail.com`, also committing as `Noc2` and `David Hawig <david@davids-mbp...>`); the only other committers are `Cursor Agent` (16 commits) and `dependabot[bot]` (9 dependency bumps). There is no third-party protocol code under review here — every finding below is about the owner's own design.

### Which model did what

The user explicitly asked this to be recorded.

- **All research and analysis in this document was performed by Claude Fable 5** (`claude-fable-5-thinking-high`): the lead/orchestrator agent and all three review subagents (contracts, incentives, off-chain) ran on Fable 5. External literature research (peer-prediction / BTS and COCM/quadratic-funding sources) was also done on Fable 5.
- **No fallback to Claude Opus 4.8 (or any other model) was needed or used.**
- One tooling caveat, unrelated to model choice: the off-chain subagent's *detailed* report body repeatedly failed to transmit back through the subagent transport (only its short high-level summaries arrived). Rather than trust a summary alone, the lead agent (Fable 5) independently re-read the relevant off-chain code (`packages/keeper/src/correlation-*.ts`, `packages/node-utils/src/correlationScoring.ts`) and verified the off-chain findings directly before writing the "Off-chain / boundary" section. Those findings are therefore code-verified, not summary-only.

### Accepted-design constraints (out of scope, per `AGENTS.md`)

The following are intentional and were **not** treated as findings:

1. `ClusterPayoutOracle` payout roots are intentionally optimistic (bonded operators publish deterministic public artifacts, challengers recompute during the window, governance arbitrates, bad proposers lose reputation/fees/bond) — not per-snapshot economically secured.
2. Challenge bonds are anti-spam bonds (default 5 USDC = `5_000_000`), not payout-value coverage.
3. The 60-minute `revealGracePeriod` is an accepted product parameter even for long blind phases.
4. LREP transferability is intentional (portable governance/reputation).
5. Contracts are deployed in production; remediations note whether they need a governed upgrade/migration vs. a parameter/off-chain change.

---

## Executive summary

RateLoop is unusually well-hardened for a self-authored protocol. The contract layer shows evidence of multiple prior internal audit passes (findings are tagged inline: `M-Oracle-1/2`, `FE-1/2/5/6`, `L-Funds-1/3`, `L-Cleanup-1`, `L-Vote-B`), and nearly every classic on-chain failure mode already has an explicit, commented mitigation. The contracts review found **no Critical or High severity issues**. The off-chain stack is similarly disciplined: x402 payments are cryptographically bound to the question payload and the agent's local signer trusts nothing from the hosted API, so there is no operator custody or payment-redirection path.

The material weaknesses are concentrated in **economic / mechanism design**, not in code correctness. The single most important theme:

> **Single-task RBTS truthfulness is BNE-only: RateLoop's correlation snapshots and surprise-weighted bounties materially reduce detectable bloc economics, but they do not make truthful reporting dominant-strategy or uniquely payoff-maximizing against undetected coordination.**

The three headline items are:

1. **RBTS/public-rating correlation snapshots must stay live and canonical.** Current wiring can discount detected clusters before RBTS stake settlement and before public-rating evidence is applied; if that oracle path is unavailable or bypassed, the old raw-stake/raw-evidence coordinated-bloc risk reappears.
2. **Peer-prediction remains BNE-only.** A reward-seeking rater is expected, and RateLoop's rewards make honest independent reporting attractive under the model; the residual risk is that a credible, undetected coordinated bloc can still be a rational equilibrium in a single-task mechanism.
3. **Askers can recapture "non-refundable" bounties** through unlinked alt wallets that both vote and claim, for any pool without mandatory cluster-oracle gating (all LREP pools, and USDC pools where gating is optional).

Everything else is Medium or below: a snapshot-input determinism gap that weakened the challenge game before the July 2 remediation, keeper liveness hardening, a cluster-pinned-pool liveness dependency, and an assortment of monitoring/consistency cleanups.

---

## Part 1 — Smart contracts (Fable 5)

No Critical/High. Findings are Medium-at-most: liveness risks, monitoring gaps, and fragile cross-contract conventions worth a future governed cleanup.

**Implementation status (2026-07-02):** The smart-contract remediation pass was implemented for the next deployment. No
normal-path timing parameter was increased: the plan keeps current challenge/reveal UX and uses structural fixes,
keeper automation, and governance recovery runbooks instead of making users wait longer.

### M-1 (contracts). Cluster-pinned reward pools have a hard liveness dependency on snapshot proposers

- **Severity:** Medium (funds temporarily frozen; fully recoverable by governance; no third-party loss).
- **Where:** `QuestionRewardPoolEscrow.sol`; `libraries/QuestionRewardPoolEscrowQualificationLib.sol` (`_clusterRoundQualificationStatus` ~495–553, `requireNoPendingFinishedRound` ~95–125); `...PoolActionsLib.sol` (`_refundUnallocatedRewardPool` ~315–338); `...SnapshotConsumerLib.sol` (`repoint` ~23–55).
- **Scenario:** For a pool pinned to a `ClusterPayoutOracle`, a settled cursor round cannot be qualified, skipped, or advanced past until the oracle holds a Finalized (or Rejected) snapshot for it. `_clusterRoundQualificationStatus` returns `roundFinished=false` when `getRoundPayoutSnapshot` reverts `SnapshotNotFound` (catch ~550), so `advanceQualificationCursor` stalls and `requireNoPendingFinishedRound` reverts every refund path with `RewardPoolCursorNeedsAdvance`. If no bonded frontend ever proposes a snapshot (frontend set winds down, all deregister), both voter payouts and the residue sweep freeze indefinitely.
- **Status:** Fixed for the next deployment without adding a long timeout. `QuestionRewardPoolEscrow` now has governance-only `skipPreQualificationSnapshotlessClusterRound(rewardPoolId, roundId)` for source-ready/raw-eligible cluster-pinned cursor rounds where the pinned oracle has no payout-root proposal. It preserves the option to repoint to a replacement oracle before refund finality, and blocks repointing after `refunded` / `unallocatedRefunded`.

### L-1 (contracts). Correlation-epoch and round-payout challenge windows run fully concurrently

- **Severity:** Low (parameter risk).
- **Where:** `ClusterPayoutOracle.sol` — `proposeRoundPayoutSnapshot` (~430–544) accepts proposals against a merely-`Proposed` epoch (~435); `setOracleConfig` (~213–224) bounds `challengeWindow ≤ 3 days`, `DEFAULT_CHALLENGE_WINDOW = 2 hours`.
- **Scenario:** A proposer submits the correlation epoch and all dependent round snapshots in one block; both layers' 2-hour windows expire simultaneously, so a human challenger who must fetch the artifact, recompute the deterministic scorer output, and fund a USDC bond gets one 2-hour (possibly overnight) window to catch errors at either layer. The 7-day `FINALIZATION_VETO_WINDOW` backstops this, but converts a permissionless check into a trusted (arbiter) one.
- **Status:** No parameter increase made, per UX review. The docs now explicitly frame this as an optimistic trust model with the existing veto/governance backstop, not as a reason to make normal bounty claimants wait longer.

### L-2 (contracts). Narrowed `roundCore` interface re-declarations are ABI-fragile across future engine upgrades

- **Severity:** Low (currently safe; latent fail-closed hazard).
- **Where:** `ConfidentialityEscrow.sol` (`IConfidentialityRoundState.roundCore`, 24–35; used ~555, ~589), `interfaces/ILaunchDistributionPool.sol` (`IRoundClusterReadyAtSource.roundCore`, 21–32; consumed via raw `staticcall` in `LaunchDistributionPool._roundCoreSettledAtView` ~1061–1075) vs. `RoundVotingEngine.roundCore` (1593–1605) which returns **8** values (adds `uint8 upWins`).
- **Verified safe today:** Solidity tolerates extra trailing static return data, so the 7-tuple `try` decode reads the first 7 words correctly and `LaunchDistributionPool` reads `settledAt` at offset 224 with a `length >= 224` check.
- **Risk:** silent coupling. If a future engine upgrade reorders/shrinks `roundCore`, the consumers flip fail-closed (`catch → false`), which for `ConfidentialityEscrow` means confidentiality bonds become unreleasable until another wiring fix ships.
- **Status:** Fixed for the next deployment. All `roundCore` consumers now use the canonical 8-return tuple including trailing `uint8 upWins`, and the contracts package has an ABI invariant test.

### L-3 (contracts). `ContentRegistry.setTreasury` writes via raw `sstore` with no event

- **Severity:** Low (monitoring gap on a fund-flow-critical address).

```504:509:packages/foundry/contracts/ContentRegistry.sol
    function setTreasury(address _treasury) external onlyRole(TREASURY_ROLE) {
        assembly ("memory-safe") {
            if iszero(_treasury) { revert(0, 0) }
            sstore(treasury.slot, _treasury)
        }
    }
```

- **Scenario:** `ProtocolConfig.setTreasury` emits `TreasuryUpdated` (643–647); the registry twin emits nothing, so monitors watching for treasury rotation miss a registry-level rotation and forensics lose the trail. `TREASURY_ROLE` is trusted, so this is not an access-control issue.
- **Status:** Fixed for the next deployment. `ContentRegistry.setTreasury` emits `TreasuryUpdated(address)` and the ABI/tests were updated.

### L-4 (contracts). Qualification/bundle iteration gas scales with `commitCount × external calls`; the 200-voter cap is near practical limits

- **Severity:** Low (bounded DoS-adjacent; confidence medium — not gas-profiled).
- **Where:** `QuestionRewardPoolEscrowQualificationLib.sol` — `qualifyRound` runs two full passes (`_countEligibleRevealedVoters` ~596–616, `_markEligibleRevealedVoters` ~618–636) over up to `MAX_REWARD_POOL_ROUND_VOTERS = 200` commits, each ~6–10 staticcalls plus up to two ban lookups across two registries; bundle qualification multiplies by bundle question count.
- **Scenario:** The first claimant on a 200-voter round pays full qualification cost inside `claimQuestionReward`. Fine on a cheap L2; near an L1-style 30M gas limit a large bundle could make first-claim/refund un-mineable.
- **Status:** Operational fix implemented without changing voter caps. Ponder `/keeper/work` now surfaces bounded `rewardPoolQualifications` and `bundleTerminalSyncs`; the keeper proactively calls `qualifyRound` and `syncQuestionBundleTerminals` with per-tick gas controls and metrics.

### L-5 (contracts). `finalizeRevealFailedRound` quorum coupling with `ProtocolConfig` bounds was load-bearing

- **Severity:** Low (acknowledged in code; re-flagged as a governance tripwire).
- **Where:** `RoundVotingEngine.sol` 985–999 uses raw `roundCfg.minVoters` as reveal quorum, safe only because `ProtocolConfig._validateRoundConfigBounds` enforces `minSettlementVoters >= 3 == MIN_RBTS_PARTICIPANTS`. If governance relaxes that bound without touching the engine, rounds with `revealedCount ∈ [minVoters, 3)` get permanently stuck (`ThresholdReached` here while RBTS scoring rejects settlement), locking stakes.
- **Status:** Fixed for the next deployment without raising the normal quorum. `ProtocolConfig` still refuses `minSettlementVoters < 3`, and `RoundCreationLib.snapshotRoundVotingConfig` now refuses to snapshot any content round config below the RBTS participant floor before stake can enter a round. The engine keeps the size-safe raw `minVoters` hot path because every reachable round snapshot is now guaranteed to satisfy `minVoters >= MIN_RBTS_PARTICIPANTS`.

### L-6 (contracts). Arbiter rejection of a partially-claimed snapshot permanently strands remaining claimants' shares

- **Severity:** Low (inherent to the accepted M-Oracle-2 veto semantics; flagged for documentation).
- **Where:** `ClusterPayoutOracle._rejectFinalizedRoundPayoutSnapshot` (~672–722); `QuestionRewardPoolEscrowRecoveryLib.recoverRejectedSnapshotRound` requires `!snapshot.firstClaimPaid` (line 130).
- **Scenario:** A snapshot finalizes, some voters claim, and within the 7-day veto window the arbiter attempts to reject it (or its correlation epoch). Before the fix, future claims could revert at `verifyPayoutWeight`; recovery was blocked by `firstClaimPaid`; the unclaimed remainder sat until `claimDeadline + 7 days`, then swept to funder/treasury.
- **Status:** Fixed for the next deployment. The oracle now rejects a finalized payout snapshot only while the configured consumer has not consumed it; once consumed, `rejectFinalizedRoundPayoutSnapshot` reverts immediately.

### Informational (contracts)

- **I-1:** Fixed. `QuestionRewardPoolEscrow._getExistingRewardPool` and `_getExistingBundleReward` now use typed custom errors.
- **I-2:** Fixed. The generated ABI test now guards indexer-critical escrow event schemas against parameter-order drift.
- **I-3:** Documented. `RoundVotingEngine.setRole`/`_grantRole` emit the custom `RoleUpdated` log rather than OZ `RoleGranted`/`RoleRevoked`; contract docs now call this out.
- **I-4 (verified working-as-designed trust assumptions):** `RaterRegistry.SEEDER_ROLE` can seed human credentials without proof (fully trusted); voters naming an ineligible frontend receive the frontend fee themselves at claim time (self-serve voters strictly out-earn frontend-routed ones by the fee); a slashed proposer self-challenging via a fresh wallet recovers ≤50% (`CHALLENGER_BOUNTY_BPS = 5000`); `ProfileRegistry._migrateProfileForIdentityKey` silently consumes an old wallet's profile name on World ID re-verification from a new wallet.

### Cross-contract consistency notes (contracts)

1. **Ban-check quadruplication:** the snapshot-registry-then-current-registry ban check with fail-open `catch` is copy-pasted in ≥4 places (`QuestionRewardPoolEscrow.sol` ~661–692, `QualificationLib` ~666–686, `BundleActionsLib` ~1418–1440, reward distributor). Identical today; any change must touch all copies. Consolidate into a shared library on a future upgrade.
2. **`"rateloop.address-identity-v1"` domain string** is independently re-derived in `QuestionRewardPoolEscrow`, `...VoterLib`, and `RaterRegistry`; `ProfileRegistry._validateRaterRegistry` validates against the literal. Consistent; a constants library would remove drift risk.
3. **"Failed window" encoding** (`bountyOpensAt > bountyClosesAt`) is an implicit protocol-wide convention (`WindowLib.activateRewardPoolWindowForRound` 55–69). Document it in `QuestionRewardPoolEscrowTypes.sol`.
4. **Quorum constant coupling:** five independent `3`s (`MIN_EFFECTIVE_PARTICIPANT_UNITS`, `MIN_REQUIRED_VOTERS`, engine `MIN_RBTS_PARTICIPANTS`, `ProtocolConfig.minSettlementVoters >= 3`, and `RoundCreationLib.MIN_RBTS_PARTICIPANTS`) must move together; the next deployment adds a round-snapshot guard so below-floor configs fail before a voting round opens (see L-5).
5. **Stale-engine/escrow guards are consistent** with the `AGENTS.md` governance-rotation model — escrow/bonus/oracle pins all fail closed on rotation, matching the "coordinated redeploy, not registry-only rotation" runbook.

---

## Part 2 — Incentives & mechanism design (Fable 5)

Mechanism as implemented: a binary Robust Bayesian Truth Serum (RBTS) turned into a **relative, zero-sum tournament** — raters are scored by RBTS against a leave-one-out, stake-weighted mean of RBTS scores; below-benchmark raters forfeit stake (<=50%) that redistributes to above-benchmark raters. The transform is monotone, so for a lone rater facing honest peers, truthful reporting is a best response. The problems live in the coordinated / sybil / relative-payoff regime. Current correlation-snapshot wiring is a real mitigation for detected clusters, but it is not the same claim as dominant-strategy truthfulness.

**Verified against code:** RBTS scoring `RobustBtsMath.scoreBps` (49-58); prediction clamp `[100, 9900]` (`requireValidUserPrediction` 25-29); leave-one-out stake-weighted benchmark `RewardMath.calculateLeaveOneOutMeanScoreBps` (75-90); forfeit `stake * 1.5 * (benchmark - score)` capped at 50% and gated by `revealedCount >= SCORE_SPREAD_FORFEIT_MIN_REVEALS = 8` (`calculateNegativeScoreSpreadForfeit` 110-122); raw vote weight begins as epoch-weighted stake, but `PAYOUT_DOMAIN_RBTS_SETTLEMENT` can replace `commitRbtsWeight` with oracle-proven `effectiveWeight` before scoring; public rating evidence is also applied through a separate finalized `PAYOUT_DOMAIN_PUBLIC_RATING` snapshot; USDC/question-bundle bounty weights get surprise-weighted base weights multiplied by the same independence signal.

### H-1 (incentives). RBTS and public-rating cluster protection depends on live correlation snapshots

- **Severity:** High if the snapshot path is disabled or unavailable; otherwise Medium residual risk; confidence High.
- **Redeploy status:** implemented as the intended production path for the fresh deployment. Non-tied rounds enter `SettlementPending`; LREP stake accounting waits for finalized `PAYOUT_DOMAIN_RBTS_SETTLEMENT` weights; public rating movement waits for `PAYOUT_DOMAIN_PUBLIC_RATING`; docs, keeper, Ponder, API, and UI surfaces now expose the pending state instead of implying instant reward finality.
- **Mechanism:** the design puts a round into `SettlementPending`, requires a finalized `PAYOUT_DOMAIN_RBTS_SETTLEMENT` root, replaces each revealed report's RBTS weight with the oracle's effective independence weight, and enables forfeits only after at least 8 effective participant units. Separately, `PAYOUT_DOMAIN_PUBLIC_RATING` applies adjusted up/down evidence before the canonical rating moves. This directly addresses the original "raw-stake sybil bloc sets the benchmark and rating" concern for detectable clusters.
- **Residual attack:** a bloc that is genuinely independent by the observable features, or that successfully avoids the scorer's cluster features, still looks like independent agreement. In that case the RBTS benchmark, public-rating evidence, and bounty weights can still be moved by coordinated reports. The protocol can reduce detectable cluster economics; it cannot prove that reports were independently generated.
- **Timeout/liveness caveat:** after the RBTS snapshot timeout, `applyRbtsSettlementSnapshot(contentId, roundId, [], [])` returns revealed stakes and completes settlement without score-spread rewards or forfeits. This prevents indefinite lockup, but it is a safety valve, not an equivalent incentive layer.
- **Refs:** `RoundVotingEngine.applyRbtsSettlementSnapshot`; `RoundRbtsSettlementSnapshotLib.applySnapshotWeights`; `ContentRegistryRatingSnapshotLib.applyRatingPayoutSnapshot`; `correlationScoring.scoreRoundRatingWeights`; `correlationScoring.scoreRoundPayoutWeights`.
- **Remediation:** keep RBTS/public-rating snapshot publication on the critical path for production, alert on `SettlementPending` age and timeout fallback, pin canonical correlation inputs, and make large-value bounty policies require finalized correlation roots. Treat scorer-feature expansion and verified-human floors as governance-tunable mitigations, not proofs of independence.

### H-2 (incentives). Single-task RBTS truthfulness is BNE-only; correlation/surprise mitigate but do not eliminate coordinated equilibria

- **Severity:** High theoretical limitation, Medium operational residual after correlation gates; confidence High (confirmed against literature and implementation).
- **Mechanism:** RBTS is Bayes-Nash incentive compatible under the independent-rater model, but not dominant-strategy truthful and not uniquely payoff-maximizing across all equilibria. Because rewards are exactly what raters care about, a credible "vote the coordinated side and predict the coordinated share" convention can be rational when the mechanism cannot distinguish it from independent agreement.
- **How existing layers help:** correlation snapshots reduce detected cluster weight before RBTS stake settlement and before public-rating evidence moves; surprise-weighted bounties reward agreement that is high relative to the trailing base rate, but only after multiplying by independence and only in bounty payout domains; launch credits use flat base weights plus independence. These are meaningful economic mitigations, especially for sybils and obvious operator/wallet clusters.
- **What remains accepted:** truthfulness is BNE-only for the current single-task mechanism. The accepted residual risk is an undetected or genuinely independent coordinated bloc that can still herd on one report/prediction strategy and earn rewards because its coordination is not visible to the scorer.
- **External grounding:** Witkowski & Parkes (RBTS, AAAI 2012) establish small-population RBTS truthfulness under the standard model, while later peer-prediction literature emphasizes equilibrium multiplicity and non-truthful/blind-agreement equilibria. Dasgupta-Ghosh, Correlated Agreement, DMI, and related multi-task mechanisms are the natural upgrade family when the product wants stronger truthfulness/focality guarantees.
- **Decision / remediation:** document this as an accepted residual risk for current single-task RBTS, with correlation snapshots, surprise-weighted bounty claims, blind commit-reveal, stake caps, verified-human policy, and public auditability as mitigations. Keep multi-task / DMI / CA-style scoring on the roadmap for a future high-assurance mode instead of claiming the current mechanism is collusion-proof.

### M-1 (incentives). Asker recaptures a "non-refundable" bounty via unlinked alt wallets

- **Severity:** Medium–High; confidence High.
- **Status as of July 2, 2026:** remediated for the fresh redeploy path by requiring `BOUNTY_ELIGIBILITY_VERIFIED_HUMAN` on non-refundable bounties at or above the 500 USDC/LREP (500,000,000 atomic-unit) recapture threshold across direct, escrow, bundle, x402, agent, and UI submission paths. Everyone can still answer; the restriction is on bounty-claim eligibility.
- **Mechanism:** `VotePreflightLib._validateVoterAndContent` (102–108) blocks self-voting only when the actor address, resolved identity holder, or submitter identity key matches; a fresh wallet with no credential and no linked identity matches none. The claim path excludes only funder/submitter identity. So an asker funds M alt wallets, votes to satisfy the participant floor (`QuestionRewardParticipantFloorLib` 3/5/8), and claims shares.
- **Numbers:** 500 USDC bounty, equal-share, `MIN_REWARD_POOL_PARTICIPANTS = 3` ⇒ 3 alts recapture ~100% minus frontend fee (≤5%) and gas. Cluster-gated pools *may* discount them only if the alts share detectable correlation features; independent-looking fresh wallets get full weight. **LREP bounties and any pool without a cluster oracle have no such protection.**
- **Refs:** `VotePreflightLib.sol` 99–109; `QuestionRewardParticipantFloorLib.sol` 13–17; `QuestionRewardPoolEscrowClaimLib._isExcludedClaimant` (funder/submitter identity only).
- **Residual:** verified-human eligibility reduces cheap unlinked recapture without adding wait time, but it is still a claimant-policy mitigation rather than cryptographic proof that the asker did not coordinate with eligible humans.

### M-2 (incentives). Surprise-weighting rewards coordinated flooding of low-base-rate sides

- **Severity:** Medium; confidence Medium.
- **Status as of July 2, 2026:** remediated for the fresh redeploy path in `rateloop-correlation-epoch-v4`. The scorer now scales surprise bonus by independence, applies a verified/high-independence anchor factor when a side floods above its trailing base rate, and caps each detected same-side cluster's aggregate surprise bonus to one independent-vote budget.
- **Original mechanism:** the old `surprise = agreement / baseRate` rule could let a bloc voting the side rare in the trailing-100-round base rate but common this round make every member "surprisingly popular" and all hit the cap.
- **Residual:** genuinely independent-looking or undetected coordinated voters can still earn surprise weight, and an attacker controlling enough rounds can still drift the trailing base rate (`baseRateWindowRounds = 100`, clamped `[500, 9500]`). This is a scoring hardening, not a collusion-proof truthfulness guarantee.

### M-3 (incentives). Governance capture via cheap LREP relative to a 0.1% quorum floor

- **Severity:** Medium; confidence Medium.
- **Mechanism:** `MINIMUM_QUORUM = 100_000 LREP` = 0.1% of the 100M cap; proposal threshold 1,000 LREP. Early on, ~75M sits in the launch pool (excluded from quorum), so the absolute floor governs. With LREP transferable (accepted), a modestly-capitalized actor can accumulate 100k+ and, on low turnout, pass proposals during bootstrap. Governance controls slashing, the oracle arbiter, and `ProtocolConfig` — so a captor could lower `minSettlementVoters`, arbitrate challenged roots in their own favor, or slash competitors and route the 50% challenger bounty to themselves.
- **Refs:** `RateLoopGovernor.sol` 48–52, 193–206; 7-day vote lock (262–279) is the main friction.
- **Remediation:** raise the bootstrap quorum floor or scale it to distributed (not just circulating) supply; use a separate, higher quorum/timelock for slashing and arbiter actions than for routine config.

### Low / Informational (incentives)

- **L (parimutuel vestigial):** `binaryLosingPool`/`upWins` is computed for public-verdict telemetry but drives no forfeiture. The redeploy docs and contract comments now separate public verdict closure from RBTS score-spread LREP accounting. The actual anti-herding / anti-cluster levers are blind commit-reveal, epoch-weighting, RBTS/public-rating snapshot weights, and bounty/launch independence weights.
- **L (dead economic zone):** `minSettlementVoters ≥ 3` but forfeits require ≥ 8 reveals. Rounds with 3–7 revealers settle, move the public rating, and consume bounties, but produce **zero forfeits and zero RBTS rewards** — no incentive to stake accurately in exactly the thin rounds where manipulation is cheapest.
- **L (weak PRNG pairing):** reference/peer draws come from a delayed-blockhash seed. On Base's centralized sequencer, the block producer can bias *pairings* (hence the RBTS reward split, not the rating outcome). Value at stake per round is tiny; the pairing sensitivity slightly amplifies H-1.
- **L (advisory/launch farming):** throttled (3 unverified credits/round, 25 raters/anchor, ≥2 anchors, score ≥7000 bps, first-100 cap 500 LREP ⇒ ≤125 LREP for an unverified sybil) but not eliminated — two colluding verified humans can run a slow farm. Referral farming is genuinely gated by World ID nullifier uniqueness (`MAX_REFERRAL_REWARD_PER_REFERRER = 10,000 LREP`), which is good.
- **I (doc vs. math):** the one-paragraph framing "scored against the stake-weighted mean **prediction**" is imprecise — implementation scores against the leave-one-out stake-weighted mean of **RBTS scores**. `how-it-works.md` is accurate; the summary framing isn't.
- **I (high-variance scoring):** at 8 reveals, single reference + single peer means an honest accurate rater can be unlucky and forfeit. Unbiased but noisy; more sampled peers would cut honest forfeiture variance (at gas cost).

### Open questions for the owner (incentives)

1. Is the RBTS/public-rating correlation snapshot path mandatory for all production asks, or can governance intentionally run with raw stake/evidence plus the 14-day RBTS timeout fallback?
2. Should cluster-oracle gating be mandatory for USDC pools above some size, or is per-pool optionality (M-1) intended?
3. What turnout is assumed for the bootstrap governance window (M-3)? Is the 100k floor sized against an expected adversary capital budget?
4. Is moving off single-task RBTS toward a multi-task/DMI/CA mechanism (H-2) on the roadmap, or is undetected coordinated-bloc risk explicitly accepted after the current correlation/surprise mitigations?

---

## Part 3 — Off-chain / on-chain boundary (Fable 5, code-verified by lead)

> Note: the off-chain subagent's detailed body did not transmit back through the tooling; the lead agent (Fable 5) re-read `packages/keeper/src/correlation-ponder-freshness.ts`, `build-correlation-artifact.ts`, `correlation-artifact-builder.ts`, and `packages/node-utils/src/correlationScoring.ts` to verify these directly.

**Trust map (brief):** the local agent signer trusts nothing from the hosted API — x402 payments are cryptographically bound to the question payload, so a malicious hosted API cannot redirect funds or take operator custody (verified: agents sign EIP-3009/x402 authorizations locally against on-chain-derived values). The keeper trusts Ponder for *work discovery* but re-reads chain state (`readRound`) before acting. Ponder/Postgres are read-model conveniences, not fund authorities; on-chain escrow accounting is the source of truth for payouts.

### M-1 (off-chain). Correlation snapshot inputs are read at query time, not pinned per round — two honest operators can compute different payout roots

- **Status as of July 2, 2026:** remediated for the fresh redeploy path. Ponder persists correlation-scoring inputs at the source event (`RoundSettled` for round domains, pending launch-credit event for launch credits), the keeper requires those `inputSnapshot` refs in `rateloop-correlation-artifact-v3`, and the epoch `parameterHash` commits to both scoring params and pinned snapshot refs. Routes fail closed when the persisted input snapshot is missing.
- **Severity:** Medium; confidence High (code-verified).
- **Mechanism:** the artifact builder scores each vote using `verifiedHuman`, `historicalVoteCount`, cluster features, and exclusion/ban reasons fetched live from Ponder (`fetchRoundVotes` in `correlation-artifact-builder.ts`), and the independence multiplier depends directly on those time-varying inputs:

```611:633:packages/node-utils/src/correlationScoring.ts
function independenceForVote(
  vote: CorrelationVoteInput,
  clusterSize: number,
  params: CorrelationScoringParams,
): { independenceBps: number; reasons: readonly string[] } {
  const floor = vote.verifiedHuman
    ? params.verifiedFloorBps
    : params.unverifiedFloorBps;
  const clusterBps =
    clusterSize <= params.maxClusterSizeWithoutDiscount
      ? 10_000
      : Math.floor(10_000 / Math.sqrt(clusterSize));
  const maturityBps = vote.verifiedHuman
    ? 10_000
    : Math.floor(
        (Math.min(vote.historicalVoteCount, params.minUnverifiedMaturityVotes) *
          10_000) /
          params.minUnverifiedMaturityVotes,
      );
  const independenceBps = Math.max(
    floor,
    Math.min(10_000, clusterBps, maturityBps),
  );
```

  `historicalVoteCount` grows over time and `verifiedHuman` flips when a rater verifies later, so an operator scoring the same round at T1 vs. T2 can legitimately produce a **different `weightRoot`**. The `now` parameter (`ponderNowSeconds`) is threaded through freshness and vote queries to pin time-relative exclusions, and `parseRoundContextQuestionMetadataRef` deliberately drops `targetAudienceHash` "so payout roots stay reproducible" — evidence the determinism boundary is understood — but the *maturity/verification* inputs themselves are not snapshotted at a canonical block.
- **Why it matters for the challenge game:** the optimistic model assumes a challenger who recomputes the artifact gets the *same* root as an honest proposer. If honest recomputation legitimately diverges (because the rater's maturity/verification state advanced), a correct proposer can be challenged, or a challenger can't reproduce a correct root — weakening the "recompute and challenge" guarantee that underpins the accepted trust model.
- **Remediation:** implemented off-chain. The persisted snapshot includes `historicalVoteCount`, `verifiedHuman`, credential provider/nullifier/timestamps, active ban reasons, and source block/tx/log/timestamp. The public artifact keeps the on-chain publish shape unchanged while storing the pinned refs in the challenge artifact and verifier. No contract change required for the future deployment.

### M-2 (off-chain). Single-keeper liveness on a long settlement clock

- **Severity:** Medium; confidence Medium.
- **Mechanism:** settlement, unrevealed-commit cleanup, dormancy marking, and snapshot publication all depend on the keeper running. The README documents multi-replica operation (different wallets, `KEEPER_STARTUP_JITTER_MS`, `KEEPER_DATABASE_URL` advisory locks) and duplicate on-chain attempts revert, but a fully-down keeper stalls settlement and (via M-1 contracts) can freeze cluster-pinned pools. Users can self-settle eligible rounds on-chain, which mitigates the worst case, but routine liveness leans on the operator.
- **Status as of July 2, 2026:** operational remediation implemented. The keeper/Ponder path now exposes `settlementReadyAt` and `keeper_settlement_backlog_oldest_seconds`, README runbooks call out two independent replicas with separate keys, and public/operator docs explain that `settleRound(contentId, roundId)` is permissionless self-settlement when automation is delayed.

### Consistency / drift notes (off-chain)

- Duplicated constants between `node-utils/correlationScoring.ts` and keeper modules (`CORRELATION_VOTE_PAGE_SIZE`, `PONDER_HTTP_FETCH_TIMEOUT_MS`, payout-domain enums) are currently imported from the shared package — good; keep them single-sourced and resist re-hardcoding in Ponder/nextjs.
- The Ponder freshness gate (`areCorrelationCandidatesPonderFresh`) correctly defers artifact builds until Ponder reflects chain `state`/`revealedCount`/`voteCount` and reconstructs correlation-eligible votes without truncation — a solid guard against indexing-lag-driven bad roots. The `--skip-ponder-freshness` manual-recovery flag is appropriately warned.
- Address/decimal/duration constants for contracts flow from `@rateloop/contracts`; env overrides are documented as local/recovery-only. Verify `docs/env-parity.md` stays in lockstep when durations change.

### Strengths (off-chain)

- x402/EIP-3009 payments bound to payload; local signer trusts nothing from the hosted API (no operator custody path).
- Freshness gate prevents indexing-lag bad roots; bounded response reads (`PONDER_JSON_MAX_BYTES`, page/size caps) prevent memory blowups from a hostile API.
- Deterministic canonical JSON + parameter hash + scorer/eligibility/feature version stamps in every artifact, with a candidate fingerprint and v3 pinned input snapshot refs — strong reproducibility scaffolding.

---

## Positive observations (whole protocol)

- **Reentrancy discipline:** `nonReentrant` (transient-storage variant) on every fund-moving entrypoint; CEI ordering explicitly commented in oracle challenge paths.
- **Token hygiene:** exact-amount pulls with balance-delta checks; `tryTransfer` verifies recipient delta and reverts on short transfers; `recoverNonAssetToken` refuses protocol assets.
- **Failure-tolerant transfers:** blocked frontend fees redirect to the voter with lockstep bucket corrections; failed treasury forfeits accumulate with a permissionless retry; slash recipient is rotatable so a reverting recipient can't brick slashing.
- **Oracle robustness:** pull-based bond withdrawals; consumer calls wrapped in `try/catch` with separate consumed tracking; rejected roots tracked at payload and root granularity; stale snapshots auto-rejected on re-proposal; sorted-unique source-set insertion.
- **Recovery machinery:** the rejected-snapshot recover → reopen → requalify pipeline with cursor-never-rewinds invariants is thorough.
- **Governance:** dynamic quorum excludes protocol-controlled balances with a bootstrap floor; proposal descriptions must embed the proposer suffix (front-run/grief protection); LREP forces self-delegation and disables `delegateBySig`; `setRole` includes an admin self-lockout guard.
- **Commit-reveal integrity:** tlock ciphertext shape/target-round validation, drand chain-hash binding re-checked at reveal, two-phase settlement with post-quorum seed entropy, permit front-running tolerance, RBTS clamps against degenerate 0%/100% reports.
- **Upgrade hygiene:** `_disableInitializers()` everywhere, storage gaps, ERC-7201 unstructured storage in the engine, config setters that probe the counterparty's selector shape before pointing at it.
- **Self-documentation:** inline audit-finding IDs at the exact mitigation site — several candidate findings turned out to be already-fixed items verifiable against their tags.

---

## Prioritized recommendations

1. **Keep RBTS/public-rating correlation snapshots mandatory and monitored (H-1 / incentives-open-Q1).** Implemented for the fresh redeploy; the remaining work is making sure the configured oracle path, canonical input snapshots, alerts, and timeout runbook are production-grade.
2. **Done for fresh redeploy: pin correlation scoring inputs to the source event (M-1 off-chain).** Keep artifact v3, scorer v4, and Ponder snapshot persistence as required deployment gates.
3. **Document that RBTS truthfulness is BNE-only after mitigations (H-2).** Correlation snapshots and surprise-weighted bounties help materially; undetected coordinated blocs remain an accepted residual risk, with multi-task/DMI/CA as the upgrade path.
4. **Done for fresh redeploy: close the alt-wallet bounty-recapture path (M-1 incentives):** verified-human claim eligibility is required for threshold-sized non-refundable USDC/LREP bounties.
5. **Write the cluster-pinned-pool zero-proposer runbook now (M-1 contracts)** and add the fork-test invariants for the quorum coupling (L-5) and `roundCore` ABI coupling (L-2).
6. **Done for fresh redeploy: reconcile docs with implementation:** public verdict, RBTS score-spread settlement, and pending reward finality are now documented separately.
7. **Operational hardening:** keep ≥2 keeper replicas with separate keys, `keeper_settlement_backlog_oldest_seconds` alerting, treasury-rotation log monitoring, and clear escalation for challenged payout roots. Do not increase normal-path challenge windows unless governance later decides the extra user wait is worth it.

---

*Prepared by a Claude Fable 5 multi-agent review (orchestrator + contracts, incentives, and off-chain subagents, all Fable 5). No fallback to Claude Opus 4.8 was used. External sources: Witkowski & Parkes, "A Robust Bayesian Truth Serum for Small Populations" (AAAI 2012) and "…for Non-Binary Signals" (AAAI 2013); Prelec, "A Bayesian Truth Serum"; Gitcoin/RadicalxChange "Beyond Collusion Resistance" (Connection-Oriented Cluster Match) and Gitcoin COCM writeups.*

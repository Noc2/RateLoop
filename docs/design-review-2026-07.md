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

> **The COCM cluster/correlation protection exists only off-chain (USDC bounties + launch credits). The on-chain LREP RBTS settlement — which moves stake and sets the public rating — has no cluster discount at all; its only sybil brake is the 10-LREP-per-identity stake cap and a 24h cooldown.**

The three headline items are:

1. **On-chain RBTS forfeiture has no sybil/cluster discount** (High for signal integrity; bounded in $ by the 10-LREP cap). A coordinated bloc dominates the stake-weighted benchmark and extracts honest minority raters' forfeited stake while setting the public rating.
2. **Peer-prediction admits a "vote the coordinated majority" equilibrium** that dominates truthful voting once any bloc exists — an inherent single-task RBTS property, confirmed against the literature.
3. **Askers can recapture "non-refundable" bounties** through unlinked alt wallets that both vote and claim, for any pool without mandatory cluster-oracle gating (all LREP pools, and USDC pools where gating is optional).

Everything else is Medium or below: a snapshot-input determinism gap that weakens the challenge game, keeper single-point-of-failure liveness, a cluster-pinned-pool liveness dependency, and an assortment of monitoring/consistency cleanups.

---

## Part 1 — Smart contracts (Fable 5)

No Critical/High. Findings are Medium-at-most: liveness risks, monitoring gaps, and fragile cross-contract conventions worth a future governed cleanup.

### M-1 (contracts). Cluster-pinned reward pools have a hard liveness dependency on snapshot proposers

- **Severity:** Medium (funds temporarily frozen; fully recoverable by governance; no third-party loss).
- **Where:** `QuestionRewardPoolEscrow.sol`; `libraries/QuestionRewardPoolEscrowQualificationLib.sol` (`_clusterRoundQualificationStatus` ~495–553, `requireNoPendingFinishedRound` ~95–125); `...PoolActionsLib.sol` (`_refundUnallocatedRewardPool` ~315–338); `...SnapshotConsumerLib.sol` (`repoint` ~23–55).
- **Scenario:** For a pool pinned to a `ClusterPayoutOracle`, a settled cursor round cannot be qualified, skipped, or advanced past until the oracle holds a Finalized (or Rejected) snapshot for it. `_clusterRoundQualificationStatus` returns `roundFinished=false` when `getRoundPayoutSnapshot` reverts `SnapshotNotFound` (catch ~550), so `advanceQualificationCursor` stalls and `requireNoPendingFinishedRound` reverts every refund path with `RewardPoolCursorNeedsAdvance`. If no bonded frontend ever proposes a snapshot (frontend set winds down, all deregister), both voter payouts and the residue sweep freeze indefinitely.
- **Recovery exists but is multi-step:** admin `repointRewardPoolClusterPayoutOracle` (allowed while `qualifiedRounds == 0 && claimedAmount == 0`) to a fresh governance-controlled oracle, then propose → arbiter-reject → `skipPreQualificationRejectedSnapshotRound` → refund. Note the runbook still requires a *Rejected* snapshot on the new oracle, hence a proposal step by an eligible frontend.
- **Remediation:** No redeploy strictly required. (a) Write and test this operational runbook now, before it is needed under pressure. (b) In a future governed escrow upgrade, add a long-timeout fallback (e.g., 90+ days after `sourceReadyAt` with no live proposal) that lets the cursor skip a snapshot-less round without oracle interaction. Confidence: high on mechanics; practical severity depends on how likely a zero-proposer state is.

### L-1 (contracts). Correlation-epoch and round-payout challenge windows run fully concurrently

- **Severity:** Low (parameter risk).
- **Where:** `ClusterPayoutOracle.sol` — `proposeRoundPayoutSnapshot` (~430–544) accepts proposals against a merely-`Proposed` epoch (~435); `setOracleConfig` (~213–224) bounds `challengeWindow ≤ 3 days`, `DEFAULT_CHALLENGE_WINDOW = 2 hours`.
- **Scenario:** A proposer submits the correlation epoch and all dependent round snapshots in one block; both layers' 2-hour windows expire simultaneously, so a human challenger who must fetch the artifact, recompute the deterministic scorer output, and fund a USDC bond gets one 2-hour (possibly overnight) window to catch errors at either layer. The 7-day `FINALIZATION_VETO_WINDOW` backstops this, but converts a permissionless check into a trusted (arbiter) one.
- **Remediation:** Pure parameter change — raise `challengeWindow` (≤ 3 days) once real bounty value flows. Optionally require the epoch to be `Finalized` before round snapshots can be proposed (sequential windows), which needs an oracle redeploy since it is non-upgradeable.

### L-2 (contracts). Narrowed `roundCore` interface re-declarations are ABI-fragile across future engine upgrades

- **Severity:** Low (currently safe; latent fail-closed hazard).
- **Where:** `ConfidentialityEscrow.sol` (`IConfidentialityRoundState.roundCore`, 24–35; used ~555, ~589), `interfaces/ILaunchDistributionPool.sol` (`IRoundClusterReadyAtSource.roundCore`, 21–32; consumed via raw `staticcall` in `LaunchDistributionPool._roundCoreSettledAtView` ~1061–1075) vs. `RoundVotingEngine.roundCore` (1593–1605) which returns **8** values (adds `uint8 upWins`).
- **Verified safe today:** Solidity tolerates extra trailing static return data, so the 7-tuple `try` decode reads the first 7 words correctly and `LaunchDistributionPool` reads `settledAt` at offset 224 with a `length >= 224` check.
- **Risk:** silent coupling. If a future engine upgrade reorders/shrinks `roundCore`, the consumers flip fail-closed (`catch → false`), which for `ConfidentialityEscrow` means confidentiality bonds become unreleasable until another wiring fix ships.
- **Remediation:** No on-chain action now. Add a repo invariant test asserting the engine's `roundCore` tuple against both narrowed interfaces, and document the coupling next to the getter.

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
- **Remediation:** Governed `ContentRegistry` upgrade to add the event (a `log2` in the same assembly block is cheap; bytecode pressure is presumably why it's assembly). Until then, monitor the storage slot directly.

### L-4 (contracts). Qualification/bundle iteration gas scales with `commitCount × external calls`; the 200-voter cap is near practical limits

- **Severity:** Low (bounded DoS-adjacent; confidence medium — not gas-profiled).
- **Where:** `QuestionRewardPoolEscrowQualificationLib.sol` — `qualifyRound` runs two full passes (`_countEligibleRevealedVoters` ~596–616, `_markEligibleRevealedVoters` ~618–636) over up to `MAX_REWARD_POOL_ROUND_VOTERS = 200` commits, each ~6–10 staticcalls plus up to two ban lookups across two registries; bundle qualification multiplies by bundle question count.
- **Scenario:** The first claimant on a 200-voter round pays full qualification cost inside `claimQuestionReward`. Fine on a cheap L2; near an L1-style 30M gas limit a large bundle could make first-claim/refund un-mineable.
- **Remediation:** Operational for now — run a keeper that calls `qualifyRound`/`syncQuestionBundleTerminals` proactively, and keep `maxVoters` conservative for bounty-carrying content (parameter). A paginated qualification path needs an escrow upgrade.

### L-5 (contracts). `finalizeRevealFailedRound` quorum coupling with `ProtocolConfig` bounds is load-bearing but only enforced by a comment

- **Severity:** Low (acknowledged in code; re-flagged as a governance tripwire).
- **Where:** `RoundVotingEngine.sol` 985–999 uses raw `roundCfg.minVoters` as reveal quorum, safe only because `ProtocolConfig._validateRoundConfigBounds` enforces `minSettlementVoters >= 3 == MIN_RBTS_PARTICIPANTS`. If governance relaxes that bound without touching the engine, rounds with `revealedCount ∈ [minVoters, 3)` get permanently stuck (`ThresholdReached` here while RBTS scoring rejects settlement), locking stakes.
- **Remediation:** Add the invariant to `ProtocolConfig`'s validation-change checklist and a fork test. Structural fix (derive quorum via `max()` in the engine) needs an engine upgrade and EIP-170 headroom.

### L-6 (contracts). Arbiter rejection of a partially-claimed snapshot permanently strands remaining claimants' shares

- **Severity:** Low (inherent to the accepted M-Oracle-2 veto semantics; flagged for documentation).
- **Where:** `ClusterPayoutOracle._rejectFinalizedRoundPayoutSnapshot` (~672–722); `QuestionRewardPoolEscrowRecoveryLib.recoverRejectedSnapshotRound` requires `!snapshot.firstClaimPaid` (line 130).
- **Scenario:** A snapshot finalizes, some voters claim, and within the 7-day veto window the arbiter rejects it (or its correlation epoch). Future claims revert at `verifyPayoutWeight`; recovery is blocked by `firstClaimPaid`; the unclaimed remainder sits until `claimDeadline + 7 days`, then sweeps to funder/treasury. Honest late-claimers lose their share.
- **Remediation:** Off-chain: arbiter policy should treat post-first-claim rejection as last-resort, and the ops runbook should compensate affected claimants. A protocol-level partial-recovery path would need an escrow upgrade and careful accounting.

### Informational (contracts)

- **I-1:** `QuestionRewardPoolEscrow._getExistingRewardPool` (1293) and `_getExistingBundleReward` (1298) revert with empty `revert()` — no selector/message, degrading trace debugging. Upgrade-fixable.
- **I-2:** Duplicate event declarations between `QuestionRewardPoolEscrow.sol` and its libraries (`RewardPoolCreated`, `RewardPoolRoundQualified`, `QuestionBundleRewardClaimed`, …). Emission address is the escrow (delegatecall), but a parameter-order drift would silently split indexer schemas — add a signature check.
- **I-3:** `RoundVotingEngine.setRole`/`_grantRole` (321–369) emit a single custom `log4` topic instead of OZ `RoleGranted`/`RoleRevoked`, so OZ-expecting role-audit tooling shows no history. Document the event ABI.
- **I-4 (verified working-as-designed trust assumptions):** `RaterRegistry.SEEDER_ROLE` can seed human credentials without proof (fully trusted); voters naming an ineligible frontend receive the frontend fee themselves at claim time (self-serve voters strictly out-earn frontend-routed ones by the fee); a slashed proposer self-challenging via a fresh wallet recovers ≤50% (`CHALLENGER_BOUNTY_BPS = 5000`); `ProfileRegistry._migrateProfileForIdentityKey` silently consumes an old wallet's profile name on World ID re-verification from a new wallet.

### Cross-contract consistency notes (contracts)

1. **Ban-check quadruplication:** the snapshot-registry-then-current-registry ban check with fail-open `catch` is copy-pasted in ≥4 places (`QuestionRewardPoolEscrow.sol` ~661–692, `QualificationLib` ~666–686, `BundleActionsLib` ~1418–1440, reward distributor). Identical today; any change must touch all copies. Consolidate into a shared library on a future upgrade.
2. **`"rateloop.address-identity-v1"` domain string** is independently re-derived in `QuestionRewardPoolEscrow`, `...VoterLib`, and `RaterRegistry`; `ProfileRegistry._validateRaterRegistry` validates against the literal. Consistent; a constants library would remove drift risk.
3. **"Failed window" encoding** (`bountyOpensAt > bountyClosesAt`) is an implicit protocol-wide convention (`WindowLib.activateRewardPoolWindowForRound` 55–69). Document it in `QuestionRewardPoolEscrowTypes.sol`.
4. **Quorum constant coupling:** four independent `3`s (`MIN_EFFECTIVE_PARTICIPANT_UNITS`, `MIN_REQUIRED_VOTERS`, engine `MIN_RBTS_PARTICIPANTS`, `ProtocolConfig.minSettlementVoters >= 3`) must move together (see L-5).
5. **Stale-engine/escrow guards are consistent** with the `AGENTS.md` governance-rotation model — escrow/bonus/oracle pins all fail closed on rotation, matching the "coordinated redeploy, not registry-only rotation" runbook.

---

## Part 2 — Incentives & mechanism design (Fable 5)

Mechanism as implemented: a binary Robust Bayesian Truth Serum (RBTS) turned into a **relative, zero-sum tournament** — raters are scored by RBTS against a leave-one-out, stake-weighted mean of RBTS scores; below-benchmark raters forfeit stake (≤50%) that redistributes to above-benchmark raters. The transform is monotone, so for a lone rater facing honest peers, truthful reporting is a best response. The problems live entirely in the coordinated / sybil / relative-payoff regime, and in the structural gap that on-chain LREP settlement carries none of the off-chain COCM protection.

**Verified against code:** RBTS scoring `RobustBtsMath.scoreBps` (49–58); prediction clamp `[100, 9900]` (`requireValidUserPrediction` 25–29); leave-one-out stake-weighted benchmark `RewardMath.calculateLeaveOneOutMeanScoreBps` (75–90); forfeit `stake * 1.5 * (benchmark − score)` capped at 50% and gated by `revealedCount ≥ SCORE_SPREAD_FORFEIT_MIN_REVEALS = 8` (`calculateNegativeScoreSpreadForfeit` 110–122); weight = epoch-weighted raw stake `RoundRevealLib._effectiveStake` (305–308) with **no cluster term**; `MAX_STAKE = 10e6` (10 LREP) / `MIN_STAKE = 1e6` (`RoundVotingEngine.sol` 92–93); off-chain COCM independence discount `independenceForVote` in `correlationScoring.ts` (611–643), which is never consulted on-chain.

### H-1 (incentives). On-chain RBTS settlement has no correlation/cluster protection; a coordinated bloc extracts honest forfeited stake

- **Severity:** High (mechanism-central); confidence High (mechanism), Medium (magnitude).
- **Mechanism:** the forfeit/redistribution loop weights everything by `commitRbtsWeight` = epoch-weighted raw stake; the only sybil brake is `MAX_STAKE = 10 LREP` per identity + a 24h per-content cooldown. The COCM `/√clusterSize` discount and independence floors touch only USDC bounties and launch credits — never `settleRound`.
- **Attack (numbers):** 8-reveal round (the forfeit minimum). Attacker fields 7 sybil wallets (distinct address-identity-keys, no human credential needed) each staking 10 LREP predicting ~9900/UP; 1 honest voter stakes 10 LREP, votes DOWN, predicts 6000. Uniform peer/reference draw ⇒ honest voter's peer is a sybil w.p. 6/7 ⇒ honest score ≈ 6000, sybils ≈ 9500. Mean ≈ 9062; honest LOO benchmark ≈ 9500 ⇒ spread −3500 ⇒ forfeits `10 × 1.5 × 0.35 = 5.25`, capped at 5 LREP (50%). Sybils' LOO benchmark ≈ 9000 ⇒ positive spread ⇒ they split 96% of the 5-LREP pool, and simultaneously set the **public rating** to UP.
- **Why bounded (and still matters):** per-round profit ≤ 5 LREP due to the cap, and the attacker funds 7+ wallets (70+ LREP + gas) per round. But it (a) corrupts the public rating, (b) griefs honest minorities into predictable losses, and (c) scales linearly across rounds. The cap makes it low-$, not low-impact on signal quality.
- **Refs:** `RoundRevealLib.sol` 305–308, 345–383; `RewardMath.sol` 75–122; `correlationScoring.ts` 611–643 (discount not applied on-chain).
- **Remediation:** feed a cluster/independence discount (or per-round, per-funding-source cap) into `commitRbtsWeight` before it enters the benchmark and reward denominator — i.e., make on-chain settlement consume the same independence signal the oracle already computes, or gate large-forfeit rounds behind a verified-human participation ratio, or cap any single funding cluster's share of both benchmark weight and reward pool. This is an engine-upgrade-class change; treat as roadmap, not a hot fix.

### H-2 (incentives). Peer-prediction admits a collusion/herding equilibrium that dominates truthful voting

- **Severity:** High for incentive-compatibility; confidence High (confirmed against literature).
- **Mechanism:** RBTS is only Bayes-Nash incentive compatible, not dominant-strategy and not a unique equilibrium. "Everyone votes UP and predicts high" is also an equilibrium: since your score rewards agreement with a randomly sampled peer signal, once a bloc coordinates on one side, matching it maximizes `E[score]` regardless of your private signal. The relative-to-mean tournament amplifies this — you only need to beat the mean, and the bloc sets the mean.
- **Scenario:** 20 real humans in a Telegram group agree "always UP, predict 9500." Against any dissenter they set the benchmark and collect forfeits (see H-1). No sybils required; epoch-weighting doesn't help because the whole bloc commits in epoch 0.
- **External grounding:** Witkowski & Parkes (RBTS, AAAI 2012) prove strict Bayes-Nash IC for `n ≥ 3` **but not dominant-strategy IC and not uniqueness**; the peer-prediction literature (and Prelec's original BTS) documents non-truthful/collusive equilibria as the standing weakness of single-task mechanisms. RateLoop's implementation matches the theory exactly — truthfulness is BNE-only.
- **Remediation:** inherent to single-task peer prediction. Realistic options: (a) multi-task / determinant-based mechanisms (Dasgupta–Ghosh, DMI) that penalize correlated report patterns; (b) mix the public rating outcome in as a scoring anchor; (c) accept it and lean on the off-chain correlation + verified-human layer to detect blocs. At minimum, **document that truthfulness is BNE-only and coordinated blocs are the accepted residual risk.**

### M-1 (incentives). Asker recaptures a "non-refundable" bounty via unlinked alt wallets

- **Severity:** Medium–High; confidence High.
- **Mechanism:** `VotePreflightLib._validateVoterAndContent` (102–108) blocks self-voting only when the actor address, resolved identity holder, or submitter identity key matches; a fresh wallet with no credential and no linked identity matches none. The claim path excludes only funder/submitter identity. So an asker funds M alt wallets, votes to satisfy the participant floor (`QuestionRewardParticipantFloorLib` 3/5/8), and claims shares.
- **Numbers:** 500 USDC bounty, equal-share, `MIN_REWARD_POOL_PARTICIPANTS = 3` ⇒ 3 alts recapture ~100% minus frontend fee (≤5%) and gas. Cluster-gated pools *may* discount them only if the alts share detectable correlation features; independent-looking fresh wallets get full weight. **LREP bounties and any pool without a cluster oracle have no such protection.**
- **Refs:** `VotePreflightLib.sol` 99–109; `QuestionRewardParticipantFloorLib.sol` 13–17; `QuestionRewardPoolEscrowClaimLib._isExcludedClaimant` (funder/submitter identity only).
- **Remediation:** require verified-human eligibility (or a minimum verified-anchor count) for bounty claims above a threshold; make cluster-oracle gating mandatory (not per-pool optional) for USDC pools above some size; link submitter payment wallet → identity at content creation.

### M-2 (incentives). Surprise-weighting rewards coordinated flooding of low-base-rate sides

- **Severity:** Medium; confidence Medium.
- **Mechanism:** `surpriseBpsForVotes` (497–547) sets `surprise = agreement / baseRate` (cap 30000 bps) ⇒ `baseWeight = 5000 + 5000·surprise/10000` (up to 2×). A bloc voting the side rare in the trailing-100-round base rate but common this round makes every member "surprisingly popular" ⇒ all hit the 2× cap, doubling the bloc's claim weight against the honest minority. Only the independence/cluster discount brakes this, and the bloc evades it by not sharing features. An attacker controlling enough rounds can also drift the trailing base rate (`baseRateWindowRounds = 100`, clamped `[500, 9500]`).
- **Refs:** `correlationScoring.ts` 497–573.
- **Remediation:** cap aggregate surprise weight per detected cluster; combine surprise with independence multiplicatively *before* the cap; down-weight surprise when a side's within-round share greatly exceeds its share among verified-human voters.

### M-3 (incentives). Governance capture via cheap LREP relative to a 0.1% quorum floor

- **Severity:** Medium; confidence Medium.
- **Mechanism:** `MINIMUM_QUORUM = 100_000 LREP` = 0.1% of the 100M cap; proposal threshold 1,000 LREP. Early on, ~75M sits in the launch pool (excluded from quorum), so the absolute floor governs. With LREP transferable (accepted), a modestly-capitalized actor can accumulate 100k+ and, on low turnout, pass proposals during bootstrap. Governance controls slashing, the oracle arbiter, and `ProtocolConfig` — so a captor could lower `minSettlementVoters`, arbitrate challenged roots in their own favor, or slash competitors and route the 50% challenger bounty to themselves.
- **Refs:** `RateLoopGovernor.sol` 48–52, 193–206; 7-day vote lock (262–279) is the main friction.
- **Remediation:** raise the bootstrap quorum floor or scale it to distributed (not just circulating) supply; use a separate, higher quorum/timelock for slashing and arbiter actions than for routine config.

### Low / Informational (incentives)

- **L (parimutuel vestigial):** `binaryLosingPool`/`upWins` is computed at settlement but used **only** in the `RoundSettled` event; it drives no forfeiture. The docs' "weighted majority wins, prevents late herding" narrative no longer maps to any payout — the real anti-herding lever is epoch-weighting on `rbtsWeight`. Reconcile docs vs. implementation.
- **L (dead economic zone):** `minSettlementVoters ≥ 3` but forfeits require ≥ 8 reveals. Rounds with 3–7 revealers settle, move the public rating, and consume bounties, but produce **zero forfeits and zero RBTS rewards** — no incentive to stake accurately in exactly the thin rounds where manipulation is cheapest.
- **L (weak PRNG pairing):** reference/peer draws come from a delayed-blockhash seed. On Base's centralized sequencer, the block producer can bias *pairings* (hence the RBTS reward split, not the rating outcome). Value at stake per round is tiny; the pairing sensitivity slightly amplifies H-1.
- **L (advisory/launch farming):** throttled (3 unverified credits/round, 25 raters/anchor, ≥2 anchors, score ≥7000 bps, first-100 cap 500 LREP ⇒ ≤125 LREP for an unverified sybil) but not eliminated — two colluding verified humans can run a slow farm. Referral farming is genuinely gated by World ID nullifier uniqueness (`MAX_REFERRAL_REWARD_PER_REFERRER = 10,000 LREP`), which is good.
- **I (doc vs. math):** the one-paragraph framing "scored against the stake-weighted mean **prediction**" is imprecise — implementation scores against the leave-one-out stake-weighted mean of **RBTS scores**. `how-it-works.md` is accurate; the summary framing isn't.
- **I (high-variance scoring):** at 8 reveals, single reference + single peer means an honest accurate rater can be unlucky and forfeit. Unbiased but noisy; more sampled peers would cut honest forfeiture variance (at gas cost).

### Incentives remediation plan (fresh deployment, no added waiting)

Owner constraint for this plan: the current contract deployment can be discarded, and the frontend can point at a newly deployed stack. Therefore prefer clean contract/API changes over migration gymnastics. Also, **do not fix these items by increasing UX-waiting parameters**: no higher default `minSettlementVoters`, no longer `epochDuration`/`maxDuration`, no longer reveal grace, no extra challenge window for ordinary claims, and no mandatory oracle wait where the flow can remain synchronous. The fast 3-voter feedback tier should survive; it just must not pretend to have full score-spread economics.

If the fresh-deployment branch includes the `PAYOUT_DOMAIN_RBTS_SETTLEMENT` / domain-5 oracle-backed settlement path, keep it as an explicit high-assurance mode rather than the default. Globally routing every RBTS settlement through a payout snapshot would improve cluster discounting, but it would add snapshot-pending UX; the default path should settle public results and ordinary stake accounting without that additional wait.

#### Commit 1 — Fix M-1: make non-refundable bounty recapture uneconomic without adding a claim delay

- **Goal:** an asker should not be able to fund a "non-refundable" bounty, answer from fresh unlinked wallets, and recover the bounty as if third parties had participated. Everyone can still answer the question; the restriction is on who can receive the bounty payout for bounty sizes where recapture matters.
- **Contract plan:** add a shared reward-policy helper (or extend `QuestionRewardParticipantFloorLib`) that maps asset/amount/non-refundable status to a required bounty-claim credential. For the launch policy, require `BOUNTY_ELIGIBILITY_VERIFIED_HUMAN` for non-refundable USDC or LREP bounties above the recapture-risk threshold; keep smaller exploratory bounties open if product wants that low-friction path. Enforce the policy in both creation paths so no caller bypasses it: `ContentRegistryRewardLib.validateSubmissionReward`, `QuestionRewardPoolEscrowPoolActionsLib._validateStoreInputs`, and `QuestionRewardPoolEscrowBundleActionsLib` for bundle rewards.
- **Identity binding:** keep the existing submitter/funder exclusion, but treat payer identity as a first-class snapshot at content/reward creation: raw payer address, resolved holder, and identity key should all be excluded from claiming. If the payer is not verified, that should not block ask creation; it only means the payer cannot later appear as an eligible verified claimant unless they are the same excluded identity.
- **Claim path:** rely on the existing commit-time credential snapshot (`commitIdentityState` / `QuestionRewardPoolEscrowEligibilityLib.isCommitEligibleForBounty`) so eligibility is checked from state already captured during voting. Do not require a cluster snapshot just to claim these bounties. Cluster/correlation weights remain useful defense-in-depth for payout shares, but the primary no-wait fix is verified-human claim eligibility above threshold.
- **Frontend, SDK, and agent plan:** update submit UI, browser handoff, MCP, SDK, and x402 validation so threshold-sized non-refundable bounties default to Proof-of-Human bounty eligibility and reject contradictory "everyone can claim" inputs before signing. Result packages should distinguish "all answers" from "bounty-eligible answers" so askers still see the full crowd.
- **Tests:** Foundry tests for direct `ContentRegistry` and escrow creation reverts on high-value open bounties; verified-human high-value bounties qualifying/paying; unverified alt wallets revealing but failing bounty qualification/claim; payer/submitter identity exclusion; and bundle parity. TypeScript tests for agent/schema/UI/SDK defaults and rejection messages.
- **Why this does not make users wait longer:** it changes claim eligibility, not round timing. It does not raise required voters, extend a voting window, add a settlement phase, or require a new oracle snapshot. Verified raters claim on the same schedule as today.

#### Commit 2 — Fix M-2: make surprise weighting cluster- and anchor-aware

- **Goal:** preserve the useful part of surprise weighting — rewarding genuinely predictive low-base-rate answers — while removing the "flood the rare side and all receive 2x" payoff.
- **Scoring plan:** change `surpriseBpsForVotes` / `baseWeightForVote` in `packages/node-utils/src/correlationScoring.ts` from an independent per-voter cap to a side-and-cluster budget:
  - compute each vote's raw surprise as today;
  - group votes by detected cluster and side;
  - cap each cluster's aggregate surprise bonus on a side to at most one fully independent vote's max bonus, then allocate that budget across members by reveal weight;
  - multiply any remaining bonus by a verified-anchor factor when the side's within-round share is far above its trailing base rate but has little verified-human or high-independence support;
  - keep the flat neutral floor for missing surprise inputs and for launch-credit domains.
- **Parameter/versioning plan:** add explicit parameters such as `surpriseClusterBudgetBps`, `surpriseVerifiedAnchorMinBps`, and `surpriseFloodDivergenceBps`; include them in `correlationParameterHash`, artifacts, verifier checks, and generated docs. Bump the scorer/spec version so old artifacts are not silently reused.
- **Oracle/artifact plan:** update `correlation-artifact-builder`, `correlation-artifact-verifier`, Ponder payout-proof serialization, and keeper tests so the new reasons explain whether a bonus was reduced by cluster budget or weak verified anchoring.
- **Tests:** unit tests proving a coordinated cluster on the rare side gets no more aggregate surprise bonus than one independent rater; independent verified raters on a genuinely surprising side still earn the intended bonus; unverified rare-side floods collapse toward neutral; bundle and question reward domains match; parameter hashes change; verifier rejects old reason/weight roots.
- **Why this does not make users wait longer:** it is a pure scoring/artifact change. It keeps the same round duration, reveal timing, claim windows, and base-rate lookback. Raters do the same work; the payout math is less gameable.

#### Commit 3 — Fix Low: remove the vestigial parimutuel payout story

- **Goal:** stop implying that the binary losing pool drives payouts. `upWins` is still the public round verdict, but RBTS score-spread settlement, not parimutuel majority loss, determines LREP forfeits/rewards.
- **Contract/API plan for the clean redeploy:** either remove `losingPool` from `RoundSettled` and generated ABIs, or rename/index it as `binaryLosingStakeForTelemetry` if downstream analytics still need it. Keep `upWins` because external consumers and result packages need the verdict. Rename local variables/comments around `binaryLosingPool` so future readers do not infer payout semantics.
- **Docs/indexer plan:** update `how-it-works`, `smart-contracts`, `tech-stack`, public `skill.md`, result package copy, Ponder schema/handlers, and E2E helpers to describe the binary verdict separately from score-spread economics.
- **Tests:** ABI/typegen snapshot updates; Ponder event ingestion tests; docs fact tests if present; E2E settlement helpers asserting `upWins` still flows to the UI/result package.
- **Why this does not make users wait longer:** it is semantic cleanup plus optional event shape cleanup for the redeploy. No timing parameter changes.

#### Commit 4 — Fix Low: make 3-7 revealer rounds an explicit fast-feedback tier

- **Goal:** keep fast low-turnout rounds, but remove the dead-zone expectation that 3-7 revealer rounds have meaningful LREP score-spread incentives.
- **Contract plan:** add an explicit settlement mode derived from the round config: rounds whose configured `minVoters` is below `SCORE_SPREAD_FORFEIT_MIN_REVEALS` are `FeedbackOnly` by default. In `FeedbackOnly` rounds, either reject nonzero LREP stake at commit time or return stake without computing score-spread rewards, and emit a clear settlement-mode flag. Full `ScoreSpread` economics remain available when the asker/front-end intentionally configures an 8+ voter economic round.
- **Bounty plan:** bounty payouts still work in fast rounds; Commit 1 handles high-value claimant eligibility. This keeps the product's quick feedback experience while ensuring the LREP stake UI does not imply a reward/forfeit game that will not activate.
- **Frontend/agent plan:** hide or disable positive LREP stake on fast-feedback questions, label them as bounty/feedback rounds, and let askers opt into 8+ voter economic settlement only when they explicitly want stronger LREP incentives.
- **Tests:** Foundry tests for zero-stake fast rounds settling at 3-7 reveals, nonzero stake rejection or full return in `FeedbackOnly`, unchanged 8+ score-spread behavior, and bounty claims in fast rounds. UI/agent tests proving default asks keep the fast tier and economic-round opt-in is explicit.
- **Why this does not make users wait longer:** defaults stay fast. The plan does not raise the minimum voter floor; it makes the economic mode honest. Users who want score-spread economics can opt into 8+ voters knowingly.

#### Commit 5 — Fix Low: replace sequencer-influenced pairing entropy without adding a new wait

- **Goal:** prevent a centralized L2 sequencer from biasing RBTS reference/peer pairings through the delayed blockhash.
- **Contract plan:** derive `scoreSeed` from precommitted voter entropy instead of a future blockhash: accumulate a `roundRevealEntropy` hash from `(commitKey, salt)` during reveal, combine it with the settlement-closed `scoringSetHash`, `chainid`, engine address, content ID, round ID, and a version string, and use that seed for `_rbtsOtherIndex` / `_rbtsPeerIndex`. The salt is already bound into the commit hash, so the sequencer cannot choose it after seeing the scoring set; censorship remains possible but no longer gives direct pairing choice.
- **Compatibility plan:** remove the one-block delayed-seed state machine for the redeployed engine, or keep it only as a fallback when no reveal entropy exists. Update event names/comments so `RbtsSeedCaptured` no longer suggests blockhash dependence.
- **Tests:** commit/reveal hash tests proving salt binding; settlement tests showing the same revealed set produces the same seed independent of blockhash; sampler distribution/fuzz tests; and a regression that an unrevealed commit cannot enter the entropy or scoring set after settlement closure.
- **Why this does not make users wait longer:** it removes the delayed-blockhash dependency and can only shorten settlement. No new randomness beacon, VRF callback, challenge period, or extra transaction wait is introduced.

#### Commit 6 — Fix Low: tighten advisory/launch farming at the credit layer

- **Goal:** keep launch/advisory incentives useful while making slow unverified farms and two-anchor collusion less profitable.
- **Launch/advisory scoring plan:** apply the same cluster independence accounting used by bounty artifacts before unverified launch/advisory credits count toward earned LREP. Add per-anchor and per-cluster credit budgets so two verified anchors cannot repeatedly bootstrap the same unverified cluster to the cap. Keep verified referral rewards gated by World ID nullifier uniqueness as-is.
- **Contract/off-chain plan:** update `LaunchDistributionPool`, `AdvisoryVoteRecorder`, keeper artifact generation, and result package labels so unverified credits carry an explicit `effectiveCreditBps` and reason hash. If bytecode pressure is tight, put the heavy clustering in the existing oracle artifact path and have contracts verify weights.
- **Tests:** unverified sybil cluster earns fractional credit; repeated use of the same verified anchors hits the per-anchor/per-cluster budget; independent verified humans retain full launch credit; existing referral cap behavior is unchanged.
- **Why this does not make users wait longer:** it reduces credit amounts for correlated activity, not eligibility timing. No additional revealers, epochs, or claim delays are required.

#### Commit 7 — Fix Informational: align docs, prompts, and result wording with the actual math

- **Goal:** remove the remaining "mean prediction" and parimutuel wording drift everywhere a rater, asker, agent, or integrator learns the protocol.
- **Docs/product plan:** update `docs/design-review-2026-07.md`, `packages/nextjs/app/(public)/docs/how-it-works/page.tsx`, `smart-contracts`, `tech-stack`, `docs/ai`, `packages/nextjs/public/skill.md`, SDK/agents READMEs, MCP tool guidance, and result package copy to consistently say: public verdict = binary weighted signal; LREP economics = leave-one-out mean of RBTS scores; below 8 score-eligible revealers = fast feedback/bounty tier, not score-spread economics.
- **Tests:** snapshot or text tests for public docs where available; agent schema/help tests for generated instructions; result package tests for the wording and fields exposed to agents.
- **Why this does not make users wait longer:** documentation only.

#### Commit 8 — Fix Informational: lower honest-rater variance once score-spread economics are active

- **Goal:** reduce the chance that an honest accurate rater at the 8-reveal threshold forfeits due to one unlucky reference/peer draw.
- **Contract plan:** once `revealedCount >= SCORE_SPREAD_FORFEIT_MIN_REVEALS`, score each report against multiple deterministic reference/peer draws from the same seed and average the RBTS score. Start with a small fixed sample count, e.g. 3, with distinct sampled peers when the revealed set allows it. Keep 3-7 revealer `FeedbackOnly` rounds out of score-spread economics per Commit 4.
- **Gas/complexity guard:** cap the sample count and fuzz gas for 8/25/100/200 revealers. If the on-chain cost is too high for the redeploy target, do not silently move the default flow into `PAYOUT_DOMAIN_RBTS_SETTLEMENT`; keep multi-sample scoring for an explicit high-assurance mode, or settle the public result immediately and defer only optional stake-accounting enhancements.
- **Tests:** deterministic multi-sample scoring tests; no duplicate self/peer draws; gas snapshots; simulation-style TS tests showing lower honest-score variance at 8 revealers; unchanged stake cap and max-forfeit behavior.
- **Why this does not make users wait longer:** it reuses the same settled revealed set and seed. The tradeoff is gas or oracle-artifact complexity, not user waiting time.

### Open questions for the owner (incentives)

1. Is the absence of on-chain cluster discounting (H-1) intentional — LREP forfeiture secured only by the 10-LREP cap + 24h cooldown, with COCM reserved for USDC/launch? If so, is ≤5-LREP/round extraction acceptable griefing?
2. Should cluster-oracle gating be mandatory for USDC pools above some size, or is per-pool optionality (M-1) intended?
3. What turnout is assumed for the bootstrap governance window (M-3)? Is the 100k floor sized against an expected adversary capital budget?
4. Is moving off single-task RBTS toward a multi-task/DMI mechanism (H-2) on the roadmap, or is coordinated-bloc risk explicitly accepted and pushed to the off-chain layer?

---

## Part 3 — Off-chain / on-chain boundary (Fable 5, code-verified by lead)

> Note: the off-chain subagent's detailed body did not transmit back through the tooling; the lead agent (Fable 5) re-read `packages/keeper/src/correlation-ponder-freshness.ts`, `build-correlation-artifact.ts`, `correlation-artifact-builder.ts`, and `packages/node-utils/src/correlationScoring.ts` to verify these directly.

**Trust map (brief):** the local agent signer trusts nothing from the hosted API — x402 payments are cryptographically bound to the question payload, so a malicious hosted API cannot redirect funds or take operator custody (verified: agents sign EIP-3009/x402 authorizations locally against on-chain-derived values). The keeper trusts Ponder for *work discovery* but re-reads chain state (`readRound`) before acting. Ponder/Postgres are read-model conveniences, not fund authorities; on-chain escrow accounting is the source of truth for payouts.

### M-1 (off-chain). Correlation snapshot inputs are read at query time, not pinned per round — two honest operators can compute different payout roots

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
- **Remediation:** pin all scoring inputs to a canonical block (or the round's settlement block) — snapshot `historicalVoteCount` and `verifiedHuman` as of that block, the way `now` already pins time-relative exclusions — and include that block reference in the artifact's parameter hash. Off-chain/keeper change; no contract change required. This is the one item that touches the payout-root challenge game and should be prioritized.

### M-2 (off-chain). Single-keeper liveness on a long settlement clock

- **Severity:** Medium; confidence Medium.
- **Mechanism:** settlement, unrevealed-commit cleanup, dormancy marking, and snapshot publication all depend on the keeper running. The README documents multi-replica operation (different wallets, `KEEPER_STARTUP_JITTER_MS`, `KEEPER_DATABASE_URL` advisory locks) and duplicate on-chain attempts revert, but a fully-down keeper stalls settlement and (via M-1 contracts) can freeze cluster-pinned pools. Users can self-settle eligible rounds on-chain, which mitigates the worst case, but routine liveness leans on the operator.
- **Remediation:** document the self-settlement fallback prominently; ensure at least two independent keeper replicas with separate keys in production; alert on settlement backlog age.

### Consistency / drift notes (off-chain)

- Duplicated constants between `node-utils/correlationScoring.ts` and keeper modules (`CORRELATION_VOTE_PAGE_SIZE`, `PONDER_HTTP_FETCH_TIMEOUT_MS`, payout-domain enums) are currently imported from the shared package — good; keep them single-sourced and resist re-hardcoding in Ponder/nextjs.
- The Ponder freshness gate (`areCorrelationCandidatesPonderFresh`) correctly defers artifact builds until Ponder reflects chain `state`/`revealedCount`/`voteCount` and reconstructs correlation-eligible votes without truncation — a solid guard against indexing-lag-driven bad roots. The `--skip-ponder-freshness` manual-recovery flag is appropriately warned.
- Address/decimal/duration constants for contracts flow from `@rateloop/contracts`; env overrides are documented as local/recovery-only. Verify `docs/env-parity.md` stays in lockstep when durations change.

### Strengths (off-chain)

- x402/EIP-3009 payments bound to payload; local signer trusts nothing from the hosted API (no operator custody path).
- Freshness gate prevents indexing-lag bad roots; bounded response reads (`PONDER_JSON_MAX_BYTES`, page/size caps) prevent memory blowups from a hostile API.
- Deterministic canonical JSON + parameter hash + scorer/eligibility/feature version stamps in every artifact, with a candidate fingerprint — strong reproducibility scaffolding (M-1 is the one remaining gap in that scaffolding).

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

1. **Decide the on-chain-cluster question (H-1 / incentives-open-Q1).** Either extend independence-aware weighting into `commitRbtsWeight`, or formally document that LREP settlement is sybil-secured only by the 10-LREP cap and accept the bounded griefing. This is the biggest signal-integrity lever.
2. **Pin correlation scoring inputs to a canonical block (M-1 off-chain).** The only item touching the payout-root challenge game; keeper-only change.
3. **Document that RBTS truthfulness is BNE-only and coordinated blocs are accepted residual risk (H-2)**, and note the multi-task/DMI upgrade path.
4. **Close the alt-wallet bounty-recapture path (M-1 incentives):** mandatory cluster gating and/or verified-human floors on USDC pools above a size threshold.
5. **Write the cluster-pinned-pool zero-proposer runbook now (M-1 contracts)** and add the fork-test invariants for the quorum coupling (L-5) and `roundCore` ABI coupling (L-2).
6. **Reconcile docs with implementation:** the vestigial parimutuel "majority wins" narrative and the "mean prediction" vs. "mean RBTS score" phrasing.
7. **Operational hardening:** ≥2 keeper replicas with separate keys + settlement-backlog alerting; emit a `ContentRegistry.setTreasury` event (L-3, next governed upgrade); raise `challengeWindow` before real bounty value flows (L-1).

---

*Prepared by a Claude Fable 5 multi-agent review (orchestrator + contracts, incentives, and off-chain subagents, all Fable 5). No fallback to Claude Opus 4.8 was used. External sources: Witkowski & Parkes, "A Robust Bayesian Truth Serum for Small Populations" (AAAI 2012) and "…for Non-Binary Signals" (AAAI 2013); Prelec, "A Bayesian Truth Serum"; Gitcoin/RadicalxChange "Beyond Collusion Resistance" (Connection-Oriented Cluster Match) and Gitcoin COCM writeups.*

# Tokenless, Keyless RateLoop — Implementation Plan (July 2026)

**Status:** v1, 2026-07-11. Companion to [web3-exit-stablecoin-pivot-analysis-2026-07.md](web3-exit-stablecoin-pivot-analysis-2026-07.md), which holds the strategic case. This document answers three follow-up questions and turns the decision into a concrete repo plan:

1. Can Hawig UG hold **no upgrade keys at all** — deploy immutable contracts once and only run the frontend?
2. Are **small USDC vote bonds a gambling-law risk** ("betting on content")?
3. Could **resolution and payout happen almost instantly** in a trusted design, or should on-chain commit-reveal stay?

---

## TL;DR

1. **Keyless is achievable and worth it, but it is currently far from true:** today every core contract is a `TransparentUpgradeableProxy` with a governance timelock as upgrade admin, plus pause, sweep, and ~30 governance setters. The plan converts everything to direct, constructor-configured, non-upgradeable deployments with no pause/sweep/setters (the Liquity model: bug response = disclose → let users exit → redeploy → migrate). Legally, keylessness clears the two sharpest MiCA "you're an intermediary" indicators (admin keys, governance concentration) — but it is necessary, not sufficient: running the sole frontend and earning the fee keeps Hawig UG identifiable. The stronger point: escrowing rating bounties in USDC is arguably not any enumerated CASP service in the first place; keylessness is defense-in-depth.
2. **Yes — the vote bond is a real legal risk, and one specific mechanism detail is the danger: forfeited-stake redistribution.** German law has no de-minimis stake exception anymore (OVG NRW 2024), the GGL classified prediction markets as unlicensable "Gesellschaftswetten" and blacklisted Polymarket (Sept 2025), crypto-denominated gambling is per-se unlicensable — so classification is binary and existential for German-facing operation. The current design pays 96% of forfeited stakes to well-scoring raters: that is structurally the poker-tournament pattern (stakes fund the prize pool, winners paid at losers' expense) that the BVerwG held to be gambling. **The fix is architectural, not cosmetic: make the bond a pure returnable deposit (Kaution) — always returned 1:1 on reveal, forfeited only for non-reveal (a contract-penalty, not a lost bet), and forfeits never flow to other raters. All rater upside comes exclusively from the funder's bounty as payment for a rating service (Auslobung).** With that change, the strongest anti-gambling arguments all line up; without it, they don't.
3. **Keep on-chain commit-reveal; near-instant payout is compatible with it.** Commit-reveal is mechanism-essential (votes are public on-chain — without sealing, later raters herd on earlier ones and the peer-prediction scoring collapses), not a regulatory artifact. The actual latency today is dominated by *permissionless-trust* machinery a first-party operator can delete: the correlation-oracle challenge/veto windows, the 1-hour RBTS snapshot timeout, fee-review and unbonding delays. The blind window itself is a product knob (default 20 min; floor 20 s) that exists to *collect* human votes — you can't resolve before humans answer no matter how trusted the design is. After the window closes, tlock reveal (drand, 3 s period) + settle + pay can complete in a couple of blocks. Target end-to-end: **question duration + ~1–2 minutes**, with no trust downgrade. A trusted server-side tally could shave that last minute — and would cost vote-privacy-from-the-operator, the self-execution posture that underpins the non-custodial legal analysis, and agent-verifiable neutrality. Not worth it.

---

## Part A — The three questions, answered from research

### A.1 Keyless immutable design: what it buys, what it doesn't

**Current admin surface (must all go):** every stateful contract behind a proxy with timelock upgrade admin (`ContentRegistry`, `RoundVotingEngine`, `ProtocolConfig`, `RoundRewardDistributor`, `FrontendRegistry`, `ProfileRegistry`, all three escrows, `FeedbackRegistry`, `RaterRegistry`); `ProtocolConfig` with 19 governance setters; pausability on `ContentRegistry`, `RoundVotingEngine`, escrows; sweeps/rescues (`recoverSurplusLrep`, `sweepStrandedLrepToTreasury`, `recoverNonAssetToken`, `rescueToken`); a live `ARBITER_ROLE` on `ClusterPayoutOracle` that can reject payout snapshots; and the Governor/timelock stack itself ([Deploy.s.sol](../packages/foundry/script/Deploy.s.sol)).

**Legal value of removing it (MFSA DeFi paper, June 2026; Commission MiCA-review indicators):** regulators score decentralization on admin keys/upgradeability, governance concentration, custody, open source, identifiable marketing entity, and fee control. Keyless immutability decisively clears the first two; an *immutable hard-coded* fee is weaker evidence of control than a settable fee (untested but directionally right). What keylessness cannot clear: Hawig UG runs the sole frontend, markets the product, and earns the fee — under substance-over-form it stays the identifiable responsible person. Two consequences:

- Don't oversell "decentralized" in positioning; the honest claim is *"non-custodial and immutable: we cannot touch, freeze, or redirect user funds — verify on-chain."* That claim is true, checkable, and is also exactly what the custody-by-control analysis needs.
- Mitigate the sole-frontend point cheaply: publish verified contract addresses as the canonical interface, pin a frontend build to IPFS, document direct-contract usage, and make any future migration opt-in with the old deployment left running (Liquity precedent).

**The cost of immutability is the bug story.** Liquity V2's Feb 2025 bug is the playbook: no fix path existed; they disclosed, users withdrew (~$30M outflows, zero losses), they re-audited and redeployed three months later. The design rule that made that survivable: **every state must have a user exit path** — bounty funders and bond holders must always be able to withdraw from a wedged round. That property must be an explicit invariant with Foundry tests, plus: minimal contract surface (this plan deletes most of it anyway), a pre-launch audit competition, and an Immunefi-style bounty. Nexus Mutual cover exists but is user-purchased — mention it in docs, don't rely on it.

**One deliberate exception to "no keys," to decide explicitly:** World ID router/verifier config in `RaterRegistry` (World has shipped v3→v4 and will ship again). Options: (a) freeze at deploy (the freeze flags already exist: `worldIdV4VerifierConfigFrozen`, `worldIdV4PresenceConfigFrozen`) and redeploy the registry on World upgrades — purest, some churn; (b) keep one narrowly-scoped, publicly documented role that can only rotate World ID verifier config and touches no funds. (b) is defensible — the role provably cannot reach user money — but (a) is cleaner and this plan assumes (a). Decide before Phase 2.

### A.2 Vote bonds and gambling law — the redesign this forces

**Why the risk is real (German law, GlüStV 2021):**
- § 3 GlüStV: gambling = payment for a win-chance decided wholly or predominantly by chance; chance is *deemed present* when the outcome turns on uncertain future events. "Predict what % of other raters vote up" is facially a bet on third-party behavior.
- **No de-minimis:** OVG NRW (13 B 1047/22, March 2024) — even ≤ €0.50 stakes don't escape; $1–10 bonds exceed even the old BGH threshold.
- **The average-player standard:** poker is gambling (BVerwG 8 C 26.12) despite real skill, because the *Durchschnittsspieler's* outcome is predominantly noise. A casual rater's BTS score in a small pool is statistically noisy — the same trap.
- **GGL posture:** prediction markets are "Gesellschaftswetten," fundamentally unlicensable (only sports betting on verifiable events is licensable), "particularly susceptible to manipulation … based on unclear, subjective, or controllable events" — which describes content-rating votes *a fortiori*. Polymarket blacklisted Sept 2025; nine EU regulators coordinating; Spain sanctioned Kalshi+Polymarket May 2026. And § 4 GlüStV: crypto-denominated gambling can't be licensed at all. So if classified as gambling, there is no license to get — plus § 284/285 StGB criminal exposure.

**Why the design can escape classification — if one thing changes:**
- The strong defenses: (1) a bond returned 1:1 on reveal is a **security deposit (Kaution)**, not an Entgelt purchasing a win-chance — BVerwG's own doctrine distinguishes true stakes (paid into the prize pool) from fees/deposits that don't fund winnings; (2) forfeiture on non-reveal is a **contract penalty for breaching a protocol duty** (Vertragsstrafe), unrelated to gambling; (3) rater rewards paid from the **funder's bounty are payment for a rating service** (Auslobung/§§ 657, 661 BGB — merit-judged prize competitions without participant stakes are permissible); (4) payout depends on the rater's **own judgment quality**, the tournament-entry analogy, not the sports-bettor analogy.
- The fatal current detail: `RewardMath.splitPool` routes **96% of forfeited/negative-spread stakes to well-scoring raters**. Winners paid from losers' stakes is precisely the structure that made paid-prize-pool poker tournaments gambling. It converts the "deposit" into a "stake" in economic substance.

**Mechanism redesign (binding for Phase 1):**
1. Bond is returned **1:1 to every rater who reveals**, regardless of score. No stake-at-risk on judgment quality.
2. Forfeiture only for non-reveal (and provable protocol abuse). Forfeits go to the **question's funder as a refund, or to the protocol fee recipient** — never to other raters. (Funder-refund is the cleanest: no participant or operator "wins" a stake; the operator route is defensible as a penalty but funder-refund reads better.)
3. All performance-dependent upside comes from the **bounty only**, distributed by RBTS score weight. Losing raters lose nothing — they simply earn less of the service payment.
4. The %-prediction leg is **scoring input for service-quality weighting**, never a standalone win/loss market. No UI or docs language of "bet/win/odds"; the user-facing frame is "quality-weighted payment for rating work," which is also what it now actually is.
5. Mechanism note: this removes the negative-spread forfeiture that RBTS used as a penalty. The incentive gradient survives — reveal-or-lose-bond kills lazy commits, and score-weighted bounty share preserves truthful-reporting incentives (the reward side of RBTS) — but the change should be re-checked by whoever owns the mechanism math. Advisory zero-bond votes (`AdvisoryVoteRecorder` pattern) remain available below the bonded tier.
6. Even with all of this: **get a formal German gambling-law opinion before mainnet** — peer-prediction staking has zero case law or GGL guidance anywhere; the design above maximizes the odds but nobody can promise the outcome. Budget this alongside the EMT/PSD2 opinion already flagged in the analysis doc.

### A.3 Latency: what "almost instant" actually requires

Current end-to-end chain and verdict on each element:

| Stage | Today | Essential? | Plan |
|---|---|---|---|
| Blind vote window | 20 min default (20 s floor – 60 d cap) | **Yes — product, not crypto.** Time for humans to answer; also the sealing period | Keep as per-question knob; agents wanting fast answers set short windows and higher bounties |
| tlock commit-reveal (drand) | Ciphertexts decryptable seconds after window ends; keeper reveals | **Yes — mechanism.** On-chain votes are public; without sealing, raters herd and peer-prediction scoring collapses. Bonus: even the operator can't peek (matters for confidential asks and for agent trust) | Keep unchanged |
| Reveal grace | 60 min | Partly. Raters don't reveal manually — the keeper decrypts everyone via drand; the grace covers keeper redundancy | Shrink to minutes (bounded keeper-retry budget) |
| RBTS settlement-pending on correlation oracle | Parks every non-tied round; 1 h timeout | **No — permissionless-trust artifact** (lets third parties challenge payout weights) | Delete with the oracle (Phase 2); settle scores directly from revealed data |
| Oracle challenge + veto windows | 15 min + 15 min (up to days) | No — same | Delete |
| Frontend fee review / unbonding | 1 h / 14 d | No — slashing-review machinery for bonded third-party frontends | Delete with the LREP bond model |
| Reward claim graces | 7 d claim / 30 d stale / 1 h feedback-award | Claim-safety, tunable | Keep; they don't delay the *payout availability*, only backstop cleanup |

**Result: after the blind window closes, reveal → settle → claimable payout in ~1–2 minutes, in a design that is more trustless than today's (no arbiter role, no operator-challengeable snapshots), not less.** The only way to go faster than the blind window is to shorten the blind window — a per-question choice the funder already controls.

Why not drop commit-reveal for a trusted instant tally? It would (a) make vote privacy depend on the operator (and the confidential-pretesting use case depends on nobody, including us, seeing early votes), (b) weaken the self-execution/non-custodial posture that both the MiCA custody analysis and the keyless story rest on, (c) remove the "agents can verify the round was sealed" property that differentiates the product from a SurveyMonkey with crypto payouts — all to save under two minutes. Short-cycle instant-gratification design also *pattern-matches toward gambling* in German regulatory practice (the GGL's DFS action targeted short-cycle money games) — a mild but real extra reason not to chase instant resolution.

---

## Part B — Target architecture

**Contracts (all non-upgradeable, no proxies, no pause, no sweeps, constructor-configured, fee + treasury immutable):**

| Contract | Fate |
|---|---|
| `LoopReputation` (LREP) | **Delete** |
| `RateLoopGovernor` + `TimelockController` | **Delete** |
| `LaunchDistributionPool` | **Delete** |
| `ClusterPayoutOracle` + correlation snapshot libs | **Delete** (first-party operation; RBTS scores directly from revealed data with equal base weights; sybil pressure handled by World ID tiers + bond floor + off-chain abuse detection) |
| `AdvisoryVoteRecorder` | Keep concept as the zero-bond advisory tier, minus launch-credit minting |
| `RoundVotingEngine` (+ storage, RBTS module) | Rewrite: USDC micro-bonds (return-on-reveal per A.2), direct settlement at reveal, no oracle dependency, no pause/roles |
| `QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`, `ConfidentialityEscrow` | Keep, USDC-only (LREP branches deleted), immutable fee bps + fee recipient, no pause, guaranteed-exit invariants |
| `X402QuestionSubmitter` | Keep (the agent lane), ownership removed, escrow addresses immutable |
| `ContentRegistry` | Keep; submission/revival economics → USDC; setters → constructor immutables |
| `RaterRegistry` + `WorldIdV4BackendIssuer` | Keep (World ID stays); config frozen at deploy (decision A.1); launch-consumer role deleted |
| `FrontendRegistry` | **Delete or radically shrink.** Without LREP bonds/slashing/fee-credit machinery, third-party frontend attribution reduces to "fee-share bps + payout address in the ask struct." Start with attribution-only; a bonded-operator program can return later as a separate contract |
| `ProtocolConfig` | Shrink to an immutable constants/addresses record (or fold into consumers as immutables) |
| `RoundRewardDistributor` | Shrink: USDC, no LREP sweeps, no frontend-fee confiscation machinery |

**Fee:** hard-coded protocol fee (percentage bps for bounties + flat-cent x402 path), immutable `PROTOCOL_FEE_RECIPIENT = Hawig UG address`, charged at escrow funding/payout sites. Fee changes = redeploy = visible to everyone, which is the point.

**Off-chain:** keeper shrinks to reveal + settle + cleanup (all snapshot proposal/challenge/arbiter code deleted — the largest share of `keeper.ts`); ponder drops LREP/governance/oracle indexing; nextjs deletes governance, tokenomics, claim/legacy, launch-credit UX and keeps wallet (thirdweb), World ID, ask/vote/result flows; sdk/agents drop LREP types and keep quote → ask → wait → result.

**Trust posture, published as a short TRUST.md:** immutable contracts (addresses + verification links), no admin keys (link to code showing none), operator cannot touch funds, votes sealed via drand tlock, settlement recomputable from public reveals (publish the recompute script — this replaces the deleted challenge machinery with evidence), bug policy = disclose → exit → redeploy.

## Part C — Phased plan

**Phase 0 — Legal + mechanism gates (before any code):**
1. German gambling-law opinion on the A.2 mechanism (bond = returnable deposit, funder-refunded forfeits, bounty-only rewards). *Blocking for mainnet, not for build.*
2. EMT/PSD2 "on behalf of clients" opinion on the escrow/payout flow (carried over from the analysis doc).
3. Mechanism review: RBTS incentive properties without negative-spread forfeiture (A.2.5).
4. Decision: World ID config frozen-at-deploy vs narrow rotation role (A.1).

**Phase 1 — Mechanism spec (small):** write the new round lifecycle spec — bond in USDC (floor sized above sybil-marginal profit for unverified raters; lower/zero for World ID-verified), reveal → bond return, non-reveal → funder refund, bounty split by RBTS weight, advisory tier unchanged. This spec is the anchor for everything below.

**Phase 2 — Contract surgery (the big one; order matters):**
1. Delete `LoopReputation`, governance stack, `LaunchDistributionPool`, `ClusterPayoutOracle` + libs, and their deploy-script sections ([Deploy.s.sol:302–445, 666–732](../packages/foundry/script/Deploy.s.sol)).
2. `RoundVotingEngine`: LREP → USDC bond per Phase 1 spec; delete oracle dependency (`settleRound` settles directly; RBTS module scores from revealed data); delete `recoverSurplusLrep`, pause, role machinery; rewrite `RewardMath.splitPool` (A.2 — no rater-to-rater forfeit flow).
3. Escrows: delete LREP branches (`REWARD_ASSET_LREP`, `BOND_ASSET_LREP`); make fee bps + recipient immutable; delete pause + `recoverNonAssetToken`; add/verify exit-path invariants (funder can always recover from wedged rounds).
4. `ContentRegistry`: submission/revival USDC; delete setters, pause, treasury mutability.
5. `FrontendRegistry` → attribution-only (or delete; fold fee-share into ask structs + `RoundRewardDistributor`).
6. De-proxy everything: `initialize()` → constructors with immutables, deploy direct, no ProxyAdmin. `ProtocolConfig` becomes constants.
7. Deploy script: single-shot deploy, zero retained roles (nothing to renounce because nothing is granted), assert-no-admin checks in a post-deploy verification script.
8. Foundry tests: prune LREP/governance/oracle suites (~large share of the ~106k test LOC), add invariant tests for "no admin path to funds" and "user exit always available."

**Phase 3 — Services (medium):** keeper: delete snapshot/challenge/arbiter jobs and related metrics, keep reveal/settle/cleanup; ponder: drop deleted-contract handlers and LREP fields in `api/{shared,earnings}.ts`; regenerate `@rateloop/contracts`.

**Phase 4 — App + SDK (medium):** nextjs: remove governance/tokenomics/claim/launch pages, LREP wallet UX, `votingTypes.ts` LREP fields; update `/docs` routes to the tokenless story + TRUST.md; sdk/agents: USDC-only types, unchanged agent flow; e2e suites updated (governance/lifecycle suites shrink, keeper suite simplifies).

**Phase 5 — Assurance + launch (calendar-driven):** internal review → audit competition on the (much smaller) immutable core → Immunefi bounty → Base Sepolia soak with agents hitting the x402 lane → mainnet single-shot deploy → publish TRUST.md + recompute script. Redeploy playbook documented in advance (Liquity model).

Rough overall effort: Phase 2 dominates; the explore inventory rates the individual items S/M/L with LREP-engine surgery, de-proxying, and `ProtocolConfig` flattening as the LARGE items — but every LARGE item is *deletion-heavy*, and the end state is a fraction of today's ~32k LOC contract surface plus a keeper reduced to its settlement core.

## Part D — Risks and open decisions

1. **Gambling-law opinion could come back adverse** even for the deposit design (untested doctrine; GGL hostile to anything poll-shaped with money). Fallbacks, in order: zero-bond voting for Germany (advisory tier + World ID gating carries sybil load), geo-scoping the bonded tier, or restructuring the bonded tier as fixed-fee work agreements. Decide only after counsel.
2. **No-oracle settlement weakens payout sybil-resistance** (correlation down-weighting is deleted). Mitigants: World ID tiers for bounty eligibility (already built), bond floors for unverified raters, off-chain anomaly detection feeding an *eligibility* (never payout-reversal) decision at question-creation time. Revisit if abuse data demands it — as a new opt-in contract, not an admin key.
3. **Immutability + bug = redeploy.** Accepted consciously; the exit-path invariant, small surface, and audit competition are the mitigations. Never ship a "temporary" pause.
4. **World ID config freezing** means a registry redeploy when World ships v5 — accepted (registry holds no funds; re-verification is a UX cost). If that proves too painful, the narrow rotation role is the documented fallback.
5. **Sole-frontend intermediary optics** remain regardless of keys — mitigated by contract-first docs, IPFS mirror, and honest "non-custodial, not decentralized-governance" language.
6. **Keeper liveness is now the main operational trust point** (reveals/settlement). It's permissionless-callable, so anyone can run a backup keeper against the public drand beacon — document how, and consider funding a community keeper as cheap credibility.

---

*Legal sources: GlüStV 2021 §§ 3–4 + official Erläuterungen; BVerwG 8 C 26.12 (poker); OVG NRW 13 B 1047/22 (no de-minimis); GGL Polymarket action (Sept 2025) and DFS/SPITCH precedent; §§ 284/285 StGB; §§ 657/661 BGB (Auslobung); ESMA event-contracts statement (July 2026); nine-regulator joint declaration; Spain vs Kalshi/Polymarket (May 2026); MFSA DeFi Discussion Paper 03-2026 + Commission MiCA-review decentralization indicators; EBA/ESMA substance-over-form commentary (BCAS, Aurum, LEXR); Ganado custody-by-control; Liquity governance-free docs + V2 bug/redeploy history (Feb–May 2025); Morpho Blue immutable-core design; Risley v. Universal Navigation (SDNY, dismissed with prejudice March 2026 — US persuasive only). Repo facts from packages/foundry (Deploy.s.sol, ProtocolConfig, RoundVotingEngine + RBTS module, RewardMath, escrows, FrontendRegistry, ClusterPayoutOracle), packages/keeper, packages/ponder. German gambling classification for peer-prediction staking has no precedent anywhere — formal legal advice is a launch gate, not a formality.*

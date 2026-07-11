# Crypto-Minimal RateLoop: Dropping LREP, Keeping a Thin On-Chain Rail — Analysis & Recommendation (July 2026)

**Status:** v2, 2026-07-11. Decision-support document with a recommendation.
**Follow-up:** the concrete repo conversion plan (keyless immutable design, gambling-law analysis of USDC vote bonds, latency/commit-reveal decision) lives in [tokenless-immutable-implementation-plan-2026-07.md](tokenless-immutable-implementation-plan-2026-07.md).
**Scope (v2, narrowed after discussion):** The question is no longer "web3 vs fully centralized." The working idea is a **thin crypto rail**: keep non-custodial, stablecoin-denominated smart contracts where they *reduce* regulatory burden, keep World ID as the optional identity layer (v4 supports passport credentials, so no separate KYC provider is needed unless it becomes simpler), and **drop the LREP token entirely**, monetizing instead with a flat fee on transactions. There are effectively no users yet, so there is no migration work and no migration story — everything can still be changed. The earlier launch-plan doc is brainstorming and is deliberately ignored here.

**Two questions this document answers:**
1. Does a crypto-minimal (tokenless) solution have a higher chance of adoption than one with its own token — given that Hacker News and parts of the AI community are actively hostile to crypto?
2. Does the "no token ⇒ Hawig UG simply charges a flat fee on all transactions" assumption hold up, legally and commercially?

---

## TL;DR — Recommendation

**Drop LREP. Keep USDC-denominated non-custodial contracts. Keep World ID as an optional credential. Charge a protocol fee hard-coded in the escrow contract. Do this now, before launch.**

The research is unusually one-sided:

1. **Adoption: yes, tokenless has a materially higher chance.** The entire credible agent-payments stack in 2026 — x402, Google AP2, Stripe ACP/MPP, MCP monetization — is tokenless and settles in USDC, with Anthropic, Google, Visa, AWS, and Cloudflare in the x402 Foundation. Token-first agent projects (Virtuals, ElizaOS, Bittensor, Fetch.ai) are covered exclusively as trading assets and show no visible adoption by mainstream AI builders. On HN, x402 threads read like Stripe threads (architectural debate, no scam accusations); Worldcoin threads are ~14-of-15 negative. RateLoop with a token pattern-matches to the camp AI builders ignore; without one, it sits inside the stack they already use.
2. **The fee assumption holds — with one design constraint.** "Operator takes a fee on each USDC flow through the contract" is a normal, productized 2026 pattern (0x sells it as a primitive; thirdweb charges 0.30%; Coinbase Commerce 1%; Uniswap Labs collected >$50M via a 0.25% front-end fee; Polymarket ran fee-free then switched fees on at ~$1M/day). A 1–5% fee is *below* both crypto norms (0.25–2.5%) and web2 marketplace norms (Upwork ~10–18.5%, Fiverr 20%+). The fee itself is not the legal problem. **What is:** operator admin-control over escrowed USDC (upgrade keys, pause/sweep powers) is what could reclassify the UG as performing MiCA custody. Design for "no operator path to user funds" and the fee is just a taxable service fee.
3. **Dropping the token deletes an entire regulatory and platform-risk class.** A transferable LREP would trigger the MiCA Title II whitepaper regime (BaFin notification, XBRL format, marketing rules — realistically mid-five to low-six figures for a UG), sits in unresolved US territory (CLARITY Act still stalled in the Senate as of July 2026), arguably violates Apple's "no currency for completing tasks" rule, and pushes the app toward Google Play's licensed-crypto-app category. USDC-only payments operate under settled law (GENIUS Act, MiCA-authorized EMT) on both sides of the Atlantic. Non-transferable (soulbound/off-chain) reputation is outside MiCA *by definition* — it isn't "able to be transferred," so it isn't a crypto-asset.
4. **The mechanism survives without LREP.** USDC-bonded truth-telling is battle-tested (Polymarket/UMA $750 USDC resolution bonds; Sherlock and Code4rena run USDC-staked adjudication with off-chain reputation). Vote stakes become small USDC bonds with the same forfeiture rules; reputation becomes non-transferable points; frontend-operator and confidentiality bonds become USDC deposits; governance becomes a published upgrade policy with timelocks (the Base/Farcaster posture, which is the accepted 2026 norm).
5. **Keep World ID; skip the KYC provider.** As a verifier, RateLoop holds only a ZK proof and a nullifier — near-zero GDPR exposure — and World ID v4's passport/document credentials cover users without Orb access. Document KYC is nearly free now ($0.33–1.50/check) but is *weaker* sybil resistance unless paired with a 1:N biometric face gallery, which is the most GDPR-hostile artifact a German UG could hold. Reserve payout-threshold KYC as a later, additive tier if AMLR obligations require it — don't build it now.

Net: the crypto-minimal design is simpler to build, simpler to regulate, simpler to explain, and better aligned with where agent payments actually happened in 2025–2026. The costs are real but manageable: no reflexive token upside for early raters, operator-trust replaces token-holder governance, and HN can still attack the product on other grounds (World ID association, "paying humans per judgment") — a token just adds a second, automatic line of attack.

---

## 1. Question 1: Does tokenless adopt better? (Evidence)

### 1.1 Developer and AI-community sentiment, 2024–2026

- HN's baseline remains anti-token: "Ask HN: What Happened to Web3/Crypto?" (2024) and "Do people still think crypto is a scam in 2025?" show the framing unchanged since Moxie's "My First Impressions of Web3" era — tokens ≈ speculation; utility claims get discounted. Molly White's *Web3 Is Going Just Great* is still active and, notably, expanded in 2026 to track crypto *and* AI political spending — the critic community now watches both of RateLoop's domains.
- **But stablecoin rails without tokens now get a measurably different reception.** The x402 launch (Sep 2025) drew 228 points/147 comments; Cloudflare's x402 monetization gateway (Jul 2026) 353 points/253 comments — and the debate in those threads is architectural (bot economics, VAT gaps), not "scam." Compare Worldcoin's HN record: roughly 14 of the top 15 stories are negative ("Worldcoin isn't as bad as it sounds: It's worse," 478 pts). The wedge between "stablecoins = payments infrastructure" and "tokens = the casino" *widened* after the GENIUS Act (July 2025) and Stripe's $1.1B Bridge acquisition; by June 2026 Stripe/Visa + 140 businesses launched a consortium stablecoin (OUSD). Crypto-minimal RateLoop sits exactly in that widening gap.
- Caveat: tokenlessness is not immunity. Polymarket — tokenless its entire life — gets hammered on HN for gambling externalities (top 2026 stories: "Polymarket gamblers threaten to kill me," 1,606 pts; Spain blocking it, 1,083 pts). HN judges product externalities; a token just adds an automatic second attack surface. For RateLoop the residual attack surfaces are World ID association and "paying humans per judgment" — both survivable, neither improved by adding a token.

### 1.2 Case studies

**Tokenless products that won mainstream legitimacy:**

- **Polymarket** — USDC-only for its whole run; took a $2B investment from ICE (NYSE's parent) at an $8B valuation (Oct 2025). Hard to imagine that money landing on a platform with a live speculative governance token. Its 2026 "token" (Polymarket USD) is deliberately a non-tradable 1:1 USDC settlement wrapper; a POLY governance token remains promised-but-unlaunched, sequenced *after* mainstream legitimacy. Pattern: legitimacy first, token maybe later.
- **Farcaster** — still no token as of 2026, deliberately; monetizes with SaaS-like fees (storage rent, Pro at 120 USDC/yr, non-tradeable Warps credits, USDC creator rewards).
- **Base** — Coinbase's L2, tokenless 3+ years; a token remains merely "explored," largely because a serious corporate/regulatory posture and a token are in tension — itself a datapoint.
- **x402** — no token; Linux Foundation governance; ~169M payments, ~590K buyers, ~100K sellers in year one; embedded at the edge by Cloudflare and AWS. (An unofficial "x402 memecoin boom" by third parties didn't dent the standard's credibility — precisely because the standard has no token.)

**Token-first cautionary tales:**

- **Friend.tech** — the token launch was the proximate cause of collapse: community uproar at the FRIEND launch, activity cratered, team abandoned the contracts.
- **Worldcoin/WLD** — directly relevant since RateLoop uses World ID: WLD is down ~97% from its 2024 ATH, called "predatory low float" by ZachXBT, banned/suspended in 8+ countries with regulators explicitly citing that *paying tokens for biometrics corrupts consent*. Meanwhile Zoom, Tinder, and Shopify adopted World ID in 2026 **despite** the token — the ID utility survives; the token is the PR liability. RateLoop already imports Worldcoin-adjacent reputational risk via World ID; adding its own token would compound it.
- **Helium** — the canonical "token bootstraps supply, not demand" case: emissions built hotspot coverage nobody used; the analogous RateLoop failure is raters farming LREP with low-quality ratings — supply without demand quality, attacking exactly the asset (rating integrity) the marketplace sells.

### 1.3 Token-incentive churn (the marketplace-specific evidence)

- Academic and industry data agree: airdrop/token-farmed users are mercenary. Up to ~66% of some airdrops sold in the first post-claim transaction (arXiv 2312.02752); zkSync active addresses fell ~85% within months of its token distribution; 2026 DeFi commentary ("Airdrops Are Dead") documents usage reverting to baseline once emissions stop.
- VC doctrine matches: a16z's token playbook opens with "the most common mistake in web3 is launching tokens too early — often fatal"; Variant's progressive-decentralization playbook is explicit that the token comes *after* PMF and community. A token is defensible for bootstrapping a physical supply network (Helium-style) or decentralizing a protocol with real third-party operators — RateLoop needs neither pre-PMF.
- MiCA quietly kills the growth-airdrop channel anyway: a distribution is not "free" (Art. 4(3) exemption) if recipients provide personal data or actions in exchange — which is what a verified-human launch distribution is.

### 1.4 The AI-agent ecosystem specifically

Two parallel economies with almost no crossover:

- **Token world:** Virtuals (~$5B peak mcap), ai16z/ElizaOS, Bittensor, Fetch.ai/ASI — covered by crypto media as trading assets, all 55–85% below ATH, with no visible adoption by OpenAI/Anthropic-ecosystem or LangChain developers.
- **Tokenless world (what mainstream builders actually use):** Stripe's Agentic Commerce Protocol + Machine Payments Protocol (Etsy/URBN/Coach onboarded), x402 (160M+ autonomous transactions; supported by Stripe itself; incorporated into Google's AP2 for agent-to-agent payments). Settlement is USDC or card rails. **None of these standards has a native token.**

**Answer to Question 1: yes.** For RateLoop's specific buyers (AI-agent builders) and its loudest amplification channel (HN), a tokenless USDC + x402 product is inside the credible stack; the same product with LREP pattern-matches to the speculative camp those audiences dismiss. The token would also *attract the wrong supply side* (farmers) while repelling the demand side (builders, enterprises, app-store review).

---

## 2. Question 2: Does the flat-fee model hold up?

### 2.1 Commercially — yes, and it's the norm

| Precedent | Fee | Relevance |
|---|---|---|
| Coinbase Commerce | 1% flat | Simple stablecoin acceptance benchmark |
| thirdweb Payments | 0.30% protocol fee | Fee hard-coded at protocol layer, productized |
| 0x | 0.15% + "set your fee, set your recipient" API | Sells operator-skim-via-contract as a primitive |
| Uniswap Labs | 0.25% front-end fee, >$50M collected (removed Dec 2025 in UNIfication) | Proves the model at scale; also proves a fee charged at a *bypassable* layer invites bypass |
| Polymarket | Fee-free through 2025 → taker fees 2026, ~$1M/day | Bootstrap fee-free, switch on later, works |
| OpenSea | 0.5–2.5% over its life | Marketplace-take benchmark |
| x402 facilitator | $0.001 flat per tx after 1,000 free/month | The agent-micropayment pricing shape |
| Escrow.com | 0.89–3.25% | Non-crypto escrow-as-a-service benchmark |
| Upwork / Fiverr / app stores | ~10–18.5% / 20%+ / 15–30% | Web2 marketplace norms |

Implications for RateLoop:

- A **1–5% protocol fee on bounty flows** is comfortably inside all norms and undercuts web2 judgment marketplaces by 2–10×. Percentage fees fit marketplace-sized bounties; **flat-cent fees (x402-style) fit agent micro-asks** — support both shapes.
- **Hard-code the fee in the escrow contract**, not the frontend. The Uniswap episode shows interface-layer fees get bypassed by forks/aggregators; a contract-layer fee is the defensible version (and 0x/thirdweb have normalized exactly this).
- Optionality preserved: Polymarket demonstrates fee-free bootstrap → fees later is a viable sequencing if early liquidity matters more than early revenue.
- German VAT is unexciting (good): a fee collected in USDC is ordinary consideration for a service — 19% VAT where applicable, reverse charge cross-border B2B, invoiced at the EUR value at receipt. For a stablecoin the FX-documentation burden is trivial.

### 2.2 Legally — yes, with one hard design constraint

The fee itself is *evidence* of intermediation but not an offense; no authority treats charging a fee as a standalone licensing trigger. The actual MiCA/BaFin exposure concentrates in one place:

- **Custody-by-control.** MiCA custody includes "exercise of control over crypto-assets on behalf of clients," and legal commentary explicitly warns control can arise via **smart contracts with administrative privileges**. BaFin has form on aggressive readings (it treated some delegated-staking-via-contract setups as licensable even where assets stayed in user wallets). If Hawig UG holds upgrade keys, pause powers, or sweep paths over escrows containing user USDC, that is the fact pattern a regulator would attack.
- **Mitigations (which are also credibility features, §4):** immutable escrow fund paths; upgrades that are timelocked and structurally unable to touch in-flight escrows; protocol-defined (not per-escrow discretionary) fee routing; users self-executing all transfers.
- **The "fully decentralised" exemption is not available** — an identifiable fee-collecting operator with upgrade authority and the only practical frontend fails every prong of the EBA/ESMA reading. That only matters if the activity is a listed CASP service at all; the defensible posture is "software provider / marketplace operator that never controls user funds."
- **The sleeper risk: USDC is an EMT ⇒ "funds" under PSD2** (EBA Opinion, June 2025; transition ended March 2026). EMT transfers *carried out on behalf of clients* are payment services. If contracts merely let users self-execute, the "on behalf of" element is arguably absent — but escrow-and-payout of e-money-equivalent tokens looks more like payment intermediation than a DEX does. **No public BaFin decision squarely covers non-custodial escrow with an operator fee. This is the single question to put to German counsel before building.** (This is also the strongest argument for the thin *on-chain* rail over any off-chain ledger: self-executed, non-custodial contract flows are the version of this business with the best licensing argument. A custodial in-house ledger is unambiguously worse.)

**Answer to Question 2: the assumption holds.** Flat fee on all transactions is the standard tokenless monetization, at rates far below web2 marketplaces, with normal VAT treatment — provided the contracts are designed so the UG demonstrably cannot touch escrowed user funds, and counsel signs off on the EMT/PSD2 "on behalf of clients" question.

---

## 3. What replaces LREP, concretely

The codebase already separates the USDC bounty lane from the LREP lane, so this is a role-by-role substitution, not a redesign:

| LREP role today | Tokenless replacement | Precedent |
|---|---|---|
| Vote stake (1–10 LREP, forfeited on non-reveal) | Small USDC bond, same commit-reveal forfeiture rules | Polymarket/UMA resolution bonds ($750 USDC); Sherlock/Code4rena USDC-staked adjudication |
| Reputation / earned standing | Non-transferable points (off-chain, or soulbound attestations if on-chain portability is wanted) — outside MiCA by definition (not transferable ⇒ not a crypto-asset) | Sherlock Watson leaderboard; Farcaster Warps (non-tradeable credits) |
| Frontend operator bond (1,000 LREP, slashable) | USDC deposit, slashable by the same challenge logic | Standard surety-bond pattern |
| Confidentiality bond + identity sanction | USDC bond + World ID nullifier ban (unchanged — the sanction never depended on LREP) | Already implemented |
| Governance (Governor + timelock + LREP votes) | Company-controlled with published constraints: security-council-style multisig, timelocked upgrades, immutable fund paths, public upgrade policy | Base (Stage 1, tokenless, 10-member council); Farcaster |
| Launch distribution pool (75M LREP) | Delete. Early-rater incentives, if any, are paid in USDC (bounty subsidies), which attracts earners rather than farmers | Airdrop-churn evidence, §1.3 |
| Challenge bonds / challenger rewards (ClusterPayoutOracle) | USDC bonds; or outsource dispute escalation to an existing token-secured oracle (UMA/Kleros) rather than building one | Polymarket outsources its token layer to UMA |

Known costs of the substitution — accept them consciously:

1. **No reflexive alignment.** Raters get cash and reputation, not upside. Retention rides on real yield and status. (The churn evidence says token upside buys farmers, not retention, so this is a smaller loss than it looks.)
2. **Capital cost of USDC stakes.** Locked USDC has a T-bill-ish opportunity cost; keep stake durations short and stake floors sized above sybil-marginal profit (World ID helps set that floor low for verified humans).
3. **The Kleros argument** (a native token makes 51%-stake-buy attacks self-punishing and fork-recoverable) applies weakly here: RateLoop's per-round stakes are small and per-market, commit-reveal + forfeiture prices spam, and the backstop can be outsourced. The Gauntlet counterpoint also applies: stablecoin security is *stable* — it doesn't collapse when a token dumps.
4. **Gameable points.** Non-valuable reputation invites farming and status-gaming; standard SBT-literature failure modes (farming, disclosure pressure) apply. Points should gate eligibility and weight, never be sellable or redeemable.

## 4. Identity: keep World ID, skip the KYC provider (for now)

- **As a verifier, RateLoop holds no biometric or document data** — only a ZK proof and a per-app nullifier. GDPR exposure is minimal; the Art. 9 controversy (BayLDA ruling, EU enforcement) sits with Tools for Humanity. The reputational association is a real but bounded cost — and note that Zoom, Tinder, Shopify, and DocuSign adopted World ID in 2026 despite it.
- **World ID v4's credential tiers solve the coverage problem that motivated the KYC idea:** Orb (strongest uniqueness, ~18M verified, ~23 countries) plus **passport/document credentials** (NFC passport scanned on-device, ~12 countries and growing, per-document uniqueness) plus device-level credentials. The repo already models exactly this (`SELFIE`/`PASSPORT`/`PROOF_OF_HUMAN` credential kinds in `RaterRegistry`).
- **Centralized KYC would be cheap ($0.33–1.50/check, free tiers at Didit/Persona) but is the wrong tool:** document KYC without 1:N face search doesn't prevent multi-accounting; with 1:N face search, the UG holds a biometric duplicate-detection gallery — the most GDPR-hostile artifact possible in its home jurisdiction, and precisely what BayLDA attacked World over. Plus 40–70% onboarding drop-off if required before earning.
- **The one future trigger:** if counsel concludes AMLR (phasing in 2026–27) imposes payout-KYC obligations, add document KYC as a payout-threshold tier (Didit/Persona free tiers), not a signup gate. Keep the credential interface pluggable — eIDAS 2.0 EUDI wallets (mandatory issuance by end-2026) may become the cheapest compliant EU identity rail by 2027.

## 5. Target architecture (what this means for the repo)

**Delete:** `LoopReputation.sol` (LREP), `RateLoopGovernor` + timelock, `LaunchDistributionPool`, LREP paths in escrows/registries, LREP staking in `RoundVotingEngine` (→ USDC bonds), the 1,000-LREP frontend bond (→ USDC deposit). Evaluate `ClusterPayoutOracle` + correlation-snapshot machinery separately — it exists to make *permissionless* settlement challengeable; under a company-operated posture, a simpler published-evidence scheme (signed artifacts, recompute scripts) may buy the same audit-ability with far less contract surface and most of the keeper's complexity.

**Keep (thin rail):** USDC bounty/feedback/confidentiality escrows with immutable fund paths and contract-level protocol fee; `X402QuestionSubmitter` (EIP-3009 agent lane — this *is* the x402 story); World ID verification in `RaterRegistry`; commit-reveal voting (with USDC micro-bonds); Base as the chain (tokenless L2, cheap, x402-native).

**Consequences:** governance runbooks, launch-pool logic, LREP tokenomics, and (probably) the correlation-oracle challenge economy disappear; keeper and ponder shrink to settlement + indexing of a much smaller contract set; the frontend loses all token UX (locks, governance, launch credits) and keeps wallet + World ID + bounty flows. Rough guess: half or more of the Solidity surface and most of the governance/ops burden goes away, while the regulatory posture *improves* (fewer admin powers, no token). No migration needed — there are no users; redeploy fresh.

**Positioning follows the architecture:** describe the product as "USDC-paid human judgment for agents, with cryptographic escrow and optional proof-of-human" — the Polymarket/Farcaster framing where the chain is an implementation detail, never the pitch. The word "token" should not appear anywhere.

## 6. Risks and open questions

1. **EMT/PSD2 "on behalf of clients"** — the one genuinely unresolved legal question (§2.2). Get a German legal opinion on the exact escrow/payout flow before building. High uncertainty; no on-point precedent found.
2. **Admin-key discipline is now load-bearing twice** — for the custody analysis and for user credibility (the April 2026 Drift exploit, a socially-engineered security-council multisig, made "who holds the keys" a live user question). Publish the upgrade policy; keep fund paths immutable.
3. **World ID association** remains RateLoop's largest residual HN/PR attack surface (WLD −97%, country bans, account black market where verified accounts sell for <$30). Mitigations: it's optional, it's one tier, we hold no PII, and face-auth rechecks are improving. Monitor; keep the credential layer pluggable.
4. **x402 demand is small and partly wash-traded today** (~$28k/day real volume per CoinDesk's March 2026 analysis, ~50% gamified) even though the rail's institutional backing means it will persist. Size the agent-lane bet accordingly: it's a cheap-to-keep ingress, not proof of demand.
5. **Retention without token upside** — pure cash + status must carry the supply side. If early rater liquidity stalls, subsidize bounties in USDC rather than reaching for a token; Polymarket's sequencing (legitimacy first, token maybe never) remains available forever, while the reverse sequencing does not.
6. **CLARITY Act** may pass in late 2026 and soften US token risk — this changes the *cost* of a future token, not the pre-PMF case against one now.

## 7. Bottom line

The original instinct behind "web3" here — credible neutrality, non-custodial money handling, agent-native payments — survives fully in a tokenless design; it's specifically the *token* that carried most of the regulatory cost, the platform-policy risk, the farmer-shaped incentives, and the pattern-match that makes HN and AI builders dismiss a product on sight. Meanwhile the fee model that replaces it is not a compromise: it's the same model the most legitimate actors in the space (Coinbase, thirdweb, Polymarket, Stripe-adjacent rails) converged on, at take rates far below the web2 marketplaces RateLoop implicitly competes with.

**Build the tokenless thin rail: USDC escrows with a hard-coded 1–5% fee (flat-cent pricing for agent micro-asks), USDC vote-bonds, non-transferable reputation, World ID as the optional human tier, company-controlled contracts with published immutable fund paths — and spend the LREP engineering/compliance budget on the two things the research says actually gate adoption: answer quality and the agent-facing API.**

---

*Sources (key): HN Algolia records for x402/Worldcoin/Polymarket threads; a16z token-launch playbook; Variant progressive-decentralization playbook; arXiv 2312.02752 (airdrop churn); zkSync post-airdrop activity analyses; ICE–Polymarket investment coverage (CoinDesk); Farcaster/Base tokenless-governance analyses (BlockEden, Base blog — Stage 1 + Security Council); x402 Foundation (Linux Foundation) membership and volume figures; CoinDesk 2026-03-11 on x402 volume quality; Stripe ACP/MPP and Bridge/OUSD coverage (Fortune, Forrester); Polymarket fee docs + Sacra; Uniswap Labs fee history + UNIfication; 0x pricing/monetization docs; thirdweb fee docs; Coinbase Commerce fees; Escrow.com fees; Upwork/Fiverr take-rate stats; MiCA Title II whitepaper regime analyses (Paul Hastings, LegalNodes, White & Case); MiCA airdrop-exemption analysis (Axis Advisory); soulbound-token MiCA classification (BCAS); Recital 22 / fully-decentralised analyses (Aurum, BCAS, LEXR); Ganado on custody-by-control; BaFin Kryptoverwahrgeschäft guidance + FIN LAW on delegated staking; EBA Opinion EBA/Op/2025/08 on EMT/PSD2 (+ Morgan Lewis, DLA Piper); German crypto-VAT commentary (Acconsis, WINHELLER); CLARITY Act trackers (Latham, Congress.gov, June–July 2026 stall coverage); Kleros "Why Kleros Needs a Native Token"; Gauntlet on stablecoin economic security; Polymarket/UMA resolution-bond docs; Sherlock/Code4rena; WLD decline and country-ban coverage (Crowdfund Insider, Tempo, Biometric Update, Rest of World, Axios); World ID v4 credential docs (world.org); Apple App Store crypto-guideline coverage (Decrypt, Crowdfund Insider); Google Play crypto-license policy (Forbes, Manimama); Didit/Persona/iDenfy/Veriff/Stripe Identity/Sumsub pricing pages; Sumsub 2025–26 fraud report; eIDAS 2.0 (Reg. EU 2024/1183). Figures are point-in-time, partly self-reported; verify before external use. v1 of this document (fuller centralized-KYC and payment-rail landscape, custodial-ledger analysis) is in git history.*

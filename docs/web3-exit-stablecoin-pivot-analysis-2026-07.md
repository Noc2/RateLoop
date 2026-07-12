# RateLoop Tokenless: Strategy Rationale (July 2026)

**Status:** Decided. This document records *why* RateLoop is built tokenless. The architecture and roadmap live in [tokenless-immutable-implementation-plan-2026-07.md](tokenless-immutable-implementation-plan-2026-07.md); legal and revenue details in [legal-revenue-assessment-tokenless-design-2026-07.md](legal-revenue-assessment-tokenless-design-2026-07.md).

## The decision

Drop the LREP token entirely. Keep a thin, non-custodial crypto rail: immutable USDC escrow contracts on Base, free stake-less voting, World ID as an optional identity credential (verified off-chain), and an interface fee as the business model. Position the product as **verified-human panels for agents and brands — minutes-fast, pay-per-question, provably sealed**. The chain is an implementation detail in all buyer-facing communication; the word "token" appears nowhere.

## Why tokenless (adoption)

- **The credible agent-payments stack is tokenless.** x402, Google AP2, Stripe ACP/MPP, and MCP monetization all settle in USDC or fiat; the x402 Foundation (Linux Foundation) includes Anthropic, Google, Visa, AWS, Cloudflare. Token-based agent projects (Virtuals, ElizaOS, Bittensor, Fetch.ai) trade as speculative assets and show no adoption by mainstream AI builders. A token pattern-matches RateLoop into the camp those builders ignore.
- **Developer sentiment splits cleanly along the token line.** On HN, x402/stablecoin-rail launches get architectural debate; token projects get hostility (Worldcoin's top HN stories are ~14-of-15 negative). Post-GENIUS-Act (2025) and post-Stripe/Bridge, "stablecoins = payments infrastructure, tokens = the casino" is the prevailing frame — the tokenless product sits in the legitimized half.
- **Tokenless is the proven mainstream-legitimacy path.** Polymarket (USDC-only, later took NYSE-parent investment), Farcaster, Base itself, and x402 all reached credibility without a token; Friend.tech's token launch was its collapse; WLD is the PR liability *around* World ID, not the useful part. Token incentives also recruit the wrong supply: airdrop-churn data (up to ~66% instant-sell; zkSync −85% actives post-token) says token rewards attract farmers — fatal for a product whose value is rating integrity.
- **Dropping the token deletes a regulatory and platform-risk class.** A transferable token would trigger the MiCA Title II whitepaper regime, sit in unresolved US territory, arguably violate Apple's "no currency for completing tasks" rule, and push the app into Google Play's licensed-crypto category. USDC-only payments operate under settled law (GENIUS Act; MiCA-authorized EMT). Non-transferable reputation is outside MiCA by definition.

## Why the fee model works (monetization without a token)

- "The interface charges a fee; the protocol is neutral" is the standard, litigation-tested pattern (Uniswap Labs' interface fee earned >$50M and coexisted with the SEC probe closing; 0x and thirdweb productize caller-set fee fields). Contracts carry a neutral `feeBps + feeRecipient` field (capped, default 0, no company address on-chain); RateLoop's own frontend/API populate it.
- **5–10% of bounty** (start ~7.5%) sits between crypto norms (0.25–2.5%) and web2 managed-marketplace norms (Upwork ~10–18.5%, Fiverr 20%+), justified by the managed work involved (verified rater supply, settlement, transparency, anti-collusion).
- Bypass risk is low: paying customers arrive through RateLoop's API, where discovery, quoting, rater supply, and the keeper live. Third-party frontends use the same fee field and monetize their own flow.

## What replaces the token, role by role

| LREP role | Replacement |
|---|---|
| Vote stake | Nothing — voting is free. Sybil/quality control via identity tiers, per-identity caps, gold questions, reputation gates (stake-free is the industry norm: Community Notes, Code4rena, Sherlock, Metaculus) |
| Reputation | Non-transferable points/attestations (outside MiCA — not transferable ⇒ not a crypto-asset) |
| Governance | None over funds — the fund-holding core is adminless and non-upgradeable; the separate credential issuer retains disclosed signer rotation for future admission only; bug response = disclose → exit → redeploy |
| Launch distribution pool | Deleted; any early incentives are USDC bounty subsidies (attract earners, not farmers) |
| Frontend operator bond | Deleted; attribution-only fee share |
| Challenge-bond oracle | Deleted; commitment-based transparency log + off-chain analytics (the Gitcoin/Community Notes pattern — single-operator challenge games are theater) |

## Identity: World ID without KYC

World ID stays as an optional credential, verified **off-chain** (cloud API + backend-signed attestations), so the provider is swappable without touching contracts. Its tiers (selfie = live human; passport = per-document uniqueness; Orb = global uniqueness) become funder-selectable assurance levels. A centralized KYC provider is not needed: document KYC is weak sybil resistance without a GDPR-hostile 1:N face gallery, and the only identification the law actually forces (DAC7 tax form for paid EU raters) is a self-declaration sheet, not KYC. As a relying party RateLoop holds no biometric or document data.

## Accepted costs

No reflexive token upside for early raters (retention rides on cash yield and status); operator-trust over voter admission replaces token-holder governance (bounded by an adminless fund core, immutable accepted commits, and published issuance evidence); World ID association and "paying humans for judgment" remain attackable surfaces regardless — a token would only have added a second one.

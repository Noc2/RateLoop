# RateLoop tokenless legal and revenue reference

**Status:** Current internal issue-spotting reference, not legal advice. The
[design of record](tokenless-immutable-implementation-plan-2026-07.md) controls architecture and the
[production-readiness register](tokenless-production-readiness-2026-07.md) controls release approval. Counsel questions
and regulatory operations remain real-money gates where the readiness register says they are required.

## Revenue model

**Fee attachment:** contracts carry a neutral caller-set `feeBps + feeRecipient` (immutable cap 20%, default 0, no company address on-chain); RateLoop's own frontend/API/MCP tools populate it. Legally this is an interface fee for the interface's service — the structure that survived the SEC's Uniswap probe and Risley, and that avoids ESMA's "identifiable operator profits from the protocol" indicator. Treat the characterization as helpful, not dispositive, in the EU (US-only authority; on the counsel list). It is also the cleanest German VAT shape: an invoiced platform-service fee (19% / reverse charge B2B).

**Levels:** 5–10% of bounty (start ~7.5%), flat and product-agnostic; quoted all-in on the x402 lane with a small fixed floor; itemized (bounty / platform fee / VAT) on every post-purchase receipt. Raters are always free — no rater-paid conveniences (any operator-collected rater payment tied to bounty access would reopen the gambling analysis).

**Stack:** (1) the take rate on funded bounties; (2) B2B SaaS/API tiers (dashboards, private rounds, analytics, SLAs — micro-fees alone don't sustain; the "open protocol, paid infra" pattern carries B2B); (3) per-call x402/MCP pricing on read/analytics endpoints; (4) treasury yield (~3–4%) on the company's own USDC balances via a regulated partner — never on customer funds, never passed to users (avoids CASP-characterization facts); (5) later, aggregate ratings-data licensing.

**Bypass:** low risk — paying customers arrive through RateLoop's API where discovery, quoting, rater supply, and the keeper live; third-party frontends use the same fee field under an integrator policy (attestation access conditions, optional rev-share).

## Legal surface by area

### Tax (the two heavyweight items)

**VAT deemed-supplier risk on the full bounty flow.** Under the CJEU's Fenix/Xyrality line, a platform that sets the terms and controls payment can be deemed to supply the underlying service itself — VAT on 100% of B2C/German bounty volume, not just the fee. Structure before scaled launch: disclosed-intermediary contract architecture (raters/the protocol pool owe the rating performance; the company owes platform services and invoices only its fee), stable pseudonymous rater IDs on receipts, funder VAT-ID capture (B2B = reverse charge), and consider a binding ruling (verbindliche Auskunft). Ratings are likely not an "electronically supplied service" (per-transaction human work), which blocks the irrebuttable platform presumption but not the general analysis.

**DAC7 (PStTG).** Bounty-paid ratings are reportable "personal services" with **no de-minimis** (the 30-transactions/€2,000 threshold is goods-only) — a rater paid €5 once is reportable. There is no escape via partial decentralization: no "fully decentralised" exemption exists; a ToS frontend plus mandatory eligibility attestations is "contracting with sellers"; unbundling multiplies duties; offshore relocation swaps regulators (place of management keeps a German founder in scope); deliberately blinding payout attribution is foreclosed by the attestation design; and "it's a contest prize, not a service" would undercut the gambling-law position (pick one characterization). **But DAC7 ≠ KYC:** the duty is a self-declaration form (name, DOB, address, TIN-or-place-of-birth) plus plausibility checks against records already held (IP, phone, locale — no ID documents, no biometrics; documents only if the BZSt challenges a specific seller — reserve that right in the ToS). The **active-seller election** means users who only browse or calibrate advisory tasks need zero data. Because the tokenless contract makes settled claims permissionless, the form must be completed at **paid-task unlock, before the first paid voucher is issued** — never after a bounty has been earned or as a surprise withdrawal gate. Everyone requesting paid eligibility answers one residence question; only EU residents see the full form; refusers remain advisory-only (§ 23 ineligibility path). An EU operator has **no registration duty** — obligations start with BZSt DIP portal onboarding in the first calendar year raters are paid, report due 31 January following. A €5,000 § 10 PStTG binding ruling is available for scope certainty. Low-risk remainder: no § 50a withholding (rating work isn't in the catalog); DAC8/KStTG prima facie inapplicable (no exchange/custody services); USDC bookkeeping per the 2025 BMF letter.

### Financial regulation

The design's load-bearing property: **no operator path to user funds.** Escrow sits in an immutable adminless fund-holding core; users self-execute; the keeper only calls permissionless functions; payout claims are permissionless (the auto-claimer is a convenience executor, self-claim is the fallback). The separate credential issuer can rotate admission signers and censor new commits. A compromised admission signer can fill remaining seats in open rounds, influence their verdicts, and direct the bounties for those attacker-controlled reports until rotation, but it cannot touch escrow, redirect another report's claim, or alter an accepted commit. Do not describe the whole system as fully keyless. Circle retains USDC token-layer pause and blacklist authority, including over transfers to or from the escrow contract. This gives the best MiCA/PSD2 posture, but it is a posture rather than a conclusion: no on-point precedent exists for fee-charging non-custodial escrow, and the counsel questions remain open. GwG/AMLR: not an obliged entity on the current theory (the AML perimeter tracks the CASP perimeter); keep a decentralization memo current; monitor the 2027+ DeFi reviews. Never hold pooled user balances; B2B prepaid balances sit with a regulated partner. Never build operator-controlled rater key recovery.

### Sanctions (binds everyone, effectively strict liability)

Frontend wallet screening + screening at paid-eligibility issuance (no keeper payout call exists to screen); geoblock RU/BY/IR/KP/SY/CU and occupied territories; ToS prohibitions (sanctioned persons, mixers, proceeds of crime); no operator-provided anonymization; one-page policy + Bundesbank escalation route. A credible notice immediately blocks new vouchers, interface access, and auto-claim assistance and is documented/escalated. The immutable core cannot stop an already-earned permissionless claim; state that limit rather than promising a technical block that does not exist. Circle can blacklist USDC at the token layer, including the escrow contract.

### Gambling (resolved by design)

Raters pay nothing — no Entgelt, so § 3 GlüStV cannot apply (gas paid to validators is like postage; sponsored relay removes even that). Funders buy a service, not a wager. Guardrails that keep it resolved: no rater-paid fees of any kind, no stake, forfeit-to-winners structures never return. A confirmatory (non-blocking) opinion is on the counsel list; any operator-collected participation fee would make it a gate again.

### Paid-review law (framing rule)

The product commissions paid ratings. UWG Anhang Nr. 23b/23c blacklists presenting commissioned reviews as consumer feedback; § 5b Abs. 3 UWG imposes disclosure duties on anyone making "ratings" accessible. Therefore: the product is **paid panel research / pretesting — never "reviews"**; funder ToS prohibit presenting scores as organic consumer feedback and require "paid panel" disclosure in public use; a methodology page is published; the compliant "Panel Verdict" share artifact is the sanctioned way to publicize results.

### Consumer & contract law

Launch is **B2B-only** (self-declaration + VAT-ID, plus machine-readable trader self-identification in the 402 offer), which switches off most consumer machinery. Still required: § 312j-compliant order button with the info block adjacent (a mislabeled button = no contract, per BGH — while the USDC already moved); German-language AGB with the company as disclosed intermediary (Vermittler) and unmistakable disclosure of who owes the rating performance; smart-contract finality framed as Leistungsbeschreibung, never a rights waiver; qualified choice-of-law clause; marketplace disclosures (§ 312l: ranking parameters, counterparty trader status, duty split). If consumer funders ever ship: Widerruf machinery (double-checkbox waiver before the funding tx, § 356a withdrawal button, 12-month penalty for botched instructions).

### Platform law (DSA & German basics)

Applies from day one at any size: contact points (Arts. 11–12), plain-language moderation terms (Art. 14), a notice-and-action mechanism (Art. 16), statements of reasons for removals (Art. 17), law-enforcement notification (Art. 18) — Arts. 16–17 gaps are what German enforcement actually pursues. Micro-enterprise carve-outs remove transparency reports, complaint systems, trusted flaggers, and trader KYBC until >50 staff/€10M. Plus: § 5 DDG Impressum, § 25 TDDDG consent banner (the classic Abmahnung targets), TCO contact point + 1-hour takedown runbook. P2B very likely inapplicable (funders buy, raters supply).

### Content liability

Hash-only on-chain keeps content takedown satisfiable (de-list, de-pin, denylist), but cannot erase accepted commitments or cancel their deterministic terminal path. Stop new vouchers, remove served content, and compensate already-accepted work from the attempt reserve/platform make-good; do not create a free-answer path for the offending funder. Apply notice-and-stay-down (hash-block re-uploads) after specific copyright notices; CSAM = immediate deletion from own storage + BKA report; funder warranties + indemnities + rater confidentiality click-throughs for submitted material; pre-round moderation screen; the confidential lane is restricted to identified raters (trade-secret adequacy). Rater age: 18+ in the paid-eligibility matrix; JuSchG/JMStV on the counsel list.

### Data protection

Wallet addresses, votes (opinions are inherently personal data — CJEU), and identity nullifiers are pseudonymous personal data for the operator. A paid commit publishes tlock ciphertext containing the vote, prediction, response hash, payout address, and salt. Committing irrevocably schedules that material to become publicly decryptable at the configured drand round after the commit deadline, whether or not the reviewer or keeper submits a reveal or claim; there is no post-commit abort. Reveal calldata also publishes the plaintext. Customer artifacts, rubrics, rationales, cohort membership, provider evidence, and vote-key mappings stay encrypted off-chain under purpose-separated key domains. Each customer artifact has a random data-encryption key. Hosted wrapping requires workspace/project-scoped AWS KMS alias templates and authenticated encryption context; authorized RateLoop workload roles can still invoke the resolved tenant key and decrypt that tenant's artifacts. Provider key provisioning, inventory, rotation/rewrap, workload-access exercises, and the DPIA remain real-customer release gates. The operator must never hold a rater spend key; the public drand/tlock reveal lane needs no operator-held universal reveal key, but that statement does not describe the customer-artifact vault. Erasure means deletion or key destruction after the applicable retention period (§ 147 AO 8–10y for the statutory records that require it; Art. 18 restriction meanwhile). Reusing a payout destination links rounds. The final DPIA may claim cross-round unlinkability only after a user-controlled per-round destination and recovery flow is implemented and tested. DPIA headline scenarios include both breach of the vote-key↔rater mapping (a standing deanonymization key for an immutable public record) and unauthorized disclosure of confidential customer artifacts. The DAC7 vault is separately keyed, access-controlled, and deletion-scheduled. World ID, Self, customer invitations, and manual qualification are optional, purpose-bound admission sources; RateLoop must request predicates rather than raw identity/document fields where possible and provide a non-biometric path to paid eligibility. Nationality, document-issuing country, declared residence, tax residence, and sanctions decisions are not interchangeable. Privacy notice and an accurate public-metadata preview precede on-chain commitment; maintain Art. 30 records and documented Chapter V analysis for public-chain replication.

### Labor

Keep rating genuinely voluntary: no obligation to accept tasks, no streaks/decay/time pressure (the BAG crowdworker ruling turned on gamified steering). Rater payouts are the rater's taxable income — say so in the terms. The published scoring algorithm and transparency surfaces double as Platform Work Directive algorithmic-management transparency (transposition due Dec 2026 — monitor).

## Counsel questions (parallel backlog)

1. Art. 28 VAT deemed-supplier structuring + binding ruling, incl. whether a pseudonymous receipt-layer rater ID satisfies the disclosure conditions.
2. EMT/PSD2 "on behalf of clients" on the escrow flow + the EU interface-fee characterization.
3. DAC7 for pseudonymous on-chain payees (no BZSt guidance); §§ 14 ff. verification standard for non-EU residency claims; whether a wallet address is the "financial account identifier"; whether unclaimed-but-claimable payouts are "credited"; the § 10 PStTG binding-ruling decision.
4. GeschGehG adequacy of the identified-rater confidential lane.
5. ESS characterization of the aggregated rating product (place of supply).
6. Consumer flows, if ever: Widerruf/§ 312j mechanics incl. consumers acting through agents.
7. Paid-review/UWG framing sign-off.
8. Versicherungsgeschäft quick check on the bounded remediation guarantee; JuSchG/JMStV rater-age check; confirmatory gambling-law opinion.

## Monitor list

DSA Section 3 duties (only after outgrowing micro/small); P2B if the user mix inverts; Platform Work Directive transposition (Dec 2026); AMLR/TFR reviews on DeFi interfaces (2027+); Tornado Cash appeals; VG Ansbach on World ID; MiCA-2.0 stablecoin-rewards changes; DAC8/KStTG boundary; § 13b reverse-charge mechanics if deemed-supplier VAT ever bites; European Accessibility Act/BFSG (micro-exempt now — build accessibility-aware defaults anyway).

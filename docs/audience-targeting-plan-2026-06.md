# Audience Targeting Plan — June 2026

A multi-agent research pass on RateLoop's audience/profile targeting system: what exists today,
whether self-reported targeting is credible enough to sell, and a phased plan to upgrade it. One
agent mapped the existing implementation end-to-end; one researched how incumbent panels
(Prolific, Dynata/Cint, CloudResearch, Wynter, Respondent) validate self-reported attributes and
what the misreporting literature says; one researched verified-attribute credential rails
(World ID 4.0, zkPassport, EAS, zkTLS) and their privacy/compliance constraints.

This refines the `use-cases-2026-06.md` finding "no demographic or expertise targeting" — that
was overstated. The accurate statement: **RateLoop has a real self-reported audience-context
system, but ask-side targeting is advisory-only, nothing validates profile claims, and several
pieces agents need are unwired.**

## What exists today

Two on-chain surfaces plus an off-chain taxonomy:

- **Rater profiles** — `ProfileRegistry.setProfile(name, selfReport)` stores a JSON blob (max
  1,600 bytes) edited on the `/governance` Profile tab. Schema v2
  (`packages/node-utils/src/profileSelfReport.ts`): `ageGroup` (6 brackets), `residenceCountry`
  (ISO-2), `nationalities` (≤3), `languages` (≤5 of 16), `roles` (≤4 of 13), `expertise` (≤5 of
  12), plus nested AI/team/hybrid blocks (model provider, framework, autonomy, team size…).
  `RaterRegistry` separately stores the rater-type enum + a `keccak256` hash of the blob, with
  World ID credential compatibility checks on rater type.
- **Ask-side `targetAudience`** — optional `{countries, languages, roles, expertise}` in the
  agent/x402 ask payload, explicitly "advisory only" in the schema. It is hashed into
  `questionMetadataHash` and then **never used again**: not enforced on-chain, not decoded in
  Ponder, no submit-UI field, no enum validation (tests pass `"developer"`, which isn't in the
  taxonomy).
- **Post-hoc cohort reporting** — at settlement, Ponder joins revealed voters against their
  profiles and aggregates into `audienceContext` (per-bucket up/down counts + coverage).

**Do agents get this information? Yes, partially.** `rateloop_get_result` returns a trimmed
`cohortSummary` (top-5 buckets for expertise/languages/residenceCountry/roles, coverage share)
plus the full `protocolState.audienceContext`. Gaps: `cohortSummary` drops `ageGroup` and
`nationalities`; nested AI/team/hybrid attributes are never aggregated at all; the quote/ask
tools don't expose the allowed taxonomy, so agents can't discover valid `targetAudience` values;
the public result page renders none of it (agents-only today); and there's no "how well did the
revealed cohort match the requested audience" field.

**What gates payouts:** only the World ID credential bitmask. Profile attributes gate nothing —
not voting, not settlement weight, not bounty eligibility. The `PROFILE_SELF_REPORT_NOTICE`
("Governance may penalize clearly false context…") promises a penalty path that is not
implemented anywhere.

Full file-level map with all gaps: see the audit's file index (`ProfileRegistry.sol`,
`profileSelfReport.ts`, `cohortSummary.ts`, `content-routes.ts`, `schemas.ts:87-96`,
`QuestionRewardPoolEscrowEligibilityLib.sol`).

## Is self-reported enough?

The research answer is nuanced and actually favorable to RateLoop's starting position:

- **Base-rate honesty is high; conditional-on-qualifying honesty is terrible.** When
  qualification criteria are visible and qualifying pays, 24–83% of respondents claiming a
  screened attribute are probable impostors (Wessling/Huber/Netzer 2017; Chandler & Paolacci
  2017), and impostors concentrate in *rare/high-value* claims — among raters failing
  CloudResearch's Sentry screen, 51% claimed to be petroleum engineers when offered the option.
  With **hidden screeners** (attributes collected before and independent of any paid task),
  misreporting drops to near zero. The lie is caused by the visible payoff, not by self-report
  per se.
- **RateLoop's current design accidentally avoids the worst incentive** — because
  `targetAudience` doesn't gate payouts, there's no reason to lie yet. But that also means
  targeting is worth nothing to buyers. The moment attributes gate money, the 24–83% problem
  arrives, so gating and validation must ship together.
- **World ID is a structurally stronger foundation than Web2 panels.** Professional respondents
  defeat Prolific/Dynata by running many accounts; a World ID rater has exactly one identity
  that cannot be burned and recreated after a contradiction is caught. A consistency ledger
  compounds here in a way it never can for incumbents.
- **Self-report is also objectively bad at some attributes even when honest:** self-rated
  language proficiency doesn't correlate with measured proficiency (LexTALE literature) — for
  language/expertise, *tests* beat claims regardless of honesty.
- **Buyers don't price unverified niche targeting at a discount — beyond a doubt threshold they
  don't buy it at all** (B2B sample buyers discard 30%+ of cases; one impostor poisons a
  15-person B2B read). Conversely, credible targeting carries the margin: B2B/expert respondents
  clear 2–5× consumer rates (Wynter charges ~$60/verified respondent vs. low single digits
  general-pop). A $5 20-rater question plausibly clears $15–25 with credible language/geo/role
  targeting.

**Conclusion:** self-report is the right *substrate* but is only sellable when (a) decoupled
from visible qualification, (b) consistency-checked against an identity that can't escape its
history, and (c) upgradeable to tested/attested tiers for the attributes that carry pricing
power. That is the plan below.

## Design principles

1. **Validation effort scales with attribute value.** Don't verify everything; verify what
   commands premiums (expertise, role, language) and what's cheap to check (consistency).
2. **Hidden-screener principle everywhere.** Attributes must be claimed *before* the tasks that
   reward them are visible. Never show raters why a question pays them more.
3. **Trust tiers, not a verified/unverified binary.** Sell the gradient:
   `self-reported → consistency-screened → proxy-certified (tests/zkTLS) → document-verified`.
4. **Keep settlement scoring attribute-blind.** Unverified attributes must never affect RBTS
   scoring or settlement weight (collusion/gaming surface). The clean integration points are the
   ones that already exist for World ID: bounty eligibility and payout-oracle claim weights.
5. **No raw demographics on-chain.** EDPB Guidelines 02/2025: wallet-linked attributes (and even
   their hashes) are personal data; the compliant pattern is policy-match booleans/buckets,
   ZK predicates, and revocable attestations. Today's plaintext `selfReport` is rater-chosen and
   public by design, but verified attributes must land as coarse, revocable booleans (EAS), not
   `nationality: "DE"` strings (the Coinbase Verifications anti-pattern).

## Phased plan

### Phase 0 — Wire up what exists (days; no new trust assumptions)

1. **Validate `targetAudience` against the taxonomy** at quote/ask time (reject `"developer"`,
   suggest `engineer`); reuse `profileSelfReport.ts` enums as the single source of truth.
2. **Expose the taxonomy to agents** — add the attribute vocabularies to
   `rateloop_list_result_templates` or a dedicated `rateloop_list_audience_options` tool so
   agents can construct valid targeting without guessing.
3. **Decode and index `targetAudience` in Ponder** (it's currently only a hash on-chain — pass
   it through the existing metadata path) so questions are queryable by requested audience.
4. **Add audience-match reporting to results:** a `targetAudienceMatch` block in the result
   package — requested audience vs. revealed-cohort composition, per-dimension match share, and
   a clear `unverified_self_report` caveat. This is the single highest-value agent-facing gap:
   today an agent that requested `languages: ["de"]` can't tell whether anyone German-speaking
   actually showed up without manually diffing `audienceContext`.
5. **Close the aggregation gaps:** include `ageGroup`/`nationalities` in `cohortSummary`;
   aggregate nested AI/team/hybrid attributes (they're collected but never counted); render
   audience context on the public result page (it's currently agents-only, which undercuts the
   auditability story).
6. **Ask-side UI:** a `targetAudience` picker in the submit flow (currently agent-payload-only).
7. Housekeeping: stable-sort `selfReport` JSON before hashing (matches `questionMetadata`
   convention); document the `templateInputs.audience` (free-text rubric) vs. `targetAudience`
   (structured) distinction in agent docs.

### Phase 1 — Make self-report credible (weeks; no credentials needed)

1. **Profile-change cooldown for target-eligibility.** New or changed attributes only count for
   audience-targeted payouts after N days (e.g. 7). This kills the see-task → edit-profile →
   qualify loop — the single most validated intervention in the literature — and is cheap:
   compare `profile.updatedAt` against round open in the payout-eligibility/claim-weight path.
2. **Don't surface targeting to raters.** Targeted questions appear in the normal feed; raters
   should not see which attributes a question pays for. (Discovery notifications in Phase 2 can
   say "questions for you" without saying why.)
3. **Incidence-rate monitoring + honeypots.** Continuously compare claimed attribute
   distributions against expected base rates (a pool where 30% claim `legal-policy` is
   self-evidently polluted); occasionally include nonexistent attribute options or fake-product
   probes. Publish the resulting **pool-level honesty metrics** — a quantified fraud rate is a
   sales asset no incumbent publishes.
4. **Consistency probes + ledger.** In a small share of rounds, re-ask a profile attribute
   blind inside the task flow; track contradictions per World ID identity. Penalty:
   targeting-eligibility suspension (off-chain artifact first, challengeable like payout roots —
   consistent with the existing optimistic-audit trust model). This also finally implements the
   penalty the `PROFILE_SELF_REPORT_NOTICE` already promises.
5. **Surface trust tier in results:** `cohortSummary` buckets annotated with the share of
   cohort members that are consistency-screened vs. merely self-reported.

### Phase 2 — Targeted payouts and supply matching (weeks–months)

1. **Audience-scoped bounty weighting.** Extend the payout side so `targetAudience` can carry
   money: either (a) a bounty-eligibility extension (profile-match required for payout, like the
   World ID bitmask — but only for cooldown-aged, screened profiles), or (b) softer: matched
   raters earn boosted claim weights via the correlation/payout-root artifacts (the rails for
   per-rater claim weights already exist — surprise weights ride them today). Start with (b):
   it degrades gracefully when targeted supply is thin and doesn't strand bounties.
2. **Supply-side matching:** "questions matching your profile" notifications/feed (the
   notification system exists; it currently only covers round lifecycle). Without this,
   targeted asks just silently under-recruit.
3. **Audience-aware ask guidance:** extend `liveAskGuidance` / `bounty.low_response` callbacks
   with audience-specific turnout (e.g. `audience.low_match`), and quote-time supply estimates
   ("~40 consistency-screened profiles currently match `de` + `engineer`").
4. **Fallback semantics:** asker-chosen behavior when the audience doesn't show — widen to open
   pool (and report it in `targetAudienceMatch`) or extend the window. Never silently settle a
   targeted ask as if matched.

### Phase 3 — Verified attribute tier (months; unlocks 2–5× pricing)

All rails funnel into one substrate, then add rails by value:

1. **EAS on World Chain as the attestation layer** (effort S — it's an OP Stack predeploy at
   `0x4200…0021`). Define revocable schemas: `ageOver18`, `nationalityBucket` (coarse regions),
   `languageCertified(lang, tier)`, `expertiseProxyVerified(tag)`, attested by a RateLoop
   verifier key after checking a proof. Ponder indexes attestations; cohort summaries and
   targeting gates read tiers from there. Do this first regardless of which rails follow.
2. **World ID Identity Check (apply for preview access now).** World ID 4.0's document-backed
   policy attestations — `nationality`, `minimum_age`, `issuing_country`, `document_type` — via
   the app raters already have, ZK selective-disclosure shaped (policy-match booleans, GDPR
   clean). Verified off-chain (`/api/v4/verify/{rp_id}`) → RateLoop attestor writes EAS.
3. **Language certification as paid one-time tasks.** LexTALE-family lexical-decision tests
   (5 min, free, validated cut-offs in ~20 languages) objectively beat self-rating. Ship as a
   "certify your language" task paying the normal flow; rotate items, time-box to resist LLM
   assistance. There is **no credential rail for language** — testing is the only option, and
   it's cheap.
4. **Expertise via short domain quizzes + zkTLS proxies.** Domain-knowledge quizzes are the
   best-measured fraud detector in the literature (>0.9 precision *and* recall from three
   domain-specific questions — WWW'22); rotate/procedurally generate items. Complement with
   Reclaim-style zkTLS proofs (GitHub contribution depth, LinkedIn WORKPLACE verification badge)
   verified backend-side → EAS, labeled "proxy-verified" (account-rental gameability is real;
   require the World ID session + wallet binding, prefer hard-to-transfer signals).
5. **zkPassport as the parallel/fallback document rail** — World Chain (480) is already in its
   SDK with a deterministic on-chain verifier, proofs bind to the rater wallet in-contract;
   covers raters who won't use World App's document flow and is the on-chain-verifiable option
   if we ever want attribute gates enforced contract-side. Watch Self Protocol (EU eIDs +
   Aadhaar coverage) if Identity Check's country rollout lags.
6. **Product packaging:** two purchasable tiers mirroring Respondent's proven split — 
   *screened* (self-reported + cooldown + consistency ledger, consumer pricing) and *verified*
   (tested language/expertise, attested age/region/role, 2–5× pricing). Expose tier composition
   per bucket in `cohortSummary` and let `targetAudience` require a minimum tier.

### Phase 4 — Mechanism-native validation (research-y, differentiating)

- **BTS-scored attribute probes.** Peer prediction was invented for unverifiable self-reports
  (Prelec 2004; validated against over-claiming in Weaver & Prelec). Periodically run
  attribute-correlated probe questions scored with the existing RBTS machinery and pay small
  bonuses; tell raters their honesty is algorithmically scored (the announcement effect is a
  large share of the measured benefit). Diagnostically: a claimed cohort whose probe-answer
  distribution diverges from the known distribution for that true cohort is polluted.
- **Cohort-divergence checks in the correlation pipeline.** The payout-root artifacts already
  recompute per-epoch facts deterministically; pool-level incidence and contradiction metrics
  can ship inside the same challengeable-artifact pattern.

## What to skip

- Device fingerprinting / IP forensics as a primary defense — decaying vs. AI, redundant with
  World ID sybil resistance; keep IP/timezone only as soft consistency signals.
- ID-document collection Web2-style (Prolific/Onfido) — kills pseudonymity; Identity
  Check/zkPassport achieve the same assurance ZK-shaped.
- Plaintext attribute attestations on-chain (Coinbase Verifications pattern) — GDPR
  anti-pattern per EDPB 02/2025.
- Phone-number country attestations — weak, farmed, no serious rail.
- Governance-tunable taxonomy on-chain — keep enums versioned in `node-utils`; revisit only if
  taxonomy churn becomes real.

## Decisions needed

1. **Gate vs. weight (Phase 2):** hard audience eligibility for bounties, or boosted claim
   weights through the payout oracle? Recommendation: weights first — graceful under thin
   supply, reuses live rails, no stranded bounties.
2. **Cooldown length** for profile-change target-eligibility (7 days suggested; balances
   farming friction vs. honest-profile onboarding).
3. **Where the consistency ledger lives:** off-chain challengeable artifact (recommended,
   matches the oracle trust model) vs. on-chain registry.
4. **Identity Check preview access:** apply to TFH now — it's the gating dependency for the
   highest-leverage verified rail.
5. **Pricing the verified tier:** premium flows to verified raters' bounty weights, or to a
   higher protocol/frontend fee, or both.

## Sources

Selected; full URL lists live with each research pass.

**Misreporting & validation research:** Chandler & Paolacci 2017 ("Lie for a Dime"), Wessling
Huber & Netzer 2017 (JCR, 24–83% impostors), Mullinix et al. hidden screeners,
cloudresearch.com (Sentry, petroleum-engineer honeypot), "Beyond Bot Detection" WWW'22
(domain-knowledge tests), lextale.com (language testing vs. self-report), Prelec 2004 BTS
(Science), Frank et al. 2017 (PLOS One), quirks.com / globaldataquality.org (fraud rates,
buyer discards)

**Incumbent practice & pricing:** researcher-help.prolific.com (screener validation,
re-verification), dynata.com (QualityScore), cint.com ("verify the respondent"),
wynter.com/policies/participant-verification-process, respondent.io (verified-professional
tier), greatquestion.co / userinterviews.com (2–5× B2B incentive multipliers)

**Credential rails:** docs.world.org/world-id/credentials + idkit-v4-preview (Identity Check),
docs.zkpassport.id (World Chain 480 SDK support, on-chain verifier), docs.optimism.io (EAS
predeploys), docs.reclaimprotocol.org (zkTLS), docs.self.xyz, learn.microsoft.com (LinkedIn
verificationReport API)

**Privacy:** edpb.europa.eu Guidelines 02/2025 (blockchain + personal data), EU age-verification
blueprint / eIDAS 2.0 EUDI wallet timeline

# RateLoop tokenless — implementation plan

Rewritten and independently rechecked 31 July 2026 from six research passes into the
question that matters: **what should this be, so that an enterprise wants it and can be
made to need it?**

**Written for a German vendor.** The first regulated market hypothesis is DSA automated-
moderation reporting. Article 15 reporting applies to non-exempt intermediary providers;
Article 20 complaint supervision applies to non-exempt online platforms; Article 37
independent audit applies only to designated VLOPs and VLOSEs. The combined moderation-
and-complaint product below primarily targets VLOPs with third-party content. An earlier
draft picked a US vertical that a German company could not credibly sell into.

This document is the product and engineering backlog, not release approval. The
[immutable implementation plan](./tokenless-immutable-implementation-plan-2026-07.md)
controls architecture, and the production-readiness register controls deployment.

The decisions after this second pass are explicit:

1. Build the measurement and DSA evidence workflow before expanding reviewer supply.
2. Run representative pilots through the private, customer-authorized lane with a small
   RateLoop-recruited named panel.
3. Retain the closed RateLoop-network lane, but test it only on a separately reported
   public-safe benchmark and keep it default-off.
4. Do not build an open task marketplace or activate hybrid review.

Effort is days for one experienced engineer.

---

## 1. What the product is

**A calibrated, reproducible quality number that an adverse third party will accept from
someone who is not the AI vendor.**

Every word of that is load-bearing.

- **Adverse third party** — an underwriter with capital at risk, an accreditor, a
  regulator on examination, a counterparty entitled to demand evidence. Not the
  engineering team improving the product. The reader must have a reason to doubt the
  producer, or none of the rigour is worth paying for.
- **Reproducible** — the reader can recompute the number and get the same answer. This
  matters more than the signature; see §2.
- **Not the AI vendor** — the UK government's own economists found the binding constraint
  in AI assurance is that **225 of 310 supplier firms are AI developers assuring their
  own tools**, and their demand-side research recorded participants saying that assurance
  delivered by a profit-motivated developer "would not be trustworthy."

Not a review workflow that emits evidence. A measurement instrument whose output is that
number — and whose review workflow is merely how the measurement gets taken.

**The buy trigger is not scale. It is the need for an artifact someone external will
accept.** The field's most influential practitioners tell teams to build their own
annotation tooling, and they are right — about _criteria_, which are domain-specific.
None of them argues that sampling design, agreement measurement or regression tracking
are domain-specific. The stated exceptions are precise and they are all the same
exception: distributed annotators with enterprise access controls, regulated or
high-risk operations, and external auditing valued for its own sake.

---

## 2. The moat is the sampling frame

`adaptiveCoverageExport.ts` emits a per-decision record for **every eligible output,
including the ones nobody reviewed**, carrying the selection probability, the sample
bucket, the sampler commitment, the key version and the reason codes — written inside
the same transaction as the decision, **before the outcome was known**.

Nothing else in the category has this — and note what makes it valuable. **Determinism,
not signing.** An adverse reader can recompute a deterministic draw and get the same
answer, which is a stronger claim than "this file has not been altered."

**Be ruthless about the signature, because it is the weakest leg.** No regulator requires
a cryptographic signature on AI evidence. None has said it would accept one. The vendors
already selling signed AI audit logs cannot cite a requirement — they cite regulations
that demand records permitting reconstruction and then supply their own schema. And when
the SEC chose a replacement for physically immutable storage, it picked **a named senior
executive's personal undertaking to produce records**. In assurance markets trust is
manufactured by attaching a name and a liability to a claim, which is why an audit
opinion is a PDF nobody verifies.

So: the measurement is the product, the signature is a feature of it, and the
differentiator is that the computation can be re-run by someone who does not trust you.

The first invariant was repaired on 31 July 2026. Adaptive and fixed review now share one
sampler implementation and persist canonical `sha256:` commitments; migration `0165`
backfills exact legacy bare digests and rejects future non-canonical writes. Golden
vectors pin both domain-separated manifests, and a real decision → persistence → export
test covers manual, always, rules, fixed and adaptive policies.

It remains:

- **Capability-flagged false**, so it cannot be mentioned publicly.
- **Never used to weight anything.** Every published rate is an unweighted count.
- **Not third-party verifiable**, because the sampler key is a permanent environment
  secret.

### What is genuinely hard, and what only looks hard

The pitch must rest on the first list.

**Hard, and done:** the twelve-dimension scope partition and its migration lineage on
live data; transactional correctness around the decision, with row locks, statement
timeouts, idempotent replay and an append-only policy log wrapped around the sampling
draw; the execution manifest with canonical commitments and a validated span DAG; an OTLP
receiver with a hand-written protobuf decoder where prompt payloads are _structurally
unrepresentable_; a Rekor inclusion-proof verifier with correct domain separation; a
hash-chained audit log that refuses to export on mismatch; and the anti-overclaiming
machinery — a regex gate over marketing copy, unearned tiers made unrepresentable in the
type system, and a CI test forbidding inference by package prefix across thirteen source
roots.

**Only looks hard:** the sampler itself is twenty lines of feature-flag bucketing. The
stage ladder is four states and three thresholds. **The Merkle trees are decorative** —
the full leaf list ships inside the packet and there are no inclusion proofs, so a signed
digest of the leaf array would be equivalent. The GRC connectors are about a hundred
lines of REST. "Nine hosts" is nine documentation entries whose tier gates nothing but a
badge colour. The framework adapters are 176 lines across two frameworks, neither of
which imports its framework.

---

## 3. The evidence standard, which is the product specification

Five converging sources define what "real" human review means, far more specifically than
any statute:

1. **Named, competent, authorised reviewers.** The Amsterdam Court of Appeal found
   against Uber partly because it could not establish the reviewers' qualifications.
2. **Demonstrated non-trivial engagement.** Cigna's medical directors averaged **1.2
   seconds per claim** across 300,000+ denials in two months. That is the anti-pattern,
   and it is measurable.
3. **Evidenced override capability and actual overrides.** Under the SCHUFA line, a
   reviewer who never disagrees is itself evidence of rubber-stamping; formal decision
   authority does not cure determinative influence.
4. **A reconstructable per-decision record.** Hamburg fined a firm €492,000 for being
   unable to explain a decision when asked — not for the decision.
5. **A working contest route.** Foodinho's specific failure, twice, at €2.6M then €5M.

**The founding case is Uber.** It _had_ human review. It lost because the court asked what
the human actually did and Uber could not show it. The question was never "was there a
human?" but **"prove what the human did."**

Three of those five map onto things this codebase already computes and does not surface:
decision-time percentiles exist, override decisions are recorded and never aggregated, and
the attestation model already stores competence basis, training records and authority
scope with expiry.

**Sell the evidentiary claim. Do not sell prevention.** No public evidence exists, in
either direction, that sampled review prevents AI failures. Abundant evidence exists that
inability to demonstrate review is independently punished.

---

## 4. First reachable market — DSA content-moderation assurance

**Start with two evidence artifacts and never merge them.** The primary artifact is a
reference-standard performance packet for automated removal. The adjacent artifact is
control evidence showing that sampled complaint decisions received qualified human
supervision and were not made solely by automation. It is evidence for the Article 20(6)
control, not a claim of full Article 20 compliance. Operational complaint reversals,
panel reference labels and panel disagreement are different measures.

This is the strongest European fit because the obligation, artifact and adverse reader
already exist:

- The [Digital Services Act](https://eur-lex.europa.eu/eli/reg/2022/2065/oj/eng) is in
  force. Article 20 requires complaint decisions to be supervised by appropriately
  qualified staff and not made solely by automation. Articles 15 and 42 require public
  reporting of automated-moderation accuracy and possible error rates; VLOPs report the
  measures by official EU language.
- The harmonised rules have applied since 1 July 2025 and the
  [first reports were published in February 2026](https://digital-strategy.ec.europa.eu/en/news/harmonised-transparency-reports-under-dsa-bring-enhanced-clarity-content-moderation-practices).
  The [mandatory template](https://eur-lex.europa.eu/eli/reg_impl/2024/2835/oj/eng)
  requires accuracy, precision and recall for each automated-removal system, together
  with input criteria and calculation method. Control-group variation is requested where
  possible; human-reviewer accuracy is optional.
- Article 17/24 statement-of-reasons submissions now use categories aligned with the
  harmonised reports, but not every private moderation decision requires a statement. The
  [Transparency Database](https://transparency.dsa.ec.europa.eu/page/api-documentation)
  can supply receipts and a secondary reconciliation source for the applicable subset,
  but it excludes personal data and does not contain the reviewed content. It cannot
  replace the provider's complete private source population.
- VLOPs and VLOSEs undergo annual independent audits. The
  [DSA audit rules](https://eur-lex.europa.eu/eli/reg_del/2024/436/oj/eng) require
  sufficient reliable evidence and assessment that public disclosures are free from
  material error. When an auditing organisation uses a sample, it must choose a
  representative method without provider interference and justify that method.
- German enforcement is concrete. The
  [Bundesnetzagentur's 2025 report](https://www.bundesnetzagentur.de/DE/Fachthemen/DSC/3_Aktuell/Downloads/Taetigkeitsberichte/DSC_Bericht2025_EN.pdf?__blob=publicationFile&v=3)
  records 2,033 Article 53 complaints and names Articles 16, 17 and 20 among its focus
  areas. It is not automatically the adverse regulator for every engagement; the DSC of
  establishment and Commission often are.
- The evidence failure is observable rather than hypothetical. Booking.com's
  [published DSA audit](https://q-xx.bstatic.com/data/mobile/2025%20-%20Audit%20report.pdf)
  sampled appeals and training records, but unreconciled datasets blocked reasonable
  assurance for several obligations and the auditor found material discrepancies in
  reported automated accuracy.

### The product boundary

The panel supplies an **adjudicated reference label**, not legal or objective ground
truth. It is not the Article 20 decision-maker, and its existence does not prove that the
platform's human supervision occurred. “Independent panel” may describe reviewer
separation only; it does not mean Article 37 auditor independence.

A provider-side RateLoop reference sample is supporting control evidence, not the
statutory audit sample. The auditor must remain free to define or draw its own sample and
independently reperform the metrics. RateLoop may participate in the audit only when the
auditing organisation controls the method and contracts RateLoop or its reviewers under
the audit rules' independence, expertise, ethics and confidentiality requirements.

The current operator-held sampler key supports reproducibility, not a no-interference
claim. The closed-frame, future-beacon draw in §6 can prove that records were not selected
after their outcomes were known. It still cannot prove that the provider supplied a
complete, correctly timestamped or correctly classified population; §7 therefore makes
source reconciliation a separate fail-closed gate.

### Buyer and first pilot

For a VLOP, the account owner is the head of the Article 41 compliance function, which
organises and supervises the independent audit. The operational champion is a moderation-
quality, Trust & Safety or data-controls lead. The first adverse reader is the statutory
auditing organisation; the Commission, relevant DSC and public receive the resulting
reports or disclosures.

Run the representative pilot with a small RateLoop-recruited, customer-authorized, named
and language-qualified private panel. The initial scope is one automated-removal system,
one policy category and one language. Use the RateLoop-network lane only for a separately
reported stratum established as public, synthetic or safely redacted **before** sample
selection. Post-selection redaction or lane switching changes the estimand and is
forbidden.

The product is not validated until one audit-organisation design partner accepts the
method and packet as usable evidence, two provider pilots reproduce the calculation, and
at least one provider requests a paid repeat engagement. Failure to obtain the complete
frame or lawful access to the selected cases stops the pilot rather than narrowing the
denominator silently.

### Pilot data contract

The first implementation freezes these records rather than accepting a generic CSV:

| Record               | Minimum frozen fields                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Population           | service and reporting period; provider decision ID; statement-of-reasons applicability and coded basis; nullable statement receipt; event time; language; content format; harmonised category; trigger source; policy and automated-system version; original automated label/restriction; eligibility and exclusion reason; access-controlled content hash and locator |
| Complaint control    | Article 20 decision type; submission, decision and notification times; grounds and outcome; reasoned result; supervisor pseudonym; qualification, training, authority and language evidence                                                                                                                                                                            |
| Reference assignment | source decision ID; reviewer and conflict/qualification snapshot; frozen audience source and material boundary; blinding state; payload and label-schema hashes; label, uncertainty/abstention, rationale and timestamps                                                                                                                                               |
| Draw                 | immutable population digest and count; strata; inclusion probability for every unit; commitment; future beacon network/round and reveal; selected flag; no replacement unless the precommitted method permits it                                                                                                                                                       |

Statement applicability is one of `required`, `no_recipient_electronic_contact`,
`deceptive_high_volume_commercial_content`, `article_9_order`,
`service_not_online_platform`, `restriction_outside_article_17` or
`other_documented_exclusion`. The basis is frozen before reconciliation, and a nullable
receipt is valid only with a coded non-required basis.

The output packet contains:

1. source totals; Article 17/24 applicable totals; coded non-applicable/excluded totals;
   statement submission totals; and every missing, duplicate, failed or unmatched record;
2. the population definition, frame digest, sampling algorithm, probabilities, seed and
   selected/non-selected manifest;
3. per-system and per-language weighted confusion matrices, accuracy, precision, recall,
   error and explicit non-estimable cells;
4. the reference-standard definition, reviewer disagreement and uncertainty, kept
   separate from operational complaint reversals;
5. Article 15(1)(e)/42(2)(c) automated-means evidence and template rows, not a complete
   DSA transparency report; and
6. a confidential calculation-input packet and a separate redacted/public disclosure.

### Contracting modes

| Mode                       | Who controls the frame and sample                                                                                   | Permitted claim                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Provider evidence supplier | Provider supplies the population; RateLoop freezes and draws the reference sample                                   | Audit preparation and reproducible reference evidence; never the statutory audit sample           |
| Audit subcontractor        | Auditing organisation controls the method, seed, exclusions and replacements and contracts RateLoop under its audit | Evidence produced under that audit engagement; the auditing organisation alone issues the opinion |

RateLoop must freeze one mode per engagement. Article 37's twelve-month non-audit-services
restriction makes casually switching roles unsafe.

The Transparency Database adapter is separately versioned from the harmonised-report
taxonomy. It stores an opaque deterministic PUID, exact payload/schema, request hash,
attempt and HTTP result, Commission UUID/ID/timestamps/links, validation errors and a
private decision crosswalk. Only `201 Created` is a creation receipt; retry after an
unknown outcome first checks that PUID. Direct production submission remains gated on DSC
onboarding and sandbox conformance. No outbound field may contain personal data.

### Adjacent obligations, not the launch wedge

- The [Platform Work Directive](https://eur-lex.europa.eu/eli/dir/2024/2831/oj/eng)
  requires qualified human oversight, human account-termination decisions and reasoned
  review after national transposition by 2 December 2026. It is a strong second vertical,
  but implementation is still settling and an outside panel cannot substitute for the
  platform's authorised decision-maker. As of the
  [Bundestag's 24 April 2026 update](https://www.bundestag.de/presse/hib/kurzmeldungen-1167478),
  BMAS was still preparing the German draft. BMAS said on 19 May that implementation
  would occur in 2026, and a
  [7 July Bundesrat motion](https://dserver.bundestag.de/brd/2026/0399-26.pdf) still asked
  the government to present a draft promptly. The directive can cover a service that
  organises platform work even when the supply pool is curated, so “closed network” is a
  product boundary, not a labour-law exemption.
- GDPR automated-decision contests are broad and already live, but lack the DSA's
  recurring public metric and statutory audit artifact.
- AI Act Annex III is a horizon, not a launch wedge. Its high-risk duties now start on
  2 December 2027 under
  [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng), and
  most Annex III providers use internal-control conformity assessment rather than a
  mandatory outside audit.
- Reviewer scorecards and engagement analytics may trigger German works-council
  co-determination under [§87(1)(6) BetrVG](https://www.gesetze-im-internet.de/betrvg/__87.html).
  That is a deployment constraint and product control, not a buyer mandate.

---

## 5. The next shippable slice

| #    | Task                                                              | Days | Status |
| ---- | ----------------------------------------------------------------- | ---- | ------ |
| 1.1  | Canonical commitment writes, legacy backfill and DB constraint    | 0.5  | Done   |
| 1.2  | Real decision → persistence → export test across all policy modes | 0.5  | Done   |
| 1.3  | Golden vectors for both domain-separated sampler manifests        | 0.5  | Done   |
| 1.4a | Freeze estimands, support and gap rules                           | 1    | Done   |
| 1.4b | Design-weighted estimator and typed export                        | 2–3  | Done   |
| 1.4c | Enumeration/simulation report and external method review          | 2    | Open   |
| 1.5  | Decision-grade comparison in the existing Evaluations destination | 2    | Open   |
| 1.6  | Sampling disclosure, locale scan and claim-gate rule              | 1    | Open   |

**1.3 matters more than its size.** Before it landed, the test asserted only
self-consistency, so reordering the manifest string could silently re-roll every bucket
with a green suite. The fixed and adaptive vectors now freeze both commitment and bucket.

**1.5 — the single view that sells this.** Extend the existing authenticated
`/agents/evaluations` destination instead of adding another navigation item. Show two
numbers side by side:

> Sampled agreement: 96.2% (n=740)
>
> **Population estimate: 88.1% (95% CI 84.3–91.4%)**
>
> _The sampled figure is biased upward because coverage was reduced on scopes that were
> already agreeing._

A vendor telling a risk officer their own headline number is wrong, and then showing the
correct one, is the most persuasive thing available here. The view also shows frame size,
selected and completed counts, certainty-unit share, effective support and the exact gap
reason. It never shows a confidence interval when the design cannot justify one.

**1.4 starts by naming the estimand and probability.** The live operational field is the
history-conditioned selection propensity at each decision, not generally a marginal
first-order inclusion probability. Operational agreement is therefore reported as a
self-normalized sequential inverse-probability-weighted domain ratio. A future closed-
frame reference draw records actual inclusion probabilities. For a binary outcome
defined for every unit in a known complete fixed frame, the population mean is the
Horvitz–Thompson total divided by known `N`; “agreement among comparable observations” is
instead a ratio of weighted agreement and comparable totals. Accuracy is a population
mean; precision and recall are ratios of weighted confusion-matrix cells. The
implementation labels the probability kind and estimand rather than calling every result
“HT.”

Do not hard-code Begg–Greenes, Korn–Graubard or another interval by name before the actual
selection and non-response design is frozen. First-order inclusion probabilities are
enough for point totals but not automatically for variance under history-conditioned
adaptive and maximum-gap selection. The method review must specify the design variance,
dependency assumptions, effective sample size and degrees of freedom, then approve the
public interval method against enumeration or simulation. Rogan–Gladen is the wrong
estimand here because it corrects apparent prevalence for an imperfect test; its previous
rejection rationale in this document was incorrect.

Certainty units with inclusion probability `1` remain valid probability-sample units and
produce no sampling uncertainty for themselves. Report their share because they can
dominate the observed sample, not because they invalidate the design. Full-population
inference fails when an in-scope unit has probability `0` or unknown, the population is
incomplete, the source can alter selection after outcomes are known, or a selected unit
lacks the predeclared reference outcome. Return a typed coverage gap in each case.

**1.4 acceptance suite:**

- hand-calculated unequal-probability totals and domain ratios, including a fixture where
  `HT/N` and the comparable-only ratio intentionally differ;
- a census with probability `1` returning the exact finite-population result and zero
  sampling uncertainty;
- probability `0`, unknown probability, missing frame members, missing selected outcomes,
  zero denominators and non-finite weights returning named gaps;
- exact decision-to-observation binding and explicit exclusion of the later §6 reference-
  sample channel from operational adaptive rollups;
- deterministic reproduction, ordering invariance and no `NaN`/infinite output; and
- a checked-in enumeration/simulation report covering rare outcomes, unequal rates,
  certainty shares, adaptive transitions and multiple scopes, with public confidence
  intervals disabled until the external method review accepts the result.

---

## 6. The six-month version: a closed-frame, externally seeded draw

Operational sampling and reporting evidence are separate channels.

- **Operational adaptive/fixed sampling** decides before each output's outcome and uses
  the current committed HMAC scheme. It is reproducible after key disclosure but not
  independent while the operator holds the secret.
- **DSA reference sampling** is retrospective. Close and reconcile the reporting frame,
  commit its root, count, strata, algorithm and a later drand round, then use that future
  verified beacon to derive the sample. The provider cannot replace a selected private
  case with a public one or feed the resulting labels into adaptive promotion.

The externally generated seed proves that, **given the committed eligible population and
stated algorithm**, records were not selected after their outcomes were known. It does
not prove that the source population was complete, correctly classified or honestly
timestamped. That stronger statement requires the reconciliation evidence in §4 and an
auditor free to reject or redraw the sample.

The concrete draw protocol is:

1. close the reporting slice and reject it unless source counts and identifiers
   reconcile, every Article 17/24-applicable decision has a statement receipt, and every
   difference has a frozen coded basis;
2. commit the canonical frame root, exact eligible count, partition counts, method
   version and future beacon network/round through the existing attestation pipeline;
3. after that round exists, fetch and verify the beacon with one shared implementation;
4. derive the domain-separated seed and calculate the selection decision and inclusion
   probability for every frame unit; and
5. freeze the complete selected/non-selected manifest before assignment.

| #    | Task                                                            | Days         | Repository status                                                          |
| ---- | --------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| 2.1  | Closed-frame sampling epochs and witnessed commitments          | 8–10         | Persistence foundation implemented; hosted exercise remains a release gate |
| 2.2  | Future-beacon verification and domain-separated seed derivation | 3–4          | Shared verified core implemented; hosted exercise remains a release gate   |
| 2.3  | Reviewer/scope override detector with employment-data gate      | 2–3          | Implemented                                                                |
| 2.4  | Auditable engagement events with aggregate-only mode            | 3–4          | Implemented                                                                |
| 2.5  | Separate reference-sampling channel for automated pass and fail | 7–8          | Sampling foundation implemented; assignment/label consumer remains open    |
| 2.8  | Typed packet schema on DSSE + RFC 8785 canonicalisation         | 5            | Implemented for new evidence packets with immutable legacy verification    |
| 2.6  | Bind audit/coverage heads to the existing attestation pipeline  | 2            | Implemented                                                                |
| 2.7  | Least-privileged compliance evidence share and bounded view     | 5            | Existing share foundation; bounded project/window consumer remains open    |
| 2.9  | Contractual public-safe benchmark research grant                | 3–5          | Pure commit-gated contract implemented; persistence and route remain open  |
| 2.10 | Statutory Article 40 vetted-researcher access                   | External + 5 | Not implemented; requires DSC-vetted request workflow                      |

**2.3 and 2.4 are the Uber and Cigna findings turned into features, but the foundation is
not release approval.** Scope/reviewer override patterns have a minimum denominator and
are gated by the persisted employment-data governance record. Append-only engagement
events distinguish first artifact access, idle, reopen and submission. Aggregate-only
mode persists no per-reviewer score; the UI consumer must preserve that property and may
show reviewer metrics only when controller/processor roles, lawful basis/necessity, DPIA,
notice, access/retention, data-subject process and works-council status are all resolved.

**2.5 is a separate append-only channel.** It samples automated `pass` and `fail` while
`uncertain` remains always reviewed. Its labels never enter operational adaptive rollups.
Disagreement may reset a scope to full coverage, but agreement from this channel never
promotes it.

**2.8 changes digests and therefore precedes 2.6, 2.7 and every pilot artifact.** The
repository already implements DSSE pre-authentication encoding correctly. Replace the
divergent hand-rolled canonical JSON implementations with one RFC 8785 producer/verifier
implementation, bump the packet version and retain verification of immutable legacy
packets.

---

## 7. What to retain and gate

**Do not delete the reviewer network under the current design of record.** The newer
deletion proposal was an unrecorded product pivot: the governing tokenless design retains
the immutable fund core, paid eligibility, reviewer access, audience policies, vouchers,
keeper, indexer and paid assignment-to-settlement release work. The stack also supports
paid customer-invited review, so it is not a detachable public-marketplace page.

The current implementation is also **not an open marketplace**: network tasks are visible
only to an exact selected, principal-bound seat. Keep that closed network default-off and
outside the initial release. Do not add public task browsing, rankings, streaks, dynamic
bonuses or self-selection.

The benchmark test is an experiment, not a launch. Freeze the qualified reviewer frame,
availability window, invitation probabilities, assignment rule and non-response handling
before outcomes. Randomize principal-bound invitations or assignments within declared
qualification strata; do not let workers browse or choose cases. Report invited,
accepted, assigned, opened, completed and timed-out counts, and keep panel-vs-network
comparisons descriptive unless the precommitted design supports a population claim.
[Adaptive allocation can make completed tasks unrepresentative](https://www.nature.com/articles/s41598-022-10794-9),
and [reputation filters can improve observed quality](https://pubmed.ncbi.nlm.nih.gov/24356996/)
while changing the represented worker population; neither effect may be hidden behind
one headline accuracy number.

The four lanes have different decisions:

| Lane                     | Decision now                                               | Reason                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private customer-invited | Keep and use for the representative DSA pilot              | It supports encrypted private artifacts, explicit project authorization and short leases. “Customer-invited” is the authorization model; RateLoop may recruit and contract the named reviewers. |
| Named RateLoop panel     | Pilot as a curated roster through the private lane         | Real moderation populations commonly include removed/private content, complaint records and personal or sensitive context.                                                                      |
| Closed RateLoop network  | Preserve and test only on a separate public-safe benchmark | It accepts only public, synthetic or owner-confirmed redacted material. Excluding or redacting private cases after selection changes the estimand.                                              |
| Hybrid                   | Keep reserved and unavailable                              | It lacks precommitted material strata, lane-specific estimation and complete child terminal/refund processing.                                                                                  |

### DSA reference-panel pilot

| #   | Task                                                                           | Days       |
| --- | ------------------------------------------------------------------------------ | ---------- |
| 3.1 | Import the complete population; reconcile applicable Article 17/24 statements  | 7–10       |
| 3.2 | Freeze a separate reference sample from the §6 closed-frame draw               | 3–4        |
| 3.3 | Authorize named private reviewers; freeze language, qualification and conflict | 4–5        |
| 3.4 | Hide provider, machine outcome and appeal result in a DSA single-case view     | 4–5        |
| 3.5 | Export Article 15/42 automated-means rows and raw calculation inputs           | 5–7        |
| 3.6 | One audit-partner method review and two provider pilots                        | External   |
| 3.7 | Separately validate paid network assignment, settlement and recovery           | 5–7 + soak |

The planning target for each first pilot is one system/category/language scope, a
100–200-case sample sized with the audit partner, five named reviewers and three
independent labels per case. Those numbers are a test configuration, not a prescribed
DSA sampling rate. Compensation may be handled by the pilot contract so that evidence
usability is tested before on-chain network settlement becomes a dependency.

Freeze who contracts and pays every pilot reviewer. A RateLoop-recruited named panel is
not exempt from paid eligibility, tax, sanctions, payout, worker-information, appeal or
applicable platform-work duties merely because the customer authorizes access to its
cases. Reassess both paid panel and network gates when Germany publishes its implementing
draft; the absence of a public draft is not permission to assume the final rules.

The reference sample is separate from the operational adaptive-review sample. It never
feeds the adaptive promotion window. In provider-evidence mode RateLoop controls only its
reference draw; in audit-subcontractor mode the auditing organisation controls the
method, seed, exclusions and replacements. Population reconciliation fails closed: a
packet with missing, duplicated or unmatched decisions produces a gap, not an estimate.

Immediate pilot stop conditions are:

- an unreconciled frame or missing/duplicate source decisions;
- a selected case that cannot lawfully be provided to its authorized private panel;
- any post-outcome change to seed, eligibility, exclusions, replacement or audience lane;
- leakage of provider identity, machine outcome or appeal result to the reviewer;
- any material privacy/security incident; or
- a case that requires manual database or chain mutation to reach its promised terminal
  state.

**Evidence-product expansion** requires the external acceptance and paid-repeat signals
in §4. **Closed-network activation** is a separate decision and additionally requires at
least two completed pilots to request supply beyond a named contracted panel. If named
panels satisfy the buyer need, leave the network off.

Any real-money network activation also requires all of the following on one fresh
complete deployment:

- exact activation evidence and a deployment-pinned eligibility → assignment →
  acceptance → commit/reveal → settlement/claim exercise;
- quorum, beacon, takedown, restart, compensation, refund, keeper and indexer recovery
  exercises;
- paid eligibility, DAC7, sanctions, payout, appeal and privacy operations; and
- a recorded choice of provider-side evidence supplier or audit-organisation
  subcontractor for each engagement. The DSA audit-independence and non-audit-services
  restrictions make casually occupying both roles unsafe.

Hybrid remains a reserved unavailable schema value until both child lanes have durable
terminal, expiry, refund, restart and compensation processing. Crowd Forecast,
Surprisingly Popular and Feedback Bonus remain separately gated experiments, not reasons
to activate the network.

If completed pilots produce no demand for network supply, leave it disabled and reopen
the governing design explicitly. Only then decide whether to retain it as a benchmark
lane or follow the ordered cross-package deletion rule. The DSA wedge does not itself
justify public-network activation.

---

## 8. What not to build

**Judge calibration as the headline.** The category is served — Galileo ships a
first-class calibration UI, and the category leader publishes a "best human-in-the-loop
evaluation platforms" listicle. Keep it as a _data source_ inside the measurement
instrument, where the probability frame makes the confusion matrix defensible in a way
theirs cannot be. Do not make it the pitch.

**A flight recorder for agent executions.** Langfuse, Arize, Braintrust, Datadog and Weave
all ingest OTLP GenAI traces. Provable payload exclusion is a differentiator inside a
bigger story, not a wedge.

**An LLM evaluator anywhere in scoring, routing or triage.** The determinism boundary is
airtight and CI-enforced; breaking it would make reviewer management an Annex III(4)(b)
system with RateLoop as provider. One hole to close: the boundary test scans one package's
source directory but not its scripts directory, which is exactly where the repository's
only outbound model call lives.

**Reviewer scorecards without an employment-data governance gate.** Per-reviewer performance
measurement is worker monitoring, and German works-council co-determination under
§87(1)(6) BetrVG means a customer cannot deploy it without an agreement. It must be
aggregate-only by default and blocked until the required governance record is complete,
not merely switchable or disclaimed.

**An MCP "get a human to sign off" tool.** Nearly free given the existing servers, which is
why it is tempting. It is also precisely the product HumanLayer abandoned while OpenAI
shipped native approve-and-resume.

---

## 9. Sequence

| Order | Work                                                               | Days/status                                  |
| ----- | ------------------------------------------------------------------ | -------------------------------------------- |
| 1     | 1.1–1.3 — make the operational frame load and stay fixed           | Done                                         |
| 2     | 1.4a–1.4b — estimand and point estimator                           | Done                                         |
| 3     | 1.4c — variance validation and external method decision            | Release gate                                 |
| 4     | 1.5, 1.6 — decision view, disclosure and fail-closed claims        | 3                                            |
| 5     | 2.3, 2.4 — governance and engagement foundations                   | Done                                         |
| 6     | 2.8, 2.6 — canonical v4 packets and witnessed audit heads          | Done                                         |
| 7     | 3.1, 2.1, 2.2 — population and persisted witnessed draw foundation | Implemented; integration verification active |
| 8     | 2.5, 3.2–3.5 — system evaluations, labels and durable reports      | 16–21                                        |
| 9     | 2.7, 2.9 — persist separate compliance and research grants         | 7                                            |
| 10    | 3.6 — audit-partner review and two provider pilots                 | Release gate                                 |
| 11    | 3.7 — separate paid-network hosted/testnet validation              | Release gate                                 |

Rows two and three ship useful provider-side measurement without claiming independence.
Rows six through nine build the DSA artifact. Row ten decides whether the evidence product
has a market. Row eleven decides separately whether the closed network deserves activation.

### Ordering hazards

- **Reference and operational channels never share rollups.** Implement the exclusion in
  1.4 before 2.5 writes its first label.
- **One migration in flight at a time.** `0170` is the sampling-epoch migration in this
  implementation slice; the next available migration number is `0171`. Do not start it
  until `0170` and its real-Postgres invariant suite are green.
- **The claim-gate walker does not scan message catalogs.** Extend it to English and German
  JSON before adding estimator or DSA copy; editing a component alone can leave localized
  overclaims green.
- **Fix the locale-dependent canonicalisation before publishing any verifier.** Key
  ordering uses locale comparison, so two machines can derive different digests for the
  same packet.
- **Do not precommit the final beacon-derived seed before the beacon exists.** Commit the
  frame, method and future round first; derive and freeze the seed afterward.
- **The current coverage export is bounded at 5,000 rows.** DSA population import and raw
  calculation inputs need paged or object-backed manifests, not a raised in-memory cap.
- **No post-selection redaction, replacement or audience switching.** A case that cannot
  enter its frozen lane becomes an explicit gap unless the precommitted method already
  defines a provider-independent replacement rule.

---

## 10. The objection to answer first

**The most influential practitioner in this field argues against the core design**, and
the product cannot pretend otherwise. Hamel Husain — whose evals course is the
highest-grossing on its platform, having trained 2,000+ people at 500+ companies —
recommends a single "benevolent dictator" annotator _instead of_ multi-rater agreement,
warns that raw agreement is a trap under class imbalance, and says outsourcing error
analysis is usually a mistake.

**He is right, for a different job.** His use case is _improving a product_: a fast
iteration loop where one expert's judgement is the ground truth and the criteria are
still being discovered. Shreya Shankar's criteria-drift finding sharpens it — grading
outputs is how you learn what to grade for, so a fixed eval suite is philosophically the
wrong shape for that job.

The job here is _evidencing a product to someone who does not trust you_. A benevolent
dictator is unfalsifiable to an adverse reader: their agreement with themselves is 100%
by construction. Chance-corrected agreement across independent raters is the only thing
that answers "how do I know this reviewer isn't just consistent with their own bias?"

**Say this explicitly in any technical conversation, because otherwise the metrics look
like the thing 2,000 engineers were told not to bother with.**

Two supporting facts worth carrying. Contact-centre QA — a purchasable category at
roughly $24k average annual contract value, up to $131k — mandates quarterly calibration
against a reference gauge, and **has never published a single chance-corrected
reliability statistic.** No kappa, no alpha, no ICC, while a quarter of programmes are
out of conformance with the standard they claim to follow. And expert human annotation
revenue went from about $1B to over $6B across exactly the period when model judges were
supposed to displace it. **Judges ate the volume tier; humans hold the boundary cases.**

---

## 11. What this plan does not claim

Recorded because the codebase's best property is refusing to let the pitch outrun it, and
this document should hold to the same standard.

- **Not that sampled review prevents failures.** No public evidence supports that.
- **Not that any regulator prescribes a sampling rate.** None does; FINRA says so
  explicitly.
- **Not that the evidence is legally privileged.** Signed evidence is admissible and
  carries no presumption without a qualified timestamp.
- **Not that DSA blinding or independence hold on the live lane.** Full assurance runs
  randomize A/B position, while direct private evidence fixes `swap:false`; neither proves
  that a DSA reviewer cannot see provider identity, machine outcome or appeal result.
- **Not that "we cannot prove what happened" is a named buyer category.** It is not; no
  major survey isolates it. That is both the opportunity and the sales-cycle risk.
- **Not that signing is what makes the evidence credible.** No regulator requires or has
  accepted it. Reproducibility by an adverse reader is the differentiator; the signature
  is a convenience.
- **Not that a mandate produces a market.** Local Law 144 has been in force for three
  years at roughly 12% compliance with no fines.
- **Not that an outside panel satisfies statutory human oversight.** It supplies a
  separate calibration/reference label. Article 20 decisions remain with appropriately
  qualified people under the platform's supervision.
- **Not that a provider-side reference sample is the statutory audit sample.** The
  auditing organisation retains method and sampling authority.
- **Not that a future beacon proves the population is complete.** It constrains selection
  from the committed frame; reconciliation and source integrity remain separate evidence.
- **Not that panel labels are objective or legal ground truth.** They are adjudicated
  labels against a frozen policy and documented reference standard.
- **Not that “independent panel” means Article 37 independence.** That term is reserved for
  an audit engagement that satisfies the DSA's organisational conditions.
- **Not that the complaint-control artifact proves full Article 20 compliance.** It
  evidences qualified human supervision and the non-solely-automated decision control.
- **Not that the automated-means export is a complete DSA transparency report.** It is a
  reproducible section and set of compatible template rows.
- **Not that RateLoop submits to the Transparency Database.** That claim stays false until
  the official sandbox, delegated-token model and zero-personal-data gate pass.
- **Not that reviewer analytics are lawful because a switch exists.** Employment-data
  governance and, where applicable, a works-council agreement remain customer gates.
- **Not that the DSA product is released.** Population reconciliation, content-moderation
  decision facts, witnessed reference-draw foundations, single-case blinding, point
  estimators and a typed Part 8 draft verifier exist. Durable report-version publication,
  the complete authorized-panel consumer, external method acceptance, two provider pilots
  and one synchronized hosted/testnet exercise remain release gates below.

---

## 12. File-level implementation packets

These are issue-sized contracts. A task is not done because a unit helper exists; it is
done only when the named consumer path and exit tests pass together.

### 1.4 — population estimator

- Add a pure `packages/nextjs/lib/tokenless/populationEstimates.ts` and tests. Read immutable
  opportunities and observations from `adaptiveCoverageExport.ts`; never derive estimates
  from the existing unweighted rollups in `assuranceMetrics.ts`.
- Extend the coverage-export schema with typed `estimable` and `coverage_gap` results,
  estimand ID, frame/selected/completed counts, weighted cells, certainty share, variance
  method and limitations.
- Exit when the §5 acceptance suite passes and an external statistician or audit-method
  partner approves the interval method. Until then, export point estimates and gaps only;
  the public capability remains false.

### 1.5–1.6 — decision view and claims

- Extend `AdaptiveCoverageSummary.tsx`, `EvaluationDashboardPanel.tsx` and
  `evaluationDashboard.ts` in the existing authenticated Evaluations route. Add English
  and German message-catalog entries and interaction tests for the exact two-number and
  gap states, tenant isolation, accessibility and absence of raw internal IDs.
- Add estimator/DSA capability rules to `publicEvidenceClaims.ts` and its cross-consumer
  test. Expand the source walker to `messages/en` and `messages/de` before any copy lands.
- Exit when either locale fails CI for an unearned claim and the capability stays false
  without deployed exercise evidence.

### 2.1–2.2 — committed reference draw

- Migration `0170` adds dedicated sampling-epoch, projection, sample, manifest and
  transition tables rather than reusing reviewer-integrity epochs. Finish integration by
  consuming the frozen sample in the authorized label and report paths; do not add a
  second epoch model.
- Extract the reusable verification core from `packages/keeper/src/drand.ts` into a shared
  package consumed by both keeper and Next.js. A cross-consumer golden-vector test must
  bind exact network, round, signature, randomness and derivation domain.
- Exit when an altered frame, method, round or beacon fails; a frozen manifest reproduces
  every bucket; the commitment predates beacon availability; and neither consumer can
  rederive a different result.

### 2.3–2.4 — supervision quality

- Build on append-only overrides in `evidencePackets.ts`, existing aggregation in
  `adaptiveCoverageExport.ts`/`assuranceMetrics.ts`, and latency data in
  `agentReviewQuality.ts`. Keep reviewer disagreement, decision-owner override, reversal
  and supersession as separate events.
- The per-workspace employment-data governance record and append-only engagement events
  are implemented. The remaining consumer must keep aggregate-only mode free of persisted
  per-reviewer scores and expose reviewer metrics only under the frozen governance gate.
- Exit with minimum-denominator, zero-override, supersession, idle/reopen, timestamp,
  privacy-role, EN/DE and works-council-off tests.

### 2.5 — reference-sampling channel

- Consume the separate append-only reference sample produced by the persisted epoch; do
  not turn it into an ordinary adaptive opportunity. Stratify automated `pass` and `fail`;
  retain always-review for `uncertain`.
- Exit when both strata are sampled reproducibly, labels are excluded from adaptive
  promotion, disagreement can reset coverage, agreement cannot promote it, and exports
  identify the reference stratum and method.

### 2.8, then 2.6–2.7 — packet and adverse-reader path

- New evidence packets use the shared RFC 8785 implementation and retain immutable legacy
  verification. Real `audit_export_head` checkpoints use one enqueue invariant in both
  standalone and database-transaction consumers.
- Extend `evidenceShareGrants.ts` from a single packet to a bounded, revocable
  project/window compliance share. Persist `benchmarkResearchGrants.ts` separately for
  contractual public-safe research; it explicitly is not Article 40 access. A statutory
  Article 40 path may be built only around a DSC-vetted researcher and reasoned request
  under [Delegated Regulation 2025/2050](https://eur-lex.europa.eu/eli/reg_del/2025/2050/oj/eng).
- Exit on official RFC vectors including Unicode and numbers, browser/Node byte identity,
  DSSE negative cases, legacy verification, exact boundary digests, expiry/revocation and
  a public view containing no ciphertext, private content or reviewer identifiers.

### 3.1–3.2 — DSA population and frozen sample

- Add versioned population, decision, reconciliation, frame and sample tables plus paged
  ingest/freeze APIs. Do not reuse the generic 200-case comparative run importer or the
  5,000-row coverage-export response as the population store.
- Store the §4 population contract, Article 17/24 applicability/basis, nullable statement
  receipt, corrections and exact source/partition totals. Freeze inclusion status and
  probability for **every** frame unit, including non-selected units. Keep the official
  Transparency Database payload/receipt ledger separately versioned and enforce no
  personal data in every outbound field.
- Exit when idempotent large imports reproduce the exact root/count; conflicting IDs are
  rejected or explicitly versioned; missing/extra rows block freeze; and the full sample
  recomputes offline without reading mutable provider state.

Implementation semantics are deliberately narrower than the first draft. The first layer
is a **content-moderation decision**, not necessarily a moderation measure. It records
`measureTaken`; the measure identifier is present if and only if a measure was taken. The
second layer contains one immutable automated-means evaluation per decision and reportable
system/version. A no-action decision and every contributing system output stay in the
reference frame without inflating the official decision, measure or notice count.
`solely_automated`, `partially_automated` and `not_automated` remain distinct because the
official template asks for “not processed by automated means,” not “not solely.” A
not-automated decision has no system evaluations; solely or partially automated decisions
must reconcile to at least one. The frozen independent inventory includes unobserved
systems as typed zero-observation gaps.

The timing contract is also explicit: `populationFrozenAt` closes the ended reporting
period; `sourceFrozenAt` identifies the repeatable-read source snapshot; `committedAt` is
captured from the database wall clock immediately before the commitment write. A deferred
database constraint rechecks at transaction commit that the selected beacon will remain
unavailable for at least five minutes. Application timestamps and transaction-start time
are not substitutes for either database clock.

### 3.3–3.4 — authorized panel and DSA blinding

- Reuse `workspaceReviewers.ts`, `reviewerExpertise.ts`, `artifactPrivacy.ts`, assignments
  and short leases. Add structured language evidence, policy-category competence and
  conflict declarations, frozen at assignment rather than resolved from a later profile.
  A contractual CEFR threshold for this panel must not be described as Article 42
  moderator-staffing compliance.
- Add a single-case reviewer projection that withholds provider identity, machine outcome
  and appeal result. Randomized baseline/candidate swap in `assuranceRunOrchestration.ts`
  is not sufficient, and `directPrivateReviewEvidence.ts` currently fixes `swap:false`.
- Exit when only authorized private reviewers receive the exact frozen content; artifact
  and metadata leakage tests find none of the withheld fields; qualification expiry and
  conflicts fail closed; and the authorized reveal reproduces the committed mapping.

### 3.5 — DSA output

- Add a typed exporter over the 1.4 estimator and 3.1/3.2 frame. Emit the official
  service/reporting-period/system/scope/value/context rows, per-language cells for VLOPs,
  raw calculation inputs, reconciliation report, reference definition, uncertainty and
  limitations. Produce UTF-8 RFC 4180-compatible CSV/ODF values: percentages in `[0,1]`,
  integer counts and median durations in hours. Preserve every published version for at
  least five years while retaining identifiable reviewer telemetry only as separately
  justified.
- Exit when an offline verifier exactly reproduces every published cell; missing
  dimensions, small/empty cells and incomplete support become gaps; and confidential and
  public packet projections have deterministic, separately signed digests.

Persist these foundations in ordered migrations after `0170`: an independent frozen
classifier inventory; notice-processing facts and typed incomplete-processing gaps; a
count contract bound to exact decision, measure and notice census witnesses plus audit
and attestation heads; reference labels bound to selected decision-system evaluations;
and immutable report IDs, versions, corrections, stored bytes, publication state and
five-year retention. The publication route may expose only bytes whose stored digest an
offline verifier reproduces from those authoritative rows.

The exporter must transform a checked-in byte-exact copy of the Commission CSV template,
whose fetched source digest on 31 July 2026 is
`sha256:1a687f468468b25b214f505c4a6cb906d6ee8cc80d20f5a60eca383cc1bea71d`.
It recomputes official measure and notice counts from the complete frozen decision facts,
re-verifies every referenced population/sample/estimate artifact, and emits canonical
context JSON without internal identifiers or spreadsheet formulas. Caller-supplied totals
or self-asserted digests are never evidence.

### 3.6–3.7 — external decision and network validation

- 3.6 completes only with dated method acceptance from one audit organisation, two
  provider pilot issue logs, offline calculation reproduction and one paid-repeat request.
- 3.7 uses one fresh complete deployment key and the real hosted/testnet path across
  Next.js, Ponder, keeper and contracts: eligibility → assignment → acceptance → commit →
  reveal/beacon → payout or compensation → claim/recovery. Exercise keeper outage, retry,
  reorg, beacon failure, expiry and old-key rejection.
- The current active v4 registry is intentionally empty and the canonical tokenless app
  is stale. A fresh Base Sepolia deployment and synchronized Vercel/Railway bundle are a
  hard prerequisite; a web-only deployment must fail closed.
- Neither task enables the closed network automatically. Activation still requires the
  legal/privacy/payment gates in §7 and explicit evidence of demand beyond the named
  panel.

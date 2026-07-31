# RateLoop tokenless — implementation plan

Rewritten 31 July 2026 from six research passes into the question that matters: **what
should this be, so that an enterprise wants it and can be made to need it?**

**Written for a German vendor.** The first reachable obligation is European: DSA
content-moderation accuracy reporting and independent audit. An earlier draft picked a
US vertical that a German company could not credibly sell into. Everything else here is
jurisdiction-independent.

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

**Start with audit-ready, independently sampled accuracy evidence for automated content
moderation and complaint review.** The platform retains the complete moderation and
appeal population. Its own qualified staff or controlled contractors remain responsible
for statutory complaint decisions. A separate, blinded and language-qualified panel
re-reviews a precommitted sample and produces reproducible accuracy, precision, recall,
error, agreement and override evidence.

This is the strongest European fit because the obligation, artifact and adverse reader
already exist:

- The [Digital Services Act](https://eur-lex.europa.eu/eli/reg/2022/2065/oj/eng) is in
  force. Article 20 requires complaint decisions to be supervised by appropriately
  qualified staff and not made solely by automation. Articles 15 and 42 require public
  reporting of automated-moderation accuracy and possible error rates; VLOPs and VLOSEs
  report the measures by official EU language.
- The harmonised reporting rules have applied since 1 July 2025. The
  [mandatory template](https://eur-lex.europa.eu/eli/reg_impl/2024/2835/oj/eng) asks for
  accuracy, precision and recall per moderation system, plus the input criteria,
  methodology, control-group variation and, optionally, human-reviewer accuracy. The
  first harmonised reports were due in February 2026, so this is a current recurring
  workflow rather than a future mandate.
- VLOPs and VLOSEs undergo annual independent audits. The
  [DSA audit rules](https://eur-lex.europa.eu/eli/reg_del/2024/436/oj/eng) require
  sufficient reliable evidence, tests of algorithmic systems, assessment that public
  disclosures are free from material error, and representative sampling selected
  without interference by the audited provider. They specifically contemplate
  independently reproducing accuracy indicators.
- German enforcement is concrete. The
  [Bundesnetzagentur's 2025 report](https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/EN/2026/20260430_TB_DSC.html)
  records more than 2,000 complaints and names Articles 16, 17 and 20 among its
  enforcement priorities.
- The evidence failure is observable rather than hypothetical. Booking.com's
  [published DSA audit](https://q-xx.bstatic.com/data/mobile/2025%20-%20Audit%20report.pdf)
  used samples of appeals and training records, but unreconciled datasets prevented
  reasonable assurance for several obligations and the auditor found material
  discrepancies in Article 42 accuracy disclosures.

### The product boundary

The independent panel is an **additional calibration and reference-label layer**. It is
not the Article 20 decision-maker, and its existence does not prove that the platform's
human supervision occurred. The DSA prescribes supervision, reporting and audit; it does
not prescribe RateLoop's sample rate, multi-rater consensus, commitments or metric.

The current permanent operator-held sampler key also does not yet support a claim that
selection occurred without provider interference. The epoch precommitment and
beacon-seeded draw in §6 are therefore prerequisites for an **independent sampling**
claim, not optional hardening.

### Buyer and first pilot

The operational champion is a moderation-quality lead, Head of Trust & Safety or DSA
compliance officer. The adverse reader is the statutory auditor, Commission or Digital
Services Coordinator. Begin with EU-established platforms using automated moderation;
VLOPs and VLOSEs are the enterprise segment because the external audit recurs annually,
while the wider Article 15 market supplies the reporting adjacency.

Run concierge pilots with a small named, contracted, language-qualified panel and only
public, synthetic, owner-confirmed redacted or contractually permitted material. Validate
the packet and sampling method with one audit-organisation design partner and two
provider-side pilots before deciding whether to expand the reviewer network.

### Adjacent obligations, not the launch wedge

- The [Platform Work Directive](https://eur-lex.europa.eu/eli/dir/2024/2831/oj/eng)
  requires qualified human oversight, human account-termination decisions and reasoned
  review after national transposition by 2 December 2026. It is a strong second vertical,
  but implementation is still settling and an outside panel cannot substitute for the
  platform's authorised decision-maker.
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

## 5. The two-week version

| #   | Task                                                              | Days | Status |
| --- | ----------------------------------------------------------------- | ---- | ------ |
| 1.1 | Canonical commitment writes, legacy backfill and DB constraint    | 0.5  | Done   |
| 1.2 | Real decision → persistence → export test across all policy modes | 0.5  | Done   |
| 1.3 | Golden vectors for both domain-separated sampler manifests        | 0.5  | Done   |
| 1.4 | Horvitz–Thompson weighted estimator                               | 3–4  | Open   |
| 1.5 | The one screen                                                    | 2    | Open   |
| 1.6 | Sampling disclosure + claim-gate rule                             | 1    | Open   |

**1.3 matters more than its size.** Before it landed, the test asserted only
self-consistency, so reordering the manifest string could silently re-roll every bucket
with a green suite. The fixed and adaptive vectors now freeze both commitment and bucket.

**1.5 — the single screen that sells this.** Two numbers side by side:

> Sampled agreement: 96.2% (n=740)
>
> **Population estimate: 88.1% (95% CI 84.3–91.4%)**
>
> _The sampled figure is biased upward because coverage was reduced on scopes that were
> already agreeing._

A vendor telling a risk officer their own headline number is wrong, and then showing the
correct one, is the most persuasive thing available here. Give it its own top-level route
and its own auth path — not a tab inside an engineer's workspace.

**On the estimator.** Horvitz–Thompson over the recorded selection probabilities, and
Begg–Greenes for any sensitivity or specificity figure. **Do not use Rogan–Gladen** — it
assumes strata defined by the human label, this design stratifies by the machine's, and
simulated on realistic numbers it returned an endorsement rate of 4.53 against a truth of
0.85. Intervals via Korn–Graubard, because weighting produces non-integer counts the
Wilson helper rejects. Forced strata carry probability 1 by construction, so they weight
correctly for free — but report the forced share, because a mostly-deterministic design is
not a probability sample and saying so is the point.

**Where the design does not support an estimate, return a coverage gap rather than a
number.** Manual and rules modes record zero selection probability; for those scopes the
honest output is always a gap. Treat that as the common case, not an edge case.

---

## 6. The six-month version: a draw that could not have been rigged

The move that changes the category, reusing code already in the repository.

Rotate the sampler key per epoch. Publish the **hash** of the next epoch's key to a
transparency log _before_ the epoch opens. Publish the **key itself** after the epoch
closes. Anyone can then recompute every bucket for that period and confirm which outputs
were selected — and that the operator could not have chosen them after seeing outcomes.

Stronger still: **seed the epoch key from a future drand round**, so the operator cannot
grind the key at all. The beacon client already exists.

**That is the difference between "we sampled honestly" and "we could not have sampled
dishonestly."** It is the only claim here that no competitor can answer by shipping a
feature, and it is why the deterministic-decision boundary stops being a restriction and
becomes the reason the number is admissible.

| #   | Task                                                      | Days |
| --- | --------------------------------------------------------- | ---- |
| 2.1 | Epoch key rotation + pre-commitment to a transparency log | 8–10 |
| 2.2 | Beacon-seeded key derivation                              | 3–4  |
| 2.3 | Override analytics — the rubber-stamp detector            | 2    |
| 2.4 | Engagement measurement per reviewer and scope             | 2–3  |
| 2.5 | Sample a fraction of automated `pass` and `fail`          | 7–8  |
| 2.6 | Anchor the audit chain                                    | 2    |
| 2.7 | Compliance-reader entry point                             | 5    |
| 2.8 | Typed packet schema on DSSE + RFC 8785 canonicalisation   | 5    |

**2.3 and 2.4 are the Uber and Cigna findings turned into features**, and both are close
to free. Override decisions are already recorded and never aggregated; decision-time
percentiles are already computed. Together they answer "prove what the human did", which
is the question the case law actually asks.

**2.5 needs its ordering respected.** Audit-sampled reviews must be excluded from the
adaptive coverage window _before_ the weighted estimator reads it, or the estimator
computes weights over a population the audit then changes. Make the audit a **one-way
ratchet**: it may force a reset to full coverage, never a promotion.

**2.8 changes digests.** Do it before anyone depends on them. The repository already
implements DSSE correctly, and there are currently six divergent hand-rolled canonical-JSON
implementations.

---

## 7. What to retain and gate

**Do not delete the reviewer network under the current design of record.** The newer
deletion proposal was an unrecorded product pivot: the governing tokenless design retains
the immutable fund core, paid eligibility, reviewer access, audience policies, vouchers,
keeper, indexer and paid assignment-to-settlement release work. The stack also supports
paid customer-invited review, so it is not a detachable public-marketplace page.

Keep the RateLoop-network lane **default-off and outside the initial release**. Test it
first as the narrow DSA reference-panel workflow in §4, using named contracted reviewers,
language and qualification evidence, blind assignment and public-safe material. Do not
finish or market a general crowd marketplace until those pilots show demand and an
external legal/privacy review approves the operating model.

### DSA reference-panel pilot

| #   | Task                                                                   | Days       |
| --- | ---------------------------------------------------------------------- | ---------- |
| 3.1 | Import and reconcile the complete moderation/appeal population         | 5–7        |
| 3.2 | Freeze a separate audit sample from the §6 provider-independent draw   | 3–4        |
| 3.3 | Bind named reviewer identity, language, qualification and conflict     | 4–5        |
| 3.4 | Blind source outcome and provider identity in assignment and review    | 4–5        |
| 3.5 | Export DSA classifier/category/language metrics and calculation inputs | 5–7        |
| 3.6 | One audit-partner review and two provider pilots                       | External   |
| 3.7 | Deployment-pinned paid assignment-to-settlement and recovery suite     | 5–7 + soak |

The audit sample is separate from the operational adaptive-review sample. It must never
feed the adaptive promotion window, and the provider must not choose its seed, exclusions
or replacements. Population reconciliation fails closed: a packet with missing,
duplicated or unmatched moderation decisions produces a gap, not an estimate.

Activation requires all of the following on one fresh complete deployment:

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

If pilots reject the network, reopen the governing design explicitly and then follow the
ordered cross-package deletion rule. Until then, irreversible deletion destroys the only
existing supply path for the DSA wedge before it has been tested.

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

**Reviewer scorecards without a per-workspace off switch.** Per-reviewer performance
measurement is worker monitoring, and German works-council co-determination under
§87(1)(6) BetrVG means a customer cannot deploy it without an agreement. It must be
switchable off, not merely disclaimed.

**An MCP "get a human to sign off" tool.** Nearly free given the existing servers, which is
why it is tempting. It is also precisely the product HumanLayer abandoned while OpenAI
shipped native approve-and-resume.

---

## 9. Sequence

| Order | Work                                                        | Days/Status  |
| ----- | ----------------------------------------------------------- | ------------ |
| 1     | 1.1–1.3 — make the frame load and stay fixed                | Done         |
| 2     | 1.4, 1.5 — the estimator and the screen                     | 5–6          |
| 3     | 1.6 — disclosure and claim gate                             | 1            |
| 4     | 2.3, 2.4 — override and engagement analytics                | 4–5          |
| 5     | 2.1, 2.2 — the provider-independent verifiable draw         | 11–14        |
| 6     | 2.7 — compliance-reader entry point                         | 5            |
| 7     | 2.5 — stratified automated-eval sampling                    | 7–8          |
| 8     | 2.6, 2.8 — anchoring and schema                             | 7            |
| 9     | 3.1–3.7 — DSA panel pilot, deployed validation and decision | Release gate |

The frame in row one is repaired. Row two produces the number; row five makes an
independent-sampling claim supportable. The intervening work makes the output honest and
operationally useful without claiming independence early.

### Ordering hazards

- **2.5 before any weighting that reads its output**, never in parallel.
- **One migration in flight at a time.** `0165` is taken; the next is `0166`.
- **Copy fixes now span four files**, because public strings moved into message catalogs
  and the German translations are already written. Editing a page component alone breaks no
  test and leaves the other language asserting the old claim.
- **The claim-gate walker never scans the message catalogs.** Adding a rule without
  extending it certifies English and ignores German — worse than no gate.
- **Fix the locale-dependent canonicalisation before publishing any verifier.** Key
  ordering uses locale comparison, so two machines can derive different digests for the
  same packet.

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
- **Not that blinding or independence hold on the live lane.** They do not — the swap flag
  is hardcoded false and reviewers are customer-invited and customer-named.
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

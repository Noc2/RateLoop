# RateLoop tokenless — business plan

Written 29–30 July 2026 against `d49862fa3`, from market, pricing, legal, procurement
and evaluation-methodology research plus a capability audit. Companion to
[product-opportunities.md](product-opportunities.md).

**This is a relaunch plan.** The main site becomes a placeholder that promises nothing.
The tokenless product is the next chapter and has never taken a payment.

---

## 1. Position: lead with evaluation, price on compliance

The compliance framing is the wrong door and the right lock.

**The door.** Gartner published a _Market Guide for AI Evaluation and Observability
Platforms_ on 2 February 2026, predicting adoption by software engineering teams rising
**18% in 2025 to 60% by 2028**. A separate Gartner release two weeks later sized the AI
governance platform market at **$492M worldwide for 2026** — the only tier-one figure in play, and the smallest by 5×, split
across OneTrust, IBM, Credo AI and everyone else. Engineering budget is larger, faster,
and reachable without procurement, legal review or a DPA negotiation.

**The lock.** Compliance budgets are non-discretionary and survive cost-cutting.
Evaluation tooling is what gets cut in a consolidation year, and 2026 is one.

**They are the same artefact.** A deterministically sampled, blinded, multi-rater
verdict on live production output — reported as chance-corrected agreement plus a
confidence-bounded endorsement rate — is simultaneously an engineering quality signal
_and_ the systematic real-world performance record that Article 72 post-market
monitoring asks providers to keep from **2 August 2026**. One measurement, two budgets.

Every precedent runs in one direction. Snyk went developer-first from 2015 and only
built the security-buyer narrative after thousands of developers were already using it.
Sigstore had compliance as its origin and engineering ergonomics as its adoption driver,
and never dropped either. Drata and Vanta lead with the operational control signal and
sell the audit artefact as a byproduct. **Compliance-first-then-engineering has no
documented precedent in either a success or a failure.**

So: **enter through the engineer who has an unvalidated judge today. Renew through the
risk owner who needs the same record dated and retained.** Do not lead with compliance
to an engineer, or with evaluation to a risk buyer.

---

## 2. The wedge, and why it is unoccupied

Human review is already the most common evaluation method — among organisations that
already run evals, **59.8% rely on it** for nuanced or high-stakes work, ahead of
LLM-as-judge at 53.3% (n=1,340 respondents, of whom about half run evals at all). So the thesis is not novel; the instrumentation is.

Automated judges are measurably unreliable exactly where they matter. Chance correction
deflates reported agreement by **33–41 percentage points**. Preference flips average
**13.6%**. Against domain experts, agreement falls to
**68% for dietitians and 64% for clinical psychologists**, versus 80% for _lay users in
the same two domains_ — the gap is expert-versus-layperson, not domain-versus-benchmark,
which an earlier draft got wrong. Prompting does not fix it. Most damning: one finance study found a judge at **κ = 0.86 on
questions it could answer itself and κ = 0.16 on questions it could not.** The judge is
reliable precisely where you do not need it.

Anthropic's own engineering guidance names human grading the **gold standard used to
calibrate model-based graders**, with its binding weakness stated plainly: _access to
human experts at scale_.

**The differentiation claim, corrected twice and now narrow enough to survive.**

An earlier draft said no platform computes chance-corrected agreement and none uses
blinded panels. **Both are false.** Langfuse's Score Analytics computes Cohen's kappa,
F1, confusion matrices and correlation coefficients. LangSmith runs genuinely blind
multi-annotator review — reviewers cannot see each other's scores — with reservations
and configurable reviewer counts. Galileo shipped a raw-percentage annotator-agreement
chart in May 2026. Confident AI reports a per-metric confusion matrix against human
labels. Label Studio Enterprise has consensus and pairwise agreement, gold-standard
honeypots, annotator performance scoring and bot detection — more mature quality control
than any evaluation vendor.

**What is actually unoccupied is the join.** Each capability exists somewhere and no
product has two of them at once:

- **Langfuse has the statistics and cannot collect the data.** A second annotator's
  submission overwrites the first; the maintainers' own workaround leaves prior labels
  visible, so there is no blinded path. Its kappa compares two _score sources_, not
  multiple human raters.
- **LangSmith collects genuinely blind independent labels and computes nothing from
  them.** Its "alignment score" is raw percentage match.
- **Braintrust states outright that it does not support blind review**, and averages
  multiple scores together. Weave shows "has annotation" badges before you rate,
  anchoring the second rater. Datadog resolves disagreement by intersection, majority
  vote or averaging — destroying the signal, though its CSV export keeps per-reviewer
  columns so a customer could compute kappa themselves.
- **Arize publishes a guide prescribing Cohen's kappa, Fleiss' kappa and Krippendorff's
  alpha, and ships none of them.**

So the honest claim is: **blind independent multi-rater collection, chance-corrected
agreement over it, a confidence bound, reproducible sampling, and a signed artefact — in
one product.** Every piece exists in isolation; nothing joins them.

Two further gaps worth naming, both verified across the category. **No vendor computes
statistical significance on experiment comparisons.** And **no signed, machine-readable
evaluation artefact exists anywhere** — model cards are prose, leaderboards are HTML,
audits are PDFs. The signing technology exists (sigstore, in-toto, C2PA's conformance
programme) and the assurance market exists, and nobody has joined those either. Verifiable
inference proved the machine ran correctly; nobody proves _N qualified humans
independently rated the same items and reached this level of agreement_.

Do not sell the arithmetic. Krippendorff's alpha calculators are free and several
qualitative-research tools have computed these coefficients for decades — ATLAS.ti built
its implementation with Krippendorff himself. **The commercial object is the
independence, the panel and the verifiability, never the coefficient.**

**Verified in code, and one claim withdrawn.** Nominal Krippendorff's alpha at
`agentReviewQuality.ts:155` — textbook, correct, and the strongest verified claim in this
document. Wilson bounds across six files (two implementations, algebraically identical —
a drift risk worth fixing). HMAC-keyed sampling at `adaptiveReview.ts:175`.

**Blinding is withdrawn.** It exists only in the switched-off paid lane. On the live
lane `directPrivateReviewEvidence.ts:296` sets `blinding = { swap: false }` — a literal
written into the commitment as bookkeeping, blinding nothing — and reviewers are stored
as `customer_invited` and `customer_named`. **They are invited and named by the party
being reviewed, which is the opposite of structural independence.** Three other documents
in this set already say the independence question is unresolved; selling it as shipped
was wrong.

**Two limits on alpha, both corrected once.** An earlier draft said the default panel
size was one and the privacy floor three. Neither is current: the default was raised to
**two** in July, and the floor **tracks the panel** rather than being fixed.

The practical problem is worse in its corrected form. Alpha is not suppressed — it is
computed on **two-rater cases**, the weakest possible reliability data, where it is a
near-deterministic transform of the unanimity rate already displayed and its sampling
variance is very large. **No confidence interval is reported at all**, only a
small-sample boolean. And because the aggregation floor equals the panel size, every case
where one of two reviewers did not respond drops out — non-randomly, which biases alpha.

Do not report alpha as a headline without a bootstrap interval. Also note the database
constraint still permits a panel of one and the SDK accepts up to five hundred, against
an enforced floor of two — three bounds that disagree.

### What this does NOT yet do, stated before anyone sells it

A code audit killed three claims a first draft of this section made. They are roadmap,
not product:

- **Judge calibration is not implemented.** There is no agreement statistic between an
  automated evaluator and humans anywhere — no confusion matrix, no precision or recall
  against human labels, no kappa. What ships is a labelled-data export.
- **Worse, the export is structurally biased.** Only receipts marked `uncertain` escalate
  to a human; `pass` and `fail` never do. So a customer can never measure their
  evaluator's false-positive or false-negative rate — **precisely the number a
  calibration buyer wants** — and the labels they do get come from the evaluator's own
  uncertainty band, where its accuracy is worst and least representative.
- **Alpha measures the panel, not the agent.** It is inter-rater reliability. A customer
  reading "reviewer consistency" as an agent quality score is being misled.
- **You cannot compare two versions of the same agent.** Every quality surface is bound
  to current versions; ship a v2 and v1's numbers vanish from the UI with no read path
  back. This kills "did my agent get better?" outright.
- **The sample does not support unbiased inference.** Forced strata union the HMAC draw,
  the sampling rate is lowered _because_ past agreement passed a threshold — selection on
  the dependent variable — and recorded inclusion probabilities are never used to weight.
  **A statistically literate buyer will notice within one meeting.** It is a defensible,
  tamper-evident _coverage policy_, not a sampling frame.
- The sampler key is never disclosed, so coverage is auditable by RateLoop rather than
  independently verifiable.

### So the honest wedge is narrower, and still unoccupied

Three claims survive the audit, and they are enough:

1. **Per-use-case human endorsement with a confidence bound.** For each workflow and
   risk tier: what share of outputs a blinded panel endorsed, with a Wilson 95% interval
   and an explicit small-sample flag. That _is_ an agent-quality measure, and it is
   use-case specific rather than benchmark-generic.
2. **Where the task itself is ambiguous.** Alpha, unanimity and dissent hotspots identify
   the workflows and risk tiers on which qualified humans cannot agree with each other.
   **Nobody else computes this, and it is the most useful thing in the product** — where
   your reviewers disagree is where an automated judge is also unreliable, and where a
   confident score is a lie.
3. **A tamper-evident record of exactly which outputs were reviewed and why**, with
   recorded inclusion probability and a coverage export carrying hashes and commitments.
   **The export is not signed** — an earlier draft said it was — and the capability is
   pinned false in the claim gate, so it cannot appear in public copy until both are
   fixed.

**The positioning sentence:**

> Generic benchmarks cannot tell you whether your agent is good enough for your use
> case. We put a sampled, blinded panel of qualified humans on your live production
> output and return two numbers per use case: what share they endorsed, with a
> confidence bound — and how much they agreed with each other, chance-corrected, so you
> know which parts of the job are genuinely ambiguous.

For the risk buyer, the same sentence plus: _and the same dated, sampled, reproducible
record a provider's post-market monitoring plan needs._ Note Article 72 binds the
**provider**, not the deployer — this set's own legal document flags deployer-facing
Article 72 citations as a defect, and an earlier draft reproduced it.

Judge calibration is the natural next claim and it is **three build items away**:
collect human labels on a sample of `pass` and `fail` receipts too, compute the
confusion matrix, and weight by recorded inclusion probability. Do not sell it first.

---

## 3. Where things stand

**Works today:** self-serve signup, agent connection over MCP OAuth or API key, review
policy configuration, invited reviewers, signed evidence packets, a browser verifier,
expiring auditor share links, audit and OSCAL exports. A three-account hosted test
exercises the whole chain.

**Revenue is blocked by three things, none architectural:** Stripe is off behind two
flags; the verified-business gate guarding checkout can only be satisfied by a function
with no route or UI, so customer #1 hits a wall; and **the decisions meter is wired only
to the switched-off paid lane**, so the usage counter reads zero forever while the
pricing page promises an allowance.

Fix the meter _after_ deciding what it should be.

---

## 4. Pricing and the numbers that actually bind

The current meter is decisions, and it is wrong three ways — with two corrections an
earlier draft needed.

**It compares badly per unit.** $29 for 250 decisions is $0.116, but that is the
promotional price; **at the $99 list it is $0.396**, and quoting the lower figure
flattered the comparison. Amazon A2I orchestrated the same work at $0.02–0.03 per object
with no charge for your own reviewers, so the honest gap is 5–20×. (A2I closed to new
customers on 30 July 2026 — a historical anchor now, but the one a buyer's memory uses.)

**It suppresses the behaviour being sold.** Metered review budgets mean fewer reviews,
which means thinner evidence.

**The metered thing is the shrinking thing.** Adaptive coverage steps
100% → 50% → 25% → 10% by design. Note the sign, because an earlier draft had it
backwards: **nothing is charged per decision today** — both plans are flat fees with an
allowance, no overage, no usage record — so falling consumption raises revenue _per
decision_. The problem is not that revenue falls. It is that of four limits already
implemented, the only one presented as the headline is the only one designed to shrink,
which forecloses usage-based expansion before it starts.

**Meter on governed agents and retention years.** Both grow. Retention costs almost
nothing to serve and is where willingness to pay sits — evidence with short retention
is worthless to an auditor.

**Price against expert-hours, not eval-tool seats.** Next to LangSmith at $39/seat you
look absurd; next to expert review at $85/hour you are cheap — €2,000/month is under 24
hours of expert judgement. Regulated-evidence artefacts price 10–40× commodity review:
Stripe Identity €1.25/verification, Sumsub $1.35–1.85, Skribble €4–5 per qualified
signature, Checkr $30–95 per report.

**One constraint any retention promise must respect:** a 30-day retention option is not
implementable. There is a six-month retention floor in `evidenceRetention.ts` _and_ a
database CHECK constraint, with its recorded basis being Article 26(6).

Two corrections an earlier draft got wrong. **Retention depth has no AI Act basis** —
Article 26(6) is _six months_, not six years. The real anchors are §195 BGB's three-year
limitation and the new Product Liability Directive's **ten-year long-stop** (25 years
for latent injury, with court-ordered evidence disclosure), transposing 9 December 2026.
And **qualified timestamps are per-unit COGS on the core artefact** — at €2.50 per token,
sixty decisions cost €150. Timestamp the packet, not every decision.

Two inputs have no credible benchmark and must be treated as scenarios rather than
estimates: months to first paying customer, and free-to-paid conversion, where the
top-to-bottom quintile spread is **10×**. Stripe Atlas's median time to first payment is
34 days from incorporation across 23,000 companies — not category-specific, but the right
order of magnitude for a product that already exists and has users.

---

## 5. Competition

**Evaluation platforms** — LangSmith ($39/seat), Braintrust ($249/mo flat, no per-seat
charge at any tier), Langfuse ($29/$199/$2,499, MIT core including annotation queues),
Arize ($50/mo, unlimited users and annotations on every tier), Galileo ($100/mo),
Confident AI ($200/$2,000, Apache-2.0 core). Well funded and consolidating: Datadog
acquired Adaptive ML in June 2026 and invested in Patronus's $50M Series B, Humanloop's
platform sunset in September 2025, and Argilla has been frozen since March 2025.

**All of them sell software with unlimited or cheap seats. None wants a services
margin**, which is why none supplies humans — and why the labour side went to Mercor,
Handshake and Surge instead, selling labour plus rubrics rather than tooling.

**Signed-evidence micro-vendors** — the closest is Monaco-based **KLA Digital**, selling
tamper-evident records and human approvals **from €5,000 per application with no free
tier and no self-serve**. The lane below them is empty. (An earlier draft described
their cryptography in specifics that are not on their reachable pages; the load-bearing
fact — price floor, no self-serve — holds.)

**The honest statement:** for most buyers the alternative is a spreadsheet, a Slack
thread and a domain expert's memory. What this sells against that is a number that
survives being questioned.

**Two warnings.** HumanLayer was the human-in-the-loop approval SDK and **pivoted away anyway**, with its
repository now carrying an explicit deprecation notice (revenue figures circulating for
it trace to an estimate aggregator and a single job posting — do not rely on them) to a coding IDE, while
OpenAI's Agents SDK shipped native approve-and-resume. HITL as a standalone product gets
absorbed into frameworks. And Datadog shipped production-to-human annotation queues in
March 2026 explicitly for judge calibration: **the workflow is being commoditised in
real time.** Only the statistics and the labour supply remain unclaimed.

---

## 6. Go to market

**One ICP, named.** Teams running a customer-facing agent where a quality claim has to
survive challenge by someone outside the team. The DSA transparency database publishes **359 active platforms** for free — that is a
live counter of platforms currently filing, not the obligated population, and Article 20
is disapplied for micro and small enterprises, which excludes much of this ICP — naming ten of them is an hour's work and is
the difference between a plan and an intention.

**The sharpest obligation is DSA Article 42(2)(b)**, not Article 20(6) and not
the AI Act. Very large platforms must report **"the qualifications and linguistic
expertise of the persons carrying out"** content moderation, "as well as the training
and support given to such staff" — a **recurring, public, mandatory disclosure about
reviewer qualifications** that someone has to produce every period, and that this
product's evidence could populate directly.

Article 20(6) is the second hook, not the first. It says decisions are _"taken under the
supervision of appropriately qualified staff, and not solely on the basis of automated
means"_ — but "appropriately qualified" is nowhere defined, and it requires
_supervision_, not that each decision be made by a qualified person. Article 50(4)'s
editorial-responsibility carve-out (an obligation with a carve-out rather than an
exemption, applying 2 August 2026, reaching a "natural **or legal** person") is the
third. Article 26 rides a deadline sixteen months out. Note that Article 72 binds the
**provider**, not the deployer — this set's own legal document flags deployer-facing
Article 72 citations as a defect, and an earlier draft reproduced it.

### The strongest citation found anywhere, and it is not about AI

**FINRA Rule 3110.07** requires evidence of review to "clearly identify the reviewer,
the internal communication or correspondence that was reviewed, the date of review, and
the actions taken" — and states plainly: **"Merely opening a communication is not
sufficient review."**

That is a binding rule with a **named record schema matching what this product already
emits**, applying to AI-assisted review today with no new AI regulation needed. Rule
3110.09 requires preparer and reviewer names to be ascertainable from retained records;
SEC Rule 17a-4(b)(4) preserves communications "and any approvals thereof"; 17a-4(f)
requires a time-stamped audit trail including the identity of whoever created or
modified a record.

**But it gives no volume driver.** FINRA Notice 07-59 permits sampling explicitly:
**"There is no prescribed minimum or fixed percentage that is required by
regulation."** The FCA has published nothing either. **No US or UK regulator prescribes
a sampling rate.** Sell the defensibility of a chosen methodology, never compliance with
a mandated review volume.

**And the pre-use approval hook is eroding.** FINRA proposed in July 2026 to delete
mandatory principal pre-use approval of retail communications, **citing the speed and
volume of AI-generated communications as a reason**. The evidence-of-review obligation
is being carried across and made universal instead — a better fit for a continuous audit
trail than a one-off signature.

**The direction of travel is this plan's thesis in miniature.** The SEC withdrew its
predictive-analytics proposal in June 2025; the CFPB withdrew both AI adverse-action
circulars in May 2025; the banking agencies replaced SR 11-7 in April 2026 with guidance
that is expressly non-enforceable and **scopes generative and agentic AI out entirely**;
the FCA states outright that it does not plan to introduce extra regulations for AI. What
grows instead is the expectation of evidence — prompt and output logs, model version and
timestamp, exam attention to AI supervision procedures, board-approved outcomes
reporting.

**The market is for evidence infrastructure, not for compliance with a human-review
mandate.** That is the clearest external confirmation of this plan's direction found
anywhere in the research, and simultaneously the sharpest warning against selling a
mandate that does not exist.

**Free artefacts worth producing:** a pre-drafted MCC-AI Annex E/F pack (Annex F is a
blank "measures to ensure human oversight" box every AI supplier to an EU public body
must fill), and a CSA STAR Level 1 self-assessment — free, no prerequisites, publicly
registered, and the format cloud marketplaces accept.

**ISO/IEC 42001 controls A.6.2.8 and A.9.4 apply before the AI Act does.** That deadline
exists now, the budget line exists, and it is jurisdiction-agnostic.

**Not worth pursuing:** channel partnerships — no European SI publishes a door below
~€1M ARR, and certification bodies cannot resell into accounts they certify. Corporate
innovation programmes convert screened startups at ~1.4%.

**Refuse white-label.** The product sells evidence independent of the party being
reviewed. Rebadged as an integrator's own output it is not independent.

---

## 7. What is actually defensible

**Not the cryptography.** Hash-chaining an annotation table is a sprint. And from
December 2026, eIDAS qualified electronic ledgers carry a statutory presumption of
sequential ordering and integrity — supervised providers can offer the primitive as a
regulated service. **The tamper-evidence layer has a known expiry date as a
differentiator.** Ride them; do not compete.

**Not data network effects — architecturally foreclosed, deliberately.** Review data is
per-customer, confidential, covered by a no-training commitment, and the plan forbids an
inference model in the core. Say this out loud so it stops being quietly assumed.

**Three things plausibly survive 24 months:**

1. **The accumulating evidence archive.** The only asset that appreciates with elapsed
   time and cannot be back-filled, because each record was signed contemporaneously by a
   named reviewer. A customer switching in month 20 abandons 20 months of evidence.
   The standalone open verifier is not marketing — **it is the precondition**, because a
   buyer only accumulates an irreplaceable archive with a solo vendor if the archive
   survives the vendor.
2. **The CI gate that blocks on a human decision.** The only item in either document
   that creates a real switching cost: a pipeline gate is removed by a deliberate act
   with a named owner. Everything else is observational and removable silently. It is
   currently late in the build order and **belongs first**.
3. **Standards participation.** There is no specification of what oversight evidence
   must look like — and CEN-CENELEC JTC 21 is drafting the document that will create
   one. SME participation is fee-exempt and explicitly encouraged. The value is 12–24
   months of advance notice of the artefact spec. Slow, unpaid, and exactly the horizon
   in question.

All three compound with _elapsed time_, so the dominant strategy is the one that
maximises months alive: minimise burn, take revenue early.

**And the honest framing: at zero customers, defensibility is the wrong thing to spend
pages on.**

---

## 8. Risks, and what actually kills this

**Nobody replies.** For bootstrapped companies this is the modal failure, not running
out of money — in one dataset of 83 postmortems citing "no market need", only **2 cited
insufficient funding** while **55% named a marketing problem** (an earlier draft said
69%, which appears only on unrelated blogs).

**The closest documented analogue shut down in August 2025** — February 2026 is when the
founder published the postmortem. Cydoc: solo founder,
bootstrapped, regulated-adjacent AI, seven years. Cause was broken unit economics (~$70
cost against a sub-$100 price), sales neglected because solo, and a moat undercut when a
client built a simpler version in-house. **Explicitly not regulation.** Three of those
four are live here.

**Point solutions lose to platforms in compliance categories.** GDPR built OneTrust —
~$500M ARR — because it addressed continuous operational pain. The small undifferentiated
GDPR-era vendors died quietly and left no postmortems. "Signed evidence for one workflow
step" is structurally the wrong shape; the evaluation framing is what turns it into a
recurring operational one.

**The sharpest threat to the evaluation framing is a mindshare problem, not an evidence
problem.** The most-followed practitioner in the field recommends a single trusted
annotator over multiple raters — which makes inter-rater agreement definitionally
inapplicable. If the buyer's mental model is "one expert, 30 traces, a spreadsheet",
then alpha, Wilson bounds and blinded panels read as academic overhead. **Test this in
the first five conversations.**

**Solo operations.** No admin UI, no error tracking, no on-call. Promising an evidence
SLA at four-figure monthly prices is a contractual liability until that changes.

### Kill criteria

- **Definition of "will pay":** a card charged or a signed order. Not verbal interest.
- **If 3+ of 10 convert:** the model works; execute.
- **If 1–2 convert:** the price is right and the ICP is wrong. Re-target, do not rebuild.
- **If 0 convert:** the pricing was never the problem. Move to the incident-and-quality
  buyer inside engineering, or stop.
- **Date:** set one. Thirty-four days from first outreach is the right order of
  magnitude for a product that already exists.

---

## 9. The next ninety days

1. **Change the meter** to agents plus retention, per §4. Fix the pricing page's
   decision-allowance claim, which the code does not support.
2. **Name ten accounts** from the DSA provider list.
3. **Run the demand test.** Lead with Article 20(6) and the judge-calibration pitch.
4. **Then unblock revenue:** Stripe on, business verification path, meter wired.
5. **Ship the standalone verifier and the CI gate** — the two items that compound.

Verify before anything becomes customer-facing copy: the consolidated Article 113 text
on the deferral, and Article 5(2)–(3) of Regulation 537/2014, neither of which could be
retrieved from primary sources during research.

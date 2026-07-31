# RateLoop tokenless — implementation plan

Written 30–31 July 2026 against `cc663375b`, from five parallel research and design
passes. Executes [business-plan.md](business-plan.md) and
[product-opportunities.md](product-opportunities.md). Engineering defects live in
[remediation-plan.md](remediation-plan.md) and are not repeated here.

Effort is days for one experienced engineer. Confidence is stated where it is low.

---

## Decisions, now made

All four were answered on 31 July 2026. Recorded here because the rest of the plan
re-sorts around them.

**1. Objective: acquisition.** "I will start reaching out to chase an acquisition and
business once everything actually works and I feel comfortable with it."

This changes what to build. Revenue mechanics stop being the critical path — there is no
point optimising a self-serve ladder for a founder who will not run one — and the
**technical artefact, the standards position and a working demonstration** become the
proof. Phase 0 stays, because a product that cannot take money reads as unfinished in
diligence, but it drops behind the things that make the product legible to an acquirer.

**2. Stripe: test mode.** Confirmed. No `sk_live_` anywhere, nothing touches `main`, and
the production-readiness gate that forbids live keys off `main` is left alone.

**3. Deployment: test via `rateloop-tokenless.vercel.app`, full redeploy at the end.**

One caveat that has to be said plainly: **the current deployment is 80+ commits stale**,
and `/docs/evidence/verify` returns 404 there. Testing against it today tests a product
that no longer exists in the repository. A redeploy is needed **before** testing begins,
not only after implementation ends — otherwise every test result is about the wrong
build. Treat that as step zero.

**4. Judge calibration leads.** Following the research rather than the earlier draft.
Phase 2 is therefore the product phase, not a follow-on.

---

## What "acquisition" changes about the order

The acquirer set is narrow and technical: a qualified trust service provider, a
compliance platform, an evaluation vendor, or an observability company consolidating the
category. None of them buys a €149 self-serve ladder. What they diligence is whether the
thing works, whether it is legible, and whether it is defensible.

So the reordering is:

- **Up:** the standards position (Phase 3), because authoring the vocabulary others
  implement is the cheapest durable asset and the window is measured in months; the
  evaluation statistics (Phase 2), because they are the technical claim; and the demo
  workspace, because a thing that cannot be shown cannot be sold.
- **Down, but not out:** the pricing ladder, the four-tier repricing, the marketplace,
  the EU procurement artefacts. Keep Phase 0 — being unable to take money at all is a
  diligence flag — but stop treating the ladder as the goal.
- **Unchanged:** every honesty fix. A claim that does not survive diligence is worse in
  an acquisition than in a sale, because the acquirer's technical reviewer will read the
  code.

---

## Phase 0 — Three days to a workspace that can pay

The critical path is three days, not six items.

| #   | Task                                                             | Days |
| --- | ---------------------------------------------------------------- | ---- |
| 0.1 | Remove the business-verification gate from subscription checkout | 0.5  |
| 0.2 | Fix the Stripe return path and configure the test account        | 2    |
| 0.3 | Fix the pricing page's decision-allowance claim                  | 0.5  |

**0.1 — and the legal reasoning matters.** The gate at `workspaceBilling.ts:454`
implements DSA Article 30 trader traceability, which governs _traders concluding
distance contracts with consumers on the platform_ — the reviewer side. Applying it to
RateLoop's own subscription customer is a category error, and the micro-enterprise
carve-out removes it anyway below 50 staff. **Keep it exactly where money moves to third
parties**: prepaid top-ups and paid panels. **Correction to an earlier draft:** it is **one** test with **four** assertions, not two
tests — and it pins a fourth gate the plan never mentioned, in `entitlements.ts:218`
inside `assertPaidPanelsAllowed`. Removing the checkout gate means editing the consumer
list and one assertion while deliberately leaving the top-up and paid-panel assertions
intact. That is the "keep it where money moves to third parties" invariant, expressed as
a test.

**0.2 — the return-path fix is one line, and the bug is worse than it looked.**
`stripe.ts:356` returns customers to `/agents/overview`. An `/agents/billing` tab now
exists and the pricing page **already links to it** — so Stripe and the pricing page
currently disagree about where billing lives. Change the one line.

Why it matters more than "the UI does not render": `WorkspaceSettingsClient.tsx:426`
**deletes the `billing` param from the URL**, so the success signal is destroyed rather
than merely unshown, and the post-checkout entitlement refresh never fires.

Five things are not in the repo and must be configured: an active USD monthly
price at exactly 2900 (validated against `plans.ts`), a **saved Customer Portal default
configuration**, Stripe Tax with an origin address, a webhook subscribed to **12 events**,
and — the likeliest silent failure — the webhook endpoint pinned to API version
**`2026-06-24.dahlia`**. Note **no `apiVersion` is set** in the Stripe constructor, so
the version is decided by the dashboard endpoint configuration alone, and that string
appears nowhere in the repository. The 12 events are a union of two sets: eight handled
plus **four reversal events** — missing those four means refunds and disputes never debit
the prepaid balance. On an older version `invoice.parent.subscription_details` is
undefined, so subscriptions never project and entitlement resolution falls back to Free.
Also fix `stripe.ts:354`, which returns customers to `/agents/overview` where the billing
UI does not render.

**0.3 — and localization changed this from a one-file edit into a four-file one with a
silent failure mode.** All public copy moved into English-string-as-key message
catalogs. The decision-allowance claim now lives in **four** places: the pricing page,
the terms page (differently worded — "included review-decision allowance"), and both the
English **and German** catalogs, where it is already translated.

**Editing the page component alone breaks no test, and German keeps serving the
uncorrected claim.** For a task whose whole purpose is not making a paid-for
misrepresentation, shipping the fix in one language is the worst available outcome. A
test does assert that English and German key sets match, so editing one catalog fails
loudly — but editing only the `.tsx` does not.

**Also required before the first top-up or paid panel** (3 days, not on the critical
path): an operator route for business verification, mirroring the existing compliance
operator pattern. And 1 day for the missing UI handling — `verificationStatus` is
returned by the profile API and rendered nowhere, so today the customer sees a generic
failure on click rather than a disabled button with a reason.

---

## Phase 1 — One day that makes the numbers honest

**1.1 — The sampling disclosure. Half a day to one day. Do this before anything else
ships.**

Every published rate is an unweighted count over a sample that is not representative:
forced strata union the deterministic draw, and the sampling rate is _lowered because_
past agreement passed a threshold — selection on the dependent variable. A
statistically literate buyer notices in one meeting.

One sentence next to the endorsement figure — _measured on reviewed outputs; review
selection is not uniform, so this is not the rate across all outputs_ — plus a `basis`
field on the API so machine consumers see it too.

**And the finding underneath it: `PUBLIC_EVIDENCE_CLAIMS_MATRIX` has no rule covering
endorsement or agreement-rate claims at all.** Unqualified "97% endorsed" copy passes
the build-time gate today. Adding that rule makes the honesty CI-enforced rather than
remembered, which is worth more than the sentence.

**But the gate has a coverage hole that must be closed in the same change.** Its file
walker takes only `.md` and `.tsx`, so **the message catalogs are never scanned**.
Adding an endorsement rule without extending the walker to `.json` over `messages/`
produces a green build that certifies English and ignores German — **worse than no gate,
because it creates false confidence.** Extend the walker first, or in the same commit.

---

## Phase 2 — Make the evaluation claim true, and lead with it

The research changed the order here. The business plan says judge calibration is "the
natural next claim — do not sell it first." **The evidence says it is the only claim
that gets stronger as models improve**, and it should lead.

A statistics review rewrote this phase. An earlier draft named the **Rogan–Gladen**
estimator and "~200 human-labelled examples". **Both are wrong, and the first is wrong by
multiples.**

**Why Rogan–Gladen fails here.** It assumes a calibration set stratified by the _human_
label. This design stratifies by the _judge's_ output — necessarily, because the human
label is the thing being bought and cannot be a design variable. Simulated on the plan's
own design, plugging judge-stratified estimates into Rogan–Gladen returned an endorsement
rate of **4.53 against a truth of 0.85**, because sampling `fail` harder collapses the
apparent sensitivity and the correction divides by a near-zero denominator. It does not
fail gracefully; it fails confidently.

**The correct estimator is Begg–Greenes, and task 2.3 already contains it.** This is
textbook partial-verification bias — the reference standard applied only to a subset,
with referral depending on the index test. Under sampling stratified by judge label with
known probabilities, the sampled items within each stratum are a simple random sample of
it. So **PPV and NPV are directly estimable with no correction at all**, the population
endorsement rate is the stratum-weighted combination, and sensitivity and specificity
come back by Bayes from those and the known stratum sizes. That last step _is_
Begg–Greenes, and it is algebraically identical to the Horvitz–Thompson weighting the
plan had filed under 2.3 as a secondary concern.

**So 2.3 is promoted to the primary estimator and 2.2 becomes the corrected
sensitivity/specificity built on it.** Rogan–Gladen is dropped; applied to corrected
inputs it returns the identical answer, so it is redundant rather than additive.

**Allocation, and the result contradicts the obvious instinct.** Given a fixed budget,
the three estimands want opposite splits. Endorsement wants roughly 71% of labels on the
`pass` stratum. Sensitivity wants more `fail`. **Specificity also wants more `pass`** —
because the scarce quantity is the rejections hiding _inside_ the pass stratum, not the
rare `fail` class. "Sample `fail` harder because it is rarer" is wrong for the
false-alarm rate, which is the number buyers care about most. Pick one primary estimand,
allocate for it, and report the others with their honest, wider intervals.

**Replacement sample sizes**, at Neyman allocation and stated assumptions:

| Target                    | Human labels         |
| ------------------------- | -------------------- |
| Endorsement rate to ±0.10 | ~20                  |
| Endorsement rate to ±0.05 | **~79**              |
| Endorsement rate to ±0.02 | ~495                 |
| Specificity to ±0.10      | not reached at n=800 |

**This is what the SKU must respect.** "±5 points at 95% confidence" is achievable at
roughly eighty labels **for the endorsement rate only**. It is not achievable for
specificity at any budget that will sell. One price card must not imply both.

**Intervals: Korn–Graubard.** Replace n with the effective sample size and apply
Clopper–Pearson in its incomplete-beta form, which is defined for the non-integer
arguments weighting produces. It is the default in standard survey packages, so a buyer
can check it. For the ratio quantities use a stratified bootstrap resampling `pass`,
`fail` and `uncertain` independently.

**The largest unaddressed threat, and it must be stated as a first-class limitation:
there is no gold standard.** Every one of these corrections assumes a perfect reference,
and the reference here is a two-person panel with measured disagreement — whose errors
are _correlated_ with the judge's, since a fluent-but-wrong output fools an LLM judge and
a hurried reviewer through the same mechanism. **Say "disagreement with a human panel",
never "error rate".**

| #   | Task                                                       | Days  | Confidence |
| --- | ---------------------------------------------------------- | ----- | ---------- |
| 2.1 | Version comparison — remove the current-version binding    | 4–5   | High       |
| 2.2 | Human labels outside the uncertain band + confusion matrix | 7–8   | Medium     |
| 2.3 | Horvitz–Thompson weighted estimator alongside the raw rate | 3.5–4 | Medium     |
| 2.4 | CI command that blocks on a human decision                 | 3–3.5 | High       |

**2.1 is bigger than 4–5 days.** It is a read path with no migration, but the
current-version rule is re-derived **four** times, not two — twice in SQL
(`agentOverview.ts:534`, `agentReviewQuality.ts:365`) and twice in JavaScript in
`agentRegistry.ts`, which `agentOverview.ts` also consumes. So that one module holds two
independent notions of "current version" that are only incidentally consistent.

Worse, the two SQL forms are **not equivalent**: one uses `DISTINCT ON` with a tie-break
returning a single row, the other a strict anti-join returning _all_ rows tied at the
maximum version. Extract to one module and bind all four with a test, per the
repository's own cross-module rule. Expect two source-text assertions to break. Use a
Newcombe hybrid-score interval for the difference, not a subtraction of point estimates.
Where two versions have different execution-profile hashes the comparison is
**legitimately non-comparable** and must be labelled, not computed.

**2.2 is the one with real risk.** Thirteen invariants currently forbid it, including
two database CHECK constraints and an append-only trigger, so it needs a migration —
**`0165`, not `0164`, which was taken by the localization work.** The journal steps by
exactly 3,600,000, so the next entry is idx 165 at `when: 1785243600000`. The full
surface to touch, including SDK literal-type mirrors and about nine test assertions, is
closer to thirty edits than thirteen.
The hidden cost is not the matrix — it is that audit-sampled reviews would feed the
adaptive coverage window and make the selection bias in 2.3 _worse_. **Exclude them**;
that is roughly a day plus test churn and it is the honest choice.

Conventions that must be fixed before anyone reads a number: `uncertain` reported
separately, never folded in silently; weight by the recorded inclusion probability;
report class prevalence adjacently, because **predictive values move with the base rate
and do not transfer** between workflows or periods while sensitivity and specificity are
comparatively portable; report Youden's J with an interval and refuse to publish a
corrected figure below a threshold, since J is the correction's denominator; and if any
stratum has probability zero the estimator is undefined — return a coverage gap, not a
number. Do **not** reuse the Wilson helper, which rejects the non-integer counts
weighting produces.

**Three things the earlier draft treated as edge cases and are not:**

- **The coverage gap is the common case, not the exception.** `manual` mode hardcodes an
  inclusion probability of zero and `rules` mode records zero or one. For those scopes
  the honest output is _always_ a coverage gap and never a number — they are not
  probability samples at all. Budget for that in the UI and in the sales story before
  2.2 starts, and verify the population denominator is recoverable for unsampled units.
- **The recorded probability is ex-post, and one forcing reason is data-dependent.** The
  `maximum_gap` trigger depends on the outcomes of prior draws, so the inclusion
  probability is a random variable correlated with the data. The point estimate survives
  by the sequential-design argument; **the closed-form stratified variance does not.**
  Use a block bootstrap over coverage windows.
- **Excluding audit reviews from the coverage ladder leaves the ladder blind to what the
  audit finds.** After exclusion, the agreement figure driving promotion is computed only
  over the escalated `uncertain` band — the least representative band there is — so it
  will visibly diverge from the published rate and a customer will ask why. Worse, an
  audit could show the judge systematically wrong on `pass` while the scope sits happily
  at 10% coverage. **Make the audit a one-way ratchet:** it may force a reset to
  calibrating, never a promotion. That is a deterministic function of observed data, so
  it costs nothing statistically and closes a real safety hole. Give the two agreement
  numbers distinct names in the schema and the UI.

**2.3** weights anything estimating a property of the output population — endorsement,
agreement, dissent — and leaves alone anything describing what happened inside a panel.
Two guards are mandatory: forced strata have probability 1 by construction, so report
the forced share and do not present the result as an unbiased population estimate; and
report the comparable share, since weighting corrects selection but not dropout.

**Do not make the weighted estimate the coverage-gating input.** That changes when
review drops from 100% to 50%, which is a customer-visible safety property and a
design-of-record reopening.

**2.4** — a blocking command already exists (`wait --until-ready`, 300s default); what is
missing is distinct exit states, since every error path currently returns 1. Exit codes
0 pass, 1 fail, 2 timeout, 3 transport. Add a `Retry-After` header
to the receipt route so backoff is server-driven; poll client-side rather than building
a second long-poll implementation.

---

### The sentences that may and may not ship

Write these into the claim gate as Phase 1's rule, not into marketing copy afterwards.

**Defensible:**

- "Of the outputs your evaluator marked pass, a human panel disagreed with 3.6%
  (95% CI 2.1–5.8%), on a probability sample of 400 drawn at a recorded rate of 1%."
- "Weighted by recorded inclusion probability, the endorsement rate across all outputs in
  this window is 85.7% (95% CI 83.4–87.9%). The unweighted rate over reviewed outputs is
  79.1%."
- "Measured at an endorsement prevalence of 85%. Predictive values move with prevalence
  and do not transfer to another workflow or period."
- "This is agreement with a human panel of stated composition. It is not a measure of
  correctness."
- "For this scope the sample has strata with zero selection probability. No population
  estimate is available."

**Not defensible — do not ship:**

- "Your evaluator's false-positive rate is X." There is no gold standard.
- "±5 points at 95% for ~200 labels." Wrong number, wrong design, and true only of the
  endorsement rate.
- Any figure corrected by an estimator fed with sensitivity and specificity taken
  directly off the judge-stratified sample.
- "Calibrated judge" or "calibration curve" in the probability-calibration sense. This is
  bias correction on a hard-label classifier — a different thing, and easy to expose.
- Any alpha without an interval, or alpha described as inter-rater reliability when it is
  computed on two-rater cases after non-random dropout.

**The sentence that should lead the product story:**

> Every published rate is a probability sample with recorded selection probabilities,
> corrected for the fact that we review some outputs more than others, reported with the
> design-based interval and the sample it came from — and where the design does not
> support an estimate, we return a coverage gap instead of a number.

True today of essentially no evaluation vendor, checkable, and it survives models getting
better.

**One unrelated defect found while verifying this:** the adaptive safety-gate
availability flag is a hardcoded `true`, so the `safety_gates_unavailable` reset can
never fire. That belongs in the remediation plan.

---

## Phase 3 — The standards window, which is open now and closing

**This is the cheapest defensibility available anywhere in either document, and it is
time-critical in a way nothing else here is.**

It matters more after the competitor survey, not less. The differentiator is not any
single statistic — Langfuse computes kappa, LangSmith runs blind panels, Galileo ships an
agreement chart — it is **the join**, and a vocabulary that can express the join is
exactly what these standards lack. Getting `evaluator.panel`, `agreement.alpha` and a
confidence bound into the schema makes the joined thing nameable by everyone, including
by buyers comparing vendors.

The business plan lists standards participation as slow and unpaid via CEN-CENELEC
JTC 21. That is true of JTC 21 and false of these. The vocabulary for "a human graded
this AI output" is being written **this month**, and every one of this product's
differentiators is missing from it.

| #   | Task                                                                   | Days | Why now                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Comment on OpenTelemetry issue #43 with a confidence-interval proposal | 1    | Open since August 2025 with **zero comments**. The product already computes Wilson bounds.                                                                                                                                                                                            |
| 3.2 | Propose multi-rater attributes on OTel PR #359                         | 1    | Updated 30 July 2026 — actively iterating. It standardises `evaluator.type = human` explicitly to compare LLM against human accuracy, and has no panel, agreement or sampling concept.                                                                                                |
| 3.3 | File an in-toto human-review predicate against issue #77               | 3–5  | Open since **December 2021**, unfilled. Meanwhile `eval-result`, `agent-decision` and `source-review-coverage` predicates are being filed right now, on a composition-by-digest pattern that leaves the reviewer slot open. `eval-result` is _explicitly_ scoped out of human review. |

Concretely: propose `score.ci_lower` / `ci_upper` / `ci_method` / `sample_size` on #43;
`evaluator.panel.id`, `evaluator.count` and `agreement.alpha` on #359; and a predicate
referencing `eval-result` statements by digest for #77. RateLoop is already the
reference implementation for all of it.

Days of work to put chance-corrected agreement, confidence bounds and inclusion
probability into two standards other people will implement. The window is months.

---

## Phase 4 — Capability the product does not have

Built from what the code already makes cheap. Nothing here requires inference — the
constraint that keeps RateLoop outside Annex III(4)(b) holds throughout.

| #    | Capability                                  | Days | Why it matters                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | **Demo workspace with synthetic data**      | 2–3  | RateLoop has the worst cold start in its category: every competitor shows a number after an API key, this shows nothing until you have recruited humans and waited. The quality projection is a pure function — a demo is a fixture and a route.                                                                                                          |
| 4.2  | **Failure taxonomy**                        | 3–5  | Schema, rubric validation and evidence-packet hashing all exist; the live lane hardcodes an empty tag list. Turns "84% endorsed" into "of rejections, 61% unsupported claim, 22% wrong tone" — the first output an engineer can act on.                                                                                                                   |
| 4.3  | **Human-judged model comparison**           | 2–3  | Model identity already flows from OTLP and is loaded in the same query batch as the agreement column. Nothing joins them. "Claude is endorsed 91% on your refund workflow, GPT-5.2 is 89% at 2.3× the cost" is a join. Needs 2.1 first.                                                                                                                   |
| 4.4  | **Sample-size planner**                     | 1    | Invert the Wilson helper: "to claim ≥95% endorsement with a 95% lower bound at 90%, you need N reviews — at your volume, X days and €Y." Converts the pricing conversation from cost to _what a defensible claim costs_.                                                                                                                                  |
| 4.5  | **Override analytics**                      | 2    | The deployer's own go/revise/stop and accepted/overridden decisions are already recorded and never aggregated. This is the rubber-stamping question — the only metric that answers whether oversight was _meaningful_, and the exact thing the Amsterdam Uber judgment turned on. **No evaluation vendor has the deployer's decision in its data model.** |
| 4.6  | **`npx rateloop score traces.jsonl`**       | 5    | Score a file of past outputs with no instrumentation at all. Inverts the adoption order. The CLI, file input and single-delivery projection all exist.                                                                                                                                                                                                    |
| 4.7  | **Reviewer calibration onboarding**         | 5    | Five gold items with feedback before a reviewer's first live case, recorded as a dated qualification. Good annotation practice _and_ the literal text of Article 26(2) "training". Scoring and thresholds are written; there is no UI.                                                                                                                    |
| 4.8  | **Senior-reviewer escalation**              | 5    | Route high-dissent cases to a named adjudicator recorded as a separate tier, so panel agreement stays intact. **The trigger must stay a deterministic count** — "escalate when the model thinks it's risky" is inference in routing and crosses the line.                                                                                                 |
| 4.9  | **Public quality page**                     | 5    | A stable, indexable, aggregate-only page verifiable in-browser. A customer linking to it markets RateLoop for free. **Needs a real minimum-cell rule written fresh** — `minimumAggregationSize` equals `panelSize` on the live lane, so what looks like k-anonymity is a panel-completeness filter.                                                       |
| 4.10 | **Licence freshness, not credential proof** | 5–8  | "In good standing _at the moment of this review_", bound into the evidence. Free authoritative sources exist: Nursys e-Notify pushes real-time status and discipline changes, the FCA register has a free REST API, GMC offers daily deltas. Almost every competitor verifies once at onboarding and never rechecks.                                      |

**Before any of Phase 4 ships, two things must be fixed or stopped being claimed.** The
live lane hardcodes its blinding flag to false and stores reviewers as customer-invited
and customer-named, so neither blinding nor independence is real there. And the coverage
export is unsigned and gate-blocked from public copy. Both are cheap to fix and neither
is fixed by building more.

**On 4.10 — drop "cryptographically verified credentials" from the pitch.** No regulator
asks for it; DSA, AI Act, MDR and FDA all accept a CV and a training record. Centaur.ai,
with 100,000+ clinical contributors, sells measured accuracy rather than credentials.
Freshness is the real and unusual claim.

**Reviewer scorecards (4.7's natural extension) need legal review first.** Per-reviewer
performance measurement is works-council co-determination territory in Germany under
§87(1)(6) BetrVG, and if a customer uses it to allocate or end work it becomes _their_
Annex III(4)(a)/(b) problem. Ship as owner-visible analytics with an explicit
not-for-employment-decisions boundary.

---

## Phase 5 — Reachability and procurement

| #   | Task                                          | Days            | Note                                                                                                                                                                                                                           |
| --- | --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 | Standalone open-source verifier package       | 4               | **No async refactor needed** — the core has zero `node:` imports and already uses `globalThis.crypto.subtle`, with a test enforcing it. There is no duplication either; the browser page already delegates to the same module. |
| 5.2 | Republish the stale npm packages              | 0.5             | npm has `0.1.0` pre-tokenless snapshots. Anyone installing today gets a different product. **Irreversible public action — needs explicit approval.**                                                                           |
| 5.3 | Flip the capability flags that genuinely ship | 1 (+1 redeploy) | Defensible after a redeploy: OTLP ingest, the offline verifier, published key history. Must stay false: the hybrid lane (hard-false in code), Rekor and RFC 3161 (procurement), Vanta delivery (open defect).                  |
| 5.4 | Suites, cases and gold on the live lane       | 12–14           | Highest variance in the plan — the library layer is ~6 days and predictable, the UI is not.                                                                                                                                    |
| 5.5 | Content-free assurance mode                   | 5               | Ship the version _without_ a human panel. Content-free _with_ review needs bring-your-own-content, a new CSP posture and a new integrity story — 10 days, scope separately.                                                    |
| 5.6 | MCC-AI annex pack, CSA STAR self-assessment   | 3               | Drafting, no engineering.                                                                                                                                                                                                      |
| 5.7 | Qualified timestamps from a QTSP              | —               | Procurement. Roughly €0.50–2.50 per token, and an advanced seal is ~€50/year, qualified ~€200. **Timestamp the packet, not every decision** — otherwise it is per-unit cost of goods on the thing being sold.                  |

**5.1 has a defect to decide before publishing.** Canonical key ordering uses
`localeCompare`, which is locale- and ICU-sensitive: an `en-US` browser and a `LANG=C`
server can produce different digests for the same packet. An open-source verifier cannot
ship that. Fixing it to code-unit ordering changes digests for affected packets, so it
needs a schema version bump and a re-derived golden vector. **Surface it as a decision,
not a silent change.**

---

## What not to build, with reasons

**An insurer channel.** Verisk filed three generative-AI exclusions effective 1 January
2026 with **no carve-backs** — there is no "unless a human reviewed it" exception
anywhere, and further agentic-AI exclusions are being weighed. No policy wording makes
human oversight a condition, warranty or rated factor. Armilla and AIUC-1 have
vertically integrated the assessment slot. **The one exception: sell to the insured.**
Vendors facing Munich Re's technical due diligence must produce documented test
methodology, labelled ground truth and evidence of annotation stability — an acute,
dated, budgeted need for exactly this artefact.

**Selling to audit firms.** They buy engagement workflow, not substantive-testing
tooling, and the prevailing doctrine explicitly excludes AI outputs from assurance
scope. Design for the auditor as _reader_ instead, and target acceptance as third-party
evidence under AIUC-1 — whose published conflict-of-interest problem (it authors the
framework, runs the evaluations, issues the certificates **and** sells the insurance
they enable) is precisely the space a neutral evidence vendor occupies.

**A bias-audit vertical.** New York's Local Law 144 enforcement was found ineffective in
a December 2025 state audit: **32 disclosures in total.**

**Litigation and e-discovery.** In June 2026 a federal court **denied** motions to
compel human-validation protocols for AI-assisted review. And the only case where human
review evidence was dispositive turned on an ordinary documented interview — the bar
adjudicators apply is "sufficiently plausible", not cryptographically proven.

**An MCP "get a human to sign off" tool.** Nearly free given two MCP servers and nine
hosts, which is why it is tempting. It is also HumanLayer's exact product; they pivoted
away at ~$660k revenue growing 100% month over month while OpenAI shipped native
approve-and-resume.

**Cross-customer benchmarks before roughly twenty customers.** At zero it is a slide,
and building it early burns the deliberate honesty that data network effects are
architecturally foreclosed.

---

## Sequence

Re-ordered for the acquisition objective. Revenue mechanics move down; the artefact,
the statistics and the standards position move up.

| Order | Work                                            | Days  | Note                                       |
| ----- | ----------------------------------------------- | ----- | ------------------------------------------ |
| **0** | **Redeploy HEAD** — before the first test pass  | —     | Phases 1 and 3 not demonstrable until then |
| 1     | Phase 1 — sampling disclosure + claim-gate rule | 1     | Cheapest honesty win; do it first          |
| 2     | Phase 3 — standards comments (3.1, 3.2)         | 2     | **Time-critical.** Window is months        |
| 3     | 4.1 — demo workspace with synthetic data        | 2–3   | Nothing can be shown without it            |
| 4     | 2.1 — version comparison                        | 4–5   | Unblocks 4.3                               |
| 5     | 4.3, 4.5 — model comparison, override analytics | 4–5   | Both are SQL joins over existing data      |
| 6     | 4.2 — failure taxonomy                          | 3–5   | Turns a number into an action              |
| 7     | 2.2, 2.3 — judge calibration and weighting      | 11–12 | The lead technical claim                   |
| 8     | 3.3 — in-toto human-review predicate            | 3–5   | The durable asset                          |
| 9     | Phase 0 — revenue mechanics, test mode          | 3     | Diligence hygiene, not the goal            |
| 10    | 5.1, 5.3 — verifier package, flag flips         | 6     | Needs the redeploy at step 0               |
| 11    | 2.4, 4.6 — CI gate, trace scoring               | 8–9   | Switching cost, adoption                   |
| 12    | Everything else                                 | —     | Appetite                                   |

Three tracks parallelise: the read path (2.1, 2.3, 4.3) must be serialised because it
touches the same SQL; the evaluator lane (2.2, 2.4) is independent; the authoring
surface (5.4) touches nothing the others do.

### Ordering hazards, found by verification

- **2.2 before 2.3, never in parallel.** Audit-sampled reviews must be excluded from the
  adaptive coverage window _before_ the weighted estimator reads it. Ship 2.3 first and
  it computes weights over a population 2.2 then changes underneath it.
- **The claims-gate walker extension must land with or before the endorsement rule** —
  see Phase 1.
- **One migration in flight at a time.** The journal is a merge-conflict magnet, and
  whoever writes first takes `0165`.
- **0.3 and 1.1 both edit the same message catalogs.** Serialise them; they are half a
  day each and adjacent anyway.
- **0.1 first among billing work.** One test asserts four gates across four files, so two
  streams touching checkout and top-ups collide in a single test body.
- **2.1's extraction breaks two source-text assertions.** Do not land it concurrently
  with 2.3, or you cannot tell which change broke which.

**Roughly 40 days gets to a demonstrable, honest, standards-positioned product with a
working payment path.** For an acquisition conversation that is the deliverable — not
the pricing ladder.

---

## Pricing, which the research says is the wrong archetype

The €149/€599/€2,499 ladder prices _access_. Every comparable that sells a **measurement**
prices the measurement — credit scores per score plus a fee when the score is used in a
consequential decision, sustainability ratings on both sides of one assessment, ad
verification per thousand impressions measured, market research per complete priced by
how hard the respondent is to find.

A three-part structure fits the cost curve better:

- **A platform subscription** for continuity, retention and the archive. Keep the tiers.
- **A per-adjudicated-item price varying with reviewer scarcity** — general,
  domain-qualified, licensed professional. This mirrors the real cost curve (roughly
  $0.50–3 per general preference pair against $5–20 for expert domains), explains itself
  without a margin argument, and removes the plan's own objection that the only metered
  thing is the only one that shrinks.
- **A per-report fee for the signed, dated artefact** — the thing an auditor or
  underwriter actually consumes.

And the SKU the research most strongly supports: **"±5 points at 95% confidence on the
endorsement rate for your use case"** rather than "1,000 reviews". Roughly **eighty**
human-labelled items buys that. Specificity does not reach ±10 points even at eight
hundred labels, so the SKU must name **which** number it bounds — one price card cannot
imply both. That is a price card a statistically literate buyer can check,
which is an unusual thing to be able to offer.

**One correction the pricing table needs regardless:** the Free tier at 30-day retention
is not implementable. There is a six-month floor in code _and_ a database CHECK
constraint. Free should be 12 months.

---

## One finding that should shape the pitch

Financial-services research produced the strongest regulatory citation of the whole
session, and it is not about AI at all. **FINRA Rule 3110.07** mandates that evidence of
review identify the reviewer, the item, the date and the actions taken — and says
**"merely opening a communication is not sufficient review."** That is a binding rule
with a named record schema matching what this product emits.

It comes with a caution of equal weight. **No US or UK regulator prescribes a sampling
percentage** — FINRA says so explicitly, the FCA has published nothing. There is no
regulatory volume driver for human review anywhere. Sell the defensibility of a chosen
methodology; never sell compliance with a rate that does not exist.

---

## Verify before any of this becomes customer-facing

- The Official Journal citation for the Digital Omnibus deferral. Three sources agree
  Annex III moved to 2 December 2027, but one still describes adoption as expected.
- Colorado's AI Act effective date — two research passes ran out of budget before
  confirming it.
- Whether the tokenless Vercel project has Stripe or evidence-signing environment
  variables set. Not knowable from the repository.

# RateLoop tokenless — implementation plan

Written 30–31 July 2026 against `cc663375b`, from five parallel research and design
passes. Executes [business-plan.md](business-plan.md) and
[product-opportunities.md](product-opportunities.md). Engineering defects live in
[remediation-plan.md](remediation-plan.md) and are not repeated here.

Effort is days for one experienced engineer. Confidence is stated where it is low.

---

## Decisions that gate everything

Four, and none is an engineering question.

**1. What is this for?** Business-plan §0. Replace a salary, chase an acquisition, or
stop. Break-even is five Business customers. Every phase below re-sorts around the
answer.

**2. Test mode or real money?** `check-tokenless-production-readiness.mjs:605` rejects
any `sk_live_` key on a non-`main` deployment, and `:753` requires one when
subscriptions are enabled on `main`. **Live Stripe is therefore only reachable on
`main`**, which the branch rules forbid touching without separate confirmation. Phase 0
assumes Stripe **test mode** on `rateloop-tokenless`. Real revenue needs an explicit
decision.

**3. Redeploy tokenless.** The live deployment is **80+ commits stale** —
`/docs/evidence/verify` returns 404 there. Nothing in Phase 3 can honestly ship until
HEAD is deployed.

**4. Does judge calibration lead?** The plan currently defers it. The research says it
should lead, and phases 2 and 3 assume it does. See §Phase 2.

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
parties**: prepaid top-ups and paid panels. Two source-scanning tests pin the current
call and must be rewritten to assert the new invariant.

**0.2.** Five things are not in the repo and must be configured: an active USD monthly
price at exactly 2900 (validated against `plans.ts`), a **saved Customer Portal default
configuration**, Stripe Tax with an origin address, a webhook subscribed to **12 events**,
and — the likeliest silent failure — the webhook endpoint pinned to API version
**`2026-06-24.dahlia`**. On an older version `invoice.parent.subscription_details` is
undefined, so subscriptions never project and entitlement resolution falls back to Free.
Also fix `stripe.ts:354`, which returns customers to `/agents/overview` where the billing
UI does not render.

**0.3.** The pricing page states reviews "use the decision allowance included in your
plan". Nothing meters that. Taking money first makes it a paid-for representation.

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

---

## Phase 2 — Make the evaluation claim true, and lead with it

The research changed the order here. The business plan says judge calibration is "the
natural next claim — do not sell it first." **The evidence says it is the only claim
that gets stronger as models improve**, and it should lead.

The 2026 methodology literature converged on bias-correcting a cheap judge against a
human-labelled calibration set: the Rogan–Gladen estimator, **~200 human-labelled
examples for a 95% interval narrower than 0.10**, with naive estimators showing
near-zero coverage. Meanwhile chance-corrected judge agreement sits near κ≈0.48 where
raw agreement reads 85%, and expert annotation prices are _rising_ while commodity
prices fall. Better judges make a small, statistically valid human sample more valuable,
not less — because the population estimate now depends on it.

| #   | Task                                                       | Days  | Confidence |
| --- | ---------------------------------------------------------- | ----- | ---------- |
| 2.1 | Version comparison — remove the current-version binding    | 4–5   | High       |
| 2.2 | Human labels outside the uncertain band + confusion matrix | 7–8   | Medium     |
| 2.3 | Horvitz–Thompson weighted estimator alongside the raw rate | 3.5–4 | Medium     |
| 2.4 | CI command that blocks on a human decision                 | 3–3.5 | High       |

**2.1** is a read path only — no migration. The current-version rule is re-derived in
two places (`agentOverview.ts:534`, `agentReviewQuality.ts:365`); extract it to one
module and bind both with a test, per the repository's own cross-module rule. Use a
Newcombe hybrid-score interval for the difference, not a subtraction of point estimates.
Where two versions have different execution-profile hashes the comparison is
**legitimately non-comparable** and must be labelled, not computed.

**2.2 is the one with real risk.** Thirteen invariants currently forbid it, including
two database CHECK constraints and an append-only trigger, so it needs migration `0164`.
The hidden cost is not the matrix — it is that audit-sampled reviews would feed the
adaptive coverage window and make the selection bias in 2.3 _worse_. **Exclude them**;
that is roughly a day plus test churn and it is the honest choice.

Conventions that must be fixed before anyone reads a number: alarm = automated `fail`,
ground truth = human `negative`; `uncertain` reported separately, never folded in
silently; weight by the recorded inclusion probability; and if any stratum has
probability zero the estimator is undefined — return a coverage gap, not a number. Do
**not** reuse the Wilson helper, which rejects the non-integer counts weighting produces.

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

| Order | Phase                                                 | Days  | Gate                            |
| ----- | ----------------------------------------------------- | ----- | ------------------------------- |
| 1     | Phase 0 — revenue mechanics                           | 3     | Decision 2                      |
| 2     | Phase 1 — sampling disclosure + claim gate            | 1     | —                               |
| 3     | Phase 3 — standards comments (3.1, 3.2)               | 2     | **Time-critical, do not defer** |
| 4     | 4.1, 4.4, 4.5 — demo, planner, override analytics     | 5–6   | —                               |
| 5     | 2.1 → 4.3 — version comparison, then model comparison | 7–8   | —                               |
| 6     | 4.2 — failure taxonomy                                | 3–5   | —                               |
| 7     | 5.1, 5.3 — verifier package, flag flips               | 6     | Decision 3                      |
| 8     | 2.2, 2.3 — judge calibration and weighting            | 11–12 | —                               |
| 9     | 3.3 — in-toto predicate                               | 3–5   | —                               |
| 10    | 2.4, 4.6 — CI gate, trace scoring                     | 8–9   | —                               |
| 11    | Everything else                                       | —     | Appetite                        |

Three tracks run in parallel: the read path (2.1, 2.3, 4.3) must be serialised because
it touches the same SQL; the evaluator lane (2.2, 2.4) is independent; the authoring
surface (5.4) touches nothing the others do.

**Roughly 30 days gets to revenue, honest numbers, a demo, model comparison and a
standards position.** The rest is appetite.

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

And the SKU the research most strongly supports: **"±5 points at 95% confidence for your
use case"** rather than "1,000 reviews". Roughly 200 human-labelled items per use case
is the published anchor. That is a price card a statistically literate buyer can check,
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

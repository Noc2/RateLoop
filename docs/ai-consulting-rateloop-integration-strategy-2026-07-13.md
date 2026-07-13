# AI Consulting + RateLoop: Product and Go-to-Market Strategy

**Date:** 13 July 2026

**Status:** Companion recommendation to the tokenless [implementation plan](tokenless-immutable-implementation-plan-2026-07.md), [product-market-fit research](tokenless-product-market-fit-research-2026-07-13.md), and [production-readiness assessment](tokenless-production-readiness-2026-07.md). This document does not change the tokenless trust model or relax any launch gate.

## Executive decision

Use AI implementation consulting as a **paid design-partner and distribution channel for RateLoop**, not as a reason to turn RateLoop into a general consultancy product.

The combined offer should be:

> We implement one valuable AI-assisted workflow and prove that it saves time without lowering customer-facing quality. Before rollout, the new workflow is tested against the current process with a blinded human evaluation and a documented acceptance decision.

RateLoop's role is the independent evaluation and evidence layer:

- it turns vague claims such as “the agent looks good” into a predefined acceptance test;
- it supplies external or customer-invited raters for subjective quality judgments;
- it captures reasons and disagreement, not just an approval percentage;
- it creates a repeatable regression suite for future prompt, model, and workflow changes; and
- eventually it returns a private, verifier-ready receipt linked to deterministic settlement.

RateLoop should **not** become the automation builder, CRM, prompt library, AI training portal, or compliance consultant. The consulting engagement supplies those services around RateLoop. This preserves a scalable software thesis while using consulting revenue to discover the workflows, artifacts, cohorts, and reports that buyers will repeatedly pay for.

The first target should not be “all local businesses.” Start with **digitally mature, customer-facing service SMEs in the DACH market**, especially agencies and service businesses with repeated marketing, sales, or support outputs. They have enough volume and budget to benefit from AI, their quality is partly subjective, and their artifacts can often be redacted. Restaurants, tradespeople, and heavily regulated professional decisions are poor first targets.

## Why this combination is commercially credible

### The adoption market exists, but generic education is commoditizing

[KfW Research](https://www.kfw.de/About-KfW/Newsroom/Latest-News/Pressemitteilungen-Details_880896.html) reports that 20% of German SMEs used AI during 2022–2024, rising to 36% among businesses with more than 50 employees. Knowledge-based services led at 28%. This is a useful market, but it is not an untouched one.

[OECD research](https://www.oecd.org/en/publications/ai-adoption-by-small-and-medium-sized-enterprises_426399c1-en.html) finds that SME adoption still lags larger firms and identifies skills, data, compute/connectivity, and finance as core enablers. In its cross-G7 evidence, about half of SMEs report that employees lack the skills to use generative AI.

At the same time, Germany's publicly funded [Mittelstand-Digital AI trainers](https://www.mittelstand-digital.de/MD/Navigation/DE/Praxis/KI-Trainer/ki-trainer.html) offer vendor-neutral workshops, company visits, and implementation support free of charge. Local consultants advertise entry workshops from roughly €800 to €4,500; examples include [Prompteur Berlin](https://prompteur.berlin/leistungen-preise/) and [Context Studios](https://www.kiberatung.berlin/).

The implication is:

> Do not compete on “AI awareness,” prompt training, or a list of possible use cases. Compete on implementation, measured business impact, and evidence that the resulting workflow is good enough to use.

### Workflow redesign and evaluation are the missing middle

[McKinsey's 2025 global survey](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/) found that only 39% of respondents attributed any enterprise-level EBIT impact to AI, while AI high performers were nearly three times as likely to redesign workflows fundamentally. It also found that 51% of organizations using AI had experienced at least one negative consequence, with inaccuracy the most common.

[OpenAI's business evaluation primer](https://openai.com/index/evals-drive-next-chapter-of-ai/) frames evaluation as “specify, measure, improve” and notes that workflow-specific nuance cannot be inferred from generic model benchmarks; human judgment remains important. [NIST's AI RMF](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) likewise recommends testing before deployment and during operation, documenting measures and uncertainty, and involving independent assessors or relevant users where appropriate.

This is where consulting and RateLoop fit together:

```text
real workflow and baseline
        -> implementation and workflow redesign
        -> deterministic checks and owner review
        -> RateLoop evaluation for subjective or ambiguous quality
        -> client-owned go / revise / no-go decision
        -> recurring sampling after prompt, model, or process changes
```

RateLoop is not the complete measurement system. It should measure subjective quality, preference, clarity, trust, tone, and ambiguous edge cases. Objective correctness, latency, cost, conversion, and error rates need normal software tests and business analytics.

## Where to start

### Recommended first segment

Target businesses with all five traits:

1. 10–100 employees, or an equivalent operating budget;
2. at least one repeated text-heavy customer workflow;
3. 20 or more hours of manual effort or enough output volume each week to matter;
4. a clear internal process owner who can supply examples and approve changes; and
5. content that can be safely redacted or replaced with representative test cases.

Best initial segments:

| Segment | Why it fits | Suitable first workflow | RateLoop role |
|---|---|---|---|
| Digital and marketing agencies | Repeated client output, quality is subjective, potential reseller channel | Campaign concepts, landing-page copy, client-report summaries | Blinded preference and message-clarity panels |
| B2B service firms | Repetitive sales and support communication, clear owner, measurable editing time | Inquiry triage, draft replies, proposal summaries | Tone, clarity, usefulness, and escalation-quality checks |
| E-commerce brands with support volume | Repeated public copy and customer questions | Support drafts, product copy, FAQ assistant | Customer-facing quality and source-support panels |
| AI/software agencies | Already understand evals and can bring multiple end customers | Agent or model release checks | External calibration layer and channel partnership |

Avoid initially:

- restaurants, solo trades, and very small firms without enough repeated work to support the project economics;
- medical, legal, hiring, credit, insurance, or safety-critical decisions requiring credentialed expert review;
- automation whose quality is objectively testable, such as exact extraction or reconciliation, where a crowd panel adds cost without signal;
- workflows containing raw customer secrets or special-category personal data until RateLoop's private-data controls are production-ready; and
- fully autonomous write actions with material financial or legal consequences.

### The first use-case rule

Choose a workflow that is **frequent, bounded, reversible, and human-reviewed**. The first deployment should assist an employee, not replace the final decision owner.

Good example:

> Draft a response to a routine customer inquiry using approved business information; the employee reviews, edits, and sends it.

Bad example:

> Decide whether to hire, fire, diagnose, lend, insure, or provide regulated advice.

## Productized service offer

These prices are hypotheses to test, not a published rate card. A scan of visible German offers shows workshops from below €1,000 to €4,500 and implementation pilots commonly framed in the mid-four to low-five figures. Price the business outcome and implementation risk, not model tokens or hours alone.

### 1. Workflow Selection Sprint

**Suggested test price:** €1,500–€2,500 plus VAT, credited toward a pilot if purchased within 30 days.

**Duration:** one day plus preparation.

Deliverables:

- one mapped workflow and conservative value baseline;
- risk/data classification and a “do not automate” boundary;
- 10–25 representative test cases;
- defined success, failure, and human-escalation criteria;
- a fixed-scope pilot proposal; and
- an AI-literacy session tailored to the actual workflow.

This is materially different from a generic workshop: the customer leaves with a test set, acceptance standard, and implementation decision.

### 2. Validated AI Workflow Pilot

**Suggested test price:** €7,500–€15,000 plus VAT.

**Duration:** four to six weeks.

Deliverables:

- the implemented AI-assisted workflow;
- vendor/data-flow and operating documentation;
- employee training and a human escalation path;
- baseline and candidate measurements on the same cases;
- a blinded RateLoop comparison for the genuinely subjective criteria;
- one included iteration if the candidate misses the predefined acceptance bar;
- a decision report with evidence, limitations, and residual risks; and
- a 30-day rollout and measurement plan.

The promise is not “the panel guarantees this AI is correct.” The promise is that the customer defines “good enough” before launch and receives evidence against that standard.

### 3. AI Quality Loop

**Suggested test price:** €1,000–€2,500 per month plus participant costs.

**Minimum term:** three months after a pilot.

Deliverables:

- monthly or release-triggered sampling;
- automated objective checks plus bounded human evaluation;
- comparison against the frozen baseline suite;
- drift, regression, and objection summary;
- review of model/prompt/vendor changes; and
- a short monthly decision and ROI report.

This retainer is where RateLoop can create recurring revenue rather than remaining a one-time novelty. If clients do not buy repeat evaluation after a successful pilot, consultant-led RateLoop demand is weak.

### Value-based qualification

Estimate conservative annual value before quoting:

```text
annual labor value
  = hours saved per week
  × fully loaded hourly cost
  × 46 working weeks
  × expected adoption rate

conservative project value
  = annual labor value
  + measurable error or response-time value
  - software, model, review, and maintenance cost
```

Do not start a €10,000 pilot for a workflow with only €8,000 of credible first-year value. Prefer workflows where conservative first-year value is at least three times the pilot price.

## How RateLoop appears in the sale

### Lead with the business outcome

Recommended pitch:

> I implement one AI workflow that saves measurable time, but we do not call it finished because the demo looks impressive. We define the acceptance test first, compare the new output with your current process, and use independent or customer-invited reviewers for the subjective parts. You receive the workflow, the evidence, and the operating rules.

Short German version:

> Ich implementiere einen konkreten KI-Workflow. Fertig ist er erst, wenn er gegen Ihren heutigen Prozess getestet wurde und nachweisbar Zeit spart, ohne die Qualität zu verschlechtern.

Do not lead with:

- blockchain, USDC, tokenless, x402, or smart contracts;
- “wisdom of crowds,” “truth,” or “objective human consensus”;
- AI Act compliance as a guaranteed outcome; or
- an anonymous global crowd as automatically representative of the customer's buyers.

Introduce RateLoop when explaining the acceptance test:

> RateLoop runs the blinded human evaluation, records the reasons and disagreement, and produces the repeatable decision evidence. The final rollout decision remains yours.

### Keep the commercial identities separate

Use two connected offers:

- **Consulting:** founder-led implementation, training, integration, process change, and measurement.
- **RateLoop:** the repeatable panel, cohort, result, and evidence product used during and after the project.

The implementation invoice should itemize RateLoop participant costs and evaluation operations rather than pretending they are free. A temporary design-partner discount is fine, but the customer should see that external evaluation is a distinct service with a cost.

After three successful direct pilots, offer an agency/channel version. Agencies are a more scalable path than personally consulting every local business, but white-label infrastructure should wait until an agency has paid for repeated evaluations.

## How the evaluation should work

For each pilot:

1. Select 10–25 representative, redacted cases before building.
2. Freeze the prompt, expected sources, forbidden errors, and escalation rules.
3. Record current-process time, edits, quality failures, and owner acceptance.
4. Build the assisted workflow and run deterministic tests first.
5. Randomize and blind baseline versus candidate outputs for subjective comparison.
6. Use the right reviewer source:
   - customer employees for internal usability and policy fit;
   - customer users for customer relevance;
   - RateLoop external raters for independent general-user judgment; or
   - qualified specialists only where credentials and confidentiality are supportable.
7. Report vote distribution, reasons, disagreement, panel definition, missing data, and test limitations.
8. Let the named client owner decide to ship, revise, or stop.
9. Preserve the accepted cases as a versioned regression suite.

Never mix customer-invited, independent external, and simulated raters under one generic “human verified” label. The source and qualification of the reviewers are part of the result.

## How RateLoop should change

### Core product decision

Do **not** change the tokenless fund core or settlement mechanism for the consulting use case. The useful changes are off-chain product and orchestration capabilities that also support the primary AI-team PMF thesis.

The current repo already has workspaces, hash-only API keys, prepaid mode, private content records, webhooks, and a coherent `quote -> ask -> wait -> result` flow. The current [`TokenlessQuestion`](../packages/sdk/src/tokenlessTypes.ts), however, contains only a prompt, labels, and rationale mode. It cannot yet represent the artifact-rich evaluation described above.

### P0: generalizable changes that help both consulting and the existing B2B wedge

1. **Evaluation projects and runs**
   - Add an off-chain project and versioned run object above individual rounds.
   - Group baseline/candidate cases, cohort rules, mechanism version, status, and one aggregate result.
   - Keep fund accounting per immutable round.

2. **Artifact and rubric support**
   - Accept paired outputs, prompt/transcript context, source documents, URLs, images, and bounded structured rubrics.
   - Store raw customer material off-chain and bind it with hiding/keyed commitments.
   - Add a rater-preview step showing exactly what assigned raters will see.

3. **Batch import and blinded comparison**
   - Start with CSV/JSON upload and pairwise randomization.
   - Do not make a local-business owner integrate the SDK to run a pilot.
   - Preserve the existing API for agencies and technical buyers.

4. **Explicit reviewer provenance**
   - Add separate modes for independent external, customer-invited, and sandbox/simulated panels.
   - Add language, geography, role/industry, recent activity, and repeat-cohort filters with honest verification labels.

5. **Useful evidence instead of one score**
   - Return split, sample size, cohort definition, rationale themes, objections, disagreement, failures, and mechanism version.
   - Add baseline-versus-candidate and run-over-time comparison.
   - Export a private decision packet suitable for a client report.

6. **Privacy and retention controls**
   - Tenant access controls, retention period, deletion workflow, access log, DPA/subprocessor documentation, and a complete public-metadata map are launch requirements for customer material.
   - Default to redacted/synthetic cases during the first consulting pilots.

7. **Recurring evaluation suites**
   - Let a customer rerun the same frozen cases after a prompt, model, source, or workflow change.
   - Trigger alerts only when predefined quality or disagreement thresholds fail.

These changes belong on the existing PMF backlog because they also serve AI product teams. The consulting channel is evidence for their priority, not a separate architecture.

### P1: build only after two paid pilots request it

- consultant portfolio view across client-isolated workspaces;
- client guest access and sign-off;
- reusable vertical template packs;
- branded PDF/HTML decision reports;
- budget allocation and client cost centers;
- Make, Zapier, or n8n adapters;
- scheduled monthly samples; and
- agency/reseller billing and “evaluated with RateLoop” branding.

### Do not build yet

- a full CRM, project-management suite, or automation builder;
- a general prompt marketplace;
- dozens of vertical templates before one workflow repeats;
- white-labeling before a channel partner pays;
- representative consumer market research claims;
- expert panels in regulated domains;
- a “compliance certificate”; or
- contract changes solely to support consultant reporting.

## The immediate product constraint

The [production-readiness assessment](tokenless-production-readiness-2026-07.md) is still controlling. The fresh isolated deployment, automated result pipeline, complete rater/funder loops, privacy hardening, and real-money controls are not finished. The current public MCP points at the legacy deployment and requires wallet context even for the attempted dry-run quote; it cannot be used as evidence that the isolated B2B flow is ready.

Therefore:

- consulting can start now;
- RateLoop's sandbox can demonstrate the intended mechanics with explicit simulation labels;
- early acceptance testing can be run as a transparent concierge process with invited reviewers; but
- do not sell a live independent RateLoop panel, public-chain evidence, or paid settlement until the tokenless readiness gates actually pass.

The concierge process should capture the exact data structures and result format needed for the eventual product. It must never be presented as an on-chain result retroactively.

## 30-day validation plan

### Week 1: choose one segment and build the offer

Recommended segment: DACH digital/marketing agencies or B2B service firms with 10–100 employees and recurring customer communication.

Create:

- a one-page “Validated AI Workflow Pilot” offer;
- one concrete before/after example using synthetic data;
- a sample acceptance report;
- a workflow qualification calculator; and
- a short data/privacy checklist.

Do not build consultant-specific RateLoop UI yet.

### Week 2: conduct 12–15 problem interviews

Ask about a recent workflow, not general AI interest:

1. Which customer-facing task consumes the most repetitive judgment?
2. What has already been tried with AI?
3. What error or quality concern stops wider use?
4. Who decides that a new workflow is safe and good enough?
5. What examples and data could be used in a test?
6. What would a failed deployment cost?
7. Has the business paid for implementation help before, and what budget owner approved it?
8. Would an external/customer panel change the rollout decision, or is internal sign-off enough?

Do not ask “Would you use RateLoop?” Show the report and ask what decision it would or would not support.

### Week 3: sell, do not only validate copy

Offer three fixed-scope pilot slots. Require a paid selection sprint or a 30–50% pilot deposit. A free letter of intent does not validate the business.

The most useful positioning comparison is:

- **A — Validated Workflow Pilot:** implement one workflow and independently test the result; versus
- **B — AI Readiness Audit:** identify opportunities and deliver a roadmap.

Direct buyer conversations are more probative than a general public poll. If the isolated RateLoop human path becomes available, use a targeted founder/operator panel with paid written reasons as supplemental evidence, not as the purchasing signal.

### Week 4: run one concierge evaluation

Use synthetic or fully redacted cases. Produce:

- baseline and candidate outputs;
- deterministic metrics;
- a blinded invited-reviewer comparison;
- reason and disagreement themes;
- the named owner's rollout decision; and
- the report the customer would receive.

Record every manual step. Only automate a step that appears in at least two paid pilots.

## Success and stop gates

After 90 days, continue building the consulting integration only if:

- at least three customers pay for a sprint or pilot;
- at least two pilots reach a production or controlled-rollout decision;
- at least two customers run a second evaluation or buy the Quality Loop;
- customers explicitly use the result or reasons in the decision;
- the evaluation cost is small relative to demonstrated workflow value; and
- the same project/run/artifact/cohort schema recurs across customers.

Interpret failure carefully:

| Evidence | Meaning | Response |
|---|---|---|
| Buyers pay for implementation but ignore external evaluation | RateLoop is not differentiating this segment | Keep consulting separate; preserve the AI-team release-gate thesis |
| Buyers value evaluation but only with their own staff/users | Orchestration and receipts matter more than an external crowd | Prioritize customer-invited cohorts with explicit provenance |
| Buyers value results but reject public metadata | The evidence boundary, not the consulting offer, is wrong | Revisit privacy architecture before mainnet |
| Agencies buy repeatedly across clients | Channel and consultant portfolio may scale | Build P1 multi-client and reseller capabilities |
| Only one-off workshops sell | The market sees education, not an operating product | Narrow the workflow and outcome; do not build RateLoop features for it |
| No buyer will pay a deposit | Positioning or customer segment is wrong | Stop product work and change the segment/offer |

## Regulatory positioning

[Article 4 AI literacy](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers) has applied since 2 February 2025 and requires providers and deployers to take measures appropriate to staff knowledge and the use context. A workflow-specific training and operating guide is therefore a useful deliverable.

The EU AI Act does **not** make every local-business AI workflow high-risk. The Commission states that most AI systems are minimal or no risk, while specific transparency duties apply from 2 August 2026 and high-risk rules depend on the use case. RateLoop can support documentation, testing, human review, and evidence, but neither a panel result nor a consultant report is a compliance certificate.

For private customer work, the product must follow data minimization and purpose limitation. The final [EDPB blockchain guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en), adopted 7 July 2026, reinforce the implementation plan's decision to keep customer artifacts, identities, rationales, and unnecessary metadata off-chain.

## Final recommendation

The consulting business and RateLoop can reinforce each other, but only if they keep different jobs:

- consulting finds and implements a valuable workflow;
- normal tests measure objective performance;
- RateLoop measures subjective quality and disagreement;
- the customer owns the decision; and
- recurring RateLoop runs monitor the workflow after the consultant leaves.

The strongest near-term move is to sell **Validated AI Workflow Pilots** to a narrow set of DACH service SMEs, deliver the first ones manually, and use the repeated evaluation schema to prioritize RateLoop's artifact, run, cohort, privacy, and evidence features. Do not pivot RateLoop into a broad local-business AI platform, and do not delay consulting revenue until the tokenless product is ready for real money.

## Source index

### Repo sources

- [Tokenless architecture and implementation plan](tokenless-immutable-implementation-plan-2026-07.md)
- [Tokenless product-market-fit research](tokenless-product-market-fit-research-2026-07-13.md)
- [Tokenless production-readiness assessment](tokenless-production-readiness-2026-07.md)
- [Tokenless SDK types](../packages/sdk/src/tokenlessTypes.ts)
- [Agent integration README](../packages/agents/README.md)
- [Workspace settings surface](../packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx)
- [Ask surface](../packages/nextjs/components/tokenless/TokenlessAskClient.tsx)

### External sources

- [KfW Research: German SME AI adoption](https://www.kfw.de/About-KfW/Newsroom/Latest-News/Pressemitteilungen-Details_880896.html)
- [OECD: AI adoption by SMEs](https://www.oecd.org/en/publications/ai-adoption-by-small-and-medium-sized-enterprises_426399c1-en.html)
- [Mittelstand-Digital AI trainers](https://www.mittelstand-digital.de/MD/Navigation/DE/Praxis/KI-Trainer/ki-trainer.html)
- [McKinsey: State of AI 2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/)
- [OpenAI: How evals drive the next chapter in AI for businesses](https://openai.com/index/evals-drive-next-chapter-of-ai/)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [European Commission: AI literacy Q&A](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers)
- [European Commission: AI Act framework and timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [EDPB: final blockchain data-protection guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en)
- [Context Studios: visible Berlin workshop pricing](https://www.kiberatung.berlin/)
- [Prompteur Berlin: visible workshop and retainer pricing](https://prompteur.berlin/leistungen-preise/)

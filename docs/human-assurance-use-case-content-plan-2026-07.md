# Human-assurance use-case content plan

**Date:** 2026-07-16

**Status:** Recommended public-content plan for the `tokenless` landing page and docs. This is a supporting product
communication document; the
[tokenless design of record](tokenless-immutable-implementation-plan-2026-07.md) controls product behavior and the
[production-readiness register](tokenless-production-readiness-2026-07.md) controls availability claims.

## Recommendation

Add concrete use cases. The current public story explains RateLoop's mechanism but makes the reader do too much work to
recognize their own problem. The first release should add:

1. one compact, problem-led landing-page section with three example workflows;
2. one `/docs/use-cases` page with five concrete scenarios, audience and data boundaries, example review criteria, and
   expected decisions; and
3. an evidence ladder that reserves **case study** for a real customer and verified results.

Do not wait for customer case studies before explaining when the product is useful. Also do not present hypothetical
outcomes, synthetic demos, or paid panel results as customer proof. Until customer evidence exists, use **Example
workflow** on the landing page and **Worked example** only for a flow RateLoop has actually run and documented.

## The current gap

The public surface is strong on mechanism and weak on situation:

- [`packages/nextjs/app/(public)/page.tsx`](<../packages/nextjs/app/(public)/page.tsx>) moves from the Human Assurance Loop
  hero to How It Works, technical differentiators, pricing, and FAQs. Only the `What Can I Evaluate?` FAQ gives a broad
  list, without a concrete trigger, reviewer, question, or decision.
- [`packages/nextjs/app/(public)/docs/page.tsx`](<../packages/nextjs/app/(public)/docs/page.tsx>) starts with adaptive
  review and product roles. It answers how RateLoop operates before answering when a team would reach for it.
- [`packages/nextjs/app/(public)/docs/how-it-works/page.tsx`](<../packages/nextjs/app/(public)/docs/how-it-works/page.tsx>)
  correctly explains evidence scope, review, and settlement, but is not an application guide.
- The docs navigation and site-search index have no use-case destination.
- The landing-page test intentionally caps visible copy at 430 words. A use-case section therefore needs to replace
  redundant explanation, not simply add another long marketing block.

This is a positioning problem rather than a missing-feature problem. A reader can understand that RateLoop gathers
blind human judgments yet still not know which decision to route through it tomorrow.

## What the research suggests

### 1. Lead with the broken workflow, not the category machinery

[Humanloop's home page](https://humanloop.com/home) states a broad problem immediately after its hero: stochastic,
subjective AI development does not fit deterministic, code-only development. Only then does it explain its develop,
evaluate, and observe workflow. RateLoop should use the same narrative order while keeping its own category and
mechanism.

Suggested RateLoop problem:

> Automated checks catch many failures. When they cannot settle a context-dependent decision, people can judge the
> actual output.

### 2. Concrete stories use problem -> workflow -> result

[Humanloop's case-study index](https://humanloop.com/case-studies) leads with customer context and business outcomes.
The detailed [Gusto story](https://humanloop.com/case-studies/gusto) then moves through a specific reliability problem,
the evaluation workflow embedded in delivery, and measured results. [Braintrust's Coursera story](https://www.braintrust.dev/customers/coursera)
uses the same pattern and states the prior process before describing the new one.

RateLoop has no customer result to fill the final stage yet. It can still publish the first two stages honestly: a
specific costly problem and the exact human-assurance workflow that addresses it. The result section should say what the
customer receives or what a pilot would measure, not claim an improvement.

### 3. Human judgment is most legible beside automated evaluation

[LangSmith's evaluation page](https://www.langchain.com/langsmith/evaluation) positions expert review as a way to
assess subjective output quality, route interesting runs, and calibrate automated evaluators. Anthropic's
[agent-evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) similarly separates
objective checks from subjective judgments and recommends expert human calibration for open-ended research quality.

RateLoop should not claim to replace unit tests, deterministic checks, tracing, or LLM-based evaluators. Its strongest
position is the next decision layer: when automated checks pass or disagree, an owner policy can route the actual output
to independent humans, return reasons and disagreement, and keep or reduce review only within the same evidence scope.

### 4. External input and ongoing evaluation are durable needs

The [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for defined human-AI oversight,
regular evaluation, and feedback from relevant actors outside the development team. This supports the general need for
human assurance across the lifecycle. It does **not** make RateLoop a compliance product or prove that a RateLoop panel
satisfies a particular legal duty. Public copy should not make that leap.

### 5. Borrow the communication pattern, not Humanloop's product scope

Humanloop combined prompt management, automated evaluation, observability, and human review. RateLoop does not. The
comparison is useful for content structure, not for feature parity. RateLoop's differentiated story is:

> Independent human judgment for an actual AI output, governed by owner policy, with scoped evidence that can earn
> lower review coverage without becoming blind trust.

## Which problems belong on RateLoop

A strong RateLoop use case meets most of these conditions:

- The output is subjective or context-dependent after deterministic checks have run.
- A wrong decision has real customer, reputation, delivery, or rework cost.
- A reviewer can decide from a bounded, authorized evidence packet.
- The owner can state one concrete criterion and a go, revise, escalate, or stop action.
- The task can tolerate a human response window; it is not an emergency control.
- The right reviewer qualifications are identifiable independently from the data boundary: target users or domain
  experts when those qualifications matter, or a general-human panel when they do not.
- Repeated comparable outputs make scoped agreement and adaptive review useful, or the one-off decision is important
  enough to justify a panel.

RateLoop is a poor fit when a deterministic test can settle the question, reviewers lack the necessary context or
expertise, the material cannot be shared with the selected audience, the decision is time-critical, or the panel would
be presented as the sole medical, legal, financial, security, or safety approval.

## Recommended use-case portfolio

The first three rows belong on the landing page. The full set belongs in the docs.

| Use case                         | Concrete operator problem                                                                                                                             | Example human check                                                                | Right audience                                                                                                                                                                  | Decision and pilot measure                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer replies                 | A support response can be grounded and formatted correctly yet still be confusing, dismissive, or off-tone.                                           | `Would you send this response to the customer as written?`                         | Invite support experts when policy correctness matters. Use a general-human panel only for clarity or tone, and only with public, synthetic, or safely redacted material.       | Send, revise, or escalate. Measure human disagreement, revision rate, review time, and escaped issues.                                                      |
| Research and client deliverables | An agent can cite sources and still overstate a conclusion, omit a decision-critical point, or deliver work the client cannot act on.                 | `Is this conclusion supported by the supplied sources?`                            | Invite domain experts for correctness. General readers can judge clarity or source credibility only when those are the frozen criteria. Apply the material boundary separately. | Deliver, revise, or escalate. Measure unsupported-claim flags, revision rate, and client acceptance.                                                        |
| UI and public-content checks     | A screen or campaign can pass automated checks and still leave the intended audience unsure what to do or interpret.                                  | `Is the intended next action clear from this screen?`                              | Invite representative target users when that qualification matters. A general-human panel can judge broadly legible public-safe media.                                          | Publish, revise, or compare a second version. Measure clarity failures, preference, and rework before release.                                              |
| Agent-version calibration        | A model, prompt, tool, or workflow change invalidates the team's intuitive belief that the agent still behaves the same way.                          | `Based on the supplied source, should this agent suggestion be accepted?`          | The same qualified audience and criterion used for that exact workflow scope.                                                                                                   | Begin at full review, then retain or reduce baseline coverage only from comparable evidence. Measure agreement, severe disagreement, and coverage by scope. |
| Extraction and triage exceptions | An agent classifies a request or extracts a record, but ambiguous source material or low confidence makes the suggested structured result unreliable. | `Does the suggested classification or extracted record match the supplied source?` | Invite operations or domain reviewers qualified for the schema and source material. Apply the public/private material boundary independently.                                   | Accept, correct, or escalate. Measure exception rate, corrections, turnaround, and repeated failure categories.                                             |

### Important capability distinctions

The public explanation must match the implementation:

- The recurring adaptive path compares an exact source payload with an exact agent suggestion and asks a frozen,
  owner-written binary acceptance question. Separately, an owner may let the agent write a binary feedback question for
  each public-safe network review. Feedback answers never enter adaptive agreement or correctness evidence, so do not
  describe that option as auditing or as an unrestricted survey builder.
- A direct one-off panel can use a binary or head-to-head question. Repeated adaptive evidence should not mix those
  shapes silently.
- Images and YouTube video are supported question media. A screenshot review is credible; claiming that panelists test
  a live interactive application is not currently supported by the artifact flow.
- RateLoop-network reviewers can supply provider-scoped proof of human uniqueness. That does not prove domain
  expertise. Use invited qualified reviewers for specialist correctness.
- Public/network material must be public, synthetic, or owner-confirmed redacted. Private customer or client material
  belongs only in an available invited-reviewer lane with the required access controls.
- The customer remains the final decision-maker. A verdict is evidence for a decision, not a truth oracle or legal
  sign-off.

The isolated tokenless test deployment currently requires network panels to remain disabled, and the adaptive
publishing path does not yet connect private or hybrid assignment. The examples can be written now, but calls to action
must not imply that an unavailable lane can complete today. Keep those readiness details internal; expose only actions
that pass the effective capability check.

## Public information architecture

### Landing page

Insert a new section after the supported-agent row and before the current How It Works section:

- eyebrow/number: `01`
- title: `When Humans Matter`
- one-sentence problem statement;
- three cards: `Customer replies`, `Research & client work`, `Product experiences`;
- each card contains one problem sentence, one sample human question, and a link to its docs anchor;
- one secondary link: `Explore example workflows` -> `/docs/use-cases`.

Renumber the existing sections. Preserve the established rail, orb, typography, gradients, numbered sections, and card
proportions. This is a copy and information-architecture change, not a visual redesign.

Keep the current 430-word ceiling. Recover the new words by removing the `What Can I Evaluate?` FAQ, shortening the
technical `Why It Works` descriptions, and avoiding repeated explanations of the Human Assurance Loop. Do not raise the
word budget merely to accommodate the new section.

Suggested compact copy:

> **When Humans Matter**
>
> Automated checks catch many failures. When they cannot settle a context-dependent decision, people can judge the
> actual output.
>
> **Customer replies**
>
> A grounded answer can still frustrate a customer. Ask: “Would you send this response as written?”
>
> **Research & client work**
>
> Citations do not make a conclusion decision-ready. Ask: “Is this conclusion supported by the supplied sources?”
>
> **Product experiences**
>
> A build can pass tests and still confuse users. Ask: “Is the intended next action clear?”

The cards should be labelled `Example workflow` in accessible supporting text or on the destination page. Do not add
customer logos, outcome numbers, or a `Case studies` navigation item.

### Use-cases docs page

Add `/docs/use-cases` under `Start Here`, between `Introduction` and `How It Works`. The page should answer:

1. **When to use RateLoop:** the fit test above.
2. **Five example workflows:** use the same structure for each:
   - problem;
   - trigger;
   - artifact and permitted data;
   - reviewer audience;
   - one example criterion;
   - what RateLoop returns;
   - what the customer decides;
   - what a pilot should measure.
3. **Choose reviewers and material separately:** qualifications determine who can answer the criterion; sensitivity
   determines what material each configured audience may receive.
4. **Combine with automated evals:** run objective checks first; route subjective or exceptional decisions to people.
5. **When not to use RateLoop:** deterministic, urgent, unauthorized, unknowable, or sole professional-sign-off cases.
6. **Next action:** connect an agent if the effective lane is available; otherwise link to How It Works and the agent
   guide without a false start-review promise.

Add an equivalent concise Markdown resource at `packages/nextjs/public/docs/use-cases.md` so the agent-readable docs
surface does not omit the product's most important application guide.

### Evidence ladder before case studies

Use these labels consistently:

| Label            | Evidence required                                                                                            | Allowed claims                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Example workflow | A clearly hypothetical or synthetic scenario grounded in implemented product boundaries.                     | The problem, intended workflow, returned fields, and decisions it could support. No outcome claims. |
| Worked example   | RateLoop actually ran the disclosed scenario with reproducible inputs, panel definition, timing, and result. | What happened in that run, with sample size and limitations. No customer impact claim.              |
| Pilot story      | A design partner used the workflow for a defined period and approved publication.                            | Preliminary baseline-to-pilot measures with dates, denominators, and caveats.                       |
| Case study       | A named customer approves the story and metric provenance has been checked.                                  | Verified problem, integration, outcome, timeframe, and attributable quotation.                      |

Do not create `/case-studies` until at least one item meets the final row. A future case study should contain customer
context, prior workflow and baseline, exact RateLoop trigger and audience, data boundary, decision packet, measurable
result, timeframe and denominator, limitations, and an approved quotation. If the panel was paid, describe it as paid
panel research or pretesting rather than organic customer reviews.

## Pilot plan for earning the first evidence

Start with two design-partner pilots:

1. **Customer-support draft approval** because it is frequent, has a clear send/revise decision, and can use existing
   support experts as invited reviewers.
2. **Agent-produced research deliverables** because the source-versus-suggestion shape maps directly to the adaptive
   path and demonstrates evidence-triggered review rather than a generic survey.

Before the first run, freeze:

- the workflow, agent version, criterion, reviewer audience, and data classification;
- the baseline period and baseline measures;
- which decisions remain automated and which require the customer;
- the pilot start/end dates and minimum sample size;
- permission to publish an anonymous pilot story or named case study; and
- a metric dictionary so `agreement`, `revision`, `acceptance`, `escaped issue`, `turnaround`, and `cost` cannot change
  meaning after results are known.

Track at minimum:

- eligible outputs and reviewed outputs;
- reason each review was triggered;
- panel result, disagreement, and rationale categories;
- customer final action and whether it disagreed with the panel;
- review turnaround and cost per reviewed output;
- revision and escalation rates;
- comparable agreement and adaptive stage by exact scope; and
- confirmed escaped issues during a defined follow-up window.

Publish no uplift percentage without the baseline, numerator, denominator, timeframe, and known confounders. A useful
negative or inconclusive pilot is still a credible worked example if its method and limitations are clear.

## Implementation sequence

### Phase 1: concrete examples without invented proof

1. Create `packages/nextjs/app/(public)/docs/use-cases/page.tsx` and its rendering test.
2. Add `Use Cases` to `packages/nextjs/constants/docsNav.ts` and update the exact navigation assertion.
3. Add page and anchor entries to `packages/nextjs/lib/search/siteSearch.ts`; verify searches for `customer support`,
   `research`, `UI`, `human judgment`, and `adaptive review`.
4. Add `packages/nextjs/public/docs/use-cases.md`.
5. Update the docs introduction with a problem-first sentence and a direct `Use Cases` path.
6. Add the compact landing-page section and its three deep links.
7. Remove the redundant evaluation FAQ and trim adjacent copy so the 430-word landing-page guard still passes.
8. Keep the landing and docs commits separate so the new documentation can land independently of homepage layout.

Acceptance criteria:

- A first-time visitor can name three problems RateLoop addresses without opening a FAQ.
- Every example states a trigger, reviewer, question, and customer decision.
- Reviewer qualifications and permitted material are explained as separate choices.
- No example claims a customer, uplift, compliance outcome, expert network, real-time decision, or currently unavailable
  workflow.
- Public-network and private-data boundaries match the design of record.
- The page says automated checks and RateLoop are complementary.
- The docs page, navigation, search index, and public Markdown agree.
- Existing visual proportions, accessibility, responsive behavior, and the landing copy budget remain intact.

### Phase 2: publish one worked example

After one complete deployment-pinned assurance path passes the relevant readiness gates, run a public-safe synthetic
support scenario. Publish the inputs, criterion, audience policy, panel size, turnaround, result, disagreement, customer
decision simulation, settlement evidence, and limitations. Label it `Worked example`, not `Case study`.

### Phase 3: run design-partner pilots

Recruit one support workflow and one research/client-delivery workflow. Instrument the measures above before the pilot,
then publish an approved pilot story if the evidence is useful and privacy permits it.

### Phase 4: add case-study architecture

Only after a named customer approves a verified story, add `/case-studies`, its navigation entry, social image, structured
metadata, and related-story cards. Do not build an empty case-study management surface in advance.

## Proposed future commit boundaries

1. `docs(nextjs): add human-assurance use cases` — docs route, Markdown mirror, navigation, search, and tests.
2. `feat(nextjs): add problem-led landing examples` — homepage section, copy removal, renumbering, and landing test.
3. `docs: publish first RateLoop worked example` — only after a real run and evidence review.

## Research sources

- [Humanloop home](https://humanloop.com/home)
- [Humanloop case studies](https://humanloop.com/case-studies)
- [Humanloop: Gusto](https://humanloop.com/case-studies/gusto)
- [Humanloop: Dixa](https://humanloop.com/case-studies/dixa)
- [Humanloop: FMG](https://humanloop.com/case-studies/fmg)
- [LangSmith Evaluation](https://www.langchain.com/langsmith/evaluation)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Braintrust: Coursera](https://www.braintrust.dev/customers/coursera)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)

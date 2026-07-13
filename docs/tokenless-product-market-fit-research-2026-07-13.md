# RateLoop Tokenless: Product-Market-Fit Research and Recommendation

**Date:** 13 July 2026

**Status:** Product recommendation and validation plan, not proof of product-market fit

**Scope:** The `tokenless` product line only. The legacy token/governance product and `rateloop.ai` deployment are not treated as constraints or launch channels.

## Executive recommendation

RateLoop should become **a B2B external-human decision-assurance API for teams shipping customer-facing AI products**, starting with one narrow job:

> Before a team ships a prompt, model, agent, or customer-facing AI behavior change, RateLoop returns a blinded multi-rater A/B or go/no-go verdict, written reasons, and a durable audit trail.

The first ideal customer is not a frontier lab, a general market researcher, or an autonomous agent with its own wallet. It is a **small-to-mid-sized AI software company that ships frequently, lacks a research-operations team, and needs human calibration before it has enough production traffic for a real A/B test**. The initial buyer is likely an AI product lead, evaluation engineer, or applied-AI founder.

The initial use cases should be subjective but consequential and understandable by a qualified non-expert cohort:

- Which of two assistant responses is more helpful, clear, and trustworthy?
- Is a proposed support-agent behavior acceptable under a short rubric?
- Does a new prompt or model version improve the user-facing experience enough to release?
- Does an AI-generated message match the intended tone and avoid obvious failure modes?

This is **not yet proven PMF**. It is the strongest hypothesis after comparing the current tokenless build with the market. The next milestone should be paid design-partner evidence, not a broad public launch.

### The centralization decision is an advantage for this wedge

The new trust split supports a better B2B product:

- RateLoop can centrally qualify raters, form persistent cohorts, enforce response-quality checks, moderate content, meet service-level objectives, and support private workspaces.
- The on-chain core can remain a narrow settlement and evidence layer with no operator path to funds.
- Buyers can use conventional workspaces, invoices/prepaid balances, API keys, and webhooks. x402 remains an optional no-account payment lane for agents, not the main story.

The positioning should therefore be **centralized operations with independently verifiable settlement**, not “decentralized market research,” “tokenless crypto,” or “agents paying humans.”

## What “best fit” means in this report

This report optimizes for the intersection of:

1. a frequent and costly buyer problem;
2. evidence of budget and active competition;
3. fit with what the tokenless branch already implements;
4. a differentiation that a buyer could care about;
5. a reachable first customer; and
6. operational and legal feasibility for a small company.

The research combines a current repo audit with current market and competitor material. It does **not** include buyer interviews, paid pilots, cohort-fill data, or willingness-to-pay tests. Any market-size number would therefore create false precision and is intentionally omitted.

## What the repo already says the product is

The [architecture and implementation plan](tokenless-immutable-implementation-plan-2026-07.md) already contains most of the demand-side foundation for a B2B product:

- B2B workspaces and hash-only API keys;
- prepaid, wallet, and x402 payment paths;
- a versioned `quote -> ask -> wait -> result` workflow;
- idempotent asks, bounded polling, signed webhooks, and machine-readable result states;
- binary and head-to-head panels;
- selectable identity assurance;
- sealed responses and deterministic settlement;
- itemized bounty, fee, reserve, refund, and compensation accounting; and
- private content handling as an intended product surface.

The [agent package](../packages/agents/README.md) and [SDK](../packages/sdk/README.md) expose a coherent machine workflow. The [legal and revenue reference](legal-revenue-assessment-tokenless-design-2026-07.md) already concludes that micro-fees alone are inadequate and names B2B SaaS/API tiers as part of the revenue stack. The plan itself names “eval-panel-as-API” and confidential creative/message pretesting as leading wedge candidates.

The implementation is therefore closer to a B2B decision service than to an open social-rating network.

### The current product is not ready to sell that promise yet

The [production-readiness assessment](tokenless-production-readiness-2026-07.md) remains controlling for launch readiness. In particular:

- live Base Sepolia E2E and an automated result pipeline are still blocked;
- the rater loop, receipts, notifications, and funder waiting room are incomplete;
- real-money B2B gating, billing/legal furniture, key custody, sanctions controls, and privacy hardening remain open;
- one reserve-compensation economic bug must be fixed before real money; and
- the current deployment artifacts are stale after fund-core changes.

This report recommends what to validate and build next; it does not relax those gates.

## Market evidence: the problem is real

### AI teams need human validation, but not on every request

[McKinsey's 2025 global AI survey](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/) reports that 51% of respondents at organizations using AI had seen at least one negative consequence, with nearly one-third reporting consequences from inaccuracy. It also identifies defined processes for deciding when model outputs need human validation as one of the practices that most distinguishes AI high performers.

[Anthropic's January 2026 agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) says agent evaluations typically combine code, model, and human graders; subjective rubrics should be calibrated against expert human judgment; and effective teams combine automated evaluation with periodic human review. That supports a **calibration and release-gate layer**, not an expensive human vote on every agent action.

[NIST's AI Resource Center](https://airc.nist.gov/) likewise describes evaluation work that combines expert annotators and human testers, while its [Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) places evaluation inside the AI risk-management lifecycle.

The buying trigger is therefore not “humans are better than AI.” It is:

> Automated graders cover scale; an external human panel calibrates subjective quality, ambiguous edge cases, and important release decisions.

### Existing vendors prove demand and expose the competitive bar

- [Scale's enterprise evaluation product](https://scale.com/evaluation/enterprise) combines automated evaluation with an expert human workforce. This validates enterprise demand but also shows that RateLoop should not try to become an entire eval, monitoring, data, and services platform.
- [Braintrust human review](https://www.braintrust.dev/docs/annotate/human-review) puts structured feedback from end users, subject-matter experts, and product teams alongside experiments, traces, and datasets. This makes Braintrust-like platforms logical integration partners: RateLoop can supply an **external panel scorer** rather than rebuild observability and dataset management.
- [Prolific for AI](https://www.prolific.com/ai) markets API-first access to more than 300,000 verified participants, more than 300 screeners, AI taskers, and domain experts. Its [2026 corporate pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing) adds a 42.8% platform fee to participant rewards. This validates both budget and the importance of supply quality, while setting a high bar for targeting and participant operations.
- [PickFu's survey product](https://www.pickfu.com/docs/product/surveys-overview) offers large consumer panels, targeting, multiple research formats, and written explanations. Its [MCP product](https://www.pickfu.com/docs/developers/mcp-server) lets assistants create surveys and retrieve results, while its developer surface includes CLI and API automation. **Agent-native polling is already table stakes, not a RateLoop moat.**
- [Wynter](https://wynter.com/products/message-testing) specializes in B2B message testing with role, industry, company-size, and regional targeting. Its [pricing](https://wynter.com/pricing) starts at $20,000 per year for Pro and reaches $100,000 per year for managed research. The lesson is that specialization and audience relevance create willingness to pay; “verified people” alone do not.
- [PausePoint](https://www.pausepoint.dev/) offers a single known human's approve/reject checkpoint for agents starting at $29 per month. RateLoop should not compete for simple owner approvals: a multi-rater external panel is slower, more expensive, and not authorized to approve a company's irreversible action.

### x402 is useful plumbing, not the market

[Coinbase describes x402](https://docs.cdp.coinbase.com/x402/welcome) as accountless, programmatic payment for APIs and AI agents. That makes x402 a valuable optional acquisition and payment path. It does not prove that autonomous agents independently buy research, that they have meaningful budgets, or that buyers choose an evaluation provider because it settles in USDC.

The near-term economic buyer remains a company. The agent is a calling client acting within the company's budget and policy.

## Candidate wedge assessment

Scores are directional judgments from 1 (poor) to 5 (strong). Weights reflect a pre-PMF company that should exploit current assets without walking into a market dominated by scale and procurement.

| Candidate wedge | Pain and frequency (25%) | Current product fit (20%) | Differentiation (20%) | Budget evidence (15%) | GTM reachability (10%) | Feasibility (10%) | Weighted score |
|---|---:|---:|---:|---:|---:|---:|---:|
| External human release gates for customer-facing AI | 5 | 4 | 4 | 4 | 4 | 3 | **83/100** |
| Confidential creative/message pretesting | 4 | 3 | 2 | 4 | 3 | 3 | **64/100** |
| Simple human approval checkpoints for agents | 5 | 2 | 1 | 2 | 4 | 4 | **59/100** |
| General agent-created consumer polls | 3 | 4 | 1 | 3 | 3 | 4 | **58/100** |
| High-stakes expert or compliance review | 5 | 1 | 2 | 5 | 2 | 1 | **58/100** |
| Public/social “verified verdicts” | 2 | 4 | 3 | 1 | 3 | 2 | **51/100** |

### 1. Recommended: external human release gates for customer-facing AI

Why it leads:

- The buyer problem is repeated whenever a team changes a model, prompt, workflow, or agent behavior.
- The current API lifecycle, idempotency, webhooks, prepaid workspace model, A/B format, sealed answers, and result artifact fit a release workflow.
- It complements automated eval platforms rather than replacing them.
- Small panels can be economically rational for release-level decisions even though they are unsuitable for scoring every trace.
- Blinded answers and durable evidence can differentiate RateLoop from internal reviews and generic polls—if buyers confirm they value those properties.

Why the scope must stay narrow:

- General raters cannot verify specialist medical, legal, financial, or deep technical correctness.
- A 15-person panel is directional evidence, not population-representative research.
- RateLoop currently lacks the artifact bundles, cohort targeting, and batch orchestration that an AI evaluation actually needs.
- The result must feed a human-owned release policy; it should not autonomously authorize irreversible actions.

### 2. Secondary template, not the company category: confidential creative/message pretesting

This is a plausible template for landing pages, AI-generated copy, ad creative, names, or product messages. It has clear budget evidence, but Wynter, PickFu, UserTesting, Maze, and similar research tools are much richer and have stronger audience targeting.

Use it where the same product primitives apply—fast A/B, blinded responses, private context, machine-readable result—but do not position RateLoop as a general user-research suite.

### 3. Reject as primary: general agent-created polls

PickFu already offers the most obvious version of this proposition with broad supply, many question types, targeting, MCP, CLI, API, media, and explanations. RateLoop cannot win by saying “an AI agent can ask humans” or “results arrive by API.”

### 4. Reject as primary: single-person human approval

Approval products route a decision to a known authorized employee or owner. RateLoop routes a judgment to independent external raters. Those are different jobs. Combining them would blur authorization, accountability, and product expectations.

### 5. Defer: high-stakes expert review

Budgets can be high, but RateLoop has no expert credential graph, specialist recruiting engine, enterprise security posture, or domain-specific liability model. Identity assurance is not expertise. Start with subjective general-user quality and add specialist cohorts only after repeated customer pull.

### 6. Avoid: public “truth,” organic reviews, or social verdicts

The legal reference correctly constrains the output to paid panel research, not organic consumer review. Small paid panels should not be marketed as truth, public consensus, or representative public opinion.

## The actual product category

Recommended category language:

> **External human evaluation for AI release decisions**

Recommended one-line description:

> Send an A/B or go/no-go evaluation from your AI workflow. Get a blinded panel verdict, written reasons, and an audit trail before you ship.

Recommended job-to-be-done:

> When automated graders and internal reviewers cannot confidently resolve a subjective release decision, give me a fast independent human signal that my pipeline can consume and my team can inspect.

### What should be visible to the buyer

1. **A structured decision**, not a generic survey builder.
2. **A relevant human cohort**, not just proof that each rater is a person.
3. **Blinded independent responses**, not social voting.
4. **Written reasons and disagreement**, not only a percentage.
5. **A machine-readable result and webhook**, not a PDF-only research report.
6. **A clear evidence trail**, with the chain implementation explained on a trust page rather than in the headline.

### What should not lead the message

- tokenless;
- blockchain or Base;
- USDC earnings;
- x402;
- World ID or passport verification;
- immutable smart contracts; or
- “AI agents hire humans.”

These can support trust, supply, and integration. They are not the buyer's core outcome.

## Ideal customer profile

### Beachhead customer

An AI-native software company with roughly 10–200 employees that:

- ships a customer-facing assistant, support agent, content tool, research agent, or conversational workflow;
- releases prompt/model/agent changes at least weekly;
- already uses traces, automated scorers, or ad hoc internal review;
- has too little traffic for fast production A/B significance or wants a pre-release signal;
- lacks a dedicated panel/research-operations team; and
- can use English-language general users or AI power users rather than regulated-domain experts.

### Buyer and user

- **Economic buyer:** Head of AI, VP Product, founder, or engineering leader.
- **Daily user/integrator:** evaluation engineer, applied-AI engineer, or AI product manager.
- **Internal champion:** the person currently chasing colleagues in Slack to compare outputs before a release.

### Disqualifiers for the first year

- a requirement for statistically representative public-opinion research;
- medical, legal, financial, employment, safety, or regulatory sign-off;
- a need for thousands of annotations per day;
- a need for dozens of narrow domain-expert categories before the first run;
- use cases where the respondent must be an authorized employee;
- secrets that cannot be shown to RateLoop or eligible raters; and
- procurement that requires mature SOC 2, SSO/SAML, VPC, and enterprise indemnity before a pilot.

## Product gaps to close for the recommended wedge

### P0: required for a credible design-partner pilot

1. **Finish the existing live-product gates.** Complete fresh Base Sepolia deployment, deployment-key propagation, automated pipeline driving, smoke E2E, and the rater/funder post-submit loops from the readiness assessment.
2. **Add evaluation context and artifacts.** The current [`TokenlessQuestion`](../packages/sdk/src/tokenlessTypes.ts) carries a prompt and labels but no source artifact, response pair, transcript bundle, rubric, URL, or image. A release decision cannot be judged from a bare sentence.
3. **Guarantee the rater type.** The current [landing page](<../packages/nextjs/app/(public)/page.tsx>) says “Human and AI raters guide decisions.” The recommended product needs an explicit **verified-human panel** mode. Synthetic or agent raters can remain in a labeled sandbox, but must never be mixed into a human-calibration result.
4. **Add job-relevant cohorts.** Current audience selection is identity assurance (`selfie`, `passport`, `orb`, `presence`). The buyer needs language, geography, AI-tool familiarity, role/industry when applicable, and repeat-cohort controls. Personhood is an input to quality, not the finished audience product.
5. **Return decision evidence, not a magic confidence score.** For small panels, expose sample size, cohort definition, vote split, rationale themes, disagreement, completion/failure state, and methodology. Do not imply statistical representativeness from an opaque `confidenceBps` field.
6. **Orchestrate an eval run.** Add an off-chain run object that groups multiple binary/A/B rounds, tracks a release candidate or experiment, and emits one webhook summary. This need not expand the fund-holding contract.

### P1: required for repeated paid use

1. reusable templates for response-pair preference, release acceptability, tone/brand fit, and support-agent quality;
2. private persistent cohorts and optional customer-supplied expert groups;
3. adapters/export for at least one eval platform rather than a new tracing system;
4. workspace budgets, usage controls, invoices/receipts, and conventional funding through a regulated partner;
5. rater calibration, gold questions, cohort-quality dashboards, and published service-level data;
6. data retention controls, customer deletion workflows, DPA/subprocessor documentation, and security basics expected for private model outputs; and
7. a result comparison view across releases, prompts, cohorts, and time.

### P2: only after customer pull

- domain-expert credentials;
- audio/video and interactive agent-trajectory review;
- representative sampling;
- SSO/SAML and formal enterprise security packages;
- a native integration marketplace;
- white-label panel infrastructure; and
- production mainnet hardening beyond what actual usage requires.

## Differentiation: what must be true

RateLoop cannot rely on “real humans,” “API access,” “MCP,” “fast feedback,” or “written explanations.” Competitors already sell all of those.

The defensible product thesis is the combination of:

1. **external** raters rather than only the customer's team;
2. **blinded and independent** responses rather than visible social voting;
3. **small, repeated decision panels** rather than open-ended research projects;
4. **machine-native orchestration** rather than manual study operations;
5. **persistent cohort quality** rather than anonymous one-off crowd supply; and
6. **recomputable evidence and non-custodial settlement** rather than a black-box final number.

This thesis must be tested. If buyers do not pay more, adopt faster, or trust results more because of independence and evidence, the chain layer is implementation complexity rather than differentiation.

## Business model recommendation

Do not rely on the 7.5% bounty fee.

The current browser “Quick pulse” preset uses a $25 bounty and a $5 attempt reserve. At 7.5%, RateLoop earns only **$1.875** in platform fee on a successfully settled panel. Even 100 such panels per month would produce only **$187.50** of fee revenue before infrastructure, support, rater operations, failed rounds, or acquisition cost.

Recommended pricing architecture:

1. **Participant compensation and reserve:** pass-through, clearly itemized.
2. **Execution fee:** retain the current transparent percentage for settlement and payment execution.
3. **B2B software subscription:** charge for private workspaces, reusable cohorts, run history, webhooks, team budgets, integrations, analytics, and service levels.
4. **Managed evaluation:** optional higher-priced rubric/cohort setup for customers without evaluation expertise.
5. **x402:** optional per-run or per-result lane for programmatic buyers without an account.

Pricing hypotheses to test—not publish as final pricing:

- Design partner: $250–$500 per month plus participant costs for a limited number of runs.
- Team: $500–$1,500 per month plus participant costs for private cohorts, history, webhooks, and budgets.
- Managed: fixed setup/run fee based on cohort and rubric complexity.

The first proof is not whether a founder says that $500 sounds reasonable. It is whether a team pays, runs the workflow repeatedly, and uses the result in an actual release decision.

## Go-to-market recommendation

### Design-partner offer

> We help AI product teams resolve subjective release decisions before production traffic. Send us two model or agent variants and a short rubric; we return a blinded human preference panel with reasons and an inspectable result.

For the first three to five partners, run this as a concierge service even if some workflow steps are manual. The product should learn the repeated schema before automation hardens it.

### Where to find the first partners

- founders and product leads of customer-facing AI startups;
- evaluation/platform engineers already using Braintrust, LangSmith, Langfuse, Arize, or home-grown evals;
- teams launching support, research, voice, or content agents;
- AI agencies that repeatedly need client sign-off on output quality; and
- Base/x402 builders only where they also have a real evaluation need.

Do not lead acquisition with rater earnings or crypto communities. Demand discovery should start where AI release quality is discussed.

### Integration strategy

RateLoop should be a scorer and human-panel provider inside an existing eval workflow:

```text
traces / candidate outputs
        -> automated filters and LLM judges
        -> ambiguous or release-critical bundle
        -> RateLoop external human panel
        -> verdict + reasons + evidence webhook
        -> human-owned release decision
```

This avoids competing with platforms that already own traces, experiments, datasets, and dashboards.

## Twelve-week validation plan

### Weeks 1–2: problem interviews, no new protocol work

Interview 15–20 people in the beachhead ICP. Ask for the last real release decision, not opinions about the concept.

Questions:

1. What AI change did you hesitate to ship in the last month?
2. What evidence did you use and who reviewed it?
3. How long did the decision take and what delayed it?
4. Where did automated graders and internal review disagree?
5. Would an external general-user or AI-power-user cohort have been competent to judge it?
6. What context could leave your systems, and under what confidentiality terms?
7. Would a blinded/auditable process change trust or procurement?
8. What would you pay to resolve that exact decision within four hours?

Success gate: at least five interviewees provide a recent qualifying artifact and at least three agree to a live design-partner run.

### Weeks 3–5: concierge pilot surface

Build only the minimum P0 additions around the existing API:

- A/B artifact bundle;
- one rubric with at most three dimensions;
- explicit human-only panel;
- one qualified cohort such as English-speaking weekly AI-tool users;
- result with split, reasons, disagreement, and evidence; and
- one eval-platform export or generic webhook example.

Use sandbox/test funds until the production-readiness gates for real money are closed.

### Weeks 6–9: run repeated partner decisions

Target three partners and at least five real release decisions per partner. Compare:

- internal reviewer decision;
- LLM-judge result;
- RateLoop panel result; and
- eventual production/user signal when available.

Measure turnaround, completion, cohort quality, disagreement, decision change, time saved, and repeat usage. Do not market agreement with internal reviewers as accuracy; the purpose is to learn when each signal is useful.

### Weeks 10–12: charge and decide

Ask every active partner to move to a paid monthly design-partner plan plus participant costs.

Continue the wedge if:

- at least two partners pay;
- at least two partners run five or more panels in a month;
- at least half of active partners return within 30 days;
- at least 30% of runs either change a decision or materially resolve documented disagreement;
- median end-to-end turnaround is below four hours during concierge supply; and
- private-context/security requirements are achievable without an enterprise rebuild.

Reconsider or stop if:

- teams say their own staff or users are always the only credible judges;
- buyers want bulk annotation rather than release decisions;
- PickFu/Prolific solve the job well enough with less friction;
- auditability and blinded independence do not influence purchase or trust;
- the required cohort breadth becomes the entire product before repeat demand exists; or
- buyers consistently reject wallet/USDC/on-chain mechanics even when hidden behind conventional billing.

## Self-dogfooding and outside validation

The RateLoop ratings workflow would normally be useful for testing two public positioning statements. It was not used for this report because the available live workflow targets the legacy `rateloop.ai` deployment, while the `tokenless` branch rules prohibit sending tokenless review asks through that product. The isolated tokenless client currently exposes a deterministic sandbox, not an outside-human handoff.

After the isolated tokenless deployment has a real human-panel path, run two separate tests:

1. a **target-buyer test** with qualified AI product/evaluation professionals comparing the release-gate positioning against generic “human judgment for agents”; and
2. a **rater-comprehension test** checking whether the task, compensation, privacy, and result terminology are clear.

Do not treat a general-rater preference poll as buyer validation. The design-partner payment and repeat-use gates above are the real test.

## Messaging recommendation

### Buyer-first landing-page hierarchy

**Headline**

> Human verdicts for AI release decisions.

**Subhead**

> Send an A/B or go/no-go evaluation from your workflow. Get blinded human judgment, written reasons, and an inspectable result before you ship.

**Primary CTA**

> Run a sandbox evaluation

**Secondary CTA**

> Become a design partner

**Rater path**

> Earn by evaluating AI experiences

The rater path should be important but secondary. “For Agents” should describe integration by the buying team's software, not suggest that AI raters are interchangeable with the external human calibration being sold.

### Proof section

Show one real case study with:

- the release question and redacted candidate artifacts;
- cohort definition and panel size;
- blinded result and disagreement;
- representative written reasons;
- the decision the team made;
- turnaround and total cost; and
- eventual user or production evidence.

One credible repeated workflow is worth more than a broad use-case catalog.

## Final decision

**Go B2B, but do not go broad.**

The best current PMF hypothesis is:

> RateLoop is the external-human release-gate layer in an AI evaluation stack, serving small-to-mid-sized teams that need fast subjective judgment before production traffic can answer the question.

The strongest use of the more centralized tokenless architecture is to operate qualified cohorts, private workspaces, quality controls, billing, and service levels. The smart contracts should remain a narrow trust and settlement substrate. x402 should remain an optional lane. Neither should define the category.

The make-or-break discovery question is simple:

> Will AI teams repeatedly pay for an external, blinded, auditable human verdict at release time when automated evals and internal reviewers disagree?

The next 12 weeks should answer that question with artifacts, paid pilots, and repeated usage before RateLoop expands its panel types, rater taxonomy, protocol, or enterprise surface.

## Source index

### Repo sources

- [Tokenless architecture and implementation plan](tokenless-immutable-implementation-plan-2026-07.md)
- [Tokenless production-readiness assessment](tokenless-production-readiness-2026-07.md)
- [Legal and revenue reference](legal-revenue-assessment-tokenless-design-2026-07.md)
- [Agent package workflow](../packages/agents/README.md)
- [SDK workflow](../packages/sdk/README.md)
- [Tokenless SDK types](../packages/sdk/src/tokenlessTypes.ts)
- [Current landing page](<../packages/nextjs/app/(public)/page.tsx>)

### External sources

- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [McKinsey — The State of AI: Global Survey 2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/)
- [NIST — AI Resource Center](https://airc.nist.gov/)
- [NIST — Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [Scale — Generative AI Evaluation for Enterprise](https://scale.com/evaluation/enterprise)
- [Braintrust — Set up human review](https://www.braintrust.dev/docs/annotate/human-review)
- [Prolific — Human data and systems for AI](https://www.prolific.com/ai)
- [Prolific — 2026 pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing)
- [PickFu — Survey product](https://www.pickfu.com/docs/product/surveys-overview)
- [PickFu — MCP server](https://www.pickfu.com/docs/developers/mcp-server)
- [Wynter — B2B message testing](https://wynter.com/products/message-testing)
- [Wynter — Pricing](https://wynter.com/pricing)
- [PausePoint — Human approval API](https://www.pausepoint.dev/)
- [Coinbase — x402 overview](https://docs.cdp.coinbase.com/x402/welcome)

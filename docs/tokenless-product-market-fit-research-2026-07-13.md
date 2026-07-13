# RateLoop Tokenless: Product-Market-Fit Research and Recommendation

> **13 July mechanism amendment:** the
> [incentive and integrity reintegration plan](tokenless-incentive-integrity-reintegration-plan-2026-07.md) supersedes
> this report where it treats the current prediction-only score as a candidate production mechanism or World ID as
> merely optional for RateLoop-network supply. The market findings remain current; paid network/hybrid launch now
> requires World ID 4, a vote-linked fixed RBTS bonus, and prospective correlation integrity epochs.

**Date:** 13 July 2026

**Status:** Product recommendation and validation plan, not proof of product-market fit. The dependency-ordered implementation is in the [human-assurance redesign plan](tokenless-human-assurance-redesign-plan-2026-07.md).

**Scope:** The `tokenless` product line only. The legacy token/governance product and `rateloop.ai` deployment are not treated as constraints or launch channels.

## Executive recommendation

RateLoop should become **a B2B human-assurance layer for companies deploying AI-enabled workflows**, starting with one narrow job:

> Before an AI-assisted workflow or customer-facing behavior goes live or materially changes, RateLoop returns a blinded multi-rater comparison or go/no-go signal, written reasons, and a portable decision receipt linked to independently verifiable settlement evidence.

The initial market should no longer be defined by whether the customer calls itself “AI-native.” That label unnecessarily limits the addressable market and misses the much larger set of ordinary companies adding AI to support, marketing, sales, operations, and digital products. The market should instead be defined by a repeated workflow: **a company changes AI-generated or AI-mediated output often enough that subjective quality, trust, tone, or usability needs a documented human acceptance test**.

The recommended first route to those companies is **AI implementation consultancies, digital agencies, and AI/software agencies that can reuse RateLoop across multiple client engagements**, alongside a smaller set of direct design partners in AI-enabled software and digitally mature service businesses. The consultancy is the channel and often the operating user; the end-client company is the beneficiary and sometimes the economic buyer. RateLoop should learn both buying arrangements rather than assume one narrow startup persona.

The operating model should nevertheless be **asymmetric B2B2C**:

- businesses fund decisions and buy the workspace, privacy controls, integration, service level, and evidence;
- individual raters supply judgment, earn, calibrate, and form the participant network; and
- public/advisory tasks can acquire and qualify raters, but consumer-funded questions should not become a second primary product before the B2B wedge works.

That combination can create a useful cross-side loop—more relevant active raters improve fill time and buyer value, while more business work improves rater earnings and retention—without forcing RateLoop to market two unrelated demand products.

The initial use cases should be subjective but consequential, repeated across industries, and understandable by an appropriately qualified cohort:

- Which of two customer-support responses is more helpful, clear, and trustworthy?
- Is an AI-assisted sales, service, or internal knowledge workflow acceptable under a short rubric?
- Does a new prompt, model, or process version improve the user or employee experience enough to roll out?
- Does AI-generated campaign, product, or client material match the intended tone and avoid obvious failure modes?

This is **not yet proven PMF**. It is the strongest hypothesis after comparing the current tokenless build with the market. The next milestone should be paid design-partner evidence, not a broad public launch.

The strongest possible moat is also narrower than “blockchain ratings.” It is the combination of **a well-benchmarked sealed rating mechanism, qualified recurring cohorts, and a portable decision receipt whose process and settlement can be independently checked**. The current scoring implementation and privacy posture are not yet strong enough to claim that moat.

### The centralization decision is an advantage for this wedge

The new trust split supports a better B2B product:

- RateLoop can centrally qualify raters, form persistent cohorts, enforce response-quality checks, moderate content, meet service-level objectives, and support private workspaces.
- RateLoop can run a participant-facing acquisition and calibration funnel without admitting every new account directly into paid B2B panels.
- The on-chain core can remain a narrow settlement and evidence layer with no operator path to funds.
- Buyers can use conventional workspaces, invoices/prepaid balances, API keys, and webhooks. x402 remains an optional no-account payment lane for agents, not the main story.

The positioning should therefore be **centralized operations with private-by-default decision evidence and independently verifiable settlement**, not “decentralized market research,” “tokenless crypto,” or “agents paying humans.”

### Revised conclusion after the additional research

Five considerations materially sharpen the original recommendation:

1. **Privacy moves from P1 to P0.** A customer or its consultant may submit unreleased prompts, model outputs, transcripts, campaign material, operating procedures, or user-derived data. “Gated” access is not enough unless RateLoop can explain exactly what the operator, raters, chain observers, subprocessors, and future auditors can see and for how long.
2. **The rating system is a hypothesis to benchmark, not a truth claim.** The current v0 mechanism rewards accurate prediction of the leave-one-out panel share; it is intentionally not a full Robust Bayesian Truth Serum implementation. Its extra prediction input is defensible only if it improves information quality enough to justify rater effort and buyer explanation cost.
3. **Combine B2B demand with B2C supply, not two equal product categories.** The consumer side should initially be the participant product—discovery, practice, qualification, paid tasks, receipts, and earnings—not a general-purpose social polling marketplace competing for roadmap and moderation capacity.
4. **Broaden the customer by workflow, not by making the product generic.** “Small AI-native software company” is a useful direct-sales design partner, but too narrow as the market definition. Consultancies and agencies can aggregate demand from many non-AI-native companies while RateLoop keeps one repeated job: human acceptance and regression evidence for AI-enabled workflows.
5. **A consulting channel creates a conflict-of-interest boundary.** A consultant may implement the workflow and operate the evaluation, but the client must approve the cases, rubric, reviewer source, and acceptance rule. The result must disclose who funded, configured, and interpreted the evaluation. Deterministic settlement can prove that accepted inputs were not changed; it cannot prove that the implementer selected an unbiased test.

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

## Market evidence: the problem is broader than AI-native software

### Ordinary companies are already the larger adoption market

[Eurostat reports](https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20251211-2) that 20.0% of EU enterprises with at least 10 employees used AI in 2025, up from 13.5% in 2024. Written-language analysis and generation were among the most common and fastest-growing uses. In Germany, [KfW Research](https://www.kfw.de/About-KfW/Newsroom/Latest-News/Pressemitteilungen-Details_880896.html) estimates that almost 780,000 SMEs used AI during 2022–2024; adoption reached 36% among companies with more than 50 employees and was strongest in knowledge-based services.

The important gap is between trying AI and operationalizing it. The [OECD's 2025 SME survey](https://www.oecd.org/en/publications/generative-ai-and-the-sme-workforce_2d08b99d-en/full-report/component-4.html) found that only 29% of generative-AI-using SMEs applied it in core company activities; use skewed toward text and simpler, one-off tasks. [U.S. Census Bureau research](https://www.census.gov/library/working-papers/2026/adrm/CES-WP-26-25.html) likewise found AI use across business functions, with sales and marketing, strategy and business development, and IT the most common functions among adopters, while most adopters still used AI in three or fewer functions.

These figures do not prove that hundreds of thousands of companies will buy RateLoop. They do invalidate “small AI-native software companies” as the only plausible demand pool. The better qualification is operational:

> Is there a repeated AI-mediated output, a named decision owner, subjective downside if quality slips, and enough volume or risk to justify a recurring acceptance test?

That qualifier reaches AI product teams, agencies, service companies, e-commerce operations, and internal customer-experience or transformation teams without claiming that every AI user needs an external panel.

The intermediary route is also credible enough to test. The [European Commission's Joint Research Centre](https://joint-research-centre.ec.europa.eu/jrc-news-and-updates/speeding-digitalisation-and-ai-uptake-european-businesses-2025-04-11_en) describes European Digital Innovation Hubs as intermediaries between technology providers and users and reports strong demand for their testing, training, and transformation services. That is evidence that businesses accept help through trusted adoption partners—not proof that private consultancies can resell RateLoop. Paid cross-client pilots remain the required channel test.

### AI-enabled workflows need human validation, but not on every request

[McKinsey's 2025 global AI survey](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/) reports that 51% of respondents at organizations using AI had seen at least one negative consequence, with nearly one-third reporting consequences from inaccuracy. It also identifies defined processes for deciding when model outputs need human validation as one of the practices that most distinguishes AI high performers.

[Anthropic's January 2026 agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) says agent evaluations typically combine code, model, and human graders; subjective rubrics should be calibrated against expert human judgment; and effective teams combine automated evaluation with periodic human review. That supports a **calibration and release-gate layer**, not an expensive human vote on every agent action.

[NIST's AI Resource Center](https://airc.nist.gov/) likewise describes evaluation work that combines expert annotators and human testers, while its [Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) places evaluation inside the AI risk-management lifecycle.

The buying trigger is therefore not “humans are better than AI” or “this company builds AI.” It is:

> Automated checks cover scale; an appropriate human cohort calibrates subjective quality, ambiguous edge cases, and important workflow or release decisions.

### Existing vendors prove demand and expose the competitive bar

- [Scale's enterprise evaluation product](https://scale.com/evaluation/enterprise) combines automated evaluation with an expert human workforce. This validates enterprise demand but also shows that RateLoop should not try to become an entire eval, monitoring, data, and services platform.
- [Braintrust human review](https://www.braintrust.dev/docs/annotate/human-review) puts structured feedback from end users, subject-matter experts, and product teams alongside experiments, traces, and datasets. This makes Braintrust-like platforms logical integration partners: RateLoop can supply an **external panel scorer** rather than rebuild observability and dataset management.
- [Prolific for AI](https://www.prolific.com/ai) markets API-first access to more than 300,000 verified participants, more than 300 screeners, AI taskers, and domain experts. Its [2026 corporate pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing) adds a 42.8% platform fee to participant rewards. This validates both budget and the importance of supply quality, while setting a high bar for targeting and participant operations.
- [PickFu's survey product](https://www.pickfu.com/docs/product/surveys-overview) offers large consumer panels, targeting, multiple research formats, and written explanations. Its [MCP product](https://www.pickfu.com/docs/developers/mcp-server) lets assistants create surveys and retrieve results, while its developer surface includes CLI and API automation. **Agent-native polling is already table stakes, not a RateLoop moat.**
- [Wynter](https://wynter.com/products/message-testing) specializes in B2B message testing with role, industry, company-size, and regional targeting. Its [pricing](https://wynter.com/pricing) starts at $20,000 per year for Pro and reaches $100,000 per year for managed research. The lesson is that specialization and audience relevance create willingness to pay; “verified people” alone do not.
- [PausePoint](https://www.pausepoint.dev/) offers a single known human's approve/reject checkpoint for agents starting at $29 per month. RateLoop should not compete for simple owner approvals: a multi-rater external panel is slower, more expensive, and not authorized to approve a company's irreversible action.

### Enterprise privacy and audit logs are part of the competitive bar

[Braintrust's current security documentation](https://www.braintrust.dev/docs/security) illustrates what established AI-evaluation buyers can already ask for: project-level access controls, encryption, hashed API keys, customer-cloud or self-hosted data planes, region control, configurable retention, exports, SOC 2 documentation, and DPAs. Its [enterprise audit logging](https://www.braintrust.dev/docs/admin/audit-logs) records administrative changes and can optionally log reads. RateLoop does not need that full enterprise surface for a small design-partner pilot, but it does need a credible security and data-flow answer before asking customers to upload unreleased AI artifacts.

The [EDPB's final blockchain-data guidelines, adopted 7 July 2026](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en), make this more than a procurement preference. They require controllers to justify why a public blockchain is necessary, assess the required level of publicity, minimize on-chain data and publicity, and design for erasure and rectification. The guidelines say transaction identifiers, event logs, receipts, state transitions, and smart-contract storage can be personal data when a natural person can be identified. They also distinguish a plain hash—which may remain personal data—from a correctly constructed hiding commitment whose witness can later be deleted.

The practical conclusion for RateLoop is:

> The chain may prove that accepted inputs and money were not silently changed; it must not become the customer's document store, full audit log, identity graph, or default publication channel.

[Article 12 of the EU AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en) reinforces buyer demand for appropriate traceability and event logging for high-risk systems, while Article 14 addresses human oversight. This can create interest in exportable human-review evidence, but RateLoop must not imply that a panel receipt by itself makes a customer's AI system compliant or that every target customer is in the high-risk category.

### The rating mechanism is promising, but its uniqueness must be earned

RateLoop's product flow is unusual: raters submit a sealed binary choice plus a coarse prediction of the panel share; every valid reveal receives an equal base payout; a bounded bonus rewards prediction accuracy; and settlement is deterministic. This is meaningfully different from a bare majority poll.

It should not yet be marketed as a “truth serum” or proof of accuracy:

- The checked-in [`TokenlessScoring`](../packages/foundry/contracts/tokenless/libraries/TokenlessScoring.sol) explicitly implements squared-error prediction accuracy against the leave-one-out panel share and says it is **not** a full RBTS implementation.
- The academic [Robust Bayesian Truth Serum for Small Populations](https://ojs.aaai.org/index.php/AAAI/article/view/8261) supplies useful theory for small binary panels, but its incentive guarantees depend on model assumptions such as shared priors and strategic behavior. Those guarantees do not automatically transfer to RateLoop's five-bucket transform, written rationales, heterogeneous cohorts, or collusion environment.
- Peer-prediction research also documents the risk of multiple equilibria, including uninformative agreement. [Kong, Schoenebeck, and Ligett](https://authors.library.caltech.edu/records/fe520-djp54) show why making truthful reporting focal requires careful mechanism design; merely having truth-telling as one equilibrium is insufficient.

The differentiated claim should therefore be **sealed independent judgment with an incentive-aware prediction signal**, followed by empirical evidence. The public methodology must state what the score measures, the assumptions it makes, what it cannot detect, and when a simple equal-pay majority performs just as well.

### x402 is useful plumbing, not the market

[Coinbase describes x402](https://docs.cdp.coinbase.com/x402/welcome) as accountless, programmatic payment for APIs and AI agents. That makes x402 a valuable optional acquisition and payment path. It does not prove that autonomous agents independently buy research, that they have meaningful budgets, or that buyers choose an evaluation provider because it settles in USDC.

The near-term economic buyer remains a company. The agent is a calling client acting within the company's budget and policy.

## Candidate wedge assessment

Scores are directional judgments from 1 (poor) to 5 (strong). Weights reflect a pre-PMF company that should exploit current assets without walking into a market dominated by scale and procurement. The candidates are jobs, not company identities.

| Candidate wedge | Pain and frequency (25%) | Current product fit (20%) | Differentiation (20%) | Budget evidence (15%) | GTM reachability (10%) | Feasibility (10%) | Weighted score |
|---|---:|---:|---:|---:|---:|---:|---:|
| Human assurance for AI-enabled workflow and release decisions | 5 | 4 | 4 | 4 | 4 | 3 | **83/100** |
| Confidential creative/message pretesting | 4 | 3 | 2 | 4 | 3 | 3 | **64/100** |
| Simple human approval checkpoints for agents | 5 | 2 | 1 | 2 | 4 | 4 | **59/100** |
| General agent-created consumer polls | 3 | 4 | 1 | 3 | 3 | 4 | **58/100** |
| High-stakes expert or compliance review | 5 | 1 | 2 | 5 | 2 | 1 | **58/100** |
| Public/social “verified verdicts” | 2 | 4 | 3 | 1 | 3 | 2 | **51/100** |

### 1. Recommended: human assurance for AI-enabled workflow and release decisions

Why it leads:

- The buyer problem is repeated whenever a company or its implementation partner changes a model, prompt, workflow, or AI-generated customer/employee experience.
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

> **Human assurance for AI-enabled workflows**

Recommended one-line description:

> Test an AI-assisted workflow or output change with the right human cohort. Get a blinded comparison, written reasons, and a verifier-ready decision receipt before rollout.

Recommended job-to-be-done:

> When automated checks and internal reviewers cannot confidently resolve a subjective workflow or release decision, give me a fast human signal from the right reviewer source that my team can inspect and my systems can consume.

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

## Customer and channel strategy

### Define the customer by the workflow

The first end client should usually have 20–500 employees or equivalent workflow volume, but company size is a proxy rather than the definition. A qualifying company:

- runs a repeated customer- or employee-facing workflow containing AI-generated or AI-mediated output;
- changes the model, prompt, sources, automation, or operating process often enough to require regression checks;
- has a named business owner who can approve test cases, reviewer provenance, and the final decision;
- has subjective criteria such as clarity, usefulness, tone, trust, preference, or escalation quality that objective tests cannot fully resolve;
- can submit representative, redacted, or synthetic cases under a workable confidentiality model; and
- has enough frequency, downside, or client value to pay for more than a one-off poll.

This includes AI-enabled SaaS, customer-support operations, digital agencies, B2B service firms, e-commerce brands, and internal AI/transformation teams. It excludes companies that merely allow employees to use a chatbot without a repeated owned workflow.

### Prioritize three routes to demand

Scores are directional, using repeat demand (25%), ability to aggregate demand (25%), current product fit (20%), budget (15%), and near-term reachability (15%).

| Route | Who operates RateLoop | Typical beneficiary | Score | Recommendation |
|---|---|---|---:|---|
| AI consultancies, AI/software agencies, and digitally mature agencies | Consultant, agency AI lead, or delivery team | Multiple client companies | **90/100** | Primary channel and paid design-partner route |
| AI-enabled SaaS and software companies | Product, evaluation, or applied-AI team | The company and its users | **81/100** | Primary direct design-partner route |
| Digitally mature service, e-commerce, CX, and marketing teams | Workflow owner, operations lead, or transformation team | The company, employees, and customers | **75/100** | Expand through validated templates and partner introductions |
| Large enterprise direct | Central AI, innovation, or risk team | Multiple business units | **65/100** | Defer broad selling until security and procurement maturity improve |
| Microbusinesses with occasional AI use | Owner | One local business | **57/100** | Avoid as a core segment; weak frequency and project economics |

The top score does not mean “build software for consultants.” It means consultants can be a lower-friction distribution and learning channel because one relationship can expose RateLoop to multiple end-client workflows. The product primitives—projects, artifact comparisons, cohorts, evidence, privacy, and recurring suites—must remain useful to direct customers too.

### Buyer, operator, beneficiary, and decision owner

- **Channel/economic buyer:** consultancy founder, AI practice lead, agency owner, or delivery lead buying evaluation capacity for client work.
- **Direct economic buyer:** Head of AI, Product, Customer Experience, Operations, Marketing, Digital Transformation, or a business-unit leader.
- **Daily operator:** consultant/project lead, evaluation engineer, applied-AI engineer, product manager, or workflow owner.
- **End beneficiary:** the client company whose workflow and customer/employee experience are being evaluated.
- **Final decision owner:** a named person at the end-client company; neither RateLoop nor the consultant should be represented as authorizing the rollout.

The [AI Consulting + RateLoop strategy](ai-consulting-rateloop-integration-strategy-2026-07-13.md) defines the complementary service motion: consulting discovers and implements the workflow; RateLoop provides the repeatable evaluation and evidence layer during the pilot and after the consultant leaves.

### Disqualifiers for the first year

- a requirement for statistically representative public-opinion research;
- medical, legal, financial, employment, safety, or regulatory sign-off;
- a need for thousands of annotations per day;
- a need for dozens of narrow domain-expert categories before the first run;
- use cases where the respondent must be an authorized employee;
- secrets that cannot be shown to RateLoop or eligible raters; and
- procurement that requires mature SOC 2, SSO/SAML, VPC, and enterprise indemnity before a pilot; and
- a consultant who has no repeated client workflow, will not disclose its role in designing the test, or wants the result to function as its own unqualified “independent certification.”

## How B2B and B2C should combine

RateLoop is already structurally a two-sided market: funders need relevant available raters, and raters need enough suitable paid work. Classic platform research describes the coordination problem as getting both sides on board; see [Rochet and Tirole](https://onlinelibrary.wiley.com/doi/pdf/10.1162/154247603322493212). But a startup does not need to expose both sides as equally open markets. [Hagiu's merchant-versus-platform analysis](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=950100) suggests tighter intermediation can be preferable when chicken-and-egg and quality problems are severe.

That maps well to RateLoop: operate the rater side as managed, qualified supply while the buyer side remains a focused B2B service.

| Surface | Primary user | Initial job | Commercial role | Visibility |
|---|---|---|---|---|
| Buyer workspace/API | Consultancies, agencies, and internal AI/workflow teams | Run private workflow and release evaluations in client-isolated projects | Revenue side: subscription + execution + participant costs | Private by default |
| Rater app | Individual participants | Qualify, receive tasks, judge, explain, and earn | Supply side: paid per accepted work | Only assigned context |
| Advisory/practice feed | Prospective raters | Learn the mechanism and demonstrate quality | Acquisition and calibration cost | Public or synthetic content only |
| Customer-invited cohort | Customer's users, experts, or community | Judge context where external generalists are insufficient | Premium cohort orchestration | Customer-scoped |
| Public result artifact | Any viewer | Inspect an opted-in, redacted example | Proof and acquisition | Explicit customer opt-in only |
| Consumer-funded questions | Individual buyers | Buy a personal panel | **Deferred experiment, not launch scope** | Public or separately governed |

### Why not launch two equal demand products

A general consumer asking product creates a different roadmap: low-price checkout, consumer withdrawal rights, public-content moderation, spam, virality, social discovery, and a much wider set of panel topics. The tokenless legal design is deliberately B2B-only on the funding side, and the existing research found weak evidence that consumers will repeatedly fund serious panels. Opening consumer funding now would dilute the release-gate wedge and reopen legal work without solving B2B demand.

The useful B2C contribution is instead **rater network growth**:

1. Anyone can see public/synthetic practice tasks and learn the two-input rating flow without tax or payout setup.
2. Advisory performance, gold questions, comprehension, and minority-calibration evidence determine access to paid panels.
3. Paid-task unlock happens before the first paid voucher, as the design of record already requires.
4. Qualified raters join explicit cohorts; buyers purchase a cohort and service level, not undifferentiated “users.”
5. Opted-in public cases and rater referrals can grow the network, while private customer work never becomes feed content.

This creates one product with two journeys, not one blended feed. The buyer navigation should lead with “Evaluate,” and the participant navigation with “Earn by rating.” Their authentication, data terms, analytics, and success metrics should remain distinct.

### Measure liquidity, not registered users

Total signups are a vanity metric for this product. The unit of supply is a **qualified, recently active rater in a specific cohort and time window**. Track:

- qualified active raters per target cohort over the last 7 and 30 days;
- invite-to-start and start-to-valid-reveal conversion;
- median and 90th-percentile time to fill each cohort/panel size;
- accepted-work, quorum-failure, and repeat-participation rates;
- buyer demand hours versus available rater hours;
- gold-question performance, disagreement structure, and appeal overturns; and
- concentration: how much of each verdict comes from the same identity, device, referral, geography, or behavior cluster.

Recruit supply against signed design-partner demand. A large generic crowd does not help if one client needs German e-commerce customers, another needs English-speaking weekly AI users, and an internal workflow requires customer-invited employees. Broadening demand makes explicit reviewer provenance and cohort operations more important, not less.

## Privacy and auditability: use layered evidence

Privacy is the central product risk created by combining confidential B2B work with a public settlement layer. It is also a chance to design a better product boundary than either “everything is on-chain” or “trust our database.”

### The four evidence planes

| Plane | Contents | Access | Purpose |
|---|---|---|---|
| Public settlement plane | Randomized round identifiers, necessary economic terms, one-time vote keys, commitments, revealed numeric vote/prediction data, settlement, and claims | Public chain | Prove accepted inputs and fund movement followed the immutable rules |
| Private decision plane | Candidate artifacts, prompts/transcripts, rubric, written rationales, cohort qualifications, moderation records, result interpretation, and access events | Customer workspace, assigned raters only while needed, authorized RateLoop operations | Make the decision useful without publishing customer IP or personal data |
| Portable evidence packet | Canonical manifest linking salted/keyed content commitments, mechanism version, cohort claims, private results, signed service events, and public transaction references | Customer-controlled export; selectively shared with an auditor | Verify a specific decision without granting public access to the underlying material |
| Public proof artifact | Redacted case, methodology, cohort summary, result, and verifier link | Anyone | Marketing and public accountability only with explicit customer opt-in |

The chain proves process integrity and financial conservation. The private evidence packet explains the business decision. Neither proves that the panel is objectively correct, representative, free of coordinated raters, or sufficient for regulatory sign-off.

### Public-chain leakage that must be threat-modelled

Keeping raw content off-chain is necessary but not sufficient. A public observer may still see timing, transaction volume, bounty size, panel size, one-time keys, revealed votes and predictions, settlement outcome, and later payout movement. Those facts can become sensitive when correlated with a known launch, leaked customer mapping, reused destination, relayer behavior, or a low-entropy content hash.

Before a B2B pilot, document every on-chain field and event and classify whether it can expose:

- the customer's identity, release cadence, spend, or existence of a sensitive project;
- a rater's identity, opinion, earning, location proxy, or activity pattern;
- the artifact or question through a dictionary attack on a predictable hash;
- cohort composition or a confidential business outcome; or
- linkage across rounds through funding, relaying, claims, or timing.

Mitigations should include high-entropy keyed hashes or hiding commitments rather than raw predictable hashes; no customer/project names, URLs, rationales, stable rater IDs, or qualification details in events; one-time vote keys and user-controlled per-round payout destinations; relayed/sponsored commits; off-chain retention and deletion; and a data-flow/DPIA review before real money. Even after those measures, the product must disclose the residual public metadata honestly.

### A private audit log can still be independently verifiable

Enterprise “audit trail” normally means authenticated, access-controlled records that can be exported and retained according to policy—not public disclosure. RateLoop should provide a tenant audit log for workspace actions and data reads, then make the log tamper-evident with signed canonical events and Merkle roots. Public anchoring can be batched, or the existing round commitment can bind the private manifest.

This is a standard cryptographic pattern rather than a reason to publish the payload. [RFC 9162 Certificate Transparency](https://www.rfc-editor.org/rfc/rfc9162.html) specifies Merkle inclusion and consistency proofs, and [Sigstore's Rekor](https://docs.sigstore.dev/logging/overview/) shows how third parties can verify an append-only log. RateLoop's advantage would be applying comparable evidence discipline to the **whole human-decision receipt** and linking it to deterministic non-custodial payment—not merely using a blockchain.

### Confidentiality modes

Use explicit modes rather than one ambiguous “gated” flag:

1. **Public panel:** context and result may be public; still no unnecessary rater identity exposure.
2. **Private managed panel — default B2B mode:** RateLoop and assigned raters can see redacted context under confidentiality terms; result and rationales stay tenant-private; only minimal commitments and settlement data are public.
3. **Customer-invited panel:** the customer supplies employees, users, community members, or experts; RateLoop orchestrates blinded scoring and settlement. This solves audience relevance for some cases but is not an independent external panel unless labeled accordingly.
4. **Customer-controlled data plane — later enterprise mode:** sensitive artifacts stay in customer-controlled storage or infrastructure and are delivered ephemerally to approved raters. This is a P2 feature, not something the current architecture can promise.

The default contract should prohibit training on customer content, unrelated secondary use, and public result publication. It should specify controller/processor roles, subprocessors, access logging, rater confidentiality, breach handling, residency, retention, deletion, and export. Written rationales need stronger review and redaction controls than binary votes because they can repeat sensitive source material.

Rater privacy is a separate promise. [Prolific's current researcher rules](https://researcher-help.prolific.com/en/articles/445117-can-i-ask-participants-for-their-personal-information-identifiers) treat participant anonymity as a core requirement and restrict attempts to collect identifying data. RateLoop buyers should receive task-relevant qualification attestations and opaque participant references, not tax identity, wallet/payout details, vote keys, unrelated cross-customer history, or a route to contact and profile raters directly.

### Privacy can improve the wedge

Do not sell privacy as “the blockchain is anonymous.” Sell a concrete private-workspace promise:

> Your prompts and artifacts stay in the assigned private panel. The public layer contains only the minimum evidence and settlement data described in our data map. You receive a portable receipt that your team can verify and selectively share.

If design partners still reject the residual public metadata, that is a product-level signal to reopen the evidence architecture before mainnet—not a copy problem. A signed private transparency log plus a narrower public funds layer may be more valuable than insisting every element of the decision be publicly recomputable.

## Product gaps to close for the recommended wedge

### P0: required for a credible design-partner pilot

1. **Finish the existing live-product gates.** Complete fresh Base Sepolia deployment, deployment-key propagation, automated pipeline driving, smoke E2E, and the rater/funder post-submit loops from the readiness assessment.
2. **Add evaluation context and artifacts.** The current [`TokenlessQuestion`](../packages/sdk/src/tokenlessTypes.ts) carries a prompt and labels but no source artifact, response pair, transcript bundle, rubric, URL, or image. A workflow or release decision cannot be judged from a bare sentence.
3. **Guarantee the rater type.** The current [landing page](<../packages/nextjs/app/(public)/page.tsx>) says “Human and AI raters guide decisions.” The recommended product needs an explicit **verified-human panel** mode. Synthetic or agent raters can remain in a labeled sandbox, but must never be mixed into a human-calibration result.
4. **Add job-relevant cohorts.** Current audience selection is identity assurance (`selfie`, `passport`, `orb`, `presence`). The buyer needs language, geography, AI-tool familiarity, role/industry when applicable, and repeat-cohort controls. Personhood is an input to quality, not the finished audience product.
5. **Return decision evidence, not a magic confidence score.** For small panels, expose sample size, cohort definition, vote split, rationale themes, disagreement, completion/failure state, and methodology. Do not imply statistical representativeness from an opaque `confidenceBps` field.
6. **Orchestrate an eval run.** Add an off-chain run object that groups multiple binary/A/B rounds, tracks a release candidate or experiment, and emits one webhook summary. This need not expand the fund-holding contract.
7. **Capture evaluation provenance and client acceptance.** Record who funded the work, selected cases, wrote the rubric, chose the cohort, operated the run, interpreted the result, and owned the final decision. For concierge pilots, a signed client approval of the manifest is enough; do not build a full consultant portal before repeated demand.
8. **Make private-by-default evidence a launch gate.** Complete the field/event-level public-metadata threat model, DPIA/data map, keyed commitment scheme, per-rater mapping encryption, tenant access controls, deletion/retention path, and a clear managed-panel confidentiality contract before accepting private customer artifacts. Consultant access must be scoped to its client engagement rather than an undifferentiated agency account.
9. **Benchmark the scoring mechanism.** Label v0 correctly as consensus-prediction accuracy, publish worked examples, and compare it in sandbox/concierge studies with equal-pay simple majority. Measure task time, completion, comprehension, honest minority preservation, repeatability, manipulation response, and whether the prediction bucket changes the business decision.
10. **Stand up one managed supply cohort.** Recruit and qualify only the rater segment required by the first design partners; implement the advisory/practice funnel, active-capacity metrics, task notifications, receipts, and a minimum fill-rate operating playbook.

### P1: required for repeated paid use

1. reusable templates for response-pair preference, release acceptability, tone/brand fit, and support-agent quality;
2. private persistent cohorts and optional customer-supplied expert groups;
3. adapters/export for at least one eval platform rather than a new tracing system;
4. workspace budgets, usage controls, invoices/receipts, and conventional funding through a regulated partner;
5. rater calibration, gold questions, cohort-quality dashboards, and published service-level data;
6. a signed, exportable evidence packet plus workspace access/read audit logs;
7. data retention controls, customer deletion workflows, DPA/subprocessor documentation, and security basics expected for private model outputs;
8. a result comparison view across releases, workflows, prompts, cohorts, and time;
9. customer-invited cohorts with explicit labels separating internal, community, and independent external panels; and
10. a consultant/agency portfolio with hard client-workspace isolation, cost allocation, client guest review, and reusable templates after at least two paid multi-client pilots request it.

### P2: only after customer pull

- domain-expert credentials;
- audio/video and interactive agent-trajectory review;
- representative sampling;
- SSO/SAML and formal enterprise security packages;
- customer-controlled/BYOC data planes and regional deployment options;
- a native integration marketplace;
- white-label or reseller panel infrastructure; and
- production mainnet hardening beyond what actual usage requires.

## Differentiation: what must be true

RateLoop cannot rely on “real humans,” “API access,” “MCP,” “fast feedback,” or “written explanations.” Competitors already sell all of those.

It also cannot rely on “audit logs” or “immutable records” alone. Enterprise software already provides controlled audit logs, while signed hash chains and Merkle transparency systems can deliver tamper evidence without a public blockchain. The public chain is justified only where the independent funds and accepted-input guarantees matter.

The defensible product thesis has three reinforcing layers:

### 1. Mechanism advantage

1. sealed choices that prevent visible copying during the panel window;
2. a coarse prediction signal that may expose surprising minorities and inattentive consensus-following;
3. a guaranteed equal base payout so every accepted participant is compensated, with only a bounded incentive-aware bonus; and
4. deterministic, versioned aggregation that a buyer can recompute.

This layer becomes a moat only after an external benchmark shows when it outperforms a simpler panel. Do not use “truth,” “accuracy,” or “wisdom of crowds” as shorthand for a squared-error consensus prediction.

### 2. Cohort and operations advantage

1. **external** raters rather than only the customer's team;
2. **persistent, measured cohorts** rather than anonymous one-off crowd supply;
3. qualification based on task-relevant calibration, not personhood alone;
4. cohort fill-time and quality operations that improve with repeated B2B demand; and
5. customer-invited panels when the required audience cannot be recruited generically.

The compounding asset is the consented quality history needed to form reliable cohorts—not customer prompts, private rationales, or a raw count of verified identities.

### 3. Evidence advantage

1. a private, portable decision packet connecting artifact, rubric, cohort claims, responses, mechanism version, and result;
2. a tamper-evident tenant action/access log;
3. an explicit provenance record naming the funder, test designer, operator, reviewer source, interpreter, and client decision owner;
4. independently verifiable accepted-input and financial settlement references; and
5. an optional redacted public artifact, never automatic publication.

Together, the product remains:

> Small, repeated, private-by-default human-assurance panels for AI-enabled workflows, with explicit reviewer provenance, a measurable incentive mechanism, and a verifier-ready receipt.

The evidence layer proves what was submitted, accepted, scored, and paid under the declared process. It does **not** prove that a consultant selected representative cases, wrote a neutral rubric, or interpreted disagreement fairly. Client approval, provenance disclosure, blinded assignment, and later outcome comparison are the safeguards for those risks.

This thesis must be tested. If buyers do not pay more, adopt faster, or trust results more because of the mechanism, cohort quality, independence, and evidence, the chain layer is implementation complexity rather than differentiation. If customers value the evidence but reject public per-round metadata, preserve non-custodial settlement and redesign the publication boundary.

## Business model recommendation

Do not rely on the 7.5% bounty fee.

The current browser “Quick pulse” preset uses a $25 bounty and a $5 attempt reserve. At 7.5%, RateLoop earns only **$1.875** in platform fee on a successfully settled panel. Even 100 such panels per month would produce only **$187.50** of fee revenue before infrastructure, support, rater operations, failed rounds, or acquisition cost.

Recommended pricing architecture:

1. **Participant compensation and reserve:** pass-through, clearly itemized.
2. **Execution fee:** retain the current transparent percentage for settlement and payment execution.
3. **B2B software subscription:** charge for private workspaces, reusable cohorts, run history, webhooks, team budgets, integrations, analytics, and service levels.
4. **Managed evaluation:** optional higher-priced rubric/cohort setup for customers without evaluation expertise.
5. **x402:** optional per-run or per-result lane for programmatic buyers without an account.

Use two commercial paths without creating two products:

- **Channel-led:** a consultancy or agency includes clearly itemized RateLoop evaluation in a paid implementation pilot, then buys recurring execution or workspace capacity across client-isolated projects.
- **Direct:** an internal product, CX, marketing, operations, or AI team buys the same evaluation runs and evidence without the consulting layer.

The companion [AI Consulting + RateLoop strategy](ai-consulting-rateloop-integration-strategy-2026-07-13.md) describes the larger implementation-pilot and Quality Loop pricing hypotheses. RateLoop participant and evaluation costs should remain visible on those proposals so the product is not mistaken for a free consulting add-on.

The participant app is not a second subscription business in the first year. Raters should never pay, stake, or buy premium access to paid work. Practice tasks, qualification, notifications, and receipts are supply-acquisition and quality costs funded by the B2B economics. Consumer-funded asks can be tested later under a separate legal and product gate; do not use them to subsidize an unproven B2B funnel.

Pricing hypotheses to test—not publish as final pricing:

- Design partner: $250–$500 per month plus participant costs for a limited number of runs.
- Team: $500–$1,500 per month plus participant costs for private cohorts, history, webhooks, and budgets.
- Managed: fixed setup/run fee based on cohort and rubric complexity.

The first proof is not whether a founder or consultant says that $500 sounds reasonable. It is whether a channel partner or internal team pays, runs the workflow repeatedly, and uses the result in an actual rollout decision.

## Go-to-market recommendation

### Design-partner offer

> We help you prove that an AI-assisted workflow is good enough to roll out. Send representative baseline and candidate outputs plus a short rubric; we return a blinded human comparison with reasons, disagreement, provenance, and a private verifier-ready result.

For the first three to five partners, run this as a concierge service even if some workflow steps are manual. The product should learn the repeated schema before automation hardens it.

### Where to find the first partners

- DACH AI implementation consultancies and AI/software agencies with at least two active client workflows;
- digital and marketing agencies already producing AI-assisted customer content and able to become a repeated channel;
- founders and product leads of customer-facing AI-enabled software companies;
- customer-experience, support, marketing, operations, and digital-transformation leaders in digitally mature service or e-commerce companies;
- evaluation/platform engineers already using Braintrust, LangSmith, Langfuse, Arize, or home-grown evals;
- teams launching support, research, voice, content, or internal knowledge workflows; and
- Base/x402 builders only where they also have a real evaluation need.

Do not lead acquisition with rater earnings or crypto communities. Demand discovery should start where AI release quality is discussed.

### Channel-led land and expand

1. **Land with a paid workflow-selection or implementation pilot.** The consultant and client define the current process, representative cases, measurable objectives, subjective rubric, reviewer source, and stop conditions before the candidate is built.
2. **Use RateLoop for the acceptance comparison.** Run deterministic checks first, then use the relevant external, customer-invited, or internal cohort only for criteria that require judgment.
3. **Convert to a recurring Quality Loop.** Freeze the cases and rerun them when prompts, models, sources, or workflow rules change.
4. **Expand through the channel.** After one consultancy repeats the same schema for two client-isolated projects, test portfolio, cost-center, and partner features. Do not build white-labeling from verbal interest.

The client must approve the evaluation manifest and own the final decision. RateLoop should describe the panel as procedurally independent only when the reviewers are external to the implementer and client; it should never describe the whole engagement as independent if the implementing consultant chose the cases and rubric without client governance.

### Supply-side launch strategy

Run supply acquisition against the first partners' actual panel definition:

1. choose one narrow starter cohort, such as English-speaking people who use AI assistants weekly;
2. recruit enough recently active qualified raters to fill the target panel with a buffer, then stop broad acquisition until demand catches up;
3. use public/synthetic advisory tasks to teach the rating flow and measure comprehension without exposing customer material;
4. invite strong advisory raters to paid-task unlock only when paid capacity exists;
5. schedule availability windows and notifications so work arrives predictably without manufacturing streaks or leaderboards; and
6. use referral source, device/identity clusters, gold drift, and rationale similarity as quality signals, never as undisclosed retroactive payout controls.

Keep one RateLoop brand but two explicit entry paths. The participant landing page can grow users and trust, while the buyer site remains focused on evaluation outcomes, privacy, integration, and evidence. Do not merge private B2B work into a public social feed to create apparent activity.

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

### Weeks 1–2: two-sided buyer interviews, no new protocol work

Interview 18–24 people across both routes:

- 8–10 AI consultants, AI/software agencies, or digitally mature agencies that could reuse the workflow across clients;
- 8–10 end-client decision owners in software, services, e-commerce, CX, marketing, operations, or transformation; and
- 2–4 evaluation/product practitioners who can pressure-test the methodology.

Ask for the last real workflow or release decision, not opinions about the concept.

Questions:

1. What AI-assisted workflow or output change did you hesitate to roll out in the last month?
2. What evidence did you use and who reviewed it?
3. How long did the decision take and what delayed it?
4. Where did automated graders and internal review disagree?
5. Would an external general-user or AI-power-user cohort have been competent to judge it?
6. What context could leave your systems, and under what confidentiality terms?
7. Would a blinded/auditable process change trust or procurement?
8. What would you pay to resolve that exact decision within four hours?
9. Which facts may be public: the existence of the run, timing, panel size, budget, individual numeric votes, result, or none?
10. Would a signed private evidence packet plus minimal public settlement proof satisfy the audit need better than a public result?
11. When do you need independent external users, your own customers/community, or internal subject-matter experts?
12. Does a prediction-based incentive make the result more credible, less understandable, or neither?
13. For consultants: how many current clients share this problem, who would pay for the evaluation, and could the same project/run schema be reused?
14. For end clients: would you trust an evaluation operated by the implementer, and what approvals or disclosures would make its result decision-useful?

Success gate: at least six interviewees provide a recent qualifying artifact; at least two channel partners identify two real client opportunities each; at least three end clients agree to a live design-partner run; and those partners accept one documented privacy and provenance mode without requiring an entirely different enterprise architecture.

### Weeks 3–5: concierge pilot surface

Build only the minimum P0 additions around the existing API:

- A/B artifact bundle;
- one rubric with at most three dimensions;
- explicit human-only panel;
- one qualified cohort such as English-speaking weekly AI-tool users;
- result with split, reasons, disagreement, and evidence;
- a private-by-default artifact store, customer-visible access log, retention control, and signed exportable evidence manifest;
- a rater practice/qualification path using only public or synthetic content; and
- one eval-platform export or generic webhook example; and
- a signed evaluation manifest recording funder, case/rubric author, operator, reviewer source, acceptance rule, interpreter, and client decision owner.

Use sandbox/test funds until the production-readiness gates for real money are closed.

### Weeks 6–9: run repeated partner decisions

Target at least two channel partners across three client-isolated projects, plus one direct design partner, and run at least three real workflow or release decisions per end client. Compare:

- internal reviewer decision;
- LLM-judge result;
- RateLoop panel result; and
- eventual production/user signal when available.

Measure turnaround, completion, cohort quality, disagreement, decision change, time saved, and repeat usage. Do not market agreement with internal reviewers as accuracy; the purpose is to learn when each signal is useful.

In sandbox or matched low-risk runs, compare the five-bucket prediction interaction with a simple equal-pay version. Measure completion time, abandonment, rater comprehension, payout dispersion, stability across repeats, minority-signal preservation, buyer understanding, and whether either result better predicts later user evidence. Do not silently run two paid mechanisms with different terms inside one panel.

For privacy, record what each partner actually submits, what must be redacted, who accesses it, which public metadata they reject, and whether the portable evidence packet is used. For supply, measure cohort-specific fill latency and active capacity rather than total signups.

### Weeks 10–12: charge and decide

Ask every active partner to move to a paid monthly design-partner plan plus participant costs.

Continue the wedge if:

- at least two channel partners or direct customers pay for RateLoop as an explicit part of a project rather than receiving it as a free extra;
- at least one channel partner repeats the evaluation schema across two client-isolated projects;
- at least three end-client decision owners use the result or reasons in a real go, revise, or stop decision;
- at least two customer organizations run five or more panels in a month;
- at least half of active partners return within 30 days;
- at least 30% of runs either change a decision or materially resolve documented disagreement;
- median end-to-end turnaround is below four hours during concierge supply;
- private-context/security requirements are achievable without an enterprise rebuild;
- every pilot can identify exactly what is public, private, retained, and deleted, with no critical leakage finding left unresolved; and
- the starter cohort can fill the promised panel size repeatedly without depending on one small referral or behavior cluster.

Reconsider or stop if:

- consultants express interest but cannot attach RateLoop to paid client work;
- end clients treat implementer-operated evidence as conflicted even with approved manifests and external reviewers;
- every segment requires a different artifact, cohort, report, and sales motion before any one pattern repeats;
- teams say their own staff or users are always the only credible judges;
- buyers want bulk annotation rather than release decisions;
- PickFu/Prolific solve the job well enough with less friction;
- auditability and blinded independence do not influence purchase or trust;
- customers reject the residual public settlement metadata or cannot share useful context with external raters;
- the prediction input adds friction without measurable information or incentive benefit;
- the required cohort breadth becomes the entire product before repeat demand exists;
- consumer/advisory signups grow but do not convert into qualified active supply for paid panels; or
- buyers consistently reject wallet/USDC/on-chain mechanics even when hidden behind conventional billing.

## Self-dogfooding and outside validation

The RateLoop ratings workflow would normally be useful for testing the positioning, rater comprehension, and privacy language. It was not used for this report because the available live workflow targets the legacy `rateloop.ai` deployment, while the `tokenless` branch rules prohibit sending tokenless review asks through that product. The isolated tokenless client currently exposes a deterministic sandbox, not an outside-human handoff.

After the isolated tokenless deployment has a real human-panel path, run three separate tests:

1. a **target-buyer test** split between AI consultants/agencies and end-client workflow owners, comparing “human assurance for AI workflows” against narrow “AI release gate” and generic “human judgment for agents” positioning; and
2. a **rater-comprehension test** checking whether first-time raters understand the choice, five-bucket prediction, base/bonus compensation, privacy obligations, and one concrete improvement they would make; and
3. a **buyer privacy test** comparing “publicly auditable result” with “private evidence packet + minimal public settlement proof,” including what metadata each buyer will permit on a public chain.

Each prompt should ask one bounded question and use paid written feedback when the rationale matters. Do not treat a general-rater preference poll as buyer validation. The design-partner payment and repeat-use gates above are the real test.

## Messaging recommendation

### Buyer-first landing-page hierarchy

**Headline**

> Know when an AI workflow is good enough to use.

**Subhead**

> Compare an AI-assisted workflow with your current process. Get blinded human judgment, written reasons, and a verifiable decision receipt before rollout—without publishing your client, prompt, or customer data.

**Primary CTA**

> Validate a workflow

**Secondary CTA**

> Partner with RateLoop

**Rater path**

> Earn by evaluating AI experiences

The rater path should be important but secondary. “For Agents” should describe integration by the buying team's software, not suggest that AI raters are interchangeable with the external human calibration being sold.

Add a channel-specific line below the primary buyer story rather than making “for consultants” the category:

> Implement AI for clients? Add a repeatable acceptance test and recurring quality loop to every workflow you deliver.

Add a short privacy line near the first artifact upload, not only in the footer:

> Private by default. Assigned raters see only the context needed for the task. We document the minimal settlement metadata that becomes public.

Do not say “anonymous,” “zero knowledge,” “fully confidential,” or “GDPR-compliant blockchain” unless the deployed data map and legal assessment support the exact claim.

### Proof section

Show one real case study with:

- the workflow or release question and redacted candidate artifacts;
- cohort definition and panel size;
- blinded result and disagreement;
- representative written reasons;
- the mechanism version and what its prediction score means;
- the public/private evidence boundary and a downloadable verifier-ready receipt;
- the decision the team made;
- turnaround and total cost; and
- eventual user or production evidence.

One credible repeated workflow is worth more than a broad use-case catalog.

## Final decision

**Go B2B2C with a broader customer universe, a narrow workflow job, and a channel-led beachhead.**

The best current PMF hypothesis is:

> RateLoop is the human-assurance layer for AI-enabled workflows, initially distributed through AI consultancies and agencies and sold directly to AI-enabled software and digitally mature business teams that need fast subjective judgment before rollout or production evidence can answer the question.

The market is not “all companies,” and it is not limited to companies that build AI as their product. A customer qualifies when it owns a repeated AI-mediated workflow, has a named decision owner, faces subjective quality risk, can supply safe representative cases, and will pay for recurring evidence. The consultancy channel aggregates those qualified workflows; it does not redefine RateLoop as consulting software.

Businesses are the paying demand side. Consultancies can be buyers, operators, or resellers, while the end-client company remains the beneficiary and final decision owner. Individual raters are the participant/supply product, supported by an open advisory-to-qualified funnel. Public consumer-funded polling and a social result feed remain deferred. This combination can grow demand and panel liquidity without splitting the company between enterprise evaluation and consumer social polling.

The strongest use of the more centralized tokenless architecture is to operate qualified cohorts, private workspaces, quality controls, billing, and service levels. The smart contracts should remain a narrow trust and settlement substrate. The complete decision audit trail should be layered: minimal public settlement evidence, tenant-private artifacts and rationales, a tamper-evident access log, and a portable selectively disclosed receipt. x402 should remain an optional lane. Neither blockchain nor x402 should define the category.

The rating mechanism and auditability can be distinctive together, but the honest current state is:

- sealed choice + crowd prediction is more interesting than a bare poll;
- v0 prediction scoring is not full RBTS and must not be sold as a truth detector;
- a public chain proves process and payment properties, not correctness or representativeness; and
- public permanence creates enterprise privacy risk unless the metadata boundary is designed and tested before real-money B2B use.

The make-or-break discovery question is now broader and more commercially useful:

> Will consultancies and internal workflow owners repeatedly pay for blinded, provenance-rich human evidence when deciding whether an AI-enabled workflow is good enough to roll out or keep running?

Three companion questions are equally load-bearing:

> Can one consultancy reuse the same RateLoop project, cohort, privacy, and report schema across multiple client-isolated engagements?

> Does the prediction-based mechanism produce measurably better decisions or incentives than a simpler panel?

> Can RateLoop provide enough independent evidence while keeping customer content, rater identity mappings, rationales, and commercially sensitive metadata private by default?

The next 12 weeks should answer those questions with partner and end-client interviews, paid workflow pilots, cross-client schema reuse, artifacts, mechanism benchmarks, privacy/provenance reviews, cohort-liquidity data, and repeated usage before RateLoop expands its panel types, consumer-funded asks, protocol, or enterprise surface.

## Source index

### Repo sources

- [Human-assurance redesign plan](tokenless-human-assurance-redesign-plan-2026-07.md)
- [Tokenless architecture and implementation plan](tokenless-immutable-implementation-plan-2026-07.md)
- [Tokenless production-readiness assessment](tokenless-production-readiness-2026-07.md)
- [Legal and revenue reference](legal-revenue-assessment-tokenless-design-2026-07.md)
- [AI Consulting + RateLoop strategy](ai-consulting-rateloop-integration-strategy-2026-07-13.md)
- [Agent package workflow](../packages/agents/README.md)
- [SDK workflow](../packages/sdk/README.md)
- [Tokenless SDK types](../packages/sdk/src/tokenlessTypes.ts)
- [Current landing page](<../packages/nextjs/app/(public)/page.tsx>)
- [Current tokenless scoring implementation](../packages/foundry/contracts/tokenless/libraries/TokenlessScoring.sol)

### External sources

- [Eurostat — 20% of EU enterprises used AI technologies in 2025](https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20251211-2)
- [KfW Research — German SME AI adoption](https://www.kfw.de/About-KfW/Newsroom/Latest-News/Pressemitteilungen-Details_880896.html)
- [OECD — Generative AI and the SME Workforce](https://www.oecd.org/en/publications/generative-ai-and-the-sme-workforce_2d08b99d-en/full-report/component-4.html)
- [U.S. Census Bureau — The Microstructure of AI Diffusion](https://www.census.gov/library/working-papers/2026/adrm/CES-WP-26-25.html)
- [European Commission JRC — Digital innovation hubs as intermediaries for AI adoption](https://joint-research-centre.ec.europa.eu/jrc-news-and-updates/speeding-digitalisation-and-ai-uptake-european-businesses-2025-04-11_en)
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [McKinsey — The State of AI: Global Survey 2025](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai/)
- [NIST — AI Resource Center](https://airc.nist.gov/)
- [NIST — Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [Scale — Generative AI Evaluation for Enterprise](https://scale.com/evaluation/enterprise)
- [Braintrust — Set up human review](https://www.braintrust.dev/docs/annotate/human-review)
- [Braintrust — Security, deployment, retention, and compliance](https://www.braintrust.dev/docs/security)
- [Braintrust — Enterprise audit logging](https://www.braintrust.dev/docs/admin/audit-logs)
- [Prolific — Human data and systems for AI](https://www.prolific.com/ai)
- [Prolific — 2026 pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing)
- [Prolific — Data protection and privacy](https://researcher-help.prolific.com/en/articles/445118-data-protection-and-privacy)
- [Prolific — Participant anonymity and identifier restrictions](https://researcher-help.prolific.com/en/articles/445117-can-i-ask-participants-for-their-personal-information-identifiers)
- [Prolific — Methodological justification and participant quality](https://researcher-help.prolific.com/en/articles/621821-methodological-justification-pack-how-prolific-protects-data-quality)
- [PickFu — Survey product](https://www.pickfu.com/docs/product/surveys-overview)
- [PickFu — MCP server](https://www.pickfu.com/docs/developers/mcp-server)
- [Wynter — B2B message testing](https://wynter.com/products/message-testing)
- [Wynter — Pricing](https://wynter.com/pricing)
- [PausePoint — Human approval API](https://www.pausepoint.dev/)
- [Coinbase — x402 overview](https://docs.cdp.coinbase.com/x402/welcome)
- [EDPB — Final Guidelines 02/2025 on processing personal data through blockchain technologies, 7 July 2026](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en)
- [EU AI Act — Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en)
- [Witkowski and Parkes — A Robust Bayesian Truth Serum for Small Populations](https://ojs.aaai.org/index.php/AAAI/article/view/8261)
- [Kong, Schoenebeck, and Ligett — Putting Peer Prediction Under the Micro(economic)scope](https://authors.library.caltech.edu/records/fe520-djp54)
- [Rochet and Tirole — Platform Competition in Two-Sided Markets](https://onlinelibrary.wiley.com/doi/pdf/10.1162/154247603322493212)
- [Hagiu — Merchant or Two-Sided Platform?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=950100)
- [IETF RFC 9162 — Certificate Transparency Version 2.0](https://www.rfc-editor.org/rfc/rfc9162.html)
- [Sigstore — Rekor transparency log](https://docs.sigstore.dev/logging/overview/)

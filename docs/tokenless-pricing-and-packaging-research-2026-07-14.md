# RateLoop tokenless: Pricing and packaging research (July 2026)

**Status:** Research recommendation and pricing hypotheses for validation. This is not yet an accepted amendment to the
[tokenless design of record](tokenless-immutable-implementation-plan-2026-07.md) or a public rate card. It is aligned
with the [Humans and Agents production redesign](tokenless-humans-agents-production-redesign-plan-2026-07.md), in
which public-network and paid private work use USDC settlement while strictly unpaid private-group work completes
off-chain.

## Executive recommendation

RateLoop should stop treating a USDC transaction fee as the whole business model. The redesigned product has two
different value and cost systems:

1. **Private-group software:** a workspace supplies its own humans. RateLoop provides agent integration, invitations,
   assignment, sealed responses, adaptive review policy, evidence, history, analytics, privacy controls, and audit.
   There may be no USDC transaction at all. Charge a recurring B2B software subscription plus included usage.
2. **Paid human supply and settlement:** RateLoop or the customer recruits compensated humans and incurs payment,
   eligibility, tax, sanctions, support, relay, failed-round, and supply-quality costs. Pass participant compensation
   and the attempt reserve through transparently and retain a separate execution/platform fee.

The recommended launch architecture is therefore:

> **workspace subscription + completed-review usage + participant costs + paid-panel execution fee + optional managed
> services**

Do not charge raters, do not charge per blockchain transaction, and do not meter every API call. The product value is a
completed, evidence-backed review decision, not the number of internal calls or settlement transactions required to
produce it.

### Recommended launch prices

| Plan       |                         Price | Intended customer                                                  | Included production usage                   |
| ---------- | ----------------------------: | ------------------------------------------------------------------ | ------------------------------------------- |
| Free       |                            $0 | Developer evaluation and a small internal proof                    | 25 completed private review decisions/month |
| Starter    | **$299/month** or $2,990/year | One team proving one to three agent workflows                      | 250 completed review decisions/month        |
| Team       | **$799/month** or $7,990/year | A team operating repeated evaluation across agents and groups      | 2,000 completed review decisions/month      |
| Enterprise |         **from $24,000/year** | Security-, retention-, support-, or volume-sensitive organizations | Contracted usage and service level          |

Before publishing all four tiers, sell a **Founding Design Partner** offer at **$299/month for six months**, with Team
features, a 250-decision monthly allowance, and participant costs charged separately. Require a real payment rather
than a letter of intent. Five paid partners are enough to learn whether $299 is too low, too high, or attached to the
wrong value.

For paid public-network and paid private panels, retain the design-of-record starting point of **7.5% of bounty with a
small fixed minimum**. Test a **$2.50 minimum per funded panel**. Bounty and attempt reserve remain separate pass-through
amounts, and the fee follows the existing refund rules. Do not discount or raise the 7.5% rate until live data exists
for supply acquisition, support, screening, relay, failure, and make-good costs. If those costs are not covered, test
10–15% for new price versions rather than hiding the increase in the bounty.

The minimum must remain inside the immutable 20% fee cap: quote the greater of 7.5% or $2.50 only when that effective
fee is at most 20% of bounty, otherwise require a larger bounty or use the capped percentage. At the current $25 preset,
the proposed minimum is 10% and therefore fits.

## What changed in the product economics

The accepted redesign defines these paths:

| Review source                | Compensation | Settlement                               | What RateLoop is selling                                             |
| ---------------------------- | ------------ | ---------------------------------------- | -------------------------------------------------------------------- |
| Customer-owned private group | Unpaid       | Off-chain terminal result; no USDC round | Orchestration, integration, privacy, evidence, policy, and analytics |
| Customer-owned private group | Paid         | USDC bounty, fee, and attempt reserve    | The same software plus compensation and deterministic settlement     |
| Public RateLoop network      | Paid only    | USDC bounty, fee, and attempt reserve    | Software, qualified supply, operations, and settlement               |

The old fee-only model produces no revenue from the first row even though that row can consume the most valuable parts
of the product: workspace isolation, agent policies, secure invitations, artifact delivery, adaptive sampling,
notifications, evidence packets, evaluation history, and audit controls.

The existing 7.5% fee is also too small to be the primary revenue engine. On the current $25 “Quick pulse” bounty it is
$1.875. One hundred successfully settled panels would produce only $187.50 before infrastructure, support, compliance,
rater operations, failed panels, or customer acquisition. A $2.50 minimum improves the smallest panels but does not
change that conclusion.

This supports a narrow decision:

- the **subscription** pays for the continuing workspace and assurance system;
- the **usage allowance** connects price to adoption without penalizing collaboration;
- the **execution fee** pays for the paid settlement lane and some network operations;
- **participant compensation and reserve** are customer-funded pass-through economics, not RateLoop revenue; and
- **managed evaluation** pays for human setup, rubric, cohort, and interpretation work that software does not automate.

Invoice the software subscription through conventional B2B card, SEPA, or invoice rails. Do not require USDC merely to
pay for the workspace. EU contracts may use a fixed EUR price plus the applicable VAT/reverse-charge treatment, while
the public-network quote can remain denominated in USDC. Any prepaid customer balance remains with the regulated
partner contemplated by the design of record; subscription billing does not authorize RateLoop custody of panel funds.

## Market pricing evidence

Prices below were checked on 14 July 2026. They are directional comparables rather than interchangeable products.

### AI evaluation and observability software

| Product                                          | Public pricing signal                                                                                                                                                                                         | Lesson for RateLoop                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Braintrust](https://www.braintrust.dev/pricing) | Starter $0; Pro $249/month; Enterprise custom. Pro includes unlimited human review scores and unlimited users.                                                                                                | A free path and a roughly $200–$300 production-team anchor are credible. Human review capability alone is not enough to support high pricing.                       |
| [LangSmith](https://www.langchain.com/pricing)   | Developer $0 for one seat; Plus $39/seat/month plus usage; Enterprise custom.                                                                                                                                 | A seat-plus-usage model exists, but charging for every invited reviewer would work against RateLoop's network effect.                                               |
| [Langfuse](https://langfuse.com/pricing)         | Hobby free; Core $29/month; Pro $199/month; Teams add-on $300/month; Enterprise $2,499/month. Paid cloud plans include unlimited users, with price differentiated by usage, retention, controls, and support. | Retention, security, audit, support, and usage are better packaging boundaries than reviewer seats. Enterprise value can be an order of magnitude above self-serve. |
| [Humanloop](https://humanloop.com/pricing)       | Trial includes 2 members, 50 evaluation runs, and 10,000 logs/month; Enterprise is contact-sales.                                                                                                             | Limited evaluation runs are a recognizable free-trial unit, but RateLoop should meter completed decisions rather than low-level logs.                               |

These products make a low-cost software alternative visible to every buyer. RateLoop cannot justify $500–$2,000 per
month merely by saying “human review.” It must earn the premium through agent-triggered review policy, secure reusable
private groups, independent paid supply, reviewer provenance, sealed answers, repeatable decision evidence, and the
ability to move between internal and external panels without changing the integration.

### Human research and participant supply

| Product                                                                                  | Public pricing signal                                                                                                                                            | Lesson for RateLoop                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Prolific](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing) | Corporate customers pay participant rewards plus a 42.8% platform fee. Prolific recommends at least $12/hour participant pay.                                    | Qualified supply and participant operations are expensive. RateLoop's 7.5% is aggressive and must be validated against actual variable costs.                                                                                                                             |
| [User Interviews](https://www.userinterviews.com/pricing)                                | Pay-as-you-go recruiting is listed at $49 per completed session, excluding incentives; incentive distribution adds 3%. Subscriptions lower the session rate.     | Separating participant incentives from platform/recruiting charges is normal and understandable to B2B buyers. One-off use should cost more than committed recurring use.                                                                                                 |
| [Wynter](https://wynter.com/pricing)                                                     | Pro is $20,000/year; Elite $40,000/year; managed research $100,000/year. Pay-as-you-go tests cost 50% more, while tests using the customer's own panel are free. | Specialized, decision-ready research commands high prices, but customer-owned panels can be priced very cheaply when the vendor is monetizing primarily through supplied respondents. RateLoop must charge for its distinct assurance workflow, not for “having a group.” |

Wynter's free own-panel path is the strongest warning against overpricing basic private groups. A group, invitation, and
question form can be replaced by email, Slack, a survey tool, or an annotation queue. The paid product begins where
RateLoop makes repeated agent review operational and auditable: policy-bound triggering, sealed independent responses,
versioned agent/run provenance, adaptive sampling, private evidence, and a comparable history of decisions.

## Recommended packaging in detail

### Billing unit

Use one customer-visible unit:

> A **completed review decision** is one frozen case or agent output that reaches an authorized terminal human-result
> state under one reviewer policy.

Rules:

- a multi-case evaluation consumes one unit per completed case, not one unit for the container run;
- a panel with several respondents still consumes one review-decision unit, subject to a fair-use maximum of 15 human
  responses per case on self-serve plans;
- a canceled draft, failed authorization, assignment with no response, or under-quorum result without a usable human
  result consumes no software unit;
- an explicit rerun is a new unit because it creates a new decision and evidence record;
- skipped adaptive-review opportunities are recorded but not billed;
- API calls, polling, webhooks, notifications, and on-chain transactions are never separate billing units; and
- paid reviews consume a software unit and separately show bounty, execution fee, and attempt reserve.

This definition should be price-versioned before billing code is built. The source-derived terminal state, not a client
event, must increment usage idempotently.

### Free

**$0/month, no card required.**

- one workspace, one agent, one private group, and up to five people total;
- 25 completed private review decisions per month;
- 30-day result history;
- browser handoff plus rate-limited API/MCP access;
- invitations, sealed responses, basic evidence, and one evaluation view;
- community support; and
- no public-network or paid-panel launch, production SLA, custom retention, SSO, or bulk export.

The free plan must demonstrate the real private-group loop; a dashboard-only mock will not establish value. Also
offer a 14-day Team trial for buyers that need to test webhooks, adaptive policy, and larger groups. Rate limits and
retention should control cost; withholding the core integration should not.

### Starter

**$299/month or $2,990/year.**

- 250 completed review decisions per month;
- up to three active agents and five private groups;
- unlimited invited reviewers and workspace collaborators;
- 90-day result history;
- production API, authenticated MCP, CLI/SDK, and webhooks;
- private artifacts within the supported production privacy boundary;
- signed evidence export, basic version comparison, and workspace spending controls;
- public-network and paid-private access, with participant costs and execution fee separate; and
- email support.

This is the recommended public anchor. It sits close to Braintrust Pro, above generic eval infrastructure, and inside
the repo's earlier $250–$500 design-partner hypothesis.

### Team

**$799/month or $7,990/year.**

- 2,000 completed review decisions per month;
- up to ten active agents and unlimited private groups;
- unlimited invited reviewers and workspace collaborators;
- one-year result history;
- adaptive review policies, forced samples, reset history, and cross-version evaluation dashboards;
- team budgets, approval policies, cost centers, advanced webhook controls, and scheduled exports;
- priority support and a quarterly usage/evaluation review; and
- public-network and paid-private access, with participant costs and execution fee separate.

This price is within the earlier $500–$1,500 Team hypothesis and remains below the $1,000–$2,500 monthly managed
Quality Loop. It should become the expected plan for customers using RateLoop in a production release process.

### Enterprise

**From $24,000/year, annual contract.**

- custom agents, groups, volume, retention, and regional requirements;
- SAML SSO, SCIM, fine-grained RBAC, audit-log export, and vendor/security review;
- DPA and contracted support/availability targets;
- onboarding, architecture review, and named success contact;
- optional isolated deployment/data plane where operationally supportable; and
- negotiated overage or committed-volume pricing.

Do not promise enterprise controls before they exist. “From $24,000/year” is a commercial target for the completed
package, not permission to sell an unimplemented SLA or security claim.

### Extra usage

Use prepaid, non-expiring-for-12-months blocks rather than surprise overages during launch:

- **500 additional completed review decisions: $250**;
- notify at 50%, 80%, and 100%;
- stop new reviews at the limit by default; and
- allow an owner to opt into automatic block purchase with a monthly ceiling.

After six months of real usage, replace this simple block with a graduated rate only if the data shows a material cost
or value difference between low and high volumes.

## Paid panels and USDC

### Keep these line items separate

For every paid public-network or private-group quote, display:

1. **Participant bounty** — entirely allocated under the frozen panel terms.
2. **Attempt reserve** — worker-protection funding under the accepted-work failure rules; not RateLoop revenue.
3. **RateLoop execution fee** — initially 7.5% of bounty, minimum proposed at $2.50 per funded panel.
4. **Tax/VAT treatment** — displayed according to the B2B billing and intermediary structure.
5. **Workspace subscription/usage** — invoiced on its normal billing cycle, not disguised inside the panel quote.

Do not assess the fee on the attempt reserve. Do not describe the total customer funding amount as RateLoop revenue.
Continue to refund the fee when the current design requires it, including under-quorum accepted-work outcomes where
the bounty and fee refund while the reserve compensates valid work.

### Do not charge “per USDC transaction”

A paid panel can require funding, settlement, claims, retries, and service transactions. A per-transaction price would:

- make retries and fallback paths feel like customer penalties;
- create unpredictable bills for the same business result;
- expose implementation details that the product intentionally keeps secondary; and
- produce no revenue for unpaid private work.

Charge per funded panel through the frozen platform fee and per completed review decision through the software plan.
USDC is a payment and settlement rail, not the customer value metric.

### Revisit the 7.5% rate only with evidence

Track contribution economics separately for public and paid-private supply:

- rater acquisition and qualification;
- screening, tax, sanctions, and identity operations;
- notification and fill operations;
- relay gas and payment-provider fees;
- support time and disputes;
- under-quorum, beacon-failure, and platform make-goods; and
- cohort authoring, rotation, and fraud loss.

If 7.5% plus the subscription does not cover those variable costs at the target panel size, test a new published price
version at 10%, then 15%. Prolific's 42.8% benchmark shows that a higher fee is commercially possible when the platform
delivers valuable supply, but RateLoop should not copy that rate before it can match the breadth, targeting, fill, and
participant operations that justify it.

## Managed and channel offers

Self-serve pricing should not absorb bespoke evaluation work. Keep these separate:

| Offer                     |                                 Test price | Includes                                                                                             |
| ------------------------- | -----------------------------------------: | ---------------------------------------------------------------------------------------------------- |
| Evaluation setup          |                       $500–$1,500 one-time | Case/rubric review, reviewer-policy setup, and one results walkthrough; no implementation consulting |
| Workflow Selection Sprint |                     €1,500–€2,500 plus VAT | Workflow/value map, test cases, acceptance criteria, and pilot proposal                              |
| AI Quality Loop           | €1,000–€2,500/month plus participant costs | Recurring sampling, evaluation, drift/regression review, and decision report                         |

These ranges preserve the companion
[AI Consulting + RateLoop strategy](ai-consulting-rateloop-integration-strategy-2026-07-13.md). Agencies and
consultancies can resell or itemize RateLoop, but participant costs and RateLoop fees should remain visible rather than
being presented as a free consulting add-on.

## Example customer bills

The examples exclude VAT and are illustrative price hypotheses.

### Internal agent review only

A Starter workspace completes 100 unpaid private-group review decisions in a month.

| Line item                |      Amount |
| ------------------------ | ----------: |
| Starter subscription     |     $299.00 |
| Participant compensation |       $0.00 |
| USDC execution fee       |       $0.00 |
| **RateLoop revenue**     | **$299.00** |

Under the old fee-only model, the same useful month produces $0.

### Team using private and public review

A Team workspace completes 500 unpaid private review decisions and 20 public-network panels, each with a $25 bounty
and a $5 attempt reserve.

| Line item                                                         |        Amount |
| ----------------------------------------------------------------- | ------------: |
| Team subscription                                                 |       $799.00 |
| Public bounties, pass-through                                     |       $500.00 |
| Attempt reserves, funded and later accounted under round outcomes |       $100.00 |
| Execution fees at proposed $2.50 minimum                          |        $50.00 |
| **RateLoop revenue before costs**                                 |   **$849.00** |
| **Total initially funded/invoiced, excluding tax**                | **$1,449.00** |

The bill shows why the subscription and paid-panel economics must remain separate.

## Validation plan

These prices are hypotheses. RateLoop does not yet have enough paid recurring use to claim a market-clearing price.

### First 90 days

1. Sell five Founding Design Partner slots at $299/month for six months. Include Team features but cap usage at 250
   completed decisions per month.
2. Require a paid first month or deposit. “I would pay” is not pricing evidence.
3. For qualified prospects, test three offers across separate deals rather than changing the price mid-conversation:
   $299, $499, and $799 per month for the same bounded production outcome.
4. Keep participant costs and execution fee identical across those offers so the subscription comparison is clean.
5. Record who owns the budget, what existing process/tool is displaced, expected review frequency, cost of a bad release,
   procurement threshold, and the feature that triggered willingness to pay.
6. Ask lost prospects whether the blocker was price, missing trust/security, missing integration, unclear value, or lack
   of a repeated workflow. Do not automatically interpret every loss as a price objection.

### Decision gates

Publish the $299 Starter tier only if at least three of five paid partners:

- complete at least 25 real review decisions in a month;
- integrate through API, MCP, SDK, CLI, or webhook rather than using only a demo;
- run a second evaluation or repeat the workflow in the next billing period; and
- say the result affected a real go, revise, stop, or escalation decision.

Move the production anchor toward $499–$799 if support or onboarding exceeds two hours per customer per month, or if
customers consistently use adaptive policies, evidence export, and multiple agent versions. Move downward only if
qualified repeated-workflow buyers activate and retain but fail specifically on price.

### Metrics required before changing paid-panel fees

- subscription MRR and gross retention;
- completed review decisions by plan;
- percentage of instrumented opportunities actually reviewed;
- time to first completed private and public result;
- direct software cost per completed decision;
- support/onboarding hours per workspace;
- public-panel fill, quorum, failure, make-good, and dispute rates;
- variable public-panel operations cost as a percentage of bounty;
- rater effective hourly compensation; and
- contribution margin by private unpaid, private paid, and public paid source.

## Billing and product implementation implications

Pricing should be implemented only after the product slices that create private groups and agent evaluations are stable,
but the data model should avoid a future rewrite.

Add or reserve concepts for:

- workspace plan and immutable price version;
- billing customer, subscription state, currency, tax/VAT facts, and billing period;
- included decision allowance and purchased usage blocks;
- an append-only, idempotent usage ledger sourced from terminal case results;
- plan entitlements for agent count, group count, retention, exports, adaptive policy, and enterprise controls;
- owner-set spend caps and automatic-purchase consent;
- invoice lines that distinguish subscription, software usage, bounty, reserve, execution fee, and tax; and
- refunds/credits that never rewrite the evidence or settlement ledger.

Fail closed if billing state is unavailable for a new paid action, but never interrupt already accepted human work or
its required terminal path. Subscription cancellation may stop new reviews after the paid-through period; it must not
cancel accepted assignments, redirect funds, or alter evidence already created.

## Risks and rejected alternatives

### Subscription only

Rejected as the complete model. It hides paid-network variable costs and makes a low-volume private customer subsidize
a high-volume public-network customer.

### Execution fee only

Rejected. It produces no revenue for unpaid private groups and only $1.875 on the current $25 bounty at 7.5%.

### Per-seat pricing

Rejected at launch. It discourages inviting reviewers and cross-functional decision owners. Paid competitors such as
Braintrust, Langfuse, and Wynter use unlimited-user packaging in important tiers. Limit abuse through decision usage,
agents, groups, retention, and rate controls instead.

### Per-API-call or per-opportunity pricing

Rejected. It discourages complete instrumentation and adaptive-policy evaluation, and it makes retries billable. Record
skipped opportunities for coverage analysis but bill terminal review decisions.

### Free unlimited private groups

Rejected. Wynter can make customer-owned panels free because its core monetization is supplied research participants.
RateLoop's private-group workflow is itself a core product. A bounded free plan should prove it, not give away ongoing
production operations, evidence retention, and adaptive policy indefinitely.

### High enterprise-only pricing from day one

Rejected. The product still needs repeated paid evidence and production hardening. Enterprise pricing is justified by
implemented security, audit, retention, support, procurement, and service commitments—not by an “AI assurance” label.

## Final decision to carry into implementation

The business model should be changed from **USDC fee-only** to a **hybrid B2B SaaS and paid-panel model**:

1. launch a bounded free tier;
2. validate $299/month with paid design partners;
3. target $799/month for repeated production use and $24,000+/year for implemented enterprise controls;
4. meter completed review decisions, not seats, API calls, opportunities, or blockchain transactions;
5. retain the 7.5% paid-panel fee initially, with a proposed $2.50 minimum and transparent pass-through bounty/reserve;
6. keep reviewers free and participant compensation separate; and
7. revise prices only from observed conversion, repeat use, support load, and contribution economics.

This model lets private unpaid groups become a real revenue product without forcing fake USDC activity, while preserving
the explicit economics and trust guarantees of compensated public and private work.

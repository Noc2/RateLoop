# RateLoop — business plan

Rewritten 6 August 2026 against `423c33f12`, from four research passes: external market
and competitive research, a unit-economics model built from the deployed infrastructure, a
pricing study of the German market, and a product audit of what a customer can actually do
today.

It replaces a version written on 29 July that has since been overtaken in five places. The
corrections are recorded in §11, because the pattern of error matters as much as the
errors.

## 1. Summary

RateLoop records a company's own named experts reviewing its AI system's outputs, and
emits a signed, exportable evidence record of that review that verifies without us.

The sellable configuration today is narrow and should be described narrowly: **customer-invited,
unpaid, named reviewers; driven by an AI agent over MCP; producing a signed evidence
export.** Paid reviewer panels, USDC settlement and the public reviewer network exist in
the codebase and are switched off. They are a different company and are not modelled here.

**The wedge is ISO/IEC 42001, not the EU AI Act.** The Act's Article 14 is a design
requirement on providers with no record-keeping obligation attached; its high-risk
obligations moved to 2 December 2027. ISO 42001 is in force now, has a scheduled audit, a
named auditor and an existing invoice, and asks a question RateLoop answers exactly: *show
me that the human-oversight control operated during the period.*

**The price is €1,200/month, not €29.** That is not a positioning preference. It is the
lowest price at which one operator can reach break-even at an achievable customer count.

**The honest risk is that nobody buys.** Not that a competitor wins — that the category
does not exist as a budget line. §10 treats this as the modal outcome rather than a
footnote.

## 2. What is actually being sold

The product does four things no combination of a spreadsheet and a shared inbox does:

1. **Freezes the question before the answers.** Policy, review question and options are
   committed before assignments go out, so the evaluation cannot be reshaped after the
   fact.
2. **Collects judgments independently.** Reviewers do not see each other's answers. A
   spreadsheet structurally cannot do this.
3. **Samples reproducibly.** HMAC-keyed selection with a recorded inclusion probability, so
   the sample can be defended rather than asserted.
4. **Emits a record that verifies without the vendor.** Ed25519 over a canonicalised
   payload, a published key history, and a verifier that runs offline.

### The licensing consequence, which changes what "moat" means

**The entire codebase is MIT-licensed** (`LICENSE`, Hawig Ventures UG; `"license": "MIT"`
in every package). There is no software licence to sell, and anyone may run this.

What is actually defensible is therefore narrower and worth stating plainly:

- **The hosted operation** — someone runs it, keeps keys, and answers when it breaks.
- **The accumulating signed archive** — a customer's own history under one key lineage.
  This compounds; the software does not.
- **Being the counterparty on the contract** — the DPA, the retention commitment, the
  entity that can be sued. This is most of what a German buyer is paying for.
- **The brand and the trademark** — the only exclusive asset, and currently unregistered.

Any plan section that implies the code is the moat is wrong.

## 3. The wedge

### Primary: the ISO/IEC 42001 human-oversight control, evidenced continuously

- **It is in force now.** No waiting for December 2027.
- **The budget exists and is already committed.** German SME certification runs from about
  €8,000; Mittelstand initial certification is quoted between €30,000 and €150,000, with
  annual surveillance audits at €3,000–10,000. RateLoop attaches to that line rather than
  creating a new one.
- **A management-system auditor asks whether the control *operated*, not whether it is
  documented.** That is a records question. It is the question this product answers.
- **The certification bodies sell no software for it.** TÜV SÜD, TÜV Rheinland, TÜV NORD,
  DEKRA, DQS, BSI and Fraunhofer IAIS sell audits, consulting, training and one free
  questionnaire. Verified absence across all of them.
- **The AI governance platforms document the control; they do not evidence its
  operation.** Credo AI's own published definition of evidence is a stakeholder sign-off
  *confirming that a control has been met* — an assertion about a control, not a record of
  it running.
- **There is German standards cover.** DIN SPEC 92006 and 92007, published 29 June 2026,
  set requirements for AI testing tools including traceability and reproducibility.

**The sentence:** *Your ISO 42001 auditor will ask you to show the human-oversight control
operating. We produce that record continuously, from your own named staff, and it verifies
without us.*

### Secondary: DSA Article 20(6)

The only regime found that is in force, per-decision, and explicitly requires a qualified
human: complaint-handling decisions must be taken *under the supervision of appropriately
qualified staff, and not solely on the basis of automated means.* The public DSA database
holds over 3.4 billion statements of reasons from 363 platforms, 42% flagged fully
automated.

The constraint is volume: obligated platforms exceed a small panel's capacity immediately,
and Article 19 disapplies the section for micro and small enterprises — removing the
companies whose volumes would fit. **So this is a sampling-and-assurance play, not a gating
play.** Sell a defensible sample, not full coverage.

### The proof point nobody is using

**AI Act Article 14(5)** requires, for one Annex III category, that no action be taken
unless the system's identification *has been separately verified and confirmed by at least
two natural persons.* That is statutory two-rater independent verification — the product's
default panel size, written into EU law. It is narrow and dated December 2027, so it is a
slide, not a market. But it legitimises multi-rater panels to a sceptical buyer, and no
competitor cites it.

### What to stop claiming

- **"Human oversight for the EU AI Act."** Article 14 binds providers at design time and
  imposes no evidence duty.
- **"Nobody signs evidence of human review."** False since at least 2026. See §5.
- **"Independent reviewers."** They are invited and named by the party being reviewed. The
  correct word is **attributable**.
- **"AI literacy creates a records market."** Article 4 was softened by the Digital Omnibus
  to supporting the development of literacy, with no specific level guaranteed.

## 4. Market, sized honestly

| Figure | Value | Kind |
| ------ | ----- | ---- |
| AI governance platform spend, 2024 | ~$65M worldwide | closest thing to observed spend |
| Same, 2026 | $492M | Gartner forecast |
| Same, 2030 | $1B–1.4B | Gartner forecast |
| EU AI Act compliance cost per high-risk product/year | €29,277, of which human oversight €7,764 | 2021 Commission cost *model*, not invoices |

**The category was smaller than one mid-size SaaS company as recently as 2024, and the
IAPP's vendor directory lists 105 entries chasing it.** A 105-vendor directory against a
$500M forecast is the signature of a category being explained rather than bought. Only
three of those vendors are German.

**Who owns the budget.** Across 670+ practitioners: privacy 22%, legal and compliance 22%,
IT 17%, data governance 10%. **Roughly 44% sits with privacy and legal — the people who
bought GDPR tooling, from the same budget line.** This is a direct challenge to entering
through the engineer: the engineer is where the product installs most easily, and the
privacy or legal owner is where the money is. Plan for a two-audience sale.

**Germany.** AI use among companies with 20+ employees rose from 17% to 41% year on year;
48% are planning. Stated barriers: GDPR 77%, skills 70%, cost 58%, unclear use cases 51%,
legal uncertainty 48%.

**Nothing in that barrier list resembles "we cannot prove a human reviewed it."** That is
the single most important market fact in this document, and §10 takes it seriously.

### The window

The German AI implementation act took effect 29 July 2026, making the Bundesnetzagentur the
national market surveillance authority with a complaints inbox and a free service desk for
SMEs. Article 50 transparency obligations applied from 2 August 2026. High-risk obligations
land 2 December 2027.

That is a **16-month gap in which buyers feel exposed, a named regulator exists, and no
conformity-assessment infrastructure serves them** — zero notified bodies designated, the
only accreditation scoped to biometrics. TÜV SÜD has been selling a *voluntary* AI
conformity certificate into that vacuum since November 2025. The window closes as notified
bodies stand up and harmonised standards land.

Expect prospects to arrive with the wrong deadline. German vendor content published as
recently as this spring still says high-risk obligations bite in August 2026.

## 5. Competition

### The three that actually overlap

**SYEN Systems** (US, founded 2024) sells a cryptographically linked, tamper-evident
evidence chain for AI decisions, capturing policy, identity, data, model execution, **human
review** and outcome in one signed entry — Ed25519 over canonicalised payloads, customer-controlled
KMS keys, RFC 3161 timestamps, offline verification with OpenSSL, and a named reviewer
identity in its demo record.

**This is the same artefact layer.** The prior claim that no vendor emits signed evidence
of human review is dead. Two others are adjacent: **Meridian Intelligence Group** ships
floor-triggered human review with **patent-pending two-key attestation** — worth a
freedom-to-operate check before any funding conversation — and **KLA Digital** sells a
runtime control plane with a tamper-evident record and a four-week governed pilot.

What none of them has is **sampling design, blinded multi-rater collection, and
chance-corrected agreement over it.** Sell the measurement, not the signature.

### AI governance platforms: the unit of evidence is wrong

Across Credo AI, Holistic AI, Trustible, Saidot, Monitaur, ModelOp, IBM watsonx.governance
and the rest, the evidentiary unit is the **AI system, use case, model or control — never
the individual output.** Gartner's first Magic Quadrant for the category (June 2026) sets
inclusion criteria — AI discovery and registry, policy enforcement, dynamic risk scoring,
10+ paid deployments in 2+ regions — that RateLoop cannot meet and **should not try to**.
It is a different shape.

The pure-plays are capitalised at startup scale: Saidot has fewer than 10 employees and
about €1.75M raised; Trustible fewer than 25 and $4.6M. The money is in the GRC incumbents.

### The substitution threat, which is live and moving

- **Vanta** shipped a dedicated AI Governance product on **30 July 2026** — seven days ago
  — with $504M raised and roughly $300M ARR. It does not do per-output human review, and
  Article 14 is absent from its EU AI Act page.
- **Drata** opened AI Agent Governance limited availability on **4 August 2026** — two days
  ago.
- **ServiceNow bundled AI Control Tower into every pricing tier** in April 2026 rather than
  selling it as an add-on, and has given it away free for a year alongside Now Assist.

**A Magic Quadrant Leader is giving this category away as a bundle sweetener.** The distance
from "approval workflow with an audit trail" to "per-output reviewer record" is one sprint,
and Vanta has 1,884 employees to walk it.

### Evaluation platforms: two checkable gaps survive

Across LangSmith, Langfuse, Braintrust, Arize, Confident AI, W&B Weave, Comet Opik, Label
Studio and Patronus:

- **Not one computes Cohen's or Fleiss' kappa, or Krippendorff's alpha.** Label Studio
  Enterprise, the most annotation-native, deliberately uses its own consensus metric
  instead.
- **Not one emits a signed or tamper-evident export.** The best on offer is an
  enterprise-tier platform activity log.

Blind multi-rater collection is rare and partial: LangSmith hides other reviewers' scores
but shows their comments; Langfuse does not support multiple annotators on one trace at all.

The EU AI Act appears in this segment as marketing only — LangChain published an AI Act
mapping in April 2026 with no new feature and no mention of signed logs.

**And the segment is consolidating away.** Humanloop was acqui-hired by Anthropic and its
platform is offline; Langfuse went to ClickHouse; Galileo to Cisco; Weights & Biases to
CoreWeave. That is both the strongest argument for positioning away from eval tooling and
the most plausible exit.

### Human-data vendors are an adjacent market, not a competitor

Scale, Surge, Toloka, Prolific, Mercor and clickworker supply *their* people doing *their*
work. None sells an evidence artefact about *your* named staff reviewing *your* AI.
Prolific is the pricing reference: minimum £6.00/$8.00 per participant-hour with a **42.8%
corporate platform fee.**

## 6. Pricing and revenue model

### The metering constraint decides this

Only three limits are enforced in code today: **active agents**, **active private groups**,
and a paid-panels boolean. The decision meter is fully built but its only production caller
sits on a switched-off lane, so **plan decision limits on the sellable lane are not
enforced** — and a paying workspace sees "0 of 250" forever, which is a live credibility
defect in the billing UI.

Per-decision pricing fails on three independent grounds: it is not wired to the sellable
lane; the adaptive sampler is *designed* to shrink the metered quantity from 100% to a 10%
floor; and at $29 for 250 decisions it prices at $0.116 per decision against comparable
orchestration at $0.02–0.03.

**So the value metric is active agents, with evidence-retention years as the second axis.**
Retention is already stored, validated, versioned and audit-logged, allows 6–120 months,
and costs under €0.20/month to serve for a decade. It is the cleanest unpriced margin in
the product.

### The structure

| | Price | Agents | Groups | Retention |
| --- | --- | --- | --- | --- |
| Sandbox | €0 | 1 | 1 | 6 months |
| **Founding Pilot** | **€2,500 net, 6 weeks** | 3 | 5 | 12 months |
| **Assurance** | **€1,200/month, annual prepay (€14,400)** | 3 | 5 | 24 months |
| **Assurance+** | **€2,500/month, annual prepay (€30,000)** | 10 | 15 | 60 months |

All prices **netto zzgl. 19% USt.**, invoiced in EUR, paid by SEPA transfer, annual prepay.

**Publish no recurring price until three pilots have closed.** Publish the pilot and the
sandbox only.

### Why the public $29 must go

The public pricing page currently shows $29 against a struck-through $99 with a blanket 20%
future discount, while the German collateral quotes €2,500 — and the only available action
on that card is "Request pilot" because self-serve checkout is deliberately disabled. **A
prospect sees a $29 price tag whose sole button asks for a €2,500 pilot.**

A published $29 is not a list price to discount from. It is a net price a buyer can point
at, and it reframes a €2,500 pilot as an 86× markup requiring justification. Every verified
competitor in the category — Vanta, Drata, Secureframe, OneTrust, Credo AI, Holistic AI,
and the closest comparable, Munich-based **trail**, which sells a structured proof of
concept — publishes no price at all.

There is also a German legal wrinkle: the Preisangabenverordnung binds offers to consumers,
but a court has held that a publicly accessible web shop must be assumed to address private
customers too unless access is technically restricted. Removing the public self-serve price
removes that exposure.

### Where €1,200 comes from

It is derived from break-even (§7), not from comparables — but the comparables support it:

| Reference | Price |
| --------- | ----- |
| German whistleblowing compliance SaaS (commodity floor) | €45–97/month |
| External DPO retainer — a named human with statutory liability | €125–450/month |
| Matproof, EU-hosted compliance platform, Germany | €480 / €1,200 per month |
| Proliance ISMS Core | €1,000/month |
| German AI Act readiness consulting, fixed price | €1,950 / €4,500 one-off |
| Larger German AI Act implementation engagements | €25,000–120,000 |

**€29/month sits below the German commodity compliance floor, which frames the product as a
toy.** €1,200 sits between the Matproof tiers and at the Proliance ISMS line — priced as
infrastructure for a certification, which is what it is.

### Delete the €249 tier

At €249, break-even needs 24–30 customers, which one operator cannot reach. Worse, a €2,500
six-week pilot implies €1,667/month of value — 6.7× a €249 subscription. **The pilot and a
€249 subscription cannot both be correctly priced.** Keep €249 only as an internal floor
for a genuinely self-serve tier if self-serve ever ships; it is not what a pilot converts
into.

### The take rate, corrected

If paid panels ever open: the platform fee is **10% of base bounty**, with a reviewer floor
of 80% guaranteed on-chain. Effective take on what the customer actually pays is **9.09%
when the attempt reserve goes unused and 5.26% when it is fully consumed.** The frequently
quoted "~7.5%" is the midpoint of that range and is not a number the code produces at any
single point.

**The deployed contract caps the fee at 20%** (`MAX_FEE_BPS = 2_000`). Any proposal for a
15–25% service fee breaches that at the top of the band and would require a fresh contract
deployment and a complete new deployment key propagated across app, indexer, keeper and
database.

At 9.09%, earning €10,000/month gross requires intermediating €110,000/month of bounty flow
— roughly 1,786 reviewed cases, about four reviewer FTE. Against Prolific's 42.8%, **9.09%
is an interface fee for settlement, not a services margin.** If RateLoop ever sources,
screens and QAs reviewers, it is loss-making, and the fix is capped by the contract.

## 7. Unit economics

### Cost structure

| Customers | Total infrastructure per month |
| --------- | ------------------------------ |
| 0 | ~€101 |
| 10 | ~€128 |
| 50 | ~€171 |
| 200 | ~€341 |

**At 200 customers, infrastructure is under €350/month — about 0.15% of revenue.
Infrastructure is not a constraint on this business and never will be. The binding cost is
one person's hours.**

One finding worth acting on: roughly **42% of fixed infrastructure serves the chain**
(indexer, keeper, paid RPC), which the only sellable lane never touches — the invited lane
terminates off-chain. It cannot simply be switched off, because the indexer URL is a
required production variable. That is a deliberate parity choice costing about €510/year.

Non-infrastructure fixed costs dwarf it: accounting, insurance, and in year one a
penetration test (~€9,000) and German counsel for the AGB, AVV, TOM annex and order form
(~€6,000). **Year-one total burn is roughly €1,800/month before any founder salary.**

### Margin

At €1,200/month with two support hours per customer per month, gross margin is **83%**.
COGS is almost entirely operator time:

| Support hours/customer/month | GM at €1,200 | at €799 | at €249 |
| --- | --- | --- | --- |
| 1 | 91% | 87% | 60% |
| 2 | 83% | 75% | 20% |
| 3 | 75% | 62% | **−20%** |
| 6 | 50% | 25% | −141% |

**Break-even support load is 12 hours/month at €1,200 and 2.5 hours at €249.** One German
security questionnaire — eight hours, and they do ask — wipes out three months of a €249
customer.

### The pilot is a qualification instrument, not revenue

A €2,500 six-week pilot costs roughly **€0 in cash** and **52 operator hours the first
time, 34 in steady state** — an effective €48–74/hour against a DACH senior technical rate
of €112–225. With one person, **two pilots can run concurrently; 8–12 per year is
realistic.** That caps pilot revenue at about €30,000/year before credits. Do not plan
around it.

### Break-even

| Price/month | Customers needed (year 1, lean) |
| ----------- | ------------------------------- |
| €249 | 24 |
| €799 | 7.4 |
| **€1,200** | **4.9** |
| €2,500 | 2.4 |

**Minimum viable configuration: five customers at €14,400 = €72,000 ARR.**

Realistic year one: six pilots signed, two conversions, **revenue about €41,000 against
costs of about €23,000 excluding salary — a contribution of roughly €1,550/month.**

**Year one does not pay a salary. Break-even lands in month 16–22 if conversion holds above
one third. Required runway: €60,000–90,000 of savings or other income.** The collateral does
not say this; the operator should say it to themselves.

## 8. Go to market

Germany first, permissioned intros only — §7 UWG rules out cold email sequences.

**Sell to two people.** The engineer installs it; privacy or legal owns the budget. A
pitch that only lands with one of them stalls.

**Attach to the certification budget.** "The €500-a-month thing that makes your €10,000
surveillance audit cheaper and faster" is a far better story than "audit alternative."

**Frame the missing certificate correctly.** RateLoop holds no ISO 27001 and no SOC 2. The
buyer is discharging *its* obligation — NIS2, DORA, GDPR Article 28(1) "sufficient
guarantees", AI Act Article 26. Give them evidence for their file and the missing
certificate becomes negotiable. For a Germany-first motion **ISO 27001 matters more than
SOC 2**, and note that Vanta, Drata, Kertos and Naaia all hold ISO 42001 themselves and say
so on their homepages — selling governance software without holding a certification is a
credibility problem as well as a procurement one.

**Prepare for the works council before it appears.** See §10.

## 9. Twelve months

| Month | Work | Milestone |
| ----- | ---- | --------- |
| Aug 2026 | Tier 0 of the readiness list — one day. Settle the one-product story. Remove the public $29. Fix "0 of 250" in the billing UI. | Site and collateral tell one story |
| Sep | Browser path to request a review; return the reasons; standalone verifier; operator verification route. Counsel briefed. Pentest booked. | Product demonstrable in a browser |
| Oct | 50 accounts researched, 20 scored, 10 permissioned intros, 8 discovery calls, 2 pilot offers | **≥1 signed pilot** |
| Nov–Dec | Deliver pilots 1–2, recording hours per activity. Pentest report; trust page. | 2 pilots delivered; median hours known |
| Jan–Feb 2027 | Pilots 3–4. First annual proposal at €1,200–1,500. | **3 paid pilots; ≥1 conversion** |
| Mar–May | Pilots 5–7. Publish recurring tiers now, not before. Decide EUR/SEPA in code from actual invoice count. | ~€43k ARR |
| Jun–Aug | Pilots 8–10. Renewal with customer #1. SLA drafted before the second annual signs. | **5 annual customers ≈ €72k ARR** |

## 10. Risks

**1. Buyer indifference is the modal outcome.** The German barrier list does not contain
anything resembling this problem. The IAPP's own four-category vendor taxonomy has no
human-oversight category. Every regulation that mandates human review mandates the
*capability*, not the *record*. **There is no procurement checklist with a line item for
this**, and creating a category is a well-funded company's job.

**2. The spreadsheet objection is stronger here than previously admitted**, because the
reviewers are unpaid and internal. The customer's honest alternative is a shared sheet and a
monthly export. The answer must be what a sheet structurally cannot do — blind collection,
committed sampling, and a record that verifies without the vendor. If the pitch is "we track
who reviewed what", the spreadsheet wins.

**3. Incumbents are moving now.** Vanta seven days ago, Drata two days ago, ServiceNow
giving it away. The prior plan conceded the tamper-evidence layer has an expiry date; the
workflow layer has one too.

**4. The protocol substitutes the workflow half for free.** MCP elicitation is a standard
primitive: a server requests structured human input and the client returns accept, decline
or cancel. Every MCP client gets human-in-the-loop pause for nothing. It persists no
evidence — which is exactly the remaining product — but the workflow half is now table
stakes in the protocol this is built on.

**5. Direct artefact substitution.** SYEN ships the same cryptography today with US
framework mappings. One competent EU competitor doing the same against AI Act, DSA and ISO
42001 erases the differentiation in a quarter.

**6. The German works council is a deal-killer disguised as a feature.** A system recording
which named human reviewed which AI output and when is textbook §87(1)(6) BetrVG territory
— objectively capable of monitoring employee performance, intent irrelevant, and
**introduction without works-council agreement is legally ineffective**. AI Act Article
26(7) independently requires informing workers' representatives. Mitigations, all cheap and
all product decisions: no per-reviewer throughput or accuracy metrics by default,
aggregate-only reviewer views, and a ready-made Betriebsvereinbarung template shipped as a
sales asset.

**7. Procurement gates the product cannot pass.** No ISO 27001, no SOC 2, no pentest report,
no trust page. In Germany ISO 27001 is the de-facto entry ticket and TISAX is contractually
mandatory for anything automotive-adjacent.

**8. Availability is a legal exposure, not a feature gap.** German SaaS is *Mietvertrag*,
so with no SLA defining availability the implied standard is 100% and downtime reduces the
fee by operation of law. Against one operator with no on-call and no error tracking, **an
SLA is a revenue-protection instrument.**

**9. Solo operations against 2–6 month German sales cycles**, a works-council gate and a
DPA negotiation per deal. Build velocity is extraordinary and burn is negligible. **Neither
engineering capacity nor money is the constraint. Distribution is.**

## 11. What this rewrite corrected

Recorded because the pattern is the finding.

1. **"No vendor emits signed evidence of human review" — false.** SYEN Systems ships it.
   The differentiation is the measurement design, not the signature.
2. **"Free and Early Access are functionally identical" — false.** Agent and group limits
   are enforced at four production call sites. Only the decision meter is not. The enforced
   value of the paid tier is exactly +2 agents and +4 groups.
3. **Qualified timestamps cost €0.035–0.19, not €2.50** — wrong by 25–50×. Sixty decisions
   cost €3–6, not €150. The batching decision may still be right, but its cost
   justification has evaporated.
4. **The take rate is 5–9%, capped at 20% by the deployed contract** — not "~7.5%", and any
   15–25% proposal breaches the contract at the top of its band.
5. **The MIT licence means there is no software licence to sell.** Three pages on
   defensibility never mentioned it.

Two prior claims could not be verified this round and were removed rather than repeated:
the Article 72 implementing-act status under Regulation (EU) 2026/1744, and the assertion
that Datadog shipped human annotation queues — its LLM Observability documentation contains
no human annotation product at all.

## 12. Kill criteria

"Will pay" means **a charged card or a signed order form with a payment date.** Verbal
interest and a scheduled follow-up are zero.

| Date | Test | If missed |
| ---- | ---- | --------- |
| 30 Sep 2026 | ≥8 qualified conversations from permissioned intros | Below 5 → the **channel** is broken, not the product. Fix distribution before anything else. |
| 31 Oct 2026 | ≥2 written pilot offers and ≥1 signed order form | Zero signed → change the ICP, not the price. |
| 31 Dec 2026 | 1 pilot delivered against all six gates, **and someone outside the customer's engineering team opened the evidence packet** | Packet never read externally → the evidence thesis is unconfirmed and this is an eval tool. Reprice self-serve and stop selling evidence. |
| 31 Mar 2027 | ≥3 paid pilots | Below 3 → the category is not convincing and a cheaper subscription will not fix it. |
| 30 Jun 2027 | ≥1 pilot→annual conversion at ≥€1,000/month | Zero from ≥3 completed pilots → the pilot is paid consulting with no product tail. |
| 31 Dec 2027 | ≥5 paying customers, ≥€60k ARR | Below → wind down or find a co-founder. |

Continuous tripwires:

- **Pilot #3 still above 45 hours** → the eight-precondition setup chain is the real cost.
  Automate before selling a fourth.
- **Any customer above 6 support hours/month at €1,200** → below 50% margin. Above 12 →
  negative.
- **Conversion below one third at €1,200** → break-even moves past month 24 and the runway
  assumption fails.
- **The mindshare test.** If in the first five conversations the buyer's mental model is
  "one trusted reviewer, thirty traces, a spreadsheet", then agreement statistics and
  blinded panels read as academic overhead and the entire statistical differentiation is
  worth nothing to that buyer. Test this explicitly and early. It is cheap, and it
  invalidates the positioning if it fails.

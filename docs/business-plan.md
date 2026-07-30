# RateLoop tokenless — business plan

Written 29 July 2026 against `d49862fa3`, from market, pricing, legal and procurement
research plus a capability audit of the branch. Companion to
[product-opportunities.md](product-opportunities.md), which lists the work this plan
implies.

**This is a relaunch plan, not a growth plan.** The main site is being replaced with a
placeholder that thanks contributors and promises nothing. The tokenless product is
the next chapter, and it has never taken a payment.

---

## 1. Where things actually stand

**What works today, end to end:** a self-serve, invited-reviewer human assurance gate.
Sign up, create a workspace, connect an agent over MCP OAuth or an API key, configure
review policy, invite reviewers, have an agent declare a run, get it reviewed, receive
an Ed25519-signed evidence packet, verify it in the browser, share it with an auditor
on an expiring link, export it. A real three-account hosted test exercises the whole
chain.

**What cannot happen today: revenue.** Three independent blockers, none architectural:

1. Stripe is off by default — two environment flags.
2. The verified-business gate that guards checkout can only be satisfied by a function
   with no route, no script and no admin UI. Every paying customer would need a manual
   intervention that has nowhere to happen. This is hit at customer #1.
3. **The metered unit is not metered.** `reserveWorkspaceUsageAllocations` is reachable
   only through the frozen-run path of the gated paid network lane. The live invited
   lane inserts its run directly as `completed` and never reserves anything. The usage
   counter reads an empty table forever, and nothing enforces 25 or 250 decisions —
   while the pricing page tells customers reviews "use the decision allowance included
   in your plan."

Agent-count and private-group quotas _are_ enforced. Only the headline meter is dead.

**The strategic reading:** the gap between a working free product and the first dollar
is days of work, not a rebuild. But before closing it, the meter itself should change —
see §4.

---

## 2. What the product honestly is

A **human-assurance record for AI agent output**, sold to teams that build and operate
their own agents. The differentiator is that the record is cryptographically signed,
independently verifiable without trusting RateLoop, and exportable in formats an
auditor recognises.

Across roughly thirty vendors examined in four adjacent markets — LLM evaluation,
annotation, AI governance, content moderation — **none emits signed or tamper-evident
evidence of human review decisions**. The state of the art is a mutable application log
plus a CSV export. That gap is real and unoccupied.

**What it is not:** a prompt-development platform, an evaluation framework, or a
compliance certification. And it is not a marketplace — see §7.

---

## 3. The market, stated without flattery

**There is no compelled buyer, and the product's own legal analysis says so.**

- **Article 14 binds the provider, not the deployer**, and requires that systems be
  _designed_ to be overseeable. It mandates no evidence artefact, no signature, no log
  format, no attestation, and no minimum number of reviewers.
- **Article 12's "identification of persons verifying results" — the requirement the
  product is shaped around — is written for Annex III point 1(a) biometric
  identification only.** Not hiring, not credit, not insurance, not essential services.
- **Annex III high-risk duties moved to 2 December 2027** under Regulation (EU)
  2026/1744, and are now additionally conditional on harmonised standards that do not
  exist. Sixteen months out, and capable of slipping further.
- **The obligation cannot transfer.** Article 25(1) provides a route for a third party
  to acquire _provider_ status and none at all for deployer status. RateLoop can do the
  work; the customer keeps the liability either way.

So this is a **discretionary quality-and-diligence purchase wearing compliance
clothing**. That is survivable — most software is discretionary — but it must be sold
on the quality of the evidence rather than the necessity of it, and the plan should
stop pretending otherwise.

### What is defensible to claim

Not "the AI Act requires this". Instead: **audit-defensible evidence that you assigned
competent human oversight under Article 26(2), retained alongside your Article 26(6)
log obligation.** Narrower, true, and it survives contact with a buyer's counsel — who
will otherwise check, and find the biometric scoping.

**Lead the commercial conversation with Article 25(4).** Providers of high-risk systems
are _required_ to hold written agreements with third parties supplying tools and
services. That is a statutory reason to sign a contract with RateLoop rather than a
security review to survive. It is cited nowhere in the product today.

### What might bite sooner than the AI Act

GDPR Article 22 (in force since 2018, with seven-figure enforcement), DSA Articles 17
and 20(6), and the Platform Work Directive, whose member-state transposition is due
2 December 2026 — a full year before Annex III.

---

## 4. Pricing — the meter currently runs backwards

Today: Free (25 decisions/month, 1 agent) and Early Access $29/month (250 decisions,
3 agents; list $99). **The ceiling per customer before "Enterprise" is $99/month.**

Three findings say per-decision is the wrong meter, in ascending order of severity.

**It is priced above a commodity.** $29 for 250 decisions is $0.116 per decision.
Amazon A2I orchestrates human review at $0.02–$0.08 per object and charges _nothing_
extra when you use your own reviewers. Any buyer who benchmarks reaches a comparison
RateLoop loses, against a product that is not even a competitor.

**It suppresses the behaviour the product sells.** The consistent 2025–26 lesson from
metered AI pricing is that visible costs get governed: GitHub Copilot estimates jumping
from $45 to $754, Cursor's public apology and refunds, Uber exhausting its annual AI
budget by April, Salesforce repricing Agentforce three times in a year. For a review
product the failure mode is specific and fatal — **a metered review budget means fewer
reviews, which means thinner evidence, which is the entire product.**

**It shrinks as the customer succeeds.** The adaptive coverage ladder steps
100% → 50% → 25% → **10%** by design. Per-decision revenue therefore declines by up to
90% as a customer's agent earns trust. The product is engineered so the meter runs
backwards.

Meanwhile the entitlement system already implements four meters — agents, private
groups, decisions, paid panels. **Three of the four grow with account success. The one
being charged for is the one that shrinks.**

### The frame to price in

Signed evidentiary artefacts price 25–400× higher than review orchestration. DocuSign
charges $0.50–$8 per envelope for the same underlying act — a human looked at something
and it was recorded — because the output is a legally usable artefact. Identity
verification runs $0.80–$5 per check, and both categories **monetise retention
separately**, as does LangSmith with extended traces.

### Recommended ladder

| Tier           | Price               | Meter                        | Gates                                                                |
| -------------- | ------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Free           | $0                  | 1 agent, 25 decisions        | 30-day retention, no export                                          |
| **Team**       | **$149/mo**         | 5 agents, generous allowance | 1-year retention, evidence export, verifier bundle                   |
| **Business**   | **$599/mo**         | 25 agents, invited lanes     | 3-year retention, SSO, DPA, audit export, Art. 25(4) agreement       |
| **Enterprise** | **from $25,000/yr** | unlimited                    | 6-year retention, invoice/bank transfer, evidence SLA, named support |

**Meter on governed agents and retention years, not decisions.** Both grow. Retention
costs almost nothing to serve and is where willingness to pay actually sits — evidence
with 30-day retention is worthless to a compliance reader.

**Delete the $29 point.** It is exactly Langfuse Core's price, so it anchors against LLM
observability rather than compliance; it caps the ladder at $99 by construction; and to
a buyer simultaneously quoting Drata at a ~$25k median and Credo AI at an estimated
$30k–$150k, it signals "not a real vendor". A $25,000 Enterprise floor is _below_ the
Drata median.

Publish every price except Enterprise. Transparent pricing is one of the few structural
advantages a solo vendor holds over Vanta, Drata and Credo AI, all of which hide it.

### Why this matters more than anything else in the plan

| ACV        | Customers needed for $1M ARR |
| ---------- | ---------------------------- |
| $29/mo     | **2,874**                    |
| $99/mo     | **842**                      |
| $599/mo    | **139**                      |
| $25,000/yr | **40**                       |

A solo founder with no distribution acquiring 2,874 paying customers is not a plan.
Forty is a list of named accounts. This table depends on no external benchmark.

---

## 5. Competition

**LLM evaluation and observability** — LangSmith ($39/seat), Braintrust ($249/mo, scores
metered at $1.50–2.50/1,000), Langfuse ($0/$29/$199/$2,499, MIT core, free
self-hosting), Arize, W&B Weave, Promptfoo, DeepEval. These serve engineers optimising
model quality. None produces evidence for a third party.

**AI governance and GRC** — Credo AI, Holistic AI, Trustible, plus AI modules from Vanta
and Drata. Contract data puts Vanta around a $20k median and Drata around $25k. These
serve compliance officers, hold the certifications RateLoop lacks, and produce policy
documentation rather than per-decision evidence.

**The honest competitive statement:** RateLoop competes with a spreadsheet and a Slack
thread, not with these vendors. The buyer's alternative is reviewing outputs informally
and writing it up later. What RateLoop sells against that is an artefact nobody can
quietly edit afterwards.

**One unverified lead worth chasing:** a product appearing in search results at
$4,000–$15,000/month claiming cryptographic signing. The pricing page returned 403. If
real, a direct competitor prices the same differentiator over 100× higher, which would
be the strongest possible external validation of §4.

---

## 6. Trust without certification

The product holds no SOC 2, ISO 27001, ISO 42001 or HIPAA attestation, and a solo
maintainer structurally cannot satisfy several ISO 27001 role-separation requirements.
The research on selling anyway is unusually clear.

**Certification is rarely the actual gate — the internal sponsor is.** Questionnaires
are risk-profiling, not pass/fail. Practitioners report closing multi-hundred-thousand
dollar contracts with no certifications, and buyer-side risk managers confirm they
write up the risk for a business sponsor to sign when the business wants the product.

**The one hard blocker is flow-down.** Buyers whose own SOC 2 or ISO 27001 includes a
control requiring their vendors to be certified cannot make an exception. This creates
an uncomfortable adverse selection: **the more compliance-mature the buyer, the more
likely they are blocked.** Screen for it in the first discovery call — one question,
and it saves months.

### What to do instead, cheapest first

1. **Publish a CSA STAR Level 1 self-assessment.** Free, no prerequisites, listed in a
   public third-party registry, and it is the exact CAIQ format AWS Marketplace accepts.
   Best ratio of procurement credibility to cost available.
2. **Scope the data down.** Risk managers tier vendors by data sensitivity. A vendor
   that holds no customer content — only commitments, hashes and reviewer assertions —
   lands in the tier where waivers are routine. The commitments-only ingestion path
   already exists; making a content-free mode a first-class product option is a
   **procurement strategy, not just an engineering choice**, and it also narrows GDPR
   Article 28 exposure.
3. **Buy one annual third-party penetration test** (~$5–15k) before any compliance
   platform subscription (~$20k+). It appears in every questionnaire.
4. **Ship the open-source verifier as the trust artefact.** The SDK is already MIT with
   npm provenance, and a browser verifier already exists. Packaging it standalone and
   saying plainly _you do not have to trust us, here is the code that checks it_ changes
   the security question from "do we trust this vendor's controls" to "can we check the
   output ourselves". That reframing is worth more to a vendor without attestations than
   to one with them.
5. **Close with a commitment, not a certificate.** Contractual undertakings to certify
   within 12–24 months are standard buyer-side practice.

**Do not pursue ISO 42001.** Roughly 350 certificates exist worldwide, holders are
hyperscalers and Big-4 consultancies, first-year cost runs $85–150k, and there is no
evidence of it appearing in EU RFPs. Revisit in 2027.

**Bridge letters are a dead end** — they presuppose a prior SOC 2 report.

One tailwind: a compliance-automation vendor was expelled from its accelerator in April
2026 amid allegations that 493 of 494 examined SOC 2 reports were near-identical. The
market is becoming more sceptical of automated attestation, which favours evidence a
buyer can verify themselves.

---

## 7. The reviewer marketplace: leave it off

It is the strongest engineering in the repository, and it should stay switched off —
permanently, in its current form. Not for cold-start reasons, but because it is a
regulatory perimeter problem.

- **DAC7/PStTG reporting with no de-minimis** for services. A reviewer paid €5 once is
  reportable. A binding ruling costs €5,000.
- **Deemed-supplier VAT risk on the full bounty flow**, not just the fee.
- **DSA duties from day one at any size** — notice-and-action and statements of reasons
  are what enforcement actually pursues.
- **Sanctions screening at effectively strict liability**, plus the Platform Work
  Directive from December 2026.
- The GDPR necessity test for on-chain settlement is, in the product's own words, hard
  to pass when an ordinary off-chain ledger achieves the same payout.

**And the commercial killer: it does not produce the artefact the product sells.**
Network reviewers have no designation and no authority over the customer's system, so
the paid lane is an independent quality signal — not Article 26(2) oversight.

**And there is a five-month clock.** The Platform Work Directive's transposition
deadline is 2 December 2026, and its Article 10 extends the algorithmic-management duties
to the **genuinely self-employed** — rebutting the employment presumption does not help.
Switching the lane on would oblige RateLoop to provide human oversight of its own routing
and scoring, explanation and human-review rights over automated decisions, a DPIA with
worker-representative involvement, and national declaration plus biannual reporting,
across 27 divergent transpositions, with Germany examining a direct-employment
requirement for platform subcontractors. There is no small-platform exemption.

The irony deserves naming: **a product selling human oversight as compliance evidence
would acquire its own human-oversight obligations toward its reviewers**, and would be
selling AI Act readiness while carrying unresolved platform-work exposure.

**If a customer wants reviewers supplied, sell it as a managed service**: RateLoop
contracts a small number of named specialists directly, the customer designates them, and
they enter through the invited lane. That keeps the work inside Article 26(2), avoids the
digital-labour-platform characterisation entirely, and the economics work — Tier B
professional review in the EU costs roughly €95–190 per hour all-in, against €60–85 of
pricing headroom for a 20–30 minute decision.

### The sequencing argument, which is the strongest one

Of seven close comparables, **not one launched as an open two-sided marketplace.** Scale
sold a developer API and hid the labour. Surge sells datasets. Mercor hand-matched
candidates. Mechanical Turk served Amazon's own internal need first. GLG sold industry
guidebooks and the expert network fell out of it. Invisible sold operations as an
outcome. Mercor, Invisible and Toloka each added a marketplace layer **only after the
managed service passed eight or nine figures of revenue**.

Read that way, a built-but-switched-off marketplace is not a wasted asset — **it is
correctly sequenced infrastructure**, and turning it on now would invert the only
sequence with documented precedent.

---

## 8. Go to market

**Segment:** companies that are **both provider and deployer** of their own
customer-facing agent. This matters legally — such a company is bound by Article 14 as
well as Article 26, which is the only configuration where the full oversight story
applies to one buyer.

**Channel, in order of realism for a solo founder:**

1. **The open verifier and the MIT SDK** as the top of funnel. Developer trust first,
   compliance conversation second.
2. **MCP and agent-host directories.** Nine host adapters, two MCP servers, OAuth device
   flow and framework adapters already exist — this is a genuinely broad distribution
   surface that costs nothing more to exploit.
3. **The limitations register as a sales asset.** The product's published candour about
   what it does not hold is unusual and will survive diligence that competitors' pages
   will not. It currently reads as apology; it should read as method.
4. **EU enterprise via the prepaid invoice path** that is already built and unused —
   bank transfer and verified-business gating suit European procurement.

**Deprioritise the innovation-budget route.** Corporate open-innovation programmes
convert screened startups to scaled projects at roughly 1.4%, and the security review is
deferred rather than avoided — resurfacing at renewal when sponsor enthusiasm has
decayed.

---

## 8b. The route with the best precedent: sell the outcome first

The strongest documented case in this category is Vanta, and it is uncomfortably close
to home — compliance evidence sold to companies that need it.

Its first product was **a spreadsheet**: a SOC 2 gap assessment built for one customer.
The second customer received _the same spreadsheet_. Customers submitted cloud
credentials through a form, and the team **extracted the data by hand and wrote the
reports manually**, telling customers the software was "a little slow" to cover
next-day delivery. Distribution was word of mouth. It reached **$10M ARR before its
Series A**, and deliberately capped customer count to keep the manual load survivable.

The trigger for building software was explicit and worth copying: the manual artefact
had proved useful to three customers unchanged. **Repeatability was demonstrated before
any code was written.**

Applied here: RateLoop already has the software. What it has never had is a customer
paying for an outcome. A defensible variant is to sell **"evidence readiness" as an
engagement** — RateLoop configures the gate, supplies or helps designate reviewers,
and delivers the signed evidence file — at compliance-budget prices rather than $29,
and let the product absorb whatever turns out to be repeatable.

**The honest caveats.** A solo founder billing at European professional rates and
roughly a thousand billable hours lands at **€150–400k a year**; past that needs
subcontractors, which reintroduces the classification problem from §7. And the exit
arithmetic is less lopsided than SaaS folklore suggests — a solo services business
trades around 2–3× owner earnings while a sub-$5M software business trades around
3.3× revenue, with the multiple expanding meaningfully only once genuinely recurring
revenue passes roughly 30% of the total. The gap is real but it is not the order of
magnitude people assume.

There is **no reliable published benchmark** for solo productized-service revenue
ceilings; the band above is arithmetic from verified European rates, not survey data.

---

## 9. Risks

**No compelled buyer** (§3). The single largest risk, and repricing does not fix it.

**Flow-down adverse selection** (§6). The best-qualified buyers may be structurally
unable to purchase.

**Solo maintainer.** No admin UI exists, no error tracking, no paging. The keeper and
indexer each run a single replica. Several operator actions are raw signed transactions
with keys in environment variables. This is fine at zero customers and a real liability
at ten.

**Multi-tenancy is per-route discipline.** No row-level security across 163 migrations;
membership checks are re-implemented across dozens of files. The failure mode is a
future route forgetting the check, and the blast radius is customer data.

**Stale npm packages.** The published SDK and agents packages predate the tokenless
work. Anyone installing today gets a different product — an own-goal for a
developer-led distribution strategy.

**Claim gate now understates the product.** Roughly five capabilities that are built,
deployed and working — evidence signing, the browser verifier, OTLP ingest — are pinned
false and therefore cannot be mentioned publicly. Honesty machinery is a strength; it
should not hide shipped work.

---

## 10. The next ninety days

**Do not build first. Price first, then test demand, then build.**

1. **Reprice** to the §4 ladder and change the meter to agents plus retention. Mostly a
   configuration and copy change; three of the four meters already exist.
2. **Fix the pricing page's decision-allowance claim**, which the code does not support.
3. **Run the demand test.** Take Business and Enterprise to ten named EU companies that
   are both provider and deployer of a customer-facing agent. Lead with Article 25(4).
   Ask for $599/month or $25,000/year **today**, with no deadline forcing them.
4. **Then, and only then, unblock revenue:** turn on Stripe, build a real
   business-verification path, and wire metering to whatever meter survives step 1.
5. **Ship the standalone open-source verifier** and publish the CSA STAR Level 1
   self-assessment. Both are cheap and both compound.

**The decision rule:** if three of ten will pay, the model works and the rest is
execution. If none will, the pricing was never the problem — the product needs a buyer
whose pain is not regulatory, and the nearest candidate is the incident-and-quality
evidence buyer inside engineering, not the compliance officer.

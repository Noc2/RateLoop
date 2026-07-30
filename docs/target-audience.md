# RateLoop tokenless — who it is for

Written 29 July 2026. Section 1 is read from the code; the rest is evidenced
research with sources. Claims that could not be verified are marked as such,
because an unproven segment in a product document becomes a roadmap by accident.

---

## 1. Who the product currently assumes

### The five jobs the interface serves

**A. Wiring an agent to a review gate.** The dominant persona by surface area:
nine host adapters, an SDK, MCP, and shipped integrations for LangGraph, the
OpenAI Agents SDK, Promptfoo and Langfuse. An AI or platform engineer who already
owns an eval stack.

**B. Deciding how much gets reviewed.** Audience, criterion, panel size, response
window, expertise, and frequency — manual, always, fixed percentage, rules, or
adaptive. A
quality or product owner.

**C. Signing off on an individual output.** The approvals inbox, backed by
attestations recording competence basis, training records and authority scope,
expiring within one to two years. This is the accountable decision-maker, and it is
modelled directly on the deployer's statutory duty.

**D. Proving it happened.** Signed packets, Merkle roots, a verifier CLI, optional
transparency-log and timestamp anchoring, and a framework cross-reference. A
compliance or audit reader — **and the only persona with no onboarding path**.

**E. The reviewer.** Discover, inbox, profile, eligibility, earnings, payout wallet.

A–D are often the same one or two people. The welcome screen offers a binary —
review AI work, or connect an agent — which is the clearest statement of the assumed
world.

### What pricing implies

|                      | Free   | Early Access          |
| -------------------- | ------ | --------------------- |
| Price                | $0     | **$29/mo** (list $99) |
| Decisions per period | **25** | **250**               |

The period differs by plan: Free uses a strict UTC calendar month, Early Access the
Stripe subscription anniversary window.
| Active agents | 1 | 3 |

Read against the adaptive sampler's 10% monitoring floor, **250 decisions a month is
roughly 2,500 reviewable outputs, about 83 a day.** At the "always" setting it is 250
outputs total. That is a pilot, a single agent in a single workflow, or a
low-volume high-consequence decision path. It is not a production workload.

There is no per-seat and no per-review price, so **the ceiling per customer before
"Enterprise" is $99 a month**. For comparison, published compliance-platform pricing
runs $20,000–$25,000 a year plus per-framework fees, and support-QA tooling runs
$30–75 per agent per month. The product maps its evidence to frameworks bought by
people paying two orders of magnitude more.

### Best and worst served

**Best: the engineer wiring up the gate.** By a wide margin — this is the most
complete part of the product.

**Worst: the compliance reader, and it is not close.** The evidence machinery is
technically excellent, but reaching it means a tab inside an engineer's workspace,
and consuming it means running a verifier from a terminal with a pinned key. A
compliance officer will not do that. There is no compliance-shaped entry point, and
the product holds no SOC 2, ISO or HIPAA attestation — a hard procurement gate for
exactly this buyer.

### The fact that reframes everything

**The paid marketplace is implemented and switched off.** The reviewer surface
offers eligibility, earnings, a payout wallet and identity assurance — all inert.
The designed economics are specified in detail and unfunded. Live landing statistics
read zero verified humans and zero paid out.

So **RateLoop today is not a two-sided marketplace.** It is a single-sided workflow
and evidence product for a team reviewing its own agent's output, with a marketplace
built behind a compliance gate. The public copy is honest about this.

---

## 2. Who would actually buy it

### The legal picture, corrected

Three corrections matter enough to state before any segmentation.

**Article 14 does not require evidence that oversight occurred.** It requires that
systems be _designed so they can be_ overseen. The per-decision human record lives
in Article 12(3), which applies only to one biometric category — not to hiring,
credit, insurance, education or essential services.

**The timeline moved.** Annex III high-risk obligations were deferred from 2 August
2026 to **2 December 2027**.

**For most of the interesting market, no external party will ever ask to see the
evidence.** Conformity assessment for Annex III points 2–8 — employment, credit,
education, essential services and the rest — is **internal control, with no notified
body**. And zero harmonised standards are published; the human-oversight standard is
the least mature of the set. **There is no specification of what oversight evidence
must look like, and therefore no procurement checklist to sell against.**

### What actually bites today

| Regime                  | In force       | Human review required                                  | Per-decision record                    |
| ----------------------- | -------------- | ------------------------------------------------------ | -------------------------------------- |
| **DSA Art. 17**         | now            | —                                                      | **yes**, filed to a public EU database |
| **DSA Art. 20(6)**      | now            | **yes, explicit** — not solely automated               | via Art. 17                            |
| **GDPR Art. 22(3)**     | since 2018     | **yes** — intervention _on the part of the controller_ | evidentially essential                 |
| **CCPA §7221**          | **1 Jan 2027** | **yes** — with authority to decide                     | —                                      |
| **Colorado SB 26-189**  | **1 Jan 2027** | **yes** — meaningful review and reconsideration        | —                                      |
| **FINRA 2210(b)(1)(A)** | now            | **yes** — a registered principal, before use           | **yes**                                |
| **AI Act Art. 26(2)**   | **2 Dec 2027** | yes — competence, training, authority                  | no                                     |

Enforcement under the data-protection route is real: a €5M fine in November 2024 for
algorithmic management without a human-intervention mechanism, following two earlier
seven-figure fines. The doctrine is settled that rubber-stamping does not escape the
rule.

**One thread runs through every one of these, and it is the most consequential fact
for the product's shape.** They all require the deployer's _own_ qualified,
authorised person — "on the part of the controller", "authority to decide", "a
registered principal". **This structurally validates the invited lane and
structurally invalidates the paid network lane for every compliance use case.** The
product's own documentation already says so.

### The commercial reason, which is larger

Content moderation is a $13.3B market growing at 14% a year, more than half of it
human services. One AI-work marketplace reached roughly $2B annualised revenue by
mid-2026. Teams already pay humans to check AI output — they call it QA, trust and
safety, or data.

Support-QA tooling proves the need and shows the competitive shape: several vendors
score 100% of interactions, but **post-hoc and with AI**. None gates before send.

### The buying centre, and its structural problem

- **Champion:** the engineer who installs it. The product is built for this person.
- **Signer:** at $29, the champion's own card. That is a feature — and it also means
  nobody senior ever evaluates it.
- **Blocker, commercial:** security review. No SOC 2, and customer output text goes
  to third-party reviewers.
- **Blocker, compliance:** legal, asking whether reviewers are "on the part of the
  controller" and what standard defines the evidence. Today the honest answers are
  "only the invited ones" and "none exists yet".

**The gap between the persona that installs it and the persona that would pay for
the evidence is the central go-to-market problem.**

---

## 3. The landscape

### Evaluation tooling — human review is table stakes, and none supply people

Every mature platform has annotation queues; one offers **blind multi-reviewer
consensus with per-queue rubrics, free at the developer tier**. Their identity model
is the workspace seat: a reviewer must be a tenant user.

**Do not position on "we let humans review AI outputs."** The answer is that an
incumbent already does it, with blind consensus, for nothing.

Notice instead what every incumbent says the labels are _for_: reference examples,
ground-truth datasets, evaluator calibration, training export. **Universally the
output is engineering input. Nobody's output is designed to be handed to a
regulator.**

Two of nine independents disappeared in twelve months — one acqui-hired and shut
down, one acquired by a networking vendor. Treat this as an adjacent category, not
one to sit inside.

### Labelling and reviewer supply — a sharp boundary

They sell **pre-deployment training data and evaluation, not continuous oversight of
production output as a control**. One major vendor's site has zero mentions of
oversight, audit trails or the AI Act. Their revenue concentrates in frontier labs
buying by the million-dollar contract, so they would not see this as competitive.

One favourable datapoint: a third to a half of crowd workers were found using
language models to complete tasks, and detection does not reliably beat chance.
That argues for identity attestation over detection — which is the network lane's
model.

### Governance platforms — nine researched, none performs oversight

All of them document it. They operate at the level of the system or the aggregate —
registry entry, risk class, control, policy, drift. **Not one routes an individual
output to a named reviewer.** One large vendor's AI Act product page does not mention
Article 14 at all.

**They are channel, not competition.** Two of them expose documented APIs for
custom evidence resources, with combined reach around 24,000 customers.

The most instructive price point found: a vendor selling versioned PDF evidence packs
mapped to the AI Act and adjacent frameworks — including human-oversight and
override logs — **from about £100 a month**. That is what the compliance-evidence
wedge currently prices at.

### Content moderation and the two adjacencies nobody assigns

The moderation specialists automate the full statutory loop including database
filing. The outsourcers run humans over production output at real scale and **make no
audit-trail claim at all**. One vendor publishing real human pricing explicitly
refuses to crowdsource "for reasons of privacy, quality and accountability" — the
incumbent argument against the network lane, made by an incumbent.

Two adjacencies matter and are easy to miss. **Agent-hires-human marketplaces**
emerged in 2026 with substantial funding — one raised $65M — competing for the same
reviewer supply the network lane would need. And the closest structural competitor,
which built exactly the agent-pauses-for-human-approval API, **has since pivoted
away entirely**. Read that as a vacuum or as a verdict.

**Across labelling, moderation, governance and evaluation: not one vendor emits
cryptographically signed or tamper-evident evidence of human review decisions.** The
state of the art is a mutable log plus export. That gap is real and unoccupied —
partly because no buyer is currently asking.

---

## 4. Is the category real?

**No. It has to be created.** The evidence is one-sided and worth stating plainly.

Against: the obligation the product leads with does not mandate its output. Analyst
sizing of the whole AI-governance market disagrees by 15x in the same year, which
means the category is not coherent enough to size. The profession's own report
segments the landscape into four buckets and **human oversight is not one of them**.
Searching for the capability returns academic papers and a hyperscaler giving away a
free toolkit — a margin warning. Where vendors do appear, every one is an adjacent
platform bolting it on as a feature, which is the hardest shape to sell against. Most
governance budgets are under $100,000, and professional services is three times the
next largest hiring sector — the signature of a category being explained rather than
bought. No live tender text could be retrieved in either direction.

For, and it is one strong datapoint: the digital-services transparency database holds
**over three billion per-decision statements from 359 platforms**, each declaring
whether the decision was automated. Per-decision, machine-readable, publicly auditable
human-versus-automated evidence is **already a live obligation at civilisational
scale** — under a different regulation than the one the product leads with.

**Conclusion: the operational budget for humans checking AI output is real and
large. The compliance-evidence budget is small, unnamed by analysts, and not yet
triggered. Sell into the operational budget and make the evidence the
differentiator, not the line item.**

One headwind worth engaging rather than ignoring: the academic literature is hostile
to the premise, concluding that people cannot reliably perform the oversight
functions asked of them. That is convertible — scored, blinded, measurable review is
precisely the answer to rubber-stamping — but the argument has to be made, not
assumed.

---

## 5. The wedge

Judged on three tests: is the obligation in force, does it require the deployer's
own reviewer, and does the volume fit 250 decisions a month?

### The human-appeal path for automated decisions that adversely affect a person

Three regimes converge on identical requirements. The data-protection route is in
force and enforced. Two US regimes land on **1 January 2027** — and one of them makes
offering meaningful human appeal an **exception to the consumer opt-out right**,
which converts human review from a cost into an operational enabler. That is the
strongest commercial framing available anywhere in this landscape, and it arrives
eleven months before the AI Act.

Why it fits this product and nothing else does:

- **Volume matches the quota.** Appeals are a small fraction of decisions. 250 a
  month is plausibly a real company's entire contested-decision volume. Every other
  candidate is a hundred to a thousand times too large.
- **Reviewers must be the deployer's own trained, authorised staff** — exactly the
  lane that is live, and exactly what the attestation model already records.
- **The evidentiary burden is the product.** The question is never "did you have a
  process" but "can you show this specific decision got a considered human look by
  someone empowered to change it."
- **Nobody serves it.** Governance platforms document policy; eval tools serve
  engineers with mutable logs; outsourcers run humans with no evidence layer;
  support QA is post-hoc; the closest competitor left.
- **It does not depend on the AI Act** — which matters now that the high-risk regime
  moved to December 2027.

**Runner-up:** pre-use approval of AI-generated regulated communications, which is in
force today, genuinely pre-send, and requires a named principal plus a retained
record. But established vendors own that workflow and that buyer. Worth pursuing only
with a sharp "for agent-generated communications, not campaign assets" framing.

**Not the wedge:** "human oversight for the EU AI Act". Sixteen months away,
requires capability rather than evidence, self-certified with no notified body for
most categories, and no published standard defines the artefact.

---

## 6. The audience

### Primary

**Mid-market teams running one consequential, low-volume automated decision path
where an affected person can contest the outcome, and whose own staff must do the
reviewing.**

Lending and credit, insurance claims, tenant and applicant screening, benefits
eligibility, HR and termination decisions, account closures and fraud holds. Roughly
50–1,000 people, EU or California/Colorado exposure, an automation team of 2–20, no
dedicated governance function.

- **Champion:** the engineer who owns the decisioning system.
- **Blocker:** legal asking whether reviewers are on the controller's side — the
  answer is yes, they are your own attested staff — and security asking for SOC 2,
  whose absence is **the single highest-value thing to fix**.
- **Trigger:** the first contested decision or regulator letter where the honest
  answer to "show me the human review" is a screenshot. Or, from January 2027, the
  realisation that without credible human appeal, opt-outs must be honoured on
  employment decisions.

### Secondary A

**AI-native product teams shipping customer-facing agents who need pre-send
confidence, not compliance.** Series A/B, already on an eval platform, already using
the coding hosts this product supports. They buy on "would a human have sent this?"

- **Blocker:** "an incumbent already does this, free" — true of the queue, false of
  the artefact, and it demands a sharper pitch than the product currently makes.
- **Trigger:** a public incident. The adaptive sampler's automatic return to full
  coverage after any model or prompt change is the feature that speaks to them, and
  it is buried in review setup.

### Secondary B

**Non-micro online platforms handling statutory complaint appeals**, where deciding
solely by automated means is already forbidden.

- **Blocker: volume.** Complaint volumes exceed 250 a month almost immediately, so
  this segment **cannot be served by the current plans** without a usage-priced tier
  that does not exist.

### Explicitly not for

- **Enterprise compliance and regulated tier-one institutions.** No attestations, no
  seat pricing, no procurement motion, a founder mailto and a personal booking link.
  A bank will not accept network reviewers for a regulated decision, and outsourcing
  does not transfer responsibility.
- **High-volume production gating.** 250 a month is about 33 reviewable outputs a
  day. Moderation, ticket QA at scale and real-time filtering are off the table by an
  order of magnitude. The product's own docs say not to use a panel as an emergency
  control.
- **Anyone needing enforced interception.** The advertised host integrations are
  **advisory** — they cannot prove an output was withheld. Selling "the agent cannot
  ship until a human approves" is not currently true for the hosts on the site.
- **Anyone whose reviewers must be independent of the customer _and_ see confidential
  material.** The lanes forbid it by construction.
- **Teams needing dataset construction or evaluator calibration.** Incumbents do that
  better, cheaper, sometimes free.
- **Frontier labs and training-data buyers.**
- **Agencies and platform-vendor embeds** — plausible, and **no evidence was found
  that they buy this**. They belong in a backlog as hypotheses, not in a segment list.

---

## 7. Three things to change regardless of segmentation

1. **Delete every "Article 14 requires evidence" formulation.** It requires
   _capability_. Lead the regulatory story with what is in force — the
   digital-services and data-protection routes — then the two US regimes at January
   2027, and put the AI Act at December 2027 as the horizon rather than the hook.
2. **Split the two lanes into two products with two pitches.** Invited is the
   compliance product. Network is an independent quality signal — a second opinion,
   benchmarking, calibration of your own reviewers. **They must never share a
   sentence with Article 14.**
3. **Decide who the product is written for.** It onboards an engineer and monetises
   an engineer, while its deepest asset — signed, independently verifiable
   per-decision evidence that genuinely no competitor in four adjacent markets has —
   is worth most to a buyer with no way into the product who cannot pass its own
   security review. **That gap, not the competitive landscape, is the thing to
   resolve.**

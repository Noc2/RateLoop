# RateLoop tokenless: commercial product expansion research

**Date:** 3 August 2026

**Code baseline:** `e48cfe8a71fa` on `tokenless`

**Status:** product and commercial research; not a release claim, legal opinion, or change to the design of record

The [tokenless implementation plan](tokenless-immutable-implementation-plan-2026-07.md)
remains the design of record. This memo is additive to the
[business plan](business-plan.md) and [product opportunities review](product-opportunities.md).
It asks a narrower question: **what can RateLoop productize next that creates a credible
reason to pay materially more, without turning into another generic evaluation dashboard or
reopening unsafe architecture decisions?**

## Executive conclusion

RateLoop should sell an **assurance control plane for consequential AI work**, not a bundle of
human-rating features.

The highest-value product is a closed loop:

1. a team defines the evidence and human-oversight policy for an agent or workflow;
2. a release, output, incident, or change triggers the policy;
3. the right people independently review the frozen case;
4. an accountable owner records go, revise, or stop;
5. RateLoop preserves a signed, shareable record of what happened; and
6. feedback, appeals, overrides, and corrective actions feed the next version.

That loop is much closer to a production control, an audit record, and an incident-management
system than to a labeling tool. It supports a higher price because it reduces the cost of
release approval, investigation, customer assurance, and external review. It also fits the
product that is already built: signed decision packets, policy-bound runs, owner decisions,
auditor shares, retention controls, WORM delivery, event streams, incident exports, and GRC
connectors already exist as primitives in the repository.

The commercial order should be:

1. **Productize release assurance**: version comparison, a real CI release gate, a concise
   signed release report, and a reusable approval policy.
2. **Productize assurance operations**: user feedback and appeals, incident cases, corrective
   actions, closure evidence, and a cross-run evidence timeline.
3. **Productize external trust**: an auditor/customer portal, framework-specific evidence
   indexes, customer-controlled archive export, and a RateLoop AI-CAIQ/STAR for AI submission.
4. **Add enterprise controls**: SSO/SCIM, granular roles, legal hold, custom retention, regional
   and content-minimized modes, SLA, security review, and controlled exports.
5. **Pilot external reviewer sourcing through bounded partners**, not a RateLoop marketplace.
   RateLoop should assign seats and preserve the method; a provider such as Prolific can recruit
   and pay eligible participants for public, synthetic, or safely redacted work.

Do **not** lead with an open reviewer marketplace, public reviewer profiles, more dashboards,
prompt editing, or an LLM-as-judge feature. Those are crowded, operationally expensive, or
inconsistent with RateLoop's trust model. The product becomes more valuable by governing fewer,
more consequential decisions well—not by maximizing the visible count of ratings.

## 1. What buyers can already get cheaply

Human annotation and automated evaluation are established features of broader AI tooling:

- Braintrust lists a free tier and a **$249/month Pro tier**, with human review scores on its
  product matrix. Its enterprise differentiation is custom retention/export, RBAC, SAML SSO,
  BAA, SLA, and privacy-sensitive deployment options
  ([Braintrust pricing](https://www.braintrust.dev/pricing)).
- LangSmith lists **$39 per seat/month** for Plus and reserves custom SSO/RBAC, support SLA,
  custom workspaces, annual invoicing, and self-hosted or hybrid deployment for Enterprise.
  It separately meters compute and storage and distinguishes short-lived from extended traces
  ([LangSmith pricing](https://www.langchain.com/pricing)).
- Langfuse offers human annotation queues, user-feedback tracking, release management, webhooks,
  and monitoring inside a broad observability product. Enterprise value is concentrated in SSO,
  SCIM, audit logs, data-retention management, security reports, legal review, and support;
  Pro and Enterprise data access can extend to three years
  ([Langfuse pricing](https://langfuse.com/pricing),
  [retention documentation](https://langfuse.com/docs/administration/data-retention)).

This establishes two boundaries.

First, “a place where people score model output” will not support premium pricing by itself.
Evaluation platforms already bundle that into products with observability, prompt management,
and automated scoring.

Second, the market consistently moves security, identity, retention, deployment control,
support, and procurement into the enterprise tier. Those capabilities do not differentiate
RateLoop alone, but they are the **permission to sell** a differentiated assurance workflow to
larger buyers.

RateLoop's pricing should therefore have two layers:

- a product value layer for governed agents, release/incident workflows, evidence retention,
  and external assurance; and
- an enterprise access layer for identity, administration, data boundaries, contracts, and
  support.

Competing against $39 evaluation seats makes RateLoop look expensive. Competing against a
manual release review, a failed customer security review, or reconstructing evidence after an
incident makes a four-figure monthly price plausible.

## 2. Why assurance operations are becoming a real buying job

The opportunity is not “regulation as a feature.” It is that serious AI programs increasingly
need repeatable operating records whether or not a particular deployment is legally high-risk.

### 2.1 NIST describes a continuous operational loop

The NIST AI RMF calls for documented human-oversight processes, production monitoring,
independent or external assessment where appropriate, and evaluation under deployment-like
conditions. Its Manage 4.1 outcome explicitly combines user input, appeal and override,
decommissioning, incident response, recovery, and change management. Measure 3.3 calls for
feedback and appeal processes to be integrated into evaluation metrics
([AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/),
[Measure playbook](https://airc.nist.gov/airmf-resources/playbook/measure/)).

That is almost exactly the lifecycle RateLoop can own. A one-time benchmark is not enough. The
valuable record connects a deployed version, the applicable policy, observed output, human
judgment, owner decision, incident or appeal, corrective action, and later version.

NIST is voluntary and does not certify RateLoop or its customers. The commercial signal is the
shape of the operational work, not a compliance claim.

### 2.2 EU implementation is creating concrete evidence templates

The European Commission's current AI Act overview says providers of high-risk systems need a
post-market monitoring system while deployers ensure human oversight and monitoring. It also
lists logging, documentation, human oversight, robustness, cybersecurity, and accuracy among
the high-risk obligations scheduled to apply from 2 December 2027
([Commission AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)).

The Commission's July 2026 implementation programme includes planned guidance or templates for
provider/deployer duties, serious-incident reporting, post-market monitoring, quality systems,
and responsibility along the AI value chain
([implementation guidance programme](https://digital-strategy.ec.europa.eu/en/news/supporting-implementation-ai-act-clear-guidelines)).

Public procurement is already translating abstract oversight into requested contractual
evidence. The EU public-buyers' MCC-AI commentary says Article 7 addresses human oversight and
uses Annex F for the technical and organisational measures a supplier will take
([MCC-AI commentary](https://public-buyers-community.ec.europa.eu/system/files/2025-03/20250228%20Commentary%202_final.pdf)).

RateLoop should not claim that a decision packet proves legal compliance. It can make the much
more defensible promise that it records specified oversight measures and exports evidence a
customer can use in its own governance, contractual, or regulatory process.

### 2.3 A current public control framework creates a distribution opportunity

The Cloud Security Alliance released AICM v1.1 in June 2026 with **247 controls across 18
domains**, implementation and audit guidance, and mappings to ISO/IEC 42001, ISO/IEC 27001,
BSI AIC4, and the EU AI Act. Its AI-CAIQ is designed for self-assessment and third-party
evaluation ([AICM v1.1](https://cloudsecurityalliance.org/artifacts/ai-controls-matrix-v1-1),
[AI-CAIQ v1.1](https://cloudsecurityalliance.org/artifacts/ai-consensus-assessments-initiative-questionnaire-ai-caiq-v1-1)).

CSA now offers STAR for AI Level 1 through an AI-CAIQ submission
([STAR for AI](https://cloudsecurityalliance.org/star/ai)). This creates two distinct product
opportunities:

- RateLoop should complete its own accurately bounded AI-CAIQ and publish the resulting trust
  material. That can shorten procurement without claiming certification beyond the actual
  registry status.
- RateLoop can map its evidence objects to selected AICM/AI-CAIQ questions and produce a
  customer evidence index. The customer still owns scope, applicability, controls, and answers.

This is better than inventing a proprietary “trust score”: buyers can recognize the framework,
the mapping can be versioned, and each claim can point to a concrete artifact.

## 3. Code-grounded commercial assets

The most promising opportunities reuse existing tokenless foundations rather than requiring a
new platform.

| Existing foundation | Repository evidence | What is missing commercially |
| --- | --- | --- |
| Policy-bound review runs and owner decisions | `assuranceRunOrchestration.ts`, `adaptiveReviewService.ts`, run/case routes | A release-oriented journey with a single status, decision, and signed release record |
| Signed decision packets and verification | `evidencePackets.ts`, `assuranceAttestations.ts`, verification scripts and public verifier | A concise executive/auditor report and a stable standalone verifier package |
| Auditor sharing | `evidenceShareGrants.ts` and public evidence-share route | A scoped auditor/customer workspace across multiple runs, requests, and expiry policies |
| Retention and defensible deletion | `evidenceRetention.ts`, enforcement worker, legal hold and audit records | Plan entitlements, presets, pricing, and a buyer-friendly retention inventory |
| WORM export | `assuranceWormExports.ts` and S3 delivery | Customer onboarding, health UI, recovery test, and enterprise archive packaging |
| Event streaming and webhooks | assurance event outbox, delivery fencing, GRC connectors | Slack/Teams/CI packaging, connector status, replay, and customer-facing setup |
| Incident report export | `incidentReportExport.ts` and oversight report route | An incident case lifecycle before export: intake, triage, actions, owner, closure |
| OSCAL/control mapping | component definition, generation script, compliance map | Current AICM/AI-CAIQ evidence index and an auditor-readable control view |
| Host-owned release evidence | `packages/agents/host-gate` | Supported adapters, a simple CLI contract, failure-safe exit codes, and release UI |
| Billing and entitlements | `lib/billing`, Stripe routes, plan cards | Business verification path, production enablement, and a value-aligned meter |

This matters commercially: RateLoop does not need to spend a year building a broad GRC suite.
It needs to turn strong but scattered primitives into three opinionated products.

## 4. Product 1: Release Assurance

### Buyer job

“Before this agent version or consequential output is released, prove that our required review
happened, that the approver saw disagreement and limitations, and that the released artifact is
the artifact that was approved.”

### Product shape

An agent or CI pipeline creates a release candidate with:

- agent, model, prompt/tool/configuration and dataset version references;
- the proposed change and deployment environment;
- frozen evaluation suite and reviewer policy;
- required decision deadline and fail-closed/fail-open policy, where the host can actually
  enforce it; and
- output or artifact commitment rather than a mutable URL.

RateLoop then runs the configured reviews and returns one of a small number of machine-readable
states: `approved`, `changes_required`, `stopped`, `expired`, `unavailable`, or `invalid_evidence`.
The accountable person records the decision. A release report binds the candidate commitment,
review evidence, overrides, decision, signer/key history, and deployment reference.

The main UI should answer only:

1. What is changing?
2. What did the independent review find?
3. Is the release allowed, blocked, or waiting?
4. Who decided, under which policy, and what evidence was produced?

### Why it supports a higher price

This is an operational dependency rather than a dashboard someone may inspect. It has value per
governed agent, environment, and release policy. It can replace manual evidence assembly and
make a control repeatable across teams.

NIST's own description of effective AI risk management includes explicit go/no-go commissioning
and deployment decisions and documented outcomes
([AI RMF effectiveness](https://airc.nist.gov/airmf-resources/airmf/4-effectiveness/)).
That does not make RateLoop “NIST compliant,” but it validates the buyer job.

### Minimum implementation

1. Define `rateloop.release-candidate.v1` and `rateloop.release-decision.v1` schemas.
2. Add a release record that references, rather than duplicates, the existing agent version,
   run, evidence packet, and owner-decision records.
3. Add a comparison projection for baseline vs candidate: outcome distribution, disagreement,
   critical criteria, coverage, and unresolved limitations. Do not add a generic analytics page.
4. Turn the host-gate proof-of-concept into a supported `rateloop gate` command with documented
   exit codes and no candidate content on stdout.
5. Add one GitHub Actions example and one local shell example. Additional CI providers wait for
   demand.
6. Generate a one-page human-readable report plus canonical JSON and signature/witness
   references.
7. Exercise candidate → review → owner decision → verified materialization in a hosted E2E test.

### Commercial package

- Include one production release policy in a Team plan.
- Charge for additional governed agents/environments and longer evidence retention.
- Reserve cross-workspace policy templates, customer archive delivery, SSO/RBAC, and SLA for
  Assurance/Enterprise.
- Offer a fixed-fee “first controlled release” implementation service.

## 5. Product 2: Assurance Operations

### Buyer job

“When users, reviewers, or monitors find a problem, route it to the right owner, record what we
did, link the fix to a new version, and preserve a defensible closure record.”

### Product shape

This is not a ticketing-system replacement. It is a narrow assurance case that binds operational
facts to AI versions and evidence:

- feedback or appeal intake with purpose-bound upload tokens;
- affected agent/workflow/version and deployment context;
- severity, scope, owner, deadlines, and current state;
- linked review run, owner override, stop action, or incident event;
- corrective action and validation run;
- closure decision and signed incident/corrective-action packet; and
- export to the customer's existing issue tracker or GRC system.

The states should be intentionally small: `new`, `triaged`, `action_required`, `validating`,
`closed`, and `rejected_with_reason`. Required legal or sector-specific states belong in a
versioned template, not the universal data model.

### Why it supports a higher price

This closes the gap between pre-release evaluation and production accountability. It creates an
ongoing system of record and makes retention, external access, and integrations more valuable.
NIST Manage 4.1 explicitly joins user input, appeal, override, incident response, recovery, and
change management; Measure 3.3 says feedback and appeals should inform evaluation metrics
([AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)).

It also gives RateLoop an expansion path inside a customer: engineering can start with release
gates, while risk/quality teams buy the incident, appeal, and evidence workflow.

### Minimum implementation

1. Introduce `assurance_cases`, `assurance_case_events`, and immutable evidence-reference joins;
   do not copy private artifacts into a second store.
2. Add intake APIs for authenticated users and high-entropy external feedback links. Public
   links must be rate-limited, revocable, scoped, and content-minimizing.
3. Reuse the event outbox for case changes and GRC/webhook delivery.
4. Extend the current incident exporter to read a selected case and its evidence timeline,
   while keeping its present draft-template warning until final official templates are checked.
5. Add corrective-action validation: closure can require a linked terminal run against a newer
   agent version.
6. Add aggregate metrics that matter—time to triage, time to closure, recurrence, appeal outcome,
   and corrective-action verification—without exposing private reviewer-level histories.
7. Test intake → triage → stop/override → corrective run → closure → verified export.

### Commercial package

- Sell it as an Assurance Operations module, not as unlimited generic tickets.
- Meter governed agents plus retained assurance-case years; do not meter the number of people
  who report problems.
- Include Jira/Linear or generic webhook export only after a design partner names the system it
  already uses.
- Offer an annual incident-readiness exercise as a paid service attached to the module.

## 6. Product 3: External Assurance Room

### Buyer job

“Give a customer, auditor, procurement team, or board reviewer exactly the evidence they are
allowed to see, for the right period, without granting access to the operating workspace or
building a report by hand.”

### Product shape

The existing single-packet share becomes a scoped assurance room:

- invited external identity or expiring bearer access, selected by sensitivity;
- a fixed evidence request list and purpose;
- selected agents, versions, runs, incidents, policies, and time range;
- redacted human-readable reports plus machine-verifiable originals;
- signer/key history and offline verification instructions;
- access log, expiry, revocation, watermark or download policy where appropriate; and
- framework index showing which evidence may support which control, with applicability and
  responsibility explicitly left to the customer.

The first framework pack should be **NIST AI RMF + CSA AICM/AI-CAIQ**, not a long list of shallow
logos. The second should be the EU operational evidence set after final Commission guidance is
available. OSCAL remains a machine-readable export, not the only human interface.

### Why it supports a higher price

External assurance consumes expensive staff time and often delays deals. A reusable,
permissioned evidence room can shorten a concrete sales or audit process. Custom retention,
access control, security review, and customer-controlled export are already enterprise price
drivers in Braintrust, LangSmith, and Langfuse.

### Minimum implementation

1. Generalize evidence-share grants from one run to a manifest of immutable evidence references.
2. Add named external roles: `auditor_read`, `customer_assurance_read`, and
   `regulator_export_operator`; avoid a generic configurable-role builder initially.
3. Add evidence-request status and an owner response, not a document-commenting suite.
4. Generate a framework evidence index with source version, mapped control/question, evidence
   reference, limitations, owner, and last reviewed date.
5. Add customer-owned WORM/S3 delivery setup with a test object, checksum verification, health
   signal, and recovery exercise.
6. Add a trust-centre page for RateLoop's own current security and AI-control evidence. Publish
   only controls actually implemented and reviewed.

### Commercial package

- Include temporary single-run shares in Team.
- Put multi-run rooms, named external identities, framework packs, customer archive delivery,
  and longer access logs in Assurance/Enterprise.
- Price a framework pack as an annual subscription because mappings and official guidance
  change.
- Offer a paid evidence-onboarding workshop, but keep the product useful without consulting.

## 7. Reviewer supply: keep the capability, reject the marketplace

The earlier choice to avoid an open RateLoop marketplace remains correct. A marketplace would
create simultaneous identity, worker classification, tax, sanctions, payments, content safety,
quality, liquidity, and dispute operations. It would also reintroduce task browsing and
self-selection, which weakens the frozen-assignment method.

That does **not** mean external reviewer supply should be deleted. The safer product is a
**reviewer-source adapter**.

### The adapter model

1. The customer selects an allowed source: its named reviewers, its BPO/expert vendor, or an
   approved recruitment partner.
2. RateLoop freezes the task, qualifications, cohort requirements, seat count, compensation
   assumptions, and exclusion rules.
3. The partner recruits and, where applicable, pays participants.
4. RateLoop receives a purpose-bound participant/session reference, assigns seats, serves the
   blinded case, prevents duplicate participation, and records the review method.
5. RateLoop returns completion status and method evidence. It does not ingest unnecessary
   identity fields or publish reviewer profiles.

Prolific demonstrates that this boundary is technically plausible. Its API can create and
publish studies, use allowlisted participant groups, and send participants to an external study
URL; signed URL parameters are available to some workspaces
([study API](https://docs.prolific.com/api-reference/studies/create-study),
[participant groups](https://docs.prolific.com/api-reference/participant-groups)). It advertises
more than 300,000 verified participants, 38+ countries, 80+ languages, and domain-expert
targeting ([participant pool](https://www.prolific.com/participant-pool)).

This should begin as a commercial and method pilot, not an immediate dependency. Prolific's
corporate platform fee is currently **42.8% of participant rewards**
([pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing)). That
shows buyers already accept a material recruitment/operations fee, but it also means RateLoop
must not stack an opaque second percentage on top. Pass partner costs through transparently and
charge RateLoop for assurance orchestration and evidence.

### Allowed first use

- public, synthetic, or safely redacted content;
- non-urgent benchmark or release-evaluation work;
- clear participant information and fair estimated time/pay;
- qualifications that the source can actually substantiate;
- no claim of national representativeness from a convenient online panel; and
- no statutory, DSA, medical, legal, or similar expert role unless the exact method and
  qualification requirements have been reviewed for that lane.

Prolific's representative samples start at 300 participants and are stratified on limited
demographics; Prolific itself describes the limitations
([representative sample guide](https://researcher-help.prolific.com/en/articles/445161-what-are-representative-samples-on-prolific)). A three- or five-person RateLoop panel must never
be marketed as population-representative merely because participants came from such a pool.

### Pilot implementation

1. Define a provider-neutral `reviewer_source.v1` interface: create cohort request, receive
   session, verify source assertion, accept completion, and reconcile cost.
2. Build one adapter only after signed commercial access and data terms are available.
3. Bind provider study/session IDs into the audience-policy evidence without exposing them in
   public results.
4. Use one-time RateLoop entry tokens and return URLs; verify signed provider parameters where
   offered.
5. Reconcile RateLoop acceptance separately from partner payment/submission status. Never make a
   later quality finding erase an earned payment.
6. Run ten synthetic studies with duplicate, expiry, abandonment, late completion, refund, and
   provider-outage cases before offering it to a customer.

### Commercial model

- Customer's own reviewers: included within plan limits.
- Customer's existing vendor: connector/setup fee plus assurance platform subscription.
- RateLoop-arranged public-safe panel: participant/provider cost passed through, plus a clearly
  quoted fixed orchestration/evidence fee or 15–25% service fee to test willingness to pay.
- Managed expert cohort: custom statement of work and minimum project fee; do not publish a
  self-serve promise until supply and qualification operations are proven.

The percentage band is a pricing experiment, not a conclusion. A fixed fee may be clearer when
partner fees already scale with participant rewards.

## 8. Enterprise capabilities that unlock, but do not define, the premium

These features are table stakes for larger contracts. They should be implemented behind actual
sales evidence and should reuse RateLoop's existing security boundaries.

| Capability | Buyer reason | Product boundary | Suggested tier |
| --- | --- | --- | --- |
| SAML/OIDC SSO and SCIM | Central identity lifecycle and procurement requirement | Better Auth remains primary; enterprise identity policy controls allowed methods | Enterprise |
| Granular roles | Separate policy owner, approver, reviewer manager, auditor, billing admin | Ship named roles first; avoid arbitrary permissions UI | Assurance/Enterprise |
| Custom retention and legal hold | Contract, dispute, audit, and deletion governance | Respect the six-month product floor and record the customer's basis | Assurance/Enterprise |
| Customer-controlled archive | Evidence continuity and exit | WORM export with checksum, health, recovery test, and documented responsibility | Enterprise |
| Content-minimized mode | Sensitive workflows | Commitments and customer-side references where the review remains useful; never imply zero access when content is served | Enterprise |
| Region/data boundary | Procurement and transfer constraints | Offer only regions and subprocessors actually operated and documented | Enterprise |
| SLA and premium support | Operational dependency | Separate product uptime, review turnaround, and third-party reviewer availability | Enterprise |
| Security and AI-control pack | Faster assessment | Current DPA/subprocessor/security docs plus accurate AI-CAIQ evidence | Assurance/Enterprise |

Avoid self-hosting as a roadmap default. LangSmith and Braintrust reserve it for enterprise, but
RateLoop should require a paid design partner and an annual contract large enough to cover
deployment, upgrade, key management, and support complexity.

## 9. Packaging and price tests

The current code exposes Free and Early Access plans at $0 and $29/month, with a $99 list-price
anchor, decision allowances, active-agent limits, and private-group limits. The existing
business plan already identifies the central defect: decision count is the wrong headline meter
because adaptive review intentionally reduces the number of reviews as confidence grows, and
the live invited lane does not currently create the promised usage path consistently.

Use **governed agents + evidence-retention term** as the primary expansion model. Treat external
reviewer costs as pass-through/service economics. Do not charge for every appeal or piece of
negative feedback; that would discourage the behavior the product needs.

The following bands are interview and proposal tests, not public prices:

| Package | Intended buyer | Included value | Price hypothesis |
| --- | --- | --- | --- |
| Developer | Individual/team evaluation | 1 governed agent, invited reviewers, short bounded retention, verifier, limited release history | Free or low-cost |
| Team | Production engineering team | 3–5 agents, release policy, CI gate, version comparison, alerts, 6–12 month evidence | **$249–$499/month** |
| Assurance | AI owner, risk, quality | 10–25 agents, assurance cases, external room, framework index, 1–3 year evidence, priority onboarding | **$1,500–$3,000/month** plus setup |
| Enterprise | Regulated or procurement-heavy organization | SSO/SCIM, named roles, regional/content controls, customer archive, legal hold, SLA, security review | **$2,500–$7,500+/month**, annual |

The lower anchors are deliberately above a generic evaluation seat and around Braintrust's
$249 Pro plan. The upper bands reflect a different buyer job and must be validated through
paid proposals, not justified by competitor arithmetic alone.

Add services that accelerate learning and cash flow:

- **Assurance launch:** policy/rubric design, one agent connection, first release report, and
  owner training—test $3,000–$7,500 fixed.
- **Evidence readiness:** retention, roles, export, evidence room, and control-index setup—test
  $5,000–$15,000 fixed.
- **Annual incident exercise:** synthetic incident, stop/override, corrective validation, and
  after-action evidence—test $2,500–$10,000 depending on scope.
- **Managed expert panel:** quoted separately with participant/provider costs visible.

Services must produce reusable templates, product gaps, and references. Decline custom work
that turns RateLoop into a bespoke annotation agency.

## 10. Ranked opportunity portfolio

Scoring is relative: 5 is best for revenue, differentiation, or reuse; 5 is highest risk in the
risk column.

| Opportunity | Revenue potential | Differentiation | Existing reuse | Delivery risk | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Release Assurance | 5 | 5 | 4 | 3 | Build first |
| Assurance Operations | 5 | 5 | 4 | 3 | Build second |
| External Assurance Room | 4 | 4 | 5 | 2 | Build with first paid audit/customer use |
| AI-CAIQ/STAR trust pack | 3 | 4 | 4 | 2 | Do now for procurement credibility |
| Enterprise identity/data controls | 5 | 2 | 3 | 3 | Sell, then complete in contract order |
| Reviewer-source adapter | 4 | 4 | 3 | 5 | One bounded partner pilot only |
| Managed expert-panel service | 4 | 3 | 2 | 5 | Concierge after a paid request |
| Industry workflow templates | 3 | 3 | 5 | 2 | Build only from repeated customer jobs |
| Generic annotation dashboard | 2 | 1 | 3 | 2 | Do not prioritize |
| Open reviewer marketplace | 3 | 2 | 1 | 5 | Do not build |
| LLM-as-judge suite | 2 | 1 | 2 | 2 | Integrate receipts, do not make it the core |
| Prompt playground/management | 1 | 1 | 1 | 3 | Do not build |
| Public reviewer ranking/streaks | 1 | 1 | 1 | 4 | Do not build |
| Cross-customer data/benchmark sales | 3 | 1 | 1 | 5 | Do not build without explicit new consent architecture |

## 11. Concrete 120-day implementation and sales plan

Implementation should follow paid learning. “Done” means a buyer uses the complete workflow,
not that another backend schema exists.

### Days 0–15: commercial truth and activation

**Product**

- Fix the business-verification path and enable the intended Stripe staging flow identified in
  the existing product review.
- Decide and document the new meter before changing entitlements or public pricing.
- Create one internal Release Assurance demo using the current hosted stack and a real signed
  packet.
- Complete a control-by-control AI-CAIQ draft for RateLoop. Mark `not applicable`, `planned`, and
  `implemented` honestly; attach evidence references and owners.

**Sales**

- Interview ten teams that deploy customer-facing or decision-support agents: five engineering
  owners and five risk/quality/security buyers.
- Show three purchase choices, not an abstract roadmap: controlled release, assurance
  operations, or external evidence room.
- Ask for a paid design partnership with a fixed first outcome and price. Record the objection,
  procurement path, existing workaround, cost of that workaround, and who controls budget.

**Gate**

- Proceed with Release Assurance if at least three buyers rank it among their top two problems
  and at least one accepts a paid or procurement-approved pilot.
- If buyers want only more scoring dashboards, do not copy competitors; narrow the target buyer.

### Days 16–45: Release Assurance vertical slice

- Add release candidate/decision schemas and references.
- Ship baseline-versus-candidate comparison for decision-critical metrics only.
- Productize the gate CLI and stable exit codes.
- Add the one-page signed release report.
- Add hosted E2E coverage for approval, changes required, stop, expiry, tampered evidence, and
  service unavailable.
- Run the first controlled release with the design partner.

**Gate:** the customer's release owner must be able to make and later reconstruct a decision
without RateLoop staff assembling evidence manually.

### Days 46–75: external assurance and pricing

- Generalize share grants into a scoped evidence-room manifest.
- Add the NIST/CSA evidence index, framework version, limitations, and owner review date.
- Expose customer-archive setup and recovery verification for one storage provider.
- Replace decision-led pricing copy with governed-agent/retention packaging after all live
  entitlement consumers share the same rule and invariant tests.
- Charge the design partner for ongoing production use or learn exactly why it cannot buy.

**Gate:** a customer security/audit stakeholder can answer a real evidence request using the
room, with no workspace-wide access and no unsupported compliance statement.

### Days 76–105: Assurance Operations vertical slice

- Add assurance case intake, triage, owner, action, validation, and closure.
- Link cases to versions, runs, overrides, stop actions, and packets by immutable reference.
- Extend the incident export from a selected case.
- Add generic webhook delivery before bespoke Jira/Linear connectors.
- Run a synthetic incident exercise with the design partner.

**Gate:** the complete issue → action → validation → closure chain is visible and verifiable,
including a negative path where closure is refused because validation evidence is missing.

### Days 106–120: enterprise and supply decisions

- Convert repeated security/procurement blockers into the next enterprise capability; do not
  implement the entire checklist speculatively.
- Submit or prepare RateLoop's STAR for AI Level 1 only after internal review of every answer.
- If two paying prospects require outside participants for public-safe tasks, negotiate one
  reviewer-source pilot. Otherwise keep the adapter at design stage.
- Publish one bounded case study with customer permission: problem, policy, review method,
  decision, time saved, and limitations—never private content or an unsupported risk-reduction
  percentage.

## 12. Metrics that predict pricing power

Do not use “ratings completed” as the primary success metric. More ratings can mean inefficient
policy, spam, or an immature adaptive system.

### Product value

- governed agents and production environments;
- percentage of eligible releases evaluated under a recorded policy;
- median time from candidate to accountable decision;
- percentage of reports later verified or shared externally;
- repeat use of the same assurance policy across versions;
- incidents/appeals linked to a corrective version and terminal validation;
- time to satisfy a real customer/auditor evidence request;
- percentage of evidence delivered to a customer-controlled archive; and
- override, disagreement, recurrence, and closure patterns at aggregate level.

### Commercial value

- paid design partners from qualified interviews;
- setup-fee acceptance;
- monthly/annual contract value by buyer job;
- conversion from engineering entry to risk/assurance expansion;
- retention or governed-agent expansion;
- sales-cycle days before and after the evidence room/trust pack;
- implementation/support hours per new customer; and
- reviewer-source gross margin after all partner, payment, support, and dispute cost.

### Kill criteria

- Stop a vertical if three paid-target buyers use it only for a one-off demo and will not put it
  in a release or incident process.
- Stop a connector if no customer will authorize production credentials or name an owner.
- Stop managed supply if support/dispute work makes gross margin structurally unattractive.
- Do not build a sector template when each prospect needs a different underlying workflow; sell
  the horizontal evidence loop instead.

## 13. Product and claims boundaries

Every premium feature must preserve the tokenless trust model.

- RateLoop provides evidence and workflow controls; the customer remains responsible for the
  AI system, reviewer selection where applicable, legal classification, and final decision.
- A framework mapping is not certification or proof of compliance.
- A human click is not meaningful oversight unless the person has usable context, authority,
  time, and an unmanipulated choice.
- A reviewer-source partner does not make a small panel representative or independent.
- External supply may not expose a browseable task market or let raters self-select after seeing
  content.
- Paid eligibility must be complete before paid work, and accepted work must retain a terminal
  payment path.
- Content-free or customer-controlled modes must describe precisely what RateLoop can still
  access and what verification remains possible.
- Enterprise urgency cannot create an operator/admin path to fund-core assets.
- Do not promise self-hosting, regions, SLA, retention, legal hold, or framework support before
  the operating process and tests exist.

## 14. Final recommendation

The best way to make RateLoop more interesting and more expensive is not to make it larger. It
is to make the existing assurance evidence **operationally unavoidable and externally useful**.

Build a clean Release Assurance workflow first. It is the shortest path from the current product
to a control that engineering teams can adopt and risk buyers can fund. Then connect production
feedback, appeals, incidents, and corrective versions into the same signed evidence chain. Put a
scoped assurance room around that chain so customers can satisfy real external questions.

That sequence creates a coherent land-and-expand motion:

> connect one agent → govern one release → retain the evidence → handle one incident → share the
> record externally → standardize the policy across the organization

External reviewer supply can make the product broader, but it should remain an adapter to a
bounded source, not RateLoop's identity. RateLoop's defensible asset is the frozen method and
verifiable decision history—not owning the largest crowd.

If only one commercial experiment is funded this quarter, sell a **paid first controlled
release** before building the full roadmap. A customer who will not pay to govern one real
release is unlikely to pay more for a larger collection of assurance features.

## Research notes and sources

This memo was researched against the code and public materials available on 3 August 2026.
Prices, product packaging, regulatory dates, and framework versions can change and must be
rechecked before public use or a commercial proposal.

Primary and vendor sources used:

- [Braintrust pricing](https://www.braintrust.dev/pricing)
- [LangSmith pricing](https://www.langchain.com/pricing)
- [Langfuse pricing](https://langfuse.com/pricing)
- [Langfuse retention documentation](https://langfuse.com/docs/administration/data-retention)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [NIST AI RMF Measure playbook](https://airc.nist.gov/airmf-resources/playbook/measure/)
- [NIST AI RMF effectiveness](https://airc.nist.gov/airmf-resources/airmf/4-effectiveness/)
- [European Commission AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [European Commission implementation guidance programme](https://digital-strategy.ec.europa.eu/en/news/supporting-implementation-ai-act-clear-guidelines)
- [EU public-buyers MCC-AI commentary](https://public-buyers-community.ec.europa.eu/system/files/2025-03/20250228%20Commentary%202_final.pdf)
- [CSA AICM v1.1](https://cloudsecurityalliance.org/artifacts/ai-controls-matrix-v1-1)
- [CSA AI-CAIQ v1.1](https://cloudsecurityalliance.org/artifacts/ai-consensus-assessments-initiative-questionnaire-ai-caiq-v1-1)
- [CSA STAR for AI](https://cloudsecurityalliance.org/star/ai)
- [Prolific participant pool](https://www.prolific.com/participant-pool)
- [Prolific pricing](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing)
- [Prolific study API](https://docs.prolific.com/api-reference/studies/create-study)
- [Prolific participant groups](https://docs.prolific.com/api-reference/participant-groups)
- [Prolific representative sample guide](https://researcher-help.prolific.com/en/articles/445161-what-are-representative-samples-on-prolific)

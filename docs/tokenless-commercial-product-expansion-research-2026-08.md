# RateLoop tokenless: pre-customer product readiness plan

**Revised:** 4 August 2026

**Code baseline:** `c3d9245ce9a7` on `tokenless`

**Status:** product and commercial research; not a release claim, legal opinion, or change to the design of record

The [tokenless implementation plan](tokenless-immutable-implementation-plan-2026-07.md)
remains the design of record. This memo is additive to the
[business plan](business-plan.md) and [product opportunities review](product-opportunities.md).

This revision deliberately narrows the earlier expansion plan. The immediate objective is now:

> Make the product that already exists easy to understand, demonstrate, verify, and buy before
> contacting potential customers.

No item in the pre-customer plan requires a new fund-core deployment, a new reviewer market, a
new external provider, a broad schema expansion, self-hosting, or a new product line.

## Executive decision

RateLoop has enough product surface for customer conversations. It does not need another major
feature before outreach.

The current repository already contains:

- guided workspace and agent setup;
- MCP OAuth and workspace API-key connections;
- versioned agents, policies, suites, and review runs;
- invited-reviewer assignment and completion flows;
- accountable go, revise, and stop decisions;
- signed evidence packets, packet-bound owner decisions, public verification, and expiring
  evidence shares;
- separate project-auditor access;
- retention policy and enforcement;
- WORM, SIEM, GRC, metrics, event-stream, and webhook primitives;
- enterprise SSO and SCIM configuration;
- oversight alerts, workspace stop, override records, and a draft-aligned incident export; and
- local, hosted-smoke, and hosted-core E2E infrastructure.

The product risk is therefore not primarily missing architecture. It is that a new user can
encounter too much terminology, too many secondary controls, unclear next actions, and powerful
evidence features that are harder to recognize than the basic review workflow.

The pre-customer work should have five outcomes:

1. **One obvious first journey:** connect one agent, request one review, receive independent
   responses, decide, and open the evidence.
2. **A quieter interface:** remove repeated labels and helper copy, hide unavailable signals,
   and move advanced evidence delivery and configuration out of the primary path.
3. **A demonstrable evidence story:** one result page and one evidence packet should explain the
   product without a verbal tour of every subsystem.
4. **A repeatable live proof:** the existing hosted E2E path should exercise the canonical
   Vercel deployment in a dedicated demo workspace and leave a clean synthetic record that can
   be shown.
5. **Truthful commercial entry:** no dead checkout, unenforced allowance, or enterprise promise
   should be visible when its operating path is not ready.

The larger ideas from the first version—new release objects, a full incident-case system,
multi-run assurance rooms, outside reviewer sourcing, and new pricing architecture—remain
reasonable hypotheses. They are now explicitly deferred until customer conversations identify
which one solves a paid problem.

## 1. Corrections from the second code review

The earlier memo was directionally right about positioning RateLoop as an assurance control
plane, but it overstated how much new product needed to be built.

| Earlier implication                                        | Current code reality                                                                                                                                              | Revised decision                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enterprise SSO and SCIM need to be added                   | Better Auth SSO/SCIM routes, configuration, schema, production readiness checks, and workspace UI already exist                                                   | Verify the existing flow and document its limitations; do not rebuild it                                                                                    |
| Auditor access needs a new portal model                    | Project-scoped auditor grants and expiring evidence-share links already exist                                                                                     | Make the current access path easy to demonstrate before considering a multi-run room                                                                        |
| Customer archive and evidence delivery are future work     | WORM, SIEM, GRC, metrics, webhooks, and event streaming already have services and UI                                                                              | Move them behind clear advanced disclosures and test one configured path                                                                                    |
| Version-aware evidence needs a new release model first     | Agent versions, immutable run attribution, newer-packet links, and version-scoped overview data already exist                                                     | Demonstrate the existing lineage; defer new release schemas                                                                                                 |
| Incident evidence needs to start with a new case system    | A factual, draft-template-aligned incident export already exists                                                                                                  | Add a small discoverable export action only if it helps the demo; defer a case-management product                                                           |
| A multi-record compliance share needs a new backend        | Deployment-window compliance shares already bind packet and DSA report versions to a manifest root, with scoped access, expiry, revocation, and replay protection | Do not build another backend or expose this advanced path before a customer needs it; use single-packet shares and project-auditor access in the first demo |
| Hosted verification needs new automation                   | Hosted smoke/core suites and strict tokenless target guards already exist                                                                                         | Run, stabilize, and document them as the release proof                                                                                                      |
| Business onboarding has no customer path                   | Self-declared business billing details have a route and workspace form                                                                                            | The remaining gap is the independent operator verification boundary; add a narrow operator runbook/command or keep checkout unavailable                     |
| Security identity controls should create the premium price | CISA's secure-by-design guidance treats secure defaults and strong identity as vendor responsibility                                                              | Keep strong authentication and safe defaults as product integrity; charge for assurance workflow, evidence scope, retention, support, and operations        |

This correction changes the implementation strategy from **build more** to **reduce, connect,
and prove**.

## 2. Revalidated market signal

Human annotation by itself is already a commodity feature in broader AI platforms:

- Braintrust lists a free tier and a **$249/month Pro tier** with human review scores. It reserves
  custom retention/export, SSO, custom RBAC, SLA, and privacy-sensitive deployment options for
  enterprise buyers ([Braintrust pricing](https://www.braintrust.dev/pricing)).
- LangSmith lists **$39 per seat/month** for Plus and positions custom SSO/RBAC, SLA, legal and
  security review, and hybrid or self-hosted operation in Enterprise
  ([LangSmith pricing](https://www.langchain.com/pricing)).
- Langfuse combines annotation queues and feedback with observability; its higher tiers add
  longer data access, retention controls, SSO, SCIM, audit logs, security reports, and support
  ([Langfuse pricing](https://langfuse.com/pricing),
  [retention documentation](https://langfuse.com/docs/administration/data-retention)).

That supports a narrow commercial conclusion: RateLoop should not spend the pre-customer period
adding generic evaluation or prompt-management features. Its interesting part is the bound chain
from policy to independent review to owner decision to verifiable evidence.

The product should also avoid treating security hygiene as an artificial upgrade lever. CISA's
secure-by-design guidance emphasizes vendor ownership of customer security outcomes, secure
defaults, and transparency. Its guidance specifically argues that the easiest route should be
the secure route and cites enterprise identity integration as an example
([CISA secure-by-design alert](https://www.cisa.gov/sites/default/files/2023-12/SbD-Alert-How-Software-Manufacturers-Can-Protect-Customers-by-Eliminating-Default-Passwords-508c_0.pdf),
[secure-by-design principles](https://www.cisa.gov/sites/default/files/2023-06/principles_approaches_for_security-by-design-default_508c.pdf)).

RateLoop can charge more for the scope and operation of assurance—governed agents, evidence
retention, external access, archive delivery, support, and method design—without weakening the
base product's security.

The underlying buyer job remains valid. NIST's AI RMF describes documented human oversight,
production monitoring, go/no-go decisions, independent input where appropriate, feedback,
appeal, override, incident response, recovery, and change management
([AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)). The European Commission
also describes post-market monitoring, deployer human oversight, logging, and documentation as
parts of the AI Act operating model
([Commission AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)).

These sources validate the direction, not a compliance claim. Before outreach, RateLoop only
needs to show that its existing workflow can record one bounded oversight decision faithfully.

## 3. The pre-customer golden path

Everything should be tested against one story:

1. A new owner creates a workspace.
2. The owner connects one agent using the recommended connection method.
3. The owner chooses one workflow, one review question, invited reviewers, and a clear default
   policy.
4. The agent submits a synthetic output for review.
5. Assigned reviewers see only the information required and submit independent judgments.
6. The owner sees the result, disagreement or limitations that actually exist, and the source
   evidence needed to decide.
7. The owner selects go, revise, or stop without a preselected choice.
8. RateLoop presents the signed evidence packet and one primary action: download, share, or
   verify.
9. A recipient opens the share and verifies the packet without workspace-wide access.

Run this story in one dedicated, isolated Base Sepolia demo workspace through the real persisted
hosted workflow. It may use synthetic content and purpose-created accounts, but it must not use a
runtime fixture mode, hidden database edits, or a simulated settlement path. Reset or replace the
demo workspace between rehearsals instead of mixing sales-demo records with ordinary test data.

The first customer demonstration should not start with paid panels, public-chain settlement,
DSA reporting, WORM configuration, GRC connectors, SCIM, or a metrics endpoint. Those are proof
of depth after the core loop is understood.

### Definition of a successful demonstration

- The owner can complete steps 1–3 without reading public documentation in another tab.
- The landing and empty states send an owner toward connecting an agent or booking a controlled
  release, rather than treating review work as the default buyer journey.
- The agent connection screen gives one recommended path and a truthful connection status.
- Every waiting state says what is waiting, who can act, and what happens next.
- The reviewer sees one primary task and no duplicate progress, status, compensation, or
  invitation text.
- The owner result shows only available decision signals and puts the decision before advanced
  evidence detail.
- The packet page has one evident verification path and preserves the privacy boundary.
- No generic 500 page, dead CTA, or unexplained internal identifier appears.
- The full path works in German and English, light and dark themes, desktop and narrow mobile.
- The canonical hosted test uses only synthetic or safely redacted content.

## 4. Immediate implementation backlog

All work below is intended to reuse current components, APIs, and tables. Each independently
useful fix should be committed separately with focused tests.

**Scope rule:** P0 is the ten-day pre-outreach commitment. P1 begins only after the P0 hosted
golden path is green; it may improve a demonstration but does not delay the first conversations.
Enterprise validation can run in parallel when credentials already exist. It must not pull a new
provider or integration into the sprint.

### P0. Simplify the decision surface

**Why now:** the result and owner-decision page is the moment where RateLoop must feel more
useful than a survey or annotation queue.

**Changes**

- In `EvaluationDashboardPanel.tsx`, render decision signals only when they contain actionable
  information. Do not show “Suppressed,” “No calibration data,” or “No data” as a permanent box;
  omit the whole box when no signal is available.
- Remove the repeated sign-off instruction immediately above the go/revise/stop buttons.
- Remove the decider's prior-choice percentage from the active decision surface. It adds noise
  and can anchor the very decision RateLoop intends to keep considered.
- Keep material disagreement, privacy threshold, small-sample, expired, failed, and
  aggregate-only explanations.
- Shorten evidence/detail disclosures so their labels predict distinct contents rather than
  repeating “details” and “evidence.”

**Tests**

- Available signals render; unavailable placeholders do not.
- The signal region disappears when empty.
- No choice is preselected and all three owner actions still work.
- Small-sample, disagreement, and privacy warnings remain visible in the relevant fixtures.

**Effort:** 1–2 days.

### P0. Simplify the reviewer path

**Why now:** invited review is the part most likely to be shared with someone who has never seen
RateLoop.

**Changes**

- In `ReviewerShell.tsx`, hide “Case 1 of 1” and its progress bar for a single-case assignment;
  retain progress for multi-case work.
- Move permanent keyboard-shortcut help into the existing accessible info popover while keeping
  all shortcuts functional.
- In `PublicQuestionCard.tsx`, show “Rating recorded” once, show guaranteed compensation once,
  and hide the eligibility-management link when eligibility is already ready.
- In `PrivateAssignmentCard.tsx`, show the case count once.
- In `HumanAssuranceRaterClient.tsx`, remove “Invitation details loaded” and “This link identifies
  your assigned review” after the valid invitation is already rendered. Keep access, privacy,
  confidentiality, deadline, public-record, recovery, and irreversible-submission warnings.

**Tests**

- Single-case and multi-case rendering have separate assertions.
- Receipt restoration produces one success message.
- A ready paid task has one compensation statement and no eligibility detour.
- Keyboard and touch access to shortcut help remains tested.

**Effort:** 1–2 days.

### P0. Make setup and first value one path, not a tour of the data model

**Why now:** the setup wizard already stages the workflow correctly, but several nested headings
and long policy descriptions make it feel larger than the task.

**Changes**

- Make the buyer-facing landing action “Connect agent” (or “Book a controlled release” when a
  guided pilot is the intended path). Keep reviewer entry available, but do not make it the
  primary action for an unsigned owner.
- Remove generic create/edit descriptions from `AgentHumanReviewEditor.tsx`.
- In the setup context, avoid repeating “When to review,” “Review routing,” and “When should…”;
  keep one visible heading and a screen-reader label where needed.
- Summarize adaptive review as “Starts at 100%; never below 10%.” Keep the exact thresholds and
  reset rules in the existing accessible popover.
- Keep the recommended connection path visually primary. Move raw workflow-version IDs and
  protocol verification detail into technical details.
- After each successful setup action, route or state the single next missing action: reconnect or
  open the agent, invite reviewers, copy the first-review instruction, open the resulting
  decision, or verify/share its packet. Derive this checklist from existing setup, agent,
  reviewer, run, decision, and packet state; do not add a migration.
- Replace passive empty Overview and Results explanations with the relevant primary action.

**Tests**

- One stage remains visible at a time.
- The exact adaptive rules remain keyboard/touch accessible.
- The recommended path and next action are visible without opening technical details.
- Retry still adopts the authoritative binding version.
- Empty and completed states advance to the correct next action without exposing a future step.

**Effort:** 2–3 days.

### P0. Make a shared packet readable and automatically verified

**Why now:** the public share is the prospect's clearest proof of value, but it currently opens
as a raw packet verifier that requires a second manual verification action.

**Changes**

- In `EvidenceShareViewer.tsx` and `PublicEvidenceVerifier.tsx`, automatically verify a redeemed
  current-schema packet and place a clear verified/failed state at the top.
- Before raw JSON, show a concise recipient view: what was reviewed, project or run context,
  review outcome, generated time, evidence scope, and material privacy or sample limitations.
- Put canonical JSON, digest values, signature metadata, and individual technical checks in a
  disclosure. Keep the manual upload/paste verifier available as a separate tool.
- Be exact about the binding: the evidence packet is signed; the owner decision has its own
  canonical digest bound to the packet digest. Do not call the assembled page a “signed release
  report” or imply that the decision itself is signed.
- Do not expose an owner note or opaque principal through a bearer grant unless the existing
  grant explicitly includes that field and the owner knowingly selected it.

**Tests**

- A valid redeemed packet verifies without a second click and presents the recipient summary.
- Tampered, expired, and revoked shares fail with distinct recovery-safe states.
- Raw JSON remains available but is not the initial reading order.
- The standalone manual verifier still accepts a pasted or uploaded packet.
- Share secrets do not leak into rendered diagnostics, analytics, or browser history.

**Effort:** 2–3 days.

### P1. Reorder the evidence page around proof

**Why now:** the evidence subsystem is a differentiator, but its current breadth can make the
page read like administration software.

**Changes**

- Keep the latest decision packets and their download/share/verify actions first.
- Replace the large standalone “Decision records and exports” card with a compact section.
- Remove repeated “Point-in-time record” badges and repeated seven-day helper text. Show the
  share expiry and consequence once in an accessible confirmation at creation.
- Move project-auditor administration, retention, WORM, SIEM, GRC, and metrics setup into one
  clearly named “Evidence settings and delivery” disclosure for authorized users.
- Preserve direct access to every action; the disclosure may organize secondary setup but must
  not become the only route to a current packet action.
- Keep the existing newer-packet link and signer/key status. Put raw digests and internal IDs in
  technical details unless needed to verify.

**Tests**

- The newest packet and primary evidence actions appear before settings.
- Share confirmation states expiry and bearer-link consequence.
- Auditor and delivery controls remain keyboard reachable and permission-bound.
- A superseded packet links to its newer packet.

**Effort:** 2–3 days.

### P0. Remove dead or misleading commercial paths

**Why now:** a prospect should never discover that a public promise has no working operating
path.

**Changes**

- Trace the decision-allowance reservation from both invited and paid terminal review paths. Add
  a cross-consumer invariant test. If the live invited path does not enforce the advertised
  allowance, remove the decision allowance from public and workspace pricing copy until it does.
- Keep `TOKENLESS_SUBSCRIPTIONS_ENABLED=false` unless checkout, webhook, cancellation, invoice,
  and the independent business-verification operation are all exercised in the target
  environment.
- Configure and test `TOKENLESS_DEMO_BOOKING_URL` for the intended tokenless environment. Keep
  the email fallback, but do not make a prospect compose an email as the primary booking flow.
  When subscriptions are disabled, offer “Request pilot” or “Book a controlled release” rather
  than implying instant purchase.
- Do not publish the speculative $249–$7,500 research bands yet. Keep the current founding offer
  or a contact path until interviews establish the buyer and paid job.

**Tests**

- Pricing copy and the entitlement consumer share one rule across free-limit boundary cases.
- Disabled subscriptions have no checkout CTA.
- Enabled staging rejects unverified businesses, accepts only operator-verified ones, and handles
  Stripe return states without a generic error.

**Effort:** 1–2 days with checkout disabled; enabling checkout is separate P1 work.

### P1. Add the missing operator boundary only if checkout will be used

**Why later:** a supported operator action is required before self-serve purchase, but a working
pilot-booking path is enough for initial outreach.

**Changes**

- Provide a narrow operator-authenticated command and runbook for the existing
  `recordOperatorBusinessVerification` service, with an evidence reference, explicit expiry,
  and audit record.
- Do not add a customer-callable verification shortcut or a general administration product.
- Exercise self-declaration, operator verification, Stripe staging checkout, webhook activation,
  invoice/return state, cancellation, and expired verification before enabling subscriptions.

**Tests**

- The command requires the operator boundary and a complete customer self-declaration.
- Verification expiry and evidence hash are required and audited.
- The full staging billing lifecycle fails closed at every unverified boundary.

**Effort:** 1–2 days once staging credentials and the intended operating procedure are ready.

### P0. Make the current evidence story self-explanatory

**Why now:** this produces sales material by improving the product rather than creating a slide
deck that overstates it.

**Changes**

- Recheck the redacted packet example in the public evidence documentation against a current
  packet schema and verifier.
- Add one concise worked example showing: agent output, review question, independent result,
  owner decision, packet, and offline verification. Reuse an existing synthetic E2E fixture.
- On a completed result, offer a direct “Open evidence” action. Do not add a second explanation
  of what evidence is.
- Give the public evidence page one download-and-verify command that works from a clean checkout.
- Review public claims with `publicEvidenceClaims` and the deployment's actual configuration;
  keep limitations beside the claim they qualify.

**Tests**

- The published sample verifies using the checked-in verification command.
- Public rendering tests contain the exact bounded claim and no prohibited stronger variant.
- English and German pages link to the same schema-valid sample.

**Effort:** 1–2 days.

### P0. Turn existing hosted tests into a release checklist

**Why now:** test infrastructure already exists. The gain is repeatability and confidence, not a
new automation framework.

**Changes**

- Define one pre-outreach command sequence using `e2e:hosted:smoke` and `e2e:hosted:core` with the
  existing exact-origin, branch-SHA, and service-health guards.
- Record the synthetic accounts, expected record cleanup/retention, and which test is allowed to
  create review responses.
- Maintain one dedicated demonstration workspace and a documented reset/replacement procedure;
  never enable runtime fixtures in the hosted environment.
- Cover the golden path plus: expired invitation, duplicate response, insufficient quorum,
  revise/stop, tampered share secret, revoked share, wrong workspace, mobile navigation, and both
  themes.
- Fail with a precise recovery action when Vercel, Ponder, keeper, authentication, or a deployment
  address is stale.
- Keep browser-plugin exploration for human-visible checks, but keep deterministic hosted E2E as
  the reproducible release gate. They serve different purposes.
- Rehearse the buyer story as a five-to-eight-minute demonstration. If it needs a verbal tour of
  internal IDs, advanced settings, or chain operations, simplify the product path rather than
  expanding the script.

**Tests**

- The guard tests continue to refuse any non-tokenless origin or mismatched checkout SHA.
- The canonical hosted run records its target deployment and terminal result.
- No test targets `rateloop.ai` or the legacy Vercel project.

**Effort:** 1–2 days if the existing hosted suite is green; defects found are separate commits.

### P1. Verify, do not expand, enterprise readiness

**Why now:** the existing capabilities are useful proof of product depth, but they should not
crowd the initial demonstration.

**Changes**

- Run an SSO/SCIM configuration test using a controlled test provider. Confirm domain
  verification, SSO-only policy, provisioning, deprovisioning, token revocation, and the stated
  lack of SCIM Groups.
- Run one project-auditor grant/read/export/revoke test and confirm the auditor cannot generate or
  mutate evidence.
- Run one WORM test-object delivery and checksum/retrieval exercise if a controlled destination
  is already configured. Do not add a new storage provider before outreach.
- Inventory the DPA, subprocessors, privacy notice, security controls, public evidence claims,
  and current limitations in a short internal response index.
- Draft AI-CAIQ answers only for controls with current evidence. CSA describes AI-CAIQ v1.1 as a
  247-question, 18-domain self-assessment with justification and evidence fields
  ([AI-CAIQ v1.1](https://cloudsecurityalliance.org/artifacts/ai-consensus-assessments-initiative-questionnaire-ai-caiq-v1-1)).
  Do not delay outreach for a STAR submission.

**Effort:** 2–4 days of validation and documentation; larger gaps move to the customer-driven
backlog.

## 5. Recommended implementation sequence

This is a **two-week readiness sprint**, not a 120-day product expansion.

### Days 1–3: remove friction

1. Point the buyer landing/empty states toward connection or a controlled-release conversation.
2. Simplify reviewer single-case, success, compensation, invitation, and shortcut copy.
3. Simplify result signals and remove decision-anchoring history from the active choice.
4. Reduce setup headings and move exact adaptive/connection details into accessible disclosures.
5. Run focused interaction, localization, accessibility, and rendering tests after each commit.

**Exit condition:** the core setup, review, and decision surfaces each have one obvious action
and retain every material safety/privacy consequence.

### Days 4–6: put evidence in the foreground

1. Make the bearer-share view automatically verify and explain the packet before showing JSON.
2. Verify the checked-in redacted example against the current verifier.
3. Add or confirm a direct result-to-evidence action.
4. Exercise current evidence sharing and separated auditor access.
5. Reorder the broader evidence workspace only if the P0 recipient path is already green.

**Exit condition:** a person unfamiliar with the code can identify what was reviewed, what was
decided, and how to verify it from one completed synthetic run.

### Days 7–8: commercial truth pass

1. Prove or remove the public decision allowance.
2. Confirm the booking/email path.
3. Keep checkout deliberately disabled for outreach unless the P1 operator boundary and full
   staging billing lifecycle have already passed independently.
4. Recheck all public evidence, custody, privacy, identity, and availability claims against the
   deployed configuration.

**Exit condition:** every visible CTA works, and no pricing or product claim depends on an
unavailable operator action.

### Days 9–10: hosted proof and freeze

1. Run the canonical hosted smoke and core suites against the exact tokenless deployment.
2. Perform a human-visible pass in Chrome for English/German, desktop/mobile, light/dark, owner,
   reviewer, and shared-evidence views.
3. Fix each discovered defect separately and rerun the smallest relevant suite plus the hosted
   golden path.
4. Record the tested deployment SHA, service deployment identities, contract deployment key, and
   known bounded limitations.
5. Freeze non-blocking feature work and prepare outreach around the verified synthetic example.

**Exit condition:** a repeatable live demonstration succeeds twice from a fresh starting state,
with no manual database mutation or hidden configuration step in the free invited-review path.

## 6. File-level implementation map

| Work                    | Existing files to start from                                                                                                                  | No new foundation needed                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Result simplification   | `EvaluationDashboardPanel.tsx`, its interaction/render tests, `evaluationRunPresentation.ts`                                                  | Uses current result and decision APIs                                |
| Reviewer simplification | `ReviewerShell.tsx`, `PublicQuestionCard.tsx`, `PrivateAssignmentCard.tsx`, `HumanAssuranceRaterClient.tsx`, EN/DE review catalogs            | Uses current assignment and receipt state                            |
| Setup simplification    | `AgentHumanReviewEditor.tsx`, `ReviewRoutingFields.tsx`, `AgentConnectionPanel.tsx`, `AgentRegistryPanel.tsx`, setup tests                    | Uses current staged setup and version binding                        |
| First-value routing     | public landing CTA, `AgentSetupFlow.tsx`, `AgentWorkspacePanels.tsx`, `AgentOverviewMonitor.tsx`, `EvaluationDashboardPanel.tsx` empty states | Derived from existing workspace and workflow state                   |
| Recipient evidence view | `EvidenceShareViewer.tsx`, `PublicEvidenceVerifier.tsx`, `evidenceShareGrants.ts`, public verifier tests                                      | Uses the current bearer grant and packet verifier                    |
| Evidence hierarchy      | `EvidenceWorkspacePanel.tsx`, evidence URL state, share-grant routes, delivery panels                                                         | Uses current packets, grants, auditors, retention, and delivery APIs |
| Pricing truth           | `lib/billing/plans.ts`, `entitlements.ts`, `WorkspacePlanCards.tsx`, `WorkspacePlanOverview.tsx`, workspace billing UI/tests                  | No pricing-engine rewrite before interviews                          |
| Operator verification   | `businessCustomerEligibility.ts`, billing profile route/UI, internal operator auth pattern                                                    | Narrow command/runbook only if checkout is enabled                   |
| Public proof            | public evidence/use-case pages, verifier scripts, sample packet, `publicEvidenceClaims` tests                                                 | Reuse current schema and synthetic fixture                           |
| Hosted proof            | `e2e/hosted`, `playwright.hosted.*.config.ts`, safety and operations guards                                                                   | Reuse current Playwright and service health checks                   |

## 7. What is explicitly deferred

These are not rejected. They require customer evidence before implementation.

| Deferred idea                                                       | Why not before outreach                                                                                                               | Evidence required to reopen                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| New release-candidate and release-decision schemas                  | Agent versions, run attribution, owner decisions, and packets already demonstrate the concept                                         | A buyer needs RateLoop to be the formal CI release system, not merely provide review evidence                              |
| Incident-export UI or full assurance-case product                   | Current incident export and event records are enough to show depth; neither is needed in the first demonstration                      | A prospect needs the existing export, or repeated paid need arises for intake, triage, corrective action, and closure      |
| Multi-run external assurance room                                   | Current packet shares and project auditors cover a credible first external-access story                                               | A real audit/customer request cannot be completed with current scoped access and exports                                   |
| Deployment-window compliance-share UI                               | The scoped manifest/grant backend already exists, while the first prospect story needs only a single packet or project-auditor access | A real external review needs a bounded multi-artifact window and validates the recipient workflow                          |
| Open reviewer marketplace                                           | High legal, payment, quality, liquidity, safety, and method cost                                                                      | None anticipated; bounded partner sourcing remains preferable                                                              |
| Reviewer-source provider adapter                                    | Requires provider terms, identity/session mapping, payment reconciliation, and outage behavior                                        | Two paying prospects require outside reviewers for public/synthetic work                                                   |
| Managed expert panels                                               | Operational service business before demand is known                                                                                   | A paid statement of work with clear qualifications and content boundaries                                                  |
| New pricing meter and tier architecture                             | The present goal is learning the buyer and job, not optimizing expansion revenue                                                      | Several proposals reveal a repeated value metric and budget owner                                                          |
| Self-hosting or new regions                                         | Large operating and support burden                                                                                                    | A sufficiently large annual contract with explicit data-boundary need                                                      |
| New GRC/Jira/Linear integrations                                    | Generic webhook/GRC primitives already exist                                                                                          | A design partner authorizes credentials and names the system of record                                                     |
| Generic annotation dashboard, prompt playground, or LLM-judge suite | Crowded, weakly differentiated, and not needed for the golden path                                                                    | No pre-customer implementation                                                                                             |
| Production host-gate enforcement                                    | The current host-gate package explicitly lacks a connected production issuer and verified host                                        | A design partner requires an enforced release boundary and the issuer/host trust path is implemented and tested end to end |
| Cross-customer data or benchmark sales                              | Conflicts with privacy and purpose boundaries without new consent architecture                                                        | No pre-customer implementation                                                                                             |

## 8. Pricing and outreach guidance

Do not redesign pricing before the first conversations. Use outreach to identify what the buyer
values and who controls the budget.

The current $29 Early Access offer can remain a founding offer only if its displayed limits and
checkout state are true. If checkout remains disabled, use a clear demo/contact CTA and be ready
to invoice a design partnership manually under explicit terms.

Keep these higher bands private as proposal tests, not public promises:

- Team assurance: $249–$499/month;
- assurance operations/evidence: $1,500–$3,000/month plus setup; and
- enterprise: $2,500–$7,500+/month on an annual contract.

These bands are private hypotheses only. Competitor list prices establish category context; they
do not validate RateLoop willingness to pay, packaging, or budget ownership.

The first sellable service should be small and concrete—a **First Controlled Release**:

> Configure one agent and one review policy, run one controlled synthetic or customer-authorized
> workflow, train the accountable owner, and deliver a verified decision packet.

Test a fixed setup fee rather than building more product in anticipation. The goal of the first
conversation is to learn whether the buyer pays for release confidence, external evidence,
operational monitoring, reviewer access, or something else.

## 9. Pre-outreach release checklist

### Product

- [ ] Fresh owner can complete the invited-review golden path without internal intervention.
- [ ] Owner, reviewer, and shared-evidence pages have one obvious next action.
- [ ] Results show only available, decision-relevant signals.
- [ ] Advanced evidence and identity configuration does not crowd the primary journey.
- [ ] Every empty, waiting, error, expired, and revoked state names the recovery action.
- [ ] English/German, mobile/desktop, and light/dark are visually checked.
- [ ] The readiness sprint adds no database migration, fund-core change, or new external
      provider.

### Evidence and claims

- [ ] One current synthetic packet verifies from the public instructions.
- [ ] A bearer-share recipient sees the bounded outcome and verification result before raw JSON.
- [ ] Share expiry, revocation, access logging, and auditor separation are tested.
- [ ] Public claims pass the evidence-claim guard and match deployed configuration.
- [ ] No compliance, anonymity, custody, independence, or representativeness claim exceeds the
      actual evidence.
- [ ] Current DPA, privacy, subprocessors, security material, and limitations are indexed for a
      prospect response.

### Reliability

- [ ] Local focused tests, type checks, and production build pass at the release SHA.
- [ ] Hosted smoke and core tests pass against `rateloop-tokenless.vercel.app` at the same SHA.
- [ ] Vercel, Railway/Ponder, keeper, Base Sepolia deployment key, and contract addresses agree.
- [ ] No hosted test, alias, or deployment touches `rateloop.ai` or the legacy project.
- [ ] The golden path succeeds twice from a clean synthetic starting point.

### Commercial path

- [ ] Demo booking and email fallback work.
- [ ] The primary landing and empty-state actions lead a buyer toward connection or the first
      controlled release.
- [ ] Pricing allowances are enforced or removed from visible copy.
- [ ] Disabled checkout is not presented as self-serve.
- [ ] Enabled checkout has a working independent business-verification operation and tested
      Stripe lifecycle.
- [ ] The demo has a stated audience, problem, outcome, limitations, and next step.
- [ ] The complete buyer story can be demonstrated in five to eight minutes without exposing
      internal IDs or advanced setup.

## 10. Success metrics before and during outreach

Do not optimize for the number of ratings. Measure whether the current product communicates and
delivers its core value.

- time from fresh account to connected agent;
- time from first review request to evidence packet;
- setup abandonment by step;
- reviewer completion and recovery failures;
- percentage of owners who open, download, share, or verify evidence;
- number of explanations required during a demonstration;
- prospect's chosen valuable outcome: release decision, evidence, monitoring, or reviewer access;
- willingness to run a paid first workflow;
- setup/support hours per pilot; and
- objections that recur across at least three qualified conversations.

The implementation backlog should reopen only from repeated evidence. One prospect request may
justify a manual workaround; repeated paid need may justify a product.

## Final recommendation

Do not wait for a larger RateLoop.

Spend one focused sprint making the existing loop quieter and undeniable:

> connect → review → decide → verify

Lead with one synthetic end-to-end example and the actual evidence it produces. Keep the deeper
features available for questions, not on the first screen. Verify enterprise and delivery
capabilities that already exist instead of expanding them. Keep checkout honest. Run the hosted
golden path at the deployed SHA.

Then begin outreach.

The first customer conversations should decide whether the next material product is a release
gate, an incident/appeal workflow, a broader assurance room, or external reviewer sourcing. Until
then, additional architecture would make the product harder to explain without making its first
proof more compelling.

## Sources rechecked 4 August 2026

- [Braintrust pricing](https://www.braintrust.dev/pricing)
- [LangSmith pricing](https://www.langchain.com/pricing)
- [Langfuse pricing](https://langfuse.com/pricing)
- [Langfuse retention documentation](https://langfuse.com/docs/administration/data-retention)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [European Commission AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [CSA AI-CAIQ v1.1](https://cloudsecurityalliance.org/artifacts/ai-consensus-assessments-initiative-questionnaire-ai-caiq-v1-1)
- [CSA STAR for AI](https://cloudsecurityalliance.org/star/ai)
- [CISA secure-by-design principles](https://www.cisa.gov/sites/default/files/2023-06/principles_approaches_for_security-by-design-default_508c.pdf)
- [CISA secure-by-design alert](https://www.cisa.gov/sites/default/files/2023-12/SbD-Alert-How-Software-Manufacturers-Can-Protect-Customers-by-Eliminating-Default-Passwords-508c_0.pdf)

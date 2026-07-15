# RateLoop tokenless: Humans and Agents production redesign plan (July 2026)

**Status:** Accepted product and implementation amendment for the `tokenless` branch. The
[concise progressive-disclosure product plan](tokenless-concise-product-ux-plan-2026-07-15.md) supersedes this document's
screen composition, always-visible tab, and large-form recommendations where they conflict. It does not
supersede the fund-custody, settlement, identity, privacy, or deployment-isolation decisions in the
[tokenless design of record](tokenless-immutable-implementation-plan-2026-07.md). It turns existing production-grade
building blocks into a coherent two-sided product and closes the gap between the current implementation and a
production-ready launch.

## 1. Recommended decision

Reframe the website around two audiences, not around three generic actions:

1. **For Humans** — discover and answer public or assigned private questions, manage notification preferences, verify
   human uniqueness, configure payout/paid eligibility, and join private groups by invitation.
2. **For Agents** — register and configure agents, create private groups, issue invitations, bind spending and review
   policies, and evaluate agent performance against human judgments. Integration guidance remains in `/docs/ai` until
   it is intentionally incorporated into the agent-management tab.

Remove **Ask** from the public navigation and remove the general-purpose human-authored question builder at `/ask`.
Agents create review requests through MCP, SDK, API, CLI, or an agent-created browser handoff. The handoff remains a
human approval surface for an exact agent-created draft; it is not a blank survey builder.

The primary route structure becomes:

| Surface            | Route                     | Purpose                                                                              |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------ |
| Landing            | `/`                       | Explain the product and route visitors to Humans or Agents                           |
| Human app          | `/human?tab=discover`     | Public feed plus private assigned work                                               |
| Human profile      | `/human?tab=profile`      | Name, World ID, invitations, memberships, eligibility, payout                        |
| Human settings     | `/human?tab=settings`     | Notification channels, availability, language, privacy preferences                   |
| Agent workspace    | `/agents?tab=overview`    | Setup state, recent activity, alerts, and quick actions                              |
| Agent registry     | `/agents?tab=agents`      | Agent identity, model/version metadata, review, audience, timing, and spend policies |
| Private groups     | `/agents?tab=groups`      | Group membership and secure invitation lifecycle                                     |
| Evaluations        | `/agents?tab=evaluations` | Human-agreement, disagreement, calibration, latency, and cost charts                 |
| Exact draft review | `/handoff`                | Existing agent-created browser approval lane                                         |

Keep `/docs` and legal pages as secondary navigation. Authentication still exists, but there is no user-facing
“Account” product area: session controls live in the shell, while human identity/preferences live under **For Humans**
and workspace administration lives under **For Agents**.

## 2. Why this is the right product boundary

The AI or agent is the requester. A person should not arrive at RateLoop, invent a question, and manually reproduce
agent state. The human product is the supply and review experience; the agent product is the configuration, purchasing,
and evaluation experience.

This also creates a clean distinction between two review sources:

- **Public RateLoop network:** discoverable work offered to eligible RateLoop humans. A USDC bounty, platform fee, and
  attempt reserve are mandatory. World ID Proof of Human is required for network eligibility, followed by the existing
  paid-task legal, sanctions, tax, and payout gates before the first paid voucher.
- **Private group:** work visible only to durable members of a workspace-owned group. A bounty is optional. Unpaid
  private work uses the off-chain sealed assignment/evidence path and never creates a zero-value on-chain round. Paid
  private work uses the same itemized USDC settlement path as other compensated work.

A private group is not “public but hidden by a URL.” Membership must be checked at question discovery, assignment,
artifact lease, response submission, notification delivery, result access, and export.

## 3. Current-state audit

The branch is not starting from zero. The following should be reused, not rebuilt:

| Capability             | Current source state                                                                                                                                 | Redesign action                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy visual language | Black fixed rail, compact mobile header, logo/tagline, animated orb, gradient headline, numbered sections, colored left rules, dark cards, pill tabs | Preserve and rationalize into one shared shell/design token system                                                                            |
| Human sign-in          | thirdweb email OTP, Google, Apple, and passkey lead to domain-bound SIWE and a hashed HttpOnly RateLoop session                                      | Keep; production-provision and browser-test every method                                                                                      |
| World ID 4             | Production/staging RP context, server verification, durable Proof of Human enrollment, HMAC references, encrypted evidence, replay controls          | Move into Human Profile, decouple enrollment from the paid-profile prerequisite, and complete live production verification and key operations |
| Human profile          | Private display name and provider-derived identity metadata                                                                                          | Move from Account to Human Profile                                                                                                            |
| Invitations            | Project/cohort reviewer invitations are hashed, expiring, redeemed into reviewer membership                                                          | Generalize from project invitation to durable private-group membership                                                                        |
| Notifications          | In-app records, preferences, verified email subscription, and delivery routes exist                                                                  | Move to Human Settings; add group-aware routing, quiet hours, digests, and web push                                                           |
| Private artifacts      | Encrypted object storage model, leases, access/export logs, retention, deletion, and hiding commitments                                              | Keep; finish production KMS, backup, legal hold, and red-team operations                                                                      |
| Private assignments    | Assignment-only access, confidentiality acceptance, reservation/assignment expiry, encrypted rationale, recovery                                     | Use as the Human Discover private lane                                                                                                        |
| Public feed            | Searchable public questions with media and restored legacy feed layout                                                                               | Use as Human Discover without category chips                                                                                                  |
| Agent API              | Versioned `quote -> ask -> payment -> wait -> result`, idempotency, webhooks, prepaid and x402 paths                                                 | Keep as the execution primitive                                                                                                               |
| Manual handoff         | Agent-created fragment-backed draft, exact browser review, quote, and submission                                                                     | Keep as the default untrusted/one-off lane                                                                                                    |
| Autonomous publishing  | Scoped policy-bound API keys, per-panel/day/month caps, wallet binding, audit events, encrypted signer, resumable x402 run                           | Expose in the Agent UI and authenticated MCP; add agent identity and adaptive review policy                                                   |
| Human-assurance domain | Projects, suites, cases, frozen audience policies, runs, assignments, responses, evidence packets, client decisions                                  | Extend instead of introducing a parallel survey model                                                                                         |
| Paid integrity         | Fixed-base RBTS work, World ID network supply, integrity epochs, post-round scoring, on-chain settlement                                             | Keep; finish active v3 deployment and real paid E2E before public launch                                                                      |

The main gaps are product composition and production operations:

1. The shell still exposes **Answer / Ask / Account** rather than the two real audiences.
2. `/ask` still invites a person to construct public and private asks manually.
3. There is no durable first-class agent identity or immutable agent-version snapshot on a run.
4. There is no workspace-level private group with a safe reusable membership and invitation lifecycle.
5. Spending policies exist in services and migrations but do not have a complete owner-facing product UI.
6. Review frequency cannot yet adapt from continuous calibration evidence.
7. There is no evaluation dashboard joining an agent suggestion to the eventual human result.
8. The active v3 Base Sepolia deployment is pinned as one complete deployment key; hosted publication remains
   fail-closed until the production-readiness register is complete.
9. Production KMS, paid settlement integration, screening/legal operations, workers, E2E, and external review remain open.
10. Starting World ID enrollment currently requires an existing paid rater profile, even though browser identity,
    Proof of Human, and paid eligibility are separate concepts.

## 4. Information architecture and interaction design

### 4.1 Landing page

Keep the old landing-page composition because it is distinctive and already responsive:

- black fixed desktop rail and compact mobile header;
- RateLoop orbital mark and short subtitle;
- Space Grotesk display type with Inter body copy;
- animated multi-color orb, with a reduced-motion static form;
- large gradient hero word;
- numbered `01 / 02 / 03` sections;
- blue `#359EEE`, green `#03CEA4`, pink `#EF476F`, and yellow `#FFC43D` accent rules;
- warm high-contrast primary action and restrained elevated surfaces;
- compact agent-client strip and proof statistics only when backed by live data.

Recommended hero:

> **Level Up Your Agent**
> Give your AI the right human feedback—first often, then exactly when evidence says it needs it.

Primary actions:

- **For Humans** → `/human?tab=discover`
- **For Agents** → `/agents?tab=overview`

Replace the current “Ask / Answer / Evaluation” explainer with:

1. **Agent asks** — through MCP, API, SDK, CLI, or a reviewed handoff.
2. **Humans answer independently** — from the public network or an invited private group.
3. **Review adapts** — RateLoop measures agreement, disagreement, drift, latency, and cost and applies the workspace's
   review policy to future work.

Do not lead with tokenless, blockchain, World ID, x402, or USDC. These remain trust, identity, and payment details. Lead
with human assurance for AI-enabled workflows.

### 4.2 Shared shell

Desktop rail order:

1. RateLoop brand and “Human Assurance” subtitle.
2. Contextual search: question search in Human; agent/run search in Agents.
3. **For Humans**.
4. **For Agents**.
5. **Docs**.
6. Session control at the bottom.

The active item keeps the existing vertical spectrum indicator. Mobile keeps the compact header and one stable-height
menu. Tabs are URL-backed so refresh, deep links, browser history, and support links work.

The shell must never show workspace names, group names, private questions, invitation state, email, or evaluation data
before the session and authorization checks complete. Loading states use neutral skeletons, not cached prior-tenant text.

### 4.3 Human page

The Human page is mobile-first and has exactly three top tabs.

#### Discover

One feed combines two authorized sources without category chips:

- **Assigned to you** cards appear first when there are active private assignments.
- **Available to answer** contains eligible public RateLoop-network questions.
- Completed/expired work does not remain in the default feed; it is available through a compact history control.

Every card shows only what the person needs to decide whether to open it:

- public or private label;
- agent display name and declared model/version when the workspace permits disclosure;
- one bounded prompt and media preview;
- response deadline in local time plus remaining time;
- number of requested answers and progress only when showing progress cannot create herding;
- bounty in human-readable USDC for paid work, or **Internal · unpaid** for private unpaid work;
- required rationale, estimated time, confidentiality notice, and eligibility state.

Do not show aggregate votes before submission. Do not expose the names of other group members or raters. Public cards
reuse the established feed-card layout, image lightbox, response controls, and brand-colored answer buttons. Remove the
legacy category bar entirely.

Search covers public prompt/labels and authorized private assignment metadata. It never indexes decrypted artifact
bodies, rationales, group invite tokens, email addresses, legal evidence, or private client names.

#### Profile

Profile consolidates identity and access without presenting a generic account dashboard:

1. **Display identity:** private display name and optional avatar/initial generated without public wallet exposure.
2. **Proof of Human:** World ID 4 status, honest validity language, verify/retry action, provider and verification date.
3. **Private groups:** active memberships, membership source, expiry if any, leave action, and **Add invitation token**.
4. **Invitations:** token redemption field, preview of organization/group before confirmation, and redemption history.
5. **Paid work:** legal/tax/sanctions/payout checklist shown before the first paid task, never after a person has earned.
6. **Payout:** destination proof and claim/recovery state, with the documented claim-linkability limitation.
7. **Security:** active sessions and sign-out-all; no raw wallet key or provider token is ever displayed.

World ID remains separate from browser authentication. Signing in proves control of the RateLoop principal; World ID
adds a provider-scoped uniqueness assertion; paid eligibility adds legal, tax, sanctions, age, and payout facts. The UI
must not collapse these into one “verified” badge. World ID enrollment may create the minimal rater identity row it
needs, but it must not require or imply completed tax, sanctions, or payout eligibility. Those checks remain the hard
gate before the first paid voucher.

#### Settings

Settings contains user-controlled notification and availability preferences:

- in-app, verified email, and web-push channels;
- assignment available, deadline reminder, assignment completed, payment/claim, result, invitation, and account-security
  topics;
- immediate versus daily digest for non-security messages;
- quiet hours and timezone;
- preferred language;
- availability pause and optional maximum active private assignments;
- public-network and private-group notification toggles;
- per-group overrides;
- data/export/deletion request links and privacy explanation.

Security messages cannot be disabled. A notification worker resolves membership and assignment authorization again at
delivery time; creating a notification does not freeze access forever. Email and push payloads contain a neutral summary
and an authenticated deep link, not private question text.

### 4.4 Agent page

The Agent page is workspace-scoped. Owners and admins can mutate configuration; analysts can read evaluations; viewers
have read-only access to permitted results. It has four URL-backed tabs.

#### Overview

Show setup and operational state, not marketing copy:

- release status and complete deployment key status;
- workspace funding balance and this-month authorized/spent USDC;
- active agents and review-policy health;
- pending reviews, results ready, expiring invitations, and delivery failures;
- current public-network eligibility and private-group counts;
- alerts for revoked keys, exhausted caps, webhook failures, or adaptive-policy reset;
- quick actions: register agent, create group, and open evaluations.

Integration setup remains documented at `/docs/ai`; it has no dedicated workspace tab. If setup controls are restored,
they belong in the agent-management tab and require a separate product decision.

#### Agents

An agent is a durable workspace object, not just a caller-supplied string. The setup form has six sections:

1. **Identity:** display name, stable external ID, declared provider/model, model version or deployment name, environment,
   owner, and optional description. Model identity is labeled **declared** unless backed by a provider attestation.
2. **Integration:** bound API key/policy, allowed project IDs, webhooks, and client type.
3. **Review mode:** manual, always review, rules-based, or adaptive.
4. **Audience:** public RateLoop network, one or more private groups, or an explicit hybrid policy.
5. **Timing and panel:** response window, target answers, minimum usable answers, assignment reservation TTL, and timeout
   behavior.
6. **Spend and privacy:** per-review/day/month USDC caps, payment mode, payer binding, classification, retention, allowed
   artifact types, public-URL permission, and policy-miss behavior.

Recommended validation defaults:

| Setting                |                           Private unpaid |                                               Private paid |                           Public network |
| ---------------------- | ---------------------------------------: | ---------------------------------------------------------: | ---------------------------------------: |
| Target answers         |                                       1+ | 3+, because compensated work uses the paid settlement path |                       3+, recommend 5–15 |
| Minimum usable answers |                                        1 |                                   Contract quorum, never 1 |                 Contract quorum, never 1 |
| Bounty                 |                   Optional, default zero |                                                  Mandatory |                                Mandatory |
| World ID               | Optional unless group policy requires it |                       Policy-defined plus paid eligibility |                                 Required |
| Response window        |                        5 minutes–30 days |                                         15 minutes–30 days |                       15 minutes–30 days |
| Early completion       |     Allowed after target valid responses |                     Only if frozen settlement terms permit | No policy change after first paid commit |

The UI must distinguish:

- response deadline;
- assignment reservation expiry;
- reveal/settlement deadlines for paid rounds;
- result SLO.

“Humans have 2 hours to answer” must never be translated into all four deadlines implicitly.

#### Groups

Groups are workspace-owned reviewer cohorts. A group record includes:

- name, purpose, owner, status, and default confidentiality terms;
- compensation default (`unpaid` or `paid`);
- allowed projects and data classifications;
- optional World ID or qualification requirements;
- member count, active assignments, and notification defaults;
- export permissions; retention remains a project-level artifact policy rather than a group-membership setting.

Owners can create invitations as a token or link with:

- random 256-bit secret and a display prefix;
- server-side hash only;
- group, role, allowed project scope, expiry, maximum redemptions, and optional email/domain binding;
- created-by, created-at, last-used-at, use count, revoke state, and audit history.

Redemption creates durable membership and the secret is discarded. Do not use the invitation token as a permanent read
credential. Default to single-use invitations; allow bounded multi-use invitations only for deliberate internal
onboarding, with short expiry and immediate revocation. Show a group preview before acceptance, but no private content.

A removed member immediately loses feed visibility, artifact leases, response rights, result access, and future
notifications. Existing submitted responses remain in the evidence record under the project's retention policy.

#### Evaluations

Evaluations compare selected agents or versions only within comparable task scopes. The default dashboard shows:

- human agreement with the agent suggestion;
- disagreement rate;
- inconclusive/insufficient-response rate;
- human-human agreement for multi-rater cases;
- response and result latency;
- review coverage (reviewed opportunities / all recorded opportunities);
- USDC and reviewer-time cost per completed review;
- breakdown by agent version, workflow/template, risk tier, audience source, and private group;
- policy stage and adaptive sample rate over time;
- drift/reset events and reason codes.

Charts use finalized source-derived decision packets and immutable run manifests. Every point links to the permitted run
detail and records the agent's suggestion before human responses. “Agreement” is not labeled accuracy, truth, approval,
or safety. One private employee answer is shown as **reviewer response**, not consensus.

Recommended visual set:

1. Agreement with 95% Wilson interval, not a naked percentage.
2. Reviewed versus skipped opportunity timeline.
3. Human response distribution and inconclusive outcomes.
4. Human-human agreement by scope.
5. Latency percentile chart (`p50`, `p90`, `p95`).
6. Cost per usable result.
7. Version comparison table with sample size and scope warnings.

Do not create a global agent leaderboard. Different workflows, risk levels, groups, and task mixes make that number
misleading.

## 5. Adaptive human-review policy

### 5.1 Product behavior

Support four modes per agent and workflow:

- **Manual:** the agent creates a browser handoff when explicitly asked.
- **Always review:** every eligible opportunity creates a human review.
- **Rules-based:** required for configured risk tags, confidence ranges, actions, projects, or data classes.
- **Adaptive:** starts with heavy review and reduces sampling only after sufficient stable human evidence.

The adaptive policy is enforced by RateLoop, not voluntarily interpreted by the agent. The agent supplies the output,
its precommitted suggestion, optional confidence, workflow/risk metadata, and an idempotent opportunity ID. Missing or
unknown risk metadata fails toward review.

### 5.2 Recommended default state machine

Partition evidence by `agent version × workflow/template × risk tier × audience policy`. Never let strong results from a
low-risk copy task reduce review for a high-risk support action.

1. **Calibrating:** review 100% until at least 30 completed comparable cases.
2. **High coverage:** review 50% after the lower bound of the 95% Wilson interval for agreement clears the configured
   threshold for two consecutive windows and completion/human-human agreement gates pass.
3. **Medium coverage:** review 25% after another 50 stable completed cases.
4. **Monitoring:** review 10% after another 100 stable cases.
5. **Reset:** immediately return to 100% for a new model/deployment version, material prompt/workflow change, missing
   metadata, policy change, incident, confidence calibration failure, agreement drop, group change, or detected drift.

The owner may set a higher floor but not silently reduce below the workspace's production minimum. Recommended
production minimum is 10%; critical risk rules remain 100% regardless of aggregate agreement. A policy may use a lower
floor only after a documented risk review and must retain periodic forced samples.

Agreement alone is insufficient. Advancement also requires:

- completed review coverage above the configured minimum;
- no unresolved severe disagreement event;
- acceptable human-human agreement when more than one person answers;
- latency and timeout rates within SLO;
- no material input or model drift;
- enough observations in the exact scope;
- statistically valid handling of abstain/inconclusive outcomes.

### 5.3 Agent-visible assurance state

Expose an authenticated, read-only MCP resource and tool response such as:

```json
{
  "agentId": "agt_...",
  "agentVersionId": "agv_...",
  "scopeId": "evs_...",
  "policyVersion": 4,
  "stage": "high_coverage",
  "reviewRateBps": 5000,
  "completedComparableCases": 47,
  "humanAgreementBps": 8723,
  "humanAgreementLower95Bps": 7810,
  "required": true,
  "reasonCodes": ["sampled", "new_input_cluster"],
  "nextReassessmentAfter": 53
}
```

The agent can explain why review was requested, but it cannot change the stage, metric, policy, or sampling decision.
Skipped opportunities must also be recorded with a privacy-minimized manifest; otherwise the dashboard cannot measure
coverage or selection bias.

## 6. API and MCP contract

### 6.1 Keep the public MCP narrow

Keep the existing public four-tool MCP draft-first:

- capabilities;
- create browser handoff;
- handoff status;
- result retrieval.

It remains suitable for public, synthetic, or safely redacted one-off work. It must not gain an unscoped publish,
payment, group-management, invitation, or private-artifact tool.

### 6.2 Add an authenticated workspace MCP

Use OAuth 2.1 for remote interactive clients and policy-bound workspace credentials for server/CLI clients. Both call
the same authorization service and expose only scopes granted to that client.

Recommended tools:

| Tool                                   | Purpose                                                           | Minimum scope     |
| -------------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `rateloop_get_assurance_state`         | Read current adaptive stage and evidence summary                  | `evaluation:read` |
| `rateloop_evaluate_review_requirement` | Record opportunity metadata and receive required/recommended/skip | `review:decide`   |
| `rateloop_request_review`              | Create a policy-bound review using `quote -> ask -> payment`      | `panel:publish`   |
| `rateloop_wait_for_review`             | Bounded wait with continuation cursor                             | `result:read`     |
| `rateloop_get_review_result`           | Retrieve versioned result/evidence references                     | `result:read`     |
| `rateloop_create_manual_handoff`       | Create exact browser approval fallback                            | `handoff:create`  |

Configuration, key issuance, group creation, and invitation issuance stay owner/admin browser actions in the first
production release. They are too consequential to expose as general agent tools.

`rateloop_evaluate_review_requirement` must be idempotent by opportunity ID and return the frozen policy decision.
`rateloop_request_review` accepts that decision ID so policy, audience, spending, and evaluation metadata cannot diverge
between the decision and the paid ask.

### 6.3 Browser and REST endpoints

Add versioned services/endpoints for:

- agent registry and immutable agent versions;
- review policies and current state;
- private groups, memberships, invitation issue/revoke/redeem;
- evaluation opportunities, observations, aggregates, and comparison queries;
- notification channel, quiet-hour, digest, and per-group preferences;
- production-safe owner views of publishing policies and budget audit events.

Reuse the existing project/run/assignment, quote/ask/payment/wait/result, and evidence-packet endpoints. Do not fork a
second review execution protocol for the new UI.

## 7. Data model and migrations

Use forward-only migrations after the current `0028_tokenless_public_question_media` migration.

### 7.1 Agent identity

Add:

- `tokenless_agents`: workspace, display name, external ID, owner, status, current version, created/updated timestamps.
- `tokenless_agent_versions`: immutable provider/model/deployment declaration, configuration commitment, created-by, and
  effective interval.
- `tokenless_agent_integrations`: agent-to-key/policy/webhook/project binding without storing raw secrets.

Each assurance opportunity and run stores `agent_id`, `agent_version_id`, the pre-human suggestion, optional declared
confidence, task/workflow key, risk tier, and an immutable metadata commitment. The result must never infer an agent
version from its current mutable profile.

### 7.2 Private groups

Add:

- `tokenless_private_groups`;
- `tokenless_private_group_memberships`;
- `tokenless_private_group_invitations`;
- `tokenless_private_group_invitation_events`;
- `tokenless_private_group_policy_versions`.

Store invitation hash, prefix, scope, expiry, redemption cap/count, optional binding, revocation, and audit metadata.
Never store the raw token after issuance. Membership is the authorization primitive after redemption.

Reuse or migrate existing project/cohort reviewer records so one person is not represented by two conflicting
membership graphs. The migration must preserve existing invitation-created reviewer memberships and assign them to a
generated project group where necessary.

### 7.3 Adaptive review and evaluation

Add:

- `tokenless_agent_review_policies`: immutable versioned rules, stage thresholds, floors, risk overrides, reset rules,
  audience/spend references, and owner approval.
- `tokenless_agent_review_opportunities`: every reviewed or skipped opportunity, idempotency key, minimized manifest,
  frozen decision, reason codes, and selection probability.
- `tokenless_agent_evaluation_scopes`: stable partition definition and current policy stage.
- `tokenless_agent_evaluation_observations`: finalized human result joined to the precommitted agent suggestion.
- `tokenless_agent_evaluation_rollups`: rebuildable performance cache, never the source of truth.
- `tokenless_agent_review_policy_events`: append-only stage changes, resets, overrides, and actor/reason.

Evaluation aggregation must be rebuildable from source-derived opportunity, run, response, and evidence records. Store
selection probability so later analysis can identify biased samples rather than pretending adaptively reviewed cases
are representative of all outputs.

### 7.4 Notifications

Extend current notification tables with:

- web-push subscriptions and VAPID key version;
- quiet hours/timezone/digest mode;
- per-group overrides;
- delivery attempts, provider message ID, retry state, and dead-letter reason;
- authorization recheck and redacted payload version.

Security and invitation-revocation messages bypass quiet hours; private question content never appears in email or push.

## 8. Production privacy and identity requirements

### 8.1 World ID 4

The current implementation already uses IDKit 4, production/staging RP context, a server-side signing key, direct
`POST /api/v4/verify/{rp_id}` verification, action-bound uniqueness, durable enrollment, HMAC subject references, and
encrypted evidence. Production completion still requires:

1. register and freeze the production RP/action and allowed origins;
2. keep the RP signing key server-only and move it to managed signing/KMS where supported;
3. apply migration `0020_world_id_proof_of_human` to the isolated production database;
4. provision and document subject-HMAC and evidence-encryption key rotation/retention;
5. test desktop QR, mobile handoff, cancellation, timeout, replay, duplicate account, provider outage, and recovery;
6. verify the nullifier is stored atomically before the UI reports success;
7. keep the honest claim: one-time provider-scoped uniqueness at enrollment, not expertise, honesty, current liveness,
   or a universal identity.

World ID is mandatory only for the public RateLoop-network path unless a private group explicitly requires it. It never
replaces paid eligibility.

### 8.2 Artifact and identity privacy

Before hosted private data:

- use a production object store and per-domain envelope encryption backed by KMS/HSM;
- separate browser identity, provider evidence, vote linkage, customer artifact, and statutory/tax key domains;
- use random hiding commitments, not unsalted predictable content hashes;
- issue short-lived assignment-specific leases and revoke them with membership/assignment state;
- record read/export events without logging plaintext content;
- implement retention workers, deletion, legal hold, export, backup/restore, and key-loss runbooks;
- prohibit private artifacts, prompts, rationales, invitation tokens, and raw identities from analytics/error logs;
- disclose that assigned reviewers and RateLoop can read content served to them;
- keep personal data and customer artifacts off-chain; publish only the minimum commitments and settlement facts needed.

On-chain data and transaction/address linkage can remain personal data. A normal payout can permanently link a vote key
to the destination, and reused payout destinations can link rounds. The UI and privacy notice must preserve that limit.

### 8.3 Tenant isolation

Add an authorization matrix covering every role × route × workspace × project × group × assignment state. Test direct
object references, revoked membership, stale leases, cached responses, notification delivery, result export, and
cross-tenant search. Authorization is checked server-side on every read and mutation; client tabs are not security
boundaries.

## 9. Payments and compensation

### Public network

Every public-network request must:

- use a B2B workspace principal;
- quote bounty, fee, attempt reserve, and total funding in human-readable USDC and canonical atomic units;
- pass per-review/day/month publishing-policy caps transactionally;
- bind the exact audience policy, panel size, deadlines, terms, deployment key, and payer;
- use prepaid balance or a locally signed short-lived x402/EIP-3009 authorization;
- reject zero bounty, missing reserve, one-person quorum, stale deployment, or mixed addresses;
- pay accepted valid work through a terminal path even on quorum or infrastructure failure according to the design of
  record.

### Private group

- `unpaid`: no quote, x402 authorization, fund-core round, tax/payout gate, or USDC promise. Use sealed off-chain
  responses and a signed evidence packet.
- `paid`: itemize and enforce compensation before assignment; complete legal/payout eligibility before the first paid
  voucher; use the paid settlement path and receipt.

The UI must never display `0 USDC bounty` as if it were a paid round. It displays **Internal · unpaid** and explains who
can see the work.

## 10. Production implementation sequence

Keep each numbered slice as its own commit unless a migration and its directly coupled service tests cannot safely be
separated.

### Phase A — accept the product boundary and remove the wrong journey

1. **`docs(product): define Humans and Agents architecture`**
   Accept this amendment in the design of record and mark the prior Ask/Account IA as superseded.
2. **`refactor(app): route navigation to Humans and Agents`**
   Add `/human` and `/agents`, shared URL-backed tabs, route guards, and legacy redirects.
3. **`refactor(app): remove human-authored Ask`**
   Remove `/ask` from shell/landing, delete the blank builder, retain `/handoff`, and prove removed copy/routes with `rg`.
4. **`refactor(human): compose discover profile and settings`**
   Move existing feed, profile, invitation, World ID, eligibility, payout, and notification components without changing
   their authorization model.
5. **`style(app): preserve legacy RateLoop design system`**
   Consolidate shell, typography, orb, cards, tabs, accent rules, responsive behavior, focus states, and reduced motion.

Compatibility redirects:

- `/rate` → `/human?tab=discover`;
- `/settings` → `/human?tab=profile`;
- `/settings/eligibility` → `/human?tab=profile&section=paid-work`;
- `/settings/workspace` → `/agents?tab=overview`;
- `/ask` → `/agents?tab=overview` after a deprecation window.

Do not redirect `/handoff`.

### Phase B — private groups and human production loop

6. **`feat(db): add private reviewer groups`**
   Add group, membership, policy-version, invitation, and audit tables; migrate existing cohort memberships.
7. **`feat(groups): enforce durable membership invitations`**
   Issue, preview, redeem, revoke, expire, cap, and audit tokens; discard raw token after issuance.
8. **`feat(human): integrate private groups into profile and discover`**
   Add token redemption, memberships, group-aware feed, removal, and honest private/unpaid labels.
9. **`refactor(identity): decouple World ID from paid eligibility`**
   Allow a signed-in human to complete Proof of Human before tax/payout onboarding, create only the minimal identity
   record required for provider binding, and keep paid eligibility as the voucher gate.
10. **`feat(notifications): deliver group-aware production notifications`**
    Add quiet hours, digests, per-group settings, web push, delivery retry/dead-letter, and authorization rechecks.
11. **`test(e2e): verify invited private review`**
    Invite → sign in → redeem → notification → private assignment → artifact lease → answer → evidence → remove member.

### Phase C — agent identity and owner configuration

12. **`feat(db): add durable agents and versions`**
    Add agent, immutable version, and integration bindings; extend opportunity/run provenance.
13. **`feat(agents-ui): manage agent identity and model declarations`**
    Build registry, version changes, role checks, connection state, revoke/rotate, and immutable run snapshot preview.
14. **`feat(agents-ui): expose publishing and spending policies`**
    Productize existing policy services with USDC decimal inputs, per-review/day/month caps, payer binding, project,
    audience, classification, retention, expiry, and audit history.
15. **`feat(agents-ui): configure audience timing and panel rules`**
    Add public/private/hybrid policy, group selection, bounty conditionality, response windows, target count, quorum,
    reservation TTL, and timeout behavior.
16. **`docs(integrations): maintain production setup guidance`**
    Keep MCP/API/SDK/CLI/webhook and manual-handoff guidance in `/docs/ai`; do not add a dedicated integration tab.

### Phase D — adaptive review and evaluation

17. **`feat(db): add adaptive review evidence`**
    Add versioned policies, opportunities, scopes, observations, rollups, and append-only policy events.
18. **`feat(evaluation): bind agent suggestions to human results`**
    Freeze the pre-human suggestion/confidence, join only source-derived results, handle abstain/inconclusive states, and
    rebuild rollups.
19. **`feat(policy): enforce adaptive review state machine`**
    Add deterministic sampling, Wilson-bound gates, minimum samples, risk overrides, floors, drift/reset rules, and
    concurrency/idempotency tests.
20. **`feat(mcp): expose authenticated assurance decisions`**
    Add OAuth/scoped tools for state, decide, request, wait, result, and handoff without exposing owner mutations.
21. **`feat(evaluations-ui): add agent comparison dashboards`**
    Add filters, uncertainty, coverage, disagreement, human-human agreement, latency, cost, and reset timelines.
22. **`test(e2e): verify adaptive agent review`**
    Calibrate → step down → forced sample → drift → reset → policy miss → handoff, including crash and retry paths.

### Phase E — production hardening

23. **`fix(contracts): close remaining paid-settlement blockers`**
    Complete assignment-specific paid settlement/receipts and any unresolved reserve, scoring, deadline, gas, or size
    findings before external review.
24. **`chore(security): move production keys to managed custody`**
    KMS/HSM for issuer, artifact, evidence, webhook, provider, and service domains; gas-only relayer remains separate;
    reconcile prepaid funds and ledger.
25. **`feat(operations): automate pipeline and notification workers`**
    Deployment-pinned settlement ingestion, evidence publication, webhooks, retention, digests, retries, and alerts.
26. **`feat(compliance): complete real-money operating controls`**
    B2B trader/VAT gate, funder screening/geoblocking, paid eligibility provider, DAC7 records, invoices/reconciliation,
    DSA notice/action, German legal copy/review, DPIA, Art. 30 records, and subprocessor/DPA inventory.
27. **`test(security): red-team privacy and tenant boundaries`**
    Cross-tenant IDOR, revoked membership, search, cache, notification, artifact lease, export, key rotation, backup, and
    incident recovery.
28. **`test(e2e): exercise complete paid Base Sepolia journey`**
    Agent policy → quote → funding → assignment → World ID/eligibility → sealed response → settlement → claim/receipt →
    evaluation → adaptive state.
29. **`chore(deploy): create fresh active tokenless v3 bundle`**
    Deploy after all fund-core changes, generate active artifacts, reset deployment-scoped Ponder schema, and update the
    isolated app, database, Ponder, keeper, workers, and signer atomically.
30. **`test(audit): complete external contract privacy and app review`**
    Resolve findings, publish verifier/runbooks and trust limitations, then repeat the full live fixture.
31. **`chore(release): enable isolated production`**
    Publish only after all fail-closed checks pass. The release targets only the
    `rateloop-tokenless` Vercel/Railway line and its Vercel-provided domain. It must not move `main`, the legacy
    `rate-loop-nextjs` project, `rateloop.ai`, or `www.rateloop.ai`.

Base mainnet and real USDC follow only after the Base Sepolia production fixture, external reviews, legal/operations
gates, and an explicit mainnet go/no-go. Testnet success is not the audit or legal gate.

## 11. Verification strategy

### Unit and property tests

- public always requires paid terms; private unpaid rejects payment claims and zero-value chain rounds;
- one answer allowed only under eligible private policy; public network cannot reduce below contract quorum;
- response, reservation, reveal, settlement, and result deadlines remain distinct and ordered;
- invitation entropy, hashing, expiry, max-use, binding, revocation, race, replay, and audit behavior;
- membership removal revokes every downstream authorization path;
- agent version/run snapshots are immutable;
- every adaptive transition and reset is deterministic and idempotent;
- concurrent cap reservations cannot overspend;
- missing risk metadata fails toward review;
- evaluation rollups rebuild exactly from source records;
- confidence intervals, denominators, abstentions, and selection probabilities are correct;
- secrets, private content, and invitation tokens do not enter logs, analytics, or notification payloads.

### Browser E2E

- landing → Humans and landing → Agents on desktop/mobile;
- email, Google, Apple, and passkey sign-in plus session expiry/revocation;
- World ID desktop QR and mobile flow against the production RP configuration;
- human public answer and private invitation/assignment journeys;
- owner registers agent, creates group, issues invitation, creates policy, and revokes both;
- manual handoff and delegated prepaid/x402 runs;
- evaluation filters, empty/small-sample warnings, version comparison, and deep links;
- keyboard, screen reader, contrast, reduced motion, timezone, and responsive behavior;
- cross-tenant direct URL and stale-cache denial.

### Live service gates

- every service reports the same complete active deployment key and expected bytecode;
- active contracts registry contains exactly the fresh v3 deployment; v1/v2 remain historical only;
- migrations `0000` through the new redesign migrations applied to the dedicated database;
- Ponder starts from the fresh deployment block in a deployment-scoped schema;
- issuer, credential signer, artifact/evidence keys, gas relayer, prepaid funder, thirdweb secret, webhook signer, and
  notification provider use distinct roles;
- settlement, evidence, webhook, retention, notification, and adaptive-rollup workers have health, lag, retry, and
  dead-letter alerts;
- load tests cover feed/search, opportunity decisions, invite bursts, notifications, long polling, and result reads;
- backup restoration and key-rotation drills complete without cross-tenant leakage or loss of required evidence;
- `rateloop.ai` deployment ID and remote `main` SHA are unchanged before and after tokenless publication.

## 12. Release gates and acceptance criteria

The redesign is production-ready only when all of the following are true:

1. Landing offers only **For Humans** and **For Agents** as primary product actions.
2. A blank human-authored Ask surface is absent from navigation and production routes.
3. An agent can use reviewed handoff, delegated prepaid, or delegated x402 within an owner-approved policy.
4. Public-network review cannot launch without valid USDC economics and eligible World ID-backed supply.
5. A private group can run a one-person unpaid review without a fake bounty or chain round.
6. Invitation tokens are hashed, scoped, expiring, capped, revocable, and exchanged for durable membership.
7. Removed members cannot discover, lease, answer, receive, or export later private content.
8. Humans can manage World ID, name, memberships, invitations, notifications, eligibility, and payout from the Human page.
9. Owners can configure agent name/model declaration, group, answer count, response window, spend caps, privacy, delivery,
   and policy-miss behavior from the Agent page.
10. Adaptive review starts at high coverage, steps down only on sufficient scoped evidence, retains forced samples, and
    resets on change or drift.
11. The agent can read the current assurance state through authenticated MCP, but cannot edit evidence or policy.
12. Evaluations use precommitted agent suggestions and source-derived human results and show uncertainty/sample size.
13. World ID, thirdweb, notifications, private storage, workers, and payment paths pass live production E2E.
14. Production secrets use managed, separated custody and operational rotation/recovery runbooks.
15. Paid settlement, contracts, privacy, tenant isolation, and operating controls pass external review.
16. A fresh active v3 deployment and every isolated service share one complete deployment key.
17. No tokenless release mutates `main`, the legacy Vercel project, or either `rateloop.ai` domain.

## 13. Research basis

- The live legacy [RateLoop landing page](https://www.rateloop.ai/) validates the strongest reusable visual and content
  elements: “Level Up Your Agent,” Humans/Agents CTAs, the agent-client strip, the orb-led hero, numbered sections, and
  the Discover feed. Legacy token/governance/reputation mechanics are not carried forward.
- [World ID IDKit 4 integration](https://docs.world.org/world-id/idkit/integrate) requires server-created RP context,
  backend verification, and replay-safe nullifier storage. The branch already implements this architecture; production
  work is provisioning, operations, and live verification rather than a mock badge.
- [World ID 4 migration guidance](https://docs.world.org/world-id/4-0-migration) distinguishes one-time uniqueness from
  stable session continuity. RateLoop should keep durable enrollment language narrow and not imply universal or ongoing
  identity.
- [MCP authorization guidance](https://modelcontextprotocol.io/docs/tutorials/security/authorization) uses OAuth 2.1
  conventions for protected remote operations. This supports a separate authenticated workspace MCP while keeping the
  public handoff MCP narrow.
- [Coinbase x402 documentation](https://docs.cdp.coinbase.com/x402/welcome) confirms programmatic USDC payment over HTTP,
  while [Agentic Wallet limits](https://docs.cdp.coinbase.com/agentic-wallet/mcp/faq) provide a useful product precedent
  for human-set per-call/session limits that agents respect but cannot change. RateLoop needs stronger server-side
  per-review/day/month caps because it funds multi-step escrowed work.
- [Anthropic's agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  recommends combining deterministic, model, and human graders and calibrating subjective graders against humans. That
  supports periodic human sampling rather than either reviewing every output forever or reducing review from a raw
  approval percentage.
- [NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for documented human-AI roles, oversight,
  production monitoring, and repeatable evaluation. The adaptive policy therefore records every opportunity, policy
  decision, stage change, and reset rather than leaving sampling to an opaque agent prompt.
- The final [EDPB blockchain-data guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-on-processing-of-personal-data-through-blockchain-technologies_en)
  reinforce data minimization, privacy by design, and careful justification of public-chain data. RateLoop keeps
  customer artifacts, identities, memberships, and evaluation details off-chain and limits the chain to settlement and
  hiding commitments.

## 14. Accepted product defaults

The following defaults are accepted unless production evidence or user research disproves them:

1. `/human` and `/agents` are the canonical product routes; old routes redirect.
2. Public RateLoop-network work is always paid and World ID-gated.
3. Private groups may be unpaid; private unpaid work is off-chain and supports one answer.
4. The manual lane is an exact agent-created `/handoff`, never a blank public `/ask` form.
5. Agent/model identity is declared and version-snapshotted, not presented as cryptographically verified.
6. Adaptive review uses scoped evidence, a 100% calibration phase, a 10% recommended floor, and 100% critical-risk
   overrides.
7. “Human agreement” is the dashboard term; it is not called truth, accuracy, approval, or safety.
8. Public MCP remains draft-first; authenticated MCP is policy-enforced and cannot mutate owner settings.
9. Invitation secrets are temporary exchange credentials; membership is the durable authorization state.
10. The first production release stays isolated on the tokenless deployment line and does not replace `rateloop.ai`.

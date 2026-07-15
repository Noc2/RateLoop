# RateLoop tokenless: concise, progressive-disclosure product plan (15 July 2026)

**Status:** Accepted product and implementation amendment for the `tokenless` branch. This plan supersedes the
screen composition, always-visible tab, and large-form recommendations in the
[Humans and Agents production redesign](tokenless-humans-agents-production-redesign-plan-2026-07.md) wherever they
conflict. It does not weaken the fund-custody, settlement, eligibility, privacy, identity, authorization, or deployment
isolation requirements in the [tokenless design of record](tokenless-immutable-implementation-plan-2026-07.md).

## 1. Product decision

RateLoop must show the user the next necessary action, not the product's entire data model.

For a newly created workspace, the next action is **Connect an agent**. Until that succeeds, the Agents experience must
not show agent registry explanations, empty connection history, empty connected-agent lists, review-policy editors,
publishing-policy editors, group management, evaluation dashboards, billing prompts, or autonomous-spend controls.

The branch-wide rules are:

1. Every screen has one obvious primary action.
2. A control appears only when the current user can use it and the current workflow needs it.
3. Empty downstream sections do not render. The current state replaces the previous state instead of stacking another
   card below it.
4. Backend terminology is not automatically user-facing terminology.
5. Safe defaults handle the common path. Advanced controls require an explicit user action.
6. Essential instructions and consequences stay visible and concise.
7. Useful secondary definitions move into an accessible info popover.
8. Technical explanations belong in Docs, not in task UI.
9. Legal and safety disclosures remain complete, but they appear at the decision where they matter.
10. Removing a UI capability requires deleting or deliberately retaining its backend path; hiding a field is not a
    complete product decision.

This is a product-composition correction, not permission to replace RateLoop's visual identity. Preserve the black rail,
compact mobile header, RateLoop logo and tagline, orb, typography, gradients, surface cards, and established responsive
proportions.

## 2. Evidence from the current branch and live site

The audit used the signed-in live deployment at `https://rateloop-tokenless.vercel.app` and the current `tokenless`
source on 15 July 2026.

| Surface | Current live first view | Problem |
| --- | --- | --- |
| Fresh-workspace Agents tab | 316 visible words, 19 form controls, 6 cards/sections, 4 workspace tabs, and 3 task actions | The one required action is buried in future configuration and empty states |
| Agents shell | Shows “Search answers” | The control has no agent-workspace job and should not appear |
| Human Discover | Shows All, Public, Private, and Submitted filters | Submitted is an unimplemented empty state; the controls precede content |
| Human Profile | 218 visible words and 9 cards/sections | Identity, invitations, memberships, World ID, and paid eligibility all compete at once |
| Human Settings | Five topic toggles plus email setup on first view | Defaults can handle the common case; customization should be requested |
| Landing page | 441 visible words, 16 cards/sections, and more than 20 actions/links in the main content | Mechanism, setup, pricing, FAQ, and trust detail compete with the two intended entries |
| Trust page | 20 claim cards and 24 evidence links | The evidence is legitimate, but the default registry view is hard to scan |
| Docs / Agents and MCP | 864 visible words | Length is justified in documentation, but navigation and first-step orientation need improvement |

The screenshots in the initiating review accurately reflect the deployed page. The large blank areas are not merely a
spacing issue: the component tree renders every future panel in sequence.

Current source composition:

- `app/(app)/agents/page.tsx` always renders the four-tab navigation.
- `AgentWorkspacePanels.tsx` always renders connection, registry, review-policy, and publishing-policy panels for an
  owner/admin.
- `AgentConnectionPanel.tsx` renders empty Connection progress and Connected agents sections.
- `AgentRegistryPanel.tsx` renders an explanatory header and a separate empty registry card.
- `AgentPublishingPolicyPanel.tsx` renders the full autonomous-spend form before an agent exists.
- `TokenlessShell.tsx` renders answer search on every product route.
- `AnswerPageClient.tsx` renders the Submitted filter even though its read model is not implemented.
- `SupportedAgentsSection.tsx` exposes six client-specific public MCP setup modals on the landing page even though the
  workspace product now has a one-message connection journey.

There is also a design-of-record mismatch. The accepted one-message connection amendment says the safe connection
requires no publishing policy and grants no publishing or spending permission. The current first-run page nevertheless
places a publishing-policy form directly below the connection action and says policies bind during approval.

## 3. Content and interaction standard

### 3.1 Three content levels

Every piece of copy must be assigned to one of these levels:

| Level | Purpose | Placement |
| --- | --- | --- |
| Essential now | Tells the user what to do, what happened, what a choice changes, or why an action is blocked | Visible in the task flow |
| Secondary | Defines a term or explains a non-critical tradeoff | Accessible info icon, popover, or “Learn more” disclosure |
| Technical/reference | Describes protocols, hashes, immutable versions, scoring, settlement internals, API shapes, or recovery details | Docs or a dedicated detail view |

If copy does not fit one of these levels, remove it.

### 3.2 UI red lines

- Do not render more than one empty state on a page.
- Do not render a section solely to say that nothing exists.
- Do not show a disabled action such as “Billing is not enabled yet.”
- Do not use a paragraph to compensate for a confusing label.
- Do not use tiny, low-contrast helper text for information required to act safely.
- Do not show raw hashes, IDs, atomic amounts, policy version mechanics, or transport terminology on the common path.
- Do not show a selector when there is only one possible choice.
- Do not show a filter until there is enough content for filtering to solve a real problem.
- Do not add a tab for a future feature or an empty dataset.
- Do not repeat the same fact in a heading, subtitle, helper paragraph, empty state, and button.

### 3.3 Accessible secondary explanation

Add one shared `InfoPopover` primitive for short secondary explanations:

- a real button with an accessible name;
- keyboard focus, Escape close, outside-click close, and focus return;
- touch support without hover;
- `aria-expanded` and `aria-controls`;
- readable contrast and at least normal body text size;
- no essential completion instruction hidden inside it.

Native `title` attributes and hover-only tooltips do not satisfy this requirement.

## 4. Canonical workspace onboarding state machine

The default `/agents` route must resolve the workspace state before choosing what to render.

| State | Visible product | Primary action |
| --- | --- | --- |
| Signed out | One sign-in card | Sign in |
| No workspace | Workspace name field only | Create workspace |
| Workspace exists, no connection | One connection card | Copy connection message |
| Connection active | The connection card becomes progress | Continue in agent; Check status only when needed |
| Owner approval required | Exact client identity, requested capability, consequence | Allow or deny |
| Connected with safe access | One success card and compact agent row | Finish; optional Manage |
| Connected, capability step-up requested | One permission/budget decision | Approve or deny the exact step-up |
| Agent has real activity | Workspace overview and relevant management navigation | Context-dependent |

### 4.1 Fresh-workspace target

The signed-in page should fit without scrolling:

> **Connect your agent**
>
> Copy one message into the agent chat you want to connect.
>
> **Copy connection message** ⓘ

The info popover may say:

> This creates safe access. The agent cannot spend, publish, read private workspace content, or change workspace
> settings.

There is no workspace selector for one workspace, no tab row, no progress section, no registry section, and no policy
form.

### 4.2 Connection in progress

Clicking the button must replace the connection card's content rather than append another card:

> **Connecting…**
>
> Continue in your agent. You can close this page.
>
> **Check status** · **Cancel**

Only show Check status when automatic refresh has failed or the user explicitly asks. Keep the existing visibility-aware
polling and one-copy clipboard fallback.

### 4.3 Connected

On success, replace progress with:

> **[Agent name] connected**
>
> Safe access · No spending or private workspace content
>
> **Done** · **Manage**

The detailed immutable version, client, integration ID, history, and revocation controls belong in Manage. A safe
connection must not silently create or imply a publishing policy.

### 4.4 Workspace context

- With one workspace, show its name as quiet context or omit it when already obvious.
- With multiple workspaces, show one compact selector in a stable workspace header shared by Overview, Agents, Groups,
  and Evaluations.
- Never repeat the selector and its explanation inside each panel.
- Persist the selected workspace in the URL or a server-owned preference so deep links remain deterministic.

## 5. Data-classification decision

### 5.1 Keep the enforcement, remove the six-checkbox UI

There is a real need for privacy classification in the backend:

- public questions are limited to public, synthetic, or redacted material and require a no-sensitive-data
  confirmation;
- credential maximum classification is enforced;
- publishing policies can reject a request outside their content boundary;
- private groups restrict projects by classification;
- rater discovery excludes private classifications from the public feed.

The current user-facing model is nevertheless wrong. It exposes six checkboxes as if they were six independent
permissions, while the code actually has inconsistent subsets:

- seven values in `lib/privacy/dataPolicy.ts`, including `regulated`;
- six values in the question constraint and publishing form;
- four values in the project API;
- three public handoff values;
- three private-group values.

The list conflates three different questions: who can see the content, where it came from or how it was sanitized, and
how sensitive it is.

### 5.2 Target model

Normalize the domain into separate enforced dimensions:

1. **Visibility:** public or private.
2. **Public material declaration:** public, synthetic, or redacted. This is selected or derived per public request and
   paired with the no-sensitive-data confirmation.
3. **Private sensitivity ceiling:** internal, confidential, restricted, or regulated. Regulated remains unavailable
   unless the workspace has the required contract mode.

The publishing grant then needs only:

- whether the agent may use the public lane;
- the maximum private sensitivity it may submit;
- the exact named project/audience it may use.

Do not expose an arbitrary allowed set. A maximum sensitivity ceiling is understandable and matches the ranked
credential enforcement already present.

### 5.3 User-facing choices

When an owner explicitly enables autonomous review requests, present:

- **Public or test material only** — public, synthetic, or safely redacted inputs;
- **Private workspace material** — private projects up to the workspace's allowed sensitivity;
- **Restricted or regulated material** — shown only when separately enabled.

Use an info popover to define the choice. The per-request review or preview remains responsible for identifying public,
synthetic, or redacted material accurately.

### 5.4 Migration

Add an append-only migration after the current `0047` migration:

- add visibility/material-kind/private-sensitivity fields where needed;
- add a publishing-policy public-lane flag and private-sensitivity ceiling;
- map existing sandbox rows deterministically;
- fail closed on any row that cannot be mapped;
- update indexes and constraints;
- update `dataPolicy.ts`, `productCore.ts`, private-group enforcement, question records, account routes, SDK schemas,
  agent/CLI payloads, MCP handoff validation, docs, fixtures, and tests together;
- remove `allowed_data_classifications_json` and compatibility parsing only after every active consumer has migrated.

Do not ship a UI-only alias over the inconsistent schema as the final state.

## 6. Agent workspace redesign

### 6.1 Navigation

Before the first agent is connected, do not render Overview / Agents / Groups / Evaluations tabs. The user is in
onboarding, not workspace administration.

After connection:

- Overview appears when there is operational state worth summarizing.
- Agents appears for connected-agent management.
- Groups appears after the user chooses private reviewers or creates a group.
- Evaluations appears after the first attributable run exists.

Deep links to unavailable sections return to the current next action with a concise explanation. They do not render an
empty dashboard.

### 6.2 Overview

The current Overview leads with subscription and panel-funding machinery. Replace it with a compact operational summary
only after setup:

- connected agents;
- active review behavior;
- current work requiring attention;
- recent results;
- budget state only when paid work is enabled.

Move subscription management behind a Billing action. Hide zero-value funding cards until the workspace enables paid
work. Creating another workspace becomes an account/workspace action, not a permanent form at the bottom of Overview.

### 6.3 Connected-agent management

The common agent row contains:

- agent display name;
- declared model/version;
- connection status;
- one Manage action.

Manage reveals only the relevant actions:

- disconnect;
- change declared version;
- view connection details/history;
- configure review behavior;
- request autonomous publishing access.

Raw external IDs, integration IDs, client capabilities, policy version IDs, and audit metadata belong in a technical
details disclosure or exported audit record.

### 6.4 Review behavior

The current review-policy form exposes mode, enforcement, audience, thresholds, production floor, maximum unreviewed
gap, confidence, risk-tier strings, and latency simultaneously.

Replace the default editor with four understandable presets:

- **Review everything**
- **Review higher-risk work**
- **Adaptive review**
- **Manual handoff only**

Then ask for the reviewer source: invited group, RateLoop network, or hybrid, only when the selected preset needs it.

Agreement threshold, sampling floor, maximum gap, confidence threshold, risk mapping, and latency remain enforced
settings, but use tested defaults and place them behind **Customize rules**. Host-enforced behavior appears only when the
connected host actually supports and attests to it; do not expose a selector that can create a false guarantee.

### 6.5 Autonomous publishing and spend

Safe connection and autonomous publishing remain separate.

The user must explicitly choose **Allow autonomous review requests**. The common step-up asks only:

1. Where may the agent request reviewers?
2. What content boundary applies?
3. What is the maximum cost per request?
4. What is the daily limit?
5. What is the monthly limit?

Then show a review screen with the exact grant and one Approve action.

Control decisions:

| Current control | Real need | Decision |
| --- | --- | --- |
| Policy name | No common-path need | Generate from agent/version and keep an audit version |
| Reviewer supply | Yes | Ask in review setup, using human labels |
| Frozen admission-policy hash | Yes for enforcement, no as manual input | Select a named group/audience; resolve and bind the hash server-side |
| Six data-classification checkboxes | Backend need, wrong UI | Replace with public-lane permission and private-sensitivity ceiling |
| Payment rail | Yes only for paid autonomy | Default to workspace prepaid; show x402 only when a bound payer exists |
| Per-request / daily / monthly caps | Yes | Keep as the three visible budget fields |
| Bounty cap | Enforced economic detail | Derive from the maximum request cost; show in the confirmation breakdown |
| Accepted-work reserve cap | Enforced economic detail | Derive and disclose in quote/confirmation, not as a first-line field |
| Platform-fee cap | Enforced safeguard | Use the platform's current fee ceiling; expose under advanced only if owners can change it |
| Maximum responses | Real review-quality control | Set through reviewer/panel preset; allow advanced override |
| Policy miss | Real failure behavior | Default to human approval; advanced option may choose deny |
| Open manual handoff | Real separate lane | Move outside the publishing-policy form |

The server still freezes and enforces every required economic field. Simplifying the form must not reduce the
transactional caps or accepted-work guarantees.

### 6.6 Groups

Do not show Groups until the user chooses invited reviewers or deliberately creates a group.

Default group creation:

- group name;
- optional purpose;
- Create.

Use safe defaults for unpaid internal review, notification delivery, no export, and no World ID unless the chosen
workflow requires different settings. Put policy defaults behind Customize.

Default invitation creation:

- Invite by link or email;
- one recipient for email invitations;
- Create invitation.

Expiry, redemption count, membership expiry, account binding, and domain binding are real controls but belong under
Invitation restrictions. Do not render all six fields by default.

### 6.7 Evaluations

Do not show an Evaluation tab or empty evaluation explanation before a real run exists.

After data exists:

- lead with the decision or current result;
- show sample size and uncertainty beside the number they qualify;
- disclose provenance and limitations through compact detail views;
- keep unattributed runs visible in audit/history, not as repeated warning blocks in the main comparison;
- keep the no-global-ranking boundary, but explain it once.

## 7. Human experience

### 7.1 Discover

- Remove the Submitted filter until a real submitted-history read model exists.
- Do not show All / Public / Private controls when the feed is empty or contains only one source.
- Put assigned private work first when present, then available public work.
- Keep one concise empty state with an appropriate next action.
- Show search only on Discover, because that is where answer search has a real job.

### 7.2 Profile

Replace the nine-section first view with a compact status list:

- Profile;
- Invitations and groups;
- Proof of Human, only when relevant or started;
- Paid work, only when the user chooses paid work or receives a paid opportunity.

Open one task at a time. Consolidate the separate project/cohort invitation and private-group invitation inputs into one
**Add invitation** action; route the token to the correct backend handler after validation.

Do not render the full paid-eligibility form until it is needed. Preserve the hard rule that eligibility completes
before the first paid voucher.

### 7.3 Settings

Use sensible notification defaults. The first view shows channel status and one Customize action. Topic toggles, email
delivery, quiet hours, and future per-group overrides appear only after customization is opened. Security notifications
remain mandatory and say so once.

## 8. Connection, handoff, and consent pages

### 8.1 Public connection status

The public `/connect/[intentId]` page currently addresses both workspace owners and agent hosts and shows transport
instructions. Its visible UI should show only:

- current status;
- the user's exact required action, if any;
- deadline only when it affects the action;
- Return to agent or Return to RateLoop when needed.

Keep the machine-readable handoff representation in the page for clients, but do not explain MCP resources, claim
tools, fragments, or telemetry rules to the owner. Move those details to the generic connection guide.

### 8.2 OAuth consent

Consent must name the client and list only capabilities that change user authority. Safe auto-authorization may continue
for verified clients, but a visible consent screen must not use protocol scopes as its primary language.

### 8.3 Browser handoff

A valid handoff focuses on:

- the exact question/material;
- who will review it;
- privacy boundary;
- total cost and accepted-work reserve;
- one approve action.

Technical quote fields and hashes are details. An invalid or expired handoff needs one short error and one recovery
action, not multiple explanatory paragraphs.

## 9. Public site and documentation

### 9.1 Landing

Preserve the orb-led visual language and the phrase **The Human Assurance Loop**.

The default landing composition becomes:

1. Hero: one product sentence and the Humans / Agents choices.
2. Three steps: Agent asks, Humans answer, Review adapts.
3. Three concise reasons to trust the mechanism, each linking to evidence.
4. One pricing sentence and a pricing link.

Move the six client-specific MCP setup modals to Docs. A supported-client strip may remain only as a non-interactive
proof point with one **See supported agents** link. Do not make six setup choices compete with the main entry actions.

Target: no more than roughly 250 visible words in the main landing content, excluding footer and opened disclosures.
This is a regression signal, not permission to delete a necessary disclosure.

### 9.2 Pricing

Keep the two workspace plans, the definition of one completed decision, and the separate paid-panel cost model. Remove
repeated positioning copy. Put fee/reserve definitions in one accessible pricing explanation. Every displayed price
must state what it buys; no disabled checkout action is rendered.

### 9.3 Trust

Trust is an evidence surface, so completeness is justified. Make it scannable:

- status, claim title, one-sentence statement, and one evidence action on each collapsed row;
- expand for review date and additional evidence;
- group unavailable claims in one collapsed section;
- preserve the versioned registry as the source of truth.

Do not hide a permanent limitation in a tooltip.

### 9.4 Docs and legal

Docs may be detailed because the user's task there is learning. Improve route orientation, table of contents, and a
single recommended first step; do not impose marketing-page word limits.

Legal text is not shortened without legal review. Add a plain-language summary and navigation where helpful, while
keeping the controlling text and required disclosures intact.

## 10. Next.js implementation architecture

### 10.1 Server-resolved initial state

Keep `app/(app)/agents/page.tsx` as the authenticated Server Component and resolve a minimal workspace/onboarding DTO
before rendering. Do not make the browser wait for four independent client fetches before it knows which screen applies.

Add a focused server service such as `lib/tokenless/agentWorkspaceState.ts` that returns:

- workspaces the principal may access;
- selected workspace and role;
- active connection intent, if any;
- connected-agent summary;
- whether groups, evaluations, paid work, and capability step-up are relevant.

This data is principal-specific and must remain uncached or request-private. Authorization stays in the service/route,
not in middleware and not in tab visibility.

### 10.2 Client islands

Keep interactivity at the leaf:

- `AgentOnboardingClient` for copy/progress/cancel;
- `WorkspaceSelector` only when multiple workspaces exist;
- focused editors opened by a deliberate action;
- `InfoPopover` as a shared accessible client component.

Do not convert the whole workspace page into a larger client state machine. After a mutation, refresh the server-owned
state rather than manually synchronizing every downstream panel. Retain stable route handlers where they serve both UI
and external integrations; do not rewrite APIs merely for style.

### 10.3 Component deletion and reshaping

Expected component work:

- replace the unconditional composition in `AgentWorkspacePanels.tsx`;
- split `AgentConnectionPanel.tsx` into one stateful onboarding surface and a separate connected-agent management
  surface;
- remove the registry header/empty card from `AgentRegistryPanel.tsx`;
- move `AgentReviewPolicyPanel.tsx` and `AgentPublishingPolicyPanel.tsx` behind contextual actions;
- centralize workspace context used by Agents, Groups, and Evaluations;
- make `TokenlessShell.tsx` route-aware and remove answer search outside Human Discover;
- remove the unimplemented Submitted path from `AnswerPageClient.tsx`;
- consolidate invitation entry on Human Profile;
- move `SupportedAgentsSection.tsx` setup detail to Docs.

Do not keep obsolete component wrappers, copy constants, tests, API fields, or schema columns merely to preserve the
current file graph.

### 10.4 Loading, error, and tenant safety

- Add a neutral route-level loading state that does not reveal a previous workspace.
- Render one recoverable error with one Retry action.
- Never cache workspace names, groups, agents, private questions, or evaluation state across principals.
- Recheck authorization on every mutation and detail read.
- Keep direct-link behavior fail closed when a section is unavailable or unauthorized.

## 11. Dependency-ordered implementation sequence

Keep each slice as its own commit. The first-run rescue intentionally ships before the deeper classification migration.

### Phase 1 — rescue the new-workspace journey

1. **`refactor(agents-ui): render one workspace onboarding action`**
   - server-resolve onboarding state;
   - hide tabs before connection;
   - collapse the fresh state to one connection card;
   - hide single-workspace selection;
   - remove empty progress, connected, registry, review-policy, and publishing-policy sections.

2. **`refactor(agents-ui): make connection states replace each other`**
   - preserve one-copy behavior, clipboard fallback, polling, expiry, cancel, recovery, and accessibility;
   - replace the card on progress/success;
   - move history and connection details into Manage.

3. **`refactor(workspaces): continue from creation to agent connection`**
   - after creating the first workspace, route directly to the connection state;
   - remove billing and zero-balance distractions from first setup.

Phase 1 may deploy without changing the privacy schema because the obsolete policy form is no longer visible.

### Phase 2 — simplify real agent management

4. **`refactor(agents-ui): add contextual connected-agent management`**
   - compact agent row;
   - version, disconnect, and audit details on demand;
   - capability-driven tabs.

5. **`refactor(review-policy): replace raw tuning with review presets`**
   - four presets;
   - audience when relevant;
   - advanced deterministic settings;
   - host-enforced availability derived from client capability.

6. **`refactor(publishing-policy): separate safe access from paid autonomy`**
   - explicit step-up;
   - five common-path questions;
   - exact review/approval;
   - server-generated policy name/hash/details.

7. **`refactor(groups): create and invite progressively`**
   - one-field group creation;
   - simple invitation;
   - restrictions on demand.

### Phase 3 — normalize privacy/content policy

8. **`feat(db): separate visibility material kind and sensitivity`**
   - append-only migration and deterministic sandbox mapping.

9. **`refactor(privacy): enforce normalized content dimensions`**
   - backend services, credential policy, project/group authorization, publishing policy, and public ingress.

10. **`refactor(api): migrate SDK agents CLI and MCP content policy`**
    - update schemas and payloads atomically;
    - prove removed classification-set fields are gone with `rg`;
    - fail closed on mixed old/new payloads.

### Phase 4 — simplify the remaining signed-in product

11. **`refactor(shell): show navigation and search only when useful`**
    - route-aware search;
    - state-aware agent navigation;
    - mobile parity.

12. **`refactor(human): reduce discover profile and settings to current tasks`**
    - remove unimplemented filters;
    - one empty state;
    - consolidated invitations;
    - paid eligibility and World ID on demand;
    - notification customization on demand.

13. **`refactor(handoff): focus approval and connection status on one decision`**
    - concise valid, invalid, expired, and action-required states;
    - technical detail in Docs.

### Phase 5 — simplify public communication

14. **`refactor(marketing): focus landing on the Human Assurance Loop`**
    - hero, three steps, three evidence-backed reasons, concise pricing link;
    - move client-specific setup to Docs.

15. **`refactor(public): make pricing and trust scannable`**
    - retain necessary economics, evidence, limitations, and legal accuracy;
    - remove repetition and competing links.

16. **`docs: orient each technical page around one first step`**
    - information architecture and table of contents;
    - no deletion of required reference detail.

### Phase 6 — regression protection and measured release

17. **`test(e2e): cover progressive-disclosure journeys`**
    - fresh workspace;
    - connection progress and recovery;
    - connected management;
    - capability step-up;
    - invited reviewer;
    - paid-work eligibility;
    - public handoff.

18. **`feat(observability): measure the onboarding funnel without content`**
    - workspace created;
    - connection message copied;
    - connection claimed;
    - approval required;
    - connected;
    - failure category and elapsed time;
    - no message URL, token, prompt, workspace name, or agent content in analytics.

19. **`chore(deploy): publish and verify the isolated tokenless site`**
    - target only `rateloop-tokenless`;
    - verify desktop/mobile live states;
    - verify `main`, the legacy Vercel project, and `rateloop.ai` are unchanged.

## 12. Verification strategy

### 12.1 Component and service tests

- onboarding state resolver covers every state and role;
- one workspace does not render a selector; multiple workspaces do;
- a fresh workspace renders one task card, one primary button, and no policy form fields;
- inactive/expired intents resolve to the correct recovery action;
- progress and success replace the connection card instead of adding sections;
- safe OAuth connection has no publishing policy or spend permission;
- connected-agent detail preserves version and audit history;
- review presets map deterministically to enforced policy values;
- autonomous-publishing confirmation matches the server-created grant;
- normalized visibility/material/sensitivity mappings are complete and fail closed;
- public content cannot carry private sensitivity;
- regulated content remains contract-gated;
- group and credential ceilings are enforced server-side;
- no removed schema field remains in SDK, agents, MCP, routes, fixtures, or docs.

Replace brittle source-regex assertions with rendered behavior or service tests where practical. Copy assertions should
protect a product invariant, not freeze incidental prose.

### 12.2 Browser tests

At 390 px, 768 px, and 1440 px:

- create workspace → see only Connect agent;
- copy once → progress replaces card;
- close/reopen page → intent resumes;
- clipboard denied → selectable fallback remains accessible;
- expired/cancelled/rejected paths offer one recovery action;
- connected → compact success and Manage;
- unavailable tabs do not expose empty management surfaces;
- info popovers work by keyboard and touch;
- focus order, contrast, reduced motion, and screen-reader names are correct;
- no horizontal overflow or tiny required text;
- no console error belongs to the RateLoop app.

### 12.3 Structural UX acceptance

For a fresh workspace on the Agents route:

- one card in the main task area;
- one primary action;
- zero form fields before the action;
- zero downstream tabs;
- zero empty-state messages;
- zero raw hashes, IDs, policy terms, payment rails, or classification labels;
- no more than about 40 visible instructional words, excluding brand, account control, and footer.

The word threshold is a regression alarm. A necessary safety or error message may exceed it when the state requires that
message.

### 12.4 Quality gates

Run, at minimum:

- `yarn next:check-types`;
- `yarn next:test`;
- `yarn next:lint`;
- the new browser E2E suite;
- `yarn next:build` with the isolated tokenless environment;
- live DOM and visual verification on the Vercel-provided domain.

## 13. Release acceptance criteria

The amendment is complete only when:

1. A first-time owner never has to understand a policy, group, evaluation, classification, payment rail, or immutable
   version before connecting an agent.
2. The only fresh-workspace Agents action is Copy connection message.
3. Connection progress and success occupy the same visual slot.
4. A safe connection has no publishing or spending grant.
5. Publishing controls appear only after an explicit autonomous-publishing step-up.
6. Every retained visible control maps to a real user choice and a real enforced behavior.
7. Public/test provenance and private sensitivity are no longer presented as six independent checkboxes.
8. Named user choices resolve to hashes and internal policy values server-side.
9. Empty Groups and Evaluations do not appear before they are useful.
10. Human Discover has no unimplemented Submitted filter.
11. Human Profile and Settings expose one task at a time.
12. Answer search appears only where it searches answers.
13. The landing page no longer presents six setup modals as peer actions to Humans and Agents.
14. Trust, legal, payment, eligibility, and privacy limits remain accurate and available at the decision where they
    matter.
15. Desktop and mobile flows pass keyboard, touch, screen-reader, contrast, and reduced-motion checks.
16. The live tokenless deployment changes without moving `main`, the legacy Vercel project, or either
    `rateloop.ai` domain.

## 14. Explicit non-goals

- No visual rebrand.
- No reduction of backend authorization, privacy, budget, eligibility, or settlement enforcement.
- No hiding of permanent trust limitations.
- No removal of legal text without legal review.
- No generic dashboard framework or new feature added merely to organize existing complexity.
- No compatibility shim for a removed tokenless-only UI model.
- No live-data deletion or legacy-pairing removal until active records are audited and a safe migration is proven.
- No deployment to the legacy production line.

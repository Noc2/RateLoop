# Tokenless UX review — 28 July 2026

This review evaluates whether RateLoop is consistent, easy to navigate, concise,
and simple to use. It combines:

- a live, signed-in Chrome review of the public site, reviewer journey, agent
  workspace, documentation, global search, and mobile layouts;
- a source review of the corresponding Next.js components and shared patterns;
- current guidance from WCAG 2.2, the GOV.UK Design System, the US Web Design
  System, the UK Office for National Statistics, and Nielsen Norman Group.

This is an expert review, not a replacement for research with representative
workspace owners and reviewers. No production data or settings were changed.

## Executive summary

RateLoop already has a recognizable visual system. The black rail, compact
mobile header, cards, typography, gradients, and active-tab treatment are
consistent. The Connection page is the best model for the rest of the app: it
shows the current state, one useful next action, and keeps technical history
secondary.

The main problem is information architecture, not visual design. Several pages
combine the primary task, future capabilities, empty management surfaces,
technical evidence, and low-frequency administration. Users can usually find a
feature eventually, but they must first understand RateLoop's internal data
model.

The recommended direction is:

1. Give every task one canonical location.
2. Show the current state and likely next action first.
3. Omit unavailable and inapplicable workflows.
4. Reveal only optional diagnostics and advanced tuning.
5. Use one small vocabulary for reviews, responses, results, decisions, and
   evidence.
6. Validate the resulting navigation with users before polishing individual
   cards.

The duplicate **Connect another agent** action seen on the live Workspace page
has already been removed from the `tokenless` branch in commit `57492f59a`.
The live deployment had not received that change at the time of this review.

## What was reviewed

### Live desktop journeys

- Home, pricing content, documentation, and global search
- Reviewer: To review, History, Profile, and Settings
- Agent workspace: Workspace, Connection, Inbox, Reviews, Evaluations, and
  Evidence
- Empty, loading, disabled, warning, accepted, expired, and completed states

### Responsive review

The home page, reviewer queue, and agent Workspace page were checked at a
390-by-844 CSS-pixel viewport. The shell reflowed without page-level horizontal
scrolling. The six agent tabs wrap to two rows and remain usable, but their
hierarchy becomes harder to scan. WCAG reflow at 320 CSS pixels and 400% zoom
still needs a formal test.

### Limitations

- No analytics, support tickets, session recordings, or user interviews were
  available.
- Authentication, destructive actions, payment, and on-chain transactions were
  not performed as part of this review.
- Contrast was visually inspected but not measured across every state.
- The live deployment and local source were temporarily out of sync, as noted
  above.

## Research principles used

These principles are the standard against which the findings were assessed.

1. **Predictability.** Repeated navigation should keep the same order, and the
   same function should keep the same name. This reduces search and memory
   burden. See [WCAG consistent navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html)
   and [consistent identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
2. **Descriptive labels.** Headings and labels should explain the topic or
   purpose without requiring technical context. See
   [WCAG headings and labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels).
3. **Progressive disclosure.** Optional detail can be hidden to improve
   scanning, but information most users need must remain visible. See the
   [GOV.UK details guidance](https://design-system.service.gov.uk/components/details/).
4. **Short, focused forms.** Ask only for necessary information and start with
   one decision per page or clearly related group. See
   [GOV.UK question pages](https://design-system.service.gov.uk/patterns/question-pages/).
5. **Scannable content.** Users scan headings and distinguishing words and skip
   repeated copy. Put important information first and say it once. See
   [ONS guidance on how people read online](https://service-manual.ons.gov.uk/content/writing-for-users/how-people-read-online).
6. **Actionable system state.** Dynamic success, waiting, progress, and error
   messages must be clear visually and programmatically available. See
   [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
7. **Accessible reflow and controls.** Content should reflow at 320 CSS pixels,
   normal text should reach 4.5:1 contrast, meaningful control boundaries should
   reach 3:1, keyboard focus must remain visible, and pointer targets should
   meet the WCAG minimum. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and
   [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
8. **Validate the hierarchy.** Card sorting reveals how users group concepts;
   tree testing verifies whether they can find features in the proposed
   hierarchy. See
   [NN/g card sorting](https://www.nngroup.com/articles/card-sorting-definition/)
   and [tree testing](https://www.nngroup.com/articles/tree-testing/).

## Priority definitions

- **P0 — release trust or core-task risk:** address before presenting the
  product as broadly ready.
- **P1 — major usability risk:** a common task is difficult, ambiguous, or much
  longer than necessary.
- **P2 — consistency and polish:** the task works, but friction or presentation
  weakens confidence.

## P0 findings

### 1. Public documentation describes capabilities that the active product does not offer

The documentation says reviewers can claim guaranteed pay and a bonus, and
describes budgeted, sealed, paid terminal settlement as the normal human check.
The active product shown in the signed-in journey is a private, invited, unpaid
lane; public paid review and the Feedback Bonus are unavailable.

This is more than excess copy. A user can make an incorrect decision about
compensation, eligibility, and product readiness.

**Recommendation**

- Rewrite the documentation landing page around the capabilities available now.
- Separate “available now” from advanced architecture or future paid lanes.
- Use four task entries: **Connect an agent**, **Set review policy**,
  **Complete a review**, and **Verify evidence**.
- Add a release check that prevents customer-facing paid, privacy, custody, or
  settlement claims from getting ahead of the deployed system.

**Acceptance criteria**

- Every compensation and settlement statement matches the active hosted lane.
- No unavailable mode is presented as an ordinary next step.
- UI and documentation use the same labels for Connection, Reviews, Results,
  and Evidence.

### 2. Evaluations hides the primary decision under alerts, diagnostics, and repeated records

The live Evaluations page begins with 12 unread alerts, most of them repeated
“Review expired” or informational “Response recorded” events. The actual
evaluation dashboard appears later, followed by operations metrics, model
profiles, adaptive coverage, recent requests, detailed result cards, and
publishing controls.

Individual result cards repeat the same evidence note and expose multiple
decision mechanisms. One inspected record was marked **completed** while also
saying **Waiting for responses**. Durations such as `251,853 sec` and
`33,924 sec` are technically precise but not useful at a glance.

Relevant implementation:

- [`EvaluationDashboardPanel.tsx`](../packages/nextjs/components/tokenless/agents/EvaluationDashboardPanel.tsx)
- Publishing configuration begins around line 780, despite belonging with
  review policy rather than evaluation results.

**Recommendation**

- Make the first view a compact list of results that need a decision, followed
  by recent completed results.
- Move actionable approval requests to Inbox. Group or collapse informational
  events and remove “Response recorded” from owner attention counts.
- Open one result in a detail page or drawer. Show the question, state, response
  count, result, confidence, and one owner decision action before evidence.
- Move operations metrics and adaptive diagnostics to an Operations view.
- Move publishing policy to Reviews.
- Humanize durations and resolve contradictory state before rendering.

**Acceptance criteria**

- A workspace owner can identify the next required action within 10 seconds.
- One event does not create multiple visually equivalent unread alerts.
- A result has one state, one explanation, and one decision control.
- Technical metrics and raw identifiers are absent from the default view.

### 3. Unavailable and inapplicable workflows are rendered throughout the core journeys

Examples observed in the live product and source include:

- network and hybrid reviewer choices shown disabled;
- a disabled “Let the agent ask each time” option;
- paid eligibility, payout, recovery, and bonus surfaces in Profile even when
  the paid lane is unavailable;
- a Feedback Bonus wallet connection shown in Inbox with no eligible bonus;
- payment notification choices when the user has no paid work;
- deployment-specific messages such as “USD invoice funding is not enabled for
  this deployment.”

The review editor exposes these choices in
[`AgentHumanReviewEditor.tsx`](../packages/nextjs/components/tokenless/agents/AgentHumanReviewEditor.tsx),
starting around line 521. The profile composition is visible in
[`HumanProfileContent.tsx`](../packages/nextjs/components/tokenless/human/HumanProfileContent.tsx).

**Recommendation**

Do not show a capability until it is available and relevant to the current
user. Show a short eligibility or availability explanation only after the user
chooses that path. Do not expose deployment state in ordinary product copy.

**Acceptance criteria**

- No disabled future option appears in the default review setup.
- Empty paid, recovery, bonus, and enterprise sections are not mounted for
  ineligible users.
- Required cost, permission, privacy, safety, and irreversible consequences
  remain visible when their action becomes available.

## P1 findings

### 4. Workspace and Profile are catch-all pages

The Workspace tab includes members, invitations, API keys, subscription usage,
billing details, panel funding, enterprise identity, destructive actions, and
workspace creation. On mobile this becomes a very long single column before a
user can understand the whole page.

The Profile tab combines display name, invitation redemption, reviewer access,
World ID, paid eligibility, earnings, forecast integrity, settlement recovery,
and bonus claims.

Relevant implementation:

- [`WorkspaceSettingsClient.tsx`](../packages/nextjs/components/tokenless/WorkspaceSettingsClient.tsx),
  especially the composition beginning around line 767
- [`HumanProfileContent.tsx`](../packages/nextjs/components/tokenless/human/HumanProfileContent.tsx),
  beginning around line 14

**Recommendation**

- Keep Workspace focused on workspace health, members, and a compact plan and
  funding summary.
- Give API access, Billing and funding, Enterprise identity, and Danger zone
  direct settings destinations.
- Keep Profile focused on display name and reviewer access.
- Add Payments only when paid work is available. Put recovery and claims there
  and render them only when actionable.
- Accept invitations only from To review; Profile should show accepted access.

### 5. The review setup form exposes the entire internal policy model

The Reviews form asks about question ownership, custom labels, rationale,
routing authority, frequency, risk rules, output gaps, reviewer audience,
specialties, response seconds, panel size, bounty, and bonus configuration in
one uninterrupted surface.

The initial setup has similar density in
[`AgentSetupFlow.tsx`](../packages/nextjs/components/tokenless/agents/setup/AgentSetupFlow.tsx)
around line 1421. The later editor duplicates it in
[`AgentHumanReviewEditor.tsx`](../packages/nextjs/components/tokenless/agents/AgentHumanReviewEditor.tsx).
The editor asks for **Response window (seconds)** even though setup already has a
human-readable duration control.

**Recommendation**

Show a short default path:

1. What should reviewers judge?
2. When should RateLoop ask?
3. Who should review, and how long should they have?

Show custom labels and rationale only while editing the question. Show limits
and risk rules only when the selected frequency needs them. Put advanced
authority and sampling controls behind a clearly named optional section. Reuse
the friendly duration control and rename “Reviewers per request” to **Panel
size**.

### 6. Connection presents overlapping representations of the same agent

Connection is the strongest agent page, but it first presents a “Codex
connected” summary and then a second “Codex active” management card with
workflow version, deactivation, and technical details. Users must infer the
difference between a connection, an agent identity, and a workflow version.

Relevant implementation:

- [`AgentConnectionPanel.tsx`](../packages/nextjs/components/tokenless/agents/AgentConnectionPanel.tsx),
  including its connected-agent surface around line 1494
- [`AgentWorkspacePanels.tsx`](../packages/nextjs/components/tokenless/agents/AgentWorkspacePanels.tsx),
  which renders the registry after the connection panel

**Recommendation**

Use one connected-agent list. Each agent should show status, last activity, and
the most common action. Put workflow version, OAuth details, audit history, and
legacy recovery in that agent's Technical details.

### 7. Search finds relevant documentation but then embeds an entire reviewer workspace

Searching for “connect agent” returned useful pages and documentation. It then
rendered a second heading, reviewer navigation, invitation action, and the full
empty review queue under a vague **Discover** label. Search also changes route
about 200 milliseconds after typing, rather than waiting for an explicit search
action.

Relevant implementation:

- [`SiteSearch.tsx`](../packages/nextjs/components/tokenless/navigation/SiteSearch.tsx),
  around line 71
- [`search/page.tsx`](<../packages/nextjs/app/(public)/search/page.tsx>), around
  line 43
- [`siteSearch.ts`](../packages/nextjs/lib/search/siteSearch.ts), whose static
  index omits most signed-in tasks

**Recommendation**

- Search on Enter or explicit activation; filter locally after reaching the
  results page.
- Show compact groups named **Pages and docs** and **Review work**, with result
  counts.
- Link to the full queue instead of embedding it.
- Index common task language: connect agent, invite reviewer, change review
  settings, view results, export evidence, billing, notifications, and
  reviewer access.
- Preserve workspace context when navigating to an agent result.

### 8. Evidence defaults to verification internals instead of recognizable records

Every inspected card was titled **Direct private review**, making records
indistinguishable. Cards repeatedly showed trigger, gate, signing key, raw
reviewer taxonomy, settlement prose, and anchor detail. The same page also
contains exports, retention, trusted keys, immutable archive, SIEM, GRC, and
metrics integrations.

The implementation begins around line 386 of
[`EvidenceWorkspacePanel.tsx`](../packages/nextjs/components/tokenless/agents/EvidenceWorkspacePanel.tsx).

**Recommendation**

- Identify each record by question or workflow, agent, outcome, and time.
- Default to outcome, response count, generated time, anchor state, and Export.
- Put signatures, keys, gate identifiers, provenance taxonomy, and settlement
  mechanism in **Verification details**.
- Separate **Decision records**, **Exports**, and **Delivery settings**.
- Replace four empty integration forms with one **Add integration** action.
- Add filtering by state, workflow, agent, and date.

### 9. Status language and loading behavior are inconsistent

Machine values and internal nouns appear directly in the interface, including
`not_started`, `general-assistance`, gate and trigger keys, “tlock ciphertext,”
“vote key,” “host-enforced,” and Resend configuration. Related states use
accepted, completed, closed, expired, insufficient, pass, waiting, failed, and
needs attention without a clear hierarchy.

The live Evidence page briefly displayed a loading skeleton above already
rendered records. The shell briefly showed a signed-out action before the
authenticated state loaded. Evidence said **Anchor not queued** while the
Workspace warning reported five pending evidence anchors.

**Recommendation**

Adopt four top-level states:

| State        | Meaning                                | Required copy                        |
| ------------ | -------------------------------------- | ------------------------------------ |
| Waiting      | Work is progressing normally           | What is pending and expected next    |
| Needs action | This user can unblock it               | The action and consequence           |
| Completed    | The workflow reached a terminal result | Outcome and completion time          |
| Failed       | It cannot continue automatically       | Cause in plain language and recovery |

Keep protocol-specific state in Technical details. Do not render mutually
exclusive loading and loaded states together, and do not replace a known
authenticated shell with a signed-out placeholder.

### 10. Error, form, and navigation accessibility need shared guarantees

The code has a good shared form foundation, but
[`Field.tsx`](../packages/nextjs/components/tokenless/forms/Field.tsx) can put
both hint and error IDs in `aria-describedby` while rendering only one of those
elements. The shared shell has `main-content` but no skip-navigation link.
Several destructive actions use inconsistent native confirmation prompts.
There is no shared retry behavior for asynchronous sections, and raw backend
errors can reach users.

**Recommendation**

- Render hint and error independently, or reference only mounted IDs.
- Add a visible-on-focus **Skip to main content** link.
- Standardize loading, empty, error, and retry states.
- Use one accessible confirmation dialog that names the target and consequence.
- Announce dynamic save, search, and loading outcomes as status messages.
- Measure every muted text and control state against WCAG 2.2 AA; do not infer
  compliance from the color token name.
- Test the entire common path with keyboard only and at 320 CSS pixels.

See [GOV.UK validation guidance](https://design-system.service.gov.uk/patterns/validation/)
for preserving entered values, showing an error summary, and placing a specific
message beside each invalid field.

## P2 findings

### 11. The home page is visually strong but weakens trust with zero-value proof

The hero is focused and responsive. Its `0 Verified Humans`, `5 Ratings`, and
`$0 USDC Paid` row is not persuasive social proof. For a signed-in user, **Start
Reviewing** and **Connect Agent** also restart onboarding instead of continuing
their work.

**Recommendation**

- Hide activity statistics until each has a meaningful, verified value.
- Give signed-in users **Continue reviewing** or **Open workspace**.
- Reduce “Why it works” to three user benefits and one documentation link;
  protocol acronyms belong in technical documentation.
- Use the pricing page as the complete source and show only a short price
  summary on the home page.

### 12. Reviewer History is sparse but repetitive

History cards are very tall and repeatedly show **Private assignment**, **Agent
private reviews**, data handling, case count, and “Assignment expires” for
accepted, completed, and expired records. The title does not help users
distinguish one review from another.

**Recommendation**

- Use a compact list identified by question, agent/workspace, outcome, and time.
- Show **Completed**, **Accepted**, or **Expired** time according to state.
- Add state and date filters only when volume justifies them.
- Put data handling and assignment mechanics in one details view.

### 13. Empty states and notification settings show redundant or irrelevant copy

The reviewer queue's concise **No review work is available right now** state is
a good baseline, but **Check again** and a separate **Have an invitation?**
control float in a mostly empty viewport. Inbox says both that no requests
exist and that prepared requests will appear there, while also showing keyboard
shortcuts that cannot yet be used.

Reviewer Settings exposes assignment, payment, ask result, account, and
oversight categories together and says email is sent through a configured
Resend account.

**Recommendation**

- Use one sentence and one next action per empty state.
- Show keyboard shortcuts only when actionable items exist.
- Group notifications by the user's roles and available capabilities.
- Say **Email notifications unavailable**, not **Resend not configured**.

### 14. Mobile works, but the secondary hierarchy does not scale cleanly

At 390 pixels, the reviewer tabs and six agent tabs wrap to two rows. The agent
workspace selector and primary action then consume another two rows before
content begins. This is usable but makes active location and priority harder to
scan.

**Recommendation**

- Keep the global mobile header.
- Use a horizontally scrollable tab strip with an obvious active state, or a
  compact section selector when all six destinations cannot fit.
- Give the workspace selector its own stable row.
- Keep the page title, current state, and primary action above long forms.
- Convert comparison tables to locally scrollable regions or record summaries.

## Proposed navigation and ownership

The current six agent concepts can remain, but their labels and ownership should
be tested:

| Proposed destination | Primary job                        | Includes                                                  | Does not include                     |
| -------------------- | ---------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Overview             | Understand workspace state         | Health, members, plan/funding summary                     | Agent connection, full billing forms |
| Connections          | Connect and manage agents          | Connection message, status, reconnect, technical details  | Workspace membership                 |
| Approvals            | Handle work requiring owner action | Prepared requests, exceptional approvals                  | Informational event history          |
| Review setup         | Define when and how humans review  | Question, timing, panel, applicable compensation          | Evaluation results                   |
| Results              | Read results and decide            | Needs-decision list, completed results, one result detail | Alert feed, publishing policy        |
| Evidence             | Verify and export records          | Packet summaries, filters, export                         | SIEM/GRC setup forms                 |

Low-frequency settings should have direct destinations rather than expanding
the Overview indefinitely:

- Members and access
- Billing and funding
- API access
- Enterprise identity
- Evidence delivery
- Danger zone

For reviewers:

| Destination | Primary job                                                               |
| ----------- | ------------------------------------------------------------------------- |
| To review   | Accept an invitation or complete available work                           |
| History     | Find previous assignments and outcomes                                    |
| Profile     | Manage display identity and reviewer access                               |
| Settings    | Manage sign-in, relevant notifications, data export, and account deletion |
| Payments    | Appears only when paid work is available or money requires action         |

The top-level label **Humans** describes a population, not the user's task.
Test **Review** or **Reviewer**. Also test **Approvals**, **Review setup**, and
**Results** against the current Inbox, Reviews, and Evaluations labels before
shipping the navigation change.

## Terminology contract

Use these terms consistently in UI, documentation, search, events, and support:

| Term            | Meaning                                     |
| --------------- | ------------------------------------------- |
| Review          | The human task or process                   |
| Response        | One reviewer's submission                   |
| Result          | The panel's combined output                 |
| Decision        | The workspace owner's action after a result |
| Evidence packet | The auditable record for a review           |
| Reviewer        | A person completing review work             |
| Human assurance | The product category, not the person's role |

Use sentence case for product UI except proper names and standards. Translate
machine values through one centralized presentation layer. Prefer verbs for
actions: **Connect agent**, **Invite member**, **Review result**, **Retry
delivery**, and **Export evidence**.

## Shared page and content contract

Every signed-in screen should answer, in this order:

1. Where am I?
2. What is the current state?
3. What should I do next?
4. What can I safely ignore until later?

Default page structure:

1. Visible page title
2. One-sentence state or purpose only when the title is insufficient
3. Primary action or actionable list
4. Compact recent or supporting information
5. Optional details, history, and diagnostics

Each helper sentence must explain a requirement, consequence, recovery step, or
non-obvious format. Delete it otherwise. Do not repeat the heading in an
eyebrow, helper sentence, empty state, and button.

Create shared patterns for:

- page header and primary action;
- status and timestamp;
- empty state;
- loading and retry;
- form errors and status announcements;
- confirmation dialog;
- record list and detail disclosure;
- human-readable duration;
- technical details.

## Recommended implementation sequence

### Phase 1 — Establish the UX contract

1. Approve the navigation ownership and terminology tables above.
2. Add user-facing status mapping and sentence-case conventions.
3. Define shared page, empty, error, confirmation, and record-summary patterns.
4. Add a lightweight copy review to pull-request criteria.

### Phase 2 — Remove misleading and unavailable content

1. Align public documentation with the hosted release.
2. Hide unavailable review, paid, bonus, billing, and enterprise paths.
3. Remove raw vendor, deployment, protocol, and enum language.
4. Resolve contradictory loading and workflow states.

### Phase 3 — Simplify the two core journeys

1. Rebuild Reviews around question, timing, and reviewers.
2. Rebuild Evaluations around needs-decision and completed results.
3. Make Evidence a recognizable, filterable record list.
4. Consolidate each connected agent into one card and management route.

### Phase 4 — Separate administration

1. Reduce Workspace to overview, members, and summaries.
2. Move API access, billing/funding, enterprise identity, evidence delivery, and
   danger controls to direct settings destinations.
3. Reduce Profile to identity and access; conditionally add Payments.
4. Replace embedded reviewer search results with compact links.

### Phase 5 — Accessibility and validation

1. Fix shared form descriptions and add skip navigation.
2. Test keyboard, focus, status announcements, error recovery, touch targets,
   and contrast.
3. Test reflow at 320 CSS pixels and text at 200% and 400% zoom.
4. Run moderated usability tests on the end-to-end owner and reviewer paths.

## Suggested research plan

Before locking the new labels and hierarchy:

1. Run a small open card sort with representative agent owners and reviewers.
2. Build a text-only tree from the proposed navigation.
3. Test these tasks without using the destination label in the prompt:
   - connect a new agent;
   - invite a workspace member;
   - change when a review is requested;
   - find a result that needs a decision;
   - understand why work is blocked;
   - export evidence for a completed review;
   - change notification preferences;
   - recover or claim payment when applicable.
4. Measure first choice, completion, backtracking, time, and misunderstood
   labels.
5. Test a clickable prototype, then repeat the same tasks in the browser.

For the two critical journeys, a participant should be able to:

- explain the page's purpose and next action without assistance;
- connect an agent and configure a basic review without opening advanced detail;
- distinguish a review, response, result, decision, and evidence packet;
- find a completed record without knowing RateLoop's protocol vocabulary;
- complete an invited review on mobile with keyboard or touch.

## What to preserve

- The established RateLoop visual identity and responsive shell
- The concise reviewer empty state
- Connection's visible status and safe-access summary
- Keyboard-aware tabs and reduced-motion support
- Accessible info popovers for genuinely optional explanation
- Technical and audit details when disclosed intentionally

The fastest path to a simpler product is subtraction and clearer ownership, not
new visual components.

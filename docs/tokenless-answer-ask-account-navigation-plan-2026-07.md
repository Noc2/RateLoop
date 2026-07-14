# Tokenless Answer, Ask, Account, and Search Reimplementation Plan

**Status:** Proposed implementation plan for the `tokenless` branch

**Date:** 2026-07-14
**Design authority:** This plan implements
[`tokenless-immutable-implementation-plan-2026-07.md`](tokenless-immutable-implementation-plan-2026-07.md), the design
of record. [`tokenless-human-assurance-redesign-plan-2026-07.md`](tokenless-human-assurance-redesign-plan-2026-07.md)
is a supporting product reference. If an implementation detail here conflicts with the design of record, reopen the
decision there before changing fund custody, settlement, admission, privacy, or paid-eligibility behavior.

## 1. Outcome

Keep the established RateLoop shell and the existing route URLs, but replace the current technical forms with three
clear product destinations:

| Route | Navbar label | Purpose |
| --- | --- | --- |
| `/rate` | **Answer** | Find and complete public questions or account-assigned private reviews. |
| `/ask` | **Ask** | Submit a public question or create a private baseline-versus-candidate evaluation. |
| `/settings` | **Account** | Manage the private account profile, one-time invitations, paid eligibility, workspaces, API keys, and webhooks. |
| `/docs` | **Docs** | Keep the current tokenless documentation navigation. |

Remove the **Validate** and **Earn** labels, remove the current `/settings` paid-eligibility landing page, and replace the
desktop **Start a validation** button with search. Do not restore the legacy Reputation/Governance destination,
Frontend registration, LREP balances, LREP staking/delegation, stake selectors, token rewards, wallet-only identity, or
legacy contract consumers.

The live legacy pages at [rateloop.ai/rate](https://www.rateloop.ai/rate),
[rateloop.ai/ask](https://www.rateloop.ai/ask), and [rateloop.ai/settings](https://www.rateloop.ai/settings) are visual and
interaction references only. Reuse their compact rail, search placement, feed/card rhythm, pill tabs, responsive header,
and settings composition. Do not copy their legacy data hooks or protocol behavior.

## 2. Current-state findings

### Shell and routes

- [`TokenlessShell.tsx`](../packages/nextjs/components/tokenless/TokenlessShell.tsx) already preserves the fixed black
  desktop rail, compact mobile header, RateLoop brand, active gradient indicator, and responsive proportions.
- Its primary labels are currently **Validate**, **Earn**, **Account**, and **Docs**.
- The desktop rail uses a **Start a validation** button where the legacy application used search.
- `/ask`, `/rate`, and `/settings` are thin route wrappers, so their URLs can remain stable while their page clients are
  replaced.

### Answer capability

- `/rate` currently renders [`HumanAssuranceRaterClient.tsx`](../packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx).
  It combines three unrelated jobs: redeeming an invitation, manually opening an assignment by ID and terms hash, and
  completing a private blinded review.
- The one-time invitation form belongs in Account, not in the work queue.
- The repository still has the tokenless paid-question backend: `/api/rater/tasks`, `/api/rater/vouchers`, and
  `/api/rater/commits`, plus local vote/recovery helpers. The earlier tokenless public-task client can be used as a
  behavioral reference, but must be rewritten against current SDK and eligibility types.
- `listPaidRaterTasks` currently joins only asks with `sandbox = true`. Production/public discovery therefore needs an
  explicit visibility filter and environment-aware sandbox filter before it can power a real Answer feed.
- Private assignments have account-bound access, confidentiality acceptance, short artifact leases, and response
  persistence. They lack a reviewer-facing list endpoint, so the current UI requires manually pasted assignment data.

### Ask capability

- `/ask` currently renders [`HumanAssuranceBuyerClient.tsx`](../packages/nextjs/components/tokenless/HumanAssuranceBuyerClient.tsx),
  which creates an encrypted, one-case private comparison suite and freezes its rubric.
- The quote -> ask -> payment -> wait -> result API remains available for public binary and head-to-head questions.
- Public-question classification is currently confirmed in the browser handoff but is not part of the persisted quote
  request. This must be fixed before a public Ask UI can make reliable privacy or publication claims.
- The private pilot form exposes only `internal` and `confidential`, but changing that value currently stores metadata;
  it does not select a different reviewer policy or access-control path.

### Account capability

- `/settings` currently contains paid-task eligibility. `/settings/workspace` contains workspace, prepaid balance, API
  key, and webhook controls.
- Verified sign-in provider, email, provider display name, principal address, and session expiry are already available
  from `/api/auth/session`.
- Invitation redemption is already account-bound, one-time, hash-stored, expiry-checked, and transactionally redeemed.
  It needs a safe list/read model and Account UI, not a new redemption protocol.
- There is no editable RateLoop-specific private profile. Thirdweb identity metadata should remain provider-derived;
  user preferences must not overwrite or weaken verified identity fields.

## 3. Product and trust decisions

### 3.1 Keep three independent concepts

Do not use one dropdown to represent all privacy behavior:

1. **Visibility** — who may discover the question/result: `public` or `private`.
2. **Data classification** — what kind of data remains: `public`, `synthetic`, `redacted`, `internal`, `confidential`, or
   later `restricted`, depending on the workflow.
3. **Reviewer source** — who answers: customer-invited, RateLoop network, hybrid, or sandbox.

A public question can use safely redacted data. A private evaluation can use customer-invited reviewers. These are not
equivalent decisions and must be persisted and audited separately.

### 3.2 Scope public and private workflows honestly

The first implementation should expose:

- **Public question:** binary or head-to-head prompt, public discovery, moderation before funding, itemized USDC quote,
  and a public Answer card. Allow only public, synthetic, or meaningfully redacted non-sensitive content. Do not allow
  confidential customer material in this lane.
- **Private evaluation:** the existing blinded baseline-versus-candidate suite, encrypted artifacts, workspace
  isolation, named/qualified assignment, confidentiality acceptance, short leases, and tenant-private results.

Do not label the current private comparison suite as support for every possible private question type. Arbitrary private
binary questions are a separate product capability and should be added only after their artifact, audience, moderation,
and settlement path is specified end to end.

### 3.3 Make classification consequential

- `public`, `synthetic`, and `redacted` belong to the public-question lane and are persisted with the quote/question.
- `internal` and `confidential` belong to the private-evaluation lane.
- `confidential` runs must fail closed unless the eventual audience/run policy requires assigned reviewers,
  confidentiality acceptance, access logging, and short artifact leases.
- Keep `restricted` in the API/schema but do not expose it in the browser until a customer-controlled or otherwise
  approved restricted-data path exists.
- Retention remains a separate control. Redaction confirmation does not substitute for access control.

### 3.4 Keep Account private

The new Profile page is an authenticated account-management surface, not a public social profile. Do not restore public
wallet profiles, follower graphs, public earnings, reputation scores, or cross-customer reviewer histories. Buyers may
receive policy-approved qualification summaries and opaque reviewer references, never a route to tax, payout, email,
or unrelated identity data.

## 4. Target interaction design

### 4.1 Navbar and search

Desktop rail order:

1. RateLoop brand and the approved short brand subtitle.
2. Full-width search field in place of **Start a validation**.
3. Answer, Ask, Account, Docs.
4. Signed-in account control at the bottom.

Mobile keeps the compact header and menu. Add a search icon that expands to the same search field without changing the
header height unpredictably.

Search behavior:

- The URL is the source of truth: `/rate?q=<query>&scope=<all|public|private>`.
- Submitting search from any route navigates to `/rate?q=...`; editing while already on `/rate` updates the results
  without a full reload.
- Escape clears the field; clear-button and keyboard submission are required.
- Search public prompt/option labels and account-visible assignment metadata only.
- Never search decrypted private artifact bodies, rationales, client names, invitation tokens, email, or qualification
  evidence from the global navbar.
- Do not show global autocomplete suggestions in the first release. Rendering results only on `/rate` avoids a new
  cross-tenant leakage surface.

### 4.2 Answer page

Reuse the established Discover/feed composition without its legacy protocol dependencies:

- Page title: **Answer** with short copy explaining public and assigned private work.
- Scope pills: **All**, **Public**, **Private**, and **Submitted**.
- Main feed card with question/assignment state, answer controls, compensation status, deadline, and source label.
- Compact side rail for eligibility, assignment privacy, recovery status, or next action.
- Previous/next controls and keyboard navigation; mobile uses a single-card stack with stable scroll behavior.
- Designed empty states for unsigned users, no matching search results, no eligible paid task, invitation accepted but
  no assignment yet, and sandbox-only deployments.

Public cards:

- Render binary labels or head-to-head options from the current tokenless question type.
- Show guaranteed base, possible bonus, and attempt compensation separately; never use a generic “earn” promise.
- Preserve local one-time vote/payout key creation, sealed payload, encrypted recovery export, idempotent voucher issue,
  and sponsored commit relay.
- Paid eligibility is checked before voucher issuance. Browsing public questions may remain available without it.

Private cards:

- List only assignments addressed to the signed-in account.
- Show project-safe metadata before acceptance; reveal artifact links only after exact terms acceptance and lease issue.
- Preserve blinded A/B order, multi-case rationale/failure tags, lease recovery, and idempotent response submission.
- Remove invitation redemption from this page.

### 4.3 Ask page

Use the legacy compact form + sticky summary composition with new tabs:

1. **Public question**
2. **Private evaluation**
3. **History**

Public question:

- Binary/head-to-head type, prompt, answer labels, rationale requirement, public/synthetic/redacted classification,
  redaction summary when applicable, audience option, panel size, bounty, reserve, and fee.
- Audience choices must be server-provided named policies. Never ask ordinary users to paste an admission-policy hash.
- Require an explicit public-publication and no-sensitive-data confirmation before quote creation.
- Show the exact itemized quote, moderation state, payment mode, refund/compensation behavior, and final submission action.
- Default browser funding to a selected prepaid workspace. Keep optional external-wallet funding separate and explicit.

Private evaluation:

- Retain project, representative case, frozen criterion, baseline, candidate, classification, and retention.
- Replace the ambiguous classification labels with explanatory copy.
- Show that audience selection and funding are a separate approval step until those controls are integrated.
- Do not offer `public` inside this private form; the Public question tab is the public lane.

History:

- Combine account-owned public ask operations and private projects into a normalized list.
- Show visibility, status, created time, audience source, payment state, result readiness, and a safe deep link.
- Never place private artifact text or reviewer identities in the list response.

### 4.4 Account page

Use nested App Router pages with a shared Account tab bar instead of client-side hash synchronization:

- `/settings` — **Profile** (default)
- `/settings/eligibility` — **Paid work**
- `/settings/workspace` — **Workspace & API**

Profile contains:

- Editable private RateLoop display name.
- Read-only verified sign-in provider/email state, principal address, and session status.
- One-time invitation redemption with the existing masked password input behavior.
- A safe list of joined customer cohorts and current assignment counts.
- Clear copy that accepting an invitation authorizes cohort membership but does not guarantee work, prove unique
  humanity, or complete paid eligibility.

Paid work contains the existing eligibility and World ID capability flow. Preserve the invariant that tax, sanctions,
age, identity, and payout setup complete before the first paid voucher.

Workspace & API reuses `WorkspaceSettingsClient` for teams, prepaid balance, API keys, and webhooks. Do not put these
controls on Profile and do not restore Frontend registration.

## 5. Data and API changes

### Private account profile

Use the next free migration number (currently expected to be `0025`) to add a `tokenless_account_profiles` table keyed
by `principal_address`. Initially store only an optional display name and timestamps. Keep provider identity fields in
`tokenless_browser_identities`; resolve the effective UI name as the private profile preference first, provider name
second, masked email third, address last.

Add:

- `GET /api/account/profile`
- `PATCH /api/account/profile`
- `GET /api/account/assurance/reviewer-invitations` for redeemed memberships and safe assignment counts
- Keep `POST /api/account/assurance/reviewer-invitations/redeem` as the one-time mutation

All mutations require the hashed HttpOnly browser session and existing mutation/CSRF protections. Profile responses
must be `Cache-Control: no-store`.

### Searchable Answer read model

Add a server-side adapter that normalizes public paid tasks and private assignments without weakening either source:

```ts
type AnswerQueueItem =
  | { kind: "public_question"; /* public question, economics, deadline, submitted state */ }
  | { kind: "private_assignment"; /* safe metadata, acceptance/lease state */ };
```

Add or extend:

- `GET /api/rater/tasks?q=&scope=&cursor=` for public questions visible in the active environment.
- `GET /api/account/assurance/assignments?q=&state=&cursor=` for signed-in private assignments.
- Server-side limits, stable pagination, query-length bounds, and deterministic ordering.
- Public questions must filter on explicit persisted `visibility = public`, approved moderation, active round state, and
  the correct sandbox/live environment.
- Private assignment queries must bind the signed-in principal before selecting any project metadata.

Keep the two API responses separate if that makes authorization easier to audit; normalize them only in the page
client. Do not create a database view that accidentally joins private artifacts into public content.

### Public visibility and classification

Use a separate migration (currently expected to be `0026`) and update the SDK/agents/MCP together:

- Persist question visibility, data classification, and redaction summary with the quote/question record.
- Extend `TokenlessQuoteRequest` and its parser/schema with the exact public-lane privacy fields.
- Carry the fields through quote hashing, product/delegated-policy enforcement, moderation, question records, evidence,
  and result/history responses.
- Update MCP handoff parsing so classification is part of the persisted reviewed request instead of URL-fragment-only
  display metadata.
- Default existing test fixtures explicitly; do not introduce an implicit production default to public.
- Fail closed if a public question claims `internal`, `confidential`, or `restricted` data.

### History

Add an account/workspace-owned read endpoint for public ask operations and reuse the existing human-assurance project
list for private history. Normalize in the UI, not by weakening the separate ownership checks.

## 6. Component architecture

Create small tokenless components inspired by the legacy visual design:

- `components/tokenless/navigation/AnswerSearch.tsx`
- `components/tokenless/account/AccountTabs.tsx`
- `components/tokenless/account/ProfileClient.tsx`
- `components/tokenless/account/InvitationRedemption.tsx`
- `components/tokenless/answer/AnswerPageClient.tsx`
- `components/tokenless/answer/PublicQuestionCard.tsx`
- `components/tokenless/answer/PrivateAssignmentCard.tsx`
- `components/tokenless/answer/AnswerStatusRail.tsx`
- `components/tokenless/ask/AskPageTabs.tsx`
- `components/tokenless/ask/PublicQuestionClient.tsx`
- `components/tokenless/ask/PrivateEvaluationClient.tsx`
- `components/tokenless/ask/AskHistoryClient.tsx`

Extract protocol operations from page components into focused hooks/services. The public sealed-commit workflow and
private assignment-response workflow must not share state merely because they render in one feed.

Do not restore the legacy `VotePageClient`, `ContentSubmissionSection`, `WalletSettingsPanel`, `DelegationSection`,
`FrontendRegistration`, category registry, follow/watch system, reputation feed, or Wagmi-based app provider graph.

## 7. Dependency-safe commit sequence

Every commit must pass its targeted tests and leave the application usable. Keep the user's unrelated working-tree
changes out of these commits.

### Commit 1 — `refactor(app): rename tokenless product navigation`

- Rename **Earn** at `/rate` to **Answer** and **Validate** at `/ask` to **Ask**, producing the final order Answer, Ask,
  Account, Docs.
- Keep `/rate`, `/ask`, `/settings`, and `/docs` URLs.
- Remove the Start a validation rail button, but do not add a fake search field before query support exists.
- Add shell tests for route activation, desktop/mobile labels, and absence of Validate/Earn/Start a validation.

### Commit 2 — `feat(account): add private account profile records`

- Add the account-profile migration, schema, service, validation, GET/PATCH routes, and route tests.
- Resolve the display-name precedence without modifying verified provider identity data.
- Verify tenant/session isolation and no-store responses.

### Commit 3 — `feat(account): expose reviewer memberships and invitations`

- Add the signed-in invitation/membership read model and GET route.
- Reuse the existing POST redemption endpoint.
- Test one-time use, account binding, expiry, revocation, idempotent UI refresh, and absence of token hashes/raw
  qualification evidence in responses.

### Commit 4 — `refactor(account): rebuild settings as account tabs`

- Add the shared `/settings` layout and Profile, Paid work, and Workspace & API routes.
- Move `PaidEligibilityClient` to `/settings/eligibility` and preserve provider-return navigation to that tab.
- Build Profile and move invitation redemption out of `HumanAssuranceRaterClient`.
- Keep `/settings/workspace` as the workspace/API page.
- Add responsive rendering and route tests. Confirm there is no Frontend, LREP, staking, delegation, or reputation UI.

### Commit 5 — `feat(answer): add searchable tokenless answer queues`

- Add explicit visibility/environment filtering for public tasks.
- Add the signed-in private-assignment list endpoint.
- Add `q`, scope/state, pagination, bounds, and stable ordering.
- Test public moderation/visibility filters and adversarial cross-account private searches.

### Commit 6 — `feat(answer): rebuild the Answer page`

- Replace the current `/rate` wrapper with `AnswerPageClient`.
- Reintroduce the useful public sealed-answer flow from the earlier tokenless client against current SDK and voucher
  requirements.
- Refactor the current private assignment UI into private cards/panels without changing its access or response rules.
- Add scope pills, card navigation, status rail, loading/empty/error states, and mobile behavior.
- Include unit/integration tests for binary, head-to-head, private multi-case, submitted, ineligible, and sandbox states.

### Commit 7 — `feat(navigation): restore navbar answer search`

- Add the desktop rail input and mobile expandable search.
- Bind it to `/rate?q=&scope=` and the searchable queue APIs.
- Test navigation from every primary route, clear/Escape/Enter behavior, back/forward synchronization, and absence of
  private-content autocomplete or leakage.

### Commit 8 — `feat(api): persist public question visibility and classification`

- Add the visibility/classification migration and update SDK types, schemas, quote hashing, server validation,
  delegated publishing policy checks, MCP handoff, agents, moderation, and tests.
- This is an API/schema commit; do not mix the new Ask UI into it.
- Reject confidential/restricted content in the public lane and reject implicit public defaults.

### Commit 9 — `feat(ask): add the public question workflow`

- Build the Public question tab using server-provided audience choices and current quote/ask/payment APIs.
- Add public/synthetic/redacted controls, public-publication confirmation, itemized USDC quote, moderation/funding state,
  and submission receipt.
- Do not expose raw admission-policy hashes as ordinary form inputs.
- Test public question creation through appearance in the Answer queue in sandbox mode.

### Commit 10 — `refactor(ask): rebuild private evaluation and history tabs`

- Move the current private suite workflow into the Private evaluation tab and preserve encrypted storage/freeze
  behavior.
- Add clear internal/confidential helper text and hide restricted until supported.
- Add History using separate public-ask and private-project ownership endpoints.
- Delete the now-superseded monolithic buyer component only after the new route tests pass.

### Commit 11 — `refactor(app): remove superseded tokenless placeholders`

- Delete superseded current page clients and duplicate route copy after all consumers have migrated.
- Use `rg` to prove the active app contains no Validate/Earn/Start a validation labels, invitation redemption on Answer,
  Frontend registration, LREP/staking/delegation UI, legacy vote/submit imports, or mixed legacy/tokenless APIs.
- Do not delete B2B workspace-governance code merely because it contains the word “governance”; it is not token
  governance.

### Commit 12 — `test(app): verify answer ask account journeys`

- Add end-to-end desktop and mobile coverage for navigation, search, public ask -> Answer, private suite -> invite ->
  Account redemption -> assigned Answer, paid-eligibility routing, and workspace/API access.
- Add accessibility checks for tab order, labels, focus restoration, errors, dialogs, and mobile menu/search.
- Add screenshot assertions for the established rail/card/tab proportions, not brittle full-page text snapshots.

### Commit 13 — `docs(app): align tokenless product navigation`

- Update user docs, AI/SDK docs, static skill/LLM files, metadata, and screenshots to say Answer, Ask, and Account.
- Document the public-question versus private-evaluation boundary and the separate visibility/classification/reviewer-source
  concepts.
- Remove stale references to Validate, Earn, legacy settings, LREP, staking, Frontend registration, or public-profile
  reputation from active tokenless documentation.

## 8. Verification gates

### Per commit

- Focused Node tests for changed route/service/component files.
- `git diff --check`.
- Next.js lint for changed TS/TSX files.
- Type checking whenever route, SDK, or shared types change.
- SDK and agent tests whenever quote/privacy schemas change.
- Database migration tests whenever schema changes.

### Full local gate

- `yarn workspace @rateloop/nextjs test`
- `yarn workspace @rateloop/nextjs check-types`
- `yarn workspace @rateloop/nextjs lint`
- Relevant SDK and agents workspace tests
- Tokenless Playwright journeys in both deterministic sandbox and production-config validation modes
- Browser verification at desktop and mobile widths with no console errors

### Security/privacy gate

- A public search cannot return private project, assignment, artifact, client, invitation, email, or qualification data.
- A signed-in reviewer can list only their own private assignments.
- Invitation redemption remains one-time, intended-account-bound when configured, and hash-only at rest.
- Public questions cannot carry confidential/restricted classification.
- Private artifact access still requires the exact assigned account, accepted terms hash, active assignment, and live lease.
- Account profile updates cannot overwrite verified provider identity, paid eligibility, payout data, or workspace roles.
- Paid voucher issuance remains the first point at which all paid-work gates are required; accepted work retains its paid
  terminal path.

## 9. Rollout and deployment isolation

1. Implement and verify only on `tokenless`.
2. Keep all migrations and environment changes scoped to the isolated tokenless Postgres/Railway/Vercel services.
3. Before preview deployment, verify `.vercel/project.json` is `rateloop-tokenless` with project ID
   `prj_H6C2pfWKEAupFroHbLfzhquaNCLm`.
4. Deploy only to the tokenless Vercel project and review `/rate`, `/ask`, and `/settings` at
   `https://rateloop-tokenless.vercel.app`.
5. Verify `rateloop.ai` and `origin/main` remain unchanged before and after any tokenless publish.
6. Do not attach `rateloop.ai`, reuse the legacy production database, or revive legacy main-branch APIs to make the UI
   compile.

## 10. Acceptance criteria

- The primary rail and mobile menu show Answer, Ask, Account, and Docs only.
- Search replaces Start a validation and filters account-visible Answer results through URL-backed state.
- `/rate` supports real public tokenless tasks and assigned private reviews without invitation redemption on the page.
- `/ask` clearly separates public questions from private evaluations and persists the selected privacy boundary.
- `/settings` opens Profile first and allows one-time invitation redemption; paid eligibility and workspace/API controls
  remain available as account tabs.
- No active tokenless UI contains LREP, staking, delegation, Frontend registration, Reputation, Validate, or Earn.
- The reimplementation visually matches the established RateLoop shell and card/tab language without importing legacy
  governance, registry, escrow, oracle, profile, reward, confidentiality, or voting consumers.
- Public search and history cannot expose private data across accounts or workspaces.
- All targeted, workspace, E2E, type, lint, migration, and browser verification gates pass.

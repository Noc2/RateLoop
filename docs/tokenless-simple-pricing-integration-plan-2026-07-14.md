# RateLoop tokenless: Simple pricing and website integration plan (July 2026)

**Status:** Proposed implementation plan. This plan turns the revised launch-pricing recommendation into the smallest
coherent production billing release. It supplements, but does not replace, the
[tokenless implementation design of record](tokenless-immutable-implementation-plan-2026-07.md) and the
[Humans and Agents production redesign](tokenless-humans-agents-production-redesign-plan-2026-07.md).

This plan supersedes the **$299/month self-serve launch recommendation** in the earlier
[pricing research](tokenless-pricing-and-packaging-research-2026-07-14.md). The research remains useful for market
comparables, billing-unit analysis, paid-panel economics, and future packaging.

## Decision

Launch only two self-serve workspace plans:

| Plan             |           Price |                                   Production allowance | Product limits                                                                                                                                                |
| ---------------- | --------------: | -----------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**         | **$0**, no card |       25 completed review decisions per calendar month | 1 active agent, 1 active private group, unpaid private reviews only                                                                                           |
| **Early Access** |   **$99/month** | 250 completed review decisions per subscription period | 3 active agents, 5 active private groups, unlimited invited reviewers, paid/private and public-network access when those paths are otherwise production-ready |

The Early Access price is an intentionally discounted learning price, not a claim that $99 is the permanent list
price. Display **“Early Access price”** next to it and state the commercial treatment before checkout:

- the customer receives $99/month for the first 12 months;
- RateLoop gives at least 60 days' notice before a later price change;
- after the first 12 months, founding customers receive 20% off the then-current comparable monthly plan;
- no lifetime grandfathering is promised; and
- a customer can cancel before a new price takes effect.

The next price to test for **new** customers is $149/month, after paid-customer evidence exists. Do not implement the
$149 price, annual billing, a Team tier, metered overages, trials, coupons, per-seat fees, or enterprise checkout in the
first release.

Continue to treat paid-panel economics separately:

- participant bounty and attempt reserve are customer-funded panel costs;
- the RateLoop execution fee remains the frozen paid-panel fee, initially 7.5% subject to the design-of-record cap and
  refund rules;
- a paid review consumes one workspace review-decision unit as well as its separate panel funding; and
- strictly unpaid private-group work has no USDC transaction but does consume the workspace allowance.

The software subscription is conventional B2B SaaS billing. It must never enter the prepaid USDC ledger, a panel
contract, a rater payout, or the immutable fund core.

## Why this is the right first release

The launch question is not whether RateLoop can construct a sophisticated billing system. It is whether customers will
pay for repeatable, auditable human assurance when they can bring their own reviewers. A $99 plan gives a real payment
signal without asking an early buyer to pay more than established evaluation platforms before RateLoop has equivalent
breadth, integrations, reliability, or brand trust.

Two plans are enough to answer the next commercial questions:

1. Do free workspaces reach the 25-decision limit?
2. Does the limit or paid-panel access create a credible upgrade moment?
3. Do customers who upgrade use materially more agents, groups, or completed decisions?
4. Is $99 low because activation is easy, or is conversion still weak because the product is not yet valuable enough?

Adding more tiers before those answers exist would create UI, entitlement, support, accounting, and migration work
without improving the experiment.

## Product rules to freeze before implementation

### Billable unit

A **completed review decision** is one frozen case or agent output that reaches an authorized terminal human-result
state under one reviewer policy.

- A multi-case run consumes one unit per completed case.
- Several responses contributing to the same case still consume one unit.
- A rerun consumes a new unit when it produces a new terminal decision.
- Drafts, rejected requests, skipped adaptive opportunities, polling, webhook delivery, API calls, and chain
  transactions consume no unit.
- A failed or cancelled case with no usable terminal human result consumes no unit.
- Paid and unpaid terminal results use the same software unit.

For capacity control, RateLoop reserves one unit per case when a run is frozen. The workspace UI distinguishes
**completed** from **reserved** units. A reservation is converted to completed usage when the run reaches its valid
terminal result, and it is released when the run is cancelled before a usable result. This is not a charge: it prevents
concurrent runs from silently exceeding a plan while preserving the accepted-work guarantee.

### Periods

- Free-plan periods are UTC calendar months.
- Early Access periods use the Stripe subscription's `current_period_start` and `current_period_end`.
- A reservation remains attached to the period in which the run was frozen, even if completion crosses the boundary.
- There is no automatic overage charge. At the allowance, RateLoop refuses to freeze additional runs.
- Existing frozen runs, accepted assignments, responses, settlement, claims, evidence generation, and result access
  continue even after a cancellation, downgrade, failed renewal, or quota limit.

### Downgrade behavior

A downgrade must not delete or hide historical evidence. When a workspace exceeds Free limits after its paid period:

- existing agents and groups remain readable;
- no existing agent or group is silently deactivated;
- new agents, groups, paid reviews, and review freezes are blocked until the workspace is within Free limits or
  upgrades again; and
- already-frozen or accepted work continues to its required terminal path.

### Subscription state

Entitlements come from verified Stripe webhooks, never from a browser redirect or client-supplied status.

| Billing state                           | New work entitlement                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| No subscription / `canceled` / `unpaid` | Free                                                                                         |
| `trialing` / `active`                   | Early Access through `current_period_end`                                                    |
| `past_due`                              | Early Access through the already-paid current period; show a payment warning and portal link |
| `incomplete` / `incomplete_expired`     | Free; allow a new Checkout attempt                                                           |
| `cancel_at_period_end = true`           | Early Access until the recorded period end, then Free                                        |

The webhook consumer must tolerate duplicates and out-of-order delivery. A stale event must not overwrite a newer
subscription snapshot.

## Current implementation fit

The tokenless application already has the right product boundaries:

- `tokenless_workspaces` and `tokenless_workspace_members` are the subscription owner and authorization boundary;
- access role `billing` already exists alongside `owner`, `admin`, and `member`;
- `/agents?tab=overview` already hosts workspace settings, API keys, webhooks, and prepaid panel funding;
- the durable agent registry and private-group service have explicit active records that can be capped;
- assurance runs already freeze their cases and reach an atomic completed transition;
- completed unpaid private work already uses the off-chain terminal path; and
- prepaid USDC, x402, panel fees, and rater settlement already have separate product and chain records.

There is no current workspace subscription schema, Stripe dependency, Stripe configuration, or subscription UI. The
new billing records must not reuse:

- `tokenless_prepaid_ledger_entries`;
- `tokenless_prepaid_reservations`; or
- `tokenless_payment_intents`.

Those tables describe panel funding. A SaaS invoice must never change a workspace's available USDC balance.

## Target architecture

```text
Public /pricing
      |
      v
Authenticated workspace overview ---- POST checkout/portal ----> Stripe-hosted pages
      |                                                            |
      |                                                            v
      +---- GET billing summary <---- verified webhook <---- Stripe subscription events
                    |
                    v
          server-side entitlements
            /         |          \
           v          v           v
     agent cap    group cap    run-freeze allowance
                                  |
                                  v
                         accepted work completes
                                  |
                                  v
                        usage allocation consumed
```

Use Stripe-hosted Checkout and Customer Portal. Do not build card fields, store payment details, add Stripe Elements,
or expose a Stripe publishable key in this release. The app needs only server-side Stripe access.

## Database change

Add migration `0032_tokenless_workspace_billing.sql` and its Drizzle journal entry. Use four new tables.

### `tokenless_workspace_billing_customers`

One Stripe customer per workspace.

| Column                     | Rule                                                  |
| -------------------------- | ----------------------------------------------------- |
| `workspace_id`             | Primary key and foreign key to `tokenless_workspaces` |
| `provider`                 | Fixed to `stripe` in v1                               |
| `provider_customer_id`     | Unique, server-only identifier                        |
| `created_at`, `updated_at` | UTC timestamps                                        |

Customer creation must be idempotent. Lock the workspace row, check this table, create the Stripe customer only when
none exists, and tolerate a retry without producing multiple active customers.

### `tokenless_workspace_subscriptions`

The local entitlement snapshot. It is not a payment ledger.

| Column                                       | Rule                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `workspace_id`                               | Primary key and foreign key                                           |
| `plan_key`                                   | `free` or `early_access`                                              |
| `price_version`                              | Immutable commercial meaning, initially `early_access_usd_99_2026_07` |
| `provider_subscription_id`                   | Unique and nullable for Free                                          |
| `provider_price_id`                          | Nullable for Free; never accepted from the browser                    |
| `provider_status`                            | Normalized Stripe subscription state                                  |
| `provider_event_created_at`                  | Reject older webhook snapshots                                        |
| `current_period_start`, `current_period_end` | Nullable for Free                                                     |
| `cancel_at_period_end`                       | Boolean                                                               |
| `created_at`, `updated_at`                   | UTC timestamps                                                        |

Backfill one `free` row for every existing active workspace, and create the Free row in the same transaction as every
new workspace. Absence must still fail safely to Free while the migration is rolling out.

### `tokenless_billing_webhook_events`

An idempotency and operations record.

| Column                        | Rule                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `provider_event_id`           | Primary key                                                                |
| `event_type`                  | Stripe event type                                                          |
| `payload_sha256`              | Digest of the verified raw body; do not retain the full payload by default |
| `event_created_at`            | Provider timestamp                                                         |
| `processing_status`           | `processing`, `processed`, or `failed`                                     |
| `error_code`                  | Bounded internal code, never raw secrets or card data                      |
| `received_at`, `processed_at` | UTC timestamps                                                             |

Duplicate delivery returns success after confirming the previously recorded event. Operational retry must be possible
for a failed event without weakening signature verification.

### `tokenless_workspace_usage_allocations`

One quota allocation per frozen case.

| Column                                      | Rule                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| `allocation_id`                             | Primary key                                             |
| `workspace_id`, `run_id`, `case_id`         | Unique together; foreign-keyed to the assurance records |
| `plan_key`, `price_version`                 | Entitlement used when reserved                          |
| `period_start`, `period_end`                | Frozen period attribution                               |
| `state`                                     | `reserved`, `consumed`, or `released`                   |
| `reserved_at`, `consumed_at`, `released_at` | Lifecycle timestamps                                    |

The customer-visible completed count is `consumed`; capacity is `reserved + consumed`. Index by
`(workspace_id, period_start, period_end, state)`. Do not update a consumed allocation back to released.

## Server modules

Create a small billing boundary instead of putting Stripe calls into workspace or assurance code.

```text
packages/nextjs/lib/billing/
  plans.ts          static plan definitions and price-version mapping
  entitlements.ts   local subscription reads, caps, quota reserve/consume/release
  stripe.ts         lazy server-only Stripe client and Checkout/Portal helpers
  webhooks.ts       signature verification and idempotent subscription projection
  billing.test.ts   plan and lifecycle tests
```

### Plan definitions

`plans.ts` is the application source of truth for entitlements. The browser sends only the stable plan key
`early_access`; the server maps it to the configured Stripe Price ID and verifies the returned subscription uses that
exact price.

```ts
free: {
  decisionsPerPeriod: 25,
  activeAgents: 1,
  activePrivateGroups: 1,
  paidPanels: false,
}

early_access_usd_99_2026_07: {
  decisionsPerPeriod: 250,
  activeAgents: 3,
  activePrivateGroups: 5,
  paidPanels: true,
}
```

Do not derive entitlements from a Stripe amount, product name, coupon, or client metadata. A future $149 price receives
a new price version and explicit migration behavior.

### Stripe client

Add the server `stripe` package only. Initialize it lazily inside `getStripe()` so a Next.js build can evaluate module
graphs without opening a service client or requiring runtime secrets. Mark every billing module that can reach Stripe
or provider IDs with `server-only`.

Use `getOptionalAppUrl()` for Checkout success/cancel and Portal return URLs. Never trust the request `Host` header for
these redirects.

### Billing authorization

Add one shared `requireWorkspaceBillingAccess()` query:

- `owner` and active `billing` access roles can start Checkout and open the Customer Portal;
- `admin` and `member` can read plan and usage status but cannot change billing;
- API keys cannot manage a subscription; and
- an unauthorized workspace ID returns the same not-found response used by existing workspace services.

The handler rechecks authorization; middleware or a client-visible role is never sufficient.

## API routes

### `GET /api/account/workspaces/[workspaceId]/billing`

Requires a browser session and workspace membership. Returns a deliberately small projection:

```json
{
  "plan": "early_access",
  "priceVersion": "early_access_usd_99_2026_07",
  "status": "active",
  "cancelAtPeriodEnd": false,
  "periodStart": "...",
  "periodEnd": "...",
  "usage": { "completed": 42, "reserved": 8, "limit": 250 },
  "limits": { "activeAgents": 3, "activePrivateGroups": 5, "paidPanels": true },
  "canManageBilling": true,
  "checkoutAvailable": true
}
```

Set `Cache-Control: private, no-store`. Never return Stripe customer, subscription, invoice, or Price IDs.

### `POST /api/account/workspaces/[workspaceId]/billing/checkout`

Requires a same-origin browser mutation and owner/billing access.

1. Validate that subscriptions are enabled and the requested plan key is exactly `early_access`.
2. Require the existing workspace B2B/trader fields needed by the legal and tax configuration before live sale.
3. Refuse a second Checkout when an active or trialing subscription already exists; direct that user to the Portal.
4. Create or reuse the server-side Stripe Customer.
5. Create a hosted Checkout Session with `mode: subscription`, the server-selected Price ID, workspace and price-version
   metadata, billing-address collection, tax-ID collection, and the configured tax behavior.
6. Use a deterministic idempotency key scoped to workspace, plan version, and the current attempt record.
7. Return only `{ "url": "https://checkout.stripe.com/..." }` and navigate there in the browser.

Do not grant Early Access here. The success redirect means Checkout returned; only a verified webhook activates the
subscription.

### `POST /api/account/workspaces/[workspaceId]/billing/portal`

Requires a same-origin browser mutation and owner/billing access. Load the customer ID by workspace on the server,
create a Stripe Customer Portal session, and return its URL. The client must not submit a Stripe customer ID.

Configure the Portal initially for:

- card/payment-method updates;
- invoice and receipt access; and
- cancellation at period end.

Do not enable arbitrary plan switching or coupons until RateLoop has another supported price version.

### `POST /api/billing/stripe/webhook`

This public Route Handler must use the Node.js runtime, read `await request.text()` before any JSON parsing, and verify
the `Stripe-Signature` against the exact raw body.

Process only the minimum event set:

- `checkout.session.completed` to associate the verified Checkout with its workspace;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`;
- `invoice.paid`; and
- `invoice.payment_failed`.

For every event:

1. verify the signature;
2. record the provider event ID and raw-body hash;
3. resolve workspace ownership from trusted server-created metadata/customer mapping;
4. retrieve the canonical Stripe subscription when the event lacks a complete snapshot;
5. verify the subscription Price ID maps to a supported price version;
6. ignore an older provider timestamp than the stored snapshot;
7. upsert the local subscription in one database transaction; and
8. mark the event processed.

Return a non-2xx response for a transient processing failure so Stripe retries. Invalid signatures return 400. Unknown
event types return 200 after verification without changing entitlements.

## Entitlement enforcement

Enforce limits in domain services, not only in React components or API routes. That covers the browser, authenticated
agent API, future MCP calls, and tests consistently.

### Active agents

In `createWorkspaceAgent()`:

1. load and lock the workspace subscription row;
2. count active workspace agents;
3. compare with the effective plan; and
4. reject with `409 plan_limit_reached` and structured details when the new agent would exceed the cap.

Agent version creation does not consume another agent slot. If agent reactivation is added, it must use the same check.

### Active private groups

In `createPrivateGroup()` use the same transaction and workspace lock before inserting an active group. Creating policy
versions, members, or invitations does not consume another group slot. A future group-reactivation path must use the
same check.

### Review allowance

Reserve capacity inside the same database transaction that freezes assurance orchestration and creates
`tokenless_assurance_run_cases`:

1. resolve the run's workspace through its project;
2. lock the workspace subscription row;
3. load the effective period and allowance;
4. count existing reserved and consumed allocations;
5. ensure the full case set fits; and
6. insert one idempotent reserved allocation per case before commit.

This must be added to the orchestration freeze path, not merely `createAssuranceRun()`, because the authoritative case
count is not fixed until orchestration freezes the run. A retry that sees the same `(workspace_id, run_id, case_id)`
allocations succeeds without reserving twice.

At the existing atomic `completeAssuranceRun()` transition, convert all of that run's valid terminal case allocations
from `reserved` to `consumed`. At a valid pre-result cancellation transition, convert remaining reserved allocations to
`released`. Evidence reads and exports do not consume additional units.

Do not add an entitlement check to assignment acceptance, response submission, reveal, settlement continuation,
claims, evidence generation, or result retrieval.

### Paid-panel access

Check `paidPanels` before a production paid run reaches quote/funding/freeze. The ideal gate is before the customer signs
or funds anything. Unpaid invited work remains available independently of subscription billing. Once paid funding or an
accepted commit exists, a subscription change can never cancel or redirect the panel.

## Website integration

### Public `/pricing`

Add `packages/nextjs/app/(public)/pricing/page.tsx` as a server-rendered, indexable page using the established RateLoop
shell, typography, gradients, numbered sections, and surface cards.

The page contains:

1. A compact headline: **“Start with your own reviewers. Add paid human supply when you need it.”**
2. Side-by-side Free and Early Access cards with only implemented entitlements.
3. A plain-language usage definition and the no-overage rule.
4. A separate “Paid panels” block explaining that bounty, attempt reserve, and 7.5% execution fee are not included in
   the $99 subscription.
5. Early Access price-protection wording and cancellation terms.
6. A small enterprise/design-partner contact link without publishing an unimplemented enterprise feature list.
7. A FAQ covering card requirement, quota reset, unused units, cancellation, USDC separation, VAT/tax, and what happens
   to existing work after downgrade.

CTAs:

- **Start free** links to `/agents?tab=overview` and lets the existing authentication/workspace flow continue.
- **Choose Early Access** links to `/agents?tab=overview&billing=upgrade`; checkout starts only after authentication and
  workspace selection.

Do not put Checkout directly on the public page because a subscription must belong to an authenticated workspace.

Add **Pricing** to `TokenlessShell`'s footer and the mobile secondary/legal block. Keep the three primary desktop rail
destinations unchanged: For Humans, For Agents, and Docs.

### Workspace overview

Keep billing within `/agents?tab=overview`; do not add a sixth Agent tab in v1.

Extend `WorkspaceSettingsClient` with a billing card above the existing panel-funding balance:

- plan name and status badge;
- completed and reserved usage, allowance, period end, and an accessible progress bar;
- active-agent and active-group limits;
- **Upgrade to Early Access** for Free owner/billing users;
- **Manage billing** for subscribed owner/billing users;
- read-only status for admin/member users;
- payment-failed and cancel-at-period-end warnings; and
- a link to `/pricing` for the full explanation.

Rename the existing USDC summary heading to **Panel funding** and label its amounts as **Settled USDC**, **Reserved
USDC**, and **Available USDC**. The subscription card and USDC card must never look like one balance.

On `billing=success`, show: **“Checkout received. Your plan activates after payment confirmation.”** Refresh the billing
endpoint until the webhook projection becomes active, with a bounded timeout and a manual refresh action. On
`billing=cancelled`, show a neutral message and retain the current plan.

The upgrade button is hidden or disabled with a clear “Billing is not enabled yet” message when the server feature flag
is false. The public pricing page may be published before Checkout, but it must label Early Access as “Join waitlist”
until live billing passes production readiness.

### Limit messages in product surfaces

When a server returns `plan_limit_reached`, the Agents, Groups, and Evaluation panels show the effective limit and a
link back to the overview billing card. Do not silently hide create buttons; users need to understand why an action is
unavailable.

An accepted or running review never shows a subscription failure. Billing warnings appear in workspace administration,
not in the human reviewer's completion journey.

### Legal and privacy copy

Before enabling live Checkout, update the public terms and privacy notice to cover:

- recurring B2B subscription billing and automatic renewal;
- the exact cancellation and price-change notice policy;
- Stripe as payment processor and the categories of billing data it receives;
- taxes/VAT, invoice identity, and the existing trader-only scope;
- the distinction between SaaS fees, panel execution fees, participant bounty, and attempt reserve; and
- the no-deletion behavior for evidence that must remain available under an agreed retention policy.

This is an implementation checklist, not a substitute for legal/tax review. Confirm Stripe Tax, VAT-ID collection,
reverse-charge copy, invoice fields, and merchant-of-record treatment before live charging.

## Configuration and readiness

Add these server-only variables to `.env.example`:

```text
TOKENLESS_SUBSCRIPTIONS_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID=
```

Do not add `NEXT_PUBLIC_STRIPE_*` variables. Hosted Checkout does not need them.

Update `check-tokenless-production-readiness.mjs` so:

- `TOKENLESS_SUBSCRIPTIONS_ENABLED` must be explicitly `true` or `false`;
- the three Stripe values are required only when the flag is `true`;
- secret and webhook values are forbidden in `NEXT_PUBLIC_` variables;
- test-mode and live-mode key/Price combinations cannot be mixed; and
- readiness output reports missing variable names but never values.

Before configuring or deploying, retain the tokenless isolation guard: the active Vercel project must be
`rateloop-tokenless` with project ID `prj_H6C2pfWKEAupFroHbLfzhquaNCLm`. Billing work does not authorize any deployment,
alias, environment change, or webhook to the legacy `rate-loop-nextjs` project or `rateloop.ai`.

Create separate Stripe test and live webhook endpoints. Subscribe each only to the event set above. Record the Stripe
Dashboard configuration and Price IDs in a tokenless billing runbook without recording secrets.

## Analytics for the pricing decision

Instrument server-derived product events without card, invoice, question, response, or reviewer content:

- `pricing_viewed`;
- `billing_upgrade_clicked`;
- `billing_checkout_created`;
- `billing_checkout_completed`;
- `billing_subscription_activated`;
- `billing_subscription_cancel_scheduled`;
- `billing_subscription_ended`;
- `billing_payment_failed`;
- `plan_limit_reached` with limit type; and
- `usage_threshold_reached` at 50%, 80%, and 100%.

The commercial dashboard should report by acquisition cohort:

- workspace activation to first completed decision;
- Free workspaces reaching 50%, 80%, and 100% usage;
- upgrade-click, Checkout-start, and paid-conversion rates;
- paid retention and cancellation reason;
- completed decisions, active agents, and active groups per paid workspace;
- subscription MRR separately from execution-fee revenue; and
- participant bounty and attempt reserve separately from RateLoop revenue.

Do not raise the public price merely because a few customers use all 250 decisions. Test $149 for new customers when at
least 10 workspaces have paid, five have renewed once, support and reliability are acceptable, and interviews show price
is not the main blocker. Compare cohorts rather than changing the price for everyone at once.

## Implementation sequence and commits

Keep each concern reviewable and do not deploy until the complete slice is verified.

### Phase 0 — commercial and provider setup

1. Confirm the Free and Early Access entitlements, founding-price language, refund policy, tax treatment, and cancellation
   behavior.
2. Create separate Stripe test product and recurring Price for `early_access_usd_99_2026_07`.
3. Configure test Customer Portal and webhook endpoint.
4. Document the price version and Stripe object ownership in a private operational runbook.

No application mutation should depend on a manually copied browser amount or product name.

### Phase 1 — billing persistence and entitlement core

**Commit:** `feat(billing): add workspace subscription entitlements`

- add migration `0032_tokenless_workspace_billing.sql` and schema/journal updates;
- backfill Free subscriptions and create one with new workspaces;
- add `plans.ts` and `entitlements.ts`;
- implement billing access checks and the read-only billing summary;
- add agent, group, freeze, complete, and cancellation enforcement; and
- add focused database and concurrency tests.

This phase runs with subscriptions disabled and all workspaces effectively Free.

### Phase 2 — Stripe Checkout, Portal, and webhooks

**Commit:** `feat(billing): integrate hosted Stripe subscriptions`

- add the `stripe` server dependency and lazy client;
- implement Checkout, Portal, and raw-body webhook routes;
- add configuration validation and readiness checks;
- add webhook idempotency and out-of-order tests; and
- add an operations runbook for test/live Stripe configuration and event replay.

Keep `TOKENLESS_SUBSCRIPTIONS_ENABLED=false` in every hosted environment until Phase 4.

### Phase 3 — pricing and workspace UI

**Commit:** `feat(web): publish simple pricing and billing controls`

- add `/pricing` and footer/mobile-secondary navigation links;
- add the overview billing card and success/cancel states;
- visually separate SaaS billing from panel-funding USDC;
- wire plan-limit errors into Agents, Groups, and Evaluations; and
- update terms/privacy after the approved billing copy exists.

### Phase 4 — test-mode release gate

**Commit:** `test(billing): cover subscription purchase and downgrade flows`

- run unit, route, migration, component, and end-to-end tests;
- deploy only to the isolated tokenless preview/test environment;
- use Stripe test clocks or controlled fixtures for renewal, past-due, cancellation, and period rollover;
- verify webhook replay and temporary webhook outage recovery;
- verify that accepted private and paid work completes through every subscription change; and
- verify the legacy production deployment and `main` branch do not move.

After the gate passes, enable test-mode subscriptions for internal accounts, then a small invited design-partner cohort.

### Phase 5 — live Early Access

1. Complete legal/tax and support-readiness checks.
2. Create the live product, Price, Portal configuration, and webhook in the isolated tokenless project.
3. Record the pre-deployment tokenless and legacy deployment IDs required by the isolation guard.
4. Configure server-only live secrets and run production readiness without printing values.
5. Enable subscriptions, complete one real low-risk B2B purchase, verify the invoice and webhook projection, then refund or
   retain it according to the test account policy.
6. Recheck `/pricing`, `/agents?tab=overview`, the tokenless review path, and the unchanged `rateloop.ai` deployment.

## Required tests

### Unit and service tests

- exact plan limits and price-version mapping;
- Free and paid period calculation at UTC boundaries;
- `past_due`, cancellation, period-end, and unsupported-price behavior;
- agent and group caps, including concurrent creation;
- multi-case reservation, idempotent retry, consumption, and release;
- no usage for drafts, skipped opportunities, failed authorization, or result reads;
- no second consumption on completion retry; and
- no subscription state affecting prepaid USDC arithmetic.

### Route and security tests

- session, same-origin mutation, workspace membership, and owner/billing authorization;
- admin/member read-only behavior;
- arbitrary Price ID, customer ID, success URL, and workspace metadata rejection;
- invalid webhook signature and mutated raw-body rejection;
- duplicate and out-of-order webhook delivery;
- unknown verified events returning success without mutations;
- Checkout success without a webhook remaining Free; and
- no Stripe secret or provider ID in client responses, rendered HTML, logs, or `NEXT_PUBLIC_` configuration.

### End-to-end tests

- create Free workspace, one agent, one group, and a completed unpaid private decision;
- reach a Free cap and see an actionable upgrade message;
- complete test Checkout and observe activation only after webhook processing;
- use Early Access limits and open the Portal;
- schedule cancellation and retain access until period end;
- fail renewal and preserve already-accepted work;
- downgrade while over Free agent/group limits without data deletion;
- keep subscription invoice, prepaid USDC, panel fee, bounty, and reserve visibly separate; and
- navigate pricing and billing on desktop and mobile without changing the established RateLoop shell proportions.

### Verification commands

Use the repository's existing package gates and add targeted billing tests to them:

```bash
yarn workspace @rateloop/nextjs next:test
yarn workspace @rateloop/nextjs check-types
yarn workspace @rateloop/nextjs next:build
yarn workspace @rateloop/nextjs tokenless:production:check
```

Run the relevant Playwright project against Stripe test mode and an authenticated local webhook forwarder or deterministic
signed webhook fixture. Never require a live charge in normal CI.

## Release acceptance criteria

The simple pricing release is complete only when all of the following are true:

1. A visitor can understand Free, Early Access, the usage unit, and separate paid-panel costs without signing in.
2. An authenticated owner or billing member can purchase and manage one $99 workspace subscription through hosted
   Stripe pages.
3. A browser redirect alone cannot grant paid entitlement.
4. Free and Early Access agent, group, paid-panel, and decision limits are enforced in server domain services.
5. Concurrent run freezes cannot exceed the allowance, and retry cannot double-reserve or double-consume.
6. Subscription failure, cancellation, downgrade, quota, or webhook outage cannot strand accepted rater work or alter
   fund-core settlement.
7. SaaS subscription records never affect prepaid USDC, bounty, fee, reserve, refunds, or rater claims.
8. The overview clearly separates subscription billing from panel funding.
9. Billing secrets remain server-only and verified webhooks are idempotent and replayable.
10. The pricing page promises only implemented features and states the Early Access price-change treatment.
11. Test-mode purchase, renewal, failed payment, cancellation, downgrade, and usage rollover pass end to end.
12. Only the isolated `rateloop-tokenless` deployment line changes; `main`, `rate-loop-nextjs`, and `rateloop.ai` remain
    untouched.

## Deliberately deferred

Defer these until paid usage supplies evidence:

- $149 public pricing and migration of founding customers;
- annual contracts and invoicing/SEPA workflows;
- Team and Enterprise self-serve tiers;
- automatic usage overages or prepaid decision blocks;
- trials, coupons, referrals, and promotional codes;
- seat-based pricing;
- proration and in-app plan switching;
- multiple currencies;
- custom retention and SLA entitlements;
- a dedicated billing tab; and
- a bespoke card-entry or invoice UI.

The next implementation should optimize for a trustworthy first charge and a clean pricing experiment, not for every
future packaging option.

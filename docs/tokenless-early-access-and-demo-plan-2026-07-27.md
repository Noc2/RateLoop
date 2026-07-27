# Early Access self-service and demo booking — plan, 27 July 2026

**Scope:** replace the two `mailto:hawigxyz@proton.me` calls to action on the landing and pricing pages with a
self-service Early Access subscription and a real demo-booking link.
**Head:** `tokenless` @ `c82494572`.
**Method:** three design/research agents plus direct verification. Every repo claim below was confirmed in source.
Google Calendar and four alternatives were verified against vendor documentation on 27 July 2026.

---

## 1. The headline: Early Access is ~85% built and switched off

Three assumptions I started with were wrong, and correcting them shrinks this work substantially.

| Assumption | Reality |
| --- | --- |
| No UI calls the checkout or portal routes | **False.** `WorkspaceSettingsClient.tsx:411` has `openBillingDestination("checkout" \| "portal")` posting to `/api/account/workspaces/${id}/billing/${kind}`. A literal grep missed it because the path is a template interpolation. |
| There is no billing surface on the agents page | **False.** `WorkspaceSettingsClient` renders on the **overview** tab (`AgentWorkspacePanels.tsx:106`) with plan, status, usage bar, limits, period end, Upgrade, Manage-billing, the business profile form, and success/cancelled banners. |
| The public CTA is a mailto | **False.** It is `/agents?tab=overview&billing=upgrade` whenever `subscriptionsEnabled` is true. The mailto is only the *fallback* when Stripe is unconfigured. |

**So the mailto the owner sees is a symptom, not the design.** It appears because
`TOKENLESS_SUBSCRIPTIONS_ENABLED` is false. The subscription journey already exists end to end:
`createEarlyAccessCheckout`, `createStripePortal`, five billing routes, the webhook, entitlements, and plan limits.

### And the deployment is not blocked

Checkout requires `traderStatus === "verified"`, which sounded like an operator gate. It is not:
`workspaceBilling.ts:208` sets `trader_status = 'verified'` inside the **self-declared** business-profile upsert. The
whole journey is self-service with no manual step.

The preflight also permits this on the tokenless deployment. `check-tokenless-production-readiness.mjs:615` returns
`validateTokenlessTestDeployment(env)` for any ref other than `main`, so the `sk_live_` requirement at `:668` is
unreachable there, and `:531` positively **rejects** live keys on the tokenless deployment. The two paths are
complementary: test-mode keys on tokenless, live keys on `main`.

> One design agent reported this as a deploy blocker requiring a preflight change. That is incorrect — verified at
> line 615. No preflight change is needed, and this also retracts a claim in
> [round-2 review §5](tokenless-completion-review-round-2-2026-07-27.md) that nothing prevents a live key on a testnet
> deployment. `:531` does.

---

## 2. Demo booking

### Recommendation: Google Calendar's free single booking page, reached by a plain outbound link.

The link-versus-embed argument is near-decided by the repo:

- `config/nextConfigCsp.test.ts:49` asserts `doesNotMatch(csp, /simpleanalyticscdn/u)` — a standing regression guard
  added by `b3794cc29` *"fix(privacy): remove undisclosed audience analytics"*. Allowlisting a third-party script
  origin now would reverse a deliberate decision made days ago.
- `script-src` is **nonce-only** with no `'unsafe-inline'` (`contentSecurityPolicy.ts:76-81`). A vendor embed loader
  would need its origin allowlisted and would likely still break, since such loaders inject un-nonced scripts.
- `legal/cookies/page.tsx` states RateLoop shows no consent banner because it places no non-essential storage, and a
  test asserts it. An auto-loading scheduler iframe would falsify that and reopen the consent question.
- `Referrer-Policy: strict-origin-when-cross-origin` is already set, so an outbound link leaks only the origin.

A plain link needs **no CSP change, no new script, no cookie-policy change, and no consent banner**.

### A legal nuance that changes where this gets disclosed

`legal/subprocessors/page.tsx:75-79` scopes that page to providers used "when it processes **Customer Personal Data**
under the Data Processing Addendum." A prospect booking a demo is not Customer Personal Data — RateLoop is the
**controller** there. The correct home is the **privacy notice**, not the subprocessor table. Listing it as a
subprocessor would misstate that page's own scope.

### Google Calendar: verified

Confirmed against Google's own documentation on 27 July 2026, with two empirical checks.

**Tiers** ([comparison page](https://support.google.com/calendar/answer/16287038)):

| Account | Appointment schedules |
| --- | --- |
| Free personal, Business Starter | **One** schedule. No payments, no email verification |
| Google One Premium / AI Pro / AI Ultra, Workspace Individual | Multiple schedules |
| Business Standard & Plus, Enterprise, Education, Nonprofits | Multiple, plus payments, email verification, secondary calendars, co-hosts |
| Frontline, Essentials, legacy SKUs | **Cannot create schedules at all** |

So **one booking page is free**, including on a personal account — which is all this needs. That resolves the
open question in a way that costs nothing.

**Public access confirmed.** Google states the booking page "is always public. Anyone with the link can view your
booking page, profile photo, account name," with no per-schedule visibility toggle. Verified empirically: an
unauthenticated request to the booking URL returns HTTP 200 with no redirect to sign-in.

**Attendee fields.** First name, last name, and email are required built-ins; "Add an item" adds custom questions,
with no documented tier gate. Phone is not a built-in — add it as a custom item. A community-reported ~5-item cap is
**not** officially confirmed.

**Data residency.** Calendar is in scope for Workspace Data Regions, but only on Business Standard and above (or the
add-on) — *not* on the free tier this plan otherwise recommends. Google's Cloud Data Processing Addendum with SCCs
covers EU requirements. **Not confirmed:** whether booking-form *answers* fall under the Calendar data-region
coverage, which enumerates event fields rather than form responses.

**Independent re-check before implementation.** A second pass over the same Google documentation confirmed the tier
matrix, the always-public booking page, the built-in attendee fields, and the unauthenticated HTTP 200. It corrected
or added five things:

- **Custom questions on the free tier are implied, not stated.** "Add an item" carries no documented tier gate and
  does not appear in the premium comparison chart, but Google never affirms free-tier availability. Treat as likely,
  not quotable.
- **Email verification is paid-only**, despite sitting in the same booking-form panel. A link on a public pricing page
  can therefore be booked with unverified addresses, and the free tier has no anti-spam control for it.
- **No rescheduling path is documented** for appointment schedules, for either the booker or the host. Do not write
  "cancel or reschedule" anywhere in the UI copy.
- **A forwarded confirmation email can cancel the booking** — Google says the recipient of a forward can cancel.
- **The booking link is not stable across a rebuild.** Deleting a schedule permanently breaks the shared link and a
  replacement gets a new URL, which is the strongest argument for keeping the destination in configuration rather
  than in source.

Also unresolved: whether the rendered free booking page carries Google chrome or branding. No Google page documents
it and no live page was available to inspect, so the site must not claim the booking page is unbranded.

### Embed vs link — the numbers

The research changed one thing: a **script-free inline iframe is far cheaper than assumed**.

| Option | CSP cost |
| --- | --- |
| Plain `<a href>` link | **none** |
| Inline iframe | **one directive**: `frame-src https://calendar.google.com` — verified the booking URL sends no `X-Frame-Options` and no `frame-ancestors` |
| Google's "button with popup" | `script-src`, `style-src` (plus `fonts.googleapis.com`), `font-src` (`fonts.gstatic.com`), `frame-src` — **and an inline script block** that needs a nonce or externalising |

The button embed is a poor fit for a nonce-only CSP and should be ruled out.

**I still recommend the plain link**, but the margin is narrower than §2 implied and the choice is now legitimately
open. The remaining argument against the iframe is not CSP cost — it is that a Google-hosted frame loading on page
view would set third-party storage, which would falsify the cookie page's "no consent banner" claim and reopen the
consent question. A link defers all of that to a deliberate click, on Google's own domain.

### Alternatives — verified 27 July 2026

Prices read from live vendor pricing pages. All five are fundamentally hosted booking pages, so **link-only works
everywhere** and the CSP question is moot for all of them. The choice reduces to price and where booking data lands.

| Vendor | Free tier | Cheapest paid | Data residency |
| --- | --- | --- | --- |
| [Zcal](https://zcal.co/pricing) | Most generous — unlimited links and calendars, payments, embed | $7/user/mo annual (removes branding) | **US.** Thin privacy policy, no hosting location named |
| [Cal.com](https://cal.com/pricing) | 1 user, unlimited event types, 100+ integrations | $12/user/mo annual (Teams; removes branding) | **US today.** Best legal documentation of the five; [cal.eu](https://cal.eu/) promises EU-only but is a **waitlist**, no price |
| [Calendly](https://calendly.com/pricing) | 1 event type only | $10/seat/mo annual | **US only.** Its own help pages name no EU option at any tier; third-party claims of Enterprise EU residency are unverified |
| [SavvyCal](https://savvycal.com/pricing) | **None** — trial only | $10/user/mo annual; branding removal is Premium-only ($17) | **US.** DPA self-serve with SCCs |
| [meetergo](https://meetergo.com/en/pricing) | €0 forever, unlimited users | €9.90/user/mo, but branding removal only from €29.90 | **EU — Frankfurt.** The only default-EU option here, no US parent |

**One finding worth knowing regardless of choice:** Cal.com's self-hosted edition has been spun out and renamed —
`github.com/calcom/cal.com` now resolves to `calcom/cal.diy`, relicensed **MIT**, described as community-maintained and
"strictly recommended for personal, non-production use," with commercial users redirected to the hosted product. The
old "AGPL plus buy a licence key" model is gone. Self-hosting is therefore *cheaper* legally but riskier
operationally, on a newly spun-out project with unproven maintenance cadence. I would not add an always-on service
with a database and mail sender to keep one marketing link alive.

**A caveat that applies to the link-only approach generally:** it keeps third-party JS and cookies off *your* origin,
so no consent banner is needed for the link itself — but the destination page runs the vendor's own analytics.
Cal.com's privacy policy names PostHog and Google Analytics; Calendly's embed docs expose a `hide_gdpr_banner`
parameter, implying its page carries one. The privacy-notice paragraph in §3/E4 should say where the prospect is being
sent, not imply the hand-off is analytics-free.

### Choosing

- **Cheapest path that works: Google's free single booking page.** Zero cost, zero new vendor relationship, and one
  schedule is all a "Book demo" button needs.
- **If EU residency for booking data is a positioning requirement** rather than a nice-to-have, **meetergo is the only
  one of these that delivers it by default** — and note that Google's free tier does *not* include Workspace Data
  Regions either. That is the real trade-off, and it is a commercial decision, not an engineering one.
- **cal.eu is the one to watch** if you would prefer Cal.com, but it is a waitlist today with no published price.

---

## 3. Work items

### E1 — Thread the upgrade intent through sign-in and workspace creation *(3–4 h)*

The CTA already targets `/agents?tab=overview&billing=upgrade`, but the intent is dropped at three points:

| Point | Code | Result |
| --- | --- | --- |
| Signed out | `agents/page.tsx:23` → `AgentsSignInPrompt` with hardcoded `returnTo="/agents"` | `billing=upgrade` lost |
| No workspace | `WorkspaceSetupStart.tsx:40` redirects to `/agents?workspace=X&step=connect` | `billing=upgrade` lost |
| Has workspace | `WorkspaceSettingsClient.tsx:384` accepts `"upgrade"` into `billingReturn` | **inert** — only `"success"`/`"cancelled"` are ever read |

Fixes: build `returnTo` from an **allowlist** of own params (`tab`, `workspace`, `step`, `billing`) rather than a raw
query passthrough; preserve `billing` through the workspace-creation redirect; and consume `billingReturn === "upgrade"`
by scrolling `#workspace-plan` into view and opening the profile form when incomplete.

**Do not auto-POST checkout on load.** An unattended redirect to Stripe is wrong, and it would burn the idempotency key.

### E2 — Fix `hasBlockingSubscription`, which is always false *(45 min)*

`workspaceBilling.ts:311` reads `provider_subscription_id`, but `readSubscription` does not select that column — so the
value is always null and `checkoutAvailable` never reflects a blocking subscription. Server-side enforcement is intact
(`findBlockingStripeSubscription`), so the impact is display-only: a workspace with an `incomplete` or `past_due`
subscription shows an enabled Upgrade button that 409s on click.

One-line fix. A test seeding a `past_due` subscription and asserting `checkoutAvailable === false` **fails on the
parent commit**.

### E3 — Absence instead of a disclaimer *(1 h)*

`WorkspaceSettingsClient.tsx:847` renders the Upgrade button **disabled** and labelled `"Billing is not enabled yet"` —
exactly the pattern `hostCapabilities.ts` rejects. Render the button only when `checkoutAvailable`; keep the
"Compare plans" link as the always-present affordance.

### E4 — Demo booking link *(1–2 h)*

`WorkspacePlanCards.tsx:87` is the single source for both pages. Add a `demoBookingUrl?: string` prop; render a plain
`<a target="_blank" rel="noopener noreferrer">` when set, falling back to the current mailto when unset so an
unconfigured environment still works. Resolve `TOKENLESS_DEMO_BOOKING_URL` server-side following the existing external
URL precedent (`paidEligibility.ts:697-705`): trim, `new URL()`, reject non-HTTPS in production, return `undefined` on
failure. Add it to `.env.example` and the environment-parity doc. **No CSP change.** Add the privacy-notice paragraph
per §2.

`pricing/page.test.tsx:32` asserts the exact mailto and will need updating; `page.test.tsx:119` asserts only
`/Book demo/` and survives, though it is worth strengthening to cover the href.

**Implemented, 27 July 2026.** `lib/marketing/demoBooking.ts` resolves the variable and both public pages pass the
result through `WorkspacePlanCards`. Two departures from the sketch above: the resolver rejects non-HTTPS in every
environment rather than only production, since a marketing link has no local-development case that needs cleartext,
and it also rejects credential-bearing URLs. It returns `null` rather than `undefined` to match the prop's type. The
mailto fallback is unchanged. **Remaining before this is live: the owner must create the booking page and set
`TOKENLESS_DEMO_BOOKING_URL` in the isolated Vercel project** — until then every environment keeps the mailto.

### E5 — Optional: a dedicated billing tab *(8–10 h, recommend deferring)*

The owner asked for a billing tab. The surface already exists on **overview** and works, so E1 alone meets the stated
goal of joining or managing after sign-in. A dedicated tab means extracting the billing card out of a 1,575-line
component that currently mixes billing, prepaid top-ups, enterprise identity, and workspace deletion — a pure refactor
with real regression risk against four source-assertion test files.

**If it is built, one detail matters:** `AgentWorkspacePanels.tsx:61` computes `canManage = owner || admin`, and that
drives which tabs are visible. A **`billing`-role member has `canManage === false`** — so gating a billing tab on
`canManage` would lock out exactly the role the tab exists for. Gate on the union `owner || admin || billing`; the
server already returns `canManageBilling` and the panel renders read-only under it.

### E6 — Optional: the 24-hour idempotency edge *(2 h)*

`checkoutIdempotencyKey` is constant per workspace and price version. That correctly collapses double-clicks, but
Stripe idempotency keys and Checkout Sessions both live ~24 h — so a user who abandons and returns near that boundary
replays the key and receives the same, now-expired session URL: a dead Stripe page with no in-app error. Append a
coarse UTC-date bucket, or catch an expired session and mint a fresh one.

---

## 4. Sequence and effort

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| E2 | `provider_subscription_id` SELECT bug | 45 min | ship first, standalone, test fails on parent |
| E1 | Thread the upgrade intent | 3–4 h | the core of the request |
| E3 | Absence over disclaimer | 1 h | |
| E4 | Demo booking link | 1–2 h | gated on the vendor decision, not on engineering |
| E6 | Idempotency edge | 2 h | optional |
| E5 | Billing tab extraction | 8–10 h | recommend a separate follow-up |

**Core path (E1–E4): ~7 hours.** None of it is blocked by the deployment.

---

## 5. Decisions for the owner

1. **Scheduler vendor.** All candidates satisfy the link-only requirement identically, so choose on cost and comfort.
   Check the Google Workspace tier question first — if you already pay for Business Standard or above, Google is free
   and adds no new commercial relationship. Also decide whether a US-processed scheduler is acceptable at all.
2. **Stripe test-mode setup on tokenless.** Create a test-mode $29/mo recurring USD price and register the webhook at
   `https://rateloop-tokenless.vercel.app/api/billing/stripe/webhook`. `isExpectedEarlyAccessStripePrice` rejects any
   price that is not active, USD, $29.00, monthly, `interval_count: 1`.
3. **The public CTA when subscriptions are genuinely off.** Keep the mailto (defensible — it is a real working
   affordance, not a disclaimer), render the card with no CTA, or hide the card. I lean toward keeping the mailto.
   No test pins this, so any choice is free of churn.
4. **Billing tab now or later** (E5).
5. **The idempotency edge** (E6) — fix or accept.
6. **Whether to list the scheduler on the subprocessor page anyway**, despite it being controller-side, for
   completeness.

---

## 6. What was and was not verified

**Verified:** every repository claim, cited by file and line. The Google Calendar tier matrix, public-access behaviour,
attendee fields, and CSP requirements — against Google's own documentation, plus two empirical checks (an
unauthenticated fetch of a booking page, and the response headers on the embed URL).

Alternative-scheduler pricing and residency were read from live vendor pages the same day.

**Not verified:** whether Google appointment booking-form *answers* fall under Workspace Data Regions coverage; the
community-reported ~5 booking-form-item cap; the Workspace Individual payments row, where Google's own comparison
table and admin documentation disagree (the admin doc is more reliable). Among alternatives: Cal.com and Calendly
month-to-month list prices (derived from annual "save" badges, since the toggles were not scriptable); whether cal.eu
is generally available or what it costs; and third-party claims that Calendly Enterprise offers EU residency, which no
Calendly-owned page confirms.

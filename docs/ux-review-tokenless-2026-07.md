# RateLoop tokenless — UX review (July 2026)

Reviewed: `https://rateloop-tokenless.vercel.app` at commit `40839eb` (tokenless), 2026-07-18.

Method: four parallel review passes — (1) accessibility/interaction code review of `packages/nextjs`, (2) content/copy review of the live server-rendered pages, (3) information-architecture and journey review (code + live), (4) external benchmark research on comparable platforms (Prolific, marketplace landing pages, passkey UX, embedded-wallet payout UX, API onboarding). Findings were spot-verified against source before inclusion; every code finding cites `packages/nextjs/` paths. Pixel-level screenshot review was not possible from the review environment (proxy blocked headless-browser access to the deployment), so visual findings are limited to what code and rendered markup establish.

Severity: **High** = blocks or badly damages a core journey, or risks incorrect/irreversible user action. **Medium** = real friction or a violation of the project's own UX standard (AGENTS.md). **Low** = polish.

---

## Executive summary

The underlying structure is in good shape: the agent setup wizard is properly staged and complies with the connect-first rule, eligibility correctly gates before the first paid voucher, drafts persist across reloads, `InfoPopover` is a model touch- and keyboard-accessible tooltip, and `AsyncSection` gives consistent loading/empty/error states. The pricing page's "no automatic overage charges" and the honest "when RateLoop is not the right tool" docs section are genuine trust assets.

The problems cluster in five themes:

1. **The rater funnel is broken at both ends.** "Start Reviewing" leads signed-out visitors to a gate with no real content, and after sign-in the fallback redirect dumps raters into the *operator* workspace wizard (`/agents`). The audience the site recruits with half its marketing story can neither preview the work nor arrive at it after signing in. (Findings 1, 2)
2. **Keyboard handling in the review flow can submit work the user never looked at.** Every question card registers its own global `keydown` listener; one keypress fans out to all cards, and Enter on a focused link is hijacked into advance/submit. For a product whose submissions are sealed, signed, and irreversible, this is the single most dangerous defect found. (Findings 3, 4, 5)
3. **Implementation vocabulary leaks ahead of need** — mechanism chips on the landing hero, "authorized terminal human result" on pricing, six different names for the unit of work — against the project's own copy standard. (Findings 8–12)
4. **Post-setup surfaces invert the "most likely next action" rule.** The Agents overview after connect is a settings pile with deletion on the default tab and funding buried; the rater Profile stacks empty management panels including a crypto-jargon bonus-claims tool shown to users with zero reviews. (Findings 6, 7, 13)
5. **The money story is missing for raters and hedged wrong for buyers.** Nowhere before sign-up does a rater learn what reviews pay, when, or how; buyers meet three unglossed fee terms; and several compliance/settlement claims (EU AI Act "Yes", FINRA/SEC references, "Base USDC settlement" with no testnet disclosure) outrun the deployed system. (Findings 14–16)

Top five fixes by leverage: carry `returnTo` through every sign-in gate (1); make the public review queue readable signed-out (2); scope review-shell keyboard shortcuts to the active card (3); rebuild Agents overview around fund → first ask → results (6); add a rater money story (pay per review, timing, payout rail) to `/human` and the landing page (14).

---

## A. Rater journey (landing → first paid rating → payout)

### 1. Post-sign-in fallback sends raters into the operator wizard — High

`safeReturnPath()` falls back to `"/agents"` (`components/auth/BetterAuthSignIn.tsx:37-39`), and the shared `RateLoopSignInAction` used by every `SignedOutGate` is a hardcoded `href="/sign-in"` that never passes `returnTo` (`components/thirdweb/ThirdwebSessionButton.tsx:12-18`). A visitor who clicks "Start Reviewing", hits the Discover gate, and signs in lands in "Name your workspace" — the operator setup wizard. This is the worst possible mis-signal for a two-audience product.

Fix: every gate passes its own path as `returnTo`; change the fallback to `/` or route by the surface the user came from.

### 2. "Start Reviewing" and `/rate` terminate in a content-free wall — High

`/rate` redirects to `/human?tab=discover`; signed-out, the task fetch 401s and the visitor gets a gate with only an illustrative example (`components/tokenless/answer/AnswerPageClient.tsx:144-153`). Server-rendered output shows only "Loading review work", so the first paint (and SEO view) of the advertised public review path is a spinner. Public-scope tasks are by definition "public, synthetic, or safely redacted" (`PublicQuestionCard.tsx:433`), so a read-only signed-out listing is safe — and it is the strongest possible proof of liquidity for both audiences. Compare `/agents`, which handles signed-out correctly with a one-line pitch plus example workspace.

Fix: serve the public queue read-only to signed-out visitors; gate at voucher/submit time. Give `/human` the `/agents` treatment as a minimum.

### 3. Every question card registers global keyboard shortcuts — one keypress acts on all cards — High

`components/tokenless/review/ReviewerShell.tsx:52` attaches a `window`-level `keydown` listener (`1`, `2`, `R`, `Enter`) per instance, and `AnswerPageClient.tsx:135` renders one `PublicQuestionCard` (each wrapping its own `ReviewerShell`) per task. With N cards listed, pressing `1` sets the answer in every card, and Enter calls `onAdvance()` on every card whose draft is complete — a sealed, on-chain-committed rating can be submitted for questions the user never looked at.

Fix: one shortcut listener, routed to the card containing `document.activeElement` (or listeners scoped to the card element).

### 4. Enter on a focused link is hijacked into advance/submit — High

`ReviewerShell.tsx:7-15` (`isTypingTarget`) excludes inputs/textareas/selects/buttons but not anchors; at `:44-48` Enter triggers `onAdvance()` with `preventDefault()`. A keyboard user who tabs to "Open private artifact" or "Paid-work eligibility" and presses Enter submits/advances instead of following the link.

Fix: bail out when the event target is or is inside an `<a>`.

### 5. Private review batches are forward-only with no confirm step — High

`HumanAssuranceRaterClient.tsx:333-340` only increments `activeCaseIndex`; there is no Back control, and on the last case the same button immediately fires `submitResponses()` for all cases (`:483`). A slip on case 1 of 5 is uncorrectable before an irreversible batch submission.

Fix: add Back (drafts already persist per case) and a summary/confirm step before final submit.

### 13. Rater Profile is a stack of empty management surfaces — Medium

`HumanProfileContent.tsx` unconditionally renders: display-name form, invitation-code form, "No private-group memberships yet…", optional World ID, eligibility, and `FeedbackBonusClaimsClient` — the last exposing "Choose a review", "Import backup", vote keys, and a legacy recovery-secret field to a brand-new user with zero reviews (`FeedbackBonusClaimsClient.tsx:215-283`). AGENTS.md names repeated empty states and premature management surfaces as product defects.

Fix: render bonus claims only when entitlements/recoveries exist; collapse invitation entry into a "Have an invitation code?" disclosure; hide memberships until one exists.

### 17. Eligibility flow ping-pongs across three surfaces with a dead end — Medium

Discover card → Profile `#paid-work` → "Add payout wallet" → `/settings/wallets` — a page outside all navigation whose client (`WalletBindingsClient.tsx`) renders no link back to eligibility — → manual back → identity provider → an 11-field tax form. The ordering (eligibility before first paid voucher) is correct and the "No blocked earnings later" rationale panel is good practice; the ergonomics are the problem. The two gate texts also disagree about when the wallet is needed (`PublicQuestionCard.tsx:584-587` vs `PaidEligibilityClient.tsx:322-324`).

Fix: one in-place stepper at `#paid-work` (wallet → identity → tax/consent), wallet binding embedded or returning via `returnTo`; reconcile the copy.

### 18. Raters have no history or earnings surface — Medium

`AnswerScope` includes `"submitted"` (`lib/tokenless/answerQueue.ts:1`) but no UI uses it. After submitting, past reviews, pending settlements, and cumulative earnings are invisible; only per-round bonus claims exist. For the "get paid" audience this is a trust gap — payment opacity is the top complaint cluster on comparable platforms (see Benchmarks §2).

Fix: a "My reviews" tab on `/human` from the existing submitted scope plus settlement status and running total.

---

## B. Agent-operator journey (landing → first paid ask)

### 6. Post-connect Agents overview is a settings dump, not a next step — High

After setup completes, the default tab renders stop panel, full workspace settings (plan/billing, VAT, funding anchor, enterprise identity), workspace **deletion**, then the evidence strip (`AgentWorkspacePanels.tsx:122-133`). The actual next actions — fund the workspace, watch for the first ask, see results — are buried or absent. This directly violates the project's "single most likely next action" and "advanced controls behind explicit disclosure" rules. (The connect-first requirement itself is correctly implemented: management tabs appear only once `setup.complete`.)

Fix: overview = status + next step (funding balance and CTA, pending approvals, latest results); move billing/VAT/identity/deletion behind an explicit workspace-settings disclosure.

### 7. Funding is never introduced; the first ask fails into a repair loop — Medium

The five wizard stages never mention prepaid USDC even when per-reviewer USDC compensation was chosen (`AgentSetupFlow.tsx:1876-1882` only notes funding is checked when a request is prepared). The first `/handoff` then errors "less available prepaid USDC than the quoted total" with a "Top up balance" link into the overview settings pile (`TokenlessHandoffClient.tsx:887-906`).

Fix: a funding step (or explicit "fund later") at wizard end; funding as a first-class overview element.

### 19. Pricing CTAs lose intent through sign-in — Medium

Plan cards link to `/agents?tab=overview&billing=upgrade` (`components/pricing/WorkspacePlanCards.tsx:24,39`); a signed-out click hits the generic Agents gate and the billing intent is lost because `returnTo` is never set (finding 1). Pricing is also absent from the desktop rail (footer only).

Fix: carry the billing param through sign-in; add Pricing to the rail.

---

## C. Landing page and messaging

### 8. The hero fails the five-second test — High

Headline "The Human Assurance Loop" plus subheadline "Scale AI autonomy without scaling blind trust." (`app/(public)/page.tsx:138`) are both benefit slogans; neither says *AI agents pay real humans to review their work*. The two CTAs presume the visitor already understands the two roles.

Fix: a literal subheadline, e.g. "Real humans review your AI agent's work before it ships. Agents request reviews through an API; reviewers get paid per review."

### 9. Mechanism vocabulary on the hero path — High

The landing "Why it works" cards name "Audience policies", "sealed answers", "Base USDC settlement", "recomputable" pay, with chips linking to "Sealed answers", "Independent opening", "Fund safeguards" (`app/(public)/page.tsx:23-40`) — and `/docs/tech-stack` opens by admitting "The landing page names the mechanisms behind RateLoop. Here is what each one does." A docs page exists to decode the landing page; the AGENTS.md standard (no implementation terminology before it's needed) is inverted on the most-trafficked page.

Fix: replace with three plain trust claims ("Reviews are blind." / "Pay is guaranteed and auditable." / "Anyone can verify every decision."), each linking to Tech Stack for the mechanism.

### 14. The rater money story is missing — High

Nowhere on `/`, `/human`, or the public review path does a prospective rater learn what a review pays, when, or how. The only pay copy is docs jargon ("claim guaranteed pay plus bonus"; reviewers "claim compensation at specified payout addresses"). Benchmarks: Prolific shows per-task reward and time estimate before acceptance and publishes a pay floor; payment opacity is the top rater complaint across MTurk/Remotasks-type platforms (Benchmarks §2).

Fix: a "Get paid to review AI work" section on the rater path: pay per review (or where it's shown), guarantee once accepted, and an honest one-liner on the payout rail (USDC on Base to your payout address) with timing.

### 10. Step 4 of "How it works" says nothing — Low

Steps 1–3 are actor+verb; step 4 "Evaluation — Returns feedback and actionable human performance metrics for AI workflows" is filler. Fix: "Agent gets the verdict — pass, revise, or stop, with reviewer reasons attached."

### 20. Three CTAs compete on the landing page — Low

"Start Reviewing", "Connect Agent", plus "Explore example workflows" mid-page. Demote the third to a text link so each audience has exactly one primary action. Benchmarks also favor picking *one* primary audience for the hero (the buyer, since demand creates the work) with the rater path as a strong secondary — worth an explicit decision.

---

## D. Pricing, docs, and terminology

### 11. Pricing defines its unit in spec language; fee taxonomy unglossed — Medium

"One case that reaches an authorized terminal human result" is state-machine vocabulary for "what counts against my 25/250?". "Bounty, attempt reserve, and execution fee are itemized before funding" introduces three terms with no gloss and leaves total cost of ownership unclear. The good parts — "no automatic overage charges", 60-days-notice — should stay.

Fix: "A decision = one piece of work that receives a final human verdict. Drafts and cancelled cases don't count." and "Paying reviewers costs extra — you see the exact all-in price for each review before you approve it." Fee taxonomy into a tooltip/docs.

### 12. The unit of work has six names; the humans have four — Medium

Across live pages: reviews, review decisions, cases, asks, rounds, handoffs; and Humans / reviewers / panels / raters (route `/rate`). Standardize the user-facing surface on ~two words (suggest **review** / **reviewer**) and confine round/ask/handoff/voucher to API reference. Similarly `/docs` "Builders" card: "versioned quote, ask, wait, and result flow without putting a token in your product" — "token" reads as *API token* here. Suggested rewrite: "Request a priced human review from your backend with one idempotent API call — no crypto required in your product."

### 21. `/docs/how-it-works` serves both audiences in one scroll — Low

Agent flow, reviewer flow, vouchers, quorum, sealed commit, RBTS bonus on a single page; each audience scrolls past the other's mechanics. The sidebar already splits "Start Here / Platform / Build" — split this page the same way and gloss each term on first use.

### 22. `/search` tells you to search somewhere else, then gates mid-results — Low

The page's own copy says to use the nav search field; signed-out it appends the Discover sign-in gate under doc results; signed-in it duplicates Discover with subtly different behavior (`app/(public)/search/page.tsx`). The rail search also navigates away on keystroke — `SiteSearch.tsx:71-75` debounces 200 ms then `router.push` while typing, abandoning mid-wizard context. Fix: navigate on Enter/overlay results; keep `/search` to pages/docs with a link into Discover.

---

## E. Trust and compliance claims

### 15. Compliance claims outrun the deployed system — High

Landing FAQ answers "Does RateLoop help with EU AI Act human oversight?" with a flat "Yes."; `/docs/human-oversight` maps Article 14(4)(a)–(e) to shipped features; `/docs/evidence` cross-references ISO/IEC 42001, NIST AI RMF, FINRA, and SEC — while the site claims "Base USDC settlement" with no visible statement that the current deployment settles on Base Sepolia testnet (and the repo's own notes mark the checked-in artifact stale). The house rule is that every customer-facing claim must describe the deployed system exactly; the regulated-market name-drops are the riskiest instance.

Fix: hedge to capability language ("designed to support Article 14(4) oversight measures; suitability depends on your deployment") and add a network-status line wherever settlement is claimed.

### 16. Missing fairness affordances that comparable platforms are scored on — Medium

No visible statement of: guaranteed payment for accepted work, a written reason for any rejection, an appeal path, or payout timing/threshold in one place. These are the auditable Fairwork Cloudwork criteria and the FTC's gig-platform enforcement focus, and they map directly onto the top rater complaints at MTurk/Remotasks (rejection without explanation, withheld pay, silent deactivation). RateLoop's settlement design can honestly claim most of these — it just never says so.

Fix: a short "How pay works" page: acceptance criteria, guarantee, rejection-with-reason policy, appeal path, payout schedule.

---

## F. Accessibility and interaction details

### 23. OTP step is a dead end — Medium

After "Email me a code" the UI swaps to a bare code form: no resend, no change-email, the target address never shown, focus not moved, nothing announced (`BetterAuthSignIn.tsx:171-189`). A typo'd email forces a reload. Also: `sendCode`/`verifyCode`/`signInWithSso` lack try/catch — a network failure skips `setBusy(false)` and freezes the form permanently (`:75-119`); and busy states change nothing visible ("Email me a code" stays static while disabled). Benchmarks favor identifier-first with passkey conditional UI (`autocomplete="webauthn"`) and offering passkey creation *after* the first OTP success. The sign-in page also renders no server-side reassurance copy — "email or passkey, no wallet needed" is the product's differentiator and goes unstated at exactly the right moment.

### 24. Error feedback is ephemeral or generic — Medium

Error toasts auto-dismiss after 3 s with no hover-pause (`RateLoopNotificationProvider.tsx:20,86`). Validation failures are replaced by "We couldn't record your rating. Try again." while the actionable cause (e.g. "Feedback must contain 1–N characters") is demoted to a collapsed "Technical details" (`PublicQuestionCard.tsx:373,552-557`) — retrying can never succeed and the fix is hidden. Submit buttons are silently disabled with unstated requirements (≥10-char rationale, prediction required) and no counter or hint (`HumanAssuranceRaterClient.tsx:164-176,640-652`; `PublicQuestionCard.tsx:397-401`).

Fix: errors persist until dismissed; show validation messages in the `role="alert"` line; state requirements inline ("At least 10 characters — 4/10").

### 25. Assorted a11y defects — Medium

- Mobile hamburger is a bare `<details>` that never closes on navigation, Escape, or outside tap (`TokenlessShell.tsx:227-240`).
- Discover filter pills claim `role="tablist"`/`tab` with no arrow-key support or panels (`AnswerPageClient.tsx:101-118`); the codebase's own `AgentTabs.tsx:30-70` does it correctly.
- Image lightbox sets `aria-modal` but doesn't trap focus or lock scroll (`QuestionMedia.tsx:93-125`) — native `<dialog>.showModal()` fixes both.
- No skip link although `<main id="main-content">` exists (`TokenlessShell.tsx:254`).
- Most routes ship no `metadata.title`; `/human`, `/agents`, `/docs`, `/legal/*`, and the home page all read "RateLoop — Human assurance for AI" in tabs/history.
- Interactive link + raw artifact hash nested inside the candidate radio's `<label>` (`HumanAssuranceRaterClient.tsx:583-620`) — invalid HTML, garbled accessible name.
- Deadline exact time only in a hover `title` (`DeadlineChip.tsx:31`) — unreachable on touch/keyboard, violating the project's own tooltip rule; `InfoPopover` is right there.
- Sub-44 px touch targets: chips, prediction pills, mobile hamburger (`Chip.tsx:24`; `PublicQuestionCard.tsx:530-540`; `TokenlessShell.tsx:228`).
- Rail nav links omit `aria-current` (which `HumanTabs`/`AgentTabs` do set) (`TokenlessShell.tsx:105-127`).
- Root error page: two heading levels for "Error / Something Went Wrong", digest never surfaced (`app/error.tsx:8-11`).
- Desktop rail appears only at ≥1280 px (`TokenlessShell.tsx:222,241`) — landscape iPads and small laptops get the phone hamburger; consider `lg`.

### 26. Settings are split across three homes — Medium

Account notifications and deletion live at `/human?tab=settings`; wallets at the orphaned `/settings/wallets`; workspace settings inside Agents → Overview; `/settings*` are redirect stubs to two different destinations. An operator's profile also lives under "Humans" via the session chip (`ThirdwebSessionButton.tsx:43`). Fix: one account-settings surface (notifications, wallets, deletion) reachable from the session chip; keep the redirects.

### 27. Machine-entry pages dead-end stray visitors — Low

Direct `/handoff` shows "Cannot open review — Ask the agent for a new link" with no links out (`TokenlessHandoffClient.tsx:589-599`); unknown `/connect/[intentId]` falls to the generic 404. Keeping them out of nav is sound IA; just add a docs/agents escape link to the error states.

---

## What's working (keep it)

`InfoPopover` (touch-safe, 44 px trigger, correct ARIA, Escape-with-focus-restore); `AsyncSection`'s consistent async states with `role="status"` and `motion-reduce`; contrast tokens flooring helper-text alpha (`styles/globals.css:109-118`); global reduced-motion handling; draft persistence in both review flows; the staged agent-setup wizard and its connect-first compliance; server-side eligibility enforcement before the first paid voucher with the "No blocked earnings later" rationale; pricing's "no automatic overage" and 60-days-notice terms; `/docs/use-cases`' "when RateLoop is not the right tool"; the `/agents` signed-out example-workspace pattern (extend it to `/human`).

---

## Benchmarks consulted (external research)

1. **Two-sided landing pages** — lead with one primary audience (the buyer creates the work), secondary CTA visually subordinate; prove liquidity above the fold. (Sharetribe marketplace guide; Unbounce/HubSpot CTA research.)
2. **Data-work platforms** — Prolific shows per-task reward + time estimate up front and publishes a pay floor ($8/hr min, $12+ recommended); Fairwork Cloudwork principles require time estimates before acceptance, payment within an agreed timeframe, and reasons + appeal for rejections; top complaints across MTurk/Remotasks: rejection without explanation, withheld pay, task drought, silent deactivation. Be honest about intermittent task availability.
3. **Passkey + OTP** — identifier-first with conditional UI (`autocomplete="webauthn"`) beats a dedicated passkey button (FIDO Passkey Central); auto-trigger passkey for known users; offer passkey creation after first OTP success, framed "sign in faster next time" (Google passkey UX).
4. **Crypto under the hood** — create wallets at the moment of need (RateLoop's purpose-bound model matches best practice); sponsor gas always; at payout time disclose asset, network, fees, timing, and a key-export escape hatch (Privy; Visa Direct stablecoin payouts).
5. **Developer onboarding** — time-to-first-successful-call under 5 minutes (under 2 is top-tier); auto-issued sandbox keys, copy-paste snippets pre-filled with the user's real test key, a Stripe-style ~7-line quickstart, and a one-line MCP install block; a sandbox that returns a simulated human rating without funding.
6. **Trust for pay platforms** — publish the Fairwork-style checklist (guaranteed pay for accepted work, fees before acceptance, plain-language terms, notice of changes); every punitive action gets a stated reason and a low-friction appeal; don't keep buyers anonymous while raters are KYC'd — show which agent requested a review and its acceptance/dispute history.

Sources: sharetribe.com/how-to-build/two-sided-marketplace · unbounce.com/conversion-rate-optimization/call-to-action-examples · researcher-help.prolific.com (payment principles) · participant-help.prolific.com (when will I be paid) · fair.work/en/fw/principles/cloudwork-principles · ssir.org/articles/entry/ai-workers-mechanical-turk · pivot-to-ai.com/2024/08/29/scale-ai-is-stiffing-its-task-workers · passkeycentral.org/design-guidelines/required-patterns/sign-in-with-a-passkey · corbado.com/blog/passkey-login-best-practices · developers.google.com/identity/passkeys/ux/user-journeys · privy.io/embedded-wallets-101 · corporate.visa.com (Visa Direct stablecoin payouts) · youngcopy.com (API onboarding TTFC benchmark) · blog.postman.com/top-25-api-onboarding-experiences · ftc.gov (gig work policy statement)

---

## Prioritized fix list

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 1 | `returnTo` through every sign-in gate; fallback off `/agents` (1) | High | S |
| 2 | Public review queue readable signed-out; gate at submit (2) | High | M |
| 3 | Scope review shortcuts to active card; exempt anchors from Enter (3, 4) | High | S |
| 4 | Back + confirm step in private review batches (5) | High | S |
| 5 | Agents overview → status/next-step surface; settings behind disclosure (6) | High | M |
| 6 | Literal hero subheadline; replace mechanism chips with plain trust claims (8, 9) | High | S |
| 7 | Rater money story on `/human` + landing; "How pay works" page (14, 16) | High | M |
| 8 | Hedge EU AI Act/FINRA/SEC claims; disclose testnet settlement (15) | High | S |
| 9 | OTP step: resend, change email, shown address, try/catch, busy labels (23) | Medium | S |
| 10 | Error persistence + actionable validation messages + inline requirements (24) | Medium | S |
| 11 | Eligibility as one in-place stepper; fix `/settings/wallets` dead end (17) | Medium | M |
| 12 | Funding step in wizard; funding first-class on overview (7) | Medium | M |
| 13 | Hide empty Profile panels; gate bonus-claims UI on entitlements (13) | Medium | S |
| 14 | "My reviews" history/earnings tab (18) | Medium | M |
| 15 | Terminology pass: review/reviewer everywhere; pricing glosses (11, 12) | Medium | M |
| 16 | A11y batch: hamburger close, tablist roles, lightbox dialog, skip link, titles, `aria-current`, touch targets, deadline popover (25) | Medium | M |
| 17 | Unify account settings under session chip (26) | Medium | M |
| 18 | Search on Enter/overlay; slim `/search` (22) | Low | S |
| 19 | Landing step-4 copy; demote third CTA; FAQ jargon (10, 20) | Low | S |
| 20 | Escape links on `/handoff`/`/connect` error states; docs split by audience (21, 27) | Low | S |

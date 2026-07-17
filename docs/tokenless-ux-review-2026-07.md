# Tokenless UX/UI review and improvement plan (July 2026)

**Status:** UX/UI review of the tokenless product surface with a phased improvement plan. Method: a live
walkthrough of the deployed preview (`rateloop-tokenless.vercel.app`, desktop 1280px and mobile 375px,
signed-out surfaces), a code-level audit of `packages/nextjs` (679 TS/TSX files, ~16.8k lines in
`components/tokenless`), and external benchmarks for comparable products (setup wizards, annotation queues,
trust presentation, crypto-abstraction, dark-theme systems; sources cited inline, current 2026-07-16).
Constraint honored throughout: the established RateLoop visual design — black rail, spectrum gradient,
typography, spacing — stays; every recommendation works inside that language. Authenticated-flow findings
are code-derived (no account was used); items marked *(verify live)* should be confirmed in a signed-in
session.

## 1. Summary verdict

The product has a distinctive, coherent visual identity, an unusually well-considered information
architecture at the top level (three-item nav, two hubs, URL-driven tabs, server-validated params), good
ARIA landmark/live-region hygiene in key flows, and honest, calm microcopy in consent moments. The main
problems are: (1) **secondary-text contrast below WCAG AA at scale** on the pure-black theme; (2) **crypto
machinery leaking into end-user surfaces** despite the "implementation detail" positioning — worst in the
public reviewer flow; (3) **two divergent reviewer UIs** for the same task, both with real friction (manual
hash entry, no draft safety, no countdowns); (4) **design-system fragmentation** (two card systems, ~7
button idioms, no shared badge) that will compound as Codex keeps adding panels; and (5) **no UX safety
net** — no interaction tests, no E2E, no a11y tooling, so none of this is guarded against regression.

Scored against a 20-criterion benchmark checklist (setup, reviewer flow, inbox/dashboard, trust/money,
craft/access — [full checklist in §7]), the surface lands roughly 21/40: strong on consent summaries,
empty-state copy, and evidence disclosure; weakest on keyboard support, contrast, loading states, and
reviewer-flow friction.

## 2. What is genuinely good (keep and protect)

- **Identity and consistency of the marketing surface.** The black rail, mono section numbers, and gradient
  headline words read as a designed system, not a template. The new "Evidence your auditors can check" card
  and `/docs/evidence` page follow layered disclosure correctly: plain-language claim → packet walk-through →
  verification commands → raw hashes last — matching the GitHub-attestations/Sigstore pattern
  ([GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)).
- **Sign-in is properly crypto-abstracted:** work email OTP, passkey, Google/Apple — no wallet vocabulary at
  the front door, which is the 2026 embedded-wallet norm
  ([Base smart wallets](https://blog.base.org/how-base-is-making-smart-wallets-the-default)).
- **Setup flow fundamentals:** resumable per workspace, backward navigation, step focus moved to the heading
  on navigation with an `aria-live` announcement (`AgentSetupFlow.tsx:562-568`), safe-by-default connection
  copy ("Safe access only: … No publishing, spending, private artifacts, or workspace administration").
- **Error/empty conventions exist:** 39 `role="alert"` inline banners, mostly user-oriented copy; empty
  states generally say what will appear and what to do next.
- **Honest states:** the paid-eligibility overlay, "Compensation evidence: No paid voucher attached", and
  advisory-vs-enforced labels carry the claims-match discipline into the UI.

## 3. Findings

### 3.1 Landing and signed-out surfaces

1. **Hero orb renders as an empty ring** (desktop and mobile in this walkthrough) and on mobile occupies
   ~500px *above* the headline, pushing the value proposition below the fold. *(verify live: the orb may
   animate in environments this walkthrough could not reproduce; if so the mobile ordering issue still
   stands.)*
2. **CTAs are persona nouns, not actions.** "Humans >" / "Agents >" say who, not what or why. Benchmarks
   favor verb-value labels ("Start reviewing — get paid in USDC" / "Connect your agent in 15 minutes")
   ([NN/g wizards & CTA guidance](https://www.nngroup.com/articles/wizards/)).
3. **Protocol jargon appears as first-layer landing chips** — `x402`, `Commit-Reveal`, `drand/tlock`,
   `RBTS`, `Fund Core` — while the design of record says blockchain/x402 "do not define the product
   category." These chips currently *are* the category signal a first-time enterprise visitor sees.
4. **Signed-out `/human` and `/agents` are dead ends:** a sign-in card with no preview of what review work
   or the workspace looks like. Vercel-style onboarding engineers the empty state out by showing real
   content first ([Vercel onboarding teardown](https://getperspective.ai/blog/vercel-ai-native-customer-onboarding-developer-teams)).
5. Small: page `<title>` duplicates the brand ("Sign-In | RateLoop | RateLoop"); the docs index "Where to go
   next" list omits the new Evidence page; heavy hero/diagram animation warrants a scroll-performance pass
   *(verify live — this walkthrough saw scroll stalls that may be environment artifacts)*.

### 3.2 Reviewer experience (the product's supply side)

6. **Two divergent UIs for the same task.** Private/invited (`HumanAssuranceRaterClient.tsx`, 580 lines) and
   public/network (`answer/PublicQuestionCard.tsx`, 521 lines) differ in layout, terminology, and
   interaction model. The best annotation tools converge on one mental model: one item per screen,
   single-keystroke answer, auto-advance ([LangSmith annotation queues](https://docs.langchain.com/langsmith/annotation-queues)).
7. **High-friction private entry:** reviewers must paste an opaque `Assignment ID` and a
   `sha256:…` confidentiality-terms hash by hand (`HumanAssuranceRaterClient.tsx:314-323`), though
   `/human?assignment=` deep links already exist and could carry both.
8. **No draft safety:** answers and rationales live only in React state — a reload loses everything; long
   multi-case assignments render as one scroll with no per-case progress.
9. **Commit–reveal leaks to the public rater:** a required "Recovery secret" password, a downloadable
   "recovery package" JSON, "Submitting through the sponsored gas-only relayer…", and "Retry saved
   submission" button-label state machines (`PublicQuestionCard.tsx:434-468, 265, 455-459`). Deel's
   benchmark for paying workers in stablecoins is full invisibility of the chain layer
   ([Deel stablecoin payouts](https://www.deel.com/blog/introducing-stablecoin-wallet/)).
10. **Undefined acronyms in the earnings row:** "Guaranteed $… · RBTS up to $… · Surprise up to $…"
    (`PublicQuestionCard.tsx:337-340`). The spec's own naming rule ("Response quality reward") is not
    applied in the UI.
11. **Deadlines are static timestamps** (lease expiry, voucher deadline) with no calm countdown, and
    estimated effort is not shown before task acceptance — both Prolific norms
    ([Prolific payment principles](https://www.prolific.com/prolific-vs-mturk)).

### 3.3 Owner workspace

12. **The `agents` tab stacks six independent panels** in one scroll (connection, approval inbox, feedback
    bonus inbox, evidence strip, registry, conditional editor — `AgentWorkspacePanels.tsx:119-153`) with no
    sub-navigation or breadcrumbs; deep states (editing one agent's policy) have only an in-component
    "Close".
13. **Every mutation is a full re-fetch** (`await load()` after approve/award; `router.push` reloads) — no
    optimistic updates, so the inbox feels synchronous. No keyboard navigation or batch actions anywhere;
    keyboard-first triage is the queue-UX bar ([GitHub PR inbox](https://devops.com/githubs-redesigned-pr-inbox-tackles-the-review-bottleneck-ai-created/),
    Linear Triage).
14. **`FeedbackBonusAwardInbox` returns `null` when empty** (`:182`) — an invisible feature; and loading
    states are inconsistent across panels (spinner in some, bare "Loading…" text in 47 places, zero
    skeletons).
15. Dashboard tiles show counts more than rates/trends; adaptive-coverage changes are plotted but not
    explained inline ("coverage moved to 50% because …") — the anti-vanity tile pattern is value + target +
    sparkline + variance ([Grafana best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/)).

### 3.4 Design system and accessibility

16. **Contrast debt at scale:** secondary text uses `text-base-content/45` (148×), `/40` (15×), `/35`
    (12×), `/30`, `/25` on `#000`; the /45 tier sits at the AA borderline and everything below fails for
    small text ([WCAG 2.2](https://www.w3.org/TR/WCAG22/); APCA is stricter for dark pairs —
    [APCA](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)). The base surface is pure
    `#000`, which dark-theme guidance advises against (halation; elevation has nowhere to go)
    — though the elevated (`#121212`) and nested (`#1a1a1a`) tokens are right.
17. **Fragmentation:** two card systems (`surface-card` 78× vs `rateloop-surface-card` 17×), ~7 button
    idioms, three ad-hoc chip/badge styles, per-component duplicated `readJson`/USDC formatters, hand-inlined
    SVGs with no icon module.
18. **Focus and motion:** only 4 files use `focus-visible`; reduced-motion is honored for orb/orbit
    animations but not for hover transforms; no WCAG 2.2 target-size audit (24px minimum) has been done.
19. **No a11y tooling at all:** no `eslint-plugin-jsx-a11y`, no axe, and the component tests are
    source-string/SSR-regex assertions with no DOM interaction; `e2e/` is empty; components appear excluded
    from the default test script. Nothing here regresses loudly.

## 4. Improvement plan

Phased; each item is commit-sized with a stated acceptance check. The visual identity is untouched — these
are token values, copy, componentization, and flow mechanics.

### Phase U0 — quick wins (days)

1. `ui: raise secondary-text contrast tokens` — map `/25–/45` tiers onto two sanctioned tokens
   (`--rateloop-text-secondary` ≈ /70, `--rateloop-text-tertiary` ≈ /55, both AA-verified on `#0a0a0a`);
   lift the base surface from `#000` to `#0a0a0a` (imperceptible, preserves the black look, enables
   elevation). Acceptance: axe contrast scan clean on landing, both hubs, both reviewer flows.
2. `copy: action-value landing CTAs and title fix` — verb CTAs; de-duplicate `<title>`; add Evidence to the
   docs-index "Where to go next".
3. `copy: rename mechanism jargon in user surfaces` — "RBTS" → "Quality bonus", "Surprise" → "Insight
   bonus" (label only; docs keep formal names), `bps` chips → `%`, keep formal terms one disclosure layer
   down. Acceptance: no undefined acronym or `bps` string in any first-layer UI copy.
4. `landing: reorder mobile hero and add orb fallback` — headline before orb on mobile; static gradient-ring
   fallback if the animation fails to mount; verify scroll performance with the diagram in view.
5. `ui: give FeedbackBonusAwardInbox an empty state` and standardize "Loading…" lines onto the spinner
   pattern as an interim step (skeletons come in U1).
6. `landing: tease the product when signed out` — one screenshot/live-sample card on `/human` (example
   review question + pay range) and `/agents` (workspace summary strip) above the sign-in gate.

### Phase U1 — design-system consolidation (1–2 weeks)

7. `ui: extract shared primitives` — `Card` (absorbing both card systems), `Button`
   (primary/secondary/ghost/danger × sm/md), `Badge/Chip`, `AsyncSection` (loading skeleton + error banner +
   empty state in one wrapper), shared `readJson` and `formatUsdc` utilities. Migrate the six agents-tab
   panels first, then the reviewer flows. Acceptance: card/button/badge class counts collapse to the
   primitives; no duplicated fetch/format helpers in `components/tokenless`.
8. `a11y: adopt jsx-a11y and axe` — `eslint-plugin-jsx-a11y` in the flat config; a rendered-DOM axe pass
   (jsdom) for the five key surfaces; fix findings (focus-visible rings ≥3:1 everywhere, 24px target-size
   on icon buttons and chip checkboxes, complete reduced-motion coverage).
9. `ui: skeleton loaders via AsyncSection` across hubs; standardize success toasts on `role="status"`.
10. `test: make component tests run and interact` — include `components` in the default test script; convert
    the highest-value SSR-regex tests to jsdom + user-event interaction tests (approve flow, answer flow,
    wizard step navigation).

### Phase U2 — flow redesigns (2–4 weeks, sequenced with Codex's stream)

11. `review-ux: unify the reviewer shell` — one answering shell for private and public lanes (single case
    per screen, progress "case 3 of 8", keyboard: 1/2 select, Enter advance, R focuses rationale), lane
    differences reduced to a header block (privacy lease vs earnings). Acceptance: both lanes render through
    the shared shell; keyboard-only completion possible.
12. `review-ux: remove manual credentials` — `/human?assignment=` deep links prefill assignment ID and
    terms hash (invitation emails/links carry them); manual entry remains as fallback only.
13. `review-ux: draft persistence and calm deadlines` — local draft autosave (IndexedDB/localStorage, keyed
    by assignment), restore on reload; one persistent, truthful countdown chip per view (lease/voucher/
    response window), no red-flash urgency.
14. `review-ux: abstract the recovery secret` — auto-generate the reveal secret, store client-side keyed to
    the vote key, offer "Download backup" as the secondary path; relayer/commit status collapses to
    "Submitting… / Recorded" with technical detail behind a disclosure. (No protocol change — presentation
    only.)
15. `agents-ux: split the six-panel stack` — sub-tabs or anchored sections within the agents tab (Connect ·
    Inbox · Registry · Evidence), approval inbox gains j/k + approve/decline keys and optimistic updates
    with rollback on error; breadcrumb-style back affordance from the policy editor.
16. `dashboard-ux: explainable coverage tiles` — rate + trend sparkline + "why" annotation on every
    adaptive-coverage change, drawn from the stage-transition evidence that already exists.

### Phase U3 — verification infrastructure (parallel, ongoing)

17. `e2e: fill the empty e2e/ directory` — Playwright journeys for the five primary flows (setup wizard,
    configure review, answer public, answer private, approve + award), with axe assertions per page and a
    small visual-regression baseline of the landing and hubs. Wire into CI. Acceptance: the readiness
    register's e2e items reference these journeys.
18. `metrics: instrument activation` — time from workspace creation to first completed review round-trip
    (the "15-minute rule" activation event for dev tools —
    [daily.dev](https://business.daily.dev/resources/15-minute-rule-time-to-value-kpi-developer-growth/));
    surfaced only internally.

## 5. Sequencing and ownership notes

U0 is independent and safe now. U1.7 should land before Codex adds more panels (every new panel built on
the primitives is one fewer to migrate). U2.11–14 touch the reviewer flows Codex recently built — coordinate
so the shared shell lands after the current human-review stream stabilizes. U2.14 changes presentation only;
the commit–reveal protocol, vote keys, and recovery semantics stay exactly as specified. Nothing in this
plan alters contracts, settlement, or the trust model.

## 6. What was not reviewed

Authenticated flows were audited from code, not exercised live (no account was used); the wizard's live
feel, InfoPopover behavior, and the paid-eligibility overlay need a signed-in pass — ideally a moderated
session with one external reviewer and one workspace owner, which would also validate the U2 priorities.

## 7. Scoring checklist (for re-review)

The 20-criterion benchmark used for §1 (score 0–2 each; current ≈ 21/40): wizard step-map/labels ·
resumability/prefill · defaults-first · consent summary editability · ≤15-min activation · one-item-per-
screen reviewing · optional inline rationale · truthful calm deadlines · effort+pay before acceptance ·
all-context-on-screen · keyboard inbox · batch with pre-commit summary · explainable rate tiles · guided
empty states · layered evidence disclosure · in-product audit log · no wallet vocabulary in mainstream
paths · plain-language payment failures with fiat equivalents · dark-theme contrast/elevation · WCAG 2.2
spot-audit (targets, focus, obscuring, redundant entry).

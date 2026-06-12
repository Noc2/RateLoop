# Playwright E2E Improvement Plan — 2026-06

Plan for extending and hardening the Playwright suite (`packages/nextjs/e2e`),
produced from a multi-agent survey of the suite (infrastructure, helpers, all 43
specs, CI), a flow-by-flow map of the confidential-content and surprise-bonus
features, and research on current Playwright (v1.60) best practices. Priorities:
**(1) confidential/gated content, (2) surprise-weighted bounty, (3) general gap
closure, (4) suite infrastructure and health.**

## Why these priorities

The last three repo reviews found five HIGH-severity bugs in the gated-content
paths (public-leak windows, broken linkage, on-chain reverts) that shipped because
**zero e2e coverage exists for any confidential-content flow** — the only gated
test in the suite is a UI-toggle check in `form-validation.spec.ts:50-76`. The
fixes since landed with node-level tests only, and the unit tests mock all chain
reads (`__setConfidentialityOnchainGateForTests`), so the real wiring
(ProtocolConfig → ConfidentialityEscrow → RaterRegistry → attachment routes) has
never been exercised against a live stack. Similarly, the surprise-bonus e2e
(`correlation-bounty-payout.spec.ts`) settles a **3-voter round while
`surpriseMinReveals = 8`**, so every multiplier it asserts is the neutral 1.0× —
the mechanism that gives the feature its name is never actually tested end-to-end.

## Current state (one paragraph)

43 specs, single worker, `fullyParallel: false`, one shared Anvil chain + Ponder +
Postgres; chain time moves forward irreversibly (`evm_increaseTime`), encoded as a
project dependency chain (settlement → round-cancellation → content-dormancy). CI
runs a 7-suite matrix on every PR (smoke/api/app/responsive/a11y/lifecycle/keeper),
each booting the full stack (30-45 min lanes); browser-compat and mobile run weekly
only; `world-id-mock.spec.ts` is dead in CI. Wallets are injected via a
localhost-only localStorage bridge (`wallet-session.ts`); multi-actor is possible
via `browser.newContext()` + `setupWallet` and already used in ~6 specs. Helpers
are strong for settlement (direct unsigned txs, tlock commit retry, Ponder polling)
but `admin-helpers.ts` is a 2,300-line god module, there is exactly one fixture
(`connectedPage`), and `submitContentDirect` hardcodes
`PUBLIC_CONFIDENTIALITY_CONFIG` — **the harness cannot create gated content today**.

---

## Phase 1 — Confidential content (highest priority)

### 1.1 New helpers (prerequisite, `e2e/helpers/confidentiality.ts`)

| Helper | Purpose |
|---|---|
| `submitGatedQuestion(page, {description, images?, bondAsset, bondAmount})` | Ask-form variant: toggle "Private context" (`getByLabel("Private context")`), fill the now-required description, optionally set bond, submit, capture contentId, and **assert the attach call linked** (details route must be gated-404/200-for-owner, never publicly served). Extend `ask-form.ts` patterns. |
| `submitGatedQuestionDirect(config)` | `admin-helpers` variant of `submitContentDirect` accepting the confidentiality tuple `{gated, bondAsset, bondAmount, flags}` instead of the hardcoded public config — needed to seed gated content cheaply for viewer-side tests. |
| `acceptConfidentialityTerms(page)` | Click locked-card "Accept terms" → dialog "Accept with wallet" → wait for unlock. Plus an API-level variant (challenge → sign with viem account → POST `/api/confidentiality/terms`) returning the `rateloop_gated_context_read_session` cookie for request-context tests (reuse `cookies.ts`). |
| `postConfidentialityBond(page)` | Click `Post {asset} bond`, wait for gate unlock (the test-wallet bridge already works for `useConfidentialityBond`). |
| `fetchGatedAttachment(request, url, {address, cookie?})` | Direct GET asserting status + headers (`X-RateLoop-View-Token`, `Cache-Control: private, no-store`, watermark presence for images). |
| `ensureHumanCredential(page, account)` | Precondition guard. **Verify first**: whether deploy-seeded accounts already pass `resolveRater(...).hasActiveHumanCredential` on 31337; if not, reuse `installLocalE2EWorldIdMock` + the settings attestation flow (which currently only runs in the dead `world-id-mock` project). |
| `triggerDisclosureReconcile(request)` | POST `/api/confidentiality/disclosure/reconcile` with the bearer secret (add a `NOTIFICATION_DELIVERY_SECRET`-equivalent to the e2e env). |

### 1.2 New spec: `confidential-context.spec.ts` (project: `ci-app`/`chromium`)

Serial, two-actor (submitter = account #2 via `connectedPage`, viewer = fresh
context + `setupWallet(account #3)`, denier = account #4). Scenarios in priority
order — the first three directly re-test the paths where the review bugs lived:

1. **Gated browser submission and fail-closed serving (the pass-3/pass-5 HIGH
   path).** Submit gated question with image + description + 1-LREP bond via the
   real UI. Assert: feed shows the locked card; the `det_`/`att_` URLs are never
   publicly served — including **during the window between mining and the attach
   call** (fetch with no session must 404/401 with `private, no-store`, never the
   public immutable cache header); after attach completes, `contentId` is linked
   (details/image routes return 200 for the owner, not 404). This single test
   would have caught pass-4 finding 3 (on-chain revert), pass-5 finding 1
   (silent linkage failure), and the pass-2/3 leak windows.
2. **Denial matrix against real contracts.** For the same content, as account #4:
   no session cookie → 401; cookie but no terms → 403; terms but no human
   credential → 403; terms + credential but no bond → 403; after governance ban
   (`banIdentity` via DEPLOYER) → 403 "access revoked". This replaces the
   chain-mocked unit coverage with real ProtocolConfig/escrow/registry wiring.
3. **Full rater unlock happy path.** Viewer (account #3): locked card → accept
   terms (wallet signature) → "bond required" → approve + post bond → gated image
   renders watermarked (assert `X-RateLoop-View-Token` and watermark SVG), inline
   details visible → vote commit succeeds. This is the spec
   `docs/private-context-plan-2026-06.md:411-413` called for and was never written.
4. **Owner path**: submitter confirms wallet ("Confirm wallet" read-session),
   views own private context, still cannot vote on own question.
5. **Zero-bond gated question**: terms still required, no bond gate.
6. **Gated bundle rejection**: toast "Private context bundles are not supported
   yet" (client-side guard).

### 1.3 New spec: `confidential-disclosure.spec.ts` (project: `settlement`)

Needs settlement, so it lives in the lifecycle lane:

1. Submit one **`after_settlement`** question via the x402/agent API (the browser
   UI hardcodes `private_forever` — 7 occurrences in `ContentSubmissionSection.tsx`
   — so the API path is the only way; this also gives the agent/x402 gated
   prepare→confirm path its first e2e) and one **`private_forever`** via the
   browser. Vote, settle both (existing settlement helpers).
2. Assert the Ponder feed un-redacts the `after_settlement` text after settlement
   while `private_forever` stays redacted.
3. Run `triggerDisclosureReconcile`, then assert the **attachment routes** serve
   the `after_settlement` content publicly while `private_forever` remains gated.
   ⚠️ Research found a likely product gap here: Ponder flips
   `confidentialityPublishedAt` at settlement, but the Next.js
   `questionConfidentiality.publishedAt` only flips via the reconcile route,
   which **nothing in-repo calls** — this test will expose the divergence and
   should be written even if it initially fails (file the bug, don't soften the
   assertion).
4. Confirm-twice idempotence on the x402 confirm (covers the retryability fix).

### 1.4 Breach reporting + sanctions (extend `governance.spec.ts` or new spec)

Governance "Breaches" tab (never opened by any test today): submit a breach
report as a bonded viewer (requires the gated-context session from 1.1), assert
it lists; "open proposal prefilled" → GovernanceActionComposer shows the
"slash confidentiality bond" / "Ban breached identity" actions; after a
governance ban, the profile sanction badge ("Active sanction") renders on the
accused's public profile.

---

## Phase 2 — Surprise-weighted bounty

### 2.1 Make the existing e2e actually exercise the mechanism

`correlation-bounty-payout.spec.ts` currently proves the pipeline (keeper →
oracle → merkle proof → claim) but with flat weights. Changes:

1. **Promote the inline utilities to shared helpers** (`e2e/helpers/correlation.ts`):
   `settleRoundWithVotes(contentId, votes: {account, isUp, stake}[])`
   (generalizing the inline `settleThreeVoteRound`) and
   `startCorrelationSnapshotKeeper()`/`stopCorrelationSnapshotKeeper()`.
2. **Add a non-neutral round**: ≥8 voters (accounts #2-#10 suffice; deployer is
   #9 — verify allocation against the per-spec account-claim comments) with an
   engineered 7-up/1-down split. With a neutral 5,000-bps base rate, up-voters'
   agreement ≈ 8,571 bps → surprise ≈ 1.71×, baseWeight ≈ 13,571 vs the
   down-voter's floor 10,000. Since `surpriseMinReveals = 8` is hardcoded in the
   keeper (`correlation-artifact-builder.ts:269`), 8 real reveals are mandatory —
   budget fits the existing 420 s pattern.
3. **Assert the money, not just completion**: claim for one bonus voter and the
   floor voter; assert the **claim-amount ratio matches the
   `effectiveWeight` ratio** from the Ponder claim-candidates payload, and assert
   per-leaf `surpriseBps` by fetching the artifact data-URI from the oracle (the
   cheapest strong assertion, since keeper params are unoverridable).
4. **Base-rate continuity**: settle a skewed prior round first, then assert round
   N's `trailingBaseRateUpBps` reflects it (currently only mock-tested in
   route-validation tests).

### 2.2 Follow-on scenarios (separate tests, same spec/file family)

- **UI claim with payout proof**: today claims are tested via direct
  `writeContract` only. Drive `ClaimRewardsButton`/ProfileEarnings through
  `claimableQuestionRewardWithPayoutWeight` in the browser — no e2e anywhere
  clicks a claim button (grep: 0 hits).
- **Challenge flow**: challenged snapshot → rejected → re-proposed → claim still
  correct. The spec currently asserts *not challenged* and never tests the path.
- **Edge rounds**: unanimous round with ≥8 reveals (flat shares despite
  eligibility); verify tied/cancelled rounds are excluded from the base-rate
  window (extend `tied-round.spec.ts` with a correlation assertion).
- **Docs rendering**: in `docs-pages.spec.ts`, assert the
  `SurpriseMultiplierChart` SVG renders (it has a stable `role="img"` +
  aria-label) and the 15 / 7.50 / 7.50 USDC worked example appears on
  `/docs/how-it-works`.

---

## Phase 3 — General coverage gaps (ranked)

From the route-inventory vs spec-coverage diff. Each item names the missing level
— several flows have contract-level tests but no UI behavioral test, which is
exactly where recent bugs hid (the sponsored-eligibility and gated-linkage bugs
were UI/server-path bugs invisible to contract tests).

1. **Sponsored frontend registration** (reviewed bug area, pass-5 finding 7):
   `frontend-lifecycle.spec.ts` registers via raw tx, bypassing
   `FrontendRegistration.tsx` entirely. Add UI registration in both
   `sponsorshipMode` branches ("sponsored" via the unmetered path and
   "self-funded" fallback), plus the bundler-failure fallback toast.
2. **Content feedback**: `ContentFeedbackPanel` + `/api/feedback`
   challenge/post/counts with the new deployment scoping — zero coverage, recent
   churn, and `submit.spec.ts:86-92` deliberately skips the feedback-bonus step.
   Behavioral test: post feedback as a rater, assert counts, assert a banned
   identity is rejected (`43ac45a2` ban checks).
3. **Agent handoff + browser signing**: `/agent/handoff/[handoffId]` and
   `/agent/sign/[intentId]` are paid flows with zero e2e (the entire
   `/api/agent/*` surface is untested). Minimum: create a handoff via the API,
   complete it in the browser (including the private-context control added in
   `6cb5d874`), assert the prepared ask matches.
4. **Legacy claim**: `/claim/legacy` + `/api/legacy-claim/[address]` — real-money
   claim, zero coverage, and recent fixes (`c0bd2f8c` reconnect loop, `6b2e610a`
   sender guard) shipped untested.
5. **Reward claim via UI** (overlaps 2.2): the flat-reward claim should also go
   through the button at least once.
6. **Governance proposal lifecycle via UI**: composer → create → vote → execute;
   today only tab-visibility smoke.
7. **Re-enable World ID in CI**: `world-id-mock.spec.ts` has a project and a
   local script but no CI suite runs it. Add it to the `ci-app` ignored-list
   exception or its own small lane; the settings `WorldIdVerificationCard` UI is
   also untested. (Phase 1's `ensureHumanCredential` depends on this
   infrastructure being alive.)
8. **USDC funding modals** (FundQuestionModal/FundFeedbackBonusModal/
   AwardFeedbackBonusModal) and **watchlist UI** (API tests are thorough; no UI
   add/remove).
9. **Email verify/deliver/unsubscribe** routes (API-level test; redaction itself
   is adequately unit-tested).
10. **PromoVideo click-to-play** smoke (new landing-page component).

---

## Phase 4 — Infrastructure and suite health

Changes that make Phases 1-3 cheaper and the suite trustworthy. Ordered by
leverage; none block the coverage work.

### 4.1 Fixtures over god-module (incremental)

- Add `fixtures/actors.ts`: worker-scoped `submitter`/`viewer`/`admin` page
  fixtures composed with `mergeTests()` — two-actor tests are the norm for gated
  content, and today every spec hand-rolls `newE2EContext` + `setupWallet`.
  Account allocation stays per-spec (the existing header-comment convention), but
  the fixture should **assert** its claimed account is funded to fail fast.
- New helpers go in domain modules (`confidentiality.ts`, `correlation.ts`), not
  `admin-helpers.ts` (2,300 lines and growing). Carve existing groups out of
  admin-helpers opportunistically when a spec touches them — no big-bang refactor.

### 4.2 Suite-health policy

- **Kill conditional assertions and silent runtime skips**: `negative-cases`
  (8 try/catch, 4 conditional asserts), `accessibility.spec` (4 "did not
  stabilize → skip"), `category-lifecycle:50` ("Ponder not indexing — on-chain
  add succeeded" skip masks indexer regressions — this exact fail-open pattern in
  *production* code was a pass-3 finding; tests should not replicate it). Replace
  with `expect.poll`/`toPass` with explicit timeouts. The `no-unexpected-skips`
  reporter exists; audit its allowlist so these stop slipping through.
- **Flake policy**: adopt `failOnFlakyTests` on the PR-blocking lanes (retried-
  then-passed currently absorbs flakes silently with `retries: 1`), tag known
  flaky tests `@flaky` (structured tag syntax), run them in a non-blocking job,
  fix-or-delete within two sprints.
- Remove the 4 remaining fixed waits (`submit.spec.ts:49`, `vote.spec.ts:30`,
  `category-filter.spec.ts:60`, `negative-cases.spec.ts:80`).

### 4.3 CI efficiency (medium-term)

- **Setup project instead of `globalSetup`**: move service-wait + db:push +
  baseline-seed into a Playwright `setup` project (gets traces, reporter
  visibility, and fixtures — `preflight.mjs` already half-duplicates this).
- **Share the Next.js build across matrix lanes**: each of the 7 lanes rebuilds
  Next.js and redeploys from genesis; build once, upload as artifact, restore in
  lanes. Biggest single wall-clock win available.
- **Promote mobile/compat from weekly to per-PR smoke subset**: a 2-3 spec
  `@smoke`-tagged subset on webkit + mobile-chromium catches the regressions that
  currently sit on main for up to a week.
- Pin Playwright ≥1.57 deliberately (Chrome-for-Testing switch invalidates any
  screenshot baselines) before introducing `toHaveScreenshot` anywhere.

### 4.4 Explicitly deferred (evaluated, not worth it now)

- **Per-worker Anvil + `evm_snapshot`/`evm_revert` isolation**: the
  recommended end-state for parallelism, but Ponder cannot tolerate block-height
  rewinds without a reset, the tlock/drand commit math depends on forward-moving
  timestamps, and the suite's serial design is load-bearing (irreversible
  `evm_increaseTime` ordering). Revisit only if suite wall-time becomes the
  bottleneck after 4.3; if attempted, remember anvil's `evm_revert` consumes the
  snapshot (re-take after every revert) and the indexer needs a per-worker reset
  strategy.
- **Playwright component testing**: still experimental; keep component-level
  tests in Vitest/RTL.
- **Visual regression**: defer until after the 1.57+ pin; then only in-container
  baselines with masked dynamic content.

---

## Sequencing and effort

| Step | Contents | Est. effort | CI lane |
|---|---|---|---|
| 1 | Helpers 1.1 + `confidential-context.spec.ts` scenarios 1-3 | 3-4 days | ci-app |
| 2 | Scenarios 4-6 + breach/sanctions (1.4) | 1-2 days | ci-app |
| 3 | `confidential-disclosure.spec.ts` (1.3) | 1-2 days (may surface a product bug) | lifecycle |
| 4 | Surprise bonus 2.1 (helpers + non-neutral round + money assertions) | 2-3 days | lifecycle |
| 5 | Surprise follow-ons 2.2 + docs assertions | 1-2 days | lifecycle / smoke |
| 6 | Gaps 3.1-3.4 (sponsored registration, feedback, handoff, legacy claim) | 3-4 days | ci-app |
| 7 | Gaps 3.5-3.10 + World ID CI revival | 2-3 days | mixed |
| 8 | Suite health 4.2 (skips/flakes/waits) | 1-2 days | — |
| 9 | CI efficiency 4.3 | 2-3 days | — |

Steps 1-3 are the payoff-critical path and should land first; everything else can
interleave with feature work. Total ≈ 3-4 engineer-weeks.

## Acceptance criteria

- Every flow in the Phase-1 coverage matrix moves from "none" to behavioral e2e;
  a reintroduction of any of the five reviewed gated-content bugs fails CI.
- The surprise-bonus e2e asserts at least one non-neutral multiplier
  end-to-end (artifact `surpriseBps` ≠ 10,000 and claim-amount ratio check).
- No conditional assertions or unexplained runtime skips in PR-blocking lanes;
  `failOnFlakyTests` enabled on smoke/api/app.
- Claim, registration, and feedback flows each have at least one test that goes
  through the real UI (not direct contract calls).

## Open questions to resolve while implementing

1. Do deploy-seeded accounts (#2-#10) already hold an active human credential on
   31337, or must Phase-1 tests attest one via the World ID mock? (Determines
   whether `ensureHumanCredential` is a check or a flow.)
2. Is the Next.js/Ponder `publishedAt` divergence (1.3) intended, with an
   external cron calling the reconcile route in production? If so, the e2e env
   should emulate that cron; if not, it's a bug to file.
3. Should the keeper's hardcoded `defaultCorrelationScoringParams()` get an env
   override (e.g. `surpriseMinReveals`) to make smaller surprise tests possible?
   Recommended: no for correctness (test the real threshold), but worth it if the
   8-reveal round proves flaky in CI.

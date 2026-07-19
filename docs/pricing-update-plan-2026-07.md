# Pricing update plan — fee to 10%, tier ladder, anchors (July 2026)

Decision input: [`pricing research memo, 2026-07-19`] — benchmarks across AI-compliance platforms ($6k–$30k/yr mid-market), LLM-eval tooling ($25–$50/mo entry tiers), and human-work marketplaces (Prolific 42.8% corporate take, MTurk 20–40%, Fiverr ~32%, Upwork ~18.5%).

## Decisions proposed

1. **Execution fee: 7.5% → 10% (750 → 1,000 bps).** One clean number, the Gurley/oDesk precedent exactly, still 2–4x below every published human-work platform take. Prefer 10% over 9%: a single-digit-vs-two-digit distinction buyers don't feel, but 9% forfeits ~10% of fee revenue and reads as fiddly; 10% pairs with the strongest possible reviewer-side message, "reviewers keep 90%." Raise it now, in early access, before any paid customer has anchored on 7.5% — quotes pin `feeBps` at quote time, so the change is forward-only with no retroactive effect.
2. **Narrative: stablecoin settlement funds the low take.** Legacy platforms lose several percent to card processing, payout-provider fees, FX, and cross-border transfers, and price their 20–40% takes accordingly; RateLoop settles USDC on Base for cents with sponsored gas, and the fee is visible on-chain rather than buried. Framing rule: claim *our* settlement costs are near zero and passed on — do not quantify competitors' internal costs (most of a 40% take is ops/margin, not payment rails, and the claims rule below applies).
3. **Tier ladder.** Free ($0, 25 decisions) → **Early Access $29/mo for the first 12 months, then $99 list** (250 decisions, 3 agents, 5 groups, paid panels) → **Team $149/mo** (1,000 decisions, 10 agents, 20 private groups, evidence exports, priority support) → **Enterprise — contact us** (row only: SSO, DPA, custom retention, audit support, volume fees). The $99 anchor already exists in the codebase as `LEGACY_EARLY_ACCESS_PRICE_VERSION` — restate it as the post-period list price rather than inventing a new number.
4. **Naming guardrail: the $149 tier is "Team", not "Compliance/Enterprise".** Research shows compliance-anchored buyers expect $1k+/mo and read $149 as a tool price, so a compliance label at $149 under-positions the evidence story; and the house rule (AGENTS.md) forbids customer-facing compliance claims beyond the deployed system. Ship the features the tier actually has today (capacity, evidence exports, priority support); introduce a genuinely priced Assurance/Enterprise tier post-mainnet when SSO/DPA/audit-support exist.

## Phase 1 — fee + ladder + copy (config-level, no contract changes)

The on-chain ceiling `MAX_FEE_BPS = 2_000` (`packages/foundry/contracts/tokenless/TokenlessPanel.sol:19`) and the SDK bound (`packages/sdk/src/tokenless.ts:200`, ≤2,000) both already admit 1,000 bps. No redeploy, no SDK change.

1. `packages/nextjs/lib/tokenless/humanReviewRequestPreparation.ts:20` — `HUMAN_REVIEW_PLATFORM_FEE_BPS = 1_000`. Sweep tests asserting 750/7.5% fee math.
2. `packages/nextjs/lib/billing/plans.ts` — add `team` plan (`monthlyPriceCents: 14_900`, `decisionsPerPeriod: 1_000`, `activeAgents: 10`, `activePrivateGroups: 20`, `paidPanels: true`, new price version `team_usd_149_2026_07`); keep `early_access` at 2_900 and add a `listPriceCents: 9_900` (or equivalent display field) so the UI can render "then $99".
3. `packages/nextjs/lib/billing/stripe.ts` + env — generalize the single-price validation (`isExpectedEarlyAccessStripePrice`, `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID`) to per-plan price IDs; create the $149 recurring price in Stripe (dashboard step, David); checkout idempotency keys already include the price version.
4. `packages/nextjs/lib/billing/entitlements.ts` / `workspaceBilling.ts` — already generic over the plan object; verify limits flow through for `team` and add coverage.
5. `components/pricing/WorkspacePlanCards.tsx` + `app/(public)/pricing/page.tsx` — four columns (Free / Early Access with "$29 for your first 12 months, then $99" + list-price strikethrough / Team / Enterprise contact row). Fold in the UX-review copy fixes while touching the page: plain definition of a decision ("one piece of work that receives a final human verdict; drafts and cancelled cases don't count"), fee paragraph rewritten (draft below), fee-term taxonomy (bounty/attempt reserve) into an `InfoPopover`.
6. Copy sweep for the fee and the story — `app/(public)/pricing/page.tsx:55` ("capped at 7.5%" → 10% + narrative), plus any mentions in `public/docs/*.md`, `/docs/how-it-works`, landing FAQ, and the rater-side surfaces (add "reviewers keep 90% of every bounty — settlement runs on stablecoin rails that cost cents, not card fees" where reviewer pay is explained). Update `siteSearch` keywords if entries change.
7. Tests: plans/entitlements/stripe unit tests, pricing page render test, quote-preparation fee tests, e2e fixtures embedding 750 bps.

Draft fee paragraph for `/pricing`:
> "Paying reviewers costs extra, and you see the exact all-in price before you approve anything. Reviewers keep 90% of every bounty — RateLoop's execution fee is capped at 10%. We can keep it that low because settlement runs on stablecoin rails that cost cents; comparable platforms charge 20–40%."

## Phase 2 — expansion path (engineering)

Decision top-up packs past the plan allowance: explicit opt-in purchase (fits the existing "no automatic overage charges" promise — keep that sentence, it tested well), e.g. +100 decisions for $15 as a Stripe one-off; entitlement accounting extends `decisionsPerPeriod` for the period. Alternative: metered overage behind an explicit arm/disarm toggle. Packs are simpler and preserve the trust posture; recommend packs first.

## Phase 3 — Assurance/Enterprise tier (post-mainnet)

Custom-priced (anchor $1k+/mo per the research): SSO, DPA, custom data retention, audit-support SLA, volume fee schedule, the Article 14 oversight evidence pack as a first-class deliverable. Blocked on: production settlement, the features themselves, and the claims rule. Until then the Enterprise column is a contact row with no feature promises.

## Rollout order and guardrails

- Fee change and tier ladder land together in one release so the story ("10%, reviewers keep 90%, here's why") ships with the number, not after it.
- Forward-only: existing quotes/asks keep their pinned 750 bps; no migration.
- Verify no readiness script or e2e fixture hardcodes 750 outside the constant before merging.
- Per the tokenless guard: app + Stripe env changes only; nothing here touches fund-core contracts or requires artifact redeploy.

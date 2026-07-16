# Remaining enterprise-analysis improvements — AI implementation plan (July 2026)

**Status:** implementation plan for the issues in the
[enterprise analysis](tokenless-enterprise-analysis-2026-07.md) that a coding agent can deliver in this
repository — code, schema, docs, and tests on the `tokenless` branch. Recommendation R1 already has its own
plan ([assurance-evidence plan](tokenless-assurance-evidence-plan-2026-07.md)); this document covers the
rest. The [design of record](tokenless-immutable-implementation-plan-2026-07.md) and
[production-readiness register](tokenless-production-readiness-2026-07.md) control decisions and release
gates. Repository facts below were re-verified on this branch on 2026-07-16; several items the analysis
flagged have since landed and are marked done.

**In scope (AI-implementable):** drift reconciliation (R9); the gold-standard quality leg and
mechanism-health metrics (R3, R10); the fiat prepaid wrapper (R4); enterprise SSO/SCIM (the code slice of
R5); approval-primitive integration adapters (R6); reviewer expertise qualifications (the implementable
slice of R2).

**Out of scope (human/business):** the SOC 2 / ISO audits themselves, external contract and privacy review,
GTM execution (R7, R8), legal/tax advice, mainnet deployment approval, and pricing decisions. Items needing
a one-line owner decision before code can proceed are collected in §8.

## 1. Already resolved since the analysis (no work needed)

- **Deployment identity carries the Feedback Bonus.** The key is now 5-slot `tokenless-v4`
  (`chain/config.ts:69`, `tokenlessDeployment.js:5`), and `tokenless-environment-parity.md` documents it.
- **A prepaid funding path exists end-to-end on the panel side**: `TokenlessPanel.createRoundFor`
  (`TokenlessPanel.sol:244`), `paymentMode: "wallet" | "x402" | "prepaid"` (`chain/payments.ts:66`),
  a prepaid funder signer, and `tokenless_prepaid_reservations` / `tokenless_prepaid_ledger_entries` with
  reserve/consume logic. R4 therefore reduces to fiat *top-up* of an existing ledger (§4).
- **The owner-approval and host-enforcement primitives exist**: `check_only | prepare_for_approval |
  ask_automatically` authority, the handoff MCP server, the host output-gate CLI
  (`packages/agents/host-gate/`), and Codex plugin lifecycle hooks (`plugins/rateloop-workspace/hooks/`).
  R6 reduces to adapters for non-Codex frameworks (§6).
- **Qualification machinery exists** (`tokenless_reviewer_qualifications`, `qualification_keys_json`,
  cohort qualification rules); what is missing is an expertise vocabulary and verification flow on top (§7).

## 2. W1 — Drift reconciliation (R9) — small, do first

Precise stale spots, re-verified:

| Location | Says | Reality | Fix |
| --- | --- | --- | --- |
| implementation plan `:69` | "two 15-case windows with at least 14 comparable agreements" | Wilson lower bound ≥ `DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS` (7,000) over ≥15-case windows, plus completion/latency/drift/severe-disagreement gates, ≥30 completed cases (`adaptiveReview.ts:66-117`) | Rewrite the narrative to describe the Wilson gate; keep 15/30/50/100 case counts |
| implementation plan `:34,:221` | migration head `0053` | `0070_feedback_bonus_awarder_wallet` | Update, and change the phrasing to "the journal head at the time of writing" or reference `_journal.json` to stop this class of drift |
| readiness register `:14,:64` | head `0051` | `0070` | Same |
| environment parity `:88` | head `0068` | `0070` | Same |
| implementation plan `:35-38` | `tokenless-v3` 4-slot key example | `tokenless-v4` 5-slot incl. feedback bonus | Update the example block |
| CLAUDE.md vs design of record | CLAUDE.md: "Base Account is the active browser wallet stack; do not restore thirdweb". Code/docs: thirdweb optional wallet provisioning is implemented (`thirdwebWalletJwt.ts`, `TOKENLESS_THIRDWEB_WALLET_*`), and a test asserts no in-browser wallet connector mounts (`browserAuthIsolation.test.ts:10`) | Contradiction is real | **Decision required (§8)**; then record the decision in the design of record and align CLAUDE.md, env, and code |

Commits: `docs: reconcile adaptive gate narrative with implementation` · `docs: update migration heads and
deployment key examples` · (post-decision) `docs: record wallet-stack decision`. Each with a doc-lint or
grep-based regression test where practical (e.g. a test asserting the parity doc's key version equals
`TOKENLESS_DEPLOYMENT_KEY_VERSION`).

## 3. W2 — Gold-standard quality leg and mechanism health (R3, R10)

**Why:** the literature is unambiguous that sparse ground truth dominates pure peer prediction
(Gao/Wright/Leyton-Brown 2016), the one controlled experiment saw collusion, and crisply binary criteria
drive near-unanimous rounds where the RBTS bonus stops discriminating (enterprise analysis, weakness 4).

**Hard constraint:** the fund core is immutable — on-chain payouts (80% base + RBTS bonus) must not change.
Gold items therefore operate entirely off-chain: they influence **admission, qualification, reputation, and
adaptive evidence**, never settlement. This respects the invariant that no off-chain signal can alter earned
pay after commit acceptance.

Implementation steps (each one commit with tests):

1. `docs: specify gold-item semantics` — new spec: gold items are known-answer cases seeded by the workspace
   owner (from adjudicated past reviews) or by the platform (synthetic, public-safe); injected into panels at
   a bounded, undisclosed rate; a gold response never pays differently (same seat economics), and gold status
   is revealed only in aggregate. Define the reviewer-facing disclosure ("panels may include
   calibration items") and the abuse cases (gold-item leakage, owner mislabeling).
2. `db: add gold items and gold outcomes` — tables for gold cases (content commitment, expected answer,
   provenance, active flag) and per-reviewer gold outcomes keyed by pseudonymous vote key lineage.
3. `review: inject gold items into panel composition` — deterministic, seeded injection in the lane adapters
   (public first; invited optional per owner), excluded from adaptive-evidence observations and from customer
   verdict aggregation, included in round size/economics quotes transparently.
4. `review: score gold outcomes into reviewer qualification` — gold accuracy feeds
   `tokenless_reviewer_qualifications` (new `qualification_kind`), gating network admission and cohort
   eligibility. No effect on any open round.
5. `review: add mechanism-health metrics` — per-scope unanimity rate, RBTS bonus variance, gold failure
   rate, comparable-case drift; persisted alongside adaptive evidence and exposed on the workspace evaluation
   dashboard and (later) the assurance metrics endpoint (assurance plan E2.7).
6. `setup-ui: present bounty guidance in effective-hourly terms` — quote panel bounties with an estimated
   per-reviewer effective hourly rate derived from the response window and expected effort, alongside the
   existing per-seat math (piece-rate pay is the known quality anti-pattern; guidance only, no economics
   change).
7. `docs: extend limitations with gold-item scope` — R10 candor: what gold does and does not prove.

Dependency: none on unfinished lanes for the invited path; public-lane injection ships behind the same
readiness gate as public paid panels.

## 4. W3 — Fiat prepaid wrapper (R4)

**Why:** enterprises cannot put "buy USDC" through procurement; review spend must be invoiceable. The
missing piece is only the fiat top-up bridge into the existing prepaid ledger.

**Design (researched against current Stripe docs):** use **Stripe Invoicing funding invoices**, not Stripe
Billing credit grants — grants only apply to metered subscription line items, and RateLoop's drawdown is its
own internal ledger. Flow: workspace owner requests a top-up → RateLoop issues a Stripe invoice
(`collection_method=send_invoice`, `days_until_due=30`, bank-transfer payment method enabled — SEPA virtual
account in the EU) with Stripe Tax (German VAT / EU reverse charge via validated `tax_ids`) → on
`invoice.paid`, an idempotent webhook credits `tokenless_prepaid_ledger_entries` → existing
`paymentMode:"prepaid"` funds rounds via `createRoundFor`; receipts continue to itemize bounty / platform
fee / VAT per the legal reference.

Steps:

1. `db: add prepaid top-up intents` — intent row linking workspace, amount, Stripe invoice id, state
   (`draft/sent/paid/credited/failed`), idempotency key.
2. `billing: issue prepaid funding invoices` — extend `lib/billing/` (Stripe client exists) with invoice
   creation + Stripe Tax; gate behind `TOKENLESS_SUBSCRIPTIONS_ENABLED`-style flag
   (`TOKENLESS_PREPAID_TOPUP_ENABLED`, default false) and complete-config fail-closed checks like the
   existing subscription gating.
3. `billing: credit ledger on invoice payment` — webhook extension (`invoice.paid`, `invoice.voided`,
   over/underpayment handling per Stripe cash-balance reconciliation caveats), exactly-once crediting with
   reconciliation job.
4. `billing-ui: add workspace top-up and balance panel` — balance, reservations, ledger history, invoice
   download; surface the existing `insufficient_prepaid_balance` error path with a top-up call to action.
5. `audit: record top-up lifecycle` — audit-chain events for request/issue/paid/credited (feeds the
   assurance-evidence exports).
6. `docs: document fiat review funding` — including the German B2B e-invoicing caveat: Stripe emits PDF
   invoices; XRechnung/ZUGFeRD issuance (mandatory for domestic German B2B from 2027/2028) requires a Stripe
   marketplace partner — flagged as a decision (§8), not implemented now.

Dependency: real-money invoicing waits on the register's billing/legal gates; everything above ships and is
exercisable in staging with Stripe test mode.

## 5. W4 — Enterprise SSO and SCIM (R5 code slice)

**Why:** hard procurement checkbox. **Researched fit:** Better Auth — already the auth layer
(`lib/auth/betterAuth.ts`: email OTP, passkeys, gated Google/Apple) — now ships first-party MIT plugins:
`@better-auth/sso` (generic OIDC + SAML 2.0 SP/IdP-initiated, DNS-TXT domain verification, organization
auto-provisioning) and `@better-auth/scim` (SCIM 2.0, **/Users only — no /Groups yet**). This keeps SSO
in-process with no new vendor; if a customer needs SCIM Groups or an exotic IdP, front it with self-hosted
Ory Polis (ex-BoxyHQ SAML Jackson, Apache 2.0) consumed as a generic OIDC provider — documented as the
fallback, not implemented now.

Steps:

1. `auth: add SSO plugin with domain verification` — `@better-auth/sso`, provider registration restricted to
   workspace owners/admins, DNS TXT domain proof required, no default providers.
2. `auth: map SSO provisioning to workspace roles` — `organizationProvisioning` onto the existing
   `owner/admin/member/billing` model (`workspaceGovernance.ts:10,31`); provisioned users land as `member`
   unless mapped; role changes remain workspace-side.
3. `auth: enforce SSO-only sign-in per verified domain` — the documented Better Auth pattern (block
   OTP/social for domains with an enforced provider); workspace setting, default off.
4. `auth: add SCIM user provisioning` — `@better-auth/scim` with provider-scoped tokens;
   deactivation honored via the admin plugin; document the Users-only limitation truthfully (no "SCIM
   group sync" claim).
5. `settings-ui: add identity provider management` — provider CRUD, domain verification status, SCIM token
   management, last-sync surface; audit-chain events for every identity-admin action.
6. `e2e: cover SSO and SCIM journeys` — mock IdP (samlify test fixtures / OIDC test provider), provisioning,
   enforcement, deprovisioning.

Constraint honored: sessions stay short-lived and hashed; a client-reported IdP assertion is authentication,
never workspace authorization (roles remain RateLoop-side) — consistent with the identity section of the
design of record. Marketing continues to follow the readiness register (no "enterprise SSO" claim until the
journeys pass in staging).

## 6. W5 — Approval-primitive integration adapters (R6)

**Why:** the synchronous approval slot is commoditized; RateLoop should snap into whatever gate primitive
the customer's framework already has and own the sampled-assurance layer behind it. Everything RateLoop-side
exists (authority levels, durable pending, host gate, hooks); what is missing is the adapter surface for
non-Codex hosts.

Steps (new `packages/agents/integrations/` or per-adapter subpackages, each with contract tests against the
existing MCP/SDK):

1. `agents: add framework adapter core` — a small TypeScript core wrapping the SDK flow
   (`evaluate → prepare/request → durable pending → result`) with the exact non-blocking semantics the state
   machine defines (never hold a tool call open for the response window).
2. `agents: add LangGraph interrupt adapter` — a node/wrapper that calls `evaluate_review_requirement`,
   raises `interrupt()` for `approval_required`, and resumes from the durable pending id; Python or JS per
   LangGraph's supported runtimes (JS first — matches the repo).
3. `agents: add OpenAI Agents interruption adapter` — same pattern over `needs_approval`/interruptions.
4. `agents: add Claude Code hook adapter` — PermissionRequest/Stop-hook variant of the existing Codex hooks
   (the plugin layout under `plugins/` already anticipates multiple hosts).
5. `mcp: support elicitation for owner-present approvals` — where the MCP host supports elicitation
   (spec ≥ June 2025), offer the approval confirmation in-session instead of only the browser handoff;
   capability-gated, advisory labeling rules unchanged.
6. `webhooks: emit review lifecycle events` — CloudEvents envelope (`ai.rateloop.review.*`) shared with the
   assurance plan's E2.8 (build once, consumed by both plans).
7. `docs: document framework integrations` — per-adapter quickstarts in the machine docs
   (`public/docs/`), each stating the advisory-vs-host-enforced status truthfully.

Dependency: none chain-side. Adapters are pure consumers of the existing API/MCP; they ship as soon as the
in-flight human-review lifecycle work (durable pending, unified envelopes — already committed) is exercised.

## 7. W6 — Reviewer expertise qualifications (R2 slice)

**Why:** the enterprise-credible reviewer pool is the wedge; the buyers' market pays a large premium for
vetted expertise, and the anonymous pool is the least sellable asset. The DB already models qualifications
(`qualification_kind`, `qualification_keys_json`, cohort rules, expiry, provenance) — what is missing is an
expertise vocabulary, a verification flow, and surfacing.

Steps:

1. `docs: specify expertise qualification semantics` — a small controlled vocabulary of expertise keys
   (e.g. `code-review:typescript`, `finance:broker-dealer-supervision`), evidence kinds
   (owner-attested for invited cohorts; platform-verified credential for network raters; gold-derived
   from W2), expiry and revocation; explicitly not a public reviewer profile (privacy model unchanged).
2. `db: extend qualifications with expertise keys and evidence kind` — on the existing tables; no new
   identity surface.
3. `review: enforce expertise requirements in audience policies` — `required_qualifications_json` already
   exists; wire owner-selected expertise keys through setup → profile hash → assignment eligibility, with
   the fail-closed rule (no eligible reviewers → `blocked`/`approval_required`, never silent downgrade).
4. `setup-ui: add expertise requirements to audience configuration` — with live eligible-pool counts so
   owners see feasibility before funding.
5. `evidence: include qualification-tier counts in packets` — the aggregate (k-anonymized) tier mix per
   round; this is assurance plan E1.1's "reviewer qualification reference" — build once.
6. `admin: add platform credential-verification queue` — a minimal operator workflow for verifying network
   raters' expertise evidence, with audit events; disclosed as an operator authority in the trust section
   (admission-only, consistent with the credential-issuer disclosure).

Dependency: paid-network expertise verification matters only once network panels are enabled; the invited
(owner-attested) path has no gate and ships first.

## 8. Decisions required before the affected commits (one line each)

1. **Wallet stack (W1):** keep optional thirdweb wallet provisioning as designed, or replace with Base
   Account — CLAUDE.md and the design of record currently contradict each other; code follows the design of
   record today.
2. **Gold seeding default (W2):** owner-seeded only at launch, or platform-synthetic gold in the public
   lane from day one.
3. **German e-invoicing partner (W3):** which Stripe marketplace partner (e.g. Billit) for
   XRechnung/ZUGFeRD when domestic German B2B invoicing starts, or defer until a German customer requires it.
4. **SSO fallback (W4):** whether to pre-approve self-hosted Ory Polis as the exotic-IdP/SCIM-Groups
   fallback or wait for demand.

## 9. Sequencing

| Order | Workstream | Gate |
| --- | --- | --- |
| 1 | W1 drift fixes | none — immediate |
| 2 | W5 adapters + W2 steps 1–2, 5–7 (specs, schema, health metrics, UI guidance) | in-flight human-review commits merged (done) |
| 3 | W3 fiat top-up (staging/test mode) · W6 steps 1–5 (invited path) | Stripe test config; setup flow stable |
| 4 | W4 SSO/SCIM | staging exercise before any marketing claim |
| 5 | W2 steps 3–4 (gold injection/scoring, public lane) · W6 step 6 | public-network readiness gate |
| 6 | Real-money invoicing, paid-network expertise | register's billing/legal/paid-settlement gates |

Every workstream follows the standing rules: no fund-core change without a fresh coordinated deployment (none
is needed here — all six are off-chain); the tokenless/`main` isolation rules; proportionate tests per
commit; and the claims-match rule — no website or docs claim ships before the capability is exercised.

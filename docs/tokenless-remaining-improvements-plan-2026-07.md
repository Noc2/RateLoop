# Remaining enterprise-analysis improvements — implementation record (July 2026)

**Status:** every AI-implementable numbered step in this record is implemented and tested on the `tokenless`
branch. External release work remains gated: Stripe test/live configuration, a live customer IdP staging
exercise, structured German e-invoice provider selection when required, legal/tax review, and the paid-network
readiness gates. This record covers the issues in the
[enterprise analysis](tokenless-enterprise-analysis-2026-07.md) that can be delivered in this repository.
Recommendation R1 already has its own
plan ([assurance-evidence plan](tokenless-assurance-evidence-plan-2026-07.md)); this document covers the
rest. The [design of record](tokenless-immutable-implementation-plan-2026-07.md) and
[production-readiness register](tokenless-production-readiness-2026-07.md) control decisions and release
gates. Repository facts below were re-verified on this branch on 2026-07-16; several items the analysis
flagged have since landed and are marked done. W1 and W5 were re-audited against the repository and the primary
LangGraph, OpenAI Agents SDK, Claude Code, and stable MCP 2025-06-18 documentation on 2026-07-17.

**In scope (AI-implementable):** drift reconciliation (R9); the gold-standard quality leg and
mechanism-health metrics (R3, R10); the fiat prepaid wrapper (R4); enterprise SSO/SCIM (the code slice of
R5); approval-primitive integration adapters (R6); reviewer expertise qualifications (the implementable
slice of R2).

**Out of scope (human/business):** the SOC 2 / ISO audits themselves, external contract and privacy review,
GTM execution (R7, R8), legal/tax advice, mainnet deployment approval, and pricing decisions. Product decisions
used for this implementation are recorded in §8.

## 1. Already resolved since the analysis (no work needed)

- **Deployment identity carries the Feedback Bonus.** The key is now 5-slot `tokenless-v4`
  (`chain/config.ts:69`, `tokenlessDeployment.js:5`), and `tokenless-environment-parity.md` documents it.
- **A prepaid funding path exists end-to-end on the panel side**: `TokenlessPanel.createRoundFor`
  (`TokenlessPanel.sol:244`), `paymentMode: "wallet" | "x402" | "prepaid"` (`chain/payments.ts:66`),
  a prepaid funder signer, and `tokenless_prepaid_reservations` / `tokenless_prepaid_ledger_entries` with
  reserve/consume logic. R4 therefore reduces to fiat _top-up_ of an existing ledger (§4).
- **The owner-approval and host-enforcement primitives exist**: `check_only | prepare_for_approval |
  ask_automatically` authority, the handoff MCP server, the host output-gate CLI
  (`packages/agents/host-gate/`), and Codex plugin lifecycle hooks (`plugins/rateloop-workspace/hooks/`).
  R6 reduces to adapters for non-Codex frameworks (§6).
- **Qualification machinery exists** (`tokenless_reviewer_qualifications`, `qualification_keys_json`,
  cohort qualification rules); what is missing is an expertise vocabulary and verification flow on top (§7).

## 2. W1 — Drift reconciliation (R9) — small, do first

Precise stale spots, re-verified:

| Location                       | Says                                                                                        | Reality                                                                                                                                                                                                  | Fix                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| implementation plan `:69`      | "two 15-case windows with at least 14 comparable agreements"                                | Wilson lower bound ≥ `DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS` (7,000) over ≥15-case windows, plus completion/latency/drift/severe-disagreement gates, ≥30 completed cases (`adaptiveReview.ts:66-117`) | Rewrite the narrative to describe the Wilson gate; keep 15/30/50/100 case counts                     |
| implementation plan `:34,:221` | migration head `0053`                                                                       | `_journal.json` is authoritative; `0091_mcp_elicitation_sessions` after this implementation                                                                                                             | Reference the journal and state the observed head only as revision context                           |
| readiness register             | previously stale fixed head                                                                 | `0091` after this implementation                                                                                                                                                                         | Keep release verification pinned to the live journal head                                            |
| environment parity `:88`       | head `0068`                                                                                 | `0091` after this implementation                                                                                                                                                                         | Same                                                                                                 |
| implementation plan `:35-38`   | historical `tokenless-v3` 4-slot key without explaining v4                                  | Code/config require `tokenless-v4` with a fifth Feedback Bonus address, while no v4 deployment currently exists                                                                                          | Preserve the historical v3 artifact and explicitly separate it from the undeployed v4 runtime schema |
| CLAUDE.md vs design of record  | CLAUDE.md prohibited thirdweb while the design and code retain optional wallet provisioning | Owner decision: keep the optional thirdweb-created app wallet after Better Auth and an explicit funding/payout/recovery request; never mount a browser connector or use a wallet for auth                | Record the decision in CLAUDE.md and the design of record                                            |

Commits: `docs: reconcile adaptive gate narrative with implementation` · `docs: update migration heads and
deployment key examples` · `docs: record wallet-stack decision`. Each with a doc-lint or
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
6. `docs: extend limitations with gold-item scope` — R10 candor: what gold does and does not prove.

Dependency: none on unfinished lanes for the invited path; public-lane injection ships behind the same
readiness gate as public paid panels.

## 4. W3 — Fiat prepaid wrapper (R4)

**Why:** enterprises cannot put "buy USDC" through procurement; review spend must be invoiceable. The
missing piece is only the fiat top-up bridge into the existing prepaid ledger.

**Design (researched against current Stripe docs):** use **Stripe Invoicing funding invoices**, not Stripe
Billing credit grants — grants only apply to metered subscription line items, and RateLoop's drawdown is its
own internal ledger. The first shipped rail is deliberately **USD-only**: a workspace owner requests a
top-up → RateLoop issues a Stripe invoice (`collection_method=send_invoice`, `days_until_due=30`,
`customer_balance` with `us_bank_transfer`) with Stripe Tax. RateLoop credits only the immutable net USD
amount after a canonical Stripe invoice is paid in full through the configured bank-transfer rail; tax is
tracked in the invoice gross and is never converted into review credit. Paid-out-of-band invoices, existing
customer-balance credit, partial/over/underpayment, currency or amount drift, and test/live-mode mismatch do
not credit the ledger. On a valid `invoice.paid`, an idempotent webhook credits
`tokenless_prepaid_ledger_entries` → existing
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
6. `docs: document fiat review funding` — including the German B2B e-invoicing caveat. A plain Stripe PDF
   is an unstructured "other invoice", not an E-Rechnung. Domestic German businesses have had to be able to
   receive structured invoices since 2025; transitional issuance of other invoices remains available through
   2026, and through 2027 where the issuer's prior-year turnover is at most EUR 800,000. Structured issuance
   is therefore required from 2027 or 2028 depending on the issuer. XRechnung/ZUGFeRD generation and any
   delivery partner remain deferred until a German customer requires the path; no partner is preselected.

Dependency: real-money invoicing waits on the register's billing/legal gates; everything above ships and is
exercisable in staging with Stripe test mode.

## 5. W4 — Enterprise SSO and SCIM (R5 code slice)

**Why:** hard procurement checkbox. **Researched fit:** Better Auth — already the auth layer
(`lib/auth/betterAuth.ts`: email OTP, passkeys, gated Google/Apple) — now ships first-party MIT plugins:
`@better-auth/sso` (generic OIDC + SAML 2.0, DNS-TXT domain verification) and `@better-auth/scim` (SCIM 2.0,
**/Users only — no /Groups yet**). IdP-initiated SAML is disabled; signed assertions, response correlation,
timestamps, bounded clock skew, and current algorithms are required. This keeps SSO in-process with no new
vendor. Ory Polis is not pre-approved: evaluate a fallback only if a real customer requires SCIM Groups or
an unsupported IdP.

Steps:

1. `auth: add SSO plugin with domain verification` — `@better-auth/sso`, provider registration restricted to
   workspace owners/admins, DNS TXT domain proof required, no default providers.
2. `auth: map SSO provisioning to workspace roles` — map the verified provider directly to the RateLoop
   workspace; do not enable a parallel Better Auth organization authority. Provisioned users land as
   `member`; existing RateLoop roles are never overwritten and role changes remain workspace-side.
3. `auth: enforce SSO-only sign-in per verified domain` — the documented Better Auth pattern (block
   OTP/social for domains with an enforced provider); workspace setting, default off.
4. `auth: add SCIM user provisioning` — `@better-auth/scim` with provider-scoped tokens;
   deactivation honored via the admin plugin; document the Users-only limitation truthfully (no "SCIM
   group sync" claim).
5. `settings-ui: add identity provider management` — provider CRUD, domain verification status, SCIM token
   management, last-sync surface; audit-chain events for every identity-admin action.
6. `e2e: cover SSO and SCIM journeys` — deterministic route/service fixtures cover provisioning,
   enforcement, role preservation, deprovisioning, and credential revocation. A real OIDC/SAML IdP exercise
   remains an explicit staging gate and is not represented as complete by fixture tests.

Constraint honored: sessions stay short-lived and hashed; a client-reported IdP assertion is authentication,
never workspace authorization (roles remain RateLoop-side) — consistent with the identity section of the
design of record. Marketing continues to follow the readiness register (no "enterprise SSO" claim until the
journeys pass in staging).

## 6. W5 — Approval-primitive integration adapters (R6)

**Why:** the synchronous approval slot is commoditized; RateLoop should snap into whatever gate primitive
the customer's framework already has and own the sampled-assurance layer behind it. Everything RateLoop-side
exists (authority levels, durable pending, host gate, hooks); what is missing is the adapter surface for
non-Codex hosts.

Re-audit result: the framework primitives are resumable checkpoints, not long-lived synchronous calls. LangGraph JS
restarts an interrupted node and therefore requires a durable checkpointer, a stable `thread_id`, and idempotent work
before `interrupt()`. OpenAI Agents returns interruptions plus resumable RunState; the app must serialize that state and
must not treat SDK approval as RateLoop release. Claude Code's durable async tool primitive is `PreToolUse` with
`permissionDecision: "defer"`; `PermissionRequest` is synchronous allow/deny and `Stop` remains only the output guard.
Stable MCP 2025-06-18 form elicitation is capability-gated, flat/primitive, accepts `accept | decline | cancel`, and must
not request sensitive information. The previous stateless Streamable HTTP route could not originate and correlate an
MCP server request; W5 therefore adds an authenticated `MCP-Session-Id`, durable request persistence, GET/SSE delivery,
and correlated POST responses rather than pretending a response-only helper is an integration.

Steps (under `packages/agents/src/integrations/` plus the workspace plugin, with contract tests):

1. `agents: add framework adapter core` — a small TypeScript core wrapping the SDK flow
   (`evaluate → prepare/request → durable pending → result`) with the exact non-blocking semantics the state
   machine defines (never hold a tool call open for the response window).
2. `agents: add LangGraph interrupt adapter` — a JSON-safe JS `interrupt()` payload carrying only the durable pending
   checkpoint; document the required checkpointer/thread and idempotent node restart.
3. `agents: add OpenAI Agents interruption adapter` — bind `needsApproval`, persist adapter state beside RunState, and
   allow the SDK interruption to be approved only after a one-shot RateLoop refresh verifies signed release evidence.
4. `agents: add Claude Code hook adapter` — use `PreToolUse` `defer` for an armed non-terminal review, recheck the same
   tool call after session resume, keep RateLoop progress tools callable, and retain `Stop` as the advisory output guard.
   Claude enforces `defer` only in Claude Code 2.1.89+ non-interactive/SDK single-tool calls; interactive and multi-tool
   sessions therefore remain advisory and must not be described as host-enforced.
5. `mcp: support elicitation for owner-present approvals` — where the MCP host supports elicitation
   (spec ≥ June 2025), offer the approval confirmation in-session instead of only the browser handoff;
   capability-gated, advisory labeling rules unchanged.
6. **Already implemented; do not duplicate:** migration `0073`, `assuranceEventStreaming.ts`, and its contract tests
   project review completion, packet anchoring, and gate blocking into the shared CloudEvents 1.0/OCSF delivery path.
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

## 8. Decisions recorded for this implementation

1. **Wallet stack (W1):** keep the optional thirdweb-created app wallet only after Better Auth and an explicit
   funding, payout, or recovery request; never use a browser wallet connector for authentication or authorization.
2. **Gold seeding default (W2):** owner-seeded only at launch. Platform-synthetic public gold remains behind
   a separate public-safety and network-readiness gate.
3. **German e-invoicing partner (W3):** deferred until a German customer requires structured issuance;
   select and approve a provider only against that customer's format and delivery requirements.
4. **SSO fallback (W4):** demand-only; evaluate Ory Polis or another bridge only for a demonstrated
   unsupported-IdP or SCIM-Groups requirement.

## 9. Sequencing

| Order | Workstream                                                                   | Gate                                           |
| ----- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| 1     | W1 drift fixes                                                               | none — immediate                               |
| 2     | W5 adapters + W2 steps 1–2, 5–7 (specs, schema, health metrics, UI guidance) | in-flight human-review commits merged (done)   |
| 3     | W3 fiat top-up (staging/test mode) · W6 steps 1–5 (invited path)             | Stripe test config; setup flow stable          |
| 4     | W4 SSO/SCIM                                                                  | staging exercise before any marketing claim    |
| 5     | W2 steps 3–4 (gold injection/scoring, public lane) · W6 step 6               | public-network readiness gate                  |
| 6     | Real-money invoicing, paid-network expertise                                 | register's billing/legal/paid-settlement gates |

Every workstream follows the standing rules: no fund-core change without a fresh coordinated deployment (none
is needed here — all six are off-chain); the tokenless/`main` isolation rules; proportionate tests per
commit; and the claims-match rule — no website or docs claim ships before the capability is exercised.

# Tokenless completion plan — 25 July 2026

**Goal:** every capability the product claims actually works. Not disclosed as missing — *working*.
**Baseline:** `tokenless` @ `35a0038c0`, migration head `0135_private_review_crowd_forecasts`. Verified green:
1723 app tests, keeper 74/74, ponder 48/48, type checks clean.
**Source:** six parallel design agents, every claim re-verified in source by the coordinating session.
Resolves [tokenless-product-readiness-audit-2026-07-25.md](tokenless-product-readiness-audit-2026-07-25.md).

---

## 1. What the plan is shaped by

Three facts determine the sequence, and none of them is a coding problem.

**Nobody can create an account.** `betterAuth.ts:126` disables password auth; email OTP needs Resend; Google/Apple need
credential pairs that are absent; passkeys cannot bootstrap because registration requires an existing session plus a
one-time proof. Until Resend is configured, nothing below can be verified by a human.

**Every paid lane waits on one vendor.** `paidEligibility.ts:299` refuses the development eligibility provider whenever
`NODE_ENV === "production"` — which is every Vercel build. No verified profile → no voucher → no commit → no claim.
The interface is already fixed and is *not* a vendor SDK: an Ed25519-signed assertion over an HTTPS redirect. Any IDV
vendor that can post that payload satisfies it. **Vendor lead time is the critical path for three of the four lanes at
once — start the contract before writing any lane code.**

**One policy decision blocks half the product.** `check-tokenless-production-readiness.mjs:416` *errors* unless
`TOKENLESS_NETWORK_PANELS_ENABLED === "false"` on a tokenless deployment, while `:707` demands `"true"` on `main`.
Since tokenless may never touch `main`, there is no configuration where the network half can be exercised. §9 proposes
the resolution; it needs a human decision, not an engineer.

Everything else is tractable engineering, and a surprising amount is already built.

---

## 2. Corrections to the audit

The design pass overturned six of my own findings. Recorded because two of them change what gets built.

| Audit claim | Reality | Consequence |
| --- | --- | --- |
| Hybrid lane "genuinely unbuilt; `assignHybrid` not even in the dependency map" | **Wrong.** Declared at `humanReviewRequestRouter.ts:287`, complete two-stage router path, and `hybridHumanReviewAdapter.ts` is a finished 264-line adapter with a security test suite. Missing: the `DEFAULT_DEPENDENCIES` entry and a split producer. | Much smaller gap than described |
| Private-paid "~90% built… 3–5 days" | **Understated the wrong way.** The reviewer cannot be vouchered either — `completePaidReviewVoucherIssuance` and `consumePaidReviewVoucher` have zero production callers — and nothing funds the round, so the operation never reaches the state the accept function requires. | 5–6 weeks, not days |
| Public-network "settlement exists; admission does not" | **Half the story.** `prepareRunAudience` and `reserveDiversifiedNetworkSubpanel` also have zero production callers. An epoch producer alone changes nothing. | 6–10 weeks |
| Adaptive: "two of five gates stubbed" | **Three.** `humanReviewResultObservation.ts:369` writes `human_human_agreement_bps` as a literal `NULL` while `adaptiveReviewService.ts:497` requires non-null — so the agreement gate is dead in the only lane that works. | Extra 1–2 d |
| `correlationRiskBps` rename "~1 hour" | **Landmine.** `immutableFinalizedEvidenceIdentity` builds identity by spread-and-zero, so a rename makes stored and derived evidence diverge → `evidence_conflict` on every historical round. | Fix the identity function first |
| Duplicate `workspace-name` DOM id | **Not real.** The two renders are in mutually exclusive branches of an early return. | Dropped |

Plus one new **live defect**, not a missing feature: the accept route calls `acceptPrivateUnpaidReviewAssignment`
unconditionally, and `privateUnpaidReviewAdapter.ts:1186` explicitly tolerates `compensation_mode === 'usdc'`. **A paid
private assignment can be accepted today with no funding, no bound round, and no voucher.** Fix in week 1 regardless of
when the paid lane ships.

And a second: `BetterAuthSignIn.tsx:148` calls `addPasskey()` without the `x-rateloop-passkey-action-proof` header that
`passkeys.ts:62` requires — so "Add a passkey and finish" can only ever fail. That is the first thing a brand-new user
is offered, so it must land *with* Resend.

---

## 3. Phase 0 — this week (~6 days, no external dependency)

Everything here is independent, ships alone, and is correct regardless of what follows.

| # | Work | Why now | Effort |
| --- | --- | --- | --- |
| 0.1 | **Branch the accept route on compensation mode**; resolve `payoutAccount` and `issuanceId` server-side, never from the request body | Closes the live hole above | 2 d |
| 0.2 | **Surface `blockingReason` / `implementedLanes` in the UI**; gate the audience and compensation selectors; add `lane_not_implemented` to the finalization postcondition; derive the public MCP capability response — **both** copies, `protocol.ts:203` and `:282` | Highest value per hour in the audit. Stops owners configuring dead lanes | 2–3 d |
| 0.3 | **Fix keeper round starvation** — move the merge into `round-scan.ts` so both lane budgets share one cursor; cap the feed at half the tick; gate `finalize_scoring_seed` on the scoring-beacon timestamp | Only item causing ongoing loss of work | 1.5 d |
| 0.4 | **Hybrid two-cohort policy emission** — `humanReviewConfiguration.ts:1434` emits at most one cohort while `validatePolicySourceRules` demands exactly two, so any hybrid policy fails today | Live contradiction; makes hybrid testable later | 1 d |
| 0.5 | **Delete dead surfaces** — the pilots route (no lib, no UI, no test), the four superseded `agent-review-policies` routes, the post-round-appeal writer whose read side has no UI either | "Prefer removal of obsolete consumers" | 0.8 d |
| 0.6 | **Start Resend + eligibility-vendor procurement** | Both are lead-time, not engineering | owner |

**Kick off 0.6 on day one.** The eligibility vendor gates three lanes simultaneously.

---

## 4. Phase 1 — foundations (~2 weeks)

Shared primitives that everything later depends on. Building these first avoids writing the same markup twice.

**1.1 Form validation primitive (3–4 d).** `lib/validation/fieldFormats.ts` — an isomorphic table holding, per format,
*one* regex, *one* length limit, *one* `title`, *one* message. That single table kills the VAT `maxLength={80}`-vs-64
mismatch and the ten `pattern=` attributes with no `title`. Then `components/tokenless/ui/Field.tsx` (render-prop, owns
`id`/`aria-describedby`/`aria-invalid`/`input-error`, message slot beneath the control, optional counter, `min-h-11`
touch target, hint contrast clamped at `/60`) and `useFormErrors.ts` (validate, focus **and** scroll to the first
invalid field, map server `{code, field, message}` back to the field).

The server half is **one edit reaching all 171 routes**: add `field` to `TokenlessServiceError` and to
`tokenlessErrorResponse`. Then delete the duplicate `RequestFailure` in `WorkspaceSettingsClient.tsx:87` rather than
extending it — it is a strictly worse copy of `lib/tokenless/http.ts`.

**1.2 Capability registry (2 d).** The repo has already solved this once. [hostCapabilities.ts](../packages/nextjs/lib/tokenless/hostCapabilities.ts)
states the intent verbatim — capability claims "match code by construction", and unavailable things are "represented by
their absence". Replicate it for review lanes: `lib/tokenless/productCapabilities.ts` deriving every fact from
`HUMAN_REVIEW_LANE_IMPLEMENTATION`, the adaptive flag, and env gates, with `available = implementedInCode &&
deploymentGateSatisfied` so env can only narrow.

Then generalise the existing `publicEvidenceClaims.ts` engine (currently a guard with no runtime consumer) into a shared
`findClaimViolations`, add `PRODUCT_CLAIMS_MATRIX`, and extend the sweep to `components/tokenless/**` — which the
current sweep never reaches.

**This is the answer to "don't just document that it's missing."** A gated sentence is *absent* when the capability is
off and *present* when it is on. When a lane flips on, the claims become true automatically and no page is hand-edited.
Ladder percentages render from `ADAPTIVE_REVIEW_STAGE_RATE_BPS`; `public/docs/*.md` is generated with a `--check` mode
so the mirror cannot drift.

**1.3 Evidence identity allow-list (0.5 d).** Rebuild `immutableFinalizedEvidenceIdentity` from an explicit list of
stable fields instead of spread-and-zero. Ship alone with a regression test proving stored-vs-derived evidence still
matches across differing analytics key sets. **This must precede any analytics key change**, including the
`correlationRiskBps` rename and the forecast aggregates in Phase 2.

**1.4 Keeper trustworthiness (2.5 d).** K3 race classifier (add the three `error` entries to the feedback-bonus ABI and
generalise `expected-panel-race.ts` — the current regex can never match a decoded custom error); K5 identity mismatch
fails closed with a counter and a readiness reason instead of a generic warn; K2 zombie fixed by extracting `main()` so
the catch can actually close the metrics server; K6 bounded log scan using the `createdBlock` Ponder already stores.

**1.5 Resend + the passkey fix (1 d + lead time).** Configure `RESEND_API_KEY` / `RESEND_FROM_EMAIL`, and fix the
`addPasskey` proof header in the same PR. Also add both variables to the *test-deployment* check — today the tokenless
build succeeds with signup completely broken.

---

## 5. Phase 2 — the crowd forecast as an honesty signal (~3 weeks)

This is the workstream you asked for, and it is the one that pays off soonest: the unpaid private lane is the only lane
generating data, and `35a0038c0` already collects the forecast there. Today **nothing reads it back** — every reference
is a write path.

### The design constraint that shapes everything

**Without payment, RBTS is not incentive-compatible — it is only a diagnostic.** The truthfulness property comes from
the score being what you are paid on. Unpaid, entering 50% every time is free, so a *high* score is weak evidence of
honesty. The detectors must therefore be ones where the informative direction is **absence of signal**, or structure
that should not exist. And unpaid panels are small (often 2–3, RBTS needs ≥3 reveals), so per-round peer scoring is too
noisy — **per-reviewer accumulation across rounds is the viable unit.**

### 2.1 Calibration accumulator (5–7 d)

Per response: forecast `f`, and realised **leave-one-out** peer positive share `q`. Store running sums only — never
per-observation history. That single choice is what makes the privacy story defensible.

The discriminating statistic is the **Brier skill score**, `BSS = 1 − B̄/Var(q)`. A constant reporter scores `BSS ≈ 0`
*by construction* however well-calibrated their constant is — which is exactly the W2 attacker profile. Brier rather
than log score because it is the same family the contract already uses (`quadraticScoreBps` is the affine-transformed
Brier), so paid and unpaid land on one comparable scale, and its constant-forecast reference is `Var(q)` exactly,
decomposable into running sums.

Written inside `terminalEnvelopeForDelivery`, which already holds the transaction and the frozen response set.
Dispersion accumulates for *every* response including panel-size-1; outcome statistics only when the panel completed —
an expired panel's split is a self-selected subsample of fast responders.

**Two deliberately disjoint key spaces**, which solves the transfer problem structurally rather than by policy prose:
invited calibration is keyed `(workspace_id, principal)` with `rater_id NULL`; network is keyed `rater_id` with
`workspace_id NULL`, enforced by a CHECK. Every network admission query filters on `reviewer_source`, so invited
calibration is **not merely deprioritised — it is invisible** to network admission. It cannot be joined without a schema
change that fails the constraint.

Do **not** derive lineage from `tokenless_private_review_responses.reviewer_key` — that value is per-delivery by design,
and re-deriving it across deliveries would defeat the property it exists for.

Personal data keyed on the principal, so it **must** be added to `lib/privacy/accountDeletion.ts`, which enforces
zero-postconditions and would otherwise complete a deletion while leaving behavioural data behind.

### 2.2 Low-effort detection (2–3 d, same module)

- `forecast_invariant` — ≤1 distinct forecast over ≥5 observations, or Wilson-95 lower bound on modal share ≥ 0.9.
  Needs no outcome at all; works at panel size 2. Cheapest and strongest.
- `forecast_discrimination_absent` — `BSS ≤ 0` at ≥10 observations.
- `forecast_vote_decoupled` — forecast independent of the reviewer's own vote. **Always soft**: holding a fixed belief
  about the crowd while your own vote varies is a coherent, informative report.

### 2.3 Pair lockstep (3–4 d)

Forecast lockstep beats vote agreement by roughly an order of magnitude per observation: a vote has 2 buckets and
competent reviewers are *supposed* to agree, whereas the forecast has 99. Compute the null against the **workspace's own
empirical forecast histogram**, not uniform-over-99 — humans anchor on round numbers, and uniform will false-positive on
every pair that likes "70%".

The sharper statistic is the **variance** of the pairwise forecast distance, not its mean: two humans with different
priors produce a stable offset with high variance; two instances of one script produce a low-variance difference. That
is the false-positive control that makes the detector shippable — the repo's own `heterogeneous_priors` scenario is the
honest profile a mean test would wrongly flag.

Co-assignment counts already exist for panel diversification; no new history table.

### 2.4 Consequences and appeal (3–5 d) — must land with or before 2.1

Findings may affect admission, cohort eligibility, qualification, and buyer-facing aggregates. **Never payout, in any
lane.** New reason codes enter as plain `reasonCodes`, **never as limitation codes** — `postRoundIntegrity.ts:206` makes
any limitation code force `insufficient` → `inconclusive`, so a `forecast_absent` limitation would silently un-publish
every historical round.

Reviewers must be able to *see* their own counters in plain language and appeal a finding, with an open appeal
suspending the consequence while the finding stays append-only. Writing findings that have consequences before an appeal
path exists is the wrong order.

### 2.5 The `forecastRequired: true` decision

`35a0038c0` made the forecast mandatory in the only working lane, for a field nothing reads. **Keep it required only if
2.1 and 2.2 land in the same iteration** (~5 days, and they need no peer scoring or paid lane). Otherwise make it
optional — because a mandatory field nothing reads *actively manufactures the failure mode you are trying to detect*:
reviewers learn to type any number to clear the gate, and the number they learn is a constant. You would be training
`constant_up` into your own dataset and then building a detector for it.

Any data collected during a "required but unread" period should be treated as a distinct collection epoch.

### 2.6 Rename `correlationRiskBps` (0.5 d, after 1.3)

To `assignmentProvenanceGapBps` — it measures assignment-coverage shortfall and has nothing to do with vote
correlation, which is very likely the source of the impression that a correlation layer exists.

---

## 6. Phase 3 — rating and forms (~2 weeks, parallel with Phase 2)

**3.1 Rating-flow blockers.** R1: `advanceDisabled` never checks `feedbackBody`, so required feedback submits, fails
server-side, and the message is discarded — mirror the private lane's `caseCompletionIssue` and route it through the
`advanceHint` prop `35a0038c0` just added. R2: delete `technicalStatus` and its `<details>` entirely (it is a developer
console shipped to raters, and AGENTS.md forbids a `<details>` being the only route to information needed to complete
the task) and surface the real server message, which `http.ts:32` already extracts. R4: validate the source URL on blur.

**3.2 One `CrowdForecastField` for both lanes (1.5 d).** The public card and private client are the *same* hand-rolled
number box. One component restores the slider — seeded default, large live `%` readout, end labels, `aria-valuetext`,
and an `InfoPopover` — for both. Port the legacy CSS verbatim from `main`, so this is design-preserving, not a redesign.
`InfoPopover` exists and is keyboard/touch tested, and is used **zero times** in the rater journey today.

Include the R9 copy: the rater is never told the forecast affects pay, and RBTS is only incentive-compatible if they
know. That matters more once Phase 2 is scoring it.

**3.3 Insight bonus (45 min).** Export the reservation formula so `raterService.ts:174` and `surpriseBountyService.ts`
cannot drift, and omit the row entirely when a zero-fee round makes it unpayable.

**3.4 Form retrofit (4–5 d).** In order: rating surfaces (proves the API on a hostile case), workspace billing/tax (the
only surface with both a wrong client limit and a leaking server message), the three evidence-delivery panels (where a
rejected URL is visually identical to success), auth, then the rest. `AgentSetupFlow` last and **one commit per wizard
step** — its `setError` doubles as client validation, so a naive retrofit clobbers server errors.

**3.5 Axe coverage (0.5 d).** The current scan runs before any interaction, so none of the rating UI is ever checked.
Scan after answer selection, after a blocked submit, in the error state, and on the receipt.

---

## 7. Phase 4 — copy and expertise (~1.5 weeks)

**4.1 Copy rules, not 60 edits.** Make `SetupChoiceGroup.description` optional — it is *required* today, which is why
every setup option ships helper text. Ban `text-base-content` below **`/55`** (not `/60`: `globals.css:76` defines the
tertiary token at exactly `0.55`, which passes WCAG AA on all four surfaces, while `/45` fails — a `/60` floor would
orphan the design token). Add an AST-based vocabulary guard: 989 raw matches, but only 142 user-visible strings, and
after structural exemptions (`<code>`/`<pre>`, and `placeholder` on an input that also has a `pattern`) about **42 need
hand-rewriting**. Make eyebrow-plus-heading-plus-subtitle a *type error* via a discriminated `SectionHeader` prop union.

**4.2 High-value deletions.** The hand-typed `sha256:` field asking a human reviewer to type a 64-hex digest; the
`Manage connected agents` disclosure that is the only route to Disconnect; the dead `InvitationRedemption.tsx`; the
"Enterprise identity" section whose only content is that the feature is disabled.

**4.3 Owner-side expertise confirmation (3 d).** The setup flow literally says *"Confirm each person's knowledge after
they join"* and then offers no control, so an owner requiring specialists gets `expertise_coverage_insufficient`
forever. Build a group-scoped `ReviewerExpertisePanel` plus an inline affordance in the setup flow's coverage list.

Defer reviewer self-submission and the operator queue: both require a `tokenless_rater_profiles` row and serve the
network lane, so building them now creates UI for a lane that cannot route — the exact pattern this plan exists to end.

---

## 8. Phase 5 — the lanes (months, external-dependent)

| Lane | Effort | Blocked on |
| --- | --- | --- |
| `private_invited` + paid | 5–6 w | eligibility vendor; thirdweb client id; funded testnet USDC |
| `public_paid_network` | 6–10 w | network-panels policy; World ID; eligibility vendor; the paid lane's settlement reconciler |
| `hybrid_public_safe` | 4–6 w | both of the above complete |

**Private-paid, in dependency order:** fund the round server-side from the already-consumed prepaid reservation (nothing
calls the payment route today, so the operation never reaches `round_bound`); a forward-only migration adding terminal
seat and operation states with a **linear, monotonic** transition guard so replay is idempotent; bridge the private
voucher ledger to the public issuer with an explicit panel-identity assertion that fails closed on a mixed bundle; make
paid assignments visible to reviewers; a settlement reconciler writing `settlement_reference` — which has **zero
production writers** today, so a paid run can never currently produce an evidence packet.

The reviewer UI needs the existing paid commit machinery — voucher, EIP-712 vote-key signing, tlock seal, commit,
poll — extracted from `PublicQuestionCard` into a shared component rather than duplicated.

**Public-network** needs both a scheduled integrity-epoch producer (rotate ~6h on the existing 5-minute cron; on failure
the previous epoch serves until expiry and admission fails closed) **and** the consumer path, since
`prepareRunAudience` and `reserveDiversifiedNetworkSubpanel` have no production callers. Recommend wiring the existing
assurance-run pipeline rather than a lighter path — it also fixes `settlement_reference` for both lanes and unblocks the
backend-with-no-UI surfaces. Four new signing/pseudonym/vault keys must be provisioned and role-distinct.

**Hybrid** is closer than the audit suggested: the schema already models two subpanels per run, and the DB already
enforces invited-wins dedupe. It needs the `DEFAULT_DEPENDENCIES` entry, a v4 semantic profile document carrying
per-cohort panel size and bounty (v1–v3 hashes stay byte-identical), per-cohort expertise keyed `(definitionId,
sourceScope)`, and **two rounds rather than one** — a single round binds one admission policy, which would defeat the
separate expertise and compensation that make hybrid worth having. No contract change: rounds are independent and
`createRound` is permissionless.

---

## 9. Phase 6 — the adaptive ladder (7–9 weeks, or cap it)

**Ship the honest interim now (4–6 h, independent of everything).** Demote `adaptive` from default to `always` —
behaviourally identical to what adaptive does today, so nothing changes except the label stops lying — relabel
`"Adaptive — Recommended"`, lift the existing truthful reason string into a shared module, and disable the
minimum-review-rate field that can never take effect.

**Then, to enable the ladder honestly:**

- Fix the reset-gate ordering bug **first** — `adaptiveReview.ts:82` returns "no reset" on an undersized window *before*
  checking severe disagreement and drift. At 10% coverage an undersized window is the normal case, so a reduced scope
  could sit at monitoring rate with an open severe disagreement forever. Currently masked by the global `false`; it
  would bite on day one of enablement.
- Populate `human_human_agreement_bps` in the private lane (the third dead gate).
- Attribute observations with their selection reason, so the window is sample-only — below 100% the window is a biased
  mixture of uniform samples and forced reviews, which destroys drift comparability.
- Drift as three components: outcome regression against a **frozen reference window** (the absolute Wilson threshold
  cannot catch a scope falling from 95% to 88%), input covariate shift via PSI against frozen bucket edges, and
  selection-mixture integrity.
- Severe disagreement as a **case-level event**, never a rate: unanimous human reversal, critical-risk disagreement,
  owner-raised, recorded override, or an evidence-integrity veto from Phase 2. Raising is atomic with the reset; only an
  owner closes it, and closing does not restore the prior stage.
- Per-scope computed readiness replacing the global `ADAPTIVE_SAFETY_GATES_AVAILABLE`, plus one global kill switch that
  can force-disable but never force-enable.
- An owner rollout approval showing detection latency **in outputs, not probabilities**: *"at 50% coverage, a drop from
  95% to 70% agreement is expected to be detected after ~N further outputs, of which ~M would be released unreviewed."*

**Decide before funding this.** I expect the honest detection-latency number at the 10% floor to be unacceptable —
hundreds of unreviewed outputs. If so, ship the ladder **capped at 25%** with a mandatory periodic re-calibration block
that bounds detection latency by construction, and leave `monitoring` unreachable until a sequential test replaces the
fixed 15-case window.

**Keep the Phase 2 signals out of the ladder arithmetic.** Both score against crowd consensus, so a lazy or colluding
panel that agrees with a bad agent raises its own quality score *and* the agent's agreement rate — the errors compound
rather than cancel, which is exactly the lazy/collusive equilibrium the readiness register keeps blocking. Use the
signals **upstream in assignment eligibility**, so bad responses never become observations, plus one binary fail-closed
veto. That also keeps the two workstreams independently shippable.

---

## 10. Decisions needed from you

Engineering cannot resolve these.

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Eligibility/KYC vendor** | Gates all three paid lanes. Longest pole. Start now |
| D2 | **`TOKENLESS_NETWORK_PANELS_ENABLED`** | Today the network half is untestable on the only permitted target. Recommend relaxing the test-deployment check from an absolute prohibition to a bounded permission (require the flag be explicitly `true`/`false`; when `true`, forbid production World ID and require the six `WORLD_ID_*` vars). `reviewCapabilities.ts:44` remains the single authority that actually opens the lane, so flipping the env var alone cannot expose it |
| D3 | **Adaptive ladder floor** | 10% may be indefensible on detection latency. Cap at 25%? |
| D4 | **Seeded forecast default** | Legacy seeded 60/40/50. It lowers abandonment but anchors an incentive-bearing input, biasing RBTS scoring and the SP bounty |
| D5 | **How far the R9 pay copy goes** | "Half the quality bonus" is accurate but is a claims decision |
| D6 | **`forecastRequired`** | Keep mandatory only if Phase 2.1–2.2 land together (§5.5) |
| D7 | **Stripe on tokenless** | The preflight demands live-mode keys when enabled, which is wrong for a testnet product. Recommend leaving both flags `false` |
| D8 | **Verify the thirdweb premise** | `check-identity-deployment.mjs:68` errors on any hosted build without the client id, so a successful deployment implies it is already set. Inspect Vercel before spending time |

---

## 11. Timeline

| Phase | Work | Effort | Gated by |
| --- | --- | --- | --- |
| 0 | Security fix, truth surfacing, keeper starvation, deletions | ~6 d | nothing |
| 1 | Form primitive, capability registry, evidence identity, keeper trust, Resend | ~2 w | Resend lead time |
| 2 | Crowd-forecast honesty system | ~3 w | nothing (unpaid lane only) |
| 3 | Rating flow + form retrofit | ~2 w | Phase 1.1 |
| 4 | Copy rules + expertise UI | ~1.5 w | Phase 1.2 |
| 6 | Adaptive interim honesty | 4–6 h | nothing |
| 5 | Private-paid lane | 5–6 w | D1 vendor |
| 5 | Public-network lane | 6–10 w | D1, D2, World ID |
| 5 | Hybrid lane | 4–6 w | both above |
| 6 | Adaptive ladder proper | 7–9 w | D3 |

Phases 2, 3, and 4 run in parallel with each other and with the Phase 5 vendor lead time. **A usable, honest product on
the one working lane is ~6 weeks. All four lanes live is 4–6 months, dominated by procurement and one policy decision
rather than by code.**

---

## 12. Standing constraints

Every phase must respect these; each was verified this session.

- **Migrations are immutable.** `migrate-hosted-database.mjs:77` hash-verifies every applied migration against the
  journal. Forward-only, always. `db:generate` and `db:push` are deliberately disabled.
- **The fund core is immutable and adminless.** No plan item requires a contract change, and none should be introduced
  without an atomic redeployment of app, Ponder, and keeper together.
- **No signal may affect earned pay.** Everything in Phase 2 carries `payoutEffect: "none"`.
- **Tokenless isolation.** `origin/tokenless` and the isolated Vercel/Railway projects only; never `main`, the legacy
  project, or `rateloop.ai`.
- **pg-mem parses the real journal in tests.** New SQL using integer `%` in a CHECK, plpgsql, or partial indexes needs a
  `memoryCompatibleMigrationStatement` case.
- **The first new migration breaks `privateReviewCrowdForecastMigration.test.ts`**, which asserts `entries.at(-1).idx
  === 135`. Change it to look up its own entry by tag.

# Tokenless completion review — 26 July 2026

**Scope:** independent verification of the 147 commits claiming to implement
[the completion plan](tokenless-completion-plan-2026-07-25.md), against the claims recorded in
[the completion verification](tokenless-completion-verification-2026-07-26.md).
**Head reviewed:** `acfba6276` (started at `fd2d8ffe3`; two build fixes landed mid-review).
**Method:** six adversarial verification agents plus direct execution and spot-verification by the coordinating
session. Every finding below was confirmed in source. This is a review of *correctness*, not a release approval.

---

## 1. Headline

A large amount of real, high-quality work landed. The suite is green — **1908 tests** (up from 1723), type checks,
lint, 77 Foundry tests, and after two fixes during this review, the production build.

But the plan's central failure mode — **a complete subsystem with no way to reach it** — has reappeared in five
places, and three claims in the verification document are false as written. Two regressions were introduced *by the
remediation itself*.

The most consequential findings:

| # | Finding | Severity |
| --- | --- | --- |
| A | Invited-paid is **still structurally unreachable** — the fix reintroduced the defect one layer up | Critical |
| B | The workspace-funds deadlock resolution exists server-side and **the UI never calls it** | Critical |
| C | The keeper tick has **no per-round isolation**, and a fix added a new hard throw inside it | Critical |
| **P** | **The paid-lane "default off" gate is a no-op outside `NODE_ENV=production`**, and lane availability checks hash *format* only | Critical |
| Q | The private-paid voucher bridge is test-only, so every paid seat settles as `not_submitted` even when paid on chain | Critical |
| R | Hybrid is not "default off" — it is **unreachable**: zero producers of `hybridSplit` | Critical |
| D | Winning a forecast appeal **restores the restriction**; the lockout is uncurable | High |
| E | The claims sweep passes green while the landing page advertises two dead lanes | High |
| F | The `technicalStatus` developer console was never removed, and a test pins it | High |

**Mitigating context for P/Q/R:** `vercel.json` sets `"deploymentEnabled": { "tokenless": false }`, so none of this is
live, and `next build` sets `NODE_ENV=production`. `packages/foundry` was **not touched** (`git log bb3dd3d86..HEAD --
packages/foundry` → zero commits), so the plan's contract prohibition was respected and no redeployment is owed.

---

## 2. Two build blockers, both found by running the build

Neither was catchable by the test suite, because **nothing in the suite runs `next build`**.

**B1 — the preflight could not load** (`fd2d8ffe3`). `check-tokenless-production-readiness.mjs` imported
`paidLaneActivation.ts` as a default export when it has only named exports. As the second command in the build chain,
this failed every build. **Fixed by `887e44cf9` during this review.**

Worth noting *how* it hid: `check-tokenless-production-readiness.test.mjs` used the **same wrong import**, so it passed
under the test runner's TS loader (which synthesizes a default via CJS interop) while raw `node` ESM did not. The test
encoded the bug.

**B2 — public pages could not prerender** (`887e44cf9`). `useSearchParams()` in `SiteSearch`, mounted twice in
`TokenlessShell` with no `Suspense` anywhere in `components/tokenless/`, broke static prerender of `/legal/terms`,
`/legal/dpa`, and `/docs/tech-stack`. **Fixed by `acfba6276` during this review.**

**The build now completes.** But two independent blockers reaching the branch head, in work explicitly declared
complete, indicates the build is not part of the verification loop. It should be.

---

## 3. Critical findings

### A — Invited-paid is still unreachable

`chain/payments.ts:907` is the only production writer of `tokenless_voucher_rounds`, and its column list **omits
`workspace_id`** — so it is always NULL. `registerVoucherRound` (`paidEligibility.ts:1998`), which does accept a
workspace and enforces *"Invited voucher rounds require an exact workspace"*, has **zero callers** outside its own
definition.

Meanwhile migration `0136_lane_paid_eligibility.sql:59-66` requires
`reviewer_source='customer_invited' AND workspace_id IS NOT NULL`.

So the preflight looks for an invited scope with a NULL workspace, the CHECK makes that row impossible, and **every
invited voucher dies at 403 `paid_eligibility_required`** — before even reaching the 409 `round_workspace_mismatch`
guard clearly written for this case.

This is the same shape of defect the plan was written to eliminate, reintroduced one layer up. No test can catch it:
nothing anywhere registers a `customer_invited` voucher round, and the invited happy path stops at the preflight.

**Fix:** call `registerVoucherRound` with the workspace, or add `workspace_id` to the `payments.ts` insert. Add a test
that issues an invited voucher end to end.

### B — The workspace-funds deadlock resolution is unreachable

The server machinery is real and correct: `lib/privacy/workspaceDeletion.ts:502-580` creates a `blocked_by_funds`
subject request and a fund-resolution row **without forfeiting funds**.

The UI never calls it. `WorkspaceDeletionPanel.tsx:112` early-returns on `preview.blockers.length > 0`; the
confirmation field (`:201`) and submit button (`:224`) render only when `blockers.length === 0`. A funded workspace
always emits `workspace_funds_active`, so the owner reads *"Confirming deletion queues a manual fund-resolution
request without forfeiting the balance"* **with no control to confirm**.

The full chain is intact: funded workspace → undeletable → `owned_workspaces_require_resolution` → account
undeletable. The blocker's stated alternative, "transfer every workspace you own", has **no implementation**.

The GDPR erasure deadlock is exactly where the plan left it, now with dead code behind it.

**Compounding:** `authorizeComplianceOperator` (`paidEligibility.ts:1750`) throws `503` unless
`TOKENLESS_COMPLIANCE_OPERATOR_SECRET` is set — and that variable appears **nowhere** outside code and tests: not in
`.env.example`, not in the privacy runbook that describes the flow, not in any preflight. So even with the UI fixed,
fund resolution, sanctions decisions, and forecast-appeal resolution all 503 on any deployment.

### C — The keeper tick has no per-round isolation, and a fix made it worse

`keeper.ts:1024-1036` calls `advanceRound` in a loop with **no try/catch**, and `reconcileFeedbackBonusRemainders`
follows it. One rejection aborts every remaining round and skips the reconciliation. This is the exact failure shape
plan item 0.5 addressed — fixed in the maintenance worker, left untouched in the keeper.

`57b6c5f9b` then added a **new hard throw** into that unprotected path:

```
keeper.ts:320-322
  if (fromBlock > toBlock) throw new Error("Indexed round creation block is ahead of the chain head.");
```

`block-log-scan.ts:15` returns `[]` benignly for the identical condition. `createdBlock` comes from Ponder; `toBlock`
from the keeper's RPC with fallbacks. **Any RPC head lagging the index now kills the whole tick** — routine with
load-balanced endpoints.

**Fix:** wrap the round loop per-round; revert the throw to the safe no-op.

**Related, same area:** the starvation fix is correct for the original defect (the cursor no longer advances past
discarded rounds), but it **moved starvation into the feed lane**. The feed has no cursor: it takes the head of a
`roundId DESC` list capped at 50 against a limit of 500, re-fetched each tick — so up to 450 actionable items are
dropped every tick, always the same ones, and because ordering is descending the starved tail is the **oldest** rounds,
nearest their deadlines. The new regression test encodes this as expected behaviour.

---

### P — The paid-lane gate does not fail closed the way the document describes

Two independent defects that compound.

**The compliance gate is a no-op off-production.** `paidLaneCompliance.ts:17`:

```ts
if (!options.force && env.NODE_ENV !== "production") return null;
```

and both throws in `requirePaidLaneComplianceApproval` are wrapped in `if (process.env.NODE_ENV === "production")`.
So outside production **no DPIA reference, funding reference, provider inventory, timestamp, flag pair, or activation
reference is required at all**, at any of the seven enforcement points. All three tests pass `{ force: true }` —
precisely the branch that skips the guard — and `requirePaidLaneComplianceApproval` has no test.

**Lane availability checks hash format only.** `reviewCapabilities.ts:36` does `HASH.test(activationReference)` against
`/^sha256:[0-9a-f]{64}$/` and never calls `derivePaidLaneActivationReference`. Its consumers are *server-side* routing
decisions. The repo's own test proves the bypass — `reviewCapabilities.test.ts:111-121` sets
`sha256:${"a".repeat(64)}` and asserts all three lanes flip to available.

**Combined: two `NEXT_PUBLIC_` variables plus a meaningless well-formed hash activate the paid lanes end to end
whenever `NODE_ENV !== "production"`.** `private_invited_paid` is least protected — unlike the network lane it has no
second server-flag backstop.

**Related:** the compliance gate is **create-time only**. All seven call sites are request or reservation creation; no
money-moving path calls it. `app/api/rater/vouchers/route.ts:28` issues the USDC-bearing voucher with no lane gate, as
do the accept and settlement paths. Turning the flags off does not stop money already in flight — contradicting the
document's "stop the request before assignment, publication, reservation, **or spend**."

The preflight also validates only lanes whose *server* flag is true, so `TOKENLESS_*=false` with
`NEXT_PUBLIC_*=true` passes untouched while the lane advertises as available.

### Q — Private-paid settles every seat as `not_submitted`, even when paid on chain

`completePaidReviewVoucherIssuance` (the only writer of `..._voucher_issuances.voucher_id`) and
`consumePaidReviewVoucher` have **zero production callers**. `issuePaidVoucher` has no `issuanceId` parameter and
rejects assignment linkage for `customer_invited`, so `voucher_id` is permanently NULL.

The reconciler joins `LEFT JOIN tokenless_rater_commits c ON c.voucher_id=i.voucher_id`
(`paidAssignmentSettlementReconciler.ts:442`). NULL on both sides never matches → no vote key → the fallback at
`:515-519` writes outcome `not_submitted` and uses the seat id as `settlement_reference`.

**A reviewer who accepted, committed, revealed, and was paid on chain is recorded terminal as `not_submitted`.**
Outcomes `paid` and `compensated` are structurally unreachable for this lane, so the evidence packet asserts a
falsehood. The plan's literal "zero production writers of `settlement_reference`" finding is mechanically closed; the
values written are guaranteed wrong.

No panel-identity assertion exists in the bridge either — the completion path validates rater id and voucher status
only, though the table stores chain id, panel address, and deployment key.

### R — Hybrid is unreachable, not "default off"

Routing requires `material.hybridSplit`; without it the router returns `blocked / lane_not_implemented`
(`humanReviewRequestRouter.ts:1503`). Excluding tests, `hybridSplit` has **three hits: one type declaration and two
consumers. Zero producers.** The only production caller of the router is MCP `rateloop_request_review`, whose material
builder never constructs it. With every flag on and all evidence configured, hybrid is still dead.

**And if it were reachable, funds could lock.** `DEFAULT_DEPENDENCIES.releaseInvited` is a pure throw stub, so once the
invited child is funded `cancelHybridReviewBeforeLiability` always throws; `recordHybridReviewChildLiability` and
`recordHybridReviewChildTerminal` have zero production callers, so no child advances past `ready`; and there is no
expiry, refund, or reclaim path in the module. Round A quorum plus round B stall is a permanent lock.

Also: "per-cohort economics" is one value reused — both cohorts derive from the same `profile.bountyPerSeatAtomic`,
with the seat split hardcoded `Math.ceil(panelSize / 2)`. Expertise *is* genuinely per-cohort, and the two-distinct-
rounds property is real (anti-collapse guard plus a DB uniqueness constraint) — but every hybrid test stubs the
round preparers to return literal `"1"`/`"2"`, so the assertion tests the stubs.

### S — Network integrity epochs: producer and consumer never joined

The plan's dead-code finding *is* fixed — `prepareRunAudience` and `reserveDiversifiedNetworkSubpanel` now have real
callers. But the only automated production writer of a `rateloop_network` audience policy hardcodes
`epochId: \`unavailable:${policyId}:${version}\`` (`humanReviewConfiguration.ts:1499`), while the producer only ever
emits `integrity:YYYY-MM-DD`. The consumer's lookup returns zero rows and throws `integrity_epoch_unavailable` on
**every** auto-configured network run, and no endpoint exposes the current epoch id for a caller to supply manually.

### T — Self-reveal works for a global keeper failure, not an individual one

The recovery package is genuinely complete — every `reveal()` argument plus both keys, AES-GCM with PBKDF2 and AAD,
forced download and confirmation *before* commit, and the server never accepts a preimage (both routes are GET-only,
session-bound, account-scoped). Ponder correctly synthesizes `revealable` from an on-chain `Open` round, so a
fully-down keeper does not block self-reveal — that path is sound, with ~30 hours of headroom.

Two gaps:

- **Individual decryption failure gives five minutes.** With quorum otherwise met, the default
  `TOKENLESS_REVEAL_WINDOW_SECONDS=300` is the entire window to notice, load a backup, type a 64-character secret,
  connect a wallet, and pay gas. After that the reveal reverts and the work is permanently uncompensated. No user
  funds strand, but accepted work goes unpaid.
- **`canReveal` does not model the contract's late-reveal rejection.** The contract rejects when
  `!scoringEligible && revealCount >= minimumReveals`; the snapshot checks neither, though both fields are in the
  Ponder payload. The UI can therefore offer a transaction that reverts after the reviewer pays gas.

**And there is no reveal-required or claim-expiring notification anywhere.** The recovery UI is entirely pull-based, so
a reviewer must proactively visit `/human`. With a 300s window and a 7-day claim grace, unclaimed value still sweeps
back to the funder — the residual half of the plan's original finding.

## 4. High findings

### D — Winning a forecast appeal restores the restriction

`crowdForecastPersistence.ts:874-897` LEFT JOINs appeals `ON appeal.status='open'`. Resolving an appeal — **accepted
or rejected, identically** — drops the join to null and re-activates the restriction. An open appeal is strictly better
for the reviewer than a won one, and nothing clears the reason codes while the append-only trigger blocks updating the
finding.

Compounded: the restriction blocks new assignments, and new assignments are the only source of observations that could
lift the statistic back over threshold. Accumulators are never windowed or decayed. **`forecast_invariant` is a
permanent, uncurable lockout with a decorative appeal.** The test asserts the restriction *after* acceptance.

### E — The claims sweep is green while the product advertises dead lanes

Two independent defects:

1. **The capability state is hard-coded, not derived.** `publicEvidenceClaims.ts:26-43` is a frozen literal with the
   three lanes set `false`; it never reads `reviewCapabilities.ts`. Only `AgentSetupFlow.tsx` genuinely derives, and
   even there the base text is static. `grep -rn reviewCapabilities "app/(public)"` returns nothing.
2. **The matchers are tautological.** Patterns like `/\bhybrid review (?:is|remains) (?:active|available)\b/iu` match
   only near-verbatim restatements of the matrix's own phrase. So the sweep passes while `app/(public)/page.tsx:81`
   ships *"Your invited reviewers, RateLoop's World ID-backed network, or clearly separated hybrid panels."* Also
   unmatched: `docs/tech-stack:43,50-51`, `docs/use-cases:184`, `PublicQuestionCard.tsx:794`,
   `SignedOutExamples.tsx:7` (*"Example pay · $3–$7 USDC"*).

**A green sweep is being read as evidence the claims are true.** The glob coverage is genuinely correct — the
suspected `plugins/**` gap does not exist — which makes the false confidence worse.

### F — The `technicalStatus` console was never removed, and a test pins it

`PublicQuestionCard.tsx:198, :831, :1097-1102` — the `<details><summary>Technical details</summary>` block is verbatim
intact with 24 `setTechnicalStatus` call sites, and `PublicQuestionCard.test.ts:68` asserts `/Technical details/`, so
removing it breaks the suite. Only the private lane was cleaned. The paired defect survives: `:456` still discards
`cause` into a generic string.

### G — A successful submission overwrites its own receipt with a false failure

`PublicQuestionCard.tsx:289-321`. `onSubmitted → load()` returns the same round with `alreadyVouchered: true`; with
`key={task.roundId}` the card is not unmounted, the effect re-fires, the IndexedDB record was just deleted, so it sets
*"No saved submission"* and *"This voucher was reserved in another session."* **The reviewer sees a success receipt
directly above a message saying their voucher was taken elsewhere.**

### H — Sanctions matches are not durable

`privacyRetention.ts:54-65` deletes blocked/review scopes and their screening rows after 35 days. A `match` decision —
with its list-snapshot hash and screener — is destroyed, and both submit paths `ON CONFLICT DO UPDATE` the legal row
back to `pending`. **A matched subject can resubmit under any name.** There is no persistent denylist. The same rule
silently discards a legitimately queued network screening not completed within 35 days.

### I — Lane-scoped eligibility writes to a shared row

`tokenless_legal_eligibility` is keyed by `rater_id` alone; both lanes upsert it, and the preflight gates every lane on
it. An invited submission resets a granted network eligibility to `pending`; a failed network attempt writes `blocked`
and bricks a granted invited one. The invited path hard-writes `verified_residence_country=NULL`, which
`isLegalEligibilityCurrent` treats as passing — **one invited submission permanently neutralises the network lane's
provider-verified-residence cross-check.**

---

### U — The decision packet is reachable, and reports `insufficient` at the default panel size

The plumbing is genuine: two real production callers plus a cron sweep, `run_id` linkage, observation backfill, and
every downstream join satisfied. Settlement and provenance JSX now exists. **1.1's wiring is real.**

But `directPrivateReviewEvidence.ts:236` hard-codes `minimumAggregationSize: 3` into the projected audience policy,
while the product default is `panelSize: 2` (`workspaceAgentSetup.ts:133`, `MINIMUM_REVIEW_PANEL_SIZE = 2`).

At the default configuration:

- the packet's per-case `outcome` is forced to `insufficient`, with `preference` and `disagreement` both null, even
  though the pass rule's `minimumValidResponses` of 2 is met;
- the dashboard suppresses `candidateSelectionShareBps`, `choices`, and `mechanismHealth`, rendering "Reviewer dissent:
  Suppressed / Calibration failure rate: No calibration data / Quorum-case unanimity: No data".

So the owner gets a signed packet whose verdict is `insufficient` and a dashboard with every signal suppressed — while
the *agent* receives the true outcome through a path with no owner-facing consumer.

It is also internally incoherent: the same page renders each reviewer's decrypted rationale and a dissent percentage
with no suppression at all. The k-anonymity floor protects nobody here — the selection is `customer_named`, so the
owner chose the reviewers. The existing test generates a packet from a 2-reviewer panel and never asserts on
`payload.aggregation`.

### V — Specialist coverage still cannot reach `ready`, so 1.5's premise was wrong

Membership *is* now written on redemption, and the four orphaned `rlgi_` routes are gone. But coverage requires
`expertise_record_schema_version = 2`, and the sole production writer of that shape has **no component fetching its
route**. `confirmedSeats` is therefore always 0 and `expertise_coverage_insufficient` is permanent.

Membership was not the last missing link. The plan asserted it was; that was wrong, and this review inherits the error.

Related: membership is written on only one of two live invitation issue points — the `WorkspaceReviewersPanel` path
never sets the setup linkage, so it silently mints group-less invitations.

### W — Smaller Phase 1 gaps

- **"Connect another agent" is a label, not a control.** It links to a card gated on `activeIntegrations.length === 0`,
  so with one agent connected it never renders. Its test is a regex on the string.
- **The 1.6 draft fix regressed the audience lane to zero persistence.** The deadline effect is guarded on `/^hpua_/`
  and `acceptAudienceAssignment` returns no expiry, so `haas_` drafts carry `expiresAt: null` — which the store treats
  as *delete*. These previously had ten minutes; they now have none.
- **The invitation email is inline, not enqueued** — a synchronous fetch with no queue row, retry, or dead-letter,
  whose failure is swallowed. With Resend unconfigured the owner sees success and the reviewer gets nothing.
- **Reviewer notifications are legitimately missable** — the producer requires `status='reserved'` against a 15-minute
  TTL, and throughput is ≤5 candidates per 5-minute tick shared with public assignments. A 20-reviewer panel loses
  most of them. The badge is also monotonic: no reviewer surface marks anything read.
- **A tied complete panel is alerted as terminal failure.** A 1-1 split on the default panel of 2 — the most likely
  non-unanimous outcome — reaches the owner as "A human review reached terminal failure."
- **The new failure telemetry is write-only.** `tokenless_scheduled_worker_runs` carries `degraded` plus retry
  identifiers, and nothing in `app/`, `components/`, or `lib/` reads that table. The reachability failure mode the plan
  was organised around, reintroduced by the commits meant to fix it.
- **Poison-pill head-of-line blocking** in the evidence projector: `LIMIT 20 ORDER BY completed_at ASC` with no attempt
  counter, backoff, or dead state, while sibling processors all carry one. Twenty stuck deliveries block every newer
  review permanently.

**1.2 is the one item that is fully clean** — all four processors bound and running in the cron, `inconclusive` in the
event projection, and expiry reason codes mapping correctly to `oversight.review_expired`.

## 5. Deliverables that were never written

Four of §2's own sub-deliverables are absent, and the verification document closes §2 without disclosing them:

- **Place-of-birth TIN.** `paidEligibility.ts:744` still accepts free-text `noTinReason`, unchanged from the code the
  plan explicitly called out. Contradicts the legal reference's DAC7 dataset.
- **Residence-conditional form.** `PaidEligibilityClient.tsx:260-337` renders the full form to everyone; non-EU
  applicants transmit a home address the server then silently discards. The plan specified one residence question first.
- **Plausibility check.** Zero implementation. `requiresDac7` is a pure function of the self-declared country with
  nothing corroborating it — the legal reference names plausibility checks as part of the duty.
- **Geoblock.** Zero implementation, and no wallet screening. The legal reference requires both.

Also absent: an explicit decline path (so the §23 advisory-only position cannot be evidenced), DAC7 retention
scheduling (account deletion destroys the record §147 AO requires retaining), and the provider abstraction itself —
`selfAssuranceAdapter.ts` still has zero importers, and "pluggable" sanctions is one hard-coded `'manual:v1'` literal.

---

## 6. Partial adoption

**Form primitive — good primitive, ~58% adoption.** The table is genuinely single-source (the VAT client cap now
derives from it, matching the server), 9 of 10 title-less `pattern=` attributes are fixed, and the server `field`
discriminator is real. But:

- **Focus never moves to the first invalid field.** No `.focus()` or `scrollIntoView` in `Field.tsx` or
  `useFormErrors.ts`, or any consumer. The claim has no code behind it.
- **66 hand-rolled controls remain**, including **23 raw `<select>`** with no error slot. Server-side `field` adoption
  is 240 / 2276 (10.5%).
- **The highest-priority retrofit was skipped** — the plan ordered rating surfaces first;
  `HumanAssuranceRaterClient.tsx` has 1 `Field` against 5 raw inputs and a raw rationale textarea.
- **The coverage guard is blind to it**: it regexes `<input` only, over a hard-coded list of 16 files.

**Receipts.** Neither lane persists one. The private lane's `initialServerAcceptance` prop has **no production
caller** — only tests. A surface the test renders and the product cannot.

**Subject access/export.** Genuinely fixed server-side and wired into cron, but **zero UI callers** — while the
privacy notice states completed exports are available to the requesting principal for seven days.

**Notification dead-lettering.** There is still no configuration-error branch; a misconfiguration consumes attempts
identically to a network failure. The window widened from ~1h to ~15 days, which is real mitigation, but the claimed
retryable/parked config state does not exist.

---

## 7. What genuinely holds

Substantial and worth protecting:

- **Deployment secrets** now fail closed on both the test and production paths, with real tests for missing and short
  values — the two most likely first failures are closed.
- **Scoring-beacon gate** correct and genuinely mirrored in SQL, with no sibling gap.
- **Race classifier** replaced the regex with structured selector matching, and proves an unrelated revert is not
  suppressed.
- **Forecast integrity codes enter as plain reason codes, never limitation codes** — the highest-risk mistake in
  Phase 3 was avoided, so no historical verdict is un-published.
- **Key-space disjointness is enforced in SQL**, not by convention; Brier skill is a genuine skill score; only running
  sums are stored and the forecast is nulled at terminal aggregation.
- **The evidence-identity allow-list landed *before* the rename**, so `evidence_conflict` never fires.
- **Adaptive**: 25% floor, reset ordering corrected above the window-size guard, default demoted to `always`.
- **HMAC subject domains byte-identical** — no binding orphaning.
- **Privacy**: `better_auth_user_id` erasure with cascade and guard, OTP/session purges wired to cron, analytics
  removed, DPA/subprocessor/cookie notices published, non-mutating audit export.
- **Route test coverage improved to 82/202 (41%)**, and the migration-journal test now looks itself up by tag. The new
  tests are genuine behaviour tests against pg-mem running the real migration journal, with no handler mocking.
  **Correction to the plan:** the "12 of 194" baseline it cited was wrong — the true figure at `bb3dd3d86` was 41 of
  194, so this batch added 34 rather than 70. And "authenticated success and denial paths" does not hold for 20 of the
  34 touched routes: the largest contributor asserts only 401/403 and never creates a session, so for POSTs the CSRF
  guard fires before the handler body runs.
- **Playwright mobile project** exists, runs in CI, with genuinely mobile-specific assertions.
- **Migration journal integrity**: 148 entries, one declared excision, no orphans, `when` strictly increasing.

---

## 8. The pattern worth naming

**Five tests in this batch encode a defect rather than detect it:**

1. `check-tokenless-production-readiness.test.mjs` — same wrong default import as the broken build.
2. `mechanismHealth.test.ts` — still asserts the SQL string; only the literal changed.
3. `crowdForecastPersistence.test.ts:114-131` — asserts the restriction persists *after* an accepted appeal.
4. `PublicQuestionCard.test.ts:68` — asserts `/Technical details/`, so the console cannot be removed.
5. `tokenless-keeper.test.ts:521-533` — encodes feed-lane starvation as expected output.

A test that asserts source text, or asserts current behaviour without asking whether that behaviour is correct, does
not protect anything — it cements. Combined with the build not being in the verification loop, this is how 147
commits of genuine work still shipped two build blockers and five unreachable surfaces.

**Recommended process changes**, in order of value:
1. Put `yarn next:build` in the pre-merge gate.
2. For each claimed fix, require a test that **fails on the parent commit**.
3. Replace source-string assertions with behavioural ones where the behaviour is reachable.
4. Stop citing a green claims sweep as evidence; the matchers are tautological.

---

## 9. Suggested fix order

1. **P** — remove the `NODE_ENV` escape from the compliance gate, compare the derived activation reference rather than
   its format, and move the gate onto the spend paths. Until this lands, "default off" is not true off-production.
2. **A** — invited-paid workspace binding. Blocks the lane the eligibility redesign was for.
3. **Q** — wire the voucher bridge, or the paid evidence packet will assert a falsehood for every seat.
4. **C** — keeper round isolation and revert the new throw. Ongoing risk to live work.
3. **B** — render the fund-resolution control; document and require the compliance-operator secret. Unblocks GDPR erasure.
4. **G** — guard the receipt effect. Actively lies to a reviewer who just succeeded.
5. **D** — treat a resolved-accepted appeal as clearing the restriction; add decay or windowing.
6. **F** — delete the console and its test; surface the real message.
7. **E** — derive the capability state; replace the tautological matchers.
8. **H, I** — durable sanctions record; lane-scoped legal/payout rows.
9. §5 missing deliverables — geoblock first, then place-of-birth TIN, conditional form, plausibility check.
10. §6 partial adoption — focus management, then the rating surfaces the plan ordered first.

---

## 10. Method and limits

Six adversarial verification agents covering deployment/services, Phase 1 reachability, eligibility and providers,
paid lanes and recovery, forecast and adaptive, and UX/forms/copy/privacy. Every finding reported above was
independently confirmed in source by the coordinating session before inclusion; agent claims that did not survive were
dropped.

**Not covered:** no `yarn e2e` run was performed. No deployed environment was inspected, so nothing here speaks to
whether the required secrets are actually set on the Vercel or Railway projects — though `vercel.json` currently sets
`"deploymentEnabled": { "tokenless": false }`, so nothing is live. There is also **no E2E covering the owner
decision-packet journey**, which is the central Phase 1 claim.

**One error corrected in this review:** the plan's "12 of 194 route modules" baseline was wrong; the true figure was 41
of 194. The finding it supported — that the HTTP boundary was badly under-tested and the one live security hole lived
in that gap — still holds, but the improvement is smaller than the plan implied.

**A premise this review inherits and now retracts:** the plan asserted that creating private-group memberships would
unblock specialist expertise coverage. It does not (finding V). The membership work was correct and necessary; it was
not sufficient, and the plan should not have presented it as the last missing link.

Nothing in this review constitutes a release approval, and no technical control here substitutes for the counsel
review the legal reference requires.

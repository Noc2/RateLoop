# Tokenless completion plan — 25 July 2026 (revision 2)

**Goal:** every capability the product claims actually works. Not disclosed as missing — *working*.
**Baseline:** `tokenless` @ `4e11c6eb3`, migration head `0135`. Verified green: 1723 app tests, keeper 74/74, ponder 48/48.
**Source:** eleven design and gap-analysis agents across two rounds, every claim re-verified in source.
Resolves [tokenless-product-readiness-audit-2026-07-25.md](tokenless-product-readiness-audit-2026-07-25.md).

Revision 2 changes the plan materially. Round one asked *does the code exist* — and it mostly does, often to a high
standard. Round two asked *can a person reach it*, and that is where the product breaks. It also removes the identity
vendor from the critical path entirely.

---

## 1. The finding that reorganises everything

**Nearly every remaining blocker is a complete, well-built subsystem with no way to reach it.** Not missing code —
missing wiring. Six examples, each verified:

| Subsystem | State | Consequence |
| --- | --- | --- |
| `createAssuranceRun` | one occurrence outside tests: its own definition | The entire results half of the owner UI reads a table nothing writes. **The decision packet is unreachable.** |
| Workspace API keys | `createWorkspaceApiKey` has no callers; `api-keys/` route dirs are empty | A direct HTTP/SDK integrator cannot obtain a credential at all |
| Self-reveal / self-claim | no route, no component | An undecryptable commit is **unpayable through every terminal path**, and the keeper sweeps the funds back |
| Private-group invitations | only writer of `..._memberships` has no UI caller | Specialist expertise coverage is structurally unreachable |
| Reviewer notifications | rows written; `/api/notifications/inbox` built | Only the *owner* dashboard reads it. A reviewer is never told work exists |
| `verifySecurityAuditChain` | no callers, no export route | The audit chain is write-only |

This is why the round-one audit missed them: it verified capability, not reachability. **The plan is now organised
around reachability first.**

---

## 2. Eligibility: the vendor leaves the critical path

Revision 1 said an identity vendor gated three of four lanes and was the longest pole. That was wrong, and your
[legal reference](tokenless-legal-revenue-reference-2026-07.md) says so explicitly:

> **DAC7 ≠ KYC:** the duty is a self-declaration form (name, DOB, address, TIN-or-place-of-birth) plus plausibility
> checks against records already held (IP, phone, locale — no ID documents, no biometrics)

Today `submitPaidEligibility` welds seven distinct obligations into one all-or-nothing transaction, and three of them —
identity, adulthood, sanctions — arrive in a single vendor-signed payload. Decoupling them is first-party work.

### Eligibility by `(lane, compensationMode)`

| Predicate | invited + unpaid | invited + paid | network paid | hybrid |
| --- | --- | --- | --- | --- |
| Membership / invitation | required | required | — | required |
| `customer_invitation` assertion | in-memory | **persisted** | — | persisted |
| Payout binding + setup | — | required | required | required |
| Residence question | — | required | required | required |
| DAC7 full form (EU residents) | — | required | required | required |
| Sanctions `clear` | — | required | required | required |
| Adulthood | — | attested — **decision D1** | provider or self | as network |
| `unique_human` (World ID) | — | **not required** | required | required |
| Document / biometric | — | **never** | never | never |

**Invited + unpaid already requires zero data** — verified: the unpaid adapter does not import the preflight at all.

### Provider layer — much further along than expected

- `tokenless_provider_subject_bindings` is already keyed `(provider_id, provider_namespace, subject_reference_hash)`,
  so multi-provider was designed in from migration `0003`.
- **World ID is substantially built**: 781-line `worldIdAssurance.ts`, a profile panel, `@worldcoin/idkit` 4.2.0.
- **`selfAssuranceAdapter.ts` already exists** — 178 lines, complete, tested, zero production importers, behind five
  unset gates. It attests `document_holder`, `minimum_age`, `issuing_country`, `nationality`. Adding Self is store
  wiring plus a DPA, not new work.
- Capability composition already works correctly in `admissionPolicy.ts`. The break is one hard-coded pair in
  `paidReviewEligibilityPreflight.ts:174-214` demanding `account_control` **and** `minimum_age` from the
  `provider_evidence` key domain — which is exactly what makes World ID unusable there.

**Preserve the two HMAC subject-domain strings byte-for-byte** when extracting the shared store, or every existing
binding is orphaned.

### Two defects that make invited-paid unreachable regardless

- `loadVoucherEligibility` selects qualifications by `rater_id`, but every `customer_invited` row is written with
  `rater_id NULL`. So `issuePaidVoucher({reviewerSource:"customer_invited"})` always throws.
- Invited admission policies require a `customer_invitation` capability from provider `rateloop:invitation` that
  nothing ever persists — it is synthesised in memory, and only on the unpaid branch.

### Sanctions

No provider on the list screens sanctions, and **no screening code exists in this repo**. The geoblock the legal
reference requires has zero implementation. Decouple it into a first-party record with a pluggable source: `manual:v1`
(operator screens against EU consolidated + OFAC SDN, records the decision and a list-snapshot hash — zero lead time)
or `opensanctions:v1` (a data source, self-serve, days). Represent the queued state as `sanctions_status='pending'`,
which the preflight already fails closed on with no constraint change.

Honest consequence: manual screening makes invited-paid unlock a **human-latency step**, not instant.

### Net effect

**The invited-paid lane loses its vendor dependency completely** — and note World ID does not unblock it either, since
`unique_human` is precisely the predicate that lane does not need. What still blocks private-paid is the Phase 5 chain
work, which was never vendor-gated. D1 drops from "gates all three paid lanes" to "optional, network only, for age."

Still genuinely external: World ID app registration (days), OpenSanctions if chosen (days, zero if manual), counsel
sign-off on the self-declaration posture and rater adulthood, a Self DPA if the network lane needs attested age. BZSt
onboarding is **not a launch gate** — it starts in the first calendar year raters are paid.

Effort: **4–5 weeks**, all first-party.

---

## 3. Phase 0 — this week (~8 days, no external dependency)

| # | Work | Why now | Effort |
| --- | --- | --- | --- |
| 0.1 | **Require `TOKENLESS_MCP_RATE_LIMIT_SECRET` and `CRON_SECRET` in the test-deployment preflight** | Verified: the loop registers them *only if present*. Unset → every agent gets 503 on first contact, and the 5-minute cron 503s forever. The two most likely first failures, both one-line fixes | 2 h |
| 0.2 | **Branch the accept route on compensation mode** | A paid private assignment can be accepted today with no funding, bound round, or voucher | 2 d |
| 0.3 | **Surface `blockingReason`; gate the audience and compensation selectors; derive the MCP capability response** (both copies, `protocol.ts:203` and `:282`) | Stops owners configuring dead lanes | 2–3 d |
| 0.4 | **Fix keeper round starvation** + gate `finalize_scoring_seed` on the scoring-beacon timestamp | Only item causing ongoing loss of work | 1.5 d |
| 0.5 | **Isolate maintenance processors** so one failure cannot abort the tick; move the webhook decrypt inside its `try`; allow retry of a failed bucket | Same failure shape as the keeper bug, in a second service | 1 d |
| 0.6 | **Hybrid two-cohort policy emission** — a live contradiction where any hybrid policy fails today | Makes hybrid testable later | 1 d |
| 0.7 | **Delete dead surfaces**: pilots route, four superseded `agent-review-policies` routes, post-round-appeal writer, ~90 empty directories | Route surface is unreadable | 1 d |
| 0.8 | **Start Resend and World ID registration** | Lead time, not engineering | owner |

---

## 4. Phase 1 — make the working lane reachable (~3 weeks)

This is new in revision 2 and is now the highest-value phase. Without it the one lane that works produces nothing an
owner or reviewer can see.

**1.1 The decision packet (2–3 w).** Wire the private-unpaid terminal envelope into a run/packet projection so the
evaluations dashboard, decision signals, evidence packets and client decisions have data. Revision 1 scoped this to the
paid lanes; it must cover the unpaid lane, which is the only one that runs. Render the settlement evidence and reviewer
provenance that `evidencePackets.ts` already computes and no JSX displays.

**1.2 Reviews must terminate without the agent (1 d).** `reconcileDirectPrivateReviewDeadline` is reachable only when
the requesting agent polls. Add it, `expireAudienceAssignments`, and `expirePrivateUnpaidReviewReservations` to the
cron. Add `inconclusive` to the event projection so expiry alerts can fire at all — today `oversight.review_expired`
can never fire for the only working lane.

**1.3 Reviewer notification surface (1–2 d).** Add direct private assignments as a notification source, and a badge in
`HumanTabs` reading the inbox API that already exists. Both halves are built; nothing connects them.

**1.4 Invitations that arrive (1.5 d).** No invitation of any kind is delivered today — the owner copies an opaque
60-character code out of band with no URL and no instructions. Add the destination URL at both issue points and an
invitation email.

**1.5 Private-group membership on redemption (2 d).** Have `redeemWorkspaceReviewerInvitation` also insert a membership
row, then delete the four orphaned `rlgi_` routes. **This is a hard prerequisite for the expertise work** — without it
specialist coverage is unreachable no matter what UI is built.

**1.6 Draft survival (0.5 d).** The private rationale draft envelope is bound to the 10-minute *lease* rather than the
assignment deadline, so a rationale typed for more than ten minutes is deleted by its own autosave; and "Refresh
access" unconditionally overwrites on-screen text with the now-empty draft. Two small fixes, both destroying real work
today.

**1.7 Workspace settings without an agent, and a second agent (1.5 d).** Settings — members, billing, deletion — are
gated behind having a connected agent, and there is no button anywhere to connect a *second* agent.

**1.8 Route-layer tests (ongoing).** Only 12 of 194 API route modules are imported by any test. The one live security
hole lives in that gap. Require a colocated route test for every route touched from here on, starting with
`app/api/rater/**` and `app/api/account/assurance/assignments/**`.

---

## 5. Phase 2 — foundations (~2 weeks, parallel)

**2.1 Form primitive (3–4 d).** `lib/validation/fieldFormats.ts` holding one regex, one length limit, one `title`, one
message per format — which kills both the VAT `maxLength={80}`-vs-64 mismatch and the ten title-less `pattern=`
attributes. Then `Field` and `useFormErrors`. The server half is one edit reaching all 171 routes: add `field` to
`TokenlessServiceError` and `tokenlessErrorResponse`. The DAC7 form is a hard dependent.

**2.2 Capability registry (2 d).** Replicate the existing `hostCapabilities.ts` idiom — claims "match code by
construction", unavailable things "represented by their absence". Extend the claims sweep to `components/tokenless/**`
**and `plugins/**/*.md`**, which ship pointing at live endpoints and advertise both dead lanes.

**2.3 Evidence identity allow-list (0.5 d).** Rebuild `immutableFinalizedEvidenceIdentity` from an explicit field list
instead of spread-and-zero. **Must precede any analytics key change**, including the `correlationRiskBps` rename.

**2.4 Keeper and Ponder correctness (2.5 d).** Race classifier, identity mismatch failing closed, zombie startup,
bounded log scan, `CreditWithdrawn` indexing, and the `mechanismHealth` join on `'finalized'` where the only writer
emits `'round.finalized'` — whose test asserts the SQL string, pinning the bug rather than catching it.

---

## 6. Phase 3 — the crowd forecast as an honesty signal (~3 weeks)

`35a0038c0` already collects the forecast in the unpaid lane; nothing reads it back.

**The constraint:** unpaid, RBTS is not incentive-compatible — it is only a diagnostic. Entering 50% every time is
free, so a *high* score is weak evidence. Favour detectors where the informative direction is **absence of signal**.
Panels are small, so per-reviewer accumulation across rounds is the viable unit, not per-round peer scoring.

**3.1 Calibration accumulator (5–7 d).** Running sums only, never per-observation history — that choice is what makes
the privacy story defensible. The discriminating statistic is the **Brier skill score**: a constant reporter scores ≈0
by construction however well-calibrated their constant. Two deliberately disjoint key spaces (invited keyed by
principal + workspace, network by `rater_id`) so invited calibration is *invisible* to network admission, not merely
deprioritised. Must be added to `accountDeletion.ts`.

**3.2 Low-effort detection (2–3 d).** `forecast_invariant` (no outcome needed, works at panel size 2),
`forecast_discrimination_absent`, and `forecast_vote_decoupled` — the last always soft, since a fixed belief about the
crowd with a varying own-vote is coherent.

**3.3 Pair lockstep (3–4 d).** Compute the null against the workspace's own forecast histogram, not uniform-over-99.
The sharper statistic is the **variance** of pairwise distance, not the mean — that is the false-positive control that
keeps honest heterogeneous priors from tripping it.

**3.4 Consequences and appeal (3–5 d) — lands with or before 3.1.** New codes enter as plain `reasonCodes`, **never as
limitation codes**: any limitation code forces `insufficient` → `inconclusive`, which would silently un-publish every
historical verdict. Reviewers must see their own counters and be able to appeal, with an open appeal suspending the
consequence while the finding stays append-only.

**3.5 `forecastRequired`.** Keep it mandatory only if 3.1–3.2 land in the same iteration. Otherwise make it optional —
a required field nothing reads *manufactures the failure mode you are trying to detect*, because reviewers learn to
type a constant.

**3.6 Rename `correlationRiskBps`** to `assignmentProvenanceGapBps`, after 2.3.

---

## 7. Phase 4 — rating, forms, copy (~2.5 weeks, parallel)

Rating-flow blockers (required feedback ungated; server errors swallowed into a generic string and buried in a
`<details>` developer console; source-URL errors discarded). One `CrowdForecastField` for both lanes restoring the
slider — **but unset, not seeded** (§9, Q2). The insight-bonus overstatement. Post-submit receipt. Window-scoped
shortcuts. The response deadline, which is returned by the API, declared by the client, and never rendered — so a
reviewer cannot see when their work is due. Deadline-passed and revocation handling that currently dead-ends.

Mobile is genuinely broken and untested: private artifact text is clipped at 375px with `overflow-hidden` and no
"Show more" below 900 characters, so **the reviewer silently never sees part of the material they are judging**; the
recovery-backup download uses a mechanism that fails in iOS webviews and gates submission; images force two columns at
every width. No automated check ever runs at a mobile viewport — add a Playwright mobile project.

Copy: make `SetupChoiceGroup.description` optional (it is required today, which is why every option ships helper text);
ban `text-base-content` below **`/55`** (the design token's own value — `/60` would orphan it); AST vocabulary guard
(142 user-visible strings, ~42 need rewriting after structural exemptions); make eyebrow+heading+subtitle a type error.

Form retrofit in order: rating surfaces, billing/tax, the three evidence-delivery panels (where a rejected URL is
visually identical to success), auth, then the rest. `AgentSetupFlow` last, one commit per wizard step.

---

## 8. Phase 5 — lanes, and the payment guarantee

**5.1 Self-reveal and self-claim (2–3 d) — do this before any paid lane opens.** There is no `/api/rater/reveal` or
`/api/rater/claim`, and no component builds a reveal transaction. Both `claim` and `claimCompensation` require
`record.revealed`, so a commit the keeper cannot decrypt is unpayable through **every** terminal path — and the keeper
then sweeps those funds back to the funder after the stale grace, with no surface anywhere showing the claim deadline.
This is advertised as working in three places, two customer-facing. The downloaded recovery package already carries
every field `reveal()` needs, so this is UI, not cryptography.

**5.2 Reviewer earnings ledger (1–2 d).** The only monetary figures a reviewer ever sees are prospective, on a card
that disappears when the round closes. No history, no outcome, no payout.

**5.3 The lanes.**

| Lane | Effort | Blocked on |
| --- | --- | --- |
| `private_invited` + paid | 5–6 w | §2 eligibility redesign; 5.1; funded testnet USDC |
| `public_paid_network` | 6–10 w | network-panels policy; World ID registration; the paid lane's settlement reconciler |
| `hybrid_public_safe` | 4–6 w | both above |

Private-paid needs server-side round funding, terminal seat/operation states with a linear monotonic guard, the
private-to-public voucher bridge with a fail-closed panel-identity assertion, and a settlement reconciler —
`settlement_reference` has **zero production writers**, so a paid run cannot currently produce an evidence packet.

Public-network needs both a scheduled integrity-epoch producer *and* the consumer path, since `prepareRunAudience` and
`reserveDiversifiedNetworkSubpanel` have no production callers either.

Hybrid is closer than round one suggested — the schema already models two subpanels and enforces invited-wins dedupe.
It needs the `DEFAULT_DEPENDENCIES` entry, a v4 semantic profile with per-cohort economics, per-cohort expertise, and
**two rounds rather than one** (a single round binds one admission policy, defeating the point).

---

## 9. Phase 6 — the adaptive ladder

**Ship the honest interim now (4–6 h):** demote `adaptive` from default to `always` — behaviourally identical today, so
only the label changes — relabel "Recommended", and disable the minimum-rate field that can never apply.

**Three of five gates are dead, not two.** `human_human_agreement_bps` is written as a literal `NULL` in the private
lane while the gate requires non-null. And a latent bug waits for enablement day: `windowResetReason` returns "no
reset" on an undersized window *before* checking severe disagreement and drift — and at 10% coverage an undersized
window is the normal case.

**The floor question is now settled arithmetically** (§10, Q1): at 10% a 95%→90% regression takes ~292 outputs to
detect, ~259 released unreviewed; at 25% it is ~133 and ~99. Worse, at n=15 the Wilson bound demands 14/15 observed, so
a genuinely healthy 95% scope **false-resets on 17.1% of windows**. The 10% floor is not merely slow — it is barely
reachable. Recommend capping at 25% with a mandatory periodic re-calibration block.

**Keep the Phase 3 signals out of the ladder arithmetic.** Both score against crowd consensus, so a lazy or colluding
panel that agrees with a bad agent raises its own score *and* the agent's — the errors compound. Use them upstream in
assignment eligibility, plus one binary fail-closed veto.

---

## 10. Open questions — three resolved by evidence

**Q1 — adaptive floor: arithmetic settled, risk appetite is yours.** No prior analysis existed. Numbers above.
Recommend 25%.

**Q2 — seeded forecast: resolved. Do not seed.** Three code-level reasons: one rater's forecast sets *another* rater's
pay via the reference-commit rotation; legacy's 60/40 seeds land exactly on the degenerate endpoint of
`shadowPredictionBps` where the information score goes binary; and the repo's own benchmark scores `constant_up` at
9950 bps against an honest 7238, so a seed correlated with the chosen answer manufactures that distribution inside the
sealed input. Restore the slider for the UX win, start it unset, and persist a "touched" flag so 3.2 can exclude
untouched values.

**Q3 — Stripe: resolved. Leave both flags off.** My objection was wrong — the Stripe block never runs on non-`main`
branches. The free plan exactly covers the working lane. **New risk to record:** nothing prevents a live `sk_live_` key
on a testnet deployment; add a test-mode assertion.

**Q4 — thirdweb: resolved, premise wrong twice.** Any successful hosted build necessarily has the client id set, *and*
it is irrelevant to the working lane, which uses `requireBrowserSession` not `requireRaterSession`. Row deleted.

### Still needing a human

| # | Decision |
| --- | --- |
| **D1** | **Rater adulthood for invited-paid.** Self-declared DOB is not verified age. Suggest `customer_attested` — the inviting workspace warrants its invitees are 18+ — but the legal reference lists JuSchG/JMStV as an open counsel item |
| D2 | **`TOKENLESS_NETWORK_PANELS_ENABLED`** — the network half is untestable on the only permitted target. Relax the prohibition to a bounded permission; `reviewCapabilities.ts` remains the authority that actually opens the lane |
| D3 | **Adaptive floor** — 25% cap? |
| D4 | **Workspace funds deadlock** — a workspace that was ever funded can never be deleted (no withdrawal path exists), and its owner can then never delete their account. Refund, or forfeit-and-delete? This is a GDPR erasure problem |
| D5 | **Sanctions latency** — manual screening means invited-paid unlock is not synchronous |
| D6 | **Subject-request route** — it starts a 30-day statutory clock and nothing fulfils it. Build the queue and export, or delete the route |
| D7 | **`forecastRequired`** — mandatory only if Phase 3.1–3.2 land together |
| D8 | **How far the pay copy goes** — accurate, but a claims decision |

---

## 11. Privacy and compliance gaps

Round two surfaced a distinct class that no earlier pass covered, and several are legal rather than UX:

- **Account deletion leaves the user an active workspace reviewer with a live access grant**, while the receipt records
  that category as fully erased. Seven `0130`/`0129` tables are untouched and outside the zero-postcondition guard.
- **Enterprise SSO identity survives deletion** — `better_auth_user_id` with no FK, by design comment, becomes the only
  surviving map from IdP subject to the tombstoned principal after the 35-day guard.
- **Eight `rater_id`-keyed tables** are neither deleted nor checked while the receipt claims erasure.
- **Almost nothing expires.** Three purges exist repo-wide. Raw OTP email addresses of abandoned sign-ups persist
  forever; session rows with IP and user-agent are never deleted.
- **Undisclosed analytics** — Simple Analytics loads on every production page with no processor named in the notice.
- **No DPA, subprocessor list, or cookie policy**, while the Terms position RateLoop as a processor.
- **The privacy notice claims KMS-scoped vault wrapping** that the deployment serving it does not use.
- **`GET /audit/export` mutates state** — behind a download link, so every prefetch grows the chain.
- **Notification emails permanently dead-letter** after ~2h of misconfiguration, so the first queue dies before Resend
  is ever configured.

---

## 12. Timeline

| Phase | Work | Effort | Gated by |
| --- | --- | --- | --- |
| 0 | Preflight secrets, security fix, truth surfacing, keeper + cron isolation, deletions | ~8 d | nothing |
| 1 | **Make the working lane reachable** | ~3 w | Resend for 1.4 |
| 2 | Form primitive, capability registry, evidence identity, keeper correctness | ~2 w | — |
| 3 | Crowd-forecast honesty system | ~3 w | nothing |
| 4 | Rating, forms, copy, mobile | ~2.5 w | Phase 2.1 |
| — | Eligibility redesign | ~4–5 w | counsel on D1 |
| 5 | Self-reveal, earnings ledger | ~1 w | before any paid lane |
| 5 | Private-paid lane | 5–6 w | eligibility + 5.1 |
| 5 | Public-network / hybrid | 6–10 w / 4–6 w | D2, World ID |
| 6 | Adaptive ladder | 4–6 h interim; 7–9 w full | D3 |

Phases 2–4 run in parallel with each other and with the eligibility work.

**A usable product on the invited lane is ~6–7 weeks** — Phase 0 plus Phase 1 plus the parallel foundation work.
**Invited paid adds ~6 weeks** and no longer waits on a vendor. **All four lanes is 4–5 months**, now dominated by
engineering rather than procurement.

---

## 13. Standing constraints

- **Migrations are immutable** — hash-verified at deploy. Forward-only. `db:generate`/`db:push` are disabled.
- **The fund core is immutable and adminless.** No plan item requires a contract change.
- **No signal may affect earned pay.** Everything in Phase 3 carries `payoutEffect: "none"`.
- **Tokenless isolation** — `origin/tokenless` and the isolated projects only.
- **The first new migration breaks** `privateReviewCrowdForecastMigration.test.ts`, which asserts
  `entries.at(-1).idx === 135`. Change it to look up its own entry by tag.
- **Preserve the two HMAC subject-domain strings** when extracting the provider store, or existing bindings orphan.

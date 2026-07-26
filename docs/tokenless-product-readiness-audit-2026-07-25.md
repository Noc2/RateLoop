# Tokenless product-readiness audit — 25 July 2026

**Scope:** what still needs building or fixing before the tokenless product is usable by real people — feature
completeness, UX, and mechanism completeness, not just tests.
**Branch/commit audited:** `tokenless` @ `02f00afb3`.
**Superseded in part:** `origin/tokenless` advanced to `35a0038c0` while this audit was running. Two of the rating
findings were fixed by that work — see the note at the head of §4. Everything else below was re-checked against the new
head and still stands.
**Method:** six parallel read-only audits, each finding re-verified in source before inclusion. Nothing here is
inferred from documentation prose. Where an agent's claim did not survive verification it was corrected or dropped —
see §10.

Companion document: [pre-E2E readiness audit](tokenless-pre-e2e-readiness-audit-2026-07-25.md), which covers the
build/test/tooling layer. This one covers the product.

---

## 1. Executive summary

The engineering is in better shape than the product is. Services are sound, the contracts are complete, the evidence
pipeline works. What is missing is the last mile: **most of the product is switched off, and nothing in the UI says so.**

Three findings dominate everything else:

1. **One of four review lanes works.** `private_invited` + `unpaid` is the only usable configuration. The other three
   are hardcoded off ([reviewCapabilities.ts:34](../packages/nextjs/lib/tokenless/reviewCapabilities.ts:34)).
2. **The owner is never told.** The system computes exactly why a configuration is blocked — `blockingReason`,
   `implementedLanes` — and a repo-wide search finds **zero** `.tsx` files that render either. The owner completes
   setup on a permanently dead configuration and finds out when their agent receives `lane_not_implemented`.
3. **The default, "Recommended" review mode is inert.**
   [adaptiveReviewService.ts:48](../packages/nextjs/lib/tokenless/adaptiveReviewService.ts:48) is
   `ADAPTIVE_SAFETY_GATES_AVAILABLE = false`, so every adaptive evaluation short-circuits to 100% review — while the
   setup UI still labels it `"Adaptive — Recommended"` and offers a minimum-review-rate field that can never apply.

Underneath that sit two quality problems the user identified directly: **field validation was lost in the rewrite**,
and **protocol vocabulary leaks into rater-facing copy**. Both are systemic, and both have a cheap structural fix.

One genuine service blocker was also found: the keeper **permanently starves rounds** whenever the Ponder work feed
returns work (§8, K1).

---

## 2. Direct answers to the three questions asked

### "Crowdforecast for correlation-adjusted RBTS settlement doesn't seem fully implemented"

Half right, and the half that is missing is not the half most people would guess.

**The crowd forecast is complete and does affect pay.** It is collected in the rating UI, converted to bps, sealed into
the tlock payload and the EIP-712 `Reveal` commitment, validated on-chain against the 1%-step grid, and scored:
[TokenlessRbts.sol:53-67](../packages/foundry/contracts/tokenless/libraries/TokenlessRbts.sol:53) computes
`informationScoreBps` and `predictionScoreBps` and averages them, and
[TokenlessPanel.sol:600](../packages/foundry/contracts/tokenless/TokenlessPanel.sol:600) pays
`fixedBasePay + maximumBonus * scoreBps / 10_000`. **The forecast is half the variable bonus.** The Surprisingly
Popular bounty is also fully built and cannot function without it.

**Correlation adjustment does not exist — anywhere.** Not in the fund core, not off-chain.

**Is it integrated into the rating UI?** Yes, but poorly — it regressed from a slider to a bare number box, and the UI
never tells the rater the forecast affects their pay (§4, R5/R9).

**Is it used for evaluation and finding honest ratings?** No. This is the real gap. `predictedUpBps` is a 99-valued
private belief committed before any peer signal is visible — the strongest honesty signal the system has — and it is
discarded after settlement. It feeds no calibration, no reviewer qualification, no lazy-reporter detection, no
collusion analytics. Tokenless's only integrity evaluator does not even receive the field
([postRoundIntegrity.ts:18-27](../packages/nextjs/lib/tokenless/postRoundIntegrity.ts:18)).

**Why the impression that a correlation layer exists:** the one field named for it measures something else entirely.
[transparency.ts:1053](../packages/nextjs/lib/tokenless/transparency.ts:1053) defines
`correlationRiskBps = |revealCount − assignment-matched reports| / revealCount` — an assignment-coverage shortfall
ratio with no relationship to vote correlation. It is also zeroed out of the canonical evidence identity. **Rename it.**

**`main`'s correlation layer cannot be ported.** It is union-find Sybil clustering whose output enters settlement as
`commitRbtsWeight` ([RoundRbtsSettlementSnapshotLib.sol:89](../packages/foundry/contracts/libraries/RoundRbtsSettlementSnapshotLib.sol:89)
on `main`), and the whole path hangs off `setClusterPayoutOracle` under `CONFIG_ROLE`, with an `ARBITER_ROLE` backstop
and stake-gated proposers. Tokenless's fund core is adminless by construction
([TokenlessPanel.sol:15](../packages/foundry/contracts/tokenless/TokenlessPanel.sol:15)). Any equivalent must be
off-chain and payout-neutral — which is exactly the shape `postRoundIntegrity.ts` already has.

**Status:** deliberate descope, correctly gated. The subsystem was deleted on 2026-07-12 in `0b7d181ea` /
`3f9201f1a` during the greenfield rebuild, and "cross-round correlation analytics" is listed as blocking in the
readiness register (W2 and W11 rows). It is not forgotten — but the design of record asserts in the present tense that
the operator *controls* "correlation analytics" ([plan:64](tokenless-immutable-implementation-plan-2026-07.md)), which
is not true today.

### "Showing users if they entered the wrong information into a field"

Confirmed, and it is a straight regression from legacy.

Legacy `main` had a consistent, good pattern: red `input-error` border on the control, red message directly beneath it,
re-validating live on change and blur, with character counters on every `maxLength` field. See
`main:packages/nextjs/components/profile/DelegationSection.tsx:555-573` and
`main:packages/nextjs/components/submit/ContentSubmissionSection.tsx`.

Tokenless dropped all of it. Every form hand-rolls one `useState` error and paints a single banner at the **bottom of
the panel**, sometimes hundreds of lines of JSX away from the field at fault. There is **no shared field primitive**,
and **`aria-invalid` appears zero times in the entire app**. `main` also ships
`e2e/tests/form-validation.spec.ts`; tokenless has no equivalent. Full detail in §5.

### "Sometimes small descriptive text that shouldn't be there"

Confirmed, and it is structural rather than editorial. **160 occurrences** of `text-base-content/40` or `/45` — the
low-contrast tier AGENTS.md explicitly calls a product defect. The root cause for the setup flow is a component API:
[SetupChoiceGroup.tsx:58](../packages/nextjs/components/tokenless/agents/setup/SetupChoiceGroup.tsx:58) renders
`{description}` unconditionally, so *every* choice option is forced to ship helper text. Full edit list in §6.

---

## 3. Blockers, ranked

| # | Finding | Area | Est. |
| --- | --- | --- | --- |
| P1 | Setup lets an owner choose a permanently dead lane and never says so | Product | 1–2 d |
| P2 | Keeper permanently starves rounds when the Ponder feed returns work | Service | 1 d |
| P3 | Required feedback is never gated; submission fails forever with a swallowed error | Rating UX | 0.5 d |
| P4 | No shared field validation; `aria-invalid` used nowhere | Forms | 3–5 d |
| P5 | Adaptive coverage is the "Recommended" default and is inert | Product | 4 h (honest) / 2–4 w (real) |
| P6 | Reviewer expertise has no UI at either end, so specialist configs never route | Product | 2–3 d |
| P7 | Nobody can sign up — no email provider configured | Provisioning | 1 d |
| P8 | Public docs advertise paid panels, the reviewer network, and the coverage ladder — none available | Docs | 2 d |

---

## 4. Rating experience

Findings are ordered by how badly they trap a rater.

> **Partly superseded by `86638d052` / `35a0038c0`.** Those commits added `advanceHint` to `ReviewerShell` and a
> `"Add at least N characters of decision rationale."` message wired through it, which **fixes R3 and R8 in the
> private flow**, and added `predicted_positive_bps` to private review responses (migration `0135`) so the private
> lane now collects a crowd forecast too. `PublicQuestionCard.tsx` was **not** touched, so R1, R2, R4, R5, R6, R9 and
> R11 still stand as written — and R3/R8 now apply only to the public card, which still has no equivalent hint.
> The `advanceHint` mechanism is the right primitive for fixing R8 there: reuse it rather than inventing another.

### R1 — Required feedback is never gated *(blocker)*
[PublicQuestionCard.tsx:631](../packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:631) —
`advanceDisabled` checks `answer`, `prediction`, `alreadyVouchered`, and `recoveryConfirmed`. It never references
`feedbackBody`. With `rationale.mode === "required"` and an empty textarea the button is fully enabled; submission
fails server-side with `Feedback must contain 1-1500 characters.`; that message is discarded and replaced with
`"We couldn't create your recovery backup. Try again."` The rater retries identically and fails forever.

**Fix:** include the minimum in `advanceDisabled`, show a live `… characters to go` under the textarea, focus it on a
blocked submit.

### R2 — Every real error is replaced by a generic string, and the cause is hidden in a collapsed `<details>` *(blocker)*
[PublicQuestionCard.tsx:445](../packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:445) and
[:859](../packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:859). `lib/tokenless/http.ts:32-39`
already extracts the server's message, and the *private* flow shows it verbatim — the public flow throws it away. In
the retry branch, `scheduleRetry` then overwrites `technicalStatus` with timer text, losing the cause entirely.

This also breaks AGENTS.md directly: a `<details>` must never be the only route to information needed to complete the
task safely. Legacy did the opposite — `main:StakeSelector.tsx:747-749` renders the actual error under the confirm
button.

**Fix:** surface the server message inline; delete `technicalStatus` and its `<details>` entirely.

### R3 — Private review hides a 10-character rationale minimum *(blocker)*
[HumanAssuranceRaterClient.tsx:205](../packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx:205) floors
the requirement at 10 characters; it gates the submit button. The textarea has no counter, no hint, no error, and a
bare `minLength` attribute that does nothing outside a submitted `<form>`. A reviewer who writes "Wrong." sits on a
dead button with zero feedback. The public card at least has a counter.

### R4 — Source-URL errors are swallowed *(major)*
Typing `example.com` into the optional HTTPS source box produces a correct
`"Source URL must be a valid HTTPS URL."` from
[publicResponse.ts:100-113](../packages/nextjs/lib/tokenless/rater/publicResponse.ts:100) — which R2 then discards.
Validate on blur and print the message under the input. *(Note: a second, unguarded `new URL()` at `:152` is
redundant defensive debt, not a reachable crash — see §10.)*

### R5 — The crowd forecast regressed from a slider to a bare number box *(major)*
Both branches use the same 1–99% range, so no bps leaks to the user. But the control lost a lot:

| | legacy `main` | tokenless |
| --- | --- | --- |
| control | `<input type="range">` | `<input type="number">` |
| starting value | seeded 60 / 40 / 50 by chosen answer | empty |
| live readout | large `{n}% up` | none |
| range labels | `1%` … `99%` | none |
| screen reader | `aria-valuetext` | none |
| explanation | tooltip: *"…This forecast helps determine rewards; it is separate from your own vote."* | one grey line that never mentions pay |

**Fix:** restore the slider with a seeded default, a large live `%` readout, end labels, and an `InfoPopover` carrying
the legacy explanation.

### R6 — No receipt after submitting *(major)*
[PublicQuestionCard.tsx:583](../packages/nextjs/components/tokenless/answer/PublicQuestionCard.tsx:583) sets
`"Recorded"` then immediately calls `onSubmitted()`, which reloads the list and unmounts the card — the confirmation
vanishes. Legacy showed an explicit receipt echoing the vote and forecast. The private flow does this correctly today;
copy it.

### R7 — Global shortcuts mutate an off-screen card *(major)*
[ReviewerShell.tsx:49](../packages/nextjs/components/tokenless/review/ReviewerShell.tsx:49) binds `keydown` on
`window`, and `AnswerPageClient` enables shortcuts for `index === 0`. With several tasks queued, pressing `1` while
scrolled to the fourth card flips the **first** card's answer, off-screen and unannounced.

### R8 — The disabled button never says what is missing *(major)*
The label only ever reads "Create recovery backup" / "Submit rating". When the block is a missing answer, forecast, or
required feedback, the label is unchanged and the button is simply dead. Prefer keeping it enabled and showing inline
errors on click.

### R9 — The rater is never told the forecast affects pay *(minor, high leverage)*
The help text says only *"Enter a whole number from 1 to 99. Your forecast stays hidden until settlement."* It never
says the forecast sets half the quality bonus and all of the insight bonus. RBTS is only incentive-compatible if
raters know that an honest forecast pays. Copy-only fix, ~1 hour.

### R10 — Smaller items
- `"Case 1 of 1"` and a 100%-full progress bar render on every public card (`totalCases` is hardcoded 1).
- Guaranteed earnings are printed twice on the same card.
- `"Attempt $0.02"` and `"Insight bonus"` are unexplained; `InfoPopover` exists and is used on agent/workspace screens
  but **never once** in the rater journey.
- `DeadlineChip.tsx:31` puts the exact deadline in a `title=` on a non-focusable `<span>` — unreachable by keyboard or
  touch, an explicit AGENTS.md prohibition.
- Touch targets: `input-sm`/`select-sm` are 32px and the backup confirm checkbox is ~16px, in a money-bearing flow.
- The public image lightbox has no focus trap; the sibling `PrivateArtifactPreview` implements one correctly — copy it.
- A single-case private assignment submits directly from `Enter` with no confirmation, permanently closing it.
- The axe check runs *before* any interaction, so none of the above is ever scanned.

### R11 — Insight bonus is overstated *(major, customer-facing claim)*
[raterService.ts:174](../packages/nextjs/lib/tokenless/raterService.ts:174) advertises the formula cap alone, while the
actual reservation is `min(formulaCap, feeAmount / maximumReports)`
([surpriseBountyService.ts:117-130](../packages/nextjs/lib/tokenless/surpriseBountyService.ts:117)). A **zero-fee round
advertises a bonus that can never be paid** — the spec says a zero-fee round has no entitlement at all. ~30 minutes.

Related: `getSurpriseBountySummary` has **no consumers** — a rater is promised an insight bonus and has no surface
telling them whether they earned it.

---

## 5. Form validation

**Recommendation: build one shared primitive and retrofit. Do not patch surfaces individually.**

Proposed: `components/tokenless/ui/Field.tsx` + `useFormErrors.ts`, owning label/`id`/`aria-describedby`/`aria-invalid`
wiring, the legacy `input-error` class, a message slot beneath the control, and an optional character counter.
`useFormErrors` runs validation, focuses and scrolls to the first invalid field on failed submit, and maps server
`{ code, field, message }` back onto the right field. Routes should return `field` so errors stop landing in a
detached banner.

Then a shared validator module for the recurring formats — 2-letter country, VAT ID, USDC decimal, HTTPS URL, domain,
the `rli_`/`haas_`/`sec_`/`vault://` prefixes, `sha256:` digests — so client and server share one message vocabulary
**and one length limit**.

### Worst offenders

| Severity | Surface | Problem |
| --- | --- | --- |
| P0 | `SiemEvidenceDelivery`, `WormEvidenceDelivery`, `GrcEvidenceDelivery` | Success and failure share one state and render identically — 12px grey `role="status"`. A rejected URL looks exactly like "created". |
| P0 | 9 `pattern=` attributes, none with `title` | The only feedback is the browser's generic "Please match the requested format", unstyled and invisible to the panel. |
| P0 | Workspace billing/tax | No client validation on a 12-field form; the banner has no `role="alert"`; **client `maxLength={80}` vs server cap 64** on VAT ID; server errors leak raw field names — the user literally sees `"vatId must be at most 64 characters."` |
| P0 | `AgentSetupFlow` | One error state for a 2,366-line multi-step flow, rendered once at the very bottom, ~600 lines of JSX below the fields it describes. |
| P1 | Auth | Bad OTP produces a bottom banner, no focus return; two buttons disable silently with no explanation. |
| P1 | Invitation codes | `type="password"` so you cannot see what you pasted, no prefix check, no feedback until a round trip. |
| P1 | Member/reviewer invites | One banner shared with role-change, removal, and revoke failures — you cannot tell which action failed. |

### Accessibility

| Property | Status |
| --- | --- |
| `aria-invalid` | **0 occurrences repo-wide** |
| `aria-describedby` → error | **0** (the 11 uses all point at hints) |
| Focus moved to first invalid field | **never** |
| Character counters on `maxLength` | **0** (legacy had them) |

Legacy lacked `aria-invalid` too, so the fix should adopt legacy's visuals *plus* the wiring legacy was missing.

---

## 6. Copy and microcopy

Six systemic patterns account for nearly every violation. Fix the pattern, not the 60 lines.

| Pattern | Root cause | Fix |
| --- | --- | --- |
| **A** Protocol vocabulary in rater copy — `voucher`, `commit`, `tlock ciphertext`, `vote key`, `sha256:`, `salt`, `beacon` | The rater flow narrates the state machine | Ban a word list from JSX literals with a test, mirroring the one already at `page.test.tsx:91` |
| **B** A helper paragraph under every control (~206 hits) | `SetupChoiceGroup.description` is **required** | Make it optional; delete descriptions that restate their label |
| **C** Eyebrow + heading + subtitle triples restating each other | Card template habit | One of the three, never all |
| **D** `text-base-content/40`–`/45` (**160 occurrences**) | — | Ban below `/60` |
| **E** Raw enums and internal IDs as UI — `integrationId`, `principalId`, `intent.status` | Debug affordances that shipped | Delete or map to plain words |
| **F** Empty management surfaces before the prerequisite | — | Gate behind the prerequisite |

### The most egregious individual items

- [HumanAssuranceRaterClient.tsx:803](../packages/nextjs/components/tokenless/HumanAssuranceRaterClient.tsx:803) asks a
  human reviewer to **hand-type a SHA-256 digest** — `required`, `pattern="sha256:[0-9a-f]{64}"`. Nobody possesses that
  value outside the invitation link. Delete the manual-entry branch.
- `PublicQuestionCard.tsx:859-864` ships a **developer console to raters** inside a `<details>`: "Reserving a voucher
  now.", "Sending the sponsored transaction.", "Unable to submit the sealed answer." Delete it and the state behind it.
- `AgentRegistryPanel.tsx:258` renders a raw `sha256:` configuration commitment at `text-[11px] text-base-content/40`.
- `AgentConnectionPanel.tsx:583-590` puts ~90 words of adaptive-ladder spec on an approve/reject screen — and
  advertises a panel that does not exist yet.
- `AgentConnectionPanel.tsx:1463` makes a `Manage connected agents` disclosure the **only** route to Disconnect and
  Reconnect — a direct AGENTS.md violation.
- `FeedbackBonusClaimsClient.tsx:249` buries a genuine privacy disclosure under five protocol nouns, defeating its
  purpose. Keep the disclosure, rewrite it in plain language. *(Its wording is test-locked; assert the meaning instead.)*
- `InvitationRedemption.tsx` is dead — referenced only by a negative test assertion. Delete the file.
- `WorkspaceSettingsClient.tsx:1216` renders an entire "Enterprise identity" section whose only content is that the
  feature is disabled.

`InfoPopover` already exists and is already keyboard- and touch-tested, so every "move to tooltip" verdict is
mechanical.

---

## 7. Feature completeness

### The lane matrix

| Lane | Status | What is actually missing |
| --- | --- | --- |
| `private_invited` + unpaid | **works** | — |
| `private_invited` + paid | off | ~90% built. `acceptPrivatePaidReviewAssignment` ([privatePaidHumanReviewAdapter.ts:462](../packages/nextjs/lib/tokenless/privatePaidHumanReviewAdapter.ts:462)) has **zero call sites — not even a test**. Reviewers can be assigned and vouchered and can never accept. 3–5 d |
| `public_paid_network` | off | Settlement exists; admission does not. `buildIntegrityEpoch` is called only from its own test and `persistIntegrityEpochSnapshot` has no caller — no producer exists. 1–2 w |
| `hybrid_public_safe` | off | Genuinely unbuilt; `assignHybrid` is not even in the dependency map. 3–4 w |

**The silent dead end (P1) is the highest value-per-hour fix in this document.** The setup wizard renders all three
audiences as selectable with no availability gate, and the finalization postcondition computes `reviewLane` without
ever consulting `HUMAN_REVIEW_LANE_IMPLEMENTATION` — so it reports `setupConfigurationIntact: true` for a dead lane.
The truth is computed (`blockingReason`, `implementedLanes`) and shipped **only to the agent** over MCP. Filter the
selectors, add `lane_not_implemented` to the postcondition, render `blockingReason`. ~1–2 days.

### Other product gaps

- **Adaptive coverage (P5)** — inert, yet the default and labelled "Recommended". Two of five gates are hardcoded
  stubs (`driftGatePassed: true`, `severeDisagreementOpen: false`); there is no drift computation anywhere. The
  cheap honest fix is to demote it from default and surface the existing truthful summary string. ~4 hours.
- **Agent-written questions (A3)** — choosing this mode forces `public_network`, which is off. The feature the design
  of record describes at length is 100% unreachable. Hide it, ~2 hours.
- **Reviewer expertise (P6)** — the wizard asks for specialist areas and then reads coverage, but *every* route that
  could confirm a reviewer's expertise has **no UI caller**. An owner requiring specialists gets
  `expertise_coverage_insufficient` forever. Owner-side confirmation alone unblocks it, ~2–3 days.
- **Backend with no UI** — assurance projects, gold quality, pilot onboarding, human-oversight attestation records,
  post-round appeals (no route at all), and a superseded legacy policy surface that should simply be deleted. The
  oversight one matters most because `/docs/human-oversight` sells it as live.

### Provisioning gates (code is done; someone must buy or configure something)

| Gate | Blocks | Effort |
| --- | --- | --- |
| `RESEND_API_KEY` + verified domain | **Nobody can sign up** — passkeys need an existing account | 1 d |
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` | No payout wallet binding; two panels render as nothing | **1 h — cheapest unblock here** |
| Eligibility/KYC provider | No voucher → no commit → no claim. The dev fallback is refused in production | vendor lead time + 3–5 d |
| Stripe | Subscriptions and prepaid top-ups | — |
| `TOKENLESS_NETWORK_PANELS_ENABLED` | Preflight **forbids** it on tokenless, so the network half of the product is untestable on the only deployment target | policy decision |

### Public docs vs reality *(P8)*

`/docs` and the landing page advertise the 100→50→25→10% ladder, paid panels, reviewer USDC pay, "Reviewers keep 90%",
and the World-ID network as one of three live options. None are available. Worse,
[protocol.ts:282](../packages/nextjs/lib/mcp/protocol.ts:282) returns
`allowedAudienceSources: ["customer_invited","rateloop_network","hybrid"]` as a **static constant**, so an agent that
calls `rateloop_capabilities` is told the network is available.

Note a guardrail pointing the wrong way: `publicCopy.test.ts:20-29` asserts public copy does **not** match
`/test deployment|Base Sepolia/i`, which actively forbids honest disclosure that the deployment runs on a testnet.

The in-app UI is already honest (`AdaptiveCoverageSummary.tsx:12`) and the markdown docs carry `**Status:**` lines —
that pattern is the precedent to follow.

---

## 8. Services

All four suites pass: keeper 74/74, ponder 48/48, node-utils 11/11, both type checks clean.

### K1 — Keeper permanently starves rounds *(blocker)*
[keeper.ts:968-974](../packages/keeper/src/keeper.ts:968) requests the *full* tick budget from `scanRoundIds` and then
`.slice()`s the union with the feed. But
[round-scan.ts:61](../packages/keeper/src/round-scan.ts:61) advances its module-level cursor **at selection time**,
unconditionally — so every round the feed displaces has already had its cursor consumed, and because the cursor
strides by a fixed amount each tick, the same rounds are skipped **forever**.

Reproduced against the real module: 30 persistently feed-eligible rounds → 60 rounds never processed across 200 ticks;
100 feed-eligible → **no historical round ever processed**. Not exotic: `finalize_scoring_seed` is returned for every
`AWAITING_SEED` round with no timestamp gate, rounds sit there ~24h waiting on the scoring beacon, and those sort to
the *front* of the tick. An existing test bakes the behaviour in.

**Fix:** cap the feed's share of the tick, budget the scan lane with what remains, and drop the `.slice()`. Separately,
gate `finalize_scoring_seed` on the scoring-beacon timestamp.

### K2 — Fatal startup failure leaves a zombie *(major)*
The metrics server starts *before* signer, connectivity, and deployment validation. On failure `main().catch` sets
`exitCode = 1`, but the listening socket keeps the event loop alive — the container stays "running", serves `/ready`
503 forever, and nothing restarts it. Verified empirically.

### K3 — Feedback-bonus race tolerance is dead code *(major)*
[tokenless-abi.ts:36](../packages/keeper/src/tokenless-abi.ts:36) declares **no `error` entries** for the bonus
contract (the panel ABI declares six), so viem cannot decode the custom revert and the
`/NothingToRefund|AwardWindowClosed|InvalidPool/` regex can never match. An ordinary two-keeper race on
`refundRemainder` — expected, since every call is permissionless — aborts the entire tick.

### K4 — `CreditWithdrawn` is emitted but neither in the ABI nor handled *(major)*
A funder's remainder-refund withdrawal is invisible to the index, contradicting the source-derived settlement-evidence
claim. Every other contract's event set is fully covered.

### K5 — Deployment-identity mismatch degrades silently *(major)*
The work feed correctly throws on a deployment-key mismatch, but the caller catches *everything* into one
`logger.warn`. No counter, no readiness reason, `/ready` stays 200 — so a keeper pointed at a Ponder indexing a
**different deployment** looks identical to a network blip. This is precisely the mixed-bundle condition the design
says must fail closed.

### K6 — Unbounded backward log scan *(major)*
`commitLogsForRound` walks backward from chain head in 1999-block chunks starting at the *global* deployment block. For
a month-old round still in its claim window that is ~650 `eth_getLogs` per round per tick — up to ~65,000 RPC calls per
15-second tick at full budget. Ponder already stores `createdBlock`; use it.

Minor: deterministic decode failures are re-decrypted every tick forever; a guaranteed-revert claim attempt on
unrevealed commits; the gas gauge loses precision above ~9e15 wei; the keeper README contradicts the code; and the
environment-parity doc omits several production-required variables (the `.env.example` files are correct).

**Verified sound:** event coverage otherwise complete and field reads correct; on-chain writes idempotent by
construction; deployment key, chain id, and schema agree across all three consumers; gas exhaustion genuinely covered;
Ponder's readiness endpoints report what the docs claim.

---

## 9. Recommended order

**Week 1 — stop lying to users, unblock signup.**
1. Surface `blockingReason` and gate the setup selectors (P1) — 1–2 d
2. Set `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` — 1 h
3. Configure Resend (P7) — 1 d
4. Fix the keeper starvation (K1) — 1 d
5. Demote adaptive from "Recommended" (P5, honest version) — 4 h; hide agent-written questions (A3) — 2 h

**Week 2 — make the one working lane pleasant.**
6. Rating-flow blockers R1–R3 — 1–2 d
7. Ship `Field` + `useFormErrors` and retrofit the P0 forms (P4) — 3–5 d
8. Insight-bonus claim fix (R11) — 30 min

**Week 3 — honesty and polish.**
9. Public docs alignment + MCP capabilities (P8) — 2 d
10. Copy sweep, applied as the six rules (§6) — 1–2 d
11. Owner-side expertise confirmation (P6) — 2–3 d
12. Keeper K2–K6 — 2–3 d

**Then:** private-paid lane (shortest route to any working paid path, 3–5 d, but needs the eligibility provider for a
live exercise — start that contract now), then correlation/calibration analytics (§2), then public-network, then hybrid.

### On the correlation work specifically

Do not port `main`'s design. The cheap, high-value version respects the adminless core and reuses existing plumbing:
- a per-reviewer-lineage **calibration accumulator** from `predictedUpBps` at evidence-publication time, feeding
  `tokenless_reviewer_qualifications` as a new `qualification_kind` (~2–4 d);
- **pair correlation** joining the co-assignment counts that already exist against vote agreement and forecast
  lockstep — identical fine-grained forecasts across rounds are a far stronger scripting signal than identical binary
  votes, 99 buckets versus 2 (~2–3 d);
- emit both as reason codes into the existing `PostRoundIntegrityReport` with `payoutEffect: "none"`.

Plus the 1-hour rename of `correlationRiskBps`, which is actively misleading in published evidence.

---

## 10. Method, corrections, and remaining gaps

Six parallel read-only audits; every finding above was re-verified in source by the coordinating session before
inclusion. No files were modified during this audit; the working tree stayed clean at `02f00afb3`.

**One claim was corrected.** An agent reported an unhandled `TypeError` from an unguarded `new URL()` at
`publicResponse.ts:152`, said to run before the guarded parse. It does not: `createPublicRaterResponse:132` calls
`normalizePublicRaterResponse` at `:141`, and the guarded parse lives there. Line 152 only ever runs on an
already-validated string — redundant defensive debt, not a reachable crash. The user-visible symptom is real but
belongs to R2 (swallowed error messages), and is recorded that way.

**Still not covered.** No `yarn e2e` run has been performed. Note that the public-paid E2E test mocks
`/api/rater/tasks` — consistent with that lane being off, and not evidence the path works. A sweep for orphan routes
and no-op components was launched but did not report; the half-built-surface findings in §7 come from direct
verification instead.

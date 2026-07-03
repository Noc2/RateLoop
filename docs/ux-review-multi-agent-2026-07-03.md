# RateLoop Website — Multi-Agent UX Review

**Date:** 2026-07-03
**Branch:** `main`
**Head reviewed:** `5a971adba` ("docs: add seventh-pass multi-agent design review"); frontend under `packages/nextjs`.
**Requested by:** the repository owner, on his own work.

## Which model did what

The owner asked for this to be recorded explicitly.

- **All analysis in this pass was performed by Claude Fable 5**: the lead orchestrator and all four parallel review subagents (public/marketing/docs surface; rater journey; asker/agent-operator journey; governance/profiles/settings plus cross-cutting accessibility and consistency), plus the lead's spot re-verification of every P0/P1 claim below directly in source.
- **No fallback to Claude Opus 4.8 (or any other model) was used.** A first launch of the four subagents was aborted by a session limit before producing output; the same four agents were relaunched afterward and all completed.
- Method caveat: this is a **code-level** review — copy, state machines, and markup were read from source; nothing was rendered in a browser. Items that need a live render or screen-reader pass are marked *speculative*. Layout, contrast, and animation quality are out of scope.

## Scope and calibration

All of `app/(public)`, `app/(app)`, and `components/**` were covered across the four subagents, calibrated against `docs/ux-impact-audit-2026-07-02.md` so remediated items are not re-raised. Confirmed fixed at HEAD and not re-litigated: the 7-day-veto payout-timing copy drift (contracts and `protocolFacts` now consistently tell the 1-hour story), the "scored against mean prediction" phrasing, bounty-eligibility "Everyone" default, and the private-context removal confirmations. One prior recommendation is re-raised because it remains unimplemented (settlement-pending ETA, UX-4).

Where a finding depends on contract behavior, it cross-references today's `docs/design-review-seventh-pass-2026-07-03.md` (notably 7P-3).

## Summary

The recurring theme across all four reviewers: **the app is candid everywhere except at the moments money is at risk or lost.** State machinery, spam-controlled notifications, formatters, and recovery flows are unusually well built — but the up-to-50% stake forfeit is disclosed only in a hover tooltip, bounty non-refundability is never shown in any payment flow, the Cancelled tooltip actively implies a refund the asker does not get, and losses settle silently while wins get toasts.

| ID | Priority | Area | Recommendation |
| --- | --- | --- | --- |
| UX-1 | P0 | Rater / stake modal | Disclose the up-to-50% forfeit at the moment of staking, not only in docs |
| UX-2 | P0 | Asker / outcomes | Fix Cancelled-round copy that implies refunds; document the bounty + feedback-bonus treasury sweep |
| UX-3 | P1 | Asker / payment | Disclose non-refundability in every payment flow before money moves |
| UX-4 | P1 | Shared / waiting | Give "Settlement pending" an ETA and plain-language copy (re-raised from 2026-07-02 audit) |
| UX-5 | P1 | Rater / outcomes | Notify and explain losing outcomes (forfeits, Cancelled/Tied/RevealFailed) per round |
| UX-6 | P1 | Rater / recovery | Make the manual-reveal safety hatch reachable before stakes forfeit |
| UX-7 | P1 | Governance | Preflight and explain the castVote LREP lock (known revert mode is unguarded) |
| UX-8 | P1 | Cross-cutting | Stop auto-requesting browser notification permission on page load |
| UX-9 | P1 | Cross-cutting | Add app-router error boundaries |
| UX-10 | P1 | Rater / claim | Fix reward-toast deep links that dead-end on the zero-LREP governance gate |
| UX-11 | P1 | Public / SEO | Per-page metadata for the public/docs surface |
| UX-12 | P1 | Asker / composer | Confirm before the A/B-format switch destroys drafted bundle questions |
| UX-13 | P1 | Public / landing | Align the x402 chip with the EIP-3009 reality; quantify the FAQ payout answer |
| UX-14 | P2 | Various | Copy, formatting, terminology, and accessibility items (batched below) |

## P0

### UX-1 — The up-to-50% stake forfeit is never disclosed at the moment of commitment

`components/swipe/StakeSelector.tsx` (risk copy only in the info-icon tooltip, line 75: stake "…can affect rewards or losses after settlement"); `components/onboarding/VotingGuide.tsx` ("optionally back your signal with reputation" — no forfeit mention). The 50% cap, below-benchmark test, and 8-reveal activation threshold live only on the public docs page and `lib/docs/protocolFacts.ts`. The confirm button reads `Stake 5 LREP` with no risk line. Real-money slashing agreed to via a hover tooltip damages trust at the first loss and is a poor consumer-protection posture for launch.

**Recommendation:** whenever `amount > 0`, show one always-visible sentence adjacent to the confirm button — "If your rating scores below the round benchmark, you can lose up to 50% of this stake (applies once 8+ votes reveal)" — and add the same fact to the VotingGuide "Lock" step with a link to the scoring docs. *(Certain.)*

### UX-2 — Cancelled-round copy implies refunds the asker does not get; bounty and feedback bonus silently sweep to treasury

`components/shared/RoundProgress.tsx` — the Cancelled tooltip says "All stakes are refunded," which is true for rater LREP stakes but reads as "your money comes back" on the asker's own question. Ground truth: the mandatory submission bounty is `nonRefundable: true` and residue routes to treasury (`QuestionRewardPoolEscrowTransferLib`), and per design-review finding 7P-3 an attached feedback bonus on a Cancelled round is unawardable and sweeps to treasury after the deadline. `app/(public)/docs/smart-contracts/page.tsx` (~line 373) compounds it by promising the bounty "routes to eligible voters plus the eligible frontend operator" — on a no-turnout round there are no eligible voters. `docs/ai.md` tells agents to attach bonuses "by default" without mentioning this path. Nothing in the submissions table or outcome chip explains a no-turnout forfeit.

**Recommendation:** split the tooltip by audience ("Rater stakes are refunded. The question bounty and any Feedback Bonus are not."), add an asker-facing explainer on their own cancelled question with a re-ask CTA, correct the smart-contracts docs sentence, and add the Cancelled-forfeit caveat to the feedback-bonus tooltip, `docs/ai.md`, and `skill.md`. Coordinate wording with the 7P-3 accept/fix decision — if 7P-3 is fixed to refund the funder, document that instead. Extend the existing short-window low-turnout warning in `ContentSubmissionSection.tsx` with "if no one answers, the bounty is not refunded." *(Certain; verified in both frontend copy and contracts.)*

## P1

### UX-3 — Non-refundability is undisclosed in every payment flow

The phrase "non-refundable" exists in `lib/agent/legalNotice.ts` and agent API payloads only — never rendered in the manual bounty step (`ContentSubmissionSection.tsx`), the handoff payment card (`AgentAskHandoffPage.tsx`), or `BrowserSigningPage.tsx`. The signing page also never calls `requireAcceptance`, so a human can sign an x402 payment with no terms gate at all; the terms modal itself contains no bounty language and is skipped for anyone who accepted terms once for any action. **Recommendation:** one persistent line in both payment summaries ("Bounties are non-refundable task payments — they pay voters and are not returned if the question gets no answers") and a terms/legal-notice gate on `BrowserSigningPage` before prepare. *(Certain.)*

### UX-4 — "Settlement pending" still has no ETA and speaks protocol jargon (re-raised)

`components/shared/RoundProgress.tsx` tooltip: "…LREP stake rewards wait for a finalized RBTS correlation snapshot…" — no countdown, no "usually within an hour," no stuck-vs-normal distinction, while the blind phase gets a live MM:SS countdown. Agents already receive `estimatedReadyAt` / `stalled` / `blockedReason` in the result package (`lib/agent/resultPackage.ts`); humans get none of it. The asker's submissions table (`SubmissionOverviewPanel.tsx`) maps SettlementPending/Tied/RevealFailed to a generic "Active." This was recommendation #2 of the 2026-07-02 audit. **Recommendation:** plain-language tooltip + ETA derived from the challenge/veto windows (or reuse `estimatedReadyAt`), a "taking longer than usual" state past budget, and distinct "Settling"/"Tied"/"No turnout" labels in `getStatus`. *(Certain.)*

### UX-5 — Losing outcomes are silent

`components/SettlementNotifier.tsx` watches only `RoundSettled`; there are no toasts for Cancelled/Tied/RevealFailed on rounds the user voted in, no per-round outcome row anywhere ("you forfeited 1.5 LREP on round #12 — below benchmark"), and the only trace of losses is the aggregate "Stake Lost" profile stat. Wins get toasts; losses vanish — the asymmetry compounds UX-1, and without per-round feedback raters cannot calibrate against the RBTS benchmark. **Recommendation:** watch terminal events for voted rounds ("Round cancelled — your 2 LREP stake is refunded"), and add a per-vote outcome row (earned/forfeited, benchmark position, applied independence weight — which also surfaces the otherwise-unexplained "correlation-adjusted" concept). *(Certain for the notifier gap; the indexer likely already carries the data.)*

### UX-6 — The manual-reveal safety hatch is unreachable

`/vote/reveal` (`components/vote/ManualRevealPage.tsx`) is a "hidden fallback for manual reveals" with zero inbound links in the product. The failure mode it exists for — keeper down — is exactly the one where unrevealed stakes forfeit (per the app's own RevealFailed tooltip), and users never learn the page exists. **Recommendation:** when a committed vote passes epoch end unrevealed for N minutes, show a warning banner/toast on `/rate` linking to `/vote/reveal` with the deadline ("1 vote needs manual reveal before HH:MM or its stake is forfeited"); the data is already client-side. *(Certain.)*

### UX-7 — Governance voting neither explains nor preflights the LREP lock

`components/governance/ProposalCard.tsx` / `hooks/useGovernance.ts` — `castVote` fires with no preflight of snapshot weight vs. current balance and no copy that voting locks the snapshot weight until proposal end. The known failure mode (documented in the fifth-pass design review and still open by design: `castVote` reverts if current balance < snapshot weight — e.g. after staking LREP on ratings, a normal action) surfaces as a generic revert toast. The proposal composer already does exactly the right preflight for the proposal threshold, so the pattern exists in-repo. **Recommendation:** multicall `proposalSnapshot` + `getVotes(addr, snapshot)` + `balanceOf`; disable with inline copy explaining the shortfall, and add one sentence on lock semantics next to the vote buttons. *(Certain.)*

### UX-8 — Notification permission is auto-requested on page load

`components/SettlementNotifier.tsx:161` fires `Notification.requestPermission()` on mount for any connected address on `/rate` and `/governance` — found independently by two reviewers. Gesture-less prompts have the lowest grant rates and modern browsers quiet or permanently suppress them, burning the polished opt-in flow that `components/settings/NotificationSettingsPanel.tsx` already implements correctly. **Recommendation:** delete the auto-request; read `Notification.permission` passively and let the Settings button (or a contextual post-first-vote prompt) be the only requester. *(Certain.)*

### UX-9 — No error boundaries in the app router

No `error.tsx` or `global-error.tsx` exists under `packages/nextjs/app` (only `not-found.tsx`), so any uncaught client error — these pages do heavy bigint math on indexer data — yields Next.js's unstyled "Application error" dead end. **Recommendation:** root `error.tsx` + `global-error.tsx` with existing `surface-card` styling and a retry button; optional per-segment boundaries for `(app)/governance` and `(app)/rate`. *(Certain.)* Note: an earlier reviewer's landing-page report referenced `app/error.tsx` chrome — that file does not exist at HEAD; treat this finding as authoritative.

### UX-10 — Reward toasts deep-link into the zero-LREP governance gate

`components/RewardNotifier.tsx` / `SettlementNotifier.tsx` link "ready to claim" toasts to `/governance`; a wallet with 0 LREP (new rater with only a USDC bounty claim, or fully staked) gets `GetLrepOnboarding` instead of any claim UI, and otherwise the claim button is buried mid-page in the profile tab's Earnings section. Related (from the cross-cutting reviewer): the zero-LREP gate also hides *read-only* governance data (proposals, treasury) from prospective participants. **Recommendation:** bypass the gate when `useAllClaimableRewards` is non-empty (or link to an anchor that always renders the claim panel), and gate only write actions on LREP. *(Certain for the link/gate branch.)*

### UX-11 — One shared title/description across nearly all public pages

Only `docs/ai` and `docs/tech-stack` export `metadata`; every other `(public)` page — including 8 docs pages listed in `public/sitemap.xml` — renders as "RateLoop - Level Up Your Agent" in search results, link previews, and tabs, undercutting the deliberate discoverability investment (sitemap, llms.txt, .md mirrors). **Recommendation:** per-page `export const metadata` using the existing `docs/ai` pattern. *(Certain.)*

### UX-12 — A/B-format switch silently destroys drafted bundle questions

`ContentSubmissionSection.tsx` `handleQuestionFormatChange` → `handleQuestionCountChange("1")` slices a multi-question draft to one entry with no confirmation or undo (the stale-state guard doesn't block it, and the title is cleared) — while the team already built a confirmation dialog for the much smaller private-context loss. **Recommendation:** mirror `PrivateContextRemovalDialog` ("keeps only this question and removes N drafts"), or retain the drafts in memory for restore. *(Likely — verified by code reading, not executed.)*

### UX-13 — Landing sells "x402" that the docs immediately disclaim; FAQ timing is the last unquantified surface

The top feature card's "x402" chip links to a tech-stack section that opens with "RateLoop does not currently return HTTP 402 challenges… standard x402 client libraries cannot auto-pay RateLoop" — overclaiming to the highest-intent audience. And `lib/docs/landingFaq.ts` ("How Fast Do Rounds Settle?") is the one remaining payout-timing surface with no numbers, sounding open-ended when everywhere else commits to ~1 hour. **Recommendation:** rename the chip ("EIP-3009 / x402-compatible") and interpolate `protocolDocFacts.payoutFinalityMaxDelayLabel` into the FAQ answer (the file already imports `protocolDocFacts`). *(Certain.)*

## P2 (batched)

- **Commit-flow transparency** (`hooks/useRoundVote.ts`, `VotePageClient.tsx`): 2–3 unannounced wallet prompts with no step indicator or gas-sponsorship note; optimistic vote state is memory-only, so a reload during indexer lag looks like a lost vote and invites a double-commit that bounces off the cooldown. Add a step indicator and persist a `{contentId, roundId, txHash}` marker to sessionStorage.
- **Settings "Notifications" tab can't survive refresh** (`app/(app)/settings/page.tsx`): `getSettingsHash("notifications")` yields a hash-less URL whose parse fallback is `"wallet"`. Make the fallback and the hash-less tab agree. *(Certain; verified.)*
- **Silent failures after World ID verification** (`WorldIdVerificationCard.tsx`): the advertised LREP bonus claim runs in empty `catch {}` blocks — verified users may never get the bonus and never see an error. Add a retry state.
- **Frontend-operator registration dead end** (`FrontendRegistration.tsx`): the Register button greys out below the 1,000-LREP stake with no shortfall copy (the explanatory toast is unreachable behind the disabled button).
- **Raw machine strings and IDs in user-facing surfaces**: handoff/signing status cards render backend enums (`awaiting_image_signatures`, `prepared`); settlement toasts say "Content #4021 round #3" while curator toasts use real titles. Map enums to labels + next action; reuse `truncateContentTitle`.
- **Terminology drift** (all four reviewers): Answer/Rate/vote, Submit/Ask, Reputation/LREP/governance, curator/rater/voter, question/ask/content, stake/bond. Pick one user-facing term per concept (suggest: Ask, Rate, rater, question, stake) and apply to nav + docs headings + toasts.
- **Number/date formatting fragmentation**: ≥5 LREP formatting code paths disagree on decimals on the same screen (`ProposalCard`, `GovernanceStats`, `FrontendRegistration`, `ManualRevealPage` rounds 2.5 → "3"); proposal deadlines shown as raw block numbers; hard deadlines lack absolute local times. Standardize on `lib/ui/tokenAmountDisplay`, lint-ban ad-hoc `/ 1e6`, estimate wall-clock deadlines from block numbers.
- **Accessibility**: dialogs have `aria-modal` but no focus trap/initial focus (`StakeSelector`, `PublicProfileView`, `WorldIdProofDialog` — the latter's backdrop is an unnamed focusable button); tab pills signal active state by color only with no `role="tab"`/`aria-selected` (governance, settings, proposal list). A shared modal primitive and tablist component would fix all instances. *(Certain on markup; AT severity speculative pending a screen-reader pass.)*
- **Docs gaps**: `tlock`/`drand` used in SDK/smart-contracts/frontend-codes docs but never defined anywhere (tech-stack deliberately abstracts it away — add one parenthetical on first use); legal hub's blanket "Last updated: May 2026" contradicts its own children (June/April 2026); manual askers can't attach a Feedback Bonus while four pieces of manual-flow copy imply they can — add the control or scrub the copy; "Context Source" hides in a collapsed advanced panel that the validation error points at without opening (mirror the bounty step's auto-expand).
- **Misc**: landing social-proof strip can render "0 Verified Humans · $0 Paid" on a fresh deployment (filter zero items); logo click forces a full page reload via `window.location.assign`; `protocolFacts.ts` hand-copies timing/bounds constants that siblings import from `@rateloop/contracts` — the exact drift mechanism that caused the last audit's worst finding (export them from the contracts package); indexer outages render profiles as confident zeros with no degraded-data chip; feedback earning potential and the 1-hour award window are never surfaced to raters; handoff image-upload failures dead-end on "ask the agent for a fresh link" despite the human having full draft-edit rights.

## Notably well done (consensus across reviewers)

The payout-timing remediation was executed end-to-end rather than patched (contracts, tooltips, how-it-works, runbooks all tell the same 1-hour story). The confidentiality trust model is stated with unusual honesty ("deterrence and redaction, not cryptographic secrecy") and repeated verbatim across surfaces. `BrowserSigningPage`'s verifiable signing surface (decoded calldata so a poisoned tool description can't lie) is rare and excellent. Notification spam engineering — shared cooldowns, per-address seen-sets, dust thresholds, route scoping — is genuinely careful, which makes the auto-permission request (UX-8) the lone outlier. Terminal round states are fully enumerated with honest copy including forfeit admissions. Batch claiming (progress, per-item failure isolation, gas-shortage halt), duplicate-handoff recovery, feedback-bonus crash recovery via persisted tx hashes, and the composer's proposal-threshold preflight are all patterns the P0/P1 fixes above can reuse directly. Agent-side discoverability (llms.txt, .md mirrors, skill.md, per-agent install modals) is first-class.

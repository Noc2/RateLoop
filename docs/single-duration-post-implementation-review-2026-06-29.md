# Single-Duration Post-Implementation Review

Date: 2026-06-29

Scope: reviewed local `main` at `a463c107f` after the single-duration
implementation and follow-up fix pass. This review focuses on bugs and
operational gaps that remain after the resolved findings in
`docs/single-duration-implementation-review-2026-06-29.md`.

Review method:

- Main-agent static review plus three parallel read-only subagent passes:
  contracts/indexer, app/API/handoff, and docs/tests/operations.
- Line-level validation against the current worktree.
- Verification command run during this pass:
  `forge test --offline --fail-fast` in `packages/foundry`.
- No application or contract code was changed during this review.

Related report:

- `packages/foundry/audit-report-2026-06-29-followup.md` is the dedicated
  contract security follow-up. It currently records one open Medium finding
  (`M-1: Bundle rejected-snapshot skip abandons same-source replacement
  claims`) and one open Low hardening finding (`L-1: Launch pool deposits trust
  the requested amount instead of exact received tokens`).

## Executive Summary

The single-duration model is mostly wired through the primary happy paths, but
the current implementation still has several follow-up risks before a fresh
production cutover:

- One browser handoff state-machine bug can leave x402 handoffs stuck after the
  user rejects the EIP-3009 signature prompt.
- Ponder can overcount recovered bundle round-set completion after a recovery
  and requalification sequence.
- A few public/ops surfaces still accept, advertise, or test states that do not
  match the fresh-deploy product rules.
- The full Foundry suite is still red under a current fail-fast run.

| ID | Severity | Status | Area | Title |
| --- | --- | --- | --- | --- |
| F-1 | P1 | Open | Handoff | x402 browser handoffs can get stuck after signature rejection |
| F-2 | P2 | Open | Ponder | Recovered bundle round-set requalification can overcount completion |
| F-3 | P2 | Open | Handoff | Explicit wallet-call USDC handoffs can expose an unusable Feedback Bonus editor |
| F-4 | P2 | Open | CI/Ops | Base Sepolia readiness treats stale one-shot Feedback Bonus x402 as warning-only |
| F-5 | P2 | Open | Testing | Feedback Bonus Playwright coverage stops at draft save |
| F-6 | P2 | Open | Testing | Full Foundry suite is still red |
| F-7 | P2 | Open | Docs/Ops | Operator docs link to a missing env-parity runbook |
| F-8 | P2 | Open | Contracts/SDK | Public escrow ABI omits library-emitted bundle monitoring events |
| F-9 | P3 | Open | API | Public handoff TTL schema advertises 24h while implementation clamps to 30m |
| F-10 | P3 | Open | Tests | Ponder bundle handler test models impossible fresh-deploy multi-round bundles |
| F-11 | P3 | Open | Docs | Fresh mainnet redeploy wording needs break-glass context |

## Findings

### F-1: x402 browser handoffs can get stuck after signature rejection

Severity: P1

Status: Open

Affected code:

- `packages/nextjs/app/api/agent/handoffs/[handoffId]/prepare/route.ts:319-326`
- `packages/nextjs/app/api/agent/handoffs/[handoffId]/prepare/route.ts:344-368`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1860-1866`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2036-2047`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2566-2649`

Description:

The prepare route treats an x402 authorization-request-only response as a
successful prepare, persists the handoff as `prepared`, and returns a
`nextAction` telling the browser to sign EIP-3009 authorization. The UI also
sets local handoff state to that `prepared` response before it calls
`signTypedDataAsync`.

If the user rejects or closes the wallet signature prompt, the catch block only
sets a local error. The persisted handoff remains `prepared`, but
`canPrepareHandoffStatus` does not allow `prepared`, and `canSubmit` needs
either transaction calls or a preparable status. An x402 handoff with no calls
can therefore be left in a state where the user cannot continue or retry from
the page.

Impact:

This is a user-facing liveness bug for browser-signed USDC handoffs, including
single-question bounty plus Feedback Bonus handoffs. It can look like the link
is broken even though the underlying draft is still valid.

Recommendation:

Either avoid persisting `prepared` for the authorization-request-only first leg,
or make `prepared` with `x402AuthorizationRequest` and no calls explicitly
retryable. Add a route/UI regression test for: prepare returns authorization
request, wallet signature is rejected, user clicks submit again, and the page
successfully restarts the signature flow.

### F-2: Recovered bundle round-set requalification can overcount completion

Severity: P2

Status: Open

Affected code:

- `packages/ponder/src/QuestionRewardPoolEscrow.ts:707-747`
- `packages/ponder/src/QuestionRewardPoolEscrow.ts:752-769`
- `packages/ponder/src/api/routes/correlation-routes.ts:756-759`

Description:

When Ponder indexes `QuestionBundleRoundSetQualified`, it inserts a
`questionBundleRoundSet` row and increments
`questionBundleReward.completedRoundSetCount` if that row did not already
exist. When it later indexes `RejectedSnapshotBundleRoundSetRecovered`, it
deletes the row and reverses the allocation, but it does not record recovered
state.

If the same logical round set is reopened and requalified after recovery, the
row is absent again, so Ponder increments `completedRoundSetCount` a second
time. On-chain recovery/requalification does not represent a second completed
round set. The API path that finds pending bundle correlations uses
`completedRoundSetCount < requiredSettledRounds`, so the overcount can suppress
later work or make bundle state look complete too early.

Impact:

Bundle reward state in the indexer can diverge from contract state after a
recover/reopen/requalify sequence. This can affect feed/API visibility,
correlation scheduling, and operator diagnosis for bundles.

Recommendation:

Track recovered/reopened round-set state in Ponder and suppress the completion
increment when a previously recovered logical round set is qualified again.
Add an indexer regression test for qualify -> recover -> reopen -> requalify
and assert the completed count matches the on-chain logical count.

### F-3: Explicit wallet-call USDC handoffs can expose an unusable Feedback Bonus editor

Severity: P2

Status: Open

Affected code:

- `packages/nextjs/lib/agent/handoffs.ts:340-378`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:2049-2050`
- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:3397-3410`

Description:

The handoff backend correctly rejects Feedback Bonus funding unless the payment
mode is x402/EIP-3009 authorization. The handoff editor, however, enables
`Add bonus` based only on single-question USDC bounty state. For a request body
that explicitly sets `paymentMode: "wallet_calls"`, the UI can offer the bonus
editor even though save/prepare cannot support that combination.

This is narrower than the already-fixed LREP issue: implicit USDC
single-question requests default to x402 authorization. The remaining mismatch
is explicit wallet-call USDC handoffs with a user-added Feedback Bonus.

Impact:

Users can make an edit that appears valid in the browser but fails server-side
because no visible control explains or changes the incompatible payment mode.

Recommendation:

Disable the Feedback Bonus editor when the stored/requested payment mode is
explicitly `wallet_calls`, or switch/clear payment mode when the user enables a
Feedback Bonus. Add a handoff draft test for an explicit wallet-call USDC ask
where clicking `Add bonus` is either blocked or converts the draft to the
supported x402 mode.

### F-4: Base Sepolia readiness treats stale one-shot Feedback Bonus x402 as warning-only

Severity: P2

Status: Open

Affected code:

- `scripts/check-base-sepolia-readiness.mjs:121-132`
- `.github/workflows/base-sepolia-readiness.yaml:84-91`

Description:

The Base Sepolia readiness script knows when the configured
`X402QuestionSubmitter` is the stale staging submitter that cannot support
one-shot Feedback Bonus x402 submissions. It only fails when
`--require-one-shot-feedback-bonus-x402` is passed. The live CI workflow runs
`--live --require-live-targets` without that stricter flag, so staging readiness
can pass with the core single-duration Feedback Bonus x402 path still warning.

Impact:

The project can treat Base Sepolia as cutover-ready while the staging x402 path
needed for creation-time USDC bounty plus Feedback Bonus is still disabled.

Recommendation:

Make one-shot Feedback Bonus x402 a default failure for staging readiness, or
add `--require-one-shot-feedback-bonus-x402` to the live workflow before the
fresh cutover checklist is considered green.

### F-5: Feedback Bonus Playwright coverage stops at draft save

Severity: P2

Status: Open

Affected code:

- `docs/single-duration-fresh-redeploy-plan.md:80-82`
- `packages/nextjs/e2e/tests/agent-handoff.spec.ts:237-317`

Description:

The fresh redeploy checklist calls for Playwright coverage proving that
creation-time bounty plus Feedback Bonus handoffs submit with one shared
question duration. The current browser handoff test covers draft restoration,
editing the Feedback Bonus amount, saving, and reading the saved API payload.
It does not execute the prepare/sign/prepare-again/submit flow or verify
transaction postconditions.

Impact:

The E2E suite can miss a regression in the actual browser-signed funding path,
including authorization amount calculation, second-leg x402 prepare, and final
submission status.

Recommendation:

Add a full Playwright happy path once the local dev stack is healthy: create a
USDC handoff with Feedback Bonus, prepare, sign typed data, prepare again with
authorization, submit calls or confirm the transaction hashes, and assert the
created ask contains the shared duration and both funding components.

### F-6: Full Foundry suite is still red

Severity: P2

Status: Open

Verification:

- Command: `forge test --offline --fail-fast`
- Result: failed after 44 passing tests and 1 failing test.
- First failure: `test/GameTheoryImprovements.t.sol:GameTheoryImprovementsTest`
  fails in `setUp()` with `InvalidConfig()`.

Related prior report:

- `packages/foundry/audit-report-2026-06-29.md:218-242` records the full
  `forge test --offline` suite as failing with stale test assumptions around
  the new single-duration `maxDuration == epochDuration` rule.

Impact:

Targeted contract suites have passed, but the main contract test gate is not
green. This leaves stale fixtures mixed with real regressions and weakens the
signal before a fresh deployment.

Recommendation:

Fix or remove stale fixtures that configure invalid separate durations, rerun
`forge test --offline`, and keep this gate required before Base Sepolia or Base
mainnet cutover.

### F-7: Operator docs link to a missing env-parity runbook

Severity: P2

Status: Open

Affected files:

- `README.md:56-57`
- `packages/nextjs/README.md:130-131`
- `packages/agents/README.md:217`

Description:

Multiple operator-facing docs point readers to `docs/env-parity.md`, but that
file is not present in the repository.

Impact:

The docs send operators to a missing source of truth for USDC aliases, E2E
flags, and contract-address prefix mapping. That is a practical cutover risk
because environment parity is exactly where stale deployment addresses tend to
hide.

Recommendation:

Create `docs/env-parity.md` with the promised cross-package mapping, or replace
the links with the current authoritative runbook.

### F-8: Public escrow ABI omits library-emitted bundle monitoring events

Severity: P2

Status: Open

Affected code:

- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleRecoveryLib.sol:13-18`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:99-104`
- `packages/ponder/src/questionRewardPoolEscrowIndexerAbi.ts:4-12`
- `packages/contracts/src/abis/QuestionRewardPoolEscrowAbi.ts:1499`

Description:

The generated public `QuestionRewardPoolEscrowAbi` contains
`PreQualificationRejectedSnapshotBundleRoundSetSkipped`, but it does not
contain `RejectedSnapshotBundleRoundSetRecovered`,
`RecoveredSnapshotBundleRoundSetReopened`, or `QuestionBundleTerminalSkipped`.
Ponder works around this with a local augmented ABI that appends those events.

Impact:

Internal indexing can decode the events, but downstream consumers of
`@rateloop/contracts` cannot reliably decode these escrow-address logs from
the published ABI. This is especially easy to miss because the indexer has a
private fix while SDK/package users do not.

Recommendation:

Declare the monitoring events on the main escrow contract or publish an
official augmented ABI from `@rateloop/contracts`. Add an ABI export test that
asserts bundle recovery and monitoring events are present for public consumers.

### F-9: Public handoff TTL schema advertises 24h while implementation clamps to 30m

Severity: P3

Status: Open

Affected code:

- `packages/nextjs/lib/agent/schemas.ts:541-545`
- `packages/nextjs/lib/agent/handoffs.ts:92-93`
- `packages/nextjs/lib/agent/handoffs.ts:114-120`

Description:

The public schema describes `ttlMs` as defaulting to 30 minutes with a maximum
of `86400000` milliseconds. The implementation sets
`PUBLIC_HANDOFF_MAX_TTL_MS` to the 30-minute default and clamps longer requests
down to 30 minutes.

Impact:

Agents can request and document one-day handoff links that are silently reduced
to 30 minutes with a warning. That can make shared handoff links expire much
earlier than callers expect.

Recommendation:

Either update the schema/docs to say the maximum is 30 minutes, or intentionally
raise the implementation cap to 24 hours and add tests for the chosen contract.

### F-10: Ponder bundle handler test models impossible fresh-deploy multi-round bundles

Severity: P3

Status: Open

Affected code:

- `packages/ponder/tests/question-reward-pool-escrow-handlers.test.ts:737-758`
- `packages/foundry/contracts/libraries/QuestionRewardPoolEscrowBundleActionsLib.sol:143-150`

Description:

The Ponder test named `indexes multi-round bundle reward round sets and claims`
emits a `QuestionBundleRewardCreated` event with `requiredSettledRounds: 2n`.
The fresh-deploy bundle creation path rejects any submission bundle with
`requiredSettledRounds != 1`.

Impact:

This test is still useful only as legacy event-shape coverage. As written, it
can give false confidence that the fresh-deploy bundle product supports
multi-round bundle rewards.

Recommendation:

Rename and isolate it as a legacy-indexing test, or update it to the
fresh-deploy one-round bundle event shape and add a separate test for rejected
legacy/multi-round assumptions.

### F-11: Fresh mainnet redeploy wording needs break-glass context

Severity: P3

Status: Open

Affected docs:

- `docs/single-duration-fresh-redeploy-plan.md:68-69`
- `docs/single-duration-implementation-review-2026-06-29.md:268-272`
- `packages/foundry/README.md:55-66`

Description:

The implementation plan and review checklist still refer directly to a Base
mainnet fresh deploy. The Foundry README correctly frames Base mainnet as the
current production boundary, says addresses should be preserved by default,
and requires break-glass handling for a genuine fresh production stack.

Impact:

This is mostly documentation friction, because the owner explicitly requested a
fresh redeployment for this work. Still, future operators could read the
checklist as routine redeploy guidance rather than an owner-directed
break-glass migration.

Recommendation:

Update the fresh redeploy plan to say "owner-directed break-glass Base mainnet
fresh deploy" and link to the deploy wrapper safeguards in
`packages/foundry/README.md`.

## Verification Notes

Current passing signals from the previous fix pass remain recorded in
`docs/single-duration-implementation-review-2026-06-29.md`, including targeted
Next.js tests, type checks, Next.js build, targeted Foundry escrow tests,
storage-layout checks, and contract-size checks.

Current failing or incomplete gates from this review:

- `forge test --offline --fail-fast` is red at
  `GameTheoryImprovementsTest.setUp()`.
- Full Playwright browser handoff submission coverage for creation-time USDC
  bounty plus Feedback Bonus has not been added.
- Base Sepolia live readiness does not currently fail on stale one-shot
  Feedback Bonus x402 unless the stricter flag is passed.

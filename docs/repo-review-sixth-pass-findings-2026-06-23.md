# Repo Review Sixth Pass Findings - 2026-06-23

Scope: read-only review of the repo after the latest fixes on `main`. This pass focused on frontend/runtime flows, off-chain services, readiness tooling, and deployed-contract integration boundaries. I did not review this as a request to change deployed smart contracts; every suggested fix below is app, service, readiness, or documentation work against the existing Base mainnet deployment unless explicitly labeled as staging-only.

Parallel reviewers covered:

- Frontend/runtime and E2E user flows.
- Keeper, Ponder, agents, workflows, env parity, and readiness scripts.
- Deployed-contract integration boundaries, generated artifacts, oracle/admin docs, and X402 wiring.

## Checks Run

- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` passed with the known stale Base Sepolia `X402QuestionSubmitter` warning.
- Parallel reviewers reported passing readiness workflow tests, dev-stack tests, and `@rateloop/agents lint:questions`.
- I also rechecked older review items to avoid repeating resolved findings. In particular, the direct `make deploy` production guard and bare Base Sepolia readiness env-source gap now appear fixed and are not repeated here.

## Findings

### P1 - Production service safety depends on `NODE_ENV`, but entrypoints do not fail closed when it is missing

Fix scope: service startup/config/readiness. No contract redeploy.

Keeper and Ponder both gate production-only protections on `process.env.NODE_ENV === "production"`:

- `packages/keeper/src/config.ts:24`
- `packages/ponder/ponder.config.ts:34`
- `packages/ponder/src/api/index.ts:34`
- `packages/ponder/src/api/routes/keeper-routes.ts:23`

Those production gates control important behavior: Keeper's advisory-lock default and DB requirement, production URL validation, production-only `PONDER_KEEPER_WORK_TOKEN` enforcement, Ponder's `PONDER_NETWORK`/RPC checks, and Ponder API fail-closed CORS/rate-limit behavior. The service start surfaces do not pin or assert production mode:

- `packages/keeper/railway.toml:17-18` runs `yarn workspace @rateloop/keeper start:built-workspace-deps`.
- `packages/ponder/railway.toml:4-5` runs `yarn workspace @rateloop/ponder start:built-contracts`.
- `packages/keeper/Dockerfile:13` sets `HUSKY=0`, but no `NODE_ENV`.
- `packages/keeper/package.json` and `packages/ponder/package.json` start scripts do not set `NODE_ENV`.

Impact: if a live host omits or overrides `NODE_ENV`, Base services can boot with development defaults: Keeper may not require a lock DB, Ponder may not fail closed for missing trusted headers/CORS, and `/keeper/work` may not require the bearer token.

Suggested fix: pin `NODE_ENV=production` in Railway/service configuration or wrapper scripts, and add startup/readiness assertions that live chain IDs, `PONDER_NETWORK=base`, or public production URLs cannot run in non-production mode.

### P2 - Base readiness does not cover the full Keeper/Ponder runtime contract

Fix scope: CI/readiness/service preflight. No contract redeploy.

The Base mainnet readiness workflow currently checks app, Ponder, RPC, and metadata-sync inputs:

- `.github/workflows/base-mainnet-readiness.yaml:26-30`
- `.github/workflows/base-mainnet-readiness.yaml:43-48`
- `scripts/check-base-mainnet-readiness.mjs:151-158`

The runtime has additional production dependencies that are documented but not gated by Base readiness:

- `packages/ponder/src/api/routes/keeper-routes.ts:20-27` protects `/keeper/work` with `PONDER_KEEPER_WORK_TOKEN` in production.
- `packages/keeper/src/keeper.ts:672-675` requires the same token in production before calling Ponder.
- `packages/keeper/src/config.ts:824-826` requires `KEEPER_DATABASE_URL` when the main-loop lock is required.
- `packages/ponder/src/api/index.ts:35-41` fails closed when trusted rate-limit headers are missing in production.
- `packages/ponder/src/api/index.ts:101-109` fails closed when `CORS_ORIGIN` is missing in production.
- `docs/env-parity.md:66-73` lists the shared Keeper/Ponder secrets separately.

Impact: Base readiness can pass while Keeper cannot fetch `/keeper/work`, Ponder rejects protected custom API routes, or Keeper runs without the intended production lock/metrics controls.

Suggested fix: add an off-chain production preflight that loads the deployed/Railway env and checks `NODE_ENV`, Keeper DB, metrics auth when public, CORS/trusted headers, and matching `PONDER_KEEPER_WORK_TOKEN`. A live mode should probe `/deployment` and `/keeper/work` with the bearer token.

### P2 - Live readiness misses two ClusterPayoutOracle consumer domains

Fix scope: readiness/admin runbook. No contract redeploy by default.

`ClusterPayoutOracle` defines four payout domains:

- `packages/foundry/contracts/ClusterPayoutOracle.sol:37-40`

The deploy script wires all four consumers, including launch credit and question bundle reward:

- `packages/foundry/script/Deploy.s.sol:363-370`

But live readiness checks only domains `1` and `3`:

- `scripts/check-worldchain-sepolia-readiness.mjs:345-355`

Impact: a governance/admin change could leave domain `2` (`LaunchDistributionPool`) or domain `4` (`QuestionRewardPoolEscrow` bundle rewards) pointed at the wrong consumer while `base-mainnet:check -- --live` still passes.

Suggested fix: add domain `2 -> LaunchDistributionPool` and domain `4 -> QuestionRewardPoolEscrow` to readiness. If live drift is detected, use the oracle/admin path such as `ClusterPayoutOracle.setRoundPayoutSnapshotConsumer`, then repoint affected pinned in-flight records where applicable.

### P2 - Advisory voters can vote but cannot publish feedback from the UI

Fix scope: Next.js feedback flow/tests. No contract redeploy.

Zero-LREP votes are submitted through `AdvisoryVoteRecorder.recordAdvisoryVote`:

- `packages/nextjs/lib/vote/roundVoteTransactionPlan.ts:68-86`

The feedback panel recognizes either a normal voting-engine commit or an advisory commit as eligibility:

- `packages/nextjs/components/feedback/ContentFeedbackPanel.tsx:177-192`

However, the submit path passes only the normal voting-engine commit:

- `packages/nextjs/components/feedback/ContentFeedbackPanel.tsx:265-270`

`useContentFeedback` then falls back to reading only `RoundVotingEngine.voterCommitKey` and throws `"Vote on this question before saving feedback"` when that is empty:

- `packages/nextjs/hooks/useContentFeedback.ts:138-179`

The server-side eligibility check already accepts advisory commits:

- `packages/nextjs/lib/feedback/contentFeedback.ts:652-679`

Impact: an advisory voter can be shown as eligible in the UI, but feedback publication fails from the browser even though the server-side model supports it.

Suggested fix: pass the advisory commit hash into `submitFeedback` when it exists, or teach `useContentFeedback.resolveCommitKey` to query `AdvisoryVoteRecorder.advisoryCommitKeyByRater` before failing. Add a test for zero-LREP advisory vote followed by feedback publish.

### P2 - New funding fallback batches can run approve-plus-create without requiring atomic execution

Fix scope: Next.js transaction options/tests. No contract redeploy.

The thirdweb batch helper sends `sendAndConfirmCalls` with `atomicRequired: options.atomicRequired ?? false`:

- `packages/nextjs/hooks/useThirdwebSponsoredSubmitCalls.ts:611-620`

Most existing multi-call submit/vote/registration paths pass `atomicRequired: true`, but the new bounty and Feedback Bonus funding fallbacks batch `approve` plus `create*Pool` without setting it:

- `packages/nextjs/components/reward-pool/FundQuestionModal.tsx:377-400`
- `packages/nextjs/components/reward-pool/FundFeedbackBonusModal.tsx:303-325`

Impact: in in-app/thirdweb paths, the approval and pool creation may not be required to succeed or fail as one unit. That can leave an approval behind after a partially successful funding attempt, or create user-visible ambiguity about whether the pool was funded.

Suggested fix: set `atomicRequired: true` for these approve-plus-create batches, matching the rest of the codebase's multi-call funding/registration flows. Add a regression test around the funding modal call options or around a small exported helper that builds the batch.

### P3 - Rejecting a USDC authorization signature silently falls back to approve-plus-fund

Fix scope: Next.js transaction UX. No contract redeploy.

Both USDC funding flows first ask for an EIP-3009 authorization signature. Their catch blocks treat all pre-transaction failures as "authorization unavailable" and then proceed to allowance/approval funding:

- `packages/nextjs/components/reward-pool/FundQuestionModal.tsx:308-354`
- `packages/nextjs/components/reward-pool/FundFeedbackBonusModal.tsx:242-288`

Impact: if the user explicitly rejects the typed-data signature, the UI can continue into a different transaction flow instead of respecting the rejection. In the batch path, that can mean the next prompt is an `approve` plus pool creation batch.

Suggested fix: detect signature rejection with the existing `isSignatureRejected` / `isUserRejectedTransactionError` helpers and stop the flow with an informational notification. Keep the approve-plus-fund fallback only for wallets or providers that cannot support the authorization path.

### P3 - Feedback close time is mapped from the award deadline

Fix scope: Next.js mapper/test. No contract redeploy.

Ponder exposes distinct `nextFeedbackAwardDeadline` and `nextFeedbackClosesAt` values:

- `packages/ponder/src/api/shared.ts:274-275`
- `packages/ponder/src/api/shared.ts:599-604`

The Next.js content-feed mapper collapses them when an award deadline exists, assigning `nextFeedbackClosesAt` from `nextFeedbackAwardDeadline`:

- `packages/nextjs/hooks/contentFeed/shared.ts:797-812`

Impact: runtime/UI consumers of `nextFeedbackClosesAt` can display or reason about the later award-decision deadline as if feedback submission itself were still open.

Suggested fix: map `nextFeedbackClosesAt` directly from `item.feedbackBonusSummary.nextFeedbackClosesAt`, while keeping award-deadline fallback only for `nextFeedbackAwardDeadline`. Add a mapper test where the close and award timestamps differ.

### P3 - Public docs understate ClusterPayoutOracle's role in public rating movement

Fix scope: public docs/operator docs. No contract redeploy.

The public docs currently say the oracle "does not decide the public rating result" and that public rating settlement happens first:

- `packages/nextjs/app/(public)/docs/governance/page.tsx:113-118`

The deployed path is more nuanced: `settleRound` records pending public-rating evidence, but visible/canonical rating movement waits for a finalized domain-3 snapshot and veto window:

- `packages/foundry/contracts/libraries/ContentRegistryRatingSnapshotLib.sol:253-258`

Impact: operators and governance participants may treat public-rating domain `3` as payout-only and miss the need to monitor public-rating snapshot finalization or include `ContentRegistry.repointPendingRatingClusterPayoutOracle` in oracle rotation runbooks.

Suggested fix: update public docs/runbooks to say settlement records pending raw evidence, while visible rating movement is applied after a finalized public-rating snapshot and veto window.

### P3 - Base Sepolia readiness passes while one-shot Feedback Bonus X402 is intentionally disabled

Fix scope: staging readiness/docs. No Base mainnet contract redeploy.

The Base Sepolia readiness script explicitly warns that the staging `X402QuestionSubmitter` is the known stale submitter:

- `scripts/check-base-sepolia-readiness.mjs:117-123`

The app disables one-shot USDC Feedback Bonus X402 support for that stale submitter and throws when the mode is requested:

- `packages/nextjs/lib/x402/questionSubmission.ts:415-423`
- `packages/nextjs/lib/x402/questionSubmission.ts:1957-1964`

Impact: Base Sepolia can look "ready" while that specific staging X402 path is not valid coverage.

Suggested fix: keep this limitation explicit in staging smoke tests, or add a stricter readiness mode for flows that require one-shot Feedback Bonus X402. Refreshing the Base Sepolia submitter can be treated as staging-only validation work; it does not imply a Base mainnet redeploy.

## Suggested Fix Order

1. Fail closed on production service mode and add the missing off-chain preflight, because those are operational safety gates.
2. Expand oracle-consumer readiness before relying on live Base checks for governance/admin changes.
3. Fix advisory feedback publication, because the product already allows advisory voting and server validation supports it.
4. Make the new funding fallback batches atomic and respect rejected signatures.
5. Fix feedback timestamp mapping and public docs.
6. Decide whether Base Sepolia needs a strict X402 Feedback Bonus readiness gate, or keep the current warning documented as a staging limitation.

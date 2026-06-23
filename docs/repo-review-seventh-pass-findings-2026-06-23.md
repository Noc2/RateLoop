# Repo Review Seventh Pass Findings - 2026-06-23

Scope: read-only review of the current repo and dirty working tree. This pass focused on issues not already captured by the sixth-pass document, plus new risks introduced by the current uncommitted frontend/runtime changes. I did not change source, config, test, or smart-contract files. The existing Base mainnet contract deployment is treated as durable production infrastructure; every suggested fix below is app, service, readiness, test, or documentation work against the existing deployment unless explicitly labeled as staging-only.

Current working tree at review time already contained edits in:

- `packages/contracts/src/deployedContracts.ts`
- `packages/nextjs/components/Header.tsx`
- `packages/nextjs/components/vote/VoteFeedStage.tsx`
- `packages/nextjs/e2e/tests/mobile.spec.ts`
- `tmp/rateloop-rating-system-handoff/`

## Checks Run

- `git diff --check` passed.
- `node packages/foundry/scripts-js/validateLocalDeploymentSync.js packages/foundry/deployments/31337.json packages/contracts/src/deployedContracts.ts 31337 FeedbackRegistry FeedbackBonusEscrow X402QuestionSubmitter` passed. The dirty `deployedContracts.ts` changes are local `31337` generated metadata and match the local deployment artifact.
- `yarn next:check-types` passed.
- `yarn next:lint --max-warnings=0` failed on a Prettier warning in `packages/nextjs/components/Header.tsx:468`.
- `yarn base-mainnet:check -- --json` passed.
- `yarn base-sepolia:check -- --json` passed with the known stale Base Sepolia `X402QuestionSubmitter` warning.
- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` passed with the same known stale Base Sepolia x402 warning.
- `node scripts/register-node-test-env.mjs node --test scripts/readiness-workflows.test.mjs` passed.

## Findings

### P1 - Current dirty Next.js tree fails lint on Prettier formatting

Fix scope: formatting/CI hygiene. No contract change.

`yarn next:lint --max-warnings=0` currently fails because the dirty `Header.tsx` change leaves the measured-height expression on one long line:

- `packages/nextjs/components/Header.tsx:468`

Impact: if the current dirty frontend changes are committed as-is, GitHub CI will be red even though type-checking passes.

Suggested fix: format the touched file with the repo's normal Prettier/lint flow before committing the mobile header work.

### P1 - Ponder production RPC chain checks warn but do not fail closed

Fix scope: Ponder startup/readiness. No contract redeploy.

`ponder.config.ts` schedules a fire-and-forget `eth_chainId` probe:

- `packages/ponder/ponder.config.ts:126-153`
- `packages/ponder/ponder.config.ts:184-186`

When the RPC endpoint reports the wrong chain, the code only logs a warning and still returns the URL. That means `PONDER_RPC_URL_8453` can point at the wrong chain while deployment metadata and readiness surfaces still describe Base mainnet.

Impact: the indexer can boot against an empty or wrong-chain RPC while `/deployment` and artifact-derived checks look correct. This is an operational safety issue for production indexing, not a deployed-contract defect.

Suggested fix: make the chain-id probe blocking and fail-fast in production, ideally in `packages/ponder/scripts/start.mjs` before spawning Ponder. Add a live readiness field or probe that reports the RPC-observed chain id, not only artifact metadata.

### P1 - Ponder Railway start path can skip required workspace builds

Fix scope: Ponder deployment/startup. No contract redeploy.

Railway starts Ponder with the built-contracts script:

- `packages/ponder/railway.toml:5`
- `packages/ponder/package.json:16`

That script enters `packages/ponder/scripts/start.mjs`, which only ensures `@rateloop/contracts` artifacts. The full `start` script builds both runtime workspace dependencies:

- `packages/ponder/package.json:9`
- `packages/ponder/package.json:15`

Ponder imports `@rateloop/node-utils` from API code:

- `packages/ponder/src/api/payout-proofs.ts:1`

`@rateloop/node-utils` publishes `dist` files, and `dist` is ignored:

- `packages/node-utils/package.json:28`
- `.gitignore:42`

Impact: a clean Railway/Nixpacks checkout can start without `packages/node-utils/dist`, causing runtime imports to fail before the indexer/API is usable.

Suggested fix: change Railway to `NODE_ENV=production yarn workspace @rateloop/ponder start`, add a build phase that runs `build:workspace-deps`, or make `start:built-contracts` ensure all runtime workspace deps rather than contracts only.

### P2 - Mobile feed settling can self-trigger at the scroll end

Fix scope: Next.js mobile feed behavior/tests. No contract change.

The dirty `VoteFeedStage.tsx` change settles mobile scrolling after a timeout, but it bypasses the same-card guard when the scroller is near the end:

- `packages/nextjs/components/vote/VoteFeedStage.tsx:920-938`

The helper always assigns `scrollTop` and dispatches a synthetic `scroll` event:

- `packages/nextjs/components/vote/VoteFeedStage.tsx:159-165`

If the computed `nextScrollTop` is already equal to the current bottom scroll position, the synthetic scroll can schedule another settle without moving anything.

Impact: on mobile near the bottom of the feed, the UI can keep waking a 140 ms settle loop, wasting CPU/battery and potentially keeping header/scroll-sync state active.

Suggested fix: before calling `markMobileHeaderScrollSync` and `setMobileScrollerScrollTop`, bail out when `Math.abs(nextScrollTop - scroller.scrollTop) < 0.5`, or avoid bypassing the same-card guard solely because the scroller is at the end.

### P2 - Public correlation artifact URLs can be configured while the keeper binds loopback

Fix scope: Keeper config/docs/readiness. No contract redeploy.

The keeper only auto-binds metrics/artifact serving to `0.0.0.0` for hosted file artifacts when `METRICS_BIND_ADDRESS` is unset:

- `packages/keeper/src/config.ts:475-483`

But the example env actively sets loopback:

- `packages/keeper/.env.example:61`

The metrics server serves public correlation artifacts before metrics auth:

- `packages/keeper/src/metrics.ts:321-329`

The production runbook expects a public `/correlation-artifacts` route:

- `packages/keeper/README.md:156-158`

Impact: copying the example env and enabling file-backed artifact publication can publish HTTPS artifact URIs that Ponder/users cannot fetch, breaking payout-proof and artifact verification flows.

Suggested fix: comment out `METRICS_BIND_ADDRESS` in the example, or fail config when a non-local `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` is set while binding to loopback. Add readiness coverage for artifact URL, bind address, and `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` parity.

### P2 - Base Sepolia agent docs overstate one-shot USDC Feedback Bonus coverage

Fix scope: docs/staging readiness. No Base mainnet contract redeploy.

The agent docs allow Base Sepolia for staging and describe native EIP-3009/x402 one-shot funding for USDC bounty plus USDC Feedback Bonus:

- `packages/nextjs/public/docs/ai.md:9`
- `packages/nextjs/public/docs/ai.md:121`
- `packages/agents/README.md:26`
- `packages/agents/README.md:153-155`
- `packages/agents/README.md:179`

The readiness script currently warns that Base Sepolia's submitter is stale for that specific path:

- `scripts/check-base-sepolia-readiness.mjs:125`

Runtime also rejects one-shot USDC Feedback Bonus x402 when the chain deployment does not support it:

- `packages/nextjs/lib/x402/questionSubmission.ts:1957-1964`

Impact: staging instructions can send agents toward a path that is intentionally disabled on Base Sepolia. Base mainnet production is not implicated, but staging smoke tests and local-signer examples can be misleading.

Suggested fix: update `/docs/ai`, `packages/agents/README.md`, and `docs/env-parity.md` to call out the Base Sepolia limitation. For staging, use bounty-only x402 or `wallet_calls` for Feedback Bonus until the Sepolia submitter is refreshed. Document `--require-one-shot-feedback-bonus-x402` for strict staging checks.

### P3 - Mobile E2E test no longer checks the behavior its title claims

Fix scope: E2E coverage/test naming. No contract change.

The dirty mobile spec still says "image preview clicks open the context link externally":

- `packages/nextjs/e2e/tests/mobile.spec.ts:935`

But the test now clicks the explicit source link:

- `packages/nextjs/e2e/tests/mobile.spec.ts:939-945`

The card implementation disables normal content intent for image cards while enabling image lightbox behavior:

- `packages/nextjs/components/vote/VoteFeedCards.tsx:258-259`
- `packages/nextjs/components/vote/VoteFeedCards.tsx:490-497`

Impact: preview-click behavior could regress while this test still passes, because it no longer exercises the image preview surface.

Suggested fix: either restore a preview-surface assertion if previews should open the external context, or rename/rewrite the test to cover the current source-link/lightbox behavior honestly.

### P3 - World Chain mainnet is still labeled like an active production target

Fix scope: docs/env parity. No contract redeploy.

The env parity matrix marks `480` as `production`:

- `docs/env-parity.md:12`

The README says the current production boundary is Base mainnet:

- `README.md:10`

The World Chain mainnet workflow says it is retired for the Base production deployment:

- `.github/workflows/worldchain-mainnet-readiness.yaml:17`

Impact: operators can read `production` in the matrix as an active production boundary rather than a legacy production-profile artifact.

Suggested fix: split "artifact profile" from "current operational production boundary", or label `480` as a legacy/retired production-profile artifact.

### P3 - Historical docs contain live-dangerous pre-mainnet assumptions without banners

Fix scope: docs. No contract redeploy.

Some older docs still state or assume that production contracts are not deployed:

- `docs/private-context-plan-2026-06.md:166`
- `docs/private-context-plan-2026-06.md:313`
- `packages/foundry/audit-report-2026-06-10.md:9`

Current Base mainnet artifacts include production deployment metadata, including `X402QuestionSubmitter` and `LoopReputation`:

- `packages/foundry/deployments/8453.json:23`
- `packages/foundry/deployments/8453.json:30`
- `packages/foundry/deployments/8453.json:34`

Impact: a future operator or reviewer can mistake historical pre-mainnet guidance for live migration guidance and infer unnecessary redeploy work.

Suggested fix: add top-of-file historical-status banners pointing to the current Base readiness docs and warning not to infer routine redeploy work from pre-mainnet assumptions.

### P4 - Root README still describes LREP in future-tense deployment language

Fix scope: docs. No contract redeploy.

The root README says LREP is "planned for the fresh deployment":

- `README.md:8`

The Base mainnet deployment artifact already contains the deployed `LoopReputation` address:

- `packages/foundry/deployments/8453.json:30`

Impact: minor but confusing inconsistency on the repo front page.

Suggested fix: reword to present-tense production language, for example: "Loop Reputation (`LREP`) is the capped governance and protocol reputation token."

### P4 - Local generated deployment metadata is dirty and should stay isolated

Fix scope: git hygiene. No production contract change.

`packages/contracts/src/deployedContracts.ts` is dirty only for chain `31337` and validates against `packages/foundry/deployments/31337.json`.

Impact: low. It is easy to accidentally bundle local generated metadata with unrelated mobile/runtime fixes, making review noisier.

Suggested fix: either leave it uncommitted, or commit it separately only if the intent is to refresh local dev deployment metadata.

## Suggested Fix Order

1. Fix the current lint failure before any frontend commit that includes `Header.tsx`.
2. Fail fast on wrong-chain Ponder RPCs and repair the Ponder Railway workspace-build path before relying on production indexer restarts.
3. Fix the mobile settle no-op loop and align the mobile E2E test with the intended image preview/source-link behavior.
4. Harden keeper artifact publication config/readiness so public artifact URLs cannot point at loopback-only servers.
5. Clean up Base Sepolia x402 Feedback Bonus staging docs and env parity wording.
6. Add historical-status banners and README wording fixes so docs match the deployed Base mainnet reality.

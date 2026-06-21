# Repo Review Fourth Pass Findings - 2026-06-21

## Scope

This was a read-only repo review of the current `main` branch, with three parallel explorers covering deployment/contracts, frontend, and off-chain/indexer paths. The only requested repo change from this pass is this findings document.

Production RateLoop contracts are already deployed on Base mainnet, so these findings intentionally prefer guard, app, indexer, environment, and documentation fixes over smart contract changes. None of the issues below require a routine production contract redeploy.

## Verification Performed

- `node scripts/check-base-mainnet-readiness.mjs --json` passed.
- `node scripts/check-base-sepolia-readiness.mjs --json` passed.
- `env DEPLOY_TARGET_NETWORK=baseSepolia RPC_URL=https://mainnet.base.org node packages/foundry/scripts-js/checkProductionDeployGuard.js` exited successfully, which reproduces the deploy-guard gap below.
- `env DEPLOY_TARGET_NETWORK=base RPC_URL=https://mainnet.base.org node packages/foundry/scripts-js/checkProductionDeployGuard.js` failed with the expected production break-glass error.

## Findings

### P1 - Production deploy guard trusts the declared target, not the observed RPC chain

The deploy guard blocks production redeploys only when the declared deploy target is a production network. It does not verify that `RPC_URL` actually points to the same chain as `DEPLOY_TARGET_NETWORK`.

Evidence:

- `packages/foundry/scripts-js/parseArgs.js` resolves an RPC override and then runs the production guard from the parsed `network`.
- `packages/foundry/scripts-js/checkProductionDeployGuard.js` accepts `DEPLOY_TARGET_NETWORK=baseSepolia` and returns before checking production confirmation, even if `RPC_URL` points at Base mainnet.
- `packages/foundry/Makefile` broadcasts with raw `RPC_URL`, so a mismatched staging target plus production RPC can bypass the current break-glass path.
- The command `DEPLOY_TARGET_NETWORK=baseSepolia RPC_URL=https://mainnet.base.org ...checkProductionDeployGuard.js` exited 0 during this review.

Impact: a misconfigured deploy environment can broadcast to Base mainnet without the production redeploy confirmation, even though the operator intended a staging deploy.

Recommended fix: before any non-local broadcast, query `eth_chainId` from `RPC_URL`, reject target/RPC chain mismatches, and apply production break-glass based on the observed chain ID as well as the declared network.

### P2 - Claimable reward preflight reads can run against the wallet/default chain

The claimable reward hooks fetch Ponder candidates for the target deployment, but the subsequent `useReadContracts` calls do not set `chainId` on each contract read.

Evidence:

- `packages/nextjs/hooks/useClaimableQuestionRewards.ts` scopes candidate fetches with `targetNetwork.id` and `deployment?.deploymentKey`.
- The claimable question and bundle reward contract objects omit `chainId`.
- `packages/nextjs/hooks/useAllClaimableRewards.ts` builds reward, refund, and RBTS read contracts without `chainId`.
- `useReadContracts` receives those unscoped contracts, so wagmi can use the connected/default chain instead of the selected RateLoop deployment chain.

Impact: the UI can hide real rewards or show false positives when the connected wallet chain differs from the app target network. The write path is more guarded, so this is primarily a display/preflight bug.

Recommended fix: include `chainId: targetNetwork.id` on every claimable read contract, and add a regression test with a non-default target deployment.

### P2 - Frontend fee discovery mixes requested-chain contracts with default-scope Ponder rounds

The frontend fee API resolves contract context for the requested `chainId`, but then queries Ponder without deployment scope before multicalling those round IDs against the requested-chain contracts.

Evidence:

- `packages/nextjs/app/api/frontend/claimable-fees/route.ts` passes an explicit `chainId` into `listClaimableFrontendFeeRounds`.
- `packages/nextjs/lib/frontendFees/server.ts` resolves a chain-specific frontend fee read context.
- The same path calls `isPonderAvailable()`, `ponderApi.getFrontend(frontend)`, and `ponderApi.getRounds(...)` without passing deployment or chain options.

Impact: if the default Ponder deployment differs from the requested chain, the API can omit real fees or offer unrelated numeric round IDs as claimable.

Recommended fix: resolve the deployment key from `chainId` and pass it through the availability check, frontend lookup, and rounds query before performing contract reads.

### P2 - Agent lifecycle callbacks ignore the candidate chain when fetching content and feedback

Agent lifecycle candidates carry a `chainId`, but callback enrichment fetches content and feedback without passing that chain or deployment scope.

Evidence:

- `packages/nextjs/lib/agent-callbacks/lifecycle.ts` candidate objects include `chainId`.
- `dependencies.getContentById(candidate.contentId)` is called without chain/deployment options.
- `dependencies.listContentFeedback(...)` is also called without chain/deployment options.
- The feedback lookup defaults missing chain scope to the primary deployment.

Impact: external agents can receive callbacks populated with content or feedback from the wrong deployment when numeric content IDs overlap across chains.

Recommended fix: resolve each candidate's deployment from its chain ID and pass `{ chainId, deploymentKey }` into content and feedback lookups. Add a non-primary-chain lifecycle regression test.

### P2 - Follow, discovery, and profile state remain default-deployment scoped in several paths

Several social/profile reads accept or imply a target network at the UI layer, but call Ponder methods that do not carry deployment scope.

Evidence:

- `packages/nextjs/hooks/useFollowedProfiles.ts` calls `isPonderAvailable()` and `ponderApi.getAllFollows()` without chain/deployment options, and its query key is address scoped only.
- `packages/nextjs/app/api/follows/profiles/route.ts` proxies `ponderApi.getFollows()` without chain/deployment options.
- `packages/nextjs/hooks/useDiscoverSignals.ts` receives target-network context but calls `ponderApi.getDiscoverSignals()` without deployment options.
- `packages/nextjs/components/profile/PublicProfileView.tsx` calls profile and participation methods without target-chain query-key scope.

Impact: follow buttons, profile state, and discovery filters can reflect the default deployment rather than the selected deployment, especially on Base Sepolia versus Base mainnet.

Recommended fix: mirror the watchlist deployment scoping pattern: include `chainId` and `deploymentKey` in query keys, route params, availability checks, and Ponder client calls.

### P2 - x402 metadata sync can be rejected because the shared token is not documented or wired in examples

The Ponder metadata sync endpoint is fail-closed unless a bearer token or explicit open mode is configured, but the shared token is absent from the relevant environment examples and parity docs.

Evidence:

- `packages/ponder/src/api/routes/content-routes.ts` requires `PONDER_METADATA_SYNC_TOKEN` unless `PONDER_METADATA_SYNC_ALLOW_OPEN=true`.
- `packages/nextjs/services/ponder/client.ts` sends a bearer token only when `PONDER_METADATA_SYNC_TOKEN` is set.
- The x402 question submission path logs metadata sync failures in production instead of failing the submission.
- `docs/env-parity.md`, `packages/ponder/.env.example`, and `packages/nextjs/.env.example` document nearby Ponder variables but not the metadata sync token pairing.

Impact: production-looking environments can submit questions successfully while Ponder rejects late-synced question metadata, leaving confidentiality, target audience, or other metadata missing from the indexer.

Recommended fix: document and wire `PONDER_METADATA_SYNC_TOKEN` across Ponder and Next.js examples, parity checks, and readiness checks. Add a route/client test proving the shared token succeeds.

### P2 - Ponder metadata sync ignores `DATABASE_PRIVATE_URL`

Ponder's env example says `DATABASE_PRIVATE_URL` takes precedence over `DATABASE_URL`, but the metadata-sync write path only reads `DATABASE_URL`.

Evidence:

- `packages/ponder/.env.example` documents `DATABASE_PRIVATE_URL` as the preferred private database URL when available.
- `packages/ponder/src/api/routes/content-routes.ts` creates the metadata pool from `DATABASE_URL` only.
- The same route reports `DATABASE_URL is required for metadata sync` even if `DATABASE_PRIVATE_URL` exists.

Impact: Railway or other private-network deployments can index normally but fail `/question-metadata` writes if they only expose `DATABASE_PRIVATE_URL`.

Recommended fix: centralize metadata DB URL resolution as `DATABASE_PRIVATE_URL || DATABASE_URL`, update the error message, and add a regression test with only `DATABASE_PRIVATE_URL` set.

### P3 - Governance docs still describe Base mainnet beta as a release-candidate redeploy phase

The public governance docs still frame mainnet beta as a release-candidate period where balances and state may be carried into updated contracts, while the app banner and deployment notes now treat the Base mainnet contracts as durable production infrastructure.

Evidence:

- `packages/nextjs/components/BetaNoticeBanner.tsx` describes the Base mainnet stack as live production infrastructure.
- `packages/nextjs/app/(public)/docs/governance/page.tsx` still describes the first mainnet deployment as a release candidate and says redeployments stop only after beta.

Impact: public docs can lead operators and users to expect routine contract replacement, which conflicts with the deployed-contract operating posture.

Recommended fix: update copy only. Frame beta around off-chain, governance, and operator maturity, and reserve redeploy language for significant unavoidable contract-level incidents.

### P3 - Ponder README says stale live-chain overrides are ignored, but startup rejects them

Ponder's documented operator behavior says stale live-chain address and start-block overrides are ignored, but the config now fails closed on mismatches.

Evidence:

- `packages/ponder/README.md` says live supported chains ignore stale address/start-block env values.
- `packages/ponder/ponder.config.ts` throws on live address override mismatches.
- `packages/ponder/ponder.config.ts` throws on live start-block override mismatches.

Impact: the implementation behavior is safer, but the README can cause operators to expect startup to continue when it will actually fail.

Recommended fix: update the README to state that live overrides are validated and conflicts are rejected.

## Suggested Non-contract Fix Order

1. Harden the production deploy guard with observed-chain validation before broadcast.
2. Add deployment scoping to frontend fee discovery, agent lifecycle enrichment, and social/profile/discovery Ponder reads.
3. Add explicit `chainId` to all claimable reward read contracts.
4. Wire and document metadata sync token handling, then fix metadata DB URL resolution.
5. Clean up governance and Ponder README copy so operator docs match current production behavior.

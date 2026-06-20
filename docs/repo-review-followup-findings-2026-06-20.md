# RateLoop Repo Follow-up Findings - 2026-06-20

## Scope

- Branch reviewed: `main`.
- Review mode: read-only static review plus three focused explorer agents. The only repository change from this pass is this findings document.
- Production posture: Base mainnet contracts are treated as deployed production infrastructure. None of the findings below require or recommend a production smart contract redeploy.
- Verification run during the review: `node scripts/check-base-sepolia-readiness.mjs --json` and `node scripts/check-base-mainnet-readiness.mjs --json`; both passed.
- Not run: full app, keeper, Ponder, or Foundry test suites; no live RPC probes.

## Findings

### P2 - Reward funding modals can target the active wallet chain instead of the displayed content chain

`ContentItem` carries chain and deployment metadata, but `VotingQuestionCard` opens `FundQuestionModal` and `FundFeedbackBonusModal` with only `contentId`, round data, and title. The modals then derive their `chainId` from `useAccount().chain` or the first Wagmi configured chain:

- `packages/nextjs/hooks/contentFeed/shared.ts:59` and `:61` define `chainId` and `deploymentKey` on content items.
- `packages/nextjs/components/shared/VotingQuestionCard.tsx:972-987` and `:1082-1097` instantiate the funding modals without passing the content chain/deployment.
- `packages/nextjs/components/reward-pool/FundQuestionModal.tsx:113-116` derives contract addresses from the connected/default chain.
- `packages/nextjs/components/reward-pool/FundFeedbackBonusModal.tsx:94-97` follows the same pattern.
- Several reads, writes, approvals, and receipt waits in both modals omit an explicit `chainId`, for example `FundQuestionModal.tsx:153`, `:291`, `:330`, `:348`, and `FundFeedbackBonusModal.tsx:206`, `:227`, `:267`, `:283`.

Impact: in a multi-target staging build, or during a target/wallet chain transition with previous feed data still visible, users can fund the same numeric `contentId` on the wrong deployment or see confusing network failures.

Fix direction: app-only. Thread `item.chainId` and, where useful, `item.deploymentKey` from the feed/card into both modals. Use that chain for contract address lookup, public clients, EIP-3009 domain chain id, `readContract`, `writeContractAsync`, and `waitForTransactionReceipt`. If the connected wallet chain differs from the content chain, show a switch-network action and keep submit buttons disabled until aligned.

### P2 - Ponder content and reward-status calls default to the first configured target

The UI keys the content feed by the active `targetNetwork.id`, but the Ponder client still defaults expected deployment scope from `scaffoldConfig.targetNetworks[0]` when an explicit deployment key is not provided:

- `packages/nextjs/services/ponder/client.ts:296-303` derives default Ponder/content deployment scope from the first configured target network.
- `packages/nextjs/hooks/useContentFeed.ts:172-187` includes `targetNetwork.id` in the query key, but `:208-213` calls `ponderApi.getContentWindow` without passing deployment scope.
- `packages/nextjs/services/ponder/client.ts:1628-1664` pages content without an expected deployment key parameter.
- `packages/nextjs/hooks/useViewerRewardStatuses.ts:23-28` keys reward statuses only by voters/content IDs, and `:72-77` fetches them without chain/deployment scope.
- `packages/nextjs/.env.production:1-3` currently targets only Base mainnet, so the production default limits blast radius; the risk is mainly staging/multi-target operation.

Impact: with `NEXT_PUBLIC_TARGET_NETWORKS` containing more than one chain, the rendered query can say one target while Ponder availability/content/reward status validation still uses the first configured deployment. That can mix content metadata, pending reward badges, and availability failures across deployments.

Fix direction: app-only. Extend Ponder content and viewer reward-status APIs to accept an explicit chain/deployment scope, pass the active target through all feed/status queries, and include that scope in React Query keys. Prefer failing closed when the configured Ponder endpoint cannot prove it serves the requested deployment.

### P2 - Public-rating correlation artifacts are supported by builders but rejected by the standalone verifier path

The correlation builder and snapshot publication paths account for public-rating payout snapshots with `rewardPoolId = 0`, but `correlation-artifact-verifier.ts` still validates round snapshot `rewardPoolId` as positive and recomputes all round snapshots with `scoreRoundPayoutWeights`:

- `packages/ponder/src/api/routes/correlation-routes.ts:478-489` exposes rating candidates with `domain = PAYOUT_DOMAIN_PUBLIC_RATING` and `rewardPoolId = 0`.
- `packages/keeper/src/correlation-artifact-builder.ts:227-235` branches to `scoreRoundRatingWeights` for the public-rating domain.
- `packages/keeper/src/correlation-snapshots.ts:604-675` normalizes rating snapshots/weights and explicitly accepts `rewardPoolId = 0`.
- `packages/keeper/src/correlation-artifact-verifier.ts:195-199` rejects zero `round.rewardPoolId` via `readPositiveBigInt`.
- `packages/keeper/src/correlation-artifact-verifier.ts:458-468` always uses `scoreRoundPayoutWeights` for round snapshots.

Impact: a valid manually supplied public-rating correlation artifact can fail file-mode verification and block an operator recovery or handoff path, even though the automated builder/publisher understands the rating domain.

Fix direction: keeper-only. Let the verifier accept `rewardPoolId = 0` only when `domain === PAYOUT_DOMAIN_PUBLIC_RATING`, and recompute those snapshots with `scoreRoundRatingWeights`. Keep positive reward-pool enforcement for question and bundle payout domains.

### P2 - Launch-credit anchor-ban mitigation is documented but not enforced by artifact tooling

`LaunchDistributionPool` filters banned raters/anchors when recording/finalizing rewards, but the current mitigation for pending credits whose anchors are banned after staging is an operator runbook rather than an automated artifact check:

- `packages/foundry/contracts/LaunchDistributionPool.sol:533-542` reads launch policy and checks current ban/anchor context when recording rewards.
- `packages/foundry/contracts/LaunchDistributionPool.sol:656-664` finalizes from stored pending credit state.
- `packages/foundry/contracts/LaunchDistributionPool.sol:741-746` updates qualifying credit counters from the stored credit flow.
- `packages/foundry/README.md:143-145` tells operators to recompute current verified-human anchor state before proposing/finalizing launch-credit payout roots.

Impact: if governance bans an anchor after a pending credit is staged, an invalid launch-credit root could slip through unless operators manually recompute/challenge it during the optimistic window.

Fix direction: off-chain only. Add a launch-credit artifact verifier/challenger check that recomputes current anchor validity from indexed/on-chain state and fails or omits pending credits whose current anchors no longer satisfy `launchRewardPolicy.minVerifiedHumans`.

### P3 - Correlation candidate fetching can skip later candidate domains under backlog

The keeper fetches candidates from question-pool, bundle-pool, and public-rating endpoints, but it uses one global candidate count while paging through endpoints:

- `packages/keeper/src/correlation-artifact-builder.ts:537-568` iterates the three endpoints, stops paging when the shared `candidates.length` reaches `targetCount * endpoints.length`, then sorts and returns only `targetCount`.

Impact: if the first endpoint has enough backlog to fill the global window, bundle and rating endpoints can be skipped for that tick. Sorting after the fact cannot rescue candidates that were never fetched. This is a fairness/liveness issue for less-active domains, not a contract safety issue.

Fix direction: keeper-only. Fetch up to a per-endpoint budget before merging and sorting, or keep separate domain windows before applying the global priority sort.

### P3 - Base Sepolia offline readiness can pass without proving the app targets Base Sepolia

The Base Sepolia readiness script reuses shared offline validation, but unlike the Base mainnet production checker it does not assert the app env target:

- `scripts/check-base-sepolia-readiness.mjs:63-67` calls `validateOfflineReadiness` and prints the result.
- `scripts/check-base-mainnet-readiness.mjs:71-83` adds a production app env check requiring `NEXT_PUBLIC_TARGET_NETWORKS=8453`.
- `packages/nextjs/.env.production:1-3` defaults to Base mainnet and notes Base Sepolia testing must override this to `84532`.

Impact: a staging operator can get a green Base Sepolia offline readiness result while the app config still points at Base mainnet.

Fix direction: tooling/docs only. Add a Sepolia app-env assertion or live app-config probe requiring `NEXT_PUBLIC_TARGET_NETWORKS=84532` for staging validation.

### P3 - Governance proposal submit waits twice, and the second wait is unscoped

`useGovernanceWrite` routes proposal writes through `useTransactor`, which already waits for the receipt through the active public client. Proposal submission then performs an additional Wagmi receipt wait without a `chainId`:

- `packages/nextjs/hooks/useGovernance.ts:540-566` wraps governance writes in `useTransactor`.
- `packages/nextjs/hooks/scaffold-eth/useTransactor.tsx:173` waits for the transaction receipt.
- `packages/nextjs/components/governance/GovernanceActionComposer.tsx:1119-1121` performs another `waitForTransactionReceipt(wagmiConfig, { hash })`.

Impact: after a proposal transaction has already confirmed, a chain switch or global client drift can make the form hang or report a post-confirmation failure.

Fix direction: app-only. Remove the redundant second wait, or pass the explicit governance target chain if a second wait is still desired.

### P3 - User-facing copy still implies routine contract redeploys

Some public/operator copy still uses redeploy language that conflicts with the current production posture:

- `packages/nextjs/components/BetaNoticeBanner.tsx:44-45` says smart contracts may be redeployed before finalization.
- `packages/nextjs/components/vote/ManualRevealPage.tsx:105-107` says "redeployed contracts" in present-tense fallback copy.
- `packages/nextjs/app/(public)/docs/sdk/page.tsx:186` uses similar "redeployed" phrasing for the SDK docs.

Impact: this can make users/operators expect routine production contract redeploys, while the live Base mainnet stack should be treated as durable infrastructure.

Fix direction: copy-only. Reword toward the current production contract stack and current tlock model. Keep redeploy language only where it is clearly historical or explicitly tied to a major incident/governance migration.

### P3 - Base Sepolia signing checklist describes an x402 path that is currently gated off

The UX checklist still asks testers to expect one-shot native x402 submission with a USDC Feedback Bonus on Base Sepolia, but current code intentionally gates that path for the stale Base Sepolia submitter:

- `docs/base-signing-ux.md:26-27` describes the one-shot x402 question submit plus USDC Feedback Bonus path.
- `packages/nextjs/lib/x402/questionSubmission.ts:84-85` defines the stale Base Sepolia x402 submitter address.
- `packages/nextjs/lib/x402/questionSubmission.ts:413-421` disables one-shot Feedback Bonus for that submitter.

Impact: operators following the checklist will hit an expected block and may treat it as a regression.

Fix direction: docs-only. Split the checklist into pre-refresh and post-refresh Base Sepolia paths, or mark this step as expected to be blocked until the staging submitter is refreshed.

## Suggested fix order

1. Fix the reward funding chain propagation first, because it can affect user funds in multi-target/staging contexts.
2. Add explicit Ponder deployment scope to content and reward-status paths, because it shares the same chain-boundary theme and will make the first fix easier to verify.
3. Patch keeper correlation verifier/fetching behavior and add focused tests for public-rating file-mode artifacts plus domain-window candidate fetching.
4. Add readiness/checklist/copy cleanups as small separate commits.
5. Add the launch-credit artifact verifier/challenger guard as an off-chain operational hardening change.

# Repo Review Findings - 2026-06-20

## Scope

This review double-checked the RateLoop repo for bugs and inconsistencies across the app, agents, SDK-adjacent flows, Ponder, Keeper, readiness tooling, docs, and contract-adjacent production operations.

Base mainnet contracts are treated as durable production infrastructure. The recommendations below avoid routine production contract redeploys. The one Solidity-adjacent issue is framed as an off-chain artifact-generator and operator-runbook mitigation unless a future protocol version chooses to harden it in code.

This pass used four read-only explorer agents plus local source review and verification commands. No implementation files were changed; this document is the only output.

## Remediation Status

A follow-up implementation pass addressed the app chain-binding, Keeper/Ponder deployment identity, live readiness, sample-command, operator-runbook, and launch-credit artifact-guard items without changing deployed contract bytecode.

## Verification

Passed:

- `yarn workspace @rateloop/contracts check-types`
- `yarn workspace @rateloop/nextjs lint`
- `yarn base-sepolia:check`
- `yarn base:check`
- `yarn base-mainnet:check`
- `node --test scripts/*.test.mjs`: 86 tests passed
- `yarn workspace @rateloop/contracts test`: 37 tests passed
- `yarn workspace @rateloop/sdk test`: 51 tests passed
- `yarn workspace @rateloop/node-utils test`: 38 tests passed
- `yarn workspace @rateloop/ponder test`: 356 passed, 1 skipped
- `yarn workspace @rateloop/agents test`: 87 passed
- `yarn workspace @rateloop/keeper test`: 229 passed, 1 skipped, when localhost binding was allowed
- `yarn workspace @rateloop/nextjs test`: 1479 tests passed on standalone rerun
- `yarn foundry:test`: 1810 tests passed
- `yarn workspace @rateloop/foundry check:sizes`: all checked deployed bytecode sizes were below the EIP-170 limit

Expected or environment-limited failures:

- `yarn test:ts` completed the broad serial gate until `packages/keeper/src/__tests__/metrics.test.ts` tried to bind `127.0.0.1` and hit `listen EPERM: operation not permitted` in this sandbox. The focused Keeper suite passed when rerun with localhost binding allowed.
- `make check-contract-sizes` from the repo root failed with `No rule to make target 'check-contract-sizes'`. The actual root-safe gate is `yarn workspace @rateloop/foundry check:sizes`.
- A parallel local run of build-producing package tests caused a transient Next.js test failure because another package cleaned or rebuilt `packages/sdk/dist` while Next.js was reading it. The standalone Next.js test and the serial root gate did not reproduce that failure.

## Findings

### P1 - Feedback publishing can send the write on the connected wallet chain

Fix scope: app-only. No contract redeploy.

Evidence:

- `packages/nextjs/hooks/useContentFeedback.ts:95` resolves the target network and `packages/nextjs/hooks/useContentFeedback.ts:96` pins the read public client to `targetNetwork.id`.
- The `publishFeedback` request built at `packages/nextjs/hooks/useContentFeedback.ts:170` through `packages/nextjs/hooks/useContentFeedback.ts:183` has no `chainId`.
- The write path at `packages/nextjs/hooks/useContentFeedback.ts:184` through `packages/nextjs/hooks/useContentFeedback.ts:188` submits that request through either the local wallet client or `writeContractAsync`.
- Receipt waiting at `packages/nextjs/hooks/useContentFeedback.ts:201` through `packages/nextjs/hooks/useContentFeedback.ts:203` also omits `chainId`.

Impact:

A user can build and sign a feedback challenge against the intended RateLoop target network, but the write itself follows the connected wallet chain. On a wrong chain this can waste gas, fail confusingly, or confirm against the wrong client context.

Suggested repair direction:

Require or trigger a wallet-chain switch before publication, pass `chainId: targetNetwork.id` into the write request, and pass the same chain into `waitForTransactionReceipt`. Add a regression test that connects to an unsupported or non-target chain and verifies feedback publication is blocked before the write.

### P1 - Correlation freshness dedupes away domain-specific Ponder vote checks

Fix scope: Keeper/off-chain only. No contract redeploy.

Evidence:

- `packages/keeper/src/correlation-ponder-freshness.ts:32` through `packages/keeper/src/correlation-ponder-freshness.ts:50` builds different vote URLs by payout domain and `rewardPoolId`.
- `packages/keeper/src/correlation-ponder-freshness.ts:153` through `packages/keeper/src/correlation-ponder-freshness.ts:160` dedupes candidates only by `${contentId}:${roundId}`.
- The eligible vote freshness check at `packages/keeper/src/correlation-ponder-freshness.ts:217` through `packages/keeper/src/correlation-ponder-freshness.ts:220` therefore runs only for the first candidate seen for a content/round pair.

Impact:

If the same content and round appears in more than one correlation domain, such as public rating plus a reward-pool or bundle domain, the freshness guard can validate only the first domain's eligible-vote endpoint. The artifact builder can then consume a second domain whose eligible votes have not fully indexed yet, producing an incomplete payout artifact if Ponder is lagging unevenly by endpoint.

Suggested repair direction:

Keep the cheap round-state dedupe by `contentId:roundId`, but run eligible-vote indexing checks per `(domain, rewardPoolId, contentId, roundId)`. Add a Keeper test with two candidates sharing content/round but using different domains where the second endpoint is still truncated or incomplete.

### P1 - Agent wallet USDC transfer is not target-chain-bound

Fix scope: app-only. No contract redeploy.

Evidence:

- `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:164` reads only the connected address from `useAccount`, while `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:177` derives the USDC token address from `targetNetwork.id`.
- The balance read at `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:204` through `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:210` has no `chainId`.
- The transfer at `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:331` through `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:336` has no `chainId`.
- Receipt waiting at `packages/nextjs/components/submit/AgentSubmissionPanel.tsx:337` also omits `chainId`.

Impact:

The panel can display or transfer against whatever chain the wallet is currently connected to while labeling the operation with the target network's USDC address and display name. That can create misleading funding state or send a transfer on the wrong chain.

Suggested repair direction:

Read the connected chain from `useAccount`, block or switch when it differs from `targetNetwork.id`, and pass `chainId: targetNetwork.id` to both `useReadContract` and the transfer/receipt calls.

### P2 - Funding and handoff balance checks read target addresses on the current chain

Fix scope: app-only. No contract redeploy.

Evidence:

- Submission funding balances in `packages/nextjs/components/submit/ContentSubmissionSection.tsx:1622` through `packages/nextjs/components/submit/ContentSubmissionSection.tsx:1639` read LREP/USDC without `chainId`.
- Submission preflight registry reads at `packages/nextjs/components/submit/ContentSubmissionSection.tsx:2209` through `packages/nextjs/components/submit/ContentSubmissionSection.tsx:2225` omit `chainId`.
- The reward-token balance check at `packages/nextjs/components/submit/ContentSubmissionSection.tsx:2282` through `packages/nextjs/components/submit/ContentSubmissionSection.tsx:2288` omits `chainId`.
- Handoff funding derives `handoffFundingChainId` at `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1770` through `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1777`, then reads LREP/USDC balances without `chainId` at `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1778` through `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1799`.
- The handoff page computes `needsChainSwitch` at `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1800`, so the UI already has enough information to avoid unpinned reads.

Impact:

The app can report "insufficient funds" or "ready to fund" from the connected wallet chain while the addresses and transaction plan belong to the handoff or target chain. This is especially confusing in staging/production sessions where Base Sepolia and Base mainnet are both configured.

Suggested repair direction:

Pin all funding reads, registry preflight reads, and receipt waits to the intended chain. Where the connected wallet is on another chain, show the switch state before reading balances or preparing transactions.

### P2 - Keeper Ponder deployment guard misses FeedbackRegistry and is not reused everywhere

Fix scope: Keeper/off-chain only. No contract redeploy.

Evidence:

- Ponder deployment metadata includes `feedbackRegistryAddress` and `deploymentKey` in `packages/ponder/src/protocol-deployment.ts:12` through `packages/ponder/src/protocol-deployment.ts:19`.
- The deployment key is built from `chainId`, `contentRegistryAddress`, and `feedbackRegistryAddress` in `packages/ponder/src/protocol-deployment.ts:52` through `packages/ponder/src/protocol-deployment.ts:61`.
- Keeper's deployment guard cache key includes only base URL, chain ID, and ContentRegistry at `packages/keeper/src/keeper.ts:581` through `packages/keeper/src/keeper.ts:583`.
- The guard compares chain ID and ContentRegistry at `packages/keeper/src/keeper.ts:603` through `packages/keeper/src/keeper.ts:625`, but does not compare FeedbackRegistry or the full deployment key.
- `fetchKeeperWorkFromPonder` calls the guard before `/keeper/work` at `packages/keeper/src/keeper.ts:666`.
- `fetchIndexedCiphertextsForRound` reads `/votes` or `/advisory-votes` directly from `PONDER_BASE_URL` at `packages/keeper/src/keeper.ts:928` through `packages/keeper/src/keeper.ts:964` without first asserting deployment identity.

Impact:

A stale or partially rewired Ponder deployment with the right chain and ContentRegistry but the wrong FeedbackRegistry can pass the Keeper guard. Ciphertext/reveal reads also have a separate path that can use the configured Ponder URL without the same deployment assertion.

Suggested repair direction:

Compare either `deploymentKey` or `feedbackRegistryAddress` in the guard, include the same identity in the cache key, and reuse the assertion for every Keeper path that consumes Ponder data. Add tests that serve a matching chain/content registry with a mismatched FeedbackRegistry and verify Keeper fails closed.

### P2 - Live readiness checks verify Ponder height but not Ponder deployment identity

Fix scope: tooling-only. No contract redeploy.

Evidence:

- The shared live readiness probe checks `Ponder /status` at `scripts/check-worldchain-sepolia-readiness.mjs:872` through `scripts/check-worldchain-sepolia-readiness.mjs:891`.
- The probe verifies only HTTP success and block height at or beyond the deployment block.
- Ponder already has deployment metadata with `chainId`, registry addresses, and `deploymentKey` in `packages/ponder/src/protocol-deployment.ts:12` through `packages/ponder/src/protocol-deployment.ts:19`.

Impact:

`base:check -- --live` or `base-sepolia:check -- --live` can pass against a Ponder service that is on the right chain and indexed far enough, but pointed at the wrong RateLoop deployment metadata. That is exactly the class of mismatch the app and Keeper now mostly try to guard against at runtime.

Suggested repair direction:

Have live readiness query `/deployment` when `PONDER_BASE_URL` or a chain-specific Ponder URL is configured. Compare chain ID, ContentRegistry, FeedbackRegistry, and deployment key against the checked deployment artifact.

### P2 - Base Sepolia offline readiness can pass while the app still targets Base mainnet

Fix scope: tooling/config only. No contract redeploy.

Evidence:

- `scripts/check-base-sepolia-readiness.mjs:63` through `scripts/check-base-sepolia-readiness.mjs:66` delegates to the shared offline readiness validator.
- The shared offline validator checks artifact/address parity and token defaults, while the production Base mainnet checker adds environment-specific app target checks.
- `packages/nextjs/.env.production` intentionally defaults to `NEXT_PUBLIC_TARGET_NETWORKS=8453` for production.

Impact:

`yarn base-sepolia:check` can be green while a staging app or local validation environment still targets Base mainnet. The deployment artifact is healthy, but the app under test may not actually be exercising `84532`.

Suggested repair direction:

Add a staging app-target check, or a live app config probe, that can be pointed at the staging environment and assert `NEXT_PUBLIC_TARGET_NETWORKS=84532` when validating Base Sepolia.

### P2 - Pending launch credits can still count after verified anchors are banned

Fix scope: off-chain artifact generator/operator runbook first. No production contract redeploy recommended for this mitigation.

Evidence:

- Initial launch credit recording screens anchors through `_countDistinctAvailableAnchors` at `packages/foundry/contracts/LaunchDistributionPool.sol:535`; that helper excludes currently banned anchors at `packages/foundry/contracts/LaunchDistributionPool.sol:1383` through `packages/foundry/contracts/LaunchDistributionPool.sol:1404`.
- When a cluster proof is required, the credit is stored as pending at `packages/foundry/contracts/LaunchDistributionPool.sol:569` through `packages/foundry/contracts/LaunchDistributionPool.sol:573`, and anchors are reserved/stored at `packages/foundry/contracts/LaunchDistributionPool.sol:855` through `packages/foundry/contracts/LaunchDistributionPool.sol:863`.
- Finalization verifies the payout proof and zeroes only when the rater is banned at `packages/foundry/contracts/LaunchDistributionPool.sol:656` through `packages/foundry/contracts/LaunchDistributionPool.sol:699`.
- Finalization records pending anchors at `packages/foundry/contracts/LaunchDistributionPool.sol:704` through `packages/foundry/contracts/LaunchDistributionPool.sol:708`; `_recordVerifiedAnchor` skips anchors that are now banned at `packages/foundry/contracts/LaunchDistributionPool.sol:1304` through `packages/foundry/contracts/LaunchDistributionPool.sol:1310`.
- `_recordEarnedRaterReward` still increments credit totals at `packages/foundry/contracts/LaunchDistributionPool.sol:741` through `packages/foundry/contracts/LaunchDistributionPool.sol:745` and then evaluates payout eligibility at `packages/foundry/contracts/LaunchDistributionPool.sol:748` through `packages/foundry/contracts/LaunchDistributionPool.sol:750`.

Impact:

If governance bans a verified anchor after a launch credit was stored as pending but before the rater finalizes the cluster payout proof, the finalization path does not recompute the per-credit human-anchor threshold. The banned anchor is not counted as a distinct anchor, but the pending credit can still become qualifying credit if the optimistic payout artifact includes it and the root survives the challenge window.

This does not bypass the documented optimistic trust model for `ClusterPayoutOracle`: payout roots are public deterministic artifacts, challengers can recompute them during the challenge window, and bad proposers can lose reputation, fee income, and LREP bond. The practical production mitigation should live in that artifact/challenge layer.

Suggested repair direction:

Have the launch-credit payout artifact generator recompute current anchor validity for every pending credit and omit credits whose current anchors no longer satisfy `policy.minVerifiedHumans`. Add a challenger check for the same condition. Update the operator runbook: after governance bans a launch human identity, scan pending launch-credit artifacts for that anchor before proposing or allowing a root to finalize. If the fraud is tied to the rater, banning the rater before finalization already triggers the zero-finalize branch.

### P3 - Browser signing labels every bounty as USDC

Fix scope: app-only. No contract redeploy.

Evidence:

- `packages/nextjs/components/agent/BrowserSigningPage.tsx:112` through `packages/nextjs/components/agent/BrowserSigningPage.tsx:125` reads the bounty amount and formats it as `${amount} USDC` unconditionally.

Impact:

Signing pages for LREP-funded asks can show the wrong asset label. The transaction plan may still be correct, but the human-facing confirmation summary is misleading at exactly the moment users are deciding whether to sign.

Suggested repair direction:

Use the same asset-aware bounty parsing/formatting style already used by the handoff page, and cover USDC and LREP signing intents in tests.

### P3 - Blank Ponder RPC placeholders override local fallback and produce raw URL errors

Fix scope: Ponder config only. No contract redeploy.

Evidence:

- `packages/ponder/.env.example:22` through `packages/ponder/.env.example:26` includes blank placeholders such as `PONDER_RPC_URL_84532=`.
- `packages/ponder/ponder.config.ts:146` through `packages/ponder/ponder.config.ts:150` reads `process.env[key]` directly, so a blank string counts as configured and prevents the non-production default RPC fallback.
- `packages/ponder/ponder.config.ts:155` through `packages/ponder/ponder.config.ts:170` rethrows the raw `new URL(value)` error for normal `Error` objects, so a blank value surfaces as `Invalid URL` instead of naming the env var.

Impact:

A local or staging operator can copy `.env.example`, set `PONDER_NETWORK=baseSepolia`, and get a confusing startup failure even though non-production fallback RPCs are supposed to be available.

Suggested repair direction:

Trim env values before testing presence, treat blanks as unset, and wrap URL parse errors with the env var name, for example `${key} must be a valid URL`.

### P3 - Keeper boolean config typos bypass aggregated config errors

Fix scope: Keeper config only. No contract redeploy.

Evidence:

- `packages/keeper/src/config.ts:34` through `packages/keeper/src/config.ts:48` throws immediately when a boolean-like env var has an invalid value.
- The rest of the config loader accumulates errors and throws a combined `Invalid keeper configuration` message at `packages/keeper/src/config.ts:813` through `packages/keeper/src/config.ts:815`.

Impact:

Operators who typo one boolean env var fix that first, restart, and only then see the rest of the missing or invalid configuration. This is a small but real production-ops paper cut.

Suggested repair direction:

Refactor boolean parsing so invalid booleans append to the shared `errors` array and return the fallback value for continued validation.

### P3 - Contracts package README sample defaults to Base Sepolia

Fix scope: docs-only. No contract redeploy.

Evidence:

- `packages/contracts/README.md:22` uses `getSharedDeploymentAddress(84532, "ContentRegistry")` as the first package usage example.

Impact:

The contracts package README can nudge integrators toward staging by default, even though Base mainnet `8453` is the production smart-contract boundary and Base Sepolia `84532` is staging/testnet.

Suggested repair direction:

Use `8453` in the first production example, or label the current `84532` sample explicitly as staging/testnet.

### P3 - PR checklist points the contract-size gate at a dead root make target

Fix scope: docs/tooling only. No contract redeploy.

Evidence:

- `.github/pull_request_template.md:14` asks contributors to run `make check-contract-sizes`.
- Running `make check-contract-sizes` from the repo root fails with `No rule to make target 'check-contract-sizes'`.
- The root-safe package script is `yarn workspace @rateloop/foundry check:sizes`, defined at `packages/foundry/package.json:23`, and that command passed in this review.

Impact:

Contributors following the PR template hit a dead command even though the deploy-profile size gate exists and is currently green.

Suggested repair direction:

Update the PR template to `yarn workspace @rateloop/foundry check:sizes`, or add a root Makefile target that delegates to the same command.

### P3 - Parallel local package tests can race on shared `dist` output

Fix scope: tooling/docs only. No contract redeploy.

Evidence:

- `scripts/clean-package-dist.mjs:1` through `scripts/clean-package-dist.mjs:7` deletes the current package's `dist` directory unconditionally.
- `packages/sdk/package.json:100` through `packages/sdk/package.json:104` builds or tests after building workspace dependencies, and the build cleans `dist`.
- `packages/agents/package.json:88` through `packages/agents/package.json:90` builds `@rateloop/sdk` as a workspace dependency before its own build.
- `packages/nextjs/package.json:22` runs `yarn build:workspace-deps` before the Next.js node test suite.
- During this review, running build-producing workspace tests in parallel produced a transient `ENOENT: no such file or directory, scandir '.../packages/sdk/dist/esm'` from `scripts/fix-esm-extensions.mjs`. A standalone `yarn workspace @rateloop/nextjs test` passed afterward.

Impact:

Humans or agents trying to speed up verification by running package tests concurrently can get false failures when one package cleans or rebuilds shared package output while another reads it.

Suggested repair direction:

Document that build-producing workspace tests should use the serial root gate, or add a workspace build lock / task orchestrator so packages do not clean shared outputs concurrently.

## Non-findings and notes

- Base mainnet and Base Sepolia offline readiness are currently green, including deployment artifact/address parity for `8453` and `84532`.
- `yarn base-mainnet:check` now exists and passed, so the older PR-template issue about that alias is no longer current.
- Deploy-profile contract sizes are green. Default-profile Foundry builds can still emit code-size warnings for contracts, scripts, or tests, but `yarn workspace @rateloop/foundry check:sizes` is the right deployed-bytecode gate and passed.
- The strongest remediation theme is chain/deployment identity plumbing in app and off-chain services, not smart-contract replacement.

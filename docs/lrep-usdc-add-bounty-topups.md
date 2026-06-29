# LREP/USDC Add Bounty Top-up Redeploy Plan

## Goal

Allow existing-question "Add bounty" top-ups to fund `QuestionRewardPoolEscrow` pools in either LREP or USDC, matching the new-question bounty asset selector while keeping USDC EIP-3009 authorization as the USDC-only convenience path.

## Contract Changes

- Add an asset-aware public top-up method on `QuestionRewardPoolEscrow`, for example `createRewardPoolWithAsset(contentId, asset, amount, requiredVoters, requiredSettledRounds, bountyStartBy, bountyWindowSeconds, feedbackWindowSeconds)`.
- Route the new method through the existing `_createRewardPool` path so it reuses asset validation, token pulls, voter floors, content round-config checks, frontend-fee accounting, bounty windows, cluster payout oracle snapshotting, and LREP/USDC claim settlement.
- Keep `createRewardPool(...)` and `createRewardPoolWithAuthorization(...)` backwards-compatible and USDC-only. USDC can continue to prefer EIP-3009 authorization; LREP top-ups should use ERC-20 approval plus the new asset-aware pool creation call.
- Decide whether purpose/challenge bounty top-ups also need asset selection. If yes, add an asset-aware companion for `createPurposeRewardPool`; otherwise document that only standard "Add bounty" uses the new selector.
- Update interfaces, generated ABIs, deployed contract metadata, SDK exports, and any free/sponsored transaction allowlists for the new selector.
- Run storage-layout checks even for a full redeploy so proxy-upgrade safety stays visible and accidental layout regressions are caught before deployment.

## Deployment And Rewiring

- Redeploy the coordinated production stack when the owner has confirmed the full redeploy path. Include `ContentRegistry`, `RoundVotingEngine`, `QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`, `FeedbackRegistry`, `FrontendRegistry` fee creditor wiring, `X402QuestionSubmitter`, `ClusterPayoutOracle` consumers, and any confidentiality or launch-distribution dependencies that pin addresses.
- Regenerate `@rateloop/contracts` deployment metadata and ABIs for Base mainnet, Base Sepolia, and local/dev chains as applicable.
- Update chain-scoped env vars only for rollout contracts or service pointers that still need env wiring; prefer generated deployment metadata for core addresses.
- Rewire Ponder, Next.js, agent services, keeper/operator scripts, and Railway/Vercel environments to the new deployment addresses.
- Preserve or explicitly migrate operational state that must survive cutover: indexed historical reads, old result URLs, old reward pools, pending feedback bonuses, open rounds, claim windows, operator bonds, allowlists, and docs that distinguish legacy vs new deployments.

## Indexer, API, And Data Model

- Ensure Ponder decodes the new top-up call/event path and stores `RewardPoolCreated.asset` for LREP and USDC top-ups.
- Verify feed summaries, result packages, agent result scopes, bounty display currency, claim status, and reward sorting handle mixed LREP/USDC bounty and feedback-bonus assets without summing unlike assets.
- Add or update API/SDK types so top-up plans and postconditions carry `asset`, `tokenAddress`, and display currency consistently.

## UI Changes

- Add a LREP/USDC segmented selector to `FundQuestionModal` with USDC as the default for continuity.
- Resolve `selectedTokenAddress`, `selectedAssetId`, labels, balance/allowance checks, and error messages from the selected asset.
- For USDC, keep the current EIP-3009 authorization path and fallback to approval plus `createRewardPool`.
- For LREP, skip EIP-3009 and use approval plus `createRewardPoolWithAsset`.
- Update tooltip and warning copy: USDC claims depend on payout-root finalization; LREP bounty claims should describe the LREP-specific claim behavior and avoid USDC-only payout timing language.
- Display existing and newly funded bounty amounts with the correct asset labels, including mixed-asset states where applicable.
- Keep required-voter floors, settled-rounds validation, bounty-window controls, wrong-chain handling, sponsored/self-funded batch calls, transaction postconditions, and success toasts working for both assets.

## Agent And SDK Surfaces

- Update browser handoff, MCP, SDK, and wallet-call transaction planning only if they expose existing-question top-up funding. New ask flows already support LREP/USDC wallet-call bounties and should remain compatible.
- Keep native x402/EIP-3009 ask and top-up paths USDC-only; return clear errors for LREP when an authorization-only payment mode is requested.

## Tests

- Foundry: add tests for `createRewardPoolWithAsset` funding LREP and USDC, invalid asset rejection, allowance/token pull behavior, required-voter floor checks, round-config mismatch, bounty window behavior, claim/refund behavior for both assets, and cluster payout snapshot behavior for LREP and USDC.
- Foundry: keep existing USDC-only `createRewardPool` and `createRewardPoolWithAuthorization` tests unchanged to prove backwards compatibility.
- Storage and size gates: run `make check-storage-layouts`, `make check-contract-sizes`, and the relevant `forge test` suites.
- Next.js unit tests: cover asset parsing/formatting, postcondition matching with asset, modal validation, transaction-call selection, USDC authorization fallback, LREP approval flow, and mixed-currency display.
- Ponder/indexer tests: cover `RewardPoolCreated` rows for both assets and feed/result summaries for mixed bounty assets.
- E2E: update funding-modal Playwright coverage to open "Add bounty", switch between USDC and LREP, verify labels/tooltips/buttons, and mock or run wallet calls through both assets on a local chain.
- Agent/API tests: cover any changed transaction plan schema and ensure LREP requests are rejected from EIP-3009-only paths with a specific error.

## Verification

- Start the local stack with `yarn dev:stack` when contract and UI work are ready.
- Seed or create a local question, fund an additional USDC bounty, fund an additional LREP bounty, verify both appear in the feed/result surfaces, and claim/refund paths remain coherent.
- Run `yarn next:build`, targeted Next.js tests, targeted Ponder tests, Foundry tests, Playwright funding-modal tests, and any package generation checks required by changed ABIs.
- Before mainnet cutover, run the Base Sepolia deployment and smoke-test the full top-up path with real wallet calls.

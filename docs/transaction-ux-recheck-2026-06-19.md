# Transaction UX Recheck - 2026-06-19

Reviewed `main` at `d084fd9907347f9a6ee320b7cc0d10ab70bc035c` after the Base mainnet deployment metadata refresh and the non-redeploy transaction UX fixes.

This pass was review-only. No app, agent, SDK, keeper, indexer, or smart-contract implementation files were changed. The only output from this pass is this findings document.

## Remediation Status

Follow-up non-redeploy fixes after this recheck:

- H-1 browser signing Feedback Bonus continuation was fixed by `b4548237` (`fix(agent): continue browser signing feedback bonus funding`).
- M-2 readiness coverage was fixed by `f222668c` (`fix(readiness): verify x402 one-shot support`).
- M-4 and M-5 documentation gaps for `requiresAtomicExecution` were fixed by `0501c8e1` (`docs(agent): document atomic wallet plan requirements`).
- M-6 direct HTTP Feedback Bonus guidance was fixed by `a376faf3` (`docs(agent): align direct feedback bonus guidance`).
- M-3 server confirmation RPC selection now ignores the public browser preconfirmation toggle unless the server-only opt-in is set. L-1 production preconfirmation env wording was clarified by `65ad89d5` (`docs(env): clarify production preconfirmation rpc config`).
- M-1 Base Sepolia now gates one-shot x402 Feedback Bonus support off for the known stale submitter deployment until staging is refreshed.
- L-2 stale review/audit docs were marked historical by `ceb48ce4` (`docs(review): mark stale transaction ux findings`).

The remaining deployment-bound work is a Base Sepolia staging refresh for parity. It does not require a Base mainnet redeploy.

## Contract Redeploy Posture

No finding below requires a Base mainnet smart-contract redeploy. The current Base mainnet artifacts point at the refreshed `X402QuestionSubmitter` address, and the focused x402 contract tests still pass.

The one deployment-bound issue is Base Sepolia staging: the checked-in Sepolia artifact still points at an older x402 submitter while the generated ABI advertises the newer one-shot Feedback Bonus functions. That can be handled either by refreshing/redeploying Sepolia only, or by gating one-shot x402 Feedback Bonus support off for `84532` until Sepolia is refreshed. It is not a Base mainnet redeploy finding.

## Review Inputs

- Local branch state: `main...origin/main`, clean before the findings doc.
- Manual review of recent transaction UX commits, x402 planning and confirmation paths, browser signing, handoff completion, local signer execution, Base deployment artifacts, readiness scripts, and docs/env surfaces.
- Subagent review split:
  - Contract and deployment boundary.
  - App, agent, x402, and browser signing behavior.
  - Docs, config, thirdweb, Flashblocks, Vercel, and Railway consistency.

Verification run during this pass:

- `yarn node ../../scripts/run-node-tests.mjs lib/agent/browserSigningValidation.test.ts lib/agent/walletTransactionPlan.test.ts lib/x402/questionSubmission.test.ts app/api/agent/routes.test.ts app/api/mcp/route.test.ts` from `packages/nextjs`: 98 passed.
- `forge test --match-path test/QuestionRewardPoolEscrow.t.sol --match-test X402` from `packages/foundry`: 15 passed.
- `yarn workspace @rateloop/foundry check:sizes`: passed, all checked contracts under the EIP-170 deploy bytecode limit.

## Findings

### H-1: Browser signing links can strand separate Feedback Bonus funding

Severity: High

Fix scope: app-only. No contract redeploy.

Evidence:

- `packages/nextjs/lib/agent/signingIntents.ts` completes every signing intent through `rateloop_confirm_ask_transactions` and stores only `submitted` or `prepared`.
- `packages/nextjs/components/agent/BrowserSigningPage.tsx` treats `submitted` as terminal and only executes top-level `intent.transactionPlan.calls`.
- `packages/nextjs/lib/mcp/tools.ts` can attach a separate `feedbackBonus.transactionPlan` after the primary ask confirmation when a wallet-call ask still needs separate Feedback Bonus funding.
- The browser handoff route already has a `feedback_bonus_prepared` continuation state, but signing intents do not mirror that state.

Scenario:

An agent creates a browser signing link using `wallet_calls` and a Feedback Bonus that cannot be funded in the same x402 one-shot transaction, for example LREP or the separate wallet-call Feedback Bonus path. The browser user executes the primary ask transaction plan successfully. The confirmation response can contain a nested `feedbackBonus.transactionPlan`, but the signing intent is marked `submitted`, the page disables further preparation/execution, and the user has no browser path to fund the bonus pool.

Impact:

The ask is submitted, but the promised Feedback Bonus remains unfunded. This is not a direct fund theft issue, but it is a user-visible promise/state break and can make agents believe an incentive was attached when it was not.

Suggested fix:

- Add a signing-intent continuation state equivalent to handoff `feedback_bonus_prepared`.
- Store the nested Feedback Bonus transaction plan on the signing intent.
- Let `BrowserSigningPage` execute and confirm that follow-up plan through `rateloop_confirm_feedback_bonus_transactions`.
- Add a route/UI regression test matching the existing handoff retry test.

### M-1: Base Sepolia advertises one-shot x402 ABI against an older submitter

Severity: Medium for staging. High only if `84532` is used as a required validation gate for the same one-shot UX now expected on mainnet.

Fix scope: Sepolia deployment refresh, or app/tooling gating for `84532`. No Base mainnet redeploy.

Evidence:

- `packages/foundry/deployments/84532.json` still maps `X402QuestionSubmitter` to `0x24AB19e0D8052DEc62bEc59e986e336adc4721F3`.
- `packages/contracts/src/deployedContracts.ts` and generated ABI surfaces expose `feedbackBonusEscrow()` and `submitQuestionWithX402OneShotPayment(...)` for that chain.
- The x402 planner calls `computeX402QuestionOneShotPaymentNonce` and encodes `submitQuestionWithX402OneShotPayment` whenever a single-question ask has a USDC Feedback Bonus.
- The review agents reported a live selector sanity check where the Base mainnet submitter responded to `feedbackBonusEscrow()`, while the Base Sepolia submitter reverted on that selector.

Scenario:

A staging environment targets Base Sepolia and exercises native x402 with a USDC Feedback Bonus. The app trusts the shared deployment artifacts, computes or submits against the newer one-shot ABI, and fails against the older submitter.

Impact:

Base Sepolia cannot currently validate the same x402 plus USDC Feedback Bonus path that production metadata now advertises for Base mainnet. This can hide production regressions or make staging look broken while production is correctly refreshed.

Suggested fix:

- Preferred for staging fidelity: redeploy/refresh Base Sepolia and regenerate `packages/foundry/deployments/84532.json` plus `@rateloop/contracts` artifacts.
- If Sepolia refresh should wait: gate one-shot x402 Feedback Bonus support by a runtime/readiness capability check, and return a clear configuration error on `84532`.

### M-2: Readiness checks miss the new one-shot x402 boundary

Severity: Medium

Fix scope: tooling-only. No contract redeploy.

Evidence:

- `scripts/check-base-sepolia-readiness.mjs` delegates to `scripts/check-worldchain-sepolia-readiness.mjs`.
- `REQUIRED_SELECTOR_CHECKS` currently includes old x402 selectors for `computeX402QuestionPaymentNonce` and `submitQuestionWithX402Payment`.
- The live pointer checks include `registry()` and `questionRewardPoolEscrow()`, but not `feedbackBonusEscrow()`.

Scenario:

`base-sepolia:check -- --live` passes because the old x402 selector and old pointers exist, while the one-shot Feedback Bonus selector and `feedbackBonusEscrow()` pointer are absent or stale. This is exactly the kind of check that should have caught the Sepolia artifact mismatch.

Impact:

Operators can get a green readiness check from a chain that cannot run the new one-shot Feedback Bonus UX.

Suggested fix:

- Add live selector checks for `computeX402QuestionOneShotPaymentNonce` and `submitQuestionWithX402OneShotPayment`.
- Add a live pointer check for `X402QuestionSubmitter.feedbackBonusEscrow() == FeedbackBonusEscrow`.
- Run those checks for Base Sepolia and Base mainnet.

### M-3: Next.js server confirmation can use Base preconfirmation RPCs

Severity: Medium

Fix scope: app/env/docs. No contract redeploy.

Evidence:

- `packages/nextjs/lib/env/server.ts` passes `NEXT_PUBLIC_USE_BASE_PRECONF_RPC` into server target-network resolution.
- `packages/nextjs/utils/env/targetNetworks.ts` swaps Base target networks to preconfirmation metadata when that flag is true.
- `packages/nextjs/lib/x402/questionSubmission.ts` builds server public clients from the resolved target network RPC URL.
- `docs/env-parity.md` says Base Flashblocks/preconfirmation RPCs are for frontend transaction UX, while Ponder and Keeper stay on sealed-block RPCs.

Scenario:

Vercel sets `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` to speed browser UX. The same public env is visible to Next.js server code, so server confirmation routes may wait for and validate receipts through the preconfirmation RPC rather than a sealed-block RPC.

Impact:

This can create a subtle source-of-truth split: app server state may advance based on a preconfirmation endpoint while Ponder and Keeper stay sealed-block canonical. It may be fine if the provider only returns mined receipts, but the code and docs currently do not make that boundary explicit.

Suggested fix:

- Split frontend preconfirmation RPC config from server confirmation RPC config, for example with a server-only `RATELOOP_SERVER_RPC_URL_<chainId>` or an option that disables preconfirmation metadata in `resolveServerTargetNetworks`.
- Or explicitly document and test that the chosen preconfirmation provider only returns finalized/mined receipts for server receipt calls.

### M-4: Low-level wallet-call docs do not tell hosts to honor `requiresAtomicExecution`

Severity: Medium

Fix scope: docs and agent/SDK guidance. No contract redeploy.

Evidence:

- `packages/nextjs/public/docs/ai.md` tells low-level MCP wallet-call hosts to execute returned `transactionPlan.calls`.
- `packages/nextjs/public/docs/sdk.md` similarly says to execute prepared `transactionPlan.calls` in order.
- `packages/sdk/src/agent.ts` exposes `requiresAtomicExecution?: boolean` on `RateLoopAgentWalletTransactionPlan`.
- Feedback Bonus wallet-call plans set `requiresAtomicExecution: true`.

Scenario:

A low-level MCP or SDK integrator receives a two-call Feedback Bonus plan marked `requiresAtomicExecution: true`, but docs only say to execute calls in order. They submit `approve` and `createFeedbackBonusPoolWithAsset` as separate transactions. If the second transaction fails, the user can be left with an exact allowance to a RateLoop escrow contract.

Impact:

The approval is scoped to a known RateLoop escrow and exact amount, so this is not an arbitrary spender loss. Still, it violates the plan semantics and reintroduces the partial-state UX that atomic-required plans were meant to prevent.

Suggested fix:

- Update low-level MCP and SDK docs to say callers must execute `requiresAtomicExecution` plans as atomic wallet batches or refuse with a clear error.
- Provide sample branching for ordered-only vs atomic-required plans.

### M-5: Local signer ignores `requiresAtomicExecution`

Severity: Medium/Low

Fix scope: agent-only or docs-only. No contract redeploy.

Evidence:

- `packages/nextjs/lib/x402/questionSubmission.ts` marks separate Feedback Bonus funding plans `requiresAtomicExecution: true`.
- `packages/agents/src/localSigner.ts` validates `requiresOrderedExecution`, but does not enforce `requiresAtomicExecution`.
- `local-ask` then sends each validated call sequentially through viem.
- `packages/agents/README.md` documents this as sending every validated call in order.

Scenario:

`local-ask` receives a separate Feedback Bonus plan with `approve + createFeedbackBonusPoolWithAsset`. It validates the calls, submits the approval, and then the create call fails.

Impact:

The signer can leave an exact allowance behind. This is less exposed than a browser wallet because the path is a trusted local automation wallet and the spender is a RateLoop escrow, but it contradicts the plan flag.

Suggested fix:

- Either reject multi-call plans with `requiresAtomicExecution` in the local signer unless it gains atomic batch support, or explicitly rename/document the local signer as an intentional trusted sequential exception.
- If keeping sequential behavior, add recovery guidance that operators should revoke or retry after a failed second call.

### M-6: Direct HTTP, SDK, and docs disagree on Feedback Bonus support

Severity: Medium

Fix scope: docs and SDK if raw direct HTTP support is intended; app-only if direct HTTP should reject Feedback Bonus. No contract redeploy.

Evidence:

- `packages/sdk/src/agent.ts` rejects `askHumans({ transport: "http", feedbackBonus })`.
- Public docs say direct `POST /api/agent/asks` rejects Feedback Bonus and direct HTTP is bounty-only.
- The raw `packages/nextjs/app/api/agent/asks/route.ts` forwards to the same public MCP path used by wallet-call asks.
- `packages/nextjs/lib/mcp/tools.ts` can parse and process `feedbackBonus` for permissionless wallet asks.

Scenario:

An SDK caller using `transport: "http"` sees an immediate SDK error. A non-SDK caller posting directly to `/api/agent/asks` may get a wallet plan with Feedback Bonus support. The same advertised transport surface behaves differently depending on client.

Impact:

Integrator confusion and inconsistent support burden. This is not a fund safety issue, but it undermines the "direct HTTP is bounty-only" contract in the docs.

Suggested fix:

- If raw direct HTTP Feedback Bonus support is intended, update docs and SDK to support it consistently.
- If direct HTTP should remain bounty-only, enforce that rejection in the API route too.

### L-1: Checked-in production env does not opt into Base preconfirmation UX

Severity: Low

Fix scope: env/config. No contract redeploy.

Evidence:

- `packages/nextjs/.env.production` sets `NEXT_PUBLIC_TARGET_NETWORKS=8453`, but does not set `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true`.
- `packages/nextjs/.env.example` and `packages/nextjs/README.md` document the preconfirmation opt-in.

Scenario:

A production deployment relies on checked-in production env defaults instead of Vercel dashboard env. The browser remains on ordinary Base RPC metadata/polling and does not get the intended Flashblocks/preconfirmation UX.

Impact:

Slower perceived confirmations, but no safety issue.

Suggested fix:

- Confirm Vercel production sets `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` and optionally `NEXT_PUBLIC_BASE_PRECONF_RPC_URL_8453`.
- If checked-in production env is meant to be deploy-ready, add the flag there. If not, document that Vercel dashboard env is authoritative.

### L-2: Review and audit docs contain superseded findings

Severity: Low

Fix scope: docs-only. No contract redeploy.

Evidence:

- `docs/transaction-ux-review-2026-06-19.md` has a remediation ledger at the top, but its body still lists fixed findings as current release blockers and still frames Base mainnet redeploy as required.
- `docs/non-contract-audit-followup-2026-06-19.md`, if retained as active guidance, appears to contain at least one superseded keeper/Ponder deployment identity finding according to current keeper code.

Scenario:

An operator or future reviewer reads the body of older docs rather than the remediation ledger and concludes Base mainnet still needs a redeploy or that already-fixed items remain open.

Impact:

Wasted review time and possible unnecessary redeploy planning.

Suggested fix:

- Mark old findings as superseded inline, or replace the stale body with a "historical findings; see remediation ledger and recheck doc" note.
- Keep this recheck document as the current source for open non-redeploy findings.

## Cleared Items From This Pass

- The previous browser x402 signed-authorization drop is fixed: x402 signing intents now bypass the prepared short-circuit when a signed `paymentAuthorization` is supplied.
- Browser x402 validation now expects bounty plus USDC Feedback Bonus, and rejects LREP in x402 mode.
- One-shot Feedback Bonus confirmation is now repairable for already submitted records.
- Browser handoff completion can now treat repeated primary ask hashes idempotently while in `feedback_bonus_prepared`.
- Browser wallet execution honors `requiresAtomicExecution` and stops unsupported wallets instead of splitting protected batches.
- Current Base mainnet artifacts point at the refreshed `X402QuestionSubmitter` address.
- Thirdweb is documented primarily as wallet, top-up, and sponsorship tooling, not as the default Flashblocks/preconfirmation provider.

## Suggested Fix Order

1. Fix H-1 in signing intents and browser signing UI. This is the only high-severity user-flow bug found in the current pass and is app-only.
2. Add readiness checks for one-shot x402 selector and `feedbackBonusEscrow()` pointer on Base Sepolia/mainnet.
3. Decide Base Sepolia policy: refresh Sepolia, or gate one-shot x402 Feedback Bonus off on `84532`.
4. Split or document server canonical RPC vs browser preconfirmation RPC.
5. Align direct HTTP Feedback Bonus behavior across route, SDK, and docs.
6. Update low-level docs and local signer behavior or documentation for `requiresAtomicExecution`.
7. Mark stale review docs as superseded or historical.

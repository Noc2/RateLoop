# Transaction UX Implementation Review - 2026-06-19

Reviewed `main` at `82e2487a` after the Base preconfirmation, batching, pure-agent fast round, one-shot x402, public docs, ABI regeneration, and contract-size follow-up commits.

Current status note: this is a historical implementation review, not the current redeploy runbook. Use the remediation
ledger below and `docs/transaction-ux-recheck-2026-06-19.md` for current status. Base mainnet metadata has since been
refreshed; do not treat the historical H-1 body as a reason for a routine Base mainnet redeploy. The remaining
deployment-bound issue from that family is Base Sepolia staging fidelity, or gating one-shot x402 Feedback Bonus support
off on `84532` until staging is refreshed.

Remediation status after the non-redeploy fix pass on June 19, 2026:

- Historical H-1 is superseded for Base mainnet after the mainnet deployment metadata refresh. Base Sepolia still needs a staging refresh or app/tooling gating before it can validate one-shot x402 Feedback Bonus flows.
- H-2 and M-1 were fixed by `79a7e6d8` (`fix(agent): complete browser x402 signing intents`).
- H-3 and M-2 were fixed by `4e5abd15` (`fix(agent): make feedback bonus confirmation retryable`).
- M-3 was fixed by `b797863b` (`fix(agent): require atomic feedback bonus batches`).
- M-4 was fixed by `a348d958` (`docs(agent): split direct ask feedback bonus guidance`).
- L-1 was fixed by `7feb8f14` (`fix(agent): allow lrep feedback bonus schema`).
- L-2 was fixed by `7dba8d5a` (`fix(contracts): validate x402 feedback bonus escrow`).
- L-3 was fixed by `f7cf1112` (`docs(env): clarify base rpc provider roles`).
- L-5 was fixed by `be990852` (`fix(agent): remove unused handoff helper`).
- L-4 remains a size-headroom guardrail rather than a correctness bug; `yarn workspace @rateloop/foundry check:sizes` is still the required gate and remained green after the contract hardening pass.

Scope:

- Contracts touched by one-shot x402 funding and feedback bonuses.
- Next.js agent ask, browser handoff, browser signing, wallet execution, docs, and environment wiring.
- Agent/local signer schemas and examples where they intersect the transaction UX.
- Base deployment artifacts and generated contract package consistency.

Severity guide:

- High: release blocker or durable production state/funding risk.
- Medium: can break a supported flow, create partial state, or mislead integrators.
- Low: hardening, cleanup, or operational consistency issue.

## Executive Summary

No direct on-chain fund theft or nonce-replay issue was found in the new x402 contract path. The nonce binding, USDC amount checks, stale question reward escrow check, residual balance checks, and downstream escrow reverts look sound.

At the time of this review, the main release blockers were off-chain and deployment consistency issues:

1. Generated ABIs advertised one-shot x402 functions at existing Base submitter addresses before those addresses were refreshed.
2. Browser x402 signing intents can drop the signed EIP-3009 authorization on the second prepare call.
3. One-shot Feedback Bonus confirmation can mark the ask submitted before persisting the funded bonus pool metadata.

## Findings

### H-1: Generated Base x402 ABI is ahead of the live deployment artifacts

Evidence:

- `packages/foundry/deployments/8453.json` still maps `X402QuestionSubmitter` to `0x523Dc1e57E0AB7b35fD927B875aEA756A0038914`.
- `packages/foundry/deployments/84532.json` still maps `X402QuestionSubmitter` to `0x24AB19e0D8052DEc62bEc59e986e336adc4721F3`.
- `packages/contracts/src/deployedContracts.ts` now exposes the updated `X402QuestionSubmitter` ABI at those same addresses, including `_feedbackBonusEscrow`, `feedbackBonusEscrow()`, and `submitQuestionWithX402OneShotPayment(...)`.
- Current source and deploy code require the new constructor argument in `packages/foundry/contracts/X402QuestionSubmitter.sol:48` and `packages/foundry/script/Deploy.s.sol:294`.

Impact:

The app/package can plan calls against selectors that the currently recorded Base deployments likely do not implement. Native x402 asks with USDC Feedback Bonus can fail at nonce computation or submit time even though TypeScript says the function exists.

Suggested fix:

- Current status: do not redeploy Base mainnet solely for this historical finding. Base mainnet metadata has been refreshed; Base Sepolia remains the stale staging boundary.
- Refresh `packages/foundry/deployments/84532.json` and generated `@rateloop/contracts` artifacts from a refreshed Base Sepolia deployment, or gate the one-shot x402 Feedback Bonus path off on `84532`.
- Add a readiness check that calls `feedbackBonusEscrow()` or validates the one-shot selector on the deployed submitter before publishing docs/ABI for live chains.

Regression coverage:

- Add a deployment-readiness script/test that fails when generated `X402QuestionSubmitter` ABI requires one-shot support but the deployed address does not respond to `feedbackBonusEscrow()`.

### H-2: Browser x402 signing intents drop the signed authorization

Evidence:

- `packages/nextjs/lib/agent/signingIntents.ts:259` treats an x402 signing intent as prepared as soon as `x402AuthorizationRequest` is present.
- `packages/nextjs/lib/agent/signingIntents.ts:366` returns the stored intent before forwarding `params.paymentAuthorization` into `rateloop_ask_humans` at `packages/nextjs/lib/agent/signingIntents.ts:371`.
- `packages/nextjs/components/agent/BrowserSigningPage.tsx:279` first prepares, signs typed data, then calls prepare again with the signed authorization.

Impact:

The browser x402 flow can get stuck after the typed-data signature. The second prepare returns the existing authorization request instead of producing the signed transaction plan, so the user never reaches the final submit transaction.

Suggested fix:

- For x402 intents, only short-circuit when a signed transaction plan exists.
- Alternatively, bypass the short-circuit whenever `paymentAuthorization` is supplied.
- Persist both phases explicitly: `authorization_requested` and `transaction_plan_prepared`.

Regression coverage:

- Add a route test that creates a browser signing intent with `paymentMode: "eip3009_usdc_authorization"`, prepares once, posts a valid `paymentAuthorization`, and asserts the second response contains `transactionPlan.calls`.

### H-3: One-shot Feedback Bonus confirmation can become non-repairable

Evidence:

- `packages/nextjs/lib/x402/questionSubmission.ts:3653` updates the ask status to `submitted`.
- `packages/nextjs/lib/x402/questionSubmission.ts:3662` only then checks and records the `FeedbackBonusPoolCreated` event.
- `packages/nextjs/lib/x402/questionSubmission.ts:3566` returns early for already submitted records, so a retry after a crash in the gap will not reprocess the one-shot Feedback Bonus event.

Impact:

The on-chain one-shot transaction can fund both the ask and Feedback Bonus pool, but the local database can permanently show the bonus as still awaiting funding if the process dies or throws after the ask status update and before `updateStoredFeedbackBonusReceipt`.

Suggested fix:

- Make ask submission status and one-shot Feedback Bonus receipt updates atomic in one database transaction.
- Also make the submitted-state retry path repair missing one-shot bonus metadata from the stored transaction hashes.

Regression coverage:

- Add a test that simulates a crash after `updateSubmissionStatus` and verifies a second confirmation repairs the funded bonus state.

### M-1: Browser one-shot x402 validation rejects valid USDC bonus authorizations

Evidence:

- `packages/nextjs/components/agent/BrowserSigningPage.tsx:294` validates x402 typed data with `readBrowserSigningBountyAmount(intent.requestBody)`.
- `packages/nextjs/lib/agent/browserSigningValidation.ts:186` only reads `bounty.amount`.
- The one-shot x402 planner uses bounty plus USDC Feedback Bonus as the authorization value in `packages/nextjs/lib/x402/questionSubmission.ts:384`.

Impact:

Even after H-2 is fixed, browser x402 signing for a single-question USDC Feedback Bonus ask can reject the correct authorization because the expected value is too low.

Suggested fix:

- Add `readBrowserSigningExpectedX402Amount()` that returns `bounty.amount + feedbackBonus.amount` when the feedback bonus asset is USDC.
- Keep LREP bonuses rejected for x402 mode.
- Update the error copy from "bounty amount" to "requested x402 payment amount".

Regression coverage:

- Add browser signing validation tests for bounty-only, bounty plus USDC bonus, and LREP bonus rejection.

### M-2: Handoff completion retries can be routed to the wrong confirmation phase

Evidence:

- `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:73` decides whether to call ask confirmation or Feedback Bonus confirmation only from `handoff.status`.
- After ask confirmation returns a separate Feedback Bonus transaction plan, `packages/nextjs/app/api/agent/handoffs/[handoffId]/complete/route.ts:88` stores `feedback_bonus_prepared`.

Impact:

If the user or wallet retries the original ask completion after the status switches to `feedback_bonus_prepared`, the route can submit the original ask transaction hash to `rateloop_confirm_feedback_bonus_transactions`. That should fail rather than steal funds, but it makes retries brittle and confusing.

Suggested fix:

- Store plan phases separately and require a phase or plan id on completion requests.
- Accept idempotent repeats of the already stored ask transaction hashes even after the bonus plan is prepared.

Regression coverage:

- Add a handoff route test that confirms an ask, receives a Feedback Bonus plan, then repeats the original ask hash and receives an idempotent ask response instead of a bonus-confirmation error.

### M-3: Atomic batch fallback silently degrades to sequential execution

Evidence:

- `packages/nextjs/hooks/useWalletTransactionPlanExecutor.ts:94` calls `sendCallsSyncAsync` with `forceAtomic: true`.
- Unsupported `wallet_sendCalls` errors fall through to sequential `sendTransaction` execution in `packages/nextjs/hooks/useWalletTransactionPlanExecutor.ts:119`.
- Plans carry `requiresOrderedExecution: true`, but there is no separate `requiresAtomicExecution` flag or abort path.
- `docs/base-signing-ux.md:37` currently documents the fallback as expected for wallets without atomic support.

Impact:

This is partly intentional compatibility behavior, but the UX can imply "one atomic batch" while the actual fallback leaves partial state possible. For example, an exact token approval can remain if the follow-up call fails. The approval is to a known RateLoop escrow/contract, so this is not an immediate arbitrary-spender loss, but it is a security/UX expectation mismatch.

Suggested fix:

- Decide per plan whether sequential fallback is acceptable.
- If not, add `requiresAtomicExecution` and refuse unsupported wallets for those plans.
- If sequential fallback remains acceptable, make the UI explicitly label it as multi-transaction recovery mode.

Regression coverage:

- Add executor tests that distinguish ordered-only plans from atomic-required plans.

### M-4: Public AI docs blur direct JSON and MCP/handoff Feedback Bonus support

Evidence:

- `packages/nextjs/public/docs/ai.md:175` and `packages/nextjs/app/(public)/docs/ai/page.tsx:451` say to use MCP for optional Feedback Bonus until direct JSON bonus support is documented.
- The same docs show `feedbackBonus` in the ask payload and describe one-shot funding in the shared example.
- `packages/sdk/src/agent.ts:910` still throws for `transport: "http"` when `feedbackBonus` is supplied.

Impact:

Integrators can reasonably try direct HTTP with `feedbackBonus` and hit an SDK/runtime error, even though nearby docs imply the payload is valid.

Suggested fix:

- Split the public examples into "MCP/browser handoff with Feedback Bonus" and "direct HTTP without Feedback Bonus".
- Or implement and document direct HTTP Feedback Bonus support consistently in the SDK and route docs.

Regression coverage:

- Add docs tests that assert the direct HTTP section does not include unsupported bonus payloads unless the SDK supports them.

### L-1: Agent schema blocks LREP Feedback Bonus despite implementation/docs support

Evidence:

- `packages/nextjs/lib/agent/schemas.ts:262` allows only `USDC`/`usdc` for `feedbackBonus.asset`.
- The surrounding schema description at `packages/nextjs/lib/agent/schemas.ts:502` says LREP or USDC are supported, with LREP requiring `wallet_calls`.
- `packages/agents/src/questions/types.ts:38` omits `feedbackBonus` from `AgentAskExample`.

Impact:

Tool/schema clients can reject a documented LREP Feedback Bonus before server logic has a chance to route it to wallet calls.

Suggested fix:

- Allow `LREP`/`lrep` in `agentFeedbackBonusInputSchema`.
- Keep runtime rejection for x402 authorization mode.
- Add `feedbackBonus` to agent example types.

### L-2: `setFeedbackBonusEscrow` lacks the shape/adoption checks used by reward escrow rotation

Evidence:

- `packages/foundry/contracts/X402QuestionSubmitter.sol:64` validates that the new question reward escrow is adopted by the registry.
- `packages/foundry/contracts/X402QuestionSubmitter.sol:70` only checks the new Feedback Bonus escrow is nonzero.
- The one-shot path calls `IFeedbackBonusEscrow(configuredFeedbackEscrow).createFeedbackBonusPoolFromGateway(...)` at `packages/foundry/contracts/X402QuestionSubmitter.sol:386`.

Impact:

Owner/governance misconfiguration can point one-shot bonus funding at the wrong contract. This is not a permissionless exploit, but the contract can harden against a bad rotation.

Suggested fix:

- Add a Feedback Bonus escrow shape check in the constructor and setter, for example code length plus `registry() == registry`, `usdcToken() == usdcToken`, and `votingEngine() == registry.votingEngine()`.

### L-3: Thirdweb RPC examples are stale for the Flashblocks/preconfirmation split

Evidence:

- `packages/nextjs/.env.example:16` still gives a thirdweb RPC URL as the generic `NEXT_PUBLIC_RPC_URL_*` example.
- `README.md:80` says Next.js reads contracts via thirdweb, wagmi, and Ponder.
- Newer docs correctly require configured Base browser RPCs for preconfirmation and keep Ponder/Keeper on sealed-block RPCs.

Impact:

This can confuse deployment operators into thinking the thirdweb RPC is the preconfirmation provider, or into using one provider for browser UX, Ponder, and Keeper.

Suggested fix:

- Make `.env.example` provider-neutral for generic browser RPCs.
- Point Flashblocks users at `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` plus Flashblocks-capable `NEXT_PUBLIC_RPC_URL_8453` / `84532`.
- Clarify thirdweb's role as wallet/top-up/sponsorship config, not canonical indexing or preconfirmation by default.

### L-4: `ContentRegistry` deploy bytecode has only 7 bytes of headroom

Evidence:

- The contract-size fix brought deploy-profile `ContentRegistry` to 24,569 bytes, 7 bytes below the 24,576 byte EIP-170 cap.
- `packages/foundry/README.md:48` notes that live deploys and size gates must use `FOUNDRY_PROFILE=deploy`; default profile artifacts can be oversized.

Impact:

The current deploy profile passes, but future changes to `ContentRegistry` can break deployability with tiny edits.

Suggested fix:

- Before the next `ContentRegistry` feature, move another helper path into a library or split less central logic out of the registry.
- Keep `check-contract-sizes` as a required gate for every contract-touching commit.

### L-5: Unused handoff zero-value helper remains after wallet plan refactor

Evidence:

- `packages/nextjs/components/agent/AgentAskHandoffPage.tsx:1567` defines `assertZeroValue`.
- No other reference to `assertZeroValue` exists in that file.

Impact:

No runtime impact, but lint/pre-commit output is noisier and can hide more meaningful warnings.

Suggested fix:

- Remove the dead helper or route handoff call normalization through the shared wallet plan normalizer.

## Checked Without Findings

- x402 contract nonce construction binds chain, registry, reward escrow, feedback escrow, gateway, payer/payee/value/validity, submission content, reward terms, round config, confidentiality, feedback terms, and metadata.
- The one-shot contract path requires USDC, exact bounty plus bonus authorization value, x402 submitter as payee, and a configured Feedback Bonus escrow when the bonus amount is nonzero.
- Downstream registry/escrow reverts roll back token transfer and content writes.
- USDC residual checks remain strict after old and one-shot x402 submission paths.
- Flashblocks/preconfirmation docs are generally scoped to the frontend, while Ponder and Keeper docs keep canonical indexing/automation on sealed-block RPCs.

## Verification Run

Read-only verification performed during the review:

```bash
yarn node ../../scripts/run-node-tests.mjs lib/agent/browserSigningValidation.test.ts lib/agent/walletTransactionPlan.test.ts lib/x402/questionSubmission.test.ts app/api/agent/routes.test.ts
```

Result: 76 passed, 0 failed. The tests do not currently cover H-2, H-3, M-1, or M-2 directly.

```bash
forge test --offline --match-path test/QuestionRewardPoolEscrow.t.sol --match-test X402
```

Result: 11 passed, 0 failed.

Parallel contract review also checked deploy-profile build/size behavior with temp cache/output and found the deploy profile passing while `ContentRegistry` remains 7 bytes under the cap.

## Recommended Fix Order

1. Refresh/regenerate Base Sepolia artifacts, or gate the one-shot ABI/docs on `84532` until staging is refreshed. Do not treat Base mainnet redeploy as routine follow-up for this historical issue.
2. Fix browser x402 two-step prepare and expected amount validation together.
3. Make one-shot confirmation and Feedback Bonus receipt persistence atomic or repairable.
4. Harden handoff completion idempotency across ask and bonus phases.
5. Decide and encode atomic-required versus ordered-only transaction plan semantics.
6. Align docs, SDK, agent schemas, and env examples.
7. Apply low-risk cleanup and contract hardening.

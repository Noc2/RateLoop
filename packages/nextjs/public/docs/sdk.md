# RateLoop SDK And Agent Integration

RateLoop exposes SDK, MCP, and JSON routes so agents can quote, submit, fund, track, and read paid human feedback rounds.

## Use The SDK When

- You are building a TypeScript agent or app.
- You need helper functions for hosted reads, payout snapshot status, result templates, vote commits, or agent result parsing.
- You need typed hosted reads, including `read.getRaterParticipationStatus(address)` for participation lane, human credential state, active/full launch cap progress, and the indexed chain timestamp used for that status.
- You want wallet-agnostic helpers that can feed browser, viem, wagmi, thirdweb, or custom signing flows.
- You are configuring a registered frontend operator address so votes and payout-root operations can be attributed to the same 1,000 LREP-bonded operator.

## Use Public MCP When

- The agent host supports remote MCP.
- The user can provide a funded wallet address and approve transaction calls.
- You want standard tool calls such as `rateloop_quote_question`, `rateloop_ask_humans`, and `rateloop_get_result`.
- You want to attach an optional feedback bonus pool to a single-question ask.
- You want an agent to rate existing content without sending plaintext vote direction, prediction, or salt to hosted infrastructure.

The exported TypeScript helpers use the RateLoop namespace. MCP tool names currently retain the legacy `rateloop_`
namespace for compatibility.

Public MCP endpoint:

```text
https://www.rateloop.xyz/api/mcp/public
```

## Use JSON Routes When

- The agent does not support MCP.
- You want direct HTTP integration for quote, ask, confirmation, status, and result routes.

Core routes:

```text
GET  /api/agent/templates
POST /api/agent/quote
POST /api/agent/asks
POST /api/agent/asks/{operationKey}/confirm
GET  /api/agent/asks/{operationKey}
GET  /api/agent/results/{operationKey}
```

## Minimal Ask Shape

Use this shape after a successful quote. USDC amounts are atomic units, so `2500000` means 2.5 USDC. LREP amounts use LREP atomic units. Replace the wallet, set `bountyStartBy` to the latest acceptable first-round start timestamp, and set the bounty and feedback windows in seconds.

```json
{
  "chainId": 480,
  "clientRequestId": "design-review-2026-05-05-001",
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "paymentMode": "wallet_calls",
  "bounty": {
    "amount": "2500000",
    "asset": "USDC",
    "requiredVoters": "5",
    "requiredSettledRounds": "1",
    "bountyStartBy": "1893456000",
    "bountyWindowSeconds": "1200",
    "feedbackWindowSeconds": "1200"
  },
  "feedbackBonus": {
    "amount": "2000000",
    "asset": "USDC"
  },
  "maxPaymentAmount": "4500000",
  "question": {
    "title": "Does this landing page explain the product clearly?",
    "contextUrl": "https://example.com/public-preview",
    "categoryId": "5",
    "tags": ["design", "landing-page"],
    "templateId": "feature_acceptance_test",
    "templateInputs": {
      "acceptanceCriteria": "Vote up only if a first-time visitor can explain what the product does and who it is for.",
      "expectedBehavior": "The page makes the core value proposition clear without relying on private context.",
      "releaseStage": "preview",
      "testSteps": "Open the preview, read the first screen, scan the primary CTA, and report any blockers or confusion."
    }
  }
}
```

For `paymentMode: "wallet_calls"`, RateLoop returns an ordered transaction plan. The wallet signs and executes those calls, then the agent confirms the hashes. Use `paymentMode: "x402_authorization"` only when the agent wallet should sign a native USDC authorization before RateLoop prepares the transaction plan.

`feedbackBonus` is optional and MCP-only. Use it when written feedback is useful in addition to the rating result. The bonus can use `asset: "USDC"` or `asset: "LREP"` when `paymentMode` is `"wallet_calls"`; `x402_authorization` remains USDC-only. After `confirmAskTransactions`, the response can include `feedbackBonus.transactionPlan`; execute those calls and call `confirmFeedbackBonusTransactions` or the MCP tool `rateloop_confirm_feedback_bonus_transactions`. The approved `maxPaymentAmount` should cover the USDC bounty plus any USDC Feedback Bonus; LREP Feedback Bonuses are approved by the returned wallet calls.

## Rating Existing Content Through MCP

Use `@rateloop/sdk/agent` to call the MCP rating tools, and use `@rateloop/sdk/vote` to build the encrypted commit locally. The prepare call accepts encrypted commit material only; do not send `isUp`, predicted crowd share, or salt to hosted MCP.

```ts
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const agent = createRateLoopAgentClient({
  apiBaseUrl: "https://www.rateloop.xyz",
});

const context = await agent.getRatingContext({
  chainId: 480,
  contentId: "42",
  walletAddress: "0xYourWallet",
});

// If context.openRoundTransactionPlan exists, execute it first, then fetch context again.
const runtime = context.runtime ?? {};
const commit = await buildCommitVoteParams({
  voter: "0xYourWallet",
  contentId: 42n,
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 1,
  epochDuration: context.runtime?.epochDuration ?? 20 * 60,
  roundId: BigInt(context.runtime?.roundId ?? "0"),
  roundReferenceRatingBps: context.runtime?.roundReferenceRatingBps ?? 5000,
  defaultFrontendCode: "0xYourFrontendCode",
  runtime: {
    targetRound: runtime.targetRound === undefined ? undefined : BigInt(runtime.targetRound),
    drandChainHash: runtime.drandChainHash as `0x${string}`,
    drandGenesisTimeSeconds:
      runtime.drandGenesisTimeSeconds === undefined ? undefined : BigInt(runtime.drandGenesisTimeSeconds),
    drandPeriodSeconds: runtime.drandPeriodSeconds === undefined ? undefined : BigInt(runtime.drandPeriodSeconds),
    roundStartTimeSeconds: runtime.roundStartTimeSeconds ?? null,
  },
});

const prepared = await agent.prepareRatingTransactions({
  chainId: 480,
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  roundReferenceRatingBps: commit.roundReferenceRatingBps,
  targetRound: commit.targetRound,
  drandChainHash: commit.drandChainHash,
  commitHash: commit.commitHash,
  ciphertext: commit.ciphertext,
  stakeWei: commit.stakeWei,
  frontend: commit.frontend,
});

// Execute prepared.transactionPlan.calls in order, then confirm the hashes.
await agent.confirmRatingTransactions({
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  commitHash: commit.commitHash,
  transactionHashes: ["0x..."],
});
```

## More

- RateLoop page: https://www.rateloop.xyz/docs/sdk
- For agents: https://www.rateloop.xyz/docs/ai
- Public MCP endpoint: https://www.rateloop.xyz/api/mcp/public

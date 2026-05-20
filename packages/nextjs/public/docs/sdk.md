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
- You want standard tool calls such as `curyo_quote_question`, `curyo_ask_humans`, and `curyo_get_result`.

The exported TypeScript helpers use the RateLoop namespace. MCP tool names currently retain the legacy `curyo_`
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

Use this shape after a successful quote. Amounts are atomic USDC units, so `2500000` means 2.5 USDC. Replace the wallet and set `rewardPoolExpiresAt` to a future Unix timestamp for the review window.

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
    "rewardPoolExpiresAt": "1893456000"
  },
  "maxPaymentAmount": "2500000",
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

## More

- RateLoop page: https://www.rateloop.xyz/docs/sdk
- For agents: https://www.rateloop.xyz/docs/ai
- Public MCP endpoint: https://www.rateloop.xyz/api/mcp/public

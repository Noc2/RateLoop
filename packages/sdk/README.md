# `@rateloop/sdk`

Framework-agnostic tokenless client for the complete agent flow:

```text
quote -> ask -> wait -> result
```

The SDK is HTTP-only and wallet-agnostic. It does not build transactions, manage keys, import contract deployment state, or expose the removed protocol generation.

## Example

```ts
import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({
  apiBaseUrl: "https://your-tokenless-app.vercel.app",
});

const quote = await client.quote({
  audience: {
    admissionPolicyHash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    source: "customer_invited",
  },
  budget: {
    attemptReserveAtomic: "5000000",
    bountyAtomic: "25000000",
    feeBps: 750,
  },
  question: {
    kind: "binary",
    prompt: "Should we ship this message?",
    rationale: { mode: "required", maxLength: 500 },
  },
  requestedPanelSize: 15,
});

const ask = await client.ask({
  idempotencyKey: "launch-message-2026-07-12",
  payment: { mode: "prepaid", workspaceId: "workspace_123" },
  quoteId: quote.quoteId,
});

let state = await client.wait({ operationKey: ask.operationKey });
while (state.status === "pending") {
  await new Promise((resolve) =>
    setTimeout(resolve, state.continuation.retryAfterMs),
  );
  state = await client.wait({
    operationKey: ask.operationKey,
    cursor: state.continuation.cursor,
  });
}

const result = await client.result({ operationKey: ask.operationKey });
console.log(result.verdictStatus, result.economics);
```

All amounts are unsigned base-10 strings in six-decimal USDC atomic units. Quotes and results itemize bounty, fee, attempt reserve, compensation, and refunds. A finalized payout can remain `pending_analytics`; payout finality never implies that a verdict has been published.

`apiBaseUrl` must use HTTPS except for loopback development. Every live ask requires an idempotency key. `wait` supports bounded long polling and returns an explicit continuation cursor. Runtime response parsers and `TOKENLESS_RESULT_JSON_SCHEMA` are exported from the package root.

## Commands

```bash
yarn build
yarn check-types
yarn test
```

# RateLoop SDK

Use the SDK to add a paid human quality gate when an AI-enabled output needs focused evaluation before rollout.

```ts
import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({ apiBaseUrl });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;
```

The client validates the versioned economic and verdict schema at runtime. Preserve the result status, rationale, limitations, and accounting fields, and return them to an accountable human decision owner.

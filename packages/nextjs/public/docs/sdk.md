# Tokenless SDK

```ts
import { createTokenlessRateLoopClient } from "@rateloop/sdk/tokenless";

const client = createTokenlessRateLoopClient({ apiBaseUrl });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;
```

The client validates the versioned economic and verdict schema at runtime. Existing legacy SDK exports remain temporarily available only for migration.

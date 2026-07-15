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

Browser identity is separate from the SDK: Better Auth resolves an opaque RateLoop principal and a wallet is optional.
Server integrations use scoped, revocable API keys whose workspace and client/project assignment are checked by the
server. Do not use a wallet address as a tenant identifier or authorization signal.

The public deployment is an explicit simulated sandbox. Use only public, synthetic, or safely redacted test data and do
not treat its output as live human evidence. EU-first repository checks do not establish verified EU hosting; use
`/trust` for current claim status.

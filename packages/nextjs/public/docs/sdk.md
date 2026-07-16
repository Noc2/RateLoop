# RateLoop SDK

Use `@rateloop/sdk` to add a paid human quality gate when an AI-enabled output needs focused evaluation before rollout.

```ts
import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({ apiBaseUrl, apiKey });
const quote = await client.quote(input);
const ask = await client.ask({ quoteId: quote.quoteId, idempotencyKey, payment });
const state = await client.wait({ operationKey: ask.operationKey });
const result = state.status === "ready" ? await client.result({ operationKey: ask.operationKey }) : null;
```

The client validates the versioned economics and verdict schema at runtime. Preserve the result status, rationale,
scope, and accounting fields, then return them to an accountable decision owner.

Browser identity is separate from the SDK: Better Auth resolves an opaque RateLoop principal and a wallet is optional.
Server integrations use scoped, revocable API keys whose workspace and client/project assignment are checked by the
server. A wallet address is never a tenant identifier or authorization signal.

For self-funded automation, the SDK builds and validates the exact x402/EIP-3009 authorization locally. It does not
hold private keys, invent contract addresses, or import a legacy protocol configuration. `apiBaseUrl` must use HTTPS
except for loopback development, every ask requires an idempotency key, and every bounded wait returns an explicit
continuation when the result is not ready.

## Evidence exports

Workspace members with the required role can export a completed run packet, adaptive-coverage history, the workspace
audit chain, and trusted-key history:

```text
GET /api/account/workspaces/{workspaceId}/assurance/runs/{runId}/evidence
GET /api/account/workspaces/{workspaceId}/assurance/coverage/export
GET /api/account/workspaces/{workspaceId}/audit/export
GET /api/account/workspaces/{workspaceId}/assurance/trusted-keys
```

Run the local checkers with explicit trust pins instead of trusting keys or heads from the same export:

```sh
yarn workspace @rateloop/nextjs evidence:verify ./packet.json --public-key ./key.txt --key-id ed25519:...
yarn workspace @rateloop/nextjs audit:verify ./audit-export.json --expected-head sha256:...
```

See [Evidence & Compliance Mapping](./evidence.md) for packet fields, verification boundaries, and framework
cross-references.

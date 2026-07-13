# RateLoop Agents

Small, versioned helpers for the tokenless RateLoop agent flow:

1. `quote` prices an immutable USDC-funded panel without authentication or spending.
2. `ask` submits that quote with a required idempotency key and one payment mode.
3. `wait` performs a bounded long poll and returns a continuation when work is still pending.
4. `result` returns the versioned verdict and complete fund accounting.

This package never defaults to `rateloop.ai`. Set the isolated deployment explicitly.

## Install

```bash
npm install @rateloop/agents
export RATELOOP_API_BASE_URL=https://your-tokenless-preview.vercel.app
```

## TypeScript

```ts
import {
  createTokenlessAgentsClient,
  waitUntilTokenlessReady,
} from "@rateloop/agents/tokenless";

const client = createTokenlessAgentsClient({
  apiBaseUrl: process.env.RATELOOP_API_BASE_URL!,
});

const quote = await client.quote({
  audience: {
    admissionPolicyHash:
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    source: "customer_invited",
  },
  budget: {
    attemptReserveAtomic: "500000",
    bountyAtomic: "5000000",
    feeBps: 500,
  },
  question: {
    kind: "binary",
    prompt: "Is this release ready for a public rollout?",
    rationale: { mode: "required", minLength: 20, maxLength: 500 },
  },
  requestedPanelSize: 5,
});

const ask = await client.ask({
  idempotencyKey: "release-check-2026-07-12",
  payment: { mode: "prepaid", workspaceId: "workspace_123" },
  quoteId: quote.quoteId,
});

const state = await waitUntilTokenlessReady(client, {
  maxWaitMs: 300_000,
  operationKey: ask.operationKey,
});

const result =
  state.status === "ready"
    ? await client.result({ operationKey: ask.operationKey })
    : null;
```

Wallet and x402 callers pass the corresponding `TokenlessPayment` variant to `ask`. The SDK does not hold private keys, execute contract calls, or possess a universal rater decryption key.

## CLI

The bundled examples contain a quote and a sandbox/prepaid ask request:

```bash
yarn workspace @rateloop/agents quote \
  --file packages/agents/examples/quote.json

# Copy quoteId from the quote response into ask.json first.
yarn workspace @rateloop/agents ask \
  --file packages/agents/examples/ask-prepaid.json

yarn workspace @rateloop/agents wait \
  --operation-key op_... \
  --until-ready \
  --max-wait-ms 300000

yarn workspace @rateloop/agents result --operation-key op_...
```

Without `--until-ready`, `wait` performs one bounded request and prints either a ready state or the server continuation (`cursor`, `retryAfterMs`, `expiresAt`, and canonical `pollUrl`). Persist the operation key and latest cursor so another process can resume without resubmitting the ask.

## Result contract

All responses use `rateloop.tokenless.v2`. The audience binds the exact frozen admission policy; no ordered identity tier or fabricated confidence score is exposed. Verdict status is one of:

- `pending`
- `publishable`
- `inconclusive`
- `delisted`
- `zero_commit_refunded`
- `under_quorum_compensated`
- `beacon_failure_compensated`

Deterministic sandbox responses retain `published` for compatibility. Production post-round integrity uses `publishable`; integrity status and appeal/remediation records never change finalized payout accounting.

Results itemize bounty, fee, attempt reserve, refunds, and compensation. A terminal compensation or refund result is a successful terminal protocol outcome, not a transport failure.

## Environment

| Variable                      | Purpose                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RATELOOP_API_BASE_URL`       | Required isolated tokenless deployment origin. HTTPS is required except on loopback.                            |
| `RATELOOP_AGENT_API_KEY`      | Workspace key required by assurance commands and authenticated paid operations. It is omitted from free quotes. |
| `RATELOOP_AGENT_API_PATH`     | Optional API prefix. Defaults to `/api/agent/v1`.                                                               |
| `RATELOOP_REQUEST_TIMEOUT_MS` | Optional positive timeout for non-wait requests.                                                                |

The CLI intentionally has no implicit production origin, MCP transport, local signer, contract-address override, or legacy chain configuration. A scoped API key is attached only to authenticated paid operations and assurance project/run requests sent to the configured tokenless origin.

## Assurance integration commands

Consultancies and evaluation platforms can create client-isolated projects and read aggregate run state with a workspace API key:

```bash
export RATELOOP_AGENT_API_KEY=rlk_...

yarn workspace @rateloop/agents assurance-project-create \
  --file packages/agents/examples/assurance-project.json

yarn workspace @rateloop/agents assurance-projects
yarn workspace @rateloop/agents assurance-project --project-id hap_...
yarn workspace @rateloop/agents assurance-run --run-id hau_...
```

An evaluation platform can persist the returned project ID beside its test-suite ID and poll `assurance-run` after a run is configured in the buyer workflow. A consultancy can create one project per client/workflow and use `assurance-project` to enumerate frozen suites and recurring runs without receiving private artifacts or reviewer-level data. These commands do not create suites, upload artifacts, recruit reviewers, or fund rounds; they expose only the database-backed project inventory and aggregate run status currently implemented.

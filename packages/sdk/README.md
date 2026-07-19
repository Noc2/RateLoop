# `@rateloop/sdk`

Framework-agnostic tokenless client for the complete agent flow:

```text
quote -> ask -> wait -> result
```

The SDK is HTTP-only and wallet-agnostic. It does not build transactions, manage keys, import contract deployment state, or expose the removed protocol generation.

Browser identity is outside the SDK: Better Auth sign-in resolves to an opaque RateLoop principal and a RateLoop-owned
HttpOnly application session. A wallet is optional and is bound separately for an explicit funding, payout, or recovery
purpose. Server-to-server SDK callers use scoped, revocable workspace API keys; neither an API key nor a wallet address
is a substitute for the server's workspace and project authorization checks.

## Human-assurance projects and runs

Server-side B2B callers can use the same client with a workspace API key. Project creation requires an explicit data classification and retention period; the server derives the workspace from the key rather than accepting a caller-supplied workspace ID.

```ts
const client = createTokenlessRateLoopClient({
  apiBaseUrl: process.env.RATELOOP_API_BASE_URL!,
  apiKey: process.env.RATELOOP_AGENT_API_KEY!,
});

const project = await client.assurance.createProject({
  name: "Client support release quality",
  dataClassification: "confidential",
  retentionDays: 90,
});

const inventory = await client.assurance.getProject({
  projectId: project.projectId,
});
const status = await client.assurance.getRunStatus({
  runId: process.env.RATELOOP_ASSURANCE_RUN_ID!,
});
```

The integration API creates and lists projects, returns project resource metadata, and reads aggregate run state. The
server derives the workspace and client/project scope and denies access when the credential lacks the matching
assignment. It does not return artifacts, reviewer identities, rationales, blinding secrets, or signing keys. Artifact
upload and run creation are intentionally not exposed to API keys yet: uploads need a non-account actor audit model,
while a runnable suite also needs explicit reviewer, funding, and frozen-manifest setup. Use the authenticated buyer
workflow for those steps. The lower-level paid primitive remains `quote -> ask -> wait -> result`.

## Example

```ts
import { createTokenlessRateLoopClient } from "@rateloop/sdk";

const client = createTokenlessRateLoopClient({
  apiKey: process.env.RATELOOP_AGENT_API_KEY!,
  apiBaseUrl: "https://your-tokenless-app.vercel.app",
});

const audiencePolicy = {
  schemaVersion: "rateloop.human-assurance.v2" as const,
  policyId: "aud_public_release_customer_invited_v1",
  version: 1,
  reviewerSource: "customer_invited" as const,
  compensation: "paid" as const,
  cohorts: [
    { cohortId: "customer_named", minimumReviewers: 3, maximumReviewers: 500 },
  ],
  selection: "customer_named" as const,
  fallbacks: { allowed: false, sources: [] },
  requiredQualifications: [],
  assurance: {
    requirements: [
      {
        capability: "account_control" as const,
        reviewerSources: ["customer_invited" as const],
        allowedProviders: [],
      },
    ],
  },
  buyerPrivacy: {
    visibleFields: [],
    minimumAggregationSize: 3,
    suppressSmallCells: true,
  },
  legalEligibilityRequired: true,
};

const quote = await client.quote({
  audience: {
    admissionPolicyHash:
      "0x8681aba447f1c2d918b038b1109b4f4112877b0acaa3f132da97e98a3d8cf09c",
    source: "customer_invited",
  },
  audiencePolicy,
  confirmedNoSensitiveData: true,
  dataClassification: "synthetic",
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
  responseWindowSeconds: 3600,
  visibility: "public",
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

All amounts are unsigned base-10 strings in six-decimal USDC atomic units. `responseWindowSeconds` is the frozen time available for responses. Once a round exists, ask and result envelopes expose its absolute ISO-8601 `commitDeadline`; `slo.estimatedSeconds` remains only an end-to-end fill estimate and must never be used to derive either value. Profile-bound requests and results also carry the immutable request-profile reference and frozen per-seat/panel economics.

Quotes and results itemize bounty, fee, attempt reserve, compensation, and refunds. A finalized payout can remain `pending` while post-round integrity inputs arrive, become `inconclusive` when the available evidence cannot support publication, or become `delisted` when integrity risks cross the frozen policy. Only `publishable` exposes the verdict. These publication states never change finalized payout accounting.

`apiBaseUrl` must use HTTPS except for loopback development. Every live ask requires an idempotency key. `wait` supports bounded long polling and returns an explicit continuation cursor. Runtime response parsers and `TOKENLESS_RESULT_JSON_SCHEMA` are exported from the package root.

## Commands

```bash
yarn build
yarn check-types
yarn test
```

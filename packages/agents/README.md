# RateLoop Agents

Small, versioned helpers for the tokenless RateLoop agent flow:

1. `quote` prices an immutable USDC-funded panel without authentication or spending.
2. `ask` submits that quote with a required idempotency key and one payment mode.
3. `wait` performs a bounded long poll and returns a continuation when work is still pending.
4. `result` returns the versioned verdict and complete fund accounting.

For unattended publishing, an owner can issue a policy-bound workspace key and
give the agent either a prepaid budget or an agent-controlled wallet for x402
payments. Public MCP and browser handoffs remain draft-first and approval-bound;
the autonomous API/CLI lane is authenticated, budgeted, revocable, and scoped.

Workspace credentials resolve to an opaque RateLoop principal and explicit workspace/client/project policy; they do
not inherit browser identity from a wallet address. A prepaid agent needs no wallet. A self-funded agent may use its own
encrypted wallet only for the authorized payment path, and that wallet does not grant browser or workspace access.

This package never defaults to `rateloop.ai`. Set the isolated deployment explicitly.

Image context uses authenticated staging rather than embedding bytes or storage URLs in a quote. The server returns an
opaque `assetId` and normalized-byte digest; put that descriptor and a meaningful `alt` value in `question.media.items`.
YouTube context needs no upload and is represented only by its eleven-character `videoId`.

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
  responseWindowSeconds: 3600,
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

Human browser accounts use Better Auth first and can work without a wallet. If a person later needs a funding, payout,
or recovery destination, they explicitly bind either a self-custodial wallet or an optional thirdweb app wallet for that
single purpose. This browser wallet flow is separate from the agent keystore described below.

## CLI

The bundled examples contain a quote and a prepaid ask request:

```bash
yarn workspace @rateloop/agents quote \
  --file packages/agents/examples/quote.json

yarn workspace @rateloop/agents media-upload \
  --file ./candidate.png \
  --client-request-id release-check-candidate-01

# Copy quoteId from the quote response into ask.json first.
yarn workspace @rateloop/agents ask \
  --file packages/agents/examples/ask-prepaid.json

yarn workspace @rateloop/agents wait \
  --operation-key op_... \
  --until-ready \
  --max-wait-ms 300000

yarn workspace @rateloop/agents result --operation-key op_...
```

Create an encrypted local wallet (the private key never enters an environment
variable), then run a quote → ask → x402 payment → wait → result flow:

```bash
export RATELOOP_AGENT_KEYSTORE_PASSWORD='use-a-secret-manager-in-production'
yarn workspace @rateloop/agents wallet-create \
  --keystore ~/.rateloop/tokenless-agent.json
export RATELOOP_AGENT_KEYSTORE_PATH=~/.rateloop/tokenless-agent.json
export RATELOOP_AGENT_API_KEY=rlk_policy_bound_key
export RATELOOP_AGENT_RESUME_PATH=~/.rateloop/tokenless-agent-resume.json
yarn workspace @rateloop/agents run \
  --file packages/agents/examples/run.json \
  --max-wait-ms 300000
```

`run` signs only the canonical EIP-3009 and round-authorization payloads
returned by the isolated deployment. The local run file must pin the complete
deployment identity and a maximum total in atomic USDC units; the CLI refuses
to sign if the server changes an address, deployment key, chain, quote total,
or spend ceiling. `resume` can poll a persisted operation
after a process restart. The server enforces the key's scopes, wallet binding,
audience, payment mode, panel limits, and daily/monthly budget; it does not
accept an accountless public x402 payment.

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

Post-round integrity uses `publishable`; integrity status and appeal/remediation records never change finalized payout accounting.

`responseWindowSeconds` is the frozen response window. An opened ask and its result expose the absolute ISO-8601 `commitDeadline`; never derive either value from the quote's `slo.estimatedSeconds` fill-time estimate. Profile-bound asks and results retain the exact `{ id, version, hash }` request-profile reference and frozen per-seat/panel economics.

Results itemize bounty, fee, attempt reserve, refunds, and compensation. A terminal compensation or refund result is a successful terminal protocol outcome, not a transport failure.

## Environment

| Variable                           | Purpose                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RATELOOP_API_BASE_URL`            | Required isolated tokenless deployment origin. HTTPS is required except on loopback.                            |
| `RATELOOP_AGENT_API_KEY`           | Workspace key required by assurance commands and authenticated paid operations. It is omitted from free quotes. |
| `RATELOOP_AGENT_API_PATH`          | Optional API prefix. Defaults to `/api/agent/v1`.                                                               |
| `RATELOOP_REQUEST_TIMEOUT_MS`      | Optional positive timeout for non-wait requests.                                                                |
| `RATELOOP_AGENT_KEYSTORE_PATH`     | Encrypted agent wallet path used by `run` and `wallet-address`.                                                 |
| `RATELOOP_AGENT_KEYSTORE_PASSWORD` | Password for the encrypted agent wallet; keep it in a secret manager.                                           |
| `RATELOOP_AGENT_RESUME_PATH`       | Optional mode-0600 path for a non-secret autonomous-run receipt.                                                |

The CLI intentionally has no implicit production origin, MCP transport, local signer, contract-address override, or legacy chain configuration. A scoped API key is attached only to authenticated paid operations and assurance project/run requests sent to the configured tokenless origin.

## Framework approval adapters

The package exports a non-blocking review-gate core plus LangGraph, OpenAI Agents SDK, and stable MCP form-elicitation
mappings. A driver wraps the workspace review tools and verifies RateLoop's signed output-release evidence. Serializable
pending state contains only opportunity and frozen commitment references; it never contains source or suggestion
payloads. See the machine-readable
[`framework-integrations.md`](../nextjs/public/docs/framework-integrations.md) quickstarts and trust boundaries.

`media-upload` accepts JPG, PNG, or WEBP input up to 10 MB. It sends file bytes as multipart data directly from disk,
requires `RATELOOP_AGENT_API_KEY`, and prints only the staged descriptor. The public MCP surface remains four tools and
does not accept raw image bytes.

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

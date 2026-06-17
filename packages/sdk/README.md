# RateLoop SDK

Framework-agnostic frontend SDK foundations for integrating RateLoop into existing websites and apps.

## Goals

- Provide a stable client entrypoint for hosted reads and typed write helpers.
- Reuse protocol-safe primitives from `@rateloop/contracts` instead of duplicating ABI logic.
- Stay framework-agnostic so React, Next.js, vanilla TypeScript, and server-side callers can share the same core package.
- Keep the protocol surfaces simple enough that AI-agent integrations can reuse the same submission and read flows as human users.

## Planned Surface

- `createRateLoopClient(...)` for shared configuration
- typed read helpers for indexed/hosted data
- rating vote/frontend helpers for building transaction parameters, including the redeployed tlock metadata bindings
- small, wallet-agnostic write helpers

The exported helper names use the RateLoop namespace.

Framework-specific hooks and UI components should live in a follow-up package rather than this core SDK.

**Chain IDs:** `84532` = Base Sepolia (testnet); `8453` = Base mainnet (`deploymentProfile: "production"` in `packages/foundry/deployments/8453.json`). Examples below use Base Sepolia unless noted.

`apiBaseUrl` on `createRateLoopClient` should point at the hosted Ponder indexer (`https://ponder.rateloop.ai` or your deployment's `NEXT_PUBLIC_PONDER_URL`), not the Next.js app origin. For `createRateLoopAgentClient`, set `mcpApiUrl` explicitly to your Next.js MCP host (`https://www.rateloop.ai/api/mcp/public` or managed `/api/mcp`); do not derive MCP from a Ponder `apiBaseUrl`.

## Available Today

- client config normalization via `createRateLoopClient(...)`
- typed read client for hosted/indexed HTTP routes
- `read.getRaterParticipationStatus(address)` for participation lane, human credential state, active/full launch cap progress, and the explicit reward policy flags
- vote/frontend helpers in `@rateloop/sdk/vote`
- wallet-agnostic agent helpers in `@rateloop/sdk/agent` for MCP-compatible asks, generated image uploads, gated-context acceptance, MCP rating of existing content, non-custodial agent-wallet flows, result parsing, and webhook verification

## Quick Example

```ts
import { packVoteRoundContext } from "@rateloop/contracts/votingCore";
import { createRateLoopClient } from "@rateloop/sdk";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const rateloop = createRateLoopClient({
  apiBaseUrl: process.env.PONDER_URL ?? "https://ponder.rateloop.ai",
  frontendCode: "0x1234567890123456789012345678901234567890",
});

const { content } = await rateloop.read.getContent("42");
const participationStatus = await rateloop.read.getRaterParticipationStatus(
  "0xAgentOrRaterWallet",
);

const commit = await buildCommitVoteParams({
  voter: "0xYourWalletAddress",
  contentId: 42n,
  roundId: BigInt(content.openRound?.roundId ?? 1),
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 2.5,
  epochDuration: 20 * 60,
  roundReferenceRatingBps:
    content.openRound?.referenceRatingBps ?? content.ratingBps ?? 5000,
  defaultFrontendCode: rateloop.config.frontendCode,
});

const commitVoteArgs = [
  42n,
  packVoteRoundContext(commit.roundId, commit.roundReferenceRatingBps),
  commit.targetRound,
  commit.drandChainHash,
  commit.commitHash,
  commit.ciphertext,
  commit.stakeWei,
  commit.frontend,
] as const;
```

The SDK stays wallet-agnostic on purpose. Host apps approve `stakeWei` of LREP to the voting engine, then call `commitVote(...commitVoteArgs)` with wagmi, viem, thirdweb, or their own signing flow.

## Agent Helpers

```ts
import {
  createRateLoopAgentClient,
  buildWebhookVerifier,
} from "@rateloop/sdk/agent";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const agent = createRateLoopAgentClient({
  apiBaseUrl: "https://ponder.rateloop.ai",
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public",
  // Optional. Add only when using a saved managed policy.
  mcpAccessToken: process.env.RATELOOP_MCP_TOKEN,
});

const walletAddress = "0xYourFundedAgentWallet";

const quote = await agent.quoteQuestion({
  clientRequestId: "launch-check-1",
  chainId: 84532,
  bounty: {
    amount: "1000000",
    requiredVoters: "3",
    requiredSettledRounds: "1",
    bountyEligibility: "0",
  },
  roundConfig: {
    epochDuration: "1200",
    maxDuration: "7200",
    minVoters: "3",
    maxVoters: "50",
  },
  question: {
    title: "Should the agent proceed with launch?",
    contextUrl: "https://example.com/launch-checklist",
    categoryId: "1",
    tags: ["agent", "launch"],
  },
  walletAddress,
});

const dryRun = await agent.askHumans({
  chainId: 84532,
  clientRequestId: "launch-check-1-dry-run",
  dryRun: true,
  mode: "dry_run",
  maxPaymentAmount: quote.payment?.amount ?? "1000000",
  bounty: {
    amount: "1000000",
    requiredVoters: "3",
    requiredSettledRounds: "1",
    bountyEligibility: "0",
  },
  roundConfig: {
    epochDuration: "1200",
    maxDuration: "7200",
    minVoters: "3",
    maxVoters: "50",
  },
  question: {
    title: "Should the agent proceed with launch?",
    contextUrl: "https://example.com/launch-checklist",
    categoryId: "1",
    tags: ["agent", "launch"],
  },
  walletAddress,
});

const ask = await agent.askHumans({
  chainId: 84532,
  clientRequestId: "launch-check-1",
  maxPaymentAmount: quote.payment?.amount ?? "1000000",
  bounty: {
    amount: "1000000",
    requiredVoters: "3",
    requiredSettledRounds: "1",
    bountyEligibility: "0",
  },
  roundConfig: {
    epochDuration: "1200",
    maxDuration: "7200",
    minVoters: "3",
    maxVoters: "50",
  },
  question: {
    title: "Should the agent proceed with launch?",
    contextUrl: "https://example.com/launch-checklist",
    categoryId: "1",
    tags: ["agent", "launch"],
  },
  walletAddress,
});

const status = await agent.getQuestionStatus({
  operationKey: ask.operationKey,
});
const result = await agent.getResult({ operationKey: status.operationKey });

let ratingContext = await agent.getRatingContext({
  chainId: 84532,
  contentId: "42",
  walletAddress,
});

if (ratingContext.content?.contextAccess === "gated") {
  await agent.acceptConfidentialityTerms({
    chainId: 84532,
    contentId: "42",
    walletAddress,
  });
  ratingContext = await agent.getRatingContext({
    chainId: 84532,
    contentId: "42",
    walletAddress,
  });
}
const ratingRuntime = ratingContext.runtime ?? {};

// Build this locally with @rateloop/sdk/vote. Do not send plaintext
// isUp, predicted crowd share, or salt to hosted MCP.
const encryptedCommit = await buildCommitVoteParams({
  voter: walletAddress,
  contentId: 42n,
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 1,
  epochDuration: ratingRuntime.epochDuration ?? 20 * 60,
  roundId: BigInt(ratingRuntime.roundId ?? "0"),
  roundReferenceRatingBps: ratingRuntime.roundReferenceRatingBps ?? 5000,
  defaultFrontendCode: "0xYourFrontendCode",
  runtime: {
    targetRound:
      ratingRuntime.targetRound === undefined
        ? undefined
        : BigInt(ratingRuntime.targetRound),
    drandChainHash: ratingRuntime.drandChainHash,
    drandGenesisTimeSeconds:
      ratingRuntime.drandGenesisTimeSeconds === undefined
        ? undefined
        : BigInt(ratingRuntime.drandGenesisTimeSeconds),
    drandPeriodSeconds:
      ratingRuntime.drandPeriodSeconds === undefined
        ? undefined
        : BigInt(ratingRuntime.drandPeriodSeconds),
    roundStartTimeSeconds: ratingRuntime.roundStartTimeSeconds ?? null,
  },
});

const preparedRating = await agent.prepareRatingTransactions({
  chainId: 84532,
  contentId: "42",
  walletAddress,
  roundId: encryptedCommit.roundId,
  roundReferenceRatingBps: encryptedCommit.roundReferenceRatingBps,
  targetRound: encryptedCommit.targetRound,
  drandChainHash: encryptedCommit.drandChainHash,
  commitHash: encryptedCommit.commitHash,
  ciphertext: encryptedCommit.ciphertext,
  stakeWei: encryptedCommit.stakeWei,
  frontend: encryptedCommit.frontend,
});

// Execute preparedRating.transactionPlan.calls, then call confirmRatingTransactions.

const verifier = buildWebhookVerifier({
  secret: process.env.RATELOOP_WEBHOOK_SECRET ?? "",
});
await verifier.assertValid({ body: webhookBody, headers: webhookHeaders });

const replaySafeVerifier = buildWebhookVerifier({
  secret: process.env.RATELOOP_WEBHOOK_SECRET ?? "",
  replayProtection: {
    store: webhookEventStore,
  },
});
const handled = await replaySafeVerifier.handleOnce(
  { body: webhookBody, headers: webhookHeaders },
  async (event) => {
    // Fetch status/result by operationKey before irreversible side effects.
    return processCallback(event.body);
  },
);
if (handled.status === "duplicate") {
  return new Response("ok");
}
```

Long public question context should be provided through `question.detailsUrl` plus its SHA-256 `question.detailsHash`, or through media/context URLs. Written context is no longer submitted as a separate on-chain text field. For confidential review material, use only RateLoop-hosted gated details/images with `question.confidentiality.visibility: "gated"`, omit external context URLs/videos, and choose `disclosurePolicy: "after_settlement"` or `"private_forever"`.

For generated mockups, screenshots, or local image files, agents can upload bytes directly to RateLoop before quoting an
ask. Public wallet-mode agents use `prepareImageUpload -> wallet signature -> uploadImage`; managed bearer-token agents
can call `uploadImage` directly. Use the returned `imageUrl` in `question.imageUrls`. Uploaded images are public ask
context unless the ask explicitly uses RateLoop-hosted gated context.

For ranked-option bundles, `requiredSettledRounds` is the number of completed bundle round sets to fund. Each round set requires every question in the bundle to settle once, and eligible voters claim each completed set separately.

`bountyEligibility` defaults to `0` for everyone. Everyone can still answer; the field only scopes which revealed answers can qualify for the bounty payout. For the World ID v3 launch, use `8` for Proof of Human. Agent results expose both `answerScopes.allAnswers` and `answerScopes.bountyEligibleAnswers`.

For ask flows, start with `dryRun: true` / `mode: "dry_run"` to validate the payload and receive a deterministic
synthetic result without a wallet signature, payment authorization, transaction plan, callback registration, or on-chain
submission. For live human-wallet asks, prefer `createAskHandoff({ request, generatedImages })`, share the returned
`handoffUrl`, then poll `getAskHandoffStatus` until it has an `operationKey`; from there use `getQuestionStatus` and
`getResult`. That path collapses review, image signing, USDC funding, ordered wallet calls, and submission into the
browser handoff. Use raw `askHumans -> execute wallet calls -> confirm` only for hosts that can execute wallet
transactions directly. For rating existing content, use
`getRatingContext -> acceptConfidentialityTerms when contextAccess is gated -> local encrypted commit -> prepareRatingTransactions -> execute wallet calls -> confirmRatingTransactions`.
A hosted direct HTTP client only needs `apiBaseUrl` plus a funded
`walletAddress`; `mcpAccessToken` is optional and adds managed policy enforcement, balance tooling, and audit surfaces.
Paid asks and prepared ratings return ordered wallet calls from a user-controlled smart wallet or scoped agent wallet.
The SDK stays wallet-agnostic and does not import a signing implementation.

For Tier-0, unusually sensitive, or high-value asks, prefer a longer `roundConfig.epochDuration`, a matching
`maxDuration`, and at least 8 required voters instead of shortening the blind phase for speed. Hosted MCP must receive
only encrypted commit material for ratings, never plaintext `isUp`, predicted crowd share, or salt.

Ask confirmations can wait for on-chain receipts. The SDK uses a longer `confirmTimeoutMs` for
`confirmAskTransactions`, `confirmFeedbackBonusTransactions`, and `confirmRatingTransactions` while ordinary reads and
writes use `timeoutMs`. If a confirm call times out locally, retry it with the same `operationKey` and transaction
hashes, or poll status by `operationKey`; RateLoop treats the operation key as the idempotent recovery handle.

`quoteFetchImpl` can route quote-only calls through separate infrastructure from mutating calls. Structured API errors
are exposed on `RateLoopApiError` as `code`, `retryable`, `recoverWith`, `originalCode`, and `details` so agents can
branch without parsing the message.

Public wallet-mode asks can register webhooks without a managed token. Include `webhookUrl`, `webhookSecret`, and
optional `webhookEvents`; if the response has `status: "webhook_signature_required"`, sign `message` with the paying
wallet and repeat the same ask with `webhookChallengeId: challengeId` and `webhookSignature`. The subscription is keyed
to the paying wallet on that chain. Managed-token asks can include webhook fields directly.

When an agent wallet should sign USDC authorization typed data before RateLoop prepares the submit transaction, use
`paymentMode: "eip3009_usdc_authorization"`. The older `paymentMode: "x402_authorization"` value remains accepted as a
compatibility alias, but RateLoop does not expose an HTTP 402 `PaymentRequirements` / `X-PAYMENT` wire flow today.

Webhook verification signs the raw request body with `x-rateloop-callback-id`, `x-rateloop-callback-timestamp`, and `x-rateloop-callback-signature`. Use `handleOnce` with an atomic replay store for non-idempotent handlers. The store should claim event IDs with a SQL unique insert or Redis `SET NX`, keep completed IDs longer than the callback retry window, return 2xx for duplicates, and release in-progress claims when handler work fails so RateLoop can retry.

## Agent Examples

Runtime-oriented examples live in [`packages/agents/examples`](../agents/examples). They include:

- copy-paste remote MCP configs for OpenClaw-style and Gemini CLI clients
- a canonical `landing-pitch-review.ts` loop for backend workers and agent wrappers
- notes for ChatGPT, Claude, and Hermes-style persistent agents

Use them as reference implementations for the same safe default:

1. quote before spending
2. ask with a stable client request id
3. choose whether bounty payouts are open to everyone or scoped by verified-human status
4. wait through a signed callback or poll status
5. read the structured result
6. store `publicUrl`, `operationKey`, and the result summary in memory or logs

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

## Available Today

- client config normalization via `createRateLoopClient(...)`
- typed read client for hosted/indexed HTTP routes
- `read.getRaterParticipationStatus(address)` for participation lane, human credential state, active/full launch cap progress, and the explicit reward policy flags
- vote/frontend helpers in `@rateloop/sdk/vote`
- wallet-agnostic agent helpers in `@rateloop/sdk/agent` for MCP-compatible asks, generated image uploads, MCP rating of existing content, non-custodial agent-wallet flows, result parsing, and webhook verification

## Quick Example

```ts
import { packVoteRoundContext } from "@rateloop/contracts/votingCore";
import { createRateLoopClient } from "@rateloop/sdk";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const rateloop = createRateLoopClient({
  apiBaseUrl: "https://www.rateloop.ai",
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
  apiBaseUrl: "https://rateloop.example",
  // Optional. Add only when using a saved managed policy.
  mcpAccessToken: process.env.RATELOOP_MCP_TOKEN,
});

const walletAddress = "0xYourFundedAgentWallet";

const quote = await agent.quoteQuestion({
  clientRequestId: "launch-check-1",
  chainId: 480,
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
  chainId: 480,
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
  chainId: 480,
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

const ratingContext = await agent.getRatingContext({
  chainId: 480,
  contentId: "42",
  walletAddress,
});
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
  chainId: 480,
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

Long question context should be provided through `question.detailsUrl` plus its SHA-256 `question.detailsHash`, or through media/context URLs. Written context is no longer submitted as a separate on-chain text field.

For generated mockups, screenshots, or local image files, agents can upload bytes directly to RateLoop before quoting an
ask. Public wallet-mode agents use `prepareImageUpload -> wallet signature -> uploadImage`; managed bearer-token agents
can call `uploadImage` directly. Use the returned `imageUrl` in `question.imageUrls`.

For ranked-option bundles, `requiredSettledRounds` is the number of completed bundle round sets to fund. Each round set requires every question in the bundle to settle once, and eligible voters claim each completed set separately.

`bountyEligibility` defaults to `0` for everyone. Everyone can still answer; the field only scopes which revealed answers can qualify for the bounty payout. It is a bitmask: `2` Selfie Check, `4` Passport, `8` Proof of Human. Add bits to allow any selected credential, for example `12` for Passport or Proof of Human, and add `128` to require a recent recheck, for example `140` for Passport or Proof of Human plus recent recheck. Agent results expose both `answerScopes.allAnswers` and `answerScopes.bountyEligibleAnswers`.

For ask flows, start with `dryRun: true` / `mode: "dry_run"` to validate the payload and receive a deterministic
synthetic result without a wallet signature, payment authorization, transaction plan, callback registration, or on-chain
submission. For live asks, treat `quote -> ask -> execute wallet calls -> confirm -> wait -> result` as the safe
default. For rating existing content, use `getRatingContext -> local encrypted commit -> prepareRatingTransactions ->
execute wallet calls -> confirmRatingTransactions`. A hosted direct HTTP client only needs `apiBaseUrl` plus a funded
`walletAddress`; `mcpAccessToken` is optional and adds managed policy enforcement, callbacks, balance tooling, and audit
surfaces. Paid asks and prepared ratings return ordered wallet calls from a user-controlled smart wallet or scoped agent
wallet. The SDK stays wallet-agnostic and does not import a signing implementation.

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

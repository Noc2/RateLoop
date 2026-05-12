# RateLoop SDK

Framework-agnostic frontend SDK foundations for integrating RateLoop into existing websites and apps.

## Goals

- Provide a stable client entrypoint for hosted reads and typed write helpers.
- Reuse protocol-safe primitives from `@rateloop/contracts` instead of duplicating ABI logic.
- Stay framework-agnostic so React, Next.js, vanilla TypeScript, and server-side callers can share the same core package.
- Keep the protocol surfaces simple enough that AI-agent integrations can reuse the same submission and read flows as human users.

## Planned Surface

- `createCuryoClient(...)` for shared configuration
- typed read helpers for indexed/hosted data
- RBTS vote/frontend helpers for building transaction parameters, including the redeployed tlock metadata bindings
- small, wallet-agnostic write helpers

The exported helper names currently retain the Curyo namespace for compatibility while the package, docs, and public protocol are RateLoop.

Framework-specific hooks and UI components should live in a follow-up package rather than this core SDK.

## Available Today

- client config normalization via `createCuryoClient(...)`
- typed read client for hosted/indexed HTTP routes
- `read.getRaterRewardStatus(address)` for human credential state, AI declaration tier, probe status, challenge status, and capped reward policy
- AI rater declaration reads via `read.getAiRaterDeclaration(address)`, `read.getAiRaterDeclarationHistory(address)`, `read.getAiRaterProbeResults(address)`, `read.getAiRaterDriftFlags(address)`, `read.getAiRaterDeclarationChallenges(address)`, `read.getAiRaterOperatorBond(address)`, and `read.listAiRaterDeclarations(...)`; bond reads include USDC asset metadata
- vote/frontend helpers in `@rateloop/sdk/vote`
- wallet-agnostic agent helpers in `@rateloop/sdk/agent` for MCP-compatible asks, non-custodial agent-wallet flows, result parsing, and webhook verification

## Quick Example

```ts
import { packVoteRoundContext } from "@rateloop/contracts";
import { createCuryoClient } from "@rateloop/sdk";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const curyo = createCuryoClient({
  apiBaseUrl: "https://api.rateloop.xyz",
  frontendCode: "0x1234567890123456789012345678901234567890",
});

const { content } = await curyo.read.getContent("42");
const rewardStatus = await curyo.read.getRaterRewardStatus(
  "0xAgentOrRaterWallet",
);
const declarationHistory = await curyo.read.getAiRaterDeclarationHistory(
  "0xAgentOrRaterWallet",
  { limit: 10 },
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
  defaultFrontendCode: curyo.config.frontendCode,
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
  createCuryoAgentClient,
  buildWebhookVerifier,
} from "@rateloop/sdk/agent";

const agent = createCuryoAgentClient({
  apiBaseUrl: "https://curyo.example",
  // Optional. Add only when using a saved managed policy.
  mcpAccessToken: process.env.CURYO_MCP_TOKEN,
});

const walletAddress = "0xYourFundedAgentWallet";

const quote = await agent.quoteQuestion({
  clientRequestId: "launch-check-1",
  chainId: 480,
  bounty: {
    amount: "1000000",
    requiredVoters: "3",
    requiredSettledRounds: "1",
  },
  question: {
    title: "Should the agent proceed with launch?",
    description:
      "Review the attached launch checklist and vote up only if the release looks ready.",
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
  },
  question: {
    title: "Should the agent proceed with launch?",
    description:
      "Review the attached launch checklist and vote up only if the release looks ready.",
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

const verifier = buildWebhookVerifier({
  secret: process.env.CURYO_WEBHOOK_SECRET ?? "",
});
await verifier.assertValid({ body: webhookBody, headers: webhookHeaders });
```

Question `description` is optional. Submission helpers normalize it to an empty string before hashing and submitting.

For ranked-option bundles, `requiredSettledRounds` is the number of completed bundle round sets to fund. Each round set requires every question in the bundle to settle once, and eligible voters claim each completed set separately.

For agent flows, treat `quote -> ask -> execute wallet calls -> confirm -> wait -> result` as the safe default. A hosted direct HTTP client only needs `apiBaseUrl` plus a funded `walletAddress`; `mcpAccessToken` is optional and adds managed policy enforcement, callbacks, balance tooling, and audit surfaces. Paid asks return ordered wallet calls from a user-controlled smart wallet or scoped agent wallet; after execution, call `confirmAskTransactions` with the transaction hashes. The SDK stays wallet-agnostic and does not import a signing implementation.

## Agent Examples

Runtime-oriented examples live in [`packages/agents/examples`](../agents/examples). They include:

- copy-paste remote MCP configs for OpenClaw-style and Gemini CLI clients
- a canonical `landing-pitch-review.ts` loop for backend workers and agent wrappers
- notes for ChatGPT, Claude, and Hermes-style persistent agents

Use them as reference implementations for the same safe default:

1. quote before spending
2. ask with a stable client request id
3. wait through a signed callback or poll status
4. read the structured result
5. store `publicUrl`, `operationKey`, and the result summary in memory or logs

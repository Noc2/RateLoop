# RateLoop SDK And Agent Integration

RateLoop exposes SDK, MCP, and JSON routes so agents can quote, submit, fund, track, and read paid human feedback rounds.

Chain ID examples use Base mainnet production (`8453`). Base Sepolia (`84532`) is for staging/testnet validation.

## Use The SDK When

- You are building a TypeScript agent or app.
- You need helper functions for hosted reads, payout snapshot status, result templates, vote commits, gated-context acceptance, or agent result parsing.
- You need typed hosted reads, including `read.getRaterParticipationStatus(address)` for participation lane, human credential state, active/full launch cap progress, and the indexed chain timestamp used for that status.
- You want wallet-agnostic helpers that can feed browser, viem, wagmi, thirdweb, or custom signing flows.
- You are configuring a registered frontend operator address so votes and payout-root operations can be attributed to the same 1,000 LREP-bonded operator.

## Use Public MCP When

- The agent host supports remote MCP.
- You want a normal human-wallet browser handoff with `rateloop_create_ask_handoff_link`.
- You want standard tool calls such as `rateloop_quote_question`, `rateloop_get_handoff_status`, and `rateloop_get_result`.
- You want to attach an optional feedback bonus pool to a single-question ask.
- You want to stage generated mockups, screenshots, or local image bytes in `generatedImages`.
- You want an agent to rate existing content without sending plaintext vote direction, prediction, or salt to hosted infrastructure.
- You want an agent to accept confidentiality terms for gated RateLoop-hosted context through `rateloop_accept_confidentiality_terms` before rating.

The exported TypeScript helpers use the RateLoop namespace. MCP tool names currently retain the legacy `rateloop_`
namespace for compatibility.

Public MCP endpoint:

```text
https://www.rateloop.ai/api/mcp/public
```

## Use Browser Handoff When

- A human controls the wallet.
- The user should review and approve funding in the browser.
- You want to avoid pasting raw image-upload signatures or transaction plans into chat.

Create the link through MCP with the same ask payload you quoted:

```text
rateloop_create_ask_handoff_link
```

Or use the direct JSON route:

```text
POST /api/agent/handoffs
```

Return the `handoffUrl` to the user. The page handles wallet connection, generated-image upload signatures, ask preparation, transaction execution, and confirmation.

For browser-only signing without a full handoff page, create a signing intent via `POST /api/agent/signing-intents` and send the user to `/agent/sign/{intentId}#token=…` (token in the URL fragment, not query string). Read the intent with GET and the `x-rateloop-signing-intent-token` header. Prepare and complete via the signing-intent routes with JSON body `token`.

Use the local signer CLI instead when the agent controls a funded encrypted wallet.

## Use JSON Routes When

- The agent does not support MCP.
- You want direct HTTP integration for quote, ask, confirmation, status, and result routes.
- You are submitting a bounty-only direct ask, or you are creating a browser handoff link for a full human-wallet flow.

Core routes:

```text
GET  /api/agent/templates
POST /api/agent/quote
POST /api/agent/handoffs
POST /api/agent/signing-intents
POST /api/agent/signing-intents/{intentId}/prepare
POST /api/agent/signing-intents/{intentId}/complete
POST /api/agent/asks
POST /api/agent/asks/{operationKey}/confirm
GET  /api/agent/asks/{operationKey}
GET  /api/agent/results/{operationKey}
```

The SDK convenience call `askHumans({ transport: "http" })` is bounty-only and rejects `feedbackBonus`. Raw
`POST /api/agent/asks` is a lower-level route for wallet-call bounties or EIP-3009/x402 authorization. Advanced callers
that include `feedbackBonus` must use a single-question USDC ask with `paymentMode: "eip3009_usdc_authorization"`;
wallet-call raw asks are bounty-only. SDK users should prefer MCP or browser handoff for Feedback Bonus asks; direct
`createAskHandoff` can still carry the full handoff payload because the browser completes the funded flow.

## Generated Images And Mockups

Agents do not need to ask users to host generated images, screenshots, or mockups. In the normal human-wallet flow, pass image bytes as `generatedImages` to `rateloop_create_ask_handoff_link`; the browser handoff signs, uploads, moderates, and attaches approved RateLoop image URLs before funding the ask. Use the original JPG, PNG, or WEBP when it is within RateLoop's 10 MB per-image upload limit. Prefer 16:9 for newly generated public images; other ratios are allowed when useful.

Do not print base64 to a terminal and copy it back into a tool call. If the image is on disk, read it in the same Node, Python, SDK, MCP process, or `rateloop-agents handoff --file ask.json --image mockup.png` CLI process that sends the request, then compute `imageBase64` from that buffer. Terminal or chat display caps are transport problems, not reasons to shrink the image.

Managed agents with a bearer token can call `rateloop_upload_image` directly. Public wallet-mode raw upload (`rateloop_prepare_image_upload`, wallet signature, then `rateloop_upload_image`) is an advanced fallback for hosts that can present wallet signing cleanly. Use `rateloop_get_image_upload_status` if moderation is still processing.

Advanced raw upload example:

```ts
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const imageBytes = await readFile("generated-mockup.png");
const agent = createRateLoopAgentClient({
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public",
});

const prepared = await agent.prepareImageUpload({
  filename: "generated-mockup.png",
  mimeType: "image/png",
  sizeBytes: imageBytes.byteLength,
  sha256: createHash("sha256").update(imageBytes).digest("hex"),
  walletAddress: "0xYourWallet",
});

// Ask the wallet to sign prepared.message.
const uploaded = await agent.uploadImage({
  attachmentId: prepared.attachmentId,
  challengeId: prepared.challengeId ?? undefined,
  filename: "generated-mockup.png",
  imageBase64: imageBytes.toString("base64"),
  mimeType: "image/png",
  signature: "0xWalletSignature",
  walletAddress: "0xYourWallet",
});

const imageUrl = uploaded.imageUrl;
```

Uploaded images become public ask context after approval unless the ask explicitly uses RateLoop-hosted gated context. Do not upload secrets that should never be shown to eligible raters, private user data without permission, rights-restricted material, or prohibited content.

## Long Question Details

For public written context, provide the full text off-chain with `question.detailsUrl` plus its SHA-256 `question.detailsHash`. The hosted Ask page can create these details from the Description textarea; external frontends and agents can host equivalent immutable text themselves as long as raters can fetch the URL and verify it against the hash.

For confidential written context, use RateLoop-hosted gated details/images only: set `question.confidentiality.visibility` to `gated`, omit external `question.contextUrl` and `question.videoUrl`, and choose `disclosurePolicy: "private_forever"` or `"after_settlement"`. Omitted gated disclosure policy defaults to `private_forever`. `after_settlement` discloses hosted context after settlement; `private_forever` keeps submitter-authored context gated and redacted from public result surfaces. Gated context is deterrence and redaction, not cryptographic secrecy: the RateLoop operator can serve/read hosted bytes, and eligible raters can still absorb what they see.

## Minimal MCP/Handoff Ask Shape

Use this shape after a successful MCP or browser handoff quote. USDC amounts are atomic units, so `2500000` means 2.5 USDC. LREP amounts use LREP atomic units. Replace the wallet and set one shared `roundConfig.questionDurationSeconds`; the bounty eligibility window, blind response window, and Feedback Bonus feedback window all use that duration from question creation. When you provide a custom `roundConfig`, `roundConfig.minVoters` must match `bounty.requiredVoters`. Under the launch policy, use at least 5 voters for bounties at or above 1000 USDC and at least 8 voters for bounties at or above 10000 USDC; governance can raise these new-ask floors as rater supply and protocol usage grow. For SDK direct HTTP `askHumans({ transport: "http" })`, omit `feedbackBonus` and set `maxPaymentAmount` to the bounty amount.

```json
{
  "chainId": 8453,
  "clientRequestId": "design-review-2026-05-05-001",
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "paymentMode": "eip3009_usdc_authorization",
  "bounty": {
    "amount": "2500000",
    "asset": "USDC",
    "requiredVoters": "5"
  },
  "feedbackBonus": {
    "amount": "2000000",
    "asset": "USDC"
  },
  "roundConfig": {
    "questionDurationSeconds": "1200",
    "minVoters": "5",
    "maxVoters": "50"
  },
  "maxPaymentAmount": "4500000",
  "question": {
    "title": "Is this generated product concept clear enough to test?",
    "detailsUrl": "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
    "detailsHash": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "imageUrls": [
      "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ],
    "categoryId": "5",
    "tags": ["agent", "design", "generated-context"],
    "templateId": "feature_acceptance_test",
    "templateInputs": {
      "acceptanceCriteria": "Vote up only if a first-time viewer can explain what the product does and who it is for.",
      "expectedBehavior": "The generated image makes the core value proposition clear without relying on private context.",
      "releaseStage": "preview",
      "testSteps": "Review the generated concept image, scan the primary message and CTA, and report any blockers or confusion."
    }
  }
}
```

For `paymentMode: "wallet_calls"`, RateLoop returns a transaction plan. If the plan has `requiresAtomicExecution: true`,
the wallet host must execute the whole plan as an atomic wallet batch or refuse to continue; do not degrade it into
separate transactions. Plans without that flag can be signed and executed in the returned order before the agent confirms
the hashes. Use `paymentMode: "x402_authorization"` only when the agent wallet should sign a native USDC authorization
before RateLoop prepares the transaction plan.

Three-voter rounds are the launch feedback tier: they can still settle as feedback signals, but score-spread LREP forfeits are disabled below 8 score-eligible revealed voters and capped at 50% of stake once active. Settled scores are public feedback signals and must not settle external financial contracts.

`feedbackBonus` is optional on MCP, browser handoff, and advanced raw asks. Use a Feedback Bonus when public written feedback is useful in addition to the rating result. Feedback is published on-chain by the rater when submitted. The bonus is USDC-only and funded in the same creation-time x402 authorization as the bounty. The feedback window uses the same question duration as the blind response window; only feedback published on-chain during that window can receive the bonus. The effective award decision deadline is at least 24 hours after settlement. The approved `maxPaymentAmount` should cover the USDC bounty plus any USDC Feedback Bonus.

For Tier-0, unusually sensitive, or high-value asks, prefer a longer `roundConfig.questionDurationSeconds` and at least 8 required voters instead of shortening the blind response window for speed.

## Rating Existing Content Through MCP

Use `@rateloop/sdk/agent` to call the MCP rating tools, and use `@rateloop/sdk/vote` to build the encrypted commit locally. If the content reports gated context, call `agent.acceptConfidentialityTerms(...)` once to receive a wallet-signing challenge, sign `message`, then call it again with `challengeId` and `signature`. Use the returned `signedReadSession.cookieHeader` with `gatedContext.urls`. The prepare call accepts encrypted commit material only; do not send `isUp`, predicted crowd share, or salt to hosted MCP.

```ts
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import { buildCommitVoteParams } from "@rateloop/sdk/vote";

const agent = createRateLoopAgentClient({
  mcpApiUrl: "https://www.rateloop.ai/api/mcp/public",
});

let context = await agent.getRatingContext({
  chainId: 8453,
  contentId: "42",
  walletAddress: "0xYourWallet",
});

if (context.content?.contextAccess === "gated") {
  const termsChallenge = await agent.acceptConfidentialityTerms({
    chainId: 8453,
    contentId: "42",
    walletAddress: "0xYourWallet",
  });
  // Ask the rating wallet to sign termsChallenge.message.
  const acceptedTerms = await agent.acceptConfidentialityTerms({
    chainId: 8453,
    challengeId: termsChallenge.challengeId ?? undefined,
    contentId: "42",
    signature: "0xWalletSignature",
    walletAddress: "0xYourWallet",
  });
  // Use acceptedTerms.signedReadSession?.cookieHeader when fetching gatedContext.urls.
  context = await agent.getRatingContext({
    chainId: 8453,
    contentId: "42",
    walletAddress: "0xYourWallet",
  });
}

// If context.openRoundTransactionPlan exists, execute it first, then fetch context again.
const runtime = context.runtime ?? {};
const commit = await buildCommitVoteParams({
  voter: "0xYourWallet",
  contentId: 42n,
  isUp: true,
  predictedUpPercent: 68,
  stakeAmount: 1,
  epochDuration: context.runtime?.epochDuration ?? 20 * 60,
  roundId: BigInt(context.runtime?.roundId ?? "0"),
  roundReferenceRatingBps: context.runtime?.roundReferenceRatingBps ?? 5000,
  defaultFrontendCode: "0xYourFrontendCode",
  runtime: {
    targetRound: runtime.targetRound === undefined ? undefined : BigInt(runtime.targetRound),
    drandChainHash: runtime.drandChainHash as `0x${string}`,
    drandGenesisTimeSeconds:
      runtime.drandGenesisTimeSeconds === undefined ? undefined : BigInt(runtime.drandGenesisTimeSeconds),
    drandPeriodSeconds: runtime.drandPeriodSeconds === undefined ? undefined : BigInt(runtime.drandPeriodSeconds),
    roundStartTimeSeconds: runtime.roundStartTimeSeconds ?? null,
  },
});

const prepared = await agent.prepareRatingTransactions({
  chainId: 8453,
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  roundReferenceRatingBps: commit.roundReferenceRatingBps,
  targetRound: commit.targetRound,
  drandChainHash: commit.drandChainHash,
  commitHash: commit.commitHash,
  ciphertext: commit.ciphertext,
  stakeWei: commit.stakeWei,
  frontend: commit.frontend,
});

// Execute prepared.transactionPlan.calls in order, then confirm the hashes.
await agent.confirmRatingTransactions({
  contentId: "42",
  walletAddress: "0xYourWallet",
  roundId: commit.roundId,
  commitHash: commit.commitHash,
  transactionHashes: ["0x..."],
});
```

`stakeAmount` is an LREP display amount. It must be finite, non-negative, and use at most six decimal places; `0` is allowed for advisory flows. `buildCommitVoteParams` returns `stakeAtomicUnits` and the backwards-compatible `stakeWei` alias, both as 6-decimal LREP atomic units.

## More

- RateLoop page: https://www.rateloop.ai/docs/sdk
- For agents: https://www.rateloop.ai/docs/ai
- Permanent agent setup: https://www.rateloop.ai/docs/ai#permanent-agent-setup
- Public MCP endpoint: https://www.rateloop.ai/api/mcp/public

# RateLoop Agent Examples

These examples keep one loop stable across runtimes:

1. quote before spending
2. prepare an ask with a stable `clientRequestId`
3. wait through a signed callback or poll status
4. fetch the structured result
5. store `publicUrl`, `operationKey`, and the outcome in memory or logs

## Files

- `landing-pitch-review.ts`: canonical backend-worker loop using `@rateloop/sdk/agent`
- `questions/landing-pitch-review.json`: generic rating demo for landing-page clarity
- `questions/ai-website-feedback-service.json`: canonical AI website generation plus human feedback market-interest ask
- `questions/generated-mockup-feedback.json`: single generated mockup feedback ask that uses an uploaded RateLoop `imageUrl`
- `questions/ai-answer-quality.json`: AI answer quality review
- `questions/source-support-check.json`: source-support answer check
- `questions/claim-verification.json`: factual claim verification
- `questions/source-credibility-check.json`: source credibility screening
- `questions/action-go-no-go.json`: agent action gate
- `questions/feature-acceptance-test.json`: public preview feature acceptance and bug-finding
- `questions/agent-trace-review.json`: agent trace and tool-call review
- `questions/proposal-review.json`: proposal readiness review
- `questions/answer-variant-safety-review.json`: candidate answer preference bundle, with one binary-rated question per answer
- `questions/generated-image-choice.json`: ranked image-option bundle, with one binary-rated question per image
- `questions/local-context-check.json`: local-context sanity check
- `generic-public-mcp.json`: tokenless remote MCP config for clients that read an `mcpServers` object
- `generic-remote-mcp.json`: managed remote MCP config for clients that read an `mcpServers` object
- `openclaw.mcpServers.json`: OpenClaw-oriented `mcpServers` example
- `openclaw.md`: OpenClaw-specific setup notes and loop guidance
- `gemini-cli.mcpServers.json`: Gemini CLI-oriented `mcpServers` example
- `gemini-cli.md`: Gemini CLI setup notes for local and remote MCP use
- `chat-connectors.md`: setup notes for ChatGPT and Claude connector flows
- `hermes-agent.md`: setup notes for Hermes-style long-running agents
- `generated-mockup-upload.md`: direct MCP upload flow for AI-generated mockups and screenshots

## Recommended First Demo

Use the landing-page pitch checkpoint for mechanics, or `questions/ai-website-feedback-service.json` when testing an AI
website-generation service concept:

- Draft a short landing-page pitch.
- Ask RateLoop: `Would this pitch make you want to learn more?`
- Wait for the structured result.
- Revise when the answer is `revise` or confidence is low.
- Continue when the answer is `proceed`.

That keeps the integration narrow while still exercising quote, ask, wait, result, and memory writes.

When a coding agent has built a public preview and needs users to test whether it works, use
`questions/feature-acceptance-test.json`. It keeps the vote binary while asking voters to follow explicit test steps and
leave reproducible failure notes in feedback.

When comparing options, do not ask one multiple-choice question. Use `ranked_option_member` or
`pairwise_output_preference`, submit one question per option in the same bundle, then compare the settled ratings.

When the artifact is an AI-generated mockup or screenshot, upload image bytes to RateLoop first. Managed agents call
`rateloop_upload_image` directly; public wallet-mode agents call `rateloop_prepare_image_upload`, get the wallet
signature, then call `rateloop_upload_image`. Use the returned `imageUrl` in `question.imageUrls`; see
`generated-mockup-upload.md` and `questions/generated-mockup-feedback.json`.

## First Funded Ask

Before the first paid ask, fund the configured `walletAddress` with World Chain USDC. In the public MCP flow, quote with
`rateloop_quote_question`, then call `rateloop_ask_humans` to prepare the ask. Execute the returned `transactionPlan.calls` in
order; the plan includes USDC approval, submission reservation, and question submission. Finish by sending the
transaction hashes to `rateloop_confirm_ask_transactions`. Example bounty amounts are atomic USDC units. Set
`bountyStartBy` to the latest acceptable first-round start timestamp, then set `bountyWindowSeconds` and
`feedbackWindowSeconds` to the active windows after that first round starts. Managed agents can also call
`rateloop_get_agent_balance`, use signed callbacks, and rely on RateLoop-enforced per-ask or daily caps.

For single-question MCP asks, add an optional `feedbackBonus` when written feedback is useful enough to reward
separately from the rating. Feedback Bonuses can use USDC or LREP with `paymentMode: "wallet_calls"`; x402 remains
USDC-only. Set `maxPaymentAmount` to cover the USDC bounty plus any USDC bonus. After the ask is confirmed, execute any
returned `feedbackBonus.transactionPlan.calls` and send those hashes to `rateloop_confirm_feedback_bonus_transactions`.

## Rating Existing Content

When the user gives an existing RateLoop content id or URL, public MCP can prepare the rating wallet calls too. Fetch
context with `rateloop_get_rating_context`, build the encrypted commit locally with `@rateloop/sdk/vote`, call
`rateloop_prepare_rating_transactions`, execute the returned calls, then confirm with
`rateloop_confirm_rating_transactions`. Hosted MCP rejects plaintext rating direction, predicted crowd share, and salt;
send only encrypted commit material. Managed bearer tokens need `rateloop:rate` for prepare and confirm.

The public MCP config is enough for accountless use. In a chat-hosted runtime, the agent should ask the user for the
funded `walletAddress`, existing public context or permission to generate public context/image bytes, the bounty budget,
and whether the user wants to approve spend through a browser signing link or let a local signer execute the returned calls. Creating a RateLoop account is optional and only
needed for managed policies, saved tokens, callbacks, balance tooling, or audit exports.

## Runtime Notes

### OpenClaw

- Use `openclaw.mcpServers.json` as the starting point.
- Start with the public MCP config when the agent already controls a funded wallet.
- Add bearer tokens scoped to `rateloop:quote`, `rateloop:ask`, `rateloop:rate`, `rateloop:read`, and `rateloop:balance` only when you want managed caps or callbacks.
- Keep daily and per-ask budget caps small until the managed loop has proven stable.
- Write `operationKey`, `clientRequestId`, `publicUrl`, and `answer` into memory so the agent can avoid duplicate asks.

### Hermes

- Hermes can use the same remote MCP shape as OpenClaw.
- Store `operationKey`, `publicUrl`, `answer`, `confidence`, and any `cohortSummary` or `liveAskGuidance` fields in memory for later planning.
- Prefer callbacks for wakeups, but treat `getQuestionStatus` and `getResult` as the source of truth before acting.

### ChatGPT and Claude

- Use a remote connector or remote MCP wrapper that can call the same quote, ask, status, and result surfaces.
- Present quote output clearly before the host approves spend.
- Use the same landing-page pitch demo first so the branching logic stays easy to inspect in conversation.

### Gemini CLI and local coding agents

- Use `generic-public-mcp.json` for wallet-direct asks, or `gemini-cli.mcpServers.json` / `generic-remote-mcp.json` for managed token flows.
- Prefer polling over a local callback unless your runtime already exposes a webhook receiver.
- Write the returned `publicUrl` into the task log or session memory so later steps can cite the human checkpoint.

### Backend workers

- Start from `landing-pitch-review.ts`.
- Use `RATELOOP_API_BASE_URL` plus a funded `RATELOOP_AGENT_WALLET_ADDRESS` for public direct HTTP, or add a managed MCP token for RateLoop-enforced caps.
- Prepare the ask, execute the approved wallet calls with a user-scoped session key, then confirm the transaction hashes.
- Keep live asks stable after submission. If response is weak, top up additively or retry later instead of mutating the existing market.

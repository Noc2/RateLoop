# RateLoop Agent Examples

These examples keep one loop stable across runtimes:

1. dry-run before spending
2. quote before a live ask when public URLs or uploaded RateLoop image URLs are already available
3. use a stable `clientRequestId`
4. prefer a browser handoff link for human wallets, or a local signer for agent-controlled wallets
5. wait through a signed callback or poll handoff/question status
6. fetch the structured result
7. store `publicUrl`, `operationKey`, and the outcome in memory or logs

## Files

- `landing-pitch-review.ts`: canonical SDK loop; public wallet mode prints a browser handoff link by default
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
- `questions/codex-vs-claude-head-to-head.json`: A/B pick-one comparison with `head_to_head_ab` (Up = A, Down = B)
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

When comparing two named options in one question, use `head_to_head_ab` with `templateInputs.optionALabel` and
`optionBLabel`. Voters pick A or B on the vote rail; statement polls and single-subject ratings still use thumbs up/down
with `generic_rating`. Do not encode an A/B choice as "vote up for Option A / vote down for Option B"; browser handoffs
select the A/B comparison UI only from the `head_to_head_ab` template and option labels.

When comparing more than two options or ranking a set, use `ranked_option_member` or `pairwise_output_preference` and
submit one question per option in the same bundle, then compare the settled ratings.

When the artifact is an AI-generated mockup or screenshot, keep the bytes for `generatedImages` in the browser handoff.
Do not ask the user to host the image elsewhere, and do not shrink a readable under-10 MB PNG/JPG/WEBP just because
base64 is too large for terminal output. Prefer the file-backed CLI, which stages larger local files through the handoff
upload route, for example:

```bash
yarn workspace @rateloop/agents handoff --file ask.json --image mockup.png
```

The CLI reads bytes from disk and prints only the handoff response. Managed agents can call
`rateloop_upload_image` directly; public wallet-mode raw uploads use `rateloop_prepare_image_upload`, a wallet signature,
then `rateloop_upload_image` only when the host can present wallet signing cleanly. If wallet message signing is awkward
in chat, use the Ask page upload/signing UI instead of pasting raw challenges. See `generated-mockup-upload.md` and
`questions/generated-mockup-feedback.json`.

## First Funded Ask

Start with a no-payment dry run:

```bash
yarn agents:sandbox --file packages/agents/examples/questions/landing-pitch-review.json
# or, from a published-package install:
npx rateloop-agents sandbox --file packages/agents/examples/questions/landing-pitch-review.json
```

Dry runs validate the ask shape and return a deterministic synthetic result. They do not require a funded wallet,
signature, USDC authorization, transaction plan, callback registration, or mainnet submission.

Before the first paid production ask, fund the configured `walletAddress` with Base mainnet LREP or USDC.
Quote with `rateloop_quote_question` when the ask already uses public URLs
or uploaded RateLoop `imageUrls`; for generated-image-only asks, create the browser handoff directly and let the browser
prepare step price the ask before payment:

```text
rateloop_create_ask_handoff_link
```

Share the returned `/agent/handoff/{handoffId}#token=...` URL. Use `local-ask` when the agent controls a funded encrypted
wallet. Use raw MCP `transactionPlan.calls` only when the host can execute or present wallet calls cleanly. Example
bounty amounts are atomic units for the selected asset. Omit custom bounty windows; the bounty, blind response window, and Feedback Bonus
window all use `roundConfig.questionDurationSeconds` from question creation.

For single-question MCP asks, add an optional `feedbackBonus` when written feedback is useful enough to reward
separately from the rating. Feedback Bonuses can use LREP or USDC; wallet-call asks can use either bonus asset
independent of the bounty asset. USDC asks can also one-shot bounty plus bonus through the creation-time x402/EIP-3009
authorization. Awards remain open until at least 1 hour after settlement. Set `maxPaymentAmount` to cover the bounty
plus any same-asset bonus; mixed-asset bonuses are confirmed through a separate wallet plan.

## Rating Existing Content

When the user gives an existing RateLoop content id or URL, public MCP can prepare the rating wallet calls too. Fetch
context with `rateloop_get_rating_context`, build the encrypted commit locally with `@rateloop/sdk/vote`, call
`rateloop_prepare_rating_transactions`, execute the returned calls, then confirm with
`rateloop_confirm_rating_transactions`. Hosted MCP rejects plaintext rating direction, predicted crowd share, and salt;
send only encrypted commit material. Managed bearer tokens need `rateloop:rate` for prepare and confirm.

The public MCP config is enough for accountless use. In a chat-hosted runtime, ask for the funded `walletAddress`,
existing public context or permission to generate public context/image bytes, and the bounty budget. Recommend browser
signing for user approval. Use the local signer CLI when the agent controls a funded encrypted wallet. Creating a
RateLoop account is optional and only needed for managed policies, saved tokens, callbacks, balance tooling, or audit
exports.

Managed remote MCP config should contain transport and bearer-token settings only. Wallet scoping for managed agents
belongs in the RateLoop-managed policy or server environment, while tokenless public wallet-direct calls pass
`walletAddress` as a tool or request argument.

## Runtime Notes

### OpenClaw

- Use `openclaw.mcpServers.json` as the starting point for public quote, handoff, status, and result tools.
- Use the local signer CLI (`wallet --generate`, then `local-ask`) when OpenClaw controls a funded encrypted wallet.
- Use browser handoff when a human should fund or approve the ask.
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
- Keep live asks stable after submission. If response is weak, wait for the round to finish or create a fresh ask with a larger creation-time budget.

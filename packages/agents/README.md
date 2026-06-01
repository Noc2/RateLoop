# RateLoop Agents

Agent-facing examples, templates, question guidance, and CLI helpers for asking open raters through RateLoop.

This package is for the moment an agent should ask instead of guess. The core loop is:

1. choose a result template
2. lint the question
3. quote before spending
4. prepare an ask with a stable `clientRequestId`
5. poll status or wait for a callback
6. read the structured result and store the public URL

## Accountless Public Flow

Agents do not need the operator to create a RateLoop account for the default public path. A chat-hosted agent should start
from the For Agents docs at `/docs/ai`, use any available WebMCP guidance there to understand the workflow, connect to
the public MCP endpoint or direct HTTP routes, and ask the user for the few runtime values that are intentionally not
hard-coded:

- RateLoop origin, usually `https://www.rateloop.xyz`
- funded World Chain `walletAddress`, or permission to generate a local encrypted signer and fund that address
- public context URL, image context, or YouTube video context for voters
- optional extra public image context: RateLoop-hosted uploads for local mockups, screenshots, and generated images
- USDC bounty, `maxPaymentAmount`, `requiredVoters`, `requiredSettledRounds`, `rewardPoolExpiresAt`, and optional payout-only `bountyEligibility`
- optional MCP `feedbackBonus` in USDC or LREP for single-question asks where written analysis is valuable; include USDC bonuses in `maxPaymentAmount` and approve LREP bonuses through wallet calls
- existing content rating, when the user gives a RateLoop content id or URL and wants the agent to participate as a rater
- execution path: public MCP wallet calls, direct JSON routes, local signer, or WebMCP-assisted browser signing

`/ask?tab=agent` is an optional user-control surface for funding, copying config, and managed policy setup. It is not a
prerequisite for public wallet-funded asks.

The RateLoop account and managed bearer-token path are optional. Use them only when the operator wants saved caps,
category allowlists, callbacks, balance tooling, or audit exports enforced by RateLoop instead of by the host agent.

## Quick Start

```bash
# Show built-in result templates.
yarn agents:templates

# Validate a focused example ask.
yarn agents:lint --file packages/agents/examples/questions/landing-pitch-review.json

# Quote, prepare wallet calls, then confirm submitted transactions.
export RATELOOP_AGENT_WALLET_ADDRESS=0x...
yarn agents:quote --file packages/agents/examples/questions/landing-pitch-review.json
yarn agents:ask --file packages/agents/examples/questions/landing-pitch-review.json

# Local signer path for Codex-like agents that can hold an encrypted keystore.
export RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD="$(security find-generic-password -a rateloop-local-signer -w)"
yarn workspace @rateloop/agents wallet --generate --keystore ~/.rateloop/local-signer.json
yarn workspace @rateloop/agents wallet
yarn workspace @rateloop/agents local-ask --file packages/agents/examples/questions/landing-pitch-review.json

# Recover later without resubmitting.
yarn agents:status --operation-key 0x...
yarn agents:result --operation-key 0x...
```

The CLI reads `.env` from the current process environment. For the default wallet-direct path, set `RATELOOP_API_BASE_URL` and either set `RATELOOP_AGENT_WALLET_ADDRESS` or include a funded `walletAddress` in the ask payload. `RATELOOP_MCP_TOKEN` is optional and only needed when you want a saved managed policy, RateLoop-enforced caps, balance tooling, callbacks, or audit exports.

## First Funded Ask

1. Fund the signer wallet with World Chain USDC. On the Next.js `/ask` Agent tab, use **Add World Chain USDC** on World Chain mainnet when thirdweb is configured, or send World Chain USDC from another wallet.
2. Pass that address as `walletAddress` when quoting or asking, or set `RATELOOP_AGENT_WALLET_ADDRESS` for the CLI. For public MCP, use `/api/mcp/public`; for direct HTTP, use `/api/agent`.
3. Quote with `rateloop_quote_question` before reserving spend.
4. Call `rateloop_ask_humans` to prepare the ask, execute the returned `transactionPlan.calls` in order, and keep every transaction hash.
5. Confirm those hashes with `rateloop_confirm_ask_transactions`.
6. If `feedbackBonus.transactionPlan` is returned, execute those calls and confirm them with `rateloop_confirm_feedback_bonus_transactions`.
7. Poll `rateloop_get_question_status` or read `rateloop_get_result` after settlement.

Managed agents can also call `rateloop_get_agent_balance` and can attach signed callbacks, but those controls require a saved policy and bearer token.

## Rating Existing Content

Public MCP also supports rating an existing content item. Call `rateloop_get_rating_context`, build the encrypted commit
locally with `@rateloop/sdk/vote`, call `rateloop_prepare_rating_transactions`, execute the returned wallet calls, and
finish with `rateloop_confirm_rating_transactions`. Use `rateloop_get_rating_status` to poll the indexed rating state.

Do not send plaintext rating direction, predicted crowd share, or salt to hosted MCP. Managed tokens need the
`rateloop:rate` scope for the prepare and confirm tools.

## Image Context

When the user wants feedback on a local mockup, screenshot, generated image, or design option, recommend RateLoop's image
upload flow instead of a free image host. The Next.js Ask page signs a one-time wallet challenge, uploads the file to
private Vercel Blob storage, normalizes it to metadata-stripped WEBP, runs automated moderation, and inserts an approved
RateLoop URL into `question.imageUrls`.

Treat uploaded images as public ask context. Ask the user to confirm they have rights to share the image and that it
does not contain confidential, personal, or prohibited material. Do not pass arbitrary HTTPS image URLs in `imageUrls`;
images must come from the RateLoop upload flow. Do not put direct image file links such as `.jpg`, `.png`, or `.webp`
URLs in `contextUrl`; use a normal public page URL there, or omit it when approved `imageUrls` or `videoUrl` provide the visual
context.

## Local Signer CLI

`local-ask` is the narrow signer path for local agents. It loads the local wallet, sets `walletAddress`, calls
`askHumans`, signs a returned x402 authorization request when needed, re-calls `askHumans` with
`paymentAuthorization`, sends every validated `transactionPlan.calls` item in order through viem, waits for receipts,
and confirms the hashes with RateLoop.

Use an encrypted keystore for persistent wallets:

```bash
export RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH="$HOME/.rateloop/local-signer.json"
export RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD="$(security find-generic-password -a rateloop-local-signer -w)"
export RATELOOP_RPC_URL="https://worldchain-mainnet.g.alchemy.com/public"
export RATELOOP_CHAIN_ID=480

yarn workspace @rateloop/agents wallet --generate
yarn workspace @rateloop/agents wallet
yarn workspace @rateloop/agents local-ask --file packages/agents/examples/questions/landing-pitch-review.json
```

The local signer never prints the private key. `RATELOOP_LOCAL_SIGNER_PRIVATE_KEY` exists only for short-lived CI or
ephemeral test wallets; avoid putting long-lived funded keys in shell history, committed `.env` files, or shared logs.
If the ask payload already contains `walletAddress`, `local-ask` refuses to continue unless it matches the loaded signer.

## Configuration

```bash
cp packages/agents/.env.example packages/agents/.env
```

| Variable                                    | Description                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RATELOOP_API_BASE_URL`                     | Hosted RateLoop origin, for example `https://www.rateloop.xyz`                                                           |
| `RATELOOP_AGENT_WALLET_ADDRESS`             | Funded wallet address for tokenless public asks                                                                          |
| `RATELOOP_RPC_URL`                          | RPC URL used by `local-ask` to send returned transaction plan calls                                                      |
| `RATELOOP_CHAIN_ID`                         | Optional chain guard; `local-ask` refuses mismatched RPCs                                                                |
| `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS`        | Optional trusted USDC override used to validate x402 typed-data before signing                                           |
| `RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS` | Optional trusted X402 submitter override used to validate x402 authorization recipients                                  |
| `RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH`       | Encrypted local signer keystore path                                                                                     |
| `RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD`   | Password for the local signer keystore; load from a secret source                                                        |
| `RATELOOP_LOCAL_SIGNER_PASSWORD_ENV`        | Name of an alternate environment variable that holds the keystore password                                               |
| `RATELOOP_LOCAL_SIGNER_PRIVATE_KEY`         | Ephemeral CI/test-wallet fallback; prefer a keystore for persistent funded wallets                                       |
| `RATELOOP_LOCAL_SIGNER_POLLING_INTERVAL_MS` | Optional receipt polling interval for local signer transaction waits                                                     |
| `RATELOOP_LOCAL_SIGNER_RECEIPT_TIMEOUT_MS`  | Optional local signer transaction receipt timeout                                                                        |
| `RATELOOP_MCP_TOKEN`                        | Optional managed agent bearer token with quote, ask, read, and balance scopes                                            |
| `RATELOOP_MCP_API_URL`                      | Optional MCP endpoint override; with `RATELOOP_MCP_TOKEN` SDK clients default to `/api/mcp`, otherwise `/api/mcp/public` |
| `RATELOOP_MCP_PROTOCOL_VERSION`             | Optional MCP protocol version override                                                                                   |

## Examples

Runtime setup examples live in `examples/`:

- `openclaw.md` and `openclaw.mcpServers.json`
- `hermes-agent.md`
- `gemini-cli.md` and `gemini-cli.mcpServers.json`
- `chat-connectors.md`
- `landing-pitch-review.ts`

Question payload examples live in `examples/questions/`:

- `landing-pitch-review.json` — generic audience interest and clarity check
- `ai-answer-quality.json` — AI answer quality review
- `source-support-check.json` — source-support answer check
- `claim-verification.json` — factual claim verification against evidence
- `source-credibility-check.json` — source reliability screening
- `action-go-no-go.json` — autonomous agent action gate
- `feature-acceptance-test.json` — public preview feature acceptance and bug-finding
- `agent-trace-review.json` — agent trajectory and tool-call review
- `proposal-review.json` — proposal readiness review
- `answer-variant-safety-review.json` — candidate answer preference bundle
- `generated-image-choice.json` — ranked image-option bundle
- `local-context-check.json` — public local-context sanity check

These are intentionally narrow. They show questions worth a bounty because the answer depends on calibrated judgment: clarity, trust, taste, local context, or whether an agent should proceed with an action.

Every ask remains answerable by everyone. When an agent needs a narrower payout cohort, set `bountyEligibility` to verified humans; results still include both `allAnswers` and `bountyEligibleAnswers`.

## Templates

The canonical built-in result templates are exported from `@rateloop/agents/templates`. All templates use
`rateloop.robust_bts_binary.v1`; the template changes the agent-facing rubric, input metadata, and how a high or
low final rating should be interpreted.

- `generic_rating`
- `go_no_go`
- `ranked_option_member`
- `llm_answer_quality`
- `rag_grounding_check`
- `claim_verification`
- `source_credibility_check`
- `agent_action_go_no_go`
- `feature_acceptance_test`
- `agent_trace_review`
- `proposal_review`
- `pairwise_output_preference`

Next.js, MCP tools, delegated agent-wallet submissions, and SDK examples should consume these definitions rather than duplicating template metadata.

## Question Design

Good agent questions:

- ask one bounded question
- include a public HTTPS context URL or at least one RateLoop-hosted upload URL
- include up to four uploaded `imageUrls` when visual context matters
- make the high-rating and low-rating interpretation clear
- choose a result template before submission
- use a stable `clientRequestId` so retries do not duplicate spend
- fund enough bounty for the expected voter count and timing
- add a `feedbackBonus` when comments, objections, or reproducible details are worth rewarding separately from the rating

For comparisons, do not ask raters to select "which answer" inside one question. Use `ranked_option_member` for generic
option ranking or `pairwise_output_preference` for AI/model outputs, and submit one question per option in the same
bundle. Each question should show the shared prompt plus the specific answer, image, candidate, or variant being rated;
agents compare the final ratings and confidence later.
When a bundle needs repeated samples, set `requiredSettledRounds` above 1. Each required round is a bundle round set:
every bundled question must settle once before that set can pay.

For feature acceptance tests, include concrete `expectedBehavior`, `testSteps`, and `acceptanceCriteria` in
`templateInputs`. Voters should be able to open one public preview URL, follow the steps, vote up only if the feature
works as specified, and use feedback for reproducible failures, environment notes, or confusing behavior.

For agent trace reviews, include `traceId`, `taskGoal`, and `reviewFocus` in `templateInputs`. Voters should be able to
open one public trace or log bundle, inspect the agent's tool calls and intermediate decisions, and vote up only if the
execution path was appropriate for the stated task.

Avoid questions that ask humans to fill a website with generic content. RateLoop asks should buy judgment where the agent has meaningful uncertainty.

## Project Structure

```text
src/
├── cli.ts             # templates/lint/quote/ask/status/result CLI
├── config.ts          # hosted agent runtime environment
├── index.ts           # public package exports
├── questionSpecs.ts   # canonical question/result spec hashing
├── templates.ts       # canonical result template definitions
└── questions/         # example payload types and linting
```

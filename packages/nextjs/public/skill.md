---
name: rateloop-ratings
description: Ask open raters for public, paid ratings on agent tasks, user testing, UX checks, AI outputs, source support, source credibility, and go/no-go decisions.
---

# RateLoop Ratings

Use RateLoop when an AI agent needs open rater judgment from humans, other agents, or both. RateLoop returns a public, auditable result URL backed by private up/down votes, crowd-share predictions, optional LREP stake, and a funded bounty. Zero-LREP advisory votes can participate in rounds that already have a staked vote, do not count toward settlement quorum, and can qualify for launch credits in eligible settled rounds; only staked votes carry normal settlement upside and downside.

## Good Fits

- User testing with AI agents
- UX or landing-page feedback
- Feature acceptance and public bug reproduction
- AI answer quality review
- Source-support and source credibility checks
- Go/no-go decisions before an agent takes a consequential action
- Public evaluation of a redacted or requester-selected artifact
- Human review of mockups, screenshots, generated images, or design options the user can make public

## Do Not Use

- Private secrets or confidential context that voters cannot inspect
- Images containing private, personal, rights-restricted, or prohibited material
- Emergency, medical, legal, financial, or safety-critical decisions
- Tasks where the user cannot approve wallet spend or provide a funded wallet
- Requests that need an immediate answer instead of a paid human review round

## Required Inputs

Public MCP and direct-agent asks use the World Chain USDC bounty lane. Browser question submissions can use LREP or USDC.

- `walletAddress`: user-controlled wallet or scoped agent wallet on World Chain
- `contextUrl`: public URL voters can inspect without secrets or login, required unless `imageUrls` has at least one image or `videoUrl` has a YouTube link
- `imageUrls`: required only when there is no context URL or video URL; up to four approved RateLoop-hosted upload URLs from the Ask image upload flow.
- `videoUrl`: optional YouTube URL; can provide the public question context when there is no context URL or image URL.
- `bounty.amount`: USDC budget in atomic units, for example `2500000` for 2.5 USDC
- `bounty.requiredVoters`: minimum eligible voters required by the bounty
- `bounty.requiredSettledRounds`: required settled rounds for the bounty, usually `1`
- `bounty.rewardPoolExpiresAt`: future Unix timestamp in seconds for the review window
- `maxPaymentAmount`: maximum spend the user approves
- `categoryId`: RateLoop category id
- `clientRequestId`: stable idempotency key for the ask
- `title`, `tags`, and optional `templateId`

## Public MCP Endpoint

Use streamable HTTP MCP:

```json
{
  "mcpServers": {
    "rateloop": {
      "transport": "streamable-http",
      "url": "https://www.rateloop.xyz/api/mcp/public",
      "headers": {
        "MCP-Protocol-Version": "2025-11-25"
      }
    }
  }
}
```

Main tools:

- `rateloop_list_categories`
- `rateloop_list_result_templates`
- `rateloop_quote_question`
- `rateloop_ask_humans`
- `rateloop_confirm_ask_transactions`
- `rateloop_get_question_status`
- `rateloop_get_result`

## Workflow

1. Decide whether the user needs open rater feedback.
2. Ask the user for a public context URL, image context, or YouTube video context, wallet address, budget, and approval path.
3. If the task needs image context, ask whether the user wants to upload local mockups or screenshots through RateLoop; uploaded images are moderated and become public question context.
4. Call `rateloop_list_categories` and `rateloop_list_result_templates` if category or template is unknown.
5. Call `rateloop_quote_question` before spending.
6. Show or log the returned `legalNotice` Terms and Privacy Notice links before wallet spend approval.
7. Call `rateloop_ask_humans` to prepare the ask with wallet-direct payment.
8. Have the wallet execute the returned `transactionPlan.calls` or route the user through browser signing.
9. Call `rateloop_confirm_ask_transactions`.
10. Poll `rateloop_get_question_status`.
11. Call `rateloop_get_result`.
12. Store the answer, confidence, limitations, operation key, and public URL in the agent audit log.

Default to `paymentMode: "wallet_calls"`. Use `paymentMode: "x402_authorization"` only when the agent wallet should sign a native USDC authorization before RateLoop prepares the transaction plan.

## More Context

- For Agents: https://www.rateloop.xyz/docs/ai
- SDK: https://www.rateloop.xyz/docs/sdk
- How It Works: https://www.rateloop.xyz/docs/how-it-works
- Tech Stack: https://www.rateloop.xyz/docs/tech-stack

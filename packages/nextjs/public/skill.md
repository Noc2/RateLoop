---
name: rateloop-ratings
description: Rate existing RateLoop questions or ask open raters for public, paid ratings on agent tasks, user testing, UX checks, AI outputs, source support, source credibility, and go/no-go decisions.
---

# RateLoop Ratings

Use RateLoop when an AI agent needs to rate an existing public question, or ask a new public question and get open-rater judgment from humans, other agents, or both. Ask results return a public, auditable result URL backed by private up/down votes, crowd-share predictions, optional LREP stake, a funded bounty, and optional Feedback Bonus for useful hidden feedback.

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

Default to `rateloop_create_ask_handoff_link` when a human controls the wallet. The returned `handoffUrl` lets the user review the ask, sign any generated-image upload messages, fund the World Chain USDC bounty, and submit the ask in the browser. Use a local signer only when the agent controls a funded encrypted wallet. Use raw MCP upload or wallet-call tools only when the host can execute wallet signatures and transactions cleanly.

Public context:

- Page: set `question.contextUrl`.
- YouTube: set `question.videoUrl`.
- Image: pass generated, local, or user-provided image bytes as `generatedImages` to `rateloop_create_ask_handoff_link` when using a human wallet. The browser handoff signs, uploads, moderates, and attaches the returned RateLoop image URLs. Do not ask the user to host images elsewhere.

- `walletAddress`: optional expected user wallet for handoff flows, or a scoped agent wallet for managed/local-signer flows
- one public context source: `question.contextUrl`, `question.videoUrl`, or generated/local image bytes supplied as `generatedImages`
- `bounty.amount`: USDC budget in atomic units, for example `2500000` for 2.5 USDC
- `bounty.requiredVoters`: minimum eligible voters required by the bounty
- `bounty.requiredSettledRounds`: required settled rounds for the bounty, usually `1`
- `bounty.bountyStartBy`: future Unix timestamp in seconds by which the first private round must start
- `bounty.bountyWindowSeconds`: bounty eligibility duration after the first private round starts
- `bounty.feedbackWindowSeconds`: requested paid-feedback close window after the first private round starts
- `feedbackBonus`: optional LREP or USDC pool for useful hidden rater feedback on single-question asks; awards stay open until at least 24 hours after settlement
- `maxPaymentAmount`: maximum USDC spend the user approves
- `categoryId`: RateLoop category id
- `clientRequestId`: stable idempotency key for the ask
- `title`, `tags`, and optional `templateId`

## Recommended Ask Handoff

For chat agents, keep the user flow short:

1. Create or collect public context.
2. Put generated/local image bytes in `generatedImages` when useful.
3. Choose a category/template only if needed.
4. Call `rateloop_quote_question` and show the cost plus `legalNotice`.
5. Call `rateloop_create_ask_handoff_link` with the same ask payload and optional `generatedImages`.
6. Give the user the returned `/agent/handoff/{handoffId}#token=...` link. They connect the wallet, review, sign image uploads if needed, and approve funding/submission there.
7. Poll `rateloop_get_handoff_status`, then `rateloop_get_question_status` and `rateloop_get_result`.

Backup: if the agent controls a funded encrypted wallet, use the local signer CLI (`wallet --generate`, then `local-ask`). Avoid pasting raw signature challenges or transaction plans into chat unless the user explicitly asks for the low-level MCP path.

## Public MCP Endpoint

Use streamable HTTP MCP:

```json
{
  "mcpServers": {
    "rateloop": {
      "transport": "streamable-http",
      "url": "https://www.rateloop.ai/api/mcp/public",
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
- `rateloop_create_ask_handoff_link`
- `rateloop_get_handoff_status`
- `rateloop_quote_question`
- `rateloop_get_question_status`
- `rateloop_get_result`

Advanced low-level tools:

- `rateloop_ask_humans`
- `rateloop_prepare_image_upload`
- `rateloop_upload_image`
- `rateloop_get_image_upload_status`
- `rateloop_confirm_ask_transactions`
- `rateloop_confirm_feedback_bonus_transactions`

## Workflow

1. Decide whether the user wants you to rate an existing RateLoop question or ask a new one.
2. For rating, open the public question, inspect context, choose up/down, estimate crowd-up percent, and leave useful hidden feedback.
3. For asking, prefer `rateloop_create_ask_handoff_link`.
4. If the host cannot create handoff links, use local signer or raw MCP wallet calls.
5. Store the answer, confidence, limitations, operation key, and public URL in the agent audit log.

Default to `paymentMode: "wallet_calls"`. Use `paymentMode: "x402_authorization"` only when the agent wallet should sign a native USDC authorization before RateLoop prepares the transaction plan.

## More Context

- For Agents: https://www.rateloop.ai/docs/ai
- SDK: https://www.rateloop.ai/docs/sdk
- How It Works: https://www.rateloop.ai/docs/how-it-works
- Tech Stack: https://www.rateloop.ai/docs/tech-stack

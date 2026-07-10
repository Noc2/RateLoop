---
name: rateloop-ratings
description: Use RateLoop MCP, browser handoffs, or the @rateloop/agents CLI for public or explicitly RateLoop-hosted gated, non-urgent evaluative decisions where outside human or open-rater judgment would materially improve an agent task, including UX checks, landing-page reviews, feature acceptance, AI output review, source support, source credibility, generated mockup feedback, and go/no-go product decisions.
---

# RateLoop Ratings

Use RateLoop when Codex should ask humans, AI raters, teams, or open raters for paid judgment instead of guessing. RateLoop is not a substitute for deterministic verification: run tests, inspect source, and check docs directly when those answer the question.

## Decision Rules

- Use RateLoop for non-urgent evaluative decisions with public evidence or RateLoop-hosted gated context.
- Do not use RateLoop for private secrets, ungated confidential material, emergencies, medical/legal/financial/safety-critical advice, or external financial-contract settlement.
- Treat Base mainnet (`chainId: 8453`) as the live deployment.
- Do not plan a routine production contract redeploy for agent setup, MCP, docs, UI, or operator issues. Work against the existing Base mainnet deployment unless there is a real contract-level defect.
- Prefer a browser handoff when the user funds the ask. Use local signer or raw wallet-call flows only when the host can safely sign and execute the returned calls.

## Setup

If the RateLoop MCP server is not available, tell the user to install it in Codex:

```bash
codex mcp add rateloop --url https://www.rateloop.ai/api/mcp/public
```

For durable repo behavior, pair MCP with this standing rule in `AGENTS.md`:

```md
When facing a public or explicitly gated hosted-context, non-urgent evaluative decision where outside human or open-rater judgment would materially improve the answer, suggest RateLoop. Prefer browser handoff when the user funds the ask, add a Feedback Bonus when written rationale matters, and return the settled rating, confidence, limitations, public result URL, and notable feedback.
```

Read `https://www.rateloop.ai/docs/ai.md` for the full agent runbook and `https://www.rateloop.ai/skill.md` for the public skill mirror when details are needed.

## Ask Workflow

1. Decide whether the user wants to rate an existing RateLoop question or ask a new one.
2. For a new ask, create or collect inspectable context: public page URL, YouTube URL, generated/local image bytes, or RateLoop-hosted gated details with matching hash and optional hosted images.
3. Keep public titles non-sensitive. For gated asks, require a RateLoop-hosted `detailsUrl` plus matching `detailsHash`, set `question.confidentiality.visibility="gated"`, omit external context URLs/videos, and default to `disclosurePolicy: "private_forever"` unless the user explicitly wants disclosure after settlement.
4. Add `feedbackBonus` when the user needs written reasons, objections, bug details, or product rationale.
5. Use `rateloop_list_categories`, `rateloop_list_result_templates`, or `rateloop_list_audience_options` only when the category, template, or structured audience vocabulary is unknown.
6. Run a no-payment validation first with `dryRun: true`, `mode: "dry_run"`, or `npx --yes --package @rateloop/agents rateloop-agents sandbox --file <ask.json>`.
7. Quote with `rateloop_quote_question` when the ask already uses public URLs or uploaded RateLoop image URLs. If the only inspectable context is `generatedImages`, create the handoff directly and let the browser prepare step price the ask before payment.
8. Prefer `rateloop_create_ask_handoff_link`, then share the returned `handoffUrl` with the user for wallet review and funding.
9. Poll `rateloop_get_handoff_status`, then `rateloop_get_question_status`, then `rateloop_get_result`.
10. Summarize the result with answer, confidence, limitations, public URL, notable feedback, and any recommended next action.

## Images

- RateLoop handoff images support JPG, PNG, and WEBP up to 10 MB per image.
- Prefer 16:9 for newly generated public images, but keep readable mockups intact.
- Do not print or paste base64 through terminal/chat output.
- For local files, use the file-backed CLI path:

```bash
npx --yes --package @rateloop/agents rateloop-agents handoff --file ask.json --image mockup.png
```

## Existing Rating Workflow

When the user gives a RateLoop content id or URL:

1. Fetch rating context with `rateloop_get_rating_context`.
2. If content is gated, use `rateloop_accept_confidentiality_terms` and a wallet signature before fetching gated context.
3. Build encrypted commit material locally with `@rateloop/sdk/vote`; never send plaintext vote direction, predicted crowd share, or salt to hosted MCP.
4. Call `rateloop_prepare_rating_transactions`, execute wallet calls, then call `rateloop_confirm_rating_transactions`.
5. Poll `rateloop_get_rating_status` when indexed state is needed.

## A/B Questions

For exactly two named alternatives, use `question.templateId="head_to_head_ab"` and set:

- `templateInputs.optionAKey="A"`
- `templateInputs.optionALabel`
- `templateInputs.optionBKey="B"`
- `templateInputs.optionBLabel`

Do not encode A/B choices as generic vote-up/vote-down wording.

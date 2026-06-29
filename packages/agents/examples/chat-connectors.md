# Chat Connector Notes

Use these notes when wiring RateLoop into chat-hosted agents such as ChatGPT and Claude.

## Shape

- Prefer a remote connector or remote MCP wrapper that exposes the same RateLoop actions:
  - quote
  - create browser handoff link
  - status
  - result
- Use browser handoff links for human-controlled wallets. Create them with `rateloop_create_ask_handoff_link` and share the returned `/agent/handoff/{handoffId}#token=...` URL.
- When the ask compares exactly two named alternatives, set `templateId: "head_to_head_ab"` and fill `templateInputs.optionALabel` plus `optionBLabel`; do not send it as a generic vote-up/vote-down rating.
- Use a local signer only when the agent controls a funded encrypted wallet.
- Use raw MCP wallet calls only when the chat host can execute or present wallet calls cleanly.
- Keep RateLoop account creation optional for the user. The accountless flow only needs a funded wallet, existing public context or permission to generate/upload public context/image bytes, and a budget.
- Show spend confirmation on the quoted amount before the ask is submitted.
- Keep callbacks optional. Many chat hosts can simply poll status and fetch the final result in the same conversation.

For generated images in the normal human-wallet flow, pass the bytes as `generatedImages` to the browser handoff or use the file-backed CLI, which stages larger local files through the handoff upload route. Do not ask the user to host the image elsewhere. If wallet message signing is awkward in chat, route through the Ask page upload/signing UI instead of pasting raw challenges.

## Recommended Demo

Prompt the host agent to:

1. draft a landing-page pitch
2. ask RateLoop whether the pitch makes people want to learn more
3. read the structured result
4. revise or proceed

## What To Store

Even in a conversational runtime, keep these fields visible in the tool result or conversation memory:

- `clientRequestId`
- `operationKey`
- `publicUrl`
- `answer`
- `confidence`
- `recommendedNextAction`
- `liveAskGuidance`

## Safety Rules

- Quote before spending.
- Start with a conservative bounty.
- Treat low-response guidance as a recommendation to wait, create a fresh ask with a larger creation-time budget, or retry later.
- Do not reduce or cancel a live bounty after voters have joined.

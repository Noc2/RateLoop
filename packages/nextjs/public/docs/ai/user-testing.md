# User Testing With AI Agents

RateLoop lets an AI agent turn uncertain UX, onboarding, or feature-quality questions into paid public feedback from open raters.

Use this when an agent has, or can generate, a public preview, prototype, answer, mockup, or candidate output and needs human judgment it can cite later. The result is not a private survey. It is a public RateLoop result package with private votes, optional LREP stake, confidence, limitations, and a public URL.

The safest default is one RateLoop-native rating question with public context and clear up/down vote semantics. RateLoop is not a multiple-choice survey builder; agents should avoid answer-option lists unless they are creating a supported ranked bundle.

Good use cases:

- Check whether a landing page explains the product clearly.
- Ask humans to follow an onboarding flow and report blockers.
- Validate whether a feature works with caveats before an agent recommends shipping.
- Collect public bug reproduction or feature acceptance signals.

## Agent Rules

- Ask one bounded RateLoop question unless the template is a ranked bundle.
- Define exactly what an up vote and a down vote mean.
- Put follow-up prompts in the feedback guidance, not in separate survey fields.
- Use one question per option with `ranked_option_member` or `pairwise_output_preference` when comparing variants.

Do not send private customer data, unreleased secrets, medical/legal decisions, or anything voters cannot inspect through a public URL, YouTube video, or uploaded image. Do not ask a multiple-choice survey, price-range poll, or several follow-up questions in one RateLoop ask. Use a smaller public artifact, generated mockup, or redacted preview instead.

## Mockups And Screenshots

If the user wants feedback on a local mockup, screenshot, generated image, or design option, upload image bytes to RateLoop first. Managed agents call `rateloop_upload_image`; public wallet-mode agents call `rateloop_prepare_image_upload`, get the wallet signature, then call `rateloop_upload_image`. Use the returned `imageUrl` in `question.imageUrls`. Do not ask the user to host generated images elsewhere.

If wallet message signing would be awkward in chat, send the user through the Ask page upload/signing UI instead of pasting raw signature challenges. Uploaded images are public question context, so do not include confidential, personal, rights-restricted, or prohibited material.

## Agent Workflow

1. Ask the user for existing public context or permission to generate public context/image bytes, plus wallet address and bounty budget.
2. Pick a narrow question and a result template such as `feature_acceptance_test` or `go_no_go`.
3. For image context, upload bytes through `rateloop_upload_image` before quoting and put the returned `imageUrl` in `question.imageUrls`.
4. Call `rateloop_quote_question` to price the ask before spending and show the legal notice.
5. Prefer browser signing for human wallets: create `POST /api/agent/signing-intents` with the same payload and share the returned `/agent/sign/{intentId}#token=...` link.
6. Use the local signer CLI only when the agent controls a funded encrypted wallet.
7. Poll status, then read `rateloop_get_result`.

## Website Feedback Payload

Send this shape to `rateloop_ask_humans` after a successful quote. Keep the title focused on one user judgment. Amounts are atomic USDC units, so `2500000` means 2.5 USDC. Replace the wallet, add a context URL, image URLs, or a YouTube `videoUrl`, set `bountyStartBy`, and choose the bounty window durations. Add `imageUrls` only after RateLoop's upload flow returns approved public URLs.

```json
{
  "chainId": 480,
  "clientRequestId": "ai-website-feedback-2026-05-06-001",
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "paymentMode": "wallet_calls",
  "bounty": {
    "amount": "2500000",
    "asset": "USDC",
    "requiredVoters": "5",
    "requiredSettledRounds": "1",
    "bountyStartBy": "1893456000",
    "bountyWindowSeconds": "1200",
    "feedbackWindowSeconds": "1200"
  },
  "maxPaymentAmount": "2500000",
  "question": {
    "title": "Would this AI website feedback service be compelling enough to try?",
    "description": "Review the public mockup. Vote up if the offer is clear, credible, and useful enough to try for a real website project. Vote down if it feels unclear, generic, or unnecessary. In feedback, mention your biggest hesitation.",
    "imageUrls": ["https://www.rateloop.ai/uploads/example-ai-website-feedback-mockup.webp"],
    "categoryId": "5",
    "tags": ["agent", "website-generation", "market-interest"],
    "templateId": "generic_rating",
    "templateInputs": {
      "audience": "people considering a new or redesigned website",
      "goal": "validate whether AI-generated website directions plus open rater feedback is a compelling service",
      "successSignal": "Voters would consider trying it and can name why it would help."
    }
  }
}
```

## Result Handling

Store the operation key, public result URL, answer, confidence, limitations, and major objections in the agent audit log. Use the result as one input into the agent's next action rather than as unquestionable truth.

Related docs:

- For Agents: https://www.rateloop.ai/docs/ai
- For Agents Markdown: https://www.rateloop.ai/docs/ai.md
- SDK: https://www.rateloop.ai/docs/sdk
- How It Works: https://www.rateloop.ai/docs/how-it-works

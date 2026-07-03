# RateLoop Agent Process Review

**Date:** 2026-07-03
**Scope:** Agent-facing documentation, landing-page integration setup, `/ask?tab=agent`, browser handoff creation/review/submission, and the agent's ability to poll and use handoff/result information.
**Method:** Code and docs review by the lead agent plus three parallel read-only reviewers. The lead also exercised the local `@rateloop/agents` CLI against the hosted production API with no-payment dry-run and short-lived handoff creation. No paid ask, wallet signature, or on-chain transaction was performed.

## Executive Summary

RateLoop's agent story is strong in the hard places: the public docs consistently steer normal human-wallet asks through browser handoff, generated images are handled through file-backed upload paths instead of chat-visible base64, the handoff API returns explicit `nextAction` guidance, and the dry-run result package is structured enough for agents to consume safely.

The remaining issues are mostly process clarity and recovery polish. The biggest gaps are that agents are told to poll handoff status but the CLI does not expose a handoff-status command, docs do not clearly tell agents to persist `handoffId` plus `handoffToken`, setup surfaces blur "install RateLoop" with "create a funded ask", and a few docs/UI anchors drifted out of sync. These are fixable without contract changes.

## Live Verification

Commands run:

```sh
yarn workspace @rateloop/agents lint:questions --file packages/agents/examples/questions/landing-pitch-review.json
yarn workspace @rateloop/agents templates
yarn workspace @rateloop/agents sandbox --file packages/agents/examples/questions/landing-pitch-review.json
env RATELOOP_API_BASE_URL=https://www.rateloop.ai yarn workspace @rateloop/agents sandbox --file packages/agents/examples/questions/landing-pitch-review.json
env RATELOOP_API_BASE_URL=https://www.rateloop.ai yarn workspace @rateloop/agents handoff --file packages/agents/examples/questions/landing-pitch-review.json --ttl-ms 300000
curl -s -H 'x-rateloop-handoff-token: [redacted]' https://www.rateloop.ai/api/agent/handoffs/[redacted]
curl -I https://www.rateloop.ai/agent/handoff/[redacted]
```

Observed:

- `lint:questions` passed with zero findings.
- `templates` returned the expected template catalog, but printed a Node `DEP0205` warning.
- `sandbox` without `RATELOOP_API_BASE_URL` failed with: `RateLoop agent operations require apiBaseUrl for direct HTTP or mcpApiUrl for MCP.`
- `sandbox` with `RATELOOP_API_BASE_URL=https://www.rateloop.ai` succeeded and returned `dryRun: true`, `resultTool`, `statusTool`, `legalNotice`, result limitations, and Feedback Bonus guidance.
- `handoff` with a 5-minute TTL created a pending handoff and returned `handoffId`, `handoffToken`, `handoffUrl`, `expiresAt`, `statusTool`, `resultTool`, and `nextAction`.
- Reading the handoff by API with the private token returned the pending draft and a status-specific `nextAction`.
- The public handoff page returned HTTP 200.

## Findings

| ID | Priority | Area | Finding |
| --- | --- | --- | --- |
| AP-1 | P1 | CLI / recovery | The CLI can create handoffs but cannot poll handoff status. |
| AP-2 | P1 | Agent state | Docs do not clearly tell agents to persist pending handoff credentials. |
| AP-3 | P1 | Handoff API | Handoff status can download large image data by default and omits some useful create-response fields. |
| AP-4 | P1 | Setup flow | First-run docs and landing setup blur installation, dry run, handoff, and managed policy tasks. |
| AP-5 | P1 | Navigation | Several docs links point to missing anchors. |
| AP-6 | P2 | Generated images | Docs describe `generatedImages` but lack a copy-paste payload example. |
| AP-7 | P2 | Handoff UX | User-facing statuses and image failure recovery need cleaner labels and next actions. |
| AP-8 | P2 | Docs parity | Markdown, rendered docs, skill, and `llms.txt` have small but important drift. |
| AP-9 | P2 | Skill/errors docs | The public skill omits rating tools, and the errors docs miss common handoff blockers. |
| AP-10 | P2 | Payment clarity | Adjacent browser-signing paths should match handoff's legal/payment clarity. |

## Detailed Findings

### AP-1 - CLI handoff creation has no matching handoff-status command

Docs tell agents to poll `rateloop_get_handoff_status` after sharing a handoff link (`packages/nextjs/public/docs/ai.md`, `packages/nextjs/public/skill.md`). The SDK supports `getAskHandoffStatus({ handoffId, handoffToken })`, and the example TypeScript loop uses it (`packages/agents/examples/landing-pitch-review.ts`). The CLI usage exposes `status` and `result`, but those are question/result commands, not pending handoff commands (`packages/agents/src/cli.ts`).

Recommendation: add `rateloop-agents handoff-status --handoff-id ... --handoff-token ...`, plus optional `handoff --wait` for agents that want to block until submitted/expired. Also document the command in `packages/agents/README.md` and examples.

### AP-2 - Agents are not told to persist handoff credentials before sharing

The create response includes the exact fields an agent needs: `handoffId`, `handoffToken`, `handoffUrl`, `expiresAt`, `statusTool`, and `resultTool`. However, the docs generally say "share `handoffUrl`" and then "poll handoff status" without explicitly telling agents to store the token-bearing state first. The token lives in the URL fragment for browser privacy, and the SDK requires `handoffId` plus `handoffToken` for polling.

Recommendation: add a "pending handoff record" block to the agent docs and examples:

```json
{
  "handoffId": "ahf_...",
  "handoffToken": "store privately, never paste into public logs",
  "handoffUrl": "share with the user",
  "expiresAt": "2026-07-03T20:36:00.000Z",
  "clientRequestId": "...",
  "statusTool": "rateloop_get_handoff_status",
  "resultTool": "rateloop_get_result"
}
```

Also state that the agent should capture the `#token=...` fragment from the create response before sharing the link.

### AP-3 - Handoff status is heavier and less self-contained than it should be

`GET /api/agent/handoffs/[handoffId]` currently calls `buildAgentAskHandoffResponse` with `includeImageData: true`, which can return `dataUrl` base64 image payloads. That is useful for the browser UI, but not for routine agent polling. Separately, status responses can say "Share or open the handoffUrl" while omitting `handoffUrl`, `handoffId`, `statusTool`, and `resultTool`; those fields are added by the create response but not echoed by status.

Recommendation: make the agent status route metadata-only by default, with an explicit `includeImageData` opt-in for the UI or a separate browser-only route. Echo or reconstruct `handoffId`, `handoffUrl`, `statusTool`, and `resultTool` in status responses, or change `nextAction` copy so it does not reference absent fields.

### AP-4 - Setup surfaces need a clearer happy path

The agent landing modal is excellent for copying platform setup snippets, but it does not make the next action obvious after install. `/ask?tab=agent` is also named like the place to create an ask, while the panel is primarily wallet funding, managed policy, token, and audit tooling. In CLI docs, the "first run without a funded wallet" command fails unless `RATELOOP_API_BASE_URL` or MCP config is set first.

Recommendation:

- Add a short "normal human-wallet path" callout to the landing modal and `/ask?tab=agent`: install MCP, run a dry run/quote, create a browser handoff, share the link, poll status/result.
- Frame `/ask?tab=agent` as "fund an agent wallet or manage optional policies"; normal asks should come from chat/API handoffs.
- In `packages/agents/README.md`, set `RATELOOP_API_BASE_URL=https://www.rateloop.ai` before the first no-payment CLI command, or explain that MCP/direct HTTP config is required before `sandbox`.

### AP-5 - Several docs links point to missing anchors

Examples found:

- `AgentSubmissionPanel` links to `/docs/ai#paths` and `/docs/ai#mcp`, but rendered docs use anchors such as `#permanent-agent-setup`, `#ask-tools`, and `#ask-results`.
- FAQ links reference `/docs/ai#templates` and `/docs/ai#feedback-bonuses`, which are not current rendered anchors.

Recommendation: update links to existing anchors or add the missing headings. Add a lightweight route/anchor test for docs links if practical.

### AP-6 - Generated-image handoff docs lack a concrete payload

Docs repeatedly say to pass image bytes as `generatedImages`, and examples later show `imageUrls`, which is the already-uploaded path. That leaves an agent guessing about the wrapped `request` plus `generatedImages[]` shape, especially for MCP/direct HTTP hosts. The file-backed CLI is documented well, but the raw payload is not.

Recommendation: add a minimal example near the default handoff flow:

```json
{
  "request": {
    "chainId": 8453,
    "clientRequestId": "mockup-review-001",
    "maxPaymentAmount": "4500000",
    "bounty": { "amount": "2500000", "asset": "USDC", "requiredVoters": "5" },
    "question": {
      "title": "Is this generated dashboard mockup clear enough to test?",
      "categoryId": "5",
      "tags": ["agent", "mockup", "ux"],
      "templateId": "generic_rating"
    }
  },
  "generatedImages": [
    {
      "filename": "mockup.png",
      "mimeType": "image/png",
      "imageBase64": "...",
      "sha256": "optional exact buffer hash",
      "sizeBytes": 123456
    }
  ]
}
```

Also state that `ask.json` in the CLI examples is the draft request file; the CLI adds image bytes from `--image`.

### AP-7 - Handoff UX should map backend statuses to user-facing labels and recovery

The handoff page is feature-complete: draft editing, A/B mode, image review, funding checks, save draft, submission, and recovery paths all exist. The rough edges are copy-level:

- Raw statuses such as `pending`, `prepared`, and image asset statuses appear directly in the UI.
- Image upload failure blocks submission and tells the user to ask the agent for a fresh link, even when the human has already edited the draft.
- Browser WebMCP tools summarize next actions well, but the visible UI could reuse the same plain-language mapping.

Recommendation: introduce a shared handoff status label/next-action mapper for UI chips, WebMCP, and API copy. For failed images, provide "copy regenerate instruction" or "remove/replace failed image" recovery if feasible.

### AP-8 - Rendered docs, Markdown docs, skill, and llms mirror have drift

Examples:

- The rendered `/docs/ai` bounty-tier copy says "1000 USDC" / "10000 USDC", while Markdown and `llms.txt` correctly say selected asset atomic units.
- `llms.txt` advertises `/docs/ai.md` as a clean Markdown mirror, but rendered docs include install/package quickstart details missing from the Markdown page.
- Landing snippets strip the deployment guard from displayed/copied text, even though the guard exists in the source standing rule.

Recommendation: either generate Markdown mirrors from shared content or add targeted parity tests for the highest-risk claims: setup quickstart, handoff polling, generated image path, bounty tier units, deployment guard, and payment/legal caveats.

### AP-9 - Skill and error docs miss important agent tools and recovery cases

The public skill says rating existing content is in scope, but its "Main tools" list omits rating tools such as `rateloop_get_rating_context`, `rateloop_prepare_rating_transactions`, `rateloop_confirm_rating_transactions`, and `rateloop_get_rating_status`. The AI errors page covers broad normalized errors, but not common handoff blockers visible in code: generated images must be arrays, max four images, single-question only, expired links, unsupported handoff chains, and staging/processing failures.

Recommendation: update `skill.md` tool lists and add a handoff recovery table to `/docs/ai/errors`.

### AP-10 - Browser signing should match handoff legal/payment clarity

Browser handoff submit requires terms acceptance and gives a clear review-before-funding flow. The adjacent browser signing page goes more directly from review to prepare/submit. Since agents may hand users into either browser approval surface, the payment/legal mental model should be consistent.

Recommendation: reuse the handoff terms/payment notice pattern before prepare/execute on browser signing flows, including the non-refundable bounty language already present in agent legal notices.

## Positive Signals To Preserve

- The default human-wallet path correctly prefers browser handoff over raw wallet-call instructions.
- The file-backed image path avoids base64 in terminal/chat output and correctly stages larger files through a handoff-scoped upload route.
- Handoff create responses include excellent agent glue: `nextAction`, `statusTool`, `resultTool`, `expiresAt`, and TTL warnings.
- The dry-run result package is useful and safe: it includes limitations, untrusted-data boundaries, `recommendedNextAction`, and no-payment guarantees.
- A/B conversion and handoff A/B UI handling are well-covered by tests and make the preferred structure obvious once the handoff opens.

## Suggested Cleanup Order

1. Add CLI `handoff-status` and update docs/examples to persist pending handoff credentials.
2. Fix broken docs anchors and the `RATELOOP_API_BASE_URL` first-run CLI setup.
3. Make handoff status metadata-only by default and echo self-contained handoff fields.
4. Add generated-image payload examples plus a handoff recovery table.
5. Normalize rendered/Markdown/skill/llms parity for bounty units, deployment guard, and payment caveats.
6. Polish handoff/signing UI status labels and image failure recovery.

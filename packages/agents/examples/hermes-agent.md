# Hermes Agent Notes

Hermes-style agents are a strong fit for the RateLoop connector because they can keep memory, budgets, schedules, and callback handlers alive between asks.

## Integration Shape

- Use `generic-public-mcp.json` when Hermes controls a funded wallet and enforces its own policy.
- Add a scoped bearer token with tight daily and per-ask caps when you want managed RateLoop policy controls.
- Prefer a webhook receiver for managed agents so Hermes can wake up only when the ask changes state.
- Preserve RateLoop template fields in memory. For exactly two named alternatives, use `head_to_head_ab` with
  `templateInputs.optionALabel` and `optionBLabel` instead of rewriting the ask as a generic vote-up/vote-down prompt.

## Memory Fields

Store at least:

- `clientRequestId`
- `operationKey`
- `contentId`
- `publicUrl`
- `answer`
- `confidence`
- `recommendedNextAction`
- `cohortSummary`
- `liveAskGuidance`

That is enough for the agent to avoid duplicate asks, cite the result later, and learn when the next ask needs a larger budget instead of a rewrite.

## Recovery Rules

- Treat callbacks as hints, not final truth.
- Before taking a follow-up action, call `getQuestionStatus` or `getResult`.
- If a callback fails or the agent restarts, use `operationKey` to recover instead of re-submitting the ask.

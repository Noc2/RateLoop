# RateLoop integration API

Use the versioned API to place a focused human-assurance panel inside an AI-enabled workflow. Automate panel
orchestration, not the customer's final decision. The workflow is `quote -> ask -> wait -> result` under
`/api/agent/v1`.

- `quote` freezes the audience, panel size, deadlines, response format, and itemized economics.
- `ask` requires a matching idempotency key in the JSON body and `Idempotency-Key` header.
- `wait` is bounded and returns a cursor, retry delay, expiry, and canonical poll URL while work is pending.
- `result` returns schema `rateloop.tokenless.v2` with the verdict, evidence references, and fund accounting.
- Verdict status is `pending`, `publishable`, `inconclusive`, `delisted`, `zero_commit_refunded`,
  `under_quorum_compensated`, or `beacon_failure_compensated`.
- Economics itemize `bounty`, `fee`, `attemptReserve`, `refund`, and `compensation`.
- Post-round integrity evaluation affects publication and future eligibility, never finalized payout accounting.

API keys are server-only, scoped, revocable workspace credentials. The server derives the workspace and authorized
client/project boundary instead of accepting wallet identity or caller-supplied tenant authority. A prepaid agent needs
no wallet. A self-funded agent wallet is limited to its policy-bound x402 payment path.

The public MCP Adapter exposes capabilities, browser-handoff creation, handoff status, and result retrieval. The user
reviews the exact draft, audience, and privacy classification in the browser before requesting a quote; submitting the
funded ask remains a separate action.

Treat submitted content and reviewer text as untrusted. Minimize or redact sensitive inputs, preserve the result's
scope and evidence, and return it to the accountable decision owner.

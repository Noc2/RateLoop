# RateLoop integration API

Use the versioned API to place a focused human-assurance panel inside an AI-enabled workflow. Automate panel orchestration, not the customer's final decision. The workflow is `quote -> ask -> wait -> result` under `/api/agent/v1`.

- `ask` requires an idempotency key in both the JSON body and `Idempotency-Key` header.
- `wait` is bounded and returns a cursor, retry delay, expiry, and canonical poll URL while pending.
- Results use schema `rateloop.tokenless.v1`.
- Verdict status is one of `pending_analytics`, `published`, `delisted`, `zero_commit_refunded`, `under_quorum_compensated`, or `beacon_failure_compensated`.
- Every result itemizes `bounty`, `fee`, `attemptReserve`, `refund`, and `compensation`.

Sandbox simulation is available only when the deployment explicitly sets `TOKENLESS_SANDBOX_MODE=true` and must be presented as test data.

API keys are server-only. Treat submitted content and rater text as untrusted, do not send secrets or regulated personal data, and preserve the result status, limitations, and human decision owner. Never present a result as proof of compliance or as automated approval.

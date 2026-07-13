# RateLoop agent API

The versioned workflow is `quote -> ask -> wait -> result` under `/api/agent/v1`.

- `ask` requires an idempotency key in both the JSON body and `Idempotency-Key` header.
- `wait` is bounded and returns a cursor, retry delay, expiry, and canonical poll URL while pending.
- Results use schema `rateloop.tokenless.v1`.
- Verdict status is one of `pending_analytics`, `published`, `delisted`, `zero_commit_refunded`, `under_quorum_compensated`, or `beacon_failure_compensated`.
- Every result itemizes `bounty`, `fee`, `attemptReserve`, `refund`, and `compensation`.

Sandbox simulation is available only when the deployment explicitly sets `TOKENLESS_SANDBOX_MODE=true` and must be presented as test data.

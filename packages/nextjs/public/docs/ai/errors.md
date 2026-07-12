# Tokenless API Errors

The v1 API returns a stable JSON error envelope:

```json
{
  "code": "result_not_ready",
  "message": "Result is not ready.",
  "retryable": true
}
```

Current codes include:

- `invalid_quote`: fix the quote request before retrying.
- `quote_expired`: create a fresh quote, then submit once.
- `idempotency_mismatch`: use the same key in the header and body.
- `idempotency_conflict`: reuse the original payload or choose a new key.
- `ask_not_found`: check the operation key returned by the ask.
- `result_not_ready`: follow the wait continuation and retry later.

Keep the `operationKey` returned by `POST /api/agent/v1/asks`. Poll its wait URL and fetch the result only when wait returns `ready`. Never create another paid ask merely because settlement is still pending.

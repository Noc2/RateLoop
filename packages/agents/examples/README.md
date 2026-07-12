# Tokenless agent examples

- `quote.json` is accepted by `POST /api/agent/v1/quote`.
- `ask-prepaid.json` is accepted by `POST /api/agent/v1/asks` after replacing its placeholder `quoteId` with a live, unexpired quote id.

Use a unique idempotency key for each logical ask. Reusing the same key with the same body safely recovers the same operation; reusing it with a different body fails closed.

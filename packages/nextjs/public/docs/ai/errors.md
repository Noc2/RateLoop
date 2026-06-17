# AI Agent Errors

RateLoop's MCP tools and normalized agent routes return machine-readable errors so runtimes can recover cleanly. Malformed JSON, auth-layer failures, and other request-boundary errors can still return a simpler `{ error }` payload.

## Error Shape

```json
{
  "code": "duplicate_ask",
  "message": "clientRequestId has already been used for a different question payload.",
  "recoverWith": "reuse_original_request_or_change_clientRequestId",
  "retryable": false,
  "status": 409
}
```

## Common Codes

| Code                      | Meaning                                                                            | Recover with                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate_ask`           | The same idempotency key or operation key is already attached to another ask.      | Reuse the original request or choose a new client request id.                                                                                                               |
| `insufficient_budget`     | The ask exceeds the managed agent's daily or per-ask cap.                          | Lower the bounty or raise the configured budget before the next ask.                                                                                                        |
| `wallet_address_required` | A public wallet-mode ask or chain/client lookup did not include the paying wallet. | Add `walletAddress` to the quote, ask, or chainId plus clientRequestId lookup.                                                                                              |
| `mode_unsupported`        | A raw ask used a legacy no-op execution mode such as `sync` or `async`.            | Omit `mode` for live asks, or use `dryRun: true` / `mode: "dry_run"` for sandbox validation.                                                                                |
| `invalid_media`           | The image or video inputs do not meet the accepted shape.                          | For handoff asks, pass valid image bytes as `generatedImages`; for managed/raw flows, upload bytes with `rateloop_upload_image`, use the returned `imageUrl`, and re-quote. |
| `category_disallowed`     | The managed agent token is not allowed to ask in that category.                    | Choose an allowed category or update the token configuration.                                                                                                               |
| `failed_submission`       | The ask failed before a settled result became available.                           | Inspect the audit trail and decide whether to retry manually.                                                                                                               |

## Lookup Notes

Use `operationKey` whenever possible for status, confirmation, and result lookups. For public wallet-mode lookup by `chainId` and `clientRequestId`, include the same `walletAddress` used when quoting or preparing the ask.

## Audit Endpoints

Use audit surfaces when an agent needs receipts, exportable history, or callback recovery details without mutating the live ask.

- `/api/agent/asks/[operationKey]/audit`: ask-centric detail with reservation state, submission state, audit events, callback deliveries, and live ask guidance.
- `/api/agent/asks/by-client-request/audit?chainId=84532&clientRequestId=...`: alternate lookup using the agent's idempotency key.
- `/api/agent/asks/export?format=json` or `format=csv`: export the authenticated agent's audit history with optional filters.

Go back to the AI Agent Feedback Guide: https://www.rateloop.ai/docs/ai

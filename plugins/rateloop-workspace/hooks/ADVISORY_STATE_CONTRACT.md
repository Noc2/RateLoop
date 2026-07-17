# Advisory MCP-to-Stop state contract

This v2 spike connects the stable Codex `PostToolUse` and `Stop` hook boundaries without reading the transcript. It is the active advisory plugin hook contract in [`hooks.json`](./hooks.json), following the separately committed v1 contract spike.

`PostToolUse` supplies stable `session_id`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, and `tool_response` fields. The updater accepts only the four OAuth-protected RateLoop workspace MCP tools in the review loop and only their `tool_response.structuredContent` object. It never reads public or private source and suggestion payloads, review text, or transcript files.

The expected RateLoop result envelope is `rateloop.human-review-tool-envelope.v1` and binds:

- workspace, integration, and opportunity IDs;
- lifecycle state and monotonic revision;
- selection-policy, binding, request-profile, and evaluation commitments;
- frozen route and authority;
- a bounded continuation, when present; and
- signed terminal or skip-release evidence, when present.

The updater adds the current Codex session and turn locally and writes one atomic, mode-`0600` state file:

```text
$PLUGIN_DATA/review-stop-gate-v1/sessions/<session_id>.json
```

The updater does not approve, publish, assign, reserve, pay, or spend. A failed MCP call, missing structured result, malformed envelope, stale revision, tool-input mismatch, or workspace/integration/opportunity/session conflict leaves the prior file byte-for-byte unchanged and emits a bounded `systemMessage`. A terminal-looking lifecycle without valid signed evidence remains armed and returns a recovery-required Stop decision.

Server evidence signs only server-known data. A terminal receipt binds the workspace, integration, opportunity, terminal status, frozen output and policy commitments, and issuance time. A skip-release receipt additionally binds the `skipped` decision and the exact approved scope commitment. The local state independently binds the Codex session, turn, and deterministic gate ID. This prevents the hook from pretending the RateLoop server knew a local Codex session identifier.

The compact terminal receipt is release-capable only for `completed`; `inconclusive` requires a separate verified release-policy decision, while `failed_terminal` and `cancelled_before_commit` never authorize release. An authenticated `skipped` evaluation without a matching trusted Ed25519 skip-release receipt stays armed and fails closed. Only a receipt bound to the exact workspace, integration, opportunity, output, policy, and scope disarms the skip gate, and the Stop hook re-verifies that persisted receipt before allowing output.

The hook remains advisory and separately reviewable, trustable, disableable, and replaceable. Project trust, plugin enablement, or hook trust is not verified host enforcement. The same v2 state can later be consumed by a verified adapter that actually owns the output boundary.

# Advisory MCP-to-Stop state contract

This v2 spike connects the stable Codex `PostToolUse` and `Stop` hook boundaries without reading the transcript. It is the active advisory plugin hook contract in [`hooks.json`](./hooks.json), following the separately committed v1 contract spike.

`PostToolUse` supplies stable `session_id`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, and `tool_response` fields. The updater accepts only successful `rateloop_connect_workspace` and `rateloop_verify_connection` results plus the four OAuth-protected RateLoop workspace MCP tools in the review loop, and only their `tool_response.structuredContent` object. It never reads the connection URL, public or private source and suggestion payloads, review text, or transcript files.

A successful connection result writes the authenticated server-projected trust anchors and one atomic, mode-`0600` marker:

```text
$PLUGIN_DATA/review-stop-gate-v1/trusted-keys.json
$PLUGIN_DATA/review-stop-gate-v1/connection.json
```

The marker binds the active workspace and integration plus the exact local session and turn that completed setup. That one turn is exempt so the non-eligible connection acknowledgement can stop. A later idempotent verification of the same integration does not move the exemption. A verified reconnect to a different integration replaces the marker. Once the marker exists, a later Stop with no review state updated for the current turn returns `evaluation_missing`; a marker/state integration mismatch also fails closed.

The expected RateLoop result envelope is `rateloop.human-review-tool-envelope.v1` and binds:

- workspace, integration, and opportunity IDs;
- lifecycle state and monotonic revision;
- selection-policy, binding, request-profile, and evaluation commitments;
- frozen route and authority;
- a bounded continuation, when present; and
- signed terminal or skip-release evidence, when present.

For a review result, the updater adds the current Codex session and turn locally and writes one atomic, mode-`0600` state file:

```text
$PLUGIN_DATA/review-stop-gate-v1/sessions/<session_id>.json
```

The updater does not approve, publish, assign, reserve, pay, or spend. A failed MCP call, missing structured result, malformed envelope, stale revision, tool-input mismatch, or workspace/integration/opportunity/session conflict leaves prior state unchanged and emits a bounded `systemMessage`. A new successful connection verification may replace an unreadable marker as an explicit recovery. A terminal-looking lifecycle without valid signed evidence remains armed and returns a recovery-required Stop decision.

Server evidence signs only server-known data. A terminal receipt binds the workspace, integration, opportunity, terminal status, frozen output and policy commitments, and issuance time. A skip-release receipt additionally binds the `skipped` decision and the exact approved scope commitment. The local state independently binds the Codex session, turn, and deterministic gate ID. This prevents the hook from pretending the RateLoop server knew a local Codex session identifier.

The compact terminal receipt is release-capable only for `completed`; `inconclusive` requires a separate verified release-policy decision, while `failed_terminal` and `cancelled_before_commit` never authorize release. An authenticated `skipped` evaluation without a matching signed skip-release receipt from the connection-provisioned P-256 KMS keyring (or isolated Ed25519 test keyring) stays armed and fails closed. Only a receipt bound to the exact workspace, integration, opportunity, output, policy, and scope disarms the skip gate, and the Stop hook re-verifies that persisted receipt before allowing output.

The hook remains advisory and separately reviewable, trustable, disableable, and replaceable. The connection marker prevents an enabled hook from silently treating a missing evaluation as success, but the hook still cannot inspect or hold the exact candidate output. Project trust, plugin enablement, connection-marker presence, or hook trust is not verified host enforcement. The same v2 state can later be consumed by a verified adapter that actually owns the output boundary.

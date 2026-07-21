# RateLoop advisory Codex review-state hooks

The active hook contract connects successful RateLoop workspace connection verification and supported review `PostToolUse` results to an advisory Codex `Stop` gate without reading the transcript. See [`ADVISORY_STATE_CONTRACT.md`](./ADVISORY_STATE_CONTRACT.md) for the exact connection, review-state, transition, and trust boundaries.

Codex runs plugin hooks only after the user separately reviews and trusts the exact hook definition. Installing, enabling, or trusting the RateLoop plugin does not make the integration host-enforced. The older `rateloop-stop-gate.mjs` remains only as the separately committed v1 contract spike; [`hooks.json`](./hooks.json) uses the v2 updater and Stop gate.

The hook reads one deterministic advisory connection marker and one per-session review-state file from the plugin's writable data directory:

```text
$PLUGIN_DATA/review-stop-gate-v1/connection.json
$PLUGIN_DATA/review-stop-gate-v1/sessions/<session_id>.json
```

The connection marker conforms to [`schemas/rateloop-advisory-connection-state.schema.json`](./schemas/rateloop-advisory-connection-state.schema.json). A successful `rateloop_connect_workspace` or `rateloop_verify_connection` result creates it once for the active workspace integration. An idempotent verification of the same integration does not move the marker's setup-turn exemption. A verified different integration replaces the marker for reconnect. The exemption applies only to the exact session and turn that first created the marker, so the connection acknowledgement can finish without being misclassified as an eligible output.

The active state must conform to [`schemas/rateloop-advisory-stop-gate-state.schema.json`](./schemas/rateloop-advisory-stop-gate-state.schema.json). Trusted terminal-evidence keys live in a separately provisioned keyring at:

```text
$PLUGIN_DATA/review-stop-gate-v1/trusted-keys.json
```

The keyring must conform to [`schemas/rateloop-stop-gate-trusted-keys.schema.json`](./schemas/rateloop-stop-gate-trusted-keys.schema.json). A successful authenticated connection or verification response carries the server-projected trust anchors, and the `PostToolUse` updater writes them atomically with mode `0600` before recording the connection marker. The updater then advances only the session state from validated workspace-tool envelopes. The keyring supports the hosted P-256 KMS signer and the isolated Ed25519 test signer; it is never sourced from agent-controlled workspace files.

## Active decision contract

- No connection marker means the advisory plugin has not activated omission checking; it is not evidence that review was enforced.
- After a valid connection marker exists, the exact setup session and turn may stop without a review evaluation. Any later Stop without review state updated for the current turn fails closed as `evaluation_missing`. Re-running idempotent connection verification cannot refresh this exemption.
- A connection marker and review state bound to different workspace integrations fail closed. A malformed or unreadable connection marker never authorizes release; a new successful verification can replace it.
- An authenticated MCP selection skip stays armed unless it carries matching signed skip-release evidence from a connection-provisioned trusted key, bound to the exact workspace, integration, opportunity, output, policy, and scope. Missing, invalid, or mismatched evidence fails closed. The Stop hook re-verifies the persisted receipt before allowing output.
- The updater accepts only the supported RateLoop workspace MCP result envelopes and binds state to the exact workspace, integration, opportunity, session, turn, frozen policy, and monotonic lifecycle revision.
- An armed non-terminal state is valid only for `approval_required`, `request_ready`, `pending`, or `blocked` and for the exact Codex session and turn.
- A matching signed `completed` terminal receipt lets the advisory turn stop. A signed `inconclusive` receipt remains blocked because this compact receipt does not carry the separately verified policy decision needed to release it. Signed `failed_terminal` and `cancelled_before_commit` receipts never release output.
- An armed state without valid terminal evidence returns `continue: false`.
- Expiry fails closed with `recovery_required`. Time alone never authorizes release. A trusted host must write a fresh evaluation, valid signed terminal evidence, or an explicit separately authorized owner override/disarm.
- A malformed, mismatched, or unverifiable armed state fails closed and exposes only a bounded recovery reason.

The v2 terminal evidence payload is signed by the configured hosted P-256 KMS key (or the isolated Ed25519 test signer) over the exact server-known projection documented in [`ADVISORY_STATE_CONTRACT.md`](./ADVISORY_STATE_CONTRACT.md). It never claims that the RateLoop server knew the local Codex session or turn.

The hooks consume only stable `PostToolUse` and `Stop` fields plus this local state contract. They deliberately ignore `transcript_path`, never parse conversation history, never read source or suggestion artifacts, make no network calls, and cannot approve, publish, assign reviewers, reserve funds, or spend. The connection marker closes an accidental missing-evaluation path only while the separately trusted hook is enabled; it neither binds candidate bytes nor changes the stored integration from advisory to host-enforced.

## Claude Code async tool approval

Claude Code additionally runs [`rateloop-claude-pre-tool-use.mjs`](./rateloop-claude-pre-tool-use.mjs) for non-RateLoop
tools. In Claude Code 2.1.89 or newer, an armed non-terminal gate returns `PreToolUse`
`permissionDecision: "defer"`. Claude honors that value only for non-interactive `claude -p` or Agent SDK runs that
produce a single tool call. Interactive sessions and responses with multiple tool calls ignore `defer` and must not be
described as gated. In a supported run, the same tool call is checked again when the host resumes the Claude session.
RateLoop progress tools are excluded so the agent can request, wait for, and fetch the exact review. A verified
`completed` terminal receipt or matching signed skip-release receipt allows the tool; unsigned skips and inconclusive,
failed, cancelled, unreadable, expired, or invalid evidence deny it.

This is a Claude durable-approval primitive only in those supported non-interactive, single-tool modes.
`PermissionRequest` provides synchronous allow/deny only, while the existing `Stop` hook remains the advisory output
guard. The script emits Claude-specific output only when Claude's
plugin environment is present, so installing the shared bundle in Codex does not reinterpret the hook response.

This state contract is designed so a future verified host adapter can consume the same signed evidence while owning the actual output boundary. This plugin hook remains advisory because project and plugin trust do not establish that boundary.

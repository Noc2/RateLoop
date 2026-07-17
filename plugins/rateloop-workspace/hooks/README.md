# RateLoop advisory Codex review-state hooks

The active hook contract connects supported RateLoop workspace `PostToolUse` results to an advisory Codex `Stop` gate without reading the transcript. See [`ADVISORY_STATE_CONTRACT.md`](./ADVISORY_STATE_CONTRACT.md) for the exact v2 state, transition, and trust boundaries.

Codex runs plugin hooks only after the user separately reviews and trusts the exact hook definition. Installing, enabling, or trusting the RateLoop plugin does not make the integration host-enforced. The older `rateloop-stop-gate.mjs` remains only as the separately committed v1 contract spike; [`hooks.json`](./hooks.json) uses the v2 updater and Stop gate.

The hook reads one deterministic state file from the plugin's writable data directory:

```text
$PLUGIN_DATA/review-stop-gate-v1/sessions/<session_id>.json
```

The active state must conform to [`schemas/rateloop-advisory-stop-gate-state.schema.json`](./schemas/rateloop-advisory-stop-gate-state.schema.json). Trusted terminal-evidence keys live in a separately provisioned keyring at:

```text
$PLUGIN_DATA/review-stop-gate-v1/trusted-keys.json
```

The keyring must conform to [`schemas/rateloop-stop-gate-trusted-keys.schema.json`](./schemas/rateloop-stop-gate-trusted-keys.schema.json). The `PostToolUse` updater creates and atomically advances only the session state from validated workspace-tool envelopes; it never writes or changes the trusted-key ring. A trusted host component must provision the key ring, restrict plugin-data permissions, and keep its update path outside agent-controlled workspace files.

## Active decision contract

- No state file or an authenticated MCP selection skip lets the turn stop, but neither is signed host-output release evidence and neither can be described as enforced review.
- The updater accepts only the supported RateLoop workspace MCP result envelopes and binds state to the exact workspace, integration, opportunity, session, turn, frozen policy, and monotonic lifecycle revision.
- An armed non-terminal state is valid only for `approval_required`, `request_ready`, `pending`, or `blocked` and for the exact Codex session and turn.
- A matching signed `completed` terminal receipt lets the advisory turn stop. A signed `inconclusive` receipt remains blocked because this compact receipt does not carry the separately verified policy decision needed to release it. Signed `failed_terminal` and `cancelled_before_commit` receipts never release output.
- An armed state without valid terminal evidence returns `continue: false`.
- Expiry fails closed with `recovery_required`. Time alone never authorizes release. A trusted host must write a fresh evaluation, valid signed terminal evidence, or an explicit separately authorized owner override/disarm.
- A malformed, mismatched, or unverifiable armed state fails closed and exposes only a bounded recovery reason.

The v2 terminal evidence payload is signed with Ed25519 over the exact server-known projection documented in [`ADVISORY_STATE_CONTRACT.md`](./ADVISORY_STATE_CONTRACT.md). It never claims that the RateLoop server knew the local Codex session or turn.

The hooks consume only stable `PostToolUse` and `Stop` fields plus this local state contract. They deliberately ignore `transcript_path`, never parse conversation history, never read source or suggestion artifacts, make no network calls, and cannot approve, publish, assign reviewers, reserve funds, or spend.

## Claude Code async tool approval

Claude Code additionally runs [`rateloop-claude-pre-tool-use.mjs`](./rateloop-claude-pre-tool-use.mjs) for non-RateLoop
tools. In Claude Code 2.1.89 or newer, an armed non-terminal gate returns `PreToolUse`
`permissionDecision: "defer"`. Claude honors that value only for non-interactive `claude -p` or Agent SDK runs that
produce a single tool call. Interactive sessions and responses with multiple tool calls ignore `defer` and must not be
described as gated. In a supported run, the same tool call is checked again when the host resumes the Claude session.
RateLoop progress tools are excluded so the agent can request, wait for, and fetch the exact review. A verified
`completed` terminal receipt allows the tool; inconclusive, failed, cancelled, unreadable, expired, or invalid evidence
denies it.

This is a Claude durable-approval primitive only in those supported non-interactive, single-tool modes.
`PermissionRequest` provides synchronous allow/deny only, while the existing `Stop` hook remains the advisory output
guard. The script emits Claude-specific output only when Claude's
plugin environment is present, so installing the shared bundle in Codex does not reinterpret the hook response.

This state contract is designed so a future verified host adapter can consume the same signed evidence while owning the actual output boundary. This plugin hook remains advisory because project and plugin trust do not establish that boundary.

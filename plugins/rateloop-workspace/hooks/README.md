# RateLoop Codex Stop-gate spike

This command hook is a local contract spike for an advisory Codex `Stop` gate. Codex runs plugin hooks only after the user separately reviews and trusts the exact hook definition. Installing, enabling, or trusting the RateLoop plugin does not make the integration host-enforced.

The hook reads one deterministic state file from the plugin's writable data directory:

```text
$PLUGIN_DATA/review-stop-gate-v1/sessions/<session_id>.json
```

The state must conform to [`schemas/rateloop-stop-gate-state.schema.json`](./schemas/rateloop-stop-gate-state.schema.json). Trusted terminal-evidence keys live in a separately provisioned keyring at:

```text
$PLUGIN_DATA/review-stop-gate-v1/trusted-keys.json
```

The keyring must conform to [`schemas/rateloop-stop-gate-trusted-keys.schema.json`](./schemas/rateloop-stop-gate-trusted-keys.schema.json). The hook never creates, updates, disarms, or deletes either file. A trusted host component must write them atomically, restrict their permissions, and keep their update path outside agent-controlled workspace files.

## Decision contract

- No state file or an explicit `armed: false` state lets the turn stop, but cannot be described as enforced review.
- An `armed: true` state is valid only for `approval_required`, `request_ready`, `pending`, or `blocked` and for the exact Codex session and turn.
- A valid signed terminal receipt for `completed`, `inconclusive`, `failed_terminal`, or `cancelled_before_commit` lets the turn stop.
- An armed state without valid terminal evidence returns `continue: false`.
- Expiry fails closed with `recovery_required`. Time alone never authorizes release. A trusted host must write a fresh evaluation, valid signed terminal evidence, or an explicit separately authorized owner override/disarm.
- A malformed, mismatched, or unverifiable armed state fails closed and exposes only a bounded recovery reason.

Terminal evidence is signed with Ed25519 over the UTF-8 bytes of the following JSON object with this exact property order:

```json
{
  "schemaVersion": "rateloop.stop-gate-terminal.v1",
  "gateId": "...",
  "sessionId": "...",
  "opportunityId": "...",
  "terminalStatus": "completed",
  "outputCommitment": "sha256:...",
  "policyBindingHash": "sha256:...",
  "issuedAt": "..."
}
```

The hook consumes only the Stop event's stable session and turn identifiers plus this local state contract. It deliberately ignores `transcript_path`, never parses conversation history, never reads source or suggestion artifacts, makes no network calls, and cannot publish, assign reviewers, reserve funds, or spend.

This state contract is designed so a future verified host adapter can consume the same signed evidence while owning the actual output boundary. This plugin hook remains advisory because project and plugin trust do not establish that boundary.

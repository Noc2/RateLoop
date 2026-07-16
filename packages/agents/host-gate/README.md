# RateLoop host-owned output gate

This directory contains a standalone output-boundary module and CLI. It is the
enforcement counterpart to the Codex `Stop` hook spike: the hook is advisory,
can be disabled by its host, and never makes a release decision. A deployment
may claim enforcement only when this gate is the sole path by which candidate
bytes become visible to the downstream consumer.

## Trust boundary

The host keeps candidate output outside the consumer-visible directory, creates
a one-use release request, and sends the request to an authenticated RateLoop
evidence issuer. RateLoop signs only state it knows:

- the workspace, integration, and review opportunity;
- the frozen output, policy, and review-scope commitments;
- whether review was satisfied or selection was skipped; and
- a commitment supplied by the host.

The committed host binding contains the host, local session and turn, gate,
opportunity, decision, candidate commitment, frozen policy and scope, a random
nonce, and the release expiry. The signature therefore cannot be moved to a
different turn or candidate, while the evidence does not pretend that RateLoop
independently discovered local Codex identifiers.

Only server-signed `satisfied` evidence for a `completed` or `inconclusive`
review, or `skipped` evidence for a signed `skipped` selection, can release
bytes. An `inconclusive` lifecycle does not authorize release by itself: the
server must explicitly sign `decision: satisfied` after applying the frozen
workspace policy. Pending, approval, failed, cancelled, malformed, expired,
mismatched, or unsigned state fails closed. Expiry never turns a refusal into
permission.

## Host flow

1. Capture the candidate in an owner-only host-private file outside every
   agent-writable workspace. Do not render or stream it to the user or any other
   consumer. The CLI refuses group/world-accessible control files and paths
   inside its current agent workspace.
2. Prepare an exact release request:

   ```sh
   node packages/agents/host-gate/rateloop-host-output-gate-cli.mjs prepare \
     --candidate /host-private/candidate.bin \
     --request /host-private/release-request.json \
     --host-id host_production_01 \
     --session-id session_01 --turn-id turn_01 --gate-id gate_0001 \
     --workspace-id workspace_01 --integration-id integration_01 \
     --opportunity-id opportunity_01 --decision satisfied \
     --policy-binding-hash sha256:... --scope-commitment sha256:...
   ```

3. Submit the request through the host's authenticated RateLoop channel. The
   production issuer must independently resolve the opportunity and exact
   frozen commitments before signing. Merely echo-signing caller fields is not
   sufficient.
4. Separately provision an owner-only (`0700`) durable state root and the
   RateLoop Ed25519 public-key keyring outside agent-controlled workspace files,
   then materialize the release. The CLI refuses a missing, group/world-writable,
   wrong-owner, symlinked, or current-workspace state root:

   ```sh
   node packages/agents/host-gate/rateloop-host-output-gate-cli.mjs release \
     --candidate /host-private/candidate.bin \
     --request /host-private/release-request.json \
     --evidence /host-private/server-evidence.json \
     --trusted-keys /host-config/rateloop-evidence-keys.json \
     --state-dir /host-state/rateloop-output-gate
   ```

The command prints paths and commitments only. Authorized bytes appear
atomically as `releases/<releaseId>/output.bin` with a receipt beside them.
`releaseId` is the replay key: an exact retry returns the existing release,
while any conflicting reuse fails closed. The state directory must be durable,
separately provisioned, host-owned, and shared by every process serving the same
output boundary. The agent process should run under a different OS identity or
inside a sandbox that cannot reach this root. A directory created inside the
agent workspace is not a trust boundary even when its Unix mode happens to be
`0700`.

The module exports `buildHostReleaseRequest`, `verifyHostOutputRelease`, and
`materializeAuthorizedOutput` for hosts that embed the same contract directly.
The evidence issuer is intentionally separate; until a deployed RateLoop server
issues this exact evidence schema, this component must not be represented as an
end-to-end production gate.

`outputCommitment` is `sha256:` plus the lowercase SHA-256 digest of the exact
raw candidate bytes. The evidence issuer must compare it with the exact bytes
frozen for the review opportunity; a commitment to a summary, mutable object,
or separately serialized approximation is not equivalent.

## Signed bytes

The Ed25519 signature covers the UTF-8 JSON serialization of the payload fields
in the exact order defined by `serverReleaseEvidencePayload`. Unknown fields are
rejected. Public keys use the existing
`rateloop.stop-gate-trusted-keys.v1` keyring contract.

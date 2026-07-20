# Agent-host smoke harness (scaffold)

Phase 5 of [the agent-install plan](../../docs/tokenless-agent-install-plan-2026-07.md) makes the
[compatibility review's acceptance criteria](../../docs/tokenless-mcp-cross-client-compatibility-review-2026-07.md)
the only way a host's support tier improves. This directory is the harness scaffold and the CI-runnable
claims-discipline gate around it.

## What this scaffold is — and is not

**This scaffold does not itself verify any host.** Every step in every spec is `"automated": false`:
the real smoke runs require live, exact-version installs of the pinned clients (Codex desktop, Claude
Code, VS Code / Copilot Chat, Gemini CLI), a disposable workspace, and an operator following the spec.
No host may be labeled **Verified** anywhere in the product until a real green run is recorded here —
the same claims discipline the repo already enforces for public capability claims. Running `run.mjs`
successfully proves only that the specs and recorded evidence are well-formed and that nobody has
claimed a tier without evidence.

```sh
node scripts/agent-host-smoke/run.mjs
```

The runner prints a per-host checklist and exits non-zero when:

- a spec is malformed, misses a required step, or claims automation that does not exist;
- a recorded run artifact is malformed (a broken evidence file is worse than none);
- any host is claimed `verified` — in its spec, or (advisory textual cross-check) in the
  host-capability registry — without a recorded green run artifact.

## Per-host specs (`specs/`)

One JSON spec per host (`specs/<hostId>.json`), with the fixed step sequence from the plan:

```text
install -> auth -> lifecycle -> rateloop_get_agent_context -> rateloop_verify_connection -> resume-after-new-task
```

Each step carries `automated: false` plus operator instructions distilled from the compatibility
review's acceptance criteria (single-session lifecycle, idempotent claim/verify, no credential in the
transcript, resume without re-asking for the link). `pinnedClientVersion` stays `null` in the spec;
the exact version exercised is recorded per run in the artifact, because a green run is only meaningful
at the version it actually ran against.

Run order (from the plan): Codex desktop and Claude Code first (bundled paths), then VS Code /
Copilot Chat and Gemini CLI, ordered thereafter by Phase 2 connection-funnel telemetry.

## Recording a run (`results/`)

Green-run artifacts are **committed to the repository as evidence** — they are the tier gate's audit
trail, so they are deliberately not gitignored. Convention:

```text
results/<hostId>/<YYYY-MM-DD>-<clientVersion>.json
```

Artifact shape (`rateloop.host-smoke-run.v1`):

```json
{
  "schemaVersion": "rateloop.host-smoke-run.v1",
  "hostId": "codex-desktop",
  "clientVersion": "<exact pinned client version>",
  "recordedAt": "2026-08-01T12:00:00Z",
  "operator": "<who performed the run>",
  "evidenceRef": "<CI run URL, recording, or log location>",
  "overall": "green",
  "steps": [{ "id": "install", "status": "pass", "notes": "..." }]
}
```

`overall: "green"` requires every required step to record `status: "pass"`. Artifacts must never
contain access tokens, refresh tokens, connection URLs/fragments, authorization URLs, prompts, or
outputs — evidence references point to where the sanitized record lives. A failed run may be recorded
with `overall: "red"` for history; only green runs count toward graduation.

## How a host graduates tiers

The support-tier registry is `packages/nextjs/lib/tokenless/hostCapabilities.ts` (created in a
parallel commit; referenced here by path on purpose — this harness never imports it, and the
registry's own tests are the authoritative gate).

1. **Experimental / Supported** — the registry's honest default; nothing in this directory changes it.
2. **Verified** — reachable **only** through this harness: a green run at a pinned client version,
   recorded under `results/<hostId>/`, referenced from the registry entry as its evidence ref together
   with `verifiedAt`. The picker, docs pages, and message variants then update from the registry
   automatically. A registry entry marked `verified` without a green artifact here is a claims bug;
   `run.mjs` fails on the cases it can detect, and the registry tests must enforce the rest.
3. **Staying verified** — a verified claim is version-pinned. A new client release or a change to the
   connection flow requires a fresh green run; until one is recorded, the honest state is the previous
   pinned version, not an implied evergreen claim.

## Relationship to the CI schema-adapter gate

The other CI-runnable part of Phase 5 lives at
`packages/nextjs/lib/mcp/schemaAdapterCompatibility.test.ts`: every workspace MCP tool schema is
compiled through conservative emulations of the OpenAI strict and Gemini CLI schema adapters, with
today's known constraint drops pinned as an exact-match baseline (notably `rateloop_request_review`
losing its `material` oneOf arms under Gemini sanitization). Live runs recorded here are the
end-to-end confirmation that those documented gaps do not break the real host; the CI gate is what
blocks new gaps from shipping between runs.

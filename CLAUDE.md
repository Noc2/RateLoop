# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, tokenless implementation boundaries, redeploy policy, cleanup order,
image handoff, and trust-model guidance.

On the `tokenless` branch, read
[`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md)
before changing contracts, deployment artifacts, Ponder, Keeper, the app, SDK,
agents, MCP, E2E, or public docs. Current Base contracts are legacy and are not
final; prefer a fresh greenfield deployment and removal of obsolete consumers
over compatibility work unless the user explicitly requests a legacy exit task.

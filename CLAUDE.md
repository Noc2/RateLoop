# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, tokenless implementation boundaries, redeploy policy, cleanup order,
image handoff, and trust-model guidance.

On the `tokenless` branch, read
[`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md)
before changing contracts, deployment artifacts, Ponder, Keeper, the app, SDK,
agents, MCP, E2E, or public docs. Base mainnet contracts are legacy and are not
final. The active test deployment is the versioned Base Sepolia artifact under
`packages/foundry/deployments/tokenless-v1/`; it may be redeployed until a
real-money hardening review. Prefer removal of obsolete consumers over any
compatibility work. Hosted tokenless work must stay in the isolated
`rateloop-tokenless` Vercel and Railway projects and must never use
`rateloop.ai`.

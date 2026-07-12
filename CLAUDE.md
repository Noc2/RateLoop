# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, tokenless implementation boundaries, redeploy policy, cleanup order,
image handoff, and trust-model guidance.

On the `tokenless` branch, read
[`docs/tokenless-immutable-implementation-plan-2026-07.md`](docs/tokenless-immutable-implementation-plan-2026-07.md)
before changing contracts, deployment artifacts, Ponder, Keeper, the app, SDK,
agents, MCP, E2E, or public docs. Base mainnet contracts are legacy and are not
final. The versioned Base Sepolia artifact under
`packages/foundry/deployments/tokenless-v1/` is stale after the current fund-core
changes and must be freshly redeployed before live configuration. Prefer removal of obsolete consumers over any
compatibility work. Hosted tokenless work must stay in the isolated
`rateloop-tokenless` Vercel and Railway projects and must never use
`rateloop.ai`.

Keep the established RateLoop website design unchanged while removing obsolete
features. Base Account is the active browser wallet/authentication stack; do not
restore thirdweb. Treat the current checked-in deployment artifact as stale
after fund-core changes until a fresh complete Base Sepolia deployment key is
installed across the isolated app, Ponder, keeper, and database.

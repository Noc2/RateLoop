# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, product design and UX, tokenless implementation boundaries, redeploy
policy, cleanup order, image handoff, and trust-model guidance.

## Non-negotiable tokenless isolation

While working on `tokenless`, a request to push, publish, or deploy means the
`tokenless` branch and isolated tokenless services only. It does not authorize
any change to `main`, the `rate-loop-nextjs` Vercel project, `rateloop.ai`, or
`www.rateloop.ai`.

Before pushing, verify that the current branch is `tokenless`, its upstream is
`origin/tokenless`, and record the remote SHAs for both `main` and `tokenless`.
Use only `git push origin HEAD:tokenless`, then verify that the remote `main` SHA
did not change. Never push tokenless `HEAD` to `main`, push both branches in one
command, or merge/rebase/cherry-pick/reset/force-update `main` without an
explicit user request to integrate tokenless into `main` plus separate
confirmation that changing the production `rateloop.ai` application is
intended. Generic instructions such as "push everything" or "publish finished
work" are not that confirmation.

Before any Vercel mutation, require the active project linkage to be
`rateloop-tokenless` (`prj_H6C2pfWKEAupFroHbLfzhquaNCLm`). Tokenless deployment,
promotion, rollback, alias, and environment commands must target only that
project and `https://rateloop-tokenless.vercel.app/rate`. Abort rather than
touching `rate-loop-nextjs`, `rateloop.ai`, or `www.rateloop.ai`. Before and
after publishing, verify that the remote `main` SHA and the deployment ID serving
`rateloop.ai` are unchanged.

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
features. Better Auth is the browser authentication stack. Wallets remain optional,
purpose-bound adapters: preserve existing self-custodial wallet proofs and the
optional thirdweb-created app wallet after an authenticated user explicitly requests
funding, payout, or recovery. Never mount a thirdweb browser connector or treat a
wallet as identity or authorization. Treat the current checked-in deployment artifact as stale
after fund-core changes until a fresh complete Base Sepolia deployment key is
installed across the isolated app, Ponder, keeper, and database.

# Claude Workflow Notes

Claude should use [`AGENTS.md`](AGENTS.md) as the source of truth for repository
workflow, product design and UX, tokenless implementation boundaries, redeploy
policy, cleanup order, image handoff, and trust-model guidance.

For every UI change, treat an active navigation tab or route label as the page
heading when it already names the destination. Do not repeat it with a separate
heading or nearby explanatory sentence that says the same thing in slightly
different words. Retain visible text only when it adds information needed to
decide, act, understand essential state, recover, or satisfy a real safety or
legal requirement.

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
final. `packages/foundry/deployments/tokenless-v4/84532.json` records the current
released test deployment at block `45115708`; every live component must match its
complete deployment key. `tokenless-v1` through `tokenless-v3` are
historical evidence only. Prefer removal of
obsolete consumers over any
compatibility work. Hosted tokenless work must stay in the isolated
`rateloop-tokenless` Vercel and Railway projects and must never use
`rateloop.ai`.

Keep the established RateLoop website design unchanged while removing obsolete
features. Better Auth is the browser authentication stack. Wallets remain optional,
purpose-bound adapters: preserve existing self-custodial wallet proofs and the
optional thirdweb-created app wallet after an authenticated user explicitly requests
funding, payout, or recovery. **Never treat a wallet as identity or authorization**
— that is the rule, and it is absolute.

A thirdweb browser connector is permitted only as the mechanism for that binding,
and only within all four of these limits. It must not be mounted in the
application shell (`providers/AppProviders.tsx`), which
[`config/browserAuthIsolation.test.ts`](packages/nextjs/config/browserAuthIsolation.test.ts)
enforces; it may be mounted only inside a component already behind a Better Auth
session; the binding must carry an existing `principalId` as an input, so the
wallet attaches to an identity and can never establish one; and the purpose must
be exactly `funding`, `payout`, or `recovery`. `lib/auth/walletBindings.ts` is
the enforcement point for the last two.

`WalletBindingsClient.tsx` and the three Feedback-Bonus and settlement surfaces
that render `ConnectButton` satisfy every limit and are **not** to be removed on
the strength of a shorter reading of this rule. Because they ship,
`https://*.thirdweb.com` and `https://*.walletconnect.*` are load-bearing in the
Content-Security-Policy; prune them only together with the connector itself.

After any fund-core change, treat the
checked-in deployment artifact as stale until a fresh complete Base Sepolia
deployment key is installed across the isolated app, Ponder, keeper, and
database.

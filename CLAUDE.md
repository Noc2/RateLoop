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

## How a tokenless deployment actually happens

Learned the hard way on 8 August 2026, including one mistake that reached the
legacy project. Read this before attempting to deploy.

**Both Vercel projects are connected to the same GitHub repository, and the legacy
`rate-loop-nextjs` project watches every branch — including `tokenless`.** That is
the entire reason `packages/nextjs/vercel.json` sets:

```json
"git": { "deploymentEnabled": { "tokenless": false } }
```

**That flag does not disable tokenless deployments. It stops the legacy project
from building tokenless pushes.** Flipping it to `true` makes a push to
`tokenless` trigger a build in `rate-loop-nextjs`, which is precisely the
isolation breach the rules above forbid. It happened: commit `1746c5d53` produced
`dpl_DLKJhXXizNXxHEk6BKv3W8uMwyMW` in the legacy project. It was a preview build
(`target: null`) that failed its gate, so `rateloop.ai` never moved — but the
build should never have started. Reverted in `c2d5e0730`. **Never set that flag to
`true`.**

**A push therefore never deploys tokenless.** Deployment is a deliberate,
manual act.

**The mechanism that works** is the Vercel CLI, run from a checkout whose current
branch is literally `tokenless`:

```bash
cd packages/nextjs   # the CLI lives here: nmHoistingLimits is `workspaces`
./node_modules/.bin/vercel whoami        # expect noc2-6281
cd ../..             # deploy from the repo root: rootDirectory is packages/nextjs
./packages/nextjs/node_modules/.bin/vercel deploy --prod --yes
```

Three traps, each of which cost an attempt:

- **The CLI is not at the repo root.** `nmHoistingLimits: workspaces` puts it in
  `packages/nextjs/node_modules/.bin/vercel`. Concluding "no CLI is installed"
  from the root alone is wrong.
- **Deploy from the repo root, not `packages/nextjs`.** The project's
  `rootDirectory` is already `packages/nextjs`, so running from there makes Vercel
  look for `packages/nextjs/packages/nextjs` and fail immediately.
- **The build reads `VERCEL_GIT_COMMIT_REF` and requires exactly `tokenless`**
  plus a 40-character lowercase SHA
  ([`check-tokenless-production-readiness.mjs:514`](packages/nextjs/scripts/check-tokenless-production-readiness.mjs)).
  The CLI infers those from the **local git branch**, so deploying from an agent
  worktree on a branch such as `plan-impl-2026-08-07` is refused. `--meta
  githubCommitRef=tokenless` does **not** help: deployment metadata does not
  populate the build environment. Verified — it still failed.

**A worktree-isolated session cannot deploy.** Its branch is not `tokenless` and
the isolation guard blocks operating on the shared checkout, so hand the deploy to
a session working directly on `tokenless`, or ask the user.

**The build does the migration and the gating for you**, in this order:

```
check-identity-deployment → check-tokenless-production-readiness → migrate-hosted-database → next build
```

So a hosted schema change needs no separate step — deploying applies it. And a
failing gate is safe: the deployment ends `ERROR` and the previous one keeps
serving. Attempting a deploy is therefore low risk; what is *not* low risk is
changing the git flag to force one.

**`DATABASE_URL` cannot be read.** It is marked Sensitive, so `vercel env pull`
returns it blank (72 of 105 variables are), and the Railway connector is an OAuth
app that returns names only. Do not plan around inspecting it — the readiness gate
checks what matters at build time, including that `sslmode=verify-full` is set and
`uselibpqcompat=true` is absent.

**Record before and after every attempt:** the deployment ID serving
`rateloop.ai` (compare `latestDeployment` only among `target: "production"`
entries — a `target: null` row is a preview and does not serve the domain), the
`origin/main` SHA, and the tokenless deployment ID.

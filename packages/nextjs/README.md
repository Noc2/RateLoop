# RateLoop tokenless app

This package is the isolated tokenless web experience and versioned agent API. It intentionally contains no legacy
LREP, governance, staking, oracle, frontend-bond, profile, leaderboard, manual-claim, MCP, or sponsored-transaction
surfaces.

## Local start

```bash
cp packages/nextjs/.env.example packages/nextjs/.env.local
yarn workspace @rateloop/nextjs db:push
yarn workspace @rateloop/nextjs dev
```

The default example enables the explicit sandbox. Sandbox responses are simulations and are visibly labeled. Set
`TOKENLESS_SANDBOX_MODE=false` only after provisioning a dedicated Postgres database and applying
`drizzle/0000_tokenless_agent_api.sql`; live mode fails closed when persistence is unavailable and does not fabricate
settlement results.

## API

- `POST /api/agent/v1/quote`
- `POST /api/agent/v1/asks` with matching `Idempotency-Key` header and body field
- `GET /api/agent/v1/asks/:operationKey/wait`
- `GET /api/agent/v1/results/:operationKey`

The shared schema and client come from `@rateloop/sdk`. Quote economics always itemize the bounty, platform fee,
maximum attempt reserve, total authorized funding, refunds, and accepted-work compensation.

## Deployment

Use a separate Vercel project/domain and a separate Postgres database for this branch. Do not attach the existing
RateLoop production domain or database. The current Base Sepolia contracts and all branch services remain disposable
until Phase 5 hardening.

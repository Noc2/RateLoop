# RateLoop app

This package is the isolated RateLoop web experience and versioned agent API.

## Local start

```bash
cp packages/nextjs/.env.example packages/nextjs/.env.local
yarn workspace @rateloop/nextjs db:push
yarn workspace @rateloop/nextjs dev
```

The default example enables the explicit sandbox. Sandbox responses are simulations and are visibly labeled. Set
`TOKENLESS_SANDBOX_MODE=false` only after provisioning a dedicated Postgres database and applying every migration in
`drizzle/meta/_journal.json`; live mode fails closed when persistence is unavailable and does not fabricate settlement
results.

## Browser authentication

The tokenless browser uses thirdweb in-app wallets for email OTP, Google, Apple, and passkey onboarding. Base Account is
also offered as an external wallet, but it is not required for workspace access. Every method signs a domain-bound login
payload; RateLoop verifies it server-side and creates its own opaque, hashed, HttpOnly session. The thirdweb browser token
and client-reported profiles are never workspace authorization.

Configure `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN`, and the server-only
`THIRDWEB_SECRET_KEY`. Apply migration `0016_thirdweb_enterprise_auth.sql`, then run
`yarn workspace @rateloop/nextjs auth:check` before a hosted rollout.

## API

- `POST /api/mcp` for the stateless, four-tool Streamable HTTP handoff adapter
- `POST /api/agent/v1/quote`
- `POST /api/agent/v1/asks` with matching `Idempotency-Key` header and body field
- `GET /api/agent/v1/asks/:operationKey/wait`
- `GET /api/agent/v1/results/:operationKey`
- `GET|POST /api/agent/v1/assurance/projects`
- `GET /api/agent/v1/assurance/projects/:projectId`
- `GET /api/agent/v1/assurance/runs/:runId`

The public MCP exposes only capabilities, browser-handoff creation, handoff status, and result retrieval. It does not
expose payments, wallet calls, private artifact upload, or the retired token/governance/rating protocol. Approved draft
content is returned in the `/handoff` URL fragment and is not persisted by the MCP. The browser stores the reviewed
question and panel terms when the user requests an exact quote; ask submission remains a separate explicit action.
Treat the complete handoff URL as a bearer capability.

The shared schema and client come from `@rateloop/sdk`. Quote economics always itemize the bounty, platform fee,
maximum attempt reserve, total authorized funding, refunds, and accepted-work compensation.

## Deployment

Use a separate Vercel project/domain and a separate Postgres database for this branch. Do not attach the existing
RateLoop production domain or database. The current Base Sepolia contracts and all branch services remain disposable
until Phase 5 hardening.

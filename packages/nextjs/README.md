# RateLoop app

This package contains the isolated RateLoop browser product and versioned agent API.

## Local start

```bash
cp packages/nextjs/.env.example packages/nextjs/.env.local
yarn workspace @rateloop/nextjs db:push
yarn workspace @rateloop/nextjs dev
```

Use a dedicated Postgres database and apply every migration in `drizzle/meta/_journal.json`. The application fails
closed when persistence, chain configuration, or required production capabilities are unavailable; it never fabricates
review, payment, or settlement results.

## Browser authentication

Better Auth is the primary browser-authentication layer. Email OTP and passkeys are the initial methods; Google and
Apple appear only when their complete server-only credential pairs are configured. After Better Auth verifies a login,
RateLoop resolves an opaque `principal_id` and issues its own random, hashed, HttpOnly application session. Provider
subjects, email addresses, and wallet addresses are identity bindings, not workspace authorization keys.

An authenticated user needs no wallet for workspace access, invited review, or API-key agent use. When a funding,
payout, or recovery flow needs an onchain destination, the user explicitly chooses an existing self-custodial wallet
or an app-scoped thirdweb wallet. RateLoop verifies a domain-, chain-, principal-, purpose-, nonce-, and expiry-bound
signature and stores a revocable binding for exactly `funding`, `payout`, or `recovery`.

Configure `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, and at least one sign-in delivery path. Email OTP
additionally requires the Resend variables; Google and Apple each require both provider credentials. thirdweb remains
disabled unless its public client ID, one-time JWT audience/key, and server-side signing key are configured. Keep every
secret and private JWK server-only.

## Private artifacts and evidence

Private artifacts are encrypted before storage and access is constrained by workspace membership, explicit project
assignment, and short reviewer leases. Workspaces and projects carry a home region, data classification, permitted-use,
retention, and legal-hold policy. Structured subject requests and integrity-chained, tenant-exportable application audit
records support operations without exposing private content in the public settlement record.

Operational procedures are in the
[`privacy operations runbook`](../../docs/tokenless-privacy-operations-runbook-2026-07.md), and the release resource
checks are in the [`EU deployment runbook`](../../docs/tokenless-eu-deployment-runbook.md).

## API

- `POST /api/mcp` for the stateless four-tool Streamable HTTP handoff adapter
- `POST /api/agent/v1/quote`
- `POST /api/agent/v1/asks` with matching `Idempotency-Key` header and body field
- `GET /api/agent/v1/asks/:operationKey/wait`
- `GET /api/agent/v1/results/:operationKey`
- `GET|POST /api/agent/v1/assurance/projects`
- `GET /api/agent/v1/assurance/projects/:projectId`
- `GET /api/agent/v1/assurance/runs/:runId`

The public MCP exposes capabilities, browser-handoff creation, handoff status, and result retrieval. Approved draft
content is returned in the `/handoff` URL fragment and is not persisted by the MCP. The browser stores the reviewed
question and panel terms when the user requests an exact quote; ask submission remains a separate explicit action.
Treat the complete handoff URL as a bearer capability.

The shared schema and client come from `@rateloop/sdk`. Quote economics itemize the bounty, platform fee, maximum
attempt reserve, total authorized funding, refunds, and accepted-work compensation.

## Deployment

Use the isolated Vercel project, Postgres database, Ponder service, and keeper service for this branch. A hosted release
must pass the production-readiness check with a complete deployment identity, regional resource manifest, managed
signing roles, private storage, database migrations, and operational evidence. Region pins alone are not sufficient.

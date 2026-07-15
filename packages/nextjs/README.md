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

Better Auth is the primary browser-authentication layer. Email OTP and passkeys are the initial methods; Google and
Apple appear only when their complete server-only credential pairs are configured. After Better Auth verifies the
login, RateLoop resolves an opaque `principal_id` and issues its own random, hashed, HttpOnly application session.
Provider subjects, email addresses, and wallet addresses are identity bindings, not workspace authorization keys.

An authenticated user needs no wallet for enterprise workspace access, invited unpaid review, or API-key agent use.
When a funding, payout, or recovery flow needs an onchain destination, the user explicitly chooses either an existing
self-custodial wallet or an app-scoped thirdweb wallet. RateLoop then verifies a domain-, chain-, principal-, purpose-,
nonce-, and expiry-bound wallet signature and stores a revocable binding for exactly `funding`, `payout`, or `recovery`.
Creating or binding a wallet never grants general account access.

Configure `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, and at least one available sign-in delivery path.
Email OTP additionally requires the Resend variables; Google and Apple each require both Better Auth provider
credentials. thirdweb remains disabled unless `TOKENLESS_THIRDWEB_WALLET_ENABLED=true` and its public client ID,
one-time JWT audience/key, and server-side signing key are configured. Keep every secret and private JWK server-only.
Apply every migration in `drizzle/meta/_journal.json` before enabling non-sandbox mode.

## Privacy and trust controls

Private artifacts are encrypted before storage and access is constrained by workspace membership, explicit project
assignment, and short reviewer leases where applicable. Workspaces and projects carry an EU home region, data
classification, permitted-use, retention, and legal-hold policy. The application also supports structured subject
requests and integrity-chained, tenant-exportable audit records. The audit chain is not an immutable or WORM log.

The checked EU manifest and regional configuration make non-sandbox deployment fail closed unless the proposed resource
bundle is complete and approved. They do not prove that the current sandbox is EU-hosted. Do not claim EU residency,
contractual no-training, SOC 2, blanket GDPR compliance, HIPAA via BAA, customer VPC, SAML/SCIM, penetration testing, or
certification from these controls. Use the trust-claim registry and `/trust` page for current public wording.
Operational intake, legal-hold, deletion-evidence, audit-integrity, and trust-claim withdrawal procedures are in the
[privacy operations runbook](../../docs/tokenless-privacy-operations-runbook-2026-07.md).

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

For a non-sandbox release, follow the
[EU deployment runbook](../../docs/tokenless-eu-deployment-runbook.md): provision new EU Postgres, private object
storage, managed KMS, workers, logs, and backups; attach processor evidence; sign the canonical manifest; and verify the
live runtime identities. Region pins alone do not activate an EU-hosting claim.

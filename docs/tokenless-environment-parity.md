# Tokenless environment parity

**Status:** Current deployment-identity and hosted-environment contract.

Every live tokenless component is isolated from the legacy RateLoop deployment.

## Chain and deployment identity

- Network: Base Sepolia
- Chain ID: `84532`
- RPC variables: each package has one primary plus one to three ordered, independent fallbacks:
  `BASE_SEPOLIA_RPC_URL` + `BASE_SEPOLIA_RPC_FALLBACK_URLS`, `PONDER_RPC_URL_84532` +
  `PONDER_RPC_FALLBACK_URLS_84532`, or `RPC_URL` + `RPC_FALLBACK_URLS`
- Deployment schema target: `rateloop-tokenless-deployment-v4`
- Deployment key target: `tokenless-v4:<chainId>:<panel>:<issuer>:<adapter-or-zero>:<feedback-bonus>`
- Current v4 release status: `unreleased`; fresh deployment required
- Historical stale Base Sepolia deployment block: `44390557`
- Historical stale Base Sepolia deployment key:
  `tokenless-v4:84532:0x377f8631030a06e997cee78bdf649106a90bba46:0xe7f214be85002a6776874e6b624f7cfee98b89d9:0xa33f747ca2e83b12cb67ca407aa4999bf7e68dcc:0xa0c1f730aad6b7cb78eaeaca39743f6430dc57b0`

The active v4 registry is empty. The checked-in v4 artifact records an older runtime-evidenced bundle but is incomplete
for the current fund core and must not configure a service. A fresh deployment must bind the experimental in-repo
`QuicknetTBeaconVerifier`, TokenlessPanel, CredentialIssuer, x402 adapter, and TokenlessFeedbackBonus. The deployment
script always deploys that exact verifier; it does not accept a verifier address from the
environment. Deployment export compares its observed runtime code hash with the compiled artifact and fails closed on
any difference. Hosted app, Ponder, and keeper configuration consume the resulting pinned address as
`TOKENLESS_BEACON_VERIFIER_ADDRESS` or their package-prefixed equivalent. The verifier remains unaudited, and this
deployment binding does not remove the independent-review release gate.
Historical v1-v4 artifacts, including the
v3 test bundle deployed at block `44132668`, must not be relabelled or used by a v4 app, Ponder, or keeper process.

The isolated Vercel app, Ponder, and keeper must all be pinned to the same complete key and deployment block before any
service is promoted. This remains a test-profile bundle, not a production
release target. Staging must use the same persisted assignment, payment, settlement, and result machinery as production.
Hosted startup must fail closed until the signed resource/provider bundle, platform-secret signer roles, workers, and paid
end-to-end path are verified.

Services must fail closed if their chain, addresses, start block, or deployment key disagree. Do not fall back to Base mainnet, an unversioned deployment JSON, or the former production services.

## Hosted isolation

- Web project: `rateloop-tokenless` on a Vercel-provided domain; never alias this branch to `rateloop.ai`.
- Service project: `rateloop-tokenless` on Railway, with its own Postgres, Ponder, and keeper services.
- Ponder database schema is derived from the complete tokenless deployment identity.
- The keeper uses a dedicated gas-only secp256k1 key in Railway's server-only secret store.
- The credential issuer uses a different key in Vercel's server-only secret store. Every EVM role pins its derived
  address and stable key version. Never expose signer configuration through a `NEXT_PUBLIC_` variable.
- RateLoop has no AWS, KMS, IAM, or AWS OIDC dependency. Platform-readable secrets are a deliberate, weaker custody
  boundary than non-exportable HSM keys and therefore require low balances, narrow allowances, explicit spend
  ceilings, rapid rotation and recovery runbooks, and append-only signing audit records.

## EU processing-region contract

Application functions are configured for Vercel `fra1`; Ponder, keeper, and primary Postgres workloads are configured
for Railway `europe-west4-drams3a`. This is an EU **processing-region** statement, not an EU-residency attestation.
Vercel and Railway control-plane or account data, provider-managed or globally replicated backups, and approved
external processors may be processed outside the EU. Relevant transfers rely on standard contractual clauses.

Every hosted startup is refused unless the signed manifest identifies the configured primary stores, private Blob,
Vercel/Railway platform-secret inventory, logs, backup policy, auth, workers, and approved external processors. The
validator checks declared configuration and its signature; it does not query providers or establish the actual
location of provider control planes, subprocessors, or backups. Region settings alone are not release evidence.

## Required production variables

Next.js:

- `APP_URL`, `NEXT_PUBLIC_APP_URL`
- the complete signed EU manifest variables from `packages/nextjs/.env.example`; hosted releases have no simulation
  bypass
- server-only `BETTER_AUTH_SECRET`; the hosted target also requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email OTP
- `TOKENLESS_EMAIL_DELIVERY_REGION=eu-west-1` plus approved processor/transfer evidence; Resend's account metadata and
  logs remain in the US even when mail is dispatched from Ireland
- optional Better Auth Google/Apple credential pairs and `BETTER_AUTH_PASSKEY_RP_ID`
- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` for self-custodial funding and payout connections, independently of managed issuance;
  `TOKENLESS_THIRDWEB_WALLET_ENABLED=false` is mandatory until verifiable export and recovery are implemented
- `DATABASE_URL`
- `NEXT_PUBLIC_TARGET_NETWORKS=84532`
- server-side `BASE_SEPOLIA_RPC_URL` plus one to three ordered, independent HTTPS URLs in
  `BASE_SEPOLIA_RPC_FALLBACK_URLS`; the public browser RPC remains separate
- distinct `TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY`, `_EXPECTED_ADDRESS`, and `_KEY_VERSION` values
- `TOKENLESS_DEPLOYMENT_SCHEMA`, `TOKENLESS_CHAIN_ID`, `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`,
  `TOKENLESS_BEACON_VERIFIER_ADDRESS`,
  `TOKENLESS_FEEDBACK_BONUS_ADDRESS`, `TOKENLESS_USDC_ADDRESS`
- `TOKENLESS_FEE_RECIPIENT`, round timing variables (`TOKENLESS_REVEAL_WINDOW_SECONDS` is at least 300), and optional
  `NEXT_PUBLIC_BASE_PAYMASTER_URL`
- distinct `TOKENLESS_X402_RELAYER_*`, `TOKENLESS_PREPAID_FUNDER_*`, and
  `TOKENLESS_SURPRISE_BONUS_FUNDER_*` private-key, expected-address, and key-version bundles
- versioned artifact wrapping and Ed25519 evidence-signing keys; approved rotation, recovery, and signer spend-limit
  records; no AWS/KMS/IAM/OIDC configuration
- eligibility provider ID/public key/start URL/handoff secret, versioned vault keys, and DAC7 policy
- `TOKENLESS_PIPELINE_TOKEN`, `CRON_SECRET`, `TOKENLESS_COMPLIANCE_OPERATOR_SECRET`,
  `TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION`,
  `TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET`,
  `TOKENLESS_WEBHOOK_ENCRYPTION_KEY`; use a distinct server-only secret of at least 32 random characters for signed
  email unsubscribe links, and a separate operator credential for sanctions, appeals, and verified workspace refunds
  (the non-secret operator key-version label changes whenever that bearer credential rotates)
- `TOKENLESS_MCP_RATE_LIMIT_SECRET` with at least 32 random characters and no public variant
- dedicated `TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET` (32-byte base64url or hex), distinct from every signing,
  encryption, rate-limit, and session key, server-only, with no `NEXT_PUBLIC_` variant
- explicit `TOKENLESS_SUBSCRIPTIONS_ENABLED`; when true, server-only `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID`
- optional `TOKENLESS_DEMO_BOOKING_URL` for the public "Book demo" action. HTTPS only; an unset or unusable value
  keeps the enterprise mailto. The scheduler is linked, never embedded, so it needs no Content-Security-Policy
  entry. It is a public booking page whose provider collects the prospect's name and email under its own terms, so
  changing the provider means revisiting the privacy notice's demo-scheduling section.
- dedicated `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY` (32-byte base64url or hex) and
  `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION`, with no public key variant

Better Auth callback and passkey origins must allow only local development and `rateloop-tokenless.vercel.app`; never
add `rateloop.ai`. Managed thirdweb wallet creation is fail-closed in hosted environments.

Apply every migration recorded in `packages/nextjs/drizzle/meta/_journal.json` in order before smoke testing the
human-assurance APIs or enabling a hosted release. The last entry in `_journal.json` is always the authoritative head;
do not copy a journal tag into this document because it becomes stale when the next migration lands.
Isolated Vercel production builds apply and verify pending journal entries
before compiling; preview and local builds never mutate a database. The app must fail closed when moderation,
eligibility, deployment, signer, or pipeline configuration is incomplete.

Ponder:

- `PONDER_NETWORK=baseSepolia`, `PONDER_CHAIN_ID=84532`, `PONDER_RPC_URL_84532`, and one to three ordered,
  independent HTTPS URLs in `PONDER_RPC_FALLBACK_URLS_84532`
- `PONDER_TOKENLESS_PANEL_ADDRESS`, `PONDER_CREDENTIAL_ISSUER_ADDRESS`, `PONDER_X402_PANEL_SUBMITTER_ADDRESS`,
  `PONDER_BEACON_VERIFIER_ADDRESS`,
  `PONDER_FEEDBACK_BONUS_ADDRESS`
- `PONDER_TOKENLESS_START_BLOCK`, `RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY`
- `DATABASE_URL`, `CORS_ORIGIN`, `PONDER_KEEPER_WORK_TOKEN`

Keeper:

- `CHAIN_ID=84532`, `RPC_URL`, and one to three ordered, independent HTTPS URLs in `RPC_FALLBACK_URLS`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`,
  `TOKENLESS_FEEDBACK_BONUS_ADDRESS`, `TOKENLESS_BEACON_VERIFIER_ADDRESS`
- `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `TOKENLESS_KEEPER_PRIVATE_KEY`, `_EXPECTED_ADDRESS`, and `_KEY_VERSION`, plus `DATABASE_URL` for the append-only
  signing ledger and `METRICS_AUTH_TOKEN`
- the same keeper identity inventory in the web release environment. Every deployment path rejects a keeper or
  evidence key reused by another signing role. Address derivation and versioned rotation evidence are additionally
  verified on the `main` release path; the isolated tokenless path checks key reuse only.

The package-local `.env.example` files remain the executable source for exact names and validation rules.

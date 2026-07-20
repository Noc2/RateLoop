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
- Current v4 release status: `unreleased`
- Current v4 Base Sepolia deployment key and addresses: none

The checked-in v4 registry is intentionally empty until a separately reviewed, non-mock verifier with deployed bytecode,
TokenlessPanel, CredentialIssuer, the optional x402 adapter, and TokenlessFeedbackBonus are freshly deployed and verified
as one bundle. The deployment script consumes the verifier as `TOKENLESS_BEACON_VERIFIER`; hosted app, Ponder, and keeper
configuration consume the pinned address as `TOKENLESS_BEACON_VERIFIER_ADDRESS` or their package-prefixed equivalent.
Historical v1-v3 artifacts, including the
v3 test bundle deployed at block `44132668`, must not be relabelled or used by a v4 app, Ponder, or keeper process. There
is no canonical current v4 address to copy into a hosted environment.

After a fresh v4 Base Sepolia deployment, the isolated Vercel app, Ponder, and keeper must all be pinned to the same
complete key and deployment block before any service is promoted. This remains a test-profile bundle, not a production
release target. Staging must use the same persisted assignment, payment, settlement, and result machinery as production.
Hosted startup must fail closed until the signed resource/provider bundle, managed signer roles, workers, and paid
end-to-end path are verified.

Services must fail closed if their chain, addresses, start block, or deployment key disagree. Do not fall back to Base mainnet, an unversioned deployment JSON, or the former production services.

## Hosted isolation

- Web project: `rateloop-tokenless` on a Vercel-provided domain; never alias this branch to `rateloop.ai`.
- Service project: `rateloop-tokenless` on Railway, with its own Postgres, Ponder, and keeper services.
- Ponder database schema is derived from the complete tokenless deployment identity.
- The keeper uses a dedicated gas-only workload-identity AWS KMS role and secp256k1 key.
- The credential issuer uses a different workload-identity AWS KMS role, key, and expected account. Never expose signer
  configuration through a `NEXT_PUBLIC_` variable.

## EU-first deployment contract

The hosted production target has one immutable home region, `eu`. Application functions are pinned to Vercel
`fra1`; Ponder and keeper are pinned to Railway `europe-west4-drams3a`. The machine-readable resource inventory,
integrity digest, signature boundary, and exact readiness procedure are in
[`tokenless-eu-deployment-runbook.md`](tokenless-eu-deployment-runbook.md).

Every hosted startup is refused unless the signed manifest identifies matching EU Postgres, private Blob, KMS, logs,
backups, auth, support-access, worker, and approved external-processor evidence. Region settings alone are not release
evidence; the deployment must also pass the dated runtime and operational checks in the runbook.

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
- the distinct `TOKENLESS_CREDENTIAL_ISSUER_KMS_KEY_RESOURCE`, `_EXPECTED_ADDRESS`, `_REGION`, `_ROLE_ARN`, and
  `_OIDC_AUDIENCE` values
- `TOKENLESS_DEPLOYMENT_SCHEMA`, `TOKENLESS_CHAIN_ID`, `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`,
  `TOKENLESS_BEACON_VERIFIER_ADDRESS`,
  `TOKENLESS_FEEDBACK_BONUS_ADDRESS`, `TOKENLESS_USDC_ADDRESS`
- `TOKENLESS_FEE_RECIPIENT`, round timing variables, and optional `NEXT_PUBLIC_BASE_PAYMASTER_URL`
- distinct `TOKENLESS_X402_RELAYER_KMS_*`, `TOKENLESS_PREPAID_FUNDER_KMS_*`, and
  `TOKENLESS_SURPRISE_BONUS_FUNDER_KMS_*` resource, expected-address, region, role, and OIDC bundles
- eligibility provider ID/public key/start URL/handoff secret, versioned vault keys, and DAC7 policy
- `TOKENLESS_PIPELINE_TOKEN`, `CRON_SECRET`, `TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET`,
  `TOKENLESS_WEBHOOK_ENCRYPTION_KEY`; use a distinct server-only secret of at least 32 random characters for signed
  email unsubscribe links
- `TOKENLESS_MCP_RATE_LIMIT_SECRET` with at least 32 random characters and no public variant
- dedicated `TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET` (32-byte base64url or hex), distinct from every signing,
  encryption, rate-limit, and session key, server-only, with no `NEXT_PUBLIC_` variant
- explicit `TOKENLESS_SUBSCRIPTIONS_ENABLED`; when true, server-only `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID`
- dedicated `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY` (32-byte base64url or hex) and
  `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION`, with no public key variant

Better Auth callback and passkey origins must allow only local development and `rateloop-tokenless.vercel.app`; never
add `rateloop.ai`. Managed thirdweb wallet creation is fail-closed in hosted environments.

Apply every migration recorded in `packages/nextjs/drizzle/meta/_journal.json` in order before smoke testing the
human-assurance APIs or enabling a hosted release. At this revision the journal head is
`0121_paid_assignment_operations`; `_journal.json`, rather than a copied range in this document, remains
authoritative.
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
- `TOKENLESS_KEEPER_KMS_KEY_RESOURCE`, `_EXPECTED_ADDRESS`, `_REGION`, and `_ROLE_ARN`, plus
  `AWS_WEB_IDENTITY_TOKEN_FILE` and `METRICS_AUTH_TOKEN`; raw keys and keystores are local-test only
- the same non-secret keeper key, address, region, and IAM-role inventory in the web release environment, where the
  release preflight rejects reuse across every EVM signer, the evidence signer, the artifact vault, and the keeper

The package-local `.env.example` files remain the executable source for exact names and validation rules.

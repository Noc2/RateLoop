# Tokenless Environment Parity

Every live tokenless component is isolated from the legacy RateLoop deployment.

## Chain and deployment identity

- Network: Base Sepolia
- Chain ID: `84532`
- RPC variable: `BASE_SEPOLIA_RPC_URL`, `PONDER_RPC_URL_84532`, or `RPC_URL`, depending on the package
- Deployment schema: `rateloop-tokenless-deployment-v3`
- Deployment key: `tokenless-v3:<chainId>:<panel>:<issuer>:<adapter-or-zero>`
- Canonical disposable test artifact: `packages/foundry/deployments/tokenless-v3/84532.json`

Historical v1 and v2 artifacts must not be used by a live service. The current v3 bundle was deployed at block
`44132668`; the isolated Vercel app, Ponder, and keeper must be pinned to its complete deployment key. This is a
Base Sepolia test-profile bundle with unrestricted test currency. The web app remains in explicit sandbox mode until
the non-sandbox secret/provider bundle, managed signer roles, workers, and paid end-to-end path are verified.

Services must fail closed if their chain, addresses, start block, or deployment key disagree. Do not fall back to Base mainnet, an unversioned deployment JSON, or the former production services.

## Hosted isolation

- Web project: `rateloop-tokenless` on a Vercel-provided domain; never alias this branch to `rateloop.ai`.
- Service project: `rateloop-tokenless` on Railway, with its own Postgres, Ponder, and keeper services.
- Ponder database schema is derived from the complete tokenless deployment identity.
- The keeper uses a dedicated gas-only Base Sepolia key.
- The credential issuer uses a separate server-only signer key. Never expose it through a `NEXT_PUBLIC_` variable.

## Required production variables

Next.js:

- `APP_URL`, `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, `NEXT_PUBLIC_THIRDWEB_AUTH_DOMAIN`, and server-only `THIRDWEB_SECRET_KEY`
- `DATABASE_URL`
- `NEXT_PUBLIC_TARGET_NETWORKS=84532`
- `TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY`
- `TOKENLESS_DEPLOYMENT_SCHEMA`, `TOKENLESS_CHAIN_ID`, `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`, `TOKENLESS_USDC_ADDRESS`
- `TOKENLESS_FEE_RECIPIENT`, round timing variables, and optional `NEXT_PUBLIC_BASE_PAYMASTER_URL`
- distinct `TOKENLESS_X402_RELAYER_PRIVATE_KEY` and `TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY`
- eligibility provider ID/public key/start URL/handoff secret, versioned vault keys, and DAC7 policy
- `TOKENLESS_PIPELINE_TOKEN`, `CRON_SECRET`, `TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET`,
  `TOKENLESS_WEBHOOK_ENCRYPTION_KEY`; use a distinct server-only secret of at least 32 random characters for signed
  email unsubscribe links
- `TOKENLESS_MCP_RATE_LIMIT_SECRET` with at least 32 random characters and no public variant
- explicit `TOKENLESS_SUBSCRIPTIONS_ENABLED`; when true, server-only `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and `STRIPE_EARLY_ACCESS_MONTHLY_PRICE_ID`
- dedicated `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY` (32-byte base64url or hex) and
  `TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION`, with no public key variant
- explicit tokenless sandbox flags only when deliberately running the permanent test sandbox

The thirdweb project must allow only local development origins and `rateloop-tokenless.vercel.app`; never add
`rateloop.ai`. Run `yarn workspace @rateloop/nextjs auth:check` before a hosted authentication rollout.

Apply every migration recorded in `packages/nextjs/drizzle/meta/_journal.json` in order before smoke testing the
human-assurance APIs or enabling live mode. Isolated Vercel production builds apply and verify pending journal entries
before compiling; preview and local builds never mutate a database. The app must fail closed when moderation,
eligibility, deployment, signer, or pipeline configuration is incomplete.

Ponder:

- `PONDER_NETWORK=baseSepolia`, `PONDER_CHAIN_ID=84532`, `PONDER_RPC_URL_84532`
- `PONDER_TOKENLESS_PANEL_ADDRESS`, `PONDER_CREDENTIAL_ISSUER_ADDRESS`, `PONDER_X402_PANEL_SUBMITTER_ADDRESS`
- `PONDER_TOKENLESS_START_BLOCK`, `RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY`
- `DATABASE_URL`, `CORS_ORIGIN`, `PONDER_KEEPER_WORK_TOKEN`

Keeper:

- `CHAIN_ID=84532`, `RPC_URL`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`
- `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `KEEPER_PRIVATE_KEY` or a hosted keystore, plus `METRICS_AUTH_TOKEN`

The package-local `.env.example` files remain the executable source for exact names and validation rules.

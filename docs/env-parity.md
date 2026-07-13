# Tokenless Environment Parity

Every live tokenless component is isolated from the legacy RateLoop deployment.

## Chain and deployment identity

- Network: Base Sepolia
- Chain ID: `84532`
- RPC variable: `BASE_SEPOLIA_RPC_URL`, `PONDER_RPC_URL_84532`, or `RPC_URL`, depending on the package
- Deployment schema: `rateloop-tokenless-deployment-v2`
- Deployment key: `tokenless-v2:<chainId>:<panel>:<issuer>:<adapter-or-zero>`
- Canonical disposable test artifact: `packages/foundry/deployments/tokenless-v2/84532.json`

The checked-in v1 artifact is historical and must not be used by a live service. The current v2 bundle was deployed at
block `44090502`; the isolated Vercel app, Ponder, and keeper are pinned to its complete deployment key. The web app
remains in explicit sandbox mode until the non-sandbox secret/provider bundle and paid end-to-end path are verified.

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
- `DATABASE_URL`
- `NEXT_PUBLIC_TARGET_NETWORKS=84532`
- `TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY`
- `TOKENLESS_DEPLOYMENT_SCHEMA`, `TOKENLESS_CHAIN_ID`, `TOKENLESS_DEPLOYMENT_KEY`, `TOKENLESS_DEPLOYMENT_BLOCK`
- `TOKENLESS_PANEL_ADDRESS`, `TOKENLESS_CREDENTIAL_ISSUER_ADDRESS`, `TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS`, `TOKENLESS_USDC_ADDRESS`
- `TOKENLESS_FEE_RECIPIENT`, round timing variables, and optional `NEXT_PUBLIC_BASE_PAYMASTER_URL`
- distinct `TOKENLESS_X402_RELAYER_PRIVATE_KEY` and `TOKENLESS_PREPAID_FUNDER_PRIVATE_KEY`
- eligibility provider ID/public key/start URL/handoff secret, versioned vault keys, and DAC7 policy
- `TOKENLESS_PIPELINE_TOKEN`, `TOKENLESS_WEBHOOK_ENCRYPTION_KEY`
- explicit tokenless sandbox flags only when deliberately running the permanent test sandbox

Apply every migration recorded in `packages/nextjs/drizzle/meta/_journal.json` (currently `0000` through `0014`) in
order before smoke testing the human-assurance APIs or enabling live mode. The app must fail closed when moderation,
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

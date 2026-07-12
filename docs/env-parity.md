# Tokenless Environment Parity

Every live tokenless component is isolated from the legacy RateLoop deployment.

## Chain and deployment identity

- Network: Base Sepolia
- Chain ID: `84532`
- RPC variable: `BASE_SEPOLIA_RPC_URL`, `PONDER_RPC_URL_84532`, or `RPC_URL`, depending on the package
- Deployment schema: `rateloop-tokenless-deployment-v1`
- Deployment key: `tokenless-v1:<chainId>:<panel>:<issuer>:<adapter-or-zero>`
- Canonical artifact: `packages/foundry/deployments/tokenless-v1/84532.json`

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
- explicit tokenless sandbox flags only when deliberately running the permanent test sandbox

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

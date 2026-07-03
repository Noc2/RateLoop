# RateLoop Environment Parity

RateLoop currently targets the live Base mainnet deployment.

## Chain Scope

- `NEXT_PUBLIC_TARGET_NETWORKS=8453` is the production app setting.
- `PONDER_NETWORK=base` is the production indexer setting.
- Local development may use Anvil (`31337`) when a local deployment is running.

## USDC Aliases

Use unscoped USDC environment variables for the live deployment unless a package explicitly documents a chain-scoped override. When a chain-scoped alias is needed, use the `8453` suffix.

- `NEXT_PUBLIC_USDC_ADDRESS_8453`
- `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_8453`
- `RATELOOP_X402_USDC_ADDRESS_8453`

## E2E Flags

Local production-style E2E runs should opt in explicitly with the package-level local E2E flags documented in `packages/nextjs/README.md`. Production deployments should not rely on local fallback chains or undeployed-network bypasses.

## Contract Address Prefixes

Use the package-specific prefixes already present in each `.env.example` file:

- Next.js public app: `NEXT_PUBLIC_*`
- Agents local signer: `RATELOOP_LOCAL_SIGNER_*`
- Agents x402 aliases: `RATELOOP_X402_*`
- Ponder and keeper services: service-specific `RATELOOP_*` variables where documented

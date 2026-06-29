# Environment Parity

This runbook keeps chain, USDC, RPC, and contract-address environment variables
aligned across the RateLoop app, agents, Ponder, and Keeper.

## Chain IDs

| Chain | Chain ID | Status | Notes |
| --- | ---: | --- | --- |
| Local Hardhat/Anvil | `31337` | Local development | Default for `yarn dev:stack` and local fixtures. |
| Base Sepolia | `84532` | Staging/testnet | First live target for fresh deployment validation. |
| Base mainnet | `8453` | Production | Production boundary; use break-glass guidance for any fresh redeploy. |
| World Chain Sepolia | `4801` | Legacy | Kept for historical deployment artifacts and legacy checks. |
| World Chain mainnet | `480` | Legacy | Kept for historical deployment artifacts and legacy checks. |

## Next.js

Primary file: `packages/nextjs/.env.example`.

Use `NEXT_PUBLIC_TARGET_NETWORKS` as the browser-visible chain allowlist, in
priority order:

- Local: `NEXT_PUBLIC_TARGET_NETWORKS=31337`
- Base Sepolia: `NEXT_PUBLIC_TARGET_NETWORKS=84532`
- Base mainnet: `NEXT_PUBLIC_TARGET_NETWORKS=8453`

RPC variables:

- `NEXT_PUBLIC_RPC_URL_31337`
- `NEXT_PUBLIC_RPC_URL_84532`
- `NEXT_PUBLIC_RPC_URL_8453`
- `NEXT_PUBLIC_RPC_URL_4801`
- `NEXT_PUBLIC_RPC_URL_480`

Base preconfirmation RPCs are browser UX only. Keep Ponder and Keeper on
sealed-block RPCs. Only set `RATELOOP_SERVER_USE_BASE_PRECONF_RPC=true` with a
provider whose server-side receipt APIs are acceptable for confirmations.

USDC variables:

- Prefer generated defaults from `@rateloop/contracts`.
- Use `NEXT_PUBLIC_USDC_ADDRESS_<chainId>` or
  `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_<chainId>` only for explicit chain
  overrides.
- `RATELOOP_X402_USDC_ADDRESS_<chainId>` is the server-side x402 planning
  override.

## USDC Defaults

Canonical defaults live in `packages/contracts/src/protocol.ts`.

| Chain ID | USDC |
| ---: | --- |
| `8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `480` | `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1` |
| `4801` | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` |

For EIP-3009 typed-data validation, Base mainnet uses the domain name
`USD Coin`; Base Sepolia and the legacy World Chain aliases use `USDC`.

## Ponder

Ponder should use sealed-block RPCs and the same generated deployment metadata
as the app.

Common pairings:

- Local: `PONDER_NETWORK=hardhat`, `PONDER_RPC_URL_31337=http://127.0.0.1:8545`
- Base Sepolia: `PONDER_NETWORK=baseSepolia`, `PONDER_RPC_URL_84532=<https rpc>`
- Base mainnet: `PONDER_NETWORK=base`, `PONDER_RPC_URL_8453=<https rpc>`

Do not point Ponder at Flashblocks/preconfirmation RPCs. Ponder is canonical
indexing infrastructure and must follow sealed blocks.

## Keeper

Keeper uses server-only env and validates that `RPC_URL` resolves to `CHAIN_ID`.

Required live pairings:

- Local: `CHAIN_ID=31337`, `RPC_URL=http://127.0.0.1:8545`
- Base Sepolia: `CHAIN_ID=84532`, `RPC_URL=<https rpc>`
- Base mainnet: `CHAIN_ID=8453`, `RPC_URL=<https rpc>`, `NODE_ENV=production`

Keeper live contract addresses should come from `@rateloop/contracts`
deployment metadata. Address env vars such as `VOTING_ENGINE_ADDRESS`,
`CONTENT_REGISTRY_ADDRESS`, `FEEDBACK_REGISTRY_ADDRESS`,
`ADVISORY_VOTE_RECORDER_ADDRESS`, `CLUSTER_PAYOUT_ORACLE_ADDRESS`,
`FEEDBACK_BONUS_ESCROW_ADDRESS`, `ROUND_REWARD_DISTRIBUTOR_ADDRESS`, and
`FRONTEND_REGISTRY_ADDRESS` are local/dev overrides or explicitly documented
exceptions.

## Agents

Primary file: `packages/agents/.env.example`.

Local signer and CLI pairings:

- `RATELOOP_RPC_URL`
- `RATELOOP_CHAIN_ID`
- `RATELOOP_AGENT_WALLET_ADDRESS`

USDC and x402 overrides:

- Prefer `@rateloop/contracts` defaults for Base and Base Sepolia.
- Use `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_<chainId>` or
  `RATELOOP_X402_USDC_ADDRESS_<chainId>` only when testing a non-default token.
- Use `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS` only for an explicitly
  documented submitter override.

Local signer contract address overrides:

- `RATELOOP_LOCAL_SIGNER_CONTENT_REGISTRY_ADDRESS`
- `RATELOOP_LOCAL_SIGNER_QUESTION_REWARD_POOL_ESCROW_ADDRESS`
- `RATELOOP_LOCAL_SIGNER_FEEDBACK_BONUS_ESCROW_ADDRESS`
- `RATELOOP_LOCAL_SIGNER_LREP_ADDRESS`
- `RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS`

## Address Rules

- Live app, Ponder, Keeper, and agent services should prefer generated
  deployment metadata from `@rateloop/contracts`.
- Chain-scoped env vars are acceptable for RPC URLs and token overrides.
- Contract-address env overrides are for local development, temporary staging
  diagnosis, or an explicitly documented cutover exception.
- Base Sepolia readiness should fail until the deployment artifact, generated
  metadata, app env, Ponder env, and Keeper env all point at the same stack.
- Base mainnet contract changes are not routine configuration updates; follow
  the owner-directed break-glass deploy guidance in `packages/foundry/README.md`.

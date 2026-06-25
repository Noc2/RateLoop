# Environment parity matrix

Cross-package reference for env names that refer to the same on-chain value, E2E toggles, and contract-address prefixes. Supported non-local chains (`8453`, `84532`, `480`, `4801`) default from `@rateloop/contracts` deployment artifacts; Keeper address overrides are local `31337` only unless noted.

## Chain IDs

| Chain ID | Network               | Deployment artifact                       | Artifact profile / operational status            |
| -------- | --------------------- | ----------------------------------------- | ------------------------------------------------ |
| `84532`  | Base Sepolia          | `packages/foundry/deployments/84532.json` | `default`; active staging                        |
| `8453`   | Base mainnet          | `packages/foundry/deployments/8453.json`  | `production`; current production boundary        |
| `4801`   | World Chain Sepolia   | `packages/foundry/deployments/4801.json`  | `default`; legacy validation artifact            |
| `480`    | World Chain mainnet   | `packages/foundry/deployments/480.json`   | `production` profile; retired operational target |
| `31337`  | Local Foundry / Anvil | gitignored local deploy                   | local                                            |

`packages/nextjs/.env.production` targets `NEXT_PUBLIC_TARGET_NETWORKS=8453` for the Base mainnet production
deployment. Base Sepolia validation should override the target to `84532` explicitly; the bare
`yarn base-sepolia:check` command defaults to `docs/testing/base-sepolia-next-env.fixture` for that offline
readiness check, and `BASE_SEPOLIA_NEXT_ENV_FILE` can point at a different staging env file when needed.

Base Sepolia is the staging chain, but its known stale `X402QuestionSubmitter` disables one-shot USDC Feedback Bonus
x402 submissions. Use bounty-only x402 or `wallet_calls` for staging Feedback Bonus coverage until
`yarn base-sepolia:check -- --require-one-shot-feedback-bonus-x402` passes.

## USDC address aliases

USDC defaults are in `@rateloop/contracts` (`USDC_BY_CHAIN_ID`). Chain-scoped env overrides use the same suffix as the chain ID.

| Chain   | Default USDC                                 |
| ------- | -------------------------------------------- |
| `84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `8453`  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `480`   | `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1` |
| `4801`  | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` |

| Package / surface            | Env var                                            | Role                                                                                                           |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Next.js browser              | `NEXT_PUBLIC_USDC_ADDRESS`                         | Browser-side USDC bounty reads and approvals                                                                   |
| Next.js browser              | `NEXT_PUBLIC_USDC_ADDRESS_<chainId>`               | Chain-scoped browser-side USDC bounty reads and approvals                                                      |
| Next.js browser (x402 alias) | `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS`           | x402-aligned browser USDC override; accepted alongside `NEXT_PUBLIC_USDC_ADDRESS` in `getDefaultUsdcAddress()` |
| Next.js browser (x402 alias) | `NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS_<chainId>` | Chain-scoped x402-aligned browser USDC override                                                                |
| Next.js server (x402)        | `RATELOOP_X402_USDC_ADDRESS`                       | Server-side x402 bounty planning and submission                                                                |
| Next.js server (x402)        | `RATELOOP_X402_USDC_ADDRESS_<chainId>`             | Chain-scoped server-side x402 bounty planning and submission                                                   |
| Agents local signer          | `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS`               | Trusted USDC override before signing EIP-3009 typed data                                                       |
| Agents local signer          | `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_<chainId>`     | Chain-scoped trusted USDC override before signing EIP-3009 typed data                                          |
| Agents local signer (alias)  | `RATELOOP_X402_USDC_ADDRESS`                       | Same as above; accepted alias in `localSigner.ts`                                                              |
| Agents local signer (alias)  | `RATELOOP_X402_USDC_ADDRESS_<chainId>`             | Chain-scoped alias accepted by `localSigner.ts`                                                                |

Next.js throws when **any two or more** of the matching public/server USDC variables disagree for the same chain (`lib/env/server.ts`). Browser `getDefaultUsdcAddress()` throws when the two public vars disagree. Agents `local-ask` throws when the local-signer USDC name and x402 alias disagree for the same scope. Set all matching variables to the same address when overriding USDC. Server x402 resolution requires at least one public browser var when `RATELOOP_X402_USDC_ADDRESS` or `RATELOOP_X402_USDC_ADDRESS_<chainId>` is set.

## Ponder URL and RPC aliases

| Package / surface                    | Env var                                | Role                                                                                                                                                 |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js browser + server reads       | `NEXT_PUBLIC_PONDER_URL`               | Hosted Ponder indexer for `/content`, `/rounds`, etc. (required in production)                                                                       |
| Next.js browser writes/receipt reads | `NEXT_PUBLIC_RPC_URL_8453`             | Base mainnet browser RPC override; required when Base preconfirmation is enabled for mainnet                                                         |
| Next.js browser writes/receipt reads | `NEXT_PUBLIC_RPC_URL_84532`            | Base Sepolia browser RPC override; required when Base preconfirmation is enabled for staging                                                         |
| Next.js browser writes/receipt reads | `NEXT_PUBLIC_USE_BASE_PRECONF_RPC`     | Set to `true` on Vercel/Railway to use Base Flashblocks/preconfirmation metadata with the configured Base RPC                                        |
| Next.js server receipt reads         | `RATELOOP_SERVER_USE_BASE_PRECONF_RPC` | Optional explicit opt-in for server confirmation to use Base preconfirmation metadata with the configured Base RPC; default is ordinary RPC metadata |
| Keeper                               | `PONDER_BASE_URL`                      | Same indexer host for `/keeper/work` and correlation vote routes                                                                                     |
| Ponder indexer                       | `PONDER_RPC_URL_8453`                  | Base mainnet RPC for indexing                                                                                                                        |
| Ponder indexer                       | `PONDER_RPC_URL_84532`                 | Base Sepolia RPC for indexing                                                                                                                        |
| Ponder indexer                       | `PONDER_RPC_URL_480`                   | World Chain mainnet RPC for indexing                                                                                                                 |
| Ponder indexer                       | `PONDER_RPC_URL_4801`                  | World Chain Sepolia RPC for indexing                                                                                                                 |
| Ponder indexer                       | `PONDER_RPC_URL_31337`                 | Local Anvil RPC for indexing                                                                                                                         |

E2E and `yarn dev:stack` should point `NEXT_PUBLIC_PONDER_URL` and `PONDER_BASE_URL` at the same Ponder base URL, including any path prefix (for example `http://localhost:42069` or `https://example.com/ponder`). Agent MCP, attachments, and browser handoffs use the Next.js app origin (`NEXT_PUBLIC_APP_URL` / `www.rateloop.ai`), not Ponder.

The deployed Next.js app can use Base Flashblocks/preconfirmation metadata to make wallet progress appear quickly after a user confirms. `NEXT_PUBLIC_USE_BASE_PRECONF_RPC=true` is a public browser env toggle; when enabled for a Base target, the matching `NEXT_PUBLIC_RPC_URL_<chainId>` must point at a Flashblocks-capable provider. The app does not use a dedicated preconfirmation env var and does not fall back to Base's public preconfirmation endpoint. Next.js server confirmation code ignores the public browser toggle and stays on ordinary RPC metadata by default. Only set `RATELOOP_SERVER_USE_BASE_PRECONF_RPC=true` after confirming the configured provider's receipt APIs are acceptable for server confirmation calls. Ponder and Keeper should use ordinary sealed-block RPCs for canonical indexing and automation. Thirdweb client and verifier env vars configure wallet, top-up, and sponsorship behavior; do not treat them as the canonical indexer RPC or the Flashblocks/preconfirmation provider by default.

### Keeper / Ponder shared secrets

| Package | Variable                     | Purpose                                                                               |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Keeper  | `PONDER_KEEPER_WORK_TOKEN`   | Bearer token for Ponder `GET /keeper/work` (must match Ponder)                        |
| Ponder  | `PONDER_KEEPER_WORK_TOKEN`   | Required in production for `/keeper/work`                                             |
| Next.js | `PONDER_METADATA_SYNC_TOKEN` | Bearer token sent to Ponder `POST /question-metadata` after x402 submissions          |
| Ponder  | `PONDER_METADATA_SYNC_TOKEN` | Required for metadata sync unless `PONDER_METADATA_SYNC_ALLOW_OPEN=true` in local/dev |

Production Keeper/Ponder services must also boot with `NODE_ENV=production`. Base mainnet service readiness expects
`KEEPER_DATABASE_URL` for the keeper advisory lock, Ponder `CORS_ORIGIN`, and
`RATE_LIMIT_TRUSTED_IP_HEADERS`; if Keeper metrics bind to a non-loopback address, set a 16+ character
`METRICS_AUTH_TOKEN`. Strict live readiness probes Ponder `/keeper/work` with `PONDER_KEEPER_WORK_TOKEN`.

## E2E production-build flags

Local Playwright suites can opt into production-style behavior (localhost attachment origins, wallet bridge, rate-limit bypass) without a production deploy.

| Env var                                     | Package         | Checked by                           |
| ------------------------------------------- | --------------- | ------------------------------------ |
| `RATELOOP_E2E_PRODUCTION_BUILD`             | Next.js server  | `isLocalE2EProductionBuildEnabled()` |
| `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD` | Next.js browser | `isLocalE2EProductionBuildEnabled()` |

Either flag set to `"true"` enables the mode. CI E2E workflows set both. Core Next.js paths use `isLocalE2EProductionBuildEnabled()` and honor either flag; set both for local full-stack E2E and Playwright CI parity.

Related: `RATELOOP_E2E_WALLET_BRIDGE` and hostname checks in `isLocalE2EWalletBridgeEnabled()` for the local test wallet bridge component.

### Base Sepolia E2E wallet

Use `yarn base-sepolia:e2e-wallet generate` to create a disposable Base Sepolia wallet for automated local
production-style browser testing. The command writes `.env.base-sepolia-e2e-wallet.local`, which is ignored by the
repo-wide `.env.*` rule, and prints only the address to fund.

The local browser wallet bridge is still localhost-only. To exercise Base Sepolia writes through the app, run the
frontend locally with `NEXT_PUBLIC_TARGET_NETWORKS=84532`, `RATELOOP_E2E_PRODUCTION_BUILD=true`, and
`NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD=true`, then seed the page with:

| Storage key                            | Value                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| `rateloop:e2e-test-wallet-private-key` | `BASE_SEPOLIA_E2E_PRIVATE_KEY` from the ignored wallet file |
| `rateloop:e2e-test-wallet-chain-id`    | `84532`                                                     |
| `rateloop:e2e-rpc-url`                 | Base Sepolia RPC URL                                        |

Use `yarn base-sepolia:e2e-wallet balances` after funding to verify ETH, USDC, and LREP. Treat this wallet as
test-only forever and never fund it on Base mainnet.

## Contract address prefix map

Shared deployments live in `packages/contracts/src/deployedContracts.ts`. Keeper address env names override artifacts only on local `31337`; non-local Keeper deployments require shared contract artifacts.

| Contract                   | Keeper                             | Ponder                                       | Next.js (when overridden)                         |
| -------------------------- | ---------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `ContentRegistry`          | `CONTENT_REGISTRY_ADDRESS`         | `PONDER_CONTENT_REGISTRY_ADDRESS`            | —                                                 |
| `RoundVotingEngine`        | `VOTING_ENGINE_ADDRESS`            | `PONDER_ROUND_VOTING_ENGINE_ADDRESS`         | —                                                 |
| `RoundRewardDistributor`   | `ROUND_REWARD_DISTRIBUTOR_ADDRESS` | `PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS`    | —                                                 |
| `QuestionRewardPoolEscrow` | —                                  | `PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS` | `NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS` |
| `FeedbackBonusEscrow`      | `FEEDBACK_BONUS_ESCROW_ADDRESS`    | `PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS`       | —                                                 |
| `FeedbackRegistry`         | —                                  | `PONDER_FEEDBACK_REGISTRY_ADDRESS`           | —                                                 |
| `CategoryRegistry`         | —                                  | `PONDER_CATEGORY_REGISTRY_ADDRESS`           | —                                                 |
| `ProfileRegistry`          | —                                  | `PONDER_PROFILE_REGISTRY_ADDRESS`            | —                                                 |
| `FrontendRegistry`         | `FRONTEND_REGISTRY_ADDRESS`        | `PONDER_FRONTEND_REGISTRY_ADDRESS`           | —                                                 |
| `LoopReputation`           | —                                  | `PONDER_LREP_ADDRESS`                        | —                                                 |
| `LaunchDistributionPool`   | —                                  | `PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS`    | —                                                 |
| `ClusterPayoutOracle`      | `CLUSTER_PAYOUT_ORACLE_ADDRESS`    | `PONDER_CLUSTER_PAYOUT_ORACLE_ADDRESS`       | —                                                 |
| `AdvisoryVoteRecorder`     | `ADVISORY_VOTE_RECORDER_ADDRESS`   | `PONDER_ADVISORY_VOTE_RECORDER_ADDRESS`      | —                                                 |
| `RaterRegistry`            | —                                  | `PONDER_RATER_REGISTRY_ADDRESS`              | —                                                 |
| `ConfidentialityEscrow`    | —                                  | `PONDER_CONFIDENTIALITY_ESCROW_ADDRESS`      | —                                                 |

Keeper and Ponder reject conflicting live-chain overrides when shared artifacts are present.

## Agent x402 submitter aliases

| Env var                                        | Package | Role                                                      |
| ---------------------------------------------- | ------- | --------------------------------------------------------- |
| `RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS` | Agents  | Trusted EIP-3009 authorization recipient before signing   |
| `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS`     | Agents  | Alias for the same submitter override in `localSigner.ts` |

## Correlation artifact HTTPS allowlists

Keeper and Ponder use different env var names for the same HTTPS prefix allowlist. Set both to the keeper's public artifact base URL (for example `https://keeper.example.com/correlation-artifacts`):

| Env var | Package | Role |
| ------- | ------- | ---- |
| `KEEPER_ARTIFACT_HTTPS_ALLOWLIST` | Keeper | HTTPS prefixes the keeper may fetch when ingesting third-party correlation artifacts |
| `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` | Keeper | Public base URL published on-chain for file-backed artifacts |
| `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` | Ponder | HTTPS prefixes Ponder may fetch when indexing payout artifacts and serving proofs |

Each service also accepts the other service's allowlist env name as an alias. Production readiness should verify the prefixes match the keeper's published artifact URL. When both `KEEPER_ARTIFACT_HTTPS_ALLOWLIST` and `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` are set, `yarn base-mainnet:check` and `yarn base-sepolia:check` require the normalized prefix lists to match.

## Agent runtime env surface

| Env var | Package | Role |
| ------- | ------- | ---- |
| `RATELOOP_API_BASE_URL` | Agents | Hosted RateLoop app origin for SDK HTTP and default MCP routing |
| `RATELOOP_MCP_TOKEN` | Agents | Managed agent bearer token; requires HTTPS API URLs when set |
| `RATELOOP_MCP_API_URL` | Agents | Optional MCP endpoint override (defaults to `${RATELOOP_API_BASE_URL}/api/mcp/public`) |
| `RATELOOP_MCP_PROTOCOL_VERSION` | Agents | Optional MCP protocol version override |
| `RATELOOP_AGENT_WALLET_ADDRESS` | Agents | Wallet used for tokenless public asks |
| `RATELOOP_RPC_URL` | Agents | RPC for `local-ask` transaction execution |
| `RATELOOP_CHAIN_ID` | Agents | Optional chain guard for `local-ask` |
| `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL` | Agents | Production metadata pin for canonical ask hashes |
| `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS` / `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS_<chainId>` | Agents | Trusted USDC override before EIP-3009 signing |
| `RATELOOP_X402_USDC_ADDRESS` / `RATELOOP_X402_USDC_ADDRESS_<chainId>` | Agents | Alias accepted by `localSigner.ts` |
| `RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS` / `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS` | Agents | Trusted x402 submitter override |
| `RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH` / `RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD` | Agents | Encrypted local signer keystore |
| `RATELOOP_LOCAL_SIGNER_PRIVATE_KEY` | Agents | Ephemeral CI escape hatch only |

Agent x402 parsers also accept `RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL` before `NEXT_PUBLIC_PONDER_URL` / `NEXT_PUBLIC_APP_URL` when building default metadata URLs outside Next.js.

## RaterRegistry follow counter storage drift

`RaterRegistry` declares `followingCount` and `followerCount` in storage and interfaces, but the implementation does not maintain them (follow edges are tracked without updating those counters). This is documentation-only drift: **no contract change is planned** for the unused counters. Off-chain indexers should not rely on those fields until a future migration explicitly wires them.

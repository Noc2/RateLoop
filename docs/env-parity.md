# Environment parity matrix

Cross-package reference for env names that refer to the same on-chain value, E2E toggles, and contract-address prefixes. Live supported chains (`480`, `4801`, `31337`) default from `@rateloop/contracts` deployment artifacts; overrides are for local Anvil or unsupported chains unless noted.

## Chain IDs

| Chain ID | Network | Deployment artifact | Profile |
| --- | --- | --- | --- |
| `4801` | World Chain Sepolia | `packages/foundry/deployments/4801.json` | testnet |
| `480` | World Chain mainnet | `packages/foundry/deployments/480.json` | `mainnet-canary` or `production` (see artifact `deploymentProfile`) |
| `31337` | Local Foundry / Anvil | gitignored local deploy | local |

## USDC address aliases

World Chain USDC defaults are in `@rateloop/contracts` (`WORLD_CHAIN_USDC_BY_CHAIN_ID`):

| Chain | Default USDC |
| --- | --- |
| `480` | `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1` |
| `4801` | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` |

| Package / surface | Env var | Role |
| --- | --- | --- |
| Next.js browser | `NEXT_PUBLIC_USDC_ADDRESS` | Browser-side USDC bounty reads and approvals |
| Next.js server (x402) | `RATELOOP_X402_USDC_ADDRESS` | Server-side x402 bounty planning and submission |
| Agents local signer | `RATELOOP_LOCAL_SIGNER_USDC_ADDRESS` | Trusted USDC override before signing EIP-3009 typed data |
| Agents local signer (alias) | `RATELOOP_X402_USDC_ADDRESS` | Same as above; accepted alias in `localSigner.ts` |

Next.js throws when **both** `NEXT_PUBLIC_USDC_ADDRESS` and `RATELOOP_X402_USDC_ADDRESS` are set and differ (`lib/env/server.ts`). Server x402 resolution accepts either variable when only one is set; set both to the same address in production to keep browser bounty reads aligned with server submission.

### Keeper / Ponder shared secrets

| Package | Variable | Purpose |
| --- | --- | --- |
| Keeper | `PONDER_KEEPER_WORK_TOKEN` | Bearer token for Ponder `GET /keeper/work` (must match Ponder) |
| Ponder | `PONDER_KEEPER_WORK_TOKEN` | Required in production for `/keeper/work` |

## E2E production-build flags

Local Playwright suites can opt into production-style behavior (localhost attachment origins, wallet bridge, rate-limit bypass) without a production deploy.

| Env var | Package | Checked by |
| --- | --- | --- |
| `RATELOOP_E2E_PRODUCTION_BUILD` | Next.js server | `isLocalE2EProductionBuildEnabled()` |
| `NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD` | Next.js browser | `isLocalE2EProductionBuildEnabled()` |

Either flag set to `"true"` enables the mode. CI E2E workflows set both. Some paths still read `NEXT_PUBLIC_*` only (see audit L1); prefer setting both for local full-stack E2E.

Related: `RATELOOP_E2E_WALLET_BRIDGE` and hostname checks in `isLocalE2EWalletBridgeEnabled()` for the local test wallet bridge component.

## Contract address prefix map

Shared deployments live in `packages/contracts/src/deployedContracts.ts`. Package-specific env names override artifacts only on local `31337` or unsupported chains.

| Contract | Keeper | Ponder | Next.js (when overridden) |
| --- | --- | --- | --- |
| `ContentRegistry` | `CONTENT_REGISTRY_ADDRESS` | `PONDER_CONTENT_REGISTRY_ADDRESS` | — |
| `RoundVotingEngine` | `VOTING_ENGINE_ADDRESS` | `PONDER_ROUND_VOTING_ENGINE_ADDRESS` | — |
| `RoundRewardDistributor` | `ROUND_REWARD_DISTRIBUTOR_ADDRESS` | `PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS` | — |
| `QuestionRewardPoolEscrow` | — | `PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS` | `NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS` |
| `FeedbackBonusEscrow` | `FEEDBACK_BONUS_ESCROW_ADDRESS` | `PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS` | — |
| `FeedbackRegistry` | — | `PONDER_FEEDBACK_REGISTRY_ADDRESS` | — |
| `CategoryRegistry` | — | `PONDER_CATEGORY_REGISTRY_ADDRESS` | — |
| `ProfileRegistry` | — | `PONDER_PROFILE_REGISTRY_ADDRESS` | — |
| `FrontendRegistry` | `FRONTEND_REGISTRY_ADDRESS` | `PONDER_FRONTEND_REGISTRY_ADDRESS` | — |
| `LoopReputation` | — | `PONDER_LREP_ADDRESS` | — |
| `LaunchDistributionPool` | — | `PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS` | — |
| `ClusterPayoutOracle` | `CLUSTER_PAYOUT_ORACLE_ADDRESS` | `PONDER_CLUSTER_PAYOUT_ORACLE_ADDRESS` | — |
| `AdvisoryVoteRecorder` | `ADVISORY_VOTE_RECORDER_ADDRESS` | `PONDER_ADVISORY_VOTE_RECORDER_ADDRESS` | — |
| `RaterRegistry` | — | `PONDER_RATER_REGISTRY_ADDRESS` | — |
| `ConfidentialityEscrow` | — | `PONDER_CONFIDENTIALITY_ESCROW_ADDRESS` | — |

Keeper and Ponder reject conflicting live-chain overrides when shared artifacts are present.

## Agent x402 submitter aliases

| Env var | Package | Role |
| --- | --- | --- |
| `RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS` | Agents | Trusted EIP-3009 authorization recipient before signing |
| `RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS` | Agents | Alias for the same submitter override in `localSigner.ts` |

## RaterRegistry follow counter storage drift

`RaterRegistry` declares `followingCount` and `followerCount` in storage and interfaces, but the implementation does not maintain them (follow edges are tracked without updating those counters). This is documentation-only drift: **no contract change is planned** for the unused counters. Off-chain indexers should not rely on those fields until a future migration explicitly wires them.

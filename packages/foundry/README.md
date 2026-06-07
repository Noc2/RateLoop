# RateLoop — Foundry (Smart Contracts)

Solidity smart contracts implementing the RateLoop protocol: voting engine, content registry, Loop Reputation token, LREP settlement, bounty escrow, launch distribution, ClusterPayoutOracle, and governance. Built with [Foundry](https://book.getfoundry.sh/). The docs now describe the question-first submission flow, public evidence through a context URL, image context, or YouTube video context, mandatory non-refundable bounties funded in LREP or USDC, flexible minimum bounty terms for raters and settlement rounds, optional identity credentials, the default frontend-operator fee on qualified bounty claims, and frontend-backed payout-root publication.

## Quick Start

```bash
# From the monorepo root:
yarn chain       # Start local Anvil chain
yarn deploy      # Deploy contracts
yarn foundry:test # Run test suite
```

## Scripts

| Command                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `yarn chain`            | Start a local Anvil chain with Scaffold-ETH scaffolding |
| `yarn deploy`           | Deploy contracts via Forge script                       |
| `yarn compile`          | Compile Solidity contracts                              |
| `yarn foundry:test`     | Run the Foundry test suite                              |
| `yarn format`           | Format Solidity and JS files                            |
| `yarn lint`             | Check code formatting                                   |
| `yarn flatten`          | Output flattened contracts                              |
| `yarn verify`           | Verify contracts on Etherscan-compatible networks       |
| `yarn account`          | Check keystore account balance                          |
| `yarn account:generate` | Create a new keystore account                           |
| `yarn account:import`   | Import an existing account into keystore                |

On World Chain mainnet and World Chain Sepolia, deploys use a Foundry keystore selected via `--keystore <name>` and skip Forge's
auto-verification flow. Verify those contracts manually with
`make verify-blockscout NETWORK=<worldchain|worldchainSepolia> CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract`.

## Configuration

Create a `.env` file (see `.env.example`):

| Variable                                              | Description                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `ALCHEMY_API_KEY`                                     | Optional RPC provider key for testnet/mainnet deploys                  |
| `WORLDCHAIN_RPC_URL`                                  | Optional World Chain mainnet RPC override for live deploys             |
| `WORLDCHAIN_SEPOLIA_RPC_URL`                          | Optional World Chain Sepolia RPC override for live deploys             |
| `NEXT_PUBLIC_WORLD_ID_APP_ID`                         | World ID app ID used when a live verifier is configured                |
| `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION`              | World ID v4 credential action; defaults to `rateloop-human-credential-v1` |
| `NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION`                | World ID v4 fresh-presence/recheck action; defaults to `rateloop-human-presence-v1` |
| `WORLD_ID_V4_VERIFIER_ADDRESS`                        | Optional explicit v4 verifier override; unset uses the bundled World Chain address only if it has code, and `0x0000000000000000000000000000000000000000` disables World ID until governance configures a verifier |
| `WORLD_ID_V4_RP_ID`                                   | Numeric World ID relying-party ID from the Developer Portal            |
| `WORLD_ID_V4_ISSUER_SCHEMA_ID`                        | World ID v4 issuer schema ID accepted by the deployment                |
| `WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN`        | Optional v4 credential genesis issuance lower bound; defaults to `0`   |
| `ETHERSCAN_API_KEY`                                   | Optional explorer API key for Etherscan-compatible networks            |

Localhost deploys use the standard Anvil private key directly, so `yarn deploy` does not need a keystore password
when deploying to `localhost`.

Live-network deploys are keystore-based rather than private-key-based. Generate or import a Foundry keystore, then run
`yarn deploy --network <network> --keystore <name>`.

## Project Structure

```
contracts/
├── ContentRegistry.sol          # Question-first submission & lifecycle management
├── RoundVotingEngine.sol        # Core tlock voting logic, metadata-bound commits, and gated round settlement
├── RoundRewardDistributor.sol   # Revealed-loser refund plus voter/consensus/frontend/treasury reward split
├── CategoryRegistry.sol         # Content category management
├── ProfileRegistry.sol          # User reputation & metadata
├── FrontendRegistry.sol         # Frontend operator fee tracking
├── RaterRegistry.sol            # Rater profiles, delegation, World ID v4 credentials, and fresh user-presence rechecks
├── LoopReputation.sol           # LREP token (governance and reputation)
├── LaunchDistributionPool.sol   # Anchor-gated earned rater rewards with verified full-cap unlocks, plus verification, referral, and legacy rewards
├── ClusterPayoutOracle.sol      # Governance-managed challengeable roots proposed by bonded frontend operators
├── QuestionRewardPoolEscrow.sol     # Bounty custody and claims
├── governance/                  # Governor contracts
├── interfaces/                  # Contract interfaces
├── libraries/                   # RoundLib and utility functions
└── mocks/                       # Mock contracts for testing

test/                            # Foundry test suite
script/
├── Deploy.s.sol                 # Main deployment entry point
└── DeployHelpers.s.sol          # Shared deployment helpers

scripts-js/                      # JS helpers for deployment & account management
```

## Architecture

The upgradeable control-plane contracts are deployed behind **transparent upgradeable proxies** and use
`AccessControlUpgradeable` for role-based permissions: `ContentRegistry`, `RoundVotingEngine`,
`RoundRewardDistributor`, `ProtocolConfig`, `FrontendRegistry`, `ProfileRegistry`, `QuestionRewardPoolEscrow`, and
`FeedbackBonusEscrow`. Token, identity, participation, governance, and helper contracts are intentionally
non-upgradeable. For upgradeable implementation contracts, storage layout must be preserved across upgrades — never
reorder, remove, or change types of existing storage variables.

Compiled ABIs and deployed addresses are generated into `packages/contracts/src/` and consumed via the `@rateloop/contracts` workspace package.

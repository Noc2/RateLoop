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

## Contract size limits (EIP-170)

Run `yarn workspace @rateloop/foundry check:sizes` (or `make check-contract-sizes` after `forge build`) to verify deployed bytecode stays at or below the 24,576 byte limit.

Several production contracts run close to the limit. Run `make check-contract-sizes DEPLOY_PROFILE=deploy` for current numbers. As of June 2026 deploy-profile checks:

| Contract | Size (B) | Headroom (B) |
| --- | --- | --- |
| `LaunchDistributionPool` | 24,538 | 38 |
| `ContentRegistry` | 24,387 | 189 |
| `QuestionRewardPoolEscrow` | 24,424 | 152 |
| `RoundVotingEngine` | 23,911 | 665 |
| `RaterRegistry` | 22,900 | 1,676 |

`ContentRegistry.repointPendingRatingClusterPayoutOracle` is exposed via a thin `CONFIG_ROLE` wrapper; dormancy lifecycle helpers live in `ContentRegistryDormancyLib` to preserve EIP-170 headroom.

Treat new features on these contracts as size-sensitive: prefer library extraction or split contracts before adding bytecode.

**Deploy profile vs default profile:** `yarn workspace @rateloop/foundry check:sizes` and live deploys use the Foundry **deploy** profile (`FOUNDRY_PROFILE=deploy`). A plain `forge build` with the default profile can produce oversize bytecode for `RoundVotingEngine`, `LaunchDistributionPool`, `QuestionRewardPoolEscrow`, and `ContentRegistry` even when deploy-profile artifacts pass EIP-170. Do not use default-profile build artifacts for size gates or production deploys.

**Settlement side effects:** `RoundSettlementSideEffectsLib` records pending public-rating settlements in a try/catch. A failed side effect emits `SettlementSideEffectFailed` but still completes settlement; operators must monitor logs and manually call `recordPendingRatingSettlement` (or repoint/retry tooling) when that event appears. Index or alert on `SettlementSideEffectFailed` from `RoundVotingEngine` in production before mainnet launch.

On World Chain mainnet and World Chain Sepolia, deploys use a Foundry keystore selected via `--keystore <name>` and skip Forge's
auto-verification flow. Verify those contracts manually with
`make verify-blockscout NETWORK=<worldchain|worldchainSepolia> CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract`.

The World Chain Sepolia flow is a fresh deployment flow: `script/Deploy.s.sol` creates new proxies and exports a new
`deployments/4801.json`. Do not use the current `ContentRegistry` implementation as an in-place upgrade for an older
Sepolia proxy unless a separate migration/backfill is provided for `submissionMediaValidator` and
`questionBundleRoundObserverByContent`. Do not use the current `RaterRegistry` implementation as an in-place upgrade
for an older Sepolia proxy unless a separate migration/backfill is provided for the `_identityBanSource` to
`_identityBanSources` slot-32 retype. The `worldchain-sepolia:check -- --live` readiness probe verifies the deployed
`ContentRegistry.submissionMediaValidator()` exposes the gated-submission validator selectors before the deployment is
treated as ready.

World Chain deploys default to legacy World ID 3.0 Orb verification. The deploy script resolves the canonical
World ID router for chain `480` or `4801`, derives the external nullifier from
`NEXT_PUBLIC_WORLD_ID_APP_ID` and `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION`, and fails pre-broadcast if the live router
has no code. World ID 4.0 Proof-of-Human remains governance-configurable on `RaterRegistry`, but production deploys do
not depend on a v4 verifier until that path is tested end-to-end.

## Configuration

Create a `.env` file (see `.env.example`):

| Variable                                       | Description                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALCHEMY_API_KEY`                              | Optional RPC provider key for testnet/mainnet deploys                                                                                                                       |
| `WORLDCHAIN_RPC_URL`                           | Optional World Chain mainnet RPC override for live deploys                                                                                                                  |
| `WORLDCHAIN_SEPOLIA_RPC_URL`                   | Optional World Chain Sepolia RPC override for live deploys                                                                                                                  |
| `NEXT_PUBLIC_WORLD_ID_APP_ID`                  | World ID app ID used to derive the legacy v3 external nullifier                                                                                                             |
| `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION`       | World ID credential action; defaults to `rateloop-human-credential-v1`                                                                                                      |
| `WORLD_ID_ROUTER_ADDRESS`                      | Optional explicit World ID v3 router override; nonzero live-network overrides must have code                                                                                |
| `WORLD_ID_EXTERNAL_NULLIFIER_HASH`             | Optional explicit v3 external nullifier hash override; leave unset to derive from app ID and action                                                                         |
| `RATELOOP_DEPLOYMENT_PROFILE`                  | Deployment artifact profile stamp; the deploy wrapper sets `production` for World Chain mainnet and `default` elsewhere                                                    |
| `ETHERSCAN_API_KEY`                            | Optional explorer API key for Etherscan-compatible networks                                                                                                                 |

World Chain mainnet (`480`) resolves router `0x17B354dD2595411ff79041f930e491A4Df39A278` by default. World Chain
Sepolia (`4801`) resolves router `0x57f928158C3EE7CDad1e4D8642503c4D0201f611` by default. Localhost deploys create
`MockWorldIDRouter`, wire it into `RaterRegistry`, and export it in the local deployment JSON.

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
├── RaterRegistry.sol            # Rater profiles, delegation, World ID v3 proof-of-human, and governed v4 upgrade hook
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

## Governance Runbooks

### Voting engine rotation

Rotating `ContentRegistry.setVotingEngine` or `FrontendRegistry.setVotingEngine` alone does **not** migrate the full protocol stack. Several contracts pin the voting engine at initialization and reject callbacks from a replacement engine with `"Stale engine"` until a coordinated replacement is deployed and rewired.

**Contracts that accept governed engine rotation**

| Contract | Entrypoint | Footgun |
| --- | --- | --- |
| `ContentRegistry` | `setVotingEngine` | In-flight rounds on the previous engine may still settle; fresh content routes through the new engine. Pending public-rating settlements pin both `votingEngine` and `clusterPayoutOracle`. |
| `FrontendRegistry` | `setVotingEngine` | Clears the fee creditor until `initializeFeeCreditor` is called again for the new reward distributor. |

**Contracts that pin engine at init (no governed rotation today)**

- `QuestionRewardPoolEscrow`
- `FeedbackRegistry`
- `FeedbackBonusEscrow`

**Coordinated engine-migration checklist**

1. Pause affected registries and escrows.
2. Deploy the replacement voting engine, reward distributor, and any escrow stacks bound to the new engine.
3. Rewire `ProtocolConfig.setRewardDistributor` (use `replaceRevokedRewardDistributor` when replacing a revoked distributor on the same engine).
4. Call `ContentRegistry.setVotingEngine` and `FrontendRegistry.setVotingEngine`; re-bind the frontend fee creditor.
5. Repoint pinned oracle consumers for in-flight payout work:
   - `QuestionRewardPoolEscrow.repointRewardPoolClusterPayoutOracle`
   - `ContentRegistry.repointPendingRatingClusterPayoutOracle` for pending public-rating settlements
   - `LaunchDistributionPool.rescueStalePendingEarnedRaterCredit` (launch credits)
6. Update off-chain X402 submitter escrow pointers and any keeper/indexer wiring.
7. Unpause only after integration checks pass.

Until the full replacement stack is live, in-flight bounty claims, feedback bonuses, and escrow settlement paths can remain stranded.

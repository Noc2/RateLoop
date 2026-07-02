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

Run `yarn workspace @rateloop/foundry check:sizes` from the monorepo root to verify deployed bytecode stays at or below the 24,576 byte limit. From `packages/foundry`, the same check is available as `make check-contract-sizes`.

Several production contracts run close to the limit. Run `yarn workspace @rateloop/foundry check:sizes` for current numbers. As of June 2026 deploy-profile checks:

| Contract                   | Size (B) | Headroom (B) |
| -------------------------- | -------- | ------------ |
| `LaunchDistributionPool`   | 24,503   | 73           |
| `ContentRegistry`          | 24,202   | 374          |
| `QuestionRewardPoolEscrow` | 23,415   | 1,161        |
| `RoundVotingEngine`        | 24,562   | 14           |
| `RaterRegistry`            | 22,900   | 1,676        |

`ContentRegistry.repointPendingRatingClusterPayoutOracle` is exposed via a thin `CONFIG_ROLE` wrapper; dormancy lifecycle and engine-probing helpers live in `ContentRegistryDormancyLib` to preserve EIP-170 headroom.

Treat new features on these contracts as size-sensitive: prefer library extraction or split contracts before adding bytecode.

**Deploy profile vs default profile:** `yarn workspace @rateloop/foundry check:sizes` and live deploys use the Foundry **deploy** profile (`FOUNDRY_PROFILE=deploy`). A plain `forge build` with the default profile can produce oversize bytecode for `RoundVotingEngine`, `LaunchDistributionPool`, `QuestionRewardPoolEscrow`, and `ContentRegistry` even when deploy-profile artifacts pass EIP-170. Do not use default-profile build artifacts for size gates or production deploys.

**Settlement side effects:** `RoundSettlementSideEffectsLib` records pending public-rating settlements in a try/catch. A failed side effect emits `SettlementSideEffectFailed` but still completes settlement; operators must monitor logs and manually call `recordPendingRatingSettlement` (or repoint/retry tooling) when that event appears. Index or alert on `SettlementSideEffectFailed` from `RoundVotingEngine` as a standing production requirement.

On Base mainnet and Base Sepolia, deploys use a Foundry keystore selected via `--keystore <name>`. Forge can use
Basescan verification when `BASESCAN_API_KEY` is set.

Base mainnet is the current production deployment boundary and its contract addresses should be preserved by default.
Use Base Sepolia for fresh deployment validation before any future production contract or integration change. Do not use
the current `ContentRegistry` implementation as an in-place upgrade for an older proxy unless a separate
migration/backfill is provided for `submissionMediaValidator` and `questionBundleRoundObserverByContent`. Do not use the
current `RaterRegistry` implementation as an in-place upgrade for an older proxy unless a separate migration/backfill is
provided for the `_identityBanSource` to `_identityBanSources` slot-32 retype. The `base-sepolia:check -- --live`
readiness probe verifies the deployed `ContentRegistry.submissionMediaValidator()` exposes the gated-submission
validator selectors before staging is treated as ready. For production wiring or environment changes, run
`base:check -- --live` or `base-mainnet:check -- --live` against the existing Base mainnet deployment.

The deploy wrapper verifies the live RPC chain and stamps Base or World Chain mainnet deploys with the `production`
deployment profile, but checked-in production artifacts no longer block a fresh deployment. Running
`yarn deploy --network base` intentionally broadcasts a replacement production stack and rewrites deployment metadata
from the successful broadcast. Prefer governance/admin rewiring, service configuration, indexing fixes, or app/keeper
changes against the existing Base mainnet deployment whenever those are sufficient. The legacy
`--confirm-production-redeploy <token>` option and `RATELOOP_CONFIRM_PRODUCTION_REDEPLOY=<token>` environment variable
remain accepted for old runbooks, but they are no longer required.

Base and World Chain deploys default to legacy World ID 3.0 Orb verification. The deploy script resolves the canonical
World ID router for chain `8453`, `84532`, `480`, or `4801`, derives the external nullifier from
`NEXT_PUBLIC_WORLD_ID_APP_ID` and `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION`, and fails pre-broadcast if the live router
has no code. World ID 4.0 Proof-of-Human remains governance-configurable on `RaterRegistry`, but production deploys do
not depend on a v4 verifier until that path is tested end-to-end.

## Configuration

Create a `.env` file (see `.env.example`):

| Variable                                 | Description                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ALCHEMY_API_KEY`                        | Optional RPC provider key for testnet/mainnet deploys                                                                        |
| `BASE_RPC_URL`                           | Optional Base mainnet RPC override for live deploys                                                                          |
| `BASE_SEPOLIA_RPC_URL`                   | Optional Base Sepolia RPC override for live deploys                                                                          |
| `WORLDCHAIN_RPC_URL`                     | Optional World Chain mainnet RPC override for live deploys                                                                   |
| `WORLDCHAIN_SEPOLIA_RPC_URL`             | Optional World Chain Sepolia RPC override for live deploys                                                                   |
| `NEXT_PUBLIC_WORLD_ID_APP_ID`            | World ID app ID used to derive the legacy v3 external nullifier                                                              |
| `NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION` | World ID credential action; defaults to `rateloop-human-credential-v1`                                                       |
| `WORLD_ID_ROUTER_ADDRESS`                | Optional explicit World ID v3 router override; nonzero live-network overrides must have code                                 |
| `WORLD_ID_EXTERNAL_NULLIFIER_HASH`       | Optional explicit v3 external nullifier hash override; leave unset to derive from app ID and action                          |
| `RATELOOP_DEPLOYMENT_PROFILE`            | Deployment artifact profile stamp; the deploy wrapper sets `production` for Base/World Chain mainnet and `default` elsewhere |
| `RATELOOP_CONFIRM_PRODUCTION_REDEPLOY`   | Legacy compatibility token accepted by the deploy wrapper; production redeploys no longer require it                         |
| `ETHERSCAN_API_KEY`                      | Optional explorer API key for Etherscan-compatible networks                                                                  |
| `BASESCAN_API_KEY`                       | Optional Basescan API key for Base and Base Sepolia verification                                                             |

Base mainnet (`8453`) resolves router `0xBCC7e5910178AFFEEeBA573ba6903E9869594163` by default. Base Sepolia (`84532`)
resolves router `0x42FF98C4E85212a5D31358ACbFe76a621b50fC02` by default. World Chain mainnet (`480`) and World Chain
Sepolia (`4801`) remain supported legacy deploy targets. Localhost deploys create `MockWorldIDRouter`, wire it into
`RaterRegistry`, and export it in the local deployment JSON.

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
`RoundRewardDistributor`, `ProtocolConfig`, `FrontendRegistry`, `ProfileRegistry`, `RaterRegistry`,
`QuestionRewardPoolEscrow`, `FeedbackBonusEscrow`, `FeedbackRegistry`, and `ConfidentialityEscrow`. Token, payout
oracle, participation, governance, media-validator, submitter, and helper contracts are intentionally non-upgradeable.
For upgradeable implementation contracts, storage layout must be preserved across upgrades — never reorder, remove, or
change types of existing storage variables.

Compiled ABIs and deployed addresses are generated into `packages/contracts/src/` and consumed via the `@rateloop/contracts` workspace package.

## Governance Runbooks

### Launch-credit anchor bans

Launch-credit payout roots are optimistic public artifacts. Before proposing a `ClusterPayoutOracle` root for launch credits, or before allowing one to finalize, operators should recompute the current `LaunchDistributionPool` verified-human anchor state for every pending credit and omit or challenge credits whose current anchors no longer satisfy the configured `launchRewardPolicy.minVerifiedHumans`. The keeper's automatic correlation snapshot builder does this through Ponder's launch-credit candidate/vote endpoints, and `yarn workspace @rateloop/keeper verify:correlation-artifact <artifact.json>` enforces the domain-2 `rewardPoolId=0`, zero-identity-key, flat-weight contract shape for manual artifacts.

When governance bans a verified-human anchor, scan pending launch-credit artifacts for that anchor before proposing or accepting a root. If the fraud is tied to the rater, ban the rater before finalization so the pending credit finalizes to zero through the existing banned-rater path.

### Cluster-pinned reward pool recovery

Cluster-pinned question reward pools and bundle rewards depend on a finalized `ClusterPayoutOracle` root before USDC
or launch-LREP payout weights can be consumed. Normal liveness should come from the keeper proposing/finalizing roots
and proactively calling `qualifyRound` / `syncQuestionBundleTerminals`, not from longer user-facing wait windows.

If a settled cursor round is source-ready and raw-eligible but the pinned oracle has no payout-root proposal, governance
has two recovery choices:

1. **Recover to a replacement oracle:** call `skipPreQualificationSnapshotlessClusterRound(rewardPoolId, roundId)` to
   advance the cursor past the missing snapshot, then call `repointRewardPoolClusterPayoutOracle` or
   `repointQuestionBundleClusterPayoutOracle` before any refund finality. Qualify the round against the replacement
   oracle once its root is finalized.
2. **Refund expired residue:** call `skipPreQualificationSnapshotlessClusterRound(rewardPoolId, roundId)`, then run the
   normal refund path after the existing bounty expiry rules allow it.

Do not refund first if the intent is recovery to a replacement oracle. After `refunded` or `unallocatedRefunded` is set,
the escrow rejects oracle repointing for that reward, and `roundPayoutSnapshotSourceReadyAt` reports `0` for the
refunded pool.

### Voting engine rotation

Rotating `ContentRegistry.setVotingEngine` or `FrontendRegistry.setVotingEngine` alone does **not** migrate the full protocol stack. Several contracts pin the voting engine at initialization and reject callbacks from a replacement engine with `"Stale engine"` until a coordinated replacement is deployed and rewired.

**Contracts that accept governed engine rotation**

| Contract           | Entrypoint        | Footgun                                                                                                                                                                                     |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContentRegistry`  | `setVotingEngine` | In-flight rounds on the previous engine may still settle; fresh content routes through the new engine. Pending public-rating settlements pin both `votingEngine` and `clusterPayoutOracle`. |
| `FrontendRegistry` | `setVotingEngine` | Clears the fee creditor until `addFeeCreditor` binds the new reward distributor; `initializeFeeCreditor` is deploy-time only.                                                               |

**Contracts that pin engine at init (no governed rotation today)**

- `QuestionRewardPoolEscrow`
- `FeedbackRegistry`
- `FeedbackBonusEscrow`

**Coordinated engine-migration checklist**

1. Pause affected registries and escrows.
2. Deploy the replacement voting engine, reward distributor, and any escrow stacks bound to the new engine.
3. Rewire `ProtocolConfig.setRewardDistributor` (use `replaceRevokedRewardDistributor` when replacing a revoked distributor on the same engine).
4. Call `ContentRegistry.setVotingEngine` and `FrontendRegistry.setVotingEngine`; re-bind the frontend fee creditor with `FrontendRegistry.addFeeCreditor`.
5. Repoint pinned oracle consumers for in-flight payout work:
   - `QuestionRewardPoolEscrow.repointRewardPoolClusterPayoutOracle`
   - `QuestionRewardPoolEscrow.repointQuestionBundleClusterPayoutOracle`
   - `ContentRegistry.repointPendingRatingClusterPayoutOracle` for pending public-rating settlements
   - `LaunchDistributionPool.rescueStalePendingEarnedRaterCredit` (launch credits)
6. Update off-chain X402 submitter escrow pointers and any keeper/indexer wiring.
7. Unpause only after integration checks pass.

Until the full replacement stack is live, in-flight bounty claims, feedback bonuses, and escrow settlement paths can remain stranded.

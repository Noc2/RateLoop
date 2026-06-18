# RateLoop — Ponder (Indexer & API)

On-chain event indexer built with [Ponder](https://ponder.sh/). Listens to smart contract events, stores processed data including correlation payout snapshots, and exposes a REST API on port 42069 for consumption by the frontend, agent, and AI/MCP adapters.

## Quick Start

```bash
# From the monorepo root:
cp packages/ponder/.env.example packages/ponder/.env.local
# Edit packages/ponder/.env.local with your RPC URL and network selection

yarn ponder:dev     # Development mode with file watching + auto-recovery, terminal UI disabled
yarn ponder:start   # Production mode (no file watching)
yarn ponder:codegen # Regenerate TypeScript types from schema
```

Requires a running chain (local via `yarn chain` or a configured testnet RPC).

## Scripts

| Command               | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `yarn ponder:dev`     | Development mode with crash recovery and terminal UI disabled |
| `yarn ponder:start`   | Production mode                                               |
| `yarn ponder:codegen` | Generate types from `ponder.schema.ts`                        |

Within the package directory, additional scripts are available:

| Command        | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `yarn dev:raw` | Development mode without recovery wrapper, terminal UI disabled |
| `yarn dev:ui`  | Development mode with Ponder's live terminal UI enabled         |
| `yarn serve`   | Run API only (no indexing)                                      |

## Configuration

| Variable                                   | Description                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `PONDER_NETWORK`                           | Active network: `hardhat`, `baseSepolia`, `base`, `worldchainSepolia`, or `worldchain`                                      |
| `PONDER_CHAIN_ID`                          | Optional explicit chain ID; must match `PONDER_NETWORK` when both are set. Used by `yarn ponder:start` for protocol deployment keys and Postgres schema selection when unset defaults from the network name |
| `PONDER_RPC_URL_31337`                     | RPC URL for local Hardhat/Anvil chain                                                                                       |
| `PONDER_RPC_URL_84532`                     | RPC URL for Base Sepolia                                                                                                    |
| `PONDER_RPC_URL_8453`                      | RPC URL for Base mainnet                                                                                                    |
| `PONDER_RPC_URL_4801`                      | RPC URL for World Chain Sepolia                                                                                             |
| `PONDER_RPC_URL_480`                       | RPC URL for World Chain mainnet                                                                                             |
| `PONDER_CONTENT_REGISTRY_ADDRESS` etc.     | Local Hardhat address overrides; ignored for supported live chains that have shared deployment metadata in `@rateloop/contracts` |
| `PONDER_ADVISORY_VOTE_RECORDER_ADDRESS`    | Advisory zero-stake vote recorder address; local override only once deployments are refreshed                               |
| `PONDER_CLUSTER_PAYOUT_ORACLE_ADDRESS`     | Correlation payout oracle address; local-only fallback when the active chain has no shared deployment metadata              |
| `PONDER_CONFIDENTIALITY_ESCROW_ADDRESS`    | Confidentiality escrow address; local-only fallback when the active chain has no shared deployment metadata                |
| `PONDER_CONTENT_REGISTRY_START_BLOCK` etc. | Local-only fallback start blocks when the active chain has no shared deployment metadata                                    |
| `RATELOOP_PONDER_DATABASE_SCHEMA`          | Optional production schema override for Ponder tables; `yarn ponder:start` defaults to a Railway deployment schema, then a protocol deployment schema, then a RateLoop-owned network schema |
| `CORS_ORIGIN`                              | Allowed origins (comma-separated; required in production)                                                                   |
| `RATE_LIMIT_TRUSTED_IP_HEADERS`            | Comma-separated proxy IP headers to trust for API rate limiting in production                                               |
| `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST`          | Comma-separated HTTPS URL prefixes Ponder may fetch for keeper-published payout artifacts                                  |

For live supported chains, Ponder treats `@rateloop/contracts` as the source of truth and ignores stale address/start-block env values.
For local Hardhat/Anvil, Ponder prefers the address env values generated into `packages/ponder/.env.local` so a fresh
`yarn deploy` does not need machine-specific addresses committed to the shared deployment artifact. After `yarn deploy`,
the Foundry deployment script refreshes `packages/ponder/.env.local` to match the deployment target. Local deploys set
`PONDER_NETWORK=hardhat`. The next live rollout starts on Base Sepolia: set `PONDER_NETWORK=baseSepolia` with
`PONDER_RPC_URL_84532`, then move to `PONDER_NETWORK=base` with `PONDER_RPC_URL_8453` only after Base mainnet is
intentionally promoted. World Chain live networks remain supported as `worldchainSepolia` and `worldchain`.

In production, `yarn ponder:start` launches Ponder with an explicit Postgres schema. On Railway, the
launcher uses `RAILWAY_DEPLOYMENT_ID`, matching Ponder's zero-downtime deployment model and keeping new
app builds from colliding with older Ponder app metadata. Outside Railway, the launcher derives a
protocol deployment key from the active chain's `ContentRegistry` and `FeedbackRegistry` addresses, so a
contract redeploy automatically indexes into a fresh schema even if content IDs restart. If neither value
is available and `DATABASE_SCHEMA` is unset or still set to the generic legacy `ponder` value, the launcher
uses network-specific defaults such as `rateloop_ponder_base_sepolia`. To force a specific schema, set
`RATELOOP_PONDER_DATABASE_SCHEMA` to a unique value such as `rateloop_ponder_base_sepolia_v2`.

When the keeper publishes correlation payout artifacts with `KEEPER_CORRELATION_ARTIFACT_STORAGE=file`, set
`PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` to the same public HTTPS prefix as the keeper's
`KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL`. Ponder refuses other HTTPS artifact URLs while building payout proofs.

## Project Structure

```
ponder.config.ts              # Network setup, contract addresses, start blocks
ponder.schema.ts              # Database tables & relationships

src/
├── ContentRegistry.ts        # Content submission & lifecycle events
├── RoundVotingEngine.ts      # Commit, reveal, settle, cancel events
├── RoundRewardDistributor.ts # Reward distribution events
├── QuestionRewardPoolEscrow.ts # Bounty funding, voter claims, and frontend shares
├── ClusterPayoutOracle.ts    # Correlation epoch and round payout snapshot roots
├── FeedbackBonusEscrow.ts    # Feedback bonus pools, awards, and forfeits
├── CategoryRegistry.ts       # Seeded discovery category metadata
├── ProfileRegistry.ts       # Profile update events
├── FrontendRegistry.ts       # Frontend fee events
├── RaterRegistry.ts          # Rater identity, human credential, and follow events
├── LoopReputation.ts         # LREP transfer events
└── api/
    └── index.ts              # REST API routes (Hono)

scripts/
└── devWithRecovery.mjs       # Auto-restart on crash, clears corrupted state
```

ABIs come from `@rateloop/contracts/abis`; the indexer imports the shared package directly.

## API Endpoints

The REST API is built with Hono. Key routes:

| Endpoint                                | Description                                             |
| --------------------------------------- | ------------------------------------------------------- |
| `GET /content`                          | List content with filters and pagination                |
| `GET /content/:id`                      | Single content item                                     |
| `GET /content/by-url?url=...`           | Look up a single content item by URL                    |
| `GET /votes`                            | List votes with filters                                 |
| `GET /question-reward-claim-candidates` | Claimable USDC bounty rounds for a revealed voter       |
| `GET /question-bundle-claim-candidates` | Claimable bundle bounty round sets for a revealed voter |
| `GET /profile/:address`                 | User profile and reputation                             |
| `GET /categories`                       | List content categories                                 |

Bounty tables track gross funding, voter payouts, and the default eligible frontend-operator share separately so API consumers can display both voter rewards and operator fees. Bundle bounties are indexed as round sets: each set records one settled round per bundled question, its allocation, and per-voter claims. Feedback Bonus tables stay separate: they index LREP/USDC pools, awarded feedback hashes, direct voter payments, frontend shares, and treasury forfeits. `feedbackClosesAt` is the requested close from pool funding; `awardDeadline` is the effective payout/forfeit deadline and extends to at least 24 hours after the round becomes terminal. Content submission events now revolve around public context from a URL, images, or YouTube video, so indexers and clients can treat those fields as the canonical entry point for discovery and previews.

Routes `/health` and `/status` are reserved by Ponder.

## Troubleshooting

**Local chain rewind / reset:** `yarn ponder:dev` now auto-recovers once if the local hardhat/anvil chain was reset and the persisted Ponder checkpoint points at a block that no longer exists. It clears `packages/ponder/.ponder/pglite` and retries automatically.

**Production schema collision:** If Railway logs `Schema '<name>' was previously used by a different
Ponder app`, make sure the service uses `yarn start` (via `packages/ponder/railway.toml` or
`yarn ponder:start`) so the launcher injects a deployment-scoped schema. When
`RAILWAY_DEPLOYMENT_ID` is set, the launcher automatically ignores deprecated static overrides such
as `rateloop_ponder_base_sepolia_canary` and uses `railway_<deployment_id>` instead. Remove that
static value from Railway env vars so future deploys stay on the deployment-scoped schema. For
non-Railway deployments without shared deployment artifacts, set
`RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY` or `RATELOOP_PONDER_DATABASE_SCHEMA` to a fresh value.
Only drop the old schema if you are certain it contains no data you need.

**`humanVerifiedCommitCount` backfill:** After deploying schema changes that add
`humanVerifiedCommitCount`, existing Postgres rows default to `0`. Either run a full
Ponder reindex, or backfill from indexed vote rows before relying on keeper
`reveal_failed` hints or dormancy pre-filters on Railway / production:

**Required before mainnet keeper cutover** if the indexer DB was created before the HRC column shipped. Without backfill, `/keeper/work` may omit dormant rounds and `reveal_failed` candidates even though on-chain state is correct.

```sql
UPDATE "<schema>"."round" AS r
SET human_verified_commit_count = COALESCE(v.count, 0),
    has_human_verified_commit = COALESCE(v.count, 0) > 0
FROM (
  SELECT content_id, round_id, COUNT(*)::integer AS count
  FROM "<schema>"."vote"
  WHERE (credential_mask & 8) != 0 AND committed_at > 0
  GROUP BY content_id, round_id
) AS v
WHERE r.content_id = v.content_id AND r.round_id = v.round_id;
```

Replace `<schema>` with your deployment schema (for example `railway_<deployment_id>`).

**PGlite corruption or unrecoverable local state:** If Ponder still crashes or behaves unexpectedly after the retry, clear the local state manually:

```bash
rm -rf packages/ponder/.ponder
```

**BigInt serialization:** Always use `replaceBigInts()` from `"ponder"` before calling `c.json()` in API routes — `JSON.stringify` cannot serialize BigInt values.

**Rate limiting behind proxies:** In production, set `RATE_LIMIT_TRUSTED_IP_HEADERS` only to headers your edge proxy overwrites, such as `x-forwarded-for` on Vercel/Railway behind a trusted proxy or `cf-connecting-ip` on Cloudflare. Non-production routes fall back to a request fingerprint when it is unset; production custom API routes fail closed with `503` until trusted headers are configured.

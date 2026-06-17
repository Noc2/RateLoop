# RateLoop — Keeper (Round Resolution Service)

Stateless service that reveals committed RBTS votes via `revealVoteByCommitKey()` after each epoch, settles eligible rounds via `settleRound()`, finalizes `RevealFailed` rounds after the last grace deadline, sweeps unrevealed-vote cleanup via `processUnrevealedVotes()`, cancels expired rounds, marks dormant content, forfeits expired Feedback Bonus residue, and can optionally sweep frontend fees or publish `ClusterPayoutOracle` snapshot artifacts for a registered frontend operator. In the redeployed tlock model, it also performs deeper AGE/tlock stanza checks against the stored drand metadata before decrypting. Designed for horizontal scaling — multiple instances run independently for redundancy.

## Quick Start

```bash
# From the monorepo root:
cp packages/keeper/.env.example packages/keeper/.env.local
# Edit packages/keeper/.env.local with your RPC URL, chain, and wallet

yarn keeper:dev    # Development mode (with file watching)
yarn keeper:start  # Production mode (long-running service)
```

## Scripts

| Command             | Description                                        |
| ------------------- | -------------------------------------------------- |
| `yarn keeper:dev`   | Development mode with auto-restart on file changes |
| `yarn keeper:start` | Production mode                                    |

## Configuration

Copy `.env.example` to `.env.local` and configure:

For live `CHAIN_ID` values `4801` and `480`, Keeper reads the latest contract addresses from `@rateloop/contracts`.
For local `31337`, address vars override the shared artifact so a fresh Anvil deploy can be used without committing
machine-specific local addresses. Only set address vars on unsupported chains or local Hardhat/Anvil.

| Variable                                          | Default                                                             | Description                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `RPC_URL`                                         | —                                                                   | Blockchain RPC endpoint (required)                                                                                 |
| `CHAIN_ID`                                        | —                                                                   | Network chain ID (required)                                                                                        |
| `VOTING_ENGINE_ADDRESS`                           | Auto-derived for supported chains                                   | Local `31337` override only; live chains require shared deployment artifacts                                       |
| `CONTENT_REGISTRY_ADDRESS`                        | Auto-derived for supported chains                                   | Local `31337` override only; live chains require shared deployment artifacts                                       |
| `ADVISORY_VOTE_RECORDER_ADDRESS`                  | Auto-derived for supported chains                                   | Local `31337` override only; used to reveal and credit zero-stake advisory votes                                   |
| `ROUND_REWARD_DISTRIBUTOR_ADDRESS`                | Auto-derived when frontend-fee sweep is enabled on supported chains | Local `31337` override only; live chains require shared deployment artifacts                                       |
| `FRONTEND_REGISTRY_ADDRESS`                       | Auto-derived when frontend-fee sweep is enabled on supported chains | Local `31337` override only; live chains require shared deployment artifacts                                       |
| `CLUSTER_PAYOUT_ORACLE_ADDRESS`                   | Auto-derived for supported chains                                   | Required when correlation snapshot publication is enabled                                                          |
| `FEEDBACK_BONUS_ESCROW_ADDRESS`                   | Auto-derived for supported chains                                   | Local `31337` override only; used for expired Feedback Bonus residue forfeits                                      |
| `CHAIN_NAME`                                      | Auto-derived from `CHAIN_ID`                                        | Optional human-readable chain label                                                                                |
| `KEYSTORE_ACCOUNT`                                | —                                                                   | Foundry keystore account name (preferred)                                                                          |
| `KEYSTORE_PASSWORD`                               | —                                                                   | Keystore decryption password                                                                                       |
| `KEEPER_PRIVATE_KEY`                              | —                                                                   | Raw private key fallback if no keystore is configured                                                              |
| `KEEPER_INTERVAL_MS`                              | `30000`                                                             | Resolution loop frequency (ms)                                                                                     |
| `KEEPER_WORK_DISCOVERY_PONDER_ENABLED`            | `true`                                                              | Use Ponder `/keeper/work` on non-reconciliation ticks                                                              |
| `KEEPER_WORK_DISCOVERY_RECONCILE_EVERY_TICKS`     | `120`                                                               | Full on-chain content enumeration every N keeper ticks (~60 min at 30s interval)                                   |
| `KEEPER_WORK_DISCOVERY_MAX_CANDIDATES`            | `500`                                                               | Max Ponder work candidates per tick                                                                                |
| `KEEPER_WORK_DISCOVERY_CHAIN_SCAN_PER_TICK`       | `max(10, ceil(maxCandidates / reconcileEveryTicks))` (default `10`) | On Ponder ticks, also process the next N content IDs from a rotating chain cursor                                  |
| `PONDER_BASE_URL`                                 | —                                                                   | Ponder API base URL used to fetch event-indexed vote ciphertext for reveals                                        |
| `KEEPER_LOG_FALLBACK_LOOKBACK_BLOCKS`             | `300000`                                                            | Max blocks the `eth_getLogs` ciphertext fallback scans when Ponder is unavailable or missing a commit              |
| `KEEPER_STARTUP_JITTER_MS`                        | `0`                                                                 | Random startup delay for multi-instance staggering                                                                 |
| `KEEPER_CLEANUP_BATCH_SIZE`                       | `25`                                                                | Max commit window processed per `processUnrevealedVotes()` batch                                                   |
| `KEEPER_FEEDBACK_BONUS_FORFEITS_ENABLED`          | `true`                                                              | Enable permissionless forfeiture of expired Feedback Bonus pools returned by Ponder keeper work discovery          |
| `KEEPER_FEEDBACK_BONUS_FORFEITS_PER_TICK`         | `25`                                                                | Max expired Feedback Bonus pools to forfeit per keeper tick                                                        |
| `KEEPER_FEEDBACK_BONUS_FORFEIT_MIN_AGE_SECONDS`   | `60`                                                                | Extra age after the indexed award deadline before Ponder returns a pool as a forfeit candidate                     |
| `KEEPER_DATABASE_URL`                             | —                                                                   | Optional Postgres URL for keeper-only correlation artifact cache and advisory locks                                |
| `METRICS_ENABLED`                                 | `true`                                                              | Enable Prometheus metrics server                                                                                   |
| `METRICS_BIND_ADDRESS`                            | `127.0.0.1`                                                         | Metrics server bind address                                                                                        |
| `METRICS_PORT`                                    | `9090`                                                              | Metrics server port                                                                                                |
| `LOG_FORMAT`                                      | `json`                                                              | Log format: `json` (production) or `text` (development)                                                            |
| `DORMANCY_PERIOD`                                 | `2592000`                                                           | Dormancy threshold in seconds used for dormant content sweeps                                                      |
| `MIN_GAS_BALANCE_WEI`                             | `10000000000000000`                                                 | Warning threshold for keeper wallet gas balance                                                                    |
| `MAX_GAS_PER_TX`                                  | `2000000`                                                           | Per-transaction gas cap for keeper writes                                                                          |
| `KEEPER_FRONTEND_FEE_ENABLED`                     | `false`                                                             | Enable hosted frontend fee sweep mode                                                                              |
| `KEEPER_FRONTEND_ADDRESS`                         | keeper wallet address                                               | Optional frontend/operator address to claim for. Must match the keeper wallet for fee sweeps to run.               |
| `KEEPER_FRONTEND_FEE_LOOKBACK_ROUNDS`             | `8`                                                                 | Recent-round window per content item to prioritize before backfilling older frontend fees                          |
| `KEEPER_FRONTEND_FEE_RECENT_ROUNDS_PER_TICK`      | `50`                                                                | Max recent frontend-fee content/round slots to scan per keeper tick                                                |
| `KEEPER_FRONTEND_FEE_BACKFILL_ROUNDS_PER_TICK`    | `50`                                                                | Max older frontend-fee content/round slots to scan per keeper tick                                                 |
| `KEEPER_FRONTEND_FEE_WITHDRAW`                    | `true`                                                              | Drive the two-step `FrontendRegistry` fee withdrawal after claiming round fees                                     |
| `KEEPER_CORRELATION_SNAPSHOTS_ENABLED`            | `false`                                                             | Publish/finalize correlation epoch and round payout snapshot artifacts from an eligible or delegated keeper wallet |
| `KEEPER_CORRELATION_SNAPSHOTS_MODE`               | `auto` without an artifact path, otherwise `file`                   | `auto` builds deterministic artifacts from Ponder; `file` reads a prebuilt artifact                                |
| `KEEPER_CORRELATION_ARTIFACT_STORAGE`             | `data-uri` on local `31337`, otherwise `file`                       | Storage for auto-generated artifacts. Use `file` with a public base URL in production                              |
| `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL`     | —                                                                   | Public HTTPS base URL for auto-generated artifact files                                                            |
| `KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR`         | `correlation-artifacts`                                             | Local directory where auto-generated artifact files are written when storage is `file`                             |
| `KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK` | `20`                                                                | Max settled USDC bounty rounds to score per keeper tick                                                            |
| `KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH`       | —                                                                   | JSON file containing deterministic correlation epoch and round payout artifacts for `file` mode                    |

## Docker

```bash
# From the monorepo root (the image needs the shared @rateloop/contracts workspace)
docker build -f packages/keeper/Dockerfile -t rateloop-keeper .
docker run --env-file packages/keeper/.env.local -e METRICS_BIND_ADDRESS=0.0.0.0 -e METRICS_AUTH_TOKEN=<token> -p 9090:9090 rateloop-keeper
```

## Monitoring

- **Prometheus metrics:** `http://localhost:9090/metrics`
- **Health check:** `http://localhost:9090/health`

Key metrics: `keeper_is_running` (gauge), `keeper_wallet_balance_wei` (gauge), `keeper_rounds_settled_total` (counter), `keeper_rounds_cancelled_total` (counter), `keeper_rounds_reveal_failed_finalized_total` (counter), `keeper_unrevealed_cleanup_batches_total` (counter), and `keeper_feedback_bonus_forfeits_total` (counter).

### Reveal-liveness metrics and alerting

A keeper/Ponder/drand outage that outlasts the on-chain reveal grace period lets rounds finalize as `RevealFailed`. Current contracts refund unrevealed voter stakes in that state, but the round loses RBTS scoring and indicates systemic reveal-liveness failure — so reveal liveness is still the keeper signal most worth paging on:

| Metric | Type | Meaning |
| --- | --- | --- |
| `keeper_rounds_awaiting_reveal_quorum` | gauge | Open rounds with commit quorum whose reveal quorum is still unmet |
| `keeper_reveal_grace_seconds_remaining_min` | gauge | Seconds until the most at-risk round becomes finalizable as `RevealFailed` (`-1` = none at risk) |
| `keeper_rounds_reveal_failed_finalized_total` | counter | Rounds this keeper finalized as `RevealFailed` (unrevealed stakes refund, but scoring did not complete) |
| `keeper_reveal_failed_finalize_skipped_total` | counter | Finalizations the keeper refused because its own reveal pipeline was unhealthy that tick |
| `keeper_ponder_ciphertext_fetch_failures_total` | counter | Failed Ponder indexed-ciphertext fetches |
| `keeper_ciphertext_log_fallback_total` | counter | Ciphertexts resolved via the `eth_getLogs` fallback instead of Ponder (Ponder degraded) |
| `keeper_drand_relay_failovers_total` | counter | drand relay failover events (primary relay degraded) |

Suggested Prometheus alert rules:

```yaml
groups:
  - name: rateloop-keeper
    rules:
      - alert: KeeperDown
        expr: time() - keeper_last_successful_run_timestamp > 300
        labels: { severity: page }
      - alert: KeeperRevealGraceExpiring
        # A round is within 15 minutes of RevealFailed finalization.
        expr: keeper_reveal_grace_seconds_remaining_min >= 0 and keeper_reveal_grace_seconds_remaining_min < 900
        labels: { severity: page }
      - alert: KeeperRevealFailedFinalized
        # Any RevealFailed finalization means the reveal path failed; investigate every one.
        expr: increase(keeper_rounds_reveal_failed_finalized_total[1h]) > 0
        labels: { severity: page }
      - alert: KeeperRevealPipelineUnhealthy
        expr: increase(keeper_reveal_failed_finalize_skipped_total[15m]) > 0
        labels: { severity: page }
      - alert: KeeperPonderDegraded
        expr: increase(keeper_ciphertext_log_fallback_total[15m]) > 0
        labels: { severity: warn }
      - alert: KeeperDrandRelayDegraded
        expr: increase(keeper_drand_relay_failovers_total[15m]) > 0
        labels: { severity: warn }
```

When `KEEPER_FRONTEND_FEE_ENABLED=true`, the same worker prioritizes a bounded cursor through recent settled rounds for the configured frontend/operator, then backfills older settled rounds so historical `RoundRewardDistributor.claimFrontendFee(...)` claims do not age out of automation. It can also drive the two-step registry withdrawal: it completes a matured `FrontendRegistry.completeFeeWithdrawal()` first, then moves newly accrued fees into the next pending bucket with `requestFeeWithdrawal()`. Requested amounts stay slashable for the registry's 21-day `FEE_WITHDRAWAL_DELAY` before they can be completed.

When `KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true`, the worker checks that the keeper wallet resolves through `FrontendRegistry.authorizedSnapshotFrontend(...)` to an eligible frontend operator only when a missing/rejected proposal slot actually needs a proposal. The keeper wallet can be the registered frontend wallet itself, or a separate operational wallet assigned by that frontend operator. The worker proposes missing correlation epoch and round payout roots from the keeper wallet and finalizes already-proposed roots after the challenge window. In `auto` mode it first preflights on-chain status so already-proposed/finalized snapshots do not rebuild artifacts, then asks Ponder for settled USDC bounty rounds only when proposal data is needed, builds deterministic payout weights with `@rateloop/node-utils/correlationScoring` (question-reward weights use a surprise-weighted base weight in `[10_000, 20_000]` bps; launch-credit weights stay flat), stores the public artifact, and publishes the roots. In `file` mode it reads the same artifact shape from `KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH`.

Set `KEEPER_DATABASE_URL` to enable optional keeper persistence. The keeper creates a small `keeper_correlation_artifacts` table for automatic correlation artifact cache rows and uses a Postgres advisory lock to prevent overlapping Railway replicas or deployments from doing the same publication work at the same time. If the database is unavailable, the keeper logs a warning once and falls back to the existing stateless behavior; on-chain status checks still prevent duplicate proposals.

For `yarn dev:stack` on local `31337`, set `KEEPER_CORRELATION_SNAPSHOTS_ENABLED=true`, `KEEPER_CORRELATION_SNAPSHOTS_MODE=auto`, and `KEEPER_CORRELATION_ARTIFACT_STORAGE=data-uri` in `packages/keeper/.env.local`; keep `PONDER_BASE_URL=http://localhost:42069`. Before starting the stack, run `yarn chain`, `yarn deploy`, register the frontend operator, and either run the keeper from that registered wallet or set a separate unregistered keeper address in frontend settings. For production, deploy contracts, Ponder, Next.js, and the keeper; register the production frontend operator; set `KEEPER_CORRELATION_ARTIFACT_STORAGE=file`, `KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR` to a persistent directory, and `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` to the keeper's public `/correlation-artifacts` route or another public HTTPS artifact host. Set Ponder's `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST` to the same HTTPS prefix so claim-proof routes can fetch the keeper-published artifacts. The operator must keep the 1,000 LREP frontend bond active. Anyone can run the same artifact through the same scorer and challenge mismatched roots on-chain; governance can arbitrate challenged roots and slash the frontend if the computation was wrong.

When the keeper's metrics server is enabled, it serves hash-named artifact files from `KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR` at `/correlation-artifacts/<artifactHash>.json`. Metrics and health requests still use `METRICS_AUTH_TOKEN`; artifact files are public because their URI and hash are published on-chain. On Railway, attach a Postgres database and set the keeper service's `KEEPER_DATABASE_URL` to the Postgres service's `DATABASE_URL` reference for cache/locking. Also mount a volume on the keeper service, point `KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR` at that mount path, expose the keeper service publicly, and use `https://<keeper-domain>/correlation-artifacts` as both `KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL` and Ponder's `PAYOUT_ARTIFACT_HTTPS_ALLOWLIST`. The Postgres cache stores canonical artifact JSON so a cache hit can re-materialize the file on the mounted volume if needed; the volume remains the public artifact store.

### Work discovery liveness

With `KEEPER_WORK_DISCOVERY_PONDER_ENABLED=true` (default), most ticks ask Ponder for up to `KEEPER_WORK_DISCOVERY_MAX_CANDIDATES` urgent items **per category** (open rounds, cleanup hints, dormancy, Feedback Bonus forfeits — up to ~4× the limit per response). Content outside those capped sets would otherwise wait until the next full chain reconciliation (`KEEPER_WORK_DISCOVERY_RECONCILE_EVERY_TICKS`, default 120 ticks). Each Ponder tick also advances a bounded chain scan: `KEEPER_WORK_DISCOVERY_CHAIN_SCAN_PER_TICK` content IDs from a rotating cursor (default `max(10, ceil(500/120)) = 10`), so every registered content ID is visited periodically even when Ponder prioritization is saturated.

In production, set matching `PONDER_KEEPER_WORK_TOKEN` on Ponder and the keeper. The keeper fails the tick when Ponder rejects `/keeper/work` auth in production instead of silently falling back to chain enumeration.

Historical round cleanup discovery (`discoverCleanupCandidate`) runs on every processed content ID, not only on reconciliation ticks. Ponder may still surface cleanup hints via `/keeper/work`; the keeper also walks one historical round per content per tick on-chain.

### Dormancy: Ponder pre-filter vs on-chain `markDormant`

Ponder `/keeper/work` applies SQL pre-filters (bundle guards, open-round checks, `lastActivityAt`) before returning dormant candidates. The keeper still re-reads `ContentRegistry.contents` and calls `markDormant` only when its local pre-check passes; the contract gates on `dormancyAnchorAt` and rejects bundled content. Benign extra `markDormant` attempts are expected when Ponder and chain state diverge slightly — failed broadcasts are skipped via gas estimation without spending gas.

## Project Structure

```
src/
├── index.ts      # Main entry point & event loop
├── keeper.ts     # Core logic (reveal, settle, RevealFailed, cleanup, dormancy)
├── correlation-artifact-builder.ts # Ponder-backed automatic ClusterPayoutOracle artifacts
├── correlation-artifact-storage.ts # Canonical artifact hashing and storage
├── correlation-snapshots.ts # Optional ClusterPayoutOracle publication
├── frontend-fees.ts # Optional hosted frontend fee sweeps
├── keeper-state.ts # Optional Postgres cache and advisory locks
├── config.ts     # Configuration from environment
├── client.ts     # viem public & wallet clients
├── keystore.ts   # Foundry keystore decryption
├── logger.ts     # Structured logging
├── metrics.ts    # Prometheus metrics server
└── revert-utils.ts # Shared revert decoding helpers
```

Contract ABIs and deployment metadata are imported from the shared `@rateloop/contracts` workspace package.

## Redundancy

Run 2+ instances with different wallet addresses and set `KEEPER_STARTUP_JITTER_MS=15000` to stagger execution cycles. Duplicate settle/finalize/cleanup transactions revert harmlessly — already-processed rounds fail silently on-chain.

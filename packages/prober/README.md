# RateLoop — Prober (AI Rater Probe Service)

Standalone TypeScript service that watches `RaterDeclarationRegistry` for pending AI rater probes, runs a detector pipeline, hashes probe metadata, records probe results on-chain, and can optionally flag behavioral drift. The initial detector is intentionally deterministic and metadata-only so the service can be wired, tested, and monitored without live LLM or Python dependencies.

## Quick Start

```bash
# Copy and configure environment:
cp packages/prober/.env.example packages/prober/.env.local

# From the monorepo root:
yarn prober:dev
yarn prober:start
```

## Scripts

| Command             | Description                                        |
| ------------------- | -------------------------------------------------- |
| `yarn prober:dev`   | Development mode with auto-restart on file changes |
| `yarn prober:start` | Production mode                                    |

## How It Works

1. Resolve the shared `RaterDeclarationRegistry` deployment for the configured chain.
2. Rebuild a pending-probe queue from on-chain `DeclarationSubmitted` and recent `ProbeRequested` events.
3. Read `getDeclaration(...)` and `getLatestProbeResult(...)` for queued raters.
4. Run the detector pipeline behind a small adapter boundary.
5. Hash the resulting artifact payload, log/store the artifact metadata, and call `recordProbeResult(...)`.
6. Optionally call `flagBehavioralDrift(...)` if a detector emits a non-zero drift score.

The default `mock` detector only inspects declaration metadata. It is suitable for integration and rehearsal, not for production-grade behavioral verification.

## Configuration

Copy `.env.example` to `.env.local` and configure:

For live `CHAIN_ID` values `4801` and `480`, Prober reads the latest contract address from `@rateloop/contracts`.
For local `31337`, `RATER_DECLARATION_REGISTRY_ADDRESS` can override the shared artifact so a fresh deploy can be used without committing machine-specific local addresses.

| Variable                              | Default                                                             | Description                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RPC_URL`                             | —                                                                   | Blockchain RPC endpoint (required)                                                            |
| `CHAIN_ID`                            | —                                                                   | Network chain ID (required)                                                                   |
| `RATER_DECLARATION_REGISTRY_ADDRESS`  | Auto-derived for supported chains                                   | Local `31337` override only; live chains require shared deployment artifacts                  |
| `PROBER_START_BLOCK`                  | Shared deployment start block                                       | Optional override for declaration/event scanning start block                                  |
| `CHAIN_NAME`                          | Auto-derived from `CHAIN_ID`                                        | Optional human-readable chain label                                                           |
| `KEYSTORE_ACCOUNT`                    | `prober`                                                            | Foundry keystore account name (preferred)                                                     |
| `KEYSTORE_PASSWORD`                   | —                                                                   | Keystore decryption password                                                                  |
| `PROBER_PRIVATE_KEY`                  | —                                                                   | Raw private key fallback if no keystore is configured                                         |
| `PROBER_ROLE_WALLET`                  | signer address                                                      | Optional role assertion; when set it must match the configured signer                         |
| `PROBER_INTERVAL_MS`                  | `30000`                                                             | Probe loop frequency (ms)                                                                     |
| `PROBER_STARTUP_JITTER_MS`            | `0`                                                                 | Random startup delay for multi-instance staggering                                            |
| `PROBER_RECENT_BLOCK_LOOKBACK`        | `5000`                                                              | Recent block window used to prioritize fresh `ProbeRequested` events                          |
| `PROBER_DECLARATION_SCAN_BATCH_BLOCKS`| `2000`                                                              | Historical `DeclarationSubmitted` scan batch size                                             |
| `PROBER_MAX_CANDIDATES_PER_TICK`      | `10`                                                                | Max pending raters processed per loop                                                         |
| `PROBER_DETECTOR_KIND`                | `mock`                                                              | Detector pipeline implementation                                                              |
| `PROBER_DETECTOR_BUNDLE_HASH`         | —                                                                   | Bytes32 identifier for the detector bundle (required)                                         |
| `PROBER_PROBE_LIBRARY_HASH`           | —                                                                   | Bytes32 identifier recorded on-chain with `recordProbeResult(...)` (required)                 |
| `METRICS_ENABLED`                     | `true`                                                              | Enable Prometheus metrics server                                                              |
| `METRICS_BIND_ADDRESS`                | `127.0.0.1`                                                         | Metrics server bind address                                                                   |
| `METRICS_PORT`                        | `9091`                                                              | Metrics server port                                                                           |
| `LOG_FORMAT`                          | `json`                                                              | Log format: `json` (production) or `text` (development)                                       |
| `MIN_GAS_BALANCE_WEI`                 | `10000000000000000`                                                 | Warning threshold for prober wallet gas balance                                               |
| `MAX_GAS_PER_TX`                      | `750000`                                                            | Per-transaction gas cap for prober writes                                                     |

## Monitoring

- **Prometheus metrics:** `http://localhost:9091/metrics`
- **Health check:** `http://localhost:9091/health`

Key metrics: `prober_is_running` (gauge), `prober_probe_results_recorded_total` (counter), `prober_drift_flags_recorded_total` (counter), `prober_pending_candidates` (gauge), `prober_last_scanned_block` (gauge).

## Project Structure

```text
src/
├── index.ts        # Main entry point & event loop
├── prober.ts       # Core probe logic and contract writes
├── registry.ts     # Registry reads, role validation, and candidate tracker
├── detectors/      # Detector pipeline and current mock detector
├── artifacts.ts    # Deterministic artifact hashing and storage boundary
├── config.ts       # Configuration from environment
├── client.ts       # viem public & wallet clients
├── keystore.ts     # Foundry keystore decryption
├── logger.ts       # Structured logging
├── metrics.ts      # Prometheus metrics server
└── types.ts        # Shared types
```

Contract ABIs and deployment metadata are imported from the shared `@rateloop/contracts` workspace package.

## Redundancy

Run 2+ instances with different wallets and set `PROBER_STARTUP_JITTER_MS=15000` to stagger execution cycles. Duplicate probe transactions should converge through `probePending` state and on-chain version checks.

/**
 * RateLoop Prober — standalone stateless AI rater probe service.
 *
 * Watches declaration state, runs a detector pipeline, stores deterministic artifact metadata,
 * records probe results, and can optionally flag behavioral drift.
 */
import { buildDetectorPipeline } from "./detectors/index.js";
import { createLogArtifactStore } from "./artifacts.js";
import { config } from "./config.js";
import { chain, getAccount, getWalletClient, publicClient, validateProberConnectivity } from "./client.js";
import { createLogger } from "./logger.js";
import {
  getConsecutiveErrors,
  recordError,
  recordRun,
  setGauge,
  setHealthThreshold,
  startMetricsServer,
} from "./metrics.js";
import { runProberCycle } from "./prober.js";
import { createPendingProbeTracker, validateProberContracts } from "./registry.js";

const logger = createLogger(config.logFormat);

async function main() {
  const account = getAccount();
  if (config.roleWallet && config.roleWallet.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `PROBER_ROLE_WALLET ${config.roleWallet} does not match the configured signer ${account.address}.`,
    );
  }

  logger.info("Prober starting", {
    chain: config.chainName,
    chainId: config.chainId,
    account: account.address,
    roleWallet: config.roleWallet ?? account.address,
    raterDeclarationRegistry: config.contracts.raterDeclarationRegistry,
    intervalMs: config.intervalMs,
    metricsEnabled: config.metricsEnabled,
    detectorKind: config.detectorKind,
    detectorBundleHash: config.detectorBundleHash,
    probeLibraryHash: config.probeLibraryHash,
    startBlock: config.startBlock,
  });

  await validateProberConnectivity(publicClient);
  await validateProberContracts(publicClient, config.contracts.raterDeclarationRegistry, account.address);
  logger.info("Prober contract connectivity verified");

  const walletClient = getWalletClient();
  const tracker = createPendingProbeTracker(config, logger);
  const detectorPipeline = buildDetectorPipeline({
    detectorKind: config.detectorKind,
  });
  const artifactStore = createLogArtifactStore(logger);

  let metricsServer: ReturnType<typeof startMetricsServer> | undefined;
  if (config.metricsEnabled) {
    setHealthThreshold(config.intervalMs);
    metricsServer = startMetricsServer(config.metricsPort, config.metricsBindAddress);
    logger.info("Metrics server started", {
      port: config.metricsPort,
      bindAddress: config.metricsBindAddress,
      endpoints: ["/metrics", "/health"],
    });
  }

  if (config.startupJitterMs > 0) {
    const jitter = Math.floor(Math.random() * config.startupJitterMs);
    logger.info("Startup jitter", { delayMs: jitter });
    await new Promise(resolve => setTimeout(resolve, jitter));
  }

  let isRunning = false;
  let shuttingDown = false;
  const minBalance = BigInt(config.minGasBalanceWei);

  async function updateOperationalGauges() {
    try {
      const balance = await publicClient.getBalance({ address: account.address });
      setGauge("prober_wallet_balance_wei", Number(balance));

      if (balance < minBalance) {
        logger.warn("Prober wallet balance low", {
          balance: balance.toString(),
          minRequired: minBalance.toString(),
        });
      }
    } catch (error) {
      logger.warn("Failed to check prober wallet balance", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function tick() {
    if (isRunning || shuttingDown) return;
    isRunning = true;
    setGauge("prober_is_running", 1);
    const start = Date.now();

    try {
      await updateOperationalGauges();

      const result = await runProberCycle({
        publicClient,
        walletClient,
        chain,
        account,
        logger,
        tracker,
        detectorPipeline,
        artifactStore,
      });
      const duration = Date.now() - start;

      setGauge("prober_last_scanned_block", Number(result.lastScannedBlock));
      setGauge("prober_latest_block", Number(result.latestBlock));
      setGauge("prober_pending_candidates", result.pendingCount);
      recordRun(result, duration);

      if (
        result.candidatesDiscovered > 0 ||
        result.candidatesProcessed > 0 ||
        result.candidatesSkipped > 0 ||
        result.failedDetections > 0
      ) {
        logger.info("Run complete", {
          ...result,
          durationMs: duration,
        });
      }
    } catch (error: any) {
      recordError();
      logger.error("Run failed", {
        error: error.message,
        consecutiveErrors: getConsecutiveErrors(),
      });
    } finally {
      isRunning = false;
      setGauge("prober_is_running", 0);
    }
  }

  await tick();
  const intervalId = setInterval(tick, config.intervalMs);
  const shutdownTimeoutMs = 30_000;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    clearInterval(intervalId);

    if (isRunning) {
      logger.info("Waiting for in-flight tick to complete...");
      const deadline = Date.now() + shutdownTimeoutMs;
      while (isRunning && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (isRunning) {
        logger.warn("Shutdown timeout — forcing exit with tick still running");
      }
    }

    metricsServer?.close();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(error => {
  logger.error("Fatal error", { error: error.message });
  process.exit(1);
});

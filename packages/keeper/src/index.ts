/**
 * RateLoop Keeper — standalone stateless round settlement service.
 *
 * Iterates on-chain content, reveals tlock votes, settles or reveal-fails eligible rounds,
 * cleans up unrevealed terminal-round commits, cancels expired rounds, sweeps dormant content,
 * and forfeits expired Feedback Bonus residue.
 *
 * Usage:
 *   npx tsx src/index.ts        # start the keeper loop
 *   npx tsx watch src/index.ts  # restart on file changes (dev)
 */
import { zeroAddress } from "viem";
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import {
  publicClient,
  getWalletClient,
  getAccount,
  chain,
  validateKeeperConnectivity,
} from "./client.js";
import {
  resolveRounds,
  validateKeeperContracts,
  type KeeperResult,
  type KeeperRunContext,
} from "./keeper.js";
import { claimConfiguredFrontendFees } from "./frontend-fees.js";
import { publishConfiguredCorrelationSnapshots } from "./correlation-snapshots.js";
import { closeKeeperState, runWithKeeperMainLoopLock } from "./keeper-state.js";
import {
  startMetricsServer,
  setHealthThreshold,
  recordRun,
  recordError,
  setGauge,
  incrementCounter,
  setWalletBalanceWei,
  getConsecutiveErrors,
} from "./metrics.js";

const logger = createLogger(config.logFormat);

function emptyKeeperResult(): KeeperResult {
  return {
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    advisoryVotesRevealed: 0,
    advisoryLaunchCreditsClaimed: 0,
    cleanupBatchesProcessed: 0,
    contentMarkedDormant: 0,
    feedbackBonusPoolsForfeited: 0,
    roundsAwaitingRevealQuorum: 0,
    minRevealGraceSecondsRemaining: null,
  };
}

async function main() {
  const account = getAccount();
  logger.info("Keeper starting", {
    chain: config.chainName,
    chainId: config.chainId,
    account: account.address,
    votingEngine: config.contracts.votingEngine,
    contentRegistry: config.contracts.contentRegistry,
    intervalMs: config.intervalMs,
    metricsEnabled: config.metricsEnabled,
    persistenceEnabled: Boolean(config.persistence?.databaseUrl),
    frontendFeesEnabled: config.frontendFees.enabled,
    frontendFeeAddress: config.frontendFees.frontendAddress ?? account.address,
    correlationSnapshotsEnabled: config.correlationSnapshots.enabled,
    feedbackBonusForfeitsEnabled: config.feedbackBonusForfeits.enabled,
    feedbackBonusEscrow: config.contracts.feedbackBonusEscrow,
  });

  await validateKeeperConnectivity(publicClient);
  const feedbackBonusEscrowForValidation =
    config.feedbackBonusForfeits.enabled &&
    config.contracts.feedbackBonusEscrow !== zeroAddress
      ? config.contracts.feedbackBonusEscrow
      : undefined;
  if (feedbackBonusEscrowForValidation) {
    await validateKeeperContracts(
      publicClient,
      config.contracts.votingEngine,
      config.contracts.contentRegistry,
      feedbackBonusEscrowForValidation,
    );
  } else {
    await validateKeeperContracts(
      publicClient,
      config.contracts.votingEngine,
      config.contracts.contentRegistry,
    );
  }
  logger.info("Keeper contract connectivity verified");

  const walletClient = getWalletClient();

  // Start metrics server
  let metricsServer: ReturnType<typeof startMetricsServer> | undefined;
  if (config.metricsEnabled) {
    setHealthThreshold(config.intervalMs);
    metricsServer = startMetricsServer(
      config.metricsPort,
      config.metricsBindAddress,
      config.metricsAuthToken,
      {
        artifactDirectory:
          config.correlationSnapshots.artifactStorage.mode === "file"
            ? config.correlationSnapshots.artifactStorage.outputDir
            : null,
      },
    );
    logger.info("Metrics server started", {
      port: config.metricsPort,
      bindAddress: config.metricsBindAddress,
      endpoints: [
        "/live",
        "/metrics",
        "/health",
        "/correlation-artifacts/:artifactHash.json",
      ],
    });
  }

  // Startup jitter for redundancy staggering
  if (config.startupJitterMs > 0) {
    const jitter = Math.floor(Math.random() * config.startupJitterMs);
    logger.info("Startup jitter", { delayMs: jitter });
    await new Promise((r) => setTimeout(r, jitter));
  }

  // --- Run loop ---
  let isRunning = false;
  let shuttingDown = false;

  const MIN_BALANCE = BigInt(config.minGasBalanceWei);

  async function updateOperationalGauges() {
    const balanceResult = await publicClient
      .getBalance({ address: account.address })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );

    if (balanceResult.status === "fulfilled") {
      const balance = balanceResult.value;
      // Keeps the exact bigint for /health; the Prometheus gauge is a float64
      // approximation. The low-balance check below stays on the exact bigint.
      setWalletBalanceWei(balance);
      if (balance < MIN_BALANCE) {
        logger.warn("Keeper wallet balance low", {
          balance: balance.toString(),
          minRequired: MIN_BALANCE.toString(),
        });
      }
    } else {
      logger.warn("Failed to check wallet balance", {
        error: balanceResult.reason?.message || String(balanceResult.reason),
      });
    }
  }

  async function tick() {
    if (isRunning || shuttingDown) return;
    isRunning = true;
    setGauge("keeper_is_running", 1);
    const start = Date.now();

    try {
      await updateOperationalGauges();

      let mainLoopRan = false;
      const mainLoopResult = await runWithKeeperMainLoopLock(
        logger,
        { result: emptyKeeperResult(), frontendFeeResult: null },
        async () => {
          mainLoopRan = true;
          const runContext: KeeperRunContext = {};
          const result = await resolveRounds(
            publicClient,
            walletClient,
            chain,
            account,
            logger,
            runContext,
          );
          const frontendFeeResult = config.frontendFees.enabled
            ? await claimConfiguredFrontendFees(
                publicClient,
                walletClient,
                chain,
                account,
                logger,
                { chainTimestamp: runContext.blockTimestamp },
              )
            : null;
          return { result, frontendFeeResult };
        },
      );
      if (!mainLoopRan) {
        incrementCounter("keeper_main_loop_lock_skips_total");
      }

      const { result, frontendFeeResult } = mainLoopResult;
      const correlationSnapshotResult = config.correlationSnapshots.enabled
        ? await publishConfiguredCorrelationSnapshots(
            publicClient,
            walletClient,
            chain,
            account,
            logger,
          )
        : null;
      const duration = Date.now() - start;
      recordRun(result, duration);

      // Log summary only when something happened — include every KeeperResult counter
      // so ticks that only finalize reveal-failed rounds or process cleanup batches
      // still produce a "Run complete" log.
      const total =
        result.roundsSettled +
        result.roundsCancelled +
        result.roundsRevealFailedFinalized +
        result.votesRevealed +
        result.advisoryVotesRevealed +
        result.advisoryLaunchCreditsClaimed +
        result.cleanupBatchesProcessed +
        result.contentMarkedDormant +
        result.feedbackBonusPoolsForfeited;
      if (total > 0) {
        logger.info("Run complete", { ...result, durationMs: duration });
      }
      if (
        frontendFeeResult &&
        (frontendFeeResult.roundsClaimed > 0 ||
          frontendFeeResult.withdrawals > 0 ||
          frontendFeeResult.withdrawalRequests > 0)
      ) {
        logger.info("Frontend fee sweep complete", {
          frontendAddress: frontendFeeResult.frontendAddress,
          roundsClaimed: frontendFeeResult.roundsClaimed,
          withdrawals: frontendFeeResult.withdrawals,
          withdrawnAmount: frontendFeeResult.withdrawnAmount.toString(),
          withdrawalRequests: frontendFeeResult.withdrawalRequests,
          requestedAmount: frontendFeeResult.requestedAmount.toString(),
        });
      }
      if (
        correlationSnapshotResult &&
        (correlationSnapshotResult.epochsProposed > 0 ||
          correlationSnapshotResult.epochsFinalized > 0 ||
          correlationSnapshotResult.roundSnapshotsProposed > 0 ||
          correlationSnapshotResult.roundSnapshotsFinalized > 0)
      ) {
        logger.info("Correlation snapshot publication complete", {
          ...correlationSnapshotResult,
        });
      }
    } catch (err: any) {
      recordError();
      logger.error("Run failed", {
        error: err.message,
        consecutiveErrors: getConsecutiveErrors(),
      });
    } finally {
      isRunning = false;
      setGauge("keeper_is_running", 0);
    }
  }

  // Initial run
  await tick();

  // Interval
  const intervalId = setInterval(tick, config.intervalMs);

  // Graceful shutdown — wait for in-flight tick to finish
  const SHUTDOWN_TIMEOUT_MS = 30_000;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    clearInterval(intervalId);

    if (isRunning) {
      logger.info("Waiting for in-flight tick to complete...");
      const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
      while (isRunning && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (isRunning) {
        logger.warn("Shutdown timeout — forcing exit with tick still running");
      }
    }

    metricsServer?.close();
    await closeKeeperState();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error", { error: err.message });
  process.exit(1);
});

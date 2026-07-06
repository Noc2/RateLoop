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
import { ClusterPayoutOracleAbi } from "@rateloop/contracts/abis";
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
  recordMainLoopLockSkip,
  recordError,
  recordCorrelationSnapshotResult,
  recordPayoutFinalityLaunchBudgetConfigViolation,
  setGauge,
  setWalletBalanceWei,
  getConsecutiveErrors,
} from "./metrics.js";

const logger = createLogger(config.logFormat);
const LOCAL_CHAIN_IDS = new Set([31337]);
const LAUNCH_PAYOUT_FINALITY_BUDGET_SECONDS = 60 * 60;

async function validatePayoutFinalityLaunchBudget() {
  if (!config.correlationSnapshots.enabled) return;

  const [challengeWindow, finalizationVetoWindow] = await Promise.all([
    publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "challengeWindow",
    }) as Promise<bigint>,
    publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "FINALIZATION_VETO_WINDOW",
    }) as Promise<bigint>,
  ]);
  const opsLagBudget = BigInt(config.payoutFinality.opsLagBudgetSeconds);
  const challengeMultiplier = config.payoutFinality.overlapProof ? 1n : 2n;
  const configuredBudget =
    challengeWindow * challengeMultiplier + finalizationVetoWindow + opsLagBudget;
  const budgetData = {
    formula: config.payoutFinality.overlapProof
      ? "challengeWindow + finalizationVetoWindow + opsLagBudget"
      : "2 * challengeWindow + finalizationVetoWindow + opsLagBudget",
    challengeWindowSeconds: challengeWindow.toString(),
    finalizationVetoWindowSeconds: finalizationVetoWindow.toString(),
    opsLagBudgetSeconds: opsLagBudget.toString(),
    overlapProof: config.payoutFinality.overlapProof,
    configuredBudgetSeconds: configuredBudget.toString(),
    launchBudgetSeconds: LAUNCH_PAYOUT_FINALITY_BUDGET_SECONDS,
    maxHealthyPathSeconds: config.payoutFinality.maxHealthyPathSeconds,
  };
  logger.info("Payout finality launch budget checked", budgetData);

  if (
    !LOCAL_CHAIN_IDS.has(config.chainId) &&
    config.payoutFinality.maxHealthyPathSeconds !== null &&
    configuredBudget > BigInt(config.payoutFinality.maxHealthyPathSeconds)
  ) {
    recordPayoutFinalityLaunchBudgetConfigViolation();
    throw new Error(
      `Configured payout finality budget exceeds launch policy: ${configuredBudget}s > ${config.payoutFinality.maxHealthyPathSeconds}s`,
    );
  }

  if (
    !LOCAL_CHAIN_IDS.has(config.chainId) &&
    config.payoutFinality.maxHealthyPathSeconds === null &&
    configuredBudget > BigInt(LAUNCH_PAYOUT_FINALITY_BUDGET_SECONDS)
  ) {
    logger.warn(
      "Payout finality launch budget exceeds the one-hour target; continuing because no hard cap is configured",
      budgetData,
    );
  }
}

function emptyKeeperResult(): KeeperResult {
  return {
    roundsOpened: 0,
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    advisoryVotesRevealed: 0,
    advisoryLaunchCreditsClaimed: 0,
    cleanupBatchesProcessed: 0,
    rewardPoolRoundsQualified: 0,
    questionBundleTerminalSyncs: 0,
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
  await validatePayoutFinalityLaunchBudget();

  const walletClient = getWalletClient();

  // Start the keeper HTTP server. Hosted deployments still need /live when
  // detailed metrics are disabled.
  let metricsServer: ReturnType<typeof startMetricsServer> | undefined;
  if (config.metricsEnabled || config.livenessEnabled) {
    const artifactDirectory =
      config.metricsEnabled && config.correlationSnapshots.artifactStorage.mode === "file"
        ? config.correlationSnapshots.artifactStorage.outputDir
        : null;
    const endpoints = config.metricsEnabled
      ? [
          "/live",
          "/metrics",
          "/health",
          "/correlation-artifacts/:artifactHash.json",
        ]
      : ["/live"];
    setHealthThreshold(config.intervalMs);
    metricsServer = startMetricsServer(
      config.metricsPort,
      config.metricsBindAddress,
      config.metricsAuthToken,
      {
        artifactDirectory,
        metricsEnabled: config.metricsEnabled,
      },
    );
    logger.info(config.metricsEnabled ? "Metrics server started" : "Liveness server started", {
      port: config.metricsPort,
      bindAddress: config.metricsBindAddress,
      endpoints,
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
        { result: emptyKeeperResult(), frontendFeeResult: null, correlationSnapshotResult: null },
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
          const correlationSnapshotResult = config.correlationSnapshots.enabled
            ? await publishConfiguredCorrelationSnapshots(
                publicClient,
                walletClient,
                chain,
                account,
                logger,
                {
                  ponderNowSeconds: runContext.blockTimestamp,
                },
              )
            : null;
          return { result, frontendFeeResult, correlationSnapshotResult };
        },
        { lockRequired: config.persistence.mainLoopLockRequired },
      );
      if (!mainLoopRan) {
        recordMainLoopLockSkip(Date.now() - start);
        return;
      }

      const { result, frontendFeeResult, correlationSnapshotResult } = mainLoopResult;
      const duration = Date.now() - start;
      recordRun(result, duration);
      if (correlationSnapshotResult) {
        recordCorrelationSnapshotResult(correlationSnapshotResult);
      }

      // Log summary only when something happened — include every KeeperResult counter
      // so ticks that only finalize reveal-failed rounds or process cleanup batches
      // still produce a "Run complete" log.
      const total =
        result.roundsOpened +
        result.roundsSettled +
        result.roundsCancelled +
        result.roundsRevealFailedFinalized +
        result.votesRevealed +
        result.advisoryVotesRevealed +
        result.advisoryLaunchCreditsClaimed +
        result.cleanupBatchesProcessed +
        result.rewardPoolRoundsQualified +
        result.questionBundleTerminalSyncs +
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

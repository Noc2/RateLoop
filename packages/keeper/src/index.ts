import { config } from "./config.js";
import {
  chain,
  closeKeeperSigningLedger,
  getAccount,
  getWalletClient,
  publicClient,
  validateKeeperConnectivity,
  validateKeeperSigner,
} from "./client.js";
import {
  runTokenlessKeeper,
  validateTokenlessKeeperDeployment,
  type TokenlessKeeperClients,
} from "./keeper.js";
import { createLogger } from "./logger.js";
import {
  getConsecutiveErrors,
  recordError,
  recordRun,
  setGauge,
  setHealthThreshold,
  setMinimumWalletBalanceWei,
  setWalletBalanceWei,
  startMetricsServer,
} from "./metrics.js";

const logger = createLogger(config.logFormat);

async function main() {
  const account = getAccount();
  const clients = {
    publicClient,
    walletClient: getWalletClient(),
    account,
  } as unknown as TokenlessKeeperClients;

  setHealthThreshold(config.intervalMs);
  setMinimumWalletBalanceWei(config.minGasBalanceWei);
  const metricsServer = startMetricsServer(
    config.metricsPort,
    config.metricsBindAddress,
    config.metricsAuthToken,
  );

  await validateKeeperSigner();
  await validateKeeperConnectivity(publicClient);
  await validateTokenlessKeeperDeployment(clients, config);
  logger.info("Tokenless keeper deployment verified", {
    chainId: chain.id,
    deploymentKey: config.deployment.key,
    deploymentBlock: config.deployment.blockNumber.toString(),
    panel: config.deployment.panel,
    credentialIssuer: config.deployment.credentialIssuer,
    feedbackBonus: config.deployment.feedbackBonus,
    account: account.address,
  });

  let running = false;
  let shuttingDown = false;

  async function tick() {
    if (running || shuttingDown) return;
    running = true;
    setGauge("keeper_is_running", 1);
    const startedAt = Date.now();
    try {
      const balance = await publicClient.getBalance({
        address: account.address,
      });
      setWalletBalanceWei(balance);
      if (balance < config.minGasBalanceWei) {
        logger.warn("Tokenless keeper wallet balance is low", {
          balanceWei: balance.toString(),
          minimumWei: config.minGasBalanceWei.toString(),
        });
      }

      const result = await runTokenlessKeeper(clients, config, logger);
      recordRun(result, Date.now() - startedAt);
      const work = Object.entries(result)
        .filter(([name]) => name !== "roundsScanned")
        .reduce((sum, [, value]) => sum + value, 0);
      if (work > 0) logger.info("Tokenless keeper run complete", { ...result });
    } catch (error) {
      recordError();
      logger.error("Tokenless keeper run failed", {
        error: error instanceof Error ? error.message : String(error),
        consecutiveErrors: getConsecutiveErrors(),
      });
    } finally {
      running = false;
      setGauge("keeper_is_running", 0);
    }
  }

  await tick();
  const interval = setInterval(() => void tick(), config.intervalMs);

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    logger.info("Tokenless keeper shutting down", { signal });
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    await closeKeeperSigningLedger();
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Tokenless keeper failed to start", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

import { afterEach, describe, expect, it, vi } from "vitest";

const ENGINE = "0x1111111111111111111111111111111111111111" as const;
const REGISTRY = "0x2222222222222222222222222222222222222222" as const;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as const;

type KeeperIndexOptions = {
  balance?: bigint;
  databaseUrl?: string | null;
  failBalanceRead?: boolean;
  frontendFeeEnabled?: boolean;
  mainLoopLockBusy?: boolean;
  mainLoopLockRequired?: boolean;
  resolveRoundsError?: Error;
  resolveRoundsResult?: Record<string, number | null>;
};

async function loadKeeperIndex(options: KeeperIndexOptions = {}) {
  vi.resetModules();

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const getBalance = vi.fn(async () => {
    if (options.failBalanceRead) {
      throw new Error("wallet balance read failed");
    }
    return options.balance ?? 500n;
  });
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) => {
      throw new Error(`unexpected readContract(${functionName})`);
    },
  );

  const resolveRounds = options.resolveRoundsError
    ? vi.fn().mockRejectedValue(options.resolveRoundsError)
    : vi.fn(
        async (
          _publicClient,
          _walletClient,
          _chain,
          _account,
          _logger,
          runContext?: { blockTimestamp?: bigint },
        ) => {
          if (runContext) {
            runContext.blockTimestamp = 1234n;
          }
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
            ...options.resolveRoundsResult,
          };
        },
      );
  const validateKeeperContracts = vi.fn().mockResolvedValue(undefined);
  const setGauge = vi.fn();
  const setWalletBalanceWei = vi.fn();
  const setHealthThreshold = vi.fn();
  const startMetricsServer = vi.fn(() => ({ close: vi.fn() }));
  const recordRun = vi.fn();
  const recordMainLoopLockSkip = vi.fn();
  const recordError = vi.fn();
  const incrementCounter = vi.fn();
  const getConsecutiveErrors = vi.fn(() => 0);
  const runWithKeeperMainLoopLock = vi.fn(async (_logger, fallback, run: () => Promise<unknown>) => {
    if (options.mainLoopLockRequired && !options.databaseUrl) {
      throw new Error("KEEPER_DATABASE_URL is required when KEEPER_MAIN_LOOP_LOCK_REQUIRED=true");
    }
    if (options.mainLoopLockBusy) {
      return fallback;
    }
    return run();
  });
  const closeKeeperState = vi.fn().mockResolvedValue(undefined);
  const getWalletClient = vi.fn(() => ({ kind: "wallet" }));
  const getAccount = vi.fn(() => ({ address: ACCOUNT }));
  const claimConfiguredFrontendFees = vi.fn().mockResolvedValue({
    frontendAddress: ACCOUNT,
    roundsClaimed: 0,
    withdrawals: 0,
    withdrawnAmount: 0n,
  });
  const validateKeeperConnectivity = vi.fn().mockResolvedValue(undefined);
  const processOn = vi
    .spyOn(process, "on")
    .mockImplementation(((..._args: any[]) => process) as typeof process.on);
  const setIntervalMock = vi.fn(() => 1 as unknown as NodeJS.Timeout);
  const clearIntervalMock = vi.fn();

  vi.stubGlobal("setInterval", setIntervalMock);
  vi.stubGlobal("clearInterval", clearIntervalMock);

  vi.doMock("../config.js", () => ({
    config: {
      chainName: "hardhat",
      chainId: 31337,
      contracts: {
        votingEngine: ENGINE,
        contentRegistry: REGISTRY,
        clusterPayoutOracle: "0x0000000000000000000000000000000000000000",
        feedbackBonusEscrow: "0x0000000000000000000000000000000000000000",
      },
      intervalMs: 30_000,
      metricsEnabled: false,
      livenessEnabled: true,
      metricsPort: 9090,
      metricsBindAddress: "127.0.0.1",
      metricsAuthToken: null,
      persistence: {
        databaseUrl: options.databaseUrl ?? null,
        mainLoopLockRequired: options.mainLoopLockRequired ?? false,
      },
      startupJitterMs: 0,
      minGasBalanceWei: "100",
      logFormat: "text",
      frontendFees: {
        enabled: options.frontendFeeEnabled ?? false,
        frontendAddress: undefined,
        lookbackRounds: 8,
        recentRoundsPerTick: 50,
        backfillRoundsPerTick: 50,
        withdrawEnabled: true,
        contracts: options.frontendFeeEnabled
          ? {
              roundRewardDistributor:
                "0x4444444444444444444444444444444444444444",
              frontendRegistry: "0x5555555555555555555555555555555555555555",
            }
          : null,
      },
      feedbackBonusForfeits: {
        enabled: true,
        maxPoolsPerTick: 25,
        minAgeSeconds: 60,
      },
      correlationSnapshots: {
        enabled: false,
        mode: "auto",
        artifactPath: undefined,
        frontendRegistry: undefined,
        maxRoundsPerTick: 20,
        artifactStorage: {
          mode: "data-uri",
          outputDir: "correlation-artifacts",
          publicBaseUrl: "",
        },
      },
    },
  }));
  vi.doMock("../logger.js", () => ({
    createLogger: () => logger,
  }));
  vi.doMock("../client.js", () => ({
    publicClient: {
      getBalance,
      readContract,
    },
    getWalletClient,
    getAccount,
    chain: { id: 31337 },
    validateKeeperConnectivity,
  }));
  vi.doMock("../keeper.js", () => ({
    resolveRounds,
    validateKeeperContracts,
  }));
  vi.doMock("../frontend-fees.js", () => ({
    claimConfiguredFrontendFees,
  }));
  vi.doMock("../metrics.js", () => ({
    startMetricsServer,
    setHealthThreshold,
    recordRun,
    recordMainLoopLockSkip,
    recordError,
    setGauge,
    incrementCounter,
    setWalletBalanceWei,
    getConsecutiveErrors,
  }));
  vi.doMock("../keeper-state.js", () => ({
    closeKeeperState,
    runWithKeeperMainLoopLock,
  }));

  await import("../index.js");
  await vi.dynamicImportSettled();

  return {
    logger,
    getBalance,
    readContract,
    resolveRounds,
    validateKeeperContracts,
    setGauge,
    setWalletBalanceWei,
    recordRun,
    recordMainLoopLockSkip,
    recordError,
    incrementCounter,
    runWithKeeperMainLoopLock,
    closeKeeperState,
    getWalletClient,
    getAccount,
    validateKeeperConnectivity,
    claimConfiguredFrontendFees,
    startMetricsServer,
    setHealthThreshold,
    processOn,
    setIntervalMock,
    clearIntervalMock,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("keeper index", () => {
  it("starts the liveness server even when metrics are disabled", async () => {
    const keeper = await loadKeeperIndex();

    expect(keeper.setHealthThreshold).toHaveBeenCalledWith(30_000);
    expect(keeper.startMetricsServer).toHaveBeenCalledWith(9090, "127.0.0.1", null, {
      artifactDirectory: null,
      metricsEnabled: false,
    });
    expect(keeper.logger.info).toHaveBeenCalledWith("Liveness server started", {
      port: 9090,
      bindAddress: "127.0.0.1",
      endpoints: ["/live"],
    });
  });

  it("reads wallet balance before running the keeper loop", async () => {
    const keeper = await loadKeeperIndex({
      balance: 1_500n,
    });

    expect(keeper.validateKeeperConnectivity).toHaveBeenCalledWith(
      expect.anything(),
    );
    expect(keeper.validateKeeperContracts).toHaveBeenCalledWith(
      expect.anything(),
      ENGINE,
      REGISTRY,
    );
    expect(keeper.getBalance).toHaveBeenCalledWith({ address: ACCOUNT });
    expect(keeper.readContract).not.toHaveBeenCalled();
    expect(keeper.setWalletBalanceWei).toHaveBeenCalledWith(1_500n);
    expect(keeper.resolveRounds).toHaveBeenCalledOnce();
    expect(keeper.recordRun).toHaveBeenCalledOnce();
  });

  it("logs failed wallet balance reads but still runs the keeper loop", async () => {
    const keeper = await loadKeeperIndex({
      failBalanceRead: true,
    });

    expect(keeper.logger.warn).toHaveBeenCalledWith(
      "Failed to check wallet balance",
      {
        error: "wallet balance read failed",
      },
    );
    expect(keeper.resolveRounds).toHaveBeenCalledOnce();
    expect(keeper.recordError).not.toHaveBeenCalled();
  });

  it("warns on low wallet balance while still running the keeper loop", async () => {
    const keeper = await loadKeeperIndex({
      balance: 50n,
    });

    expect(keeper.logger.warn).toHaveBeenCalledWith(
      "Keeper wallet balance low",
      {
        balance: "50",
        minRequired: "100",
      },
    );
    expect(keeper.setWalletBalanceWei).toHaveBeenCalledWith(50n);
    expect(keeper.resolveRounds).toHaveBeenCalledOnce();
  });

  it("logs a run summary for ticks that only finalize reveal-failed rounds, clean up, or forfeit bonuses", async () => {
    const keeper = await loadKeeperIndex({
      resolveRoundsResult: {
        roundsRevealFailedFinalized: 1,
        cleanupBatchesProcessed: 2,
        feedbackBonusPoolsForfeited: 3,
      },
    });

    expect(keeper.logger.info).toHaveBeenCalledWith(
      "Run complete",
      expect.objectContaining({
        roundsRevealFailedFinalized: 1,
        cleanupBatchesProcessed: 2,
        feedbackBonusPoolsForfeited: 3,
      }),
    );
  });

  it("skips the run summary when nothing happened", async () => {
    const keeper = await loadKeeperIndex();

    expect(keeper.logger.info).not.toHaveBeenCalledWith(
      "Run complete",
      expect.anything(),
    );
  });

  it("records an error when resolveRounds fails entirely", async () => {
    const keeper = await loadKeeperIndex({
      resolveRoundsError: new Error(
        "Cannot resolve current block time: rpc down",
      ),
    });

    expect(keeper.recordError).toHaveBeenCalledOnce();
    expect(keeper.recordRun).not.toHaveBeenCalled();
    expect(keeper.logger.error).toHaveBeenCalledWith(
      "Run failed",
      expect.objectContaining({
        error: "Cannot resolve current block time: rpc down",
      }),
    );
  });

  it("records an error instead of a successful run when the required main-loop lock is unavailable", async () => {
    const keeper = await loadKeeperIndex({
      mainLoopLockRequired: true,
    });

    expect(keeper.resolveRounds).not.toHaveBeenCalled();
    expect(keeper.recordRun).not.toHaveBeenCalled();
    expect(keeper.recordError).toHaveBeenCalledOnce();
    expect(keeper.incrementCounter).not.toHaveBeenCalledWith(
      "keeper_main_loop_lock_skips_total",
    );
    expect(keeper.logger.error).toHaveBeenCalledWith(
      "Run failed",
      expect.objectContaining({
        error:
          "KEEPER_DATABASE_URL is required when KEEPER_MAIN_LOOP_LOCK_REQUIRED=true",
      }),
    );
  });

  it("records a lock skip instead of a successful run when another keeper holds the main-loop lock", async () => {
    const keeper = await loadKeeperIndex({
      databaseUrl: "postgres://keeper:test@localhost:5432/rateloop",
      mainLoopLockBusy: true,
    });

    expect(keeper.resolveRounds).not.toHaveBeenCalled();
    expect(keeper.recordMainLoopLockSkip).toHaveBeenCalledOnce();
    expect(keeper.recordRun).not.toHaveBeenCalled();
    expect(keeper.recordError).not.toHaveBeenCalled();
    expect(keeper.incrementCounter).not.toHaveBeenCalledWith(
      "keeper_main_loop_lock_skips_total",
    );
  });

  it("runs the hosted frontend fee sweep when enabled", async () => {
    const keeper = await loadKeeperIndex({
      frontendFeeEnabled: true,
    });

    expect(keeper.claimConfiguredFrontendFees).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ address: ACCOUNT }),
      expect.anything(),
      { chainTimestamp: 1234n },
    );
  });
});

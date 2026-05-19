import { afterEach, describe, expect, it, vi } from "vitest";

const ENGINE = "0x1111111111111111111111111111111111111111" as const;
const REGISTRY = "0x2222222222222222222222222222222222222222" as const;
const ACCOUNT = "0x3333333333333333333333333333333333333333" as const;

type KeeperIndexOptions = {
  balance?: bigint;
  failBalanceRead?: boolean;
  frontendFeeEnabled?: boolean;
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

  const resolveRounds = vi.fn().mockResolvedValue({
    roundsSettled: 0,
    roundsCancelled: 0,
    roundsRevealFailedFinalized: 0,
    votesRevealed: 0,
    cleanupBatchesProcessed: 0,
    contentMarkedDormant: 0,
  });
  const validateKeeperContracts = vi.fn().mockResolvedValue(undefined);
  const setGauge = vi.fn();
  const recordRun = vi.fn();
  const recordError = vi.fn();
  const getConsecutiveErrors = vi.fn(() => 0);
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
      },
      intervalMs: 30_000,
      metricsEnabled: false,
      metricsPort: 9090,
      startupJitterMs: 0,
      minGasBalanceWei: "100",
      logFormat: "text",
      frontendFees: {
        enabled: options.frontendFeeEnabled ?? false,
        frontendAddress: undefined,
        lookbackRounds: 8,
        withdrawEnabled: true,
        contracts: options.frontendFeeEnabled
          ? {
              roundRewardDistributor:
                "0x4444444444444444444444444444444444444444",
              frontendRegistry: "0x5555555555555555555555555555555555555555",
            }
          : null,
      },
      correlationSnapshots: {
        enabled: false,
        artifactPath: undefined,
        frontendRegistry: undefined,
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
    startMetricsServer: vi.fn(),
    setHealthThreshold: vi.fn(),
    recordRun,
    recordError,
    setGauge,
    getConsecutiveErrors,
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
    recordRun,
    recordError,
    getWalletClient,
    getAccount,
    validateKeeperConnectivity,
    claimConfiguredFrontendFees,
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
    expect(keeper.setGauge).toHaveBeenCalledWith(
      "keeper_wallet_balance_wei",
      1500,
    );
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
    expect(keeper.setGauge).toHaveBeenCalledWith(
      "keeper_wallet_balance_wei",
      50,
    );
    expect(keeper.resolveRounds).toHaveBeenCalledOnce();
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
    );
  });
});

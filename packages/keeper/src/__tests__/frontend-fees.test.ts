import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ACCOUNT,
  FRONTEND,
  ROUND_REWARD_DISTRIBUTOR,
  FRONTEND_REGISTRY,
  mockConfig,
  readCurrentRoundIds,
  readRound,
  writeContractAndConfirm,
  getRevertReason,
} = vi.hoisted(() => ({
  ACCOUNT: "0x1111111111111111111111111111111111111111" as const,
  FRONTEND: "0x2222222222222222222222222222222222222222" as const,
  ROUND_REWARD_DISTRIBUTOR:
    "0x5555555555555555555555555555555555555555" as const,
  FRONTEND_REGISTRY: "0x6666666666666666666666666666666666666666" as const,
  mockConfig: {
    contracts: {
      contentRegistry: "0x3333333333333333333333333333333333333333" as const,
      votingEngine: "0x4444444444444444444444444444444444444444" as const,
    },
    frontendFees: {
      enabled: true,
      frontendAddress: undefined as `0x${string}` | undefined,
      lookbackRounds: 8,
      recentRoundsPerTick: 50,
      backfillRoundsPerTick: 50,
      withdrawEnabled: true,
      contracts: {
        roundRewardDistributor:
          "0x5555555555555555555555555555555555555555" as const,
        frontendRegistry: "0x6666666666666666666666666666666666666666" as const,
      },
    },
  },
  readCurrentRoundIds: vi.fn(),
  readRound: vi.fn(),
  writeContractAndConfirm: vi.fn(),
  getRevertReason: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

vi.mock("../contract-reads.js", () => ({
  readCurrentRoundIds,
  readRound,
  RoundState: {
    Open: 0,
    Settled: 1,
    Cancelled: 2,
    Tied: 3,
    RevealFailed: 4,
  },
}));

vi.mock("../keeper.js", () => ({
  writeContractAndConfirm,
}));

vi.mock("../revert-utils.js", () => ({
  getRevertReason,
}));

import {
  claimConfiguredFrontendFees,
  resetFrontendFeeSweepStateForTests,
} from "../frontend-fees.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("claimConfiguredFrontendFees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFrontendFeeSweepStateForTests();
    mockConfig.frontendFees.enabled = true;
    mockConfig.frontendFees.frontendAddress = undefined;
    mockConfig.frontendFees.lookbackRounds = 8;
    mockConfig.frontendFees.recentRoundsPerTick = 50;
    mockConfig.frontendFees.backfillRoundsPerTick = 50;
    mockConfig.frontendFees.withdrawEnabled = true;
    mockConfig.frontendFees.contracts = {
      roundRewardDistributor: ROUND_REWARD_DISTRIBUTOR,
      frontendRegistry: FRONTEND_REGISTRY,
    };
  });

  it("returns without on-chain work when the feature is disabled", async () => {
    mockConfig.frontendFees.enabled = false;
    const publicClient = {
      readContract: vi.fn(),
    };

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      makeLogger() as never,
    );

    expect(result).toEqual({
      frontendAddress: ACCOUNT,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
      withdrawalRequests: 0,
      requestedAmount: 0n,
    });
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("skips sweeping when the configured frontend is not the keeper wallet", async () => {
    mockConfig.frontendFees.frontendAddress = FRONTEND;
    const logger = makeLogger();
    const publicClient = {
      readContract: vi.fn(),
    };

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    expect(result).toEqual({
      frontendAddress: FRONTEND,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
      withdrawalRequests: 0,
      requestedAmount: 0n,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping frontend fee sweep because keeper wallet is not the configured frontend operator",
      expect.objectContaining({
        frontendAddress: FRONTEND,
        account: ACCOUNT,
      }),
    );
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("claims settled frontend fees and requests a delayed withdrawal for accumulated credits", async () => {
    const logger = makeLogger();
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return [15n, 0, ACCOUNT, false] as const;
            case "pendingFeeWithdrawalAmount":
              return 0n;
            case "getAccumulatedFees":
              return 15n;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 1n,
    });
    readRound.mockResolvedValue({
      state: 1,
    });
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    expect(result).toEqual({
      frontendAddress: ACCOUNT,
      roundsClaimed: 1,
      withdrawals: 0,
      withdrawnAmount: 0n,
      withdrawalRequests: 1,
      requestedAmount: 15n,
    });
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      1,
      publicClient,
      {},
      expect.objectContaining({
        address: ROUND_REWARD_DISTRIBUTOR,
        functionName: "claimFrontendFee",
        args: [1n, 1n, ACCOUNT],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      2,
      publicClient,
      {},
      expect.objectContaining({
        address: FRONTEND_REGISTRY,
        functionName: "requestFeeWithdrawal",
        args: [],
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("completes a matured pending withdrawal and requests the next one", async () => {
    const logger = makeLogger();
    const chainTimestamp = 1_000_000n;
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return [0n, 0, ACCOUNT, true] as const;
            case "pendingFeeWithdrawalAmount":
              return 20n;
            case "pendingFeeWithdrawalReleaseAt":
              return chainTimestamp - 10n;
            case "hasOpenSnapshotDispute":
              return false;
            case "getAccumulatedFees":
              return 5n;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 1n,
    });
    readRound.mockResolvedValue({
      state: 1,
    });
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
      { chainTimestamp },
    );

    expect(result).toEqual({
      frontendAddress: ACCOUNT,
      roundsClaimed: 0,
      withdrawals: 1,
      withdrawnAmount: 20n,
      withdrawalRequests: 1,
      requestedAmount: 5n,
    });
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      1,
      publicClient,
      {},
      expect.objectContaining({
        address: FRONTEND_REGISTRY,
        functionName: "completeFeeWithdrawal",
        args: [],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      2,
      publicClient,
      {},
      expect.objectContaining({
        address: FRONTEND_REGISTRY,
        functionName: "requestFeeWithdrawal",
        args: [],
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips a matured pending withdrawal while a snapshot dispute is active", async () => {
    const logger = makeLogger();
    const chainTimestamp = 1_000_000n;
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return [0n, 0, ACCOUNT, true] as const;
            case "pendingFeeWithdrawalAmount":
              return 20n;
            case "pendingFeeWithdrawalReleaseAt":
              return chainTimestamp - 10n;
            case "hasOpenSnapshotDispute":
              return true;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 1n,
    });
    readRound.mockResolvedValue({
      state: 1,
    });

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
      { chainTimestamp },
    );

    expect(result).toEqual({
      frontendAddress: ACCOUNT,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
      withdrawalRequests: 0,
      requestedAmount: 0n,
    });
    expect(writeContractAndConfirm).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Skipping matured frontend fee withdrawal while snapshot dispute is active",
      { frontendAddress: ACCOUNT, pendingAmount: 20n },
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("waits for the withdrawal delay before completing a pending withdrawal", async () => {
    const logger = makeLogger();
    const chainTimestamp = 1_000n;
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return [0n, 0, ACCOUNT, true] as const;
            case "pendingFeeWithdrawalAmount":
              return 20n;
            case "pendingFeeWithdrawalReleaseAt":
              return chainTimestamp + 3600n;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 1n,
    });
    readRound.mockResolvedValue({
      state: 1,
    });
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
      { chainTimestamp },
    );

    expect(result).toEqual({
      frontendAddress: ACCOUNT,
      roundsClaimed: 0,
      withdrawals: 0,
      withdrawnAmount: 0n,
      withdrawalRequests: 0,
      requestedAmount: 0n,
    });
    expect(writeContractAndConfirm).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("backfills older settled rounds outside the recent lookback window in the same run", async () => {
    mockConfig.frontendFees.lookbackRounds = 2;
    const logger = makeLogger();
    const publicClient = {
      readContract: vi.fn(
        async ({
          functionName,
          args,
        }: {
          functionName: string;
          args?: readonly bigint[];
        }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return args?.[1] === 3n
                ? ([15n, 0, ACCOUNT, false] as const)
                : ([0n, 0, ACCOUNT, false] as const);
            case "getAccumulatedFees":
              return 0n;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 5n,
    });
    readRound.mockImplementation(
      async (
        _publicClient: unknown,
        _engine: unknown,
        _contentId: bigint,
        roundId: bigint,
      ) => ({
        state: roundId === 3n ? 1 : 0,
      }),
    );
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const result = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    expect(result.roundsClaimed).toBe(1);
    expect(writeContractAndConfirm).toHaveBeenCalledWith(
      publicClient,
      {},
      expect.objectContaining({
        address: ROUND_REWARD_DISTRIBUTOR,
        functionName: "claimFrontendFee",
        args: [1n, 3n, ACCOUNT],
      }),
    );
  });

  it("bounds recent frontend fee scans and resumes from the cursor", async () => {
    mockConfig.frontendFees.lookbackRounds = 3;
    mockConfig.frontendFees.recentRoundsPerTick = 2;
    mockConfig.frontendFees.backfillRoundsPerTick = 0;
    mockConfig.frontendFees.withdrawEnabled = false;
    const logger = makeLogger();
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 3n;
            case "previewFrontendFee":
              return [15n, 0, ACCOUNT, false] as const;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 3n,
    });
    readRound.mockResolvedValue({
      state: 1,
    });
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const firstResult = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    const secondResult = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    expect(firstResult.roundsClaimed).toBe(2);
    expect(secondResult.roundsClaimed).toBe(2);
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      1,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [1n, 1n, ACCOUNT],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      2,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [1n, 2n, ACCOUNT],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      3,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [1n, 3n, ACCOUNT],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      4,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [2n, 1n, ACCOUNT],
      }),
    );
  });

  it("bounds historical frontend fee backfill and resumes from the cursor", async () => {
    mockConfig.frontendFees.lookbackRounds = 1;
    mockConfig.frontendFees.backfillRoundsPerTick = 1;
    mockConfig.frontendFees.withdrawEnabled = false;
    const logger = makeLogger();
    const publicClient = {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "nextContentId":
              return 2n;
            case "previewFrontendFee":
              return [15n, 0, ACCOUNT, false] as const;
            default:
              throw new Error(`Unexpected readContract(${functionName})`);
          }
        },
      ),
    };

    readCurrentRoundIds.mockResolvedValue({
      activeRoundId: 0n,
      latestRoundId: 4n,
    });
    readRound.mockImplementation(
      async (
        _publicClient: unknown,
        _engine: unknown,
        _contentId: bigint,
        roundId: bigint,
      ) => ({
        state: roundId === 4n ? 0 : 1,
      }),
    );
    writeContractAndConfirm.mockResolvedValue("0xabc");

    const firstResult = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    const secondResult = await claimConfiguredFrontendFees(
      publicClient as never,
      {} as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger as never,
    );

    expect(firstResult.roundsClaimed).toBe(1);
    expect(secondResult.roundsClaimed).toBe(1);
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      1,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [1n, 1n, ACCOUNT],
      }),
    );
    expect(writeContractAndConfirm).toHaveBeenNthCalledWith(
      2,
      publicClient,
      {},
      expect.objectContaining({
        functionName: "claimFrontendFee",
        args: [1n, 2n, ACCOUNT],
      }),
    );
  });
});

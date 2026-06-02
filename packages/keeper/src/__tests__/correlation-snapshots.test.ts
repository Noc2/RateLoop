import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const ORACLE = "0x2222222222222222222222222222222222222222" as const;
const FRONTEND_REGISTRY = "0x3333333333333333333333333333333333333333" as const;
const SNAPSHOT_CONSUMER = "0x4444444444444444444444444444444444444444" as const;
const SNAPSHOT_KEY = `0x${"a".repeat(64)}` as const;

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

function mockConfig(frontendRegistry: `0x${string}` | undefined = FRONTEND_REGISTRY) {
  vi.doMock("../config.js", () => ({
    config: {
      contracts: {
        clusterPayoutOracle: ORACLE,
      },
      correlationSnapshots: {
        enabled: true,
        mode: "file",
        artifactPath: "/tmp/correlation-snapshots.json",
        frontendRegistry,
        maxRoundsPerTick: 20,
        artifactStorage: {
          mode: "data-uri",
          outputDir: "correlation-artifacts",
          publicBaseUrl: "",
        },
      },
    },
  }));
}

async function loadPublisher(options: {
  frontendRegistry?: `0x${string}` | undefined;
  frontendEligible?: boolean;
  epochStatus?: number;
  roundStatus?: number;
} = {}) {
  vi.resetModules();
  mockConfig(options.frontendRegistry ?? FRONTEND_REGISTRY);

  const artifact = {
    correlationEpochs: [
      {
        epochId: "1",
        fromRoundId: "1",
        toRoundId: "4",
        clusterRoot: `0x${"1".repeat(64)}`,
        parameterHash: `0x${"2".repeat(64)}`,
        artifactHash: `0x${"3".repeat(64)}`,
        artifactURI: "ipfs://epoch",
      },
    ],
    roundPayoutSnapshots: [
      {
        domain: 1,
        rewardPoolId: "7",
        contentId: "9",
        roundId: "2",
        correlationEpochId: "1",
        rawEligibleVoters: 5,
        effectiveParticipantUnits: 50_000,
        totalClaimWeight: "100",
        weightRoot: `0x${"4".repeat(64)}`,
        reasonRoot: `0x${"5".repeat(64)}`,
        artifactHash: `0x${"6".repeat(64)}`,
        artifactURI: "ipfs://round",
      },
    ],
  };
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(artifact));

  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "authorizedSnapshotFrontend") {
      return (options.frontendEligible ?? true)
        ? "0x9999999999999999999999999999999999999999"
        : "0x0000000000000000000000000000000000000000";
    }
    if (functionName === "correlationEpochSnapshot") return { status: options.epochStatus ?? 0 };
    if (functionName === "roundPayoutSnapshotConsumer") return SNAPSHOT_CONSUMER;
    if (functionName === "roundPayoutSnapshotSourceReadyAt") return 100n;
    if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
    if (functionName === "roundPayoutProposal") return { snapshot: { status: options.roundStatus ?? 0 } };
    throw new Error(`unexpected readContract(${functionName})`);
  });
  const getBlock = vi.fn().mockResolvedValue({ timestamp: 200n });
  const writeContract = vi.fn().mockResolvedValue("0xhash");
  const waitForTransactionReceipt = vi.fn().mockResolvedValue({
    status: "success",
  });
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const { publishConfiguredCorrelationSnapshots } = await import(
    "../correlation-snapshots.js"
  );

  return {
    publishConfiguredCorrelationSnapshots,
    publicClient: { readContract, getBlock, waitForTransactionReceipt },
    walletClient: { writeContract },
    chain: { id: 31337 },
    account: { address: ACCOUNT },
    logger,
    readContract,
    getBlock,
    writeContract,
    waitForTransactionReceipt,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("correlation snapshot publisher", () => {
  it("confirms frontend eligibility and proposes finalized-epoch round snapshots without ETH value", async () => {
    const publisher = await loadPublisher({ epochStatus: 3 });

    const result = await publisher.publishConfiguredCorrelationSnapshots(
      publisher.publicClient as never,
      publisher.walletClient as never,
      publisher.chain as never,
      publisher.account as never,
      publisher.logger,
    );

    expect(result).toEqual({
      epochsProposed: 0,
      epochsFinalized: 0,
      roundSnapshotsProposed: 1,
      roundSnapshotsFinalized: 0,
    });
    expect(publisher.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FRONTEND_REGISTRY,
        functionName: "authorizedSnapshotFrontend",
        args: [ACCOUNT],
      }),
    );
    expect(publisher.logger.debug).toHaveBeenCalledWith(
      "Correlation snapshot proposer authorization confirmed",
      expect.objectContaining({
        snapshotProposer: ACCOUNT,
        frontendOperator: "0x9999999999999999999999999999999999999999",
        eligible: true,
      }),
    );
    expect(publisher.writeContract).toHaveBeenCalledTimes(1);
    expect(publisher.writeContract).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ value: expect.anything() }),
    );
    expect(publisher.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(publisher.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: "0xhash",
    });
  });

  it("does not propose round snapshots in the same tick as a new epoch proposal", async () => {
    const publisher = await loadPublisher();

    const result = await publisher.publishConfiguredCorrelationSnapshots(
      publisher.publicClient as never,
      publisher.walletClient as never,
      publisher.chain as never,
      publisher.account as never,
      publisher.logger,
    );

    expect(result).toEqual({
      epochsProposed: 1,
      epochsFinalized: 0,
      roundSnapshotsProposed: 0,
      roundSnapshotsFinalized: 0,
    });
    expect(publisher.writeContract).toHaveBeenCalledTimes(1);
    expect(publisher.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeCorrelationEpoch",
      }),
    );
    expect(publisher.logger.debug).toHaveBeenCalledWith(
      "Skipping round payout snapshot until correlation epoch is finalized",
      expect.objectContaining({
        correlationEpochId: "1",
      }),
    );
  });

  it("skips proposals when the frontend operator is not eligible", async () => {
    const publisher = await loadPublisher({ frontendEligible: false });

    const result = await publisher.publishConfiguredCorrelationSnapshots(
      publisher.publicClient as never,
      publisher.walletClient as never,
      publisher.chain as never,
      publisher.account as never,
      publisher.logger,
    );

    expect(result).toEqual({
      epochsProposed: 0,
      epochsFinalized: 0,
      roundSnapshotsProposed: 0,
      roundSnapshotsFinalized: 0,
    });
    expect(publisher.writeContract).not.toHaveBeenCalled();
    expect(publisher.logger.warn).toHaveBeenCalledWith(
      "Skipping correlation snapshot proposals because keeper is not authorized by an eligible frontend",
      expect.objectContaining({
        snapshotProposer: ACCOUNT,
        eligible: false,
      }),
    );
  });

  it("still finalizes already-proposed snapshots when the frontend operator is not eligible", async () => {
    const publisher = await loadPublisher({
      frontendEligible: false,
      epochStatus: 1,
      roundStatus: 1,
    });

    const result = await publisher.publishConfiguredCorrelationSnapshots(
      publisher.publicClient as never,
      publisher.walletClient as never,
      publisher.chain as never,
      publisher.account as never,
      publisher.logger,
    );

    expect(result).toEqual({
      epochsProposed: 0,
      epochsFinalized: 1,
      roundSnapshotsProposed: 0,
      roundSnapshotsFinalized: 1,
    });
    expect(publisher.writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "finalizeCorrelationEpoch",
      }),
    );
    expect(publisher.writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "finalizeRoundPayoutSnapshot",
      }),
    );
  });
});

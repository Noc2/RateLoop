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

function mockConfig(
  frontendRegistry: `0x${string}` | undefined = FRONTEND_REGISTRY,
) {
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

async function loadPublisher(
  options: {
    frontendRegistry?: `0x${string}` | undefined;
    frontendEligible?: boolean;
    epochStatus?: number;
    roundStatus?: number;
  } = {},
) {
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

  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "authorizedSnapshotFrontend") {
        return (options.frontendEligible ?? true)
          ? "0x9999999999999999999999999999999999999999"
          : "0x0000000000000000000000000000000000000000";
      }
      if (functionName === "correlationEpochSnapshot")
        return { status: options.epochStatus ?? 0 };
      if (functionName === "roundPayoutSnapshotConsumer")
        return SNAPSHOT_CONSUMER;
      if (functionName === "roundPayoutSnapshotSourceReadyAt") return 100n;
      if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
      if (functionName === "roundPayoutProposal")
        return { snapshot: { status: options.roundStatus ?? 0 } };
      throw new Error(`unexpected readContract(${functionName})`);
    },
  );
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
  it("does not build automatic artifacts when status preflight can finish the tick", async () => {
    vi.resetModules();
    mockConfig(FRONTEND_REGISTRY);
    vi.doMock("../config.js", () => ({
      config: {
        contracts: {
          clusterPayoutOracle: ORACLE,
        },
        correlationSnapshots: {
          enabled: true,
          mode: "auto",
          artifactPath: undefined,
          frontendRegistry: FRONTEND_REGISTRY,
          maxRoundsPerTick: 20,
          artifactStorage: {
            mode: "data-uri",
            outputDir: "correlation-artifacts",
            publicBaseUrl: "",
          },
        },
      },
    }));

    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi.fn();
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => `0x${"f".repeat(64)}`),
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    }));

    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "correlationEpochSnapshot") return { status: 1 };
        if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
        if (functionName === "roundPayoutProposal")
          return { snapshot: { status: 3 } };
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );
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

    const result = await publishConfiguredCorrelationSnapshots(
      { readContract, getBlock, waitForTransactionReceipt } as never,
      { writeContract } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(result).toEqual({
      epochsProposed: 0,
      epochsFinalized: 1,
      roundSnapshotsProposed: 0,
      roundSnapshotsFinalized: 0,
      ratingSnapshotsApplied: 0,
    });
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).not.toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "finalizeCorrelationEpoch",
      }),
    );
  });

  it("uses cached automatic artifacts when a proposal needs artifact data", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({
      config: {
        contracts: {
          clusterPayoutOracle: ORACLE,
        },
        correlationSnapshots: {
          enabled: true,
          mode: "auto",
          artifactPath: undefined,
          frontendRegistry: FRONTEND_REGISTRY,
          maxRoundsPerTick: 20,
          artifactStorage: {
            mode: "data-uri",
            outputDir: "correlation-artifacts",
            publicBaseUrl: "",
          },
        },
      },
    }));

    const fingerprint = `0x${"f".repeat(64)}` as const;
    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi.fn();
    const restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson = vi
      .fn()
      .mockResolvedValue({
        artifact: {
          correlationEpochs: [
            {
              epochId: "1",
              fromRoundId: "1",
              toRoundId: "1",
              clusterRoot: `0x${"1".repeat(64)}`,
              parameterHash: `0x${"2".repeat(64)}`,
              artifactHash: `0x${"3".repeat(64)}`,
              artifactURI: "ipfs://cached",
            },
          ],
          roundPayoutSnapshots: [
            {
              domain: 1,
              rewardPoolId: "7",
              contentId: "9",
              roundId: "1",
              correlationEpochId: "1",
              rawEligibleVoters: 5,
              effectiveParticipantUnits: 50_000,
              totalClaimWeight: "100",
              weightRoot: `0x${"4".repeat(64)}`,
              reasonRoot: `0x${"5".repeat(64)}`,
              artifactHash: `0x${"3".repeat(64)}`,
              artifactURI: "ipfs://cached-round",
            },
          ],
        },
        artifactHash: `0x${"3".repeat(64)}`,
        canonicalJson: "{}",
        canonicalBytes: 2,
        roundSnapshotCount: 0,
        epochCount: 1,
      });
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => fingerprint),
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson,
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    }));

    const readCachedCorrelationArtifact = vi.fn().mockResolvedValue({
      artifactHash: `0x${"3".repeat(64)}`,
      canonicalJson: "{}",
    });
    const writeCachedCorrelationArtifact = vi.fn();
    vi.doMock("../keeper-state.js", () => ({
      runWithCorrelationSnapshotPublishLock: vi.fn((_logger, _fallback, run) =>
        run(),
      ),
      readCachedCorrelationArtifact,
      writeCachedCorrelationArtifact,
    }));

    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "correlationEpochSnapshot") return { status: 0 };
        if (functionName === "authorizedSnapshotFrontend") {
          return "0x9999999999999999999999999999999999999999";
        }
        if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
        if (functionName === "roundPayoutSnapshotConsumer")
          return SNAPSHOT_CONSUMER;
        if (functionName === "roundPayoutSnapshotSourceReadyAt") return 100n;
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );
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

    const result = await publishConfiguredCorrelationSnapshots(
      { readContract, getBlock, waitForTransactionReceipt } as never,
      { writeContract } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(result.epochsProposed).toBe(1);
    expect(readCachedCorrelationArtifact).toHaveBeenCalledWith(
      fingerprint,
      logger,
    );
    expect(
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson,
    ).toHaveBeenCalledWith("{}");
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).not.toHaveBeenCalled();
    expect(writeCachedCorrelationArtifact).not.toHaveBeenCalled();
  });

  it("skips rebuilding automatic artifacts for a rejected candidate fingerprint", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({
      config: {
        contracts: {
          clusterPayoutOracle: ORACLE,
        },
        correlationSnapshots: {
          enabled: true,
          mode: "auto",
          artifactPath: undefined,
          frontendRegistry: FRONTEND_REGISTRY,
          maxRoundsPerTick: 20,
          artifactStorage: {
            mode: "data-uri",
            outputDir: "correlation-artifacts",
            publicBaseUrl: "",
          },
        },
      },
    }));

    const fingerprint = `0x${"f".repeat(64)}` as const;
    const clusterRoot = `0x${"1".repeat(64)}` as const;
    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi
      .fn()
      .mockResolvedValue({
        artifact: {
          correlationEpochs: [
            {
              epochId: "1",
              fromRoundId: "1",
              toRoundId: "1",
              clusterRoot,
              parameterHash: `0x${"2".repeat(64)}`,
              artifactHash: `0x${"3".repeat(64)}`,
              artifactURI: "ipfs://rejected",
            },
          ],
        },
        artifactHash: `0x${"3".repeat(64)}`,
        canonicalBytes: 2,
        candidateCount: 1,
        roundSnapshotCount: 0,
        epochCount: 1,
      });
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => fingerprint),
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: vi.fn(),
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    }));

    const readCachedCorrelationArtifact = vi.fn().mockResolvedValue(null);
    const writeCachedCorrelationArtifact = vi.fn();
    vi.doMock("../keeper-state.js", () => ({
      runWithCorrelationSnapshotPublishLock: vi.fn((_logger, _fallback, run) =>
        run(),
      ),
      readCachedCorrelationArtifact,
      writeCachedCorrelationArtifact,
    }));

    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "correlationEpochSnapshot") {
          return { status: 4, clusterRoot };
        }
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const { publishConfiguredCorrelationSnapshots } = await import(
      "../correlation-snapshots.js"
    );

    const firstResult = await publishConfiguredCorrelationSnapshots(
      { readContract } as never,
      { writeContract: vi.fn() } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );
    const secondResult = await publishConfiguredCorrelationSnapshots(
      { readContract } as never,
      { writeContract: vi.fn() } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(firstResult).toEqual({
      epochsProposed: 0,
      epochsFinalized: 0,
      roundSnapshotsProposed: 0,
      roundSnapshotsFinalized: 0,
      ratingSnapshotsApplied: 0,
    });
    expect(secondResult).toEqual(firstResult);
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).toHaveBeenCalledTimes(1);
    expect(readCachedCorrelationArtifact).toHaveBeenCalledTimes(1);
    expect(writeCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Skipping automatic correlation epoch proposal for rejected cluster root",
      expect.objectContaining({
        epochId: "1",
        clusterRoot,
        candidateFingerprint: fingerprint,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Skipping automatic correlation snapshot build for previously rejected candidate fingerprint",
      expect.objectContaining({
        candidateFingerprint: fingerprint,
        rejectedEpochIds: ["1"],
      }),
    );
  });

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
      ratingSnapshotsApplied: 0,
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

  it("can propose round snapshots in the same tick as a new epoch proposal", async () => {
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
      roundSnapshotsProposed: 1,
      roundSnapshotsFinalized: 0,
      ratingSnapshotsApplied: 0,
    });
    expect(publisher.writeContract).toHaveBeenCalledTimes(2);
    expect(publisher.writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "proposeCorrelationEpoch",
      }),
    );
    expect(publisher.writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "proposeRoundPayoutSnapshot",
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
      ratingSnapshotsApplied: 0,
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
      ratingSnapshotsApplied: 0,
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

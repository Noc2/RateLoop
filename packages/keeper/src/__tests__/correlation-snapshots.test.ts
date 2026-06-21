import { readFile } from "node:fs/promises";
import { PAYOUT_DOMAIN_PUBLIC_RATING } from "@rateloop/node-utils/correlationScoring";
import { afterEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const ORACLE = "0x2222222222222222222222222222222222222222" as const;
const FRONTEND_REGISTRY = "0x3333333333333333333333333333333333333333" as const;
const SNAPSHOT_CONSUMER = "0x4444444444444444444444444444444444444444" as const;
const CONTENT_REGISTRY = "0x5555555555555555555555555555555555555555" as const;
const VOTING_ENGINE = "0x6666666666666666666666666666666666666666" as const;
const SNAPSHOT_KEY = `0x${"a".repeat(64)}` as const;

const { mockRestoreFromCanonical } = vi.hoisted(() => ({
  mockRestoreFromCanonical: vi.fn(async (canonical: string) => {
    const parsed = JSON.parse(canonical) as {
      correlationEpochs?: Array<Record<string, unknown>>;
      roundPayoutSnapshots?: Array<Record<string, unknown>>;
    };
    const artifactHash = `0x${"a".repeat(64)}` as const;
    const artifactURI = "data:application/json;base64,e30=";
    const artifact = {
      correlationEpochs: (parsed.correlationEpochs ?? []).map(epoch => ({
        ...epoch,
        artifactHash: epoch.artifactHash ?? artifactHash,
        artifactURI: epoch.artifactURI ?? artifactURI,
      })),
      roundPayoutSnapshots: (parsed.roundPayoutSnapshots ?? []).map(snapshot => ({
        ...snapshot,
        artifactHash: snapshot.artifactHash ?? artifactHash,
        artifactURI: snapshot.artifactURI ?? artifactURI,
      })),
    };
    return {
      artifact,
      artifactHash,
      artifactURI,
      canonicalJson: canonical,
      canonicalBytes: Buffer.byteLength(canonical),
      candidateCount: 0,
      roundSnapshotCount: artifact.roundPayoutSnapshots.length,
      epochCount: artifact.correlationEpochs.length,
    };
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../correlation-artifact-verifier.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../correlation-artifact-verifier.js")>();
  return {
    ...actual,
    verifyCorrelationArtifact: (artifact: unknown) => ({
      ok: true,
      artifactHash: `0x${"a".repeat(64)}`,
      parameterHash: null,
      roundSnapshotCount: Array.isArray((artifact as { roundPayoutSnapshots?: unknown[] })?.roundPayoutSnapshots)
        ? (artifact as { roundPayoutSnapshots: unknown[] }).roundPayoutSnapshots.length
        : 0,
      epochCount: Array.isArray((artifact as { correlationEpochs?: unknown[] })?.correlationEpochs)
        ? (artifact as { correlationEpochs: unknown[] }).correlationEpochs.length
        : 0,
      errors: [],
    }),
  };
});

vi.mock("../correlation-ponder-freshness.js", () => ({
  areCorrelationCandidatesPonderFresh: vi.fn(async () => true),
}));

vi.mock("../correlation-artifact-builder.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../correlation-artifact-builder.js")>();
  return {
    ...actual,
    restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: mockRestoreFromCanonical,
  };
});

function mockConfig(
  frontendRegistry: `0x${string}` | undefined = FRONTEND_REGISTRY,
) {
  vi.doMock("../config.js", () => ({
    config: {
      contracts: {
        clusterPayoutOracle: ORACLE,
        contentRegistry: CONTENT_REGISTRY,
        votingEngine: VOTING_ENGINE,
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
          publicBaseUrl: "https://ipfs.io/ipfs/",
        },
      },
    },
  }));
}

function oversizedChunkedJsonResponse(totalBytes = 10_000_001) {
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(64 * 1024, totalBytes - sent);
        sent += size;
        controller.enqueue(new Uint8Array(size).fill(0x20));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
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
      if (functionName === "getRoundPayoutSnapshot") {
        const status = options.roundStatus ?? 0;
        if (status === 0) throw new Error("SnapshotNotFound");
        return { status, finalizedAt: 100n };
      }
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
            publicBaseUrl: "https://ipfs.io/ipfs/",
          },
        },
      },
    }));

    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi.fn();
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          domain: 1,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => `0x${"f".repeat(64)}`),
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: mockRestoreFromCanonical,
    }));

    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "correlationEpochSnapshot") return { status: 1 };
        if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
        if (functionName === "getRoundPayoutSnapshot")
          return { status: 3, finalizedAt: 100n };
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

  it("rebuilds automatic artifacts instead of trusting a cached candidate fingerprint", async () => {
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
            publicBaseUrl: "https://ipfs.io/ipfs/",
          },
        },
      },
    }));

    const fingerprint = `0x${"f".repeat(64)}` as const;
    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi
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
              artifactURI: "ipfs://fresh",
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
              artifactURI: "ipfs://fresh-round",
            },
          ],
        },
        artifactHash: `0x${"4".repeat(64)}`,
        canonicalJson: "{\"fresh\":true}",
        canonicalBytes: 14,
        candidateCount: 1,
        roundSnapshotCount: 1,
        epochCount: 1,
      });
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
          domain: 1,
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
        if (functionName === "getRoundPayoutSnapshot")
          throw new Error("SnapshotNotFound");
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
    expect(readCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson,
    ).not.toHaveBeenCalled();
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).toHaveBeenCalledWith(
      [
        {
          domain: 1,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ],
      logger,
      { ponderNowSeconds: undefined },
    );
    expect(writeCachedCorrelationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint,
        artifactHash: `0x${"4".repeat(64)}`,
        canonicalJson: "{\"fresh\":true}",
      }),
    );
  });

  it("rebuilds automatic artifacts when a normalized round snapshot is rejected", async () => {
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
            publicBaseUrl: "https://ipfs.io/ipfs/",
          },
        },
      },
    }));

    const fingerprint = `0x${"e".repeat(64)}` as const;
    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi
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
              artifactURI: "ipfs://rebuilt",
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
              artifactHash: `0x${"6".repeat(64)}`,
              artifactURI: "ipfs://rebuilt-round",
            },
          ],
        },
        artifactHash: `0x${"7".repeat(64)}`,
        canonicalJson: "{}",
        canonicalBytes: 2,
        candidateCount: 1,
        roundSnapshotCount: 1,
        epochCount: 1,
      });
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          domain: 1,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => fingerprint),
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: mockRestoreFromCanonical,
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    }));

    const readCachedCorrelationArtifact = vi.fn().mockResolvedValue({
      artifactHash: `0x${"8".repeat(64)}`,
      canonicalJson: "{\"stale\":true}",
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
        if (functionName === "correlationEpochSnapshot") return { status: 3 };
        if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
        if (functionName === "getRoundPayoutSnapshot")
          return { status: 4, finalizedAt: 100n };
        if (functionName === "roundPayoutSnapshotConsumer")
          return SNAPSHOT_CONSUMER;
        if (functionName === "roundPayoutSnapshotSourceReadyAt") return 100n;
        if (functionName === "authorizedSnapshotFrontend") {
          return "0x9999999999999999999999999999999999999999";
        }
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );
    const writeContract = vi.fn().mockResolvedValue("0xhash");
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
      {
        readContract,
        getBlock: vi.fn().mockResolvedValue({ timestamp: 200n }),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
        }),
      } as never,
      { writeContract } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(result.roundSnapshotsProposed).toBe(1);
    expect(readCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeRoundPayoutSnapshot",
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Rebuilding automatic correlation snapshot artifact after rejected round payout snapshot",
      expect.objectContaining({
        candidateFingerprint: fingerprint,
      }),
    );
  });

  it("rebuilds rejected automatic candidates and skips only the same cluster root", async () => {
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
            publicBaseUrl: "https://ipfs.io/ipfs/",
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
          domain: 1,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => fingerprint),
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: mockRestoreFromCanonical,
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
    ).toHaveBeenCalledTimes(2);
    expect(readCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(writeCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "Skipping automatic correlation epoch proposal for rejected cluster root",
      expect.objectContaining({
        epochId: "1",
        clusterRoot,
        candidateFingerprint: fingerprint,
      }),
    );
  });

  it("proposes a rebuilt automatic artifact when a rejected candidate has a different cluster root", async () => {
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
            publicBaseUrl: "https://ipfs.io/ipfs/",
          },
        },
      },
    }));

    const fingerprint = `0x${"e".repeat(64)}` as const;
    const rejectedClusterRoot = `0x${"1".repeat(64)}` as const;
    const rebuiltClusterRoot = `0x${"2".repeat(64)}` as const;
    const buildConfiguredCorrelationSnapshotArtifactForCandidates = vi
      .fn()
      .mockResolvedValue({
        artifact: {
          correlationEpochs: [
            {
              epochId: "1",
              fromRoundId: "1",
              toRoundId: "1",
              clusterRoot: rebuiltClusterRoot,
              parameterHash: `0x${"3".repeat(64)}`,
              artifactHash: `0x${"4".repeat(64)}`,
              artifactURI: "ipfs://rebuilt",
              sourceRefs: [
                {
                  domain: 1,
                  rewardPoolId: "7",
                  contentId: "9",
                  roundId: "1",
                },
              ],
            },
          ],
        },
        artifactHash: `0x${"4".repeat(64)}`,
        canonicalJson: "{\"rebuilt\":true}",
        canonicalBytes: 16,
        candidateCount: 1,
        roundSnapshotCount: 0,
        epochCount: 1,
      });
    vi.doMock("../correlation-artifact-builder.js", () => ({
      loadConfiguredCorrelationSnapshotCandidates: vi.fn().mockResolvedValue([
        {
          domain: 1,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 1n,
        },
      ]),
      correlationSnapshotCandidateFingerprint: vi.fn(() => fingerprint),
      restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson: mockRestoreFromCanonical,
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
          return { status: 4, clusterRoot: rejectedClusterRoot };
        }
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
    const writeContract = vi.fn().mockResolvedValue("0xhash");
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
      {
        readContract,
        getBlock: vi.fn().mockResolvedValue({ timestamp: 200n }),
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: "success",
        }),
      } as never,
      { writeContract } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(result.epochsProposed).toBe(1);
    expect(
      buildConfiguredCorrelationSnapshotArtifactForCandidates,
    ).toHaveBeenCalledTimes(1);
    expect(readCachedCorrelationArtifact).not.toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeCorrelationEpoch",
      }),
    );
    expect(writeCachedCorrelationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint,
        artifactHash: `0x${"4".repeat(64)}`,
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
    expect(publisher.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SNAPSHOT_CONSUMER,
        functionName: "roundPayoutSnapshotSourceReadyAt",
        account: ORACLE,
        args: [1, 7n, 9n, 2n],
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

  it("proposes a replacement when the normalized round snapshot is rejected", async () => {
    const publisher = await loadPublisher({ epochStatus: 3, roundStatus: 4 });

    const result = await publisher.publishConfiguredCorrelationSnapshots(
      publisher.publicClient as never,
      publisher.walletClient as never,
      publisher.chain as never,
      publisher.account as never,
      publisher.logger,
    );

    expect(result.roundSnapshotsProposed).toBe(1);
    expect(publisher.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getRoundPayoutSnapshot",
        args: [1, 7n, 9n, 2n],
      }),
    );
    expect(publisher.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeRoundPayoutSnapshot",
      }),
    );
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

  it("skips finalized rating snapshot application when an HTTPS artifact is too large", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({
      config: {
        contracts: {
          clusterPayoutOracle: ORACLE,
          contentRegistry: CONTENT_REGISTRY,
          votingEngine: VOTING_ENGINE,
        },
        correlationSnapshots: {
          enabled: true,
          mode: "file",
          artifactPath: "/tmp/correlation-snapshots.json",
          frontendRegistry: FRONTEND_REGISTRY,
          maxRoundsPerTick: 20,
          artifactStorage: {
            mode: "file",
            outputDir: "correlation-artifacts",
            publicBaseUrl: "https://artifacts.example.com/rateloop",
          },
        },
      },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => oversizedChunkedJsonResponse()));

    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        correlationEpochs: [
          {
            epochId: "1",
            fromRoundId: "1",
            toRoundId: "1",
            clusterRoot: `0x${"1".repeat(64)}`,
            parameterHash: `0x${"2".repeat(64)}`,
            artifactHash: `0x${"3".repeat(64)}`,
            artifactURI: "https://artifacts.example.com/rateloop/epoch.json",
          },
        ],
        roundPayoutSnapshots: [
          {
            domain: PAYOUT_DOMAIN_PUBLIC_RATING,
            rewardPoolId: "0",
            contentId: "9",
            roundId: "2",
            correlationEpochId: "1",
            rawEligibleVoters: 5,
            effectiveParticipantUnits: 50_000,
            totalClaimWeight: "100",
            weightRoot: `0x${"4".repeat(64)}`,
            reasonRoot: `0x${"5".repeat(64)}`,
            artifactHash: `0x${"6".repeat(64)}`,
            artifactURI: "https://artifacts.example.com/rateloop/round.json",
          },
        ],
      }),
    );

    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "correlationEpochSnapshot") return { status: 3 };
        if (functionName === "roundPayoutSnapshotKey") return SNAPSHOT_KEY;
        if (functionName === "getRoundPayoutSnapshot")
          return { status: 3, finalizedAt: 100n };
        if (functionName === "FINALIZATION_VETO_WINDOW") return 0n;
        if (functionName === "roundLifecycleState")
          return { cleanupRemaining: 0n };
        if (functionName === "isRoundPayoutSnapshotConsumed") return false;
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const writeContract = vi.fn();
    const { publishConfiguredCorrelationSnapshots } = await import(
      "../correlation-snapshots.js"
    );

    const result = await publishConfiguredCorrelationSnapshots(
      {
        readContract,
        getBlock: vi.fn().mockResolvedValue({ timestamp: 200n }),
        waitForTransactionReceipt: vi.fn(),
      } as never,
      { writeContract } as never,
      { id: 31337 } as never,
      { address: ACCOUNT } as never,
      logger,
    );

    expect(result.ratingSnapshotsApplied).toBe(0);
    expect(writeContract).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping rating snapshot application because artifact could not be read or verified",
      expect.objectContaining({
        snapshotKey: SNAPSHOT_KEY,
        artifactHash: `0x${"6".repeat(64)}`,
      }),
    );
  });
});

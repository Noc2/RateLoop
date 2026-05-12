import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryArtifactStore } from "../artifacts.js";
import { ZERO_HASH, type LatestProbeResultState, type StoredDeclarationState } from "../types.js";

const CONFIG = vi.hoisted(() => ({
  contracts: {
    raterDeclarationRegistry: "0x5555555555555555555555555555555555555555",
  },
  maxGasPerTx: 750000,
  maxCandidatesPerTick: 10,
  detectorBundleHash: `0x${"11".repeat(32)}`,
  probeLibraryHash: `0x${"22".repeat(32)}`,
}));

const readProbeState = vi.hoisted(() => vi.fn());

vi.mock("../config.js", () => ({
  config: CONFIG,
}));

vi.mock("../registry.js", () => ({
  readProbeState,
}));

function makeStoredDeclaration(): StoredDeclarationState {
  return {
    declaration: {
      rater: "0x1111111111111111111111111111111111111111",
      operator: "0x2222222222222222222222222222222222222222",
      modelClass: 1,
      modelId: `0x${"aa".repeat(32)}`,
      provider: `0x${"bb".repeat(32)}`,
      endpointHint: ZERO_HASH,
      promptTemplateHash: `0x${"cc".repeat(32)}`,
      retrievalConfigHash: `0x${"dd".repeat(32)}`,
      toolingHash: `0x${"ee".repeat(32)}`,
      version: 2,
      effectiveEpoch: 100n,
      expiresAtEpoch: 0n,
      disclosure: 1,
      nonce: 1n,
    },
    tier: 1,
    declaredAt: 123n,
    probePending: true,
    declarationHash: `0x${"ff".repeat(32)}`,
    lastProbeResultHash: ZERO_HASH,
  };
}

const latestProbeResult: LatestProbeResultState = {
  probeLibraryHash: ZERO_HASH,
  resultHash: ZERO_HASH,
  confidenceBps: 0,
  recordedAt: 0n,
  passed: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  readProbeState.mockReset();
});

describe("runProberCycle", () => {
  it("records probe results and stores the hashed metadata artifact", async () => {
    const { runProberCycle } = await import("../prober.js");
    readProbeState.mockResolvedValue({
      storedDeclaration: makeStoredDeclaration(),
      latestProbeResult,
    });

    const artifactStore = createMemoryArtifactStore();
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    const writeContract = vi.fn().mockResolvedValue("0xabc");
    const result = await runProberCycle({
      publicClient: {
        waitForTransactionReceipt,
      } as any,
      walletClient: {
        writeContract,
      } as any,
      chain: { id: 31337 } as any,
      account: { address: "0x9999999999999999999999999999999999999999" } as any,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      tracker: {
        scan: vi.fn().mockResolvedValue({
          discoveredCandidates: 1,
          pendingCount: 1,
          latestBlock: 150n,
          lastScannedBlock: 145n,
        }),
        claim: vi.fn().mockReturnValue([
          {
            rater: "0x1111111111111111111111111111111111111111",
            hintVersion: 2,
            source: "probe-requested",
          },
        ]),
        requeue: vi.fn(),
        pendingCount: vi.fn().mockReturnValue(0),
      },
      detectorPipeline: {
        evaluate: vi.fn().mockResolvedValue({
          kind: "mock",
          passed: true,
          confidenceBps: 8600,
          summary: "mock-metadata: core declaration hashes are present",
          signals: [],
        }),
      },
      artifactStore,
    });

    expect(result).toMatchObject({
      candidatesDiscovered: 1,
      candidatesProcessed: 1,
      probeResultsRecorded: 1,
      driftFlagsRecorded: 0,
      failedDetections: 0,
    });
    expect(artifactStore.records).toHaveLength(1);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "recordProbeResult",
        args: expect.arrayContaining([
          "0x1111111111111111111111111111111111111111",
          2,
          CONFIG.probeLibraryHash,
          8600,
          true,
        ]),
      }),
    );
  });

  it("flags behavioral drift after recording the probe result when the pipeline emits a drift score", async () => {
    const { runProberCycle } = await import("../prober.js");
    readProbeState.mockResolvedValue({
      storedDeclaration: makeStoredDeclaration(),
      latestProbeResult,
    });

    const artifactStore = createMemoryArtifactStore();
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce("0xabc")
      .mockResolvedValueOnce("0xdef");

    await runProberCycle({
      publicClient: {
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
      } as any,
      walletClient: {
        writeContract,
      } as any,
      chain: { id: 31337 } as any,
      account: { address: "0x9999999999999999999999999999999999999999" } as any,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      tracker: {
        scan: vi.fn().mockResolvedValue({
          discoveredCandidates: 1,
          pendingCount: 1,
          latestBlock: 150n,
          lastScannedBlock: 145n,
        }),
        claim: vi.fn().mockReturnValue([
          {
            rater: "0x1111111111111111111111111111111111111111",
            hintVersion: 2,
            source: "probe-requested",
          },
        ]),
        requeue: vi.fn(),
        pendingCount: vi.fn().mockReturnValue(0),
      },
      detectorPipeline: {
        evaluate: vi.fn().mockResolvedValue({
          kind: "mock",
          passed: true,
          confidenceBps: 8600,
          driftScoreBps: 6500,
          summary: "mock-metadata: drift suspected",
          signals: [],
        }),
      },
      artifactStore,
    });

    expect(artifactStore.records).toHaveLength(2);
    expect(writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "flagBehavioralDrift",
        args: expect.arrayContaining([
          "0x1111111111111111111111111111111111111111",
          2,
          6500,
        ]),
      }),
    );
  });
});

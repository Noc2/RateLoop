import { describe, expect, it } from "vitest";
import { buildDetectorPipeline } from "../detectors/index.js";
import { ZERO_HASH, type LatestProbeResultState, type ProbeCandidateHint, type StoredDeclarationState } from "../types.js";

const candidate: ProbeCandidateHint = {
  rater: "0x1111111111111111111111111111111111111111",
  hintVersion: 2,
  source: "probe-requested",
};

const latestProbeResult: LatestProbeResultState = {
  probeLibraryHash: ZERO_HASH,
  resultHash: ZERO_HASH,
  confidenceBps: 0,
  recordedAt: 0n,
  passed: false,
};

function makeStoredDeclaration(overrides: Partial<StoredDeclarationState["declaration"]> = {}): StoredDeclarationState {
  return {
    declaration: {
      rater: candidate.rater,
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
      ...overrides,
    },
    tier: 1,
    declaredAt: 123n,
    probePending: true,
    declarationHash: `0x${"ff".repeat(32)}`,
    lastProbeResultHash: ZERO_HASH,
  };
}

describe("mock detector pipeline", () => {
  it("passes when core declaration hashes are present", async () => {
    const pipeline = buildDetectorPipeline({ detectorKind: "mock" });
    const result = await pipeline.evaluate({
      candidate,
      storedDeclaration: makeStoredDeclaration(),
      latestProbeResult,
      detectorBundleHash: `0x${"11".repeat(32)}`,
      probeLibraryHash: `0x${"22".repeat(32)}`,
    });

    expect(result.kind).toBe("mock");
    expect(result.passed).toBe(true);
    expect(result.confidenceBps).toBeGreaterThanOrEqual(7000);
    expect(result.signals[0]).toMatchObject({
      detectorId: "mock-metadata",
      passed: true,
    });
  });

  it("fails conservatively when a core declaration hash is missing", async () => {
    const pipeline = buildDetectorPipeline({ detectorKind: "mock" });
    const result = await pipeline.evaluate({
      candidate,
      storedDeclaration: makeStoredDeclaration({
        promptTemplateHash: ZERO_HASH,
      }),
      latestProbeResult,
      detectorBundleHash: `0x${"11".repeat(32)}`,
      probeLibraryHash: `0x${"22".repeat(32)}`,
    });

    expect(result.passed).toBe(false);
    expect(result.confidenceBps).toBeLessThan(7000);
    expect(result.summary).toContain("mock-metadata");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const ORACLE = "0x2222222222222222222222222222222222222222" as const;

function mockConfig() {
  vi.doMock("../config.js", () => ({
    config: {
      chainId: 31337,
      ponderBaseUrl: "http://ponder.local",
      contracts: {
        clusterPayoutOracle: ORACLE,
      },
      correlationSnapshots: {
        maxRoundsPerTick: 5,
        artifactStorage: {
          mode: "data-uri",
          outputDir: "correlation-artifacts",
          publicBaseUrl: "",
        },
      },
    },
  }));
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function parseDataUri(uri: string) {
  const commaIndex = uri.indexOf(",");
  return JSON.parse(Buffer.from(uri.slice(commaIndex + 1), "base64").toString("utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("automatic correlation artifact builder", () => {
  it("builds a deterministic stored artifact from Ponder candidates and votes", async () => {
    mockConfig();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
        expect(url.searchParams.get("limit")).toBe("6");
        expect(url.searchParams.get("offset")).toBe("0");
        return jsonResponse({
          items: [
            {
              rewardPoolId: "7",
              contentId: "9",
              roundId: "2",
            },
          ],
        });
      }
      if (url.pathname === "/correlation/round-votes") {
        expect(url.searchParams.get("rewardPoolId")).toBe("7");
        return jsonResponse({
          items: [
            {
              account: "0x0000000000000000000000000000000000000001",
              identityKey: `0x${"a".repeat(64)}`,
              commitKey: `0x${"b".repeat(64)}`,
              baseWeight: "10000",
              verifiedHuman: true,
              historicalVoteCount: 12,
              features: [`identity:0x${"a".repeat(64)}`],
            },
            {
              account: "0x0000000000000000000000000000000000000002",
              identityKey: `0x${"c".repeat(64)}`,
              commitKey: `0x${"d".repeat(64)}`,
              baseWeight: "10000",
              verifiedHuman: false,
              historicalVoteCount: 1,
              features: [`identity:0x${"c".repeat(64)}`],
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { buildConfiguredCorrelationSnapshotArtifact } = await import(
      "../correlation-artifact-builder.js"
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const artifact = await buildConfiguredCorrelationSnapshotArtifact(logger);

    expect(artifact.correlationEpochs).toHaveLength(1);
    expect(artifact.roundPayoutSnapshots).toHaveLength(1);
    expect(artifact.correlationEpochs?.[0]).toMatchObject({
      epochId: "2",
      fromRoundId: "2",
      toRoundId: "2",
      artifactHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      artifactURI: expect.stringMatching(/^data:application\/json;base64,/),
    });
    expect(artifact.roundPayoutSnapshots?.[0]).toMatchObject({
      domain: 1,
      rewardPoolId: "7",
      contentId: "9",
      roundId: "2",
      correlationEpochId: "2",
      rawEligibleVoters: 2,
      artifactHash: artifact.correlationEpochs?.[0]?.artifactHash,
      artifactURI: artifact.correlationEpochs?.[0]?.artifactURI,
    });

    const publicArtifact = parseDataUri(artifact.roundPayoutSnapshots![0]!.artifactURI);
    expect(publicArtifact.roundPayoutSnapshots[0].payoutWeights).toHaveLength(2);
    expect(publicArtifact.roundPayoutSnapshots[0].payoutWeights[0]).toMatchObject({
      proof: expect.any(Array),
      effectiveWeight: expect.any(String),
      reasonHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Built automatic correlation snapshot artifact",
      expect.objectContaining({
        candidateCount: 1,
        roundSnapshotCount: 1,
        epochCount: 1,
      }),
    );
  });

  it("emits empty round snapshots for settled rounds with no eligible voters", async () => {
    mockConfig();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
        return jsonResponse({
          items: [
            {
              rewardPoolId: "8",
              contentId: "10",
              roundId: "3",
            },
          ],
        });
      }
      if (url.pathname === "/correlation/round-votes") {
        return jsonResponse({ items: [] });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { buildConfiguredCorrelationSnapshotArtifact } = await import(
      "../correlation-artifact-builder.js"
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const artifact = await buildConfiguredCorrelationSnapshotArtifact(logger);

    expect(artifact.roundPayoutSnapshots?.[0]).toMatchObject({
      rewardPoolId: "8",
      contentId: "10",
      roundId: "3",
      rawEligibleVoters: 0,
      effectiveParticipantUnits: 0,
      totalClaimWeight: "0",
      weightRoot: `0x${"0".repeat(64)}`,
    });
    expect(artifact.correlationEpochs?.[0]?.clusterRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(artifact.correlationEpochs?.[0]?.clusterRoot).not.toBe(
      `0x${"0".repeat(64)}`,
    );
  });

  it("skips an automatic epoch when the first round has more candidates than the tick limit", async () => {
    mockConfig();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
        return jsonResponse({
          items: Array.from({ length: 6 }, (_, index) => ({
            rewardPoolId: String(index + 1),
            contentId: String(index + 10),
            roundId: "4",
          })),
        });
      }
      return new Response("round votes should not be requested", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { buildConfiguredCorrelationSnapshotArtifact } = await import(
      "../correlation-artifact-builder.js"
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const artifact = await buildConfiguredCorrelationSnapshotArtifact(logger);

    expect(artifact).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping automatic correlation epoch because one round exceeds maxRoundsPerTick",
      expect.objectContaining({
        roundId: "4",
        maxRoundsPerTick: 5,
      }),
    );
  });
});

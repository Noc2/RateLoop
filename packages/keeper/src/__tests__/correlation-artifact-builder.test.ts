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

function fullVotePageResponse() {
  return jsonResponse({
    items: Array.from({ length: 1_000 }, () => ({
      account: "0x0000000000000000000000000000000000000001",
      identityKey: `0x${"a".repeat(64)}`,
      commitKey: `0x${"b".repeat(64)}`,
      baseWeight: "10000",
      verifiedHuman: true,
      historicalVoteCount: 12,
      features: [`identity:0x${"a".repeat(64)}`],
    })),
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
          roundContext: {
            trailingBaseRateUpBps: 2_000,
            baseRateWindowRounds: 100,
            settledRoundsInWindow: 12,
          },
          items: [
            {
              account: "0x0000000000000000000000000000000000000001",
              identityKey: `0x${"a".repeat(64)}`,
              commitKey: `0x${"b".repeat(64)}`,
              isUp: true,
              stake: "10000000",
              epochIndex: 0,
              revealWeight: "10000",
              verifiedHuman: true,
              historicalVoteCount: 12,
              features: [`identity:0x${"a".repeat(64)}`],
            },
            {
              account: "0x0000000000000000000000000000000000000002",
              identityKey: `0x${"c".repeat(64)}`,
              commitKey: `0x${"d".repeat(64)}`,
              isUp: false,
              stake: "10000000",
              epochIndex: 1,
              revealWeight: "2500",
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

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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
    expect(publicArtifact.artifactVersion).toBe("rateloop-correlation-artifact-v2");
    expect(publicArtifact.scorerVersion).toBe("rateloop-correlation-epoch-v2");
    expect(publicArtifact.roundPayoutSnapshots[0].trailingBaseRateUpBps).toBe(2_000);
    expect(publicArtifact.roundPayoutSnapshots[0].payoutWeights).toHaveLength(2);
    expect(publicArtifact.roundPayoutSnapshots[0].eligibleVotes).toHaveLength(2);
    expect(publicArtifact.roundPayoutSnapshots[0].payoutWeights[0]).toMatchObject({
      proof: expect.any(Array),
      effectiveWeight: expect.any(String),
      surpriseBps: 10_000,
      reasonHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    // A two-voter split round has zero peer agreement on both sides, so both
    // surprise multipliers floor at neutral and baseWeights stay flat.
    expect(
      publicArtifact.roundPayoutSnapshots[0].payoutWeights.map(
        (payoutWeight: { baseWeight: string }) => payoutWeight.baseWeight,
      ),
    ).toEqual(["10000", "10000"]);
    const { verifyCorrelationArtifact } = await import(
      "../correlation-artifact-verifier.js"
    );
    expect(verifyCorrelationArtifact(publicArtifact)).toMatchObject({
      ok: true,
      roundSnapshotCount: 1,
      epochCount: 1,
      errors: [],
    });
    const tamperedArtifact = structuredClone(publicArtifact);
    tamperedArtifact.roundPayoutSnapshots[0].payoutWeights[0].effectiveWeight = "1";
    expect(verifyCorrelationArtifact(tamperedArtifact)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("effectiveWeight"),
      ]),
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Built automatic correlation snapshot artifact",
      expect.objectContaining({
        candidateCount: 1,
        roundSnapshotCount: 1,
        epochCount: 1,
        artifactUriScheme: "data",
        artifactUriBytes: expect.any(Number),
      }),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      "Built automatic correlation snapshot artifact",
      expect.objectContaining({
        artifactURI: expect.any(String),
      }),
    );
  });

  it("builds non-flat surprise-weighted baseWeights for a non-uniform round", async () => {
    mockConfig();
    const voteItem = (index: number, isUp: boolean) => ({
      account: `0x000000000000000000000000000000000000000${index}`,
      identityKey: `0x${String(index).repeat(64)}`,
      commitKey: `0x${String(index + 3).repeat(64)}`,
      isUp,
      stake: "10000000",
      epochIndex: 0,
      revealWeight: "10000",
      verifiedHuman: true,
      historicalVoteCount: 12,
      features: [`identity:0x${String(index).repeat(64)}`],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
        return jsonResponse({
          items: [{ rewardPoolId: "7", contentId: "9", roundId: "2" }],
        });
      }
      if (url.pathname === "/correlation/round-votes") {
        return jsonResponse({
          roundContext: {
            trailingBaseRateUpBps: 2_000,
            baseRateWindowRounds: 100,
            settledRoundsInWindow: 40,
          },
          items: [voteItem(1, true), voteItem(2, true), voteItem(3, false)],
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
    const publicArtifact = parseDataUri(artifact.roundPayoutSnapshots![0]!.artifactURI);
    const snapshot = publicArtifact.roundPayoutSnapshots[0];

    expect(publicArtifact.artifactVersion).toBe("rateloop-correlation-artifact-v2");
    expect(snapshot.trailingBaseRateUpBps).toBe(2_000);
    // UP majority beats the 20% trailing base rate: agreement 5_000 bps,
    // surprise 25_000 bps, baseWeight 5_000 + 5_000 * 25_000 / 10_000.
    expect(
      snapshot.payoutWeights.map((payoutWeight: { surpriseBps: number }) => payoutWeight.surpriseBps),
    ).toEqual([25_000, 25_000, 10_000]);
    expect(
      snapshot.payoutWeights.map((payoutWeight: { baseWeight: string }) => payoutWeight.baseWeight),
    ).toEqual(["17500", "17500", "10000"]);
    // Independent verified voters keep independenceBps = 10_000, so the
    // surprise-weighted baseWeights flow through to leaves and the total.
    expect(
      snapshot.payoutWeights.map(
        (payoutWeight: { effectiveWeight: string }) => payoutWeight.effectiveWeight,
      ),
    ).toEqual(["17500", "17500", "10000"]);
    expect(snapshot.totalClaimWeight).toBe("45000");
    expect(artifact.roundPayoutSnapshots?.[0]?.totalClaimWeight).toBe("45000");
    expect(
      new Set(snapshot.payoutWeights.map((payoutWeight: { leaf: string }) => payoutWeight.leaf)).size,
    ).toBe(3);
  });

  it("falls back to neutral surprise when Ponder omits the new vote fields", async () => {
    mockConfig();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
        return jsonResponse({
          items: [{ rewardPoolId: "7", contentId: "9", roundId: "2" }],
        });
      }
      if (url.pathname === "/correlation/round-votes") {
        // Legacy Ponder response: no roundContext, no isUp/revealWeight.
        return jsonResponse({
          items: [1, 2, 3].map((index) => ({
            account: `0x000000000000000000000000000000000000000${index}`,
            identityKey: `0x${String(index).repeat(64)}`,
            commitKey: `0x${String(index + 3).repeat(64)}`,
            baseWeight: "10000",
            verifiedHuman: true,
            historicalVoteCount: 12,
            features: [`identity:0x${String(index).repeat(64)}`],
          })),
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
    const publicArtifact = parseDataUri(artifact.roundPayoutSnapshots![0]!.artifactURI);
    const snapshot = publicArtifact.roundPayoutSnapshots[0];

    expect(snapshot.trailingBaseRateUpBps).toBeNull();
    expect(
      snapshot.payoutWeights.map((payoutWeight: { surpriseBps: number }) => payoutWeight.surpriseBps),
    ).toEqual([10_000, 10_000, 10_000]);
    expect(
      snapshot.payoutWeights.map((payoutWeight: { baseWeight: string }) => payoutWeight.baseWeight),
    ).toEqual(["10000", "10000", "10000"]);
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

  it("rejects oversized Ponder responses before reading the body", async () => {
    mockConfig();
    const fetchMock = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: {
        "content-length": "5000001",
        "content-type": "application/json",
      },
    }));
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

    await expect(buildConfiguredCorrelationSnapshotArtifact(logger)).rejects.toThrow(
      "Ponder response too large",
    );
  });

  it("rejects streamed Ponder responses that exceed the byte cap", async () => {
    mockConfig();
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ items: [] }).padEnd(5_000_001, " "),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ));
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

    await expect(buildConfiguredCorrelationSnapshotArtifact(logger)).rejects.toThrow(
      "Ponder response exceeded",
    );
  });

  it("stops vote pagination after the round page cap", async () => {
    mockConfig();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname === "/correlation/round-candidates") {
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
        return fullVotePageResponse();
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

    await expect(buildConfiguredCorrelationSnapshotArtifact(logger)).rejects.toThrow(
      "more than 50 correlation vote pages",
    );
    const voteRequests = fetchMock.mock.calls.filter(([input]) =>
      new URL(input.toString()).pathname === "/correlation/round-votes"
    );
    expect(voteRequests).toHaveLength(50);
  });
});

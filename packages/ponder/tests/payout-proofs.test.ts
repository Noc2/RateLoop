import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";

const proofParams = {
  domain: 1,
  rewardPoolId: 7n,
  contentId: 9n,
  roundId: 2n,
  commitKey: `0x${"11".repeat(32)}` as const,
  identityKey: `0x${"22".repeat(32)}` as const,
};

const artifact = {
  payoutWeights: [
    {
      domain: proofParams.domain,
      rewardPoolId: proofParams.rewardPoolId.toString(),
      contentId: proofParams.contentId.toString(),
      roundId: proofParams.roundId.toString(),
      commitKey: proofParams.commitKey,
      identityKey: proofParams.identityKey,
      account: `0x${"33".repeat(20)}`,
      baseWeight: "10000",
      independenceBps: 10000,
      effectiveWeight: "10000",
      reasonHash: `0x${"44".repeat(32)}`,
      proof: [],
    },
  ],
};

function artifactWithPayoutWeight(overrides: Record<string, unknown>) {
  return {
    payoutWeights: [
      {
        ...artifact.payoutWeights[0],
        ...overrides,
      },
    ],
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])]),
  );
}

function artifactHash(value: unknown) {
  return keccak256(toBytes(canonicalJson(value)));
}

async function loadResolver(allowlist = "") {
  vi.resetModules();
  process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST = allowlist;
  return import("../src/payout-proofs.js");
}

function mockArtifactFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    headers: { get: () => null },
    json: async () => artifact,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  delete process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("payout artifact proof resolution", () => {
  it("resolves data URI artifacts without an HTTPS allowlist", async () => {
    const { resolveQuestionPayoutProof } = await loadResolver();
    const artifactUri = `data:application/json;base64,${Buffer.from(JSON.stringify(artifact), "utf8").toString("base64")}`;

    await expect(resolveQuestionPayoutProof({ ...proofParams, artifactUri })).resolves.toEqual(
      expect.objectContaining({ proof: [] }),
    );
  });

  it("rejects oversized data URI artifacts before base64 decoding", async () => {
    const { resolveQuestionPayoutProof } = await loadResolver();
    const bufferFromSpy = vi.spyOn(Buffer, "from");
    const oversizedPayload = "A".repeat(13_333_340);

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: `data:application/json;base64,${oversizedPayload}`,
      }),
    ).resolves.toBeNull();
    expect(bufferFromSpy).not.toHaveBeenCalled();
    bufferFromSpy.mockRestore();
  });

  it("verifies fetched artifacts against the expected on-chain hash", async () => {
    const { resolveQuestionPayoutProof } = await loadResolver();
    const artifactUri = `data:application/json;base64,${Buffer.from(JSON.stringify(artifact), "utf8").toString("base64")}`;

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactHash: artifactHash(artifact),
        artifactUri,
      }),
    ).resolves.toEqual(expect.objectContaining({ proof: [] }));

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactHash: `0x${"ff".repeat(32)}`,
        artifactUri,
      }),
    ).resolves.toBeNull();
  });

  it("rejects payout weights with malformed ABI hex widths", async () => {
    const { resolveQuestionPayoutProof } = await loadResolver();
    const badAccountArtifact = artifactWithPayoutWeight({
      account: `0x${"33".repeat(32)}`,
    });
    const badProofArtifact = artifactWithPayoutWeight({
      proof: [`0x${"55".repeat(20)}`],
    });

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: `data:application/json;base64,${Buffer.from(JSON.stringify(badAccountArtifact), "utf8").toString("base64")}`,
      }),
    ).resolves.toBeNull();

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: `data:application/json;base64,${Buffer.from(JSON.stringify(badProofArtifact), "utf8").toString("base64")}`,
      }),
    ).resolves.toBeNull();
  });

  it("fetches HTTPS artifacts from an allowed base URL", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver("https://artifacts.example.com/rateloop/");

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "https://artifacts.example.com/rateloop/0xabc.json",
      }),
    ).resolves.toEqual(expect.objectContaining({ proof: [] }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects HTTPS host suffix confusion", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver("https://artifacts.example.com/rateloop/");

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "https://artifacts.example.com.evil/rateloop/0xabc.json",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects HTTPS path prefix confusion", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver("https://artifacts.example.com/rateloop");

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "https://artifacts.example.com/rateloop-malicious/0xabc.json",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires explicit gateway allowlist entries for IPFS artifacts", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver();

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "ipfs://bafybeihash/artifact.json",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires explicit gateway allowlist entries for Arweave artifacts", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver();

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "ar://artifact-id",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows IPFS artifacts when the normalized gateway URL is allowlisted", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver("https://ipfs.io/ipfs/");

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "ipfs://bafybeihash/artifact.json",
      }),
    ).resolves.toEqual(expect.objectContaining({ proof: [] }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ipfs.io/ipfs/bafybeihash/artifact.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

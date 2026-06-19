import { afterEach, describe, expect, it, vi } from "vitest";
import { merkleProof } from "@rateloop/node-utils/correlationScoring";
import { canonicalJsonHash } from "@rateloop/node-utils/json";

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

function artifactHash(value: unknown) {
  return canonicalJsonHash(value);
}

function createCachedArtifactQuery(cachedCanonicalJson: string | null) {
  const rows = cachedCanonicalJson ? [{ canonicalJson: cachedCanonicalJson }] : [];
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return builder;
}

async function loadResolver(allowlist = "", cachedCanonicalJson: string | null = null) {
  vi.resetModules();
  process.env.PAYOUT_ARTIFACT_HTTPS_ALLOWLIST = allowlist;
  const queryBuilder = createCachedArtifactQuery(cachedCanonicalJson);
  vi.doMock("ponder:api", () => ({
    db: {
      select: vi.fn(() => queryBuilder),
    },
  }));
  vi.doMock("ponder", () => ({
    eq: (...args: unknown[]) => ({ kind: "eq", args }),
  }));
  vi.doMock("ponder:schema", () => ({
    payoutArtifactCache: {
      artifactHash: "payoutArtifactCache.artifactHash",
      canonicalJson: "payoutArtifactCache.canonicalJson",
    },
  }));
  return import("../src/api/payout-proofs.js");
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
  delete process.env.PONDER_NETWORK;
  delete process.env.RATELOOP_E2E_PRODUCTION_BUILD;
  delete process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD;
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

  it("uses cached canonical artifacts by hash before fetching the URI", async () => {
    const fetchMock = mockArtifactFetch();
    const { resolveQuestionPayoutProof } = await loadResolver(
      "https://artifacts.example.com/",
      JSON.stringify(artifact),
    );

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactHash: artifactHash(artifact),
        artifactUri: "https://artifacts.example.com/rateloop/0xabc.json",
      }),
    ).resolves.toEqual(expect.objectContaining({ proof: [] }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds fallback Merkle proofs from the matching round snapshot only", async () => {
    const targetLeaf = `0x${"aa".repeat(32)}` as const;
    const siblingLeaf = `0x${"bb".repeat(32)}` as const;
    const unrelatedLeaf = `0x${"cc".repeat(32)}` as const;
    const siblingWeight = {
      ...artifact.payoutWeights[0],
      commitKey: `0x${"55".repeat(32)}`,
      identityKey: `0x${"66".repeat(32)}`,
      leaf: siblingLeaf,
      proof: undefined,
    };
    const unrelatedWeight = {
      ...artifact.payoutWeights[0],
      commitKey: `0x${"77".repeat(32)}`,
      identityKey: `0x${"88".repeat(32)}`,
      leaf: unrelatedLeaf,
      proof: undefined,
      roundId: "3",
    };
    const scopedArtifact = {
      roundPayoutSnapshots: [
        {
          domain: proofParams.domain,
          rewardPoolId: proofParams.rewardPoolId.toString(),
          contentId: proofParams.contentId.toString(),
          roundId: proofParams.roundId.toString(),
          payoutWeights: [
            {
              ...artifact.payoutWeights[0],
              leaf: targetLeaf,
              proof: undefined,
            },
            siblingWeight,
          ],
        },
        {
          domain: proofParams.domain,
          rewardPoolId: proofParams.rewardPoolId.toString(),
          contentId: proofParams.contentId.toString(),
          roundId: "3",
          payoutWeights: [unrelatedWeight],
        },
      ],
    };
    const { resolveQuestionPayoutProof } = await loadResolver();
    const artifactUri = `data:application/json;base64,${Buffer.from(JSON.stringify(scopedArtifact), "utf8").toString("base64")}`;

    const result = await resolveQuestionPayoutProof({
      ...proofParams,
      artifactUri,
    });

    expect(result?.proof).toEqual(merkleProof([targetLeaf, siblingLeaf], targetLeaf));
    expect(result?.proof).not.toEqual(
      merkleProof([targetLeaf, siblingLeaf, unrelatedLeaf], targetLeaf),
    );
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

  it("fetches loopback HTTP artifacts only in hardhat or E2E environments", async () => {
    const fetchMock = mockArtifactFetch();
    let { resolveQuestionPayoutProof } = await loadResolver();

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "http://127.0.0.1:9091/correlation-artifacts/test.json",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.PONDER_NETWORK = "hardhat";
    ({ resolveQuestionPayoutProof } = await loadResolver());

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "http://127.0.0.1:9091/correlation-artifacts/test.json",
      }),
    ).resolves.toEqual(expect.objectContaining({ proof: [] }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9091/correlation-artifacts/test.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects non-loopback HTTP artifact URLs in hardhat", async () => {
    const fetchMock = mockArtifactFetch();
    process.env.PONDER_NETWORK = "hardhat";
    const { resolveQuestionPayoutProof } = await loadResolver();

    await expect(
      resolveQuestionPayoutProof({
        ...proofParams,
        artifactUri: "http://artifacts.example.com/rateloop/0xabc.json",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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

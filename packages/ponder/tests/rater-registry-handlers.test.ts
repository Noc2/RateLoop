import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { timestamp: bigint };
  };
  context: Record<string, unknown>;
}) => Promise<void>;

const handlers = new Map<string, RegisteredHandler>();

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      handlers.set(name, handler);
    }),
  },
}));

vi.mock("ponder:schema", () => ({
  raterClusterScore: "raterClusterScore",
  raterClusterScoreChallenge: "raterClusterScoreChallenge",
  raterClusterScoreHistory: "raterClusterScoreHistory",
  raterProfile: "raterProfile",
  raterSelfCredential: "raterSelfCredential",
  raterTrustAttestation: "raterTrustAttestation",
  raterTrustSeed: "raterTrustSeed",
}));

function createDb() {
  const upserts: Array<{
    table: string;
    values: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  const inserts: Array<{
    table: string;
    values: Record<string, unknown>;
    mode: string;
    update?: unknown;
  }> = [];
  const updates: Array<{
    table: string;
    key: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];

  return {
    db: {
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            inserts.push({ table, values, mode: "nothing" });
          }),
          onConflictDoUpdate: vi.fn(async (update: Record<string, unknown>) => {
            upserts.push({ table, values, update });
            inserts.push({ table, values, mode: "update", update });
          }),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(async (update: Record<string, unknown>) => {
          updates.push({ table, key, update });
        }),
      })),
    },
    upserts,
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/RaterRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("RaterRegistry ponder handlers", () => {
  it("indexes optional Self credentials", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:SelfCredentialAttested",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          nullifierHash: `0x${"11".repeat(32)}`,
          scope: `0x${"22".repeat(32)}`,
          legacy: false,
          verifiedAt: 100n,
          expiresAt: 200n,
          multiplierBps: 11_000,
          evidenceHash: `0x${"33".repeat(32)}`,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterSelfCredential",
        values: expect.objectContaining({
          rater: "0x0000000000000000000000000000000000001234",
          verified: true,
          legacy: false,
          revoked: false,
          multiplierBps: 11_000,
        }),
        update: expect.objectContaining({
          verified: true,
          revoked: false,
          updatedAt: 100n,
        }),
      },
    ]);
  });

  it("indexes bounded trust attestations", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterRegistry:TrustAttestationSet");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          attestationId: `0x${"44".repeat(32)}`,
          issuer: "0x0000000000000000000000000000000000001111",
          subject: "0x0000000000000000000000000000000000002222",
          categoryId: 3n,
          trustBudget: 100n,
          maxBoostBps: 11_500,
          expiresAt: 300n,
          metadataHash: `0x${"55".repeat(32)}`,
        },
        block: { timestamp: 123n },
      },
      context: { db },
    });

    expect(upserts[0]).toMatchObject({
      table: "raterTrustAttestation",
      values: {
        id: `0x${"44".repeat(32)}`,
        issuer: "0x0000000000000000000000000000000000001111",
        subject: "0x0000000000000000000000000000000000002222",
        categoryId: 3n,
        trustBudget: 100n,
        maxBoostBps: 11_500,
        expiresAt: 300n,
        metadataHash: `0x${"55".repeat(32)}`,
        issuedAt: 123n,
        revoked: false,
        updatedAt: 123n,
      },
    });
  });

  it("indexes versioned cluster scores into current and history tables", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:VersionedClusterScorePublished",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          scorerEpoch: 42n,
          modelVersionHash: `0x${"66".repeat(32)}`,
          clusterId: `0x${"44".repeat(32)}`,
          discountBps: 7_500,
          algorithmHash: `0x${"55".repeat(32)}`,
          scoreRoot: `0x${"77".repeat(32)}`,
          evidenceHash: `0x${"00".repeat(32)}`,
          challengeWindowEndsAt: 500n,
          updatedAt: 100n,
          scoreKey: `0x${"88".repeat(32)}`,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toMatchObject({
      table: "raterClusterScore",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        scorerEpoch: 42n,
        modelVersionHash: `0x${"66".repeat(32)}`,
        challengeWindowEndsAt: 500n,
        scoreKey: `0x${"88".repeat(32)}`,
      }),
    });
    expect(upserts[1]).toMatchObject({
      table: "raterClusterScoreHistory",
      values: expect.objectContaining({
        id: `0x${"88".repeat(32)}`,
        algorithmHash: `0x${"55".repeat(32)}`,
        scoreRoot: `0x${"77".repeat(32)}`,
      }),
    });
  });

  it("indexes bondless cluster score challenges and resolutions", async () => {
    const { db, inserts, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const openedHandler = registeredHandlers.get(
      "RaterRegistry:ClusterScoreChallengeOpened",
    );
    const resolvedHandler = registeredHandlers.get(
      "RaterRegistry:ClusterScoreChallengeResolved",
    );

    expect(openedHandler).toBeDefined();
    expect(resolvedHandler).toBeDefined();

    await openedHandler!({
      event: {
        args: {
          challengeId: 1n,
          challenger: "0x0000000000000000000000000000000000009999",
          scoreKey: `0x${"88".repeat(32)}`,
          rater: "0x0000000000000000000000000000000000001234",
          scorerEpoch: 42n,
          algorithmHash: `0x${"55".repeat(32)}`,
          modelVersionHash: `0x${"66".repeat(32)}`,
          evidenceHash: `0x${"99".repeat(32)}`,
          openedAt: 120n,
        },
        block: { timestamp: 120n },
      },
      context: { db },
    });

    expect(inserts[0]).toMatchObject({
      table: "raterClusterScoreChallenge",
      mode: "nothing",
      values: expect.objectContaining({
        challengeId: 1n,
        status: 1,
        resolutionHash: null,
        resolvedAt: null,
      }),
    });

    await resolvedHandler!({
      event: {
        args: {
          challengeId: 1n,
          status: 2,
          resolutionHash: `0x${"aa".repeat(32)}`,
          resolvedAt: 150n,
        },
        block: { timestamp: 150n },
      },
      context: { db },
    });

    expect(updates).toEqual([
      {
        table: "raterClusterScoreChallenge",
        key: { challengeId: 1n },
        update: {
          status: 2,
          resolutionHash: `0x${"aa".repeat(32)}`,
          resolvedAt: 150n,
        },
      },
    ]);
  });
});

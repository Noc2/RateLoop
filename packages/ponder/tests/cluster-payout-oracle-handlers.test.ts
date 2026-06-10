import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJsonHash } from "@rateloop/node-utils/json";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
  };
  context: { db: ReturnType<typeof createDb>["db"] };
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
  correlationEpochSnapshot: "correlationEpochSnapshot",
  payoutArtifactCache: "payoutArtifactCache",
  roundPayoutSnapshot: "roundPayoutSnapshot",
}));

function createDb() {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const conflictUpdates: Array<Record<string, unknown>> = [];
  const updates: Array<{
    table: string;
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];

  const db = {
    insert: vi.fn((table: string) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return {
          onConflictDoUpdate: vi.fn(async (values: Record<string, unknown>) => {
            conflictUpdates.push(values);
          }),
        };
      }),
    })),
    update: vi.fn((table: string, key: Record<string, unknown>) => ({
      set: vi.fn(async (values: Record<string, unknown>) => {
        updates.push({ table, key, values });
      }),
    })),
  };

  return { db, inserts, conflictUpdates, updates };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/ClusterPayoutOracle.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ClusterPayoutOracle ponder handlers", () => {
  it("indexes the frontend operator on correlation epoch proposals", async () => {
    const { db, inserts, conflictUpdates } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("ClusterPayoutOracle:CorrelationEpochProposed")!({
      event: {
        args: {
          epochId: 1n,
          fromRoundId: 1n,
          toRoundId: 4n,
          frontendOperator: "0x00000000000000000000000000000000000000f1",
          proposer: "0x00000000000000000000000000000000000000a1",
          clusterRoot: `0x${"1".repeat(64)}`,
          parameterHash: `0x${"2".repeat(64)}`,
          artifactHash: `0x${"3".repeat(64)}`,
          artifactURI: "ipfs://epoch",
        },
        block: { number: 10n, timestamp: 1_700n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "correlationEpochSnapshot",
      values: expect.objectContaining({
        id: 1n,
        proposer: "0x00000000000000000000000000000000000000a1",
        frontendOperator: "0x00000000000000000000000000000000000000f1",
      }),
    });
    expect(conflictUpdates).toContainEqual(
      expect.objectContaining({
        proposer: "0x00000000000000000000000000000000000000a1",
        frontendOperator: "0x00000000000000000000000000000000000000f1",
      }),
    );
  });

  it("falls back to proposer for older round payout snapshot events", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("ClusterPayoutOracle:RoundPayoutSnapshotProposed")!({
      event: {
        args: {
          snapshotKey: `0x${"a".repeat(64)}`,
          domain: 1n,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 2n,
          correlationEpochId: 1n,
          proposer: "0x00000000000000000000000000000000000000f1",
          rawEligibleVoters: 5n,
          effectiveParticipantUnits: 50_000n,
          totalClaimWeight: 100n,
          weightRoot: `0x${"4".repeat(64)}`,
          reasonRoot: `0x${"5".repeat(64)}`,
          artifactHash: `0x${"6".repeat(64)}`,
          artifactURI: "ipfs://round",
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "roundPayoutSnapshot",
      values: expect.objectContaining({
        id: `0x${"a".repeat(64)}`,
        proposer: "0x00000000000000000000000000000000000000f1",
        frontendOperator: "0x00000000000000000000000000000000000000f1",
      }),
    });
  });

  it("caches verified payout artifacts by artifact hash", async () => {
    const publicArtifact = {
      artifactVersion: "rateloop-correlation-artifact-v2",
      roundPayoutSnapshots: [],
    };
    const artifactURI = `data:application/json;base64,${Buffer.from(JSON.stringify(publicArtifact), "utf8").toString("base64")}`;
    const artifactHash = canonicalJsonHash(publicArtifact);
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("ClusterPayoutOracle:RoundPayoutSnapshotProposed")!({
      event: {
        args: {
          snapshotKey: `0x${"c".repeat(64)}`,
          domain: 1n,
          rewardPoolId: 7n,
          contentId: 9n,
          roundId: 2n,
          correlationEpochId: 1n,
          proposer: "0x00000000000000000000000000000000000000f1",
          rawEligibleVoters: 0n,
          effectiveParticipantUnits: 0n,
          totalClaimWeight: 0n,
          weightRoot: `0x${"0".repeat(64)}`,
          reasonRoot: `0x${"0".repeat(64)}`,
          artifactHash,
          artifactURI,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "payoutArtifactCache",
      values: expect.objectContaining({
        artifactHash,
        artifactUri: artifactURI,
        canonicalJson: expect.any(String),
        firstSeenAt: 1_800n,
        lastFetchedAt: 1_800n,
      }),
    });
  });

  it("updates correlation epoch lifecycle state", async () => {
    const registeredHandlers = await loadHandlers();
    const challenger = "0x00000000000000000000000000000000000000c1";

    const cases = [
      {
        handler: "ClusterPayoutOracle:CorrelationEpochChallenged",
        args: { epochId: 1n, challenger },
        blockTimestamp: 1_900n,
        expected: { challenger, status: 2, updatedAt: 1_900n },
      },
      {
        handler: "ClusterPayoutOracle:CorrelationEpochFinalized",
        args: { epochId: 1n },
        blockTimestamp: 2_000n,
        expected: { status: 3, finalizedAt: 2_000n, updatedAt: 2_000n },
      },
      {
        handler: "ClusterPayoutOracle:CorrelationEpochRejected",
        args: { epochId: 1n },
        blockTimestamp: 2_100n,
        expected: { status: 4, updatedAt: 2_100n },
      },
    ];

    for (const testCase of cases) {
      const { db, updates } = createDb();
      await registeredHandlers.get(testCase.handler)!({
        event: {
          args: testCase.args,
          block: { number: 12n, timestamp: testCase.blockTimestamp },
        },
        context: { db },
      });

      expect(updates).toContainEqual({
        table: "correlationEpochSnapshot",
        key: { id: 1n },
        values: testCase.expected,
      });
    }
  });

  it("updates round payout snapshot lifecycle state", async () => {
    const registeredHandlers = await loadHandlers();
    const snapshotKey = `0x${"b".repeat(64)}`;
    const challenger = "0x00000000000000000000000000000000000000c2";

    const cases = [
      {
        handler: "ClusterPayoutOracle:RoundPayoutSnapshotChallenged",
        args: { snapshotKey, challenger },
        blockTimestamp: 2_200n,
        expected: { challenger, status: 2, updatedAt: 2_200n },
      },
      {
        handler: "ClusterPayoutOracle:RoundPayoutSnapshotFinalized",
        args: { snapshotKey },
        blockTimestamp: 2_300n,
        expected: { status: 3, finalizedAt: 2_300n, updatedAt: 2_300n },
      },
      {
        handler: "ClusterPayoutOracle:RoundPayoutSnapshotRejected",
        args: { snapshotKey },
        blockTimestamp: 2_400n,
        expected: { status: 4, updatedAt: 2_400n },
      },
    ];

    for (const testCase of cases) {
      const { db, updates } = createDb();
      await registeredHandlers.get(testCase.handler)!({
        event: {
          args: testCase.args,
          block: { number: 13n, timestamp: testCase.blockTimestamp },
        },
        context: { db },
      });

      expect(updates).toContainEqual({
        table: "roundPayoutSnapshot",
        key: { id: snapshotKey },
        values: testCase.expected,
      });
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex: number };
  };
  context: Record<string, any>;
}) => Promise<void>;

const handlers = new Map<string, RegisteredHandler>();

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      handlers.set(name, handler);
    }),
  },
}));

vi.mock("ponder", () => ({
  and: vi.fn(() => "and"),
  asc: vi.fn((expr: unknown) => ({ kind: "asc", expr })),
  eq: vi.fn(() => "eq"),
}));

vi.mock("ponder:schema", () => ({
  category: "category",
  content: "content",
  dailyVoteActivity: "dailyVoteActivity",
  globalStats: "globalStats",
  profile: "profile",
  rewardClaim: "rewardClaim",
  round: "round",
  vote: "vote",
  voterCategoryStats: "voterCategoryStats",
  voterStats: "voterStats",
  voterStreak: "voterStreak",
}));

vi.mock("@rateloop/contracts/protocol", () => ({
  DEFAULT_ROUND_CONFIG: {
    epochDurationSeconds: 1200,
    maxDurationSeconds: 604800,
    minVoters: 3,
    maxVoters: 1000,
  },
  ROUND_STATE: {
    Open: 0,
    Settled: 1,
    Cancelled: 2,
    Tied: 3,
    RevealFailed: 4,
  },
}));

function createDb({
  existingRound = null,
  existingVote = null,
  roundVotes = [],
}: {
  existingRound?: Record<string, unknown> | null;
  existingVote?: Record<string, unknown> | null;
  roundVotes?: Record<string, unknown>[];
} = {}) {
  const insertCalls: Array<{ table: string; values: Record<string, unknown> }> =
    [];
  const updateCalls: Array<{
    table: string;
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];
  const contentRecord = {
    id: 7n,
    rating: 64,
    ratingBps: 6400,
    categoryId: 0n,
    totalVotes: 0,
    lastActivityAt: 0n,
  };
  const roundRecord = existingRound
    ? {
        id: "7-2",
        voteCount: 0,
        revealedCount: 0,
        totalStake: 0n,
        upPool: 0n,
        downPool: 0n,
        upCount: 0,
        downCount: 0,
        referenceRatingBps: 6400,
        ratingBps: 6400,
        conservativeRatingBps: 6400,
        epochDuration: 1200,
        startTime: 0n,
        ...existingRound,
      }
    : null;
  const rowsByTable: Record<string, Record<string, unknown>> = {
    content: contentRecord,
    round: roundRecord ?? {},
    vote: existingVote ?? {},
    globalStats: { totalVotes: 0, totalRoundsSettled: 0 },
    dailyVoteActivity: { voteCount: 0 },
    voterStreak: {
      currentDailyStreak: 0,
      bestDailyStreak: 0,
      lastActiveDate: "2026-04-19",
      totalActiveDays: 0,
    },
  };
  const resolveSetValues = (
    table: string,
    values:
      | Record<string, unknown>
      | ((row: Record<string, any>) => Record<string, unknown>),
  ) =>
    typeof values === "function" ? values(rowsByTable[table] ?? {}) : values;

  return {
    db: {
      find: vi.fn(async (table: string) => {
        if (table === "content") return contentRecord;
        if (table === "round") return roundRecord;
        if (table === "vote") return existingVote;
        return null;
      }),
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return {
            onConflictDoNothing: vi.fn(async () => undefined),
            onConflictDoUpdate: vi.fn(async () => undefined),
          };
        }),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(
          async (
            values:
              | Record<string, unknown>
              | ((row: Record<string, any>) => Record<string, unknown>),
          ) => {
            updateCalls.push({
              table,
              key,
              values: resolveSetValues(table, values),
            });
          },
        ),
      })),
      sql: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(async () => roundVotes),
            })),
          })),
        })),
      },
    },
    insertCalls,
    updateCalls,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/RoundVotingEngine.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("RoundVotingEngine ponder handlers", () => {
  it("inserts per-round config snapshots before votes arrive", async () => {
    const { db, insertCalls } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundVotingEngine:RoundConfigSnapshotted",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          epochDuration: 600,
          maxDuration: 7200,
          minVoters: 5,
          maxVoters: 50,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: { db },
    });

    expect(insertCalls).toEqual([
      {
        table: "round",
        values: expect.objectContaining({
          id: "7-2",
          contentId: 7n,
          roundId: 2n,
          referenceRatingBps: 6400,
          epochDuration: 600,
          maxDuration: 7200,
          minVoters: 5,
          maxVoters: 50,
        }),
      },
    ]);
  });

  it("updates an existing round when the config snapshot arrives late", async () => {
    const { db, updateCalls } = createDb({ existingRound: { id: "7-2" } });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundVotingEngine:RoundConfigSnapshotted",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          epochDuration: 900,
          maxDuration: 10800,
          minVoters: 7,
          maxVoters: 70,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: { db },
    });

    expect(updateCalls).toEqual([
      {
        table: "round",
        key: { id: "7-2" },
        values: {
          epochDuration: 900,
          maxDuration: 10800,
          minVoters: 7,
          maxVoters: 70,
        },
      },
    ]);
  });

  it("indexes canonical round reference snapshots", async () => {
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        referenceRatingBps: 6400,
        ratingBps: 6400,
        conservativeRatingBps: 6400,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundVotingEngine:RoundReferenceSnapshotted",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          roundReferenceRatingBps: 7200,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: { db },
    });

    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: {
        referenceRatingBps: 7200,
        ratingBps: 7200,
        conservativeRatingBps: 7200,
      },
    });
  });

  it("stores a late commit in the reduced reward epoch", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const { db, insertCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 1,
        totalStake: 10n,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:VoteCommitted");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          voter,
          commitHash: `0x${"11".repeat(32)}`,
          roundReferenceRatingBps: 7200,
          targetRound: 123n,
          drandChainHash: `0x${"22".repeat(32)}`,
          stake: 10n,
        },
        block: {
          number: 43n,
          timestamp: 1_601n,
        },
        log: {
          logIndex: 9,
        },
      },
      context: { db },
    });

    expect(insertCalls).toContainEqual({
      table: "vote",
      values: expect.objectContaining({
        id: `7-2-${voter}`,
        epochIndex: 1,
        committedAt: 1_601n,
        commitBlockNumber: 43n,
        commitLogIndex: 9,
      }),
    });
  });

  it("stores revealed RBTS votes and updates compatibility pools", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        referenceRatingBps: 6400,
        revealedCount: 0,
        upPool: 0n,
        downPool: 0n,
        upCount: 0,
        downCount: 0,
      },
      existingVote: {
        id: `7-2-${voter}`,
        voter,
        stake: 25n,
        revealed: false,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundVotingEngine:RbtsVoteRevealed",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          voter,
          isUp: true,
          predictedUpBps: 6800,
          effectiveWeight: 25n,
        },
        block: {
          number: 44n,
          timestamp: 2_000n,
        },
      },
      context: { db },
    });

    expect(updateCalls).toContainEqual({
      table: "vote",
      key: { id: `7-2-${voter}` },
      values: {
        isUp: true,
        predictedUpBps: 6800,
        rbtsWeight: 25n,
        revealed: true,
        revealedAt: 2_000n,
      },
    });
    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        revealedCount: 1,
        upPool: 25n,
        downPool: 0n,
        upCount: 1,
        downCount: 0,
      }),
    });
  });

  it("indexes RBTS reward scoring stats", async () => {
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        rbtsRewardWeight: null,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundVotingEngine:RbtsRewardsScored",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          scoreSeed: `0x${"11".repeat(32)}`,
          rewardWeight: 50n,
          rewardClaimants: 2n,
          forfeitedPool: 5n,
          forfeitClaimants: 1n,
        },
        block: {
          number: 45n,
          timestamp: 2_100n,
        },
      },
      context: { db },
    });

    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: {
        rbtsRewardWeight: 50n,
        rbtsRewardClaimants: 2,
        rbtsScoreSeed: `0x${"11".repeat(32)}`,
        rbtsForfeitedPool: 5n,
        rbtsForfeitClaimants: 1,
      },
    });
  });
});

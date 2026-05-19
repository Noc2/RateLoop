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
    maxDurationSeconds: 1200,
    minVoters: 3,
    maxVoters: 200,
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
        hasHumanVerifiedCommit: false,
        lastCommitRevealableAfter: null,
        revealGracePeriod: null,
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
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "commitIdentityKey") return `0x${"00".repeat(32)}`;
      if (functionName === "commitIdentityHolder") return "0x0000000000000000000000000000000000000000";
      if (functionName === "roundHasHumanVerifiedCommit") return true;
      if (functionName === "targetRoundRevealableTimestamp") return 2_000n;
      if (functionName === "roundRevealGracePeriodSnapshot") return 3_600n;
      return null;
    });
    const { db, insertCalls, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 1,
        totalStake: 10n,
        lastCommitRevealableAfter: 1_500n,
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
      context: {
        db,
        client: { readContract },
        contracts: {
          RoundVotingEngine: { address: "0x0000000000000000000000000000000000000666" },
        },
      },
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
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "roundHasHumanVerifiedCommit",
        args: [7n, 2n],
      }),
    );
    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        voteCount: 2,
        totalStake: 20n,
        hasHumanVerifiedCommit: true,
        lastCommitRevealableAfter: 2_200n,
        revealGracePeriod: 3_600n,
      }),
    });
  });

  it("attributes delegated RaterRegistry commits to the holder identity", async () => {
    const delegate = "0x0000000000000000000000000000000000000001";
    const holder = "0x0000000000000000000000000000000000000002";
    const identityKey = `0x${"33".repeat(32)}`;
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "commitIdentityKey") return identityKey;
      if (functionName === "commitIdentityHolder") return holder;
      return null;
    });
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
          voter: delegate,
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
      context: {
        db,
        client: { readContract },
        contracts: {
          RoundVotingEngine: { address: "0x0000000000000000000000000000000000000666" },
        },
      },
    });

    expect(insertCalls).toContainEqual({
      table: "vote",
      values: expect.objectContaining({
        id: `7-2-${delegate}`,
        voter: delegate,
        identityKey,
        identityHolder: holder,
        identityVoter: holder,
      }),
    });
    expect(insertCalls).toContainEqual({
      table: "dailyVoteActivity",
      values: expect.objectContaining({
        id: `${holder}-19700101`,
        voter: holder,
      }),
    });
    expect(insertCalls).toContainEqual({
      table: "voterStreak",
      values: expect.objectContaining({
        voter: holder,
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
        rbtsMeanScoreBps: 0,
        rbtsForfeitedPool: 5n,
        rbtsForfeitClaimants: 1,
      },
    });
  });

  it("returns zero-stake revealed votes without economic RBTS rewards", async () => {
    const voter1 = "0x0000000000000000000000000000000000000001";
    const voter2 = "0x0000000000000000000000000000000000000002";
    const voter3 = "0x0000000000000000000000000000000000000003";
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        rbtsRewardWeight: 0n,
      },
      roundVotes: [
        {
          id: `7-2-${voter1}`,
          voter: voter1,
          commitHash: `0x${"11".repeat(32)}`,
          revealed: true,
          isUp: true,
          predictedUpBps: 8000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter2}`,
          voter: voter2,
          commitHash: `0x${"22".repeat(32)}`,
          revealed: true,
          isUp: true,
          predictedUpBps: 7000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter3}`,
          voter: voter3,
          commitHash: `0x${"33".repeat(32)}`,
          revealed: true,
          isUp: false,
          predictedUpBps: 3000,
          rbtsWeight: 0n,
          stake: 0n,
        },
      ],
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
          rewardWeight: 0n,
          rewardClaimants: 0n,
          forfeitedPool: 0n,
          forfeitClaimants: 0n,
        },
        block: {
          number: 45n,
          timestamp: 2_100n,
        },
      },
      context: { db },
    });

    const zeroStakeUpdate = updateCalls.find(
      (call) => call.table === "vote" && call.key.id === `7-2-${voter3}`,
    );
    expect(zeroStakeUpdate).toBeDefined();
    expect(zeroStakeUpdate?.values).toMatchObject({
      rbtsRewardWeight: 0n,
      rbtsStakeReturned: 0n,
      rbtsForfeitedStake: 0n,
    });

    const stakedUpdate = updateCalls.find(
      (call) => call.table === "vote" && call.key.id === `7-2-${voter1}`,
    );
    expect(stakedUpdate).toBeDefined();
    expect(stakedUpdate?.values).toMatchObject({
      rbtsRewardWeight: 0n,
      rbtsStakeReturned: 25n,
      rbtsForfeitedStake: 0n,
    });
  });

  it("preserves economic RBTS payouts when zero-stake votes are mixed into a scored round", async () => {
    const voter1 = "0x0000000000000000000000000000000000000001";
    const voter2 = "0x0000000000000000000000000000000000000002";
    const voter3 = "0x0000000000000000000000000000000000000003";
    const voter4 = "0x0000000000000000000000000000000000000004";
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        rbtsRewardWeight: 50n,
      },
      roundVotes: [
        {
          id: `7-2-${voter1}`,
          voter: voter1,
          commitHash: `0x${"11".repeat(32)}`,
          revealed: true,
          isUp: true,
          predictedUpBps: 8000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter2}`,
          voter: voter2,
          commitHash: `0x${"22".repeat(32)}`,
          revealed: true,
          isUp: true,
          predictedUpBps: 7000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter3}`,
          voter: voter3,
          commitHash: `0x${"33".repeat(32)}`,
          revealed: true,
          isUp: false,
          predictedUpBps: 3000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter4}`,
          voter: voter4,
          commitHash: `0x${"44".repeat(32)}`,
          revealed: true,
          isUp: true,
          predictedUpBps: 6500,
          rbtsWeight: 0n,
          stake: 0n,
        },
      ],
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

    const zeroStakeUpdate = updateCalls.find(
      (call) => call.table === "vote" && call.key.id === `7-2-${voter4}`,
    );
    expect(zeroStakeUpdate).toBeDefined();
    expect(zeroStakeUpdate?.values).toMatchObject({
      rbtsRewardWeight: 0n,
      rbtsStakeReturned: 0n,
      rbtsForfeitedStake: 0n,
    });

    const economicUpdates = [voter1, voter2, voter3].map((voter) => {
      const update = updateCalls.find(
        (call) => call.table === "vote" && call.key.id === `7-2-${voter}`,
      );
      expect(update).toBeDefined();
      return update!.values;
    });
    const meanScoreBps =
      economicUpdates.reduce(
        (sum, update) => sum + 25n * BigInt(update.rbtsScoreBps as number),
        0n,
      ) / 75n;

    let positiveSpreadCount = 0;
    let negativeSpreadCount = 0;
    for (const update of economicUpdates) {
      const scoreBps = BigInt(update.rbtsScoreBps as number);
      const deltaBps = scoreBps - meanScoreBps;
      if (deltaBps > 0n) {
        positiveSpreadCount += 1;
        expect(update.rbtsRewardWeight).toBe((25n * deltaBps) / 10_000n);
        expect(update.rbtsStakeReturned).toBe(25n);
        expect(update.rbtsForfeitedStake).toBe(0n);
      } else {
        const rawForfeiture =
          deltaBps < 0n ? (25n * 15_000n * -deltaBps) / 10_000n / 10_000n : 0n;
        const forfeitedStake = rawForfeiture > 25n ? 25n : rawForfeiture;
        negativeSpreadCount += deltaBps < 0n ? 1 : 0;
        expect(update.rbtsRewardWeight).toBe(0n);
        expect(update.rbtsStakeReturned).toBe(25n - forfeitedStake);
        expect(update.rbtsForfeitedStake).toBe(forfeitedStake);
      }
    }
    expect(positiveSpreadCount).toBeGreaterThan(0);
    expect(negativeSpreadCount).toBeGreaterThan(0);
  });
});

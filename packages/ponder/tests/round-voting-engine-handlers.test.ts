import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePacked, keccak256 } from "viem";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex: number };
    transaction?: { hash: `0x${string}` };
  };
  context: Record<string, any>;
}) => Promise<void>;

const handlers = new Map<string, RegisteredHandler>();

function rbtsCommitKey(voter: `0x${string}`, commitHash: `0x${string}`) {
  return keccak256(encodePacked(["address", "bytes32"], [voter, commitHash]));
}

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
  feedbackBonusPool: "feedbackBonusPool",
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
    maxVoters: 100,
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
  feedbackBonusPools = [],
  roundVotes = [],
}: {
  existingRound?: Record<string, unknown> | null;
  existingVote?: Record<string, unknown> | null;
  feedbackBonusPools?: Record<string, unknown>[];
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
          from: vi.fn((table: string) => ({
            where: vi.fn(() => {
              const rows = table === "feedbackBonusPool" ? feedbackBonusPools : roundVotes;
              return {
                orderBy: vi.fn(async () => rows),
                then: (
                  resolve: (value: Record<string, unknown>[]) => unknown,
                  reject?: (reason: unknown) => unknown,
                ) => Promise.resolve(rows).then(resolve, reject),
              };
            }),
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
  it("stores terminal event timestamps for unresolved round outcomes", async () => {
    const registeredHandlers = await loadHandlers();
    const cases = [
      {
        eventName: "RoundVotingEngine:RoundCancelled",
        expectedState: 2,
      },
      {
        eventName: "RoundVotingEngine:RoundTied",
        expectedState: 3,
      },
      {
        eventName: "RoundVotingEngine:RoundRevealFailed",
        expectedState: 4,
      },
    ];

    for (const testCase of cases) {
      const { db, updateCalls, insertCalls } = createDb({
        existingRound: { id: "7-2" },
      });

      await registeredHandlers.get(testCase.eventName)!({
        event: {
          args: { contentId: 7n, roundId: 2n },
          block: { number: 42n, timestamp: 1_234n },
        },
        context: { db },
      });

      expect(updateCalls).toContainEqual({
        table: "round",
        key: { id: "7-2" },
        values: expect.objectContaining({
          state: testCase.expectedState,
          settledAt: 1_234n,
        }),
      });
      expect(insertCalls).toEqual([]);

      const missing = createDb();
      await registeredHandlers.get(testCase.eventName)!({
        event: {
          args: { contentId: 7n, roundId: 2n },
          block: { number: 42n, timestamp: 1_235n },
        },
        context: { db: missing.db },
      });

      expect(missing.insertCalls).toContainEqual({
        table: "round",
        values: expect.objectContaining({
          state: testCase.expectedState,
          settledAt: 1_235n,
        }),
      });
    }
  });

  it("extends feedback bonus award deadlines when a round becomes terminal", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
      feedbackBonusPools: [
        {
          id: 11n,
          contentId: 7n,
          roundId: 2n,
          feedbackClosesAt: 2_000n,
          awardDeadline: 2_000n,
        },
        {
          id: 12n,
          contentId: 7n,
          roundId: 2n,
          feedbackClosesAt: 100_000n,
          awardDeadline: 100_000n,
        },
      ],
    });

    await registeredHandlers.get("RoundVotingEngine:RoundTied")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 3_000n },
      },
      context: { db },
    });

    expect(updateCalls).toContainEqual({
      table: "feedbackBonusPool",
      key: { id: 11n },
      values: {
        awardDeadline: 89_400n,
        updatedAt: 3_000n,
      },
    });
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({
        table: "feedbackBonusPool",
        key: { id: 12n },
      }),
    );
  });

  it("does not extend feedback bonus award deadlines when a round is cancelled", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
      feedbackBonusPools: [
        {
          id: 11n,
          contentId: 7n,
          roundId: 2n,
          feedbackClosesAt: 2_000n,
          awardDeadline: 2_000n,
        },
      ],
    });

    await registeredHandlers.get("RoundVotingEngine:RoundCancelled")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 3_000n },
      },
      context: { db },
    });

    // On-chain _markRoundCancelled never sets settledAt, so the contract keeps
    // feedbackClosesAt as the award deadline; the indexer must match.
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({ table: "feedbackBonusPool" }),
    );
  });

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
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const commitKey = rbtsCommitKey(voter, commitHash);
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
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
          commitHash,
          roundReferenceRatingBps: 7200,
          targetRound: 123n,
          drandChainHash: `0x${"22".repeat(32)}`,
          stake: 10n,
          ciphertextHash,
          ciphertext,
        },
        transaction: {
          hash: `0x${"44".repeat(32)}`,
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
        commitTxHash: `0x${"44".repeat(32)}`,
        ciphertextHash,
        ciphertext,
      }),
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "commitIdentityKey",
        args: [7n, 2n, commitKey],
      }),
    );
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

  it("reuses indexed round voteability state during committed vote handling", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "commitIdentityKey") return `0x${"00".repeat(32)}`;
      if (functionName === "commitIdentityHolder") return "0x0000000000000000000000000000000000000000";
      if (functionName === "targetRoundRevealableTimestamp") return 2_000n;
      return null;
    });
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 1,
        totalStake: 10n,
        hasHumanVerifiedCommit: true,
        lastCommitRevealableAfter: 1_500n,
        revealGracePeriod: 3_600n,
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
          commitHash,
          roundReferenceRatingBps: 7200,
          targetRound: 123n,
          drandChainHash: `0x${"22".repeat(32)}`,
          stake: 10n,
          ciphertextHash,
          ciphertext,
        },
        transaction: {
          hash: `0x${"44".repeat(32)}`,
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

    expect(readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "roundHasHumanVerifiedCommit" }),
    );
    expect(readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "roundRevealGracePeriodSnapshot" }),
    );
    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
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
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const commitKey = rbtsCommitKey(delegate, commitHash);
    const ciphertext = "0xabcd" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
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
          commitHash,
          roundReferenceRatingBps: 7200,
          targetRound: 123n,
          drandChainHash: `0x${"22".repeat(32)}`,
          stake: 10n,
          ciphertextHash,
          ciphertext,
        },
        transaction: {
          hash: `0x${"55".repeat(32)}`,
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
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "commitIdentityKey",
        args: [7n, 2n, commitKey],
      }),
    );
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
    const voter = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
    const eventVoter = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
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
          voter: eventVoter,
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
    const identityKey1 = `0x${"aa".repeat(32)}`;
    const identityKey2 = `0x${"bb".repeat(32)}`;
    const identityKey3 = `0x${"cc".repeat(32)}`;
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        rbtsRewardWeight: 50n,
      },
      roundVotes: [
        {
          id: `7-2-${voter1}`,
          voter: voter1,
          identityKey: identityKey1,
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
          identityKey: identityKey2,
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
          identityKey: identityKey3,
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
          scoreSeed: `0x${"01".repeat(32)}`,
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
    expect(economicUpdates.map((update) => update.rbtsScoreBps)).toEqual([
      1800,
      8750,
      6750,
    ]);
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

  it("excludes post-threshold reveals from the indexed RBTS scoring set", async () => {
    const voter1 = "0x0000000000000000000000000000000000000001";
    const voter2 = "0x0000000000000000000000000000000000000002";
    const voter3 = "0x0000000000000000000000000000000000000003";
    const voter4 = "0x0000000000000000000000000000000000000004";
    const commitHash1 = `0x${"11".repeat(32)}` as `0x${string}`;
    const commitHash2 = `0x${"22".repeat(32)}` as `0x${string}`;
    const commitHash3 = `0x${"33".repeat(32)}` as `0x${string}`;
    const commitHash4 = `0x${"44".repeat(32)}` as `0x${string}`;
    const commitKey1 = rbtsCommitKey(voter1, commitHash1);
    const commitKey2 = rbtsCommitKey(voter2, commitHash2);
    const commitKey3 = rbtsCommitKey(voter3, commitHash3);
    const commitKey4 = rbtsCommitKey(voter4, commitHash4);
    const scoringWeights = new Map([
      [commitKey1, 25n],
      [commitKey2, 25n],
      [commitKey3, 25n],
      [commitKey4, 0n],
    ]);
    const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "commitRbtsScoringWeight") {
        return scoringWeights.get(args[2] as `0x${string}`) ?? 0n;
      }
      return null;
    });
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        rbtsRewardWeight: 50n,
      },
      roundVotes: [
        {
          id: `7-2-${voter1}`,
          voter: voter1,
          commitKey: commitKey1,
          commitHash: commitHash1,
          revealed: true,
          isUp: true,
          predictedUpBps: 8000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter2}`,
          voter: voter2,
          commitKey: commitKey2,
          commitHash: commitHash2,
          revealed: true,
          isUp: true,
          predictedUpBps: 7000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter3}`,
          voter: voter3,
          commitKey: commitKey3,
          commitHash: commitHash3,
          revealed: true,
          isUp: false,
          predictedUpBps: 3000,
          rbtsWeight: 25n,
          stake: 25n,
        },
        {
          id: `7-2-${voter4}`,
          voter: voter4,
          commitKey: commitKey4,
          commitHash: commitHash4,
          revealed: true,
          isUp: true,
          predictedUpBps: 6500,
          rbtsWeight: 25n,
          stake: 25n,
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
          scoreSeed: `0x${"01".repeat(32)}`,
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
      context: {
        db,
        client: { readContract },
        contracts: {
          RoundVotingEngine: { address: "0x0000000000000000000000000000000000000666" },
        },
      },
    });

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "commitRbtsScoringWeight",
        args: [7n, 2n, commitKey4],
      }),
    );
    const postThresholdUpdate = updateCalls.find(
      (call) => call.table === "vote" && call.key.id === `7-2-${voter4}`,
    );
    expect(postThresholdUpdate).toBeDefined();
    expect(postThresholdUpdate?.values).toMatchObject({
      rbtsRewardWeight: 0n,
      rbtsStakeReturned: 25n,
      rbtsForfeitedStake: 0n,
    });
    expect(postThresholdUpdate?.values.rbtsScoreBps).toBeUndefined();

    for (const voter of [voter1, voter2, voter3]) {
      const update = updateCalls.find(
        (call) => call.table === "vote" && call.key.id === `7-2-${voter}`,
      );
      expect(update?.values.rbtsScoreBps).toEqual(expect.any(Number));
    }
  });
});

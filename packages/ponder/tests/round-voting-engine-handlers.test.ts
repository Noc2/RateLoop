import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContractFunctionRevertedError,
  HttpRequestError,
  encodePacked,
  keccak256,
} from "viem";
import { SCORE_SPREAD_POLICY } from "@rateloop/contracts/protocol";

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
  USER_PREDICTION_BPS: { min: 100, max: 9_900 },
  USER_PREDICTION_PERCENT: { min: 1, max: 99 },
  ROUND_STATE: {
    Open: 0,
    Settled: 1,
    Cancelled: 2,
    Tied: 3,
    RevealFailed: 4,
  },
  SCORE_SPREAD_POLICY: {
    intensityBps: 15_000,
    forfeitMinReveals: 8,
    maxForfeitBps: 5_000,
  },
}));

function createDb({
  existingRound = null,
  existingVote = null,
  feedbackBonusPools = [],
  roundVotes = [],
  voterStatsRow = null,
  contentRecord: contentRecordOverride = {},
}: {
  existingRound?: Record<string, unknown> | null;
  existingVote?: Record<string, unknown> | null;
  feedbackBonusPools?: Record<string, unknown>[];
  roundVotes?: Record<string, unknown>[];
  voterStatsRow?: Record<string, unknown> | null;
  contentRecord?: Record<string, unknown>;
} = {}) {
  const insertCalls: Array<{ table: string; values: Record<string, unknown> }> =
    [];
  const conflictUpdateCalls: Array<{
    table: string;
    values: Record<string, unknown>;
  }> = [];
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
    totalRounds: 0,
    lastActivityAt: 0n,
    gated: false,
    confidentialityDisclosurePolicy: null,
    confidentialityPublishedAt: null,
    ...contentRecordOverride,
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
        humanVerifiedCommitCount: 0,
        lastCommitRevealableAfter: null,
        revealGracePeriod: null,
        ...existingRound,
      }
    : null;
  const rowsByTable: Record<string, Record<string, unknown>> = {
    content: contentRecord,
    round: roundRecord ?? {},
    vote: existingVote ?? {},
    globalStats: { totalVotes: 0, totalRoundsSettled: 0, totalVoterIds: 0 },
    dailyVoteActivity: { voteCount: 0 },
    voterStreak: {
      currentDailyStreak: 0,
      bestDailyStreak: 0,
      lastActiveDate: "2026-04-19",
      totalActiveDays: 0,
    },
  };
  if (voterStatsRow) {
    rowsByTable.voterStats = voterStatsRow;
  }
  const resolveSetValues = (
    table: string,
    values:
      | Record<string, unknown>
      | ((row: Record<string, any>) => Record<string, unknown>),
  ) =>
    typeof values === "function" ? values(rowsByTable[table] ?? {}) : values;

  return {
    conflictUpdateCalls,
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
            // Resolve the conflict updater against a known row only when the
            // test provided one; otherwise stay a no-op like before.
            onConflictDoUpdate: vi.fn(
              async (
                updater?:
                  | Record<string, unknown>
                  | ((row: Record<string, any>) => Record<string, unknown>),
              ) => {
                if (updater === undefined || !(table in rowsByTable)) {
                  return undefined;
                }
                conflictUpdateCalls.push({
                  table,
                  values: resolveSetValues(table, updater),
                });
                return undefined;
              },
            ),
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
              const rows =
                table === "feedbackBonusPool" ? feedbackBonusPools : roundVotes;
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
          maxVoters: 100,
          state: testCase.expectedState,
          settledAt: 1_235n,
        }),
      });
    }
  });

  it("keeps cancelled rounds without settledAt", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
    });

    await registeredHandlers.get("RoundVotingEngine:RoundCancelled")!({
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
        state: 2,
      }),
    });
    expect(updateCalls[0]?.values).not.toHaveProperty("settledAt");

    const missing = createDb();
    await registeredHandlers.get("RoundVotingEngine:RoundCancelled")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 1_235n },
      },
      context: { db: missing.db },
    });

    expect(missing.insertCalls).toContainEqual({
      table: "round",
      values: expect.objectContaining({
        maxVoters: 100,
        state: 2,
      }),
    });
    expect(missing.insertCalls[0]?.values).not.toHaveProperty("settledAt");
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

  it("marks after-settlement confidential content public when a round is terminal", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
      contentRecord: {
        gated: true,
        confidentialityDisclosurePolicy: "after_settlement",
        confidentialityPublishedAt: null,
      },
    });

    await registeredHandlers.get("RoundVotingEngine:RoundTied")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 3_000n },
      },
      context: { db },
    });

    expect(updateCalls).toContainEqual({
      table: "content",
      key: { id: 7n },
      values: {
        confidentialityPublishedAt: 3_000n,
      },
    });
  });

  it("keeps unsynced confidential content undisclosed at settlement", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
      contentRecord: {
        gated: true,
        confidentialityDisclosurePolicy: null,
        confidentialityPublishedAt: null,
      },
    });

    await registeredHandlers.get("RoundVotingEngine:RoundTied")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 3_000n },
      },
      context: { db },
    });

    expect(updateCalls).not.toContainEqual({
      table: "content",
      key: { id: 7n },
      values: {
        confidentialityPublishedAt: 3_000n,
      },
    });
  });

  it("keeps private-forever confidential content undisclosed at settlement", async () => {
    const registeredHandlers = await loadHandlers();
    const { db, updateCalls } = createDb({
      existingRound: { id: "7-2" },
      contentRecord: {
        gated: true,
        confidentialityDisclosurePolicy: "private_forever",
        confidentialityPublishedAt: null,
      },
    });

    await registeredHandlers.get("RoundVotingEngine:RoundRevealFailed")!({
      event: {
        args: { contentId: 7n, roundId: 2n },
        block: { number: 42n, timestamp: 3_000n },
      },
      context: { db },
    });

    expect(updateCalls).not.toContainEqual({
      table: "content",
      key: { id: 7n },
      values: {
        confidentialityPublishedAt: 3_000n,
      },
    });
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
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") {
          return [
            `0x${"00".repeat(32)}`,
            "0x0000000000000000000000000000000000000000",
            0n,
            0x08,
            0x08,
            false,
          ];
        }
        if (functionName === "advisoryRoundContext") {
          return [
            0,
            2_000n,
            `0x${"00".repeat(32)}`,
            0n,
            0n,
            false,
            "0x0000000000000000000000000000000000000000",
          ];
        }
        if (functionName === "roundLifecycleState") return [3_600n, 0n, 0n, 0n];
        return null;
      },
    );
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
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
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
        functionName: "commitIdentityState",
        args: [7n, 2n, commitKey],
      }),
    );
    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        voteCount: 2,
        totalStake: 20n,
        hasHumanVerifiedCommit: true,
        humanVerifiedCommitCount: 1,
        lastCommitRevealableAfter: 2_200n,
        revealGracePeriod: 3_600n,
      }),
    });
  });

  it("accumulates humanVerifiedCommitCount toward quorum on human-credential commits", async () => {
    const voter = "0x0000000000000000000000000000000000000002";
    const commitHash = `0x${"22".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x5678" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") {
          return [
            `0x${"00".repeat(32)}`,
            voter,
            0n,
            0x08,
            0x08,
            false,
          ];
        }
        if (functionName === "advisoryRoundContext") {
          return [
            0,
            2_000n,
            `0x${"00".repeat(32)}`,
            0n,
            0n,
            false,
            "0x0000000000000000000000000000000000000000",
          ];
        }
        if (functionName === "roundLifecycleState") return [3_600n, 0n, 0n, 0n];
        return null;
      },
    );
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 2,
        totalStake: 20n,
        minVoters: 3,
        hasHumanVerifiedCommit: true,
        humanVerifiedCommitCount: 2,
        lastCommitRevealableAfter: 1_500n,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:VoteCommitted");

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          voter,
          commitHash,
          roundReferenceRatingBps: 7200,
          targetRound: 123n,
          drandChainHash: `0x${"33".repeat(32)}`,
          stake: 10n,
          ciphertextHash,
          ciphertext,
        },
        transaction: { hash: `0x${"55".repeat(32)}` },
        block: { number: 44n, timestamp: 1_602n },
        log: { logIndex: 10 },
      },
      context: {
        db,
        client: { readContract },
        contracts: {
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
        },
      },
    });

    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        voteCount: 3,
        humanVerifiedCommitCount: 3,
        hasHumanVerifiedCommit: true,
      }),
    });
  });

  it("falls back to the address identity when the identity read reverts deterministically", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const expectedFallbackIdentityKey = keccak256(
      encodePacked(
        ["string", "address"],
        ["rateloop.address-identity-v1", voter],
      ),
    );
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") {
          throw new ContractFunctionRevertedError({
            abi: [],
            functionName: "commitIdentityState",
            message: "execution reverted",
          });
        }
        if (functionName === "advisoryRoundContext") {
          return [
            0,
            2_000n,
            `0x${"00".repeat(32)}`,
            0n,
            0n,
            false,
            "0x0000000000000000000000000000000000000000",
          ];
        }
        if (functionName === "roundLifecycleState") return [3_600n, 0n, 0n, 0n];
        return null;
      },
    );
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
        transaction: { hash: `0x${"44".repeat(32)}` },
        block: { number: 43n, timestamp: 1_601n },
        log: { logIndex: 9 },
      },
      context: {
        db,
        client: { readContract },
        contracts: {
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
        },
      },
    });

    expect(insertCalls).toContainEqual({
      table: "vote",
      values: expect.objectContaining({
        id: `7-2-${voter}`,
        identityKey: expectedFallbackIdentityKey,
        identityHolder: voter,
        credentialMask: 0,
      }),
    });
  });

  it("fails the commit handler when the identity read keeps failing transiently", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const transportFailure = new HttpRequestError({
      url: "http://localhost:8545",
      details: "fetch failed",
    });
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") throw transportFailure;
        return null;
      },
    );
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

    await expect(
      handler!({
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
          transaction: { hash: `0x${"44".repeat(32)}` },
          block: { number: 43n, timestamp: 1_601n },
          log: { logIndex: 9 },
        },
        context: {
          db,
          client: { readContract },
          contracts: {
            RoundVotingEngine: {
              address: "0x0000000000000000000000000000000000000666",
            },
          },
        },
      }),
    ).rejects.toBe(transportFailure);
    // Bounded in-process retry before failing loudly.
    expect(readContract).toHaveBeenCalledTimes(3);
    expect(insertCalls).not.toContainEqual(
      expect.objectContaining({ table: "vote" }),
    );
  });

  it("reuses indexed round voteability state during committed vote handling", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") {
          return [
            `0x${"00".repeat(32)}`,
            "0x0000000000000000000000000000000000000000",
            0n,
            0,
            0,
            false,
          ];
        }
        if (functionName === "advisoryRoundContext") {
          return [
            0,
            2_000n,
            `0x${"00".repeat(32)}`,
            0n,
            0n,
            false,
            "0x0000000000000000000000000000000000000000",
          ];
        }
        return null;
      },
    );
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 1,
        totalStake: 10n,
        hasHumanVerifiedCommit: true,
        humanVerifiedCommitCount: 1,
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
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
        },
      },
    });

    expect(readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "roundLifecycleState" }),
    );
    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        hasHumanVerifiedCommit: true,
        humanVerifiedCommitCount: 1,
        lastCommitRevealableAfter: 2_200n,
        revealGracePeriod: 3_600n,
      }),
    });
  });

  it("fails the commit handler when voteability reads keep failing transiently", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const transportFailure = new HttpRequestError({
      url: "http://localhost:8545",
      details: "fetch failed",
    });
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState") {
          return [
            `0x${"00".repeat(32)}`,
            voter,
            0n,
            0,
            0,
            false,
          ];
        }
        if (functionName === "advisoryRoundContext") throw transportFailure;
        return null;
      },
    );
    const { db, updateCalls } = createDb({
      existingRound: {
        id: "7-2",
        startTime: 1_000n,
        epochDuration: 600,
        voteCount: 1,
        totalStake: 10n,
        lastCommitRevealableAfter: 1_500n,
        revealGracePeriod: 3_600n,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:VoteCommitted");

    await expect(
      handler!({
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
          transaction: { hash: `0x${"44".repeat(32)}` },
          block: { number: 43n, timestamp: 1_601n },
          log: { logIndex: 9 },
        },
        context: {
          db,
          client: { readContract },
          contracts: {
            RoundVotingEngine: {
              address: "0x0000000000000000000000000000000000000666",
            },
          },
        },
      }),
    ).rejects.toBe(transportFailure);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "advisoryRoundContext" }),
    );
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({
        table: "round",
        values: expect.objectContaining({
          lastCommitRevealableAfter: 1_500n,
        }),
      }),
    );
  });

  it("attributes delegated RaterRegistry commits to the holder identity", async () => {
    const delegate = "0x0000000000000000000000000000000000000001";
    const holder = "0x0000000000000000000000000000000000000002";
    const identityKey = `0x${"33".repeat(32)}`;
    const commitHash = `0x${"11".repeat(32)}` as `0x${string}`;
    const commitKey = rbtsCommitKey(delegate, commitHash);
    const ciphertext = "0xabcd" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "commitIdentityState")
          return [identityKey, holder, 0n, 0, 0, false];
        return null;
      },
    );
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
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
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
      }),
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "commitIdentityState",
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

  it("returns revealed RBTS stakes without scores when the score seed is zero", async () => {
    const voter1 = "0x0000000000000000000000000000000000000001";
    const voter2 = "0x0000000000000000000000000000000000000002";
    const voter3 = "0x0000000000000000000000000000000000000003";
    const zeroSeed = `0x${"00".repeat(32)}`;
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
          scoreSeed: zeroSeed,
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

    expect(updateCalls).toContainEqual({
      table: "round",
      key: { id: "7-2" },
      values: expect.objectContaining({
        rbtsScoreSeed: zeroSeed,
        rbtsRewardWeight: 0n,
        rbtsForfeitedPool: 0n,
      }),
    });

    for (const voter of [voter1, voter2, voter3]) {
      const update = updateCalls.find(
        (call) => call.table === "vote" && call.key.id === `7-2-${voter}`,
      );
      expect(update).toBeDefined();
      expect(update?.values).toEqual({
        rbtsScoreBps: null,
        rbtsRewardWeight: 0n,
        rbtsStakeReturned: 25n,
        rbtsForfeitedStake: 0n,
      });
    }
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
      1800, 8750, 6750,
    ]);
    const totalScoreWeight = 75n;
    const weightedScoreSum = economicUpdates.reduce(
      (sum, update) => sum + 25n * BigInt(update.rbtsScoreBps as number),
      0n,
    );

    let positiveSpreadCount = 0;
    let negativeSpreadCount = 0;
    for (const update of economicUpdates) {
      const scoreBps = BigInt(update.rbtsScoreBps as number);
      const benchmarkScoreBps =
        (weightedScoreSum - 25n * scoreBps) / (totalScoreWeight - 25n);
      const deltaBps = scoreBps - benchmarkScoreBps;
      if (deltaBps > 0n) {
        positiveSpreadCount += 1;
        expect(update.rbtsRewardWeight).toBe((25n * deltaBps) / 10_000n);
        expect(update.rbtsStakeReturned).toBe(25n);
        expect(update.rbtsForfeitedStake).toBe(0n);
      } else {
        const rawForfeiture =
          deltaBps < 0n && economicUpdates.length >= SCORE_SPREAD_POLICY.forfeitMinReveals
            ? (25n * BigInt(SCORE_SPREAD_POLICY.intensityBps) * -deltaBps) / 10_000n / 10_000n
            : 0n;
        const maxForfeit = (25n * BigInt(SCORE_SPREAD_POLICY.maxForfeitBps)) / 10_000n;
        const forfeitedStake = rawForfeiture > maxForfeit ? maxForfeit : rawForfeiture;
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
    const readContract = vi.fn(
      async ({
        functionName,
        args,
      }: {
        functionName: string;
        args: unknown[];
      }) => {
        if (functionName === "rbtsCommitState") {
          return [
            0,
            0,
            scoringWeights.get(args[2] as `0x${string}`) ?? 0n,
            0n,
            0n,
          ];
        }
        return null;
      },
    );
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
          RoundVotingEngine: {
            address: "0x0000000000000000000000000000000000000666",
          },
        },
      },
    });

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "rbtsCommitState",
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

  it("treats unscored RBTS reveals as neutral in voterStats", async () => {
    const voter = "0x00000000000000000000000000000000000000a1";
    const { db, insertCalls, conflictUpdateCalls } = createDb({
      existingRound: { id: "7-2" },
      roundVotes: [
        // Degraded-round / post-threshold shape: full stake returned, never
        // scored against — on-chain this voter is not penalized at all.
        {
          id: `7-2-${voter}`,
          voter,
          isUp: true,
          stake: 100n,
          revealed: true,
          rbtsScoreBps: null,
          rbtsRewardWeight: 0n,
          rbtsStakeReturned: 100n,
          rbtsForfeitedStake: 0n,
        },
      ],
      voterStatsRow: {
        totalSettledVotes: 4,
        totalWins: 3,
        totalLosses: 1,
        totalStakeWon: 300n,
        totalStakeLost: 50n,
        currentStreak: 2,
        bestWinStreak: 3,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:RoundSettled");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: { contentId: 7n, roundId: 2n, upWins: true, losingPool: 0n },
        block: { number: 50n, timestamp: 2_200n },
      },
      context: { db },
    });

    // First-seen path: neither a win nor a loss, streak stays neutral.
    expect(insertCalls).toContainEqual(
      expect.objectContaining({
        table: "voterStats",
        values: expect.objectContaining({
          totalWins: 0,
          totalLosses: 0,
          totalStakeWon: 100n,
          totalStakeLost: 0n,
          currentStreak: 0,
          bestWinStreak: 0,
        }),
      }),
    );

    // Existing-row path: counters advance but win/loss totals and the active
    // win streak are untouched.
    const statsUpdate = conflictUpdateCalls.find(
      (call) => call.table === "voterStats",
    );
    expect(statsUpdate?.values).toEqual(
      expect.objectContaining({
        totalSettledVotes: 5,
        totalWins: 3,
        totalLosses: 1,
        totalStakeWon: 400n,
        totalStakeLost: 50n,
        currentStreak: 2,
        bestWinStreak: 3,
      }),
    );
  });

  it("increments totalVoterIds when a voter identity is first seen at settlement", async () => {
    const voter = "0x00000000000000000000000000000000000000a3";
    const { db, insertCalls } = createDb({
      existingRound: { id: "7-2" },
      roundVotes: [
        {
          id: `7-2-${voter}`,
          voter,
          isUp: true,
          stake: 100n,
          revealed: true,
          rbtsScoreBps: null,
          rbtsRewardWeight: null,
          rbtsStakeReturned: null,
          rbtsForfeitedStake: null,
        },
      ],
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:RoundSettled");

    await handler!({
      event: {
        args: { contentId: 7n, roundId: 2n, upWins: true, losingPool: 0n },
        block: { number: 50n, timestamp: 2_200n },
      },
      context: { db },
    });

    // The mock store has no voterStats row for this identity, so the handler
    // must count it as a newly seen voter id.
    expect(insertCalls).toContainEqual(
      expect.objectContaining({
        table: "globalStats",
        values: expect.objectContaining({ totalVoterIds: 1 }),
      }),
    );
  });

  it("counts an RBTS reveal as a loss only when stake was forfeited", async () => {
    const voter = "0x00000000000000000000000000000000000000a2";
    const { db, insertCalls, conflictUpdateCalls } = createDb({
      existingRound: { id: "7-2" },
      roundVotes: [
        // Scored below the round mean: part of the stake was forfeited.
        {
          id: `7-2-${voter}`,
          voter,
          isUp: false,
          stake: 100n,
          revealed: true,
          rbtsScoreBps: -500,
          rbtsRewardWeight: 0n,
          rbtsStakeReturned: 60n,
          rbtsForfeitedStake: 40n,
        },
      ],
      voterStatsRow: {
        totalSettledVotes: 4,
        totalWins: 3,
        totalLosses: 1,
        totalStakeWon: 300n,
        totalStakeLost: 50n,
        currentStreak: 2,
        bestWinStreak: 3,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RoundVotingEngine:RoundSettled");

    await handler!({
      event: {
        args: { contentId: 7n, roundId: 2n, upWins: true, losingPool: 40n },
        block: { number: 50n, timestamp: 2_200n },
      },
      context: { db },
    });

    expect(insertCalls).toContainEqual(
      expect.objectContaining({
        table: "voterStats",
        values: expect.objectContaining({
          totalWins: 0,
          totalLosses: 1,
          totalStakeWon: 60n,
          totalStakeLost: 40n,
          currentStreak: -1,
        }),
      }),
    );

    const statsUpdate = conflictUpdateCalls.find(
      (call) => call.table === "voterStats",
    );
    expect(statsUpdate?.values).toEqual(
      expect.objectContaining({
        totalSettledVotes: 5,
        totalWins: 3,
        totalLosses: 2,
        totalStakeWon: 360n,
        totalStakeLost: 90n,
        currentStreak: -1,
        bestWinStreak: 3,
      }),
    );
  });
});

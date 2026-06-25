import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex?: number | bigint | null };
    transaction?: { hash?: string | null };
  };
  context: { db: ReturnType<typeof createDb>["db"] };
}) => Promise<void>;

const handlers = new Map<string, RegisteredHandler>();
const EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH = `0x${"0".repeat(64)}`;
const FUNDER_IDENTITY_KEY = `0x${"1".repeat(64)}`;

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      handlers.set(name, handler);
    }),
  },
}));

vi.mock("ponder:schema", () => ({
  content: "content",
  questionBundleClaim: "questionBundleClaim",
  questionBundleQuestion: "questionBundleQuestion",
  questionBundleRound: "questionBundleRound",
  questionBundleRoundSet: "questionBundleRoundSet",
  questionBundleReward: "questionBundleReward",
  questionBundleTerminalSkip: "questionBundleTerminalSkip",
  questionRewardPool: "questionRewardPool",
  questionRewardPoolClaim: "questionRewardPoolClaim",
  questionRewardPoolRound: "questionRewardPoolRound",
}));

function resolveSetter(
  valuesOrUpdater:
    | Record<string, unknown>
    | ((row: any) => Record<string, unknown>),
  rowOverrides: Record<string, unknown> = {},
) {
  if (typeof valuesOrUpdater !== "function") return valuesOrUpdater;

  return valuesOrUpdater({
    allocatedAmount: 0n,
    claimedAmount: 0n,
    claimedCount: 0,
    completedRoundSetCount: 0,
    frontendClaimedAmount: 0n,
    fundedAmount: 100_000_000n,
    qualifiedRounds: 0,
    refundedAmount: 0n,
    requiredSettledRounds: 2,
    totalRecordedQuestionRounds: 0,
    unallocatedAmount: 100_000_000n,
    voterClaimedAmount: 0n,
    ...rowOverrides,
  });
}

function createDb(
  findResults: Record<string, unknown> = {},
  updateRow: Record<string, unknown> = {},
) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<{
    table: string;
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];
  const deletes: Array<{ table: string; key: Record<string, unknown> }> = [];

  const db = {
    delete: vi.fn(async (table: string, key: Record<string, unknown>) => {
      deletes.push({ table, key });
      return true;
    }),
    find: vi.fn(async (table: string, key: Record<string, unknown>) => {
      const lookupKey = `${table}:${JSON.stringify(key, (_name, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )}`;
      return findResults[lookupKey] ?? findResults[table] ?? null;
    }),
    insert: vi.fn((table: string) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return {
          onConflictDoNothing: vi.fn(async () => undefined),
          onConflictDoUpdate: vi.fn(async () => undefined),
        };
      }),
    })),
    update: vi.fn((table: string, key: Record<string, unknown>) => ({
      set: vi.fn(
        async (
          valuesOrUpdater:
            | Record<string, unknown>
            | ((row: any) => Record<string, unknown>),
        ) => {
          updates.push({ table, key, values: resolveSetter(valuesOrUpdater, updateRow) });
        },
      ),
    })),
  };

  return { db, inserts, updates, deletes };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/QuestionRewardPoolEscrow.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("QuestionRewardPoolEscrow ponder handlers", () => {
  it("indexes created bounties with USDC accounting fields", async () => {
    const { db, inserts, updates } = createDb({ content: { id: 1n } });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolCreated",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          funder: "0x0000000000000000000000000000000000000001",
          funderIdentityKey: FUNDER_IDENTITY_KEY,
          amount: 100_000_000n,
          requiredVoters: 5n,
          requiredSettledRounds: 2n,
          startRoundId: 3n,
          bountyStartBy: 86_400n,
          bountyWindowSeconds: 2_592_000n,
          feedbackWindowSeconds: 2_592_000n,
          frontendFeeBps: 300n,
          asset: 1n,
          bountyEligibility: 2n,
          bountyEligibilityDataHash: EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH,
          nonRefundable: false,
        },
        block: { number: 10n, timestamp: 1_700n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "questionRewardPool",
      values: expect.objectContaining({
        id: 7n,
        contentId: 1n,
        funderIdentityKey: FUNDER_IDENTITY_KEY,
        fundedAmount: 100_000_000n,
        unallocatedAmount: 100_000_000n,
        frontendFeeBps: 300,
        bountyKind: 0,
        bountyEligibility: 2,
        bountyEligibilityDataHash: EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH,
        challengedRoundId: 0n,
        requiredVoters: 5,
        requiredSettledRounds: 2,
        startRoundId: 3n,
        bountyStartBy: 86_400n,
        bountyOpensAt: 0n,
        bountyClosesAt: 0n,
        feedbackClosesAt: 0n,
        bountyWindowSeconds: 2_592_000,
        feedbackWindowSeconds: 2_592_000,
        expiresAt: 86_400n,
      }),
    });
    expect(updates).toContainEqual(
      expect.objectContaining({ table: "content" }),
    );
  });

  it("indexes challenge and rerate bounty purpose metadata", async () => {
    const { db, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolPurposeSet",
    );

    expect(handler).toBeDefined();

    const reasonHash =
      "0x1234000000000000000000000000000000000000000000000000000000000000";
    await handler!({
      event: {
        args: {
          rewardPoolId: 7n,
          bountyKind: 1n,
          challengedRoundId: 3n,
          reasonHash,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    expect(updates).toContainEqual({
      table: "questionRewardPool",
      key: { id: 7n },
      values: {
        bountyKind: 1,
        challengedRoundId: 3n,
        reasonHash,
        updatedAt: 1_800n,
      },
    });
  });

  it("indexes bounty eligibility", async () => {
    const { db, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const rewardPoolHandler = registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolEligibilitySet",
    );
    const bundleHandler = registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleEligibilitySet",
    );

    expect(rewardPoolHandler).toBeDefined();
    expect(bundleHandler).toBeDefined();

    await rewardPoolHandler!({
      event: {
        args: {
          rewardPoolId: 7n,
          bountyEligibility: 2n,
        },
        block: { number: 12n, timestamp: 1_900n },
      },
      context: { db },
    });

    await bundleHandler!({
      event: {
        args: {
          bundleId: 9n,
          bountyEligibility: 2n,
        },
        block: { number: 13n, timestamp: 2_000n },
      },
      context: { db },
    });

    expect(updates).toContainEqual({
      table: "questionRewardPool",
      key: { id: 7n },
      values: {
        bountyEligibility: 2,
        updatedAt: 1_900n,
      },
    });
    expect(updates).toContainEqual({
      table: "questionBundleReward",
      key: { id: 9n },
      values: {
        bountyEligibility: 2,
        updatedAt: 2_000n,
      },
    });
  });

  it("indexes activated bounty windows", async () => {
    const { db, updates } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolWindowActivated",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          bountyOpensAt: 1_700n,
          bountyClosesAt: 3_300n,
          feedbackClosesAt: 3_300n,
        },
        block: { number: 14n, timestamp: 1_710n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleWindowActivated",
    )!({
      event: {
        args: {
          bundleId: 9n,
          bountyOpensAt: 1_800n,
          bountyClosesAt: 3_400n,
          feedbackClosesAt: 3_200n,
        },
        block: { number: 15n, timestamp: 1_810n },
      },
      context: { db },
    });

    expect(updates).toContainEqual({
      table: "questionRewardPool",
      key: { id: 7n },
      values: {
        bountyOpensAt: 1_700n,
        bountyClosesAt: 3_300n,
        feedbackClosesAt: 3_300n,
        expiresAt: 3_300n,
        updatedAt: 1_710n,
      },
    });
    expect(updates).toContainEqual({
      table: "questionBundleReward",
      key: { id: 9n },
      values: {
        bountyOpensAt: 1_800n,
        bountyClosesAt: 3_400n,
        feedbackClosesAt: 3_200n,
        expiresAt: 3_400n,
        updatedAt: 1_810n,
      },
    });
  });

  it("updates bounty and round accounting for qualifications, claims, and refunds", async () => {
    const { db, inserts, updates } = createDb({
      'questionRewardPool:{"id":"7"}': { id: 7n, contentId: 1n },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRoundQualified",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          allocation: 50_000_000n,
          eligibleVoters: 5n,
          frontendFeeAllocation: 1_500_000n,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRoundEffectiveUnits",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          rawEligibleVoters: 6n,
          effectiveParticipantUnits: 4n,
          totalClaimWeight: 32_000n,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionRewardClaimed",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          claimant: "0x0000000000000000000000000000000000000002",
          identityKey:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: 9_700_000n,
          frontend: "0x00000000000000000000000000000000000000f1",
          frontendRecipient: "0x00000000000000000000000000000000000000f1",
          frontendFee: 300_000n,
          grossAmount: 10_000_000n,
        },
        block: { number: 12n, timestamp: 1_900n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRefunded",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          funder: "0x0000000000000000000000000000000000000001",
          amount: 50_000_000n,
        },
        block: { number: 13n, timestamp: 2_000n },
      },
      context: { db },
    });

    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionRewardPoolRound",
          values: expect.objectContaining({
            id: "7-3",
            allocation: 50_000_000n,
            frontendFeeAllocation: 1_500_000n,
            eligibleVoters: 5,
            rawEligibleVoters: 5,
            effectiveParticipantUnits: 5,
            totalClaimWeight: 5n,
          }),
        }),
        expect.objectContaining({
          table: "questionRewardPoolClaim",
          values: expect.objectContaining({
            id: "7-3-0x0000000000000000000000000000000000000002-0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            identityKey:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            amount: 9_700_000n,
            grossAmount: 10_000_000n,
            frontendFee: 300_000n,
          }),
        }),
      ]),
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionRewardPool",
          values: expect.objectContaining({
            allocatedAmount: 50_000_000n,
            qualifiedRounds: 1,
          }),
        }),
        expect.objectContaining({
          table: "questionRewardPoolRound",
          key: { id: "7-3" },
          values: expect.objectContaining({
            rawEligibleVoters: 6,
            effectiveParticipantUnits: 4,
            totalClaimWeight: 32_000n,
          }),
        }),
        expect.objectContaining({
          table: "questionRewardPoolRound",
          values: expect.objectContaining({
            claimedAmount: 10_000_000n,
            voterClaimedAmount: 9_700_000n,
            frontendClaimedAmount: 300_000n,
            claimedCount: 1,
          }),
        }),
        expect.objectContaining({
          table: "questionRewardPool",
          values: expect.objectContaining({
            claimedAmount: 10_000_000n,
            voterClaimedAmount: 9_700_000n,
            frontendClaimedAmount: 300_000n,
          }),
        }),
        expect.objectContaining({
          table: "questionRewardPool",
          values: expect.objectContaining({
            refundedAmount: 50_000_000n,
            unallocatedAmount: 0n,
          }),
        }),
      ]),
    );
  });

  it("does not double-count duplicate round qualifications", async () => {
    const { db, inserts, updates } = createDb({
      'questionRewardPoolRound:{"id":"7-3"}': { id: "7-3" },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRoundQualified",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          allocation: 50_000_000n,
          eligibleVoters: 5n,
          frontendFeeAllocation: 1_500_000n,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPoolRound",
        values: expect.objectContaining({ id: "7-3" }),
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({ table: "questionRewardPool" }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({ table: "content" }),
    );
  });

  it("reverses round qualification when a rejected snapshot round is recovered", async () => {
    const { db, deletes, updates } = createDb({
      'questionRewardPoolRound:{"id":"7-3"}': { id: "7-3" },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RejectedSnapshotRoundRecovered",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          allocationReturned: 50_000_000n,
        },
        block: { number: 14n, timestamp: 2_100n },
      },
      context: { db },
    });

    expect(deletes).toContainEqual({
      table: "questionRewardPoolRound",
      key: { id: "7-3" },
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPool",
        key: { id: 7n },
        values: expect.objectContaining({
          unallocatedAmount: 150_000_000n,
          allocatedAmount: -50_000_000n,
          qualifiedRounds: -1,
          updatedAt: 2_100n,
        }),
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "content",
        values: expect.objectContaining({ lastActivityAt: 2_100n }),
      }),
    );
  });

  it("ignores recovery events for rounds that were never indexed as qualified", async () => {
    const { db, deletes, updates } = createDb({ content: { id: 1n } });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RejectedSnapshotRoundRecovered",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          allocationReturned: 50_000_000n,
        },
        block: { number: 14n, timestamp: 2_100n },
      },
      context: { db },
    });

    expect(deletes).toEqual([]);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ table: "questionRewardPool" }),
    );
  });

  it("re-applies qualification accounting when a recovered round re-qualifies", async () => {
    // After RejectedSnapshotRoundRecovered deletes the round row, a fresh
    // RewardPoolRoundQualified must insert the row again and update the pool aggregates.
    const { db, inserts, updates } = createDb({ content: { id: 1n } });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRoundQualified",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          allocation: 40_000_000n,
          eligibleVoters: 4n,
          frontendFeeAllocation: 1_200_000n,
        },
        block: { number: 16n, timestamp: 2_300n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPoolRound",
        values: expect.objectContaining({
          id: "7-3",
          allocation: 40_000_000n,
          frontendFeeAllocation: 1_200_000n,
          eligibleVoters: 4,
        }),
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPool",
        key: { id: 7n },
        values: expect.objectContaining({
          allocatedAmount: 40_000_000n,
          qualifiedRounds: 1,
        }),
      }),
    );
  });

  it("touches pool and content timestamps when a recovered round is reopened", async () => {
    const { db, updates } = createDb({
      'questionRewardPool:{"id":"7"}': { id: 7n, contentId: 1n },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RecoveredSnapshotRoundReopened",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          newWeightRoot: `0x${"2".repeat(64)}`,
        },
        block: { number: 15n, timestamp: 2_200n },
      },
      context: { db },
    });

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPool",
        key: { id: 7n },
        values: expect.objectContaining({ updatedAt: 2_200n }),
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "content",
        values: expect.objectContaining({ lastActivityAt: 2_200n }),
      }),
    );
  });

  it("does not double-count duplicate question reward claims", async () => {
    const claimId =
      "7-3-0x0000000000000000000000000000000000000002-0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { db, inserts, updates } = createDb({
      [`questionRewardPoolClaim:{"id":"${claimId}"}`]: { id: claimId },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionRewardClaimed",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          contentId: 1n,
          roundId: 3n,
          claimant: "0x0000000000000000000000000000000000000002",
          identityKey:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: 9_700_000n,
          frontend: "0x00000000000000000000000000000000000000f1",
          frontendRecipient: "0x00000000000000000000000000000000000000f1",
          frontendFee: 300_000n,
          grossAmount: 10_000_000n,
        },
        block: { number: 12n, timestamp: 1_900n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: "questionRewardPoolClaim",
        values: expect.objectContaining({ id: claimId }),
      }),
    );
    expect(updates).toEqual([]);
  });

  it("indexes multi-round bundle reward round sets and claims", async () => {
    const { db, inserts, updates } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRewardCreated",
    )!({
      event: {
        args: {
          bundleId: 9n,
          funder: "0x0000000000000000000000000000000000000001",
          funderIdentityKey: FUNDER_IDENTITY_KEY,
          amount: 120_000_000n,
          requiredCompleters: 3n,
          questionCount: 2n,
          requiredSettledRounds: 2n,
          bountyStartBy: 86_400n,
          bountyWindowSeconds: 2_592_000n,
          feedbackWindowSeconds: 2_592_000n,
          frontendFeeBps: 300n,
          asset: 1n,
          bountyEligibility: 2n,
          bountyEligibilityDataHash: EMPTY_BOUNTY_ELIGIBILITY_DATA_HASH,
        },
        block: { number: 20n, timestamp: 1_700n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRoundRecorded",
    )!({
      event: {
        args: {
          bundleId: 9n,
          contentId: 101n,
          roundId: 4n,
          bundleIndex: 0n,
          roundSetIndex: 1n,
        },
        block: { number: 21n, timestamp: 1_800n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRoundSetQualified",
    )!({
      event: {
        args: {
          bundleId: 9n,
          roundSetIndex: 1n,
          allocation: 60_000_000n,
          frontendFeeAllocation: 1_800_000n,
        },
        block: { number: 22n, timestamp: 1_900n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRewardClaimed",
    )!({
      event: {
        args: {
          bundleId: 9n,
          roundSetIndex: 1n,
          claimant: "0x00000000000000000000000000000000000000A2",
          identityKey:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          amount: 19_400_000n,
          frontend: "0x00000000000000000000000000000000000000f1",
          frontendRecipient: "0x00000000000000000000000000000000000000f1",
          frontendFee: 600_000n,
          grossAmount: 20_000_000n,
        },
        block: { number: 23n, timestamp: 2_000n },
      },
      context: { db },
    });

    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionBundleReward",
          values: expect.objectContaining({
            id: 9n,
            fundedAmount: 120_000_000n,
            unallocatedAmount: 120_000_000n,
            requiredCompleters: 3,
            requiredSettledRounds: 2,
            questionCount: 2,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleRound",
          values: expect.objectContaining({
            id: "9-1-0",
            bundleId: 9n,
            roundSetIndex: 1,
            roundId: 4n,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleRoundSet",
          values: expect.objectContaining({
            id: "9-1",
            allocation: 60_000_000n,
            frontendFeeAllocation: 1_800_000n,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleClaim",
          values: expect.objectContaining({
            id: "9-1-0x00000000000000000000000000000000000000a2-0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            identityKey:
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            roundSetIndex: 1,
            amount: 19_400_000n,
            frontendFee: 600_000n,
          }),
        }),
      ]),
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionBundleReward",
          values: expect.objectContaining({ totalRecordedQuestionRounds: 1 }),
        }),
        expect.objectContaining({
          table: "questionBundleReward",
          values: expect.objectContaining({
            unallocatedAmount: 40_000_000n,
            allocatedAmount: 60_000_000n,
            completedRoundSetCount: 1,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleRoundSet",
          values: expect.objectContaining({
            claimedAmount: 20_000_000n,
            voterClaimedAmount: 19_400_000n,
            frontendClaimedAmount: 600_000n,
            claimedCount: 1,
          }),
        }),
      ]),
    );
  });

  it("removes recovered bundle round sets and reverses indexed allocation once", async () => {
    const { db, deletes, updates } = createDb(
      {
        'questionBundleRoundSet:{"id":"9-1"}': { id: "9-1" },
      },
      {
        unallocatedAmount: 40_000_000n,
        allocatedAmount: 60_000_000n,
        completedRoundSetCount: 1,
      },
    );
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RejectedSnapshotBundleRoundSetRecovered",
    )!({
      event: {
        args: {
          bundleId: 9n,
          roundSetIndex: 1n,
          allocationReturned: 60_000_000n,
        },
        block: { number: 24n, timestamp: 2_100n },
      },
      context: { db },
    });

    expect(deletes).toContainEqual({
      table: "questionBundleRoundSet",
      key: { id: "9-1" },
    });
    expect(updates).toContainEqual({
      table: "questionBundleReward",
      key: { id: 9n },
      values: {
        unallocatedAmount: 100_000_000n,
        allocatedAmount: 0n,
        updatedAt: 2_100n,
      },
    });
  });

  it("does not double-apply bundle recovery accounting when the round set is absent", async () => {
    const { db, deletes, updates } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RejectedSnapshotBundleRoundSetRecovered",
    )!({
      event: {
        args: {
          bundleId: 9n,
          roundSetIndex: 1n,
          allocationReturned: 60_000_000n,
        },
        block: { number: 24n, timestamp: 2_100n },
      },
      context: { db },
    });

    expect(deletes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("marks reopened recovered bundle round sets as bundle activity", async () => {
    const { db, updates } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RecoveredSnapshotBundleRoundSetReopened",
    )!({
      event: {
        args: {
          bundleId: 9n,
          roundSetIndex: 1n,
          newWeightRoot: `0x${"3".repeat(64)}`,
        },
        block: { number: 25n, timestamp: 2_200n },
      },
      context: { db },
    });

    expect(updates).toEqual([
      {
        table: "questionBundleReward",
        key: { id: 9n },
        values: {
          updatedAt: 2_200n,
        },
      },
    ]);
  });

  it("persists bundle terminal skip diagnostics by emitted log", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleTerminalSkipped",
    )!({
      event: {
        args: {
          bundleId: 9n,
          contentId: 101n,
          roundId: 4n,
          reasonCode: 2n,
        },
        block: { number: 26n, timestamp: 2_300n },
        log: { logIndex: 7 },
        transaction: {
          hash: "0x1234000000000000000000000000000000000000000000000000000000000000",
        },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "questionBundleTerminalSkip",
      values: {
        id: "0x1234000000000000000000000000000000000000000000000000000000000000-7",
        bundleId: 9n,
        contentId: 101n,
        roundId: 4n,
        reasonCode: 2,
        blockNumber: 26n,
        logIndex: 7,
        transactionHash:
          "0x1234000000000000000000000000000000000000000000000000000000000000",
        skippedAt: 2_300n,
      },
    });
  });

  it("zeros allocated balance and marks pools refunded on complete residue sweeps", async () => {
    const { db, updates } = createDb(
      {},
      {
        unallocatedAmount: 10_000_000n,
        allocatedAmount: 80_000_000n,
        claimedAmount: 10_000_000n,
        qualifiedRounds: 2,
      },
    );
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:RewardPoolRefunded",
    )!({
      event: {
        args: {
          rewardPoolId: 7n,
          funder: "0x0000000000000000000000000000000000000001",
          amount: 90_000_000n,
        },
        block: { number: 13n, timestamp: 2_000n },
      },
      context: { db },
    });

    expect(updates).toContainEqual({
      table: "questionRewardPool",
      key: { id: 7n },
      values: {
        unallocatedAmount: 0n,
        allocatedAmount: 0n,
        refundedAmount: 90_000_000n,
        refunded: true,
        updatedAt: 2_000n,
      },
    });
  });

  it("marks bundle rewards refunded when unused funds are returned or forfeited", async () => {
    const { db, updates } = createDb();
    const registeredHandlers = await loadHandlers();

    expect(
      registeredHandlers.has("QuestionRewardPoolEscrow:QuestionBundleFailed"),
    ).toBe(false);

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRewardRefunded",
    )!({
      event: {
        args: {
          bundleId: 9n,
          funder: "0x0000000000000000000000000000000000000001",
          amount: 30_000_000n,
        },
        block: { number: 21n, timestamp: 2_100n },
      },
      context: { db },
    });

    await registeredHandlers.get(
      "QuestionRewardPoolEscrow:QuestionBundleRewardForfeited",
    )!({
      event: {
        args: {
          bundleId: 10n,
          treasury: "0x0000000000000000000000000000000000000003",
          amount: 20_000_000n,
        },
        block: { number: 22n, timestamp: 2_200n },
      },
      context: { db },
    });

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionBundleReward",
          key: { id: 9n },
          values: expect.objectContaining({
            refunded: true,
            refundedAmount: 30_000_000n,
            allocatedAmount: 0n,
            unallocatedAmount: 0n,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleReward",
          key: { id: 10n },
          values: expect.objectContaining({
            refunded: true,
            refundedAmount: 20_000_000n,
            allocatedAmount: 0n,
            unallocatedAmount: 0n,
          }),
        }),
      ]),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { timestamp: bigint };
    transaction: { hash: `0x${string}` };
    log: { logIndex: number };
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
  globalStats: "globalStats",
  launchRaterRewardProgress: "launchRaterRewardProgress",
  launchRewardPolicyState: "launchRewardPolicyState",
  profile: "profile",
  rewardClaim: "rewardClaim",
}));

function createDb(existingProfile: Record<string, unknown> | null = null) {
  const inserts: Array<{
    table: string;
    values: Record<string, unknown>;
    mode: string;
    update?: unknown;
  }> = [];
  const updates: Array<{
    table: string;
    key: Record<string, unknown>;
    update: unknown;
  }> = [];
  const finds: Array<{ table: string; key: Record<string, unknown> }> = [];

  return {
    db: {
      find: vi.fn(async (table: string, key: Record<string, unknown>) => {
        finds.push({ table, key });
        return table === "profile" ? existingProfile : null;
      }),
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            inserts.push({ table, values, mode: "nothing" });
          }),
          onConflictDoUpdate: vi.fn(async (update: unknown) => {
            inserts.push({ table, values, mode: "update", update });
          }),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(async (update: unknown) => {
          updates.push({ table, key, update });
        }),
      })),
    },
    finds,
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/LaunchDistributionPool.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("LaunchDistributionPool ponder handlers", () => {
  it("indexes credited launch reward progress before payout", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "LaunchDistributionPool:EarnedRaterRewardCreditRecorded",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          contentId: 11n,
          roundId: 7n,
          commitKey: `0x${"11".repeat(32)}`,
          scoreBps: 8_000,
          qualifyingRatingCount: 4,
          qualifyingCreditBps: 37_500n,
          distinctVerifiedAnchorCount: 2,
          distinctAnchorRoundCount: 4,
          payoutEligible: false,
        },
        block: { timestamp: 500n },
        transaction: { hash: `0x${"aa".repeat(32)}` },
        log: { logIndex: 0 },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "launchRaterRewardProgress",
      mode: "update",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        qualifyingRatingCount: 4,
        qualifyingCreditBps: 37_500n,
        distinctVerifiedAnchorCount: 2,
        distinctAnchorRoundCount: 4,
        payoutEligible: false,
        lastQualifiedContentId: 11n,
        lastQualifiedRoundId: 7n,
        lastScoreBps: 8_000,
        eligibleAt: null,
        latestCreditedAt: 500n,
        updatedAt: 500n,
      }),
      update: expect.any(Function),
    });
  });

  it("indexes paid launch rewards into claims and progress", async () => {
    const { db, finds, inserts, updates } = createDb({
      address: "0x0000000000000000000000000000000000001234",
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "LaunchDistributionPool:EarnedRaterRewardPaid",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          contentId: 11n,
          roundId: 8n,
          commitKey: `0x${"22".repeat(32)}`,
          amount: 1_000_000n,
          scoreBps: 8_500,
          qualifyingRatingCount: 5,
          qualifyingCreditBps: 47_500n,
          rewardedRatingCount: 1,
          distinctVerifiedAnchorCount: 2,
          distinctAnchorRoundCount: 5,
        },
        block: { timestamp: 600n },
        transaction: { hash: `0x${"bb".repeat(32)}` },
        log: { logIndex: 1 },
      },
      context: { db },
    });

    expect(finds).toEqual([
      {
        table: "profile",
        key: { address: "0x0000000000000000000000000000000000001234" },
      },
    ]);
    expect(updates).toContainEqual({
      table: "profile",
      key: { address: "0x0000000000000000000000000000000000001234" },
      update: expect.any(Function),
    });
    expect(inserts).toContainEqual({
      table: "rewardClaim",
      mode: "nothing",
      values: {
        id: `0x${"bb".repeat(32)}-1`,
        contentId: 11n,
        roundId: 8n,
        source: "launch",
        voter: "0x0000000000000000000000000000000000001234",
        stakeReturned: 0n,
        lrepReward: 1_000_000n,
        claimedAt: 600n,
      },
    });
    expect(inserts).toContainEqual({
      table: "launchRaterRewardProgress",
      mode: "update",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        qualifyingRatingCount: 5,
        qualifyingCreditBps: 47_500n,
        rewardedRatingCount: 1,
        payoutEligible: true,
        launchPaid: 1_000_000n,
        latestPaidAt: 600n,
      }),
      update: expect.any(Function),
    });
  });

  it("indexes launch policy and cap assignments", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const policyHandler = registeredHandlers.get(
      "LaunchDistributionPool:LaunchRewardPolicyUpdated",
    );
    const capHandler = registeredHandlers.get(
      "LaunchDistributionPool:RaterLaunchCapAssigned",
    );

    expect(policyHandler).toBeDefined();
    expect(capHandler).toBeDefined();

    await policyHandler!({
      event: {
        args: {
          policy: {
            minQualifyingScoreBps: 7_000,
            minVoters: 3,
            minVerifiedHumans: 1,
            minDistinctVerifiedAnchors: 2,
            minDistinctAnchorRounds: 2,
            eligibilityRatingCount: 5,
            rewardingRatingCount: 10,
            unverifiedEarnedRaterCapBps: 10_000,
            requireNoPendingCleanup: true,
          },
        },
        block: { timestamp: 700n },
        transaction: { hash: `0x${"cc".repeat(32)}` },
        log: { logIndex: 2 },
      },
      context: { db },
    });

    await capHandler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          cap: 10_000_000n,
          cohortIndex: 2,
        },
        block: { timestamp: 710n },
        transaction: { hash: `0x${"dd".repeat(32)}` },
        log: { logIndex: 3 },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "launchRewardPolicyState",
      mode: "update",
      values: {
        id: "current",
        minQualifyingScoreBps: 7_000,
        minVoters: 3,
        minVerifiedHumans: 1,
        minDistinctVerifiedAnchors: 2,
        minDistinctAnchorRounds: 2,
        eligibilityRatingCount: 5,
        rewardingRatingCount: 10,
        unverifiedEarnedRaterCapBps: 10_000,
        requireNoPendingCleanup: true,
        updatedAt: 700n,
      },
      update: expect.objectContaining({
        minQualifyingScoreBps: 7_000,
        unverifiedEarnedRaterCapBps: 10_000,
        updatedAt: 700n,
      }),
    });
    expect(inserts).toContainEqual({
      table: "launchRaterRewardProgress",
      mode: "update",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        launchCap: 10_000_000n,
        cohortIndex: 2,
        updatedAt: 710n,
      }),
      update: expect.objectContaining({
        launchCap: 10_000_000n,
        cohortIndex: 2,
        updatedAt: 710n,
      }),
    });
  });

  it("indexes launch cap status and full-cap unlock catch-up", async () => {
    const { db, finds, inserts } = createDb({
      address: "0x0000000000000000000000000000000000001234",
    });
    const registeredHandlers = await loadHandlers();
    const statusHandler = registeredHandlers.get(
      "LaunchDistributionPool:RaterLaunchCapStatusUpdated",
    );
    const unlockHandler = registeredHandlers.get(
      "LaunchDistributionPool:RaterLaunchCapUnlocked",
    );

    expect(statusHandler).toBeDefined();
    expect(unlockHandler).toBeDefined();

    await statusHandler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          activeCap: 2_500_000n,
          fullCap: 10_000_000n,
          activeCapBps: 2_500,
          fullCapUnlocked: false,
        },
        block: { timestamp: 720n },
        transaction: { hash: `0x${"ee".repeat(32)}` },
        log: { logIndex: 4 },
      },
      context: { db },
    });

    await unlockHandler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          nullifierHash: `0x${"33".repeat(32)}`,
          previousCap: 2_500_000n,
          fullCap: 10_000_000n,
          catchUpPaid: 750_000n,
        },
        block: { timestamp: 730n },
        transaction: { hash: `0x${"ff".repeat(32)}` },
        log: { logIndex: 5 },
      },
      context: { db },
    });

    expect(finds).toContainEqual({
      table: "profile",
      key: { address: "0x0000000000000000000000000000000000001234" },
    });
    expect(inserts).toContainEqual({
      table: "launchRaterRewardProgress",
      mode: "update",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        launchCap: 2_500_000n,
        fullLaunchCap: 10_000_000n,
        capBps: 2_500,
        fullCapUnlocked: false,
        updatedAt: 720n,
      }),
      update: expect.objectContaining({
        launchCap: 2_500_000n,
        fullLaunchCap: 10_000_000n,
        capBps: 2_500,
        fullCapUnlocked: false,
      }),
    });
    expect(inserts).toContainEqual({
      table: "rewardClaim",
      mode: "nothing",
      values: expect.objectContaining({
        id: `0x${"ff".repeat(32)}-5`,
        source: "launch",
        voter: "0x0000000000000000000000000000000000001234",
        lrepReward: 750_000n,
        claimedAt: 730n,
      }),
    });
    expect(inserts).toContainEqual({
      table: "launchRaterRewardProgress",
      mode: "update",
      values: expect.objectContaining({
        launchCap: 10_000_000n,
        fullLaunchCap: 10_000_000n,
        capBps: 10_000,
        fullCapUnlocked: true,
        capUnlockNullifierHash: `0x${"33".repeat(32)}`,
        launchPaid: 750_000n,
        latestPaidAt: 730n,
      }),
      update: expect.any(Function),
    });
  });
});

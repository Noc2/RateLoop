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
  globalStats: "globalStats",
  profile: "profile",
  rewardClaim: "rewardClaim",
}));

function resolveUpdater(
  update: Record<string, unknown> | ((row: Record<string, unknown>) => Record<string, unknown>),
  row: Record<string, unknown>,
) {
  return typeof update === "function" ? update(row) : update;
}

function createDb({
  voterProfile = null,
  payerProfile = null,
  globalStatsRow = null,
}: {
  voterProfile?: Record<string, unknown> | null;
  payerProfile?: Record<string, unknown> | null;
  globalStatsRow?: Record<string, unknown> | null;
} = {}) {
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

  const voter = "0x0000000000000000000000000000000000000001";
  const stakePayer = "0x0000000000000000000000000000000000000002";

  return {
    db: {
      find: vi.fn(async (table: string, key: Record<string, unknown>) => {
        if (table !== "profile") return null;
        if (key.address === voter) return voterProfile;
        if (key.address === stakePayer) return payerProfile;
        return null;
      }),
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            inserts.push({ table, values, mode: "nothing" });
          }),
          onConflictDoUpdate: vi.fn(async (update: unknown) => {
            inserts.push({
              table,
              values,
              mode: "update",
              update: resolveUpdater(
                update as Record<string, unknown> | ((row: Record<string, unknown>) => Record<string, unknown>),
                globalStatsRow ?? { totalRewardsClaimed: 0n },
              ),
            });
          }),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(
          async (
            update:
              | Record<string, unknown>
              | ((row: Record<string, unknown>) => Record<string, unknown>),
          ) => {
            const baseRow =
              key.address === voter
                ? (voterProfile ?? { totalRewardsClaimed: 0n })
                : (payerProfile ?? { totalRewardsClaimed: 0n });
            updates.push({
              table,
              key,
              update: resolveUpdater(update, baseRow),
            });
          },
        ),
      })),
    },
    inserts,
    updates,
    voter,
    stakePayer,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/RoundRewardDistributor.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("RoundRewardDistributor ponder handlers", () => {
  it("indexes round reward claims and credits voter and stake payer profiles", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const stakePayer = "0x0000000000000000000000000000000000000002";
    const { db, inserts, updates } = createDb({
      voterProfile: { address: voter, totalRewardsClaimed: 100n },
      payerProfile: { address: stakePayer, totalRewardsClaimed: 50n },
      globalStatsRow: { totalRewardsClaimed: 1_000n },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RoundRewardDistributor:RewardClaimed",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          voter,
          stakePayer,
          stakeReturned: 25n,
          reward: 75n,
        },
        block: { timestamp: 2_000n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "rewardClaim",
      mode: "nothing",
      values: expect.objectContaining({
        id: "7-2-0x0000000000000000000000000000000000000001",
        contentId: 7n,
        roundId: 2n,
        source: "round",
        voter,
        stakePayer,
        stakeReturned: 25n,
        lrepReward: 75n,
        claimedAt: 2_000n,
      }),
    });
    expect(inserts).toContainEqual({
      table: "globalStats",
      mode: "update",
      values: expect.objectContaining({
        id: "global",
        totalRewardsClaimed: 100n,
      }),
      update: { totalRewardsClaimed: 1_100n },
    });
    expect(updates).toContainEqual({
      table: "profile",
      key: { address: voter },
      update: { totalRewardsClaimed: 175n },
    });
    expect(updates).toContainEqual({
      table: "profile",
      key: { address: stakePayer },
      update: { totalRewardsClaimed: 75n },
    });
  });
});

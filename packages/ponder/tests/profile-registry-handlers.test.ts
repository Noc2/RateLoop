import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: {
      name: string;
      selfReport: string;
      user: `0x${string}`;
    };
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex: number };
    transaction?: { hash: `0x${string}` };
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
  profileSelfReportHistory: "profileSelfReportHistory",
}));

function createDb(existingProfile: Record<string, unknown> | null = null) {
  const inserts: Array<{
    mode: "nothing" | "update";
    table: string;
    update?: unknown;
    values: Record<string, unknown>;
  }> = [];
  const updates: Array<{
    key: Record<string, unknown>;
    table: string;
    values: Record<string, unknown>;
  }> = [];

  return {
    db: {
      find: vi.fn(async () => existingProfile),
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            inserts.push({ mode: "nothing", table, values });
          }),
          onConflictDoUpdate: vi.fn(async (update: unknown) => {
            inserts.push({ mode: "update", table, update, values });
          }),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(async (values: Record<string, unknown>) => {
          updates.push({ key, table, values });
        }),
      })),
    },
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/ProfileRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ProfileRegistry ponder handlers", () => {
  it("stores self-report history when a profile is created", async () => {
    const user = "0x0000000000000000000000000000000000001234" as const;
    const transactionHash = `0x${"a".repeat(64)}` as const;
    const selfReport = JSON.stringify({
      raterType: 1,
      roles: ["engineer"],
      v: 2,
    });
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ProfileRegistry:ProfileCreated");

    expect(handler).toBeDefined();
    await handler!({
      context: { db },
      event: {
        args: { name: "Ada", selfReport, user },
        block: { number: 10n, timestamp: 100n },
        log: { logIndex: 7 },
        transaction: { hash: transactionHash },
      },
    });

    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "nothing",
          table: "profileSelfReportHistory",
          values: expect.objectContaining({
            address: user,
            blockNumber: 10n,
            createdAt: 100n,
            id: `${user}-10-7`,
            logIndex: 7,
            name: "Ada",
            selfReport,
            transactionHash,
            updatedAt: 100n,
          }),
        }),
      ]),
    );
  });

  it("stores self-report history with the original profile creation time on update", async () => {
    const user = "0x0000000000000000000000000000000000001234" as const;
    const selfReport = JSON.stringify({
      languages: ["de"],
      roles: ["engineer"],
      v: 2,
    });
    const { db, inserts, updates } = createDb({ createdAt: 50n });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ProfileRegistry:ProfileUpdated");

    expect(handler).toBeDefined();
    await handler!({
      context: { db },
      event: {
        args: { name: "Ada Lovelace", selfReport, user },
        block: { number: 20n, timestamp: 200n },
        log: { logIndex: 3 },
      },
    });

    expect(updates).toEqual([
      {
        key: { address: user },
        table: "profile",
        values: expect.objectContaining({
          name: "Ada Lovelace",
          selfReport,
          updatedAt: 200n,
        }),
      },
    ]);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "nothing",
          table: "profileSelfReportHistory",
          values: expect.objectContaining({
            address: user,
            blockNumber: 20n,
            createdAt: 50n,
            id: `${user}-20-3`,
            logIndex: 3,
            name: "Ada Lovelace",
            selfReport,
            transactionHash: null,
            updatedAt: 200n,
          }),
        }),
      ]),
    );
  });
});

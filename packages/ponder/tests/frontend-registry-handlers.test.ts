import { afterEach, describe, expect, it, vi } from "vitest";

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
  frontend: "frontend",
}));

const BASE_ROW = {
  stakedAmount: 1000_000000n,
  slashed: false,
  exitAvailableAt: null,
  totalFeesCredited: 0n,
  totalFeesClaimed: 0n,
  totalFeesConfiscated: 0n,
};

function createDb(row: Record<string, unknown> = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
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
            | ((current: Record<string, unknown>) => Record<string, unknown>),
        ) => {
          const values =
            typeof valuesOrUpdater === "function"
              ? valuesOrUpdater({ ...BASE_ROW, ...row })
              : valuesOrUpdater;
          updates.push({ table, key, values });
        },
      ),
    })),
  };

  return { db, inserts, updates };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/FrontendRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

const FRONTEND = "0x00000000000000000000000000000000000000f1";

describe("FrontendRegistry ponder handlers", () => {
  it("initializes cumulative fee counters on registration", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("FrontendRegistry:FrontendRegistered")!({
      event: {
        args: {
          frontend: FRONTEND,
          operator: "0x0000000000000000000000000000000000000001",
          stakedAmount: 1000_000000n,
        },
        block: { number: 1n, timestamp: 1_000n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "frontend",
      values: expect.objectContaining({
        address: FRONTEND,
        totalFeesCredited: 0n,
        totalFeesClaimed: 0n,
        totalFeesConfiscated: 0n,
      }),
    });
  });

  it("accumulates credited and claimed fees", async () => {
    const { db, updates } = createDb({
      totalFeesCredited: 5_000000n,
      totalFeesClaimed: 1_000000n,
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("FrontendRegistry:FeesCredited")!({
      event: {
        args: { frontend: FRONTEND, lrepAmount: 2_000000n },
        block: { number: 2n, timestamp: 1_100n },
      },
      context: { db },
    });
    await registeredHandlers.get("FrontendRegistry:FeesClaimed")!({
      event: {
        args: { frontend: FRONTEND, lrepAmount: 3_000000n },
        block: { number: 3n, timestamp: 1_200n },
      },
      context: { db },
    });

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "frontend",
        key: { address: FRONTEND },
        values: { totalFeesCredited: 7_000000n },
      }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "frontend",
        key: { address: FRONTEND },
        values: expect.objectContaining({ totalFeesClaimed: 4_000000n }),
      }),
    );
  });

  it("accumulates confiscated fees so pending fees do not overstate after a slash", async () => {
    const { db, updates } = createDb({ totalFeesConfiscated: 1_000000n });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("FrontendRegistry:FeesConfiscated")!({
      event: {
        args: { frontend: FRONTEND, lrepAmount: 4_000000n },
        block: { number: 4n, timestamp: 1_300n },
      },
      context: { db },
    });

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "frontend",
        key: { address: FRONTEND },
        values: { totalFeesConfiscated: 5_000000n },
      }),
    );
  });
});

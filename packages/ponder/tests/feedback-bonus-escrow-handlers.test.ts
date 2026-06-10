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
  content: "content",
  feedbackBonusAward: "feedbackBonusAward",
  feedbackBonusPool: "feedbackBonusPool",
  round: "round",
}));

function resolveSetter(valuesOrUpdater: Record<string, unknown> | ((row: any) => Record<string, unknown>)) {
  if (typeof valuesOrUpdater !== "function") return valuesOrUpdater;

  return valuesOrUpdater({
    awardCount: 0,
    awardedAmount: 0n,
    forfeitedAmount: 0n,
    frontendAwardedAmount: 0n,
    remainingAmount: 100_000_000n,
    voterAwardedAmount: 0n,
  });
}

function createDb(findResults: Record<string, unknown> = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; key: Record<string, unknown>; values: Record<string, unknown> }> = [];

  const db = {
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
        };
      }),
    })),
    update: vi.fn((table: string, key: Record<string, unknown>) => ({
      set: vi.fn(async (valuesOrUpdater: Record<string, unknown> | ((row: any) => Record<string, unknown>)) => {
        updates.push({ table, key, values: resolveSetter(valuesOrUpdater) });
      }),
    })),
  };

  return { db, inserts, updates };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/FeedbackBonusEscrow.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("FeedbackBonusEscrow ponder handlers", () => {
  it("indexes created feedback bonus pools", async () => {
    const { db, inserts, updates } = createDb({ content: { id: 1n } });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("FeedbackBonusEscrow:FeedbackBonusPoolCreated");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          poolId: 7n,
          contentId: 1n,
          roundId: 3n,
          funder: "0x0000000000000000000000000000000000000001",
          awarder: "0x0000000000000000000000000000000000000002",
          asset: 0n,
          amount: 100_000_000n,
          feedbackClosesAt: 2_592_000n,
          frontendFeeBps: 300n,
        },
        block: { number: 10n, timestamp: 1_700n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "feedbackBonusPool",
      values: expect.objectContaining({
        id: 7n,
        contentId: 1n,
        roundId: 3n,
        fundedAmount: 100_000_000n,
        remainingAmount: 100_000_000n,
        asset: 0,
        feedbackClosesAt: 2_592_000n,
        awardDeadline: 2_592_000n,
        frontendFeeBps: 300,
      }),
    });
    expect(updates).toContainEqual(expect.objectContaining({ table: "content" }));
  });

  it("extends the award deadline when the pool targets an already-settled round", async () => {
    const settledAt = 1_000_000n;
    const feedbackClosesAt = 1_000_100n; // before settledAt + 24h
    const { db, inserts } = createDb({
      content: { id: 1n },
      'round:{"id":"1-3"}': { id: "1-3", settledAt },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("FeedbackBonusEscrow:FeedbackBonusPoolCreated");

    await handler!({
      event: {
        args: {
          poolId: 8n,
          contentId: 1n,
          roundId: 3n,
          funder: "0x0000000000000000000000000000000000000001",
          awarder: "0x0000000000000000000000000000000000000002",
          asset: 0n,
          amount: 100_000_000n,
          feedbackClosesAt,
          frontendFeeBps: 300n,
        },
        block: { number: 20n, timestamp: 1_000_050n },
      },
      context: { db },
    });

    // On-chain deadline for pools targeting terminal rounds is
    // max(feedbackClosesAt, settledAt + 24h).
    expect(inserts).toContainEqual({
      table: "feedbackBonusPool",
      values: expect.objectContaining({
        id: 8n,
        feedbackClosesAt,
        awardDeadline: settledAt + 24n * 60n * 60n,
      }),
    });
  });

  it("keeps the requested deadline when the target round is not settled", async () => {
    // Cancelled rounds never set settledAt on the indexed round row, so they
    // must not receive the post-settlement extension.
    const { db, inserts } = createDb({
      content: { id: 1n },
      'round:{"id":"1-3"}': { id: "1-3", settledAt: null },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("FeedbackBonusEscrow:FeedbackBonusPoolCreated");

    await handler!({
      event: {
        args: {
          poolId: 9n,
          contentId: 1n,
          roundId: 3n,
          funder: "0x0000000000000000000000000000000000000001",
          awarder: "0x0000000000000000000000000000000000000002",
          asset: 0n,
          amount: 100_000_000n,
          feedbackClosesAt: 2_592_000n,
          frontendFeeBps: 300n,
        },
        block: { number: 21n, timestamp: 1_700n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "feedbackBonusPool",
      values: expect.objectContaining({
        id: 9n,
        awardDeadline: 2_592_000n,
      }),
    });
  });

  it("updates pool accounting for awards and forfeits", async () => {
    const { db, inserts, updates } = createDb({
      'feedbackBonusPool:{"id":"7"}': { id: 7n, contentId: 1n, asset: 0 },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    await registeredHandlers.get("FeedbackBonusEscrow:FeedbackBonusAwarded")!({
      event: {
        args: {
          poolId: 7n,
          contentId: 1n,
          roundId: 3n,
          recipient: "0x0000000000000000000000000000000000000003",
          identityKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          feedbackHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          grossAmount: 10_000_000n,
          recipientAmount: 9_700_000n,
          frontend: "0x00000000000000000000000000000000000000f1",
          frontendRecipient: "0x00000000000000000000000000000000000000f2",
          frontendFee: 300_000n,
        },
        block: { number: 11n, timestamp: 1_800n },
      },
      context: { db },
    });

    await registeredHandlers.get("FeedbackBonusEscrow:FeedbackBonusForfeited")!({
      event: {
        args: {
          poolId: 7n,
          treasury: "0x00000000000000000000000000000000000000ee",
          amount: 90_000_000n,
        },
        block: { number: 12n, timestamp: 1_900n },
      },
      context: { db },
    });

    expect(inserts).toContainEqual({
      table: "feedbackBonusAward",
      values: expect.objectContaining({
        id: "7-0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        grossAmount: 10_000_000n,
        recipientAmount: 9_700_000n,
        asset: 0,
        frontendFee: 300_000n,
      }),
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "feedbackBonusPool",
          values: expect.objectContaining({
            remainingAmount: 90_000_000n,
            awardedAmount: 10_000_000n,
            voterAwardedAmount: 9_700_000n,
            frontendAwardedAmount: 300_000n,
            awardCount: 1,
          }),
        }),
        expect.objectContaining({
          table: "feedbackBonusPool",
          values: expect.objectContaining({
            remainingAmount: 0n,
            forfeitedAmount: 90_000_000n,
            forfeited: true,
          }),
        }),
      ]),
    );
  });

  it("indexes the funder-refund forfeiture fallback identically to a treasury forfeit", async () => {
    const { db, updates } = createDb({
      'feedbackBonusPool:{"id":"7"}': { id: 7n, contentId: 1n, asset: 0 },
      content: { id: 1n },
    });
    const registeredHandlers = await loadHandlers();

    const handler = registeredHandlers.get(
      "FeedbackBonusEscrow:FeedbackBonusFunderRefunded",
    );
    expect(handler).toBeDefined();

    // Emitted when ProtocolConfig has no treasury set, so the expired pool's
    // residue is refunded to the original funder instead of the treasury.
    await handler!({
      event: {
        args: {
          poolId: 7n,
          funder: "0x0000000000000000000000000000000000000001",
          amount: 90_000_000n,
        },
        block: { number: 12n, timestamp: 1_900n },
      },
      context: { db },
    });

    // Drives the same terminal state as FeedbackBonusForfeited: drained and forfeited.
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "feedbackBonusPool",
        key: { id: 7n },
        values: expect.objectContaining({
          remainingAmount: 0n,
          forfeitedAmount: 90_000_000n,
          forfeited: true,
        }),
      }),
    );
    expect(updates).toContainEqual(expect.objectContaining({ table: "content" }));
  });
});

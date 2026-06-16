import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex: number };
    transaction: { hash: `0x${string}` };
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
  content: "content",
  contentFeedback: "contentFeedback",
}));

function createDb(existingContent: Record<string, unknown> | null = { id: 7n }) {
  const inserts: Array<{
    table: string;
    values: Record<string, unknown>;
    update?: Record<string, unknown>;
  }> = [];
  const updates: Array<{
    table: string;
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];

  return {
    db: {
      find: vi.fn(async (table: string) => {
        if (table === "content") return existingContent;
        return null;
      }),
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoUpdate: vi.fn(
            async (
              update:
                | Record<string, unknown>
                | (() => Record<string, unknown>),
            ) => {
              inserts.push({
                table,
                values,
                update: typeof update === "function" ? update() : update,
              });
            },
          ),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(async (values: Record<string, unknown>) => {
          updates.push({ table, key, values });
        }),
      })),
    },
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/FeedbackRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("FeedbackRegistry ponder handlers", () => {
  it("indexes published feedback and touches parent content activity", async () => {
    const { db, inserts, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("FeedbackRegistry:FeedbackPublished");

    expect(handler).toBeDefined();

    const commitKey = `0x${"11".repeat(32)}`;
    const author = "0x0000000000000000000000000000000000000001";
    const txHash = `0x${"44".repeat(32)}`;

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          commitKey,
          author,
          feedbackHash: `0x${"22".repeat(32)}`,
          feedbackType: 1,
          body: "helpful context",
          sourceUrl: "https://example.com/source",
          clientNonce: `0x${"33".repeat(32)}`,
        },
        transaction: { hash: txHash },
        block: { number: 42n, timestamp: 1_234n },
        log: { logIndex: 3 },
      },
      context: { db },
    });

    expect(inserts).toEqual([
      {
        table: "contentFeedback",
        values: expect.objectContaining({
          id: `7-2-${commitKey}`,
          contentId: 7n,
          roundId: 2n,
          commitKey,
          author,
          feedbackType: 1,
          body: "helpful context",
          sourceUrl: "https://example.com/source",
          revealed: true,
          committedAt: 1_234n,
          commitTxHash: txHash,
          revealTxHash: txHash,
        }),
        update: expect.objectContaining({
          author,
          feedbackType: 1,
          body: "helpful context",
          revealed: true,
          revealTxHash: txHash,
          updatedAt: 1_234n,
        }),
      },
    ]);
    expect(updates).toEqual([
      {
        table: "content",
        key: { id: 7n },
        values: { lastActivityAt: 1_234n },
      },
    ]);
  });
});

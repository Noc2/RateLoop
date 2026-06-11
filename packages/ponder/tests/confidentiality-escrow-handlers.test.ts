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
  confidentialityBond: "confidentialityBond",
  confidentialityConfig: "confidentialityConfig",
  content: "content",
}));

function createDb() {
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
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoUpdate: vi.fn(async (update: Record<string, unknown>) => {
            inserts.push({ table, values, update });
          }),
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
  await import("../src/ConfidentialityEscrow.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ConfidentialityEscrow ponder handlers", () => {
  it("indexes confidentiality config without requiring the content row to exist", async () => {
    const { db, inserts, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "ConfidentialityEscrow:ConfidentialityConfigured",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 42n,
          gated: true,
          bondAsset: 1,
          bondAmount: 2_500_000n,
          flags: 3,
        },
        block: { timestamp: 1_000n },
      },
      context: { db },
    });

    expect(inserts).toEqual([
      {
        table: "confidentialityConfig",
        values: {
          contentId: 42n,
          gated: true,
          bondAsset: 1,
          bondAmount: 2_500_000n,
          flags: 3,
          configuredAt: 1_000n,
          updatedAt: 1_000n,
        },
        update: {
          gated: true,
          bondAsset: 1,
          bondAmount: 2_500_000n,
          flags: 3,
          updatedAt: 1_000n,
        },
      },
    ]);
    expect(updates).toEqual([]);
  });

  it("tracks posted and released bonds by content identity key", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const identityKey = `0x${"1".repeat(64)}`;
    const poster = "0x0000000000000000000000000000000000001234";

    await registeredHandlers.get("ConfidentialityEscrow:BondPosted")!({
      event: {
        args: {
          contentId: 42n,
          identityKey,
          poster,
          asset: 0,
          amount: 1_000_000n,
        },
        block: { timestamp: 1_100n },
      },
      context: { db },
    });
    await registeredHandlers.get("ConfidentialityEscrow:BondReleased")!({
      event: {
        args: {
          contentId: 42n,
          identityKey,
          poster,
          amount: 1_000_000n,
        },
        block: { timestamp: 2_100n },
      },
      context: { db },
    });

    expect(inserts).toEqual([
      expect.objectContaining({
        table: "confidentialityBond",
        values: expect.objectContaining({
          id: `42-${identityKey}`,
          amount: 1_000_000n,
          asset: 0,
          postedAt: 1_100n,
          status: "active",
        }),
        update: expect.objectContaining({
          postedAt: 1_100n,
          status: "active",
        }),
      }),
      expect.objectContaining({
        table: "confidentialityBond",
        values: expect.objectContaining({
          id: `42-${identityKey}`,
          releasedAt: 2_100n,
          status: "released",
        }),
        update: expect.objectContaining({
          releasedAt: 2_100n,
          status: "released",
        }),
      }),
    ]);
  });

  it("records slash evidence and reporter split", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const identityKey = `0x${"2".repeat(64)}`;
    const poster = "0x0000000000000000000000000000000000001234";
    const reporterRecipient = "0x0000000000000000000000000000000000005678";
    const evidenceHash = `0x${"3".repeat(64)}`;

    await registeredHandlers.get("ConfidentialityEscrow:BondSlashed")!({
      event: {
        args: {
          contentId: 42n,
          identityKey,
          poster,
          reporterRecipient,
          reporterAmount: 500_000n,
          confiscatedAmount: 500_000n,
          evidenceHash,
          reason: "verified leak",
        },
        block: { timestamp: 3_100n },
      },
      context: { db },
    });

    expect(inserts).toEqual([
      expect.objectContaining({
        table: "confidentialityBond",
        values: expect.objectContaining({
          id: `42-${identityKey}`,
          amount: 1_000_000n,
          evidenceHash,
          reason: "verified leak",
          reporterAmount: 500_000n,
          reporterRecipient,
          confiscatedAmount: 500_000n,
          slashedAt: 3_100n,
          status: "slashed",
        }),
        update: expect.objectContaining({
          evidenceHash,
          reason: "verified leak",
          slashedAt: 3_100n,
          status: "slashed",
        }),
      }),
    ]);
  });
});

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
  raterFollow: "raterFollow",
  raterHumanCredential: "raterHumanCredential",
  raterProfile: "raterProfile",
}));

function createDb() {
  const upserts: Array<{
    table: string;
    values: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
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

  return {
    db: {
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(async () => {
            inserts.push({ table, values, mode: "nothing" });
          }),
          onConflictDoUpdate: vi.fn(async (update: Record<string, unknown>) => {
            upserts.push({ table, values, update });
            inserts.push({ table, values, mode: "update", update });
          }),
        })),
      })),
      update: vi.fn((table: string, key: Record<string, unknown>) => ({
        set: vi.fn(async (update: Record<string, unknown>) => {
          updates.push({ table, key, update });
        }),
      })),
    },
    upserts,
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/RaterRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("RaterRegistry ponder handlers", () => {
  it("indexes public follow edges and deactivations", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const followedHandler = registeredHandlers.get(
      "RaterRegistry:ProfileFollowed",
    );
    const unfollowedHandler = registeredHandlers.get(
      "RaterRegistry:ProfileUnfollowed",
    );

    expect(followedHandler).toBeDefined();
    expect(unfollowedHandler).toBeDefined();

    await followedHandler!({
      event: {
        args: {
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          followedAt: 100n,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    await unfollowedHandler!({
      event: {
        args: {
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          unfollowedAt: 120n,
        },
        block: { timestamp: 120n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterFollow",
        values: {
          id: "0x0000000000000000000000000000000000001234-0x0000000000000000000000000000000000009999",
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          active: true,
          createdAt: 100n,
          unfollowedAt: null,
          updatedAt: 100n,
        },
        update: {
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          active: true,
          createdAt: 100n,
          unfollowedAt: null,
          updatedAt: 100n,
        },
      },
      {
        table: "raterFollow",
        values: {
          id: "0x0000000000000000000000000000000000001234-0x0000000000000000000000000000000000009999",
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          active: false,
          createdAt: 120n,
          unfollowedAt: 120n,
          updatedAt: 120n,
        },
        update: {
          follower: "0x0000000000000000000000000000000000001234",
          target: "0x0000000000000000000000000000000000009999",
          active: false,
          unfollowedAt: 120n,
          updatedAt: 120n,
        },
      },
    ]);
  });

  it("indexes optional human credentials", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:HumanCredentialVerified",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          nullifierHash: `0x${"11".repeat(32)}`,
          scope: `0x${"22".repeat(32)}`,
          provider: 1,
          verifiedAt: 100n,
          expiresAt: 200n,
          evidenceHash: `0x${"33".repeat(32)}`,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterHumanCredential",
        values: expect.objectContaining({
          rater: "0x0000000000000000000000000000000000001234",
          verified: true,
          revoked: false,
          provider: 1,
        }),
        update: expect.objectContaining({
          verified: true,
          revoked: false,
          provider: 1,
          updatedAt: 100n,
        }),
      },
    ]);
  });
});

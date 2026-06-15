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
  raterHumanPresence: "raterHumanPresence",
  raterIdentityBan: "raterIdentityBan",
  raterProfile: "raterProfile",
  raterRegistryConfig: "raterRegistryConfig",
  raterWorldCredential: "raterWorldCredential",
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
  it("indexes identity bans and unbans", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const bannedHandler = registeredHandlers.get(
      "RaterRegistry:IdentityBanned",
    );
    const unbannedHandler = registeredHandlers.get(
      "RaterRegistry:IdentityUnbanned",
    );
    const nullifierHash = `0x${"11".repeat(32)}`;
    const evidenceHash = `0x${"22".repeat(32)}`;

    expect(bannedHandler).toBeDefined();
    expect(unbannedHandler).toBeDefined();

    await bannedHandler!({
      event: {
        args: {
          provider: 2,
          nullifierHash,
          expiresAt: 2_000n,
          permanent: false,
          evidenceHash,
          reason: "verified leak",
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    await unbannedHandler!({
      event: {
        args: {
          provider: 2,
          nullifierHash,
        },
        block: { timestamp: 150n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterIdentityBan",
        values: {
          id: `2-${nullifierHash}`,
          provider: 2,
          nullifierHash,
          active: true,
          permanent: false,
          expiresAt: 2_000n,
          evidenceHash,
          reason: "verified leak",
          bannedAt: 100n,
          unbannedAt: null,
          updatedAt: 100n,
        },
        update: {
          active: true,
          permanent: false,
          expiresAt: 2_000n,
          evidenceHash,
          reason: "verified leak",
          bannedAt: 100n,
          unbannedAt: null,
          updatedAt: 100n,
        },
      },
      {
        table: "raterIdentityBan",
        values: {
          id: `2-${nullifierHash}`,
          provider: 2,
          nullifierHash,
          active: false,
          permanent: false,
          expiresAt: 0n,
          evidenceHash: `0x${"0".repeat(64)}`,
          reason: "",
          bannedAt: 0n,
          unbannedAt: 150n,
          updatedAt: 150n,
        },
        update: {
          active: false,
          unbannedAt: 150n,
          updatedAt: 150n,
        },
      },
    ]);
  });

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
          createdAt: 0n,
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

  it("indexes World ID v4 credential kinds and mirrors Proof of Human", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:WorldCredentialVerified",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          kind: 3,
          nullifierHash: `0x${"44".repeat(32)}`,
          scope: `0x${"55".repeat(32)}`,
          verifiedAt: 100n,
          expiresAt: 200n,
          evidenceHash: `0x${"66".repeat(32)}`,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterWorldCredential",
        values: expect.objectContaining({
          id: "0x0000000000000000000000000000000000001234-3",
          rater: "0x0000000000000000000000000000000000001234",
          kind: 3,
          verified: true,
          revoked: false,
        }),
        update: expect.objectContaining({
          verified: true,
          revoked: false,
          updatedAt: 100n,
        }),
      },
      {
        table: "raterHumanCredential",
        values: expect.objectContaining({
          rater: "0x0000000000000000000000000000000000001234",
          verified: true,
          revoked: false,
          provider: 2,
        }),
        update: expect.objectContaining({
          verified: true,
          revoked: false,
          provider: 2,
          updatedAt: 100n,
        }),
      },
    ]);
  });

  it("indexes fresh World ID user-presence rechecks", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:HumanPresenceVerified",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          kind: 2,
          nullifierHash: `0x${"77".repeat(32)}`,
          lastRecheckedAt: 1_000n,
          freshUntil: 1_900n,
          evidenceHash: `0x${"88".repeat(32)}`,
        },
        block: { timestamp: 1_000n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterHumanPresence",
        values: expect.objectContaining({
          id: "0x0000000000000000000000000000000000001234-2",
          rater: "0x0000000000000000000000000000000000001234",
          kind: 2,
          verified: true,
          lastRecheckedAt: 1_000n,
          freshUntil: 1_900n,
        }),
        update: expect.objectContaining({
          verified: true,
          lastRecheckedAt: 1_000n,
          freshUntil: 1_900n,
          updatedAt: 1_000n,
        }),
      },
    ]);
  });

  it("indexes human credential revocations with the emitted provider", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "RaterRegistry:HumanCredentialRevoked",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          nullifierHash: `0x${"99".repeat(32)}`,
          provider: 1,
        },
        block: { timestamp: 300n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterHumanCredential",
        values: expect.objectContaining({
          rater: "0x0000000000000000000000000000000000001234",
          verified: false,
          revoked: true,
          provider: 1,
          nullifierHash: `0x${"99".repeat(32)}`,
        }),
        update: expect.objectContaining({
          revoked: true,
          updatedAt: 300n,
        }),
      },
    ]);
  });
});

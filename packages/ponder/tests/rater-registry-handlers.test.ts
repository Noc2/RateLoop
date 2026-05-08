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
  raterClusterScore: "raterClusterScore",
  raterProfile: "raterProfile",
  raterSelfCredential: "raterSelfCredential",
  raterTrustAttestation: "raterTrustAttestation",
  raterTrustSeed: "raterTrustSeed",
}));

function createDb() {
  const upserts: Array<{ table: string; values: Record<string, unknown>; update: Record<string, unknown> }> = [];

  return {
    db: {
      insert: vi.fn((table: string) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          onConflictDoUpdate: vi.fn(async (update: Record<string, unknown>) => {
            upserts.push({ table, values, update });
          }),
        })),
      })),
    },
    upserts,
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
  it("indexes optional Self credentials", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterRegistry:SelfCredentialAttested");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          nullifierHash: `0x${"11".repeat(32)}`,
          scope: `0x${"22".repeat(32)}`,
          legacy: false,
          verifiedAt: 100n,
          expiresAt: 200n,
          multiplierBps: 11_000,
          evidenceHash: `0x${"33".repeat(32)}`,
        },
        block: { timestamp: 100n },
      },
      context: { db },
    });

    expect(upserts).toEqual([
      {
        table: "raterSelfCredential",
        values: expect.objectContaining({
          rater: "0x0000000000000000000000000000000000001234",
          verified: true,
          legacy: false,
          revoked: false,
          multiplierBps: 11_000,
        }),
        update: expect.objectContaining({
          verified: true,
          revoked: false,
          updatedAt: 100n,
        }),
      },
    ]);
  });

  it("indexes bounded trust attestations", async () => {
    const { db, upserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterRegistry:TrustAttestationSet");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          attestationId: `0x${"44".repeat(32)}`,
          issuer: "0x0000000000000000000000000000000000001111",
          subject: "0x0000000000000000000000000000000000002222",
          categoryId: 3n,
          trustBudget: 100n,
          maxBoostBps: 11_500,
          expiresAt: 300n,
          metadataHash: `0x${"55".repeat(32)}`,
        },
        block: { timestamp: 123n },
      },
      context: { db },
    });

    expect(upserts[0]).toMatchObject({
      table: "raterTrustAttestation",
      values: {
        id: `0x${"44".repeat(32)}`,
        issuer: "0x0000000000000000000000000000000000001111",
        subject: "0x0000000000000000000000000000000000002222",
        categoryId: 3n,
        trustBudget: 100n,
        maxBoostBps: 11_500,
        expiresAt: 300n,
        metadataHash: `0x${"55".repeat(32)}`,
        issuedAt: 123n,
        revoked: false,
        updatedAt: 123n,
      },
    });
  });
});

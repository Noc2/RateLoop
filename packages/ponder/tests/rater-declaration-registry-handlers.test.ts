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

function findKey(table: string, key: Record<string, unknown>) {
  return `${table}:${JSON.stringify(key, (_name, value) => (typeof value === "bigint" ? value.toString() : value))}`;
}

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      handlers.set(name, handler);
    }),
  },
}));

vi.mock("ponder:schema", () => ({
  aiRaterDeclaration: "aiRaterDeclaration",
  aiRaterDeclarationChallenge: "aiRaterDeclarationChallenge",
  aiRaterDeclarationHistory: "aiRaterDeclarationHistory",
  aiRaterDriftFlag: "aiRaterDriftFlag",
  aiRaterOperatorBond: "aiRaterOperatorBond",
  aiRaterProbeResult: "aiRaterProbeResult",
}));

function createDb(findResults: Record<string, unknown> = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown>; mode: string; update?: unknown }> = [];
  const updates: Array<{ table: string; key: Record<string, unknown>; update: Record<string, unknown> }> = [];

  return {
    db: {
      find: vi.fn(async (table: string, key: Record<string, unknown>) => findResults[findKey(table, key)]),
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
        set: vi.fn(async (update: Record<string, unknown>) => {
          updates.push({ table, key, update });
        }),
      })),
    },
    inserts,
    updates,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/RaterDeclarationRegistry.js");
  return handlers;
}

const baseEvent = {
  block: { timestamp: 123n },
  transaction: { hash: "0xabc" as const },
  log: { logIndex: 7 },
};

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("RaterDeclarationRegistry ponder handlers", () => {
  it("indexes AI declaration metadata from events", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterDeclarationRegistry:DeclarationSubmitted");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        ...baseEvent,
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          operator: "0x000000000000000000000000000000000000abcd",
          version: 1,
          effectiveEpoch: 100n,
          expiresAtEpoch: 0n,
          tier: 1,
          behaviorChanged: true,
          probePending: true,
          declarationHash: `0x${"11".repeat(32)}`,
          modelClass: 0,
          modelId: `0x${"22".repeat(32)}`,
          provider: `0x${"33".repeat(32)}`,
          promptTemplateHash: `0x${"44".repeat(32)}`,
          retrievalConfigHash: `0x${"55".repeat(32)}`,
          toolingHash: `0x${"66".repeat(32)}`,
          disclosure: 1,
        },
      },
      context: { db },
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({
      table: "aiRaterDeclaration",
      mode: "update",
      values: expect.objectContaining({
        rater: "0x0000000000000000000000000000000000001234",
        operator: "0x000000000000000000000000000000000000abcd",
        version: 1,
        effectiveEpoch: 100n,
        expiresAtEpoch: 0n,
        probePending: true,
        modelId: `0x${"22".repeat(32)}`,
      }),
    });
    expect(inserts[1]).toMatchObject({
      table: "aiRaterDeclarationHistory",
      values: expect.objectContaining({
        id: "0x0000000000000000000000000000000000001234-1",
      }),
    });
  });

  it("indexes probe results and updates the current declaration tier", async () => {
    const { db, inserts, updates } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterDeclarationRegistry:ProbeResultRecorded");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        ...baseEvent,
        args: {
          rater: "0x0000000000000000000000000000000000001234",
          operator: "0x000000000000000000000000000000000000abcd",
          version: 1,
          passed: true,
          confidenceBps: 8_500,
          probeLibraryHash: `0x${"77".repeat(32)}`,
          resultHash: `0x${"88".repeat(32)}`,
        },
      },
      context: { db },
    });

    expect(inserts[0]).toMatchObject({
      table: "aiRaterProbeResult",
      values: expect.objectContaining({
        id: "0x0000000000000000000000000000000000001234-1-0xabc-7",
        passed: true,
        confidenceBps: 8_500,
      }),
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        {
          table: "aiRaterDeclaration",
          key: { rater: "0x0000000000000000000000000000000000001234" },
          update: expect.objectContaining({
            tier: 2,
            probePending: false,
            lastProbeResultHash: `0x${"88".repeat(32)}`,
          }),
        },
      ]),
    );
  });

  it("indexes declaration challenges with their bond amount", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterDeclarationRegistry:ChallengeOpened");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        ...baseEvent,
        args: {
          challengeId: 1n,
          challenger: "0x0000000000000000000000000000000000009999",
          rater: "0x0000000000000000000000000000000000001234",
          operator: "0x000000000000000000000000000000000000abcd",
          declarationVersion: 1,
          bondAmount: 25n,
          evidenceHash: `0x${"99".repeat(32)}`,
        },
      },
      context: { db },
    });

    expect(inserts[0]).toMatchObject({
      table: "aiRaterDeclarationChallenge",
      values: expect.objectContaining({
        challengeId: 1n,
        bondAmount: 25n,
        status: 1,
        operatorSlash: 0n,
        challengerReward: 0n,
      }),
    });
  });

  it("marks the current declaration inactive when a challenge is sustained", async () => {
    const challengeId = 1n;
    const rater = "0x0000000000000000000000000000000000001234";
    const { db, updates } = createDb({
      [findKey("aiRaterDeclarationChallenge", { challengeId })]: {
        rater,
        declarationVersion: 3,
      },
    });
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("RaterDeclarationRegistry:ChallengeResolved");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        ...baseEvent,
        args: {
          challengeId,
          status: 2,
          operatorSlash: 50n,
          challengerReward: 25n,
          resolutionHash: `0x${"aa".repeat(32)}`,
        },
      },
      context: { db },
    });

    expect(updates).toEqual(
      expect.arrayContaining([
        {
          table: "aiRaterDeclaration",
          key: { rater },
          update: expect.objectContaining({
            tier: 0,
            probePending: false,
            retiredAt: 123n,
          }),
        },
        {
          table: "aiRaterDeclarationHistory",
          key: { id: `${rater}-3` },
          update: expect.objectContaining({
            tier: 0,
            probePending: false,
            retiredAt: 123n,
          }),
        },
      ]),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

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
  advisoryVote: "advisoryVote",
}));

function createDb() {
  const inserts: Array<{
    table: string;
    values: Record<string, unknown>;
    update?: Record<string, unknown>;
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
      update: vi.fn(() => ({
        set: vi.fn(async () => undefined),
      })),
    },
    inserts,
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/AdvisoryVoteRecorder.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("AdvisoryVoteRecorder ponder handlers", () => {
  it("indexes advisory vote commits with conflict upsert metadata", async () => {
    const { db, inserts } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "AdvisoryVoteRecorder:AdvisoryVoteRecorded",
    );

    expect(handler).toBeDefined();

    const voter = "0x0000000000000000000000000000000000000001";
    const advisoryCommitKey = `0x${"aa".repeat(32)}`;
    const commitHash = `0x${"11".repeat(32)}`;
    const ciphertext = "0x1234" as `0x${string}`;
    const ciphertextHash = keccak256(ciphertext);
    const txHash = `0x${"44".repeat(32)}`;

    await handler!({
      event: {
        args: {
          contentId: 7n,
          roundId: 2n,
          voter,
          advisoryCommitKey,
          commitHash,
          roundReferenceRatingBps: 6400,
          targetRound: 123n,
          drandChainHash: `0x${"22".repeat(32)}`,
          ciphertextHash,
          ciphertext,
        },
        transaction: { hash: txHash },
        block: { number: 42n, timestamp: 1_234n },
        log: { logIndex: 5 },
      },
      context: { db },
    });

    expect(inserts).toEqual([
      {
        table: "advisoryVote",
        values: expect.objectContaining({
          id: advisoryCommitKey,
          contentId: 7n,
          roundId: 2n,
          voter,
          commitHash,
          ciphertextHash,
          ciphertext,
          ciphertextSource: "event",
          roundReferenceRatingBps: 6400,
          revealed: false,
          committedAt: 1_234n,
          commitTxHash: txHash,
          commitBlockNumber: 42n,
          commitLogIndex: 5,
        }),
        update: expect.objectContaining({
          commitHash,
          ciphertextHash,
          ciphertext,
          ciphertextSource: "event",
          commitTxHash: txHash,
          commitBlockNumber: 42n,
          commitLogIndex: 5,
          updatedAt: 1_234n,
        }),
      },
    ]);
  });
});

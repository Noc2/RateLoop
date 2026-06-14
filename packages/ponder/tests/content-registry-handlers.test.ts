import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";

type RegisteredHandler = (args: {
  event: {
    args: Record<string, unknown>;
    block: { number: bigint; timestamp: bigint };
    log?: { logIndex: number };
    transaction?: { hash: `0x${string}` };
  };
  context: Record<string, unknown>;
}) => Promise<void>;

const handlers = new Map<string, RegisteredHandler>();
const REGISTRY_ADDRESS = "0x000000000000000000000000000000000000c0de";
const VALIDATOR_ADDRESS = "0x000000000000000000000000000000000000beef";
const SUBMITTER_ADDRESS = "0x0000000000000000000000000000000000000001";
const CONTENT_REGISTRY_ABI = vi.hoisted(
  () =>
    [
      {
        type: "event",
        name: "ContentSubmitted",
        inputs: [
          { name: "contentId", type: "uint256", indexed: true },
          { name: "submitter", type: "address", indexed: true },
          { name: "contentHash", type: "bytes32", indexed: false },
          { name: "url", type: "string", indexed: false },
          { name: "title", type: "string", indexed: false },
          { name: "tags", type: "string", indexed: false },
          { name: "categoryId", type: "uint256", indexed: false },
        ],
      },
      {
        type: "event",
        name: "QuestionContentAnchored",
        inputs: [
          { name: "contentId", type: "uint256", indexed: true },
          { name: "mediaType", type: "uint8", indexed: true },
          { name: "mediaIndex", type: "uint256", indexed: false },
          { name: "url", type: "string", indexed: false },
          { name: "questionMetadataHash", type: "bytes32", indexed: false },
          { name: "resultSpecHash", type: "bytes32", indexed: false },
        ],
      },
      {
        type: "function",
        name: "submissionMediaValidator",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
      {
        type: "event",
        name: "QuestionBundleContentLinked",
        inputs: [
          { name: "bundleId", type: "uint256", indexed: true },
          { name: "contentId", type: "uint256", indexed: true },
          { name: "bundleIndex", type: "uint256", indexed: true },
        ],
      },
    ] as const,
);

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((name: string, handler: RegisteredHandler) => {
      handlers.set(name, handler);
    }),
  },
}));

vi.mock("ponder", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("ponder:schema", () => ({
  category: "category",
  confidentialityConfig: "confidentialityConfig",
  content: "content",
  contentMedia: "contentMedia",
  globalStats: "globalStats",
  profile: "profile",
  questionBundleQuestion: {
    contentId: "questionBundleQuestion.contentId",
    toString: () => "questionBundleQuestion",
  },
  ratingChange: "ratingChange",
  round: "round",
}));

vi.mock("@rateloop/contracts/abis", () => ({
  ContentRegistryAbi: CONTENT_REGISTRY_ABI,
}));

vi.mock("@rateloop/contracts/protocol", () => ({
  DEFAULT_ROUND_CONFIG: {
    epochDurationSeconds: 1200,
    maxDurationSeconds: 1200,
    minVoters: 3,
    maxVoters: 100,
  },
  USER_PREDICTION_BPS: { min: 100, max: 9_900 },
  USER_PREDICTION_PERCENT: { min: 1, max: 99 },
  ROUND_STATE: { Settled: 1 },
}));

function tableName(table: unknown) {
  return String(table);
}

function createDb(
  existingRound: Record<string, unknown> | null = { id: "1-2" },
  options: {
    confidentialityConfig?: Record<string, unknown> | null;
  } = {},
) {
  const updateCalls: Array<{
    table: string;
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];
  const insertCalls: Array<{ table: string; values: Record<string, unknown> }> =
    [];
  const questionBundleRows: Array<Record<string, unknown>> = [];

  return {
    db: {
      find: vi.fn(async (table: unknown) => {
        if (tableName(table) === "confidentialityConfig") {
          return options.confidentialityConfig ?? null;
        }
        return existingRound;
      }),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          const normalizedTable = tableName(table);
          insertCalls.push({ table: normalizedTable, values });
          if (normalizedTable === "questionBundleQuestion") {
            questionBundleRows.push(values);
          }
          return {
            onConflictDoNothing: vi.fn(async () => undefined),
            onConflictDoUpdate: vi.fn(async () => undefined),
          };
        }),
      })),
      update: vi.fn((table: unknown, key: Record<string, unknown>) => ({
        set: vi.fn(async (values: Record<string, unknown>) => {
          updateCalls.push({ table: tableName(table), key, values });
        }),
      })),
      sql: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => questionBundleRows.slice(0, 1)),
            })),
          })),
        })),
      },
    },
    insertCalls,
    questionBundleRows,
    updateCalls,
  };
}

function contentSubmittedLog(contentId: bigint, logIndex: number) {
  return {
    address: REGISTRY_ADDRESS,
    logIndex,
    topics: encodeEventTopics({
      abi: CONTENT_REGISTRY_ABI,
      eventName: "ContentSubmitted",
      args: {
        contentId,
        submitter: SUBMITTER_ADDRESS,
      },
    }),
    data: encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
      ],
      [
        `0x${"a".repeat(64)}`,
        `https://example.com/question-${contentId.toString()}`,
        `Question ${contentId.toString()}?`,
        "Context",
        "tag",
        1n,
      ],
    ),
  };
}

function questionContentAnchoredLog(params: {
  address?: string;
  contentId: bigint;
  logIndex: number;
  mediaIndex: bigint;
  mediaType: number;
  questionMetadataHash?: `0x${string}`;
  resultSpecHash?: `0x${string}`;
  url: string;
}) {
  return {
    address: params.address ?? VALIDATOR_ADDRESS,
    logIndex: params.logIndex,
    topics: encodeEventTopics({
      abi: CONTENT_REGISTRY_ABI,
      eventName: "QuestionContentAnchored",
      args: {
        contentId: params.contentId,
        mediaType: params.mediaType,
      },
    }),
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        params.mediaIndex,
        params.url,
        params.questionMetadataHash ?? `0x${"2".repeat(64)}`,
        params.resultSpecHash ?? `0x${"3".repeat(64)}`,
      ],
    ),
  };
}

async function loadHandlers() {
  handlers.clear();
  await import("../src/ContentRegistry.js");
  return handlers;
}

afterEach(() => {
  handlers.clear();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ContentRegistry ponder handlers", () => {
  it("indexes selected round config when content is submitted", async () => {
    const { db, insertCalls } = createDb();
    const readContract = vi.fn(async () => ({
      epochDuration: 600,
      maxDuration: 7200,
      minVoters: 5,
      maxVoters: 50,
    }));

    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ContentRegistry:ContentSubmitted");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          submitter: "0x0000000000000000000000000000000000000001",
          contentHash: "0xabc",
          url: "https://example.com/question",
          title: "Question?",
          tags: "tag",
          categoryId: 1n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        client: { readContract },
        contracts: {
          ContentRegistry: {
            address: "0x000000000000000000000000000000000000c0de",
          },
        },
        db,
      },
    });

    expect(readContract).toHaveBeenCalledWith({
      abi: CONTENT_REGISTRY_ABI,
      address: REGISTRY_ADDRESS,
      args: [7n],
      functionName: "getContentRoundConfig",
    });
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            roundEpochDuration: 600,
            roundMaxDuration: 7200,
            roundMinVoters: 5,
            roundMaxVoters: 50,
          }),
        }),
      ]),
    );
  });

  it("updates content-level round config from ContentRoundConfigSet events", async () => {
    const { db, updateCalls } = createDb({ id: 7n });

    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "ContentRegistry:ContentRoundConfigSet",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          epochDuration: 600,
          maxDuration: 7200,
          minVoters: 5,
          maxVoters: 50,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: { db },
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            roundEpochDuration: 600,
            roundMaxDuration: 7200,
            roundMinVoters: 5,
            roundMaxVoters: 50,
          }),
        }),
      ]),
    );
  });

  it("registers explicit bundle content link events", async () => {
    const registeredHandlers = await loadHandlers();

    expect(
      registeredHandlers.has("ContentRegistry:QuestionBundleContentLinked"),
    ).toBe(true);
  });

  it("indexes question content anchors from submission receipt logs", async () => {
    const { db, insertCalls, updateCalls } = createDb();
    const imageUrl =
      "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) =>
        functionName === "submissionMediaValidator"
          ? VALIDATOR_ADDRESS
          : {
              epochDuration: 600,
              maxDuration: 7200,
              minVoters: 5,
              maxVoters: 50,
            },
    );
    const getTransactionReceipt = vi.fn(async () => ({
      logs: [
        contentSubmittedLog(7n, 10),
        questionContentAnchoredLog({
          address: "0x000000000000000000000000000000000000f00d",
          contentId: 7n,
          logIndex: 11,
          mediaIndex: 0n,
          mediaType: 1,
          questionMetadataHash: `0x${"f".repeat(64)}`,
          resultSpecHash: `0x${"e".repeat(64)}`,
          url: "https://evil.example/spoof.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
        questionContentAnchoredLog({
          contentId: 7n,
          logIndex: 12,
          mediaIndex: 0n,
          mediaType: 1,
          url: imageUrl,
        }),
      ],
    }));

    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ContentRegistry:ContentSubmitted");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          submitter: "0x0000000000000000000000000000000000000001",
          contentHash: "0xabc",
          url: "https://example.com/question",
          title: "Question?",
          tags: "tag",
          categoryId: 1n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
        log: {
          logIndex: 10,
        },
        transaction: {
          hash: `0x${"1".repeat(64)}`,
        },
      },
      context: {
        client: { getTransactionReceipt, readContract },
        contracts: {
          ContentRegistry: {
            address: REGISTRY_ADDRESS,
          },
        },
        db,
      },
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { id: 7n },
          table: "content",
          values: expect.objectContaining({
            questionMetadataHash: `0x${"2".repeat(64)}`,
            resultSpecHash: `0x${"3".repeat(64)}`,
          }),
        }),
      ]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "contentMedia",
          values: expect.objectContaining({
            contentId: 7n,
            mediaIndex: 0,
            mediaType: "image",
            url: imageUrl,
          }),
        }),
      ]),
    );
  });

  it("applies confidentiality config that was indexed before content submission", async () => {
    const { db, insertCalls, updateCalls } = createDb(
      null,
      {
        confidentialityConfig: {
          contentId: 7n,
          gated: true,
          bondAsset: 1,
          bondAmount: 2_500_000n,
          flags: 1,
        },
      },
    );
    const readContract = vi.fn(async () => ({
      epochDuration: 600,
      maxDuration: 7200,
      minVoters: 5,
      maxVoters: 50,
    }));
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ContentRegistry:ContentSubmitted");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 7n,
          submitter: "0x0000000000000000000000000000000000000001",
          contentHash: "0xabc",
          url: "https://example.com/question",
          title: "Question?",
          tags: "tag",
          categoryId: 1n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        client: { readContract },
        contracts: {
          ContentRegistry: {
            address: REGISTRY_ADDRESS,
          },
        },
        db,
      },
    });

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            id: 7n,
            gated: false,
            confidentialityBondAmount: 0n,
          }),
        }),
      ]),
    );
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { id: 7n },
          table: "content",
          values: {
            gated: true,
            confidentialityBondAsset: "USDC",
            confidentialityBondAmount: 2_500_000n,
            confidentialityDisclosurePolicy: "private_forever",
          },
        }),
      ]),
    );
  });

  it("links bundle questions from explicit content link events", async () => {
    const { db, insertCalls, updateCalls } = createDb();
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "ContentRegistry:QuestionBundleContentLinked",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          bundleId: 3n,
          contentId: 9n,
          bundleIndex: 2n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        db,
      },
    });
    await handler!({
      event: {
        args: {
          bundleId: 3n,
          contentId: 7n,
          bundleIndex: 0n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        db,
      },
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { id: 7n },
          table: "content",
          values: expect.objectContaining({ bundleId: 3n, bundleIndex: 0 }),
        }),
        expect.objectContaining({
          key: { id: 9n },
          table: "content",
          values: expect.objectContaining({ bundleId: 3n, bundleIndex: 2 }),
        }),
      ]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionBundleQuestion",
          values: expect.objectContaining({
            id: "3-0",
            bundleId: 3n,
            contentId: 7n,
            bundleIndex: 0,
          }),
        }),
        expect.objectContaining({
          table: "questionBundleQuestion",
          values: expect.objectContaining({
            id: "3-2",
            bundleId: 3n,
            contentId: 9n,
            bundleIndex: 2,
          }),
        }),
      ]),
    );
  });

  it("applies bundle links that arrive before content submission", async () => {
    const { db, insertCalls, updateCalls } = createDb(null);
    const readContract = vi.fn(async () => ({
      epochDuration: 600,
      maxDuration: 7200,
      minVoters: 5,
      maxVoters: 50,
    }));
    const registeredHandlers = await loadHandlers();
    const linkHandler = registeredHandlers.get(
      "ContentRegistry:QuestionBundleContentLinked",
    );
    const contentHandler = registeredHandlers.get(
      "ContentRegistry:ContentSubmitted",
    );

    expect(linkHandler).toBeDefined();
    expect(contentHandler).toBeDefined();

    await linkHandler!({
      event: {
        args: {
          bundleId: 3n,
          contentId: 7n,
          bundleIndex: 0n,
        },
        block: {
          number: 42n,
          timestamp: 998n,
        },
      },
      context: {
        db,
      },
    });

    await contentHandler!({
      event: {
        args: {
          contentId: 7n,
          submitter: "0x0000000000000000000000000000000000000001",
          contentHash: "0xabc",
          url: "https://example.com/question",
          title: "Question?",
          tags: "tag",
          categoryId: 1n,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        client: { readContract },
        contracts: {
          ContentRegistry: {
            address: REGISTRY_ADDRESS,
          },
        },
        db,
      },
    });

    expect(updateCalls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { id: 7n },
          table: "content",
          values: expect.objectContaining({ bundleId: 3n, bundleIndex: 0 }),
        }),
      ]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "questionBundleQuestion",
          values: expect.objectContaining({
            id: "3-0",
            bundleId: 3n,
            contentId: 7n,
            bundleIndex: 0,
          }),
        }),
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            id: 7n,
            bundleId: 3n,
            bundleIndex: 0,
          }),
        }),
      ]),
    );
  });

  it("does not create synthetic rating history rows for RatingUpdated display refreshes", async () => {
    const { db, insertCalls, updateCalls } = createDb();

    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get("ContentRegistry:RatingUpdated");

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          contentId: 1n,
          newRating: 57,
          oldRating: 50,
        },
        block: {
          number: 42n,
          timestamp: 999n,
        },
      },
      context: {
        client: { readContract: vi.fn() },
        contracts: {
          ContentRegistry: {
            address: "0x000000000000000000000000000000000000c0de",
          },
        },
        db,
      },
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            conservativeRatingBps: 5700,
            rating: 57,
            ratingBps: 5700,
          }),
        }),
      ]),
    );
    expect(insertCalls).toEqual([]);
  });

  it("indexes lowSince from RatingStateUpdated events", async () => {
    const { db, insertCalls, updateCalls } = createDb();

    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "ContentRegistry:RatingStateUpdated",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          confidenceMass: 123n,
          conservativeRatingBps: 5200,
          contentId: 1n,
          downEvidence: 111n,
          effectiveEvidence: 456n,
          newRatingBps: 5700,
          oldRatingBps: 5000,
          referenceRatingBps: 5000,
          roundId: 2n,
          settledRounds: 3,
          lowSince: 777n,
          upEvidence: 345n,
        },
        block: {
          number: 99n,
          timestamp: 888n,
        },
      },
      context: {
        client: { readContract: vi.fn() },
        contracts: {
          ContentRegistry: {
            address: "0x000000000000000000000000000000000000c0de",
          },
        },
        db,
      },
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "content",
          values: expect.objectContaining({
            ratingDownEvidence: 111n,
            ratingLowSince: 777n,
            ratingUpEvidence: 345n,
          }),
        }),
        expect.objectContaining({
          table: "round",
          values: expect.objectContaining({
            downEvidence: 111n,
            lowSince: 777n,
            upEvidence: 345n,
          }),
        }),
      ]),
    );

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "ratingChange",
          values: expect.objectContaining({
            downEvidence: 111n,
            lowSince: 777n,
            upEvidence: 345n,
          }),
        }),
      ]),
    );
  });

  it("uses protocol round config defaults for RatingStateUpdated fallback round inserts", async () => {
    const { db, insertCalls } = createDb(null);
    const registeredHandlers = await loadHandlers();
    const handler = registeredHandlers.get(
      "ContentRegistry:RatingStateUpdated",
    );

    expect(handler).toBeDefined();

    await handler!({
      event: {
        args: {
          confidenceMass: 123n,
          conservativeRatingBps: 5200,
          contentId: 1n,
          downEvidence: 111n,
          effectiveEvidence: 456n,
          newRatingBps: 5700,
          oldRatingBps: 5000,
          referenceRatingBps: 5000,
          roundId: 2n,
          settledRounds: 3,
          lowSince: 777n,
          upEvidence: 345n,
        },
        block: {
          number: 99n,
          timestamp: 888n,
        },
      },
      context: {
        client: { readContract: vi.fn() },
        contracts: {
          ContentRegistry: {
            address: "0x000000000000000000000000000000000000c0de",
          },
        },
        db,
      },
    });

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "round",
          values: expect.objectContaining({
            epochDuration: 1200,
            maxDuration: 1200,
            maxVoters: 100,
            minVoters: 3,
          }),
        }),
      ]),
    );
  });
});

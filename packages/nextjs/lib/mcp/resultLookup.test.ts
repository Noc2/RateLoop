import type { McpAgentAuth } from "./auth";
import { McpToolError, __setMcpToolTestOverridesForTests, callRateLoopMcpTool, normalizeToolError } from "./tools";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;

const AGENT: McpAgentAuth = {
  allowedCategoryIds: null,
  dailyBudgetAtomic: 5_000_000n,
  id: "agent-read",
  perAskLimitAtomic: 2_000_000n,
  scopes: new Set(["rateloop:read"]),
  tokenHash: "a".repeat(64),
  walletAddress: null,
};

before(() => {
  env.DATABASE_URL = "memory:";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

beforeEach(async () => {
  __setMcpToolTestOverridesForTests(null);
  await dbClient.execute("DELETE FROM mcp_agent_budget_reservations");
  await dbClient.execute("DELETE FROM x402_question_submissions");
});

after(() => {
  __setMcpToolTestOverridesForTests(null);
  __setDatabaseResourcesForTests(null);
  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("rateloop_get_result requires contentId when an operation maps to multiple bundle questions", async () => {
  const operationKey = `0x${"6".repeat(64)}` as const;
  const now = new Date("2026-04-23T12:00:00.000Z");

  await dbClient.execute({
    args: [
      operationKey,
      AGENT.id,
      "bundle-result",
      "payload-hash",
      480,
      "5",
      "1000000",
      "submitted",
      "123",
      null,
      now,
      now,
    ],
    sql: `
      INSERT INTO mcp_agent_budget_reservations (
        operation_key,
        agent_id,
        client_request_id,
        payload_hash,
        chain_id,
        category_id,
        payment_amount,
        status,
        content_id,
        error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  await dbClient.execute({
    args: [
      operationKey,
      "bundle-result",
      "payload-hash",
      480,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      2,
      "submitted",
      "123",
      JSON.stringify(["123", "456"]),
      now,
      now,
      now,
    ],
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        content_ids,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  __setMcpToolTestOverridesForTests({
    getContentById: async () => {
      throw new Error("content lookup should not run without an explicit contentId");
    },
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: {
          chainId: 480,
          clientRequestId: "bundle-result",
        },
        name: "rateloop_get_result",
      }),
    /provide contentid/i,
  );
});

test("rateloop_get_result accepts an explicit bundle contentId without bypassing operation lookup", async () => {
  const operationKey = `0x${"7".repeat(64)}` as const;
  const now = new Date("2026-04-23T12:00:00.000Z");
  let contentLookupOptions: unknown;

  await dbClient.execute({
    args: [
      operationKey,
      AGENT.id,
      "bundle-result-selected",
      "payload-hash",
      480,
      "5",
      "1000000",
      "submitted",
      "123",
      null,
      now,
      now,
    ],
    sql: `
      INSERT INTO mcp_agent_budget_reservations (
        operation_key,
        agent_id,
        client_request_id,
        payload_hash,
        chain_id,
        category_id,
        payment_amount,
        status,
        content_id,
        error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  await dbClient.execute({
    args: [
      operationKey,
      "bundle-result-selected",
      "payload-hash",
      480,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      2,
      "submitted",
      "123",
      JSON.stringify(["123", "456"]),
      now,
      now,
      now,
    ],
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        content_ids,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  __setMcpToolTestOverridesForTests({
    getContentById: async (contentId, options) => {
      contentLookupOptions = options;
      return {
        audienceContext: null,
        content: {
          categoryId: "5",
          conservativeRatingBps: 5000,
          contentHash: `0x${"1".repeat(64)}`,
          createdAt: "1",
          description: "Would this make you want to learn more?",
          id: contentId,
          lastActivityAt: "2",
          openRound: null,
          questionMetadataHash: `0x${"2".repeat(64)}`,
          rating: 50,
          resultSpecHash: null,
          rewardPoolSummary: null,
          status: 0,
          submitter: `0x${"3".repeat(40)}`,
          tags: "agent,pitch",
          title: "Pitch interest",
          totalRounds: 1,
          totalVotes: 1,
          url: "https://example.com/pitch",
        },
        ratings: [],
        rounds: [],
      } as never;
    },
  });

  const result = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      chainId: 480,
      clientRequestId: "bundle-result-selected",
      contentId: "456",
    },
    name: "rateloop_get_result",
  })) as {
    operation: {
      contentIds: string[];
    } | null;
    publicUrl: string | null;
  };

  assert.equal(result.publicUrl, "http://localhost:3000/rate?content=456");
  assert.deepEqual(result.operation?.contentIds, ["123", "456"]);
  const expectedDeployment = resolveProtocolDeploymentScope(480);
  assert.ok(expectedDeployment);
  assert.deepEqual(contentLookupOptions, {
    chainId: 480,
    deploymentKey: expectedDeployment.deploymentKey,
    includeTargetAudience: true,
  });
});

test("rateloop_get_result rejects contentId that does not belong to the operation", async () => {
  const operationKey = `0x${"a".repeat(64)}` as const;
  const now = new Date("2026-04-23T12:00:00.000Z");

  await dbClient.execute({
    args: [
      operationKey,
      AGENT.id,
      "bundle-result-mismatch",
      "payload-hash",
      480,
      "5",
      "1000000",
      "submitted",
      "42",
      null,
      now,
      now,
    ],
    sql: `
      INSERT INTO mcp_agent_budget_reservations (
        operation_key,
        agent_id,
        client_request_id,
        payload_hash,
        chain_id,
        category_id,
        payment_amount,
        status,
        content_id,
        error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  await dbClient.execute({
    args: [
      operationKey,
      "bundle-result-mismatch",
      "payload-hash",
      480,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      "42",
      JSON.stringify(["42"]),
      now,
      now,
      now,
    ],
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        content_ids,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  __setMcpToolTestOverridesForTests({
    getContentById: async () => {
      throw new Error("content lookup should not run for mismatched operation contentId");
    },
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: {
          contentId: "99",
          operationKey,
        },
        name: "rateloop_get_result",
      }),
    /contentId does not belong to this ask/i,
  );
});

test("rateloop_get_result returns schema-shaped pending packages before content exists", async () => {
  const operationKey = `0x${"8".repeat(64)}` as const;
  const now = new Date("2026-04-23T12:00:00.000Z");

  await dbClient.execute({
    args: [
      operationKey,
      "pending-result",
      "payload-hash",
      480,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "awaiting_wallet_signature",
      null,
      null,
      now,
      now,
      null,
    ],
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        content_ids,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  const result = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      chainId: 480,
      clientRequestId: "pending-result",
    },
    name: "rateloop_get_result",
  })) as {
    answerScopes?: {
      allAnswers?: unknown;
      bountyEligibleAnswers?: {
        policy?: {
          mode?: number;
        };
      };
    };
    cohortSummary?: unknown;
    methodology?: {
      ratingSystem?: string;
    };
    ready?: boolean;
  };

  assert.equal(result.ready, false);
  assert.equal(result.cohortSummary, null);
  assert.ok(result.answerScopes?.allAnswers);
  assert.equal(result.answerScopes?.bountyEligibleAnswers?.policy?.mode, 0);
  assert.equal(result.methodology?.ratingSystem, "rateloop.robust_bts_binary.v1");
});

test("rateloop_get_result applies bundle bounty eligibility when loading eligible answers", async () => {
  let voteQuery: unknown;

  __setMcpToolTestOverridesForTests({
    getAllVotes: async params => {
      voteQuery = params;
      return [
        {
          contentId: "789",
          id: "vote-1",
          identityHolder: `0x${"a".repeat(40)}`,
          isUp: true,
          revealed: true,
          roundId: "2",
          stake: "100",
          voter: `0x${"a".repeat(40)}`,
        },
        {
          contentId: "789",
          id: "vote-2",
          identityHolder: `0x${"b".repeat(40)}`,
          isUp: false,
          revealed: true,
          roundId: "2",
          stake: "100",
          voter: `0x${"b".repeat(40)}`,
        },
      ] as never;
    },
    getContentById: async contentId =>
      ({
        audienceContext: null,
        content: {
          bundle: {
            allocatedAmount: "1000000",
            asset: 1,
            bountyClosesAt: "2000",
            bountyEligibility: 8,
            bountyEligibilityDataHash: `0x${"0".repeat(64)}`,
            bountyOpensAt: "1000",
            claimedAmount: "0",
            claimedCount: 0,
            completedRoundSetCount: 1,
            failed: false,
            feedbackClosesAt: "2000",
            frontendFeeBps: 300,
            fundedAmount: "1000000",
            id: "bundle-1",
            questionCount: 2,
            refunded: false,
            refundedAmount: "0",
            requiredCompleters: 3,
            requiredSettledRounds: 1,
            totalRecordedQuestionRounds: 2,
            unallocatedAmount: "0",
          },
          categoryId: "5",
          conservativeRatingBps: 5000,
          contentHash: `0x${"1".repeat(64)}`,
          createdAt: "1",
          description: "Would this make you want to learn more?",
          id: contentId,
          lastActivityAt: "2",
          openRound: null,
          questionMetadataHash: `0x${"2".repeat(64)}`,
          rating: 50,
          resultSpecHash: null,
          rewardPoolSummary: null,
          status: 0,
          submitter: `0x${"3".repeat(40)}`,
          tags: "agent,pitch",
          title: "Pitch interest",
          totalRounds: 1,
          totalVotes: 2,
          url: "https://example.com/pitch",
        },
        ratings: [],
        rounds: [
          {
            downCount: 1,
            downPool: "100",
            revealedCount: 2,
            roundId: "2",
            settledAt: "100",
            state: 1,
            totalStake: "200",
            upCount: 1,
            upPool: "100",
            upWins: true,
            voteCount: 2,
          },
        ],
      }) as never,
    getRaterParticipationStatus: async address =>
      ({
        humanCredential: {
          verified: false,
        },
        worldCredentials: {
          activeMask: address.toLowerCase() === `0x${"a".repeat(40)}` ? 8 : 0,
          freshRecheckMask: 0,
          kinds: {},
        },
      }) as never,
  });

  const result = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      contentId: "789",
    },
    name: "rateloop_get_result",
  })) as {
    answerScopes?: {
      bountyEligibleAnswers?: {
        distribution?: {
          up?: {
            share?: number | null;
          };
        } | null;
        policy?: {
          mode?: number | null;
        };
      };
    };
  };

  assert.deepEqual(voteQuery, {
    contentId: "789",
    roundId: "2",
  });
  assert.equal(result.answerScopes?.bountyEligibleAnswers?.policy?.mode, 8);
  assert.equal(result.answerScopes?.bountyEligibleAnswers?.distribution?.up?.share, 1);
});

test("normalizeToolError preserves category_disallowed for explicit MCP category blocks", () => {
  const normalized = normalizeToolError(new McpToolError("This MCP agent is not allowed to ask in category 6.", 403));
  assert.equal(normalized.code, "category_disallowed");
  assert.equal(normalized.originalCode, "McpToolError");
  assert.equal(normalized.retryable, false);
});

import {
  __setAgentLifecycleTargetChainIdsForTests,
  __setAgentLifecycleTestOverridesForTests,
  sweepAgentLifecycleCallbacks,
} from "./lifecycle";
import { publicWebhookAgentId } from "./publicWebhooks";
import { upsertAgentCallbackSubscription } from "./registry";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { __setUrlSafetyDnsResolversForTests } from "~~/utils/urlSafety";

const CANDIDATE = {
  agentId: "agent-a",
  chainId: 480,
  clientRequestId: "pitch-1",
  contentId: "42",
  operationKey: `0x${"1".repeat(64)}` as const,
  sortAt: new Date("2023-11-14T22:00:00.000Z"),
};

function operationKeyFor(value: number) {
  return `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;
}

function contentResponse(overrides: Record<string, unknown> = {}) {
  return {
    audienceContext: null,
    content: {
      openRound: {
        estimatedSettlementTime: "1700000600",
        roundId: "7",
      },
      ...overrides,
    },
    ratings: [],
    rounds: [],
  };
}

async function insertSubmittedWalletAsk(params: {
  chainId: number;
  clientRequestId: string;
  contentId: string;
  operationKey: `0x${string}`;
  submittedAt: Date;
  walletAddress: string;
}) {
  await dbClient.execute({
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payer_address,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        payment_receipt,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.operationKey,
      params.clientRequestId,
      `payload-${params.operationKey}`,
      params.chainId,
      params.walletAddress,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      params.contentId,
      JSON.stringify({
        mode: "permissionless-wallet-plan",
        operationKey: params.operationKey,
        originalClientRequestId: params.clientRequestId,
        walletAddress: params.walletAddress,
      }),
      params.submittedAt,
      params.submittedAt,
      params.submittedAt,
    ],
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
});

afterEach(() => {
  __setAgentLifecycleTargetChainIdsForTests(undefined);
  __setAgentLifecycleTestOverridesForTests(null);
  __setDatabaseResourcesForTests(null);
  __setUrlSafetyDnsResolversForTests(null);
});

test("sweepAgentLifecycleCallbacks emits open and settling for overdue open rounds", async () => {
  const enqueued: Array<{ eventId?: string; eventType: string; payload: unknown }> = [];

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    getContentById: async () =>
      contentResponse({
        openRound: {
          estimatedSettlementTime: "1700000000",
          roundId: "7",
        },
      }) as never,
    listCandidates: async () => [CANDIDATE],
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.deepEqual(result.emitted, {
    bountyLowResponse: 0,
    feedbackUnlocked: 0,
    questionOpen: 1,
    questionSettled: 0,
    questionSettling: 1,
  });
  assert.deepEqual(
    enqueued.map(event => event.eventType),
    ["question.open", "question.settling"],
  );
});

test("sweepAgentLifecycleCallbacks scopes content and feedback reads by candidate deployment", async () => {
  const candidate = { ...CANDIDATE, chainId: 84532 };
  const deployment = resolveProtocolDeploymentScope(candidate.chainId);
  assert.ok(deployment);
  let contentOptions: unknown = null;
  let feedbackOptions: unknown = null;

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async () => [],
    getContentById: async (_contentId, options) => {
      contentOptions = options;
      return contentResponse({
        openRound: {
          estimatedSettlementTime: "1700000000",
          roundId: "7",
        },
      }) as never;
    },
    listCandidates: async () => [candidate],
    listContentFeedback: async params => {
      feedbackOptions = params;
      return {
        items: [],
      } as never;
    },
  });

  await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.deepEqual(contentOptions, {
    chainId: candidate.chainId,
    deploymentKey: deployment.deploymentKey,
  });
  assert.deepEqual(feedbackOptions, {
    chainId: candidate.chainId,
    contentId: candidate.contentId,
    context: {
      currentRoundId: "7",
      openRoundId: "7",
      settlementComplete: false,
      terminalRoundIds: new Set(),
    },
    deploymentKey: deployment.deploymentKey,
  });
});

test("sweepAgentLifecycleCallbacks skips candidates outside configured target networks", async () => {
  let contentReads = 0;
  let candidateTargetChainIds: number[] | null = null;

  __setAgentLifecycleTargetChainIdsForTests([8453]);
  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async () => [],
    getContentById: async () => {
      contentReads += 1;
      return contentResponse() as never;
    },
    listCandidates: async ({ targetChainIds }) => {
      candidateTargetChainIds = targetChainIds ? Array.from(targetChainIds) : null;
      return [{ ...CANDIDATE, chainId: 84532 }];
    },
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks();

  assert.equal(contentReads, 0);
  assert.deepEqual(candidateTargetChainIds, [8453]);
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.emitted, {
    bountyLowResponse: 0,
    feedbackUnlocked: 0,
    questionOpen: 0,
    questionSettled: 0,
    questionSettling: 0,
  });
});

test("sweepAgentLifecycleCallbacks filters target chains before applying sweep limit", async () => {
  const activeChainId = 480;
  const inactiveChainId = 84532;
  const walletAddress = "0x00000000000000000000000000000000000000bb";
  const submittedAt = new Date("2023-11-14T22:00:00.000Z");
  const activeContentId = "active-after-inactive";
  const contentReads: string[] = [];
  const openedContentIds: string[] = [];

  for (let index = 0; index < 25; index += 1) {
    await insertSubmittedWalletAsk({
      chainId: inactiveChainId,
      clientRequestId: `wallet:inactive-${index}`,
      contentId: `inactive-${index}`,
      operationKey: operationKeyFor(index + 1),
      submittedAt: new Date(submittedAt.getTime() + index * 1000),
      walletAddress,
    });
  }
  await insertSubmittedWalletAsk({
    chainId: activeChainId,
    clientRequestId: "wallet:active",
    contentId: activeContentId,
    operationKey: operationKeyFor(100),
    submittedAt: new Date(submittedAt.getTime() + 25_000),
    walletAddress,
  });

  __setAgentLifecycleTargetChainIdsForTests([activeChainId]);
  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      if (params.eventType === "question.open") {
        openedContentIds.push(String((params.payload as { contentId?: string }).contentId));
      }
      return [];
    },
    getContentById: async contentId => {
      contentReads.push(String(contentId));
      return contentResponse() as never;
    },
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks({
    limit: 25,
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.deepEqual(contentReads, [activeContentId]);
  assert.deepEqual(openedContentIds, [activeContentId]);
  assert.equal(result.scanned, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.emitted.questionOpen, 1);
});

test("sweepAgentLifecycleCallbacks emits settled and feedback unlocked for terminal rounds", async () => {
  const enqueued: Array<{ eventType: string }> = [];

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push({ eventType: params.eventType });
      return [];
    },
    getContentById: async () =>
      ({
        ...contentResponse({ openRound: null }),
        rounds: [{ roundId: "7", state: 1 }],
      }) as never,
    listCandidates: async () => [CANDIDATE],
    listContentFeedback: async () =>
      ({
        items: [{ id: 1 }],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks();

  assert.deepEqual(result.emitted, {
    bountyLowResponse: 0,
    feedbackUnlocked: 1,
    questionOpen: 0,
    questionSettled: 1,
    questionSettling: 0,
  });
  assert.deepEqual(
    enqueued.map(event => event.eventType),
    ["question.settled", "feedback.unlocked"],
  );
});

test("sweepAgentLifecycleCallbacks stays idempotent through stable event ids", async () => {
  const seen = new Set<string>();
  let duplicateCount = 0;

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      if (params.eventId && seen.has(params.eventId)) duplicateCount += 1;
      if (params.eventId) seen.add(params.eventId);
      return [];
    },
    getContentById: async () =>
      contentResponse({
        openRound: {
          estimatedSettlementTime: "1700000000",
          roundId: "7",
        },
      }) as never,
    listCandidates: async () => [CANDIDATE],
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });
  await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.equal(seen.size, 2);
  assert.equal(duplicateCount, 2);
});

test("sweepAgentLifecycleCallbacks caps scanned asks per invocation", async () => {
  const listCalls: Array<{ after: string | null; limit: number }> = [];
  const openedContentIds: string[] = [];
  const candidates = [
    {
      ...CANDIDATE,
      contentId: "41",
      operationKey: `0x${"2".repeat(64)}` as const,
      sortAt: new Date("2023-11-14T22:00:00.000Z"),
    },
    {
      ...CANDIDATE,
      contentId: "42",
      operationKey: `0x${"3".repeat(64)}` as const,
      sortAt: new Date("2023-11-14T22:01:00.000Z"),
    },
    {
      ...CANDIDATE,
      contentId: "43",
      operationKey: `0x${"4".repeat(64)}` as const,
      sortAt: new Date("2023-11-14T22:02:00.000Z"),
    },
  ];

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      if (params.eventType === "question.open") {
        openedContentIds.push(String((params.payload as { contentId?: string }).contentId));
      }
      return [];
    },
    getContentById: async contentId =>
      contentResponse({
        id: contentId,
        openRound: {
          estimatedSettlementTime: "1700000600",
          roundId: "7",
        },
      }) as never,
    listCandidates: async ({ after, limit }) => {
      listCalls.push({
        after: after?.operationKey ?? null,
        limit,
      });
      return candidates
        .filter(candidate => {
          if (!after) return true;
          return (
            candidate.sortAt.getTime() > after.sortAt.getTime() ||
            (candidate.sortAt.getTime() === after.sortAt.getTime() && candidate.operationKey > after.operationKey)
          );
        })
        .slice(0, limit);
    },
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks({
    limit: 2,
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.equal(result.scanned, 2);
  assert.equal(result.hasMore, true);
  assert.deepEqual(openedContentIds, ["41", "42"]);
  assert.deepEqual(listCalls, [
    {
      after: null,
      limit: 2,
    },
  ]);
});

test("sweepAgentLifecycleCallbacks emits bounty.low_response with live ask guidance", async () => {
  const enqueued: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push({
        eventType: params.eventType,
        payload: params.payload as Record<string, unknown>,
      });
      return [];
    },
    getContentById: async () =>
      ({
        ...contentResponse({
          openRound: {
            epochDuration: 1200,
            estimatedSettlementTime: "1700000400",
            lowSince: "1700000100",
            maxDuration: 7200,
            maxVoters: 50,
            minVoters: 3,
            roundId: "7",
            voteCount: 1,
          },
          rewardPoolSummary: {
            currentRewardPoolAmount: "1000000",
            hasActiveBounty: true,
            nextBountyClosesAt: "1700000600",
          },
          roundEpochDuration: 1200,
          roundMaxDuration: 7200,
          roundMaxVoters: 50,
          roundMinVoters: 3,
        }),
        rounds: [],
      }) as never,
    listCandidates: async () => [CANDIDATE],
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.equal(result.emitted.bountyLowResponse, 1);
  assert.equal(enqueued.at(-1)?.eventType, "bounty.low_response");
  assert.deepEqual(enqueued.at(-1)?.payload.liveAskGuidance, {
    lowResponseRisk: "high",
    reasonCodes: [
      "quorum_not_reached",
      "low_response_persisting",
      "bounty_below_healthy_target",
      "bounty_closing_soon",
      "settlement_near_with_quorum_gap",
    ],
    recommendedAction: "retry_later",
    suggestedTopUpAtomic: "500000",
  });
});

test("sweepAgentLifecycleCallbacks casts nullable lifecycle cursor parameters", async () => {
  const resources = createMemoryDatabaseResources();
  const lifecycleQueries: string[] = [];
  const execute: typeof resources.client.execute = async input => {
    if (typeof input !== "string" && input.sql.includes("WITH lifecycle_candidates AS")) {
      lifecycleQueries.push(input.sql);
    }
    return resources.client.execute(input);
  };
  __setDatabaseResourcesForTests({
    ...resources,
    client: { execute },
  });

  const result = await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.equal(result.scanned, 0);
  assert.equal(lifecycleQueries.length, 1);
  assert.match(lifecycleQueries[0] ?? "", /CAST\(\? AS timestamptz\) IS NULL/);
});

test("sweepAgentLifecycleCallbacks discovers public wallet webhook subscriptions", async () => {
  const operationKey = `0x${"8".repeat(64)}` as const;
  const walletAddress = "0x00000000000000000000000000000000000000aa";
  const agentId = publicWebhookAgentId({ chainId: 480, walletAddress });
  const submittedAt = new Date("2023-11-14T22:00:00.000Z");
  const enqueued: Array<{ agentId: string; eventType: string; payload: Record<string, unknown> }> = [];

  await dbClient.execute({
    sql: `
      INSERT INTO x402_question_submissions (
        operation_key,
        client_request_id,
        payload_hash,
        chain_id,
        payer_address,
        payment_asset,
        payment_amount,
        bounty_amount,
        question_count,
        status,
        content_id,
        payment_receipt,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      operationKey,
      "wallet:hashed-public-id",
      "payload-hash",
      480,
      walletAddress,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      "42",
      JSON.stringify({
        mode: "permissionless-wallet-plan",
        operationKey,
        originalClientRequestId: "ask-public-lifecycle",
        walletAddress,
      }),
      submittedAt,
      submittedAt,
      submittedAt,
    ],
  });
  await upsertAgentCallbackSubscription({
    agentId,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.open"],
    secret: "webhook-secret",
  });

  __setAgentLifecycleTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push({
        agentId: params.agentId,
        eventType: params.eventType,
        payload: params.payload as Record<string, unknown>,
      });
      return [];
    },
    getContentById: async () =>
      contentResponse({
        openRound: {
          estimatedSettlementTime: "1700000600",
          roundId: "7",
        },
      }) as never,
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await sweepAgentLifecycleCallbacks({
    now: new Date("2023-11-14T22:13:40.000Z"),
  });

  assert.equal(result.emitted.questionOpen, 1);
  assert.equal(enqueued[0]?.agentId, agentId);
  assert.equal(enqueued[0]?.eventType, "question.open");
  assert.equal(enqueued[0]?.payload.clientRequestId, "ask-public-lifecycle");
  assert.equal(enqueued[0]?.payload.operationKey, operationKey);
});

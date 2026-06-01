import type { McpAgentAuth } from "./auth";
import { __setMcpToolTestOverridesForTests, callPublicRateLoopMcpTool, callRateLoopMcpTool } from "./tools";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";
import { __setUrlSafetyDnsResolversForTests } from "~~/utils/urlSafety";

const AGENT: McpAgentAuth = {
  allowedCategoryIds: null,
  dailyBudgetAtomic: 5_000_000n,
  id: "agent-a",
  perAskLimitAtomic: 2_000_000n,
  scopes: new Set(["rateloop:ask", "rateloop:rate"]),
  tokenHash: "a".repeat(64),
  walletAddress: "0x00000000000000000000000000000000000000aa",
};
const RESTRICTED_AGENT: McpAgentAuth = {
  ...AGENT,
  allowedCategoryIds: new Set(["5"]),
  id: "restricted-agent",
};
const OPERATION_KEY = `0x${"1".repeat(64)}` as const;
const RATING_CONTENT_ID = "42";
const RATING_ROUND_ID = 7n;
const RATING_COMMIT_HASH = `0x${"4".repeat(64)}` as const;
const RATING_CIPHERTEXT = `0x${"12".repeat(64)}` as const;
const RATING_DRAND_CHAIN_HASH = `0x${"5".repeat(64)}` as const;
const RATING_FRONTEND = "0x00000000000000000000000000000000000000fe" as const;

function askArguments(overrides: Record<string, unknown> = {}) {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
      rewardPoolExpiresAt: "1762000000",
    },
    chainId: 480,
    clientRequestId: "ask-bookkeeping-failure",
    maxPaymentAmount: "1500000",
    question: {
      categoryId: "5",
      contextUrl: "https://example.com/context",
      description: "Should this autonomous action continue?",
      tags: ["agents"],
      title: "Agent action approval",
    },
    ...overrides,
  };
}

function budgetReservation() {
  return {
    agentId: AGENT.id,
    categoryId: "5",
    chainId: 480,
    clientRequestId: "ask-bookkeeping-failure",
    contentId: null,
    createdAt: new Date(),
    error: null,
    operationKey: OPERATION_KEY,
    paymentAmount: "1000000",
    payloadHash: "payload-hash",
    status: "reserved",
    updatedAt: new Date(),
  } as const;
}

function quoteOverrides() {
  return {
    preflightX402QuestionSubmission: async () => ({
      operation: {
        canonicalPayload: {} as never,
        operationKey: OPERATION_KEY,
        payloadHash: "payload-hash",
      },
      paymentAmount: 1_000_000n,
      resolvedCategoryIds: [5n],
      submissionKeys: [`0x${"2".repeat(64)}` as const],
    }),
    reserveMcpAgentBudget: async () => budgetReservation(),
    resolveX402QuestionConfig: () =>
      ({
        feedbackBonusEscrowAddress: "0x0000000000000000000000000000000000000003",
        questionRewardPoolEscrowAddress: "0x0000000000000000000000000000000000000002",
        usdcAddress: "0x0000000000000000000000000000000000000001",
      }) as never,
  };
}

function managedBudgetSummary() {
  return {
    agentId: AGENT.id,
    dailyBudgetAtomic: "5000000",
    perAskLimitAtomic: "2000000",
    remainingDailyBudgetAtomic: "4000000",
    spentTodayAtomic: "1000000",
  };
}

function ratingContent(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      categoryId: "5",
      description: "Rate this existing question",
      id: RATING_CONTENT_ID,
      openRound: null,
      roundEpochDuration: 1200,
      submitter: "0x00000000000000000000000000000000000000bb",
      title: "Existing content",
      ...overrides,
    },
    rounds: [],
  } as never;
}

function ratingRuntime(overrides: Record<string, unknown> = {}) {
  return {
    baseTotalStake: 0n,
    baseVoteCount: 0n,
    drandChainHash: RATING_DRAND_CHAIN_HASH,
    drandGenesisTimeSeconds: 1n,
    drandPeriodSeconds: 3n,
    epochDuration: 1200,
    now: () => Date.now(),
    requiresOpenRound: false,
    roundId: RATING_ROUND_ID,
    roundReferenceRatingBps: 5000,
    roundStartTimeSeconds: 1_762_000_000,
    targetRound: 100n,
    ...overrides,
  } as never;
}

function ratingPrepareArguments(overrides: Record<string, unknown> = {}) {
  return {
    ciphertext: RATING_CIPHERTEXT,
    commitHash: RATING_COMMIT_HASH,
    contentId: RATING_CONTENT_ID,
    drandChainHash: RATING_DRAND_CHAIN_HASH,
    frontend: RATING_FRONTEND,
    roundId: RATING_ROUND_ID.toString(),
    roundReferenceRatingBps: 5000,
    stakeWei: "1000000",
    targetRound: "100",
    walletAddress: AGENT.walletAddress,
    ...overrides,
  };
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
});

afterEach(() => {
  mock.reset();
  __setDatabaseResourcesForTests(null);
  __setUrlSafetyDnsResolversForTests(null);
  __setMcpToolTestOverridesForTests(null);
});

test("rateloop_ask_humans returns a wallet transaction plan without submitting from the server", async () => {
  mock.method(console, "error", () => {});
  const prepared: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          clientRequestId: "mcp:hashed",
          operationKey: OPERATION_KEY,
          payment: {
            amount: "1000000",
            asset: "USDC",
            bountyAmount: "1000000",
            decimals: 6,
            spender: "0x0000000000000000000000000000000000000002",
            tokenAddress: "0x0000000000000000000000000000000000000001",
          },
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: [{ id: "approve-usdc", to: "0x0000000000000000000000000000000000000001" }],
            requiresOrderedExecution: true,
          },
          wallet: { address: params.walletAddress, fundingMode: "agent_wallet" },
        },
        status: 202,
      };
    },
    ...quoteOverrides(),
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments(),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    confirmTool: string;
    legalNotice: { privacyUrl: string; termsUrl: string };
    managedBudget: { remainingDailyBudgetAtomic: string };
    status: string;
    transactionPlan: { calls: unknown[] };
    wallet: { address: string };
  };

  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.confirmTool, "rateloop_confirm_ask_transactions");
  assert.equal(body.wallet.address, AGENT.walletAddress);
  assert.equal(body.transactionPlan.calls.length, 1);
  assert.match(body.legalNotice.termsUrl, /\/legal\/terms$/);
  assert.match(body.legalNotice.privacyUrl, /\/legal\/privacy$/);
  assert.equal(body.managedBudget.remainingDailyBudgetAtomic, "4000000");
  assert.equal(prepared.length, 1);
});

test("rateloop_get_rating_context returns local encrypted commit instructions and open-round plan", async () => {
  __setMcpToolTestOverridesForTests({
    getContentById: async () => ratingContent(),
    readRatingAllowance: async () => 0n,
    resolveRoundVoteRuntime: async () => ratingRuntime({ requiresOpenRound: true, roundStartTimeSeconds: null }),
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: {
      contentId: RATING_CONTENT_ID,
      walletAddress: AGENT.walletAddress,
    },
    name: "rateloop_get_rating_context",
  });
  const body = result as {
    openRoundTransactionPlan: { calls: Array<{ data: string; functionName: string; phase: string }> };
    privacy: { inputMode: string };
    ratingInputMode: string;
    status: string;
  };

  assert.equal(body.status, "open_round_required");
  assert.equal(body.ratingInputMode, "local_encrypted_commit");
  assert.equal(body.privacy.inputMode, "local_encrypted_commit");
  assert.equal(body.openRoundTransactionPlan.calls[0]?.functionName, "openRound");
  assert.equal(body.openRoundTransactionPlan.calls[0]?.phase, "open_round");
  assert.match(body.openRoundTransactionPlan.calls[0]?.data ?? "", /^0x/);
});

test("rateloop_prepare_rating_transactions rejects plaintext rating fields", async () => {
  await assert.rejects(
    () =>
      callPublicRateLoopMcpTool({
        arguments: ratingPrepareArguments({ isUp: true }),
        name: "rateloop_prepare_rating_transactions",
      }),
    /Do not send plaintext rating fields/i,
  );
});

test("rateloop_prepare_rating_transactions returns wallet calls for encrypted commit material", async () => {
  __setMcpToolTestOverridesForTests({
    getContentById: async () => ratingContent(),
    readRatingAllowance: async () => 0n,
    resolveRoundVoteRuntime: async () => ratingRuntime(),
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: ratingPrepareArguments(),
    name: "rateloop_prepare_rating_transactions",
  });
  const body = result as {
    commit: { ciphertextHash: string; commitHash: string };
    confirmTool: string;
    status: string;
    statusTool: string;
    transactionPlan: { calls: Array<{ data: string; functionName: string; phase: string }> };
  };

  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.confirmTool, "rateloop_confirm_rating_transactions");
  assert.equal(body.statusTool, "rateloop_get_rating_status");
  assert.equal(body.commit.commitHash, RATING_COMMIT_HASH);
  assert.match(body.commit.ciphertextHash, /^0x[a-f0-9]{64}$/i);
  assert.deepEqual(
    body.transactionPlan.calls.map(call => call.phase),
    ["approve_lrep", "commit_rating"],
  );
  assert.ok(body.transactionPlan.calls.every(call => call.data.startsWith("0x")));
});

test("rateloop_prepare_rating_transactions can return a zero-stake advisory plan", async () => {
  __setMcpToolTestOverridesForTests({
    getContentById: async () => ratingContent(),
    readRatingAllowance: async () => 0n,
    resolveRoundVoteRuntime: async () => ratingRuntime(),
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: ratingPrepareArguments({ stakeWei: "0" }),
    name: "rateloop_prepare_rating_transactions",
  });
  const body = result as {
    isAdvisoryVote: boolean;
    transactionPlan: { calls: Array<{ functionName: string; phase: string }> };
  };

  assert.equal(body.isAdvisoryVote, true);
  assert.deepEqual(
    body.transactionPlan.calls.map(call => call.phase),
    ["record_advisory_vote"],
  );
  assert.equal(body.transactionPlan.calls[0]?.functionName, "recordAdvisoryVote");
});

test("rateloop_confirm_rating_transactions confirms matching rating commit receipts", async () => {
  const topics = encodeEventTopics({
    abi: RoundVotingEngineAbi,
    args: {
      contentId: BigInt(RATING_CONTENT_ID),
      roundId: RATING_ROUND_ID,
      voter: AGENT.walletAddress,
    },
    eventName: "VoteCommitted",
  });
  const data = encodeAbiParameters(
    [
      { name: "commitHash", type: "bytes32" },
      { name: "roundReferenceRatingBps", type: "uint16" },
      { name: "targetRound", type: "uint64" },
      { name: "drandChainHash", type: "bytes32" },
      { name: "stake", type: "uint256" },
      { name: "ciphertextHash", type: "bytes32" },
      { name: "ciphertext", type: "bytes" },
    ],
    [RATING_COMMIT_HASH, 5000, 100n, RATING_DRAND_CHAIN_HASH, 1_000_000n, `0x${"6".repeat(64)}`, RATING_CIPHERTEXT],
  );

  __setMcpToolTestOverridesForTests({
    getRatingTransactionReceipt: async () =>
      ({
        logs: [
          {
            address: "0x0000000000000000000000000000000000000001",
            data,
            topics,
          },
        ],
        status: "success",
      }) as never,
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      commitHash: RATING_COMMIT_HASH,
      contentId: RATING_CONTENT_ID,
      roundId: RATING_ROUND_ID.toString(),
      transactionHashes: [`0x${"7".repeat(64)}`],
      walletAddress: AGENT.walletAddress,
    },
    name: "rateloop_confirm_rating_transactions",
  });
  const body = result as { confirmed: boolean; commitHash: string | null; roundId: string; status: string };

  assert.equal(body.status, "committed");
  assert.equal(body.confirmed, true);
  assert.equal(body.roundId, RATING_ROUND_ID.toString());
  assert.equal(body.commitHash, RATING_COMMIT_HASH);
});

test("rateloop_ask_humans carries optional feedback bonus and reserves total spend", async () => {
  const prepared: unknown[] = [];
  const reserved: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          operationKey: OPERATION_KEY,
          payment: {
            amount: "1000000",
            asset: "USDC",
            bountyAmount: "1000000",
            decimals: 6,
            spender: "0x0000000000000000000000000000000000000002",
            tokenAddress: "0x0000000000000000000000000000000000000001",
          },
          status: "awaiting_wallet_signature",
        },
        status: 202,
      };
    },
    reserveMcpAgentBudget: async params => {
      reserved.push(params);
      return budgetReservation();
    },
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      feedbackBonus: { amount: "2000000" },
      maxPaymentAmount: "3000000",
    }),
    name: "rateloop_ask_humans",
  });
  const body = result as unknown as {
    feedbackBonus: { amount: string; status: string };
    feedbackBonusGuidance: { included: boolean };
    payment: { feedbackBonusAmount: string; totalAmount: string };
  };

  assert.equal(body.feedbackBonus.status, "pending_question_confirmation");
  assert.equal(body.feedbackBonus.amount, "2000000");
  assert.equal(body.feedbackBonusGuidance.included, true);
  assert.equal(body.payment.feedbackBonusAmount, "2000000");
  assert.equal(body.payment.totalAmount, "3000000");
  assert.equal((prepared[0] as { feedbackBonus?: { amount: bigint } }).feedbackBonus?.amount, 2_000_000n);
  assert.equal((reserved[0] as { amount: bigint }).amount, 3_000_000n);
});

test("rateloop_ask_humans can return a native x402 authorization request", async () => {
  const prepared: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareNativeX402QuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          clientRequestId: "mcp:hashed",
          nextAction: "sign_x402_authorization",
          operationKey: OPERATION_KEY,
          paymentMode: "x402_authorization",
          status: "awaiting_wallet_signature",
          transactionPlan: null,
          wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
          x402AuthorizationRequest: {
            authorization: {
              from: params.walletAddress,
              nonce: `0x${"4".repeat(64)}`,
              to: "0x0000000000000000000000000000000000000002",
              validAfter: "0",
              validBefore: "1762000000",
              value: "1000000",
            },
          },
        },
        status: 202,
      };
    },
    ...quoteOverrides(),
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({ paymentMode: "x402_authorization" }),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    confirmTool: string;
    nextAction: string;
    paymentMode: string;
    transactionPlan: null;
    wallet: { address: string; fundingMode: string };
    x402AuthorizationRequest: { authorization: { nonce: string } };
  };

  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.nextAction, "sign_x402_authorization");
  assert.equal(body.transactionPlan, null);
  assert.equal(body.confirmTool, "rateloop_confirm_ask_transactions");
  assert.equal(body.wallet.address, AGENT.walletAddress);
  assert.equal(body.wallet.fundingMode, "x402_authorization");
  assert.equal(body.x402AuthorizationRequest.authorization.nonce, `0x${"4".repeat(64)}`);
  assert.equal(prepared.length, 1);
});

test("quote and ask flows pass submission identity into image preflight", async () => {
  const preflightCalls: Array<{
    agentId?: string | null;
    ownerWalletAddress?: string | null;
  }> = [];

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    preflightX402QuestionSubmission: async params => {
      preflightCalls.push(params);
      return {
        operation: {
          canonicalPayload: {} as never,
          operationKey: OPERATION_KEY,
          payloadHash: "payload-hash",
        },
        paymentAmount: 1_000_000n,
        resolvedCategoryIds: [5n],
        submissionKeys: [`0x${"2".repeat(64)}` as const],
      };
    },
    prepareAgentWalletQuestionSubmissionRequest: async params => ({
      body: {
        clientRequestId: "mcp:hashed",
        operationKey: OPERATION_KEY,
        payment: {
          amount: "1000000",
          asset: "USDC",
          bountyAmount: "1000000",
          decimals: 6,
          spender: "0x0000000000000000000000000000000000000002",
          tokenAddress: "0x0000000000000000000000000000000000000001",
        },
        status: "awaiting_wallet_signature",
        transactionPlan: {
          calls: [{ id: "approve-usdc", to: "0x0000000000000000000000000000000000000001" }],
          requiresOrderedExecution: true,
        },
        wallet: { address: params.walletAddress, fundingMode: "agent_wallet" },
      },
      status: 202,
    }),
    preparePermissionlessWalletQuestionSubmissionRequest: async () => ({
      body: {
        clientRequestId: "public:mcp:hashed",
        operationKey: OPERATION_KEY,
        payment: {
          amount: "1000000",
          asset: "USDC",
          bountyAmount: "1000000",
          decimals: 6,
          spender: "0x0000000000000000000000000000000000000002",
          tokenAddress: "0x0000000000000000000000000000000000000001",
        },
        status: "awaiting_wallet_signature",
        transactionPlan: {
          calls: [{ id: "approve-usdc", to: "0x0000000000000000000000000000000000000001" }],
          requiresOrderedExecution: true,
        },
        wallet: { address: AGENT.walletAddress, fundingMode: "agent_wallet" },
      },
      status: 202,
    }),
  });

  await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments(),
    name: "rateloop_quote_question",
  });
  await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments(),
    name: "rateloop_ask_humans",
  });
  await callPublicRateLoopMcpTool({
    arguments: {
      ...askArguments(),
      walletAddress: AGENT.walletAddress,
    },
    name: "rateloop_ask_humans",
  });

  assert.equal(preflightCalls.length, 3);
  const managedCalls = preflightCalls.filter(call => call.agentId === AGENT.id);
  const publicCalls = preflightCalls.filter(call => call.agentId == null);

  assert.equal(managedCalls.length, 2);
  assert.equal(publicCalls.length, 1);
  assert.ok(managedCalls.every(call => call.ownerWalletAddress === AGENT.walletAddress));
  assert.equal(publicCalls[0]?.ownerWalletAddress, AGENT.walletAddress);
});

test("managed quote and ask reject wallet overrides outside the scoped agent wallet", async () => {
  __setMcpToolTestOverridesForTests({
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    ...quoteOverrides(),
  });

  const argumentsWithOverride = askArguments({
    walletAddress: "0x00000000000000000000000000000000000000bb",
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: argumentsWithOverride,
        name: "rateloop_quote_question",
      }),
    /does not match the scoped MCP agent wallet/i,
  );
  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: argumentsWithOverride,
        name: "rateloop_ask_humans",
      }),
    /does not match the scoped MCP agent wallet/i,
  );
});

test("rateloop_ask_humans rejects bundle members outside the agent category allowlist", async () => {
  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: RESTRICTED_AGENT,
        arguments: askArguments({
          questions: [
            {
              categoryId: "5",
              contextUrl: "https://example.com/context",
              description: "Should this autonomous action continue?",
              tags: ["agents"],
              title: "Agent action approval",
            },
            {
              categoryId: "6",
              contextUrl: "https://example.com/alternate",
              description: "Should this alternate action continue?",
              tags: ["agents"],
              title: "Agent action approval follow-up",
            },
          ],
          question: undefined,
        }),
        name: "rateloop_ask_humans",
      }),
    /not allowed to ask in category 6/i,
  );
});

test("rateloop_ask_humans rejects feedback bonuses on bundles", async () => {
  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: askArguments({
          feedbackBonus: { amount: "1000000" },
          questions: [
            {
              categoryId: "5",
              contextUrl: "https://example.com/context",
              description: "Should this autonomous action continue?",
              tags: ["agents"],
              title: "Agent action approval",
            },
            {
              categoryId: "5",
              contextUrl: "https://example.com/alternate",
              description: "Should this alternate action continue?",
              tags: ["agents"],
              title: "Agent action approval follow-up",
            },
          ],
          question: undefined,
        }),
        name: "rateloop_ask_humans",
      }),
    /single-question asks only/i,
  );
});

test("rateloop_ask_humans registers webhooks and enqueues the awaiting-signature callback", async () => {
  const registered: unknown[] = [];
  const enqueued: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async params => ({
      body: {
        operationKey: OPERATION_KEY,
        status: "awaiting_wallet_signature",
        wallet: { address: params.walletAddress, fundingMode: "agent_wallet" },
      },
      status: 202,
    }),
    ...quoteOverrides(),
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      webhookEvents: ["question.submitting"],
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    webhook: { events: string[]; registered: boolean; signatureHeaders: string[] };
  };

  assert.equal(body.webhook.registered, true);
  assert.deepEqual(body.webhook.events, ["question.submitting"]);
  assert.ok(body.webhook.signatureHeaders.includes("x-rateloop-callback-signature"));
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0], {
    agentId: AGENT.id,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitting"],
    secret: "webhook-secret",
  });
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    agentId: AGENT.id,
    eventId: `${OPERATION_KEY}:question.submitting`,
    eventType: "question.submitting",
    payload: {
      chainId: 480,
      clientRequestId: "ask-bookkeeping-failure",
      contentId: null,
      contentIds: [],
      error: null,
      eventType: "question.submitting",
      operationKey: OPERATION_KEY,
      publicUrl: null,
      status: "awaiting_wallet_signature",
    },
  });
});

test("rateloop_ask_humans registers the default lifecycle webhook events", async () => {
  const registered: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    enqueueAgentCallbackEvent: async () => [],
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        operationKey: OPERATION_KEY,
        status: "awaiting_wallet_signature",
      },
      status: 202,
    }),
    ...quoteOverrides(),
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });

  assert.deepEqual(registered[0], {
    agentId: AGENT.id,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: [
      "question.submitting",
      "question.submitted",
      "question.open",
      "question.settling",
      "question.failed",
      "question.settled",
      "feedback.unlocked",
      "bounty.low_response",
    ],
    secret: "webhook-secret",
  });
});

test("rateloop_confirm_ask_transactions marks budget submitted and enqueues submitted callbacks", async () => {
  const enqueued: unknown[] = [];
  const reservationUpdates: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 480,
        clientRequestId: "ask-bookkeeping-failure",
        contentId: "123",
        contentIds: ["123"],
        operationKey: OPERATION_KEY,
        status: "submitted",
      },
      status: 200,
    }),
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    updateMcpBudgetReservation: async params => {
      reservationUpdates.push(params);
      return null;
    },
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      operationKey: OPERATION_KEY,
      transactionHashes: [`0x${"4".repeat(64)}`],
    },
    name: "rateloop_confirm_ask_transactions",
  });

  const body = result as unknown as { contentId: string; publicUrl: string; status: string };
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "123");
  assert.equal(body.publicUrl, "http://localhost:3000/rate?content=123");
  assert.deepEqual(reservationUpdates, [{ contentId: "123", operationKey: OPERATION_KEY, status: "submitted" }]);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    agentId: AGENT.id,
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    payload: {
      chainId: 480,
      clientRequestId: "ask-bookkeeping-failure",
      contentId: "123",
      contentIds: ["123"],
      error: null,
      eventType: "question.submitted",
      operationKey: OPERATION_KEY,
      publicUrl: "http://localhost:3000/rate?content=123",
      status: "submitted",
    },
  });
});

test("rateloop_confirm_ask_transactions returns a pending feedback bonus transaction plan", async () => {
  __setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 480,
        clientRequestId: "ask-bookkeeping-failure",
        contentId: "123",
        contentIds: ["123"],
        feedbackBonus: {
          amount: "2000000",
          enabled: true,
          status: "awaiting_wallet_signature",
        },
        operationKey: OPERATION_KEY,
        status: "submitted",
      },
      status: 200,
    }),
    enqueueAgentCallbackEvent: async () => [],
    prepareFeedbackBonusQuestionSubmissionRequest: async () => ({
      body: {
        feedbackBonus: {
          amount: "2000000",
          contentId: "123",
          roundId: "1",
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: [{ id: "approve-feedback-bonus-usdc" }, { id: "create-feedback-bonus-pool" }],
            requiresOrderedExecution: true,
          },
        },
        operationKey: OPERATION_KEY,
      },
      status: 202,
    }),
    updateMcpBudgetReservation: async () => null,
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      operationKey: OPERATION_KEY,
      transactionHashes: [`0x${"4".repeat(64)}`],
    },
    name: "rateloop_confirm_ask_transactions",
  });
  const body = result as unknown as {
    feedbackBonus: { confirmTool: string; transactionPlan: { calls: unknown[] } };
  };

  assert.equal(body.feedbackBonus.confirmTool, "rateloop_confirm_feedback_bonus_transactions");
  assert.equal(body.feedbackBonus.transactionPlan.calls.length, 2);
});

test("rateloop_confirm_feedback_bonus_transactions confirms the funded bonus", async () => {
  const confirmed: unknown[] = [];
  __setMcpToolTestOverridesForTests({
    confirmFeedbackBonusQuestionSubmissionRequest: async params => {
      confirmed.push(params);
      return {
        body: {
          feedbackBonus: {
            enabled: true,
            poolId: "55",
            status: "funded",
          },
          operationKey: params.operationKey,
          status: "submitted",
        },
        status: 200,
      };
    },
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      operationKey: OPERATION_KEY,
      transactionHashes: [`0x${"5".repeat(64)}`],
    },
    name: "rateloop_confirm_feedback_bonus_transactions",
  });
  const body = result as unknown as { feedbackBonus: { poolId: string; status: string } };

  assert.equal(body.feedbackBonus.status, "funded");
  assert.equal(body.feedbackBonus.poolId, "55");
  assert.deepEqual(confirmed, [{ operationKey: OPERATION_KEY, transactionHashes: [`0x${"5".repeat(64)}`] }]);
});

test("rateloop_ask_humans rejects unsafe webhook URLs before reservation or wallet planning", async () => {
  let prepared = false;
  let budgetReserved = false;

  __setMcpToolTestOverridesForTests({
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async () => {
      prepared = true;
      return { body: { status: "awaiting_wallet_signature" }, status: 202 };
    },
    ...quoteOverrides(),
    reserveMcpAgentBudget: async () => {
      budgetReserved = true;
      return budgetReservation();
    },
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: askArguments({
          webhookSecret: "webhook-secret",
          webhookUrl: "http://127.0.0.1:3000/rateloop",
        }),
        name: "rateloop_ask_humans",
      }),
    /webhookUrl must be a public HTTPS URL/,
  );

  assert.equal(budgetReserved, false);
  assert.equal(prepared, false);
});

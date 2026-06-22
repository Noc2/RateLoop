import type { McpAgentAuth } from "./auth";
import { __setMcpToolTestOverridesForTests, callPublicRateLoopMcpTool, callRateLoopMcpTool } from "./tools";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, mock, test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  enqueueAgentCallbackEvent,
  publicWebhookAgentId,
  upsertAgentCallbackSubscription,
} from "~~/lib/agent-callbacks";
import { __setSignedActionVerificationClientForTests } from "~~/lib/auth/signedActions";
import { CONFIDENTIALITY_TERMS_VERSION } from "~~/lib/confidentiality/context";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
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
const RATING_VOTING_ENGINE_ADDRESS = deployedContracts[31337].RoundVotingEngine.address;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const ONE_PIXEL_PNG_SHA256 = createHash("sha256").update(ONE_PIXEL_PNG).digest("hex");

function askArguments(overrides: Record<string, unknown> = {}) {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
      bountyStartBy: "1762000000",
      bountyWindowSeconds: "1200",
      feedbackWindowSeconds: "1200",
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

async function insertX402SubmissionRecord(params: {
  agentId?: string;
  clientRequestId?: string;
  contentId?: string | null;
  mode?: string;
  operationKey?: `0x${string}`;
  pendingCallback?: {
    agentId: string;
    callbackUrl: string;
    eventTypes: string[];
    secret: string;
  };
  status?: string;
}) {
  const now = new Date();
  const operationKey = params.operationKey ?? OPERATION_KEY;
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
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      operationKey,
      params.clientRequestId ?? "wallet:test-public-operation",
      "payload-hash",
      480,
      AGENT.walletAddress,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      params.status ?? "awaiting_wallet_signature",
      params.contentId ?? null,
      JSON.stringify({
        ...(params.agentId ? { agentId: params.agentId } : {}),
        mode: params.mode,
        operationKey,
        ...(params.pendingCallback ? { pendingCallback: params.pendingCallback } : {}),
        walletAddress: AGENT.walletAddress,
      }),
      now,
      now,
    ],
  });
}

async function insertBudgetReservation(params: { agentId?: string; operationKey?: `0x${string}` } = {}) {
  const now = new Date();
  await dbClient.execute({
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      params.operationKey ?? OPERATION_KEY,
      params.agentId ?? AGENT.id,
      "ask-bookkeeping-failure",
      "payload-hash",
      480,
      "5",
      "1000000",
      "reserved",
      now,
      now,
    ],
  });
}

async function insertGatedContextAttachments(contentId = RATING_CONTENT_ID) {
  const now = new Date("2026-06-11T10:00:00.000Z");
  const contentRegistryAddress = deployedContracts[31337].ContentRegistry.address.toLowerCase();
  const deploymentKey = `31337:${contentRegistryAddress}`;
  await dbClient.execute({
    sql: `
      INSERT INTO question_confidentiality (
        deployment_key,
        chain_id,
        content_registry_address,
        content_id,
        gated,
        bond_asset,
        bond_amount,
        disclosure_policy,
        published_at,
        question_metadata_hash,
        content_hash,
        details_hash,
        media_tuple_hash,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (deployment_key, content_id) DO UPDATE SET
        gated = excluded.gated,
        bond_asset = excluded.bond_asset,
        bond_amount = excluded.bond_amount,
        disclosure_policy = excluded.disclosure_policy,
        published_at = excluded.published_at,
        question_metadata_hash = excluded.question_metadata_hash,
        content_hash = excluded.content_hash,
        details_hash = excluded.details_hash,
        media_tuple_hash = excluded.media_tuple_hash,
        updated_at = excluded.updated_at
    `,
    args: [
      deploymentKey,
      31337,
      contentRegistryAddress,
      contentId,
      true,
      "USDC",
      "0",
      "after_settlement",
      null,
      `0x${"4".repeat(64)}`,
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
      null,
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `
      INSERT INTO question_details (
        id,
        deployment_key,
        chain_id,
        content_registry_address,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        client_request_id,
        content_id,
        size_bytes,
        sha256,
        normalized_text,
        status,
        moderation_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "det_mcpcontextdetail01",
      deploymentKey,
      31337,
      contentRegistryAddress,
      "wallet",
      AGENT.walletAddress,
      null,
      "mcp-gated-context",
      contentId,
      32,
      "7".repeat(64),
      "Private hosted details",
      "approved",
      "approved",
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `
      INSERT INTO question_image_attachments (
        id,
        deployment_key,
        chain_id,
        content_registry_address,
        uploader_kind,
        owner_wallet_address,
        agent_id,
        client_request_id,
        content_id,
        original_filename,
        mime_type,
        size_bytes,
        sha256,
        status,
        moderation_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "att_mcpcontextimage01",
      deploymentKey,
      31337,
      contentRegistryAddress,
      "wallet",
      AGENT.walletAddress,
      null,
      "mcp-gated-context",
      contentId,
      "mockup.webp",
      "image/webp",
      64,
      "8".repeat(64),
      "approved",
      "approved",
      now,
      now,
    ],
  });
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
        lrepAddress: "0x0000000000000000000000000000000000000004",
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

function ratingCommitReceiptLog(address = RATING_VOTING_ENGINE_ADDRESS) {
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

  return {
    address,
    data,
    topics,
  };
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setSignedActionVerificationClientForTests({ verifyMessage });
  __setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
});

afterEach(() => {
  mock.reset();
  __setDatabaseResourcesForTests(null);
  __setSignedActionVerificationClientForTests(null);
  __setUrlSafetyDnsResolversForTests(null);
  __setMcpToolTestOverridesForTests(null);
});

test("public rateloop_list_audience_options returns the shared targeting taxonomy", async () => {
  const result = await callPublicRateLoopMcpTool({
    arguments: {},
    name: "rateloop_list_audience_options",
  });
  const body = result as {
    caveat: string;
    targetAudience: {
      languages: string[];
      roles: string[];
    };
  };

  assert.equal(body.caveat, "unverified_self_report");
  assert.equal(body.targetAudience.roles.includes("engineer"), true);
  assert.equal(body.targetAudience.roles.includes("developer"), false);
  assert.equal(body.targetAudience.languages.includes("de"), true);
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
    arguments: askArguments({ paymentMode: "wallet_calls" }),
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

test("rateloop_ask_humans dry-run validates without reserving budget or preparing transactions", async () => {
  const forbidden = async () => {
    throw new Error("dry run should not create side effects");
  };

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    prepareAgentWalletQuestionSubmissionRequest: forbidden as never,
    prepareNativeX402QuestionSubmissionRequest: forbidden as never,
    reserveMcpAgentBudget: forbidden as never,
    upsertAgentCallbackSubscription: forbidden as never,
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      dryRun: true,
      webhookEvents: ["question.submitted"],
      webhookSecret: "secret",
      webhookUrl: "https://example.com/callback",
    }),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    dryRun: boolean;
    executionMode: string;
    operationKey: string;
    paymentRequired: boolean;
    result: {
      answer: string;
      cohortSummary: { simulatedRevealedAnswers: number };
      targetAudienceMatch: unknown;
      wait: { recoverWith: null };
    };
    status: string;
    transactionPlan: unknown;
    wallet: { fundingMode: string };
    warnings: string[];
    x402AuthorizationRequest: unknown;
  };

  assert.equal(body.status, "dry_run");
  assert.equal(body.dryRun, true);
  assert.equal(body.executionMode, "dry_run");
  assert.equal(body.paymentRequired, false);
  assert.equal(body.transactionPlan, null);
  assert.equal(body.x402AuthorizationRequest, null);
  assert.equal(body.wallet.fundingMode, "dry_run");
  assert.equal(body.result.answer, "dry_run_complete");
  assert.equal(body.result.cohortSummary.simulatedRevealedAnswers, 3);
  assert.equal(body.result.targetAudienceMatch, null);
  assert.equal(body.result.wait.recoverWith, null);
  assert.match(body.operationKey, /^0x[a-f0-9]{64}$/);
  assert.ok(body.warnings.includes("dry_run_no_payment"));

  const status = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: { dryRun: true, operationKey: body.operationKey },
    name: "rateloop_get_question_status",
  })) as unknown as { ready: boolean; status: string };
  assert.equal(status.status, "dry_run");
  assert.equal(status.ready, true);

  const syntheticResult = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: { dryRun: true, operationKey: body.operationKey },
    name: "rateloop_get_result",
  })) as unknown as {
    answer: string;
    cohortSummary: { kind: string; simulatedRevealedAnswers: number };
    paymentRequired: boolean;
    targetAudienceMatch: unknown;
    wait: { recoverWith: null };
  };
  assert.equal(syntheticResult.answer, "dry_run_complete");
  assert.equal(syntheticResult.cohortSummary.kind, "dry_run_fixture");
  assert.equal(syntheticResult.cohortSummary.simulatedRevealedAnswers, 3);
  assert.equal(syntheticResult.paymentRequired, false);
  assert.equal(syntheticResult.targetAudienceMatch, null);
  assert.equal(syntheticResult.wait.recoverWith, null);
});

test("public rateloop_ask_humans dry-run skips permissionless transaction planning", async () => {
  const forbidden = async () => {
    throw new Error("dry run should not prepare public wallet calls");
  };

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    preparePermissionlessNativeX402QuestionSubmissionRequest: forbidden as never,
    preparePermissionlessWalletQuestionSubmissionRequest: forbidden as never,
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: askArguments({
      dryRun: true,
      walletAddress: AGENT.walletAddress,
    }),
    name: "rateloop_ask_humans",
  });

  const body = result as {
    dryRun: boolean;
    executionMode: string;
    managedBudget: unknown;
    paymentRequired: boolean;
    status: string;
    transactionPlan: unknown;
    walletPolicyRequired: boolean;
  };

  assert.equal(body.status, "dry_run");
  assert.equal(body.dryRun, true);
  assert.equal(body.executionMode, "dry_run");
  assert.equal(body.paymentRequired, false);
  assert.equal(body.transactionPlan, null);
  assert.equal(body.managedBudget, null);
  assert.equal(body.walletPolicyRequired, false);
});

test("public rateloop_ask_humans returns a wallet-signed webhook challenge before side effects", async () => {
  const account = privateKeyToAccount(`0x${"2".repeat(64)}`);
  const forbidden = async () => {
    throw new Error("unsigned public webhook registration should not prepare or register");
  };

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    enqueueAgentCallbackEvent: forbidden as never,
    preparePermissionlessNativeX402QuestionSubmissionRequest: forbidden as never,
    preparePermissionlessWalletQuestionSubmissionRequest: forbidden as never,
    upsertAgentCallbackSubscription: forbidden as never,
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: askArguments({
      walletAddress: account.address,
      webhookEvents: ["question.submitting"],
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });
  const body = result as {
    message: string;
    nextAction: string;
    operationKey: string;
    status: string;
    transactionPlan: unknown;
    webhook: { events: string[]; registered: boolean; signatureRequired: boolean };
  };

  assert.equal(body.status, "webhook_signature_required");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.transactionPlan, null);
  assert.match(body.message, /RateLoop public webhook/);
  assert.match(body.nextAction, /omit webhookChallengeId\/webhookSignature/);
  assert.equal(body.webhook.registered, false);
  assert.equal(body.webhook.signatureRequired, true);
  assert.deepEqual(body.webhook.events, ["question.submitting"]);
});

test("public rateloop_ask_humans stores signed webhook registration until payment confirmation", async () => {
  const account = privateKeyToAccount(`0x${"3".repeat(64)}`);
  const registered: unknown[] = [];
  const enqueued: unknown[] = [];
  const prepared: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    preparePermissionlessWalletQuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          clientRequestId: params.payload.clientRequestId,
          operationKey: OPERATION_KEY,
          payerAddress: params.walletAddress,
          status: "awaiting_wallet_signature",
          wallet: { address: params.walletAddress, fundingMode: "permissionless_wallet" },
        },
        status: 202,
      };
    },
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  const unsigned = (await callPublicRateLoopMcpTool({
    arguments: askArguments({
      paymentMode: "wallet_calls",
      walletAddress: account.address,
      webhookEvents: ["question.submitting"],
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  })) as { challengeId: string; message: string };
  const signature = await account.signMessage({ message: unsigned.message });

  const result = await callPublicRateLoopMcpTool({
    arguments: askArguments({
      paymentMode: "wallet_calls",
      walletAddress: account.address,
      webhookChallengeId: unsigned.challengeId,
      webhookEvents: ["question.submitting"],
      webhookSecret: "webhook-secret",
      webhookSignature: signature,
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });
  const body = result as {
    status: string;
    webhook: { events: string[]; registered: boolean; signatureHeaders: string[] };
  };
  const callbackAgentId = publicWebhookAgentId({ chainId: 480, walletAddress: account.address });

  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.webhook.registered, false);
  assert.deepEqual(body.webhook.events, ["question.submitting"]);
  assert.ok(body.webhook.signatureHeaders.includes("x-rateloop-callback-signature"));
  assert.equal(prepared.length, 1);
  assert.deepEqual((prepared[0] as { pendingCallback?: unknown }).pendingCallback, {
    agentId: callbackAgentId,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitting"],
    secret: "webhook-secret",
  });
  assert.equal(registered.length, 0);
  assert.equal(enqueued.length, 0);
});

test("rateloop_ask_humans rejects unsupported sync and async modes", async () => {
  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: askArguments({ mode: "sync" }),
        name: "rateloop_ask_humans",
      }),
    /mode is not supported/,
  );
  await assert.rejects(
    () =>
      callPublicRateLoopMcpTool({
        arguments: askArguments({
          mode: "async",
          walletAddress: AGENT.walletAddress,
        }),
        name: "rateloop_ask_humans",
      }),
    /mode is not supported/,
  );
});

test("managed agents can upload generated image bytes and get a question imageUrl", async () => {
  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`,
      filename: "generated-mockup.png",
      walletAddress: AGENT.walletAddress,
    },
    name: "rateloop_upload_image",
    requestUrl: "https://www.rateloop.ai/api/mcp",
  });
  const body = result as {
    attachmentId: string;
    imageUrl: string;
    nextAction: string;
    status: string;
  };

  assert.equal(body.status, "approved");
  assert.match(body.attachmentId, /^att_[A-Za-z0-9_-]{16,80}$/);
  assert.match(body.imageUrl, /^https:\/\/www\.rateloop\.ai\/api\/attachments\/images\/att_/);
  assert.match(body.nextAction, /question\.imageUrls/);
});

test("managed image upload explains byte-count mismatches", async () => {
  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: {
          dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`,
          filename: "generated-mockup.png",
          sizeBytes: ONE_PIXEL_PNG.length + 1,
          walletAddress: AGENT.walletAddress,
        },
        name: "rateloop_upload_image",
        requestUrl: "https://www.rateloop.ai/api/mcp",
      }),
    /exact image buffer in the same request process/,
  );
});

test("public MCP image upload uses a wallet-signed upload challenge", async () => {
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const attachmentId = "att_mcppublicupload01";
  const prepared = (await callPublicRateLoopMcpTool({
    arguments: {
      attachmentId,
      filename: "generated-mockup.png",
      mimeType: "image/png",
      sha256: ONE_PIXEL_PNG_SHA256,
      sizeBytes: ONE_PIXEL_PNG.length,
      walletAddress: account.address,
    },
    name: "rateloop_prepare_image_upload",
    requestUrl: "https://www.rateloop.ai/api/mcp/public",
  })) as {
    challengeId: string;
    message: string;
    signatureRequired: boolean;
  };

  const signature = await account.signMessage({ message: prepared.message });
  const result = await callPublicRateLoopMcpTool({
    arguments: {
      attachmentId,
      challengeId: prepared.challengeId,
      filename: "generated-mockup.png",
      imageBase64: ONE_PIXEL_PNG.toString("base64"),
      mimeType: "image/png",
      signature,
      walletAddress: account.address,
    },
    name: "rateloop_upload_image",
    requestUrl: "https://www.rateloop.ai/api/mcp/public",
  });
  const body = result as {
    imageUrl: string;
    status: string;
  };

  assert.equal(prepared.signatureRequired, true);
  assert.equal(body.status, "approved");
  assert.match(
    body.imageUrl,
    new RegExp(`^https://www\\.rateloop\\.ai/api/attachments/images/${attachmentId}\\.webp#sha256=0x[a-f0-9]{64}$`),
  );
});

test("public MCP image upload rejects unsigned image bytes", async () => {
  await assert.rejects(
    () =>
      callPublicRateLoopMcpTool({
        arguments: {
          filename: "generated-mockup.png",
          imageBase64: ONE_PIXEL_PNG.toString("base64"),
          mimeType: "image/png",
          walletAddress: AGENT.walletAddress,
        },
        name: "rateloop_upload_image",
      }),
    /challengeId and signature are required/,
  );
});

test("public operation-key lookups allow only permissionless ask records", async () => {
  await insertX402SubmissionRecord({ mode: "permissionless-wallet-plan" });

  const result = await callPublicRateLoopMcpTool({
    arguments: { operationKey: OPERATION_KEY },
    name: "rateloop_get_question_status",
  });
  const body = result as unknown as { operationKey: string; status: string };

  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.status, "awaiting_wallet_signature");
});

test("public operation-key lookups reject managed ask records", async () => {
  await insertX402SubmissionRecord({
    agentId: AGENT.id,
    clientRequestId: "mcp:managed-client-request",
    mode: "agent-wallet-plan",
  });

  await assert.rejects(
    () =>
      callPublicRateLoopMcpTool({
        arguments: { operationKey: OPERATION_KEY },
        name: "rateloop_get_question_status",
      }),
    /public permissionless wallet flow/,
  );
});

test("managed operation lookups reject malformed chain ids", async () => {
  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: {
          chainId: "480abc",
          clientRequestId: "mcp:managed-client-request",
        },
        name: "rateloop_get_question_status",
      }),
    /Provide operationKey or both chainId and clientRequestId/,
  );
});

test("public operation-key confirms reject records with managed reservations", async () => {
  await insertX402SubmissionRecord({ mode: "permissionless-wallet-plan" });
  await insertBudgetReservation();

  await assert.rejects(
    () =>
      callPublicRateLoopMcpTool({
        arguments: {
          operationKey: OPERATION_KEY,
          transactionHashes: [`0x${"4".repeat(64)}`],
        },
        name: "rateloop_confirm_ask_transactions",
      }),
    /public permissionless wallet flow/,
  );
});

test("managed operation-key lookups still allow same-agent managed records", async () => {
  await insertX402SubmissionRecord({
    agentId: AGENT.id,
    clientRequestId: "mcp:managed-client-request",
    mode: "agent-wallet-plan",
  });
  await insertBudgetReservation();

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: { operationKey: OPERATION_KEY },
    name: "rateloop_get_question_status",
  });
  const body = result as unknown as { operationKey: string; status: string };

  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.status, "awaiting_wallet_signature");
});

test("rateloop_get_rating_context returns local encrypted commit instructions and open-round plan", async () => {
  await insertGatedContextAttachments();
  __setMcpToolTestOverridesForTests({
    getContentById: async () =>
      ratingContent({
        confidentiality: {
          bondAmount: "0",
          bondAsset: "LREP",
          disclosurePolicy: "after_settlement",
          publishedAt: null,
          visibility: "gated",
        },
        contextAccess: "gated",
        contextVisibility: "gated",
        description: "",
      }),
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
    content: {
      contextAccess: string;
      gatedContext: {
        acceptTermsTool: string;
        fetch: {
          request: { cookieHeader: string | null; cookieHeaderFrom: string | null; query: { address: string } };
          urls: Array<{ kind: string; resourceId: string; url: string }>;
        };
        status: string;
        termsAccepted: boolean;
      } | null;
    };
    openRoundTransactionPlan: { calls: Array<{ data: string; functionName: string; phase: string }> };
    privacy: { inputMode: string };
    ratingInputMode: string;
    status: string;
  };

  assert.equal(body.status, "open_round_required");
  assert.equal(body.content.contextAccess, "gated");
  assert.equal(body.content.gatedContext?.acceptTermsTool, "rateloop_accept_confidentiality_terms");
  assert.equal(body.content.gatedContext?.status, "terms_required");
  assert.equal(body.content.gatedContext?.termsAccepted, false);
  assert.equal(body.content.gatedContext?.fetch.request.cookieHeader, null);
  assert.equal(
    body.content.gatedContext?.fetch.request.cookieHeaderFrom,
    "rateloop_accept_confidentiality_terms.signedReadSession",
  );
  assert.deepEqual(
    body.content.gatedContext?.fetch.urls.map(url => `${url.kind}:${url.resourceId}`),
    ["details:det_mcpcontextdetail01", "image:att_mcpcontextimage01"],
  );
  assert.match(
    body.content.gatedContext?.fetch.urls[0]?.url ?? "",
    /^https:\/\/www\.rateloop\.ai\/api\/attachments\/details\/det_mcpcontextdetail01\?address=0x00000000000000000000000000000000000000aa$/,
  );
  assert.equal(body.ratingInputMode, "local_encrypted_commit");
  assert.equal(body.privacy.inputMode, "local_encrypted_commit");
  assert.equal(body.openRoundTransactionPlan.calls[0]?.functionName, "openRound");
  assert.equal(body.openRoundTransactionPlan.calls[0]?.phase, "open_round");
  assert.match(body.openRoundTransactionPlan.calls[0]?.data ?? "", /^0x/);
});

test("rateloop_accept_confidentiality_terms records signed acceptance and returns gated fetch auth", async () => {
  const account = privateKeyToAccount(`0x${"3".repeat(64)}`);
  await insertGatedContextAttachments();
  __setMcpToolTestOverridesForTests({
    getContentById: async () =>
      ratingContent({
        contentHash: `0x${"1".repeat(64)}`,
        contextAccess: "gated",
        contextVisibility: "gated",
        detailsHash: `0x${"2".repeat(64)}`,
        questionMetadataHash: `0x${"4".repeat(64)}`,
      }),
    readRatingAllowance: async () => 0n,
    resolveRoundVoteRuntime: async () => ratingRuntime(),
  });

  const challenge = (await callPublicRateLoopMcpTool({
    arguments: {
      contentId: RATING_CONTENT_ID,
      termsVersion: CONFIDENTIALITY_TERMS_VERSION,
      walletAddress: account.address,
    },
    name: "rateloop_accept_confidentiality_terms",
  })) as {
    accepted: boolean;
    challengeId: string;
    contextAccess: string;
    message: string;
    status: string;
    wallet: { address: string };
  };
  const signature = await account.signMessage({ message: challenge.message });

  assert.equal(challenge.accepted, false);
  assert.equal(challenge.contextAccess, "gated");
  assert.equal(challenge.status, "signature_required");
  assert.equal(challenge.wallet.address, account.address);

  const result = await callPublicRateLoopMcpTool({
    arguments: {
      challengeId: challenge.challengeId,
      contentId: RATING_CONTENT_ID,
      signature,
      termsVersion: CONFIDENTIALITY_TERMS_VERSION,
      walletAddress: account.address,
    },
    name: "rateloop_accept_confidentiality_terms",
    requestUrl: "https://www.rateloop.ai/api/mcp/public",
  });
  const body = result as {
    accepted: boolean;
    gatedContext: {
      request: { cookieHeader: string | null; query: { address: string } };
      status: string;
      urls: Array<{ kind: string; resourceId: string; url: string }>;
    };
    signedReadSession: { cookieHeader: string; cookieName: string; cookieValue: string; expiresAt: string };
    status: string;
    wallet: { address: string };
  };

  assert.equal(body.accepted, true);
  assert.equal(body.status, "accepted");
  assert.equal(body.wallet.address, account.address);
  assert.equal(body.signedReadSession.cookieName, "rateloop_gated_context_read_session");
  assert.match(body.signedReadSession.cookieValue, /^[a-f0-9]{64}$/);
  assert.equal(body.gatedContext.status, "ready");
  assert.equal(body.gatedContext.request.cookieHeader, body.signedReadSession.cookieHeader);
  assert.equal(body.gatedContext.request.query.address, account.address);
  assert.deepEqual(
    body.gatedContext.urls.map(url => `${url.kind}:${url.resourceId}`),
    ["details:det_mcpcontextdetail01", "image:att_mcpcontextimage01"],
  );
  assert.match(
    body.gatedContext.urls[1]?.url ?? "",
    /^https:\/\/www\.rateloop\.ai\/api\/attachments\/images\/att_mcpcontextimage01\.webp\?address=0x[a-fA-F0-9]{40}#sha256=0x8888/,
  );

  const rows = await dbClient.execute(
    "SELECT wallet_address, content_id, terms_version FROM confidentiality_terms_acceptances",
  );
  assert.deepEqual(rows.rows, [
    {
      content_id: RATING_CONTENT_ID,
      terms_version: CONFIDENTIALITY_TERMS_VERSION,
      wallet_address: account.address.toLowerCase(),
    },
  ]);

  const context = (await callPublicRateLoopMcpTool({
    arguments: {
      contentId: RATING_CONTENT_ID,
      walletAddress: account.address,
    },
    name: "rateloop_get_rating_context",
    requestUrl: "https://www.rateloop.ai/api/mcp/public",
  })) as {
    content: {
      gatedContext: {
        fetch: { request: { cookieHeader: string | null; cookieHeaderFrom: string | null } };
        status: string;
        termsAccepted: boolean;
      };
    };
  };
  assert.equal(context.content.gatedContext.termsAccepted, true);
  assert.equal(context.content.gatedContext.status, "terms_accepted");
  assert.equal(context.content.gatedContext.fetch.request.cookieHeader, null);
  assert.equal(
    context.content.gatedContext.fetch.request.cookieHeaderFrom,
    "rateloop_accept_confidentiality_terms.signedReadSession",
  );
});

test("rateloop_get_result redacts submitter-authored text for gated private context", async () => {
  mock.method(console, "warn", () => {});
  const secretQuestion = "SECRET: unreleased product positioning prompt";
  __setMcpToolTestOverridesForTests({
    getContentById: async () =>
      ratingContent({
        contextAccess: "gated",
        contextVisibility: "gated",
        question: secretQuestion,
        title: "Public-safe prototype title",
      }),
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: {
      contentId: RATING_CONTENT_ID,
    },
    name: "rateloop_get_result",
  });
  const body = result as {
    limitations: string[];
    protocolState: { contextAccess: string; question: string };
  };

  assert.equal(body.protocolState.contextAccess, "gated");
  assert.ok(body.limitations.some(limitation => limitation.includes("gated private context")));
  assert.ok(!JSON.stringify(body).includes(secretQuestion));
  assert.match(body.protocolState.question, /RATELOOP_UNTRUSTED_DATA_BEGIN/);
});

test("rateloop_get_rating_context can use a scoped managed agent wallet", async () => {
  __setMcpToolTestOverridesForTests({
    getContentById: async () => ratingContent(),
    readRatingAllowance: async () => 0n,
    resolveRoundVoteRuntime: async () => ratingRuntime(),
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: {
      contentId: RATING_CONTENT_ID,
    },
    name: "rateloop_get_rating_context",
  });
  const body = result as { wallet: { address: string } };

  assert.equal(body.wallet.address, AGENT.walletAddress);
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
  __setMcpToolTestOverridesForTests({
    getRatingTransactionReceipt: async () =>
      ({
        logs: [ratingCommitReceiptLog()],
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

test("rateloop_confirm_rating_transactions rejects matching events from unrelated contracts", async () => {
  __setMcpToolTestOverridesForTests({
    getRatingTransactionReceipt: async () =>
      ({
        logs: [ratingCommitReceiptLog("0x0000000000000000000000000000000000000001")],
        status: "success",
      }) as never,
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: {
          commitHash: RATING_COMMIT_HASH,
          contentId: RATING_CONTENT_ID,
          roundId: RATING_ROUND_ID.toString(),
          transactionHashes: [`0x${"7".repeat(64)}`],
          walletAddress: AGENT.walletAddress,
        },
        name: "rateloop_confirm_rating_transactions",
      }),
    /No matching successful rating commit/,
  );
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
      paymentMode: "wallet_calls",
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

test("rateloop_ask_humans keeps mixed-asset feedback bonuses out of the scalar payment cap", async () => {
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
      feedbackBonus: { amount: "2000000", asset: "LREP" },
      maxPaymentAmount: "1000000",
    }),
    name: "rateloop_ask_humans",
  });
  const body = result as unknown as {
    feedbackBonus: { amount: string; asset: string };
    payment: { feedbackBonusAmount: string; feedbackBonusAsset: string; totalAmount: string };
  };

  assert.equal(body.feedbackBonus.amount, "2000000");
  assert.equal(body.feedbackBonus.asset, "LREP");
  assert.equal(body.payment.feedbackBonusAmount, "2000000");
  assert.equal(body.payment.feedbackBonusAsset, "LREP");
  assert.equal(body.payment.totalAmount, "1000000");
  assert.equal(
    (prepared[0] as { feedbackBonus?: { amount: bigint; asset: string } }).feedbackBonus?.amount,
    2_000_000n,
  );
  assert.equal((prepared[0] as { feedbackBonus?: { asset: string } }).feedbackBonus?.asset, "LREP");
  assert.equal((reserved[0] as { amount: bigint }).amount, 1_000_000n);
});

test("rateloop_ask_humans still requires cap room for same-asset feedback bonuses", async () => {
  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
  });

  await assert.rejects(
    () =>
      callRateLoopMcpTool({
        agent: AGENT,
        arguments: askArguments({
          feedbackBonus: { amount: "2000000" },
          maxPaymentAmount: "1000000",
        }),
        name: "rateloop_ask_humans",
      }),
    /Quoted payment exceeds maxPaymentAmount/,
  );
});

test("public rateloop_ask_humans dry-run reports mixed-asset bonus outside totalAmount", async () => {
  __setMcpToolTestOverridesForTests({
    ...quoteOverrides(),
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: askArguments({
      dryRun: true,
      feedbackBonus: { amount: "2000000", asset: "LREP" },
      maxPaymentAmount: "1000000",
      walletAddress: AGENT.walletAddress,
    }),
    name: "rateloop_ask_humans",
  });
  const body = result as unknown as {
    payment: { feedbackBonusAmount: string; feedbackBonusAsset: string; totalAmount: string };
  };

  assert.equal(body.payment.feedbackBonusAmount, "2000000");
  assert.equal(body.payment.feedbackBonusAsset, "LREP");
  assert.equal(body.payment.totalAmount, "1000000");
});

test("rateloop_ask_humans defaults eligible USDC asks to an EIP-3009 authorization request", async () => {
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
          paymentScheme: "eip3009_usdc_authorization",
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
    arguments: askArguments(),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    confirmTool: string;
    nextAction: string;
    paymentMode: string;
    paymentScheme: string;
    transactionPlan: null;
    wallet: { address: string; fundingMode: string };
    x402AuthorizationRequest: { authorization: { nonce: string } };
  };

  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.paymentScheme, "eip3009_usdc_authorization");
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
    arguments: askArguments({ paymentMode: "wallet_calls" }),
    name: "rateloop_ask_humans",
  });
  await callPublicRateLoopMcpTool({
    arguments: {
      ...askArguments(),
      paymentMode: "wallet_calls",
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

test("rateloop_quote_question labels LREP bounty payment metadata", async () => {
  __setMcpToolTestOverridesForTests({
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    ...quoteOverrides(),
  });

  const body = (await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      bounty: {
        ...askArguments().bounty,
        asset: "LREP",
      },
      maxPaymentAmount: "1000000",
    }),
    name: "rateloop_quote_question",
  })) as {
    payment: { amount: string; asset: string; bountyAmount: string; tokenAddress: string; totalAmount: string };
  };

  assert.equal(body.payment.asset, "LREP");
  assert.equal(body.payment.amount, "1000000");
  assert.equal(body.payment.bountyAmount, "1000000");
  assert.equal(body.payment.totalAmount, "1000000");
  assert.equal(body.payment.tokenAddress, "0x0000000000000000000000000000000000000004");
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

test("rateloop_ask_humans stores webhooks until payment confirmation", async () => {
  const registered: unknown[] = [];
  const enqueued: unknown[] = [];
  const prepared: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          operationKey: OPERATION_KEY,
          status: "awaiting_wallet_signature",
          wallet: { address: params.walletAddress, fundingMode: "agent_wallet" },
        },
        status: 202,
      };
    },
    ...quoteOverrides(),
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  const result = await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      paymentMode: "wallet_calls",
      webhookEvents: ["question.submitting"],
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });

  const body = result as unknown as {
    webhook: { events: string[]; registered: boolean; signatureHeaders: string[] };
  };

  assert.equal(body.webhook.registered, false);
  assert.deepEqual(body.webhook.events, ["question.submitting"]);
  assert.ok(body.webhook.signatureHeaders.includes("x-rateloop-callback-signature"));
  assert.equal(prepared.length, 1);
  assert.deepEqual((prepared[0] as { pendingCallback?: unknown }).pendingCallback, {
    agentId: AGENT.id,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitting"],
    secret: "webhook-secret",
  });
  assert.equal(registered.length, 0);
  assert.equal(enqueued.length, 0);
});

test("rateloop_ask_humans stores the default lifecycle webhook events", async () => {
  const registered: unknown[] = [];
  const prepared: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    enqueueAgentCallbackEvent: async () => [],
    getMcpAgentBudgetSummary: async () => managedBudgetSummary(),
    prepareAgentWalletQuestionSubmissionRequest: async params => {
      prepared.push(params);
      return {
        body: {
          operationKey: OPERATION_KEY,
          status: "awaiting_wallet_signature",
        },
        status: 202,
      };
    },
    ...quoteOverrides(),
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  await callRateLoopMcpTool({
    agent: AGENT,
    arguments: askArguments({
      paymentMode: "wallet_calls",
      webhookSecret: "webhook-secret",
      webhookUrl: "https://agent.example/rateloop",
    }),
    name: "rateloop_ask_humans",
  });

  assert.equal(registered.length, 0);
  assert.deepEqual((prepared[0] as { pendingCallback?: unknown }).pendingCallback, {
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

test("rateloop_confirm_ask_transactions activates pending webhook subscriptions after payment confirmation", async () => {
  const registered: unknown[] = [];
  const enqueued: unknown[] = [];
  const pendingCallback = {
    agentId: AGENT.id,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitting", "question.submitted"],
    secret: "webhook-secret",
  };
  await insertX402SubmissionRecord({
    agentId: AGENT.id,
    mode: "agent-wallet-plan",
    pendingCallback,
  });

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
    updateMcpBudgetReservation: async () => null,
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
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

  const body = result as unknown as { status: string; warnings: string[] };
  assert.equal(body.status, "submitted");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(registered, [pendingCallback]);
  assert.deepEqual(
    enqueued.map(event => (event as { eventType: string }).eventType),
    ["question.submitting", "question.submitted"],
  );
  assert.deepEqual(
    enqueued.map(event => (event as { agentId: string }).agentId),
    [AGENT.id, AGENT.id],
  );
});

test("public rateloop_confirm_ask_transactions enqueues wallet webhook callbacks", async () => {
  const enqueued: unknown[] = [];

  __setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 480,
        clientRequestId: "ask-public-callback",
        contentId: "123",
        contentIds: ["123"],
        operationKey: OPERATION_KEY,
        payerAddress: AGENT.walletAddress,
        status: "submitted",
      },
      status: 200,
    }),
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: {
      operationKey: OPERATION_KEY,
      transactionHashes: [`0x${"4".repeat(64)}`],
    },
    name: "rateloop_confirm_ask_transactions",
  });
  const body = result as { status: string; warnings: string[] };

  assert.equal(body.status, "submitted");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(enqueued[0], {
    agentId: publicWebhookAgentId({ chainId: 480, walletAddress: String(AGENT.walletAddress) }),
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    payload: {
      chainId: 480,
      clientRequestId: "ask-public-callback",
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

test("public rateloop_confirm_ask_transactions activates pending wallet webhook subscriptions after payment confirmation", async () => {
  const registered: unknown[] = [];
  const enqueued: unknown[] = [];
  const agentId = publicWebhookAgentId({ chainId: 480, walletAddress: String(AGENT.walletAddress) });
  const pendingCallback = {
    agentId,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitted"],
    secret: "webhook-secret",
  };
  await insertX402SubmissionRecord({
    mode: "permissionless-wallet-plan",
    pendingCallback,
  });

  __setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 480,
        clientRequestId: "ask-public-callback",
        contentId: "123",
        contentIds: ["123"],
        operationKey: OPERATION_KEY,
        payerAddress: AGENT.walletAddress,
        status: "submitted",
      },
      status: 200,
    }),
    enqueueAgentCallbackEvent: async params => {
      enqueued.push(params);
      return [];
    },
    upsertAgentCallbackSubscription: async params => {
      registered.push(params);
      return null;
    },
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: {
      operationKey: OPERATION_KEY,
      transactionHashes: [`0x${"4".repeat(64)}`],
    },
    name: "rateloop_confirm_ask_transactions",
  });
  const body = result as { status: string; warnings: string[] };

  assert.equal(body.status, "submitted");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(registered, [pendingCallback]);
  assert.deepEqual(enqueued[0], {
    agentId,
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    payload: {
      chainId: 480,
      clientRequestId: "ask-public-callback",
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

test("public rateloop_get_question_status surfaces wallet callback deliveries", async () => {
  const agentId = publicWebhookAgentId({ chainId: 480, walletAddress: String(AGENT.walletAddress) });
  await insertX402SubmissionRecord({
    mode: "permissionless-wallet-plan",
    operationKey: OPERATION_KEY,
    status: "submitted",
  });
  await upsertAgentCallbackSubscription({
    agentId,
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitted"],
    secret: "webhook-secret",
  });
  await enqueueAgentCallbackEvent({
    agentId,
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    payload: {
      chainId: 480,
      clientRequestId: "ask-public-callback",
      eventType: "question.submitted",
      operationKey: OPERATION_KEY,
      status: "submitted",
    },
  });

  const result = await callPublicRateLoopMcpTool({
    arguments: { operationKey: OPERATION_KEY },
    name: "rateloop_get_question_status",
  });
  const body = result as {
    callbackDeliveries: Array<{ callbackUrl: string; eventId: string; eventType: string; status: string }>;
    status: string;
  };

  assert.equal(body.status, "submitted");
  assert.equal(body.callbackDeliveries.length, 1);
  assert.equal(body.callbackDeliveries[0]?.callbackUrl, "https://agent.example/rateloop");
  assert.equal(body.callbackDeliveries[0]?.eventId, `${OPERATION_KEY}:question.submitted`);
  assert.equal(body.callbackDeliveries[0]?.eventType, "question.submitted");
  assert.equal(body.callbackDeliveries[0]?.status, "pending");
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

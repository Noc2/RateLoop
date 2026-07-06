import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { getAgentGeneratedImagesJsonBudgetBytes } from "~~/lib/auth/imageUploadChallenge.shared";

const env = process.env as Record<string, string | undefined>;
const originalAgents = env.RATELOOP_MCP_AGENTS;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;
const originalVercel = env.VERCEL;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;

env.DATABASE_URL = "memory:";

type AgentAsksByClientRouteModule = typeof import("./asks/by-client-request/route");
type AgentAsksByClientAuditRouteModule = typeof import("./asks/by-client-request/audit/route");
type AgentAsksConfirmRouteModule = typeof import("./asks/[operationKey]/confirm/route");
type AgentAsksAuditRouteModule = typeof import("./asks/[operationKey]/audit/route");
type AgentAsksExportRouteModule = typeof import("./asks/export/route");
type AgentAsksOperationRouteModule = typeof import("./asks/[operationKey]/route");
type AgentAsksRouteModule = typeof import("./asks/route");
type AgentHandoffCompleteFeedbackBonusRouteModule =
  typeof import("./handoffs/[handoffId]/complete-feedback-bonus/route");
type AgentHandoffCompleteRouteModule = typeof import("./handoffs/[handoffId]/complete/route");
type AgentHandoffAssetRouteModule = typeof import("./handoffs/[handoffId]/assets/[assetId]/route");
type AgentHandoffPrepareRouteModule = typeof import("./handoffs/[handoffId]/prepare/route");
type AgentHandoffRouteModule = typeof import("./handoffs/[handoffId]/route");
type AgentHandoffsRouteModule = typeof import("./handoffs/route");
type AgentHandoffsModule = typeof import("~~/lib/agent/handoffs");
type AgentQuoteRouteModule = typeof import("./quote/route");
type AgentResultsByClientRouteModule = typeof import("./results/by-client-request/route");
type AgentResultsOperationRouteModule = typeof import("./results/[operationKey]/route");
type AgentSigningIntentCompleteRouteModule = typeof import("./signing-intents/[intentId]/complete/route");
type AgentSigningIntentRouteModule = typeof import("./signing-intents/[intentId]/route");
type AgentSigningIntentPrepareRouteModule = typeof import("./signing-intents/[intentId]/prepare/route");
type AgentSigningIntentsRouteModule = typeof import("./signing-intents/route");
type AgentTemplatesRouteModule = typeof import("./templates/route");
type CallbackDeliveryModule = typeof import("~~/lib/agent-callbacks/delivery");
type CallbackEventsModule = typeof import("~~/lib/agent-callbacks/events");
type CallbackLifecycleModule = typeof import("~~/lib/agent-callbacks/lifecycle");
type CallbackRegistryModule = typeof import("~~/lib/agent-callbacks/registry");
type DbModule = typeof import("../../../lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type McpBudgetModule = typeof import("~~/lib/mcp/budget");
type McpToolsModule = typeof import("~~/lib/mcp/tools");
type UrlSafetyModule = typeof import("~~/utils/urlSafety");
type McpToolTestOverrides = NonNullable<Parameters<McpToolsModule["__setMcpToolTestOverridesForTests"]>[0]>;

const OPERATION_KEY = `0x${"1".repeat(64)}` as const;
const HANDOFF_CHAIN_ID = 8453;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const ONE_PIXEL_PNG_BASE64 = ONE_PIXEL_PNG.toString("base64");
const ONE_PIXEL_PNG_SHA256 = createHash("sha256").update(ONE_PIXEL_PNG).digest("hex");
const TRUNCATED_JPEG = Buffer.from("ffd8ffe000104a46494600010101006000600000", "hex");
const TRUNCATED_JPEG_BASE64 = TRUNCATED_JPEG.toString("base64");
const TRUNCATED_JPEG_SHA256 = createHash("sha256").update(TRUNCATED_JPEG).digest("hex");

let asksByClientRoute: AgentAsksByClientRouteModule;
let asksByClientAuditRoute: AgentAsksByClientAuditRouteModule;
let asksConfirmRoute: AgentAsksConfirmRouteModule;
let asksAuditRoute: AgentAsksAuditRouteModule;
let asksExportRoute: AgentAsksExportRouteModule;
let asksOperationRoute: AgentAsksOperationRouteModule;
let asksRoute: AgentAsksRouteModule;
let callbackDeliveryModule: CallbackDeliveryModule;
let callbackEventsModule: CallbackEventsModule;
let callbackLifecycleModule: CallbackLifecycleModule;
let callbackRegistryModule: CallbackRegistryModule;
let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let handoffCompleteFeedbackBonusRoute: AgentHandoffCompleteFeedbackBonusRouteModule;
let handoffCompleteRoute: AgentHandoffCompleteRouteModule;
let handoffAssetRoute: AgentHandoffAssetRouteModule;
let handoffPrepareRoute: AgentHandoffPrepareRouteModule;
let handoffRoute: AgentHandoffRouteModule;
let handoffsRoute: AgentHandoffsRouteModule;
let handoffsModule: AgentHandoffsModule;
let mcpBudgetModule: McpBudgetModule;
let mcpToolsModule: McpToolsModule;
let quoteRoute: AgentQuoteRouteModule;
let resultsByClientRoute: AgentResultsByClientRouteModule;
let resultsOperationRoute: AgentResultsOperationRouteModule;
let signingIntentCompleteRoute: AgentSigningIntentCompleteRouteModule;
let signingIntentRoute: AgentSigningIntentRouteModule;
let signingIntentPrepareRoute: AgentSigningIntentPrepareRouteModule;
let signingIntentsRoute: AgentSigningIntentsRouteModule;
let templatesRoute: AgentTemplatesRouteModule;
let urlSafetyModule: UrlSafetyModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function configureAgent() {
  env.RATELOOP_MCP_AGENTS = JSON.stringify([
    {
      dailyBudgetAtomic: "5000000",
      id: "route-agent",
      perAskLimitAtomic: "1000000",
      scopes: ["rateloop:ask", "rateloop:balance", "rateloop:quote", "rateloop:read"],
      token: "secret-token",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    },
  ]);
}

function makePost(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: new Headers({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
      ...headers,
    }),
    method: "POST",
  });
}

function makePublicPost(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: new Headers({
      "content-type": "application/json",
      ...headers,
    }),
    method: "POST",
  });
}

function makePublicPatch(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: new Headers({
      "content-type": "application/json",
      ...headers,
    }),
    method: "PATCH",
  });
}

function makeGet(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: new Headers({
      authorization: "Bearer secret-token",
      ...headers,
    }),
    method: "GET",
  });
}

function makePublicGet(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: new Headers(headers),
    method: "GET",
  });
}

function configureProductionAgentLinks(appUrl?: string) {
  env.NODE_ENV = "production";
  env.VERCEL = "1";
  if (appUrl) {
    env.APP_URL = appUrl;
  } else {
    delete env.APP_URL;
  }
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;
}

function questionPayload(clientRequestId: string, params: { chainId?: number } = {}) {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
    },
    chainId: params.chainId ?? 8453,
    clientRequestId,
    question: {
      categoryId: "5",
      contextUrl: "https://example.com/context",
      description: "Would this make you want to learn more?",
      tags: ["agents", "pitch"],
      title: "Pitch interest",
    },
  };
}

function handoffQuestionPayload(clientRequestId: string) {
  return {
    ...questionPayload(clientRequestId, { chainId: HANDOFF_CHAIN_ID }),
    maxPaymentAmount: "1500000",
  };
}

async function seedManagedAskAudit(params: {
  chainId?: number;
  clientRequestId: string;
  contentId?: string | null;
  operationKey?: `0x${string}`;
}) {
  const operationKey = params.operationKey ?? OPERATION_KEY;
  const chainId = params.chainId ?? 8453;
  const now = new Date("2026-04-23T12:00:00.000Z");
  const contentId = params.contentId ?? null;

  await dbModule.dbClient.execute({
    args: [
      operationKey,
      "route-agent",
      params.clientRequestId,
      "payload-hash",
      chainId,
      "5",
      "1000000",
      "submitted",
      contentId,
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

  await dbModule.dbClient.execute({
    args: [
      operationKey,
      params.clientRequestId,
      "payload-hash",
      chainId,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      contentId,
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  await dbModule.dbClient.execute({
    args: [
      operationKey,
      "route-agent",
      params.clientRequestId,
      "payload-hash",
      chainId,
      "5",
      "1000000",
      "reserved",
      now,
    ],
    sql: `
      INSERT INTO mcp_agent_ask_audit_records (
        operation_key,
        agent_id,
        client_request_id,
        payload_hash,
        chain_id,
        category_id,
        payment_amount,
        event_type,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
    `,
  });

  await dbModule.dbClient.execute({
    args: [
      operationKey,
      "route-agent",
      params.clientRequestId,
      "payload-hash",
      chainId,
      "5",
      "1000000",
      "submitted",
      "submitted",
      contentId,
      now,
    ],
    sql: `
      INSERT INTO mcp_agent_ask_audit_records (
        operation_key,
        agent_id,
        client_request_id,
        payload_hash,
        chain_id,
        category_id,
        payment_amount,
        event_type,
        status,
        content_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

function installQuoteOverrides() {
  mcpToolsModule.__setMcpToolTestOverridesForTests({
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
    resolveX402QuestionConfig: () =>
      ({
        feedbackBonusEscrowAddress: "0x0000000000000000000000000000000000000003",
        questionRewardPoolEscrowAddress: "0x0000000000000000000000000000000000000002",
        usdcAddress: "0x0000000000000000000000000000000000000001",
      }) as never,
  });
}

function installAskOverrides(overrides: McpToolTestOverrides = {}) {
  installQuoteOverrides();
  mcpToolsModule.__setMcpToolTestOverridesForTests({
    getMcpAgentBudgetSummary: async () => ({
      agentId: "route-agent",
      dailyBudgetAtomic: "5000000",
      perAskLimitAtomic: "1000000",
      remainingDailyBudgetAtomic: "4000000",
      spentTodayAtomic: "1000000",
    }),
    prepareAgentWalletQuestionSubmissionRequest: async params => ({
      body: {
        clientRequestId: "mcp:ask-http",
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
    confirmAgentWalletQuestionSubmissionRequest: async params => ({
      body: {
        contentId: "content-123",
        operationKey: params.operationKey,
        status: "submitted",
        transactionHashes: params.transactionHashes,
      },
      status: 200,
    }),
    confirmFeedbackBonusQuestionSubmissionRequest: async params => ({
      body: {
        feedbackBonus: {
          enabled: true,
          status: "funded",
          transactionHashes: params.transactionHashes,
        },
        operationKey: params.operationKey,
        status: "submitted",
      },
      status: 200,
    }),
    prepareNativeX402QuestionSubmissionRequest: async params => ({
      body: {
        clientRequestId: "mcp:ask-http",
        operationKey: OPERATION_KEY,
        payment: {
          amount: "1000000",
          asset: "USDC",
          bountyAmount: "1000000",
          decimals: 6,
          spender: "0x0000000000000000000000000000000000000002",
          tokenAddress: "0x0000000000000000000000000000000000000001",
        },
        paymentMode: "x402_authorization",
        paymentScheme: "eip3009_usdc_authorization",
        status: "awaiting_wallet_signature",
        transactionPlan: null,
        wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
        x402AuthorizationRequest: {
          authorization: {
            from: params.walletAddress,
            nonce: `0x${"3".repeat(64)}`,
            to: "0x0000000000000000000000000000000000000002",
            validAfter: "0",
            validBefore: "1762000000",
            value: "1000000",
          },
          typedData: { primaryType: "ReceiveWithAuthorization" },
        },
      },
      status: 202,
    }),
    preparePermissionlessNativeX402QuestionSubmissionRequest: async params => ({
      body: {
        chainId: params.payload.chainId,
        clientRequestId: params.payload.clientRequestId,
        operationKey: OPERATION_KEY,
        payment: {
          amount: "1000000",
          asset: "USDC",
          bountyAmount: "1000000",
          decimals: 6,
          spender: "0x0000000000000000000000000000000000000002",
          tokenAddress: "0x0000000000000000000000000000000000000001",
        },
        paymentMode: "x402_authorization",
        paymentScheme: "eip3009_usdc_authorization",
        status: "awaiting_wallet_signature",
        transactionPlan: null,
        wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
        x402AuthorizationRequest: {
          authorization: {
            from: params.walletAddress,
            nonce: `0x${"3".repeat(64)}`,
            to: "0x0000000000000000000000000000000000000002",
            validAfter: "0",
            validBefore: "1762000000",
            value: "1000000",
          },
          typedData: { primaryType: "ReceiveWithAuthorization" },
        },
      },
      status: 202,
    }),
    preparePermissionlessWalletQuestionSubmissionRequest: async params => ({
      body: {
        chainId: params.payload.chainId,
        clientRequestId: params.payload.clientRequestId,
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
        wallet: { address: params.walletAddress, fundingMode: "permissionless_wallet" },
      },
      status: 202,
    }),
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
    reserveMcpAgentBudget: async () =>
      ({
        agentId: "route-agent",
        categoryId: "5",
        chainId: 8453,
        clientRequestId: "ask-http",
        contentId: null,
        createdAt: new Date(),
        error: null,
        operationKey: OPERATION_KEY,
        paymentAmount: "1000000",
        payloadHash: "payload-hash",
        status: "reserved",
        updatedAt: new Date(),
      }) as never,
    resolveX402QuestionConfig: () =>
      ({
        feedbackBonusEscrowAddress: "0x0000000000000000000000000000000000000003",
        questionRewardPoolEscrowAddress: "0x0000000000000000000000000000000000000002",
        usdcAddress: "0x0000000000000000000000000000000000000001",
      }) as never,
    updateMcpBudgetReservation: async () => null,
    ...overrides,
  });
}

before(async () => {
  env.NODE_ENV = "development";
  configureAgent();
  dbModule = await import("../../../lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  mcpBudgetModule = await import("~~/lib/mcp/budget");
  mcpToolsModule = await import("~~/lib/mcp/tools");
  urlSafetyModule = await import("~~/utils/urlSafety");
  asksByClientAuditRoute = await import("./asks/by-client-request/audit/route");
  asksByClientRoute = await import("./asks/by-client-request/route");
  asksConfirmRoute = await import("./asks/[operationKey]/confirm/route");
  asksAuditRoute = await import("./asks/[operationKey]/audit/route");
  asksExportRoute = await import("./asks/export/route");
  asksOperationRoute = await import("./asks/[operationKey]/route");
  asksRoute = await import("./asks/route");
  callbackDeliveryModule = await import("~~/lib/agent-callbacks/delivery");
  callbackEventsModule = await import("~~/lib/agent-callbacks/events");
  callbackLifecycleModule = await import("~~/lib/agent-callbacks/lifecycle");
  callbackRegistryModule = await import("~~/lib/agent-callbacks/registry");
  handoffCompleteFeedbackBonusRoute = await import("./handoffs/[handoffId]/complete-feedback-bonus/route");
  handoffCompleteRoute = await import("./handoffs/[handoffId]/complete/route");
  handoffAssetRoute = await import("./handoffs/[handoffId]/assets/[assetId]/route");
  handoffPrepareRoute = await import("./handoffs/[handoffId]/prepare/route");
  handoffRoute = await import("./handoffs/[handoffId]/route");
  handoffsRoute = await import("./handoffs/route");
  handoffsModule = await import("~~/lib/agent/handoffs");
  quoteRoute = await import("./quote/route");
  resultsByClientRoute = await import("./results/by-client-request/route");
  resultsOperationRoute = await import("./results/[operationKey]/route");
  signingIntentCompleteRoute = await import("./signing-intents/[intentId]/complete/route");
  signingIntentRoute = await import("./signing-intents/[intentId]/route");
  signingIntentPrepareRoute = await import("./signing-intents/[intentId]/prepare/route");
  signingIntentsRoute = await import("./signing-intents/route");
  templatesRoute = await import("./templates/route");
});

beforeEach(async () => {
  env.NODE_ENV = "development";
  env.NEXT_PUBLIC_TARGET_NETWORKS = String(HANDOFF_CHAIN_ID);
  configureAgent();
  urlSafetyModule.__setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
  mcpToolsModule.__setMcpToolTestOverridesForTests(null);
  callbackLifecycleModule.__setAgentLifecycleTestOverridesForTests(null);
  handoffsModule.__setAgentAskHandoffDraftSchemaReadyForTests(null);
  handoffsModule.__resetAgentAskHandoffAssetPositionSchemaReadyForTests();
  handoffsModule.__resetAgentAskHandoffFeedbackBonusRecoverySchemaReadyForTests();
  await dbModule.dbClient.execute("DELETE FROM agent_callback_events");
  await dbModule.dbClient.execute("DELETE FROM agent_callback_subscriptions");
  await dbModule.dbClient.execute("DELETE FROM api_rate_limits");
  await dbModule.dbClient.execute("DELETE FROM api_rate_limit_maintenance");
  await dbModule.dbClient.execute("DELETE FROM mcp_agent_ask_audit_records");
  await dbModule.dbClient.execute("DELETE FROM mcp_agent_budget_reservations");
  await dbModule.dbClient.execute("DELETE FROM agent_ask_handoff_assets");
  await dbModule.dbClient.execute("DELETE FROM agent_ask_handoff_intents");
  await dbModule.dbClient.execute("DELETE FROM agent_signing_intents");
  await dbModule.dbClient.execute("DELETE FROM question_image_attachments");
  await dbModule.dbClient.execute("DELETE FROM signed_action_challenges");
  await dbModule.dbClient.execute("DELETE FROM x402_question_submissions");
});

after(() => {
  urlSafetyModule.__setUrlSafetyDnsResolversForTests(null);
  mcpToolsModule.__setMcpToolTestOverridesForTests(null);
  handoffsModule.__setAgentAskHandoffDraftSchemaReadyForTests(null);
  handoffsModule.__resetAgentAskHandoffAssetPositionSchemaReadyForTests();
  handoffsModule.__resetAgentAskHandoffFeedbackBonusRecoverySchemaReadyForTests();
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("RATELOOP_MCP_AGENTS", originalAgents);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("NEXT_PUBLIC_TARGET_NETWORKS", originalTargetNetworks);
  restoreEnv("VERCEL", originalVercel);
  restoreEnv("VERCEL_ENV", originalVercelEnv);
  restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

test("agent templates route returns public templates without bearer auth", async () => {
  const response = await templatesRoute.GET(
    new NextRequest("https://rateloop.ai/api/agent/templates", { method: "GET" }),
  );
  const body = (await response.json()) as {
    templates: Array<{ id: string; submissionPattern: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.equal(body.templates[0]?.id, "generic_rating");
  assert.equal(body.templates[0]?.submissionPattern, "single_question");
});

test("agent quote route returns a direct authenticated quote response", async () => {
  installQuoteOverrides();

  const response = await quoteRoute.POST(
    makePost("https://rateloop.ai/api/agent/quote", questionPayload("quote-http")),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "quote-http");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.deepEqual(body.resolvedCategoryIds, ["5"]);
  assert.match(String((body.legalNotice as Record<string, unknown>).termsUrl), /\/legal\/terms$/);
  assert.match(String((body.legalNotice as Record<string, unknown>).privacyUrl), /\/legal\/privacy$/);
  assert.equal((body.fastLane as Record<string, unknown>).recommendedAction, "start_small");
  assert.equal((body.fastLane as Record<string, unknown>).pricingConfidence, "high");
});

test("agent quote route returns a tokenless wallet quote response", async () => {
  installQuoteOverrides();

  const response = await quoteRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/quote", {
      ...questionPayload("quote-public"),
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "quote-public");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.walletPolicyRequired, false);
  assert.equal((body.wallet as Record<string, unknown>).address, "0x00000000000000000000000000000000000000aa");
});

test("agent quote route marks dry-run quotes without requiring payment", async () => {
  installQuoteOverrides();

  const response = await quoteRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/quote", {
      ...questionPayload("quote-public-dry-run"),
      dryRun: true,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "quote-public-dry-run");
  assert.equal(body.dryRun, true);
  assert.equal(body.executionMode, "dry_run");
  assert.equal(body.paymentRequired, false);
  assert.equal(body.walletPolicyRequired, false);
});

test("agent quote route treats malformed authorization as managed auth", async () => {
  const response = await quoteRoute.POST(
    makePublicPost(
      "https://rateloop.ai/api/agent/quote",
      {
        ...questionPayload("quote-bad-auth"),
        walletAddress: "0x00000000000000000000000000000000000000aa",
      },
      { authorization: "Token malformed" },
    ),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.code, "transport_auth_required");
});

test("agent asks route returns the wallet transaction plan response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-http"),
      maxPaymentAmount: "1500000",
      paymentMode: "wallet_calls",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal((body.transactionPlan as { calls: unknown[] }).calls.length, 1);
});

test("agent asks route returns a tokenless wallet transaction plan response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-public"),
      maxPaymentAmount: "1500000",
      paymentMode: "wallet_calls",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "ask-public");
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.match(String((body.legalNotice as Record<string, unknown>).notice), /not investment returns/i);
  assert.equal(body.walletPolicyRequired, false);
  assert.equal(body.managedBudget, null);
  assert.equal((body.transactionPlan as { calls: unknown[] }).calls.length, 1);
});

test("agent asks route returns dry-run response without preparing transactions", async () => {
  const forbidden = async () => {
    throw new Error("dry run should not create side effects");
  };
  installAskOverrides({
    prepareAgentWalletQuestionSubmissionRequest: forbidden as never,
    prepareNativeX402QuestionSubmissionRequest: forbidden as never,
    reserveMcpAgentBudget: forbidden as never,
    upsertAgentCallbackSubscription: forbidden as never,
  });

  const response = await asksRoute.POST(
    makePost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-http-dry-run"),
      dryRun: true,
      maxPaymentAmount: "1500000",
      webhookUrl: "https://example.com/callback",
      webhookSecret: "secret",
      webhookEvents: ["question.submitted"],
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "ask-http-dry-run");
  assert.equal(body.status, "dry_run");
  assert.equal(body.dryRun, true);
  assert.equal(body.executionMode, "dry_run");
  assert.equal(body.paymentRequired, false);
  assert.equal(body.transactionPlan, null);
  assert.equal(body.x402AuthorizationRequest, null);
  assert.equal((body.wallet as Record<string, unknown>).fundingMode, "dry_run");
  assert.equal((body.result as Record<string, unknown>).answer, "dry_run_complete");
});

test("agent asks route rejects oversized JSON bodies", async () => {
  const response = await asksRoute.POST(
    new NextRequest("https://rateloop.ai/api/agent/asks", {
      body: "{}",
      headers: new Headers({
        "content-length": String(getAgentGeneratedImagesJsonBudgetBytes() + 1),
        "content-type": "application/json",
      }),
      method: "POST",
    }),
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).message, "Request body is too large.");
});

test("agent signing intent routes create and prepare browser handoff asks", async () => {
  installAskOverrides();

  const createResponse = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/rateloop/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-handoff"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
        signatureMode: "browser_link",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const intentId = String(createBody.id);
  // C-1 (2026-05-22 audit): token now lives in the URL fragment so it doesn't leak via
  // Referer or proxy logs.
  const signingUrl = new URL(String(createBody.signingUrl));
  const hashParams = new URLSearchParams(signingUrl.hash.replace(/^#/, ""));
  const token = hashParams.get("token");

  assert.equal(createResponse.status, 200);
  assert.match(intentId, /^asi_/);
  assert.ok(token);
  assert.match(signingUrl.pathname, /^\/rateloop\/agent\/sign\/asi_/);
  assert.equal(signingUrl.searchParams.get("token"), null);
  assert.equal(createBody.status, "pending");

  const readResponse = await signingIntentRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/signing-intents/${intentId}`, {
      "x-rateloop-signing-intent-token": token,
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const readBody = (await readResponse.json()) as Record<string, unknown>;

  assert.equal(readResponse.status, 200);
  assert.equal(readBody.id, intentId);
  assert.equal(readBody.clientRequestId, "browser-handoff");

  const prepareResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.id, intentId);
  assert.equal(prepareBody.operationKey, OPERATION_KEY);
  assert.equal(prepareBody.status, "prepared");
  assert.equal((prepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);

  const prepareAgainResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const prepareAgainBody = (await prepareAgainResponse.json()) as Record<string, unknown>;
  assert.equal(prepareAgainResponse.status, 200);
  assert.equal(prepareAgainBody.status, "prepared");
  assert.equal((prepareAgainBody.transactionPlan as { calls: unknown[] }).calls.length, 1);

  const readAfterPrepare = await signingIntentRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/signing-intents/${intentId}`, {
      "x-rateloop-signing-intent-token": token,
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const readAfterPrepareBody = (await readAfterPrepare.json()) as Record<string, unknown>;
  assert.equal(readAfterPrepare.status, 200);
  assert.equal(readAfterPrepareBody.status, "prepared");
  assert.equal((readAfterPrepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);

  const malformedCompleteResponse = await signingIntentCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/complete`, {
      token,
      transactionHashes: ["not-a-transaction-hash"],
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const malformedCompleteBody = (await malformedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(malformedCompleteResponse.status, 400);
  assert.equal(malformedCompleteBody.message, "transactionHashes must contain at least one transaction hash.");

  const oversizedCompleteResponse = await signingIntentCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/complete`, {
      token,
      transactionHashes: Array.from({ length: 33 }, (_value, index) => `0x${index.toString(16).padStart(64, "0")}`),
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const oversizedCompleteBody = (await oversizedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(oversizedCompleteResponse.status, 400);
  assert.equal(oversizedCompleteBody.message, "transactionHashes must contain at most 32 transaction hashes.");

  const readAfterRejectedComplete = await signingIntentRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/signing-intents/${intentId}`, {
      "x-rateloop-signing-intent-token": token,
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const readAfterRejectedCompleteBody = (await readAfterRejectedComplete.json()) as Record<string, unknown>;
  assert.equal(readAfterRejectedComplete.status, 200);
  assert.equal(readAfterRejectedCompleteBody.status, "prepared");
  assert.deepEqual(readAfterRejectedCompleteBody.transactionHashes, []);
});

test("agent signing intent complete retries confirmation after a transient failure", async () => {
  let confirmCalls = 0;
  const transactionHash = `0x${"4".repeat(64)}` as const;
  installAskOverrides({
    confirmAgentWalletQuestionSubmissionRequest: async params => {
      confirmCalls += 1;
      if (confirmCalls === 1) {
        throw new Error("transient confirm failure");
      }
      return {
        body: {
          contentId: "content-123",
          operationKey: params.operationKey,
          status: "submitted",
          transactionHashes: params.transactionHashes,
        },
        status: 200,
      };
    },
  });

  const createResponse = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-handoff-confirm-retry"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
        signatureMode: "browser_link",
      },
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const intentId = String(createBody.id);
  const signingUrl = new URL(String(createBody.signingUrl));
  const token = new URLSearchParams(signingUrl.hash.replace(/^#/, "")).get("token");
  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  assert.equal(prepareResponse.status, 200);

  const failedCompleteResponse = await signingIntentCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/complete`, {
      token,
      transactionHashes: [transactionHash],
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const failedCompleteBody = (await failedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(failedCompleteResponse.status, 500);
  assert.match(String(failedCompleteBody.message), /transient confirm failure/);
  assert.equal(confirmCalls, 1);

  const readAfterFailedComplete = await signingIntentRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/signing-intents/${intentId}`, {
      "x-rateloop-signing-intent-token": token,
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const readAfterFailedCompleteBody = (await readAfterFailedComplete.json()) as Record<string, unknown>;
  assert.equal(readAfterFailedCompleteBody.status, "failed");
  assert.deepEqual(readAfterFailedCompleteBody.transactionHashes, [transactionHash]);

  const retriedCompleteResponse = await signingIntentCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/complete`, {
      token,
      transactionHashes: [transactionHash],
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const retriedCompleteBody = (await retriedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(retriedCompleteResponse.status, 200);
  assert.equal(retriedCompleteBody.status, "submitted");
  assert.deepEqual(retriedCompleteBody.transactionHashes, [transactionHash]);
  assert.equal(confirmCalls, 2);
});

test("agent signing intent route uses configured production app URL for token links", async () => {
  configureProductionAgentLinks("https://canonical.rateloop.ai/app");
  installAskOverrides();

  try {
    const createResponse = await signingIntentsRoute.POST(
      makePublicPost(
        "https://evil.example/api/agent/signing-intents",
        {
          request: {
            ...questionPayload("browser-handoff-canonical-origin"),
            maxPaymentAmount: "1500000",
            signatureMode: "browser_link",
          },
        },
        { "x-real-ip": "203.0.113.10" },
      ),
    );
    const createBody = (await createResponse.json()) as Record<string, unknown>;
    const signingUrl = new URL(String(createBody.signingUrl));

    assert.equal(createResponse.status, 200, JSON.stringify(createBody));
    assert.equal(signingUrl.origin, "https://canonical.rateloop.ai");
    assert.match(signingUrl.pathname, /^\/app\/agent\/sign\/asi_/);
    assert.ok(new URLSearchParams(signingUrl.hash.replace(/^#/, "")).get("token"));
  } finally {
    restoreEnv("APP_URL", originalAppUrl);
    restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("VERCEL", originalVercel);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
    restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
    restoreEnv("VERCEL_URL", originalVercelUrl);
  }
});

test("agent signing intent route fails closed without production app URL", async () => {
  configureProductionAgentLinks();

  try {
    const response = await signingIntentsRoute.POST(
      makePublicPost(
        "https://evil.example/api/agent/signing-intents",
        {
          request: {
            ...questionPayload("browser-handoff-missing-app-url"),
            maxPaymentAmount: "1500000",
            signatureMode: "browser_link",
          },
        },
        { "x-real-ip": "203.0.113.11" },
      ),
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 503);
    assert.equal(body.recoverWith, "configure_app_url");
    assert.match(String(body.message), /APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_PROJECT_PRODUCTION_URL is required/);
  } finally {
    restoreEnv("APP_URL", originalAppUrl);
    restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("VERCEL", originalVercel);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
    restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
    restoreEnv("VERCEL_URL", originalVercelUrl);
  }
});

test("agent signing intent accepts Feedback Bonus wallet-call funding", async () => {
  installAskOverrides();

  const response = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-feedback-bonus"),
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
        },
        maxPaymentAmount: "3000000",
        paymentMode: "wallet_calls",
        signatureMode: "browser_link",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  const signingUrl = new URL(String(body.signingUrl));

  assert.equal(response.status, 200);
  assert.match(String(body.id), /^asi_/);
  assert.match(signingUrl.pathname, /^\/agent\/sign\/asi_/);
  assert.ok(new URLSearchParams(signingUrl.hash.replace(/^#/, "")).get("token"));
});

test("agent signing intent x402 prepare forwards signed authorizations", async () => {
  let prepareCalls = 0;
  let forwardedAuthorization: unknown;
  installAskOverrides({
    preparePermissionlessNativeX402QuestionSubmissionRequest: async params => {
      prepareCalls += 1;
      forwardedAuthorization = params.paymentAuthorization;
      const payment = {
        amount: "1000000",
        asset: "USDC",
        bountyAmount: "1000000",
        decimals: 6,
        spender: "0x0000000000000000000000000000000000000002",
        tokenAddress: "0x0000000000000000000000000000000000000001",
      };
      if (!params.paymentAuthorization) {
        return {
          body: {
            chainId: params.payload.chainId,
            clientRequestId: params.payload.clientRequestId,
            operationKey: OPERATION_KEY,
            payment,
            paymentMode: "x402_authorization",
            paymentScheme: "eip3009_usdc_authorization",
            status: "awaiting_wallet_signature",
            transactionPlan: null,
            wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
            x402AuthorizationRequest: {
              authorization: {
                from: params.walletAddress,
                nonce: `0x${"3".repeat(64)}`,
                to: "0x0000000000000000000000000000000000000002",
                validAfter: "0",
                validBefore: "1762000000",
                value: "1000000",
              },
              typedData: { primaryType: "ReceiveWithAuthorization" },
            },
          },
          status: 202,
        };
      }
      return {
        body: {
          chainId: params.payload.chainId,
          clientRequestId: params.payload.clientRequestId,
          operationKey: OPERATION_KEY,
          payment,
          paymentMode: "x402_authorization",
          paymentScheme: "eip3009_usdc_authorization",
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: [{ id: "submit-x402-question", to: "0x0000000000000000000000000000000000000002" }],
            requiresOrderedExecution: true,
          },
          wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
        },
        status: 202,
      };
    },
  });

  const createResponse = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-x402"),
        maxPaymentAmount: "1500000",
        paymentMode: "eip3009_usdc_authorization",
        signatureMode: "browser_link",
      },
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const intentId = String(createBody.id);
  const signingUrl = new URL(String(createBody.signingUrl));
  const token = new URLSearchParams(signingUrl.hash.replace(/^#/, "")).get("token");
  assert.ok(token);

  const prepareResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;
  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.transactionPlan, null);
  const authorizationRequest = prepareBody.x402AuthorizationRequest as {
    authorization: { value: string };
  };
  assert.equal(authorizationRequest.authorization.value, "1000000");

  const paymentAuthorization = {
    from: "0x00000000000000000000000000000000000000aa",
    nonce: `0x${"3".repeat(64)}`,
    signature: `0x${"4".repeat(130)}`,
    to: "0x0000000000000000000000000000000000000002",
    validAfter: "0",
    validBefore: "1762000000",
    value: "1000000",
  };
  const signedPrepareResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      paymentAuthorization,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const signedPrepareBody = (await signedPrepareResponse.json()) as Record<string, unknown>;
  assert.equal(signedPrepareResponse.status, 200);
  assert.equal(prepareCalls, 2);
  assert.deepEqual(forwardedAuthorization, paymentAuthorization);
  assert.equal((signedPrepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);
});

test("agent signing intent prepare fails when MCP returns an empty transaction plan", async () => {
  installAskOverrides({
    preparePermissionlessWalletQuestionSubmissionRequest: async params => ({
      body: {
        chainId: params.payload.chainId,
        clientRequestId: params.payload.clientRequestId,
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
          calls: [],
          requiresOrderedExecution: true,
        },
        wallet: { address: params.walletAddress, fundingMode: "permissionless_wallet" },
      },
      status: 202,
    }),
  });

  const createResponse = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-empty-plan"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
        signatureMode: "browser_link",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const intentId = String(createBody.id);
  const signingUrl = new URL(String(createBody.signingUrl));
  const token = new URLSearchParams(signingUrl.hash.replace(/^#/, "")).get("token");

  const prepareResponse = await signingIntentPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/signing-intents/${intentId}/prepare`, {
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ intentId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 400);
  assert.match(String(prepareBody.message), /executable transaction plan/i);
});

test("agent signing intent route accepts ttlMs on direct ask bodies without persisting it", async () => {
  installAskOverrides();

  const response = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      ...questionPayload("direct-ttl"),
      maxPaymentAmount: "1500000",
      signatureMode: "browser_link",
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "direct-ttl");
  assert.equal((body.requestBody as Record<string, unknown>).ttlMs, undefined);
  assert.equal(new Date(String(body.expiresAt)).getTime() - new Date(String(body.createdAt)).getTime(), 300000);
});

test("agent signing intent route rejects malformed TTLs", async () => {
  installAskOverrides();

  const response = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      ...questionPayload("signing-intent-invalid-ttl"),
      maxPaymentAmount: "1500000",
      signatureMode: "browser_link",
      ttlMs: "10junk",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_arguments");
  assert.equal(body.message, "ttlMs must be a positive integer.");
});

test("agent signing intent route rejects browser callbacks", async () => {
  installAskOverrides();

  const response = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      ...questionPayload("signing-intent-webhook-secret"),
      maxPaymentAmount: "1500000",
      signatureMode: "browser_link",
      webhookSecret: "super-secret-callback-key",
      webhookUrl: "https://agent.example/callback",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_arguments");
  assert.equal(
    body.message,
    "callbacks are not supported on browser signing links; omit webhookUrl, webhookSecret, and webhookEvents.",
  );
});

test("agent ask handoff route rejects chains unavailable on this server", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...questionPayload("agent-handoff-unsupported-chain", { chainId: 999999 }),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "service_unavailable");
  assert.equal(body.retryable, true);
  assert.match(String(body.message), /Chain 999999 is not available for browser handoffs/);
  assert.match(String(body.message), /Chain 999999 is not configured for this server/);
});

test("agent ask handoff route rejects live drafts without maxPaymentAmount", async () => {
  const request = { ...handoffQuestionPayload("agent-handoff-missing-cap") };
  delete (request as { maxPaymentAmount?: unknown }).maxPaymentAmount;
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request,
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_arguments");
  assert.equal(body.message, "maxPaymentAmount is required and must be a non-negative integer string.");
});

test("agent ask handoff route uses configured production app URL for token links", async () => {
  configureProductionAgentLinks("https://canonical.rateloop.ai/app");

  try {
    const response = await handoffsRoute.POST(
      makePublicPost(
        "https://evil.example/api/agent/handoffs",
        {
          request: {
            ...handoffQuestionPayload("agent-handoff-canonical-origin"),
            maxPaymentAmount: "1500000",
          },
          ttlMs: 300000,
        },
        { "x-real-ip": "203.0.113.12" },
      ),
    );
    const body = (await response.json()) as Record<string, unknown>;
    const handoffUrl = new URL(String(body.handoffUrl));

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(handoffUrl.origin, "https://canonical.rateloop.ai");
    assert.match(handoffUrl.pathname, /^\/app\/agent\/handoff\/ahf_/);
    assert.ok(new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token"));
  } finally {
    restoreEnv("APP_URL", originalAppUrl);
    restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("VERCEL", originalVercel);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
    restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
    restoreEnv("VERCEL_URL", originalVercelUrl);
  }
});

test("agent ask handoff route rejects browser callbacks", async () => {
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-webhook-secret"),
        maxPaymentAmount: "1500000",
        webhookSecret: "super-secret-callback-key",
        webhookUrl: "https://agent.example/callback",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;

  assert.equal(createResponse.status, 400);
  assert.equal(createBody.code, "invalid_arguments");
  assert.equal(
    createBody.message,
    "callbacks are not supported on browser handoffs; omit webhookUrl, webhookSecret, and webhookEvents.",
  );
});

test("agent ask handoff prepare rejects legacy browser callbacks", async () => {
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-legacy-webhook-secret"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const token = new URLSearchParams(new URL(String(createBody.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200, JSON.stringify(createBody));
  assert.ok(token);

  const legacyBody = {
    ...handoffQuestionPayload("agent-handoff-legacy-webhook-secret"),
    maxPaymentAmount: "1500000",
    webhookSecret: "super-secret-callback-key",
    webhookUrl: "https://agent.example/callback",
  };
  await dbModule.dbClient.execute({
    args: [JSON.stringify(legacyBody), JSON.stringify(legacyBody), handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET request_body = ?, original_request_body = ? WHERE id = ?",
  });

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 400);
  assert.equal(
    prepareBody.message,
    "callbacks are not supported on browser handoffs; omit webhookUrl, webhookSecret, and webhookEvents.",
  );
});

test("agent ask handoff route stages generated image bytes behind a browser link", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-image"),
        maxPaymentAmount: "1500000",
        question: {
          categoryId: "5",
          description: "Would this make you want to learn more?",
          tags: ["agents", "pitch"],
          title: "Generated concept image",
        },
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  const handoffId = String(body.handoffId);
  const handoffUrl = new URL(String(body.handoffUrl));
  const hashParams = new URLSearchParams(handoffUrl.hash.replace(/^#/, ""));
  const token = hashParams.get("token");

  assert.equal(response.status, 200);
  assert.match(handoffId, /^ahf_/);
  assert.ok(token);
  assert.equal(body.effectiveTtlMs, 300000);
  assert.deepEqual(body.warnings, []);
  assert.equal(handoffUrl.searchParams.get("token"), null);
  assert.match(String(body.nextAction), /Save handoffId and the private handoffToken/);
  assert.match(String(body.nextAction), /share handoffUrl/);

  const readResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readBody = (await readResponse.json()) as { assets?: Array<Record<string, unknown>>; status?: string };

  assert.equal(readResponse.status, 200);
  assert.equal(readBody.status, "pending");
  assert.equal(readBody.assets?.[0]?.status, "staged");
  assert.equal(readBody.assets?.[0]?.dataUrl, undefined);

  const readWithImageDataResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}?includeImageData=true`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readWithImageDataBody = (await readWithImageDataResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
  };

  assert.equal(readWithImageDataResponse.status, 200);
  assert.equal(readWithImageDataBody.assets?.[0]?.dataUrl, `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    chainId?: number;
    status?: string;
    uploadChallenges?: Array<Record<string, unknown>>;
  };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.chainId, HANDOFF_CHAIN_ID);
  assert.equal(prepareBody.status, "awaiting_image_signatures");
  assert.equal(prepareBody.assets?.[0]?.dataUrl, undefined);
  assert.equal(prepareBody.uploadChallenges?.length, 1);
  assert.equal(prepareBody.uploadChallenges?.[0]?.assetId, readBody.assets?.[0]?.id);
  assert.match(String(prepareBody.uploadChallenges?.[0]?.challengeId), /^[a-f0-9]{32}$/);
});

test("agent ask handoff complete returns image data only when requested", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-complete-image-data"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as { handoffId?: string; handoffUrl?: string };
  const handoffId = String(body.handoffId);
  const token = new URLSearchParams(new URL(String(body.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(token);

  await dbModule.dbClient.execute({
    args: ["submitted", handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET status = ? WHERE id = ?",
  });

  const transactionHashes = [`0x${"1".repeat(64)}`];
  const completeResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeBody = (await completeResponse.json()) as { assets?: Array<Record<string, unknown>> };

  assert.equal(completeResponse.status, 200, JSON.stringify(completeBody));
  assert.equal(completeBody.assets?.[0]?.dataUrl, undefined);

  const completeWithImageDataResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      includeImageData: true,
      token,
      transactionHashes,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeWithImageDataBody = (await completeWithImageDataResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
  };

  assert.equal(completeWithImageDataResponse.status, 200, JSON.stringify(completeWithImageDataBody));
  assert.equal(completeWithImageDataBody.assets?.[0]?.dataUrl, `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);
});

test("agent ask handoff route reports clamped TTLs", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-clamped-ttl"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 7_200_000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.effectiveTtlMs, 1_800_000);
  assert.deepEqual(body.warnings, [
    "requested_ttl_clamped: requested ttlMs 7200000 exceeds the maximum 1800000; using 1800000.",
  ]);
});

test("agent ask handoff route rejects malformed TTLs", async () => {
  for (const ttlMs of ["10junk", "1.5", "NaN", 0, -1, true, [], {}]) {
    const response = await handoffsRoute.POST(
      makePublicPost("https://rateloop.ai/api/agent/handoffs", {
        request: {
          ...handoffQuestionPayload(`agent-handoff-invalid-ttl-${typeof ttlMs}`),
          maxPaymentAmount: "1500000",
        },
        ttlMs,
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400, JSON.stringify({ ttlMs, body }));
    assert.equal(body.code, "invalid_arguments");
    assert.equal(body.message, "ttlMs must be a positive integer.");
  }
});

test("agent ask handoff prepare explains how to recover an expired link", async () => {
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-expired-recovery"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  await dbModule.dbClient.execute({
    args: [new Date(Date.now() - 1_000), handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET expires_at = ? WHERE id = ?",
  });

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 410);
  assert.equal(prepareBody.message, "Handoff link has expired. Ask the AI agent to generate a new handoff link.");
});

test("agent ask handoff route stages generated image upload metadata before blob bytes arrive", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImageUploads: [
        {
          filename: "concept.png",
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-image-upload-metadata"),
        maxPaymentAmount: "1500000",
        question: {
          categoryId: "5",
          description: "Would this make you want to learn more?",
          tags: ["agents", "pitch"],
          title: "Generated concept image",
        },
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as {
    assets?: Array<Record<string, unknown>>;
    handoffId?: string;
    handoffUrl?: string;
    nextAction?: string;
  };
  const handoffId = String(body.handoffId);
  const token = new URLSearchParams(new URL(String(body.handoffUrl)).hash.replace(/^#/, "")).get("token");
  const asset = body.assets?.[0];

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(token);
  assert.equal(asset?.status, "uploading");
  assert.equal(asset?.dataUrl, undefined);
  assert.match(String(body.nextAction), /Save handoffId and the private handoffToken/);
  assert.match(String(body.nextAction), /upload each staged image/);
  assert.match(String(body.nextAction), /poll rateloop_get_handoff_status/);

  await handoffsModule.stageAgentAskHandoffAssetUpload({
    assetId: String(asset?.id),
    buffer: ONE_PIXEL_PNG,
    contentType: "image/png",
    handoffId,
  });

  const readResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readBody = (await readResponse.json()) as { assets?: Array<Record<string, unknown>>; status?: string };

  assert.equal(readResponse.status, 200);
  assert.equal(readBody.status, "pending");
  assert.equal(readBody.assets?.[0]?.status, "staged");
  assert.equal(readBody.assets?.[0]?.dataUrl, undefined);

  const readWithImageDataResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}?includeImageData=true`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readWithImageDataBody = (await readWithImageDataResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
  };

  assert.equal(readWithImageDataResponse.status, 200);
  assert.equal(readWithImageDataBody.assets?.[0]?.dataUrl, `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    status?: string;
    uploadChallenges?: Array<Record<string, unknown>>;
  };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "awaiting_image_signatures");
  assert.equal(prepareBody.assets?.[0]?.dataUrl, undefined);
  assert.equal(prepareBody.uploadChallenges?.length, 1);
  assert.equal(prepareBody.uploadChallenges?.[0]?.assetId, readBody.assets?.[0]?.id);

  const prepareWithImageDataResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      includeImageData: true,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareWithImageDataBody = (await prepareWithImageDataResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
  };

  assert.equal(prepareWithImageDataResponse.status, 200);
  assert.equal(prepareWithImageDataBody.assets?.[0]?.dataUrl, `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);
});

test("agent ask handoff route lets humans remove interrupted uploading image assets", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImageUploads: [
        {
          filename: "concept.png",
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-uploading-remove"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as {
    assets?: Array<Record<string, unknown>>;
    handoffId?: string;
    handoffUrl?: string;
  };
  const handoffId = String(body.handoffId);
  const token = new URLSearchParams(new URL(String(body.handoffUrl)).hash.replace(/^#/, "")).get("token");
  const assetId = String(body.assets?.[0]?.id);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(token);
  assert.equal(body.assets?.[0]?.status, "uploading");

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 400);
  assert.equal(prepareBody.code, "invalid_arguments");
  assert.equal(prepareBody.message, "All staged images must be uploaded before preparing the ask.");

  const statusResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const statusBody = (await statusResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    nextAction?: string;
    status?: string;
  };

  assert.equal(statusResponse.status, 200, JSON.stringify(statusBody));
  assert.equal(statusBody.status, "failed");
  assert.equal(statusBody.assets?.[0]?.status, "uploading");
  assert.match(String(statusBody.nextAction), /Image upload was interrupted/);

  const invalidActionResponse = await handoffAssetRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}/assets/${assetId}`, {
      action: "archive",
      token,
    }),
    { params: Promise.resolve({ assetId, handoffId }) },
  );
  const invalidActionBody = (await invalidActionResponse.json()) as Record<string, unknown>;

  assert.equal(invalidActionResponse.status, 400);
  assert.equal(invalidActionBody.code, "invalid_arguments");
  assert.equal(invalidActionBody.recoverWith, "fix_tool_arguments");
  assert.equal(invalidActionBody.retryable, false);
  assert.equal(invalidActionBody.status, 400);

  const removeResponse = await handoffAssetRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}/assets/${assetId}`, {
      action: "remove",
      token,
    }),
    { params: Promise.resolve({ assetId, handoffId }) },
  );
  const removeBody = (await removeResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    status?: string;
  };

  assert.equal(removeResponse.status, 200, JSON.stringify(removeBody));
  assert.equal(removeBody.status, "pending");
  assert.deepEqual(removeBody.assets, []);
});

test("agent ask handoff route applies the pending asset position migration before staging images", async () => {
  await dbModule.dbClient.execute('ALTER TABLE "agent_ask_handoff_assets" DROP COLUMN "position"');

  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImageUploads: [
        {
          filename: "concept.png",
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-missing-position-migration"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as {
    assets?: Array<Record<string, unknown>>;
    handoffId?: string;
  };

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.assets?.[0]?.filename, "concept.png");

  const rows = await dbModule.dbClient.execute({
    args: [String(body.handoffId)],
    sql: 'SELECT "position" FROM "agent_ask_handoff_assets" WHERE "handoff_id" = ?',
  });
  assert.equal(rows.rows[0]?.position, 0);
});

test("agent ask handoff route keeps multi-image upload order stable", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImageUploads: [
        {
          filename: "first.png",
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
        {
          filename: "second.png",
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-image-upload-order"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as {
    assets?: Array<Record<string, unknown>>;
    handoffId?: string;
    handoffUrl?: string;
  };
  const handoffId = String(body.handoffId);
  const token = new URLSearchParams(new URL(String(body.handoffUrl)).hash.replace(/^#/, "")).get("token");
  const [firstAsset, secondAsset] = body.assets ?? [];

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(token);
  assert.equal(firstAsset?.filename, "first.png");
  assert.equal(secondAsset?.filename, "second.png");

  const now = Date.now();
  await dbModule.dbClient.execute({
    args: [new Date(now + 60_000), String(firstAsset?.id)],
    sql: "UPDATE agent_ask_handoff_assets SET created_at = ? WHERE id = ?",
  });
  await dbModule.dbClient.execute({
    args: [new Date(now), String(secondAsset?.id)],
    sql: "UPDATE agent_ask_handoff_assets SET created_at = ? WHERE id = ?",
  });

  const readResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readBody = (await readResponse.json()) as { assets?: Array<Record<string, unknown>> };

  assert.equal(readResponse.status, 200, JSON.stringify(readBody));
  assert.deepEqual(
    readBody.assets?.map(asset => asset.filename),
    ["first.png", "second.png"],
  );
});

test("agent ask handoff route rejects corrupt generated image bytes before staging", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "truncated.jpg",
          imageBase64: TRUNCATED_JPEG_BASE64,
          mimeType: "image/jpeg",
          sha256: TRUNCATED_JPEG_SHA256,
          sizeBytes: TRUNCATED_JPEG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-corrupt-image"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.match(String(body.message), /generatedImages\[0\] is not a processable image/);
  assert.match(String(body.message), /corrupt or incomplete/);
});

test("agent ask handoff route explains generated image byte-count mismatches", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length + 1,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-image-size-mismatch"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.match(String(body.message), /sizeBytes must match the decoded image byte length/);
  assert.match(String(body.message), /exact image buffer in the same request process/);
});

test("agent ask handoff route unwraps base64-encoded image data URLs", async () => {
  const nestedDataUrl = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;
  const legacyWrappedBytes = Buffer.from(nestedDataUrl, "utf8");
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "nested-data-url.png",
          imageBase64: Buffer.from(nestedDataUrl, "utf8").toString("base64"),
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-nested-data-url"),
        maxPaymentAmount: "1500000",
        question: {
          categoryId: "5",
          description: "Would this make you want to learn more?",
          tags: ["agents", "pitch"],
          title: "Generated concept image",
        },
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  const handoffId = String(body.handoffId);
  const token = new URLSearchParams(new URL(String(body.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(response.status, 200);
  assert.ok(token);

  await dbModule.dbClient.execute({
    args: [
      legacyWrappedBytes.toString("base64"),
      createHash("sha256").update(legacyWrappedBytes).digest("hex"),
      legacyWrappedBytes.length,
      handoffId,
    ],
    sql: `
      UPDATE agent_ask_handoff_assets
      SET image_base64 = ?,
          sha256 = ?,
          size_bytes = ?
      WHERE handoff_id = ?
    `,
  });

  const readResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readBody = (await readResponse.json()) as { assets?: Array<Record<string, unknown>> };

  assert.equal(readResponse.status, 200);
  assert.equal(readBody.assets?.[0]?.dataUrl, undefined);
  assert.equal(readBody.assets?.[0]?.mimeType, "image/png");
  assert.equal(readBody.assets?.[0]?.sha256, ONE_PIXEL_PNG_SHA256);
  assert.equal(readBody.assets?.[0]?.sizeBytes, ONE_PIXEL_PNG.length);

  const readWithImageDataResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}?includeImageData=true`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readWithImageDataBody = (await readWithImageDataResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
  };

  assert.equal(readWithImageDataResponse.status, 200);
  assert.equal(readWithImageDataBody.assets?.[0]?.dataUrl, nestedDataUrl);
});

test("agent ask handoff route uploads signed generated images before preparing ask", async () => {
  let preparedPayload: unknown = null;
  installAskOverrides({
    preparePermissionlessWalletQuestionSubmissionRequest: async params => {
      preparedPayload = params.payload;
      return {
        body: {
          chainId: params.payload.chainId,
          clientRequestId: params.payload.clientRequestId,
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
          wallet: { address: params.walletAddress, fundingMode: "permissionless_wallet" },
        },
        status: 202,
      };
    },
  });

  const account = privateKeyToAccount(`0x${"6".repeat(64)}`);
  const handoffRequest = {
    ...handoffQuestionPayload("agent-handoff-upload-image"),
    maxPaymentAmount: "1500000",
    paymentMode: "wallet_calls",
    question: {
      categoryId: "5",
      description: "Would this make you want to learn more?",
      tags: ["agents", "pitch"],
      title: "Generated concept image",
    },
  };
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/rateloop/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: handoffRequest,
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  assert.equal(createResponse.status, 200, JSON.stringify(createBody));
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.match(handoffUrl.pathname, /^\/rateloop\/agent\/handoff\/ahf_/);
  assert.ok(token);

  const patchResponse = await handoffRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/rateloop/api/agent/handoffs/${handoffId}`, {
      requestBody: {
        ...handoffRequest,
        question: {
          ...handoffRequest.question,
          videoUrl: "https://www.youtube.com/watch?v=abc123",
        },
      },
      token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(patchResponse.status, 200);

  const challengeResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/rateloop/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: account.address,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const challengeBody = (await challengeResponse.json()) as {
    uploadChallenges?: Array<Record<string, unknown>>;
  };
  const challenge = challengeBody.uploadChallenges?.[0];

  assert.equal(challengeResponse.status, 200);
  assert.ok(challenge);

  const signature = await account.signMessage({ message: String(challenge.message) });
  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/rateloop/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      imageSignatures: [
        {
          assetId: challenge.assetId,
          challengeId: challenge.challengeId,
          signature,
        },
      ],
      token,
      walletAddress: account.address,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    requestBody?: { question?: { imageUrls?: string[] } };
    status?: string;
    transactionPlan?: { calls?: unknown[] };
  };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.assets?.[0]?.status, "uploaded");
  assert.match(
    String(prepareBody.assets?.[0]?.imageUrl),
    /^https:\/\/rateloop\.ai\/rateloop\/api\/attachments\/images\/att_/,
  );
  assert.equal(prepareBody.transactionPlan?.calls?.length, 1);
  const payload = preparedPayload as {
    questions: Array<{ imageUrls: string[]; videoUrl?: string }>;
  };
  assert.match(
    String(payload.questions[0]?.imageUrls[0]),
    /^https:\/\/rateloop\.ai\/rateloop\/api\/attachments\/images\/att_/,
  );
  assert.deepEqual(prepareBody.requestBody?.question?.imageUrls, payload.questions[0]?.imageUrls);
  assert.equal(payload.questions[0]?.videoUrl || undefined, undefined);
});

test("agent ask handoff route marks parent failed when signed generated image upload fails", async () => {
  const account = privateKeyToAccount(`0x${"7".repeat(64)}`);
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: {
        ...handoffQuestionPayload("agent-handoff-upload-image-fails"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const token = new URLSearchParams(new URL(String(createBody.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  await dbModule.dbClient.execute({
    args: [TRUNCATED_JPEG_BASE64, "image/jpeg", TRUNCATED_JPEG_SHA256, TRUNCATED_JPEG.length, handoffId],
    sql: `
      UPDATE agent_ask_handoff_assets
      SET image_base64 = ?,
          mime_type = ?,
          sha256 = ?,
          size_bytes = ?
      WHERE handoff_id = ?
    `,
  });

  const challengeResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: account.address,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const challengeBody = (await challengeResponse.json()) as {
    uploadChallenges?: Array<Record<string, unknown>>;
  };
  const challenge = challengeBody.uploadChallenges?.[0];

  assert.equal(challengeResponse.status, 200);
  assert.ok(challenge);

  const signature = await account.signMessage({ message: String(challenge.message) });
  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      imageSignatures: [
        {
          assetId: challenge.assetId,
          challengeId: challenge.challengeId,
          signature,
        },
      ],
      token,
      walletAddress: account.address,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 400);
  assert.match(String(prepareBody.message), /Image upload failed/);
  assert.match(String(prepareBody.message), /corrupt or incomplete/);

  const statusResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const statusBody = (await statusResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    error?: string | null;
    nextAction?: string;
    status?: string;
  };

  assert.equal(statusResponse.status, 200);
  assert.equal(statusBody.status, "failed");
  assert.match(String(statusBody.error), /Image upload failed/);
  assert.match(String(statusBody.nextAction), /Retry the image/);
  assert.equal(statusBody.assets?.[0]?.status, "failed");
  assert.match(String(statusBody.assets?.[0]?.error), /corrupt or incomplete/);

  const retryResponse = await handoffAssetRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}/assets/${statusBody.assets?.[0]?.id}`, {
      action: "retry",
      token,
    }),
    { params: Promise.resolve({ assetId: String(statusBody.assets?.[0]?.id), handoffId }) },
  );
  const retryBody = (await retryResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    status?: string;
  };
  assert.equal(retryResponse.status, 200);
  assert.equal(retryBody.status, "pending");
  assert.equal(retryBody.assets?.[0]?.status, "staged");

  await dbModule.dbClient.execute({
    args: ["failed", "still bad", handoffId],
    sql: `
      UPDATE agent_ask_handoff_assets
      SET status = ?,
          error = ?
      WHERE handoff_id = ?
    `,
  });
  await dbModule.dbClient.execute({
    args: ["failed", "still bad", handoffId],
    sql: `
      UPDATE agent_ask_handoff_intents
      SET status = ?,
          error = ?
      WHERE id = ?
    `,
  });

  const removeResponse = await handoffAssetRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}/assets/${statusBody.assets?.[0]?.id}`, {
      action: "remove",
      token,
    }),
    { params: Promise.resolve({ assetId: String(statusBody.assets?.[0]?.id), handoffId }) },
  );
  const removeBody = (await removeResponse.json()) as {
    assets?: Array<Record<string, unknown>>;
    status?: string;
  };
  assert.equal(removeResponse.status, 200);
  assert.equal(removeBody.status, "pending");
  assert.deepEqual(removeBody.assets, []);
});

test("agent ask handoff route lets stale uploading image handoffs retry prepare", async () => {
  const account = privateKeyToAccount(`0x${"8".repeat(64)}`);
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
          sha256: ONE_PIXEL_PNG_SHA256,
          sizeBytes: ONE_PIXEL_PNG.length,
        },
      ],
      request: handoffQuestionPayload("agent-handoff-stale-uploading-retry"),
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const token = new URLSearchParams(new URL(String(createBody.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  await dbModule.dbClient.execute({
    args: [new Date(Date.now() - 6 * 60_000), handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET status = 'uploading_images', updated_at = ? WHERE id = ?",
  });

  const retryResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: account.address,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const retryBody = (await retryResponse.json()) as {
    nextAction?: string;
    status?: string;
    uploadChallenges?: Array<Record<string, unknown>>;
  };

  assert.equal(retryResponse.status, 200, JSON.stringify(retryBody));
  assert.equal(retryBody.status, "awaiting_image_signatures");
  assert.match(String(retryBody.nextAction), /Sign each upload challenge/);
  assert.equal(retryBody.uploadChallenges?.length, 1);
});

test("agent ask handoff route reports a pending draft migration clearly", async () => {
  handoffsModule.__setAgentAskHandoffDraftSchemaReadyForTests(false);

  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-missing-draft-migration"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.code, "service_unavailable");
  assert.equal(body.retryable, true);
  assert.match(String(body.message), /0003_agent_handoff_drafts\.sql/);
  assert.match(String(body.message), /before creating or preparing browser handoff links/);
});

test("agent ask handoff route prepares and completes no-image wallet-call asks", async () => {
  installAskOverrides();

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-no-image"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.chainId, HANDOFF_CHAIN_ID);
  assert.equal((prepareBody.ask as Record<string, unknown>).chainId, HANDOFF_CHAIN_ID);
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.operationKey, OPERATION_KEY);
  assert.equal((prepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);

  const completeResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [`0x${"4".repeat(64)}`],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeBody = (await completeResponse.json()) as Record<string, unknown>;

  assert.equal(completeResponse.status, 200);
  assert.equal(completeBody.status, "submitted");
  assert.deepEqual(completeBody.transactionHashes, [`0x${"4".repeat(64)}`]);
});

test("agent ask handoff complete gives recovery guidance for expired prepared links", async () => {
  installAskOverrides();

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-expired-after-prepare"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(prepareResponse.status, 200);

  await dbModule.dbClient.execute({
    args: [new Date(Date.now() - 1_000), handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET expires_at = ? WHERE id = ?",
  });

  const completeResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [`0x${"4".repeat(64)}`],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeBody = (await completeResponse.json()) as Record<string, unknown>;

  assert.equal(completeResponse.status, 410);
  assert.match(String(completeBody.message), /expired after preparation/);
  assert.match(String(completeBody.message), /rateloop_confirm_ask_transactions/);
  assert.match(String(completeBody.message), /do not rebroadcast/);
});

test("agent ask handoff route retries completion with stored transaction hashes", async () => {
  let confirmCalls = 0;
  const transactionHash = `0x${"4".repeat(64)}` as const;
  installAskOverrides({
    confirmAgentWalletQuestionSubmissionRequest: async params => {
      confirmCalls += 1;
      if (confirmCalls === 1) {
        throw new Error("transient handoff confirm failure");
      }
      return {
        body: {
          contentId: "content-123",
          operationKey: params.operationKey,
          status: "submitted",
          transactionHashes: params.transactionHashes,
        },
        status: 200,
      };
    },
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-complete-retry"),
        maxPaymentAmount: "1500000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");
  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(prepareResponse.status, 200);

  const failedCompleteResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [transactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const failedCompleteBody = (await failedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(failedCompleteResponse.status, 500);
  assert.match(String(failedCompleteBody.message), /transient handoff confirm failure/);
  assert.equal(confirmCalls, 1);

  const readAfterFailedComplete = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readAfterFailedCompleteBody = (await readAfterFailedComplete.json()) as Record<string, unknown>;
  assert.equal(readAfterFailedCompleteBody.status, "failed");
  assert.deepEqual(readAfterFailedCompleteBody.transactionHashes, [transactionHash]);
  assert.match(String(readAfterFailedCompleteBody.nextAction), /stored transaction hashes/);

  const retriedCompleteResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [transactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const retriedCompleteBody = (await retriedCompleteResponse.json()) as Record<string, unknown>;
  assert.equal(retriedCompleteResponse.status, 200);
  assert.equal(retriedCompleteBody.status, "submitted");
  assert.deepEqual(retriedCompleteBody.transactionHashes, [transactionHash]);
  assert.equal(confirmCalls, 2);
});

test("agent ask handoff route blocks Feedback Bonus completion for an expired prepared handoff", async () => {
  let bonusConfirmCalls = 0;
  const bonusTransactionHash = `0x${"5".repeat(64)}` as const;
  installAskOverrides({
    confirmFeedbackBonusQuestionSubmissionRequest: async () => {
      bonusConfirmCalls += 1;
      throw new Error("feedback bonus confirm should not run");
    },
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-feedback-bonus-before-submit"),
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
        },
        maxPaymentAmount: "3500000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");
  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(prepareResponse.status, 200);

  await dbModule.dbClient.execute({
    args: [new Date(Date.now() - 1_000), handoffId],
    sql: "UPDATE agent_ask_handoff_intents SET expires_at = ? WHERE id = ?",
  });

  const bonusResponse = await handoffCompleteFeedbackBonusRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete-feedback-bonus`, {
      token,
      transactionHashes: [bonusTransactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const bonusBody = (await bonusResponse.json()) as Record<string, unknown>;
  assert.equal(bonusResponse.status, 400);
  assert.equal(bonusBody.message, "Complete this handoff before completing its Feedback Bonus.");
  assert.equal(bonusConfirmCalls, 0);
});

test("agent ask handoff route retries Feedback Bonus completion with stored bonus transaction hashes", async () => {
  let bonusConfirmCalls = 0;
  const mainTransactionHash = `0x${"4".repeat(64)}` as const;
  const bonusTransactionHash = `0x${"5".repeat(64)}` as const;
  installAskOverrides({
    confirmFeedbackBonusQuestionSubmissionRequest: async params => {
      bonusConfirmCalls += 1;
      if (bonusConfirmCalls === 1) {
        throw new Error("transient feedback bonus confirm failure");
      }
      return {
        body: {
          feedbackBonus: {
            enabled: true,
            status: "funded",
            transactionHashes: params.transactionHashes,
          },
          operationKey: params.operationKey,
          status: "submitted",
        },
        status: 200,
      };
    },
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-feedback-bonus-retry"),
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
        },
        maxPaymentAmount: "3500000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");
  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(prepareResponse.status, 200);

  const completeResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [mainTransactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(completeResponse.status, 200);

  const failedBonusResponse = await handoffCompleteFeedbackBonusRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete-feedback-bonus`, {
      token,
      transactionHashes: [bonusTransactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const failedBonusBody = (await failedBonusResponse.json()) as Record<string, unknown>;
  assert.equal(failedBonusResponse.status, 500);
  assert.match(String(failedBonusBody.message), /transient feedback bonus confirm failure/);
  assert.equal(bonusConfirmCalls, 1);

  const readAfterFailedBonus = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readAfterFailedBonusBody = (await readAfterFailedBonus.json()) as Record<string, unknown>;
  assert.equal(readAfterFailedBonusBody.status, "submitted");
  assert.equal(readAfterFailedBonusBody.feedbackBonusStatus, "failed_confirmation");
  assert.deepEqual(readAfterFailedBonusBody.feedbackBonusTransactionHashes, [bonusTransactionHash]);
  assert.match(String(readAfterFailedBonusBody.nextAction), /stored bonus transaction hashes/);

  const retriedBonusResponse = await handoffCompleteFeedbackBonusRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete-feedback-bonus`, {
      token,
      transactionHashes: [bonusTransactionHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const retriedBonusBody = (await retriedBonusResponse.json()) as Record<string, unknown>;
  assert.equal(retriedBonusResponse.status, 200);
  assert.equal(retriedBonusBody.status, "submitted");
  assert.equal(retriedBonusBody.feedbackBonusStatus, "confirmed");
  assert.deepEqual(retriedBonusBody.feedbackBonusTransactionHashes, [bonusTransactionHash]);
  assert.equal((retriedBonusBody.ask as { feedbackBonus?: { status?: string } }).feedbackBonus?.status, "funded");
  assert.equal(bonusConfirmCalls, 2);
});

test("agent ask handoff route defaults eligible USDC asks to EIP-3009 authorization", async () => {
  let prepareCalls = 0;
  let forwardedAuthorization: unknown;
  installAskOverrides({
    preparePermissionlessNativeX402QuestionSubmissionRequest: async params => {
      prepareCalls += 1;
      forwardedAuthorization = params.paymentAuthorization;
      const paymentAmount = (
        params.payload.bounty.amount + (params.feedbackBonus?.asset === "USDC" ? params.feedbackBonus.amount : 0n)
      ).toString();
      const payment = {
        amount: paymentAmount,
        asset: "USDC",
        bountyAmount: params.payload.bounty.amount.toString(),
        decimals: 6,
        spender: "0x0000000000000000000000000000000000000002",
        tokenAddress: "0x0000000000000000000000000000000000000001",
      };
      if (!params.paymentAuthorization) {
        return {
          body: {
            chainId: params.payload.chainId,
            clientRequestId: params.payload.clientRequestId,
            operationKey: OPERATION_KEY,
            payment,
            paymentMode: "x402_authorization",
            paymentScheme: "eip3009_usdc_authorization",
            status: "awaiting_wallet_signature",
            transactionPlan: null,
            wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
            x402AuthorizationRequest: {
              authorization: {
                from: params.walletAddress,
                nonce: `0x${"3".repeat(64)}`,
                to: "0x0000000000000000000000000000000000000002",
                validAfter: "0",
                validBefore: "1762000000",
                value: paymentAmount,
              },
              typedData: { primaryType: "ReceiveWithAuthorization" },
            },
          },
          status: 202,
        };
      }
      return {
        body: {
          chainId: params.payload.chainId,
          clientRequestId: params.payload.clientRequestId,
          operationKey: OPERATION_KEY,
          payment,
          paymentMode: "x402_authorization",
          paymentScheme: "eip3009_usdc_authorization",
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: [
              {
                functionName: "submitQuestionWithX402OneShotPayment",
                id: "submit-x402-one-shot-question",
                to: "0x0000000000000000000000000000000000000002",
              },
            ],
            requiresOrderedExecution: true,
          },
          wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
        },
        status: 202,
      };
    },
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-x402-default"),
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
        },
        maxPaymentAmount: "3000000",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const token = new URLSearchParams(new URL(String(createBody.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200, JSON.stringify(createBody));
  assert.equal(createBody.paymentMode, "x402_authorization");
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;
  const authorizationRequest = prepareBody.x402AuthorizationRequest as { authorization: { value: string } };

  assert.equal(prepareResponse.status, 200, JSON.stringify(prepareBody));
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.paymentMode, "x402_authorization");
  assert.equal(prepareBody.transactionPlan, null);
  assert.equal(authorizationRequest.authorization.value, "3000000");

  const statusResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const statusBody = (await statusResponse.json()) as Record<string, unknown>;
  assert.equal(statusResponse.status, 200);
  assert.match(String(statusBody.nextAction), /sign the EIP-3009 USDC authorization/);

  const retryPrepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const retryPrepareBody = (await retryPrepareResponse.json()) as Record<string, unknown>;
  const retryAuthorizationRequest = retryPrepareBody.x402AuthorizationRequest as { authorization: { value: string } };

  assert.equal(retryPrepareResponse.status, 200, JSON.stringify(retryPrepareBody));
  assert.equal(retryPrepareBody.status, "prepared");
  assert.equal(retryPrepareBody.transactionPlan, null);
  assert.equal(retryAuthorizationRequest.authorization.value, "3000000");

  const paymentAuthorization = {
    from: "0x00000000000000000000000000000000000000aa",
    nonce: `0x${"3".repeat(64)}`,
    signature: `0x${"4".repeat(130)}`,
    to: "0x0000000000000000000000000000000000000002",
    validAfter: "0",
    validBefore: "1762000000",
    value: "3000000",
  };
  const signedPrepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      paymentAuthorization,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const signedPrepareBody = (await signedPrepareResponse.json()) as Record<string, unknown>;
  const transactionPlan = signedPrepareBody.transactionPlan as { calls: Array<Record<string, unknown>> };

  assert.equal(signedPrepareResponse.status, 200, JSON.stringify(signedPrepareBody));
  assert.equal(prepareCalls, 3);
  assert.deepEqual(forwardedAuthorization, paymentAuthorization);
  assert.equal(transactionPlan.calls.length, 1);
  assert.equal(transactionPlan.calls[0]?.functionName, "submitQuestionWithX402OneShotPayment");
});

test("agent ask handoff route rejects prepare requests on the wrong chain", async () => {
  installAskOverrides();

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-chain-drift"),
        maxPaymentAmount: "1500000",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const token = new URLSearchParams(new URL(String(createBody.handoffUrl)).hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.equal(createBody.chainId, HANDOFF_CHAIN_ID);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: 999999,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 409);
  assert.match(String(prepareBody.message), /handoff is for chain 8453/);
  assert.match(String(prepareBody.message), /requested for chain 999999/);

  const statusResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const statusBody = (await statusResponse.json()) as {
    chainId?: number | null;
    requestBody?: Record<string, unknown>;
    status?: string;
  };

  assert.equal(statusResponse.status, 200);
  assert.equal(statusBody.status, "pending");
  assert.equal(statusBody.chainId, HANDOFF_CHAIN_ID);
  assert.equal(statusBody.requestBody?.chainId, HANDOFF_CHAIN_ID);
});

test("agent ask handoff route saves edited drafts before prepare", async () => {
  let preparedPayload: unknown = null;
  let preparedFeedbackBonus: unknown = null;
  installAskOverrides({
    preflightX402QuestionSubmission: async params => ({
      operation: {
        canonicalPayload: {} as never,
        operationKey: OPERATION_KEY,
        payloadHash: "payload-hash",
      },
      paymentAmount: params.payload.bounty.amount,
      resolvedCategoryIds: [5n],
      submissionKeys: [`0x${"2".repeat(64)}` as const],
    }),
    preparePermissionlessNativeX402QuestionSubmissionRequest: async params => {
      preparedPayload = params.payload;
      preparedFeedbackBonus = params.feedbackBonus;
      return {
        body: {
          chainId: params.payload.chainId,
          clientRequestId: params.payload.clientRequestId,
          operationKey: OPERATION_KEY,
          payment: {
            amount: (params.payload.bounty.amount + (params.feedbackBonus?.amount ?? 0n)).toString(),
            asset: params.payload.bounty.asset,
            bountyAmount: params.payload.bounty.amount.toString(),
            decimals: 6,
            spender: "0x0000000000000000000000000000000000000002",
            tokenAddress: "0x0000000000000000000000000000000000000001",
          },
          status: "awaiting_authorization",
          transactionPlan: null,
          wallet: { address: params.walletAddress, fundingMode: "x402_authorization" },
          x402AuthorizationRequest: {
            chainId: params.payload.chainId,
            from: params.walletAddress,
            nonce: `0x${"1".repeat(64)}`,
            to: "0x0000000000000000000000000000000000000009",
            tokenAddress: "0x0000000000000000000000000000000000000001",
            validAfter: 1,
            validBefore: 2,
            value: (params.payload.bounty.amount + (params.feedbackBonus?.amount ?? 0n)).toString(),
          },
        },
        status: 202,
      };
    },
  });

  const originalRequest = {
    ...handoffQuestionPayload("agent-handoff-editable"),
    maxPaymentAmount: "1000000",
    paymentMode: "eip3009_usdc_authorization",
  };
  const editedRequest = {
    ...originalRequest,
    bounty: {
      ...originalRequest.bounty,
      amount: "2500000",
      asset: "USDC",
      requiredVoters: "4",
    },
    feedbackBonus: {
      amount: "2000000",
      asset: "USDC",
    },
    maxPaymentAmount: "4500000",
    question: {
      ...originalRequest.question,
      description: "Edited after the agent handoff.",
      detailsHash: `0x${"a".repeat(64)}`,
      detailsUrl: "https://rateloop.ai/api/attachments/details/det_agenthandoffedit",
      tags: ["agents", "running"],
      title: "Edited pitch interest",
    },
    roundConfig: {
      questionDurationSeconds: "600",
      maxVoters: "40",
      minVoters: "4",
    },
  };

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: originalRequest,
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);
  assert.equal(createBody.draftRevision, 0);
  assert.equal(createBody.editedByUser, false);

  const patchResponse = await handoffRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      requestBody: editedRequest,
      token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const patchBody = (await patchResponse.json()) as Record<string, unknown>;
  const patchRequestBody = patchBody.requestBody as Record<string, unknown>;
  const patchOriginalRequestBody = patchBody.originalRequestBody as Record<string, unknown>;
  const patchQuestion = patchRequestBody.question as Record<string, unknown>;
  const patchOriginalQuestion = patchOriginalRequestBody.question as Record<string, unknown>;

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.status, "pending");
  assert.equal(patchBody.draftRevision, 1);
  assert.equal(patchBody.editedByUser, true);
  assert.equal(patchBody.clientRequestId, patchRequestBody.clientRequestId);
  assert.notEqual(patchRequestBody.clientRequestId, originalRequest.clientRequestId);
  assert.match(String(patchRequestBody.clientRequestId), /^agent-handoff-editable:draft:ahf_/);
  assert.equal(patchRequestBody.maxPaymentAmount, "4500000");
  assert.equal((patchRequestBody.bounty as Record<string, unknown>).asset, "USDC");
  assert.equal((patchRequestBody.feedbackBonus as Record<string, unknown>).amount, "2000000");
  assert.equal((patchRequestBody.feedbackBonus as Record<string, unknown>).asset, "USDC");
  assert.equal(patchQuestion.title, "Edited pitch interest");
  assert.equal(patchOriginalQuestion.title, "Pitch interest");

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;
  const payload = preparedPayload as {
    bounty: { amount: bigint; asset: "LREP" | "USDC"; requiredVoters: bigint };
    questions: Array<{ detailsHash: string; detailsUrl: string; tagList: string[]; title: string }>;
    roundConfig: { epochDuration: bigint; maxDuration: bigint; maxVoters: bigint; minVoters: bigint };
  };
  const feedbackBonus = preparedFeedbackBonus as { amount: bigint; asset: "USDC" };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.draftRevision, 1);
  assert.equal(prepareBody.preparedDraftRevision, 1);
  assert.equal(prepareBody.clientRequestId, patchRequestBody.clientRequestId);
  assert.equal((preparedPayload as { clientRequestId: string }).clientRequestId, patchRequestBody.clientRequestId);
  assert.equal(((prepareBody.x402AuthorizationRequest as Record<string, unknown>) ?? {}).value, "4500000");
  assert.equal(prepareBody.transactionPlan, null);
  assert.equal(payload.questions[0]?.title, "Edited pitch interest");
  assert.equal(payload.questions[0]?.detailsUrl, "https://rateloop.ai/api/attachments/details/det_agenthandoffedit");
  assert.equal(payload.questions[0]?.detailsHash, `0x${"a".repeat(64)}`);
  assert.deepEqual(payload.questions[0]?.tagList, ["agents", "running"]);
  assert.equal(payload.bounty.amount, 2_500_000n);
  assert.equal(payload.bounty.asset, "USDC");
  assert.equal(payload.bounty.requiredVoters, 4n);
  assert.equal(feedbackBonus.amount, 2_000_000n);
  assert.equal(feedbackBonus.asset, "USDC");
  assert.equal(payload.roundConfig.epochDuration, 600n);
  assert.equal(payload.roundConfig.maxDuration, 600n);
  assert.equal(payload.roundConfig.minVoters, 4n);
  assert.equal(payload.roundConfig.maxVoters, 40n);
});

test("agent ask handoff prepare failure marks the draft recoverable", async () => {
  installAskOverrides({
    preparePermissionlessNativeX402QuestionSubmissionRequest: async () => {
      const error = new Error("clientRequestId has already been used for a different question payload.") as Error & {
        status: number;
      };
      error.status = 409;
      throw error;
    },
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-conflict"),
        maxPaymentAmount: "1000000",
        paymentMode: "eip3009_usdc_authorization",
      },
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200, JSON.stringify(createBody));
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 409, JSON.stringify(prepareBody));
  assert.equal(prepareBody.message, "clientRequestId has already been used for a different question payload.");

  const readResponse = await handoffRoute.GET(
    makePublicGet(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      "x-rateloop-handoff-token": token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const readBody = (await readResponse.json()) as Record<string, unknown>;

  assert.equal(readResponse.status, 200, JSON.stringify(readBody));
  assert.equal(readBody.status, "failed");
  assert.equal(readBody.error, "clientRequestId has already been used for a different question payload.");
});

test("agent ask handoff route accepts edited mixed-asset Feedback Bonus wallet-call drafts", async () => {
  let preparedPayload: unknown = null;
  let preparedFeedbackBonus: unknown = null;
  installAskOverrides({
    preparePermissionlessNativeX402QuestionSubmissionRequest: async () => {
      throw new Error("Mixed-asset Feedback Bonus handoff drafts must not use x402 authorization.");
    },
    preparePermissionlessWalletQuestionSubmissionRequest: async params => {
      preparedPayload = params.payload;
      preparedFeedbackBonus = params.feedbackBonus;
      const sameAssetFeedbackBonusAmount =
        params.feedbackBonus?.asset === params.payload.bounty.asset ? params.feedbackBonus.amount : 0n;
      return {
        body: {
          chainId: params.payload.chainId,
          clientRequestId: params.payload.clientRequestId,
          operationKey: OPERATION_KEY,
          payment: {
            amount: (params.payload.bounty.amount + sameAssetFeedbackBonusAmount).toString(),
            asset: params.payload.bounty.asset,
            bountyAmount: params.payload.bounty.amount.toString(),
            decimals: 6,
            spender: "0x0000000000000000000000000000000000000002",
            tokenAddress: "0x0000000000000000000000000000000000000001",
          },
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: [{ id: "approve-lrep", to: "0x0000000000000000000000000000000000000001" }],
            requiresOrderedExecution: true,
          },
          wallet: { address: params.walletAddress, fundingMode: "permissionless_wallet" },
        },
        status: 202,
      };
    },
  });

  const originalRequest = {
    ...handoffQuestionPayload("agent-handoff-edit-lrep-feedback-bonus"),
    maxPaymentAmount: "1000000",
    paymentMode: "eip3009_usdc_authorization",
  };
  const editedRequest = {
    ...originalRequest,
    bounty: {
      ...originalRequest.bounty,
      amount: "2500000",
      asset: "USDC",
      requiredVoters: "4",
    },
    feedbackBonus: {
      amount: "2000000",
      asset: "LREP",
    },
    maxPaymentAmount: "2500000",
    paymentMode: "wallet_calls",
  };

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: originalRequest,
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.equal(createBody.paymentMode, "x402_authorization");
  assert.ok(token);

  const patchResponse = await handoffRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      requestBody: editedRequest,
      token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const patchBody = (await patchResponse.json()) as Record<string, unknown>;
  const patchRequestBody = patchBody.requestBody as Record<string, unknown>;

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.paymentMode, "wallet_calls");
  assert.equal((patchRequestBody.bounty as Record<string, unknown>).asset, "USDC");
  assert.equal((patchRequestBody.feedbackBonus as Record<string, unknown>).asset, "LREP");
  assert.equal((patchRequestBody.feedbackBonus as Record<string, unknown>).amount, "2000000");
  assert.equal(patchRequestBody.maxPaymentAmount, "2500000");

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;
  const payload = preparedPayload as {
    bounty: { amount: bigint; asset: "LREP" | "USDC"; requiredVoters: bigint };
  };
  const feedbackBonus = preparedFeedbackBonus as { amount: bigint; asset: "LREP" | "USDC" };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.paymentMode, "wallet_calls");
  assert.ok(prepareBody.transactionPlan);
  const preparedAsk = prepareBody.ask as Record<string, unknown>;
  const preparedPayment = preparedAsk.payment as Record<string, unknown>;
  assert.equal(preparedPayment.feedbackBonusAmount, "2000000");
  assert.equal(preparedPayment.feedbackBonusAsset, "LREP");
  assert.equal(preparedPayment.totalAmount, "2500000");
  assert.equal(payload.bounty.amount, 2_500_000n);
  assert.equal(payload.bounty.asset, "USDC");
  assert.equal(payload.bounty.requiredVoters, 4n);
  assert.equal(feedbackBonus.amount, 2_000_000n);
  assert.equal(feedbackBonus.asset, "LREP");
});

test("agent ask handoff route blocks draft edits after prepare", async () => {
  installAskOverrides();

  const originalRequest = {
    ...handoffQuestionPayload("agent-handoff-edit-blocked"),
    maxPaymentAmount: "1500000",
    paymentMode: "wallet_calls",
  };
  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: originalRequest,
      ttlMs: 300000,
    }),
  );
  const createBody = (await createResponse.json()) as Record<string, unknown>;
  const handoffId = String(createBody.handoffId);
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: HANDOFF_CHAIN_ID,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  assert.equal(prepareResponse.status, 200);

  const patchResponse = await handoffRoute.PATCH(
    makePublicPatch(`https://rateloop.ai/api/agent/handoffs/${handoffId}`, {
      requestBody: {
        ...originalRequest,
        question: {
          ...originalRequest.question,
          title: "Too late to edit",
        },
      },
      token,
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const patchBody = (await patchResponse.json()) as Record<string, unknown>;

  assert.equal(patchResponse.status, 409);
  assert.match(String(patchBody.message), /cannot be edited after preparation has started/);
});

test("agent ask handoff route accepts Feedback Bonus wallet-call funding", async () => {
  installAskOverrides();

  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...handoffQuestionPayload("agent-handoff-feedback-bonus"),
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
        },
        maxPaymentAmount: "3000000",
        paymentMode: "wallet_calls",
      },
      ttlMs: 300000,
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  const handoffUrl = new URL(String(body.handoffUrl));

  assert.equal(response.status, 200);
  assert.match(String(body.handoffId), /^ahf_/);
  assert.match(handoffUrl.pathname, /^\/agent\/handoff\/ahf_/);
  assert.ok(new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token"));
});

test("agent signing intent read requires a private token outside the request URL", async () => {
  const response = await signingIntentRoute.GET(
    makePublicGet("https://rateloop.ai/api/agent/signing-intents/asi_missing"),
    { params: Promise.resolve({ intentId: "asi_missing" }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.message, "token is required.");
});

test("agent signing intent read rejects token in query string", async () => {
  const response = await signingIntentRoute.GET(
    makePublicGet("https://rateloop.ai/api/agent/signing-intents/asi_test?token=leaked-token"),
    { params: Promise.resolve({ intentId: "asi_test" }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.message, "token is required.");
});

test("agent asks route requires walletAddress for tokenless asks", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-public-missing-wallet"),
      maxPaymentAmount: "1500000",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.code, "wallet_address_required");
  assert.match(String(body.message), /walletAddress is required/i);
});

test("agent asks route returns a public webhook signature challenge for tokenless asks", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-public-callback"),
      maxPaymentAmount: "1500000",
      walletAddress: "0x00000000000000000000000000000000000000aa",
      webhookSecret: "secret",
      webhookUrl: "https://agent.example/callback",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "webhook_signature_required");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.signatureRequired, true);
  assert.match(String(body.message), /RateLoop public webhook/);
  assert.deepEqual(body.webhook, {
    delivery: "signed_hmac_sha256",
    events: [
      "bounty.low_response",
      "feedback.unlocked",
      "question.failed",
      "question.open",
      "question.settled",
      "question.settling",
      "question.submitted",
      "question.submitting",
    ],
    registered: false,
    signatureHeaders: ["x-rateloop-callback-id", "x-rateloop-callback-timestamp", "x-rateloop-callback-signature"],
    signatureRequired: true,
  });
});

test("agent asks route returns the EIP-3009 USDC authorization response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-http"),
      maxPaymentAmount: "1500000",
      paymentMode: "eip3009_usdc_authorization",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.paymentScheme, "eip3009_usdc_authorization");
  assert.equal(body.transactionPlan, null);
  assert.equal(
    ((body.x402AuthorizationRequest as Record<string, unknown>).typedData as Record<string, unknown>).primaryType,
    "ReceiveWithAuthorization",
  );
});

test("agent asks route returns tokenless EIP-3009 USDC authorization response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-public-x402"),
      maxPaymentAmount: "1500000",
      paymentMode: "eip3009_usdc_authorization",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "ask-public-x402");
  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.paymentScheme, "eip3009_usdc_authorization");
  assert.equal(body.transactionPlan, null);
  assert.equal(body.walletPolicyRequired, false);
});

test("agent asks route returns stable direct HTTP error payloads", async () => {
  installQuoteOverrides();
  mcpToolsModule.__setMcpToolTestOverridesForTests({
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
    reserveMcpAgentBudget: async () => {
      throw new mcpBudgetModule.McpBudgetError("This MCP agent is not allowed to ask in the selected category.", 403);
    },
    resolveX402QuestionConfig: () =>
      ({
        usdcAddress: "0x0000000000000000000000000000000000000001",
      }) as never,
  });

  const response = await asksRoute.POST(
    makePost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-http"),
      maxPaymentAmount: "1500000",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 403);
  assert.equal(body.code, "category_disallowed");
  assert.equal(body.originalCode, "McpBudgetError");
});

test("agent confirm route returns a submitted ask response", async () => {
  mcpToolsModule.__setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 8453,
        clientRequestId: "ask-http",
        contentId: "42",
        contentIds: ["42"],
        operationKey: OPERATION_KEY,
        status: "submitted",
      },
      status: 200,
    }),
    enqueueAgentCallbackEvent: async () => [],
    updateMcpBudgetReservation: async () => null,
  });

  const response = await asksConfirmRoute.POST(
    makePost(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}/confirm`, {
      transactionHashes: [`0x${"4".repeat(64)}`],
    }),
    { params: Promise.resolve({ operationKey: OPERATION_KEY }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "42");
  assert.equal(body.publicUrl, "http://localhost:3000/rate?content=42");
});

test("agent confirm route accepts tokenless operation confirmations", async () => {
  mcpToolsModule.__setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => ({
      body: {
        chainId: 8453,
        clientRequestId: "ask-public",
        contentId: "42",
        contentIds: ["42"],
        operationKey: OPERATION_KEY,
        status: "submitted",
      },
      status: 200,
    }),
  });

  const response = await asksConfirmRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}/confirm`, {
      transactionHashes: [`0x${"4".repeat(64)}`],
    }),
    { params: Promise.resolve({ operationKey: OPERATION_KEY }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.contentId, "42");
  assert.deepEqual(body.warnings, []);
});

test("agent confirm route rejects malformed transaction hashes before MCP confirmation", async () => {
  mcpToolsModule.__setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async () => {
      throw new Error("confirmation should not be called");
    },
  });

  const response = await asksConfirmRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}/confirm`, {
      transactionHashes: ["not-a-transaction-hash"],
    }),
    { params: Promise.resolve({ operationKey: OPERATION_KEY }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.message, "transactionHashes must contain at least one transaction hash.");
  assert.equal(body.code, "invalid_arguments");
});

test("agent status route returns not_found without treating it as a transport error", async () => {
  const response = await asksByClientRoute.GET(
    makeGet("https://rateloop.ai/api/agent/asks/by-client-request?chainId=8453&clientRequestId=missing"),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "not_found");
  assert.equal(body.ready, false);
  assert.equal(body.terminal, true);
});

test("managed by-client-request routes validate forwarded walletAddress filters", async () => {
  const statusResponse = await asksByClientRoute.GET(
    makeGet(
      "https://rateloop.ai/api/agent/asks/by-client-request?chainId=8453&clientRequestId=missing&walletAddress=0x00000000000000000000000000000000000000bb",
    ),
  );
  const statusBody = (await statusResponse.json()) as Record<string, unknown>;

  assert.equal(statusResponse.status, 403);
  assert.match(String(statusBody.message), /walletAddress does not match/);

  const resultResponse = await resultsByClientRoute.GET(
    makeGet(
      "https://rateloop.ai/api/agent/results/by-client-request?chainId=8453&clientRequestId=missing&walletAddress=0x00000000000000000000000000000000000000bb",
    ),
  );
  const resultBody = (await resultResponse.json()) as Record<string, unknown>;

  assert.equal(resultResponse.status, 403);
  assert.match(String(resultBody.message), /walletAddress does not match/);
});

test("agent status route supports tokenless operation lookups", async () => {
  await dbModule.dbClient.execute({
    args: [
      OPERATION_KEY,
      "wallet:public-status",
      "payload-hash",
      8453,
      "0x00000000000000000000000000000000000000aa",
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "awaiting_wallet_signature",
      new Date("2026-04-23T12:00:00.000Z"),
      new Date("2026-04-23T12:00:00.000Z"),
    ],
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  const response = await asksOperationRoute.GET(makePublicGet(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}`), {
    params: Promise.resolve({ operationKey: OPERATION_KEY }),
  });
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.deepEqual(body.callbackDeliveries, []);
});

test("lifecycle sweep uses submitted x402 state even when reservation bookkeeping is stale", async () => {
  await dbModule.dbClient.execute({
    args: [
      OPERATION_KEY,
      "route-agent",
      "stale-reservation",
      "payload-hash",
      8453,
      "5",
      "1000000",
      "reserved",
      null,
      null,
      new Date("2026-04-23T12:00:00.000Z"),
      new Date("2026-04-23T12:00:00.000Z"),
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
  await dbModule.dbClient.execute({
    args: [
      OPERATION_KEY,
      "mcp:stale-reservation",
      "payload-hash",
      8453,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      "42",
      new Date("2026-04-23T12:00:00.000Z"),
      new Date("2026-04-23T12:00:00.000Z"),
      new Date("2026-04-23T12:05:00.000Z"),
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
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  await callbackRegistryModule.upsertAgentCallbackSubscription({
    agentId: "route-agent",
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.open"],
    id: "sub-open",
    secret: "callback-secret",
  });
  callbackLifecycleModule.__setAgentLifecycleTestOverridesForTests({
    getContentById: async () =>
      ({
        audienceContext: null,
        content: {
          openRound: {
            estimatedSettlementTime: "4700000500",
            roundId: "7",
          },
        },
        ratings: [],
        rounds: [],
      }) as never,
    listContentFeedback: async () =>
      ({
        items: [],
      }) as never,
  });

  const result = await callbackLifecycleModule.sweepAgentLifecycleCallbacks({
    now: new Date("2026-04-23T12:06:00.000Z"),
  });
  const deliveries = await callbackEventsModule.listAgentCallbackEventsByEventIdPrefix({
    agentId: "route-agent",
    eventIdPrefix: `${OPERATION_KEY}:`,
  });

  assert.equal(result.emitted.questionOpen, 1);
  assert.deepEqual(
    deliveries.map(delivery => delivery.eventType),
    ["question.open"],
  );
});

test("agent audit route returns ask-centric audit details", async () => {
  await seedManagedAskAudit({ clientRequestId: "audit-http" });
  await callbackRegistryModule.upsertAgentCallbackSubscription({
    agentId: "route-agent",
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitted"],
    id: "sub-a",
    secret: "callback-secret",
  });
  await callbackEventsModule.enqueueAgentCallbackEvent({
    agentId: "route-agent",
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    now: new Date("2026-04-23T12:00:01.000Z"),
    payload: {
      operationKey: OPERATION_KEY,
      status: "submitted",
    },
  });

  const response = await asksAuditRoute.GET(makeGet(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}/audit`), {
    params: Promise.resolve({ operationKey: OPERATION_KEY }),
  });
  const body = (await response.json()) as {
    auditEvents: Array<Record<string, unknown>>;
    callbackDeliveries: Array<Record<string, unknown>>;
    operationKey: string;
    reservation: Record<string, unknown>;
    status: string;
    submission: Record<string, unknown> | null;
  };

  assert.equal(response.status, 200);
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.status, "submitted");
  assert.equal(body.reservation.clientRequestId, "audit-http");
  assert.equal(body.submission?.status, "submitted");
  assert.equal(body.auditEvents.length, 2);
  assert.equal(body.auditEvents[0]?.eventType, "reserved");
  assert.equal(body.callbackDeliveries.length, 1);
});

test("agent audit by client request route resolves the same managed ask", async () => {
  await seedManagedAskAudit({ clientRequestId: "audit-client-http" });

  const response = await asksByClientAuditRoute.GET(
    makeGet(
      "https://rateloop.ai/api/agent/asks/by-client-request/audit?chainId=8453&clientRequestId=audit-client-http",
    ),
  );
  const body = (await response.json()) as {
    clientRequestId: string;
    operationKey: string;
    status: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "audit-client-http");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.status, "submitted");
});

test("agent audit export route returns csv rows for the authenticated agent", async () => {
  await seedManagedAskAudit({ clientRequestId: "audit-export-http" });

  const response = await asksExportRoute.GET(
    makeGet("https://rateloop.ai/api/agent/asks/export?format=csv&eventType=submitted&limit=10"),
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(body, /operationKey,clientRequestId,chainId/);
  assert.match(body, /audit-export-http/);
  assert.match(body, /submitted/);
});

test("agent audit export route rejects malformed numeric filters", async () => {
  for (const [query, message] of [
    ["chainId=999999abc", "chainId must be a positive integer."],
    ["limit=10junk", "limit must be a positive integer."],
  ] as const) {
    const response = await asksExportRoute.GET(makeGet(`https://rateloop.ai/api/agent/asks/export?${query}`));
    const body = (await response.json()) as { code?: string; message?: string };

    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_arguments");
    assert.equal(body.message, message);
  }
});

test("agent status route surfaces callback delivery state for missed webhooks", async () => {
  await callbackRegistryModule.upsertAgentCallbackSubscription({
    agentId: "route-agent",
    callbackUrl: "https://agent.example/rateloop",
    eventTypes: ["question.submitted"],
    id: "sub-a",
    secret: "callback-secret",
  });
  await callbackEventsModule.enqueueAgentCallbackEvent({
    agentId: "route-agent",
    eventId: `${OPERATION_KEY}:question.submitted`,
    eventType: "question.submitted",
    now: new Date("2026-04-23T12:00:00.000Z"),
    payload: {
      operationKey: OPERATION_KEY,
      status: "submitted",
    },
  });
  await callbackDeliveryModule.leaseDueAgentCallbackEvents({
    now: new Date("2026-04-23T12:00:01.000Z"),
    workerId: "worker-a",
  });
  await callbackDeliveryModule.failAgentCallbackDelivery({
    error: "503",
    eventKey: `sub-a:${OPERATION_KEY}:question.submitted`,
    now: new Date("2026-04-23T12:00:02.000Z"),
    workerId: "worker-a",
  });

  const response = await asksOperationRoute.GET(makeGet(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}`), {
    params: Promise.resolve({ operationKey: OPERATION_KEY }),
  });
  const body = (await response.json()) as {
    callbackDeliveries: Array<Record<string, unknown>>;
    status: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, "not_found");
  assert.deepEqual(body.callbackDeliveries, [
    {
      attemptCount: 1,
      callbackUrl: "https://agent.example/rateloop",
      deliveredAt: null,
      eventId: `${OPERATION_KEY}:question.submitted`,
      eventType: "question.submitted",
      lastError: "503",
      nextAttemptAt: "2026-04-23T12:00:03.000Z",
      status: "retrying",
      subscriptionId: "sub-a",
    },
  ]);
});

test("agent status route includes live ask guidance for underfunded open markets", async () => {
  await dbModule.dbClient.execute({
    args: [
      OPERATION_KEY,
      "status-guidance",
      "payload-hash",
      8453,
      "0x0000000000000000000000000000000000000001",
      "1000000",
      "1000000",
      1,
      "submitted",
      "42",
      new Date("2026-04-23T12:00:00.000Z"),
      new Date("2026-04-23T12:00:00.000Z"),
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });

  mcpToolsModule.__setMcpToolTestOverridesForTests({
    getContentById: async () =>
      ({
        audienceContext: null,
        content: {
          categoryId: "5",
          conservativeRatingBps: 5000,
          contentHash: `0x${"1".repeat(64)}`,
          createdAt: "1",
          description: "Would this make you want to learn more?",
          id: "42",
          lastActivityAt: "2",
          openRound: {
            confidenceMass: "0",
            conservativeRatingBps: 5000,
            downCount: 0,
            downPool: "0",
            effectiveEvidence: "0",
            epochDuration: 1200,
            estimatedSettlementTime: "4700000500",
            lowSince: "1700000100",
            maxDuration: 1200,
            maxVoters: 50,
            minVoters: 3,
            ratingBps: 5000,
            referenceRatingBps: 5000,
            revealedCount: 1,
            roundId: "1",
            settledRounds: 0,
            startTime: "1699998800",
            totalStake: "1000",
            upCount: 1,
            upPool: "1000",
            voteCount: 1,
          },
          questionMetadataHash: `0x${"2".repeat(64)}`,
          rating: 50,
          ratingBps: 5000,
          ratingConfidenceMass: "0",
          ratingEffectiveEvidence: "0",
          ratingLowSince: "0",
          ratingSettledRounds: 0,
          resultSpecHash: null,
          rewardPoolSummary: {
            asset: 1,
            activeRewardPoolCount: 1,
            activeUnallocatedAmount: "1000000",
            claimableAllocatedAmount: "0",
            currentRewardPoolAmount: "1000000",
            currency: "USDC",
            decimals: 6,
            displayCurrency: "USD",
            expiredRewardPoolCount: 0,
            expiredUnallocatedAmount: "0",
            hasActiveBounty: true,
            nextBountyClosesAt: "4700001800",
            nextFeedbackClosesAt: null,
            qualifiedRoundCount: 0,
            rewardPoolCount: 1,
            totalAllocatedAmount: "0",
            totalClaimedAmount: "0",
            totalFrontendClaimedAmount: "0",
            totalFundedAmount: "1000000",
            totalRefundedAmount: "0",
            totalUnallocatedAmount: "1000000",
            totalVoterClaimedAmount: "0",
          },
          roundEpochDuration: 1200,
          roundMaxDuration: 7200,
          roundMaxVoters: 50,
          roundMinVoters: 3,
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
      }) as never,
  });

  const response = await asksOperationRoute.GET(makeGet(`https://rateloop.ai/api/agent/asks/${OPERATION_KEY}`), {
    params: Promise.resolve({ operationKey: OPERATION_KEY }),
  });
  const body = (await response.json()) as {
    liveAskGuidance: {
      lowResponseRisk: string;
      recommendedAction: string;
      suggestedReplacementBountyAtomic: string | null;
    } | null;
    status: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.deepEqual(body.liveAskGuidance, {
    lowResponseRisk: "high",
    reasonCodes: ["quorum_not_reached", "low_response_persisting", "bounty_below_healthy_target"],
    recommendedAction: "create_replacement_ask",
    suggestedReplacementBountyAtomic: "1500000",
  });
});

test("agent results route returns the pending result package before settlement", async () => {
  const response = await resultsByClientRoute.GET(
    makeGet("https://rateloop.ai/api/agent/results/by-client-request?chainId=8453&clientRequestId=missing"),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.ready, false);
  assert.equal(body.answer, "pending");
  assert.equal(body.liveAskGuidance, null);
  assert.equal(body.recommendedNextAction, "wait_for_settlement");
  assert.deepEqual(body.wait, {
    code: "still_settling",
    recoverWith: "rateloop_get_question_status",
  });
});

test("agent results routes accept contentId for bundle lookups", async () => {
  await seedManagedAskAudit({ clientRequestId: "bundle-result-http", contentId: "42" });
  await dbModule.dbClient.execute({
    args: [JSON.stringify(["42", "99"]), "bundle-result-http"],
    sql: `
      UPDATE x402_question_submissions
      SET content_ids = ?
      WHERE client_request_id = ?
    `,
  });

  mcpToolsModule.__setMcpToolTestOverridesForTests({
    getContentById: async contentId =>
      ({
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
      }) as never,
  });

  const byClientResponse = await resultsByClientRoute.GET(
    makeGet(
      "https://rateloop.ai/api/agent/results/by-client-request?chainId=8453&clientRequestId=bundle-result-http&contentId=99",
    ),
  );
  const byClientBody = (await byClientResponse.json()) as {
    operation: {
      contentIds: string[];
    } | null;
    publicUrl: string | null;
  };

  assert.equal(byClientResponse.status, 200);
  assert.equal(byClientBody.publicUrl, "http://localhost:3000/rate?content=99");
  assert.deepEqual(byClientBody.operation?.contentIds, ["42", "99"]);

  const byOperationResponse = await resultsOperationRoute.GET(
    makeGet(`https://rateloop.ai/api/agent/results/${OPERATION_KEY}?contentId=99`),
    {
      params: Promise.resolve({ operationKey: OPERATION_KEY }),
    },
  );
  const byOperationBody = (await byOperationResponse.json()) as {
    publicUrl: string | null;
  };

  assert.equal(byOperationResponse.status, 200);
  assert.equal(byOperationBody.publicUrl, "http://localhost:3000/rate?content=99");
});

test("agent templates route returns supported result templates", async () => {
  const response = await templatesRoute.GET(makeGet("https://rateloop.ai/api/agent/templates"));
  const body = (await response.json()) as {
    templates: Array<{
      bundleStrategy: string;
      id: string;
      submissionPattern: string;
      templateInputsExample: Record<string, unknown> | null;
      templateInputsSchema: Record<string, unknown>;
    }>;
  };

  assert.equal(response.status, 200);
  assert.ok(body.templates.length > 0);
  assert.equal(body.templates[0]?.id, "generic_rating");
  assert.equal(body.templates[0]?.submissionPattern, "single_question");
  assert.equal(body.templates[0]?.bundleStrategy, "independent");
  assert.equal(body.templates[0]?.templateInputsExample?.goal, "quick audience interest check");
  assert.equal(body.templates[0]?.templateInputsSchema.type, "object");
  const featureAcceptance = body.templates.find(template => template.id === "feature_acceptance_test");
  assert.equal(featureAcceptance?.submissionPattern, "single_question");
  assert.equal(featureAcceptance?.bundleStrategy, "independent");
  assert.ok(
    (featureAcceptance?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.expectedBehavior,
  );
  assert.ok((featureAcceptance?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.testSteps);
  assert.ok(
    (featureAcceptance?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.acceptanceCriteria,
  );
  const traceReview = body.templates.find(template => template.id === "agent_trace_review");
  assert.equal(traceReview?.submissionPattern, "single_question");
  assert.equal(traceReview?.bundleStrategy, "independent");
  assert.ok((traceReview?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.traceId);
  assert.ok((traceReview?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.taskGoal);
  assert.ok((traceReview?.templateInputsSchema.properties as Record<string, unknown> | undefined)?.reviewFocus);
});

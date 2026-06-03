import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAgents = env.RATELOOP_MCP_AGENTS;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.DATABASE_URL = "memory:";

type AgentAsksByClientRouteModule = typeof import("./asks/by-client-request/route");
type AgentAsksByClientAuditRouteModule = typeof import("./asks/by-client-request/audit/route");
type AgentAsksConfirmRouteModule = typeof import("./asks/[operationKey]/confirm/route");
type AgentAsksAuditRouteModule = typeof import("./asks/[operationKey]/audit/route");
type AgentAsksExportRouteModule = typeof import("./asks/export/route");
type AgentAsksOperationRouteModule = typeof import("./asks/[operationKey]/route");
type AgentAsksRouteModule = typeof import("./asks/route");
type AgentHandoffCompleteRouteModule = typeof import("./handoffs/[handoffId]/complete/route");
type AgentHandoffPrepareRouteModule = typeof import("./handoffs/[handoffId]/prepare/route");
type AgentHandoffRouteModule = typeof import("./handoffs/[handoffId]/route");
type AgentHandoffsRouteModule = typeof import("./handoffs/route");
type AgentQuoteRouteModule = typeof import("./quote/route");
type AgentResultsByClientRouteModule = typeof import("./results/by-client-request/route");
type AgentResultsOperationRouteModule = typeof import("./results/[operationKey]/route");
type AgentSigningIntentRouteModule = typeof import("./signing-intents/[intentId]/route");
type AgentSigningIntentPrepareRouteModule = typeof import("./signing-intents/[intentId]/prepare/route");
type AgentSigningIntentsRouteModule = typeof import("./signing-intents/route");
type AgentTemplatesRouteModule = typeof import("./templates/route");
type CallbackDeliveryModule = typeof import("~~/lib/agent-callbacks/delivery");
type CallbackEventsModule = typeof import("~~/lib/agent-callbacks/events");
type CallbackLifecycleModule = typeof import("~~/lib/agent-callbacks/lifecycle");
type CallbackRegistryModule = typeof import("~~/lib/agent-callbacks/registry");
type DbModule = typeof import("../../../lib/db");
type DbTestMemoryModule = typeof import("../../../lib/db/testMemory");
type McpBudgetModule = typeof import("~~/lib/mcp/budget");
type McpToolsModule = typeof import("~~/lib/mcp/tools");
type UrlSafetyModule = typeof import("~~/utils/urlSafety");
type McpToolTestOverrides = NonNullable<Parameters<McpToolsModule["__setMcpToolTestOverridesForTests"]>[0]>;

const OPERATION_KEY = `0x${"1".repeat(64)}` as const;

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
let handoffCompleteRoute: AgentHandoffCompleteRouteModule;
let handoffPrepareRoute: AgentHandoffPrepareRouteModule;
let handoffRoute: AgentHandoffRouteModule;
let handoffsRoute: AgentHandoffsRouteModule;
let mcpBudgetModule: McpBudgetModule;
let mcpToolsModule: McpToolsModule;
let quoteRoute: AgentQuoteRouteModule;
let resultsByClientRoute: AgentResultsByClientRouteModule;
let resultsOperationRoute: AgentResultsOperationRouteModule;
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

function questionPayload(clientRequestId: string) {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
      bountyStartBy: "1762000000",
      bountyWindowSeconds: "1200",
      feedbackWindowSeconds: "1200",
    },
    chainId: 480,
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

async function seedManagedAskAudit(params: {
  chainId?: number;
  clientRequestId: string;
  contentId?: string | null;
  operationKey?: `0x${string}`;
}) {
  const operationKey = params.operationKey ?? OPERATION_KEY;
  const chainId = params.chainId ?? 480;
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
        chainId: 480,
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
  dbTestMemory = await import("../../../lib/db/testMemory");
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
  handoffCompleteRoute = await import("./handoffs/[handoffId]/complete/route");
  handoffPrepareRoute = await import("./handoffs/[handoffId]/prepare/route");
  handoffRoute = await import("./handoffs/[handoffId]/route");
  handoffsRoute = await import("./handoffs/route");
  quoteRoute = await import("./quote/route");
  resultsByClientRoute = await import("./results/by-client-request/route");
  resultsOperationRoute = await import("./results/[operationKey]/route");
  signingIntentRoute = await import("./signing-intents/[intentId]/route");
  signingIntentPrepareRoute = await import("./signing-intents/[intentId]/prepare/route");
  signingIntentsRoute = await import("./signing-intents/route");
  templatesRoute = await import("./templates/route");
});

beforeEach(async () => {
  env.NODE_ENV = "development";
  configureAgent();
  urlSafetyModule.__setUrlSafetyDnsResolversForTests({
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  });
  mcpToolsModule.__setMcpToolTestOverridesForTests(null);
  callbackLifecycleModule.__setAgentLifecycleTestOverridesForTests(null);
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
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("RATELOOP_MCP_AGENTS", originalAgents);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
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

test("agent asks route rejects oversized JSON bodies", async () => {
  const response = await asksRoute.POST(
    new NextRequest("https://rateloop.ai/api/agent/asks", {
      body: "{}",
      headers: new Headers({
        "content-length": String(128 * 1024 + 1),
        "content-type": "application/json",
      }),
      method: "POST",
    }),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
});

test("agent signing intent routes create and prepare browser handoff asks", async () => {
  installAskOverrides();

  const createResponse = await signingIntentsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/signing-intents", {
      request: {
        ...questionPayload("browser-handoff"),
        maxPaymentAmount: "1500000",
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
  assert.equal(prepareBody.status, "awaiting_wallet_signature");
  assert.equal((prepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);
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

test("agent ask handoff route stages generated image bytes behind a browser link", async () => {
  const response = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      generatedImages: [
        {
          filename: "concept.png",
          imageBase64: "aGVsbG8=",
          mimeType: "image/png",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          sizeBytes: 5,
        },
      ],
      request: {
        ...questionPayload("agent-handoff-image"),
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
  assert.equal(handoffUrl.searchParams.get("token"), null);
  assert.equal(body.nextAction, "Share handoffUrl with the user. Do not ask the user to paste raw wallet signatures.");

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
  assert.equal(readBody.assets?.[0]?.dataUrl, "data:image/png;base64,aGVsbG8=");

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: 4801,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as {
    chainId?: number;
    status?: string;
    uploadChallenges?: Array<Record<string, unknown>>;
  };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.chainId, 4801);
  assert.equal(prepareBody.status, "awaiting_image_signatures");
  assert.equal(prepareBody.uploadChallenges?.length, 1);
  assert.equal(prepareBody.uploadChallenges?.[0]?.assetId, readBody.assets?.[0]?.id);
  assert.match(String(prepareBody.uploadChallenges?.[0]?.challengeId), /^[a-f0-9]{32}$/);
});

test("agent ask handoff route prepares and completes no-image wallet-call asks", async () => {
  installAskOverrides();

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...questionPayload("agent-handoff-no-image"),
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

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: 4801,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.chainId, 4801);
  assert.equal((prepareBody.ask as Record<string, unknown>).chainId, 4801);
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

test("agent ask handoff route saves edited drafts before prepare", async () => {
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
            amount: params.payload.bounty.amount.toString(),
            asset: "USDC",
            bountyAmount: params.payload.bounty.amount.toString(),
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

  const originalRequest = {
    ...questionPayload("agent-handoff-editable"),
    maxPaymentAmount: "3000000",
  };
  const editedRequest = {
    ...originalRequest,
    bounty: {
      ...originalRequest.bounty,
      amount: "2500000",
    },
    question: {
      ...originalRequest.question,
      description: "Edited after the agent handoff.",
      tags: ["agents", "running"],
      title: "Edited pitch interest",
    },
    roundConfig: {
      epochDuration: "600",
      maxDuration: "7200",
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
  assert.equal(patchQuestion.title, "Edited pitch interest");
  assert.equal(patchOriginalQuestion.title, "Pitch interest");

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: 4801,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;
  const payload = preparedPayload as {
    bounty: { amount: bigint };
    questions: Array<{ description: string; tagList: string[]; title: string }>;
    roundConfig: { epochDuration: bigint; maxDuration: bigint; maxVoters: bigint; minVoters: bigint };
  };

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "prepared");
  assert.equal(prepareBody.draftRevision, 1);
  assert.equal(prepareBody.preparedDraftRevision, 1);
  assert.equal(payload.questions[0]?.title, "Edited pitch interest");
  assert.equal(payload.questions[0]?.description, "Edited after the agent handoff.");
  assert.deepEqual(payload.questions[0]?.tagList, ["agents", "running"]);
  assert.equal(payload.bounty.amount, 2_500_000n);
  assert.equal(payload.roundConfig.epochDuration, 600n);
  assert.equal(payload.roundConfig.maxDuration, 7200n);
  assert.equal(payload.roundConfig.minVoters, 4n);
  assert.equal(payload.roundConfig.maxVoters, 40n);
});

test("agent ask handoff route blocks draft edits after prepare", async () => {
  installAskOverrides();

  const originalRequest = {
    ...questionPayload("agent-handoff-edit-blocked"),
    maxPaymentAmount: "1500000",
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
      chainId: 4801,
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

test("agent ask handoff route funds feedback bonus after submitting the ask", async () => {
  const feedbackBonusCalls = [
    { id: "approve-feedback-bonus-usdc", to: "0x0000000000000000000000000000000000000001" },
    { id: "create-feedback-bonus-pool", to: "0x0000000000000000000000000000000000000003" },
  ];
  const confirmedFeedbackBonus: unknown[] = [];
  mcpToolsModule.__setMcpToolTestOverridesForTests({
    confirmAgentWalletQuestionSubmissionRequest: async params => ({
      body: {
        contentId: "content-123",
        feedbackBonus: {
          amount: "2000000",
          asset: "USDC",
          enabled: true,
          status: "awaiting_wallet_signature",
        },
        operationKey: params.operationKey,
        publicUrl: "https://rateloop.ai/rate?content=content-123",
        status: "submitted",
        transactionHashes: params.transactionHashes,
      },
      status: 200,
    }),
    confirmFeedbackBonusQuestionSubmissionRequest: async params => {
      confirmedFeedbackBonus.push(params);
      return {
        body: {
          feedbackBonus: {
            enabled: true,
            poolId: "7",
            status: "funded",
          },
          operationKey: params.operationKey,
          status: "submitted",
        },
        status: 200,
      };
    },
    prepareFeedbackBonusQuestionSubmissionRequest: async params => ({
      body: {
        feedbackBonus: {
          amount: "2000000",
          contentId: "content-123",
          roundId: "1",
          status: "awaiting_wallet_signature",
          transactionPlan: {
            calls: feedbackBonusCalls,
            requiresOrderedExecution: true,
          },
        },
        operationKey: params.operationKey,
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
    resolveX402QuestionConfig: () =>
      ({
        feedbackBonusEscrowAddress: "0x0000000000000000000000000000000000000003",
        questionRewardPoolEscrowAddress: "0x0000000000000000000000000000000000000002",
        usdcAddress: "0x0000000000000000000000000000000000000001",
      }) as never,
  });

  const createResponse = await handoffsRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/handoffs", {
      request: {
        ...questionPayload("agent-handoff-feedback-bonus"),
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
  const handoffUrl = new URL(String(createBody.handoffUrl));
  const token = new URLSearchParams(handoffUrl.hash.replace(/^#/, "")).get("token");

  assert.equal(createResponse.status, 200);
  assert.ok(token);
  assert.equal(
    ((createBody.requestBody as Record<string, unknown>).feedbackBonus as Record<string, unknown>).amount,
    "2000000",
  );

  const prepareResponse = await handoffPrepareRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/prepare`, {
      chainId: 4801,
      token,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const prepareBody = (await prepareResponse.json()) as Record<string, unknown>;

  assert.equal(prepareResponse.status, 200);
  assert.equal(prepareBody.status, "prepared");
  assert.equal((prepareBody.transactionPlan as { calls: unknown[] }).calls.length, 1);
  assert.equal(
    ((prepareBody.ask as Record<string, unknown>).feedbackBonus as Record<string, unknown>).status,
    "pending_question_confirmation",
  );

  const askHash = `0x${"4".repeat(64)}` as const;
  const completeAskResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [askHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeAskBody = (await completeAskResponse.json()) as Record<string, unknown>;

  assert.equal(completeAskResponse.status, 200);
  assert.equal(completeAskBody.status, "feedback_bonus_prepared");
  assert.deepEqual(completeAskBody.transactionHashes, [askHash]);
  assert.equal((completeAskBody.transactionPlan as { calls: unknown[] }).calls.length, 2);
  assert.equal(
    completeAskBody.nextAction,
    "Execute the Feedback Bonus transactionPlan.calls in the connected wallet, then confirm transaction hashes.",
  );

  const feedbackHash = `0x${"5".repeat(64)}` as const;
  const completeBonusResponse = await handoffCompleteRoute.POST(
    makePublicPost(`https://rateloop.ai/api/agent/handoffs/${handoffId}/complete`, {
      token,
      transactionHashes: [feedbackHash],
    }),
    { params: Promise.resolve({ handoffId }) },
  );
  const completeBonusBody = (await completeBonusResponse.json()) as Record<string, unknown>;

  assert.equal(completeBonusResponse.status, 200);
  assert.equal(completeBonusBody.status, "submitted");
  assert.deepEqual(completeBonusBody.transactionHashes, [askHash, feedbackHash]);
  assert.equal(
    ((completeBonusBody.ask as Record<string, unknown>).feedbackBonus as Record<string, unknown>).status,
    "funded",
  );
  assert.deepEqual(confirmedFeedbackBonus, [{ operationKey: OPERATION_KEY, transactionHashes: [feedbackHash] }]);
});

test("agent signing intent read requires a private token outside the request URL", async () => {
  const response = await signingIntentRoute.GET(
    makePublicGet("https://rateloop.ai/api/agent/signing-intents/asi_missing"),
    { params: Promise.resolve({ intentId: "asi_missing" }) },
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(body.error, "token is required.");
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

test("agent asks route keeps callbacks managed-only for tokenless asks", async () => {
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

  assert.equal(response.status, 401);
  assert.match(String(body.message), /managed agent token/i);
});

test("agent asks route returns the native x402 authorization response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-http"),
      maxPaymentAmount: "1500000",
      paymentMode: "x402_authorization",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_wallet_signature");
  assert.equal(body.operationKey, OPERATION_KEY);
  assert.equal(body.paymentMode, "x402_authorization");
  assert.equal(body.transactionPlan, null);
  assert.equal(
    ((body.x402AuthorizationRequest as Record<string, unknown>).typedData as Record<string, unknown>).primaryType,
    "ReceiveWithAuthorization",
  );
});

test("agent asks route returns tokenless native x402 authorization response", async () => {
  installAskOverrides();

  const response = await asksRoute.POST(
    makePublicPost("https://rateloop.ai/api/agent/asks", {
      ...questionPayload("ask-public-x402"),
      maxPaymentAmount: "1500000",
      paymentMode: "x402_authorization",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.clientRequestId, "ask-public-x402");
  assert.equal(body.paymentMode, "x402_authorization");
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
        chainId: 480,
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
        chainId: 480,
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

test("agent status route returns not_found without treating it as a transport error", async () => {
  const response = await asksByClientRoute.GET(
    makeGet("https://rateloop.ai/api/agent/asks/by-client-request?chainId=480&clientRequestId=missing"),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "not_found");
  assert.equal(body.ready, false);
  assert.equal(body.terminal, true);
});

test("agent status route supports tokenless operation lookups", async () => {
  await dbModule.dbClient.execute({
    args: [
      OPERATION_KEY,
      "wallet:public-status",
      "payload-hash",
      480,
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
      480,
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
      480,
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
    makeGet("https://rateloop.ai/api/agent/asks/by-client-request/audit?chainId=480&clientRequestId=audit-client-http"),
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
      480,
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
            maxDuration: 7200,
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
      suggestedTopUpAtomic: string | null;
    } | null;
    status: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.deepEqual(body.liveAskGuidance, {
    lowResponseRisk: "high",
    reasonCodes: ["quorum_not_reached", "low_response_persisting", "bounty_below_healthy_target"],
    recommendedAction: "top_up",
    suggestedTopUpAtomic: "500000",
  });
});

test("agent results route returns the pending result package before settlement", async () => {
  const response = await resultsByClientRoute.GET(
    makeGet("https://rateloop.ai/api/agent/results/by-client-request?chainId=480&clientRequestId=missing"),
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
      "https://rateloop.ai/api/agent/results/by-client-request?chainId=480&clientRequestId=bundle-result-http&contentId=99",
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

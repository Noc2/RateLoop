import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/mcp/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { tokenlessMcpTools } from "~~/lib/mcp/protocol";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import { createAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import {
  activateAgentIntegrationPublishing,
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  listAgentConnections,
  revokeAgentIntegration,
  rotateAgentIntegration,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import {
  exchangeAgentOAuthToken,
  getCanonicalAgentMcpResource,
  issueAgentOAuthAuthorizationCode,
  registerAgentOAuthClient,
  validateAgentOAuthAuthorizationRequest,
} from "~~/lib/tokenless/agentOAuth";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "99".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-route-v1";
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "workspace-mcp-test-rate-limit-secret-with-32-characters";
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
  if (originalRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalRateLimitSecret;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

function request(value: unknown, token?: string) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/mcp", {
    method: "POST",
    body: JSON.stringify(value),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      "x-real-ip": "203.0.113.90",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "Workspace MCP", ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "MCP policy",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "30000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 15,
      maxBountyAtomic: "20000000",
      maxFeeBps: 750,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["internal"],
    },
  });
  const audience = { reviewerSource: "private_invited" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const provisional = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(provisional.kind, "pairing");
  if (provisional.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing: provisional,
    registration: {
      externalId: "mcp-agent",
      displayName: "MCP Agent",
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["support-reply"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["support-reply"] },
  });
  return { workspaceId, approved, audiencePolicyHash, token: issued.secret };
}

test("pairing initialization tells the agent to register immediately and returns the next automatic action", async () => {
  const { workspaceId } = await createWorkspace({ name: "Automatic pairing", ownerAddress: OWNER });
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const initialized = await POST(
    request(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "automatic-agent", version: "1.0.0" },
        },
      },
      issued.secret,
    ),
  );
  const initializedBody = await initialized.json();
  assert.match(initializedBody.result.instructions, /Act immediately without asking the user/);
  assert.match(initializedBody.result.instructions, /call rateloop_register_agent exactly once/);

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, issued.secret));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ["rateloop_register_agent", "rateloop_get_registration_status"],
  );
  assert.match(listedBody.result.tools[0].description, /Call immediately after connecting/);

  const registered = await POST(
    request(
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rateloop_register_agent",
          arguments: {
            externalId: "automatic-agent",
            displayName: "Automatic Agent",
            provider: "OpenAI",
            model: "gpt-test",
            environment: "production",
            requestedWorkflowKeys: ["general-assistance"],
          },
        },
      },
      issued.secret,
    ),
  );
  const registration = (await registered.json()).result.structuredContent;
  assert.equal(registration.registration.status, "claimed");
  assert.equal(registration.pollAfterMs, 3_000);
  assert.match(registration.nextAction, /rateloop_get_registration_status/);
});

test("OAuth keeps one stable tool list while one message claims, loads, and verifies the connection", async () => {
  const principalId = `rlp_${"b".repeat(24)}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [principalId, now, now],
  });
  const { workspaceId } = await createWorkspace({ name: "One-message OAuth", ownerAddress: principalId });
  const intent = await createAgentConnectionIntent({
    accountAddress: principalId,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const redirectUri = "http://127.0.0.1:43219/oauth/callback";
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const oauthClient = await registerAgentOAuthClient({
    client_name: "Cross-host MCP client",
    redirect_uris: [redirectUri],
  });
  const authorization = await validateAgentOAuthAuthorizationRequest(
    new URLSearchParams({
      client_id: oauthClient.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: getCanonicalAgentMcpResource(),
      scope: oauthClient.scope,
    }),
  );
  const codeRedirect = await issueAgentOAuthAuthorizationCode({
    request: authorization,
    subjectPrincipalId: principalId,
    consented: true,
  });
  const code = new URL(codeRedirect.redirectUri).searchParams.get("code");
  assert.ok(code);
  const tokens = await exchangeAgentOAuthToken({
    grantType: "authorization_code",
    clientId: oauthClient.client_id,
    code,
    redirectUri,
    codeVerifier: verifier,
    resource: getCanonicalAgentMcpResource(),
  });

  const names = [
    "rateloop_claim_connection_intent",
    "rateloop_get_agent_context",
    "rateloop_verify_connection",
    "rateloop_get_assurance_state",
    "rateloop_evaluate_review_requirement",
    "rateloop_request_review",
    "rateloop_wait_for_review",
    "rateloop_get_review_result",
  ];
  const before = await POST(request({ id: 10, jsonrpc: "2.0", method: "tools/list", params: {} }, tokens.access_token));
  const beforeTools = (await before.json()).result.tools as Array<{
    name: string;
    annotations?: Record<string, boolean>;
    description?: string;
    inputSchema?: {
      required?: string[];
      properties?: Record<string, unknown>;
    };
  }>;
  assert.deepEqual(
    beforeTools.map(tool => tool.name),
    names,
  );
  const tool = (name: string) => beforeTools.find(candidate => candidate.name === name);
  assert.deepEqual(tool("rateloop_claim_connection_intent")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(tool("rateloop_get_agent_context")?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(tool("rateloop_verify_connection")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(tool("rateloop_request_review")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
  const requestReviewTool = tool("rateloop_request_review");
  assert.match(requestReviewTool?.description ?? "", /public RateLoop network/);
  assert.match(requestReviewTool?.description ?? "", /private and hybrid assignment lanes are not available/);
  assert.deepEqual(requestReviewTool?.inputSchema?.required, [
    "opportunityId",
    "sourcePayload",
    "suggestionPayload",
    "economics",
    "publication",
  ]);
  assert.deepEqual(requestReviewTool?.inputSchema?.properties?.publication, {
    additionalProperties: false,
    allOf: [
      {
        if: {
          properties: { dataClassification: { const: "redacted" } },
          required: ["dataClassification"],
        },
        then: { required: ["redactionSummary"] },
      },
    ],
    properties: {
      visibility: { enum: ["public"], type: "string" },
      dataClassification: { enum: ["public", "synthetic", "redacted"], type: "string" },
      confirmedNoSensitiveData: { enum: [true], type: "boolean" },
      redactionSummary: { maxLength: 1_000, minLength: 10, type: "string" },
    },
    required: ["visibility", "dataClassification", "confirmedNoSensitiveData"],
    type: "object",
  });
  const notReady = await POST(
    request(
      {
        id: 11,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  assert.equal((await notReady.json()).result.structuredContent.code, "connection_not_ready");
  const claimed = await POST(
    request(
      {
        id: 12,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_claim_connection_intent", arguments: { connectionUrl: intent.connectionUrl } },
      },
      tokens.access_token,
    ),
  );
  const claim = (await claimed.json()).result.structuredContent;
  assert.equal(claim.connection.status, "testing");
  const context = await POST(
    request(
      {
        id: 13,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  const agentContext = (await context.json()).result.structuredContent;
  assert.equal(agentContext.workspaceId, workspaceId);
  assert.match(agentContext.reviewPolicy.audiencePolicyHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(agentContext.publishingPolicy, null);
  assert.equal(agentContext.safeAccess.canSpend, false);
  const verified = await POST(
    request(
      {
        id: 14,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_verify_connection", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  const firstVerification = (await verified.json()).result.structuredContent;
  assert.equal(firstVerification.connection.status, "connected");

  const resumedInitialization = await POST(
    request(
      {
        id: 141,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: true } },
          clientInfo: { name: "Codex", version: "2026.07.15" },
        },
      },
      tokens.access_token,
    ),
  );
  const resumedInitializationBody = await resumedInitialization.json();
  assert.match(resumedInitializationBody.result.instructions, /workspace connection is available/i);

  const resumedTools = await POST(
    request({ id: 142, jsonrpc: "2.0", method: "tools/list", params: {} }, tokens.access_token),
  );
  assert.deepEqual(
    (await resumedTools.json()).result.tools.map((candidate: { name: string }) => candidate.name),
    names,
  );

  const repeatedClaim = await POST(
    request(
      {
        id: 143,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_claim_connection_intent", arguments: { connectionUrl: intent.connectionUrl } },
      },
      tokens.access_token,
    ),
  );
  const resumedClaim = (await repeatedClaim.json()).result.structuredContent;
  assert.equal(resumedClaim.idempotent, true);
  assert.equal(resumedClaim.connection.integrationId, claim.connection.integrationId);
  assert.equal(resumedClaim.connection.status, "connected");

  const resumedContext = await POST(
    request(
      {
        id: 144,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  assert.deepEqual((await resumedContext.json()).result.structuredContent, agentContext);

  const repeatedVerification = await POST(
    request(
      {
        id: 145,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_verify_connection", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  assert.deepEqual((await repeatedVerification.json()).result.structuredContent, firstVerification);
  const entityCounts = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_agents WHERE workspace_id = ?) AS agents,
            (SELECT COUNT(*) FROM tokenless_agent_integrations WHERE workspace_id = ?) AS integrations`,
    args: [workspaceId, workspaceId],
  });
  assert.equal(Number(entityCounts.rows[0]?.agents ?? 0), 1);
  assert.equal(Number(entityCounts.rows[0]?.integrations ?? 0), 1);
  const resumedMetadata = await dbClient.execute({
    sql: `SELECT client_name, client_version, client_capabilities_json
          FROM tokenless_agent_integrations WHERE integration_id = ?`,
    args: [claim.connection.integrationId],
  });
  assert.equal(resumedMetadata.rows[0]?.client_name, "Codex");
  assert.equal(resumedMetadata.rows[0]?.client_version, "2026.07.15");
  assert.deepEqual(JSON.parse(String(resumedMetadata.rows[0]?.client_capabilities_json)), ["tools"]);
  const connectedEvents = await dbClient.execute({
    sql: `SELECT COUNT(*) AS total FROM tokenless_agent_integration_events
          WHERE integration_id = ? AND event_type = 'connected'`,
    args: [claim.connection.integrationId],
  });
  assert.equal(Number(connectedEvents.rows[0]?.total ?? 0), 1);
  const after = await POST(request({ id: 15, jsonrpc: "2.0", method: "tools/list", params: {} }, tokens.access_token));
  assert.deepEqual(
    (await after.json()).result.tools.map((tool: { name: string }) => tool.name),
    names,
  );
  const connections = await listAgentConnections({ accountAddress: principalId, workspaceId });
  const oauthIntegration = connections.integrations.find(
    integration => integration.integrationId === claim.connection.integrationId,
  );
  assert.equal(oauthIntegration?.activationMode, "preauthorized_safe");
  assert.equal(oauthIntegration?.credentialPrefix, null);
  const publishing = await createAgentPublishingPolicy({
    accountAddress: principalId,
    workspaceId,
    policy: {
      name: "Consented OAuth publishing",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "30000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 15,
      maxBountyAtomic: "20000000",
      maxFeeBps: 750,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"22".repeat(32)}`],
      allowedDataClassifications: ["internal"],
      onPolicyMiss: "deny",
    },
  });
  const stepUp = await activateAgentIntegrationPublishing({
    accountAddress: principalId,
    workspaceId,
    integrationId: claim.connection.integrationId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["general-assistance"] },
  });
  const upgradedContextResponse = await POST(
    request(
      {
        id: 151,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      tokens.access_token,
    ),
  );
  const upgradedContext = (await upgradedContextResponse.json()).result.structuredContent;
  assert.equal(upgradedContext.agentVersionId, stepUp.integration.agentVersionId);
  assert.deepEqual(upgradedContext.reviewPolicy, {
    policyId: stepUp.integration.reviewPolicyId,
    version: stepUp.integration.reviewPolicyVersion,
    audiencePolicyHash: agentContext.reviewPolicy.audiencePolicyHash,
  });
  assert.deepEqual(upgradedContext.publishingPolicy, { policyId: publishing.policyId, version: publishing.version });
  assert.equal(upgradedContext.safeAccess.canSpend, true);
  assert.equal(upgradedContext.safeAccess.canPublish, true);
  await assert.rejects(
    () =>
      rotateAgentIntegration({
        accountAddress: principalId,
        workspaceId,
        integrationId: claim.connection.integrationId,
        origin: "https://rateloop-tokenless.vercel.app",
      }),
    /rotate credentials in the agent host/,
  );
  await revokeAgentIntegration({
    accountAddress: principalId,
    workspaceId,
    integrationId: claim.connection.integrationId,
  });
  const revoked = await POST(
    request({ id: 16, jsonrpc: "2.0", method: "tools/list", params: {} }, tokens.access_token),
  );
  assert.equal(revoked.status, 401);
});

test("uses a bound authenticated workspace surface without changing the public four tools", async () => {
  const setupData = await setup();
  const unauthenticated = await POST(request({ id: 1, jsonrpc: "2.0", method: "tools/list", params: {} }));
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  assert.equal((await unauthenticated.json()).error.data.code, "invalid_agent_credential");

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, setupData.token));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    [
      "rateloop_get_agent_context",
      "rateloop_get_assurance_state",
      "rateloop_evaluate_review_requirement",
      "rateloop_request_review",
      "rateloop_wait_for_review",
      "rateloop_get_review_result",
    ],
  );
  assert.deepEqual(
    tokenlessMcpTools.map(tool => tool.name),
    ["rateloop_capabilities", "rateloop_create_handoff", "rateloop_get_handoff_status", "rateloop_get_result"],
  );

  const approvalTransition = await POST(
    request(
      {
        id: 21,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_registration_status", arguments: {} },
      },
      setupData.token,
    ),
  );
  const approval = (await approvalTransition.json()).result.structuredContent;
  assert.equal(approval.registration.status, "approved");
  assert.equal(approval.integration.integrationId, setupData.approved.integration.integrationId);
  assert.match(approval.nextAction, /rateloop_get_agent_context/);
});

test("injects bound identity into review decisions and rejects caller spoofing", async () => {
  const setupData = await setup();
  const args = {
    externalOpportunityId: "mcp-opportunity-0001",
    workflowKey: "support-reply",
    riskTier: "low",
    audiencePolicyHash: setupData.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ answer: "candidate" }),
    sourceEvidence: {
      reference: "case/mcp-opportunity-0001/revision-1",
      hash: __adaptiveReviewServiceTestUtils.sha256({ source: "mcp-opportunity-0001", revision: 1 }),
    },
    declaredConfidenceBps: 9200,
    metadataComplete: true,
  };
  const decided = await POST(
    request(
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_evaluate_review_requirement", arguments: args },
      },
      setupData.token,
    ),
  );
  const decision = (await decided.json()).result.structuredContent;
  assert.equal(decision.decision, "required");
  assert.equal(decision.policyFrozen, true);
  assert.equal(decision.stage, "calibrating");
  assert.equal("sourceEvidenceReference" in decision, false);

  const spoofed = await POST(
    request(
      {
        id: 31,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_evaluate_review_requirement", arguments: { ...args, agentId: "agt_spoofed" } },
      },
      setupData.token,
    ),
  );
  assert.equal((await spoofed.json()).result.isError, true);

  const stateResponse = await POST(
    request(
      {
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_assurance_state", arguments: { scopeId: decision.scopeId } },
      },
      setupData.token,
    ),
  );
  const state = (await stateResponse.json()).result.structuredContent;
  assert.equal(state.scopeId, decision.scopeId);
  assert.equal(state.reviewRateBps, 10_000);
  assert.equal(state.humanAgreementBps, null);
  assert.equal(state.nextReassessmentAfter, 30);
});

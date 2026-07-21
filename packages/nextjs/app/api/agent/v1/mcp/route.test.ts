import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { GET, POST } from "~~/app/api/agent/v1/mcp/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { tokenlessMcpTools } from "~~/lib/mcp/protocol";
import { requireWorkspaceMcpSession } from "~~/lib/mcp/workspaceElicitation";
import { requestWorkspaceDeletion } from "~~/lib/privacy/workspaceDeletion";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import { createAgentConnectionIntent } from "~~/lib/tokenless/agentConnectionIntents";
import {
  activateAgentIntegrationPublishing,
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  listAgentConnections,
  recoverAgentIntegrationOAuth,
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
import { __setArtifactPrivacyRuntimeForTests } from "~~/lib/tokenless/artifactPrivacy";
import { putHumanReviewConfigurationForOwner } from "~~/lib/tokenless/humanReviewConfiguration";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";
import {
  configureWorkspaceSetupReviews,
  confirmWorkspaceSetupAgent,
  createWorkspaceAgentSetupConnection,
  finalizeWorkspaceAgentSetup,
  getWorkspaceAgentSetup,
} from "~~/lib/tokenless/workspaceAgentSetup";
import {
  createWorkspaceReviewerInvitation,
  redeemWorkspaceReviewerInvitation,
} from "~~/lib/tokenless/workspaceReviewers";

const OWNER = "0x1111111111111111111111111111111111111111";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
const originalAppUrl = process.env.APP_URL;
const PRIVATE_REVIEWER_A = "0x2222222222222222222222222222222222222222";
const PRIVATE_REVIEWER_B = "0x3333333333333333333333333333333333333333";

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "99".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-route-v1";
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "workspace-mcp-test-rate-limit-secret-with-32-characters";
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setArtifactPrivacyRuntimeForTests(null);
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

function request(value: unknown, token?: string, sessionId?: string, protocolVersion = "2025-11-25") {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/mcp", {
    method: "POST",
    body: JSON.stringify(value),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
      "x-real-ip": "203.0.113.90",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
  });
}

function streamRequest(token: string, sessionId: string, protocolVersion: string, lastEventId?: string) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/mcp", {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": protocolVersion,
      "mcp-session-id": sessionId,
      "x-real-ip": "203.0.113.90",
      ...(lastEventId ? { "last-event-id": lastEventId } : {}),
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
  const reviewBinding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: approved.agent.agentId,
    agentVersionId: approved.agent.versionId,
    policyId: approved.integration.reviewPolicyId,
    policyVersion: 1,
    actor: OWNER,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET human_review_binding_id = ?, human_review_binding_version = ?
          WHERE integration_id = ?`,
    args: [reviewBinding.bindingId, reviewBinding.bindingVersion, approved.integration.integrationId],
  });
  const verified = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  assert.equal(verified.kind, "integration");
  if (verified.kind !== "integration") throw new Error("Integration principal expected.");
  const storedCredential = await dbClient.execute({
    sql: "SELECT api_key_id, token_family_id FROM tokenless_agent_integrations WHERE integration_id = ?",
    args: [approved.integration.integrationId],
  });
  assert.equal(verified.principal.apiKeyId, storedCredential.rows[0]?.api_key_id);
  assert.equal(storedCredential.rows[0]?.token_family_id, null);
  return { workspaceId, approved, audiencePolicyHash, reviewBinding, token: issued.secret };
}

async function setupOAuthConnectionIntent() {
  const principalId = `rlp_${"c".repeat(24)}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [principalId, now, now],
  });
  const { workspaceId } = await createWorkspace({ name: "Atomic OAuth", ownerAddress: principalId });
  const intent = await createAgentConnectionIntent({
    accountAddress: principalId,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const redirectUri = "http://127.0.0.1:43220/oauth/callback";
  const verifier = "w".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const oauthClient = await registerAgentOAuthClient({
    client_name: "Atomic MCP client",
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
  return { clientId: oauthClient.client_id, intent, principalId, tokens, workspaceId };
}

async function addRedeemedPrivateReviewer(input: {
  accountAddress: string;
  email: string;
  ownerAddress: string;
  workspaceId: string;
}) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?)`,
    args: [input.accountAddress, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,email_domain,
           display_name,created_at,updated_at,last_login_at)
          VALUES (?,?,'email',?,true,'example.test',NULL,?,?,?)`,
    args: [input.accountAddress, `thirdweb-${input.accountAddress}`, input.email, now, now, now],
  });
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: input.ownerAddress,
    workspaceId: input.workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: input.accountAddress,
    accessExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    now,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: input.accountAddress, token: invitation.token, now });
}

test("pairing initialization describes the owner-initiated registration flow without instruction overrides", async () => {
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
  assert.match(initializedBody.result.instructions, /workspace owner initiated this pairing/i);
  assert.match(initializedBody.result.instructions, /call rateloop_register_agent exactly once/);
  assert.doesNotMatch(initializedBody.result.instructions, /without asking the user|act immediately/i);

  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, issued.secret));
  const listedBody = await listed.json();
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ["rateloop_register_agent", "rateloop_get_registration_status"],
  );
  assert.match(listedBody.result.tools[0].description, /workspace owner initiates this pairing/i);
  assert.doesNotMatch(listedBody.result.tools[0].description, /without waiting|call immediately/i);
  assert.equal("deploymentName" in listedBody.result.tools[0].inputSchema.properties, false);

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

  const nullId = await POST(request({ id: null, jsonrpc: "2.0", method: "ping" }, issued.secret));
  const nullIdBody = await nullId.json();
  assert.equal(nullIdBody.error.code, -32600);
  assert.equal(nullIdBody.id, null);
});

test("one preferred OAuth tool connects a fresh workspace without reflecting the connection secret", async () => {
  const { intent, tokens, workspaceId } = await setupOAuthConnectionIntent();
  const initialized = await POST(
    request(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "Atomic MCP client", version: "1.0.0" },
        },
      },
      tokens.access_token,
    ),
  );
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.match(sessionId ?? "", /^mcps_[A-Za-z0-9_-]{32,128}$/u);
  const invoke = () =>
    POST(
      request(
        {
          id: 2,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "rateloop_connect_workspace",
            arguments: { connectionUrl: intent.connectionUrl, reportedLane: "plugin-with-hooks" },
          },
        },
        tokens.access_token,
        sessionId!,
      ),
    );

  const firstResponse = await invoke();
  const first = (await firstResponse.json()).result.structuredContent;
  assert.equal(first.schemaVersion, "rateloop.workspace-connection.v1");
  assert.equal(first.connected, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.nextAction, "follow_bound_policy");
  assert.equal(first.connection.status, "connected");
  assert.equal(first.connection.reportedLane, "plugin-with-hooks");
  assert.equal(first.context.reportedLane, "plugin-with-hooks");
  assert.match(first.verification.reportedLaneStatement, /host-reported/u);
  assert.match(first.verification.reportedLaneStatement, /not verified/u);
  assert.equal(first.connection.workspaceId, workspaceId);
  assert.equal(first.context.workspaceId, workspaceId);
  assert.equal(first.verification.connection.status, "connected");
  const firstJson = JSON.stringify(first);
  assert.equal(firstJson.includes(intent.connectionUrl), false);
  assert.equal(firstJson.includes(new URL(intent.connectionUrl).hash), false);

  const secondResponse = await invoke();
  const second = (await secondResponse.json()).result.structuredContent;
  assert.equal(second.connected, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.nextAction, "follow_bound_policy");
  assert.deepEqual(second.connection, first.connection);
  assert.deepEqual(second.context, first.context);
  assert.deepEqual(second.verification, first.verification);
  const secondJson = JSON.stringify(second);
  assert.equal(secondJson.includes(intent.connectionUrl), false);
  assert.equal(secondJson.includes(new URL(intent.connectionUrl).hash), false);

  const state = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_agents WHERE workspace_id=?) AS agents,
            (SELECT COUNT(*) FROM tokenless_agent_integrations WHERE workspace_id=?) AS integrations,
            (SELECT COUNT(*) FROM tokenless_agent_integration_events
             WHERE integration_id=? AND event_type='connected') AS connected_events`,
    args: [workspaceId, workspaceId, first.connection.integrationId],
  });
  assert.equal(Number(state.rows[0]?.agents ?? 0), 1);
  assert.equal(Number(state.rows[0]?.integrations ?? 0), 1);
  assert.equal(Number(state.rows[0]?.connected_events ?? 0), 1);
});

test("an owner can recover only a replay-revoked public OAuth integration", async () => {
  const { clientId, intent, principalId, tokens, workspaceId } = await setupOAuthConnectionIntent();
  const initialized = await POST(
    request(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "Recovery MCP client", version: "1.0.0" },
        },
      },
      tokens.access_token,
    ),
  );
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.ok(sessionId);
  const connectedResponse = await POST(
    request(
      {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_connect_workspace", arguments: { connectionUrl: intent.connectionUrl } },
      },
      tokens.access_token,
      sessionId,
    ),
  );
  const connected = (await connectedResponse.json()).result.structuredContent;
  const integrationId = connected.connection.integrationId as string;
  const now = new Date();
  const retainedRefreshToken = `rlo_rt_${"r".repeat(64)}`;
  const originalRefreshHash = createHash("sha256").update(tokens.refresh_token).digest("hex");
  const retainedRefreshHash = createHash("sha256").update(retainedRefreshToken).digest("hex");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_refresh_tokens
          (refresh_token_id,token_hash,token_family_id,client_id,subject_principal_id,audience,resource,
           granted_scopes_json,generation,created_at,expires_at)
          SELECT ?,?,token_family_id,client_id,subject_principal_id,audience,resource,
                 granted_scopes_json,2,created_at,expires_at
          FROM tokenless_agent_oauth_refresh_tokens WHERE token_hash=?`,
    args: [`art_${"f".repeat(32)}`, retainedRefreshHash, originalRefreshHash],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_oauth_refresh_tokens
          SET used_at=?,replaced_at=? WHERE token_hash IN (?,?)`,
    args: [now, now, originalRefreshHash, retainedRefreshHash],
  });
  await assert.rejects(
    () =>
      exchangeAgentOAuthToken({
        grantType: "refresh_token",
        clientId,
        refreshToken: tokens.refresh_token,
        resource: getCanonicalAgentMcpResource(),
      }),
    /replay revoked this token family/u,
  );

  const before = await listAgentConnections({ accountAddress: principalId, workspaceId });
  assert.equal(
    before.integrations.find(integration => integration.integrationId === integrationId)?.oauthRecoveryAvailable,
    true,
  );
  const presented = await dbClient.execute({
    sql: `SELECT generation FROM tokenless_agent_oauth_refresh_tokens
          WHERE revocation_reason='refresh_token_replay_presented'`,
    args: [],
  });
  assert.deepEqual(presented.rows, [{ generation: 1 }]);
  const recovered = await recoverAgentIntegrationOAuth({ accountAddress: principalId, workspaceId, integrationId });
  assert.equal(recovered.integration.oauthRecovered, true);
  const after = await listAgentConnections({ accountAddress: principalId, workspaceId });
  assert.equal(
    after.integrations.find(integration => integration.integrationId === integrationId)?.oauthRecoveryAvailable,
    false,
  );

  const refreshed = await exchangeAgentOAuthToken({
    grantType: "refresh_token",
    clientId,
    refreshToken: tokens.refresh_token,
    resource: getCanonicalAgentMcpResource(),
  });
  assert.equal(refreshed.refresh_token, tokens.refresh_token);
  const obsoleteRefresh = await dbClient.execute({
    sql: `SELECT revoked_at FROM tokenless_agent_oauth_refresh_tokens WHERE token_hash=?`,
    args: [retainedRefreshHash],
  });
  assert.ok(obsoleteRefresh.rows[0]?.revoked_at);
  await assert.rejects(
    () => authenticateAgentMcpPrincipal(`Bearer ${tokens.access_token}`),
    /invalid|expired|revoked/iu,
  );
  assert.equal((await authenticateAgentMcpPrincipal(`Bearer ${refreshed.access_token}`)).kind, "oauth");
  await assert.rejects(
    () => recoverAgentIntegrationOAuth({ accountAddress: principalId, workspaceId, integrationId }),
    /cannot be restored/u,
  );
  const audit = await dbClient.execute({
    sql: `SELECT action,reason FROM tokenless_audit_events
          WHERE workspace_id=? AND target_id=? AND action='agent.oauth_connection_recovered'`,
    args: [workspaceId, integrationId],
  });
  assert.deepEqual(audit.rows, [
    { action: "agent.oauth_connection_recovered", reason: "owner_authorized_refresh_replay_recovery" },
  ]);
});

test("finished automatic private setup lets the connected agent assign an eligible review without manual routing", async () => {
  const privateObjects = new Map<string, Uint8Array>();
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "mcp-setup-acceptance-v1",
    masterKey: Buffer.alloc(32, 7),
    store: {
      async delete(reference) {
        privateObjects.delete(reference);
      },
      async get(reference) {
        const value = privateObjects.get(reference);
        if (!value) throw new Error("Private test object is unavailable.");
        return new Uint8Array(value);
      },
      async put(pathname, body) {
        const reference = `memory://${pathname}`;
        privateObjects.set(reference, new Uint8Array(body));
        return reference;
      },
    },
  });
  const { principalId, tokens, workspaceId } = await setupOAuthConnectionIntent();
  const setupIntent = await createWorkspaceAgentSetupConnection({
    accountAddress: principalId,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
    revision: 1,
  });
  const initialized = await POST(
    request(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: true } },
          clientInfo: { name: "Setup acceptance client", version: "1.0.0" },
        },
      },
      tokens.access_token,
    ),
  );
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.ok(sessionId);
  async function call(id: number, name: string, args: Record<string, unknown>) {
    const response = await POST(
      request(
        { id, jsonrpc: "2.0", method: "tools/call", params: { name, arguments: args } },
        tokens.access_token,
        sessionId!,
      ),
    );
    const body = await response.json();
    assert.ok(body.result?.structuredContent, JSON.stringify(body));
    assert.notEqual(body.result.isError, true, JSON.stringify(body));
    return body.result.structuredContent;
  }

  const connected = await call(2, "rateloop_connect_workspace", { connectionUrl: setupIntent.connectionUrl });
  assert.equal(connected.connected, true);
  const setup = await getWorkspaceAgentSetup({ accountAddress: principalId, workspaceId });
  assert.ok(setup.agent);
  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: principalId,
    workspaceId,
    revision: setup.revision,
    agent: {
      displayName: setup.agent.displayName,
      description: setup.agent.description,
      provider: setup.agent.provider,
      model: setup.agent.model,
      modelVersion: setup.agent.modelVersion,
      environment: "production",
    },
  });
  const group = await createPrivateGroup({
    accountAddress: principalId,
    workspaceId,
    name: "Setup acceptance reviewers",
    purpose: "Review private output from the connected setup acceptance agent.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  await addRedeemedPrivateReviewer({
    accountAddress: PRIVATE_REVIEWER_A,
    email: "setup-reviewer-a@example.test",
    ownerAddress: principalId,
    workspaceId,
  });
  await addRedeemedPrivateReviewer({
    accountAddress: PRIVATE_REVIEWER_B,
    email: "setup-reviewer-b@example.test",
    ownerAddress: principalId,
    workspaceId,
  });
  const saved = await putHumanReviewConfigurationForOwner({
    accountAddress: principalId,
    workspaceId,
    agentId: setup.agent.agentId,
    body: {
      expectedBindingVersion: null,
      selection: {
        mode: "always",
        enforcementMode: "advisory",
        agreementThresholdBps: 8_000,
        productionFloorBps: 0,
        fixedRateBps: null,
        maximumUnreviewedGap: 20,
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7_000,
        maximumLatencyMs: 120_000,
      },
      requestProfile: {
        questionAuthority: "owner_fixed",
        criterion: "Is this response safe and correct?",
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        rationaleMode: "required",
        audience: "private_invited",
        contentBoundary: "private_workspace",
        privateSensitivity: "confidential",
        privateGroupId: group.groupId,
        responseWindowSeconds: 3_600,
        panelSize: 2,
        compensationMode: "unpaid",
        bountyPerSeatAtomic: null,
        feedbackBonusEnabled: false,
      },
      authority: "ask_automatically",
      publishingGrant: {
        integrationId: setup.connection.integrationId!,
        provision: "private_invited_unpaid",
        allowedWorkflowKeys: ["general-assistance"],
      },
    },
  });
  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: principalId,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: saved.configuration.version,
  });
  const finalized = await finalizeWorkspaceAgentSetup({
    accountAddress: principalId,
    workspaceId,
    revision: reviews.revision,
    idempotencyKey: "d5742714-44c4-41b9-a18d-cdf0c58f9692",
    decision: "later",
    groupId: group.groupId,
    createInvitation: false,
  });
  assert.equal(finalized.postcondition.privateRouting?.ready, true);
  assert.equal(finalized.postcondition.reviewerRoutingStatus, "ready");
  assert.equal(finalized.postcondition.canSend, true);
  const managedRouting = finalized.postcondition.privateRouting!;

  const context = await call(3, "rateloop_get_agent_context", {});
  assert.equal(context.humanReview.authority, "ask_automatically");
  assert.equal(context.capabilities.effectiveLane.lane, "private_invited_unpaid");
  assert.equal(context.publishingGrant.active, true);
  assert.equal(context.safeAccess.canPublish, true);
  assert.ok(context.publishingGrant.grantedScopes.includes("panel:publish"));
  assert.ok(!context.publishingGrant.grantedScopes.includes("payment:submit"));

  const sourcePayload = JSON.stringify({ case: "private support request", revision: 1 });
  const suggestionPayload = JSON.stringify({ answer: "A safe candidate response." });
  const textHash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const evaluation = await call(4, "rateloop_evaluate_review_requirement", {
    externalOpportunityId: "setup-private-review-opportunity-0001",
    workflowKey: "general-assistance",
    riskTier: "high",
    audiencePolicyHash: context.reviewPolicy.audiencePolicyHash,
    suggestionCommitment: textHash(suggestionPayload),
    sourceEvidence: {
      reference: "case/setup-private-review-opportunity-0001/revision-1",
      hash: textHash(sourcePayload),
    },
    declaredConfidenceBps: 8_500,
    criticalRisk: false,
    metadataComplete: true,
    execution: {
      externalExecutionId: "execution-setup-private-review-0001",
      status: "completed",
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary",
          provider: "OpenAI",
          requestedModel: "gpt-test",
          resolvedModel: "gpt-test-2026-07-19",
          reasoningEffort: "low",
          serviceTier: "default",
          inputTokens: 120,
          outputTokens: 40,
          reasoningOutputTokens: 10,
        },
      ],
    },
  });
  assert.equal(evaluation.decision, "required");

  const routed = await call(5, "rateloop_request_review", {
    opportunityId: evaluation.opportunityId,
    sourcePayload,
    suggestionPayload,
    material: {
      kind: "private",
      sourceContentType: "application/json",
      suggestionContentType: "application/json",
    },
  });
  assert.equal(routed.action, "private_review_assigned");
  assert.equal(routed.foundation.bindings.project.projectId, managedRouting.projectId);
  assert.equal(routed.foundation.bindings.cohort.cohortId, managedRouting.cohortId);
  assert.deepEqual(
    routed.delivery.assignments.map(
      (assignment: { reviewerAccountAddress: string }) => assignment.reviewerAccountAddress,
    ),
    [PRIVATE_REVIEWER_A, PRIVATE_REVIEWER_B],
  );
  const stored = await dbClient.execute({
    sql: `SELECT project_id,cohort_id FROM tokenless_private_review_requests WHERE private_review_id=?`,
    args: [routed.foundation.privateReviewId],
  });
  assert.deepEqual(stored.rows, [{ project_id: managedRouting.projectId, cohort_id: managedRouting.cohortId }]);
});

test("OAuth keeps one stable tool list and fails closed for unavailable paid-network delivery", async () => {
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

  const initialized = await POST(
    request(
      {
        id: 9,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: { elicitation: { form: {} }, tools: { listChanged: true } },
          clientInfo: { name: "Cross-host MCP client", version: "1.0.0" },
        },
      },
      tokens.access_token,
    ),
  );
  const initializedBody = await initialized.json();
  assert.equal(initializedBody.result.protocolVersion, "2025-11-25");
  const sessionId = initialized.headers.get("mcp-session-id");
  assert.match(sessionId ?? "", /^mcps_[A-Za-z0-9_-]{32,128}$/u);
  const sessionHash = `sha256:${createHash("sha256").update(sessionId!).digest("hex")}`;
  const initialSession = await dbClient.execute({
    sql: `SELECT workspace_id,integration_id,subject_principal_id,token_family_id,elicitation_mode
          FROM tokenless_mcp_sessions WHERE session_hash=?`,
    args: [sessionHash],
  });
  assert.equal(initialSession.rows[0]?.workspace_id, null);
  assert.equal(initialSession.rows[0]?.integration_id, null);
  assert.equal(initialSession.rows[0]?.subject_principal_id, principalId);
  assert.equal(initialSession.rows[0]?.elicitation_mode, "form");
  const oauthRequest = (value: unknown) => request(value, tokens.access_token, sessionId!);
  const initializedNotification = await POST(
    oauthRequest({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  );
  assert.equal(initializedNotification.status, 202);
  assert.equal(initializedNotification.headers.get("mcp-session-id"), sessionId);
  const missingSession = await POST(
    request({ id: 901, jsonrpc: "2.0", method: "tools/list", params: {} }, tokens.access_token),
  );
  assert.equal(missingSession.status, 400);
  assert.equal((await missingSession.json()).error.data.code, "mcp_session_required");

  const names = [
    "rateloop_connect_workspace",
    "rateloop_claim_connection_intent",
    "rateloop_get_agent_context",
    "rateloop_verify_connection",
    "rateloop_list_open_reviews",
    "rateloop_get_assurance_state",
    "rateloop_evaluate_review_requirement",
    "rateloop_request_review",
    "rateloop_wait_for_review",
    "rateloop_get_review_result",
  ];
  const before = await POST(oauthRequest({ id: 10, jsonrpc: "2.0", method: "tools/list", params: {} }));
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
  assert.deepEqual(tool("rateloop_connect_workspace")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.match(tool("rateloop_connect_workspace")?.description ?? "", /Preferred one-call workspace connection/u);
  assert.match(tool("rateloop_connect_workspace")?.description ?? "", /never returned/u);
  assert.deepEqual(tool("rateloop_connect_workspace")?.inputSchema?.required, ["connectionUrl"]);
  assert.deepEqual(
    (tool("rateloop_connect_workspace")?.inputSchema?.properties?.reportedLane as { enum?: string[] })?.enum,
    ["plugin-with-hooks", "mcp-oauth"],
  );
  assert.match(
    (tool("rateloop_claim_connection_intent")?.inputSchema?.properties?.reportedLane as { description?: string })
      ?.description ?? "",
    /host-reported and never verified/u,
  );
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
  assert.deepEqual(tool("rateloop_list_open_reviews")?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.match(tool("rateloop_list_open_reviews")?.description ?? "", /never returns review content/u);
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
  assert.match(requestReviewTool?.description ?? "", /exact reviewer-visible source and completed candidate/);
  assert.match(requestReviewTool?.description ?? "", /Check-only records the requirement without preparing/);
  assert.match(requestReviewTool?.description ?? "", /requires one binary agent-written question/);
  assert.match(requestReviewTool?.description ?? "", /derives the panel, response window, bounty, fee/);
  assert.equal("economics" in (requestReviewTool?.inputSchema?.properties ?? {}), false);
  assert.deepEqual(requestReviewTool?.inputSchema?.required, ["opportunityId", "sourcePayload", "suggestionPayload"]);
  assert.deepEqual(requestReviewTool?.inputSchema?.properties?.question, {
    additionalProperties: false,
    properties: {
      kind: { const: "binary", type: "string" },
      prompt: { maxLength: 500, minLength: 1, type: "string" },
      positiveLabel: { maxLength: 40, minLength: 1, type: "string" },
      negativeLabel: { maxLength: 40, minLength: 1, type: "string" },
    },
    required: ["kind", "prompt", "positiveLabel", "negativeLabel"],
    type: "object",
  });
  assert.deepEqual(requestReviewTool?.inputSchema?.properties?.material, {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          kind: { const: "public", type: "string" },
          publication: {
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
          },
        },
        required: ["kind", "publication"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          kind: { const: "private", type: "string" },
          sourceContentType: { maxLength: 160, minLength: 1, type: "string" },
          suggestionContentType: { maxLength: 160, minLength: 1, type: "string" },
        },
        required: ["kind", "sourceContentType", "suggestionContentType"],
        type: "object",
      },
    ],
  });
  const claimed = await POST(
    oauthRequest({
      id: 12,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_claim_connection_intent", arguments: { connectionUrl: intent.connectionUrl } },
    }),
  );
  const claim = (await claimed.json()).result.structuredContent;
  assert.equal(claim.connection.status, "testing");
  const claimedSession = await dbClient.execute({
    sql: `SELECT workspace_id,integration_id,subject_principal_id,token_family_id
          FROM tokenless_mcp_sessions WHERE session_hash=?`,
    args: [sessionHash],
  });
  assert.equal(claimedSession.rows[0]?.workspace_id, workspaceId);
  assert.equal(claimedSession.rows[0]?.integration_id, claim.connection.integrationId);
  assert.equal(claimedSession.rows[0]?.subject_principal_id, principalId);
  assert.equal(claimedSession.rows[0]?.token_family_id, initialSession.rows[0]?.token_family_id);
  const atomicRecoveryResponse = await POST(
    oauthRequest({
      id: 121,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_connect_workspace", arguments: { connectionUrl: intent.connectionUrl } },
    }),
  );
  const atomicRecovery = (await atomicRecoveryResponse.json()).result.structuredContent;
  assert.equal(atomicRecovery.schemaVersion, "rateloop.workspace-connection.v1");
  assert.equal(atomicRecovery.connected, true);
  assert.equal(atomicRecovery.idempotent, true);
  assert.equal(atomicRecovery.connection.status, "connected");
  assert.equal(atomicRecovery.context.workspaceId, workspaceId);
  assert.equal(atomicRecovery.verification.connection.status, "connected");
  assert.equal(JSON.stringify(atomicRecovery).includes(intent.connectionUrl), false);
  assert.equal(JSON.stringify(atomicRecovery).includes(new URL(intent.connectionUrl).hash), false);
  const context = await POST(
    oauthRequest({
      id: 13,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_get_agent_context", arguments: {} },
    }),
  );
  const agentContext = (await context.json()).result.structuredContent;
  assert.deepEqual(atomicRecovery.context, agentContext);
  assert.equal(agentContext.schemaVersion, "rateloop.agent-context.v2");
  assert.equal(agentContext.workspaceId, workspaceId);
  assert.equal(agentContext.enforcementBoundary, "advisory");
  assert.equal(agentContext.reportedLane, "mcp-oauth");
  assert.match(agentContext.reviewPolicy.audiencePolicyHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(agentContext.publishingPolicy, null);
  assert.equal(agentContext.humanReview.status, "configuration_required");
  assert.equal(agentContext.publishingGrant.active, false);
  assert.equal(agentContext.publishingGrant.reason, "not_configured");
  assert.equal(agentContext.safeAccess.canSpend, false);
  const verified = await POST(
    oauthRequest({
      id: 14,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_verify_connection", arguments: {} },
    }),
  );
  const firstVerification = (await verified.json()).result.structuredContent;
  assert.deepEqual(atomicRecovery.verification, firstVerification);
  assert.equal(firstVerification.connection.status, "connected");
  assert.equal(firstVerification.connection.reportedLane, "mcp-oauth");
  assert.match(firstVerification.reportedLaneStatement, /plugin hooks not reported/u);
  const ping = await POST(oauthRequest({ id: 15, jsonrpc: "2.0", method: "ping", params: {} }));
  assert.deepEqual((await ping.json()).result, {});
  const afterVerification = await POST(oauthRequest({ id: 16, jsonrpc: "2.0", method: "tools/list", params: {} }));
  assert.deepEqual(
    (await afterVerification.json()).result.tools.map((tool: { name: string }) => tool.name),
    names,
  );

  const invalidInitialization = await POST(
    request(
      {
        id: 140,
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      },
      tokens.access_token,
    ),
  );
  assert.ok((await invalidInitialization.json()).error);
  assert.equal(invalidInitialization.headers.get("mcp-session-id"), null);
  const sessionsAfterInvalidInitialize = await dbClient.execute({
    sql: "SELECT COUNT(*) AS total FROM tokenless_mcp_sessions",
    args: [],
  });
  assert.equal(Number(sessionsAfterInvalidInitialize.rows[0]?.total ?? 0), 1);

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
  assert.match(resumedInitializationBody.result.instructions, /exact human-review configuration/i);
  assert.match(resumedInitializationBody.result.instructions, /publishing-policy reference alone never grants/i);
  assert.match(resumedInitializationBody.result.instructions, /safeAccess and the exact publishingGrant/i);
  const resumedSessionId = resumedInitialization.headers.get("mcp-session-id");
  assert.match(resumedSessionId ?? "", /^mcps_[A-Za-z0-9_-]{32,128}$/u);
  const currentSession = await dbClient.execute({
    sql: `SELECT protocol_version,elicitation_mode FROM tokenless_mcp_sessions
          WHERE session_hash=?`,
    args: [`sha256:${createHash("sha256").update(resumedSessionId!).digest("hex")}`],
  });
  assert.deepEqual(currentSession.rows[0], {
    protocol_version: "2025-11-25",
    elicitation_mode: "none",
  });
  const resumedRequest = (value: unknown) => request(value, tokens.access_token, resumedSessionId!);
  const connectedPrincipal = await authenticateAgentMcpPrincipal(`Bearer ${tokens.access_token}`);
  await requireWorkspaceMcpSession({
    sessionId: resumedSessionId!,
    principal: connectedPrincipal,
    protocolVersion: "2025-11-25",
  });

  const resumedTools = await POST(resumedRequest({ id: 142, jsonrpc: "2.0", method: "tools/list", params: {} }));
  const resumedToolsBody = await resumedTools.json();
  assert.ok(resumedToolsBody.result, JSON.stringify(resumedToolsBody));
  assert.deepEqual(
    resumedToolsBody.result.tools.map((candidate: { name: string }) => candidate.name),
    names,
  );

  const repeatedClaim = await POST(
    resumedRequest({
      id: 143,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_claim_connection_intent", arguments: { connectionUrl: intent.connectionUrl } },
    }),
  );
  const resumedClaim = (await repeatedClaim.json()).result.structuredContent;
  assert.equal(resumedClaim.idempotent, true);
  assert.equal(resumedClaim.connection.integrationId, claim.connection.integrationId);
  assert.equal(resumedClaim.connection.status, "connected");

  const resumedContext = await POST(
    resumedRequest({
      id: 144,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_get_agent_context", arguments: {} },
    }),
  );
  assert.deepEqual((await resumedContext.json()).result.structuredContent, agentContext);

  const repeatedVerification = await POST(
    resumedRequest({
      id: 145,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_verify_connection", arguments: {} },
    }),
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
  const after = await POST(resumedRequest({ id: 146, jsonrpc: "2.0", method: "tools/list", params: {} }));
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
      allowedReviewerSources: ["rateloop_network"],
      allowedAdmissionPolicyHashes: [`0x${"22".repeat(32)}`],
      allowedDataClassifications: ["public"],
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
    resumedRequest({
      id: 151,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_get_agent_context", arguments: {} },
    }),
  );
  const upgradedContext = (await upgradedContextResponse.json()).result.structuredContent;
  assert.equal(upgradedContext.agentVersionId, stepUp.integration.agentVersionId);
  assert.deepEqual(upgradedContext.reviewPolicy, {
    policyId: stepUp.integration.reviewPolicyId,
    version: stepUp.integration.reviewPolicyVersion,
    audiencePolicyHash: agentContext.reviewPolicy.audiencePolicyHash,
  });
  assert.equal(upgradedContext.publishingPolicy, null);
  assert.deepEqual(upgradedContext.publishingGrant.integrationPolicy, {
    policyId: publishing.policyId,
    version: publishing.version,
  });
  assert.equal(upgradedContext.publishingGrant.active, false);
  assert.equal(upgradedContext.publishingGrant.reason, "not_configured");
  assert.equal(upgradedContext.safeAccess.canSpend, false);
  assert.equal(upgradedContext.safeAccess.canPublish, false);

  const configured = await putHumanReviewConfigurationForOwner({
    accountAddress: principalId,
    workspaceId,
    agentId: claim.connection.agentId,
    body: {
      expectedBindingVersion: null,
      selection: {
        mode: "fixed",
        enforcementMode: "advisory",
        agreementThresholdBps: 7_500,
        productionFloorBps: 0,
        fixedRateBps: 2_500,
        maximumUnreviewedGap: 8,
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7_000,
        maximumLatencyMs: 120_000,
      },
      requestProfile: {
        questionAuthority: "owner_fixed",
        criterion: "Is this output correct and safe to use?",
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        rationaleMode: "optional",
        audience: "public_network",
        contentBoundary: "public_or_test",
        privateSensitivity: null,
        privateGroupId: null,
        requiredExpertiseKeys: ["code-review:security"],
        responseWindowSeconds: 3_600,
        panelSize: 5,
        compensationMode: "usdc",
        bountyPerSeatAtomic: "1000000",
      },
      authority: "ask_automatically",
      publishingGrant: {
        integrationId: claim.connection.integrationId,
        publishingPolicyId: publishing.policyId,
        publishingPolicyVersion: publishing.version,
        allowedWorkflowKeys: ["general-assistance"],
      },
    },
  });
  assert.equal(configured.configuration.authority, "ask_automatically");
  const configuredContextResponse = await POST(
    resumedRequest({
      id: 1511,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "rateloop_get_agent_context", arguments: {} },
    }),
  );
  const configuredContext = (await configuredContextResponse.json()).result.structuredContent;
  assert.equal(configuredContext.humanReview.binding.bindingId, configured.configuration.bindingId);
  assert.deepEqual(configuredContext.humanReview.selection.frequency, {
    mode: "fixed",
    fixedRateBps: 2_500,
    agreementThresholdBps: 7_500,
    productionFloorBps: 0,
    maximumUnreviewedGap: 8,
  });
  assert.equal(configuredContext.humanReview.requestProfile.audience.type, "public_network");
  assert.equal(configuredContext.humanReview.requestProfile.audience.contentBoundary, "public_or_test");
  assert.equal(configuredContext.humanReview.requestProfile.responseWindowSeconds, 3_600);
  assert.equal(configuredContext.humanReview.requestProfile.panelSize, 5);
  assert.deepEqual(configuredContext.humanReview.requestProfile.compensation, {
    mode: "usdc",
    bountyPerSeatAtomic: "1000000",
  });
  assert.equal(configuredContext.humanReview.authority, "ask_automatically");
  assert.equal(configuredContext.capabilities.implementedLanes.privateInvitedUnpaid.available, true);
  assert.equal(configuredContext.capabilities.implementedLanes.privateInvitedPaid.available, false);
  assert.equal(configuredContext.capabilities.implementedLanes.publicPaidNetwork.available, false);
  assert.equal(configuredContext.capabilities.implementedLanes.hybridPublicSafe.available, false);
  assert.equal(configuredContext.capabilities.effectiveLane.lane, "public_paid_network");
  assert.equal(configuredContext.publishingGrant.active, true);
  assert.ok(configuredContext.publishingGrant.grantedScopes.includes("panel:publish"));
  assert.ok(configuredContext.publishingGrant.grantedScopes.includes("payment:submit"));
  assert.equal(configuredContext.safeAccess.canSpend, false);
  assert.equal(configuredContext.safeAccess.canPublish, false);
  const approvalConfigured = await putHumanReviewConfigurationForOwner({
    accountAddress: principalId,
    workspaceId,
    agentId: claim.connection.agentId,
    body: {
      expectedBindingVersion: configured.configuration.version,
      selection: {
        mode: "fixed",
        enforcementMode: "advisory",
        agreementThresholdBps: 7_500,
        productionFloorBps: 0,
        fixedRateBps: 10_000,
        maximumUnreviewedGap: 1,
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7_000,
        maximumLatencyMs: 120_000,
      },
      requestProfile: {
        questionAuthority: "owner_fixed",
        criterion: "Is this output correct and safe to use?",
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        rationaleMode: "optional",
        audience: "public_network",
        contentBoundary: "public_or_test",
        privateSensitivity: null,
        privateGroupId: null,
        requiredExpertiseKeys: ["code-review:security"],
        responseWindowSeconds: 3_600,
        panelSize: 5,
        compensationMode: "usdc",
        bountyPerSeatAtomic: "1000000",
      },
      authority: "prepare_for_approval",
      publishingGrant: null,
    },
  });
  assert.equal(approvalConfigured.configuration.authority, "prepare_for_approval");
  const upgradedInitialization = await POST(
    request(
      {
        id: 152,
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
  const upgradedInitializationBody = await upgradedInitialization.json();
  assert.match(upgradedInitializationBody.result.instructions, /publishing-policy reference alone never grants/i);
  assert.match(upgradedInitializationBody.result.instructions, /safeAccess and the exact publishingGrant/i);
  const mismatchedProtocol = await POST(
    request(
      { id: 153, jsonrpc: "2.0", method: "tools/list", params: {} },
      tokens.access_token,
      sessionId!,
      "2025-06-18",
    ),
  );
  assert.equal(mismatchedProtocol.status, 404);
  assert.equal((await mismatchedProtocol.json()).error.data.code, "mcp_session_not_found");

  const stableInitialization = await POST(
    request(
      {
        id: 154,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { elicitation: {} },
          clientInfo: { name: "Stable MCP client", version: "1.0.0" },
        },
      },
      tokens.access_token,
      undefined,
      "2025-06-18",
    ),
  );
  const stableSessionId = stableInitialization.headers.get("mcp-session-id");
  assert.match(stableSessionId ?? "", /^mcps_[A-Za-z0-9_-]{32,128}$/u);
  const stableSession = await dbClient.execute({
    sql: `SELECT protocol_version,elicitation_mode FROM tokenless_mcp_sessions
          WHERE session_hash=?`,
    args: [`sha256:${createHash("sha256").update(stableSessionId!).digest("hex")}`],
  });
  assert.deepEqual(stableSession.rows[0], {
    protocol_version: "2025-06-18",
    elicitation_mode: "form",
  });
  const stableTools = await POST(
    request(
      { id: 155, jsonrpc: "2.0", method: "tools/list", params: {} },
      tokens.access_token,
      stableSessionId!,
      "2025-06-18",
    ),
  );
  assert.ok((await stableTools.json()).result.tools);
  const stableContextResponse = await POST(
    request(
      {
        id: 156,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      tokens.access_token,
      stableSessionId!,
      "2025-06-18",
    ),
  );
  const stableContext = (await stableContextResponse.json()).result.structuredContent;
  assert.equal(stableContext.humanReview.authority, "prepare_for_approval");
  const sourcePayload = JSON.stringify({ source: "public fixture", revision: 1 });
  const suggestionPayload = JSON.stringify({ answer: "candidate" });
  const evaluated = await POST(
    request(
      {
        id: 157,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rateloop_evaluate_review_requirement",
          arguments: {
            externalOpportunityId: "mcp-elicitation-opportunity-0001",
            workflowKey: "general-assistance",
            riskTier: "high",
            audiencePolicyHash: stableContext.reviewPolicy.audiencePolicyHash,
            suggestionCommitment: `sha256:${createHash("sha256").update(suggestionPayload).digest("hex")}`,
            sourceEvidence: {
              reference: "case/mcp-elicitation-opportunity-0001/revision-1",
              hash: `sha256:${createHash("sha256").update(sourcePayload).digest("hex")}`,
            },
            declaredConfidenceBps: 8_000,
            criticalRisk: false,
            metadataComplete: true,
            execution: {
              externalExecutionId: "execution-mcp-elicitation-0001",
              status: "completed",
              primarySpanId: "generation-primary",
              generationSpans: [
                {
                  spanId: "generation-primary",
                  role: "primary",
                  provider: "OpenAI",
                  requestedModel: "gpt-test",
                  resolvedModel: "gpt-test-2026-07-01",
                  reasoningEffort: "low",
                  serviceTier: "default",
                  inputTokens: 120,
                  outputTokens: 30,
                  reasoningOutputTokens: 8,
                },
              ],
            },
          },
        },
      },
      tokens.access_token,
      stableSessionId!,
      "2025-06-18",
    ),
  );
  const evaluation = (await evaluated.json()).result.structuredContent;
  assert.equal(evaluation.decision, "required");
  const prepared = await POST(
    request(
      {
        id: 158,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rateloop_request_review",
          arguments: {
            opportunityId: evaluation.opportunityId,
            sourcePayload,
            suggestionPayload,
            material: {
              kind: "public",
              publication: {
                visibility: "public",
                dataClassification: "synthetic",
                confirmedNoSensitiveData: true,
              },
            },
          },
        },
      },
      tokens.access_token,
      stableSessionId!,
      "2025-06-18",
    ),
  );
  const preparedPayload = await prepared.json();
  assert.ok(preparedPayload.result, JSON.stringify(preparedPayload));
  const preparedResult = preparedPayload.result.structuredContent;
  assert.equal(preparedResult.action, "blocked", JSON.stringify(preparedResult));
  assert.equal(preparedResult.code, "lane_not_implemented");
  assert.deepEqual(preparedResult.sideEffects, {
    prepared: false,
    published: false,
    assigned: false,
    fundsReserved: false,
    spent: false,
  });
  const queued = await dbClient.execute({
    sql: `SELECT request_id,state FROM tokenless_mcp_elicitation_requests WHERE session_hash=?`,
    args: [`sha256:${createHash("sha256").update(stableSessionId!).digest("hex")}`],
  });
  assert.equal(queued.rowCount, 0);
  const emptyStream = await GET(streamRequest(tokens.access_token, stableSessionId!, "2025-06-18"));
  assert.equal(emptyStream.status, 200);
  assert.match(emptyStream.headers.get("content-type") ?? "", /^text\/event-stream/u);
  assert.equal(await emptyStream.text(), ": keep-alive\n\n");
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
  await requestWorkspaceDeletion({
    accountAddress: principalId,
    workspaceId,
    confirmationName: "One-message OAuth",
    identityAssurance: "better_auth:passkey",
  });
  const revoked = await POST(resumedRequest({ id: 160, jsonrpc: "2.0", method: "tools/list", params: {} }));
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  const revokedFamily = await dbClient.execute({
    sql: `SELECT f.status,f.revocation_reason
          FROM tokenless_agent_oauth_token_families f
          JOIN tokenless_agent_integrations i ON i.token_family_id=f.token_family_id
          WHERE i.integration_id=?`,
    args: [claim.connection.integrationId],
  });
  assert.deepEqual(revokedFamily.rows[0], { status: "revoked", revocation_reason: "workspace_deleted" });
});

test("agent context reports the exact configured profile while a legacy publishing reference grants nothing", async () => {
  const setupData = await setup();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies SET audience_policy_json = ?
          WHERE workspace_id = ? AND policy_id = ? AND version = 1`,
    args: [
      JSON.stringify({ reviewerSource: "public_network" }),
      setupData.workspaceId,
      setupData.approved.integration.reviewPolicyId,
    ],
  });
  const contextResponse = await POST(
    request(
      {
        id: 0,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_get_agent_context", arguments: {} },
      },
      setupData.token,
    ),
  );
  const context = (await contextResponse.json()).result.structuredContent;
  assert.equal(context.humanReview.status, "configured");
  assert.equal(context.humanReview.binding.bindingId, setupData.reviewBinding.bindingId);
  assert.equal(context.humanReview.authority, "check_only");
  assert.equal(context.humanReview.selection.frequency.mode, "adaptive");
  assert.equal(context.humanReview.requestProfile.audience.type, "public_network");
  assert.equal(context.humanReview.requestProfile.responseWindowSeconds, 1_200);
  assert.equal(context.humanReview.requestProfile.panelSize, 3);
  assert.deepEqual(context.humanReview.requestProfile.compensation, {
    mode: "usdc",
    bountyPerSeatAtomic: "1000000",
  });
  assert.equal(context.publishingPolicy, null);
  assert.ok(context.publishingGrant.integrationPolicy);
  assert.equal(context.publishingGrant.active, false);
  assert.equal(context.publishingGrant.reason, "not_configured");
  assert.equal(context.safeAccess.canPublish, false);
  assert.equal(context.safeAccess.canSpend, false);
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
      "rateloop_list_open_reviews",
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
    execution: {
      externalExecutionId: "execution-mcp-opportunity-0001",
      status: "completed",
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary",
          provider: "OpenAI",
          requestedModel: "gpt-5.6-terra",
          resolvedModel: "gpt-5.6-terra-2026-07-01",
          reasoningEffort: "low",
          serviceTier: "fast",
          inputTokens: 1200,
          outputTokens: 300,
          reasoningOutputTokens: 80,
        },
      ],
    },
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
  const decidedBody = await decided.json();
  assert.ok(decidedBody.result?.structuredContent, JSON.stringify(decidedBody));
  const decision = decidedBody.result.structuredContent;
  assert.equal(decision.decision, "required", JSON.stringify(decision));
  assert.equal(decision.policyFrozen, true);
  assert.equal(decision.stage, "calibrating");
  assert.equal(decision.executionProfile.primary.resolvedModel, "gpt-5.6-terra-2026-07-01");
  assert.equal(decision.executionProfile.primary.reasoningEffort, "low");
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

test("rediscovers only the bound integration's active reviews with safe bounded pagination after restart", async () => {
  const primary = await setup();
  const isolated = await setup();

  function opportunityArguments(id: string) {
    return {
      externalOpportunityId: `rediscovery-${id}`,
      workflowKey: "support-reply",
      riskTier: "low",
      audiencePolicyHash: primary.audiencePolicyHash,
      suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ answer: id }),
      sourceEvidence: {
        reference: `private/source/${id}`,
        hash: __adaptiveReviewServiceTestUtils.sha256({ privateSource: id }),
      },
      declaredConfidenceBps: 8_500,
      metadataComplete: true,
      execution: {
        externalExecutionId: `rediscovery-execution-${id}`,
        status: "completed",
        primarySpanId: "primary",
        generationSpans: [
          {
            spanId: "primary",
            role: "primary",
            provider: "OpenAI",
            requestedModel: "gpt-test",
          },
        ],
      },
    };
  }

  async function evaluate(token: string, args: ReturnType<typeof opportunityArguments>, id: number) {
    const response = await POST(
      request(
        {
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "rateloop_evaluate_review_requirement", arguments: args },
        },
        token,
      ),
    );
    const body = await response.json();
    assert.ok(body.result?.structuredContent?.opportunityId, JSON.stringify(body));
    return body.result.structuredContent.opportunityId as string;
  }

  async function list(token: string, args: Record<string, unknown>, id: number) {
    const response = await POST(
      request(
        {
          id,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "rateloop_list_open_reviews", arguments: args },
        },
        token,
      ),
    );
    const body = await response.json();
    assert.ok(body.result?.structuredContent, JSON.stringify(body));
    return body.result.structuredContent as {
      schemaVersion: string;
      items: Array<{
        opportunityId: string;
        workflowKey: string;
        riskTier: string;
        createdAt: string;
        lifecycle: { state: string; revision: number; stateEnteredAt: string; updatedAt: string };
        nextAction: string;
      }>;
      nextCursor: string | null;
    };
  }

  const approvalRequired = await evaluate(primary.token, opportunityArguments("approval"), 201);
  const pending = await evaluate(primary.token, opportunityArguments("pending"), 202);
  const blocked = await evaluate(primary.token, opportunityArguments("blocked"), 203);
  const requestReady = await evaluate(primary.token, opportunityArguments("request-ready"), 204);
  const terminal = await evaluate(primary.token, opportunityArguments("terminal-private-payload"), 205);
  const isolatedOpportunity = await evaluate(
    isolated.token,
    { ...opportunityArguments("other-workspace"), audiencePolicyHash: isolated.audiencePolicyHash },
    206,
  );

  const transitionedAt = new Date(Date.now() + 1_000);
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_opportunity_lifecycles
          SET state='pending', state_revision=3, state_entered_at=?, updated_at=?
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [transitionedAt, transitionedAt, primary.workspaceId, pending],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_opportunity_lifecycles
          SET state='blocked', state_revision=3, state_entered_at=?, updated_at=?
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [transitionedAt, transitionedAt, primary.workspaceId, blocked],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_opportunity_lifecycles
          SET state='request_ready', state_revision=3, state_entered_at=?, updated_at=?
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [transitionedAt, transitionedAt, primary.workspaceId, requestReady],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_opportunity_lifecycles
          SET state='completed', state_revision=3, state_entered_at=?, terminal_at=?, updated_at=?
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [transitionedAt, transitionedAt, transitionedAt, primary.workspaceId, terminal],
  });

  const first = await list(primary.token, { limit: 2 }, 207);
  assert.equal(first.schemaVersion, "rateloop.open-human-reviews.v1");
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await list(primary.token, { cursor: first.nextCursor, limit: 2 }, 208);
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);

  const items = [...first.items, ...second.items];
  assert.deepEqual(
    items.map(item => item.opportunityId).sort(),
    [approvalRequired, pending, blocked, requestReady].sort(),
  );
  assert.equal(
    items.some(item => item.opportunityId === terminal),
    false,
  );
  assert.equal(
    items.some(item => item.opportunityId === isolatedOpportunity),
    false,
  );
  assert.deepEqual(Object.fromEntries(items.map(item => [item.lifecycle.state, item.nextAction])), {
    approval_required: "rateloop_request_review",
    blocked: "rateloop_get_agent_context",
    pending: "rateloop_wait_for_review",
    request_ready: "rateloop_request_review",
  });
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "createdAt",
      "lifecycle",
      "nextAction",
      "opportunityId",
      "riskTier",
      "workflowKey",
    ]);
    assert.deepEqual(Object.keys(item.lifecycle).sort(), ["revision", "state", "stateEnteredAt", "updatedAt"]);
  }
  const serialized = JSON.stringify(items);
  assert.equal(serialized.includes("private/source"), false);
  assert.equal(serialized.includes("terminal-private-payload"), false);
  assert.equal(serialized.includes("suggestionCommitment"), false);
  assert.equal(serialized.includes("sourceEvidence"), false);
  assert.equal(serialized.includes("operationKey"), false);
  assert.equal(serialized.includes("executionId"), false);

  // Every call reauthenticates from persisted state, so a fresh un-cursored request models agent restart recovery.
  const afterRestart = await list(primary.token, { limit: 50 }, 209);
  assert.deepEqual(
    afterRestart.items.map(item => item.opportunityId).sort(),
    [approvalRequired, pending, blocked, requestReady].sort(),
  );

  const invalidCursor = await POST(
    request(
      {
        id: 210,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "rateloop_list_open_reviews", arguments: { cursor: "not-a-cursor" } },
      },
      primary.token,
    ),
  );
  const invalidCursorBody = await invalidCursor.json();
  assert.equal(invalidCursorBody.result.isError, true);
  assert.equal(invalidCursorBody.result.structuredContent.code, "invalid_open_review_query");
});

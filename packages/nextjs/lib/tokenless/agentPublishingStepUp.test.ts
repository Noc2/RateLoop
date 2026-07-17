import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { POST as activatePublishingRoute } from "~~/app/api/account/workspaces/[workspaceId]/agent-integrations/[integrationId]/publishing/route";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  claimAgentConnectionIntent,
  createAgentConnectionIntent,
  verifyAgentConnection,
} from "~~/lib/tokenless/agentConnectionIntents";
import {
  OWNER_APPROVED_AGENT_SCOPES,
  activateAgentIntegrationPublishing,
  authenticateAgentMcpPrincipal,
  recordOAuthAgentContextRead,
} from "~~/lib/tokenless/agentIntegrations";
import {
  exchangeAgentOAuthToken,
  getCanonicalAgentMcpResource,
  issueAgentOAuthAuthorizationCode,
  registerAgentOAuthClient,
  validateAgentOAuthAuthorizationRequest,
} from "~~/lib/tokenless/agentOAuth";
import { putHumanReviewConfigurationForOwner } from "~~/lib/tokenless/humanReviewConfiguration";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { TOKENLESS_AGENT_SCOPES, createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const APP_ORIGIN = "https://rateloop-tokenless.vercel.app";
const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

async function connectOAuthAgent(label: string) {
  const principalId = `rlp_${label.padEnd(24, "a").slice(0, 24)}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [principalId, now, now],
  });
  const { workspaceId } = await createWorkspace({ name: `${label} workspace`, ownerAddress: principalId });
  const intent = await createAgentConnectionIntent({ accountAddress: principalId, workspaceId, origin: APP_ORIGIN });
  const redirectUri = "http://127.0.0.1:43219/oauth/callback";
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const oauthClient = await registerAgentOAuthClient({ client_name: `${label} client`, redirect_uris: [redirectUri] });
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
  const unbound = await authenticateAgentMcpPrincipal(`Bearer ${tokens.access_token}`);
  assert.equal(unbound.kind, "oauth");
  if (unbound.kind !== "oauth") throw new Error("OAuth principal expected.");
  const claim = await claimAgentConnectionIntent({
    connectionUrl: intent.connectionUrl,
    origin: APP_ORIGIN,
    principal: unbound.oauth,
  });
  const testing = await authenticateAgentMcpPrincipal(`Bearer ${tokens.access_token}`);
  assert.equal(testing.kind, "oauth");
  if (testing.kind !== "oauth" || !testing.integration) throw new Error("Claimed OAuth integration expected.");
  await recordOAuthAgentContextRead(testing);
  await verifyAgentConnection({ principal: testing.oauth, integrationId: testing.integration.integrationId });
  const connected = await authenticateAgentMcpPrincipal(`Bearer ${tokens.access_token}`);
  assert.equal(connected.kind, "oauth");
  if (connected.kind !== "oauth" || !connected.integration || !connected.principal) {
    throw new Error("Connected OAuth integration expected.");
  }
  return {
    claim,
    connected: { ...connected, integration: connected.integration, principal: connected.principal },
    principalId,
    token: tokens.access_token,
    workspaceId,
  };
}

async function publishingPolicy(principalId: string, workspaceId: string, suffix = "11") {
  return createAgentPublishingPolicy({
    accountAddress: principalId,
    workspaceId,
    policy: {
      name: "Browser-consented publishing",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "30000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 15,
      maxBountyAtomic: "20000000",
      maxFeeBps: 750,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${suffix.repeat(32)}`],
      allowedDataClassifications: ["internal"],
      onPolicyMiss: "deny",
    },
  });
}

test("browser consent atomically upgrades one connected OAuth integration to exact immutable bindings", async () => {
  const setup = await connectOAuthAgent("scopeup");
  const policy = await publishingPolicy(setup.principalId, setup.workspaceId);

  assert.equal(setup.connected.principal.policyId, null);
  assert.equal(setup.connected.integration.publishingPolicyId, null);
  assert.deepEqual(setup.connected.principal.scopes, ["evaluation:read", "review:decide"]);
  const frozenAudiencePolicyHash = setup.connected.integration.audiencePolicyHash;

  const activated = await activateAgentIntegrationPublishing({
    accountAddress: setup.principalId,
    workspaceId: setup.workspaceId,
    integrationId: setup.connected.integration.integrationId,
    body: { publishingPolicyId: policy.policyId, allowedWorkflowKeys: ["support-reply", "general-assistance"] },
  });

  assert.equal(activated.integration.activationMode, "owner_approved");
  assert.equal(activated.integration.agentVersionId, setup.connected.integration.agentVersionId);
  assert.equal(activated.integration.reviewPolicyId, setup.connected.integration.reviewPolicyId);
  assert.equal(activated.integration.reviewPolicyVersion, setup.connected.integration.reviewPolicyVersion + 1);
  assert.equal(activated.integration.audiencePolicyHash, frozenAudiencePolicyHash);
  assert.equal(activated.integration.publishingPolicyId, policy.policyId);
  assert.equal(activated.integration.publishingPolicyVersion, policy.version);
  assert.deepEqual(activated.integration.grantedScopes, OWNER_APPROVED_AGENT_SCOPES);

  const refreshed = await authenticateAgentMcpPrincipal(`Bearer ${setup.token}`);
  assert.equal(refreshed.kind, "oauth");
  if (refreshed.kind !== "oauth" || !refreshed.integration || !refreshed.principal) return;
  assert.equal(refreshed.principal.policyId, policy.policyId);
  assert.deepEqual(refreshed.principal.scopes, TOKENLESS_AGENT_SCOPES);
  assert.equal(refreshed.integration.reviewPolicyVersion, activated.integration.reviewPolicyVersion);
  assert.equal(refreshed.integration.publishingPolicyVersion, policy.version);
  assert.deepEqual(refreshed.integration.allowedWorkflowKeys, ["support-reply", "general-assistance"]);

  const reviewVersions = await dbClient.execute({
    sql: `SELECT version,enabled,superseded_at,publishing_policy_id
          FROM tokenless_agent_review_policies
          WHERE workspace_id = ? AND policy_id = ? ORDER BY version ASC`,
    args: [setup.workspaceId, setup.connected.integration.reviewPolicyId],
  });
  assert.equal(reviewVersions.rowCount, 2);
  assert.equal(reviewVersions.rows[0]?.enabled, false);
  assert.ok(reviewVersions.rows[0]?.superseded_at);
  assert.equal(reviewVersions.rows[1]?.enabled, true);
  assert.equal(reviewVersions.rows[1]?.publishing_policy_id, policy.policyId);

  const integrationEvent = await dbClient.execute({
    sql: `SELECT actor_reference,details_json FROM tokenless_agent_integration_events
          WHERE integration_id = ? AND event_type = 'scope_upgraded'`,
    args: [setup.connected.integration.integrationId],
  });
  assert.equal(integrationEvent.rowCount, 1);
  assert.equal(integrationEvent.rows[0]?.actor_reference, setup.principalId);
  assert.match(String(integrationEvent.rows[0]?.details_json), /browser_owner_step_up/);
  assert.match(String(integrationEvent.rows[0]?.details_json), /explicitBrowserConsent/);
});

test("legacy publishing activation preserves a bound unpaid private review without payment authority", async () => {
  const setup = await connectOAuthAgent("unpaidgrant");
  const policy = await publishingPolicy(setup.principalId, setup.workspaceId);
  const group = await createPrivateGroup({
    accountAddress: setup.principalId,
    workspaceId: setup.workspaceId,
    name: "Unpaid reviewers",
    purpose: "Review private workspace material without payment.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal", "confidential"] },
  });
  const saved = await putHumanReviewConfigurationForOwner({
    accountAddress: setup.principalId,
    workspaceId: setup.workspaceId,
    agentId: setup.connected.integration.agentId,
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
        integrationId: setup.connected.integration.integrationId,
        publishingPolicyId: policy.policyId,
        publishingPolicyVersion: policy.version ?? 1,
        allowedWorkflowKeys: ["general-assistance"],
      },
    },
  });
  assert.equal(saved.configuration.authority, "ask_automatically");
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET activation_mode='preauthorized_safe',publishing_policy_id=NULL,publishing_policy_version=NULL,
              granted_scopes_json=? WHERE integration_id=?`,
    args: [JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES), setup.connected.integration.integrationId],
  });

  const activated = await activateAgentIntegrationPublishing({
    accountAddress: setup.principalId,
    workspaceId: setup.workspaceId,
    integrationId: setup.connected.integration.integrationId,
    body: { publishingPolicyId: policy.policyId, allowedWorkflowKeys: ["general-assistance"] },
  });
  assert.equal(activated.integration.canPublish, true);
  assert.equal(activated.integration.canSpend, false);
  assert.ok(activated.integration.grantedScopes.includes("panel:publish"));
  assert.ok(!activated.integration.grantedScopes.includes("payment:submit"));
});

test("publishing step-up fails closed for a publishing policy from another workspace", async () => {
  const first = await connectOAuthAgent("firstgrant");
  const second = await connectOAuthAgent("secondgrant");
  const foreignPolicy = await publishingPolicy(second.principalId, second.workspaceId, "22");

  await assert.rejects(
    () =>
      activateAgentIntegrationPublishing({
        accountAddress: first.principalId,
        workspaceId: first.workspaceId,
        integrationId: first.connected.integration.integrationId,
        body: { publishingPolicyId: foreignPolicy.policyId, allowedWorkflowKeys: ["general-assistance"] },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "publishing_policy_not_found",
  );
  const unchanged = await authenticateAgentMcpPrincipal(`Bearer ${first.token}`);
  assert.equal(unchanged.kind, "oauth");
  if (unchanged.kind === "oauth") {
    assert.equal(unchanged.integration?.publishingPolicyId, null);
    assert.equal(unchanged.principal?.policyId, null);
  }
});

test("publishing activation route requires same-origin browser consent from a workspace owner", async () => {
  const setup = await connectOAuthAgent("routegrant");
  const outsider = await connectOAuthAgent("routeother");
  const policy = await publishingPolicy(setup.principalId, setup.workspaceId);
  const ownerSession = await createAuthSession({
    principalId: setup.principalId,
    authProvider: "better_auth:passkey",
    displayName: null,
  });
  const outsiderSession = await createAuthSession({
    principalId: outsider.principalId,
    authProvider: "better_auth:passkey",
    displayName: null,
  });
  const path = `/api/account/workspaces/${setup.workspaceId}/agent-integrations/${setup.connected.integration.integrationId}/publishing`;
  const context = {
    params: Promise.resolve({
      workspaceId: setup.workspaceId,
      integrationId: setup.connected.integration.integrationId,
    }),
  };
  const request = (token: string, origin?: string) =>
    new NextRequest(`${APP_ORIGIN}${path}`, {
      method: "POST",
      body: JSON.stringify({ publishingPolicyId: policy.policyId, allowedWorkflowKeys: ["general-assistance"] }),
      headers: {
        "content-type": "application/json",
        cookie: `${AUTH_SESSION_COOKIE}=${token}`,
        ...(origin ? { origin } : {}),
      },
    });

  const missingOrigin = await activatePublishingRoute(request(ownerSession.token), context);
  assert.equal(missingOrigin.status, 403);
  assert.equal((await missingOrigin.json()).code, "invalid_origin");

  const denied = await activatePublishingRoute(request(outsiderSession.token, APP_ORIGIN), context);
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).code, "workspace_not_found");

  const activated = await activatePublishingRoute(request(ownerSession.token, APP_ORIGIN), context);
  assert.equal(activated.status, 200);
  assert.equal(activated.headers.get("cache-control"), "private, no-store, max-age=0");
  const body = await activated.json();
  assert.equal(body.integration.activationMode, "owner_approved");
  assert.equal(body.integration.publishingPolicyId, policy.policyId);
  assert.equal(body.integration.canSpend, true);
});

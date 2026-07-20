import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  claimAgentConnectionIntent,
  connectionLaneFromClientCapabilitiesJson,
  createAgentConnectionIntent,
  getPublicAgentConnectionIntent,
  listAgentConnectionIntents,
  verifyAgentConnection,
} from "~~/lib/tokenless/agentConnectionIntents";
import { listWorkspaceAgents } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = `rlp_${"a".repeat(24)}`;
const CLIENT_ID = "rloc_test_client";
const RESOURCE = "https://rateloop-tokenless.example/api/agent/v1/mcp";

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?, 'active', ?, ?)`,
    args: [OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_name,redirect_uris_json,redirect_uris_digest,token_endpoint_auth_method,
           grant_types_json,response_types_json,allowed_scopes_json,registration_source,status,created_at,updated_at)
          VALUES (?, 'Test client', '["http://127.0.0.1/callback"]', ?, 'none',
                  '["authorization_code","refresh_token"]', '["code"]', ?, 'dynamic', 'active', ?, ?)`,
    args: [CLIENT_ID, "redirect-digest", JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES), now, now],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

async function createTokenFamily(tokenFamilyId: string, subjectPrincipalId = OWNER) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,status,
           created_at,absolute_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      tokenFamilyId,
      CLIENT_ID,
      subjectPrincipalId,
      RESOURCE,
      RESOURCE,
      JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
      now,
      new Date(now.getTime() + 24 * 60 * 60_000),
    ],
  });
  return {
    tokenFamilyId,
    clientId: CLIENT_ID,
    clientName: "Test client",
    subjectPrincipalId,
    resource: RESOURCE,
    scopes: [...SAFE_AGENT_CONNECTION_SCOPES],
  };
}

test("one copied fragment intent activates safe access idempotently and verifies without review evidence", async () => {
  const { workspaceId } = await createWorkspace({ name: "One paste", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const url = new URL(issued.connectionUrl);
  assert.match(url.pathname, /^\/connect\/aci_[a-f0-9]{32}$/);
  assert.equal(url.search, "");
  assert.match(url.hash, /^#claim=[A-Za-z0-9_-]{43}$/);
  const stored = await dbClient.execute({
    sql: "SELECT claim_nonce_hash FROM tokenless_agent_connection_intents WHERE intent_id = ?",
    args: [issued.intent.intentId],
  });
  assert.notEqual(String(stored.rows[0]?.claim_nonce_hash), new URLSearchParams(url.hash.slice(1)).get("claim"));

  const publicIntent = await getPublicAgentConnectionIntent(issued.intent.intentId);
  assert.equal("workspaceId" in publicIntent, false);
  assert.equal(publicIntent.status, "issued");
  const principal = await createTokenFamily("oatf_safe_connection");
  const first = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  assert.equal(first.idempotent, false);
  assert.equal(first.connection.status, "testing");
  assert.equal(first.connection.reportedLane, "mcp-oauth");

  const retry = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.connection.integrationId, first.connection.integrationId);

  const verified = await verifyAgentConnection({
    principal,
    integrationId: first.connection.integrationId,
  });
  assert.equal(verified.connection.status, "connected");
  assert.equal(verified.connection.reportedLane, "mcp-oauth");
  assert.match(verified.reportedLaneStatement, /plugin hooks not reported/);
  assert.deepEqual(verified.safeAccess, {
    canCheckReviewRequirement: true,
    canSpend: false,
    canPublish: false,
    canReadPrivateArtifacts: false,
    canAdministerWorkspace: false,
  });
  const opportunities = await dbClient.execute({
    sql: "SELECT COUNT(*)::integer AS count FROM tokenless_agent_review_opportunities",
  });
  assert.equal(Number(opportunities.rows[0]?.count), 0);
  const policies = await dbClient.execute({
    sql: `SELECT agreement_threshold_bps FROM tokenless_agent_review_policies
          WHERE workspace_id = ? AND agent_id = ?`,
    args: [workspaceId, first.connection.agentId],
  });
  assert.equal(policies.rowCount, 1);
  assert.equal(Number(policies.rows[0]?.agreement_threshold_bps), DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS);
  assert.equal(
    (await listAgentConnectionIntents({ accountAddress: OWNER, workspaceId })).intents[0]?.status,
    "connected",
  );
});

test("lane derivation defaults to the weakest assumption for unreported or malformed capabilities", () => {
  assert.equal(connectionLaneFromClientCapabilitiesJson("[]"), "mcp-oauth");
  assert.equal(connectionLaneFromClientCapabilitiesJson(null), "mcp-oauth");
  assert.equal(connectionLaneFromClientCapabilitiesJson("not json"), "mcp-oauth");
  assert.equal(connectionLaneFromClientCapabilitiesJson('{"lane":"plugin-with-hooks"}'), "mcp-oauth");
  assert.equal(connectionLaneFromClientCapabilitiesJson('["reported-lane:plugin-with-hooks"]'), "plugin-with-hooks");
  assert.equal(connectionLaneFromClientCapabilitiesJson('["grant:device-authorization"]'), "device-flow");
  assert.equal(
    connectionLaneFromClientCapabilitiesJson('["reported-lane:plugin-with-hooks","grant:device-authorization"]'),
    "plugin-with-hooks",
  );
});

test("a host-reported plugin lane is recorded at claim and surfaced only as host-reported", async () => {
  const { workspaceId } = await createWorkspace({ name: "Plugin lane", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const principal = await createTokenFamily("oatf_plugin_lane");
  const claimed = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
    reportedLane: "plugin-with-hooks",
  });
  assert.equal(claimed.connection.reportedLane, "plugin-with-hooks");
  const stored = await dbClient.execute({
    sql: "SELECT client_capabilities_json FROM tokenless_agent_connection_intents WHERE intent_id = ?",
    args: [issued.intent.intentId],
  });
  assert.deepEqual(JSON.parse(String(stored.rows[0]?.client_capabilities_json)), ["reported-lane:plugin-with-hooks"]);

  const retry = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.connection.reportedLane, "plugin-with-hooks");

  const verified = await verifyAgentConnection({ principal, integrationId: claimed.connection.integrationId });
  assert.equal(verified.connection.reportedLane, "plugin-with-hooks");
  assert.match(verified.reportedLaneStatement, /host-reported/);
  assert.match(verified.reportedLaneStatement, /not verified/);

  const registry = await listWorkspaceAgents({ accountAddress: OWNER, workspaceId });
  assert.equal(registry.agents[0]?.reportedConnectionLane, "plugin-with-hooks");
});

test("a device-authorization grant records the device-flow lane without any host report", async () => {
  const { workspaceId } = await createWorkspace({ name: "Device lane", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const principal = await createTokenFamily("oatf_device_lane");
  const createdAt = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_device_authorizations
          (device_authorization_id,device_code_hash,user_code_hash,client_id,audience,resource,
           requested_scopes_json,status,approved_by_principal_id,approved_at,consumed_at,token_family_id,
           created_at,expires_at,updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'consumed', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "adva_device_lane_test",
      "device-code-hash",
      "user-code-hash",
      CLIENT_ID,
      RESOURCE,
      RESOURCE,
      JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
      OWNER,
      createdAt,
      createdAt,
      "oatf_device_lane",
      createdAt,
      new Date(createdAt.getTime() + 10 * 60_000),
      createdAt,
    ],
  });
  const claimed = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  assert.equal(claimed.connection.reportedLane, "device-flow");
  const verified = await verifyAgentConnection({ principal, integrationId: claimed.connection.integrationId });
  assert.equal(verified.connection.reportedLane, "device-flow");
  assert.match(verified.reportedLaneStatement, /Device-flow/);
  assert.match(verified.reportedLaneStatement, /plugin hooks not reported/);
});

test("a host cannot report a lane outside the self-declarable set", async () => {
  const { workspaceId } = await createWorkspace({ name: "Bad lane", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const principal = await createTokenFamily("oatf_bad_lane");
  for (const reportedLane of ["device-flow", "verified-plugin", ""]) {
    await assert.rejects(
      () =>
        claimAgentConnectionIntent({
          connectionUrl: issued.connectionUrl,
          origin: "https://rateloop-tokenless.example",
          principal,
          reportedLane,
        }),
      (error: unknown) =>
        Boolean(error && typeof error === "object" && "code" in error && error.code === "invalid_reported_lane"),
    );
  }
});

test("one OAuth token family cannot claim a second workspace", async () => {
  const firstWorkspace = await createWorkspace({ name: "First", ownerAddress: OWNER });
  const secondWorkspace = await createWorkspace({ name: "Second", ownerAddress: OWNER });
  const first = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId: firstWorkspace.workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const second = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId: secondWorkspace.workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const principal = await createTokenFamily("oatf_one_workspace");
  await claimAgentConnectionIntent({
    connectionUrl: first.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  await assert.rejects(
    () =>
      claimAgentConnectionIntent({
        connectionUrl: second.connectionUrl,
        origin: "https://rateloop-tokenless.example",
        principal,
      }),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "workspace_conflict"),
  );
});

test("verification fails closed after the hard connection deadline", async () => {
  const { workspaceId } = await createWorkspace({ name: "Expired verification", ownerAddress: OWNER });
  const issued = await createAgentConnectionIntent({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
  });
  const principal = await createTokenFamily("oatf_expired_verification");
  const claimed = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_connection_intents
          SET created_at = ?, claim_expires_at = ?, hard_expires_at = ? WHERE intent_id = ?`,
    args: [
      new Date(Date.now() - 60 * 60_000),
      new Date(Date.now() - 30 * 60_000),
      new Date(Date.now() - 15 * 60_000),
      issued.intent.intentId,
    ],
  });

  await assert.rejects(
    () =>
      verifyAgentConnection({
        principal,
        integrationId: claimed.connection.integrationId,
      }),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "connection_intent_expired"),
  );
  const state = await dbClient.execute({
    sql: `SELECT c.status AS connection_status,i.status AS integration_status
          FROM tokenless_agent_connection_intents c
          JOIN tokenless_agent_integrations i ON i.connection_intent_id = c.intent_id
          WHERE c.intent_id = ?`,
    args: [issued.intent.intentId],
  });
  assert.equal(state.rows[0]?.connection_status, "expired");
  assert.equal(state.rows[0]?.integration_status, "revoked");
});

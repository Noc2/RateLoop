import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  claimAgentConnectionIntent,
  verifyAgentConnection,
} from "~~/lib/tokenless/agentConnectionIntents";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  agentSetupUrl,
  clampAgentSetupStep,
  completeWorkspaceAgentSetup,
  configureWorkspaceSetupPeople,
  configureWorkspaceSetupReviews,
  confirmWorkspaceSetupAgent,
  createWorkspaceAgentSetupConnection,
  getWorkspaceAgentSetup,
} from "~~/lib/tokenless/workspaceAgentSetup";

const OWNER = `rlp_${"b".repeat(24)}`;
const CLIENT_ID = "rloc_setup_client";
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
          VALUES (?, 'Setup client', '["http://127.0.0.1/callback"]', 'setup-redirects', 'none',
                  '["authorization_code","refresh_token"]', '["code"]', ?, 'dynamic', 'active', ?, ?)`,
    args: [CLIENT_ID, JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES), now, now],
  });
});

afterEach(() => __setDatabaseResourcesForTests(null));

async function connectedSetup() {
  const { workspaceId } = await createWorkspace({ name: "Setup workspace", ownerAddress: OWNER });
  const issued = await createWorkspaceAgentSetupConnection({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.example",
    revision: 1,
  });
  assert.equal(typeof issued.connectionUrl, "string", JSON.stringify(issued));
  const now = new Date();
  const tokenFamilyId = "rlotf_setup_family";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,status,
           created_at,absolute_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      tokenFamilyId,
      CLIENT_ID,
      OWNER,
      RESOURCE,
      RESOURCE,
      JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
      now,
      new Date(now.getTime() + 86_400_000),
    ],
  });
  const principal = {
    tokenFamilyId,
    clientId: CLIENT_ID,
    clientName: "Setup client",
    subjectPrincipalId: OWNER,
    resource: RESOURCE,
    scopes: [...SAFE_AGENT_CONNECTION_SCOPES],
  };
  const claimed = await claimAgentConnectionIntent({
    connectionUrl: issued.connectionUrl,
    origin: "https://rateloop-tokenless.example",
    principal,
  });
  await verifyAgentConnection({ principal, integrationId: claimed.connection.integrationId });
  return { workspaceId, integrationId: claimed.connection.integrationId };
}

test("setup binds one verified connection and completes without publishing or spending authority", async () => {
  const { workspaceId, integrationId } = await connectedSetup();
  const connected = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(connected.resumeStep, "agent");
  assert.equal(connected.revision, 2);
  assert.equal(connected.connection.integrationId, integrationId);
  assert.equal(connected.capabilities.autonomousAccess, false);

  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: OWNER,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: connected.agent!.displayName,
      description: connected.agent!.description,
      provider: connected.agent!.provider,
      model: connected.agent!.model,
      modelVersion: connected.agent!.modelVersion,
      deploymentName: connected.agent!.deploymentName,
      environment: "production",
    },
  });
  assert.equal(confirmed.revision, 3);

  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: OWNER,
    workspaceId,
    revision: confirmed.revision,
    review: { mode: "adaptive", reviewerAudience: "private_invited", contentBoundary: "private_workspace" },
  });
  assert.equal(reviews.revision, 4);

  const people = await configureWorkspaceSetupPeople({
    accountAddress: OWNER,
    workspaceId,
    revision: reviews.revision,
    decision: "later",
  });
  assert.equal(people.revision, 5);
  assert.match(people.groupId, /^pgrp_/);

  const completed = await completeWorkspaceAgentSetup({
    accountAddress: OWNER,
    workspaceId,
    revision: people.revision,
  });
  assert.equal(completed.revision, 6);
  const finalState = await getWorkspaceAgentSetup({ accountAddress: OWNER, workspaceId });
  assert.equal(finalState.complete, true);
  assert.equal(finalState.status, "completed");

  const integration = await dbClient.execute({
    sql: `SELECT activation_mode,granted_scopes_json,publishing_policy_id,review_policy_id,review_policy_version
          FROM tokenless_agent_integrations WHERE integration_id=?`,
    args: [integrationId],
  });
  assert.equal(String(integration.rows[0]?.activation_mode), "preauthorized_safe");
  assert.equal(integration.rows[0]?.publishing_policy_id, null);
  assert.deepEqual(JSON.parse(String(integration.rows[0]?.granted_scopes_json)), SAFE_AGENT_CONNECTION_SCOPES);
  const audience = await dbClient.execute({
    sql: `SELECT audience_policy_json FROM tokenless_agent_review_policies
          WHERE policy_id=? AND version=?`,
    args: [integration.rows[0]?.review_policy_id, integration.rows[0]?.review_policy_version],
  });
  const audiencePolicy = JSON.parse(String(audience.rows[0]?.audience_policy_json));
  assert.equal(audiencePolicy.reviewerSource, "private_invited");
  assert.equal(audiencePolicy.autonomousAccess, false);
  assert.equal(audiencePolicy.group.groupId, people.groupId);
});

test("setup rejects future steps, stale revisions, and unavailable autonomous lanes", async () => {
  assert.equal(clampAgentSetupStep("people", "agent"), "agent");
  assert.equal(clampAgentSetupStep("connect", "agent"), "connect");
  assert.equal(agentSetupUrl("ws a", "reviews"), "/agents?workspace=ws%20a&step=reviews");

  const { workspaceId } = await connectedSetup();
  await assert.rejects(
    configureWorkspaceSetupReviews({
      accountAddress: OWNER,
      workspaceId,
      revision: 2,
      review: { mode: "adaptive", autonomousAccess: true },
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "agent_setup_lane_unavailable",
  );
  await assert.rejects(
    createWorkspaceAgentSetupConnection({
      accountAddress: OWNER,
      workspaceId,
      origin: "https://rateloop-tokenless.example",
      revision: 1,
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "agent_setup_conflict",
  );
});

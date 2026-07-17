import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __enterpriseAuthRouteTestUtils } from "~~/app/api/auth/better/[...all]/route";
import { synchronizeScimUser } from "~~/lib/auth/enterpriseIdentityPolicy";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedScimUser(suffix: string) {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const betterAuthUserId = `scim-user-${suffix}`;
  const providerId = `rlscim_${suffix.padEnd(24, "0").slice(0, 24)}`;
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId, displayName: "Managed user", now });
  const workspace = await createWorkspace({ name: `SCIM ${suffix}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at,role,banned)
          VALUES (?,?,?,true,?,?,NULL,false)`,
    args: [betterAuthUserId, "Managed user", `${suffix}@example.test`, now, now],
  });
  const oauthClientId = `oauth-client-${suffix}`;
  const tokenFamilyId = `oauth-family-${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_secret_hash,client_name,redirect_uris_json,redirect_uris_digest,
           token_endpoint_auth_method,grant_types_json,response_types_json,allowed_scopes_json,
           registration_source,registered_by_principal_id,status,created_at,updated_at)
          VALUES (?,NULL,?,'["https://client.example/callback"]',?,'none',
                  '["authorization_code","refresh_token"]','["code"]','["agent:context"]',
                  'dynamic',?,'active',?,?)`,
    args: [
      oauthClientId,
      `SCIM client ${suffix}`,
      `sha256:${suffix.padEnd(64, "0").slice(0, 64)}`,
      identity.principalId,
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,
           status,created_at,absolute_expires_at)
          VALUES (?,?,?,?,?,'["agent:context"]','active',?,?)`,
    args: [
      tokenFamilyId,
      oauthClientId,
      identity.principalId,
      "https://rateloop.test/api/agent/v1/mcp",
      "https://rateloop.test/api/agent/v1/mcp",
      now,
      new Date(now.getTime() + 86_400_000),
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_access_tokens
          (access_token_id,token_hash,token_family_id,client_id,subject_principal_id,audience,resource,
           granted_scopes_json,created_at,expires_at)
          VALUES (?,?,?,?,?,?,?,'["agent:context"]',?,?)`,
    args: [
      `access-${suffix}`,
      `sha256:${`${suffix}a`.padEnd(64, "0").slice(0, 64)}`,
      tokenFamilyId,
      oauthClientId,
      identity.principalId,
      "https://rateloop.test/api/agent/v1/mcp",
      "https://rateloop.test/api/agent/v1/mcp",
      now,
      new Date(now.getTime() + 3_600_000),
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_scim_providers
          (id,provider_id,scim_token,organization_id,user_id) VALUES (?,?,?,NULL,?)`,
    args: [`scim-row-${suffix}`, providerId, `hash-${suffix}`, betterAuthUserId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_accounts
          (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
    args: [`scim-account-${suffix}`, betterAuthUserId, providerId, betterAuthUserId, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_scim_connections
          (provider_id,workspace_id,status,created_by,last_sync_at,last_sync_result,created_at,updated_at)
          VALUES (?,?,'active',?,NULL,NULL,?,?)`,
    args: [providerId, workspace.workspaceId, identity.principalId, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_managed_members
          (workspace_id,provider_id,better_auth_user_id,principal_id,source,status,created_at,last_synced_at,deactivated_at)
          VALUES (?,?,?,?,'scim','active',?,?,NULL)`,
    args: [workspace.workspaceId, providerId, betterAuthUserId, identity.principalId, now, now],
  });
  const session = await createAuthSession(identity, now);
  return { betterAuthUserId, identity, oauthClientId, providerId, session, tokenFamilyId, workspace };
}

async function assertDeactivated(input: Awaited<ReturnType<typeof seedScimUser>>) {
  const member = await dbClient.execute({
    sql: "SELECT role FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [input.workspace.workspaceId, input.identity.principalId],
  });
  assert.equal(member.rowCount, 0);
  const managed = await dbClient.execute({
    sql: `SELECT status,deactivated_at FROM tokenless_enterprise_managed_members
          WHERE provider_id=? AND better_auth_user_id=?`,
    args: [input.providerId, input.betterAuthUserId],
  });
  assert.equal(managed.rows[0]?.status, "deactivated");
  assert.ok(managed.rows[0]?.deactivated_at);
  const session = await dbClient.execute({
    sql: "SELECT revoked_at FROM tokenless_auth_sessions WHERE principal_id=?",
    args: [input.identity.principalId],
  });
  assert.ok(session.rows[0]?.revoked_at);
  const oauth = await dbClient.execute({
    sql: `SELECT f.status,f.revocation_reason,a.revoked_at,a.revocation_reason AS access_revocation_reason
          FROM tokenless_agent_oauth_token_families f
          JOIN tokenless_agent_oauth_access_tokens a ON a.token_family_id=f.token_family_id
          WHERE f.token_family_id=?`,
    args: [input.tokenFamilyId],
  });
  assert.equal(oauth.rows[0]?.status, "revoked");
  assert.equal(oauth.rows[0]?.revocation_reason, "enterprise_scim_deprovision");
  assert.ok(oauth.rows[0]?.revoked_at);
  assert.equal(oauth.rows[0]?.access_revocation_reason, "enterprise_scim_deprovision");
  const audit = await dbClient.execute({
    sql: `SELECT delivery_state FROM tokenless_enterprise_identity_audit_outbox
          WHERE action='identity.scim.member_deactivated' AND target_id=?`,
    args: [input.identity.principalId],
  });
  assert.equal(audit.rows[0]?.delivery_state, "pending");
}

test("SCIM PATCH active=false projects a 204 response into workspace-local deprovisioning", async () => {
  const seeded = await seedScimUser("patch");
  const response = await __enterpriseAuthRouteTestUtils.handle(
    new NextRequest(`https://rateloop.test/api/auth/better/scim/v2/Users/${seeded.betterAuthUserId}`, {
      method: "PATCH",
      headers: { "content-type": "application/scim+json" },
      body: JSON.stringify({ Operations: [{ op: "replace", path: "active", value: false }] }),
    }),
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(
    response.status,
    204,
    JSON.stringify(
      await response
        .clone()
        .json()
        .catch(() => null),
    ),
  );
  await assertDeactivated(seeded);
});

test("SCIM DELETE keeps the captured managed record after the provider deletes its user", async () => {
  const seeded = await seedScimUser("delete");
  const response = await __enterpriseAuthRouteTestUtils.handle(
    new NextRequest(`https://rateloop.test/api/auth/better/scim/v2/Users/${seeded.betterAuthUserId}`, {
      method: "DELETE",
    }),
    async () => {
      await dbClient.execute({
        sql: "DELETE FROM tokenless_better_auth_users WHERE id=?",
        args: [seeded.betterAuthUserId],
      });
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(
    response.status,
    204,
    JSON.stringify(
      await response
        .clone()
        .json()
        .catch(() => null),
    ),
  );
  await assertDeactivated(seeded);
  const user = await dbClient.execute({
    sql: "SELECT id FROM tokenless_better_auth_users WHERE id=?",
    args: [seeded.betterAuthUserId],
  });
  assert.equal(user.rowCount, 0);
});

test("SCIM deprovision fails closed before provider mutation when the principal has outside workspace access", async () => {
  const seeded = await seedScimUser("scope");
  const outsideOwner = await resolveBetterAuthPrincipal({ betterAuthUserId: "outside-owner" });
  const outside = await createWorkspace({ name: "Outside", ownerAddress: outsideOwner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?)`,
    args: [outside.workspaceId, seeded.identity.principalId, new Date()],
  });
  let providerCalled = false;
  const response = await __enterpriseAuthRouteTestUtils.handle(
    new NextRequest(`https://rateloop.test/api/auth/better/scim/v2/Users/${seeded.betterAuthUserId}`, {
      method: "DELETE",
    }),
    async () => {
      providerCalled = true;
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(response.status, 409);
  assert.equal(providerCalled, false);
  const memberships = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_workspace_members WHERE account_address=?",
    args: [seeded.identity.principalId],
  });
  assert.equal(memberships.rowCount, 2);
  const managed = await dbClient.execute({
    sql: "SELECT status FROM tokenless_enterprise_managed_members WHERE provider_id=?",
    args: [seeded.providerId],
  });
  assert.equal(managed.rows[0]?.status, "active");
});

test("SCIM provisioning cannot convert a principal with outside workspace access into a managed member", async () => {
  const seeded = await seedScimUser("provision-scope");
  await dbClient.execute({
    sql: "DELETE FROM tokenless_enterprise_managed_members WHERE provider_id=?",
    args: [seeded.providerId],
  });
  await dbClient.execute({
    sql: "DELETE FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [seeded.workspace.workspaceId, seeded.identity.principalId],
  });
  const outsideOwner = await resolveBetterAuthPrincipal({ betterAuthUserId: "provision-outside-owner" });
  const outside = await createWorkspace({ name: "Provision outside", ownerAddress: outsideOwner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?)`,
    args: [outside.workspaceId, seeded.identity.principalId, new Date()],
  });
  await assert.rejects(
    () =>
      synchronizeScimUser({
        active: true,
        betterAuthUserId: seeded.betterAuthUserId,
        providerId: seeded.providerId,
      }),
    /outside the provider workspace/u,
  );
  const targetMember = await dbClient.execute({
    sql: "SELECT 1 FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [seeded.workspace.workspaceId, seeded.identity.principalId],
  });
  assert.equal(targetMember.rowCount, 0);
  const managed = await dbClient.execute({
    sql: "SELECT 1 FROM tokenless_enterprise_managed_members WHERE provider_id=?",
    args: [seeded.providerId],
  });
  assert.equal(managed.rowCount, 0);
});

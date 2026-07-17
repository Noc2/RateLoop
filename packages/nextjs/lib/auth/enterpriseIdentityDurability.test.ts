import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  __setEnterpriseIdentityAuthForTests,
  deleteWorkspaceIdentityProvider,
  revokeWorkspaceScimConnection,
} from "~~/lib/auth/enterpriseIdentity";
import {
  __setEnterpriseIdentityAuditActivationHookForTests,
  reconcileEnterpriseIdentityAuditReservations,
} from "~~/lib/auth/enterpriseIdentityAudit";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const originalIdentityFlag = process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED;

beforeEach(() => {
  process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  if (originalIdentityFlag === undefined) delete process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED;
  else process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = originalIdentityFlag;
  __setEnterpriseIdentityAuditActivationHookForTests(null);
  __setEnterpriseIdentityAuthForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function seedIdentityAdmin(suffix: string) {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const betterAuthUserId = `identity-owner-${suffix}`;
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId, displayName: "Identity owner", now });
  const workspace = await createWorkspace({ name: `Identity ${suffix}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at,role,banned)
          VALUES (?,?,?,true,?,?,NULL,false)`,
    args: [betterAuthUserId, "Identity owner", `${suffix}@example.test`, now, now],
  });
  return { betterAuthUserId, identity, now, workspace };
}

async function seedSsoProvider(suffix: string) {
  const seeded = await seedIdentityAdmin(suffix);
  const providerId = `rlsso_${suffix.padEnd(24, "0").slice(0, 24)}`;
  const domain = `${suffix}.example.test`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_sso_providers
          (id,issuer,oidc_config,saml_config,user_id,provider_id,organization_id,domain,domain_verified)
          VALUES (?,?,?,NULL,?,?,NULL,?,true)`,
    args: [`sso-row-${suffix}`, `https://id.${domain}`, "{}", seeded.betterAuthUserId, providerId, domain],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_identity_providers
          (provider_id,workspace_id,protocol,domain,enforce_sso,status,created_by,last_sso_at,created_at,updated_at)
          VALUES (?,?,'oidc',?,false,'active',?,NULL,?,?)`,
    args: [providerId, seeded.workspace.workspaceId, domain, seeded.identity.principalId, seeded.now, seeded.now],
  });
  return { ...seeded, providerId };
}

async function seedScimConnection(suffix: string) {
  const seeded = await seedIdentityAdmin(suffix);
  const providerId = `rlscim_${suffix.padEnd(24, "0").slice(0, 24)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_scim_providers
          (id,provider_id,scim_token,organization_id,user_id) VALUES (?,?,?,NULL,?)`,
    args: [`scim-row-${suffix}`, providerId, `hash-${suffix}`, seeded.betterAuthUserId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_scim_connections
          (provider_id,workspace_id,status,created_by,last_sync_at,last_sync_result,created_at,updated_at)
          VALUES (?,?,'active',?,NULL,NULL,?,?)`,
    args: [providerId, seeded.workspace.workspaceId, seeded.identity.principalId, seeded.now, seeded.now],
  });
  return { ...seeded, providerId };
}

function installAuth(input: {
  betterAuthUserId: string;
  deleteScim?: (providerId: string) => Promise<void>;
  deleteSso?: (providerId: string) => Promise<void>;
}) {
  __setEnterpriseIdentityAuthForTests({
    api: {
      getSession: async () => ({ user: { id: input.betterAuthUserId } }),
      deleteSCIMProviderConnection: async ({ body }: { body: { providerId: string } }) => {
        await input.deleteScim?.(body.providerId);
      },
      deleteSSOProvider: async ({ body }: { body: { providerId: string } }) => {
        await input.deleteSso?.(body.providerId);
      },
    },
  } as unknown as Parameters<typeof __setEnterpriseIdentityAuthForTests>[0]);
}

async function auditState(eventKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT delivery_state,last_error FROM tokenless_enterprise_identity_audit_outbox
          WHERE event_key=?`,
    args: [eventKey],
  });
  return result.rows[0];
}

test("provider mutation failure leaves only a reserved event and retry can complete without false success", async () => {
  const seeded = await seedSsoProvider("provider-failure");
  const eventKey = `identity-provider-deleted:${seeded.workspace.workspaceId}:${seeded.providerId}`;
  installAuth({
    betterAuthUserId: seeded.betterAuthUserId,
    deleteSso: async () => {
      throw new Error("provider unavailable");
    },
  });
  await assert.rejects(
    () =>
      deleteWorkspaceIdentityProvider({
        accountAddress: seeded.identity.principalId,
        headers: new Headers(),
        providerId: seeded.providerId,
        workspaceId: seeded.workspace.workspaceId,
      }),
    /provider unavailable/u,
  );
  assert.deepEqual(await auditState(eventKey), { delivery_state: "reserved", last_error: "provider unavailable" });

  installAuth({
    betterAuthUserId: seeded.betterAuthUserId,
    deleteSso: async providerId => {
      await dbClient.execute({
        sql: "DELETE FROM tokenless_better_auth_sso_providers WHERE provider_id=?",
        args: [providerId],
      });
    },
  });
  await deleteWorkspaceIdentityProvider({
    accountAddress: seeded.identity.principalId,
    headers: new Headers(),
    providerId: seeded.providerId,
    workspaceId: seeded.workspace.workspaceId,
  });
  assert.notEqual((await auditState(eventKey))?.delivery_state, "reserved");
});

test("provider deletion survives post-delete audit activation failure and scheduled reconciliation completes it", async () => {
  const seeded = await seedSsoProvider("provider-audit");
  const eventKey = `identity-provider-deleted:${seeded.workspace.workspaceId}:${seeded.providerId}`;
  installAuth({
    betterAuthUserId: seeded.betterAuthUserId,
    deleteSso: async providerId => {
      await dbClient.execute({
        sql: "DELETE FROM tokenless_better_auth_sso_providers WHERE provider_id=?",
        args: [providerId],
      });
    },
  });
  __setEnterpriseIdentityAuditActivationHookForTests(async () => {
    throw new Error("audit activation unavailable");
  });
  await assert.rejects(
    () =>
      deleteWorkspaceIdentityProvider({
        accountAddress: seeded.identity.principalId,
        headers: new Headers(),
        providerId: seeded.providerId,
        workspaceId: seeded.workspace.workspaceId,
      }),
    /audit activation unavailable/u,
  );
  assert.equal((await auditState(eventKey))?.delivery_state, "reserved");
  __setEnterpriseIdentityAuditActivationHookForTests(null);
  assert.deepEqual(await reconcileEnterpriseIdentityAuditReservations(), { activated: 1, inspected: 1 });
  assert.notEqual((await auditState(eventKey))?.delivery_state, "reserved");
});

test("SCIM revocation survives post-delete audit activation failure and scheduled reconciliation completes it", async () => {
  const seeded = await seedScimConnection("scim-audit");
  const eventKey = `identity-scim-revoked:${seeded.workspace.workspaceId}:${seeded.providerId}`;
  installAuth({
    betterAuthUserId: seeded.betterAuthUserId,
    deleteScim: async providerId => {
      await dbClient.execute({
        sql: "DELETE FROM tokenless_better_auth_scim_providers WHERE provider_id=?",
        args: [providerId],
      });
    },
  });
  __setEnterpriseIdentityAuditActivationHookForTests(async () => {
    throw new Error("audit activation unavailable");
  });
  await assert.rejects(
    () =>
      revokeWorkspaceScimConnection({
        accountAddress: seeded.identity.principalId,
        headers: new Headers(),
        providerId: seeded.providerId,
        workspaceId: seeded.workspace.workspaceId,
      }),
    /audit activation unavailable/u,
  );
  assert.equal((await auditState(eventKey))?.delivery_state, "reserved");
  __setEnterpriseIdentityAuditActivationHookForTests(null);
  assert.deepEqual(await reconcileEnterpriseIdentityAuditReservations(), { activated: 1, inspected: 1 });
  assert.notEqual((await auditState(eventKey))?.delivery_state, "reserved");
});

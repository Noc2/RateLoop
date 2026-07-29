import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setEnterpriseIdentityAuthForTests, setWorkspaceSsoEnforcement } from "~~/lib/auth/enterpriseIdentity";
import { assertEnterpriseSignInAllowed } from "~~/lib/auth/enterpriseIdentityPolicy";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { ENTERPRISE_SSO_AUTH_PROVIDER, createAuthSession, findAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const originalIdentityFlag = process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED;
const now = new Date("2026-07-29T08:00:00.000Z");

beforeEach(() => {
  process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  if (originalIdentityFlag === undefined) delete process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED;
  else process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = originalIdentityFlag;
  __setEnterpriseIdentityAuthForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function addBetterAuthUser(input: { email: string; name: string; userId: string }) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at,role,banned)
          VALUES (?,?,?,true,?,?,NULL,false)`,
    args: [input.userId, input.name, input.email, now, now],
  });
  return resolveBetterAuthPrincipal({
    betterAuthUserId: input.userId,
    displayName: input.name,
    now,
  });
}

test("enabling SSO revokes affected non-SSO app sessions while preserving SSO and unrelated sessions", async () => {
  const domain = "company.example";
  const ownerUserId = "sso-policy-owner";
  const owner = await addBetterAuthUser({
    email: `owner@${domain}`,
    name: "Owner",
    userId: ownerUserId,
  });
  const workspace = await createWorkspace({ name: "SSO policy", ownerAddress: owner.principalId });
  const affected = await addBetterAuthUser({
    email: `member@${domain}`,
    name: "Affected member",
    userId: "sso-policy-affected",
  });
  const differentDomain = await addBetterAuthUser({
    email: "member@outside.example",
    name: "Different-domain member",
    userId: "sso-policy-different-domain",
  });
  const sameDomainOutsider = await addBetterAuthUser({
    email: `outsider@${domain}`,
    name: "Same-domain outsider",
    userId: "sso-policy-outsider",
  });
  for (const principalId of [affected.principalId, differentDomain.principalId]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
            VALUES (?,?,'member',?)`,
      args: [workspace.workspaceId, principalId, now],
    });
  }

  const providerId = "rlsso_session_revocation";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_sso_providers
          (id,issuer,oidc_config,saml_config,user_id,provider_id,organization_id,domain,domain_verified)
          VALUES (?,?,?,NULL,?,?,NULL,?,true)`,
    args: ["sso-session-revocation", `https://id.${domain}`, "{}", ownerUserId, providerId, domain],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_identity_providers
          (provider_id,workspace_id,protocol,domain,enforce_sso,status,created_by,last_sso_at,created_at,updated_at)
          VALUES (?,?,'oidc',?,false,'active',?,NULL,?,?)`,
    args: [providerId, workspace.workspaceId, domain, owner.principalId, now, now],
  });

  const affectedNonSso = await createAuthSession({ ...affected, authProvider: "better_auth:email-otp" }, now);
  const affectedSso = await createAuthSession({ ...affected, authProvider: ENTERPRISE_SSO_AUTH_PROVIDER }, now);
  const differentDomainSession = await createAuthSession(
    { ...differentDomain, authProvider: "better_auth:google" },
    now,
  );
  const outsiderSession = await createAuthSession({ ...sameDomainOutsider, authProvider: "better_auth:passkey" }, now);

  __setEnterpriseIdentityAuthForTests({
    api: { getSession: async () => ({ user: { id: ownerUserId } }) },
  } as unknown as Parameters<typeof __setEnterpriseIdentityAuthForTests>[0]);
  assert.deepEqual(
    await setWorkspaceSsoEnforcement({
      accountAddress: owner.principalId,
      enabled: true,
      headers: new Headers(),
      now,
      providerId,
      workspaceId: workspace.workspaceId,
    }),
    { enforced: true },
  );

  assert.equal(await findAuthSession(affectedNonSso.token, now), null);
  assert.equal((await findAuthSession(affectedSso.token, now))?.authProvider, ENTERPRISE_SSO_AUTH_PROVIDER);
  assert.equal((await findAuthSession(differentDomainSession.token, now))?.principalId, differentDomain.principalId);
  assert.equal((await findAuthSession(outsiderSession.token, now))?.principalId, sameDomainOutsider.principalId);
  await assert.rejects(
    () => assertEnterpriseSignInAllowed(`member@${domain}`, "email-otp"),
    /organization's SSO provider/u,
  );
  assert.deepEqual(await assertEnterpriseSignInAllowed(`member@${domain}`, `sso:${providerId}`), {
    domain,
    providerId,
    workspaceId: workspace.workspaceId,
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  assertEnterpriseSignInAllowed,
  authenticationMethodFromContext,
  provisionEnterpriseSsoUser,
} from "~~/lib/auth/enterpriseIdentityPolicy";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedVerifiedProvider(protocol: "oidc" | "saml", suffix: string) {
  const now = new Date("2026-07-17T02:00:00.000Z");
  const ownerUserId = `owner-${suffix}`;
  const targetUserId = `target-${suffix}`;
  const providerId = `rlsso_${suffix}`;
  const domain = `${suffix}.example.test`;
  const owner = await resolveBetterAuthPrincipal({ betterAuthUserId: ownerUserId, now });
  const workspace = await createWorkspace({ name: `${protocol} workspace`, ownerAddress: owner.principalId });
  for (const [id, name, email] of [
    [ownerUserId, "Owner", `owner@${domain}`],
    [targetUserId, "Target", `target@${domain}`],
  ]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_better_auth_users
            (id,name,email,email_verified,created_at,updated_at,role,banned)
            VALUES (?,?,?,true,?,?,NULL,false)`,
      args: [id, name, email, now, now],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_sso_providers
          (id,issuer,oidc_config,saml_config,user_id,provider_id,organization_id,domain,domain_verified)
          VALUES (?,?,?, ?,?,?,NULL,?,true)`,
    args: [
      `sso-row-${suffix}`,
      `https://id.${domain}`,
      protocol === "oidc" ? "{}" : null,
      protocol === "saml" ? "{}" : null,
      ownerUserId,
      providerId,
      domain,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_enterprise_identity_providers
          (provider_id,workspace_id,protocol,domain,enforce_sso,status,created_by,last_sso_at,created_at,updated_at)
          VALUES (?,?,?,?,true,'active',?,NULL,?,?)`,
    args: [providerId, workspace.workspaceId, protocol, domain, owner.principalId, now, now],
  });
  return { domain, providerId, targetUserId, workspace };
}

test("OIDC and strict SAML callback contexts bind the provider to the new session", () => {
  assert.equal(authenticationMethodFromContext({ path: "/sso/callback/rlsso_oidc" }), "sso:rlsso_oidc");
  assert.equal(authenticationMethodFromContext({ path: "/sso/saml2/sp/acs/rlsso_saml" }), "sso:rlsso_saml");
});

test("SSO-only policy rejects OTP/social sessions and accepts only the matching session-bound provider", async () => {
  const seeded = await seedVerifiedProvider("oidc", "enforced");
  await assert.rejects(
    () => assertEnterpriseSignInAllowed(`target@${seeded.domain}`, "email-otp"),
    /organization's SSO provider/u,
  );
  await assert.rejects(
    () => assertEnterpriseSignInAllowed(`target@${seeded.domain}`, "social:google"),
    /organization's SSO provider/u,
  );
  assert.deepEqual(await assertEnterpriseSignInAllowed(`target@${seeded.domain}`, `sso:${seeded.providerId}`), {
    domain: seeded.domain,
    providerId: seeded.providerId,
    workspaceId: seeded.workspace.workspaceId,
  });
});

test("verified OIDC provisioning creates a default member and RateLoop-owned managed mapping", async () => {
  const seeded = await seedVerifiedProvider("oidc", "oidc-provision");
  await provisionEnterpriseSsoUser({
    provider: { domain: seeded.domain, providerId: seeded.providerId },
    user: { id: seeded.targetUserId, email: `target@${seeded.domain}`, name: "Target" },
  });
  const target = await resolveBetterAuthPrincipal({ betterAuthUserId: seeded.targetUserId });
  const member = await dbClient.execute({
    sql: `SELECT m.role,e.source,e.status FROM tokenless_workspace_members m
          JOIN tokenless_enterprise_managed_members e
            ON e.workspace_id=m.workspace_id AND e.principal_id=m.account_address
          WHERE m.workspace_id=? AND m.account_address=?`,
    args: [seeded.workspace.workspaceId, target.principalId],
  });
  assert.deepEqual(member.rows[0], { role: "member", source: "sso", status: "active" });
});

test("verified SAML provisioning never overwrites an existing RateLoop workspace role", async () => {
  const seeded = await seedVerifiedProvider("saml", "saml-provision");
  const target = await resolveBetterAuthPrincipal({ betterAuthUserId: seeded.targetUserId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'admin',?)`,
    args: [seeded.workspace.workspaceId, target.principalId, new Date()],
  });
  await provisionEnterpriseSsoUser({
    provider: { domain: seeded.domain, providerId: seeded.providerId },
    user: { id: seeded.targetUserId, email: `target@${seeded.domain}`, name: "Target" },
  });
  const member = await dbClient.execute({
    sql: "SELECT role FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [seeded.workspace.workspaceId, target.principalId],
  });
  assert.equal(member.rows[0]?.role, "admin");
});

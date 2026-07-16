import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { createAuthSession, findAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { deleteAccount, getAccountDeletionPreview } from "~~/lib/privacy/accountDeletion";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedBetterAuthUser(id: string, email = "delete@example.test") {
  const now = new Date("2026-07-16T08:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, 'Delete me', ?, true, ?, ?)`,
    args: [id, email, now, now],
  });
}

test("account deletion revokes authentication, removes shared access, and permits a genuinely fresh signup", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-old");
  const oldIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" });
  const oldSession = await createAuthSession(oldIdentity, now);
  const shared = await createWorkspace({
    name: "Shared",
    ownerAddress: "0x1111111111111111111111111111111111111111",
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [shared.workspaceId, oldIdentity.principalId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_self', ?, 'payout', '0x2222222222222222222222222222222222222222',
                  'self_custodial', 8453, 'proof', ?, ?)`,
    args: [oldIdentity.principalId, now, now],
  });
  for (const type of ["email-verification", "sign-in", "forget-password", "change-email"]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_better_auth_verifications
            (id, identifier, value, expires_at, created_at, updated_at)
            VALUES (?, ?, 'otp', ?, ?, ?)`,
      args: [`verification-${type}`, `${type}-otp-delete@example.test`, new Date(now.getTime() + 60_000), now, now],
    });
  }

  const preview = await getAccountDeletionPreview(oldIdentity.principalId);
  assert.equal(preview.impact.sharedWorkspaces, 1);
  assert.deepEqual(preview.blockers, []);

  const deleted = await deleteAccount({
    betterAuthUserId: "better-old",
    confirmation: "DELETE",
    principalId: oldIdentity.principalId,
    now,
  });
  assert.match(deleted.receiptDigest, /^[0-9a-f]{64}$/);
  assert.equal(await findAuthSession(oldSession.token, now), null);

  const stored = await dbClient.execute({
    sql: `SELECT
            (SELECT status FROM tokenless_principals WHERE principal_id = ?) AS principal_status,
            (SELECT status FROM tokenless_identity_bindings WHERE principal_id = ?) AS binding_status,
            (SELECT COUNT(*) FROM tokenless_better_auth_users WHERE id = 'better-old') AS better_users,
            (SELECT COUNT(*) FROM tokenless_better_auth_verifications) AS verifications,
            (SELECT COUNT(*) FROM tokenless_browser_identities WHERE principal_address = ?) AS browser_identities,
            (SELECT COUNT(*) FROM tokenless_workspace_members WHERE account_address = ?) AS memberships,
            (SELECT COUNT(*) FROM tokenless_wallet_bindings WHERE principal_id = ?) AS wallet_bindings,
            (SELECT COUNT(*) FROM tokenless_deletion_job_categories WHERE job_id = ?) AS categories`,
    args: [
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      deleted.jobId,
    ],
  });
  const storedRow = Object.fromEntries(
    Object.entries(stored.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  assert.deepEqual(storedRow, {
    principal_status: "deleted",
    binding_status: "revoked",
    better_users: 0,
    verifications: 0,
    browser_identities: 0,
    memberships: 0,
    wallet_bindings: 0,
    categories: 7,
  });

  await assert.rejects(
    () => resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" }),
    /Unable to create the RateLoop principal binding/,
  );
  await assert.rejects(
    () => createWorkspace({ name: "Orphan", ownerAddress: oldIdentity.principalId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "principal_inactive",
  );

  await seedBetterAuthUser("better-new");
  const freshIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-new" });
  assert.notEqual(freshIdentity.principalId, oldIdentity.principalId);
  assert.equal((await getAccountDeletionPreview(freshIdentity.principalId)).impact.ownedWorkspaces, 0);
});

test("account deletion blocks sole workspace owners and active managed wallets", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-blocked", "blocked@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-blocked" });
  await createWorkspace({ name: "Owned", ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_managed', ?, 'recovery', '0x3333333333333333333333333333333333333333',
                  'thirdweb', 8453, 'proof', ?, ?)`,
    args: [identity.principalId, now, now],
  });
  const preview = await getAccountDeletionPreview(identity.principalId);
  assert.deepEqual(
    preview.blockers.map(blocker => blocker.code),
    ["owned_workspaces_require_resolution", "managed_wallet_recovery_required"],
  );
  await assert.rejects(
    () =>
      deleteAccount({
        betterAuthUserId: "better-blocked",
        confirmation: "DELETE",
        principalId: identity.principalId,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "owned_workspaces_require_resolution",
  );
});

test("the account deletion route requires the product session, same-origin mutation, and recent Better Auth", () => {
  const source = readFileSync(join(process.cwd(), "app/api/account/deletion/route.ts"), "utf8");
  assert.match(source, /requireBrowserSession\(request\)/);
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(source, /getBetterAuth\(\)\.api\.getSession\(\{ headers: request\.headers \}\)/);
  assert.match(source, /recent_authentication_required/);
  assert.match(source, /betterAuthUserId: betterSession\.user\.id/);
  assert.match(source, /response\.cookies\.delete\(AUTH_SESSION_COOKIE\)/);
});

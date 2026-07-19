import { canRemovePasskey, removePrincipalPasskey } from "./passkeys";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("the only passkey is retained when no other sign-in method is available", () => {
  assert.equal(canRemovePasskey({ emailOtpEnabled: false, emailVerified: false, passkeyCount: 1 }), false);
});

test("the only passkey can be removed when a verified fallback remains", () => {
  assert.equal(canRemovePasskey({ emailOtpEnabled: true, emailVerified: true, passkeyCount: 1 }), true);
  assert.equal(canRemovePasskey({ emailOtpEnabled: false, emailVerified: false, passkeyCount: 1 }), false);
});

test("one of multiple passkeys can always be removed", () => {
  assert.equal(canRemovePasskey({ emailOtpEnabled: false, emailVerified: false, passkeyCount: 2 }), true);
});

test("Better Auth blocks direct deletion and requires an exact add proof", () => {
  const policy = readFileSync(new URL("./passkeys.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("./betterAuth.ts", import.meta.url), "utf8");
  assert.match(policy, /context\.path === "\/passkey\/delete-passkey"/);
  assert.match(policy, /PASSKEY_DELETION_REQUIRES_RATELOOP_REAUTH/);
  assert.match(policy, /context\.path === "\/passkey\/verify-registration"/);
  assert.match(policy, /consumePasskeyAddProof/);
  assert.match(auth, /passkeySafetyPlugin\(\)/);
});

test("serialized concurrent removals cannot delete both remaining factors", async () => {
  const now = new Date("2026-07-19T10:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at)
          VALUES ('better-passkeys','Passkey test','passkeys@example.test',false,?,?)`,
    args: [now, now],
  });
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-passkeys", now });
  for (const [id, credential] of [
    ["pk_first", "credential-first"],
    ["pk_second", "credential-second"],
  ]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_better_auth_passkeys
            (id,name,public_key,user_id,credential_id,counter,device_type,backed_up,created_at)
            VALUES (?,?,'public-key','better-passkeys',?,0,'singleDevice',false,?)`,
      args: [id, id, credential, now],
    });
  }

  const results = await Promise.allSettled(
    ["pk_first", "pk_second"].map(passkeyId =>
      removePrincipalPasskey({
        betterAuthUserId: "better-passkeys",
        emailOtpEnabled: false,
        passkeyId,
        principalId: identity.principalId,
      }),
    ),
  );
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const rejection = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejection.reason instanceof TokenlessServiceError);
  assert.equal(rejection.reason.code, "last_sign_in_method");
  const remaining = await dbClient.execute({
    sql: `SELECT id FROM tokenless_better_auth_passkeys WHERE user_id = 'better-passkeys'`,
  });
  assert.equal(remaining.rowCount, 1);
});

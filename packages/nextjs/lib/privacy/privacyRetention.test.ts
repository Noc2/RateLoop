import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { purgeExpiredPrivacyOperations } from "~~/lib/privacy/privacyRetention";

const NOW = new Date("2026-07-26T10:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("privacy retention purges expired OTP and session telemetry while preserving current rows", async () => {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES ('0x1111111111111111111111111111111111111111','active',?,?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_verifications
          (id,identifier,value,expires_at,created_at,updated_at)
          VALUES ('verification_expired','sign-in-otp-test@example.test','secret',?,?,?),
                 ('verification_current','sign-in-otp-current@example.test','secret',?,?,?)`,
    args: [
      new Date(NOW.getTime() - 1),
      new Date(NOW.getTime() - 60_000),
      new Date(NOW.getTime() - 60_000),
      new Date(NOW.getTime() + 60_000),
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_auth_sessions
          (session_hash,account_address,expires_at,revoked_at,created_at,auth_provider,principal_id)
          VALUES ('session_expired','0x1111111111111111111111111111111111111111',?,NULL,?,'base_account',
                  '0x1111111111111111111111111111111111111111')`,
    args: [new Date(NOW.getTime() - 40 * 86_400_000), new Date(NOW.getTime() - 50 * 86_400_000)],
  });
  const purged = await purgeExpiredPrivacyOperations(NOW);
  assert.equal(purged.verifications, 1);
  assert.equal(purged.productSessions, 1);
  const rows = await dbClient.execute("SELECT id FROM tokenless_better_auth_verifications ORDER BY id");
  assert.deepEqual(rows.rows, [{ id: "verification_current" }]);
});

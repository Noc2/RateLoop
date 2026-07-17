import {
  DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
  buildTokenlessSignedUnsubscribeToken,
  getTokenlessEmailNotificationSettings,
  getTokenlessNotificationPreferences,
  normalizeNotificationEmail,
  normalizeNotificationPreferences,
  unsubscribeTokenlessEmailNotificationToken,
  upsertTokenlessEmailNotificationSettings,
  upsertTokenlessNotificationPreferences,
} from "./tokenless";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const PRINCIPAL = "rlp_notification_settings_test_0001";
const NOW = new Date("2026-07-15T15:00:00.000Z");
const UNSUBSCRIBE_SECRET = "notification-settings-test-secret-0001";

beforeEach(async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, 'email', true, ?, ?, ?)`,
    args: [PRINCIPAL, NOW, NOW, NOW],
  });
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("tokenless notification preferences require every supported boolean", () => {
  assert.deepEqual(normalizeNotificationPreferences(DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES), {
    assignmentAvailable: true,
    assignmentCompleted: true,
    paymentUpdates: true,
    askResults: true,
    accountSecurity: true,
    oversightAlerts: false,
  });
  assert.throws(
    () => normalizeNotificationPreferences({ ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES, askResults: "yes" }),
    /askResults must be a boolean/,
  );
  assert.throws(
    () => normalizeNotificationPreferences({ ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES, oversightAlerts: "on" }),
    /oversightAlerts must be a boolean/,
  );
  assert.throws(
    () => normalizeNotificationPreferences({ ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES, accountSecurity: false }),
    /Account and security notifications are required/,
  );
});

test("tokenless notification email normalization is lowercase and rejects malformed addresses", () => {
  assert.equal(normalizeNotificationEmail(" Person@Example.com "), "person@example.com");
  assert.equal(normalizeNotificationEmail(""), "");
  assert.throws(() => normalizeNotificationEmail("not-an-email"), /valid email/);
});

test("notification preferences accept an opaque Better Auth principal", async () => {
  assert.deepEqual(await getTokenlessNotificationPreferences(PRINCIPAL), DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES);

  const preferences = {
    ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
    assignmentCompleted: false,
    askResults: false,
    oversightAlerts: true,
  };
  assert.deepEqual(await upsertTokenlessNotificationPreferences(PRINCIPAL, preferences), preferences);
  assert.deepEqual(await getTokenlessNotificationPreferences(PRINCIPAL), preferences);
});

test("notification email settings and signed unsubscribe accept an opaque Better Auth principal", async () => {
  assert.deepEqual(await getTokenlessEmailNotificationSettings(PRINCIPAL, true), {
    ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
    email: "",
    verified: false,
    deliveryConfigured: true,
  });

  const result = await upsertTokenlessEmailNotificationSettings(
    PRINCIPAL,
    "reviewer@example.test",
    DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
  );
  assert.equal(result.settings.email, "reviewer@example.test");
  assert.equal(result.settings.verified, false);
  assert.ok(result.verificationToken);

  const unsubscribeTokenHash = createHash("sha256").update("opaque-principal-unsubscribe").digest("hex");
  await dbClient.execute({
    sql: `UPDATE tokenless_notification_email_subscriptions
          SET unsubscribe_token_hash = ? WHERE principal_address = ?`,
    args: [unsubscribeTokenHash, PRINCIPAL],
  });
  const token = buildTokenlessSignedUnsubscribeToken(
    { principalAddress: PRINCIPAL, unsubscribeTokenHash },
    UNSUBSCRIBE_SECRET,
  );
  assert.deepEqual(await unsubscribeTokenlessEmailNotificationToken(token, UNSUBSCRIBE_SECRET), { ok: true });
});

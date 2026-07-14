import {
  DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES,
  normalizeNotificationEmail,
  normalizeNotificationPreferences,
} from "./tokenless";
import assert from "node:assert/strict";
import test from "node:test";

test("tokenless notification preferences require every supported boolean", () => {
  assert.deepEqual(normalizeNotificationPreferences(DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES), {
    assignmentAvailable: true,
    assignmentCompleted: true,
    paymentUpdates: true,
    askResults: true,
    accountSecurity: true,
  });
  assert.throws(
    () => normalizeNotificationPreferences({ ...DEFAULT_TOKENLESS_NOTIFICATION_PREFERENCES, askResults: "yes" }),
    /askResults must be a boolean/,
  );
});

test("tokenless notification email normalization is lowercase and rejects malformed addresses", () => {
  assert.equal(normalizeNotificationEmail(" Person@Example.com "), "person@example.com");
  assert.equal(normalizeNotificationEmail(""), "");
  assert.throws(() => normalizeNotificationEmail("not-an-email"), /valid email/);
});

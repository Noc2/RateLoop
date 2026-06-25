import assert from "node:assert/strict";
import { test } from "node:test";
import { isEmailNotificationEmailInUseError } from "~~/lib/notifications/emailSettings";

test("email notification conflict helper recognizes database unique constraint races", () => {
  const postgresError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "notification_email_subscriptions_email_unique",
  });
  const sqliteError = new Error(
    "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: notification_email_subscriptions.email",
  );
  const wrappedError = new Error("transaction failed", { cause: postgresError });

  assert.equal(isEmailNotificationEmailInUseError(new Error("EMAIL_IN_USE")), true);
  assert.equal(isEmailNotificationEmailInUseError(postgresError), true);
  assert.equal(isEmailNotificationEmailInUseError(sqliteError), true);
  assert.equal(isEmailNotificationEmailInUseError(wrappedError), true);
  assert.equal(isEmailNotificationEmailInUseError(new Error("different failure")), false);
});

import {
  getEmailNotificationPrimaryActionLabel,
  getEmailNotificationStatusText,
  isEmailNotificationPrimaryActionDisabled,
} from "./NotificationSettingsPanel.helpers";
import assert from "node:assert/strict";
import test from "node:test";

test("email notification status names empty state as wallet scoped", () => {
  assert.equal(
    getEmailNotificationStatusText({
      email: "",
      verified: false,
    }),
    "No email configured for this wallet.",
  );
});

test("email notification primary action is disabled for a clean empty wallet", () => {
  assert.equal(
    getEmailNotificationPrimaryActionLabel({
      draftEmail: "",
      savedEmail: "",
      isSaving: false,
    }),
    "Save email settings",
  );
  assert.equal(
    isEmailNotificationPrimaryActionDisabled({
      draftEmail: "",
      emailDirty: false,
      isSaving: false,
      savedEmail: "",
    }),
    true,
  );
});

test("email notification primary action removes only when a saved email is cleared", () => {
  assert.equal(
    getEmailNotificationPrimaryActionLabel({
      draftEmail: "",
      savedEmail: "you@example.com",
      isSaving: false,
    }),
    "Remove email notifications",
  );
  assert.equal(
    isEmailNotificationPrimaryActionDisabled({
      draftEmail: "",
      emailDirty: true,
      isSaving: false,
      savedEmail: "you@example.com",
    }),
    false,
  );
});

test("email notification primary action saves when a draft email exists", () => {
  assert.equal(
    getEmailNotificationPrimaryActionLabel({
      draftEmail: "new@example.com",
      savedEmail: "",
      isSaving: false,
    }),
    "Save email settings",
  );
  assert.equal(
    isEmailNotificationPrimaryActionDisabled({
      draftEmail: "new@example.com",
      emailDirty: true,
      isSaving: false,
      savedEmail: "",
    }),
    false,
  );
});

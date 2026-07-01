import { type EmailNotificationSettingsState } from "~~/lib/notifications/emailShared";

export function getEmailNotificationStatusText(settings: Pick<EmailNotificationSettingsState, "email" | "verified">) {
  if (!settings.email) {
    return "No email configured for this wallet.";
  }

  return settings.verified ? `Verified: ${settings.email}` : `Verification pending for ${settings.email}`;
}

export function getEmailNotificationPrimaryActionLabel({
  draftEmail,
  savedEmail,
  isSaving,
}: {
  draftEmail: string;
  savedEmail: string;
  isSaving: boolean;
}) {
  if (isSaving) {
    return "Saving...";
  }

  if (draftEmail.trim().length > 0) {
    return "Save email settings";
  }

  return savedEmail.trim().length > 0 ? "Remove email notifications" : "Save email settings";
}

export function isEmailNotificationPrimaryActionDisabled({
  draftEmail,
  emailDirty,
  isSaving,
  savedEmail,
}: {
  draftEmail: string;
  emailDirty: boolean;
  isSaving: boolean;
  savedEmail: string;
}) {
  if (isSaving) {
    return true;
  }

  const hasDraftEmail = draftEmail.trim().length > 0;
  const hasSavedEmail = savedEmail.trim().length > 0;

  if (!emailDirty && hasDraftEmail) {
    return true;
  }

  return !hasSavedEmail && !hasDraftEmail;
}

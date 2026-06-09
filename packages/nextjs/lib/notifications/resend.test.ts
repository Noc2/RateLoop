import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isResendConfigured, isResendDeliveryError, normalizeResendFromEmail } from "~~/lib/notifications/resend";

const env = process.env as Record<string, string | undefined>;
const originalResendApiKey = env.RESEND_API_KEY;
const originalResendFromEmail = env.RESEND_FROM_EMAIL;

afterEach(() => {
  if (originalResendApiKey === undefined) {
    delete env.RESEND_API_KEY;
  } else {
    env.RESEND_API_KEY = originalResendApiKey;
  }

  if (originalResendFromEmail === undefined) {
    delete env.RESEND_FROM_EMAIL;
  } else {
    env.RESEND_FROM_EMAIL = originalResendFromEmail;
  }
});

test("normalizeResendFromEmail accepts Resend sender email formats", () => {
  assert.equal(normalizeResendFromEmail("notifications@info.rateloop.ai"), "notifications@info.rateloop.ai");
  assert.equal(
    normalizeResendFromEmail("RateLoop <notifications@info.rateloop.ai>"),
    "RateLoop <notifications@info.rateloop.ai>",
  );
});

test("normalizeResendFromEmail rejects bare domains and malformed senders", () => {
  assert.equal(normalizeResendFromEmail("info.rateloop.ai"), null);
  assert.equal(normalizeResendFromEmail("RateLoop <info.rateloop.ai>"), null);
  assert.equal(normalizeResendFromEmail("notifications@info"), null);
  assert.equal(normalizeResendFromEmail(undefined), null);
});

test("isResendConfigured requires both an API key and a valid sender address", () => {
  env.RESEND_API_KEY = "re_test";
  env.RESEND_FROM_EMAIL = "info.rateloop.ai";
  assert.equal(isResendConfigured(), false);

  env.RESEND_FROM_EMAIL = "RateLoop <notifications@info.rateloop.ai>";
  assert.equal(isResendConfigured(), true);

  delete env.RESEND_API_KEY;
  assert.equal(isResendConfigured(), false);
});

test("isResendDeliveryError recognizes configuration and provider failures", () => {
  assert.equal(isResendDeliveryError(new Error("Resend is not configured")), true);
  assert.equal(isResendDeliveryError(new Error("Resend request failed: 422 sender invalid")), true);
  assert.equal(isResendDeliveryError(new Error("EMAIL_IN_USE")), false);
  assert.equal(isResendDeliveryError("Resend request failed: 422"), false);
});

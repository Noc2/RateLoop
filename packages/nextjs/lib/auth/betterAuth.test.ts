import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  __resetBetterAuthForTests,
  getBetterAuth,
  getBetterAuthConfiguration,
  getBetterAuthTrustedOrigins,
} from "~~/lib/auth/betterAuth";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

beforeEach(() => {
  process.env.APP_URL = "https://rateloop-tokenless.vercel.app";
  process.env.BETTER_AUTH_SECRET = "b".repeat(48);
  process.env.BETTER_AUTH_PASSKEY_RP_ID = "rateloop-tokenless.vercel.app";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __resetBetterAuthForTests();
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_PASSKEY_RP_ID;
  delete process.env.BETTER_AUTH_APPLE_CLIENT_ID;
  delete process.env.BETTER_AUTH_APPLE_CLIENT_SECRET;
  delete process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED;
  delete process.env.TOKENLESS_SSO_TRUSTED_ISSUERS;
  __resetBetterAuthForTests();
  __setDatabaseResourcesForTests(null);
});

test("Better Auth is self-hosted at the isolated origin with email providers disabled until configured", async () => {
  assert.deepEqual(getBetterAuthConfiguration(), {
    appleEnabled: false,
    emailOtpEnabled: false,
    googleEnabled: false,
    origin: "https://rateloop-tokenless.vercel.app",
    rpID: "rateloop-tokenless.vercel.app",
  });
  const response = await getBetterAuth().handler(
    new Request("https://rateloop-tokenless.vercel.app/api/auth/better/get-session"),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
});

test("Apple OAuth trusts Apple's form-post origin only when its credential pair is configured", () => {
  assert.deepEqual(getBetterAuthTrustedOrigins(), ["https://rateloop-tokenless.vercel.app"]);

  process.env.BETTER_AUTH_APPLE_CLIENT_ID = "ai.rateloop.tokenless.web";
  process.env.BETTER_AUTH_APPLE_CLIENT_SECRET = "apple-client-secret";

  assert.deepEqual(getBetterAuthTrustedOrigins(), [
    "https://rateloop-tokenless.vercel.app",
    "https://appleid.apple.com",
  ]);
});

test("enterprise identity endpoints and issuer origins are absent while the feature is disabled", async () => {
  process.env.TOKENLESS_SSO_TRUSTED_ISSUERS = "https://identity.example.test";
  assert.deepEqual(getBetterAuthTrustedOrigins(), ["https://rateloop-tokenless.vercel.app"]);

  const response = await getBetterAuth().handler(
    new Request("https://rateloop-tokenless.vercel.app/api/auth/better/scim/v2/ServiceProviderConfig"),
  );
  assert.equal(response.status, 404);
});

test("enterprise identity endpoints and configured issuer origins activate together", async () => {
  process.env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED = "true";
  process.env.TOKENLESS_SSO_TRUSTED_ISSUERS = "https://identity.example.test";
  __resetBetterAuthForTests();
  assert.deepEqual(getBetterAuthTrustedOrigins(), [
    "https://rateloop-tokenless.vercel.app",
    "https://identity.example.test",
  ]);

  const response = await getBetterAuth().handler(
    new Request("https://rateloop-tokenless.vercel.app/api/auth/better/scim/v2/ServiceProviderConfig"),
  );
  assert.equal(response.status, 200);
});

test("email OTP writes a generated verification ID before delivery", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "RateLoop <login@info.rateloop.ai>";
  __resetBetterAuthForTests();

  const originalFetch = globalThis.fetch;
  let resendRequests = 0;
  globalThis.fetch = async input => {
    assert.equal(input.toString(), "https://api.resend.com/emails");
    resendRequests += 1;
    return Response.json({ id: "email_test" });
  };

  try {
    const response = await getBetterAuth().handler(
      new Request("https://rateloop-tokenless.vercel.app/api/auth/better/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com", type: "sign-in" }),
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(resendRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    __resetBetterAuthForTests();
  }
});

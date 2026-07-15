import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __resetBetterAuthForTests, getBetterAuth, getBetterAuthConfiguration } from "~~/lib/auth/betterAuth";
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

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

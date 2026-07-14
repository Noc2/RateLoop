import { NextRequest } from "next/server";
import { GET } from "./route";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const previousSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("scheduled maintenance route rejects requests without the Vercel cron bearer secret", async () => {
  process.env.CRON_SECRET = "cron-test-secret";
  const response = await GET(new NextRequest("https://tokenless.example.test/api/cron/tokenless-maintenance"));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "invalid_cron_credential");
});

test("scheduled maintenance route fails closed when CRON_SECRET is not configured", async () => {
  delete process.env.CRON_SECRET;
  const response = await GET(new NextRequest("https://tokenless.example.test/api/cron/tokenless-maintenance"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "cron_unavailable");
});

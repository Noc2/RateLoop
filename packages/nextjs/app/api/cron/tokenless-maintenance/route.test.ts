import { NextRequest } from "next/server";
import { GET, maxDuration, scheduledMaintenanceResponse } from "./route";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SCHEDULED_MAINTENANCE_PROCESSING_BUDGET_MS } from "~~/lib/tokenless/scheduledMaintenance";

const previousSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("scheduled maintenance reserves time to persist health before the route deadline", () => {
  assert.equal(maxDuration, 60);
  assert.ok(SCHEDULED_MAINTENANCE_PROCESSING_BUDGET_MS <= maxDuration * 1_000 - 5_000);
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

test("repeated processor failure returns a privacy-safe distinct non-2xx response", async () => {
  const privateResult = {
    runId: "swr_private",
    status: "degraded",
    summary: {
      processorFailures: [
        {
          processor: "deliverWebhooks",
          errorCode: "private_error",
          errorDigest: `sha256:${"a".repeat(64)}`,
        },
      ],
    },
  };
  const response = scheduledMaintenanceResponse(privateResult, true);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), {
    code: "scheduled_processor_repeated_failure",
    message: "Scheduled maintenance requires operator attention.",
  });
  assert.doesNotMatch(body, /deliverWebhooks|private_error|sha256|swr_private/u);
});

test("transient or recovered processor health keeps the normal cron response", async () => {
  const result = { runId: "swr_public", status: "degraded" };
  const response = scheduledMaintenanceResponse(result, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});

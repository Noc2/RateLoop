import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;

function makeRequest(body: Record<string, unknown> | string) {
  return new NextRequest("https://rateloop.ai/api/transactions/timing", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-real-ip": "127.0.0.1",
    },
    method: "POST",
  });
}

beforeEach(() => {
  __setRateLimitStoreForTests({
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("api_rate_limits")) {
        return { rows: [{ request_count: 1 }] } as any;
      }
      if (sql.includes("api_rate_limit_maintenance")) {
        return { rows: [{ name: "cleanup" }] } as any;
      }
      return { rows: [] } as any;
    },
  });
  console.warn = () => {};
});

after(() => {
  __setRateLimitStoreForTests(null);
  console.info = originalConsoleInfo;
  console.warn = originalConsoleWarn;
});

test("transaction timing route logs sanitized timing payloads", async () => {
  const logs: unknown[][] = [];
  console.info = (...args: unknown[]) => {
    logs.push(args);
  };

  const response = await POST(
    makeRequest({
      action: "vote",
      callCount: 2,
      callTypes: ["approve", "commitVote", "x".repeat(200)],
      chainId: 8453,
      contentRegistryAddress: "0x1111111111111111111111111111111111111111",
      deltaMs: 4.4,
      deploymentKey: "8453:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222",
      elapsedMs: 120.2,
      event: "success",
      feedbackRegistryAddress: "0x2222222222222222222222222222222222222222",
      metadata: {
        authorization: "do-not-log",
        contentId: "3",
        initialRequiresOpenRound: true,
        isGatedContext: true,
        ok: true,
        operation: "confirm",
        roundId: "6",
        signature: "do-not-log",
      },
      route: "thirdweb",
      runId: "run-1",
      sendCallsDurationMs: 18001.8,
      sendCallsSlowThresholdMs: 8000,
      source: "thirdweb-batch",
      sponsorshipMode: "sponsored",
      status: "success",
      statusToastSuppressed: true,
      thirdwebCallsId: `0x${"a".repeat(64)}`,
      walletExecutionMode: "sponsored_7702",
      walletId: "inApp",
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.[0], "[transaction-timing]");

  const payload = logs[0]?.[1] as {
    callTypes: string[];
    contentRegistryAddress: string;
    deploymentKey: string;
    feedbackRegistryAddress: string;
    metadata: Record<string, unknown>;
    sendCallsDurationMs: number;
    sendCallsSlowThresholdMs: number;
    statusToastSuppressed: boolean;
    thirdwebCallsId: string;
    walletExecutionMode: string;
    walletId: string;
  };
  assert.deepEqual(payload.metadata, {
    contentId: "3",
    initialRequiresOpenRound: true,
    isGatedContext: true,
    ok: true,
    operation: "confirm",
    roundId: "6",
  });
  assert.equal(payload.callTypes[0], "approve");
  assert.equal(payload.callTypes[1], "commitVote");
  assert.equal(payload.callTypes[2]?.length, 120);
  assert.equal(payload.contentRegistryAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(
    payload.deploymentKey,
    "8453:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222",
  );
  assert.equal(payload.feedbackRegistryAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(payload.sendCallsDurationMs, 18002);
  assert.equal(payload.sendCallsSlowThresholdMs, 8000);
  assert.equal(payload.statusToastSuppressed, true);
  assert.equal(payload.thirdwebCallsId, `0x${"a".repeat(64)}`);
  assert.equal(payload.walletExecutionMode, "sponsored_7702");
  assert.equal(payload.walletId, "inApp");
});

test("transaction timing route rejects missing required fields", async () => {
  const response = await POST(makeRequest({ event: "success", source: "thirdweb-batch" }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid timing payload." });
});

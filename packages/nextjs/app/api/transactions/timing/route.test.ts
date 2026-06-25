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
      deltaMs: 4.4,
      elapsedMs: 120.2,
      event: "success",
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
      source: "thirdweb-batch",
      sponsorshipMode: "sponsored",
      status: "success",
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.[0], "[transaction-timing]");

  const payload = logs[0]?.[1] as { callTypes: string[]; metadata: Record<string, unknown> };
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
});

test("transaction timing route rejects missing required fields", async () => {
  const response = await POST(makeRequest({ event: "success", source: "thirdweb-batch" }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid timing payload." });
});

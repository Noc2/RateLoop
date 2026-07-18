import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/quote/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "quote-route-rate-limit-secret-with-at-least-32-characters";
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalRateLimitSecret;
});

function quoteRequest(visibility: "private" | "public") {
  return {
    audience: { admissionPolicyHash: `0x${"ab".repeat(32)}`, source: "customer_invited" },
    budget: { attemptReserveAtomic: "5000000", bountyAtomic: "25000000", feeBps: 750 },
    ...(visibility === "public" ? { confirmedNoSensitiveData: true, dataClassification: "public" as const } : {}),
    question: { kind: "binary", prompt: "Ship this?", rationale: { mode: "optional" } },
    requestedPanelSize: 15,
    responseWindowSeconds: 3_600,
    visibility,
  };
}

function request(body: unknown, headers: HeadersInit = {}) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/quote", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.42",
      ...headers,
    },
    method: "POST",
  });
}

test("quote route permits safe public quotes but requires authentication for private content", async () => {
  const privateResponse = await POST(request(quoteRequest("private")));
  assert.equal(privateResponse.status, 401);
  assert.equal((await privateResponse.json()).code, "authentication_required");

  const publicResponse = await POST(request(quoteRequest("public")));
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  assert.match((await publicResponse.json()).quoteId, /^qte_[0-9a-f]{32}$/);

  const quotes = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_quotes");
  assert.equal(Number(quotes.rows[0]?.count), 1);
});

test("quote route rejects oversized bodies before parsing or persistence", async () => {
  const response = await POST(
    request(quoteRequest("public"), {
      "content-length": String(64 * 1024 + 1),
    }),
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
  const quotes = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_quotes");
  assert.equal(Number(quotes.rows[0]?.count), 0);
});

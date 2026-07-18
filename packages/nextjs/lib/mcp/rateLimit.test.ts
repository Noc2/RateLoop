import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";

const originalSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

beforeEach(() => {
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "test-only-rate-limit-secret-with-at-least-32-characters";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalSecret;
});

test("atomically limits each hashed bearer client to 60 requests per minute", async () => {
  const rawBearer = "mcp-client-secret-that-must-never-be-stored";
  const headers = new Headers({ authorization: `Bearer ${rawBearer}` });
  const now = new Date("2026-07-13T12:34:12.000Z");

  for (let request = 1; request <= 60; request += 1) {
    const result = await consumeMcpRateLimit(headers, now);
    assert.equal(result.allowed, true);
    assert.equal(result.requestCount, request);
  }
  const denied = await consumeMcpRateLimit(headers, now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.requestCount, 61);
  assert.equal(denied.retryAfterSeconds, 48);

  const stored = await dbClient.execute(
    "SELECT client_hash, request_count, window_started_at FROM tokenless_mcp_rate_limits",
  );
  assert.equal(stored.rows.length, 1);
  assert.match(String(stored.rows[0]?.client_hash), /^[0-9a-f]{64}$/);
  assert.notEqual(stored.rows[0]?.client_hash, rawBearer);
  assert.equal(Number(stored.rows[0]?.request_count), 61);
  assert.equal(JSON.stringify(stored.rows).includes(rawBearer), false);
});

test("uses a separate minute window and fails closed without identity or secret", async () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.4" });
  const first = await consumeMcpRateLimit(headers, new Date("2026-07-13T12:34:59.000Z"));
  const next = await consumeMcpRateLimit(headers, new Date("2026-07-13T12:35:00.000Z"));
  assert.equal(first.requestCount, 1);
  assert.equal(next.requestCount, 1);
  const stored = await dbClient.execute("SELECT request_count, window_started_at FROM tokenless_mcp_rate_limits");
  assert.equal(stored.rows.length, 1);
  assert.equal(Number(stored.rows[0]?.request_count), 1);

  await assert.rejects(
    () => consumeMcpRateLimit(new Headers()),
    (error: unknown) => error instanceof TokenlessMcpHttpError && error.code === "rate_limit_identity_unavailable",
  );
  delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  await assert.rejects(
    () => consumeMcpRateLimit(headers),
    (error: unknown) => error instanceof TokenlessMcpHttpError && error.code === "rate_limit_unavailable",
  );
});

test("uses Vercel's authoritative client IP instead of caller-controlled proxy headers", async () => {
  const now = new Date("2026-07-13T12:34:12.000Z");
  const first = await consumeMcpRateLimit(
    new Headers({
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "198.51.100.2",
      "x-real-ip": "198.51.100.3",
      "x-vercel-forwarded-for": "203.0.113.9",
    }),
    now,
  );
  const second = await consumeMcpRateLimit(
    new Headers({
      "cf-connecting-ip": "192.0.2.1",
      "x-forwarded-for": "192.0.2.2",
      "x-real-ip": "192.0.2.3",
      "x-vercel-forwarded-for": "203.0.113.9",
    }),
    now,
  );

  assert.equal(first.requestCount, 1);
  assert.equal(second.requestCount, 2);
  const stored = await dbClient.execute("SELECT client_hash, request_count FROM tokenless_mcp_rate_limits");
  assert.equal(stored.rows.length, 1);
  assert.equal(Number(stored.rows[0]?.request_count), 2);
});

test("fails closed when the atomic database counter is unavailable", async () => {
  const resources = createMemoryDatabaseResources();
  resources.client.execute = async () => {
    throw new Error("database unavailable");
  };
  __setDatabaseResourcesForTests(resources);

  await assert.rejects(
    () => consumeMcpRateLimit(new Headers({ "x-real-ip": "203.0.113.5" })),
    (error: unknown) => error instanceof TokenlessMcpHttpError && error.code === "rate_limit_unavailable",
  );
});

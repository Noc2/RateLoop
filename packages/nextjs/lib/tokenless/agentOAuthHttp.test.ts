import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { enforceAgentOAuthRateLimit, readAgentOAuthResource } from "~~/lib/tokenless/agentOAuthHttp";

const originalSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

beforeEach(() => {
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "oauth-provisioning-rate-limit-test-secret-long-enough";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalSecret;
});

test("OAuth client and device provisioning is bounded per network identity", async () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.44" });
  const now = new Date("2026-07-15T08:00:00.000Z");
  for (let request = 0; request < 60; request += 1) {
    await enforceAgentOAuthRateLimit(headers, now);
  }
  await assert.rejects(
    () => enforceAgentOAuthRateLimit(headers, now),
    (error: unknown) => error instanceof AgentOAuthError && error.code === "slow_down" && error.status === 429,
  );
});

test("OAuth provisioning fails closed when the rate-limit identity is unavailable", async () => {
  await assert.rejects(
    () => enforceAgentOAuthRateLimit(new Headers()),
    (error: unknown) => error instanceof AgentOAuthError && error.code === "server_error" && error.status === 503,
  );
});

test("the token endpoint accepts one exact resource even when a client repeats the same value", () => {
  const resource = "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp";
  const repeated = new URLSearchParams();
  repeated.append("resource", resource);
  repeated.append("resource", resource);

  assert.equal(readAgentOAuthResource(new URLSearchParams({ resource })), resource);
  assert.equal(readAgentOAuthResource(repeated), resource);
});

test("the token endpoint rejects missing, empty, distinct, and oversized resources", () => {
  const distinct = new URLSearchParams();
  distinct.append("resource", "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp");
  distinct.append("resource", "https://example.com/api/agent/v1/mcp");

  assert.throws(() => readAgentOAuthResource(new URLSearchParams()), /one exact server resource/);
  assert.throws(() => readAgentOAuthResource(new URLSearchParams({ resource: "" })), /one exact server resource/);
  assert.throws(() => readAgentOAuthResource(distinct), /one exact server resource/);
  assert.throws(
    () => readAgentOAuthResource(new URLSearchParams({ resource: "x".repeat(2_049) })),
    /one exact server resource/,
  );
});

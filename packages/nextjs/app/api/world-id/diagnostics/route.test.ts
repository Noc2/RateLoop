import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

const originalWarn = console.warn;
let warnCalls: unknown[][] = [];

function makeRequest(body: unknown) {
  return new NextRequest("https://rateloop.ai/api/world-id/diagnostics", {
    method: "POST",
    headers: new Headers({ "x-forwarded-for": "203.0.113.77" }),
    body: JSON.stringify(body),
  });
}

before(() => {
  __setRateLimitStoreForTests({
    execute: async () => ({ rows: [{ name: "cleanup", request_count: 1 }] }) as never,
  });
});

afterEach(() => {
  console.warn = originalWarn;
  warnCalls = [];
});

test("World ID diagnostics route logs normalized client diagnostics", async () => {
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };

  const response = await POST(
    makeRequest({
      action: "rateloop-human-credential-v1",
      appId: "app_test",
      connectorScheme: "https",
      credential: "proof_of_human",
      diagnosticId: "diag-1",
      environment: "staging",
      event: "poll_failed",
      message: "World ID returned generic error.",
      phase: "poll",
      proofMode: "legacy",
      purpose: "credential",
      requestId: "request-1",
      rpContextExpiresAt: 1_800_000_000,
      rpId: "rp_test",
      signature: "should_not_be_logged",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0]?.[0], "[world-id] client diagnostic");
  assert.deepEqual(warnCalls[0]?.[1], {
    action: "rateloop-human-credential-v1",
    appId: "app_test",
    connectorScheme: "https",
    credential: "proof_of_human",
    diagnosticId: "diag-1",
    environment: "staging",
    errorCode: undefined,
    event: "poll_failed",
    message: "World ID returned generic error.",
    phase: "poll",
    proofMode: "legacy",
    purpose: "credential",
    requestId: "request-1",
    rpContextExpiresAt: 1_800_000_000,
    rpId: "rp_test",
  });
});

test("World ID diagnostics route rejects unknown diagnostic events", async () => {
  const response = await POST(makeRequest({ event: "proof_submitted" }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid World ID diagnostic payload.");
});

import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const TOKEN = "pipeline_test_token";
let previousToken: string | undefined;

function request(body: unknown, authorization = `Bearer ${TOKEN}`) {
  return new NextRequest("https://tokenless.example.test/api/internal/tokenless/pipeline", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  previousToken = process.env.TOKENLESS_PIPELINE_TOKEN;
  process.env.TOKENLESS_PIPELINE_TOKEN = TOKEN;
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.TOKENLESS_PIPELINE_TOKEN;
  else process.env.TOKENLESS_PIPELINE_TOKEN = previousToken;
});

test("pipeline requires its server-only bearer credential", async () => {
  const response = await POST(
    request({ action: "publish_finalized_round", operationKey: "operation_123" }, "Bearer wrong"),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "invalid_pipeline_credential");
});

test("pipeline rejects caller-supplied evidence, metrics, and timestamps", async () => {
  for (const extra of [
    { evidence: { roundId: "42" } },
    { metrics: { correlationRiskBps: 0 } },
    { occurredAt: "2026-07-12T18:00:00.000Z" },
  ]) {
    const response = await POST(
      request({ action: "publish_finalized_round", operationKey: "operation_123", ...extra }),
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_pipeline_request");
  }
});

test("pipeline requires a scoped operation key for every action", async () => {
  const response = await POST(request({ action: "deliver_webhooks" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_pipeline_request");
});

test("pipeline treats malformed JSON as an invalid request", async () => {
  const malformed = new NextRequest("https://tokenless.example.test/api/internal/tokenless/pipeline", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: "{",
  });
  const response = await POST(malformed);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_pipeline_request");
});

import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as GET_LABELED_DATA } from "~~/app/api/assurance/v1/evaluations/labeled-data/route";
import { POST as POST_RECEIPT } from "~~/app/api/assurance/v1/evaluations/receipts/route";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = "2026-07-16T12:00:00.000Z";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "Automated eval routes", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "automated-eval-route-agent",
    version: { displayName: "Eval route agent", provider: "OpenAI", model: "gpt-test", environment: "production" },
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Automated eval routes",
    scopes: ["telemetry:write", "evaluation:read"],
  });
  return { workspaceId, agent, token: key.token };
}

function body(input: Awaited<ReturnType<typeof setup>>) {
  return {
    schemaVersion: "rateloop.automated-eval-receipt.v1",
    provider: "promptfoo",
    externalReceiptId: "promptfoo-route-pass-0001",
    agentId: input.agent.agentId,
    agentVersionId: input.agent.currentVersion.versionId,
    evaluator: { name: "safety", version: "1.0.0" },
    evaluation: { checkName: "safety", outcome: "pass", scoreBps: 10_000, thresholdBps: 8_000 },
    contentCommitment: `sha256:${"11".repeat(32)}`,
    observedAt: NOW,
  };
}

function request(value: unknown, token?: string, idempotencyKey = "promptfoo-route-pass-0001") {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(value),
  });
}

test("automated-eval routes require tenant API-key scopes and exact replay idempotency", async () => {
  const setupData = await setup();
  const unauthorized = await POST_RECEIPT(request(body(setupData)));
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, "workspace_api_key_required");

  const created = await POST_RECEIPT(request(body(setupData), setupData.token));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "private, no-store, max-age=0");
  const createdBody = await created.json();
  assert.equal(createdBody.automatedSignal.humanVerdict, null);
  assert.equal(createdBody.humanReview, null);

  const replay = await POST_RECEIPT(request(body(setupData), setupData.token));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  const exported = await GET_LABELED_DATA(
    new NextRequest(
      `https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/labeled-data?from=2026-07-16T11%3A00%3A00.000Z&to=2026-07-16T13%3A00%3A00.000Z`,
      { headers: { authorization: `Bearer ${setupData.token}` } },
    ),
  );
  assert.equal(exported.status, 200);
  assert.equal(
    exported.headers.get("content-disposition"),
    'attachment; filename="rateloop-automated-eval-labeled-data.json"',
  );
  const exportBody = await exported.json();
  assert.equal(exportBody.workspaceId, setupData.workspaceId);
  assert.deepEqual(exportBody.items, []);
});

test("receipt route rejects unsupported media and oversized bodies before parsing", async () => {
  const setupData = await setup();
  const unsupported = new NextRequest("https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/receipts", {
    method: "POST",
    headers: { authorization: `Bearer ${setupData.token}`, "content-type": "text/plain" },
    body: "not-json",
  });
  assert.equal((await POST_RECEIPT(unsupported)).status, 415);

  const oversized = new NextRequest("https://rateloop-tokenless.vercel.app/api/assurance/v1/evaluations/receipts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupData.token}`,
      "content-type": "application/json",
      "content-length": "65537",
    },
    body: "{}",
  });
  const response = await POST_RECEIPT(oversized);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "automated_eval_receipt_too_large");
});

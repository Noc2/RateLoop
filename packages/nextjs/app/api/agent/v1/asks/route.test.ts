import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function request(body: string, token: string, idempotencyKey: string) {
  return new NextRequest("https://tokenless.example/api/agent/v1/asks", {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
  });
}

async function apiKeyToken() {
  const { workspaceId } = await createWorkspace({ name: "Ask cap", ownerAddress: OWNER });
  const { token } = await createWorkspaceApiKey({ workspaceId, name: "Ask cap key" });
  return { token, workspaceId };
}

test("ask submission refuses a body larger than the shared 64 KiB agent cap", async () => {
  const { token, workspaceId } = await apiKeyToken();
  const idempotencyKey = "ask:cap:12345678";
  const body = JSON.stringify({
    idempotencyKey,
    payment: { mode: "prepaid", workspaceId },
    quoteId: "qte_missing",
    padding: "x".repeat(70 * 1_024),
  });
  const response = await POST(request(body, token, idempotencyKey));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
});

test("ask submission still reports malformed JSON as an invalid ask", async () => {
  const { token } = await apiKeyToken();
  const response = await POST(request("{", token, "ask:cap:12345678"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_ask");
});

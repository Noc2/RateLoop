import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "~~/app/api/agent/v1/assurance/private-reviews/route";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function request(body: string, token?: string, idempotencyKey?: string) {
  return new Request("https://rateloop-tokenless.vercel.app/api/agent/v1/assurance/private-reviews", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
  });
}

test("private-review route authenticates at the handler and never caches errors", async () => {
  const response = await POST(request("{}"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("private-review route rejects malformed JSON and mismatched idempotency headers before service work", async () => {
  const { workspaceId } = await createWorkspace({ name: "Private route", ownerAddress: OWNER });
  const key = await createWorkspaceApiKey({ workspaceId, name: "Private route key" });
  const malformed = await POST(request("{", key.token));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "private, no-store, max-age=0");

  const body = {
    idempotencyKey: "private-route-0001",
    integrationId: "agi_private_route",
    projectId: "hap_private_route",
    requestProfile: { id: "rrp_private_route", version: 1, hash: `sha256:${"a".repeat(64)}` },
    cohortId: "hacoh_private_route",
    dataClassification: "confidential",
    source: { contentType: "text/plain", bytesBase64: Buffer.from("source").toString("base64") },
    suggestion: { contentType: "text/plain", bytesBase64: Buffer.from("suggestion").toString("base64") },
  };
  const mismatch = await POST(request(JSON.stringify(body), key.token, "private-route-other"));
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).code, "invalid_idempotency_key");
});

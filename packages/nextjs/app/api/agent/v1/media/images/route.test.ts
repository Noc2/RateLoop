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

function request(token?: string) {
  const form = new FormData();
  form.set("clientRequestId", "media-scope-0001");
  form.set("file", new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }));
  return new NextRequest("https://tokenless.example/api/agent/v1/media/images", {
    method: "POST",
    body: form,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test("staging an image requires an API key that may publish panels", async () => {
  const { workspaceId } = await createWorkspace({ name: "Media scope", ownerAddress: OWNER });
  const { token } = await createWorkspaceApiKey({
    workspaceId,
    name: "Telemetry only",
    scopes: ["telemetry:write"],
  });
  const response = await POST(request(token));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "insufficient_scope");
});

test("staging an image still refuses an unauthenticated caller", async () => {
  const response = await POST(request());
  assert.equal(response.status, 401);
});

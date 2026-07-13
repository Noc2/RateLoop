import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const CACHE_CONTROL = "private, no-store, max-age=0";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function apiKey() {
  const { workspaceId } = await createWorkspace({ name: "Client", ownerAddress: ADDRESS });
  const { token } = await createWorkspaceApiKey({ workspaceId, name: "Integration" });
  return { token, workspaceId };
}

function request(method: "GET" | "POST", token?: string, body?: string) {
  return new NextRequest("https://tokenless.example/api/agent/v1/assurance/projects", {
    method,
    body,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

test("project routes require an API key and disable shared caching on errors", async () => {
  const response = await GET(request("GET"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
  assert.equal((await response.json()).code, "workspace_api_key_required");
});

test("project POST rejects malformed JSON as a private 400 response", async () => {
  const { token } = await apiKey();
  const response = await POST(request("POST", token, "{"));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
  assert.equal((await response.json()).code, "invalid_human_assurance_input");
});

test("project POST derives workspace scope from the API key", async () => {
  const { token, workspaceId } = await apiKey();
  const response = await POST(
    request(
      "POST",
      token,
      JSON.stringify({
        name: "Support quality",
        dataClassification: "confidential",
        retentionDays: 90,
      }),
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
  const body = await response.json();
  assert.equal(body.workspaceId, workspaceId);
  assert.match(body.projectId, /^hap_/);

  const list = await GET(request("GET", token));
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), CACHE_CONTROL);
  assert.equal((await list.json()).projects[0].projectId, body.projectId);
});

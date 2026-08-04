import { NextRequest } from "next/server";
import { DELETE as revokeApiKey } from "./workspaces/[workspaceId]/api-keys/[apiKeyId]/route";
import { POST as createApiKey, GET as listApiKeys } from "./workspaces/[workspaceId]/api-keys/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { authenticateProductPrincipal, createWorkspace } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function browser(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_api_key_route_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function request(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST" | "DELETE"; origin?: string; token?: string } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

test("workspace API key routes authorize managers, reveal once, list metadata, and revoke credentials", async () => {
  const owner = await browser("owner");
  const outsider = await browser("outsider");
  const { workspaceId } = await createWorkspace({ name: "API key routes", ownerAddress: owner.principalId });
  const path = `/api/account/workspaces/${workspaceId}/api-keys`;
  const context = { params: Promise.resolve({ workspaceId }) };

  const unauthenticated = await listApiKeys(request(path), context);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), NO_STORE);

  const hidden = await listApiKeys(request(path, { token: outsider.token }), context);
  assert.equal(hidden.status, 404);

  const crossOrigin = await createApiKey(
    request(path, {
      body: { name: "Bad origin", scopes: ["result:read"] },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);

  const invalid = await createApiKey(
    request(path, {
      body: { name: "Unsupported", scopes: ["workspace:admin"] },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).field, "scopes");

  const created = await createApiKey(
    request(path, {
      body: {
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        name: "Production agent",
        scopes: ["result:read", "evaluation:read"],
      },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), NO_STORE);
  const createdBody = (await created.json()) as {
    apiKey: { apiKeyId: string; keyPrefix: string; scopes: string[] };
    token: string;
  };
  assert.match(createdBody.token, /^rlk_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(createdBody.apiKey.scopes, ["result:read", "evaluation:read"]);

  const stored = await dbClient.execute({
    sql: "SELECT key_hash, key_prefix FROM tokenless_workspace_api_keys WHERE key_id = ?",
    args: [createdBody.apiKey.apiKeyId],
  });
  assert.notEqual(stored.rows[0]?.key_hash, createdBody.token);
  assert.equal(stored.rows[0]?.key_prefix, createdBody.apiKey.keyPrefix);

  const listed = await listApiKeys(request(path, { token: owner.token }), context);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), NO_STORE);
  const listedText = await listed.text();
  assert.equal(listedText.includes(createdBody.token), false);
  assert.equal(listedText.includes("keyHash"), false);
  assert.equal(listedText.includes("Production agent"), true);

  const revokePath = `${path}/${createdBody.apiKey.apiKeyId}`;
  const revoked = await revokeApiKey(
    request(revokePath, { method: "DELETE", origin: APP_ORIGIN, token: owner.token }),
    { params: Promise.resolve({ workspaceId, apiKeyId: createdBody.apiKey.apiKeyId }) },
  );
  assert.equal(revoked.status, 204);
  assert.equal(revoked.headers.get("cache-control"), NO_STORE);

  await assert.rejects(
    authenticateProductPrincipal({ authorization: `Bearer ${createdBody.token}`, sessionToken: undefined }),
    /Invalid API key/,
  );
});

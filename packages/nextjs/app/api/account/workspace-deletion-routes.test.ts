import { NextRequest } from "next/server";
import { GET, POST } from "./workspaces/[workspaceId]/deletion/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

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

async function authenticatedPrincipal(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_workspace_delete_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function browserRequest(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST"; origin?: string; token?: string } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

test("workspace deletion preview is private, no-store, and owner-only with masked denial", async () => {
  const owner = await authenticatedPrincipal("owner");
  const member = await authenticatedPrincipal("member");
  const { workspaceId } = await createWorkspace({ name: "Delete route", ownerAddress: owner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, member.principalId, new Date()],
  });
  const path = `/api/account/workspaces/${workspaceId}/deletion`;
  const context = { params: Promise.resolve({ workspaceId }) };

  const response = await GET(browserRequest(path, { token: owner.token }), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  const preview = await response.json();
  assert.deepEqual(preview.workspace, { name: "Delete route", workspaceId });
  assert.equal(preview.impact.otherMembers, 1);
  assert.deepEqual(preview.blockers, []);

  const denied = await GET(browserRequest(path, { token: member.token }), context);
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("cache-control"), NO_STORE);
  assert.deepEqual(await denied.json(), {
    code: "workspace_not_found",
    message: "Workspace not found.",
    retryable: false,
  });
});

test("workspace deletion mutation enforces same-origin and exact-name confirmation", async () => {
  const owner = await authenticatedPrincipal("mutation");
  const { workspaceId } = await createWorkspace({ name: "Confirm this name", ownerAddress: owner.principalId });
  const path = `/api/account/workspaces/${workspaceId}/deletion`;
  const context = { params: Promise.resolve({ workspaceId }) };

  const crossOrigin = await POST(
    browserRequest(path, {
      body: { confirmationName: "Confirm this name" },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "invalid_origin");

  const mismatch = await POST(
    browserRequest(path, {
      body: { confirmationName: "confirm this name" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.headers.get("cache-control"), NO_STORE);
  assert.equal((await mismatch.json()).code, "workspace_confirmation_mismatch");

  const deleted = await POST(
    browserRequest(path, {
      body: { confirmationName: "Confirm this name" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(deleted.status, 202);
  assert.equal(deleted.headers.get("cache-control"), NO_STORE);
  const result = await deleted.json();
  assert.equal(result.deleted, true);
  assert.equal(result.status, "completed");
  assert.match(result.jobId, /^del_/);
  assert.match(result.requestId, /^dsr_/);

  const stored = await dbClient.execute({
    sql: "SELECT name, status, deleted_at FROM tokenless_workspaces WHERE workspace_id = ?",
    args: [workspaceId],
  });
  assert.equal(stored.rows[0]?.name, "Deleted workspace");
  assert.equal(stored.rows[0]?.status, "deleted");
  assert.ok(stored.rows[0]?.deleted_at);
});

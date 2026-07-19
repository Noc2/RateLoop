import { NextRequest } from "next/server";
import { POST as releaseHold } from "../workspaces/[workspaceId]/assurance/projects/[projectId]/legal-holds/[holdId]/release/route";
import { POST as createHold } from "../workspaces/[workspaceId]/assurance/projects/[projectId]/legal-holds/route";
import { GET as exportAudit } from "../workspaces/[workspaceId]/audit/export/route";
import { POST as createSubjectRequest } from "./subject-requests/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { SUBJECT_REQUEST_TYPES } from "~~/lib/privacy/lifecycle";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment, grantProjectAccountAccess } from "~~/lib/tokenless/projectAccess";

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
    betterAuthUserId: `better_${label}`,
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

async function seedProject(ownerId: string) {
  const { workspaceId } = await createWorkspace({ name: "Privacy routes", ownerAddress: ownerId });
  const projectId = "project_privacy_routes";
  const now = new Date("2026-07-15T10:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, 'Privacy routes', 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, ownerId, now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: ownerId, projectId, workspaceId, now });
  return { projectId, workspaceId };
}

test("subject-request intake binds requests to the authenticated principal and server-derived scope", async () => {
  const owner = await authenticatedPrincipal("subject_owner");
  const { workspaceId } = await createWorkspace({ name: "Subject requests", ownerAddress: owner.principalId });

  for (const requestType of SUBJECT_REQUEST_TYPES) {
    const response = await createSubjectRequest(
      browserRequest("/api/account/privacy/subject-requests", {
        body: { requestType, scope: { account: true, privateArtifacts: true }, workspaceId },
        method: "POST",
        origin: APP_ORIGIN,
        token: owner.token,
      }),
    );
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), NO_STORE);
    const body = await response.json();
    assert.match(body.requestId, /^dsr_/u);
    assert.match(body.dueAt, /^\d{4}-\d{2}-\d{2}T/u);
  }

  const rows = await dbClient.execute({
    sql: `SELECT principal_id, workspace_id, request_type, scope_json, identity_assurance
          FROM tokenless_subject_requests ORDER BY received_at ASC`,
  });
  assert.equal(rows.rowCount, SUBJECT_REQUEST_TYPES.length);
  for (const row of rows.rows) {
    assert.equal(String(row.principal_id), owner.principalId);
    assert.equal(String(row.workspace_id), workspaceId);
    assert.equal(String(row.identity_assurance), "better_auth:passkey");
    assert.deepEqual(JSON.parse(String(row.scope_json)), { principal: true, workspaceId });
  }
});

test("subject-request intake rejects workspace scope outside the authenticated membership", async () => {
  const owner = await authenticatedPrincipal("subject_workspace_owner");
  const outsider = await authenticatedPrincipal("subject_workspace_outsider");
  const { workspaceId } = await createWorkspace({ name: "Subject scope", ownerAddress: owner.principalId });

  const response = await createSubjectRequest(
    browserRequest("/api/account/privacy/subject-requests", {
      body: { requestType: "access", scope: { ignored: true }, workspaceId },
      method: "POST",
      origin: APP_ORIGIN,
      token: outsider.token,
    }),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "workspace_not_found");

  const rows = await dbClient.execute({ sql: "SELECT request_id FROM tokenless_subject_requests" });
  assert.equal(rows.rowCount, 0);
});

test("subject-request mutations reject cross-origin calls before the closed intake response", async () => {
  const requester = await authenticatedPrincipal("subject_requester");

  const crossOrigin = await createSubjectRequest(
    browserRequest("/api/account/privacy/subject-requests", {
      body: { requestType: "access" },
      method: "POST",
      origin: "https://attacker.example",
      token: requester.token,
    }),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "invalid_origin");
});

test("workspace audit export is private, integrity-bearing JSON restricted to owners and admins", async () => {
  const owner = await authenticatedPrincipal("audit_owner");
  const member = await authenticatedPrincipal("audit_member");
  const { workspaceId } = await createWorkspace({ name: "Audit export", ownerAddress: owner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, member.principalId, new Date()],
  });
  await appendAuditEvent({
    action: "privacy.route_test",
    actorKind: "principal",
    actorReference: owner.principalId,
    assuranceMethod: "better_auth:passkey",
    occurredAt: new Date("2026-07-15T12:00:00.000Z"),
    purpose: "test",
    reason: "route_contract",
    result: "success",
    targetId: workspaceId,
    targetKind: "workspace",
    workspaceId,
  });
  const path = `/api/account/workspaces/${workspaceId}/audit/export`;
  const context = { params: Promise.resolve({ workspaceId }) };

  const exported = await exportAudit(browserRequest(path, { token: owner.token }), context);
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("cache-control"), NO_STORE);
  assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="rateloop-audit.json"');
  assert.equal(exported.headers.get("x-content-type-options"), "nosniff");
  const body = await exported.json();
  assert.equal(body.format, "rateloop-audit-v1");
  assert.equal(body.integrity.valid, true);
  assert.equal(body.events.length, 1);

  const denied = await exportAudit(browserRequest(path, { token: member.token }), context);
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("cache-control"), NO_STORE);
  assert.equal((await denied.json()).code, "workspace_not_found");
});

test("legal-hold routes enforce same-origin mutations and project-admin authorization", async () => {
  const owner = await authenticatedPrincipal("hold_owner");
  const auditor = await authenticatedPrincipal("hold_auditor");
  const project = await seedProject(owner.principalId);
  await grantProjectAccountAccess({
    accountAddress: auditor.principalId,
    grantedBy: owner.principalId,
    reason: "audit_only",
    role: "auditor",
    ...project,
  });
  const path = `/api/account/workspaces/${project.workspaceId}/assurance/projects/${project.projectId}/legal-holds`;
  const context = { params: Promise.resolve(project) };
  const body = {
    reason: "active customer dispute",
    reviewAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    scope: "project",
  };

  const crossOrigin = await createHold(
    browserRequest(path, {
      body,
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "invalid_origin");

  const denied = await createHold(
    browserRequest(path, { body, method: "POST", origin: APP_ORIGIN, token: auditor.token }),
    context,
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "project_access_forbidden");

  const created = await createHold(
    browserRequest(path, { body, method: "POST", origin: APP_ORIGIN, token: owner.token }),
    context,
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), NO_STORE);
  const hold = await created.json();
  assert.match(hold.holdId, /^hold_/);

  const released = await releaseHold(
    browserRequest(`${path}/${hold.holdId}/release`, {
      body: { reason: "dispute resolved" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    { params: Promise.resolve({ ...project, holdId: hold.holdId }) },
  );
  assert.equal(released.status, 200);
  assert.equal(released.headers.get("cache-control"), NO_STORE);
  assert.deepEqual(await released.json(), { holdId: hold.holdId, released: true });
});

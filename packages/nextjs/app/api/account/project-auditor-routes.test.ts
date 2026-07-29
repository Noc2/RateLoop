import { NextRequest } from "next/server";
import { DELETE as revokeAuditor } from "./workspaces/[workspaceId]/assurance/projects/[projectId]/auditors/[assignmentId]/route";
import {
  POST as grantAuditor,
  GET as listAuditors,
} from "./workspaces/[workspaceId]/assurance/projects/[projectId]/auditors/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment } from "~~/lib/tokenless/projectAccess";

const ORIGIN = "https://tokenless.example.test";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function browserPrincipal(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_auditor_${label}`,
    method: "passkey",
  });
  return { principalId: identity.principalId, token: (await createAuthSession(identity)).token };
}

function request(path: string, token: string, init?: { body?: unknown; method?: string }) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init?.method ?? "GET",
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      cookie: `${AUTH_SESSION_COOKIE}=${token}`,
      origin: ORIGIN,
    },
  });
}

async function seedProject(owner: { principalId: string }, label: string) {
  const { workspaceId } = await createWorkspace({ name: `${label} workspace`, ownerAddress: owner.principalId });
  const projectId = `project_${label}`;
  const now = new Date("2026-07-25T10:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES (?,?,?,'confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, label, owner.principalId, now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: owner.principalId, projectId, workspaceId, now });
  return { projectId, workspaceId };
}

test("project auditor routes grant, list, expire, and revoke without crossing project boundaries", async () => {
  const owner = await browserPrincipal("owner");
  const auditor = await browserPrincipal("auditor");
  const first = await seedProject(owner, "first-auditor");
  const second = await seedProject(owner, "second-auditor");
  const firstPath = `/api/account/workspaces/${first.workspaceId}/assurance/projects/${first.projectId}/auditors`;
  const firstContext = { params: Promise.resolve(first) };
  const expiresAt = "2030-01-02T12:30:00.000Z";

  const granted = await grantAuditor(
    request(firstPath, owner.token, {
      method: "POST",
      body: { subjectReference: auditor.principalId, expiresAt },
    }),
    firstContext,
  );
  assert.equal(granted.status, 201, await granted.clone().text());
  const assignmentId = String((await granted.json()).assignmentId);

  const listed = await listAuditors(request(firstPath, owner.token), firstContext);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (await listed.json()).auditors.map((entry: Record<string, unknown>) => ({
      assignmentId: entry.assignmentId,
      subjectReference: entry.subjectReference,
      expiresAt: entry.expiresAt,
    })),
    [{ assignmentId, subjectReference: auditor.principalId, expiresAt }],
  );

  const auditorCannotManage = await listAuditors(request(firstPath, auditor.token), firstContext);
  assert.equal(auditorCannotManage.status, 403);

  const secondPath = `/api/account/workspaces/${second.workspaceId}/assurance/projects/${second.projectId}/auditors`;
  const crossProject = await revokeAuditor(
    request(`${secondPath}/${assignmentId}`, owner.token, { method: "DELETE" }),
    { params: Promise.resolve({ ...second, assignmentId }) },
  );
  assert.equal(crossProject.status, 404);
  assert.equal((await listAuditors(request(firstPath, owner.token), firstContext)).status, 200);

  const revoked = await revokeAuditor(request(`${firstPath}/${assignmentId}`, owner.token, { method: "DELETE" }), {
    params: Promise.resolve({ ...first, assignmentId }),
  });
  assert.equal(revoked.status, 204);
  assert.deepEqual((await (await listAuditors(request(firstPath, owner.token), firstContext)).json()).auditors, []);
});

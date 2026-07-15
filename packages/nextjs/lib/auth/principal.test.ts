import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { createAuthSession, findAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createAssuranceProject,
  listAssuranceProjects,
  scopeAssuranceSessionToWorkspace,
} from "~~/lib/tokenless/humanAssurance";
import { createWorkspace, listProductWorkspaces } from "~~/lib/tokenless/productCore";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("Better Auth resolves to one opaque RateLoop principal and a hash-only app session", async () => {
  const first = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-user-1", displayName: "Buyer" });
  const second = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-user-1", displayName: "Buyer" });
  assert.equal(first.principalId, second.principalId);
  assert.match(first.principalId, /^rlp_[a-zA-Z0-9_-]+$/);
  assert.doesNotMatch(first.principalId, /^0x/);

  const created = await createAuthSession(first);
  const stored = await dbClient.execute({ sql: "SELECT session_hash, principal_id FROM tokenless_auth_sessions" });
  assert.equal(stored.rows[0]?.principal_id, first.principalId);
  assert.notEqual(stored.rows[0]?.session_hash, created.token);
  assert.equal((await findAuthSession(created.token))?.principalId, first.principalId);
});

test("a no-wallet Better Auth principal can own a workspace and receive principal-scoped project access", async () => {
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-user-workspace" });
  const workspace = await createWorkspace({ name: "EU assurance", ownerAddress: identity.principalId });
  const listed = await listProductWorkspaces(identity.principalId);
  assert.equal(listed[0]?.workspaceId, workspace.workspaceId);

  const principal = await scopeAssuranceSessionToWorkspace({
    accountAddress: identity.principalId,
    workspaceId: workspace.workspaceId,
  });
  const project = await createAssuranceProject({
    principal,
    name: "Model release",
    description: "No-wallet enterprise project",
    dataClassification: "internal",
    retentionDays: 30,
  });
  assert.equal((await listAssuranceProjects(principal))[0]?.projectId, project.projectId);
  const assignment = await dbClient.execute({
    sql: `SELECT subject_kind, subject_reference FROM tokenless_project_access_assignments WHERE project_id = ?`,
    args: [project.projectId],
  });
  assert.deepEqual(assignment.rows[0], { subject_kind: "principal", subject_reference: identity.principalId });
});

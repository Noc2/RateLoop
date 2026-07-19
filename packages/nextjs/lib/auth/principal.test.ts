import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { completePrincipalWelcome, getPrincipalWelcomeState, resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
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

test("principal welcome completion is one-time, isolated, and denied for inactive principals", async () => {
  const first = await resolveBetterAuthPrincipal({ betterAuthUserId: "welcome-first" });
  const second = await resolveBetterAuthPrincipal({ betterAuthUserId: "welcome-second" });
  assert.deepEqual(await getPrincipalWelcomeState(first.principalId), { completedAt: null, required: true });

  const completedAt = new Date("2026-07-19T08:00:00.000Z");
  const firstCompletion = await completePrincipalWelcome(first.principalId, completedAt);
  assert.equal(firstCompletion.required, false);
  assert.equal(firstCompletion.completedAt.toISOString(), completedAt.toISOString());

  const retried = await completePrincipalWelcome(first.principalId, new Date("2026-07-19T09:00:00.000Z"));
  assert.equal(retried.completedAt.toISOString(), completedAt.toISOString());
  assert.equal((await getPrincipalWelcomeState(second.principalId)).required, true);

  await dbClient.execute({
    sql: "UPDATE tokenless_principals SET status = 'disabled', disabled_at = ? WHERE principal_id = ?",
    args: [new Date("2026-07-19T10:00:00.000Z"), second.principalId],
  });
  await assert.rejects(() => completePrincipalWelcome(second.principalId), /principal is not active/i);
});

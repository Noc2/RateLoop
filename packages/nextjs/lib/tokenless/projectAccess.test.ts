import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  authorizeProjectAccount,
  createProjectOwnerAssignment,
  grantProjectAccountAccess,
  revokeProjectAccess,
} from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const AUDITOR = "0x2222222222222222222222222222222222222222";
const UNASSIGNED = "0x3333333333333333333333333333333333333333";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedProject(name: string) {
  const { workspaceId } = await createWorkspace({ name: `${name} workspace`, ownerAddress: OWNER });
  const projectId = `project_${name}`;
  const now = new Date("2026-07-15T08:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, name, OWNER, now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: OWNER, projectId, workspaceId, now });
  return { projectId, workspaceId };
}

test("project assignments deny unassigned and cross-project access and enforce role actions", async () => {
  const first = await seedProject("first");
  const second = await seedProject("second");
  const assignment = await grantProjectAccountAccess({
    accountAddress: AUDITOR,
    grantedBy: OWNER,
    reason: "security_review",
    role: "auditor",
    ...first,
  });

  assert.equal((await authorizeProjectAccount({ accountAddress: AUDITOR, action: "read", ...first })).role, "auditor");
  assert.equal(
    (await authorizeProjectAccount({ accountAddress: AUDITOR, action: "export", ...first })).role,
    "auditor",
  );
  await assert.rejects(
    () => authorizeProjectAccount({ accountAddress: AUDITOR, action: "write", ...first }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_access_forbidden",
  );
  await assert.rejects(
    () => authorizeProjectAccount({ accountAddress: AUDITOR, action: "read", ...second }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );
  await assert.rejects(
    () => authorizeProjectAccount({ accountAddress: UNASSIGNED, action: "read", ...first }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );

  await revokeProjectAccess({ assignmentId: assignment.assignmentId, revokedBy: OWNER, ...first });
  await assert.rejects(
    () => authorizeProjectAccount({ accountAddress: AUDITOR, action: "read", ...first }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );

  const audit = await dbClient.execute({
    sql: `SELECT action, actor_reference, target_id, metadata_json
          FROM tokenless_audit_events WHERE workspace_id = ? ORDER BY sequence ASC`,
    args: [first.workspaceId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.action),
    ["project.access_initialized", "project.access_granted", "project.access_revoked"],
  );
  assert.equal(JSON.stringify(audit.rows).includes(AUDITOR), true);
});

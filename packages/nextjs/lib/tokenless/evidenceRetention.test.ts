import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  getWorkspaceEvidenceRetentionPolicy,
  putWorkspaceEvidenceRetentionPolicy,
} from "~~/lib/tokenless/evidenceRetention";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("workspaces start with a versioned one-year evidence and audit retention policy", async () => {
  const { workspaceId } = await createWorkspace({ name: "Retention", ownerAddress: OWNER });
  const policy = await getWorkspaceEvidenceRetentionPolicy({ accountAddress: OWNER, workspaceId });
  assert.equal(policy.version, 1);
  assert.equal(policy.evidenceRetentionMonths, 12);
  assert.equal(policy.auditRetentionMonths, 12);
  assert.equal(policy.minimumRetentionMonths, 6);
});

test("owners version retention settings and cannot go below six calendar months", async () => {
  const { workspaceId } = await createWorkspace({ name: "Retention update", ownerAddress: OWNER });
  const updated = await putWorkspaceEvidenceRetentionPolicy({
    accountAddress: OWNER,
    workspaceId,
    body: { evidenceRetentionMonths: 24, auditRetentionMonths: 18 },
    now: new Date("2030-07-16T12:00:00.000Z"),
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.evidenceRetentionMonths, 24);
  await assert.rejects(
    () =>
      putWorkspaceEvidenceRetentionPolicy({
        accountAddress: OWNER,
        workspaceId,
        body: { evidenceRetentionMonths: 5, auditRetentionMonths: 12 },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_retention_policy",
  );
  await assert.rejects(
    () => getWorkspaceEvidenceRetentionPolicy({ accountAddress: OTHER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
});

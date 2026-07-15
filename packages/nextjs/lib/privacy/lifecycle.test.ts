import {
  createLegalHold,
  createSubjectRequest,
  recordSubjectRequestCompletion,
  releaseLegalHold,
  transitionSubjectRequest,
} from "./lifecycle";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type PrivateArtifactStore,
  __setArtifactPrivacyRuntimeForTests,
  requestProjectDeletion,
} from "~~/lib/tokenless/artifactPrivacy";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

class EmptyStore implements PrivateArtifactStore {
  async delete(_reference: string) {}
  async get(_reference: string): Promise<Uint8Array> {
    throw new Error("not used");
  }
  async put(_pathname: string, _body: Uint8Array): Promise<string> {
    throw new Error("not used");
  }
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "test-v1",
    masterKey: Buffer.alloc(32, 1),
    store: new EmptyStore(),
  });
});

afterEach(() => {
  __setArtifactPrivacyRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function seedProject() {
  const { workspaceId } = await createWorkspace({ name: "Lifecycle", ownerAddress: OWNER });
  const projectId = "project_lifecycle";
  const now = new Date("2026-07-15T08:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, 'Lifecycle project', 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, OWNER, now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: OWNER, projectId, workspaceId, now });
  return { projectId, workspaceId };
}

test("legal holds block deletion until an authorized release", async () => {
  const project = await seedProject();
  const now = new Date("2026-07-15T09:00:00.000Z");
  const hold = await createLegalHold({
    accountAddress: OWNER,
    now,
    reason: "active dispute",
    reviewAt: new Date("2026-08-15T09:00:00.000Z"),
    ...project,
  });
  await assert.rejects(
    () => requestProjectDeletion({ accountAddress: OWNER, now, reason: "customer_request", ...project }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "deletion_blocked_by_hold",
  );

  await releaseLegalHold({
    accountAddress: OWNER,
    holdId: hold.holdId,
    now: new Date("2026-07-16T09:00:00.000Z"),
    reason: "dispute closed",
    ...project,
  });
  const deletion = await requestProjectDeletion({
    accountAddress: OWNER,
    now: new Date("2026-07-16T10:00:00.000Z"),
    reason: "customer_request",
    ...project,
  });
  assert.match(deletion.requestId, /^delete_/);
});

test("subject requests have explicit transitions and category-level completion evidence", async () => {
  const created = await createSubjectRequest({
    identityAssurance: "better_auth_session",
    now: new Date("2026-07-15T10:00:00.000Z"),
    principalId: "rlp_subject_1234567890abcdefgh",
    requestType: "deletion",
    scope: { account: true },
  });
  await transitionSubjectRequest({
    actorReference: "privacy:operator",
    nextStatus: "identity_verified",
    reason: "session_and_otp_verified",
    requestId: created.requestId,
  });
  await transitionSubjectRequest({
    actorReference: "privacy:operator",
    nextStatus: "in_progress",
    reason: "inventory_started",
    requestId: created.requestId,
  });
  await assert.rejects(
    () =>
      transitionSubjectRequest({
        actorReference: "privacy:operator",
        nextStatus: "identity_verified",
        reason: "invalid_backwards_transition",
        requestId: created.requestId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_subject_request_transition",
  );
  await recordSubjectRequestCompletion({
    completedBy: "privacy:operator",
    deletedCategories: ["profile", "private_artifacts"],
    pendingBackupExpiry: [{ category: "encrypted_backups", expiresAt: "2026-08-19" }],
    publicChainExceptions: ["settlement_commitment"],
    requestId: created.requestId,
    retainedCategories: [{ basis: "tax_law", category: "invoice" }],
  });
  const row = await dbClient.execute({
    sql: `SELECT r.status, c.deleted_categories_json, c.retained_categories_json,
                 c.pending_backup_expiry_json, c.public_chain_exceptions_json
          FROM tokenless_subject_requests r
          JOIN tokenless_subject_request_completions c ON c.request_id = r.request_id
          WHERE r.request_id = ?`,
    args: [created.requestId],
  });
  assert.equal(String(row.rows[0]?.status), "completed");
  assert.match(String(row.rows[0]?.public_chain_exceptions_json), /settlement_commitment/);
  assert.match(String(row.rows[0]?.pending_backup_expiry_json), /encrypted_backups/);
});

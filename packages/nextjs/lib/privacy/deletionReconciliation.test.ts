import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  expireDeletedAuthSubjectGuards,
  reconcileDeletedAccountPaidAssignmentSeats,
  reconcileWorkspaceDeletionJobs,
} from "~~/lib/privacy/deletionReconciliation";
import { requestWorkspaceDeletion } from "~~/lib/privacy/workspaceDeletion";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  __setPublicQuestionMediaRuntimeForTests,
  processPublicQuestionMediaDeletionByAssetId,
} from "~~/lib/tokenless/publicQuestionMedia";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-16T08:04:45.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => {
  __setPublicQuestionMediaRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function normalizedRow(sql: string, args: unknown[] = []) {
  const result = await dbClient.execute({ sql, args });
  return Object.fromEntries(
    Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

test("blob-first public media deletion completes the durable workspace erasure receipt", async () => {
  const { workspaceId } = await createWorkspace({ name: "Delete media", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_question_media
          (asset_id, workspace_id, owner_account_address, client_request_id, digest, storage_ref,
           content_type, original_filename, size_bytes, width, height, technical_status, moderation_status,
           expires_at, created_at, updated_at)
          VALUES ('asset_reconcile', ?, ?, 'reconcile-media', 'sha256:reconcile', 'memory://reconcile',
                  'image/png', 'private-name.png', 100, 10, 10, 'ready', 'approved', ?, ?, ?)`,
    args: [workspaceId, OWNER, new Date(NOW.getTime() + 86_400_000), NOW, NOW],
  });
  const request = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Delete media",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(request.status, "in_progress");

  const calls: string[] = [];
  __setPublicQuestionMediaRuntimeForTests({
    randomAssetId: () => "unused",
    store: {
      async delete(reference) {
        calls.push(reference);
      },
      async get() {
        return new Uint8Array();
      },
      async put() {
        return "unused";
      },
    },
  });
  assert.equal(await processPublicQuestionMediaDeletionByAssetId("asset_reconcile", NOW), true);
  assert.deepEqual(calls, ["memory://reconcile"]);
  assert.deepEqual(
    await normalizedRow(
      "SELECT technical_status, storage_ref, original_filename FROM tokenless_public_question_media WHERE asset_id = 'asset_reconcile'",
    ),
    {
      original_filename: "deleted",
      storage_ref: "deleted://asset_reconcile",
      technical_status: "deleted",
    },
  );

  assert.deepEqual(await reconcileWorkspaceDeletionJobs(NOW), { blocked: 0, completed: 1, pending: 0 });
  const completed = await normalizedRow(
    `SELECT jobs.status, jobs.receipt_digest, requests.status AS request_status,
            categories.status AS category_status, categories.evidence_digest
     FROM tokenless_deletion_jobs jobs
     JOIN tokenless_subject_requests requests ON requests.request_id = jobs.subject_request_id
     JOIN tokenless_deletion_job_categories categories ON categories.job_id = jobs.job_id
     WHERE jobs.job_id = ? AND categories.category = 'private_objects'`,
    [request.jobId],
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.request_status, "completed");
  assert.equal(completed.category_status, "completed");
  assert.match(String(completed.receipt_digest), /^[0-9a-f]{64}$/);
  assert.match(String(completed.evidence_digest), /^[0-9a-f]{64}$/);
});

test("the short anti-resurrection binding expires after its documented guard period", async () => {
  const createdAt = new Date("2026-06-01T00:00:00.000Z");
  const deadline = new Date("2026-07-06T00:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals
          (principal_id, status, created_at, updated_at, disabled_at)
          VALUES ('rlp_deleted_guard', 'deleted', ?, ?, ?);
          INSERT INTO tokenless_identity_bindings
          (binding_id, principal_id, provider, provider_subject, status, created_at, last_used_at, revoked_at)
          VALUES ('idb_deleted_guard', 'rlp_deleted_guard', 'better_auth', 'better-deleted-guard',
                  'revoked', ?, ?, ?);
          INSERT INTO tokenless_deletion_jobs
          (job_id, scope_kind, scope_id, requested_by, status, due_at, requested_at, started_at,
           completed_at, receipt_digest)
          VALUES ('del_deleted_guard', 'account', 'rlp_deleted_guard', 'rlp_deleted_guard', 'completed',
                  ?, ?, ?, ?, ?);
          INSERT INTO tokenless_deletion_job_categories
          (job_id, category, disposition, status, basis_code, retention_deadline, evidence_digest,
           created_at, started_at, completed_at)
          VALUES ('del_deleted_guard', 'deleted_auth_subject_guard', 'retain', 'retained',
                  'account_resurrection_prevention', ?, ?, ?, ?, ?)`,
    args: [
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      deadline,
      createdAt,
      createdAt,
      createdAt,
      "a".repeat(64),
      deadline,
      "b".repeat(64),
      createdAt,
      createdAt,
      createdAt,
    ],
  });
  assert.deepEqual(await expireDeletedAuthSubjectGuards(new Date("2026-07-07T00:00:00.000Z")), { expired: 1 });
  assert.equal(
    (
      await normalizedRow(
        "SELECT COUNT(*) AS count FROM tokenless_identity_bindings WHERE principal_id = 'rlp_deleted_guard'",
      )
    ).count,
    0,
  );
  assert.deepEqual(
    await normalizedRow(
      `SELECT disposition, status, basis_code, retention_deadline
       FROM tokenless_deletion_job_categories WHERE job_id = 'del_deleted_guard'`,
    ),
    { basis_code: null, disposition: "erase", retention_deadline: null, status: "completed" },
  );
});

test("paid-assignment identity reconciliation is a no-op without resurrected direct identities", async () => {
  assert.deepEqual(await reconcileDeletedAccountPaidAssignmentSeats(NOW), { accounts: 0, erasedSeats: 0 });
});

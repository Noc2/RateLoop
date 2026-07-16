import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { getWorkspaceDeletionPreview, requestWorkspaceDeletion } from "~~/lib/privacy/workspaceDeletion";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const MEMBER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T08:04:45.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function storedRow(sql: string, args: unknown[] = []) {
  const result = await dbClient.execute({ sql, args });
  return Object.fromEntries(
    Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

test("workspace deletion preview is owner-only and masks unauthorized workspaces", async () => {
  const { workspaceId } = await createWorkspace({ name: "Private workspace", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, NOW],
  });

  const preview = await getWorkspaceDeletionPreview({ accountAddress: OWNER, workspaceId });
  assert.equal(preview.workspace.name, "Private workspace");
  assert.equal(preview.impact.otherMembers, 1);
  assert.equal(preview.immediate, true);
  assert.deepEqual(preview.blockers, []);

  await assert.rejects(
    () => getWorkspaceDeletionPreview({ accountAddress: MEMBER, workspaceId }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 404 && error.code === "workspace_not_found",
  );
  await assert.rejects(
    () => getWorkspaceDeletionPreview({ accountAddress: OWNER, workspaceId: "ws_missing" }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 404 && error.code === "workspace_not_found",
  );
});

test("workspace deletion blocks nonzero funds, active subscriptions, and reservations without mutating them", async () => {
  const { workspaceId } = await createWorkspace({ name: "Funded workspace", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', provider_subscription_id = 'sub_active', provider_status = 'active',
              updated_at = ?
          WHERE workspace_id = ?`,
    args: [NOW, workspaceId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id, workspace_id, delta_atomic, settlement_status, source, created_at, settled_at)
          VALUES ('ledger_workspace_delete', ?, 11, 'settled', 'invoice', ?, ?)`,
    args: [workspaceId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_reservations
          (reservation_id, workspace_id, idempotency_key, amount_atomic, status, created_at, updated_at)
          VALUES ('reservation_workspace_delete', ?, 'workspace-delete-reservation', 3, 'reserved', ?, ?)`,
    args: [workspaceId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES ('quote_workspace_delete', 'quote-hash', '{}', '{}', ?, ?)`,
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_content_records
          (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at)
          VALUES ('content_workspace_delete', ?, 'content-hash', '{}', 'approved', ?, ?)`,
    args: [workspaceId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_question_records
          (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, moderation_status,
           created_at, updated_at)
          VALUES ('question_workspace_delete', ?, 'content_workspace_delete', 'quote_workspace_delete',
                  'terms-hash', '{}', 'approved', ?, ?)`,
    args: [workspaceId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES ('operation_workspace_delete', 'ask-workspace-delete', 'request-hash',
                  'quote_workspace_delete', '{}', '{}', 'open', ?, ?)`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_ownership
          (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state,
           payment_reference, idempotency_key, created_at, updated_at)
          VALUES ('operation_workspace_delete', ?, ?, 'question_workspace_delete', 'prepaid', 'reserved',
                  'reservation_workspace_delete', 'ownership-workspace-delete', ?, ?)`,
    args: [workspaceId, OWNER, NOW, NOW],
  });

  const preview = await getWorkspaceDeletionPreview({ accountAddress: OWNER, workspaceId });
  assert.equal(preview.impact.settledAtomic, "11");
  assert.equal(preview.impact.reservedAtomic, "3");
  assert.equal(preview.impact.availableAtomic, "8");
  assert.deepEqual(
    preview.blockers.map(blocker => blocker.code),
    [
      "workspace_funds_active",
      "workspace_subscription_active",
      "workspace_asks_active",
      "workspace_payment_reservations_active",
    ],
  );

  await assert.rejects(
    () =>
      requestWorkspaceDeletion({
        accountAddress: OWNER,
        confirmationName: "Funded workspace",
        identityAssurance: "better_auth:passkey",
        now: NOW,
        workspaceId,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === 409 && error.code === "workspace_funds_active",
  );
  assert.deepEqual(
    await storedRow("SELECT name, status, deleted_at FROM tokenless_workspaces WHERE workspace_id = ?", [workspaceId]),
    {
      deleted_at: null,
      name: "Funded workspace",
      status: "active",
    },
  );
  assert.equal(
    (await storedRow("SELECT status FROM tokenless_prepaid_reservations WHERE workspace_id = ?", [workspaceId])).status,
    "reserved",
  );
});

test("workspace deletion requires the exact current name and completes an empty workspace atomically", async () => {
  const { workspaceId } = await createWorkspace({ name: "Delete exactly", ownerAddress: OWNER });
  const { apiKeyId } = await createWorkspaceApiKey({ name: "Delete me", workspaceId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_governance
          (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
          VALUES (?, ?, 'end_client', ?, ?, ?)`,
    args: [workspaceId, MEMBER, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agents
          (agent_id, workspace_id, external_id, owner_account_address, status, created_by, created_at, updated_at)
          VALUES ('agent_workspace_delete', ?, 'external-delete', ?, 'active', ?, ?, ?)`,
    args: [workspaceId, OWNER, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_webhook_endpoints
          (endpoint_id, workspace_id, url, event_types_json, secret_ciphertext, secret_key_version,
           active, created_at, updated_at)
          VALUES ('endpoint_workspace_delete', ?, 'https://example.test/hook', '["result"]', 'ciphertext',
                  'key-v1', true, ?, ?)`,
    args: [workspaceId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_invites
          (invite_id, workspace_id, invite_token_hash, access_role, governance_role, expires_at,
           created_by, created_at)
          VALUES ('invite_workspace_delete', ?, 'invite-delete-hash', 'member', 'end_client', ?, ?, ?)`,
    args: [workspaceId, new Date(NOW.getTime() + 86_400_000), OWNER, NOW],
  });

  await assert.rejects(
    () =>
      requestWorkspaceDeletion({
        accountAddress: OWNER,
        confirmationName: "delete exactly",
        identityAssurance: "better_auth:passkey",
        now: NOW,
        workspaceId,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.status === 400 &&
      error.code === "workspace_confirmation_mismatch",
  );
  assert.equal(
    (await storedRow("SELECT COUNT(*) AS count FROM tokenless_deletion_jobs WHERE scope_id = ?", [workspaceId])).count,
    0,
  );

  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Delete exactly",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.immediate, true);
  assert.equal(deleted.status, "completed");

  assert.deepEqual(
    await storedRow("SELECT name, status, deleted_at FROM tokenless_workspaces WHERE workspace_id = ?", [workspaceId]),
    {
      deleted_at: NOW,
      name: "Deleted workspace",
      status: "deleted",
    },
  );
  assert.equal(
    (await storedRow("SELECT COUNT(*) AS count FROM tokenless_workspace_members WHERE workspace_id = ?", [workspaceId]))
      .count,
    0,
  );
  assert.equal(
    (
      await storedRow("SELECT COUNT(*) AS count FROM tokenless_workspace_member_governance WHERE workspace_id = ?", [
        workspaceId,
      ])
    ).count,
    0,
  );
  assert.equal(
    (
      await storedRow("SELECT COUNT(*) AS count FROM tokenless_workspace_agent_setups WHERE workspace_id = ?", [
        workspaceId,
      ])
    ).count,
    0,
  );
  assert.ok(
    (await storedRow("SELECT revoked_at FROM tokenless_workspace_api_keys WHERE key_id = ?", [apiKeyId])).revoked_at,
  );
  assert.deepEqual(
    await storedRow("SELECT status, deactivated_at FROM tokenless_agents WHERE workspace_id = ?", [workspaceId]),
    { deactivated_at: NOW, status: "inactive" },
  );
  assert.deepEqual(
    await storedRow(
      "SELECT active, url, event_types_json, secret_ciphertext, secret_key_version FROM tokenless_webhook_endpoints WHERE workspace_id = ?",
      [workspaceId],
    ),
    {
      active: false,
      event_types_json: "[]",
      secret_ciphertext: "deleted",
      secret_key_version: "deleted",
      url: "deleted://endpoint_workspace_delete",
    },
  );
  assert.ok(
    (await storedRow("SELECT revoked_at FROM tokenless_workspace_member_invites WHERE workspace_id = ?", [workspaceId]))
      .revoked_at,
  );
  assert.deepEqual(
    await storedRow(
      `SELECT j.status AS job_status, j.receipt_digest, r.status AS request_status
       FROM tokenless_deletion_jobs j
       JOIN tokenless_subject_requests r ON r.request_id = j.subject_request_id
       WHERE j.job_id = ?`,
      [deleted.jobId],
    ),
    {
      job_status: "completed",
      receipt_digest: (
        await storedRow("SELECT receipt_digest FROM tokenless_deletion_jobs WHERE job_id = ?", [deleted.jobId])
      ).receipt_digest,
      request_status: "completed",
    },
  );
  assert.equal(
    (
      await storedRow("SELECT COUNT(*) AS count FROM tokenless_deletion_job_categories WHERE job_id = ?", [
        deleted.jobId,
      ])
    ).count,
    5,
  );
  assert.equal(
    (
      await storedRow("SELECT COUNT(*) AS count FROM tokenless_subject_request_completions WHERE request_id = ?", [
        deleted.requestId,
      ])
    ).count,
    1,
  );
  assert.match(
    String(
      (await storedRow("SELECT receipt_digest FROM tokenless_deletion_jobs WHERE job_id = ?", [deleted.jobId]))
        .receipt_digest,
    ),
    /^[0-9a-f]{64}$/,
  );
});

test("workspace deletion marks private media for worker reconciliation and keeps the DSR in progress", async () => {
  const { workspaceId } = await createWorkspace({ name: "Media workspace", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_question_media
          (asset_id, workspace_id, owner_account_address, client_request_id, digest, storage_ref,
           content_type, original_filename, size_bytes, width, height, technical_status, moderation_status,
           expires_at, created_at, updated_at)
          VALUES ('asset_workspace_delete', ?, ?, 'delete-media-request', 'sha256:delete-media',
                  'memory://delete-media', 'image/png', 'delete.png', 100, 10, 10, 'ready', 'approved', ?, ?, ?)`,
    args: [workspaceId, OWNER, new Date(NOW.getTime() + 86_400_000), NOW, NOW],
  });

  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Media workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(deleted.immediate, false);
  assert.equal(deleted.status, "in_progress");
  assert.deepEqual(
    await storedRow(
      `SELECT j.status AS job_status, j.receipt_digest, r.status AS request_status,
              c.status AS category_status, c.evidence_digest
       FROM tokenless_deletion_jobs j
       JOIN tokenless_subject_requests r ON r.request_id = j.subject_request_id
       JOIN tokenless_deletion_job_categories c ON c.job_id = j.job_id AND c.category = 'private_objects'
       WHERE j.job_id = ?`,
      [deleted.jobId],
    ),
    {
      category_status: "in_progress",
      evidence_digest: null,
      job_status: "running",
      receipt_digest: null,
      request_status: "in_progress",
    },
  );
  assert.deepEqual(
    await storedRow(
      "SELECT technical_status, deletion_requested_at FROM tokenless_public_question_media WHERE asset_id = 'asset_workspace_delete'",
    ),
    { deletion_requested_at: NOW, technical_status: "ready" },
  );
});

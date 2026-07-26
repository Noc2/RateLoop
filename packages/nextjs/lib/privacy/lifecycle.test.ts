import {
  createLegalHold,
  createSubjectRequest,
  listSubjectRequests,
  processSubjectRequestQueue,
  readSubjectRequestExport,
  recordSubjectRequestCompletion,
  releaseLegalHold,
  transitionSubjectRequest,
} from "./lifecycle";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";
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
  async delete() {}
  async get(): Promise<Uint8Array> {
    throw new Error("not used");
  }
  async put(): Promise<string> {
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
    requestType: "access",
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
  const completionInput = {
    completedBy: "privacy:operator",
    deletedCategories: ["profile", "private_artifacts"],
    pendingBackupExpiry: [{ category: "encrypted_backups", expiresAt: "2026-08-19" }],
    publicChainExceptions: ["settlement_commitment"],
    requestId: created.requestId,
    retainedCategories: [{ basis: "tax_law", category: "invoice" }],
  };
  const completionId = await recordSubjectRequestCompletion(completionInput);
  const replayedCompletionId = await recordSubjectRequestCompletion({
    ...completionInput,
    now: new Date("2026-07-16T10:00:00.000Z"),
  });
  assert.equal(replayedCompletionId, completionId);
  await assert.rejects(
    () =>
      recordSubjectRequestCompletion({
        ...completionInput,
        deletedCategories: ["profile"],
        now: new Date("2026-07-16T11:00:00.000Z"),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "subject_request_completion_conflict",
  );
  const row = await dbClient.execute({
    sql: `SELECT r.status, c.deleted_categories_json, c.retained_categories_json,
                 c.pending_backup_expiry_json, c.public_chain_exceptions_json
          FROM tokenless_subject_requests r
          JOIN tokenless_subject_request_completions c ON c.request_id = r.request_id
          WHERE r.request_id = ?`,
    args: [created.requestId],
  });
  const completionCounts = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_subject_request_completions WHERE request_id = ?) AS completion_count,
            (SELECT COUNT(*) FROM tokenless_subject_request_events
             WHERE request_id = ? AND to_status = 'completed') AS completion_event_count`,
    args: [created.requestId, created.requestId],
  });
  assert.equal(String(row.rows[0]?.status), "completed");
  assert.match(String(row.rows[0]?.public_chain_exceptions_json), /settlement_commitment/);
  assert.match(String(row.rows[0]?.pending_backup_expiry_json), /encrypted_backups/);
  assert.equal(Number(completionCounts.rows[0]?.completion_count), 1);
  assert.equal(Number(completionCounts.rows[0]?.completion_event_count), 1);
});

test("invalid completion transitions roll back their evidence insert", async () => {
  const created = await createSubjectRequest({
    identityAssurance: "better_auth_session",
    now: new Date("2026-07-15T10:00:00.000Z"),
    principalId: "rlp_rollback_1234567890abcdef",
    requestType: "access",
    scope: { account: true },
  });

  await assert.rejects(
    () =>
      recordSubjectRequestCompletion({
        completedBy: "privacy:operator",
        deletedCategories: ["profile"],
        requestId: created.requestId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_subject_request_transition",
  );

  const result = await dbClient.execute({
    sql: "SELECT status FROM tokenless_subject_requests WHERE request_id = ?",
    args: [created.requestId],
  });
  const completionCounts = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_subject_request_completions WHERE request_id = ?) AS completion_count,
            (SELECT COUNT(*) FROM tokenless_subject_request_events
             WHERE request_id = ? AND to_status = 'completed') AS completion_event_count`,
    args: [created.requestId, created.requestId],
  });
  assert.equal(String(result.rows[0]?.status), "received");
  assert.equal(Number(completionCounts.rows[0]?.completion_count), 0);
  assert.equal(Number(completionCounts.rows[0]?.completion_event_count), 0);
});

test("access and export requests produce a bounded authenticated download instead of a dead-end intake row", async () => {
  await createWorkspace({ name: "Subject export", ownerAddress: OWNER });
  const now = new Date("2026-07-15T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?) ON CONFLICT (principal_id) DO NOTHING`,
    args: [OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,
           email_domain,display_name,created_at,updated_at,last_login_at)
          VALUES (?,'subject-export-user','email','subject@example.test',true,
                  'example.test','Subject',?,?,?)`,
    args: [OWNER, now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notification_preferences
          (principal_address,assignment_available,assignment_completed,payment_updates,
           ask_results,account_security,created_at,updated_at)
          VALUES (?,true,false,true,true,true,?,?)`,
    args: [OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_notifications
          (notification_id,principal_address,kind,title,body,href,preference_key,
           source_type,source_key,created_at)
          VALUES ('notification_subject_export',?,'assignment','Private colleague name',
                  'Private rationale must not leave the workspace','/private/review',
                  'assignmentAvailable','assignment','private-source',?)`,
    args: [OWNER, now],
  });
  const created = await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now,
    principalId: OWNER,
    requestType: "export",
    scope: { principal: true },
  });
  assert.deepEqual(await processSubjectRequestQueue(now), { completed: 1, queued: 1 });
  const listed = await listSubjectRequests(OWNER, now);
  assert.equal(listed[0]?.requestId, created.requestId);
  assert.equal(listed[0]?.status, "completed");
  assert.equal(listed[0]?.exportReady, true);

  const exported = await readSubjectRequestExport({ principalId: OWNER, requestId: created.requestId, now });
  assert.equal(exported.data.schemaVersion, "rateloop.subject-export.v3");
  const accountProfile = exported.data.accountProfile as Record<string, unknown>;
  assert.equal(accountProfile.primary_email, "subject@example.test");
  assert.equal(accountProfile.display_name, "Subject");
  assert.deepEqual(exported.data.forecastIntegrity, {
    schemaVersion: "rateloop.reviewer-forecast-integrity.v1",
    items: [],
  });
  assert.match(String(exported.payloadHash), /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(exported.data),
    /tax_vault_ciphertext|provider_evidence_ciphertext|nullifier_seed_ciphertext|Private colleague name|Private rationale must not leave/iu,
  );
  const communications = exported.data.communications as {
    notifications: Array<Record<string, unknown>>;
    preferences: Record<string, unknown>;
  };
  assert.equal(communications.notifications[0]?.notification_id, "notification_subject_export");
  assert.equal(communications.notifications[0]?.title, undefined);
  assert.equal(communications.notifications[0]?.body, undefined);
  assert.equal(communications.preferences.assignment_completed, false);
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "reviewActivity"),
    ["reviewActivity"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "auditAndSecurityActivity"),
    ["auditAndSecurityActivity"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "connectedAutomation"),
    ["connectedAutomation"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "authentication"),
    ["authentication"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "enterpriseIdentity"),
    ["enterpriseIdentity"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "billing"),
    ["billing"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "agentActivity"),
    ["agentActivity"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "oversightAttestations"),
    ["oversightAttestations"],
  );
  assert.deepEqual(
    Object.keys(exported.data).filter(key => key === "publicQuestionMedia"),
    ["publicQuestionMedia"],
  );
  const reviewActivity = exported.data.reviewActivity as {
    networkSettlements: Array<Record<string, unknown>>;
  };
  assert.deepEqual(reviewActivity.networkSettlements, []);
  const categoryManifest = exported.data.categoryManifest as {
    included: Array<{ category: string; path: string }>;
    withheld: Array<{ category: string; reason: string }>;
  };
  assert.ok(categoryManifest.included.some(item => item.category === "account_profile"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_settlement_status"));
  const networkRetention = categoryManifest.withheld.find(
    item => item.category === "network_reviewer_lookup_and_receipt_payloads",
  );
  assert.match(String(networkRetention?.reason), /reviewer HMAC correlation handle/u);
  assert.match(String(networkRetention?.reason), /append-only receipt payloads/u);
  assert.doesNotMatch(JSON.stringify(exported.data), /integrity_reviewer_lookup|receipt_json/u);
  await assert.rejects(
    () => readSubjectRequestExport({ principalId: "rlp_other_subject", requestId: created.requestId, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "subject_export_unavailable",
  );
});

test("subject export includes only the principal identity audit scope and fails closed on chain corruption", async () => {
  const principalId = "rlp_subject_security_export_0001";
  const now = new Date("2026-07-15T13:00:00.000Z");
  const appended = await appendSecurityAuditEvent({
    scopeKind: "identity",
    scopeId: principalId,
    actorKind: "principal",
    actorReference: principalId,
    assuranceMethod: "passkey",
    action: "account.passkey_verified",
    targetKind: "account",
    targetId: principalId,
    purpose: "account_access",
    reason: "subject_sign_in",
    result: "success",
    metadata: { deviceClass: "platform" },
    occurredAt: now,
  });
  await appendSecurityAuditEvent({
    scopeKind: "system",
    scopeId: "authentication",
    actorKind: "system",
    actorReference: "system:auth",
    assuranceMethod: "service_configuration",
    action: "auth.configuration_checked",
    targetKind: "identity_provider",
    targetId: "better_auth",
    purpose: "account_access",
    reason: "scheduled_check",
    result: "success",
    occurredAt: now,
  });
  const first = await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now,
    principalId,
    requestType: "export",
    scope: { principal: true },
  });
  await processSubjectRequestQueue(now);
  const exported = await readSubjectRequestExport({ principalId, requestId: first.requestId, now });
  const audit = (exported.data.auditAndSecurityActivity as Record<string, unknown>).identitySecurity as {
    integrity: { eventCount: number; headDigest: string; valid: boolean };
    events: Array<Record<string, unknown>>;
  };
  assert.deepEqual(audit.integrity, { eventCount: 1, headDigest: appended.eventDigest, valid: true });
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.action, "account.passkey_verified");
  assert.equal(JSON.stringify(audit).includes("auth.configuration_checked"), false);
  assert.equal(JSON.stringify(audit).includes("deviceClass"), false);

  await dbClient.execute({
    sql: `UPDATE tokenless_security_audit_events SET action='account.tampered'
          WHERE scope_kind='identity' AND scope_id=?`,
    args: [principalId],
  });
  await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now: new Date(now.getTime() + 1_000),
    principalId,
    requestType: "export",
    scope: { principal: true },
  });
  await assert.rejects(
    () => processSubjectRequestQueue(new Date(now.getTime() + 1_000)),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "security_audit_integrity_invalid",
  );
});

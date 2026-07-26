import {
  __hybridNetworkExclusionSubjectExportSqlForTests,
  __hybridSubjectExportSqlForTests,
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
import { newDb } from "pg-mem";
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
const SUBJECT_NETWORK_SENTINEL = "subject-network-snapshot";
const PEER_NETWORK_SENTINEL = "peer-network-record-must-not-export";

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

async function seedNetworkSubjectExportRecords(workspaceId: string, now: Date) {
  const projectId = "project_subject_network_export";
  const subjectWallet = OWNER;
  const peerWallet = "0x2222222222222222222222222222222222222222";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES (? ,?,'Network export project','confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, OWNER, now, now],
  });
  await createProjectOwnerAssignment({ accountAddress: OWNER, projectId, workspaceId, now });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,
           pass_rule_json,rubric_json,created_at)
          VALUES ('rubric_subject_network_export',?,1,'Export test','[]','{}','{}','{}',?);
          INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,manifest_hash,
           manifest_json,frozen_at,created_at,updated_at)
          VALUES ('suite_subject_network_export',?,'Export suite',1,'frozen',
                  'rubric_subject_network_export',1,?,'{}',?,?,?);
          INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES ('policy_subject_network_export',?,1,'rateloop_network','paid','[]','randomized',
                  '{"allowed":false,"sources":[]}','[]','{"requirements":[]}','{}',true,?,'{}',?);
          INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,manifest_hash,manifest_json,created_by,created_at,updated_at,frozen_at,
           completed_at)
          VALUES ('run_subject_network_export',?,'suite_subject_network_export',1,
                  'policy_subject_network_export',1,'completed',?,?,'{}',?,?,?,?,?);
          INSERT INTO tokenless_assurance_cohorts
          (cohort_id,project_id,name,source,selection,capacity,active_reservations,
           qualification_rules_json,status,created_by,created_at,updated_at)
          VALUES ('cohort_subject_network_export',?,'Network','rateloop_network','randomized',
                  2,0,'[]','active',?,?,?);
          INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id,workspace_id,project_id,run_id,cohort_id,source,selection,target_count,
           active_reservations,policy_id,policy_version,policy_hash,run_manifest_hash,created_at)
          VALUES ('subpanel_subject_network_export',?,?,'run_subject_network_export',
                  'cohort_subject_network_export','rateloop_network','randomized',2,0,
                  'policy_subject_network_export',1,?,?,?)`,
    args: [
      projectId,
      now,
      projectId,
      `sha256:${"1".repeat(64)}`,
      now,
      now,
      now,
      projectId,
      `sha256:${"2".repeat(64)}`,
      now,
      projectId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      OWNER,
      now,
      now,
      now,
      now,
      projectId,
      OWNER,
      now,
      now,
      workspaceId,
      projectId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      now,
    ],
  });

  for (const subject of [
    {
      assertionId: "assertion_subject_network_export",
      bindingId: "binding_subject_network_export",
      marker: SUBJECT_NETWORK_SENTINEL,
      principalId: OWNER,
      qualificationId: "qualification_subject_network_export",
      raterId: "rater_subject_network_export",
      wallet: subjectWallet,
    },
    {
      assertionId: "assertion_peer_network_export",
      bindingId: "binding_peer_network_export",
      marker: PEER_NETWORK_SENTINEL,
      principalId: "rlp_peer_network_export_00000001",
      qualificationId: "qualification_peer_network_export",
      raterId: "rater_peer_network_export",
      wallet: peerWallet,
    },
  ]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
            VALUES (?,'active',?,?) ON CONFLICT (principal_id) DO NOTHING;
            INSERT INTO tokenless_rater_profiles
            (rater_id,principal_id,account_address,nullifier_seed_ciphertext,
             nullifier_key_version,nullifier_key_domain,created_at,updated_at)
            VALUES (?,?,?,'encrypted-nullifier','test-v1','vote_mapping',?,?);
            INSERT INTO tokenless_reviewer_qualifications
            (qualification_id,rater_id,reviewer_source,qualification_kind,cohort_ids_json,
             qualification_keys_json,evidence_kind,qualification_value_json,verified_at,
             expires_at,status,created_at,updated_at)
            VALUES (?,?,'rateloop_network','cohort',? ,?,'legacy_migrated',?,?,
                    ?,'active',?,?);
            INSERT INTO tokenless_provider_subject_bindings
            (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
             subject_reference_scheme,status,bound_at,last_verified_at,created_at,updated_at)
            VALUES (?,?,'provider:network-export','network:export',?,'legacy-sha256-v2',
                    'active',?,?,?,?);
            INSERT INTO tokenless_assurance_assertions
            (assertion_id,rater_id,binding_id,provider_id,provider_namespace,
             provider_assertion_hash,provider_assertion_id_hash,
             provider_assertion_reference_scheme,capabilities_json,
             provider_evidence_ciphertext,provider_evidence_key_version,
             provider_evidence_key_domain,evidence_verified_at,evidence_expires_at,
             minimum_age_verified,verified_residence_country,status,created_at,updated_at)
            VALUES (?,?,?,'provider:network-export','network:export',?,?,'legacy-sha256-v2',
                    '["unique_human"]',?,'test-v1','provider_evidence',?,?,18,'DE',
                    'active',?,?);
            INSERT INTO tokenless_assurance_cohort_reviewers
            (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
             maximum_active_assignments,active_reservations,status,network_managed,
             created_by,created_at,updated_at)
            VALUES (?,'cohort_subject_network_export',?,?,1,0,'active',true,?,?,?);
            INSERT INTO tokenless_assurance_assignments
            (assignment_id,workspace_id,project_id,run_id,subpanel_id,cohort_id,
             reviewer_account_address,rater_id,payout_account_snapshot,source,selection,status,
             confidentiality_terms_hash,qualification_provenance_json,assurance_snapshot_json,
             assurance_snapshot_hash,blinding_json,paid_assignment,paid_eligibility_checked_at,
             reservation_expires_at,lease_issuer_account_address,lease_state,created_at,updated_at,
             integrity_reviewer_lookup,integrity_cluster_pseudonym,integrity_risk_band,
             provider_subject_hashes_json,integrity_provenance_json,integrity_provenance_hash,
             selection_batch_id)
            VALUES (?,?,?,'run_subject_network_export','subpanel_subject_network_export',
                    'cohort_subject_network_export',?,?,?,'rateloop_network','randomized','expired',
                    ?,?,?,?,'{"mode":"blind"}',true,?,?,?,'expired',?,?,? ,?,'medium',?,?,?,?)`,
      args: [
        subject.principalId,
        now,
        now,
        subject.raterId,
        subject.principalId,
        subject.wallet,
        now,
        now,
        subject.qualificationId,
        subject.raterId,
        JSON.stringify(["cohort_subject_network_export"]),
        JSON.stringify([subject.marker]),
        JSON.stringify({ marker: subject.marker }),
        now,
        new Date(now.getTime() + 86_400_000),
        now,
        now,
        subject.bindingId,
        subject.raterId,
        `sha256:${subject.marker === SUBJECT_NETWORK_SENTINEL ? "4".repeat(64) : "5".repeat(64)}`,
        now,
        now,
        now,
        now,
        subject.assertionId,
        subject.raterId,
        subject.bindingId,
        `sha256:${"6".repeat(64)}`,
        `sha256:${subject.marker === SUBJECT_NETWORK_SENTINEL ? "7".repeat(64) : "8".repeat(64)}`,
        `encrypted-provider-evidence:${subject.marker}`,
        now,
        new Date(now.getTime() + 86_400_000),
        now,
        now,
        projectId,
        subject.wallet,
        JSON.stringify([{ marker: subject.marker }]),
        OWNER,
        now,
        now,
        `assignment_${subject.raterId}`,
        workspaceId,
        projectId,
        subject.wallet,
        subject.raterId,
        subject.wallet,
        `sha256:${"9".repeat(64)}`,
        JSON.stringify([{ marker: subject.marker }]),
        JSON.stringify({ assertions: [{ marker: subject.marker }] }),
        `sha256:${"a".repeat(64)}`,
        now,
        new Date(now.getTime() + 3_600_000),
        OWNER,
        now,
        now,
        `hmac-sha256:lookup-v1:${subject.marker}`,
        `hmac-sha256:cluster-v1:${subject.marker}`,
        JSON.stringify([`hmac-sha256:provider-v1:${subject.marker}`]),
        JSON.stringify({
          clusterPseudonym: `hmac-sha256:cluster-v1:${subject.marker}`,
          marker: subject.marker,
          providerSubjectHashes: [`hmac-sha256:provider-v1:${subject.marker}`],
          reviewerLookup: `hmac-sha256:lookup-v1:${subject.marker}`,
        }),
        `sha256:${"b".repeat(64)}`,
        `batch_${subject.raterId}`,
      ],
    });
  }
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
  const { workspaceId } = await createWorkspace({ name: "Subject export", ownerAddress: OWNER });
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
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_eligibility_decisions
          (decision_id,principal_id,reviewer_source,workspace_id,decision,notice_version,
           decided_at,delete_after)
          VALUES ('ped_11111111111111111111111111111111',?,'rateloop_network',NULL,
                  'declined_paid_data_collection','paid-eligibility-v2',?,?)`,
    args: [OWNER, now, new Date(now.getTime() + 365 * 86_400_000)],
  });
  await seedNetworkSubjectExportRecords(workspaceId, now);
  const created = await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now,
    principalId: OWNER,
    requestType: "export",
    scope: { principal: true },
  });
  const queueResult = await processSubjectRequestQueue(now);
  if (queueResult.completed !== 1) {
    const failures = await dbClient.execute({
      sql: `SELECT last_error_code,last_error_digest FROM tokenless_privacy_worker_failures
            WHERE worker_kind='subject_request' AND work_item_key=?`,
      args: [created.requestId],
    });
    assert.fail(`subject export worker failed: ${JSON.stringify(failures.rows)}`);
  }
  assert.deepEqual(queueResult, { completed: 1, queued: 1 });
  const listed = await listSubjectRequests(OWNER, now);
  assert.equal(listed[0]?.requestId, created.requestId);
  assert.equal(listed[0]?.status, "completed");
  assert.equal(listed[0]?.exportReady, true);
  const persistedExport = await dbClient.execute({
    sql: "SELECT schema_version FROM tokenless_subject_request_exports WHERE request_id=?",
    args: [created.requestId],
  });
  assert.equal(Number(persistedExport.rows[0]?.schema_version), 4);

  const exported = await readSubjectRequestExport({ principalId: OWNER, requestId: created.requestId, now });
  assert.equal(exported.data.schemaVersion, "rateloop.subject-export.v4");
  const accountProfile = exported.data.accountProfile as Record<string, unknown>;
  assert.equal(accountProfile.primary_email, "subject@example.test");
  assert.equal(accountProfile.display_name, "Subject");
  assert.deepEqual(exported.data.paidEligibilityDecisions, [
    {
      decision_id: "ped_11111111111111111111111111111111",
      reviewer_source: "rateloop_network",
      workspace_id: null,
      decision: "declined_paid_data_collection",
      notice_version: "paid-eligibility-v2",
      decided_at: now.toISOString(),
      delete_after: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
    },
  ]);
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
    hybridReviews: Array<Record<string, unknown>>;
  };
  assert.deepEqual(reviewActivity.networkSettlements, []);
  assert.deepEqual(reviewActivity.hybridReviews, []);
  const networkReviewerData = exported.data.networkReviewerData as {
    assuranceAssertions: Array<Record<string, unknown>>;
    assignmentSnapshots: Array<Record<string, unknown>>;
    hybridNetworkExclusions: Array<Record<string, unknown>>;
    materializedMemberships: Array<Record<string, unknown>>;
    qualifications: Array<Record<string, unknown>>;
  };
  assert.deepEqual(networkReviewerData.hybridNetworkExclusions, []);
  assert.equal(networkReviewerData.qualifications.length, 1);
  assert.equal(networkReviewerData.qualifications[0]?.qualification_id, "qualification_subject_network_export");
  assert.equal(networkReviewerData.assuranceAssertions.length, 1);
  assert.equal(networkReviewerData.assuranceAssertions[0]?.assertion_id, "assertion_subject_network_export");
  assert.equal(networkReviewerData.assignmentSnapshots.length, 1);
  assert.equal(networkReviewerData.assignmentSnapshots[0]?.assignmentId, "assignment_rater_subject_network_export");
  assert.equal(networkReviewerData.materializedMemberships.length, 1);
  const serializedExport = JSON.stringify(exported.data);
  assert.match(serializedExport, new RegExp(SUBJECT_NETWORK_SENTINEL, "u"));
  assert.doesNotMatch(serializedExport, new RegExp(PEER_NETWORK_SENTINEL, "u"));
  assert.doesNotMatch(serializedExport, /encrypted-provider-evidence/u);
  assert.doesNotMatch(serializedExport, /hmac-sha256:(lookup|cluster|provider)-v1/u);
  assert.match(serializedExport, /withheld_security_identifier/u);
  const categoryManifest = exported.data.categoryManifest as {
    included: Array<{ category: string; path: string }>;
    withheld: Array<{ category: string; reason: string }>;
  };
  assert.ok(categoryManifest.included.some(item => item.category === "account_profile"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_settlement_status"));
  assert.ok(categoryManifest.included.some(item => item.category === "hybrid_review_status"));
  assert.ok(categoryManifest.included.some(item => item.category === "hybrid_network_reviewer_exclusions"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_qualification_records"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_assurance_assertions"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_assignment_snapshots"));
  assert.ok(categoryManifest.included.some(item => item.category === "network_materialized_memberships"));
  const networkRetention = categoryManifest.withheld.find(
    item => item.category === "network_reviewer_lookup_and_receipt_payloads",
  );
  assert.match(String(networkRetention?.reason), /Reviewer and cluster HMAC correlation handles/u);
  assert.match(String(networkRetention?.reason), /append-only receipt payloads/u);
  assert.doesNotMatch(JSON.stringify(exported.data), /integrity_reviewer_lookup|receipt_json/u);
  await assert.rejects(
    () => readSubjectRequestExport({ principalId: "rlp_other_subject", requestId: created.requestId, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "subject_export_unavailable",
  );
});

test("hybrid subject export reveals both cohorts to owners but only the exact assigned cohort to each reviewer", async () => {
  const database = newDb();
  database.public.none(`
    CREATE TABLE tokenless_workspace_members (
      workspace_id text NOT NULL,
      account_address text NOT NULL
    );
    CREATE TABLE tokenless_hybrid_review_operations (
      hybrid_operation_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      opportunity_id text NOT NULL,
      state text NOT NULL,
      preparation_evidence_hash text,
      result_evidence_hash text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_hybrid_review_children (
      child_id text PRIMARY KEY,
      hybrid_operation_id text NOT NULL,
      cohort text NOT NULL,
      source_kind text,
      source_operation_reference text,
      state text NOT NULL,
      deployment_key text,
      chain_id integer,
      panel_address text,
      round_id numeric,
      assignment_evidence_hash text,
      voucher_preparation_hash text,
      settlement_binding_hash text,
      settlement_evidence_hash text,
      accepted_count integer NOT NULL,
      committed_count integer NOT NULL,
      terminal_count integer NOT NULL
    );
    CREATE TABLE tokenless_hybrid_review_receipts (
      receipt_id text PRIMARY KEY,
      hybrid_operation_id text NOT NULL,
      child_id text
    );
    CREATE TABLE tokenless_paid_assignment_operations (operation_id text PRIMARY KEY);
    CREATE TABLE tokenless_paid_assignment_seats (
      seat_id text PRIMARY KEY,
      operation_id text NOT NULL,
      reviewer_principal_id text
    );
    CREATE TABLE tokenless_network_assignment_settlements (
      binding_id text PRIMARY KEY,
      assignment_id text NOT NULL,
      operation_key text NOT NULL
    );
    CREATE TABLE tokenless_assurance_assignments (
      assignment_id text PRIMARY KEY,
      reviewer_account_address text NOT NULL,
      rater_id text
    );
    CREATE TABLE tokenless_rater_profiles (
      rater_id text PRIMARY KEY,
      principal_id text
    );
    INSERT INTO tokenless_workspace_members VALUES ('workspace_hybrid','principal_owner');
    INSERT INTO tokenless_hybrid_review_operations VALUES (
      'hybrid_subject','workspace_hybrid','opportunity_private','ready',
      'sha256:parent-preparation','sha256:parent-result',
      '2026-07-26T00:00:00Z','2026-07-26T00:00:00Z'
    );
    INSERT INTO tokenless_hybrid_review_children VALUES
      ('child_invited','hybrid_subject','invited','private_paid_assignment','paid_invited','ready',
       'deployment',84532,'0x1111111111111111111111111111111111111111',1,
       'sha256:invited-assignment','sha256:invited-voucher','sha256:invited-settlement',NULL,0,0,0),
      ('child_network','hybrid_subject','network','public_network_assignment','ask_network','ready',
       'deployment',84532,'0x2222222222222222222222222222222222222222',2,
       'sha256:network-assignment','sha256:network-voucher','sha256:network-settlement',NULL,0,0,0);
    INSERT INTO tokenless_hybrid_review_receipts VALUES
      ('receipt_parent','hybrid_subject',NULL),
      ('receipt_invited','hybrid_subject','child_invited'),
      ('receipt_network','hybrid_subject','child_network');
    INSERT INTO tokenless_paid_assignment_operations VALUES ('paid_invited');
    INSERT INTO tokenless_paid_assignment_seats VALUES ('seat_invited','paid_invited','principal_invited');
    INSERT INTO tokenless_rater_profiles VALUES ('rater_network','principal_network');
    INSERT INTO tokenless_assurance_assignments VALUES (
      'assignment_network','non_subject_lookup','rater_network'
    );
    INSERT INTO tokenless_network_assignment_settlements VALUES (
      'settlement_network','assignment_network','ask_network'
    );
  `);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  const query = async (principalId: string) =>
    (await pool.query(__hybridSubjectExportSqlForTests, [principalId])).rows as Array<Record<string, unknown>>;

  const ownerRows = await query("principal_owner");
  assert.deepEqual(
    ownerRows.map(row => row.cohort),
    ["invited", "network"],
  );
  assert.equal(ownerRows[0]?.workspace_id, "workspace_hybrid");
  assert.equal(Number(ownerRows[0]?.append_only_receipt_count), 3);

  const invitedRows = await query("principal_invited");
  assert.deepEqual(
    invitedRows.map(row => row.cohort),
    ["invited"],
  );
  assert.equal(invitedRows[0]?.workspace_id, null);
  assert.equal(invitedRows[0]?.opportunity_id, null);
  assert.equal(invitedRows[0]?.preparation_evidence_hash, null);
  assert.equal(invitedRows[0]?.subject_access_scope, "assigned_reviewer");
  assert.equal(Number(invitedRows[0]?.append_only_receipt_count), 1);

  const networkRows = await query("principal_network");
  assert.deepEqual(
    networkRows.map(row => row.cohort),
    ["network"],
  );
  assert.equal(networkRows[0]?.workspace_id, null);
  assert.equal(Number(networkRows[0]?.append_only_receipt_count), 1);

  assert.deepEqual(await query("principal_cross_subject"), []);
  await pool.end();
});

test("hybrid network exclusions export only the exact reviewer subject", async () => {
  const database = newDb();
  database.public.none(`
    CREATE TABLE tokenless_hybrid_network_reviewer_exclusions (
      hybrid_operation_id text NOT NULL,
      reviewer_principal_id text NOT NULL,
      payout_account text NOT NULL,
      exclusion_hash text NOT NULL,
      created_at timestamptz NOT NULL
    );
    INSERT INTO tokenless_hybrid_network_reviewer_exclusions VALUES
      ('hybrid_subject','rlp_subject_export_0001',
       '0x1111111111111111111111111111111111111111',
       'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       '2026-07-15T12:00:00Z'),
      ('hybrid_peer','rlp_peer_export_00000001',
       '0x2222222222222222222222222222222222222222',
       'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       '2026-07-15T12:01:00Z');
  `);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  try {
    const rows = (await pool.query(__hybridNetworkExclusionSubjectExportSqlForTests, ["rlp_subject_export_0001"])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.hybrid_operation_id, "hybrid_subject");
    assert.equal(rows[0]?.reviewer_principal_id, undefined);
    assert.equal(rows[0]?.payout_account, "0x1111111111111111111111111111111111111111");
    assert.doesNotMatch(JSON.stringify(rows), /2222222222222222222222222222222222222222|hybrid_peer/u);
  } finally {
    await pool.end();
  }
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
  const poisoned = await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now: new Date(now.getTime() + 1_000),
    principalId,
    requestType: "export",
    scope: { principal: true },
  });
  const healthy = await createSubjectRequest({
    identityAssurance: "better_auth:passkey",
    now: new Date(now.getTime() + 2_000),
    principalId: "rlp_subject_security_export_healthy",
    requestType: "export",
    scope: { principal: true },
  });
  assert.deepEqual(await processSubjectRequestQueue(new Date(now.getTime() + 2_000)), {
    completed: 1,
    queued: 2,
  });
  const healthyExport = await readSubjectRequestExport({
    now: new Date(now.getTime() + 2_000),
    principalId: "rlp_subject_security_export_healthy",
    requestId: healthy.requestId,
  });
  assert.equal(healthyExport.data.generatedFor, "rlp_subject_security_export_healthy");
  const failure = await dbClient.execute({
    sql: `SELECT status,attempt_count,last_error_code,last_error_digest,operator_alert_state,next_retry_at
          FROM tokenless_privacy_worker_failures
          WHERE worker_kind='subject_request' AND work_item_key=?`,
    args: [poisoned.requestId],
  });
  assert.equal(failure.rows[0]?.status, "retrying");
  assert.equal(Number(failure.rows[0]?.attempt_count), 1);
  assert.equal(failure.rows[0]?.last_error_code, "security_audit_integrity_invalid");
  assert.match(String(failure.rows[0]?.last_error_digest), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(failure.rows[0]?.operator_alert_state, "pending");
  assert.ok(new Date(String(failure.rows[0]?.next_retry_at)) > new Date(now.getTime() + 2_000));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  getWorkspaceDeletionPreview,
  recordWorkspaceFundResolution,
  requestWorkspaceDeletion,
} from "~~/lib/privacy/workspaceDeletion";
import { expireWorkspaceDeletionRetentionCategories } from "~~/lib/privacy/workspaceDeletionRetention";
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

async function seedWorkspaceNetworkAssignment(workspaceId: string) {
  const reviewerPrincipal = "rlp_workspace_network_reviewer_0001";
  const reviewerAccount = "0x3333333333333333333333333333333333333333";
  const raterId = "rater_workspace_network_reviewer";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?);
          INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,
           nullifier_key_version,nullifier_key_domain,created_at,updated_at)
          VALUES (?,?,?,'encrypted-nullifier','test-v1','vote_mapping',?,?);
          INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES ('project_workspace_network_delete',?,'Network','confidential','active',30,?,?,?);
          INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,
           pass_rule_json,rubric_json,created_at)
          VALUES ('rubric_workspace_network_delete','project_workspace_network_delete',1,
                  'Delete','[]','{}','{}','{}',?);
          INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,manifest_hash,
           manifest_json,frozen_at,created_at,updated_at)
          VALUES ('suite_workspace_network_delete','project_workspace_network_delete','Delete',1,
                  'frozen','rubric_workspace_network_delete',1,?,'{}',?,?,?);
          INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES ('policy_workspace_network_delete','project_workspace_network_delete',1,
                  'rateloop_network','paid','[]','randomized',
                  '{"allowed":false,"sources":[]}','[]','{"requirements":[]}','{}',true,?,'{}',?);
          INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,manifest_hash,manifest_json,created_by,created_at,updated_at,frozen_at,
           completed_at)
          VALUES ('run_workspace_network_delete','project_workspace_network_delete',
                  'suite_workspace_network_delete',1,'policy_workspace_network_delete',1,
                  'completed',?,?,'{}',?,?,?,?,?);
          INSERT INTO tokenless_assurance_cohorts
          (cohort_id,project_id,name,source,selection,capacity,active_reservations,
           qualification_rules_json,status,created_by,created_at,updated_at)
          VALUES ('cohort_workspace_network_delete','project_workspace_network_delete','Network',
                  'rateloop_network','randomized',1,0,'[]','active',?,?,?);
          INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id,workspace_id,project_id,run_id,cohort_id,source,selection,target_count,
           active_reservations,policy_id,policy_version,policy_hash,run_manifest_hash,created_at)
          VALUES ('subpanel_workspace_network_delete',?,'project_workspace_network_delete',
                  'run_workspace_network_delete','cohort_workspace_network_delete',
                  'rateloop_network','randomized',1,0,'policy_workspace_network_delete',1,?,?,?);
          INSERT INTO tokenless_assurance_cohort_reviewers
          (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
           maximum_active_assignments,active_reservations,status,network_managed,
           created_by,created_at,updated_at)
          VALUES ('project_workspace_network_delete','cohort_workspace_network_delete',?,
                  '[{"privateQualification":"workspace-delete-me"}]',1,0,'active',true,?,?,?);
          INSERT INTO tokenless_assurance_assignments
          (assignment_id,workspace_id,project_id,run_id,subpanel_id,cohort_id,
           reviewer_account_address,rater_id,payout_account_snapshot,source,selection,status,
           confidentiality_terms_hash,qualification_provenance_json,assurance_snapshot_json,
           assurance_snapshot_hash,blinding_json,paid_assignment,paid_eligibility_checked_at,
           reservation_expires_at,lease_issuer_account_address,lease_state,created_at,updated_at,
           integrity_reviewer_lookup,integrity_cluster_pseudonym,integrity_risk_band,
           provider_subject_hashes_json,integrity_provenance_json,integrity_provenance_hash,
           selection_batch_id)
          VALUES ('assignment_workspace_network_delete',?,'project_workspace_network_delete',
                  'run_workspace_network_delete','subpanel_workspace_network_delete',
                  'cohort_workspace_network_delete',?,?,?,'rateloop_network','randomized','expired',
                  ?,'[{"privateQualification":"workspace-delete-me"}]',
                  '{"assertions":[{"privateAssertion":"workspace-delete-me"}]}',?,
                  '{"privateBlind":"workspace-delete-me"}',true,?,?,?,'expired',?,?,?,
                  'private-cluster-workspace-delete','high',
                  '["private-provider-workspace-delete"]',
                  '{"reviewerLookup":"private-lookup-workspace-delete"}',?,?)`,
    args: [
      reviewerPrincipal,
      NOW,
      NOW,
      raterId,
      reviewerPrincipal,
      reviewerAccount,
      NOW,
      NOW,
      workspaceId,
      OWNER,
      NOW,
      NOW,
      NOW,
      `sha256:${"1".repeat(64)}`,
      NOW,
      NOW,
      NOW,
      `sha256:${"2".repeat(64)}`,
      NOW,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      OWNER,
      NOW,
      NOW,
      NOW,
      NOW,
      OWNER,
      NOW,
      NOW,
      workspaceId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      NOW,
      reviewerAccount,
      OWNER,
      NOW,
      NOW,
      workspaceId,
      reviewerAccount,
      raterId,
      reviewerAccount,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      NOW,
      new Date(NOW.getTime() - 60_000),
      OWNER,
      NOW,
      NOW,
      "private-lookup-workspace-delete",
      `sha256:${"6".repeat(64)}`,
      "batch_workspace_network_delete",
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id,request_hash,request_json,response_json,expires_at,created_at)
          VALUES ('quote_workspace_network_delete','request-workspace-network-delete',
                  '{"visibility":"public"}','{}',?,?);
          INSERT INTO tokenless_agent_asks
          (operation_key,idempotency_key,request_hash,quote_id,request_json,economics_json,
           status,created_at,updated_at)
          VALUES ('operation_workspace_network_delete','workspace-network-delete',
                  'request-workspace-network-delete','quote_workspace_network_delete','{}','{}',
                  'completed',?,?);
          INSERT INTO tokenless_paid_vouchers
          (voucher_id,rater_id,request_idempotency_key,request_hash,chain_id,panel_address,
           issuer_address,issuer_epoch,signer_address,round_id,content_id,vote_key,nullifier,
           admission_policy_hash,assurance_snapshot_hash,expires_at,payout_account_snapshot,
           voucher_json,voucher_signature,status,issued_at,network_assignment_id,
           network_selection_binding_hash,network_operation_key,network_deployment_key)
          VALUES ('voucher_workspace_network_delete',?,'voucher:workspace-network-delete',
                  'request-workspace-network-delete',84532,
                  '0x4444444444444444444444444444444444444444',
                  '0x5555555555555555555555555555555555555555',1,
                  '0x5555555555555555555555555555555555555555',42,?,?,?,?,
                  ?,?,?,'{}','0x12','issued',?,'assignment_workspace_network_delete',?,
                  'operation_workspace_network_delete','deployment-workspace-network-delete');
          INSERT INTO tokenless_voucher_assurance_snapshots
          (voucher_id,rater_id,reviewer_source,snapshot_json,snapshot_hash,created_at)
          VALUES ('voucher_workspace_network_delete',?,'rateloop_network',
                  '{"privateVoucherAssertion":"workspace-delete-me"}',?,?)`,
    args: [
      new Date(NOW.getTime() + 3_600_000),
      NOW,
      NOW,
      NOW,
      raterId,
      `0x${"1".repeat(64)}`,
      reviewerAccount,
      `0x${"2".repeat(64)}`,
      `0x${"3".repeat(64)}`,
      `sha256:${"7".repeat(64)}`,
      new Date(NOW.getTime() + 3_600_000),
      reviewerAccount,
      NOW,
      `sha256:${"8".repeat(64)}`,
      raterId,
      `sha256:${"9".repeat(64)}`,
      NOW,
    ],
  });
  return { raterId, reviewerAccount, reviewerPrincipal };
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
          VALUES ('quote_workspace_delete', 'quote-hash', '{"visibility":"public"}', '{}', ?, ?)`,
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

test("funded workspace erasure queues a refund and resumes the same subject request after verification", async () => {
  const { workspaceId } = await createWorkspace({ name: "Refund before erase", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id,workspace_id,delta_atomic,settlement_status,source,created_at,settled_at)
          VALUES ('ledger_refund_before_erase',?,11,'settled','invoice',?,?)`,
    args: [workspaceId, NOW, NOW],
  });
  const blocked = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Refund before erase",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(blocked.deleted, false);
  assert.equal(blocked.status, "blocked_by_funds");
  assert.match(blocked.resolutionId, /^wfr_[0-9a-f]{32}$/u);
  assert.equal(
    (await storedRow("SELECT status FROM tokenless_workspaces WHERE workspace_id=?", [workspaceId])).status,
    "active",
  );

  await recordWorkspaceFundResolution({
    resolutionId: blocked.resolutionId,
    status: "refunded",
    resolutionReference: "refund:provider:verified-001",
    resolvedBy: "operator@example.test",
    now: new Date(NOW.getTime() + 60_000),
  });
  assert.deepEqual((await getWorkspaceDeletionPreview({ accountAddress: OWNER, workspaceId })).blockers, []);
  const completed = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Refund before erase",
    identityAssurance: "better_auth:passkey",
    now: new Date(NOW.getTime() + 120_000),
    workspaceId,
  });
  assert.equal(completed.deleted, true);
  assert.equal(completed.requestId, blocked.requestId);
  assert.deepEqual(
    await storedRow(
      `SELECT requests.status AS request_status,resolution.status AS resolution_status
       FROM tokenless_subject_requests requests
       JOIN tokenless_workspace_fund_resolution_requests resolution ON resolution.request_id=requests.request_id
       WHERE requests.request_id=?`,
      [blocked.requestId],
    ),
    { request_status: "completed", resolution_status: "refunded" },
  );
});

test("workspace deletion requires the exact current name and atomically erases forecast integrity state", async () => {
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
    sql: `INSERT INTO tokenless_workspace_governance
          (workspace_id, default_retention_days, trader_status, trader_legal_name,
           trader_registration_number, trader_registered_address, vat_country_code, vat_id,
           billing_country_code, billing_address_line1, billing_address_line2, billing_city,
           billing_postal_code, billing_state, updated_by, created_at, updated_at)
          VALUES (?, 30, 'verified', 'Delete Exactly GmbH', 'HRB 12345',
                  'Beispielweg 1, 10115 Berlin', 'DE', 'DE123456789',
                  'DE', 'Beispielweg 1', 'Aufgang B', 'Berlin', '10115', 'Berlin', ?, ?, ?)`,
    args: [workspaceId, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_clients
          (client_id, workspace_id, name, status, dpa_status, created_by, created_at, updated_at)
          VALUES ('client_workspace_delete', ?, 'Nina Sørensen Consulting', 'active', 'signed', ?, ?, ?)`,
    args: [workspaceId, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_clients
          (workspace_id, client_id, account_address, created_by, created_at)
          VALUES (?, 'client_workspace_delete', ?, ?, ?)`,
    args: [workspaceId, MEMBER, OWNER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_cost_centers
          (cost_center_id, workspace_id, client_id, code, name, status, created_by, created_at, updated_at)
          VALUES ('cost_center_workspace_delete', ?, 'client_workspace_delete', 'CC-1', 'Delivery',
                  'active', ?, ?, ?)`,
    args: [workspaceId, OWNER, NOW, NOW],
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
          (invite_id, workspace_id, client_id, invite_token_hash, access_role, governance_role,
           expires_at, created_by, created_at)
          VALUES ('invite_workspace_delete', ?, 'client_workspace_delete', 'invite-delete-hash',
                  'member', 'end_client', ?, ?, ?)`,
    args: [workspaceId, new Date(NOW.getTime() + 86_400_000), OWNER, NOW],
  });
  const forecastSubject = `hmac-sha256:${"a".repeat(64)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_forecast_calibration_accumulators
          (subject_space,subject_key,key_version,workspace_id,observation_count,outcome_observation_count,
           forecast_sum_bps,forecast_square_sum,squared_error_sum,outcome_positive_count,
           positive_outcome_forecast_sum_bps,positive_outcome_count,negative_outcome_forecast_sum_bps,
           negative_outcome_count,positive_vote_forecast_sum_bps,positive_vote_count,
           negative_vote_forecast_sum_bps,negative_vote_count,current_reason_codes_json,updated_at)
          VALUES ('invited_workspace',?,'delete-test-v1',?,1,1,5000,25000000,25000000,1,
                  5000,1,0,0,5000,1,0,0,'["forecast_invariant"]',?)`,
    args: [forecastSubject, workspaceId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_forecast_workspace_histograms
          (workspace_id,subject_space,observation_count,buckets_json,updated_at)
          VALUES (?,'invited_workspace',1,?,?)`,
    args: [workspaceId, JSON.stringify(Array<string>(99).fill("0")), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_forecast_integrity_findings
          (finding_id,dedupe_key,subject_space,subject_key,workspace_id,reason_code,severity,
           source_observation_count,evidence_counters_json,payout_effect,consequence,created_at)
          VALUES ('cff_workspace_delete','sha256:workspace-delete','invited_workspace',?,?,
                  'forecast_invariant','hard',1,'{}','none','future_assignment_restriction',?)`,
    args: [forecastSubject, workspaceId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_forecast_integrity_terminal_receipts
          (lane,terminal_key,workspace_id,source_set_commitment,aggregated_forecast_count,processed_at)
          VALUES ('private_invited','delivery_workspace_delete',? ,?,1,?)`,
    args: [workspaceId, `sha256:${"b".repeat(64)}`, NOW],
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
    await storedRow(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_forecast_calibration_accumulators WHERE workspace_id=?) AS calibration,
         (SELECT COUNT(*) FROM tokenless_forecast_workspace_histograms WHERE workspace_id=?) AS histograms,
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_findings WHERE workspace_id=?) AS findings,
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_terminal_receipts WHERE workspace_id=?) AS receipts`,
      [workspaceId, workspaceId, workspaceId, workspaceId],
    ),
    { calibration: 0, findings: 0, histograms: 0, receipts: 0 },
  );

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
  assert.deepEqual(
    await storedRow(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_workspace_governance WHERE workspace_id=?) AS governance,
         (SELECT COUNT(*) FROM tokenless_workspace_clients WHERE workspace_id=?) AS clients,
         (SELECT COUNT(*) FROM tokenless_workspace_cost_centers WHERE workspace_id=?) AS cost_centers,
         (SELECT COUNT(*) FROM tokenless_workspace_member_clients WHERE workspace_id=?) AS member_clients,
         (SELECT COUNT(*) FROM tokenless_workspace_member_invites
          WHERE workspace_id=? AND client_id IS NOT NULL) AS invite_client_links`,
      [workspaceId, workspaceId, workspaceId, workspaceId, workspaceId],
    ),
    { clients: 0, cost_centers: 0, governance: 0, invite_client_links: 0, member_clients: 0 },
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
    7,
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

test("workspace deletion deletes unused private quotes and anonymizes referenced quote ownership", async () => {
  const { workspaceId } = await createWorkspace({ name: "Quote workspace", ownerAddress: OWNER });
  const { apiKeyId } = await createWorkspaceApiKey({ name: "Quote owner", workspaceId });
  for (const [quoteId, prompt] of [
    ["quote_workspace_unused", "Unused private prompt"],
    ["quote_workspace_retained", "Retained private prompt"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_quotes
            (quote_id, request_hash, request_json, response_json, owner_workspace_id, owner_api_key_id,
             expires_at, created_at)
            VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`,
      args: [
        quoteId,
        `hash-${quoteId}`,
        JSON.stringify({ question: { prompt }, visibility: "private" }),
        workspaceId,
        apiKeyId,
        new Date(NOW.getTime() + 60_000),
        NOW,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES ('operation_workspace_retained', 'workspace-retained', 'request-hash',
                  'quote_workspace_retained', '{}', '{}', 'completed', ?, ?)`,
    args: [NOW, NOW],
  });

  const preview = await getWorkspaceDeletionPreview({ accountAddress: OWNER, workspaceId });
  assert.equal(preview.immediate, true);
  assert.equal(preview.impact.privateObjects, 1);
  assert.equal(preview.impact.retainedPrivateQuotes, 1);
  assert.match(preview.warnings.join(" "), /anonymized and retained/iu);

  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Quote workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(deleted.immediate, true);
  const quotes = await dbClient.execute({
    sql: `SELECT quote_id, request_json, owner_principal_id, owner_workspace_id, owner_api_key_id
          FROM tokenless_agent_quotes
          WHERE quote_id IN ('quote_workspace_unused', 'quote_workspace_retained')
          ORDER BY quote_id`,
  });
  assert.equal(quotes.rowCount, 1);
  assert.equal(quotes.rows[0]?.quote_id, "quote_workspace_retained");
  assert.doesNotMatch(String(quotes.rows[0]?.request_json), /Retained private prompt/u);
  assert.match(String(quotes.rows[0]?.request_json), /rateloop\.erased-private-quote\.v1/u);
  assert.match(String(quotes.rows[0]?.owner_principal_id), /^deleted-workspace-quote:[0-9a-f]{64}$/u);
  assert.equal(quotes.rows[0]?.owner_workspace_id, null);
  assert.equal(quotes.rows[0]?.owner_api_key_id, null);

  const receipt = await dbClient.execute({
    sql: `SELECT requests.scope_json, completions.evidence_json
          FROM tokenless_subject_requests requests
          JOIN tokenless_subject_request_completions completions ON completions.request_id = requests.request_id
          WHERE requests.request_id = ?`,
    args: [deleted.requestId],
  });
  const scope = JSON.parse(String(receipt.rows[0]?.scope_json)) as Record<string, unknown>;
  const evidence = JSON.parse(String(receipt.rows[0]?.evidence_json)) as Record<string, unknown>;
  assert.deepEqual(scope.privateQuotes, evidence.privateQuotes);
  assert.deepEqual(scope.privateQuotes, {
    deletedUnreferenced: 1,
    erasedReferencedContent: 0,
    ownerTombstone: quotes.rows[0]?.owner_principal_id,
    retainedReferencedCommitmentOnly: 1,
  });
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

test("workspace deletion tombstones copied network reviewer data without deleting the global rater", async () => {
  const { workspaceId } = await createWorkspace({ name: "Network copy workspace", ownerAddress: OWNER });
  const seeded = await seedWorkspaceNetworkAssignment(workspaceId);

  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Network copy workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(deleted.deleted, true);

  const assignment = await dbClient.execute({
    sql: `SELECT assignment.reviewer_account_address,assignment.payout_account_snapshot,
                 assignment.rater_id,assignment.qualification_provenance_json,
                 assignment.assurance_snapshot_json,assignment.assurance_snapshot_hash,
                 assignment.blinding_json,assignment.integrity_reviewer_lookup,
                 assignment.integrity_cluster_pseudonym,assignment.integrity_risk_band,
                 assignment.provider_subject_hashes_json,assignment.integrity_provenance_json,
                 assignment.integrity_provenance_hash,
                 profile.principal_id AS tombstone_principal_id,
                 profile.account_address AS tombstone_account_address,
                 profile.deletion_receipt_hash,profile.deleted_at,
                 reviewer.network_managed,reviewer.status AS reviewer_status
          FROM tokenless_assurance_assignments assignment
          JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
          JOIN tokenless_assurance_cohort_reviewers reviewer
            ON reviewer.project_id=assignment.project_id
           AND reviewer.cohort_id=assignment.cohort_id
           AND reviewer.reviewer_account_address=assignment.reviewer_account_address
          WHERE assignment.assignment_id='assignment_workspace_network_delete'`,
  });
  assert.equal(assignment.rowCount, 1);
  const row = assignment.rows[0] as Record<string, unknown>;
  assert.match(String(row.reviewer_account_address), /^rlp_erased_assignment_/u);
  assert.match(String(row.rater_id), /^rater_erased_ws_/u);
  assert.equal(row.tombstone_principal_id, null);
  assert.equal(new Date(String(row.deleted_at)).toISOString(), NOW.toISOString());
  assert.match(String(row.deletion_receipt_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(row.payout_account_snapshot, row.tombstone_account_address);
  assert.equal(row.qualification_provenance_json, "[]");
  assert.match(String(row.assurance_snapshot_json), /rateloop\.erased-assurance-snapshot\.v1/u);
  assert.match(String(row.assurance_snapshot_json), new RegExp(String(row.assurance_snapshot_hash), "u"));
  assert.equal(row.blinding_json, '{"subject":"deleted"}');
  assert.equal(row.integrity_reviewer_lookup, null);
  assert.equal(row.integrity_cluster_pseudonym, null);
  assert.equal(row.integrity_risk_band, null);
  assert.equal(row.provider_subject_hashes_json, "[]");
  assert.match(String(row.integrity_provenance_json), /rateloop\.erased-integrity-provenance\.v1/u);
  assert.equal(row.network_managed, true);
  assert.equal(row.reviewer_status, "removed");
  assert.doesNotMatch(JSON.stringify(row), /workspace-delete-me|private-lookup|private-cluster|private-provider/u);
  const retainedVoucherEvidence = await dbClient.execute({
    sql: `SELECT voucher.rater_id AS voucher_rater_id,
                 snapshot.rater_id AS snapshot_rater_id,snapshot.snapshot_json,snapshot.snapshot_hash
          FROM tokenless_paid_vouchers voucher
          JOIN tokenless_voucher_assurance_snapshots snapshot ON snapshot.voucher_id=voucher.voucher_id
          WHERE voucher.voucher_id='voucher_workspace_network_delete'`,
  });
  assert.deepEqual(
    {
      snapshotRaterId: retainedVoucherEvidence.rows[0]?.snapshot_rater_id,
      voucherRaterId: retainedVoucherEvidence.rows[0]?.voucher_rater_id,
    },
    { snapshotRaterId: seeded.raterId, voucherRaterId: seeded.raterId },
  );
  assert.match(
    String(retainedVoucherEvidence.rows[0]?.snapshot_json),
    /rateloop\.erased-voucher-assurance-snapshot\.v1/u,
  );
  assert.match(
    String(retainedVoucherEvidence.rows[0]?.snapshot_json),
    new RegExp(String(retainedVoucherEvidence.rows[0]?.snapshot_hash), "u"),
  );
  assert.doesNotMatch(String(retainedVoucherEvidence.rows[0]?.snapshot_json), /workspace-delete-me/u);

  assert.deepEqual(
    await storedRow(
      `SELECT principal_id,account_address,deleted_at FROM tokenless_rater_profiles
       WHERE rater_id=?`,
      [seeded.raterId],
    ),
    {
      account_address: seeded.reviewerAccount,
      deleted_at: null,
      principal_id: seeded.reviewerPrincipal,
    },
  );
  assert.equal(
    (
      await storedRow(
        `SELECT COUNT(*) AS count FROM tokenless_assurance_cohort_reviewers
         WHERE reviewer_account_address=? AND network_managed=true`,
        [seeded.reviewerAccount],
      )
    ).count,
    0,
  );
  const deletionReceipt = await dbClient.execute({
    sql: `SELECT completion.evidence_json,category.disposition,category.status,
                 category.basis_code,category.retention_deadline
          FROM tokenless_subject_request_completions completion
          JOIN tokenless_deletion_jobs job ON job.subject_request_id=completion.request_id
          JOIN tokenless_deletion_job_categories category
            ON category.job_id=job.job_id AND category.category='settlement_audit'
          WHERE completion.request_id=?`,
    args: [deleted.requestId],
  });
  const evidence = JSON.parse(String(deletionReceipt.rows[0]?.evidence_json)) as {
    networkEvidenceRetention: Record<string, unknown>;
  };
  assert.deepEqual(evidence.networkEvidenceRetention, {
    basis: "settlement_and_audit",
    form: "restricted_claim_links_direct_exclusions_and_commitment_only_receipts",
    hybridReviewerExclusions: 0,
    publicNetworkBindings: 0,
    settlementCommitments: 0,
    settlementReceiptCommitments: 0,
    voucherRaterLinks: 1,
    voucherSnapshotRaterLinks: 1,
  });
  assert.equal(deletionReceipt.rows[0]?.disposition, "retain");
  assert.equal(deletionReceipt.rows[0]?.status, "retained");
  assert.equal(deletionReceipt.rows[0]?.basis_code, "settlement_and_audit");
  assert.equal(
    new Date(String(deletionReceipt.rows[0]?.retention_deadline)).toISOString(),
    new Date(NOW.getTime() + 365 * 86_400_000).toISOString(),
  );
});

test("network evidence expiry rebinds retained voucher copies to the assignment tombstone", async () => {
  const { workspaceId } = await createWorkspace({ name: "Network expiry workspace", ownerAddress: OWNER });
  const seeded = await seedWorkspaceNetworkAssignment(workspaceId);
  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Network expiry workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  const expiresAt = new Date(NOW.getTime() + 86_400_000);
  const categoryBefore = await dbClient.execute({
    sql: `SELECT evidence_digest FROM tokenless_deletion_job_categories
          WHERE job_id=? AND category='settlement_audit'`,
    args: [deleted.jobId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_deletion_job_categories SET retention_deadline=?
          WHERE job_id=? AND category='settlement_audit'`,
    args: [new Date(expiresAt.getTime() - 1), deleted.jobId],
  });

  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(expiresAt), {
    completed: 1,
    deferredByHold: 0,
    releasedHoldSchedules: 0,
  });
  const retained = await dbClient.execute({
    sql: `SELECT assignment.rater_id AS assignment_rater_id,
                 profile.account_address AS tombstone_payout,profile.principal_id,
                 voucher.rater_id AS voucher_rater_id,
                 voucher.payout_account_snapshot AS voucher_payout,
                 snapshot.rater_id AS snapshot_rater_id,snapshot.snapshot_json,
                 category.disposition,category.status,category.basis_code,
                 category.retention_deadline,category.evidence_digest
          FROM tokenless_assurance_assignments assignment
          JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
          JOIN tokenless_paid_vouchers voucher
            ON voucher.network_assignment_id=assignment.assignment_id
          JOIN tokenless_voucher_assurance_snapshots snapshot
            ON snapshot.voucher_id=voucher.voucher_id
          JOIN tokenless_deletion_job_categories category
            ON category.job_id=? AND category.category='settlement_audit'
          WHERE assignment.assignment_id='assignment_workspace_network_delete'`,
    args: [deleted.jobId],
  });
  assert.equal(retained.rowCount, 1);
  const row = retained.rows[0] as Record<string, unknown>;
  assert.match(String(row.assignment_rater_id), /^rater_erased_ws_/u);
  assert.equal(row.voucher_rater_id, row.assignment_rater_id);
  assert.equal(row.snapshot_rater_id, row.assignment_rater_id);
  assert.equal(row.voucher_payout, row.tombstone_payout);
  assert.equal(row.principal_id, null);
  assert.match(String(row.snapshot_json), /rateloop\.erased-voucher-assurance-snapshot\.v1/u);
  assert.equal(row.disposition, "anonymize");
  assert.equal(row.status, "completed");
  assert.equal(row.basis_code, null);
  assert.equal(row.retention_deadline, null);
  assert.notEqual(row.evidence_digest, categoryBefore.rows[0]?.evidence_digest);
  assert.deepEqual(
    await storedRow(
      `SELECT principal_id,account_address,deleted_at FROM tokenless_rater_profiles
       WHERE rater_id=?`,
      [seeded.raterId],
    ),
    {
      account_address: seeded.reviewerAccount,
      deleted_at: null,
      principal_id: seeded.reviewerPrincipal,
    },
  );
  assert.deepEqual(
    await storedRow(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_paid_vouchers voucher
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=voucher.network_assignment_id
          JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
          WHERE assignment.workspace_id=? AND profile.principal_id IS NOT NULL)
         AS live_voucher_links,
         (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots snapshot
          JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=snapshot.voucher_id
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=voucher.network_assignment_id
          JOIN tokenless_rater_profiles profile ON profile.rater_id=snapshot.rater_id
          WHERE assignment.workspace_id=? AND profile.principal_id IS NOT NULL)
         AS live_snapshot_links,
         (SELECT COUNT(*) FROM tokenless_public_network_review_bindings WHERE workspace_id=?)
         AS public_bindings`,
      [workspaceId, workspaceId, workspaceId],
    ),
    { live_snapshot_links: 0, live_voucher_links: 0, public_bindings: 0 },
  );
});

test("legal holds defer network evidence expiry without rebinding retained reviewer claims", async () => {
  const { workspaceId } = await createWorkspace({ name: "Network hold workspace", ownerAddress: OWNER });
  const seeded = await seedWorkspaceNetworkAssignment(workspaceId);
  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Network hold workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  const expiresAt = new Date(NOW.getTime() + 86_400_000);
  await dbClient.execute({
    sql: `UPDATE tokenless_deletion_job_categories SET retention_deadline=?
          WHERE job_id=? AND category='settlement_audit';
          INSERT INTO tokenless_legal_holds
          (hold_id,workspace_id,project_id,scope,reason,status,created_by,created_at,review_at)
          VALUES ('hold_network_retention',?,NULL,'workspace','litigation','active',
                  'privacy:operator',?,?)`,
    args: [
      new Date(expiresAt.getTime() - 1),
      deleted.jobId,
      workspaceId,
      NOW,
      new Date(expiresAt.getTime() + 86_400_000),
    ],
  });

  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(expiresAt), {
    completed: 0,
    deferredByHold: 1,
    releasedHoldSchedules: 0,
  });
  assert.deepEqual(
    await storedRow(
      `SELECT voucher.rater_id AS voucher_rater_id,snapshot.rater_id AS snapshot_rater_id,
              category.status,category.disposition
       FROM tokenless_paid_vouchers voucher
       JOIN tokenless_voucher_assurance_snapshots snapshot ON snapshot.voucher_id=voucher.voucher_id
       JOIN tokenless_deletion_job_categories category
         ON category.job_id=? AND category.category='settlement_audit'
       WHERE voucher.voucher_id='voucher_workspace_network_delete'`,
      [deleted.jobId],
    ),
    {
      disposition: "retain",
      snapshot_rater_id: seeded.raterId,
      status: "retained",
      voucher_rater_id: seeded.raterId,
    },
  );
});

test("network evidence expiry preserves a still-payable voucher and remains retryable", async () => {
  const { workspaceId } = await createWorkspace({ name: "Network payable workspace", ownerAddress: OWNER });
  const seeded = await seedWorkspaceNetworkAssignment(workspaceId);
  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Network payable workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  const prematureExpiry = new Date(NOW.getTime() + 30 * 60_000);
  await dbClient.execute({
    sql: `UPDATE tokenless_deletion_job_categories SET retention_deadline=?
          WHERE job_id=? AND category='settlement_audit'`,
    args: [new Date(prematureExpiry.getTime() - 1), deleted.jobId],
  });

  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(prematureExpiry), {
    completed: 0,
    deferredByHold: 0,
    releasedHoldSchedules: 0,
  });
  assert.deepEqual(
    await storedRow(
      `SELECT voucher.rater_id AS voucher_rater_id,snapshot.rater_id AS snapshot_rater_id,
              category.status,category.disposition,failure.status AS failure_status
       FROM tokenless_paid_vouchers voucher
       JOIN tokenless_voucher_assurance_snapshots snapshot ON snapshot.voucher_id=voucher.voucher_id
       JOIN tokenless_deletion_job_categories category
         ON category.job_id=? AND category.category='settlement_audit'
       JOIN tokenless_privacy_worker_failures failure
         ON failure.worker_kind='workspace_retention'
        AND failure.work_item_key=? || ':settlement_audit'
       WHERE voucher.voucher_id='voucher_workspace_network_delete'`,
      [deleted.jobId, deleted.jobId],
    ),
    {
      disposition: "retain",
      failure_status: "retrying",
      snapshot_rater_id: seeded.raterId,
      status: "retained",
      voucher_rater_id: seeded.raterId,
    },
  );
});

test("workspace deletion anonymizes terminal review subjects and removes private access links", () => {
  const source = readFileSync(new URL("./workspaceDeletion.ts", import.meta.url), "utf8");
  assert.match(source, /rlp_erased_assignment_/u);
  assert.match(source, /UPDATE tokenless_assurance_assignments[\s\S]*reviewer_account_address=\$1/u);
  assert.match(source, /UPDATE tokenless_private_unpaid_review_assignments[\s\S]*reviewer_account_address=\$1/u);
  assert.match(source, /DELETE FROM tokenless_private_group_policy_acceptances WHERE workspace_id=\$1/u);
  assert.match(source, /DELETE FROM tokenless_private_group_memberships/u);
  assert.match(source, /DELETE FROM tokenless_workspace_members WHERE workspace_id = \$1/u);
  assert.match(source, /assurance_assignment_direct_subjects/u);
  assert.match(source, /network_assignment_personal_copies/u);
  assert.match(source, /network_history_personal_copies/u);
  assert.match(source, /network_voucher_snapshot_personal_copies/u);
  assert.match(source, /active_hybrid_reviews/u);
  assert.match(source, /hybrid_reviewer_exclusions/u);
  assert.match(source, /direct_private_assignment_subjects/u);
  assert.match(source, /workspace_memberships/u);
});

test("workspace deletion clears invited paid eligibility and retains a recorded sanctions match", async () => {
  const { workspaceId } = await createWorkspace({ name: "Invited paid workspace", ownerAddress: OWNER });
  const raterId = "rater_invited_paid_delete";
  const principalId = "rlp_invited_paid_delete";
  const later = new Date(NOW.getTime() + 86_400_000);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES ($1,'active',$2,$2);
          INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,
           nullifier_key_version,nullifier_key_domain,created_at,updated_at)
          VALUES ($3,$1,'0x3333333333333333333333333333333333333333',
                  'encrypted-nullifier','test-v1','vote_mapping',$2,$2);
          INSERT INTO tokenless_provider_subject_bindings
          (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
           subject_reference_scheme,status,bound_at,last_verified_at,created_at,updated_at)
          VALUES ('bind_invited_paid_delete',$3,'rateloop:invitation','workspace',
                  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
                  'hmac-sha256-v1','active',$2,$2,$2,$2);
          INSERT INTO tokenless_assurance_assertions
          (assertion_id,rater_id,binding_id,provider_id,provider_namespace,provider_assertion_hash,
           provider_assertion_id_hash,provider_assertion_reference_scheme,capabilities_json,
           provider_evidence_ciphertext,provider_evidence_key_version,provider_evidence_key_domain,
           evidence_verified_at,evidence_expires_at,minimum_age_verified,status,created_at,updated_at)
          VALUES ('assert_invited_paid_delete',$3,'bind_invited_paid_delete','rateloop:invitation','workspace',
                  'sha256:5555555555555555555555555555555555555555555555555555555555555555',
                  'sha256:6666666666666666666666666666666666666666666666666666666666666666',
                  'hmac-sha256-v1','["customer_invitation","minimum_age"]',
                  'sealed','test-v1','provider_evidence',$2,$4,18,'active',$2,$2);
          INSERT INTO tokenless_reviewer_qualifications
          (qualification_id,rater_id,reviewer_source,qualification_kind,cohort_ids_json,
           qualification_keys_json,verified_at,status,created_at,updated_at)
          VALUES ('qual_invited_paid_delete',$3,'customer_invited','invitation','[]','[]',
                  $2,'active',$2,$2);
          INSERT INTO tokenless_sanctions_screenings
          (screening_id,rater_id,source,status,subject_ciphertext,subject_key_version,
           subject_key_domain,list_snapshot_hash,screened_by,requested_at,screened_at,updated_at)
          VALUES ('screen_invited_match',$3,'manual:v1','match','sealed','test-v1','provider_evidence',
                  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
                  'operator',$2,$2,$2);
          INSERT INTO tokenless_paid_eligibility_scopes
          (scope_id,rater_id,reviewer_source,workspace_id,compensation_mode,adulthood_basis,
           adulthood_assertion_id,invitation_qualification_id,sanctions_screening_id,status,
           created_at,updated_at)
          VALUES ('scope_invited_paid_delete',$3,'customer_invited',$5,'usdc','customer_attested',
                  'assert_invited_paid_delete','qual_invited_paid_delete','screen_invited_match',
                  'blocked',$2,$2);
          INSERT INTO tokenless_legal_eligibility
          (scope_id,rater_id,reviewer_source,workspace_id,sanctions_screening_id,
           declared_residence_country,tax_residence_country,residence_tax_status,tax_profile_status,
           dac7_status,sanctions_consent_at,sanctions_status,sanctions_reference_hash,
           sanctions_screened_at,sanctions_expires_at,eligibility_status,created_at,updated_at)
          VALUES ('scope_invited_paid_delete',$3,'customer_invited',$5,'screen_invited_match',
                  'DE','DE','consistent','complete','not_required',$2,'match',
                  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
                  $2,$4,'blocked',$2,$2);`,
    args: [principalId, NOW, raterId, later, workspaceId],
  });

  const deleted = await requestWorkspaceDeletion({
    accountAddress: OWNER,
    confirmationName: "Invited paid workspace",
    identityAssurance: "better_auth:passkey",
    now: NOW,
    workspaceId,
  });
  assert.equal(deleted.deleted, true);

  const legal = await dbClient.execute({
    sql: `SELECT scope_id FROM tokenless_legal_eligibility WHERE scope_id='scope_invited_paid_delete'`,
  });
  assert.equal(legal.rowCount, 0);
  const scopes = await dbClient.execute({
    sql: `SELECT scope_id FROM tokenless_paid_eligibility_scopes WHERE scope_id='scope_invited_paid_delete'`,
  });
  assert.equal(scopes.rowCount, 0);

  const screening = await dbClient.execute({
    sql: `SELECT status FROM tokenless_sanctions_screenings WHERE screening_id='screen_invited_match'`,
  });
  assert.equal(screening.rowCount, 1);
  assert.equal((screening.rows[0] as Record<string, unknown>).status, "match");
});

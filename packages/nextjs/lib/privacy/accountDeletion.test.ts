import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { newDb } from "pg-mem";
import { BETTER_AUTH_SESSION_COOKIE_NAMES } from "~~/lib/auth/betterAuthCookies";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { issueAccountDeletionProof } from "~~/lib/auth/recentAccountActionProof";
import { createAuthSession, findAuthSession } from "~~/lib/auth/session";
import { revokeWalletBinding } from "~~/lib/auth/walletBindings";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __hybridNetworkExclusionErasureSqlForTests,
  deleteAccount,
  getAccountDeletionPreview,
} from "~~/lib/privacy/accountDeletion";
import { __setPaidEligibilityOverridesForTests, ensureAssuranceRaterProfile } from "~~/lib/tokenless/paidEligibility";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

let databaseResources: ReturnType<typeof createMemoryDatabaseResources>;

beforeEach(() => {
  databaseResources = createMemoryDatabaseResources();
  __setDatabaseResourcesForTests(databaseResources);
  __setPaidEligibilityOverridesForTests({
    vault: {
      provider_evidence: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 11)]]) },
      tax_records: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 13)]]) },
      vote_mapping: { currentVersion: "test-v1", keys: new Map([["test-v1", Buffer.alloc(32, 17)]]) },
    },
  });
});
afterEach(() => {
  __setPaidEligibilityOverridesForTests({});
  __setDatabaseResourcesForTests(null);
});

async function seedBetterAuthUser(id: string, email = "delete@example.test") {
  const now = new Date("2026-07-16T08:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, 'Delete me', ?, true, ?, ?)`,
    args: [id, email, now, now],
  });
}

async function deletionProof(betterAuthUserId: string, principalId: string, now: Date) {
  return (
    await issueAccountDeletionProof({
      authenticatedAt: now,
      authenticationMethod: "passkey",
      betterAuthUserId,
      now,
      principalId,
    })
  ).proof;
}

async function seedNetworkRaterCopies(input: { now: Date; payoutAccount: string; raterId: string }) {
  const owner = "0x1111111111111111111111111111111111111111";
  const { workspaceId } = await createWorkspace({ name: "Network erasure", ownerAddress: owner });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES ('project_network_erasure',?,'Network erasure','confidential','active',30,?,?,?);
          INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,
           pass_rule_json,rubric_json,created_at)
          VALUES ('rubric_network_erasure','project_network_erasure',1,'Erase','[]','{}','{}','{}',?);
          INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,manifest_hash,
           manifest_json,frozen_at,created_at,updated_at)
          VALUES ('suite_network_erasure','project_network_erasure','Erase',1,'frozen',
                  'rubric_network_erasure',1,?,'{}',?,?,?);
          INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES ('policy_network_erasure','project_network_erasure',1,'rateloop_network','paid',
                  '[]','randomized','{"allowed":false,"sources":[]}','[]',
                  '{"requirements":[]}','{}',true,?,'{}',?);
          INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,manifest_hash,manifest_json,created_by,created_at,updated_at,frozen_at,
           completed_at)
          VALUES ('run_network_erasure','project_network_erasure','suite_network_erasure',1,
                  'policy_network_erasure',1,'completed',?,?,'{}',?,?,?,?,?);
          INSERT INTO tokenless_assurance_cohorts
          (cohort_id,project_id,name,source,selection,capacity,active_reservations,
           qualification_rules_json,status,created_by,created_at,updated_at)
          VALUES ('cohort_network_erasure','project_network_erasure','Network','rateloop_network',
                  'randomized',1,0,'[]','active',?,?,?);
          INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id,workspace_id,project_id,run_id,cohort_id,source,selection,target_count,
           active_reservations,policy_id,policy_version,policy_hash,run_manifest_hash,created_at)
          VALUES ('subpanel_network_erasure',?,'project_network_erasure','run_network_erasure',
                  'cohort_network_erasure','rateloop_network','randomized',1,0,
                  'policy_network_erasure',1,?,?,?);
          INSERT INTO tokenless_assurance_cohort_reviewers
          (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
           maximum_active_assignments,active_reservations,status,network_managed,
           created_by,created_at,updated_at)
          VALUES ('project_network_erasure','cohort_network_erasure',?,
                  '[{"privateQualification":"delete-me"}]',1,0,'active',true,?,?,?);
          INSERT INTO tokenless_assurance_assignments
          (assignment_id,workspace_id,project_id,run_id,subpanel_id,cohort_id,
           reviewer_account_address,rater_id,payout_account_snapshot,source,selection,status,
           confidentiality_terms_hash,qualification_provenance_json,assurance_snapshot_json,
           assurance_snapshot_hash,blinding_json,paid_assignment,paid_eligibility_checked_at,
           reservation_expires_at,lease_issuer_account_address,lease_state,created_at,updated_at,
           integrity_reviewer_lookup,integrity_cluster_pseudonym,integrity_risk_band,
           provider_subject_hashes_json,integrity_provenance_json,integrity_provenance_hash,
           selection_batch_id)
          VALUES ('assignment_network_erasure',?,'project_network_erasure','run_network_erasure',
                  'subpanel_network_erasure','cohort_network_erasure',?,?,?,
                  'rateloop_network','randomized','expired',?,
                  '[{"privateQualification":"delete-me"}]',
                  '{"assertions":[{"privateAssertion":"delete-me"}]}',?,
                  '{"privateBlind":"delete-me"}',true,?,?,?,'expired',?,?,?,
                  'private-cluster-delete-me','medium','["private-provider-delete-me"]',
                  '{"reviewerLookup":"private-lookup-delete-me","privateRisk":"delete-me"}',?,?)`,
    args: [
      workspaceId,
      owner,
      input.now,
      input.now,
      input.now,
      `sha256:${"1".repeat(64)}`,
      input.now,
      input.now,
      input.now,
      `sha256:${"2".repeat(64)}`,
      input.now,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      owner,
      input.now,
      input.now,
      input.now,
      input.now,
      owner,
      input.now,
      input.now,
      workspaceId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      input.now,
      input.payoutAccount,
      owner,
      input.now,
      input.now,
      workspaceId,
      input.payoutAccount,
      input.raterId,
      input.payoutAccount,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      input.now,
      new Date(input.now.getTime() - 60_000),
      owner,
      input.now,
      input.now,
      "private-lookup-delete-me",
      `sha256:${"6".repeat(64)}`,
      "batch_network_erasure",
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_voucher_assurance_snapshots
          (voucher_id,rater_id,reviewer_source,snapshot_json,snapshot_hash,created_at)
          VALUES ('voucher_delete',?,'rateloop_network',
                  '{"assertions":[{"privateVoucherAssertion":"delete-me"}]}',?,?)`,
    args: [input.raterId, `sha256:${"7".repeat(64)}`, input.now],
  });
}

test("account erasure deletes only the exact subject hybrid exclusion", async () => {
  const database = newDb();
  database.public.none(`
    CREATE TABLE tokenless_hybrid_network_reviewer_exclusions (
      hybrid_operation_id text NOT NULL,
      reviewer_principal_id text NOT NULL,
      payout_account text NOT NULL
    );
    INSERT INTO tokenless_hybrid_network_reviewer_exclusions VALUES
      ('hybrid_subject','rlp_subject_erasure_0001',
       '0x1111111111111111111111111111111111111111'),
      ('hybrid_peer','rlp_peer_erasure_00000001',
       '0x2222222222222222222222222222222222222222');
  `);
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  try {
    const deleted = await pool.query(__hybridNetworkExclusionErasureSqlForTests, ["rlp_subject_erasure_0001"]);
    assert.equal(deleted.rowCount, 1);
    assert.equal(deleted.rows[0]?.hybrid_operation_id, "hybrid_subject");
    const retained = await pool.query(
      "SELECT hybrid_operation_id,reviewer_principal_id FROM tokenless_hybrid_network_reviewer_exclusions",
    );
    assert.deepEqual(retained.rows, [
      { hybrid_operation_id: "hybrid_peer", reviewer_principal_id: "rlp_peer_erasure_00000001" },
    ]);
  } finally {
    await pool.end();
  }
});

test("account deletion revokes authentication, removes shared access, and permits a genuinely fresh signup", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-old");
  const oldIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" });
  const oldSession = await createAuthSession(oldIdentity, now);
  const shared = await createWorkspace({
    name: "Shared",
    ownerAddress: "0x1111111111111111111111111111111111111111",
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [shared.workspaceId, oldIdentity.principalId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_self', ?, 'payout', '0x2222222222222222222222222222222222222222',
                  'self_custodial', 8453, 'proof', ?, ?)`,
    args: [oldIdentity.principalId, now, now],
  });
  for (const type of ["email-verification", "sign-in", "forget-password", "change-email"]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_better_auth_verifications
            (id, identifier, value, expires_at, created_at, updated_at)
            VALUES (?, ?, 'otp', ?, ?, ?)`,
      args: [`verification-${type}`, `${type}-otp-delete@example.test`, new Date(now.getTime() + 60_000), now, now],
    });
  }

  const preview = await getAccountDeletionPreview(oldIdentity.principalId);
  assert.equal(preview.impact.sharedWorkspaces, 1);
  assert.deepEqual(preview.blockers, []);

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: oldIdentity.principalId,
    recentAuthProof: await deletionProof("better-old", oldIdentity.principalId, now),
    now,
  });
  assert.match(deleted.receiptDigest, /^[0-9a-f]{64}$/);
  assert.equal(await findAuthSession(oldSession.token, now), null);

  const stored = await dbClient.execute({
    sql: `SELECT
            (SELECT status FROM tokenless_principals WHERE principal_id = ?) AS principal_status,
            (SELECT status FROM tokenless_identity_bindings WHERE principal_id = ?) AS binding_status,
            (SELECT COUNT(*) FROM tokenless_better_auth_users WHERE id = 'better-old') AS better_users,
            (SELECT COUNT(*) FROM tokenless_better_auth_verifications) AS verifications,
            (SELECT COUNT(*) FROM tokenless_browser_identities WHERE principal_address = ?) AS browser_identities,
            (SELECT COUNT(*) FROM tokenless_workspace_members WHERE account_address = ?) AS memberships,
            (SELECT COUNT(*) FROM tokenless_wallet_bindings WHERE principal_id = ?) AS wallet_bindings,
            (SELECT COUNT(*) FROM tokenless_deletion_job_categories WHERE job_id = ?) AS categories`,
    args: [
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      oldIdentity.principalId,
      deleted.jobId,
    ],
  });
  const storedRow = Object.fromEntries(
    Object.entries(stored.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  assert.deepEqual(storedRow, {
    principal_status: "deleted",
    binding_status: "revoked",
    better_users: 0,
    verifications: 0,
    browser_identities: 0,
    memberships: 0,
    wallet_bindings: 0,
    categories: 12,
  });

  await assert.rejects(
    () => resolveBetterAuthPrincipal({ betterAuthUserId: "better-old" }),
    /Unable to create the RateLoop principal binding/,
  );
  await assert.rejects(
    () => createWorkspace({ name: "Orphan", ownerAddress: oldIdentity.principalId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "principal_inactive",
  );

  await seedBetterAuthUser("better-new");
  const freshIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-new" });
  assert.notEqual(freshIdentity.principalId, oldIdentity.principalId);
  assert.equal((await getAccountDeletionPreview(freshIdentity.principalId)).impact.ownedWorkspaces, 0);
});

test("account deletion pseudonymizes durable agent, oversight, public-media, and MCP references", async () => {
  const now = new Date("2026-07-16T08:20:00.000Z");
  await seedBetterAuthUser("better-service-references", "service-references@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-service-references" });
  const workspace = await createWorkspace({
    name: "Service references",
    ownerAddress: "0x1111111111111111111111111111111111111111",
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agents
          (agent_id,workspace_id,external_id,owner_account_address,status,created_by,created_at,updated_at)
          VALUES ('agent_service_delete',?,'service-delete',?,'active',?,?,?)`,
    args: [workspace.workspaceId, identity.principalId, identity.principalId, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_versions
          (version_id,agent_id,workspace_id,version_number,display_name,description,
           declared_provider,declared_model,declared_model_version,environment,
           configuration_commitment,created_by,created_at)
          VALUES ('version_service_delete','agent_service_delete',?,1,'Service delete',NULL,
                  'test','test-model',NULL,'staging',?, ?,?)`,
    args: [workspace.workspaceId, `sha256:${"1".repeat(64)}`, identity.principalId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_audit_events
          (event_id,workspace_id,agent_id,version_id,event_type,actor_account_address,details_json,created_at)
          VALUES ('audit_service_delete',?,'agent_service_delete','version_service_delete',
                  'agent.created',?,? ,?)`,
    args: [workspace.workspaceId, identity.principalId, JSON.stringify({ approvedBy: identity.principalId }), now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_oversight_attestations
          (attestation_id,workspace_id,account_address,competence_basis,training_records_json,
           authority_scope,attested_by,attested_at,expires_at,status,created_at,updated_at)
          VALUES ('attestation_service_delete',?,?,'Trained reviewer',?,'both',?,?,?,'active',?,?)`,
    args: [
      workspace.workspaceId,
      identity.principalId,
      JSON.stringify([{ verifiedBy: identity.principalId }]),
      identity.principalId,
      now,
      new Date(now.getTime() + 86_400_000),
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_question_media
          (asset_id,workspace_id,owner_account_address,client_request_id,digest,storage_ref,
           content_type,original_filename,size_bytes,width,height,technical_status,
           moderation_status,expires_at,created_at,updated_at)
          VALUES ('pqm_service_delete_1234567890',?,?,'personal-client-request',
                  ?,'blob:service-delete','image/png','personal-name.png',10,1,1,'ready',
                  'pending',?,?,?)`,
    args: [
      workspace.workspaceId,
      identity.principalId,
      `sha256:${"2".repeat(64)}`,
      new Date(now.getTime() + 86_400_000),
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_public_media_daily_quotas
          (workspace_id,owner_account_address,day_key,upload_count,upload_bytes,updated_at)
          VALUES (?,?,'2026-07-16',1,10,?)`,
    args: [workspace.workspaceId, identity.principalId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_name,redirect_uris_json,redirect_uris_digest,token_endpoint_auth_method,
           allowed_scopes_json,registration_source,status,created_at,updated_at)
          VALUES ('client_service_delete','Service delete','[]','redirect-delete','none',
                  '[]','pre_registered','active',?,?)`,
    args: [now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,
           status,created_at,absolute_expires_at)
          VALUES ('family_service_delete','client_service_delete',?,'rateloop','rateloop','[]',
                  'active',?,?)`,
    args: [identity.principalId, now, new Date(now.getTime() + 86_400_000)],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_authorization_codes
          (authorization_code_id,code_hash,token_family_id,client_id,subject_principal_id,
           redirect_uri,redirect_uri_digest,code_challenge,audience,resource,granted_scopes_json,
           created_at,expires_at)
          VALUES ('code_service_delete','code-hash-service-delete','family_service_delete',
                  'client_service_delete',?,'https://agent.example/callback','redirect-digest',
                  'challenge','rateloop','rateloop','[]',?,?)`,
    args: [identity.principalId, now, new Date(now.getTime() + 5 * 60_000)],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_refresh_tokens
          (refresh_token_id,token_hash,token_family_id,client_id,subject_principal_id,
           audience,resource,granted_scopes_json,generation,created_at,expires_at)
          VALUES ('refresh_service_delete','refresh-hash-service-delete','family_service_delete',
                  'client_service_delete',?,'rateloop','rateloop','[]',1,?,?)`,
    args: [identity.principalId, now, new Date(now.getTime() + 60 * 60_000)],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_access_tokens
          (access_token_id,token_hash,token_family_id,refresh_token_id,client_id,
           subject_principal_id,audience,resource,granted_scopes_json,created_at,expires_at)
          VALUES ('access_service_delete','access-hash-service-delete','family_service_delete',
                  'refresh_service_delete','client_service_delete',?,'rateloop','rateloop','[]',?,?)`,
    args: [identity.principalId, now, new Date(now.getTime() + 30 * 60_000)],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_device_authorizations
          (device_authorization_id,device_code_hash,user_code_hash,client_id,audience,resource,
           requested_scopes_json,status,approved_by_principal_id,approved_at,consumed_at,
           token_family_id,created_at,expires_at,updated_at)
          VALUES ('device_service_delete','device-hash-service-delete','user-hash-service-delete',
                  'client_service_delete','rateloop','rateloop','[]','consumed',?,?,?,
                  'family_service_delete',?,?,?)`,
    args: [identity.principalId, now, now, now, new Date(now.getTime() + 10 * 60_000), now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_mcp_sessions
          (session_hash,workspace_id,integration_id,subject_principal_id,token_family_id,
           client_name,client_version,protocol_version,elicitation_mode,status,
           created_at,last_seen_at,expires_at)
          VALUES (?,NULL,NULL,?,'family_service_delete','test','1','2025-11-25','none',
                  'active',?,?,?)`,
    args: [`sha256:${"3".repeat(64)}`, identity.principalId, now, now, new Date(now.getTime() + 3_600_000)],
  });

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: identity.principalId,
    recentAuthProof: await deletionProof("better-service-references", identity.principalId, now),
    now,
  });
  const stored = await dbClient.execute({
    sql: `SELECT
            (SELECT owner_account_address FROM tokenless_agents
             WHERE agent_id='agent_service_delete') AS agent_owner,
            (SELECT created_by FROM tokenless_agent_versions
             WHERE version_id='version_service_delete') AS version_creator,
            (SELECT actor_account_address FROM tokenless_agent_audit_events
             WHERE event_id='audit_service_delete') AS audit_actor,
            (SELECT details_json FROM tokenless_agent_audit_events
             WHERE event_id='audit_service_delete') AS audit_details,
            (SELECT account_address FROM tokenless_oversight_attestations
             WHERE attestation_id='attestation_service_delete') AS oversight_account,
            (SELECT training_records_json FROM tokenless_oversight_attestations
             WHERE attestation_id='attestation_service_delete') AS oversight_training,
            (SELECT owner_account_address FROM tokenless_public_question_media
             WHERE asset_id='pqm_service_delete_1234567890') AS media_owner,
            (SELECT original_filename FROM tokenless_public_question_media
             WHERE asset_id='pqm_service_delete_1234567890') AS media_filename,
            (SELECT deletion_requested_at FROM tokenless_public_question_media
             WHERE asset_id='pqm_service_delete_1234567890') AS media_deletion_requested_at,
            (SELECT COUNT(*) FROM tokenless_public_media_daily_quotas
             WHERE owner_account_address=?) AS media_quota_links,
            (SELECT subject_principal_id FROM tokenless_mcp_sessions
             WHERE session_hash=?) AS mcp_subject`,
    args: [identity.principalId, `sha256:${"3".repeat(64)}`],
  });
  const storedRow = Object.fromEntries(
    Object.entries(stored.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const serialized = JSON.stringify(storedRow);
  assert.doesNotMatch(serialized, new RegExp(identity.principalId, "u"));
  assert.match(String(storedRow.agent_owner), /^rlp_erased_/u);
  assert.match(String(storedRow.version_creator), /^deleted-actor:/u);
  assert.equal(storedRow.audit_details, '{"subject":"deleted","retentionBasis":"security_audit"}');
  assert.equal(storedRow.oversight_training, "[]");
  assert.match(String(storedRow.media_owner), /^deleted-media:/u);
  assert.equal(storedRow.media_filename, "deleted");
  assert.equal(new Date(String(storedRow.media_deletion_requested_at)).toISOString(), now.toISOString());
  assert.equal(Number(storedRow.media_quota_links), 0);
  assert.match(String(storedRow.mcp_subject), /^rlp_erased_/u);

  const oauth = await dbClient.execute({
    sql: `SELECT
            (SELECT subject_principal_id FROM tokenless_agent_oauth_token_families
             WHERE token_family_id='family_service_delete') AS family_subject,
            (SELECT status FROM tokenless_agent_oauth_token_families
             WHERE token_family_id='family_service_delete') AS family_status,
            (SELECT subject_principal_id FROM tokenless_agent_oauth_authorization_codes
             WHERE authorization_code_id='code_service_delete') AS code_subject,
            (SELECT subject_principal_id FROM tokenless_agent_oauth_refresh_tokens
             WHERE refresh_token_id='refresh_service_delete') AS refresh_subject,
            (SELECT subject_principal_id FROM tokenless_agent_oauth_access_tokens
             WHERE access_token_id='access_service_delete') AS access_subject,
            (SELECT approved_by_principal_id FROM tokenless_agent_oauth_device_authorizations
             WHERE device_authorization_id='device_service_delete') AS device_subject`,
  });
  const oauthRow = Object.fromEntries(
    Object.entries(oauth.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  assert.doesNotMatch(JSON.stringify(oauthRow), new RegExp(identity.principalId, "u"));
  assert.equal(oauthRow.family_status, "revoked");
  for (const field of ["family_subject", "code_subject", "refresh_subject", "access_subject", "device_subject"]) {
    assert.match(String(oauthRow[field]), /^rlp_erased_/u);
  }

  const completion = await dbClient.execute({
    sql: "SELECT anonymized_categories_json,evidence_json FROM tokenless_subject_request_completions WHERE request_id=?",
    args: [deleted.requestId],
  });
  assert.deepEqual(JSON.parse(String(completion.rows[0]?.anonymized_categories_json)), [
    "service_identity_references",
    "oauth_authorization_records",
  ]);
  const evidence = JSON.parse(String(completion.rows[0]?.evidence_json)) as {
    categoryEvidence: Record<string, Record<string, number>>;
  };
  assert.equal(evidence.categoryEvidence.service_identity_references?.agentsPseudonymized, 1);
  assert.equal(evidence.categoryEvidence.service_identity_references?.mcpSessionsPseudonymized, 1);
  assert.deepEqual(evidence.categoryEvidence.oauth_authorization_records, {
    accessTokensPseudonymized: 1,
    authorizationCodesPseudonymized: 1,
    deviceAuthorizationsPseudonymized: 1,
    refreshTokensPseudonymized: 1,
    tokenFamiliesPseudonymized: 1,
  });
});

test("account deletion deletes unused private quotes and anonymizes retained quote ownership", async () => {
  const now = new Date("2026-07-16T08:30:00.000Z");
  await seedBetterAuthUser("better-private-quotes", "private-quotes@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-private-quotes" });
  for (const [quoteId, prompt] of [
    ["quote_account_unused", "Unused account-private prompt"],
    ["quote_account_retained", "Retained account-private prompt"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_quotes
            (quote_id, request_hash, request_json, response_json, owner_principal_id, expires_at, created_at)
            VALUES (?, ?, ?, '{}', ?, ?, ?)`,
      args: [
        quoteId,
        `hash-${quoteId}`,
        JSON.stringify({ question: { prompt }, visibility: "private" }),
        identity.principalId,
        new Date(now.getTime() + 60_000),
        now,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, created_at, updated_at)
          VALUES ('operation_account_retained', 'account-retained', 'request-hash',
                  'quote_account_retained', '{}', '{}', 'completed', ?, ?)`,
    args: [now, now],
  });
  assert.match(
    (await getAccountDeletionPreview(identity.principalId)).impact.retainedRecords.join(" "),
    /owner link anonymized/iu,
  );

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: identity.principalId,
    recentAuthProof: await deletionProof("better-private-quotes", identity.principalId, now),
    now,
  });
  const quotes = await dbClient.execute({
    sql: `SELECT quote_id, request_json, owner_principal_id, owner_workspace_id, owner_api_key_id
          FROM tokenless_agent_quotes
          WHERE quote_id IN ('quote_account_unused', 'quote_account_retained')
          ORDER BY quote_id`,
  });
  assert.equal(quotes.rowCount, 1);
  assert.equal(quotes.rows[0]?.quote_id, "quote_account_retained");
  assert.doesNotMatch(String(quotes.rows[0]?.request_json), /Retained account-private prompt/u);
  assert.match(String(quotes.rows[0]?.request_json), /rateloop\.erased-private-quote\.v1/u);
  assert.match(String(quotes.rows[0]?.owner_principal_id), /^deleted-quote:[0-9a-f]{64}$/u);
  assert.equal(quotes.rows[0]?.owner_workspace_id, null);
  assert.equal(quotes.rows[0]?.owner_api_key_id, null);

  const completion = await dbClient.execute({
    sql: `SELECT evidence_json FROM tokenless_subject_request_completions WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  const evidence = JSON.parse(String(completion.rows[0]?.evidence_json)) as {
    categoryEvidence: Record<string, Record<string, unknown>>;
  };
  assert.deepEqual(evidence.categoryEvidence.private_quote_plaintext_payloads, {
    deletedUnreferenced: 1,
    erasedReferencedContent: 0,
  });
  assert.deepEqual(evidence.categoryEvidence.referenced_private_quote_commitments, {
    ownerTombstone: quotes.rows[0]?.owner_principal_id,
    retainedReferencedCommitmentOnly: 1,
  });
  assert.equal(evidence.categoryEvidence.settlement_legal_security?.retainedPrivateQuoteCommitments, 1);
  assert.equal(
    evidence.categoryEvidence.settlement_legal_security?.privateQuoteOwnerTombstone,
    quotes.rows[0]?.owner_principal_id,
  );
});

test("account deletion receipts the rater identity, erases World ID state, and permits fresh enrollment", async () => {
  const now = new Date("2026-07-16T09:00:00.000Z");
  const payoutAccount = "0x2222222222222222222222222222222222222222";
  await seedBetterAuthUser("better-rater", "rater-delete@example.test");
  const oldIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-rater" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,
           proof_message_hash,created_at,last_used_at)
          VALUES ('wb_rater_old',?,'payout',?,'self_custodial',8453,'proof-old',?,?)`,
    args: [oldIdentity.principalId, payoutAccount, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'wb_rater_old',?)`,
    args: [payoutAccount, oldIdentity.principalId, now],
  });
  const oldClient = await dbPool.connect();
  let oldRaterId: string;
  try {
    oldRaterId = await ensureAssuranceRaterProfile(
      oldClient,
      { principalId: oldIdentity.principalId, payoutAccount },
      now,
    );
  } finally {
    oldClient.release();
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_paid_vouchers
          (voucher_id,rater_id,request_idempotency_key,request_hash,chain_id,panel_address,
           issuer_address,issuer_epoch,signer_address,round_id,content_id,vote_key,nullifier,
           admission_policy_hash,assurance_snapshot_hash,expires_at,payout_account_snapshot,
           voucher_json,voucher_signature,status,issued_at)
          VALUES ('voucher_delete',?,'voucher:delete:1','request-delete',84532,
                  '0x3333333333333333333333333333333333333333',
                  '0x4444444444444444444444444444444444444444',1,
                  '0x4444444444444444444444444444444444444444',42,?,?,?,?,'sha256:${"5".repeat(64)}',
                  ?,?,'{}','0x12','issued',?)`,
    args: [
      oldRaterId,
      `0x${"1".repeat(64)}`,
      "0x5555555555555555555555555555555555555555",
      `0x${"2".repeat(64)}`,
      `0x${"3".repeat(64)}`,
      new Date(now.getTime() + 3_600_000),
      payoutAccount,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_world_id_context_limits
          (rater_id,window_started_at,request_count,updated_at) VALUES (?, ?, 1, ?)`,
    args: [oldRaterId, now, now],
  });
  await seedNetworkRaterCopies({ now, payoutAccount, raterId: oldRaterId });
  const worldSubjectReferenceHash = `hmac-sha256:test-v1:${"6".repeat(64)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_provider_subject_bindings
          (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
           subject_reference_scheme,subject_reference_key_version,status,bound_at,last_verified_at,
           created_at,updated_at)
          VALUES ('bind_world_delete',?,'world:poh','rp_delete',?,'hmac-sha256-v1','test-v1',
                  'active',?,?,?,?)`,
    args: [oldRaterId, worldSubjectReferenceHash, now, now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_assertions
          (assertion_id,rater_id,binding_id,provider_id,provider_namespace,provider_assertion_hash,
           provider_assertion_id_hash,provider_assertion_reference_scheme,provider_assertion_key_version,
           capabilities_json,provider_evidence_ciphertext,provider_evidence_key_version,
           provider_evidence_key_domain,evidence_verified_at,evidence_expires_at,status,created_at,updated_at)
          VALUES ('assert_world_delete',?,'bind_world_delete','world:poh','rp_delete',?,?,'hmac-sha256-v1',
                  'test-v1','["unique_human"]','ciphertext','test-v1','provider_evidence',?,?,'active',?,?)`,
    args: [
      oldRaterId,
      `hmac-sha256:test-v1:${"7".repeat(64)}`,
      `hmac-sha256:test-v1:${"8".repeat(64)}`,
      now,
      new Date(now.getTime() + 86_400_000),
      now,
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_world_id_requests
          (request_id,rater_id,principal_id,account_address,provider_id,rp_id,app_id,action_version,
           action,environment,mode,assurance_effect,nonce,credential_expires_at_min,status,created_at,expires_at)
          VALUES ('wrq_delete',?,?,?,'world:poh','rp_delete','app_delete','v1','delete-test','staging',
                  'initial_unique','bind_durable_unique_human','nonce-delete',?,'pending',?,?)`,
    args: [
      oldRaterId,
      oldIdentity.principalId,
      payoutAccount,
      new Date(now.getTime() + 86_400_000),
      now,
      new Date(now.getTime() + 300_000),
    ],
  });

  const deleted = await deleteAccount({
    confirmation: "DELETE",
    principalId: oldIdentity.principalId,
    recentAuthProof: await deletionProof("better-rater", oldIdentity.principalId, now),
    now,
  });
  const receiptAccount = `0x${createHash("sha256")
    .update(`deleted-rater-payout:${deleted.receiptDigest}`)
    .digest("hex")
    .slice(0, 40)}`;
  const erased = await dbClient.execute({
    sql: `SELECT principal_id,account_address,nullifier_seed_ciphertext,deletion_receipt_hash,deleted_at
          FROM tokenless_rater_profiles WHERE rater_id = ?`,
    args: [oldRaterId],
  });
  assert.equal(erased.rowCount, 1);
  assert.deepEqual(erased.rows[0], {
    principal_id: null,
    account_address: receiptAccount,
    nullifier_seed_ciphertext: `deleted:${deleted.receiptDigest}`,
    deletion_receipt_hash: `sha256:${deleted.receiptDigest}`,
    deleted_at: now,
  });
  const erasedState = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_world_id_requests WHERE rater_id = ?) AS world_requests,
            (SELECT COUNT(*) FROM tokenless_world_id_context_limits WHERE rater_id = ?) AS world_limits,
            (SELECT COUNT(*) FROM tokenless_provider_subject_bindings WHERE rater_id = ?) AS subject_bindings,
            (SELECT COUNT(*) FROM tokenless_assurance_assertions WHERE rater_id = ?) AS assertions,
            (SELECT COUNT(*) FROM tokenless_payout_wallet_ownership WHERE principal_id = ?) AS ownership,
            (SELECT COUNT(*) FROM tokenless_paid_vouchers WHERE rater_id = ?) AS retained_vouchers`,
    args: [oldRaterId, oldRaterId, oldRaterId, oldRaterId, oldIdentity.principalId, oldRaterId],
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(erasedState.rows[0] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
    { world_requests: 0, world_limits: 0, subject_bindings: 0, assertions: 0, ownership: 0, retained_vouchers: 1 },
  );
  const networkCopies = await dbClient.execute({
    sql: `SELECT assignment.reviewer_account_address,assignment.payout_account_snapshot,
                 assignment.qualification_provenance_json,assignment.assurance_snapshot_json,
                 assignment.assurance_snapshot_hash,assignment.blinding_json,
                 assignment.integrity_reviewer_lookup,assignment.integrity_cluster_pseudonym,
                 assignment.integrity_risk_band,assignment.provider_subject_hashes_json,
                 assignment.integrity_provenance_json,assignment.integrity_provenance_hash
          FROM tokenless_assurance_assignments assignment
          WHERE assignment.assignment_id='assignment_network_erasure'`,
  });
  assert.equal(networkCopies.rowCount, 1);
  const networkCopy = networkCopies.rows[0] as Record<string, unknown>;
  assert.equal(networkCopy.reviewer_account_address, receiptAccount);
  assert.equal(networkCopy.payout_account_snapshot, receiptAccount);
  assert.equal(networkCopy.qualification_provenance_json, "[]");
  assert.match(String(networkCopy.assurance_snapshot_json), /rateloop\.erased-assurance-snapshot\.v1/u);
  assert.match(
    String(networkCopy.assurance_snapshot_json),
    new RegExp(String(networkCopy.assurance_snapshot_hash), "u"),
  );
  assert.equal(networkCopy.blinding_json, '{"subject":"deleted"}');
  assert.equal(networkCopy.integrity_reviewer_lookup, null);
  assert.equal(networkCopy.integrity_cluster_pseudonym, null);
  assert.equal(networkCopy.integrity_risk_band, null);
  assert.equal(networkCopy.provider_subject_hashes_json, "[]");
  assert.match(String(networkCopy.integrity_provenance_json), /rateloop\.erased-integrity-provenance\.v1/u);
  assert.match(
    String(networkCopy.integrity_provenance_json),
    new RegExp(String(networkCopy.integrity_provenance_hash), "u"),
  );
  const voucherSnapshot = await dbClient.execute({
    sql: `SELECT snapshot_json,snapshot_hash FROM tokenless_voucher_assurance_snapshots
          WHERE voucher_id='voucher_delete'`,
  });
  assert.equal(voucherSnapshot.rowCount, 1);
  assert.match(String(voucherSnapshot.rows[0]?.snapshot_json), /rateloop\.erased-voucher-assurance-snapshot\.v1/u);
  assert.match(
    String(voucherSnapshot.rows[0]?.snapshot_json),
    new RegExp(String(voucherSnapshot.rows[0]?.snapshot_hash), "u"),
  );
  const memberships = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_assurance_cohort_reviewers
             WHERE reviewer_account_address=? AND network_managed=true) AS old_memberships,
            (SELECT COUNT(*) FROM tokenless_assurance_cohort_reviewers
             WHERE reviewer_account_address=? AND network_managed=true
               AND status='removed') AS erased_memberships`,
    args: [payoutAccount, receiptAccount],
  });
  assert.equal(Number(memberships.rows[0]?.old_memberships), 0);
  assert.equal(Number(memberships.rows[0]?.erased_memberships), 1);
  assert.doesNotMatch(
    JSON.stringify({ assignment: networkCopy, voucherSnapshot: voucherSnapshot.rows[0] }),
    /delete-me|private-lookup|private-cluster|private-provider/u,
  );

  const receipt = await dbClient.execute({
    sql: `SELECT category,disposition,status,basis_code,retention_deadline,evidence_digest,
                 created_at,completed_at
          FROM tokenless_deletion_job_categories
          WHERE job_id = ? AND category = 'world_id_and_rater_linkage'`,
    args: [deleted.jobId],
  });
  assert.equal(receipt.rowCount, 1);
  assert.equal(receipt.rows[0]?.disposition, "erase");
  assert.equal(receipt.rows[0]?.status, "completed");
  assert.equal(receipt.rows[0]?.basis_code, null);
  assert.equal(receipt.rows[0]?.retention_deadline, null);
  assert.match(String(receipt.rows[0]?.evidence_digest), /^[0-9a-f]{64}$/);
  assert.ok(new Date(String(receipt.rows[0]?.completed_at)) >= new Date(String(receipt.rows[0]?.created_at)));
  const retainedReceipt = await dbClient.execute({
    sql: `SELECT disposition,status,basis_code,retention_deadline,evidence_digest
          FROM tokenless_deletion_job_categories
          WHERE job_id = ? AND category = 'settlement_legal_security'`,
    args: [deleted.jobId],
  });
  assert.deepEqual(
    {
      basis: retainedReceipt.rows[0]?.basis_code,
      disposition: retainedReceipt.rows[0]?.disposition,
      status: retainedReceipt.rows[0]?.status,
    },
    { basis: "legal_settlement_security", disposition: "retain", status: "retained" },
  );
  assert.equal(
    new Date(String(retainedReceipt.rows[0]?.retention_deadline)).toISOString(),
    new Date(now.getTime() + 3_650 * 86_400_000).toISOString(),
  );
  assert.match(String(retainedReceipt.rows[0]?.evidence_digest), /^[0-9a-f]{64}$/);
  const completion = await dbClient.execute({
    sql: `SELECT evidence_json FROM tokenless_subject_request_completions WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  const completionEvidence = JSON.parse(String(completion.rows[0]?.evidence_json)) as {
    categoryDigests: Record<string, string>;
    categoryEvidence: Record<string, Record<string, unknown>>;
  };
  assert.equal(completionEvidence.categoryDigests.world_id_and_rater_linkage, receipt.rows[0]?.evidence_digest);
  assert.deepEqual(completionEvidence.categoryEvidence.world_id_and_rater_linkage, {
    deletedRows: {
      assuranceAssertions: 1,
      legalEligibility: 0,
      paidEligibilityScopes: 0,
      payoutEligibility: 0,
      providerSubjectBindings: 1,
      integrityEpochMemberships: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      worldIdContextLimits: 1,
      worldIdRequests: 1,
    },
    forecastIntegrityErasure: {
      deletedRows: 0,
      remainingRows: 0,
      subjectCount: 1,
    },
    paidAssignmentSeatDirectIdentitiesErased: 0,
    profileFound: true,
    networkCopiesErasure: {
      assignmentHistoryAnonymized: 0,
      assignmentsAnonymized: 1,
      materializedMembershipsDeleted: 1,
      remainingDirectCopies: 0,
      tombstoneMembershipsRetained: 1,
      voucherSnapshotsAnonymized: 1,
    },
    remainingPaidAssignmentSeatDirectIdentities: 0,
    remainingRows: {
      assuranceAssertions: 0,
      legalEligibility: 0,
      paidEligibilityScopes: 0,
      payoutEligibility: 0,
      principalProfileLinks: 0,
      providerSubjectBindings: 0,
      integrityEpochMemberships: 0,
      reviewerQualifications: 0,
      sanctionsScreenings: 0,
      worldIdContextLimits: 0,
      worldIdRequests: 0,
    },
    tombstoneWritten: true,
  });
  assert.deepEqual(completionEvidence.categoryEvidence.settlement_legal_security, {
    paidAssignmentSeatErasureReceiptHashes: [],
    paidAssignmentSeatIdentityCommitmentsRetained: 0,
    privateQuoteOwnerTombstone: null,
    raterTombstoneRetained: true,
    networkReviewerLinkageRetention: null,
    retainedPrivateQuoteCommitments: 0,
    retainedPaidVouchers: 1,
    retainedRaterLinkedSettlementAndQualityRows: {
      assuranceAssignments: 1,
      expertiseVerificationRequests: 0,
      goldOutcomes: 0,
      paidReviewEligibilitySnapshots: 0,
      paidReviewVoucherIssuances: 0,
      voucherAssuranceSnapshots: 1,
      networkSettlementCommitments: 0,
    },
    tombstoneReceiptHash: `sha256:${deleted.receiptDigest}`,
  });
  const events = await dbClient.execute({
    sql: `SELECT from_status,to_status,actor_reference,reason,created_at
          FROM tokenless_subject_request_events WHERE request_id = ?`,
    args: [deleted.requestId],
  });
  assert.equal(events.rowCount, 1);
  assert.deepEqual(
    {
      actor: events.rows[0]?.actor_reference,
      from: events.rows[0]?.from_status,
      reason: events.rows[0]?.reason,
      to: events.rows[0]?.to_status,
    },
    {
      actor: "system:account_deletion",
      from: null,
      reason: "atomic_account_erasure_completed",
      to: "completed",
    },
  );

  await seedBetterAuthUser("better-rater-fresh", "rater-delete@example.test");
  const freshIdentity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-rater-fresh" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,
           proof_message_hash,created_at,last_used_at)
          VALUES ('wb_rater_fresh',?,'payout',?,'self_custodial',8453,'proof-fresh',?,?)`,
    args: [freshIdentity.principalId, payoutAccount, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'wb_rater_fresh',?)`,
    args: [payoutAccount, freshIdentity.principalId, now],
  });
  const freshClient = await dbPool.connect();
  let freshRaterId: string;
  try {
    freshRaterId = await ensureAssuranceRaterProfile(
      freshClient,
      { principalId: freshIdentity.principalId, payoutAccount },
      now,
    );
  } finally {
    freshClient.release();
  }
  assert.notEqual(freshRaterId, oldRaterId);
  const fresh = await dbClient.execute({
    sql: `SELECT principal_id,account_address,deletion_receipt_hash
          FROM tokenless_rater_profiles WHERE rater_id = ?`,
    args: [freshRaterId],
  });
  assert.deepEqual(fresh.rows[0], {
    principal_id: freshIdentity.principalId,
    account_address: payoutAccount,
    deletion_receipt_hash: null,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_provider_subject_bindings
          (binding_id,rater_id,provider_id,provider_namespace,subject_reference_hash,
           subject_reference_scheme,subject_reference_key_version,status,bound_at,last_verified_at,
           created_at,updated_at)
          VALUES ('bind_world_fresh',?,'world:poh','rp_delete',?,'hmac-sha256-v1','test-v1',
                  'active',?,?,?,?)`,
    args: [freshRaterId, worldSubjectReferenceHash, now, now, now, now],
  });
  const rebound = await dbClient.execute({
    sql: `SELECT rater_id FROM tokenless_provider_subject_bindings
          WHERE subject_reference_hash = ?`,
    args: [worldSubjectReferenceHash],
  });
  assert.deepEqual(rebound.rows, [{ rater_id: freshRaterId }]);
});

test("account deletion blocks active managed wallets until they are disconnected", async () => {
  const now = new Date("2026-07-16T08:04:45.000Z");
  await seedBetterAuthUser("better-blocked", "blocked@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-blocked" });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_bindings
          (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
           proof_message_hash, created_at, last_used_at)
          VALUES ('wb_managed', ?, 'recovery', '0x3333333333333333333333333333333333333333',
                  'thirdweb', 8453, 'proof', ?, ?)`,
    args: [identity.principalId, now, now],
  });
  const preview = await getAccountDeletionPreview(identity.principalId);
  assert.deepEqual(
    preview.blockers.map(blocker => blocker.code),
    ["managed_wallet_recovery_required"],
  );
  assert.equal(preview.impact.managedWallets, 1);
  const recentAuthProof = await deletionProof("better-blocked", identity.principalId, now);
  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_wallet_recovery_required",
  );
  await revokeWalletBinding({ bindingId: "wb_managed", principalId: identity.principalId, now });
  const disconnectedPreview = await getAccountDeletionPreview(identity.principalId);
  assert.deepEqual(disconnectedPreview.blockers, []);
  assert.equal(disconnectedPreview.impact.managedWallets, 0);
});

test("account deletion fails closed before receipting an incomplete erasure", async () => {
  const now = new Date("2026-07-16T10:00:00.000Z");
  await seedBetterAuthUser("better-incomplete", "incomplete@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-incomplete" });
  const recentAuthProof = await deletionProof("better-incomplete", identity.principalId, now);
  const originalConnect = databaseResources.pool.connect.bind(databaseResources.pool);
  databaseResources.pool.connect = (async () => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client);
    client.query = (async (queryText: string, queryValues?: unknown[]) => {
      const result = await originalQuery(queryText, queryValues);
      if (typeof queryText === "string" && queryText.includes("AS browser_identities") && result.rows[0]) {
        result.rows[0].browser_identities = 1;
      }
      return result;
    }) as typeof client.query;
    return client;
  }) as typeof databaseResources.pool.connect;

  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    /Account deletion postcondition failed: browserIdentities/,
  );
  databaseResources.pool.connect = originalConnect as typeof databaseResources.pool.connect;
  const receipts = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_deletion_jobs WHERE scope_id = ?`,
    args: [identity.principalId],
  });
  const receiptCount = receipts.rows[0]?.count;
  assert.equal(Number(Array.isArray(receiptCount) ? receiptCount[0] : receiptCount), 0);
});

test("account deletion rolls back proof consumption and its audit when the bound identity changed", async () => {
  const now = new Date("2026-07-16T10:05:00.000Z");
  await seedBetterAuthUser("better-proof-rollback", "proof-rollback@example.test");
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId: "better-proof-rollback" });
  const recentAuthProof = await deletionProof("better-proof-rollback", identity.principalId, now);
  await dbClient.execute({
    sql: `UPDATE tokenless_identity_bindings SET status = 'revoked', revoked_at = ?
          WHERE principal_id = ? AND provider = 'better_auth'`,
    args: [now, identity.principalId],
  });

  await assert.rejects(
    () =>
      deleteAccount({
        confirmation: "DELETE",
        principalId: identity.principalId,
        recentAuthProof,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "recent_authentication_required",
  );
  const proofState = await dbClient.execute({
    sql: `SELECT consumed_at FROM tokenless_recent_account_action_proofs WHERE principal_id = ?`,
    args: [identity.principalId],
  });
  assert.deepEqual(proofState.rows, [{ consumed_at: null }]);
  const auditActions = await dbClient.execute({
    sql: `SELECT action FROM tokenless_security_audit_events
          WHERE scope_kind = 'identity' AND scope_id = ? ORDER BY sequence`,
    args: [identity.principalId],
  });
  assert.equal(
    auditActions.rows.some(row => row.action === "account.deletion_recent_auth_consumed"),
    false,
  );
});

test("the account deletion route requires the product session and a one-use recent-auth proof", () => {
  const source = readFileSync(join(process.cwd(), "app/api/account/deletion/route.ts"), "utf8");
  assert.match(source, /requireBrowserSession\(request\)/);
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(source, /recentAuthProof/);
  assert.doesNotMatch(source, /consumeAccountDeletionProof/);
  const service = readFileSync(join(process.cwd(), "lib/privacy/accountDeletion.ts"), "utf8");
  assert.match(service, /lockAccountDeletionProof[\s\S]+client/);
  assert.match(service, /consumeLockedAccountDeletionProof[\s\S]+client/);
  assert.match(service, /SELECT rater_id FROM tokenless_rater_profiles[\s\S]*principal_id=\$1 LIMIT 1 FOR UPDATE/u);
  assert.ok(
    service.indexOf("await lockRaterProfileForDeletion") < service.indexOf("await releaseReservedAssignments"),
    "account deletion must take the selector's rater-profile lock before sweeping network assignments",
  );
  assert.match(source, /response\.cookies\.delete\(AUTH_SESSION_COOKIE\)/);
  assert.match(source, /BETTER_AUTH_SESSION_COOKIE_NAMES/);
  assert.deepEqual(BETTER_AUTH_SESSION_COOKIE_NAMES, [
    "rateloop-identity.session_token",
    "__Secure-rateloop-identity.session_token",
  ]);
  assert.doesNotMatch(source, /better-auth\.session_token/);
});

test("account deletion covers direct-review reservations, identities, and policy acceptances", () => {
  const source = readFileSync(join(process.cwd(), "lib/privacy/accountDeletion.ts"), "utf8");
  assert.match(
    source,
    /UPDATE tokenless_private_unpaid_review_assignments[\s\S]*status='expired',lease_state='expired'/u,
  );
  assert.match(source, /UPDATE tokenless_assurance_cohort_reviewers[\s\S]*active_reservations=active_reservations-1/u);
  assert.match(source, /UPDATE tokenless_assurance_cohorts[\s\S]*active_reservations=active_reservations-1/u);
  assert.match(source, /UPDATE tokenless_private_unpaid_review_assignments[\s\S]*reviewer_account_address=\$1/u);
  assert.match(source, /UPDATE tokenless_assurance_assignments[\s\S]*reviewer_account_address=\$1/u);
  assert.match(source, /DELETE FROM tokenless_private_group_policy_acceptances WHERE principal_address=\$1/u);
  assert.match(source, /Account deletion reservation-release postcondition failed/u);
  assert.match(source, /direct_private_assignments/u);
  assert.match(source, /private_group_policy_acceptances/u);
});

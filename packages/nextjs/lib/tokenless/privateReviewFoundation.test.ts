import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { __setArtifactPrivacyRuntimeForTests } from "~~/lib/tokenless/artifactPrivacy";
import { createAssuranceProject } from "~~/lib/tokenless/humanAssurance";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import {
  __privateReviewFoundationTestUtils,
  preparePrivateReviewFoundation,
} from "~~/lib/tokenless/privateReviewFoundation";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { createReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => {
  __setArtifactPrivacyRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

test("OAuth-shaped MCP principals bind their token family without pretending it is an API key", () => {
  assert.deepEqual(
    __privateReviewFoundationTestUtils.resolveCallerCredential(
      { api_key_id: null, token_family_id: "atf_oauth_family" },
      "atf_oauth_family",
    ),
    { callerCredentialId: "atf_oauth_family", callerCredentialKind: "oauth_token_family" },
  );
  assert.throws(
    () =>
      __privateReviewFoundationTestUtils.resolveCallerCredential(
        { api_key_id: null, token_family_id: "atf_oauth_family" },
        "workspace_api_key_id",
      ),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "private_review_integration_binding_mismatch",
  );
});

test("integration rows must contain exactly one caller credential source", () => {
  assert.deepEqual(
    __privateReviewFoundationTestUtils.resolveCallerCredential(
      { api_key_id: "key_service", token_family_id: null },
      "key_service",
    ),
    { callerCredentialId: "key_service", callerCredentialKind: "api_key" },
  );
  assert.throws(() =>
    __privateReviewFoundationTestUtils.resolveCallerCredential(
      { api_key_id: "key_service", token_family_id: "atf_oauth_family" },
      "atf_oauth_family",
    ),
  );
});

async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Private foundation", ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Private foundation publishing",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "10000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 10,
      maxBountyAtomic: "10000000",
      maxFeeBps: 1_000,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["confidential"],
    },
  });
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const pairing = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (pairing.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing,
    registration: {
      externalId: "private-foundation-agent",
      displayName: "Private foundation agent",
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["private-review"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["private-review"] },
  });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Private reviewers",
    purpose: "Review confidential agent suggestions.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  const profile = await createReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId,
    profile: {
      agentId: approved.agent.agentId,
      agentVersionId: approved.agent.versionId,
      questionAuthority: "owner_fixed",
      criterion: "Is this suggestion correct and safe?",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "off",
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: group.groupId,
      privateGroupPolicyVersion: 1,
      privateGroupPolicyHash: group.policyHash,
      responseWindowSeconds: 3_600,
      panelSize: 2,
      compensationMode: "unpaid",
    },
  });
  const bindingId = "hrb_private_foundation";
  const now = new Date("2026-07-16T09:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id,version,workspace_id,agent_id,agent_version_id,selection_policy_id,
           selection_policy_version,request_profile_id,request_profile_version,request_profile_hash,
           publishing_policy_id,publishing_policy_version,authority,enabled,canonical_hash,
           created_by,created_at,approved_by,approved_at)
          VALUES (?,1,?,?,?,?,?,?,1,?,?,?,'prepare_for_approval',true,?,?,?,?,?)`,
    args: [
      bindingId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.reviewPolicyId,
      1,
      profile.profileId,
      profile.profileHash,
      publishing.policyId,
      publishing.version,
      `sha256:${"2".repeat(64)}`,
      OWNER,
      now,
      OWNER,
      now,
    ],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET human_review_binding_id = ?, human_review_binding_version = 1
          WHERE integration_id = ?`,
    args: [bindingId, approved.integration.integrationId],
  });
  const integrated = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (integrated.kind !== "integration") throw new Error("Integration principal expected.");
  const project = await createAssuranceProject({
    principal: integrated.principal,
    name: "Private suggestions",
    dataClassification: "confidential",
    retentionDays: 30,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_projects
          SET visibility = 'private', private_sensitivity = 'confidential'
          WHERE project_id = ?`,
    args: [project.projectId],
  });
  const cohortId = "hacoh_private_foundation";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id,project_id,name,source,selection,capacity,active_reservations,private_group_id,
           qualification_rules_json,status,created_by,created_at,updated_at)
          VALUES (?,?,'Named reviewers','customer_invited','customer_named',10,0,?,'[]','active',?,?,?)`,
    args: [cohortId, project.projectId, group.groupId, OWNER, now, now],
  });
  return {
    now,
    publishing,
    workspaceId,
    principal: integrated.principal,
    request: {
      idempotencyKey: "private-foundation-0001",
      integrationId: approved.integration.integrationId,
      projectId: project.projectId,
      requestProfile: {
        id: profile.profileId,
        version: profile.version,
        hash: profile.profileHash as `sha256:${string}`,
      },
      cohortId,
      dataClassification: "confidential" as const,
      source: { contentType: "text/plain", bytesBase64: Buffer.from("private source").toString("base64") },
      suggestion: {
        contentType: "text/plain",
        bytesBase64: Buffer.from("private suggestion").toString("base64"),
      },
    },
  };
}

function memoryArtifactRuntime(input: { failFirstPut?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  let failFirstPut = input.failFirstPut ?? false;
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "private-foundation-test-v1",
    masterKey: new Uint8Array(32).fill(7),
    store: {
      async delete(reference) {
        objects.delete(reference);
      },
      async get(reference) {
        const value = objects.get(reference);
        if (!value) throw new Error("missing test object");
        return value;
      },
      async put(pathname, body) {
        if (failFirstPut) {
          failFirstPut = false;
          throw new Error("simulated blob interruption");
        }
        const reference = `memory://${pathname}`;
        objects.set(reference, body.slice());
        return reference;
      },
    },
  });
  return objects;
}

test("private foundation encrypts separate artifacts and exact replay is idempotent", async () => {
  const setup = await fixture();
  const objects = memoryArtifactRuntime();
  const first = await preparePrivateReviewFoundation(setup);
  const replay = await preparePrivateReviewFoundation(setup);
  assert.deepEqual(replay, first);
  assert.equal(first.task.kind, "binary_review");
  assert.equal(first.responseDeadline, new Date(setup.now.getTime() + 3_600_000).toISOString());
  assert.notEqual(first.artifacts.sourceArtifactId, first.artifacts.suggestionArtifactId);
  assert.equal(objects.size, 2);

  const stored = await dbClient.execute({
    sql: `SELECT r.integration_id,r.caller_credential_kind,r.caller_credential_id,r.foundation_status,
                 r.response_deadline,r.preparation_lease_id,
                 source.content_nonce AS source_nonce,suggestion.content_nonce AS suggestion_nonce,
                 source.wrapped_data_key AS source_key,suggestion.wrapped_data_key AS suggestion_key
          FROM tokenless_private_review_requests r
          JOIN tokenless_assurance_artifact_objects source ON source.artifact_id=r.source_artifact_id
          JOIN tokenless_assurance_artifact_objects suggestion ON suggestion.artifact_id=r.suggestion_artifact_id`,
  });
  assert.equal(stored.rows[0]?.caller_credential_kind, "api_key");
  assert.equal(stored.rows[0]?.foundation_status, "ready_for_assignment");
  assert.equal(stored.rows[0]?.preparation_lease_id, null);
  assert.notEqual(stored.rows[0]?.source_nonce, stored.rows[0]?.suggestion_nonce);
  assert.notEqual(stored.rows[0]?.source_key, stored.rows[0]?.suggestion_key);
  const projectAccess = await dbClient.execute({
    sql: `SELECT subject_kind,subject_reference FROM tokenless_project_access_assignments
          WHERE project_id=? AND status='active'`,
    args: [setup.request.projectId],
  });
  assert.deepEqual(projectAccess.rows[0], {
    subject_kind: "api_key",
    subject_reference: setup.principal.apiKeyId,
  });
  const persisted = JSON.stringify(
    await Promise.all(
      ["tokenless_private_review_requests", "tokenless_assurance_access_logs", "tokenless_audit_events"].map(
        async table => (await dbClient.execute(`SELECT * FROM ${table}`)).rows,
      ),
    ),
  );
  assert.equal(persisted.includes("private source"), false);
  assert.equal(persisted.includes("private suggestion"), false);
});

test("private foundation freezes caller-verifiable commitments separately from vault commitments", async () => {
  const setup = await fixture();
  memoryArtifactRuntime();
  const externalContentCommitments = {
    sourceEvidenceHash: `sha256:${"a".repeat(64)}` as const,
    suggestionCommitment: `sha256:${"b".repeat(64)}` as const,
  };
  const first = await preparePrivateReviewFoundation({ ...setup, externalContentCommitments });
  const replay = await preparePrivateReviewFoundation({ ...setup, externalContentCommitments });
  assert.equal(replay.privateReviewId, first.privateReviewId);
  const stored = await dbClient.execute({
    sql: `SELECT r.external_source_evidence_hash,r.external_suggestion_commitment,
                 source.digest AS source_digest,suggestion.digest AS suggestion_digest
          FROM tokenless_private_review_requests r
          JOIN tokenless_assurance_artifacts source ON source.artifact_id=r.source_artifact_id
          JOIN tokenless_assurance_artifacts suggestion ON suggestion.artifact_id=r.suggestion_artifact_id
          WHERE r.private_review_id=?`,
    args: [first.privateReviewId],
  });
  assert.equal(stored.rows[0]?.external_source_evidence_hash, externalContentCommitments.sourceEvidenceHash);
  assert.equal(stored.rows[0]?.external_suggestion_commitment, externalContentCommitments.suggestionCommitment);
  assert.notEqual(stored.rows[0]?.source_digest, externalContentCommitments.sourceEvidenceHash);
  assert.notEqual(stored.rows[0]?.suggestion_digest, externalContentCommitments.suggestionCommitment);
  await assert.rejects(
    preparePrivateReviewFoundation({
      ...setup,
      externalContentCommitments: {
        ...externalContentCommitments,
        suggestionCommitment: `sha256:${"c".repeat(64)}`,
      },
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_review_idempotency_conflict",
  );
});

test("failed preparation is durably recoverable without duplicate artifacts", async () => {
  const setup = await fixture();
  const objects = memoryArtifactRuntime({ failFirstPut: true });
  await assert.rejects(() => preparePrivateReviewFoundation(setup), /simulated blob interruption/u);
  const failed = await dbClient.execute(
    "SELECT foundation_status,preparation_attempt_count FROM tokenless_private_review_requests",
  );
  assert.equal(failed.rows[0]?.foundation_status, "failed_recoverable");
  assert.equal(Number(failed.rows[0]?.preparation_attempt_count), 1);

  const recovered = await preparePrivateReviewFoundation(setup);
  assert.equal(recovered.status, "ready_for_assignment");
  assert.equal(objects.size, 2);
  const completed = await dbClient.execute(
    "SELECT foundation_status,preparation_attempt_count FROM tokenless_private_review_requests",
  );
  assert.equal(completed.rows[0]?.foundation_status, "ready_for_assignment");
  assert.equal(Number(completed.rows[0]?.preparation_attempt_count), 2);
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_artifacts")).rows[0]?.count),
    2,
  );
});

test("an excluded project freezes awaiting_owner_rebind without creating an assignment", async () => {
  const setup = await fixture();
  memoryArtifactRuntime();
  await dbClient.execute({
    sql: `UPDATE tokenless_private_group_policy_versions
          SET allowed_project_ids_json='["hap_owner_must_rebind"]'
          WHERE group_id=(SELECT private_group_id FROM tokenless_assurance_cohorts WHERE cohort_id=?)`,
    args: [setup.request.cohortId],
  });
  const result = await preparePrivateReviewFoundation({
    ...setup,
    request: { ...setup.request, idempotencyKey: "private-foundation-excluded-0001" },
  });
  assert.equal(result.status, "awaiting_owner_rebind");
  assert.equal(result.bindings.privateGroup.allowlistStatus, "excluded");
  const stored = await dbClient.execute(
    "SELECT foundation_status,group_allowlist_status FROM tokenless_private_review_requests",
  );
  assert.deepEqual(stored.rows[0], {
    foundation_status: "awaiting_owner_rebind",
    group_allowlist_status: "excluded",
  });
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_assignments")).rows[0]?.count),
    0,
  );
});

test("expired lease racers use isolated upload prefixes and cannot delete the winner", async () => {
  const setup = await fixture();
  const objects = new Map<string, Uint8Array>();
  let releaseFirstPut!: () => void;
  let markFirstPutStarted!: () => void;
  const firstPutStarted = new Promise<void>(resolve => {
    markFirstPutStarted = resolve;
  });
  const firstPutRelease = new Promise<void>(resolve => {
    releaseFirstPut = resolve;
  });
  let blockFirstPut = true;
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "private-foundation-race-v1",
    masterKey: new Uint8Array(32).fill(9),
    store: {
      async delete(reference) {
        objects.delete(reference);
      },
      async get(reference) {
        const value = objects.get(reference);
        if (!value) throw new Error("missing test object");
        return value;
      },
      async put(pathname, body) {
        if (blockFirstPut) {
          blockFirstPut = false;
          markFirstPutStarted();
          await firstPutRelease;
        }
        const reference = `memory://${pathname}`;
        objects.set(reference, body.slice());
        return reference;
      },
    },
  });

  const loser = preparePrivateReviewFoundation(setup);
  await firstPutStarted;
  await dbClient.execute({
    sql: `UPDATE tokenless_private_review_requests SET preparation_lease_expires_at = ?`,
    args: [new Date(setup.now.getTime() - 1)],
  });
  const winner = await preparePrivateReviewFoundation(setup);
  releaseFirstPut();
  await assert.rejects(loser, /durable lease|duplicate key|unique constraint/iu);

  assert.equal(winner.status, "ready_for_assignment");
  assert.equal(objects.size, 2);
  const reservation = await dbClient.execute(
    "SELECT preparation_upload_ids_json FROM tokenless_private_review_requests",
  );
  const uploadIds = JSON.parse(String(reservation.rows[0]?.preparation_upload_ids_json)) as string[];
  assert.equal(uploadIds.length, 2);
  const storedObjects = await dbClient.execute(
    "SELECT storage_ref FROM tokenless_assurance_artifact_objects ORDER BY object_id",
  );
  const references = storedObjects.rows.map(row => String(row.storage_ref));
  assert.equal(references.length, 2);
  assert.ok(references.every(reference => uploadIds.some(uploadId => reference.includes(`/${uploadId}/`))));
  assert.equal(
    uploadIds.filter(uploadId => references.some(reference => reference.includes(`/${uploadId}/`))).length,
    1,
  );
});

test("DB-backed OAuth token families authorize only through their exact connected owner grant", async () => {
  const setup = await fixture();
  const principalId = `rlp_${"b".repeat(24)}`;
  const clientId = "rlo_client_private_foundation";
  const tokenFamilyId = "atf_private_foundation";
  const intentId = "aci_private_foundation";
  const createdAt = setup.now;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?)`,
    args: [principalId, createdAt, createdAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_name,redirect_uris_json,redirect_uris_digest,token_endpoint_auth_method,
           grant_types_json,response_types_json,allowed_scopes_json,registration_source,status,
           created_at,updated_at)
          VALUES (?,'Private foundation OAuth','[]',?,'none','["authorization_code","refresh_token"]',
                  '["code"]','["panel:publish"]','dynamic','active',?,?)`,
    args: [clientId, `sha256:${"3".repeat(64)}`, createdAt, createdAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,
           status,created_at,absolute_expires_at)
          VALUES (?,?,?,'rateloop-agent','https://rateloop-tokenless.vercel.app/api/agent/v1/mcp',
                  '["panel:publish"]','active',?,?)`,
    args: [tokenFamilyId, clientId, principalId, createdAt, new Date(createdAt.getTime() + 86_400_000)],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_connection_intents
          (intent_id,claim_nonce_hash,workspace_id,created_by,status,profile_key,profile_version,
           maximum_scopes_json,allowed_workflow_keys_json,review_preset_json,
           allowed_host_families_json,auto_activate,created_at,claim_expires_at,hard_expires_at,
           claimed_at,consumed_at,tested_at,connected_at,claimed_token_family_id,
           claimed_oauth_client_id,claimed_subject_principal_id,client_capabilities_json,last_transition_at)
          VALUES (?,?,?,?,'connected','default',1,'["panel:publish"]','["private-review"]','{}',
                  '[]',false,?,?,?,?,?,?,?,?,?,?,'[]',?)`,
    args: [
      intentId,
      `sha256:${"4".repeat(64)}`,
      setup.workspaceId,
      principalId,
      createdAt,
      new Date(createdAt.getTime() + 30 * 60_000),
      new Date(createdAt.getTime() + 45 * 60_000),
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      tokenFamilyId,
      clientId,
      principalId,
      createdAt,
    ],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET pairing_id=NULL,api_key_id=NULL,connection_intent_id=?,token_family_id=?,
              activation_mode='owner_approved',granted_scopes_json='["panel:publish"]',
              oauth_client_id=?,oauth_subject_principal_id=?
          WHERE integration_id=?`,
    args: [intentId, tokenFamilyId, clientId, principalId, setup.request.integrationId],
  });
  memoryArtifactRuntime();
  const oauthPrincipal = { ...setup.principal, apiKeyId: tokenFamilyId };
  const created = await preparePrivateReviewFoundation({
    ...setup,
    now: new Date(),
    principal: oauthPrincipal,
    request: { ...setup.request, idempotencyKey: "private-foundation-oauth-0001" },
  });
  assert.equal(created.status, "ready_for_assignment");
  const stored = await dbClient.execute(
    "SELECT integration_id,caller_credential_kind,caller_credential_id FROM tokenless_private_review_requests",
  );
  assert.deepEqual(stored.rows[0], {
    integration_id: setup.request.integrationId,
    caller_credential_kind: "oauth_token_family",
    caller_credential_id: tokenFamilyId,
  });
  const audit = await dbClient.execute({
    sql: `SELECT actor_kind FROM tokenless_audit_events
          WHERE action='private_review.foundation_created' ORDER BY sequence DESC LIMIT 1`,
  });
  assert.equal(audit.rows[0]?.actor_kind, "oauth_token_family");

  await assert.rejects(
    () =>
      preparePrivateReviewFoundation({
        ...setup,
        now: new Date(),
        principal: { ...oauthPrincipal, apiKeyId: "atf_wrong_family" },
        request: { ...setup.request, idempotencyKey: "private-foundation-oauth-wrong" },
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "private_review_integration_binding_mismatch",
  );
});

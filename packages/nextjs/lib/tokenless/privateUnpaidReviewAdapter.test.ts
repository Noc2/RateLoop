import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { preparePrivateReviewFoundation } from "~~/lib/tokenless/privateReviewFoundation";
import {
  __privateUnpaidReviewAdapterTestUtils,
  acceptPrivateUnpaidReviewAssignment,
  requestPrivateUnpaidHumanReview,
} from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { createReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import { attestInvitedReviewerExpertise } from "~~/lib/tokenless/reviewerExpertise";
import { replacePrivateGroupMemberExpertise } from "~~/lib/tokenless/reviewerExpertiseAssignments";
import { createWorkspaceReviewerExpertiseDefinition } from "~~/lib/tokenless/reviewerExpertiseDefinitions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER_A = "0x2222222222222222222222222222222222222222";
const REVIEWER_B = "0x3333333333333333333333333333333333333333";

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "private-unpaid-test-v1",
    masterKey: new Uint8Array(32).fill(9),
    store: {
      async delete() {},
      async get() {
        throw new Error("not needed by assignment tests");
      },
      async put(pathname) {
        return `memory://${pathname}`;
      },
    },
  });
});

afterEach(() => {
  __privateUnpaidReviewAdapterTestUtils.setBeforeDeliveryCommitForTests(null);
  __privateUnpaidReviewAdapterTestUtils.setBeforeLeaseCommitForTests(null);
  __setArtifactPrivacyRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function identity(address: string, email: string, now: Date) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,
           email_domain,display_name,created_at,updated_at,last_login_at)
          VALUES (?,?,'email',?,true,?,?,?, ?, ?)`,
    args: [address, `test-${address}`, email, email.split("@")[1], email.split("@")[0], now, now, now],
  });
}

async function fixture(
  requiredExpertiseKeys: Array<"code-review:typescript"> = [],
  exactMinimumSeats: number | null = null,
  commitmentMode: "external" | "legacy" = "external",
) {
  const foundationNow = new Date("2026-07-16T09:00:00.000Z");
  await identity(REVIEWER_A, "reviewer-a@example.com", foundationNow);
  await identity(REVIEWER_B, "reviewer-b@example.com", foundationNow);
  const { workspaceId } = await createWorkspace({ name: "Private unpaid adapter", ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Private unpaid adapter publishing",
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
      externalId: "private-unpaid-agent",
      displayName: "Private unpaid agent",
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
    name: "Named private reviewers",
    purpose: "Review confidential suggestions without base compensation.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  const expertiseDefinition = exactMinimumSeats
    ? (
        await createWorkspaceReviewerExpertiseDefinition({
          accountAddress: OWNER,
          workspaceId,
          label: "Private release controls",
          description: "Can assess the workspace's private release and rollback controls.",
        })
      ).definition
    : null;
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
      requiredExpertiseKeys,
      expertiseRequirements: expertiseDefinition
        ? [
            {
              definitionId: expertiseDefinition.definitionId,
              definitionVersion: expertiseDefinition.version,
              definitionHash: expertiseDefinition.hash,
              minimumSeats: exactMinimumSeats!,
              sourceScope: "customer_invited",
            },
          ]
        : undefined,
    },
  });
  const bindingId = "hrb_private_unpaid_adapter";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id,version,workspace_id,agent_id,agent_version_id,selection_policy_id,
           selection_policy_version,request_profile_id,request_profile_version,request_profile_hash,
           publishing_policy_id,publishing_policy_version,authority,enabled,canonical_hash,
           created_by,created_at,approved_by,approved_at)
          VALUES (?,1,?,?,?,?,?,?,1,?,?,?,'ask_automatically',true,?,?,?,?,?)`,
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
      hash("private-unpaid-binding"),
      OWNER,
      foundationNow,
      OWNER,
      foundationNow,
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
    name: "Confidential suggestions",
    dataClassification: "confidential",
    retentionDays: 30,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_projects
          SET visibility = 'private', private_sensitivity = 'confidential' WHERE project_id = ?`,
    args: [project.projectId],
  });
  const cohortId = "hacoh_private_unpaid_adapter";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id,project_id,name,source,selection,capacity,active_reservations,private_group_id,
           qualification_rules_json,status,created_by,created_at,updated_at)
          VALUES (?,?,'Named private reviewers','customer_invited','customer_named',10,0,?,'[]','active',?,?,?)`,
    args: [cohortId, project.projectId, group.groupId, OWNER, foundationNow, foundationNow],
  });
  for (const reviewer of [REVIEWER_A, REVIEWER_B]) {
    const invitationId = `pgi_private_${reviewer.slice(2, 10)}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_private_group_invitations
            (invitation_id,workspace_id,group_id,token_hash,token_prefix,role,
             allowed_project_ids_json,intended_account_address,expires_at,maximum_redemptions,
             redemption_count,last_used_at,created_by,created_at)
            VALUES (?,?,?, ?,?,'reviewer',?,?,?,1,1,?,?,?)`,
      args: [
        invitationId,
        workspaceId,
        group.groupId,
        hash(`token:${reviewer}`),
        reviewer.slice(2, 18),
        JSON.stringify([project.projectId]),
        reviewer,
        new Date("2026-07-23T09:00:00.000Z"),
        foundationNow,
        OWNER,
        foundationNow,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_private_group_invitation_redemptions
            (invitation_id,principal_address,group_id,redeemed_at) VALUES (?,?,?,?)`,
      args: [invitationId, reviewer, group.groupId, foundationNow],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_private_group_memberships
            (group_id,principal_address,role,status,allowed_project_ids_json,source_invitation_id,membership_expires_at,
             joined_at,created_by,updated_at)
            VALUES (?,?,'reviewer','active',?,?,NULL,?,?,?)`,
      args: [
        group.groupId,
        reviewer,
        JSON.stringify([project.projectId]),
        invitationId,
        foundationNow,
        OWNER,
        foundationNow,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_cohort_reviewers
            (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
             qualification_expires_at,maximum_active_assignments,active_reservations,status,
             created_by,created_at,updated_at)
            VALUES (?,?,?,'[]',NULL,1,0,'active',?,?,?)`,
      args: [project.projectId, cohortId, reviewer, OWNER, foundationNow, foundationNow],
    });
  }
  const externalContentCommitments = {
    sourceEvidenceHash: hash("private-source-evidence"),
    suggestionCommitment: hash("private-suggestion-evidence"),
  } as const;
  const prepared = await preparePrivateReviewFoundation({
    principal: integrated.principal,
    ...(commitmentMode === "external" ? { externalContentCommitments } : {}),
    request: {
      idempotencyKey: "private-unpaid-foundation-0001",
      integrationId: approved.integration.integrationId,
      projectId: project.projectId,
      requestProfile: {
        id: profile.profileId,
        version: profile.version,
        hash: profile.profileHash as `sha256:${string}`,
      },
      cohortId,
      dataClassification: "confidential",
      source: { contentType: "text/plain", bytesBase64: Buffer.from("private source").toString("base64") },
      suggestion: {
        contentType: "text/plain",
        bytesBase64: Buffer.from("private suggestion").toString("base64"),
      },
    },
    now: foundationNow,
  });
  const artifacts = await dbClient.execute({
    sql: `SELECT source.digest AS source_digest,suggestion.digest AS suggestion_digest
          FROM tokenless_private_review_requests r
          JOIN tokenless_assurance_artifacts source ON source.artifact_id=r.source_artifact_id
          JOIN tokenless_assurance_artifacts suggestion ON suggestion.artifact_id=r.suggestion_artifact_id
          WHERE r.private_review_id=?`,
    args: [prepared.privateReviewId],
  });
  assert.notEqual(artifacts.rows[0]?.source_digest, externalContentCommitments.sourceEvidenceHash);
  assert.notEqual(artifacts.rows[0]?.suggestion_digest, externalContentCommitments.suggestionCommitment);
  const opportunityCommitments =
    commitmentMode === "external"
      ? externalContentCommitments
      : {
          sourceEvidenceHash: String(artifacts.rows[0]?.source_digest),
          suggestionCommitment: String(artifacts.rows[0]?.suggestion_digest),
        };
  const scopeId = "aesc_private_unpaid_adapter";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,
           risk_tier,audience_policy_hash,partition_commitment,execution_profile_hash,
           execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,
           completed_comparable_cases,stable_cases_since_stage,unreviewed_since_last_sample,
           stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'private-review','normal',?,?,?,'{}',?,1,?,1,?,'calibrating',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.reviewPolicyId,
      hash("private-audience"),
      hash("private-partition"),
      hash("private-execution-profile"),
      bindingId,
      profile.profileId,
      profile.profileHash,
      foundationNow,
      foundationNow,
    ],
  });
  const opportunityId = "arop_private_unpaid_adapter";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
           external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
           metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,
           sample_bucket,sampler_key_version,sampler_commitment,reason_codes_json,status,
           source_evidence_reference,source_evidence_hash,human_review_binding_id,
           human_review_binding_version,request_profile_id,request_profile_version,
           request_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,'private-output-1',?,9000,?,true,false,'required',10000,10000,1,
                  'private-test-v1',?,'["private_review_required"]','decided','private/source',?,
                  ?,1,?,1,?,?,?)`,
    args: [
      opportunityId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      scopeId,
      approved.integration.reviewPolicyId,
      opportunityCommitments.suggestionCommitment,
      hash("private-metadata"),
      hash("private-sampler"),
      opportunityCommitments.sourceEvidenceHash,
      bindingId,
      profile.profileId,
      profile.profileHash,
      foundationNow,
      foundationNow,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,
           terminal_at,created_at,updated_at)
          VALUES (?,?,'request_ready',1,'["private_lane_ready"]',?,NULL,?,?)`,
    args: [workspaceId, opportunityId, foundationNow, foundationNow, foundationNow],
  });
  return {
    prepared,
    principal: integrated.principal,
    opportunityId,
    workspaceId,
    projectId: project.projectId,
    cohortId,
    groupId: group.groupId,
    externalContentCommitments: opportunityCommitments,
    expertiseDefinition,
  };
}

test("reserves exact named private members idempotently without public or paid side effects", async () => {
  const setup = await fixture();
  const now = new Date("2026-07-16T09:20:00.000Z");
  const first = await requestPrivateUnpaidHumanReview({
    principal: setup.principal,
    opportunityId: setup.opportunityId,
    privateReviewId: setup.prepared.privateReviewId,
    reviewerAccountAddresses: [REVIEWER_B, REVIEWER_A],
    now,
  });
  const replay = await requestPrivateUnpaidHumanReview({
    principal: setup.principal,
    opportunityId: setup.opportunityId,
    privateReviewId: setup.prepared.privateReviewId,
    reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
    now,
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.deliveryId, first.deliveryId);
  assert.deepEqual(
    first.assignments.map(value => value.reviewerAccountAddress),
    [REVIEWER_A, REVIEWER_B],
  );
  assert.equal(first.responseDeadline, "2026-07-16T10:00:00.000Z");
  assert.ok(first.assignments.every(value => value.reservationExpiresAt === "2026-07-16T09:35:00.000Z"));
  const state = await dbClient.execute({
    sql: `SELECT l.state,l.state_revision,o.status
          FROM tokenless_agent_review_opportunity_lifecycles l
          JOIN tokenless_agent_review_opportunities o
            ON o.workspace_id=l.workspace_id AND o.opportunity_id=l.opportunity_id
          WHERE l.workspace_id=? AND l.opportunity_id=?`,
    args: [setup.workspaceId, setup.opportunityId],
  });
  assert.deepEqual(state.rows[0], {
    state: "pending",
    state_revision: 2,
    status: "review_requested",
  });
  for (const table of [
    "tokenless_agent_review_opportunity_transition_events",
    "tokenless_agent_asks",
    "tokenless_prepaid_reservations",
    "tokenless_payment_intents",
    "tokenless_paid_vouchers",
    "tokenless_assurance_assignments",
  ]) {
    const count = await dbClient.execute(`SELECT COUNT(*) AS count FROM ${table}`);
    assert.equal(Number(count.rows[0]?.count), table.endsWith("transition_events") ? 1 : 0);
  }
  const snapshots = await dbClient.execute(
    `SELECT COUNT(DISTINCT membership_snapshot_hash) AS snapshots,
            MIN(snapshot_cutoff_at) AS cutoff,MAX(reservation_expires_at) AS reservation_deadline,
            MAX(response_deadline) AS response_deadline
     FROM tokenless_private_unpaid_review_assignments`,
  );
  assert.equal(Number(snapshots.rows[0]?.snapshots), 2);
  assert.equal(new Date(String(snapshots.rows[0]?.cutoff)).toISOString(), now.toISOString());
  assert.equal(new Date(String(snapshots.rows[0]?.reservation_deadline)).toISOString(), "2026-07-16T09:35:00.000Z");
  assert.equal(new Date(String(snapshots.rows[0]?.response_deadline)).toISOString(), first.responseDeadline);
});

test("external evidence and vault artifact commitments fail closed independently", async () => {
  const setup = await fixture();
  const now = new Date("2026-07-16T09:20:00.000Z");
  const assign = () =>
    requestPrivateUnpaidHumanReview({
      principal: setup.principal,
      opportunityId: setup.opportunityId,
      privateReviewId: setup.prepared.privateReviewId,
      reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
      now,
    });
  await dbClient.execute({
    sql: `UPDATE tokenless_private_review_requests SET external_suggestion_commitment=NULL
          WHERE private_review_id=?`,
    args: [setup.prepared.privateReviewId],
  });
  await assert.rejects(
    assign,
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "private_unpaid_review_binding_conflict",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_private_review_requests SET external_suggestion_commitment=?
          WHERE private_review_id=?`,
    args: [setup.externalContentCommitments.suggestionCommitment, setup.prepared.privateReviewId],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_review_opportunities SET source_evidence_hash=? WHERE opportunity_id=?",
    args: [hash("different-external-source"), setup.opportunityId],
  });
  await assert.rejects(
    assign,
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "private_unpaid_review_binding_conflict",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_review_opportunities SET source_evidence_hash=? WHERE opportunity_id=?",
    args: [setup.externalContentCommitments.sourceEvidenceHash, setup.opportunityId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_artifacts SET digest=?
          WHERE artifact_id=(SELECT source_artifact_id FROM tokenless_private_review_requests WHERE private_review_id=?)`,
    args: [hash("different-vault-source"), setup.prepared.privateReviewId],
  });
  await assert.rejects(
    assign,
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "private_unpaid_review_binding_conflict",
  );
});

test("pre-0116 foundations retain their exact artifact-equals-opportunity assignment path", async () => {
  const setup = await fixture([], null, "legacy");
  const stored = await dbClient.execute({
    sql: `SELECT external_source_evidence_hash,external_suggestion_commitment
          FROM tokenless_private_review_requests WHERE private_review_id=?`,
    args: [setup.prepared.privateReviewId],
  });
  assert.deepEqual(stored.rows[0], {
    external_source_evidence_hash: null,
    external_suggestion_commitment: null,
  });
  const assigned = await requestPrivateUnpaidHumanReview({
    principal: setup.principal,
    opportunityId: setup.opportunityId,
    privateReviewId: setup.prepared.privateReviewId,
    reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
    now: new Date("2026-07-16T09:20:00.000Z"),
  });
  assert.equal(assigned.assignments.length, 2);
});

test("profile expertise requirements fail closed through private assignment until every named seat qualifies", async () => {
  const setup = await fixture(["code-review:typescript"]);
  const assignment = () =>
    requestPrivateUnpaidHumanReview({
      principal: setup.principal,
      opportunityId: setup.opportunityId,
      privateReviewId: setup.prepared.privateReviewId,
      reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
      now: new Date("2026-07-16T09:20:00.000Z"),
    });
  await assert.rejects(assignment, /not an active eligible member/u);
  await attestInvitedReviewerExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    projectId: setup.projectId,
    cohortId: setup.cohortId,
    reviewerAccountAddress: REVIEWER_A,
    expertiseKeys: ["code-review:typescript"],
    expiresAt: "2026-07-17T10:00:00.000Z",
    now: new Date("2026-07-16T09:10:00.000Z"),
  });
  await assert.rejects(assignment, /not an active eligible member/u);
  await attestInvitedReviewerExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    projectId: setup.projectId,
    cohortId: setup.cohortId,
    reviewerAccountAddress: REVIEWER_B,
    expertiseKeys: ["code-review:typescript"],
    expiresAt: "2026-07-17T10:00:00.000Z",
    now: new Date("2026-07-16T09:10:00.000Z"),
  });
  const delivered = await assignment();
  assert.equal(delivered.assignments.length, 2);
  const qualifications = await dbClient.execute({
    sql: `SELECT reviewer_account_address,status FROM tokenless_reviewer_qualifications
          WHERE workspace_id=? AND qualification_kind='expertise' ORDER BY reviewer_account_address`,
    args: [setup.workspaceId],
  });
  assert.deepEqual(
    qualifications.rows.map(value => ({
      reviewer_account_address: value.reviewer_account_address,
      status: value.status,
    })),
    [
      { reviewer_account_address: REVIEWER_A, status: "active" },
      { reviewer_account_address: REVIEWER_B, status: "active" },
    ],
  );
});

test("exact specialist coverage is revalidated collectively through the response deadline", async () => {
  const setup = await fixture([], 1);
  const assignment = () =>
    requestPrivateUnpaidHumanReview({
      principal: setup.principal,
      opportunityId: setup.opportunityId,
      privateReviewId: setup.prepared.privateReviewId,
      reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
      now: new Date("2026-07-16T09:20:00.000Z"),
    });
  await assert.rejects(assignment, /no longer covers every specialist requirement/u);
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    groupId: setup.groupId,
    reviewerAccountAddress: REVIEWER_A,
    definitions: [
      {
        definitionId: setup.expertiseDefinition!.definitionId,
        definitionVersion: setup.expertiseDefinition!.version,
        definitionHash: setup.expertiseDefinition!.hash,
      },
    ],
    expiresAt: "2026-07-17T10:00:00.000Z",
    now: new Date("2026-07-16T09:10:00.000Z"),
  });
  const delivered = await assignment();
  assert.equal(delivered.assignments.length, 2);
  const evidence = await dbClient.execute({
    sql: `SELECT qualification_snapshot_json FROM tokenless_private_unpaid_review_assignments
          WHERE reviewer_account_address=? LIMIT 1`,
    args: [REVIEWER_A],
  });
  assert.match(String(evidence.rows[0]?.qualification_snapshot_json), /exact_expertise/u);
  assert.match(
    String(evidence.rows[0]?.qualification_snapshot_json),
    new RegExp(setup.expertiseDefinition!.definitionId, "u"),
  );
});

test("fails closed when the private project drifts after its foundation is frozen", async () => {
  const setup = await fixture();
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_projects SET retention_days = retention_days + 1 WHERE project_id = ?",
    args: [setup.projectId],
  });
  await assert.rejects(
    () =>
      requestPrivateUnpaidHumanReview({
        principal: setup.principal,
        opportunityId: setup.opportunityId,
        privateReviewId: setup.prepared.privateReviewId,
        reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
        now: new Date("2026-07-16T09:20:00.000Z"),
      }),
    /no longer matches its exact opportunity, profile, group, or cohort/u,
  );
});

test("fails closed when frozen cohort rules drift before assignment", async () => {
  const setup = await fixture();
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_cohorts SET qualification_rules_json = ? WHERE project_id = ? AND cohort_id = ?",
    args: ['[{"key":"security-review"}]', setup.projectId, setup.cohortId],
  });
  await assert.rejects(
    () =>
      requestPrivateUnpaidHumanReview({
        principal: setup.principal,
        opportunityId: setup.opportunityId,
        privateReviewId: setup.prepared.privateReviewId,
        reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
        now: new Date("2026-07-16T09:20:00.000Z"),
      }),
    /no longer matches its exact opportunity, profile, group, or cohort/u,
  );
});

test("requires membership and qualifications to remain valid through the response deadline", async () => {
  const setup = await fixture();
  const expiresBeforeDeadline = new Date("2026-07-16T09:50:00.000Z");
  await dbClient.execute({
    sql: `UPDATE tokenless_private_group_memberships
          SET membership_expires_at = ? WHERE group_id = ? AND principal_address = ?`,
    args: [expiresBeforeDeadline, setup.prepared.bindings.privateGroup.groupId, REVIEWER_A],
  });
  await assert.rejects(
    () =>
      requestPrivateUnpaidHumanReview({
        principal: setup.principal,
        opportunityId: setup.opportunityId,
        privateReviewId: setup.prepared.privateReviewId,
        reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
        now: new Date("2026-07-16T09:20:00.000Z"),
      }),
    /not an active eligible member/u,
  );

  await dbClient.execute({
    sql: `UPDATE tokenless_private_group_memberships
          SET membership_expires_at = NULL WHERE group_id = ? AND principal_address = ?`,
    args: [setup.prepared.bindings.privateGroup.groupId, REVIEWER_A],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohort_reviewers
          SET qualification_expires_at = ? WHERE project_id = ? AND cohort_id = ?
            AND reviewer_account_address = ?`,
    args: [expiresBeforeDeadline, setup.projectId, setup.cohortId, REVIEWER_A],
  });
  await assert.rejects(
    () =>
      requestPrivateUnpaidHumanReview({
        principal: setup.principal,
        opportunityId: setup.opportunityId,
        privateReviewId: setup.prepared.privateReviewId,
        reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
        now: new Date("2026-07-16T09:20:00.000Z"),
      }),
    /not an active eligible member/u,
  );
});

test("transaction crashes replay safely and accepted assignments and leases stop at the frozen deadline", async () => {
  const setup = await fixture();
  const now = new Date("2026-07-16T09:45:00.000Z");
  __privateUnpaidReviewAdapterTestUtils.setBeforeDeliveryCommitForTests(async () => {
    throw new Error("simulated delivery crash");
  });
  await assert.rejects(
    () =>
      requestPrivateUnpaidHumanReview({
        principal: setup.principal,
        opportunityId: setup.opportunityId,
        privateReviewId: setup.prepared.privateReviewId,
        reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
        now,
      }),
    /simulated delivery crash/u,
  );
  const interruptedDeliveries = await dbClient.execute(
    "SELECT COUNT(*) AS count FROM tokenless_private_unpaid_review_deliveries",
  );
  const interruptedAssignments = await dbClient.execute(
    "SELECT COUNT(*) AS count FROM tokenless_private_unpaid_review_assignments",
  );
  const interruptedLifecycle = await dbClient.execute({
    sql: `SELECT state FROM tokenless_agent_review_opportunity_lifecycles
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [setup.workspaceId, setup.opportunityId],
  });
  // pg-mem does not emulate PostgreSQL rollback. The retained preparation rows
  // deliberately exercise the adapter's durable reconciliation path.
  assert.equal(Number(interruptedDeliveries.rows[0]?.count), 1);
  assert.equal(Number(interruptedAssignments.rows[0]?.count), 2);
  assert.equal(interruptedLifecycle.rows[0]?.state, "request_ready");
  __privateUnpaidReviewAdapterTestUtils.setBeforeDeliveryCommitForTests(null);
  const recovered = await requestPrivateUnpaidHumanReview({
    principal: setup.principal,
    opportunityId: setup.opportunityId,
    privateReviewId: setup.prepared.privateReviewId,
    reviewerAccountAddresses: [REVIEWER_A, REVIEWER_B],
    now,
  });
  const assignmentId = recovered.assignments[0]!.assignmentId;
  const acceptAt = new Date("2026-07-16T09:55:00.000Z");
  let leaseAttempts = 0;
  __privateUnpaidReviewAdapterTestUtils.setBeforeLeaseCommitForTests(async () => {
    leaseAttempts += 1;
    if (leaseAttempts === 1) throw new Error("simulated lease crash");
  });
  await assert.rejects(
    () =>
      acceptPrivateUnpaidReviewAssignment({
        assignmentId,
        reviewerAccountAddress: REVIEWER_A,
        now: acceptAt,
      }),
    /simulated lease crash/u,
  );
  const rolledBack = await dbClient.execute({
    sql: `SELECT status,accepted_at,assignment_expires_at
          FROM tokenless_private_unpaid_review_assignments WHERE assignment_id=?`,
    args: [assignmentId],
  });
  const interruptedLeases = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_artifact_leases WHERE assignment_id=?",
    args: [assignmentId],
  });
  assert.equal(rolledBack.rows[0]?.status, "accepted");
  assert.equal(new Date(String(rolledBack.rows[0]?.assignment_expires_at)).toISOString(), recovered.responseDeadline);
  assert.equal(Number(interruptedLeases.rows[0]?.count), 1);
  __privateUnpaidReviewAdapterTestUtils.setBeforeLeaseCommitForTests(null);
  const accepted = await acceptPrivateUnpaidReviewAssignment({
    assignmentId,
    reviewerAccountAddress: REVIEWER_A,
    now: acceptAt,
  });
  assert.equal(accepted.replayed, true);
  assert.equal(accepted.assignmentExpiresAt, recovered.responseDeadline);
  assert.equal(accepted.leases.length, 2);
  assert.ok(accepted.leases.every(value => value.expiresAt === recovered.responseDeadline));
  const replay = await acceptPrivateUnpaidReviewAssignment({
    assignmentId,
    reviewerAccountAddress: REVIEWER_A,
    now: new Date("2026-07-16T09:56:00.000Z"),
  });
  assert.equal(replay.replayed, true);
  assert.ok(replay.leases.every(value => value.expiresAt === recovered.responseDeadline));
  const leases = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count,MAX(expires_at) AS maximum_expiry
          FROM tokenless_assurance_artifact_leases WHERE assignment_id=?`,
    args: [assignmentId],
  });
  assert.equal(Number(leases.rows[0]?.count), 2);
  assert.equal(new Date(String(leases.rows[0]?.maximum_expiry)).toISOString(), recovered.responseDeadline);
});

import { HUMAN_ASSURANCE_SCHEMA_VERSION, type HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { type PrivateArtifactStore, __setArtifactPrivacyRuntimeForTests } from "~~/lib/tokenless/artifactPrivacy";
import {
  type CohortSource,
  type QualificationProvenance,
  acceptAudienceAssignment,
  createProjectCohort,
  createReviewerInvitation,
  expireAudienceAssignments,
  getAssignmentOnlyTask,
  prepareRunAudience,
  recoverExpiredAudienceAssignment,
  redeemReviewerInvitationWithBaseAccount,
  registerProjectCohortReviewer,
  reserveAudienceAssignment,
} from "~~/lib/tokenless/audienceAssignments";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const SECOND_REVIEWER = "0x3333333333333333333333333333333333333333";
const OTHER_OWNER = "0x4444444444444444444444444444444444444444";
const TERMS_HASH = `sha256:${"c".repeat(64)}`;
const POLICY_HASH = `sha256:${"d".repeat(64)}`;
const RUN_HASH = `sha256:${"e".repeat(64)}`;

class MemoryPrivateStore implements PrivateArtifactStore {
  async delete() {}

  async get(): Promise<Uint8Array> {
    throw new Error("not used by audience assignment tests");
  }

  async put(pathname: string) {
    return `memory://${pathname}`;
  }
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setArtifactPrivacyRuntimeForTests({
    keyVersion: "artifact-test-v1",
    masterKey: Buffer.alloc(32, 9),
    store: new MemoryPrivateStore(),
  });
});

afterEach(() => {
  __setArtifactPrivacyRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

function qualification(
  key: string,
  value: QualificationProvenance["value"],
  now = new Date(),
): QualificationProvenance {
  return {
    key,
    value,
    source: "customer_attestation",
    assertedBy: OWNER,
    verifiedAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
  };
}

type CohortFixture = {
  cohortId: string;
  minimumReviewers?: number;
  maximumReviewers?: number;
  source: CohortSource;
};

function audiencePolicy(
  cohorts: CohortFixture[],
  input: Partial<
    Pick<
      HumanAssuranceAudiencePolicy,
      "reviewerSource" | "selection" | "compensation" | "requiredQualifications" | "legalEligibilityRequired"
    >
  > = {},
): HumanAssuranceAudiencePolicy {
  const compensation = input.compensation ?? "unpaid";
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_fixture",
    version: 1,
    reviewerSource: input.reviewerSource ?? cohorts[0]!.source,
    compensation,
    cohorts: cohorts.map(cohort => ({
      cohortId: cohort.cohortId,
      minimumReviewers: cohort.minimumReviewers ?? 1,
      maximumReviewers: cohort.maximumReviewers ?? 1,
    })),
    selection: input.selection ?? "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: input.requiredQualifications ?? [],
    assurance: { requiredCapabilities: [], allowedProviders: [] },
    buyerPrivacy: {
      visibleFields: ["reviewer_source", "qualification_summary"],
      minimumAggregationSize: 2,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: input.legalEligibilityRequired ?? compensation !== "unpaid",
  };
}

async function seedProject(owner = OWNER, label = "primary") {
  const { workspaceId } = await createWorkspace({ name: `${label} workspace`, ownerAddress: owner });
  const projectId = `project_${label}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'confidential', 'active', 30, ?, ?, ?)`,
    args: [projectId, workspaceId, `${label} assurance`, owner.toLowerCase(), now, now],
  });
  return { workspaceId, projectId };
}

async function seedRun(project: { workspaceId: string; projectId: string }, policy: HumanAssuranceAudiencePolicy) {
  const now = new Date();
  const rubricId = `rubric_${project.projectId}`;
  const suiteId = `suite_${project.projectId}`;
  const caseId = `case_${project.projectId}`;
  const runId = `run_${project.projectId}`;
  const policyId = `${policy.policyId}_${project.projectId}`;
  const artifactIds = [`artifact_${project.projectId}_a`, `artifact_${project.projectId}_b`];

  for (const [index, artifactId] of artifactIds.entries()) {
    const role = index === 0 ? "baseline" : "candidate";
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_artifacts
            (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
             redaction_status, renderer_policy, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'text/plain', 10, ?, 'approved', 'plain_text', ?, ?)`,
      args: [
        artifactId,
        project.projectId,
        role,
        `Option ${index + 1}`,
        `sha256:${String(index + 1).repeat(64)}`,
        `memory://${artifactId}`,
        now,
        now,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_artifact_objects
            (object_id, artifact_id, workspace_id, project_id, storage_provider, storage_ref, key_domain,
             key_version, content_nonce, content_auth_tag, wrapped_data_key, wrap_nonce, wrap_auth_tag,
             status, delete_after, created_at)
            VALUES (?, ?, ?, ?, 'test', ?, 'customer_artifact', 'artifact-test-v1',
                    'nonce', 'tag', 'key', 'wrap-nonce', 'wrap-tag', 'active', ?, ?)`,
      args: [
        `object_${artifactId}`,
        artifactId,
        project.workspaceId,
        project.projectId,
        `memory://${artifactId}`,
        new Date(now.getTime() + 86_400_000),
        now,
      ],
    });
  }

  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json,
           pass_rule_json, rubric_json, created_at)
          VALUES (?, ?, 1, 'Select the better answer', '[]', '{}', '{}', '{}', ?)`,
    args: [rubricId, project.projectId, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id, project_id, name, version, status, rubric_id, rubric_version, manifest_hash,
           manifest_json, frozen_at, created_at, updated_at)
          VALUES (?, ?, 'Release gate', 1, 'frozen', ?, 1, ?, '{}', ?, ?, ?)`,
    args: [suiteId, project.projectId, rubricId, `sha256:${"f".repeat(64)}`, now, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cases
          (case_id, project_id, suite_id, suite_version, position, title, instructions,
           baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json,
           objective_reference, status, created_at, updated_at)
          VALUES (?, ?, ?, 1, 0, 'Support response', 'Compare the blinded responses.', ?, ?, '[]',
                  'ticket-42', 'ready', ?, ?)`,
    args: [caseId, project.projectId, suiteId, artifactIds[0], artifactIds[1], now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id, project_id, version, reviewer_source, compensation, cohorts_json, selection,
           fallbacks_json, required_qualifications_json, assurance_json, buyer_privacy_json,
           legal_eligibility_required, policy_hash, policy_json, created_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      policyId,
      project.projectId,
      policy.reviewerSource,
      policy.compensation,
      JSON.stringify(policy.cohorts),
      policy.selection,
      JSON.stringify(policy.fallbacks),
      JSON.stringify(policy.requiredQualifications),
      JSON.stringify(policy.assurance),
      JSON.stringify(policy.buyerPrivacy),
      policy.legalEligibilityRequired,
      POLICY_HASH,
      JSON.stringify({ ...policy, policyId }),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id, project_id, suite_id, suite_version, audience_policy_id, audience_policy_version,
           status, policy_hash, manifest_hash, manifest_json, created_by, created_at, updated_at, frozen_at)
          VALUES (?, ?, ?, 1, ?, 1, 'frozen', ?, ?, '{}', ?, ?, ?, ?)`,
    args: [runId, project.projectId, suiteId, policyId, POLICY_HASH, RUN_HASH, OWNER, now, now, now],
  });
  return { runId, caseId, artifactIds };
}

async function seedPaidEligibility(accountAddress = REVIEWER, now = new Date()) {
  const raterId = `rater_${accountAddress.slice(2, 10)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id, account_address, nullifier_seed_ciphertext,
           nullifier_key_version, created_at, updated_at)
          VALUES (?, ?, 'ciphertext', 'v1', ?, ?)`,
    args: [raterId, accountAddress.toLowerCase(), now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_capability_eligibility
          (rater_id, provider_id, provider_assertion_hash, provider_assertion_id_hash,
           provider_subject_hash, capabilities_json, provider_evidence_ciphertext,
           provider_evidence_key_version, provider_evidence_key_domain, evidence_verified_at,
           evidence_expires_at, minimum_age_verified, declared_residence_country,
           tax_residence_country, residence_tax_status, tax_profile_status, dac7_status,
           sanctions_consent_at, sanctions_status, sanctions_reference_hash, sanctions_screened_at,
           sanctions_expires_at, payout_account, payout_ownership_method, payout_verified_at,
           reviewer_source, cohort_ids_json, qualification_keys_json, eligibility_status,
           created_at, updated_at)
          VALUES (?, 'test-provider', ?, ?, ?, '["account_control","minimum_age"]', 'ciphertext',
                  'v1', 'provider_evidence', ?, ?, 18, 'DE', 'DE', 'declared_only', 'complete',
                  'not_required', ?, 'clear', ?, ?, ?, ?, 'siwe_base_account_session', ?,
                  'rateloop_network', '[]', '[]', 'eligible', ?, ?)`,
    args: [
      raterId,
      `assertion_${raterId}`,
      `assertion_id_${raterId}`,
      `subject_${raterId}`,
      now,
      new Date(now.getTime() + 86_400_000),
      now,
      `sanctions_${raterId}`,
      now,
      new Date(now.getTime() + 86_400_000),
      accountAddress.toLowerCase(),
      now,
      now,
      now,
    ],
  });
  return raterId;
}

async function createCohort(
  project: { workspaceId: string; projectId: string },
  input: {
    source: CohortSource;
    selection?: "customer_named" | "randomized";
    capacity?: number;
    qualificationRules?: HumanAssuranceAudiencePolicy["requiredQualifications"];
  },
) {
  return createProjectCohort({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    name: `${input.source} reviewers`,
    source: input.source,
    selection: input.selection ?? "randomized",
    capacity: input.capacity ?? 5,
    qualificationRules: input.qualificationRules,
  });
}

test("one-time invitations store only token hashes and bind redemption to the intended Base Account", async () => {
  const project = await seedProject();
  const otherProject = await seedProject(OTHER_OWNER, "other");
  const cohort = await createCohort(project, { source: "customer_invited", selection: "customer_named" });
  const now = new Date();
  const invitation = await createReviewerInvitation({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    cohortId: cohort.cohortId,
    intendedAccountAddress: REVIEWER,
    qualificationProvenance: [qualification("support_experience", true, now)],
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  const stored = await dbClient.execute({
    sql: `SELECT token_hash, qualification_provenance_json
          FROM tokenless_assurance_reviewer_invitations WHERE invitation_id = ?`,
    args: [invitation.invitationId],
  });
  assert.match(String(stored.rows[0]?.token_hash), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(stored.rows), new RegExp(invitation.token));

  await assert.rejects(
    () => redeemReviewerInvitationWithBaseAccount({ token: invitation.token, baseAccountAddress: SECOND_REVIEWER }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invite_account_mismatch",
  );
  const redeemed = await redeemReviewerInvitationWithBaseAccount({
    token: invitation.token,
    baseAccountAddress: REVIEWER,
  });
  assert.equal(redeemed.reviewerAccountAddress, REVIEWER.toLowerCase());
  await assert.rejects(
    () => redeemReviewerInvitationWithBaseAccount({ token: invitation.token, baseAccountAddress: REVIEWER }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invite_unavailable",
  );

  const reviewer = await dbClient.execute({
    sql: `SELECT qualification_provenance_json FROM tokenless_assurance_cohort_reviewers
          WHERE project_id = ? AND cohort_id = ? AND reviewer_account_address = ?`,
    args: [project.projectId, cohort.cohortId, REVIEWER.toLowerCase()],
  });
  assert.deepEqual(
    JSON.parse(String(reviewer.rows[0]?.qualification_provenance_json)).map(
      (value: QualificationProvenance) => value.key,
    ),
    ["customer_invitation", "support_experience"],
  );
  await assert.rejects(
    () =>
      createReviewerInvitation({
        accountAddress: OTHER_OWNER,
        workspaceId: otherProject.workspaceId,
        projectId: project.projectId,
        cohortId: cohort.cohortId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "project_not_found",
  );
});

test("hybrid policies create separate source subpanels and reject ambiguous source-selection combinations", async () => {
  const project = await seedProject();
  const invited = await createCohort(project, { source: "customer_invited" });
  const network = await createCohort(project, { source: "rateloop_network" });
  const policy = audiencePolicy(
    [
      { ...invited, source: "customer_invited", maximumReviewers: 2 },
      { ...network, source: "rateloop_network", maximumReviewers: 3 },
    ],
    { reviewerSource: "hybrid", selection: "randomized", compensation: "mixed" },
  );
  const { runId } = await seedRun(project, policy);
  const subpanels = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId,
  });
  assert.deepEqual(subpanels.map(value => value.source).sort(), ["customer_invited", "rateloop_network"]);
  assert.equal(
    subpanels.some(value => value.source === "hybrid"),
    false,
  );
  assert.deepEqual(
    await prepareRunAudience({
      accountAddress: OWNER,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      runId,
    }),
    subpanels,
  );

  await assert.rejects(
    () => createCohort(project, { source: "rateloop_network", selection: "customer_named" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_audience_selection",
  );

  const sandboxProject = await seedProject(OWNER, "sandbox");
  const sandbox = await createCohort(sandboxProject, { source: "sandbox" });
  const sandboxPolicy = audiencePolicy([{ ...sandbox, source: "sandbox" }], {
    reviewerSource: "sandbox",
    compensation: "paid",
  });
  const sandboxRun = await seedRun(sandboxProject, sandboxPolicy);
  await assert.rejects(
    () =>
      prepareRunAudience({
        accountAddress: OWNER,
        workspaceId: sandboxProject.workspaceId,
        projectId: sandboxProject.projectId,
        runId: sandboxRun.runId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_sandbox_compensation",
  );
});

test("paid randomized reservations require qualification and eligibility before capacity is consumed", async () => {
  const project = await seedProject();
  const now = new Date();
  const cohort = await createCohort(project, {
    source: "rateloop_network",
    capacity: 1,
    qualificationRules: [{ key: "support_years", operator: "at_least", value: 3 }],
  });
  await registerProjectCohortReviewer({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    cohortId: cohort.cohortId,
    reviewerAccountAddress: REVIEWER,
    qualificationProvenance: [qualification("support_years", 5, now)],
  });
  const policy = audiencePolicy([{ ...cohort, source: "rateloop_network" }], {
    reviewerSource: "rateloop_network",
    compensation: "paid",
    requiredQualifications: [{ key: "support_years", operator: "at_least", value: 4 }],
  });
  const { runId } = await seedRun(project, policy);
  const [subpanel] = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId,
  });
  assert.ok(subpanel?.subpanelId);

  await assert.rejects(
    () =>
      reserveAudienceAssignment({
        accountAddress: OWNER,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        runId,
        subpanelId: subpanel!.subpanelId!,
        confidentialityTermsHash: TERMS_HASH,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_capacity_unavailable",
  );
  assert.equal(
    Number(
      (await dbClient.execute("SELECT active_reservations FROM tokenless_assurance_cohorts")).rows[0]
        ?.active_reservations,
    ),
    0,
  );

  await seedPaidEligibility(REVIEWER, now);
  const reserved = await reserveAudienceAssignment({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId,
    subpanelId: subpanel!.subpanelId!,
    confidentialityTermsHash: TERMS_HASH,
    reservationTtlMs: 60_000,
    now,
  });
  assert.equal(reserved.paidAssignment, true);
  const paidMarker = await dbClient.execute({
    sql: `SELECT paid_eligibility_checked_at, voucher_marker
          FROM tokenless_assurance_assignments WHERE assignment_id = ?`,
    args: [reserved.assignmentId],
  });
  assert.ok(paidMarker.rows[0]?.paid_eligibility_checked_at);
  assert.equal(paidMarker.rows[0]?.voucher_marker, null);
  await assert.rejects(
    () =>
      reserveAudienceAssignment({
        accountAddress: OWNER,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        runId,
        subpanelId: subpanel!.subpanelId!,
        confidentialityTermsHash: TERMS_HASH,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "audience_capacity_exhausted",
  );

  assert.deepEqual(await expireAudienceAssignments(new Date(now.getTime() + 60_001)), { expired: 1 });
  const recovered = await recoverExpiredAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    now: new Date(now.getTime() + 60_002),
  });
  assert.equal(recovered.assignmentId, reserved.assignmentId);
  const recovery = await dbClient.execute({
    sql: "SELECT status, recovery_count FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [reserved.assignmentId],
  });
  assert.equal(recovery.rows[0]?.status, "reserved");
  assert.equal(Number(recovery.rows[0]?.recovery_count), 1);

  await dbClient.execute({
    sql: "UPDATE tokenless_capability_eligibility SET eligibility_status = 'blocked' WHERE payout_account = ?",
    args: [REVIEWER.toLowerCase()],
  });
  await assert.rejects(
    () =>
      acceptAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: TERMS_HASH,
        now: new Date(now.getTime() + 60_003),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "paid_eligibility_required",
  );
  assert.equal(
    (
      await dbClient.execute({
        sql: "SELECT voucher_marker FROM tokenless_assurance_assignments WHERE assignment_id = ?",
        args: [reserved.assignmentId],
      })
    ).rows[0]?.voucher_marker,
    null,
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_capability_eligibility SET eligibility_status = 'eligible' WHERE payout_account = ?",
    args: [REVIEWER.toLowerCase()],
  });
  await acceptAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    confidentialityTermsHash: TERMS_HASH,
    now: new Date(now.getTime() + 60_004),
  });
  const voucher = await dbClient.execute({
    sql: "SELECT voucher_marker FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [reserved.assignmentId],
  });
  assert.match(String(voucher.rows[0]?.voucher_marker), /^eligibility:rater_/);
});

test("confidentiality acceptance unlocks only the assigned blinded task and short artifact leases", async () => {
  const project = await seedProject();
  const cohort = await createCohort(project, { source: "customer_invited", selection: "customer_named" });
  const now = new Date();
  const invite = await createReviewerInvitation({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    cohortId: cohort.cohortId,
    intendedAccountAddress: REVIEWER,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  await redeemReviewerInvitationWithBaseAccount({ token: invite.token, baseAccountAddress: REVIEWER, now });
  const policy = audiencePolicy([{ ...cohort, source: "customer_invited" }], {
    reviewerSource: "customer_invited",
    selection: "customer_named",
  });
  const seeded = await seedRun(project, policy);
  const [subpanel] = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
  });
  const reserved = await reserveAudienceAssignment({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
    subpanelId: subpanel!.subpanelId!,
    confidentialityTermsHash: TERMS_HASH,
    reviewerAccountAddress: REVIEWER,
    now,
  });
  assert.equal(
    Number(
      (await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_artifact_leases")).rows[0]?.count,
    ),
    0,
  );
  await assert.rejects(
    () => getAssignmentOnlyTask({ baseAccountAddress: REVIEWER, assignmentId: reserved.assignmentId, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_not_found",
  );
  await assert.rejects(
    () =>
      acceptAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: POLICY_HASH,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "confidentiality_terms_mismatch",
  );
  const accepted = await acceptAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    confidentialityTermsHash: TERMS_HASH,
    now,
  });
  assert.equal(accepted.leases.length, 2);
  assert.ok(accepted.leases.every(value => new Date(value.expiresAt).getTime() - now.getTime() === 600_000));

  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_responses
          (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
           failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
           response_digest, validity, submitted_at, updated_at)
          VALUES ('hidden_response', ?, ?, 'other_reviewer', 'rateloop_network', 'candidate',
                  '[]', '[]', '[]', ?, 'valid', ?, ?)`,
    args: [seeded.runId, seeded.caseId, `sha256:${"9".repeat(64)}`, now, now],
  });
  const task = await getAssignmentOnlyTask({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    now: new Date(now.getTime() + 1),
  });
  assert.equal(task.cases.length, 1);
  assert.deepEqual(new Set(task.cases[0]!.options.map(value => value.artifactId)), new Set(seeded.artifactIds));
  const serialized = JSON.stringify(task);
  assert.doesNotMatch(serialized, /hidden_response|other_reviewer|"choice"|"validity"/);
  await assert.rejects(
    () =>
      getAssignmentOnlyTask({
        baseAccountAddress: SECOND_REVIEWER,
        assignmentId: reserved.assignmentId,
        now: new Date(now.getTime() + 1),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_not_found",
  );
  const assignment = await dbClient.execute({
    sql: `SELECT confidentiality_accepted_at, voucher_marker, lease_state
          FROM tokenless_assurance_assignments WHERE assignment_id = ?`,
    args: [reserved.assignmentId],
  });
  assert.ok(assignment.rows[0]?.confidentiality_accepted_at);
  assert.equal(assignment.rows[0]?.voucher_marker, null);
  assert.equal(assignment.rows[0]?.lease_state, "issued");
});

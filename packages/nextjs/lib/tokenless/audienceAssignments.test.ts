import { HUMAN_ASSURANCE_SCHEMA_VERSION, type HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { type PrivateArtifactStore, __setArtifactPrivacyRuntimeForTests } from "~~/lib/tokenless/artifactPrivacy";
import {
  type CohortSource,
  type QualificationProvenance,
  __integrityAssignmentConcurrencyTestUtils,
  acceptAudienceAssignment,
  createProjectCohort,
  createReviewerInvitation,
  getAssignmentOnlyTask,
  listReviewerMemberships,
  prepareRunAudience,
  recoverExpiredAudienceAssignment,
  redeemReviewerInvitationWithBaseAccount,
  registerProjectCohortReviewer,
  reserveAudienceAssignment,
  reserveDiversifiedNetworkSubpanel,
} from "~~/lib/tokenless/audienceAssignments";
import {
  createPrivateGroup,
  createPrivateGroupInvitation,
  redeemPrivateGroupInvitation,
  removePrivateGroupMember,
} from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment } from "~~/lib/tokenless/projectAccess";
import { listReviewerAssignments } from "~~/lib/tokenless/reviewerAssignments";
import { attestInvitedReviewerExpertise } from "~~/lib/tokenless/reviewerExpertise";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const SECOND_REVIEWER = "0x3333333333333333333333333333333333333333";
const OTHER_OWNER = "0x4444444444444444444444444444444444444444";
const OPAQUE_REVIEWER = "rlp_audience_reviewer_principal_0001";
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

test("network assignment transactions lock the workspace before any selection query", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql.replace(/\s+/g, " ").trim());
      return { rowCount: sql === "BEGIN" ? null : 1, rows: [{ workspace_id: "ws_lock" }] };
    },
  } as unknown as PoolClient;
  await __integrityAssignmentConcurrencyTestUtils.beginIntegrityAssignmentTransaction(client, "ws_lock");
  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1]!, /FROM tokenless_workspaces .* FOR UPDATE$/);
  assert.equal(queries.length, 2);
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
  const reviewerSource = input.reviewerSource ?? cohorts[0]!.source;
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_fixture",
    version: 1,
    reviewerSource,
    compensation,
    cohorts: cohorts.map(cohort => ({
      cohortId: cohort.cohortId,
      minimumReviewers: cohort.minimumReviewers ?? 1,
      maximumReviewers: cohort.maximumReviewers ?? 1,
    })),
    selection: input.selection ?? "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: input.requiredQualifications ?? [],
    assurance: {
      requirements:
        reviewerSource === "rateloop_network" || reviewerSource === "hybrid"
          ? [
              {
                capability: "unique_human",
                reviewerSources: ["rateloop_network"],
                allowedProviders: ["world:poh"],
              },
            ]
          : [],
    },
    ...(reviewerSource === "rateloop_network" || reviewerSource === "hybrid"
      ? {
          integrity: {
            schemaVersion: "rateloop.integrity-assignment.v1" as const,
            epochId: "integrity:2026-07-13:001",
            epochManifestHash: `sha256:${"a".repeat(64)}` as const,
            maxClusterShareBps: 5_000,
            allowedRiskBands: ["low", "medium"] as Array<"low" | "medium">,
            recentCoassignmentWindowSeconds: 2_592_000,
            maxRecentCoassignments: 0,
            maxPerCustomer: 3,
            onePerProviderSubject: true as const,
          },
        }
      : {}),
    buyerPrivacy: {
      visibleFields: ["reviewer_source", "qualification_summary"],
      minimumAggregationSize: 2,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: input.legalEligibilityRequired ?? compensation !== "unpaid",
  };
}

async function seedIntegrityEpoch(now = new Date()) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_integrity_epochs
          (epoch_id, schema_version, cutoff_at, source_window_started_at, source_window_ended_at,
           private_features_expire_at, feature_spec_hash, parameter_hash, scorer_build_hash,
           private_leaf_root, aggregate_cluster_counts_json, eligible_reviewer_count,
           excluded_reviewer_count, manifest_hash, manifest_json, signature_algorithm,
           signer_key_id, signing_public_key, signature, lookup_key_version,
           pseudonym_key_version, vault_key_version, created_at)
          VALUES (?, 'rateloop-integrity-epoch-v1', ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, 0, ?, '{}',
                  'Ed25519', 'fixture', 'fixture', 'fixture', 'lookup-v1', 'pseudonym-v1', 'vault-v1', ?)`,
    args: [
      "integrity:2026-07-13:001",
      new Date(now.getTime() - 120_000),
      new Date(now.getTime() - 3_600_000),
      new Date(now.getTime() - 120_000),
      new Date(now.getTime() + 86_400_000),
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"a".repeat(64)}`,
      now,
    ],
  });
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
  await createProjectOwnerAssignment({
    accountAddress: owner,
    projectId,
    workspaceId,
  });
  return { workspaceId, projectId };
}

async function seedBrowserIdentity(address: string, label: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, thirdweb_user_id, auth_provider, primary_email, email_verified,
           email_domain, display_name, created_at, updated_at, last_login_at)
          VALUES (?, ?, 'email', ?, true, 'example.test', ?, ?, ?, ?)`,
    args: [address.toLowerCase(), `thirdweb-${label}`, `${label}@example.test`, label, now, now, now],
  });
}

async function seedRun(project: { workspaceId: string; projectId: string }, policy: HumanAssuranceAudiencePolicy) {
  const now = new Date();
  const rubricId = `rubric_${project.projectId}`;
  const suiteId = `suite_${project.projectId}`;
  const caseId = `case_${project.projectId}`;
  const runId = `run_${project.projectId}`;
  const policyId = `${policy.policyId}_${project.projectId}`;
  const artifactIds = [`artifact_${project.projectId}_a`, `artifact_${project.projectId}_b`];
  const rubric = {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    rubricId,
    projectId: project.projectId,
    version: 1,
    prompt: "Select the better answer",
    choices: ["baseline", "candidate", "tie"],
    failureTags: [{ key: "incorrect", label: "Incorrect" }],
    rationale: { mode: "required", minLength: 10, maxLength: 500 },
    passRule: {
      metric: "candidate_preference_share_bps",
      operator: "gte",
      thresholdBps: 6_000,
      minimumValidResponses: 1,
    },
  };
  const suiteManifest = JSON.stringify({ rubric });

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
          VALUES (?, ?, 1, 'Select the better answer', ?, ?, ?, ?, ?)`,
    args: [
      rubricId,
      project.projectId,
      JSON.stringify(rubric.failureTags),
      JSON.stringify(rubric.rationale),
      JSON.stringify(rubric.passRule),
      JSON.stringify(rubric),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id, project_id, name, version, status, rubric_id, rubric_version, manifest_hash,
           manifest_json, frozen_at, created_at, updated_at)
          VALUES (?, ?, 'Release gate', 1, 'frozen', ?, 1, ?, ?, ?, ?, ?)`,
    args: [suiteId, project.projectId, rubricId, `sha256:${"f".repeat(64)}`, suiteManifest, now, now, now],
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
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_cases
          (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
           blinding_commitment, blinding_secret_json, deterministic_checks_json,
           deterministic_checks_hash, deterministic_checks_status, content_id,
           admission_policy_hash, round_status, created_at, updated_at)
          VALUES (?, ?, 0, ?, ?, ?, '{}', '[]', ?, 'not_applicable', ?, ?, 'planned', ?, ?)`,
    args: [
      runId,
      caseId,
      artifactIds[0],
      artifactIds[1],
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      `0x${"3".repeat(64)}`,
      `0x${"4".repeat(64)}`,
      now,
      now,
    ],
  });
  return { runId, caseId, artifactIds };
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

test("one-time invitations store only token hashes and bind redemption to the intended browser principal", async () => {
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

test("reviewer invitations and membership lookup support Better Auth principals without a wallet", async () => {
  const project = await seedProject(OWNER, "opaque_reviewer");
  const cohort = await createCohort(project, { source: "customer_invited", selection: "customer_named" });
  await seedBrowserIdentity(OPAQUE_REVIEWER, "opaque-reviewer");
  const invitation = await createReviewerInvitation({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    cohortId: cohort.cohortId,
    intendedAccountAddress: OPAQUE_REVIEWER,
  });

  const redeemed = await redeemReviewerInvitationWithBaseAccount({
    token: invitation.token,
    baseAccountAddress: OPAQUE_REVIEWER,
  });
  assert.equal(redeemed.reviewerAccountAddress, OPAQUE_REVIEWER);

  const result = await listReviewerMemberships({ accountAddress: OPAQUE_REVIEWER });
  assert.equal(result.memberships.length, 1);
  assert.equal(result.memberships[0]?.projectId, project.projectId);
  assert.equal(result.memberships[0]?.cohortId, cohort.cohortId);
  assert.equal(result.invitations[0]?.invitationId, invitation.invitationId);
});

test("hybrid audiences freeze separate epoch-bound network and invited subpanels", async () => {
  const project = await seedProject();
  await seedIntegrityEpoch();
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
  assert.equal(subpanels.find(value => value.source === "customer_invited")?.integrity, undefined);
  assert.equal(
    subpanels.find(value => value.source === "rateloop_network")?.integrity?.manifestHash,
    `sha256:${"a".repeat(64)}`,
  );

  await assert.rejects(
    () => createCohort(project, { source: "rateloop_network", selection: "customer_named" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_audience_selection",
  );
});

test("paid network audiences require an exact epoch and stay closed before voucher/receipt-bound assignment", async () => {
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
  await assert.rejects(
    () =>
      prepareRunAudience({
        accountAddress: OWNER,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        runId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "integrity_epoch_unavailable",
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_run_subpanels")).rows[0]?.count),
    0,
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_assignments")).rows[0]?.count),
    0,
  );
  await seedIntegrityEpoch(now);
  const [subpanel] = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId,
  });
  assert.equal(subpanel?.integrity?.epochId, "integrity:2026-07-13:001");
  await assert.rejects(
    () =>
      reserveDiversifiedNetworkSubpanel({
        accountAddress: OWNER,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        runId,
        subpanelId: subpanel!.subpanelId!,
        confidentialityTermsHash: TERMS_HASH,
        now,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_assignment_settlement_unavailable",
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_assignments")).rows[0]?.count),
    0,
  );
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
  const secondCaseId = `case_${project.projectId}_opposite`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cases
          (case_id, project_id, suite_id, suite_version, position, title, instructions,
           baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json,
           objective_reference, status, deterministic_checks_json, created_at, updated_at)
          SELECT ?, project_id, suite_id, suite_version, 1, 'Second support response', instructions,
                 baseline_artifact_id, candidate_artifact_id, '[]', 'ticket-43', 'ready', '[]', created_at, updated_at
          FROM tokenless_assurance_cases WHERE case_id = ?`,
    args: [secondCaseId, seeded.caseId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_cases
          (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
           blinding_commitment, blinding_secret_json, deterministic_checks_json,
           deterministic_checks_hash, deterministic_checks_status, content_id,
           admission_policy_hash, round_status, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, '{}', '[]', ?, 'not_applicable', ?, ?, 'planned', ?, ?)`,
    args: [
      seeded.runId,
      secondCaseId,
      seeded.artifactIds[1],
      seeded.artifactIds[0],
      `sha256:${"5".repeat(64)}`,
      `sha256:${"6".repeat(64)}`,
      `0x${"7".repeat(64)}`,
      `0x${"4".repeat(64)}`,
      now,
      now,
    ],
  });
  const [subpanel] = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET policy_json = ? WHERE project_id = ?",
    args: [JSON.stringify({ ...policy, compensation: "paid", legalEligibilityRequired: true }), project.projectId],
  });
  await assert.rejects(
    () =>
      reserveAudienceAssignment({
        accountAddress: OWNER,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        runId: seeded.runId,
        subpanelId: subpanel!.subpanelId!,
        confidentialityTermsHash: TERMS_HASH,
        reviewerAccountAddress: REVIEWER,
        now,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_assignment_settlement_unavailable",
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_assignments")).rows[0]?.count),
    0,
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET policy_json = ? WHERE project_id = ?",
    args: [JSON.stringify(policy), project.projectId],
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
        confidentialityTermsAccepted: false,
        confidentialityTermsHash: TERMS_HASH,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "confidentiality_acceptance_required",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET policy_json = ? WHERE project_id = ?",
    args: [JSON.stringify({ ...policy, compensation: "paid", legalEligibilityRequired: true }), project.projectId],
  });
  await assert.rejects(
    () =>
      acceptAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsAccepted: true,
        confidentialityTermsHash: TERMS_HASH,
        now,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_assignment_settlement_unavailable",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET policy_json = ? WHERE project_id = ?",
    args: [JSON.stringify(policy), project.projectId],
  });
  await assert.rejects(
    () =>
      acceptAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsAccepted: true,
        confidentialityTermsHash: POLICY_HASH,
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "confidentiality_terms_mismatch",
  );
  const accepted = await acceptAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    confidentialityTermsAccepted: true,
    confidentialityTermsHash: TERMS_HASH,
    now,
  });
  assert.equal(accepted.leases.length, 2);
  assert.ok(accepted.leases.every(value => new Date(value.expiresAt).getTime() - now.getTime() === 600_000));
  const activeReplay = await recoverExpiredAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    confidentialityTermsHash: TERMS_HASH,
    now: new Date(now.getTime() + 1),
  });
  if (activeReplay.accepted !== true) assert.fail("accepted assignment recovery must return artifact leases");
  assert.deepEqual(
    activeReplay.leases.map(value => value.leaseId).sort(),
    accepted.leases.map(value => value.leaseId).sort(),
  );
  assert.equal(
    Number(
      (
        await dbClient.execute({
          sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs WHERE project_id = ? AND action = 'lease'",
          args: [project.projectId],
        })
      ).rows[0]?.count,
    ),
    accepted.leases.length,
  );

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
  assert.equal(task.cases.length, 2);
  assert.deepEqual(
    task.rubric.failureTags.map(value => ({ key: value.key, label: value.label })),
    [{ key: "incorrect", label: "Incorrect" }],
  );
  assert.deepEqual(
    task.cases.map(value => value.options.map(option => [option.key, option.artifactId])),
    [
      [
        ["A", seeded.artifactIds[0]],
        ["B", seeded.artifactIds[1]],
      ],
      [
        ["A", seeded.artifactIds[1]],
        ["B", seeded.artifactIds[0]],
      ],
    ],
  );
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

  const originalExpiry = (
    await dbClient.execute({
      sql: "SELECT assignment_expires_at FROM tokenless_assurance_assignments WHERE assignment_id = ?",
      args: [reserved.assignmentId],
    })
  ).rows[0]?.assignment_expires_at;
  const leaseExpiredAt = new Date(now.getTime() + 600_001);
  await assert.rejects(
    () =>
      getAssignmentOnlyTask({ baseAccountAddress: REVIEWER, assignmentId: reserved.assignmentId, now: leaseExpiredAt }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "artifact_lease_expired",
  );
  await assert.rejects(
    () =>
      recoverExpiredAudienceAssignment({
        baseAccountAddress: SECOND_REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: TERMS_HASH,
        now: leaseExpiredAt,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_recovery_unavailable",
  );
  await assert.rejects(
    () =>
      recoverExpiredAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: POLICY_HASH,
        now: leaseExpiredAt,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "confidentiality_terms_mismatch",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_run_subpanels SET policy_hash = ? WHERE run_id = ?",
    args: [`sha256:${"8".repeat(64)}`, seeded.runId],
  });
  await assert.rejects(
    () =>
      recoverExpiredAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: TERMS_HASH,
        now: leaseExpiredAt,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_not_found",
  );
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_run_subpanels SET policy_hash = ? WHERE run_id = ?",
    args: [POLICY_HASH, seeded.runId],
  });

  const renewed = await recoverExpiredAudienceAssignment({
    baseAccountAddress: REVIEWER,
    assignmentId: reserved.assignmentId,
    confidentialityTermsHash: TERMS_HASH,
    now: leaseExpiredAt,
  });
  if (renewed.accepted !== true) assert.fail("expired artifact access must renew the accepted assignment leases");
  assert.equal(renewed.leases.length, accepted.leases.length);
  assert.ok(renewed.leases.every(value => new Date(value.expiresAt).getTime() - leaseExpiredAt.getTime() === 600_000));
  assert.notDeepEqual(
    renewed.leases.map(value => value.leaseId).sort(),
    accepted.leases.map(value => value.leaseId).sort(),
  );
  const renewedAssignment = await dbClient.execute({
    sql: `SELECT assignment_expires_at, recovery_count, lease_state
          FROM tokenless_assurance_assignments WHERE assignment_id = ?`,
    args: [reserved.assignmentId],
  });
  assert.equal(
    new Date(String(renewedAssignment.rows[0]?.assignment_expires_at)).getTime(),
    new Date(String(originalExpiry)).getTime(),
  );
  assert.equal(Number(renewedAssignment.rows[0]?.recovery_count), 0);
  assert.equal(renewedAssignment.rows[0]?.lease_state, "issued");
  const leaseAudit = await dbClient.execute({
    sql: `SELECT lease_id FROM tokenless_assurance_access_logs
          WHERE project_id = ? AND action = 'lease' ORDER BY occurred_at ASC`,
    args: [project.projectId],
  });
  assert.equal(leaseAudit.rows.length, accepted.leases.length + renewed.leases.length);
  assert.ok(leaseAudit.rows.every(row => row.lease_id));
  assert.equal(
    (
      await getAssignmentOnlyTask({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        now: new Date(leaseExpiredAt.getTime() + 1),
      })
    ).cases.length,
    2,
  );

  const afterAssignmentExpiry = new Date(new Date(String(originalExpiry)).getTime() + 1);
  await assert.rejects(
    () =>
      recoverExpiredAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsHash: TERMS_HASH,
        now: afterAssignmentExpiry,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_expired",
  );
  assert.equal(
    Number(
      (
        await dbClient.execute({
          sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_access_logs WHERE project_id = ? AND action = 'lease'",
          args: [project.projectId],
        })
      ).rows[0]?.count,
    ),
    leaseAudit.rows.length,
  );
});

test("durable private-group membership gates reservation discovery and acceptance without erasing accepted work", async () => {
  const project = await seedProject(OWNER, "private_group");
  await Promise.all([
    seedBrowserIdentity(REVIEWER, "private-reviewer"),
    seedBrowserIdentity(SECOND_REVIEWER, "private-second"),
  ]);
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    name: "Release council",
    purpose: "Confidential employee review.",
    policy: {
      defaultCompensation: "unpaid",
      allowedProjectIds: [project.projectId],
      dataClassifications: ["confidential"],
    },
  });
  const invitation = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    groupId: group.groupId,
    maximumRedemptions: 2,
  });
  await redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: invitation.token });
  await redeemPrivateGroupInvitation({ accountAddress: SECOND_REVIEWER, token: invitation.token });
  const cohort = await createProjectCohort({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    name: "Release council",
    source: "customer_invited",
    selection: "customer_named",
    capacity: 3,
    privateGroupId: group.groupId,
  });
  const policy = audiencePolicy([{ ...cohort, source: "customer_invited" }], {
    reviewerSource: "customer_invited",
    selection: "customer_named",
    compensation: "unpaid",
  });
  const seeded = await seedRun(project, policy);
  const [subpanel] = await prepareRunAudience({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
  });
  assert.deepEqual(subpanel?.privateGroup, {
    groupId: group.groupId,
    policyVersion: 1,
    policyHash: group.policyHash,
  });

  const reserved = await reserveAudienceAssignment({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
    subpanelId: subpanel!.subpanelId!,
    reviewerAccountAddress: REVIEWER,
    confidentialityTermsHash: TERMS_HASH,
  });
  const visible = await listReviewerAssignments({ accountAddress: REVIEWER });
  assert.equal(visible[0]?.assignmentId, reserved.assignmentId);
  assert.equal(visible[0]?.privateGroup?.groupId, group.groupId);
  assert.equal(
    (await listReviewerAssignments({ accountAddress: REVIEWER, view: "active" }))[0]?.assignmentId,
    reserved.assignmentId,
  );
  assert.deepEqual(await listReviewerAssignments({ accountAddress: REVIEWER, view: "history" }), []);
  const expertiseNow = new Date();
  await attestInvitedReviewerExpertise({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    cohortId: cohort.cohortId,
    reviewerAccountAddress: SECOND_REVIEWER,
    expertiseKeys: ["code-review:typescript"],
    expiresAt: new Date(expertiseNow.getTime() + 86_400_000).toISOString(),
    now: expertiseNow,
  });

  await removePrivateGroupMember({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    groupId: group.groupId,
    principalAddress: REVIEWER,
  });
  const released = await dbClient.execute({
    sql: "SELECT status FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [reserved.assignmentId],
  });
  assert.equal(released.rows[0]?.status, "released");
  assert.equal((await listReviewerAssignments({ accountAddress: REVIEWER })).length, 0);
  await assert.rejects(
    () =>
      acceptAudienceAssignment({
        baseAccountAddress: REVIEWER,
        assignmentId: reserved.assignmentId,
        confidentialityTermsAccepted: true,
        confidentialityTermsHash: TERMS_HASH,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "private_group_membership_required",
  );

  const acceptedReservation = await reserveAudienceAssignment({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    runId: seeded.runId,
    subpanelId: subpanel!.subpanelId!,
    reviewerAccountAddress: SECOND_REVIEWER,
    confidentialityTermsHash: TERMS_HASH,
  });
  const refreshedExpertise = await dbClient.execute({
    sql: `SELECT qualification_provenance_json FROM tokenless_assurance_cohort_reviewers
          WHERE project_id=? AND cohort_id=? AND reviewer_account_address=?`,
    args: [project.projectId, cohort.cohortId, SECOND_REVIEWER],
  });
  assert.match(String(refreshedExpertise.rows[0]?.qualification_provenance_json), /expertise:code-review:typescript/u);
  await acceptAudienceAssignment({
    baseAccountAddress: SECOND_REVIEWER,
    assignmentId: acceptedReservation.assignmentId,
    confidentialityTermsAccepted: true,
    confidentialityTermsHash: TERMS_HASH,
  });
  await removePrivateGroupMember({
    accountAddress: OWNER,
    workspaceId: project.workspaceId,
    groupId: group.groupId,
    principalAddress: SECOND_REVIEWER,
  });
  const accepted = await dbClient.execute({
    sql: "SELECT status, private_group_policy_hash FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [acceptedReservation.assignmentId],
  });
  assert.equal(accepted.rows[0]?.status, "accepted");
  assert.equal(accepted.rows[0]?.private_group_policy_hash, group.policyHash);
  assert.equal(
    (await listReviewerAssignments({ accountAddress: SECOND_REVIEWER }))[0]?.assignmentId,
    acceptedReservation.assignmentId,
  );
  assert.deepEqual(await listReviewerAssignments({ accountAddress: SECOND_REVIEWER, view: "active" }), []);
  assert.equal(
    (await listReviewerAssignments({ accountAddress: SECOND_REVIEWER, view: "history" }))[0]?.assignmentId,
    acceptedReservation.assignmentId,
  );
  await assert.rejects(
    () =>
      getAssignmentOnlyTask({
        baseAccountAddress: SECOND_REVIEWER,
        assignmentId: acceptedReservation.assignmentId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_not_found",
  );
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createPrivateGroup,
  createPrivateGroupInvitation,
  redeemPrivateGroupInvitation,
} from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { updateReviewRequestProfile } from "~~/lib/tokenless/reviewRequestProfiles";
import {
  type ExactReviewerExpertiseDefinition,
  replacePrivateGroupMemberExpertise,
} from "~~/lib/tokenless/reviewerExpertiseAssignments";
import type { ReviewerExpertiseRequirement } from "~~/lib/tokenless/reviewerExpertiseOptions";
import { provisionWorkspacePrivateReviewRouting } from "~~/lib/tokenless/workspacePrivateReviewRouting";
import {
  createWorkspaceReviewerInvitation,
  redeemWorkspaceReviewerInvitation,
} from "~~/lib/tokenless/workspaceReviewers";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER_A = "0x2222222222222222222222222222222222222222";
const REVIEWER_B = "0x3333333333333333333333333333333333333333";
const REVIEWER_C = "0x4444444444444444444444444444444444444444";
const PROFILE_ID = "hrrp_workspace_private_routing";
const PROFILE_HASH = `sha256:${"a".repeat(64)}`;

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function definition(slug: string): Promise<ExactReviewerExpertiseDefinition> {
  const result = await dbClient.execute({
    sql: `SELECT definition_id,version,definition_hash
          FROM tokenless_reviewer_expertise_definitions
          WHERE slug=? AND superseded_at IS NULL LIMIT 1`,
    args: [slug],
  });
  const row = result.rows[0];
  if (!row) throw new Error(`Missing seeded definition ${slug}.`);
  return {
    definitionId: String(row.definition_id),
    definitionVersion: Number(row.version),
    definitionHash: String(row.definition_hash) as `sha256:${string}`,
  };
}

async function fixture(expertiseRequirements: ReviewerExpertiseRequirement[] = []) {
  const { workspaceId } = await createWorkspace({ name: "Private routing", ownerAddress: OWNER });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Private reviewers",
    purpose: "Review this workspace's private agent work.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["confidential"] },
  });
  const now = new Date("2026-07-19T09:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agents
          (agent_id,workspace_id,external_id,owner_account_address,status,created_by,created_at,updated_at)
          VALUES ('agent_private_routing',?,'private-routing-agent',?,'active',?,?,?)`,
    args: [workspaceId, OWNER, OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_versions
          (version_id,agent_id,workspace_id,version_number,display_name,description,declared_provider,
           declared_model,declared_model_version,environment,
           configuration_commitment,created_by,created_at)
          VALUES ('agentv_private_routing','agent_private_routing',?,1,'Private routing agent',NULL,
                  'OpenAI','test-model',NULL,'production','private-routing-v1',?,?)`,
    args: [workspaceId, OWNER, now],
  });
  for (const [reviewer, email] of [
    [REVIEWER_A, "reviewer-a@example.test"],
    [REVIEWER_B, "reviewer-b@example.test"],
    [REVIEWER_C, "reviewer-c@example.test"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
            VALUES (?,'active',?,?)`,
      args: [reviewer, now, now],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_browser_identities
            (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,email_domain,
             display_name,created_at,updated_at,last_login_at)
            VALUES (?,?,'email',?,true,'example.test',NULL,?,?,?)`,
      args: [reviewer, `thirdweb-${reviewer}`, email, now, now, now],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_request_profiles
          (profile_id,version,workspace_id,agent_id,agent_version_id,question_authority,result_semantics,
           criterion,positive_label,negative_label,rationale_mode,audience,content_boundary,private_sensitivity,
           private_group_id,private_group_policy_version,private_group_policy_hash,semantic_schema_version,
           required_expertise_keys_json,expertise_requirements_json,response_window_seconds,panel_size,
           compensation_mode,bounty_per_seat_atomic,configuration_status,profile_hash,created_by,created_at,
           approved_by,approved_at,superseded_at)
          VALUES (?,1,?,'agent_private_routing','agentv_private_routing','owner_fixed','assurance',
                  'Assess whether this response is safe and correct.','Approve','Reject','required','private_invited',
                  'private_workspace','confidential',?,?,?,?,'[]',?,3600,2,'unpaid',NULL,'ready',?,?,?, ?,?,NULL)`,
    args: [
      PROFILE_ID,
      workspaceId,
      group.groupId,
      1,
      group.policyHash,
      expertiseRequirements.length > 0 ? 3 : 1,
      JSON.stringify(expertiseRequirements),
      PROFILE_HASH,
      OWNER,
      now,
      OWNER,
      now,
    ],
  });
  return { workspaceId, groupId: group.groupId, groupPolicyHash: group.policyHash, now };
}

async function addMember(input: { workspaceId: string; groupId: string; reviewer: string; now: Date }) {
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: input.reviewer,
    accessExpiresAt: new Date(input.now.getTime() + 30 * 86_400_000),
    now: input.now,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: input.reviewer, token: invitation.token, now: input.now });
  return invitation;
}

async function addLegacyExpertiseBinding(input: { workspaceId: string; groupId: string; reviewer: string; now: Date }) {
  const invitation = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    intendedAccountAddress: input.reviewer,
    membershipExpiresAt: new Date(input.now.getTime() + 30 * 86_400_000),
    now: input.now,
  });
  await redeemPrivateGroupInvitation({ accountAddress: input.reviewer, token: invitation.token, now: input.now });
}

function provision(input: { workspaceId: string; now: Date; profileVersion?: number; profileHash?: string }) {
  return provisionWorkspacePrivateReviewRouting({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    profileId: PROFILE_ID,
    profileVersion: input.profileVersion ?? 1,
    profileHash: input.profileHash ?? PROFILE_HASH,
    now: input.now,
  });
}

function replaceWithPaidProfileV2(input: { workspaceId: string; groupId: string; groupPolicyHash: string }) {
  return updateReviewRequestProfile({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    profileId: PROFILE_ID,
    profile: {
      agentId: "agent_private_routing",
      agentVersionId: "agentv_private_routing",
      questionAuthority: "owner_fixed",
      criterion: "Assess whether this response is safe and correct.",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "required",
      audience: "private_invited",
      contentBoundary: "private_workspace",
      privateSensitivity: "confidential",
      privateGroupId: input.groupId,
      privateGroupPolicyVersion: 1,
      privateGroupPolicyHash: input.groupPolicyHash,
      requiredExpertiseKeys: [],
      expertiseRequirements: [],
      responseWindowSeconds: 3_600,
      panelSize: 2,
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
    },
  });
}

test("managed private routing is idempotent and stays unready until the exact reviewer seats exist", async () => {
  const setup = await fixture();
  const empty = await provision(setup);
  assert.deepEqual(
    {
      ready: empty.ready,
      reason: empty.reason,
      synced: empty.syncedReviewerCount,
      eligible: empty.eligibleReviewerCount,
      selected: empty.selectedReviewerCount,
    },
    { ready: false, reason: "reviewer_seats_insufficient", synced: 0, eligible: 0, selected: 0 },
  );
  const replay = await provision(setup);
  assert.equal(replay.projectId, empty.projectId);
  assert.equal(replay.cohortId, empty.cohortId);
  const resources = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_assurance_projects WHERE project_id=?) AS projects,
            (SELECT COUNT(*) FROM tokenless_assurance_cohorts WHERE cohort_id=?) AS cohorts`,
    args: [empty.projectId, empty.cohortId],
  });
  assert.equal(Number(resources.rows[0]?.projects), 1);
  assert.equal(Number(resources.rows[0]?.cohorts), 1);

  await addMember({ ...setup, reviewer: REVIEWER_A });
  await addMember({ ...setup, reviewer: REVIEWER_B });
  const ready = await provision(setup);
  assert.equal(ready.ready, true);
  assert.equal(ready.reason, "ready");
  assert.equal(ready.syncedReviewerCount, 2);
  assert.equal(ready.selectedReviewerCount, 2);
  await addMember({ ...setup, reviewer: REVIEWER_C });
  const exact = await provision(setup);
  assert.equal(exact.ready, true);
  assert.equal(exact.syncedReviewerCount, 3);
  assert.equal(exact.selectedReviewerCount, 2);
  const reviewers = await dbClient.execute({
    sql: `SELECT reviewer_account_address,status,qualification_provenance_json
          FROM tokenless_assurance_cohort_reviewers
          WHERE project_id=? AND cohort_id=? ORDER BY reviewer_account_address`,
    args: [exact.projectId, exact.cohortId],
  });
  assert.deepEqual(
    reviewers.rows.map(row => [row.reviewer_account_address, row.status]),
    [
      [REVIEWER_A, "active"],
      [REVIEWER_B, "active"],
      [REVIEWER_C, "inactive"],
    ],
  );
  for (const row of reviewers.rows) {
    const provenance = JSON.parse(String(row.qualification_provenance_json)) as Array<Record<string, unknown>>;
    assert.deepEqual(
      provenance.map(value => value.key),
      ["customer_invitation", "private_review_policy_group", "workspace_reviewer_access_grant"],
    );
  }
});

test("exact expertise and cohort capacity both fail closed", async () => {
  const typescript = await definition("code-review:typescript");
  const requirement: ReviewerExpertiseRequirement = {
    ...typescript,
    minimumSeats: 2,
    sourceScope: "customer_invited",
  };
  const setup = await fixture([requirement]);
  await addMember({ ...setup, reviewer: REVIEWER_A });
  await addMember({ ...setup, reviewer: REVIEWER_B });
  await addLegacyExpertiseBinding({ ...setup, reviewer: REVIEWER_A });
  await addLegacyExpertiseBinding({ ...setup, reviewer: REVIEWER_B });
  const expertiseExpiresAt = new Date(setup.now.getTime() + 10 * 86_400_000);
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    groupId: setup.groupId,
    reviewerAccountAddress: REVIEWER_A,
    definitions: [typescript],
    expiresAt: new Date(setup.now.getTime() + 30 * 60_000),
    now: setup.now,
  });
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    groupId: setup.groupId,
    reviewerAccountAddress: REVIEWER_B,
    definitions: [typescript],
    expiresAt: expertiseExpiresAt,
    now: setup.now,
  });
  const missingExpertise = await provision(setup);
  assert.equal(missingExpertise.ready, false);
  assert.equal(missingExpertise.reason, "expertise_coverage_insufficient");
  assert.equal(missingExpertise.selectedReviewerCount, 0);

  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId: setup.workspaceId,
    groupId: setup.groupId,
    reviewerAccountAddress: REVIEWER_A,
    definitions: [typescript],
    expiresAt: expertiseExpiresAt,
    now: setup.now,
  });
  const ready = await provision(setup);
  assert.equal(ready.ready, true);
  const expertise = await dbClient.execute({
    sql: `SELECT qualification_provenance_json FROM tokenless_assurance_cohort_reviewers
          WHERE project_id=? AND cohort_id=? ORDER BY reviewer_account_address`,
    args: [ready.projectId, ready.cohortId],
  });
  for (const row of expertise.rows) {
    assert.match(String(row.qualification_provenance_json), /expertise:expd_/u);
    assert.match(String(row.qualification_provenance_json), /owner_attested/u);
  }

  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohorts SET active_reservations=1
          WHERE project_id=? AND cohort_id=?`,
    args: [ready.projectId, ready.cohortId],
  });
  const busy = await provision(setup);
  assert.equal(busy.ready, false);
  assert.equal(busy.reason, "cohort_capacity_insufficient");
  assert.equal(busy.availableCapacity, 1);
  assert.equal(busy.selectedReviewerCount, 0);
});

test("a newer paid profile retires stale managed routing only after the older cohort is idle", async () => {
  const setup = await fixture();
  await addMember({ ...setup, reviewer: REVIEWER_A });
  await addMember({ ...setup, reviewer: REVIEWER_B });
  const first = await provision(setup);
  assert.equal(first.ready, true);
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohorts SET active_reservations=1
          WHERE project_id=? AND cohort_id=?`,
    args: [first.projectId, first.cohortId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=1
          WHERE project_id=? AND cohort_id=? AND reviewer_account_address=?`,
    args: [first.projectId, first.cohortId, REVIEWER_A],
  });
  const updatedProfile = await replaceWithPaidProfileV2(setup);
  assert.equal(updatedProfile.version, 2);
  assert.equal(updatedProfile.compensationMode, "usdc");
  assert.equal(updatedProfile.bountyPerSeatAtomic, "1000000");

  const nextProfile = { ...setup, profileVersion: 2, profileHash: updatedProfile.profileHash };
  const blocked = await provision(nextProfile);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.reason, "prior_managed_cohort_busy");
  const prospective = await dbClient.execute({
    sql: `SELECT COUNT(*) AS projects FROM tokenless_assurance_projects WHERE project_id=?`,
    args: [blocked.projectId],
  });
  assert.equal(Number(prospective.rows[0]?.projects), 0, "busy reconciliation must not create a second route");
  const preserved = await dbClient.execute({
    sql: `SELECT p.status AS project_status,c.status AS cohort_status,c.active_reservations
          FROM tokenless_assurance_projects p
          JOIN tokenless_assurance_cohorts c ON c.project_id=p.project_id
          WHERE p.project_id=? AND c.cohort_id=?`,
    args: [first.projectId, first.cohortId],
  });
  assert.deepEqual(
    {
      project: preserved.rows[0]?.project_status,
      cohort: preserved.rows[0]?.cohort_status,
      reservations: Number(preserved.rows[0]?.active_reservations),
    },
    { project: "active", cohort: "active", reservations: 1 },
  );

  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohorts SET active_reservations=0
          WHERE project_id=? AND cohort_id=?`,
    args: [first.projectId, first.cohortId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations=0
          WHERE project_id=? AND cohort_id=?`,
    args: [first.projectId, first.cohortId],
  });
  const second = await provision(nextProfile);
  assert.equal(second.ready, true, "paid private profiles use the same compensation-independent routing foundation");
  assert.notEqual(second.projectId, first.projectId);
  assert.notEqual(second.cohortId, first.cohortId);

  const retired = await dbClient.execute({
    sql: `SELECT p.status AS project_status,c.status AS cohort_status,
                 COUNT(CASE WHEN cr.status='active' THEN 1 END) AS active_reviewers
          FROM tokenless_assurance_projects p
          JOIN tokenless_assurance_cohorts c ON c.project_id=p.project_id
          LEFT JOIN tokenless_assurance_cohort_reviewers cr
            ON cr.project_id=c.project_id AND cr.cohort_id=c.cohort_id
          WHERE p.project_id=? AND c.cohort_id=?
          GROUP BY p.status,c.status`,
    args: [first.projectId, first.cohortId],
  });
  assert.deepEqual(
    {
      project: retired.rows[0]?.project_status,
      cohort: retired.rows[0]?.cohort_status,
      activeReviewers: Number(retired.rows[0]?.active_reviewers),
    },
    { project: "archived", cohort: "archived", activeReviewers: 0 },
  );
  const current = await dbClient.execute({
    sql: `SELECT p.project_id,c.cohort_id
          FROM tokenless_assurance_projects p
          JOIN tokenless_assurance_cohorts c ON c.project_id=p.project_id
          JOIN tokenless_assurance_cohort_reviewers cr
            ON cr.project_id=c.project_id AND cr.cohort_id=c.cohort_id AND cr.status='active'
          WHERE p.workspace_id=? AND c.private_group_id=?
            AND p.project_id LIKE 'hap_setup_%' AND c.cohort_id LIKE 'hacoh_setup_%'
            AND p.status='active' AND c.status='active'
          GROUP BY p.project_id,c.cohort_id`,
    args: [setup.workspaceId, setup.groupId],
  });
  assert.deepEqual(current.rows, [{ project_id: second.projectId, cohort_id: second.cohortId }]);
});

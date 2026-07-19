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
import {
  type ExactReviewerExpertiseDefinition,
  __reviewerExpertiseAssignmentsTestUtils,
  activeExactReviewerExpertiseKeysThroughDeadline,
  countEligibleNetworkExactExpertisePool,
  exactReviewerExpertiseDefinitionKey,
  listPrivateGroupExpertiseCoverage,
  replacePrivateGroupMemberExpertise,
} from "~~/lib/tokenless/reviewerExpertiseAssignments";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const SECOND_REVIEWER = "0x3333333333333333333333333333333333333333";
const PENDING_REVIEWER = "0x4444444444444444444444444444444444444444";
const OUTSIDER = "0x5555555555555555555555555555555555555555";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function identity(address: string, email: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address,thirdweb_user_id,auth_provider,primary_email,email_verified,email_domain,
           display_name,created_at,updated_at,last_login_at)
          VALUES (?,?,'email',?,true,?,?, ?,?,?)`,
    args: [address, `thirdweb-${address}`, email, email.split("@")[1], email.split("@")[0], now, now, now],
  });
}

async function definition(slug: string): Promise<ExactReviewerExpertiseDefinition> {
  const result = await dbClient.execute({
    sql: `SELECT definition_id,version,definition_hash
          FROM tokenless_reviewer_expertise_definitions WHERE slug=? AND superseded_at IS NULL LIMIT 1`,
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

async function inviteAndRedeem(input: {
  workspaceId: string;
  groupId: string;
  reviewer: string;
  membershipExpiresAt: Date;
  now: Date;
}) {
  const invitation = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    intendedAccountAddress: input.reviewer,
    membershipExpiresAt: input.membershipExpiresAt,
    now: input.now,
  });
  await redeemPrivateGroupInvitation({ accountAddress: input.reviewer, token: invitation.token, now: input.now });
  return invitation;
}

async function fixture() {
  await Promise.all([
    identity(OWNER, "owner@example.test"),
    identity(REVIEWER, "reviewer@example.test"),
    identity(SECOND_REVIEWER, "second@example.test"),
    identity(PENDING_REVIEWER, "pending@example.test"),
    identity(OUTSIDER, "outsider@example.test"),
  ]);
  const { workspaceId } = await createWorkspace({ name: "Specialist coverage", ownerAddress: OWNER });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Specialists",
    purpose: "Invited specialist review.",
  });
  return { workspaceId, groupId: group.groupId };
}

test("owners replace exact member expertise and omitted grants are revoked", async () => {
  const { workspaceId, groupId } = await fixture();
  const now = new Date();
  const membershipExpiresAt = new Date(now.getTime() + 90 * 86_400_000);
  const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
  const source = await inviteAndRedeem({ workspaceId, groupId, reviewer: REVIEWER, membershipExpiresAt, now });
  const typescript = await definition("code-review:typescript");
  const security = await definition("code-review:security");

  const assigned = await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    reviewerAccountAddress: REVIEWER,
    definitions: [typescript, security],
    expiresAt,
    now,
  });
  assert.equal(assigned.sourceInvitationId, source.invitationId);
  assert.equal(assigned.grants.length, 2);
  const active = await dbClient.execute({
    sql: `SELECT reviewer_source,evidence_kind,source_invitation_id,asserted_by,
                 expertise_record_schema_version,status
          FROM tokenless_reviewer_qualifications
          WHERE workspace_id=? AND reviewer_account_address=? ORDER BY expertise_definition_id`,
    args: [workspaceId, REVIEWER],
  });
  assert.deepEqual(
    active.rows.map(row => ({
      source: row.reviewer_source,
      evidence: row.evidence_kind,
      invitation: row.source_invitation_id,
      assertedBy: row.asserted_by,
      schema: Number(row.expertise_record_schema_version),
      status: row.status,
    })),
    [
      {
        source: "customer_invited",
        evidence: "owner_attested",
        invitation: source.invitationId,
        assertedBy: OWNER,
        schema: 2,
        status: "active",
      },
      {
        source: "customer_invited",
        evidence: "owner_attested",
        invitation: source.invitationId,
        assertedBy: OWNER,
        schema: 2,
        status: "active",
      },
    ],
  );

  const cleared = await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    reviewerAccountAddress: REVIEWER,
    definitions: [],
    expiresAt,
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(cleared.grants.length, 0);
  const revoked = await dbClient.execute({
    sql: `SELECT status,revoked_by FROM tokenless_reviewer_qualifications
          WHERE workspace_id=? AND reviewer_account_address=? ORDER BY qualification_id`,
    args: [workspaceId, REVIEWER],
  });
  assert.equal(
    revoked.rows.every(row => row.status === "revoked" && row.revoked_by === OWNER),
    true,
  );
});

test("member grants fail closed on manager, membership, definition, and expiry boundaries", async () => {
  const { workspaceId, groupId } = await fixture();
  const now = new Date();
  const membershipExpiresAt = new Date(now.getTime() + 10 * 86_400_000);
  await inviteAndRedeem({ workspaceId, groupId, reviewer: REVIEWER, membershipExpiresAt, now });
  const typescript = await definition("code-review:typescript");

  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OUTSIDER,
        workspaceId,
        groupId,
        reviewerAccountAddress: REVIEWER,
        definitions: [typescript],
        expiresAt: new Date(now.getTime() + 5 * 86_400_000),
        now,
      }),
    /not found/i,
  );
  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OWNER,
        workspaceId,
        groupId,
        reviewerAccountAddress: SECOND_REVIEWER,
        definitions: [typescript],
        expiresAt: new Date(now.getTime() + 5 * 86_400_000),
        now,
      }),
    /active invited reviewer/i,
  );
  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OWNER,
        workspaceId,
        groupId,
        reviewerAccountAddress: REVIEWER,
        definitions: [typescript],
        expiresAt: new Date(now.getTime() + 11 * 86_400_000),
        now,
      }),
    /cannot outlive/i,
  );
  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OWNER,
        workspaceId,
        groupId,
        reviewerAccountAddress: REVIEWER,
        definitions: [{ ...typescript, definitionHash: `sha256:${"f".repeat(64)}` }],
        expiresAt: new Date(now.getTime() + 5 * 86_400_000),
        now,
      }),
    /unavailable/i,
  );

  const maximumExpiry = new Date(now);
  maximumExpiry.setUTCFullYear(maximumExpiry.getUTCFullYear() + 2);
  assert.equal(
    __reviewerExpertiseAssignmentsTestUtils.maximumExpertiseExpiry(now).toISOString(),
    maximumExpiry.toISOString(),
  );
  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OWNER,
        workspaceId,
        groupId,
        reviewerAccountAddress: SECOND_REVIEWER,
        definitions: [typescript],
        expiresAt: new Date(maximumExpiry.getTime() + 1),
        now,
      }),
    /within two years/i,
  );
});

test("coverage separates confirmed members from pending invitations", async () => {
  const { workspaceId, groupId } = await fixture();
  const now = new Date();
  const responseDeadline = new Date(now.getTime() + 2 * 86_400_000);
  const membershipExpiresAt = new Date(now.getTime() + 90 * 86_400_000);
  const expertiseExpiresAt = new Date(now.getTime() + 30 * 86_400_000);
  await inviteAndRedeem({ workspaceId, groupId, reviewer: REVIEWER, membershipExpiresAt, now });
  await inviteAndRedeem({ workspaceId, groupId, reviewer: SECOND_REVIEWER, membershipExpiresAt, now });
  const typescript = await definition("code-review:typescript");
  const security = await definition("code-review:security");
  const historical: ExactReviewerExpertiseDefinition = {
    definitionId: "expd_historical_architecture",
    definitionVersion: 1,
    definitionHash: `sha256:${"c".repeat(64)}`,
  };
  await dbClient.execute({
    sql: `INSERT INTO tokenless_reviewer_expertise_definitions
          (definition_id,version,scope,workspace_id,slug,label,description,network_eligible,
           definition_hash,status,created_by,created_at,superseded_at)
          VALUES (?,?,'workspace',?,'architecture:historical','Historical architecture review',
                  'Review against the exact retired architecture specialist definition.',false,
                  ?,'retired',?,?,NULL)`,
    args: [
      historical.definitionId,
      historical.definitionVersion,
      workspaceId,
      historical.definitionHash,
      OWNER,
      new Date(now.getTime() - 1_000),
    ],
  });
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    reviewerAccountAddress: REVIEWER,
    definitions: [typescript],
    expiresAt: expertiseExpiresAt,
    now,
  });
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    reviewerAccountAddress: SECOND_REVIEWER,
    definitions: [security],
    expiresAt: expertiseExpiresAt,
    now,
  });
  const pending = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    intendedAccountAddress: PENDING_REVIEWER,
    membershipExpiresAt,
    expertiseDefinitions: [typescript],
    expertiseExpiresAt,
    now,
  });
  const shortPending = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    intendedAccountAddress: OUTSIDER,
    membershipExpiresAt: new Date(now.getTime() + 86_400_000),
    expertiseDefinitions: [typescript],
    expertiseExpiresAt: new Date(now.getTime() + 86_400_000),
    now,
  });
  assert.equal(pending.expertiseDefinitions.length, 1);
  assert.equal(shortPending.expertiseDefinitions.length, 1);

  const coverage = await listPrivateGroupExpertiseCoverage({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    requirements: [
      { ...typescript, minimumSeats: 2, sourceScope: "customer_invited" },
      { ...security, minimumSeats: 1, sourceScope: "customer_invited" },
      { ...historical, minimumSeats: 1, sourceScope: "customer_invited" },
    ],
    responseDeadline,
    now,
  });
  await assert.rejects(
    () =>
      replacePrivateGroupMemberExpertise({
        accountAddress: OWNER,
        workspaceId,
        groupId,
        reviewerAccountAddress: REVIEWER,
        definitions: [historical],
        expiresAt: expertiseExpiresAt,
        now,
      }),
    /unavailable/i,
  );
  assert.equal(coverage.confirmedMemberCount, 2);
  assert.equal(coverage.pendingInvitationCount, 1);
  assert.equal(coverage.ready, false);
  assert.equal(coverage.status, "action_required");
  assert.deepEqual(
    coverage.requirements.map(requirement => ({
      label: requirement.label,
      needed: requirement.minimumSeats,
      confirmed: requirement.confirmedSeats,
      pending: requirement.pendingInvitationSeats,
      status: requirement.status,
    })),
    [
      {
        label: "Application security review",
        needed: 1,
        confirmed: 1,
        pending: 0,
        status: "ready",
      },
      {
        label: "TypeScript code review",
        needed: 2,
        confirmed: 1,
        pending: 1,
        status: "pending_confirmation",
      },
      {
        label: "Historical architecture review",
        needed: 1,
        confirmed: 0,
        pending: 0,
        status: "missing",
      },
    ],
  );
});

test("candidate expertise keys require both grant and membership through the deadline", async () => {
  const { workspaceId, groupId } = await fixture();
  const now = new Date();
  const membershipExpiresAt = new Date(now.getTime() + 90 * 86_400_000);
  const expertiseExpiresAt = new Date(now.getTime() + 10 * 86_400_000);
  await inviteAndRedeem({ workspaceId, groupId, reviewer: REVIEWER, membershipExpiresAt, now });
  const typescript = await definition("code-review:typescript");
  await replacePrivateGroupMemberExpertise({
    accountAddress: OWNER,
    workspaceId,
    groupId,
    reviewerAccountAddress: REVIEWER,
    definitions: [typescript],
    expiresAt: expertiseExpiresAt,
    now,
  });
  assert.deepEqual(
    await activeExactReviewerExpertiseKeysThroughDeadline({
      workspaceId,
      groupId,
      reviewerAccountAddress: REVIEWER,
      responseDeadline: new Date(now.getTime() + 5 * 86_400_000),
      now,
    }),
    [exactReviewerExpertiseDefinitionKey(typescript)],
  );
  assert.deepEqual(
    await activeExactReviewerExpertiseKeysThroughDeadline({
      workspaceId,
      groupId,
      reviewerAccountAddress: REVIEWER,
      responseDeadline: new Date(now.getTime() + 11 * 86_400_000),
      now,
    }),
    [],
  );
});

test("network exact expertise counts only credentials valid through the response deadline", async () => {
  await identity(REVIEWER, "network-reviewer@example.test");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 86_400_000);
  const typescript = await definition("code-review:typescript");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
          VALUES (?,'active',?,?);
          INSERT INTO tokenless_wallet_bindings
          (binding_id,principal_id,purpose,wallet_address,wallet_source,chain_id,proof_message_hash,created_at,last_used_at)
          VALUES ('binding_exact_network',?,'payout',?,'self_custodial',84532,'fixture',?,?);
          INSERT INTO tokenless_payout_wallet_ownership
          (wallet_address,principal_id,first_binding_id,first_bound_at)
          VALUES (?,?,'binding_exact_network',?)`,
    args: [REVIEWER, now, now, REVIEWER, REVIEWER, now, now, REVIEWER, REVIEWER, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_rater_profiles
          (rater_id,principal_id,account_address,nullifier_seed_ciphertext,nullifier_key_version,nullifier_key_domain,
           created_at,updated_at)
          VALUES ('rater_exact_network',?,?,'ciphertext','v1','vote_mapping',?,?)`,
    args: [REVIEWER, REVIEWER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_reviewer_qualifications
          (qualification_id,rater_id,reviewer_source,qualification_kind,cohort_ids_json,
           qualification_keys_json,evidence_kind,workspace_id,evidence_reference_hash,
           qualification_value_json,verified_at,expires_at,status,created_at,updated_at,revoked_at,
           expertise_record_schema_version,expertise_definition_id,expertise_definition_version,
           expertise_definition_hash,source_invitation_id,asserted_by,revoked_by)
          VALUES ('qual_exp_network_exact','rater_exact_network','rateloop_network','expertise','[]','[]',
                  'platform_verified_credential',NULL,?,'{}',?,?,'active',?,?,NULL,2,?,?,?,NULL,
                  'system:expertise-verification',NULL)`,
    args: [
      `sha256:${"a".repeat(64)}`,
      now,
      expiresAt,
      now,
      now,
      typescript.definitionId,
      typescript.definitionVersion,
      typescript.definitionHash,
    ],
  });
  const requirement = { ...typescript, minimumSeats: 1, sourceScope: "rateloop_network" as const };
  assert.equal(
    (
      await countEligibleNetworkExactExpertisePool({
        requirements: [requirement],
        panelSize: 1,
        responseDeadline: new Date(now.getTime() + 5 * 86_400_000),
        now,
      })
    ).eligible,
    1,
  );
  assert.equal(
    (
      await countEligibleNetworkExactExpertisePool({
        requirements: [requirement],
        panelSize: 1,
        responseDeadline: new Date(now.getTime() + 11 * 86_400_000),
        now,
      })
    ).eligible,
    0,
  );
});

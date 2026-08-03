import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { type DatabaseResources, __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __workspaceReviewerInvitationEmailTestUtils,
  deliverPendingWorkspaceReviewerInvitationEmails,
} from "~~/lib/notifications/workspaceReviewerInvitations";
import { createPrivateGroup, createPrivateGroupInvitationInTransaction } from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  acceptWorkspaceReviewerTerms,
  buildWorkspaceReviewerInvitationUrl,
  createWorkspaceReviewerInvitation,
  createWorkspaceReviewerTermsVersion,
  leaveWorkspaceReviewer,
  listMyWorkspaceReviewerAccess,
  listWorkspaceReviewers,
  previewWorkspaceReviewerInvitation,
  redeemWorkspaceReviewerInvitation,
  removeWorkspaceReviewer,
  requireEligibleWorkspaceReviewerGrant,
  revokeWorkspaceReviewerInvitation,
} from "~~/lib/tokenless/workspaceReviewers";

function reviewerTestDatabaseResources() {
  const resources = createMemoryDatabaseResources();
  const connect = resources.pool.connect.bind(resources.pool);
  resources.pool.connect = (async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = ((queryInput: unknown, values?: unknown[]) => {
      if (typeof queryInput === "string") {
        return query(queryInput.replace(/FOR (UPDATE|SHARE) OF [a-z_]+/gu, "FOR $1"), values);
      }
      if (queryInput && typeof queryInput === "object" && "text" in queryInput) {
        return query({
          ...(queryInput as { text: string }),
          text: (queryInput as { text: string }).text.replace(/FOR (UPDATE|SHARE) OF [a-z_]+/gu, "FOR $1"),
        });
      }
      return query(queryInput as never, values);
    }) as typeof client.query;
    return client;
  }) as typeof resources.pool.connect;
  return resources as DatabaseResources;
}

beforeEach(() => __setDatabaseResourcesForTests(reviewerTestDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function betterAuthPrincipal(label: string, email: string) {
  const now = new Date("2026-07-21T08:00:00.000Z");
  const betterAuthUserId = `better_workspace_reviewer_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at)
          VALUES (?,?,?,true,?,?)`,
    args: [betterAuthUserId, `Reviewer ${label}`, email, now, now],
  });
  return (await resolveBetterAuthPrincipal({ betterAuthUserId, displayName: `Reviewer ${label}`, method: "email-otp" }))
    .principalId;
}

async function fixture() {
  const owner = await betterAuthPrincipal("owner", "owner@example.test");
  const reviewer = await betterAuthPrincipal("reviewer", "reviewer@example.test");
  const outsider = await betterAuthPrincipal("outsider", "outsider@example.test");
  const { workspaceId } = await createWorkspace({ name: "Workspace reviewers", ownerAddress: owner });
  return { workspaceId, owner, reviewer, outsider };
}

test("reviewer invitations persist only token hashes and never grant workspace membership", async () => {
  const { workspaceId, owner, reviewer, outsider } = await fixture();
  const routingGroup = await createPrivateGroup({
    accountAddress: owner,
    workspaceId,
    name: "Review routing",
    purpose: "Internal compatibility routing.",
  });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: reviewer,
    now,
  });

  assert.match(invitation.token, /^rlri_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/u);
  assert.equal(
    buildWorkspaceReviewerInvitationUrl(invitation.token, "https://tokenless.example.test"),
    `https://tokenless.example.test/human/review?invite=1#invite=${invitation.token}`,
  );
  assert.match(invitation.destinationUrl, /\/human\/review\?invite=1#invite=rlri_/u);
  const stored = await dbClient.execute({
    sql: `SELECT token_hash,token_prefix,intended_account_address
          FROM tokenless_workspace_reviewer_invitations WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.token_hash, createHash("sha256").update(invitation.token).digest("hex"));
  assert.equal(stored.rows[0]?.token_prefix, invitation.tokenPrefix);
  assert.equal(stored.rows[0]?.intended_account_address, reviewer);
  assert.equal(JSON.stringify(stored.rows[0]).includes(invitation.token), false);

  await assert.rejects(
    () => previewWorkspaceReviewerInvitation({ accountAddress: outsider, token: invitation.token, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_invitation_account_mismatch",
  );
  const preview = await previewWorkspaceReviewerInvitation({ accountAddress: reviewer, token: invitation.token, now });
  assert.equal(preview.workspaceId, workspaceId);
  assert.equal(preview.maxPrivateSensitivity, "confidential");

  const redemption = await redeemWorkspaceReviewerInvitation({
    accountAddress: reviewer,
    token: invitation.token,
    now,
  });
  assert.equal(redemption.replay, false);
  assert.match(redemption.grantHash, /^sha256:[a-f0-9]{64}$/u);

  const workspaceMember = await dbClient.execute({
    sql: "SELECT 1 FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [workspaceId, reviewer],
  });
  assert.equal(workspaceMember.rowCount, 0);
  const privateGroupMembership = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [routingGroup.groupId, reviewer],
  });
  assert.equal(privateGroupMembership.rowCount, 0);
  const reviewers = await listWorkspaceReviewers({ accountAddress: owner, workspaceId, now });
  assert.equal(reviewers.length, 1);
  assert.equal(reviewers[0]?.principalAddress, reviewer);
  assert.equal(reviewers[0]?.displayName, "Reviewer reviewer");
  assert.equal(reviewers[0]?.email, "reviewer@example.test");
  assert.equal(reviewers[0]?.status, "active");
  assert.equal(reviewers[0]?.grants.length, 1);

  await dbClient.execute({
    sql: `INSERT INTO tokenless_account_profiles (principal_address,display_name,created_at,updated_at)
          VALUES (?,?,?,?)`,
    args: [reviewer, "Saved reviewer name", now, now],
  });
  const profiledReviewers = await listWorkspaceReviewers({ accountAddress: owner, workspaceId, now });
  assert.equal(profiledReviewers[0]?.displayName, "Saved reviewer name");

  await dbClient.execute({
    sql: `UPDATE tokenless_better_auth_users SET email_verified=false
          WHERE id='better_workspace_reviewer_reviewer'`,
  });
  const unverifiedReviewers = await listWorkspaceReviewers({ accountAddress: owner, workspaceId, now });
  assert.equal(unverifiedReviewers[0]?.email, null);
});

test("a reviewer invitation transactionally binds and activates the selected private group idempotently", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const group = await createPrivateGroup({
    accountAddress: owner,
    workspaceId,
    name: "Deployment reviewers",
    purpose: "Review private agent output.",
  });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    privateGroupId: group.groupId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: reviewer,
    accessExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    now,
  });
  const paired = await dbClient.execute({
    sql: `SELECT group_id,intended_account_address,membership_expires_at
          FROM tokenless_private_group_invitations
          WHERE invitation_id=? AND workspace_id=?`,
    args: [invitation.invitationId, workspaceId],
  });
  assert.equal(paired.rows[0]?.group_id, group.groupId);
  assert.equal(paired.rows[0]?.intended_account_address, reviewer);

  const first = await redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: invitation.token, now });
  assert.equal(first.replay, false);
  const stored = await dbClient.execute({
    sql: `SELECT status,allowed_project_ids_json,source_invitation_id,membership_expires_at
          FROM tokenless_private_group_memberships WHERE group_id=? AND principal_address=?`,
    args: [group.groupId, reviewer],
  });
  assert.equal(stored.rows[0]?.status, "active");
  assert.equal(stored.rows[0]?.allowed_project_ids_json, "[]");
  assert.equal(stored.rows[0]?.source_invitation_id, invitation.invitationId);
  assert.equal(
    new Date(String(stored.rows[0]?.membership_expires_at)).toISOString(),
    new Date(now.getTime() + 30 * 86_400_000).toISOString(),
  );

  await dbClient.execute({
    sql: "DELETE FROM tokenless_private_group_memberships WHERE group_id=? AND principal_address=?",
    args: [group.groupId, reviewer],
  });
  const replay = await redeemWorkspaceReviewerInvitation({
    accountAddress: reviewer,
    token: invitation.token,
    now: new Date(now.getTime() + 60_000),
  });
  assert.equal(replay.replay, true);
  const repaired = await dbClient.execute({
    sql: `SELECT status,source_invitation_id FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [group.groupId, reviewer],
  });
  assert.equal(repaired.rows[0]?.status, "active");
  assert.equal(repaired.rows[0]?.source_invitation_id, invitation.invitationId);

  await removeWorkspaceReviewer({
    accountAddress: owner,
    workspaceId,
    principalAddress: reviewer,
    reason: "access_removed",
    now: new Date(now.getTime() + 120_000),
  });
  const removedReplay = await redeemWorkspaceReviewerInvitation({
    accountAddress: reviewer,
    token: invitation.token,
    now: new Date(now.getTime() + 180_000),
  });
  assert.equal(removedReplay.replay, true);
  const remainsRemoved = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [group.groupId, reviewer],
  });
  assert.equal(remainsRemoved.rows[0]?.status, "removed");
});

test("revoking a setup invitation also revokes its private-group provenance and pending expertise", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const group = await createPrivateGroup({
    accountAddress: owner,
    workspaceId,
    name: "Revoked setup reviewers",
    purpose: "Exercise setup invitation revocation.",
  });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const accessExpiresAt = new Date(now.getTime() + 30 * 86_400_000);
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: reviewer,
    accessExpiresAt,
    now,
  });
  const definitionResult = await dbClient.execute({
    sql: `SELECT definition_id,version,definition_hash
          FROM tokenless_reviewer_expertise_definitions
          WHERE slug='code-review:typescript' AND superseded_at IS NULL`,
  });
  const definition = definitionResult.rows[0]!;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await createPrivateGroupInvitationInTransaction(client, {
      actorAddress: owner,
      invitationId: invitation.invitationId,
      workspaceId,
      groupId: group.groupId,
      intendedAccountAddress: reviewer,
      expiresAt: new Date(invitation.expiresAt),
      membershipExpiresAt: accessExpiresAt,
      expertiseExpiresAt: new Date(now.getTime() + 10 * 86_400_000),
      expertiseDefinitions: [
        {
          definitionId: String(definition.definition_id),
          definitionVersion: Number(definition.version),
          definitionHash: String(definition.definition_hash) as `sha256:${string}`,
        },
      ],
      now,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET status='completed',current_step='complete',people_decision='invited',private_group_id=?,
              people_decided_at=?,people_decided_by=?,people_invitation_id=?,
              finalization_idempotency_key_hash=?,finalization_request_hash=?,
              completed_at=?,completed_by=?,updated_at=?
          WHERE workspace_id=?`,
    args: [
      group.groupId,
      now,
      owner,
      invitation.invitationId,
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
      now,
      owner,
      now,
      workspaceId,
    ],
  });

  await revokeWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    invitationId: invitation.invitationId,
    now: new Date(now.getTime() + 60_000),
  });
  await assert.rejects(
    redeemWorkspaceReviewerInvitation({
      accountAddress: reviewer,
      token: invitation.token,
      now: new Date(now.getTime() + 120_000),
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_invitation_unavailable",
  );
  const revoked = await dbClient.execute({
    sql: `SELECT
            (SELECT revoked_at FROM tokenless_workspace_reviewer_invitations WHERE invitation_id=?) AS workspace_revoked_at,
            (SELECT revoked_at FROM tokenless_private_group_invitations WHERE invitation_id=?) AS group_revoked_at,
            (SELECT COUNT(*) FROM tokenless_private_group_memberships
             WHERE group_id=? AND principal_address=?) AS membership_count`,
    args: [invitation.invitationId, invitation.invitationId, group.groupId, reviewer],
  });
  const expertiseStatus = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_invitation_expertise_attestations
          WHERE invitation_id=? LIMIT 1`,
    args: [invitation.invitationId],
  });
  assert.ok(revoked.rows[0]?.workspace_revoked_at);
  assert.ok(revoked.rows[0]?.group_revoked_at);
  assert.equal(expertiseStatus.rows[0]?.status, "revoked");
  assert.equal(Number(revoked.rows[0]?.membership_count), 0);
});

test("expired setup invitations cannot create private-group memberships", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const group = await createPrivateGroup({
    accountAddress: owner,
    workspaceId,
    name: "Expired setup reviewers",
    purpose: "Exercise setup invitation expiry.",
  });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedAccountAddress: reviewer,
    accessExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    now,
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await createPrivateGroupInvitationInTransaction(client, {
      actorAddress: owner,
      invitationId: invitation.invitationId,
      workspaceId,
      groupId: group.groupId,
      intendedAccountAddress: reviewer,
      expiresAt: new Date(invitation.expiresAt),
      membershipExpiresAt: new Date(invitation.accessExpiresAt!),
      now,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_agent_setups
          SET status='completed',current_step='complete',people_decision='invited',private_group_id=?,
              people_decided_at=?,people_decided_by=?,people_invitation_id=?,
              finalization_idempotency_key_hash=?,finalization_request_hash=?,
              completed_at=?,completed_by=?,updated_at=?
          WHERE workspace_id=?`,
    args: [
      group.groupId,
      now,
      owner,
      invitation.invitationId,
      `sha256:${"5".repeat(64)}`,
      `sha256:${"6".repeat(64)}`,
      now,
      owner,
      now,
      workspaceId,
    ],
  });

  await assert.rejects(
    redeemWorkspaceReviewerInvitation({
      accountAddress: reviewer,
      token: invitation.token,
      now: new Date(now.getTime() + 8 * 86_400_000),
    }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_invitation_unavailable",
  );
  const membership = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [group.groupId, reviewer],
  });
  assert.equal(membership.rowCount, 0);
});

test("reviewer invitation redemption is idempotent after reaching its redemption cap", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "internal",
    intendedAccountAddress: reviewer,
    now,
  });
  const first = await redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: invitation.token, now });
  const replay = await redeemWorkspaceReviewerInvitation({
    accountAddress: reviewer,
    token: invitation.token,
    now: new Date(now.getTime() + 60_000),
  });

  assert.equal(first.replay, false);
  assert.equal(replay.replay, true);
  assert.equal(replay.grantId, first.grantId);
  const counts = await dbClient.execute({
    sql: `SELECT redemption_count FROM tokenless_workspace_reviewer_invitations WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(Number(counts.rows[0]?.redemption_count), 1);
  const grants = await dbClient.execute({
    sql: "SELECT COUNT(*)::int AS count FROM tokenless_workspace_reviewer_access_grants WHERE workspace_id=?",
    args: [workspaceId],
  });
  assert.equal(Number(grants.rows[0]?.count), 1);
});

test("reviewers can inspect and leave workspace access without workspace membership", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "internal",
    intendedAccountAddress: reviewer,
    now,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: invitation.token, now });

  const before = await listMyWorkspaceReviewerAccess({ accountAddress: reviewer, now });
  assert.equal(before[0]?.workspaceId, workspaceId);
  assert.equal(before[0]?.status, "active");
  assert.equal(before[0]?.grants[0]?.status, "active");

  const left = await leaveWorkspaceReviewer({
    accountAddress: reviewer,
    workspaceId,
    now: new Date(now.getTime() + 10_000),
  });
  assert.equal(left.status, "left");
  const after = await listMyWorkspaceReviewerAccess({
    accountAddress: reviewer,
    now: new Date(now.getTime() + 10_000),
  });
  assert.equal(after[0]?.status, "left");
  assert.equal(after[0]?.grants[0]?.status, "revoked");
});

test("reviewer invitations reject access authority that expires before the invitation", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  await assert.rejects(
    () =>
      createWorkspaceReviewerInvitation({
        accountAddress: owner,
        workspaceId,
        maxPrivateSensitivity: "internal",
        intendedAccountAddress: reviewer,
        expiresAt: new Date(now.getTime() + 120_000),
        accessExpiresAt: new Date(now.getTime() + 60_000),
        now,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_workspace_reviewer",
  );
  const stored = await dbClient.execute({
    sql: `SELECT invitation_id FROM tokenless_workspace_reviewer_invitations WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(stored.rowCount, 0);
});

test("verified-email invitations cannot be redeemed by a different authenticated email", async () => {
  const rightReviewer = await betterAuthPrincipal("right", "right@example.test");
  const wrongReviewer = await betterAuthPrincipal("wrong", "wrong@example.test");
  const owner = await betterAuthPrincipal("email_owner", "email-owner@example.test");
  const { workspaceId } = await createWorkspace({ name: "Email-bound reviewers", ownerAddress: owner });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "restricted",
    intendedEmail: "RIGHT@example.test",
    now,
  });

  const stored = await dbClient.execute({
    sql: `SELECT intended_email_hash FROM tokenless_workspace_reviewer_invitations WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.match(String(stored.rows[0]?.intended_email_hash), /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(stored.rows[0]).includes("right@example.test"), false);
  await assert.rejects(
    () => redeemWorkspaceReviewerInvitation({ accountAddress: wrongReviewer, token: invitation.token, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_invitation_email_mismatch",
  );
  const redeemed = await redeemWorkspaceReviewerInvitation({
    accountAddress: rightReviewer,
    token: invitation.token,
    now,
  });
  assert.equal(redeemed.principalAddress, rightReviewer);
});

test("reviewer invitation email delivery is encrypted, durable, and resumes after configuration repair", async () => {
  const { workspaceId, owner } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "restricted",
    intendedEmail: "REVIEWER@example.test",
    now,
  });
  assert.equal(invitation.emailDelivery.status, "queued");
  const queued = await dbClient.execute({
    sql: `SELECT state,attempt_count,payload_ciphertext,parked_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries
          WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(queued.rows[0]?.state, "pending");
  assert.equal(Number(queued.rows[0]?.attempt_count), 0);
  assert.doesNotMatch(String(queued.rows[0]?.payload_ciphertext), /reviewer@example\.test|rlri_/iu);

  const parked = await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "http://not-a-production-origin.test",
    now,
  });
  assert.deepEqual(
    parked.map(value => value.state),
    ["parked"],
  );
  let stored = await dbClient.execute({
    sql: `SELECT state,attempt_count,parked_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries
          WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.state, "parked");
  assert.equal(Number(stored.rows[0]?.attempt_count), 0);
  assert.ok(stored.rows[0]?.parked_at);

  const sent: Array<{ destinationUrl: string; email: string; invitationId: string }> = [];
  const resumed = await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "https://tokenless.example.test",
    now: new Date(now.getTime() + 60_000),
    send: async input => {
      sent.push(input);
      return { id: "resend_invitation_1" };
    },
  });
  const resumedState = await dbClient.execute({
    sql: `SELECT state,last_error FROM tokenless_workspace_reviewer_invitation_email_deliveries
          WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.deepEqual(
    resumed.map(value => value.state),
    ["delivered"],
    JSON.stringify(resumedState.rows[0]),
  );
  assert.equal(sent[0]?.email, "reviewer@example.test");
  assert.equal(sent[0]?.invitationId, invitation.invitationId);
  assert.equal(
    sent[0]?.destinationUrl,
    buildWorkspaceReviewerInvitationUrl(invitation.token, "https://tokenless.example.test"),
  );
  stored = await dbClient.execute({
    sql: `SELECT state,attempt_count,payload_ciphertext,payload_key_version,provider_message_id
          FROM tokenless_workspace_reviewer_invitation_email_deliveries
          WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.state, "delivered");
  assert.equal(Number(stored.rows[0]?.attempt_count), 1);
  assert.equal(stored.rows[0]?.payload_ciphertext, null);
  assert.equal(stored.rows[0]?.payload_key_version, null);
  assert.equal(stored.rows[0]?.provider_message_id, "resend_invitation_1");
});

test("reviewer invitation email payloads survive artifact wrapping key rotation", () => {
  const v1 = Buffer.alloc(32, 1).toString("base64url");
  const v2 = Buffer.alloc(32, 2).toString("base64url");
  const legacyEnv = {
    TOKENLESS_ARTIFACT_KEY_VERSION: "artifact-v1",
    TOKENLESS_ARTIFACT_MASTER_KEY: v1,
  } as unknown as NodeJS.ProcessEnv;
  const rotatedEnv = {
    TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({ "artifact-v1": v1, "artifact-v2": v2 }),
    TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
  } as unknown as NodeJS.ProcessEnv;
  const input = {
    email: "reviewer@example.test",
    invitationId: "wri_rotation",
    token: `rlri_${"a".repeat(16)}_${"b".repeat(43)}`,
    workspaceId: "workspace_rotation",
  };
  const legacyEnvelope = __workspaceReviewerInvitationEmailTestUtils.encryptPayload(input, legacyEnv);
  assert.equal(legacyEnvelope.keyVersion, "invitation-email-v1:artifact-v1");

  assert.equal(
    __workspaceReviewerInvitationEmailTestUtils.payloadKeyVersion(rotatedEnv),
    "invitation-email-v1:artifact-v2",
  );
  assert.deepEqual(
    __workspaceReviewerInvitationEmailTestUtils.decryptPayload(
      legacyEnvelope.ciphertext,
      {
        invitationId: input.invitationId,
        payloadKeyVersion: "invitation-email-v1:artifact-v1",
        workspaceId: input.workspaceId,
      },
      rotatedEnv,
    ),
    { email: input.email, token: input.token },
  );
  assert.throws(
    () =>
      __workspaceReviewerInvitationEmailTestUtils.decryptPayload(
        legacyEnvelope.ciphertext,
        {
          invitationId: input.invitationId,
          payloadKeyVersion: "invitation-email-v1:retired-key",
          workspaceId: input.workspaceId,
        },
        rotatedEnv,
      ),
    /payload key version is unavailable/u,
  );
  assert.throws(
    () =>
      __workspaceReviewerInvitationEmailTestUtils.decryptPayload(
        `${legacyEnvelope.ciphertext}.extra`,
        {
          invitationId: input.invitationId,
          payloadKeyVersion: legacyEnvelope.keyVersion,
          workspaceId: input.workspaceId,
        },
        rotatedEnv,
      ),
    /payload is invalid/u,
  );
  assert.throws(
    () =>
      __workspaceReviewerInvitationEmailTestUtils.decryptPayload(
        legacyEnvelope.ciphertext,
        {
          invitationId: input.invitationId,
          payloadKeyVersion: legacyEnvelope.keyVersion,
          workspaceId: "another_workspace",
        },
        rotatedEnv,
      ),
    /authenticate data|Unsupported state/iu,
  );
  assert.throws(
    () =>
      __workspaceReviewerInvitationEmailTestUtils.payloadKeyVersion({
        NEXT_PUBLIC_TOKENLESS_ARTIFACT_WRAPPING_KEYS: "{}",
      } as unknown as NodeJS.ProcessEnv),
    /never use NEXT_PUBLIC_/u,
  );
  assert.throws(
    () =>
      __workspaceReviewerInvitationEmailTestUtils.payloadKeyVersion({
        TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
      } as unknown as NodeJS.ProcessEnv),
    /configured together/u,
  );
});

test("retired invitation payload keys stay parked without retry churn", async () => {
  const { workspaceId, owner } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "restricted",
    intendedEmail: "reviewer@example.test",
    now,
  });
  const retiredEnv = {
    TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({
      "artifact-v2": Buffer.alloc(32, 2).toString("base64url"),
    }),
    TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
  } as unknown as NodeJS.ProcessEnv;
  const send = async () => ({ id: "must_not_send" });

  assert.deepEqual(
    await deliverPendingWorkspaceReviewerInvitationEmails({
      appOrigin: "https://tokenless.example.test",
      env: retiredEnv,
      now,
      send,
    }),
    [{ deliveryId: invitation.emailDelivery.deliveryId, state: "parked" }],
  );
  const parked = await dbClient.execute({
    sql: `SELECT state,attempt_count,payload_ciphertext,payload_key_version,parked_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(parked.rows[0]?.state, "parked");
  assert.equal(Number(parked.rows[0]?.attempt_count), 0);
  assert.equal(parked.rows[0]?.payload_key_version, "invitation-email-v1:artifact-v1");

  assert.deepEqual(
    await deliverPendingWorkspaceReviewerInvitationEmails({
      appOrigin: "https://tokenless.example.test",
      env: retiredEnv,
      now: new Date(now.getTime() + 60_000),
      send,
    }),
    [],
  );
  const stillParked = await dbClient.execute({
    sql: `SELECT state,attempt_count,payload_ciphertext,payload_key_version,parked_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.deepEqual(stillParked.rows[0], parked.rows[0]);

  const restoredEnv = {
    TOKENLESS_ARTIFACT_WRAPPING_KEYS: JSON.stringify({
      "artifact-v1": createHash("sha256").update("rateloop-invitation-email-development-only").digest("base64url"),
      "artifact-v2": Buffer.alloc(32, 2).toString("base64url"),
    }),
    TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION: "artifact-v2",
  } as unknown as NodeJS.ProcessEnv;
  const sent: string[] = [];
  assert.deepEqual(
    await deliverPendingWorkspaceReviewerInvitationEmails({
      appOrigin: "https://tokenless.example.test",
      env: restoredEnv,
      now: new Date(now.getTime() + 120_000),
      send: async input => {
        sent.push(input.invitationId);
        return { id: "resend_restored_key" };
      },
    }),
    [{ deliveryId: invitation.emailDelivery.deliveryId, state: "delivered" }],
  );
  assert.deepEqual(sent, [invitation.invitationId]);
  const delivered = await dbClient.execute({
    sql: `SELECT state,payload_ciphertext,payload_key_version
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.deepEqual(delivered.rows[0], {
    payload_ciphertext: null,
    payload_key_version: null,
    state: "delivered",
  });
});

test("reviewer invitation email delivery retries transient failures and dead-letters at its bound", async () => {
  const { workspaceId, owner } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedEmail: "reviewer@example.test",
    now,
  });
  const failingSend = async () => {
    throw new Error("temporary provider failure");
  };
  const first = await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "https://tokenless.example.test",
    now,
    send: failingSend,
  });
  assert.deepEqual(
    first.map(value => value.state),
    ["retry"],
  );
  let stored = await dbClient.execute({
    sql: `SELECT state,attempt_count,next_attempt_at,dead_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.state, "retry");
  assert.equal(Number(stored.rows[0]?.attempt_count), 1);
  assert.ok(new Date(String(stored.rows[0]?.next_attempt_at)) > now);

  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
          SET attempt_count=7,next_attempt_at=? WHERE invitation_id=?`,
    args: [now, invitation.invitationId],
  });
  const terminal = await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "https://tokenless.example.test",
    now,
    send: failingSend,
  });
  assert.deepEqual(
    terminal.map(value => value.state),
    ["dead"],
  );
  stored = await dbClient.execute({
    sql: `SELECT state,attempt_count,next_attempt_at,dead_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.state, "dead");
  assert.equal(Number(stored.rows[0]?.attempt_count), 8);
  assert.equal(stored.rows[0]?.next_attempt_at, null);
  assert.ok(stored.rows[0]?.dead_at);
});

test("expired parked invitation email payloads are suppressed and erased", async () => {
  const { workspaceId, owner } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "confidential",
    intendedEmail: "reviewer@example.test",
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  });
  await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "http://not-a-production-origin.test",
    now,
  });
  const suppressed = await deliverPendingWorkspaceReviewerInvitationEmails({
    appOrigin: "http://not-a-production-origin.test",
    now: new Date(now.getTime() + 60_001),
  });
  assert.deepEqual(
    suppressed.map(value => value.state),
    ["suppressed"],
  );
  const stored = await dbClient.execute({
    sql: `SELECT state,payload_ciphertext,payload_key_version,suppressed_at
          FROM tokenless_workspace_reviewer_invitation_email_deliveries WHERE invitation_id=?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.state, "suppressed");
  assert.equal(stored.rows[0]?.payload_ciphertext, null);
  assert.equal(stored.rows[0]?.payload_key_version, null);
  assert.ok(stored.rows[0]?.suppressed_at);
});

test("reviewer terms acceptance is idempotent and records one immutable event", async () => {
  const { workspaceId, owner, reviewer } = await fixture();
  const now = new Date("2026-07-21T09:00:00.000Z");
  const invitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "internal",
    intendedAccountAddress: reviewer,
    now,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: invitation.token, now });
  const terms = await createWorkspaceReviewerTermsVersion({
    accountAddress: owner,
    workspaceId,
    terms: { confidentiality: "required", exportAllowed: false },
    now,
  });
  const accepted = await acceptWorkspaceReviewerTerms({
    workspaceId,
    termsVersion: terms.version,
    termsHash: terms.termsHash,
    principalAddress: reviewer,
    acceptedFromAssignmentId: "assignment_first",
    now: new Date(now.getTime() + 10_000),
  });
  const replayed = await acceptWorkspaceReviewerTerms({
    workspaceId,
    termsVersion: terms.version,
    termsHash: terms.termsHash,
    principalAddress: reviewer,
    acceptedFromAssignmentId: "assignment_replay",
    now: new Date(now.getTime() + 20_000),
  });

  assert.equal(accepted.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.acceptedAt, accepted.acceptedAt);
  const acceptance = await dbClient.execute({
    sql: `SELECT accepted_from_assignment_id,accepted_at
          FROM tokenless_workspace_reviewer_terms_acceptances
          WHERE workspace_id=? AND terms_version=? AND principal_address=?`,
    args: [workspaceId, terms.version, reviewer],
  });
  assert.equal(acceptance.rows[0]?.accepted_from_assignment_id, "assignment_first");
  const events = await dbClient.execute({
    sql: `SELECT COUNT(*)::int AS count FROM tokenless_workspace_reviewer_events
          WHERE workspace_id=? AND principal_address=? AND event_type='terms_accepted'`,
    args: [workspaceId, reviewer],
  });
  assert.equal(Number(events.rows[0]?.count), 1);
});

test("revocation blocks unused invitations and reviewer removal revokes assignment authority", async () => {
  const { workspaceId, owner, reviewer, outsider } = await fixture();
  const routingGroup = await createPrivateGroup({
    accountAddress: owner,
    workspaceId,
    name: "Review routing",
    purpose: "Internal compatibility routing.",
  });
  const now = new Date("2026-07-21T09:00:00.000Z");
  const revokedInvitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "internal",
    now,
  });
  await revokeWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    invitationId: revokedInvitation.invitationId,
    now,
  });
  await assert.rejects(
    () => redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: revokedInvitation.token, now }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_invitation_unavailable",
  );

  const activeInvitation = await createWorkspaceReviewerInvitation({
    accountAddress: owner,
    workspaceId,
    maxPrivateSensitivity: "regulated",
    intendedAccountAddress: reviewer,
    now,
  });
  await redeemWorkspaceReviewerInvitation({ accountAddress: reviewer, token: activeInvitation.token, now });
  const activeGrant = await dbClient.execute({
    sql: `SELECT grant_hash,revoked_at FROM tokenless_workspace_reviewer_access_grants
          WHERE workspace_id=? AND principal_address=?`,
    args: [workspaceId, reviewer],
  });
  assert.match(String(activeGrant.rows[0]?.grant_hash), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(activeGrant.rows[0]?.revoked_at, null);
  const beforeRemoval = await requireEligibleWorkspaceReviewerGrant({
    workspaceId,
    principalAddress: reviewer,
    projectId: "any-project-under-an-all-project-grant",
    privateSensitivity: "restricted",
    responseDeadline: new Date(now.getTime() + 60_000),
    now,
  });
  assert.equal(beforeRemoval.grantHash, activeGrant.rows[0]?.grant_hash);

  await assert.rejects(
    () =>
      removeWorkspaceReviewer({
        accountAddress: outsider,
        workspaceId,
        principalAddress: reviewer,
        reason: "unauthorized_attempt",
        now: new Date(now.getTime() + 20_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_reviewers_not_found",
  );
  const afterUnauthorizedAttempt = await listWorkspaceReviewers({ accountAddress: owner, workspaceId, now });
  assert.equal(afterUnauthorizedAttempt[0]?.status, "active");

  const removed = await removeWorkspaceReviewer({
    accountAddress: owner,
    workspaceId,
    principalAddress: reviewer,
    reason: "contract_ended",
    now: new Date(now.getTime() + 30_000),
  });
  assert.equal(removed.status, "removed");
  const roster = await listWorkspaceReviewers({
    accountAddress: owner,
    workspaceId,
    now: new Date(now.getTime() + 30_000),
  });
  assert.equal(roster[0]?.status, "removed");
  assert.equal(roster[0]?.grants[0]?.status, "revoked");
  await assert.rejects(
    () =>
      requireEligibleWorkspaceReviewerGrant({
        workspaceId,
        principalAddress: reviewer,
        projectId: "any-project-under-an-all-project-grant",
        privateSensitivity: "internal",
        responseDeadline: new Date(now.getTime() + 60_000),
        now: new Date(now.getTime() + 30_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_reviewer_ineligible",
  );
  const grant = await dbClient.execute({
    sql: `SELECT revoked_at,revoked_by FROM tokenless_workspace_reviewer_access_grants WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.ok(grant.rows[0]?.revoked_at);
  assert.equal(grant.rows[0]?.revoked_by, owner);
  const member = await dbClient.execute({
    sql: "SELECT 1 FROM tokenless_workspace_members WHERE workspace_id=? AND account_address=?",
    args: [workspaceId, reviewer],
  });
  assert.equal(member.rowCount, 0);
  const privateGroupMembership = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [routingGroup.groupId, reviewer],
  });
  assert.equal(privateGroupMembership.rowCount, 0);
});

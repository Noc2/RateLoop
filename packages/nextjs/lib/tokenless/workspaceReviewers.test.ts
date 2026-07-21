import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { type DatabaseResources, __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createPrivateGroup } from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  acceptWorkspaceReviewerTerms,
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
  const compatibilityMembership = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [routingGroup.groupId, reviewer],
  });
  assert.equal(compatibilityMembership.rows[0]?.status, "active");
  const reviewers = await listWorkspaceReviewers({ accountAddress: owner, workspaceId, now });
  assert.equal(reviewers.length, 1);
  assert.equal(reviewers[0]?.principalAddress, reviewer);
  assert.equal(reviewers[0]?.status, "active");
  assert.equal(reviewers[0]?.grants.length, 1);
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
  const compatibilityMembership = await dbClient.execute({
    sql: `SELECT status FROM tokenless_private_group_memberships
          WHERE group_id=? AND principal_address=?`,
    args: [routingGroup.groupId, reviewer],
  });
  assert.equal(compatibilityMembership.rows[0]?.status, "removed");
});

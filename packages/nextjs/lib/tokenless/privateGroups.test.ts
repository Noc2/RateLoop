import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createPrivateGroup,
  createPrivateGroupInvitation,
  createPrivateGroupPolicyVersion,
  previewPrivateGroupInvitation,
  redeemPrivateGroupInvitation,
  removePrivateGroupMember,
  requireActivePrivateGroupMembership,
  revokePrivateGroupInvitation,
} from "~~/lib/tokenless/privateGroups";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const SECOND_REVIEWER = "0x3333333333333333333333333333333333333333";
const OUTSIDER = "0x4444444444444444444444444444444444444444";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function identity(address: string, email: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_browser_identities
          (principal_address, thirdweb_user_id, auth_provider, primary_email, email_verified,
           email_domain, display_name, created_at, updated_at, last_login_at)
          VALUES (?, ?, 'email', ?, true, ?, ?, ?, ?, ?)`,
    args: [address, `thirdweb-${address}`, email, email.split("@")[1], email.split("@")[0], now, now, now],
  });
}

async function fixture() {
  await Promise.all([
    identity(OWNER, "owner@rateloop.test"),
    identity(REVIEWER, "reviewer@example.com"),
    identity(SECOND_REVIEWER, "second@example.com"),
    identity(OUTSIDER, "outsider@elsewhere.test"),
  ]);
  const { workspaceId } = await createWorkspace({ name: "Private assurance", ownerAddress: OWNER });
  const group = await createPrivateGroup({
    accountAddress: OWNER,
    workspaceId,
    name: "Incident response",
    purpose: "Internal review by invited employees.",
    policy: { defaultCompensation: "unpaid", dataClassifications: ["internal"] },
  });
  return { workspaceId, group };
}

test("private groups have immutable policy versions scoped to workspace managers", async () => {
  const { workspaceId, group } = await fixture();
  assert.match(group.policyHash, /^sha256:[a-f0-9]{64}$/);

  const updated = await createPrivateGroupPolicyVersion({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
    policy: { defaultCompensation: "paid", worldIdRequired: true },
  });
  assert.equal(updated.version, 2);
  assert.notEqual(updated.policyHash, group.policyHash);

  const versions = await dbClient.execute({
    sql: `SELECT version, default_compensation, world_id_required, policy_hash, policy_json
          FROM tokenless_private_group_policy_versions WHERE group_id = ? ORDER BY version`,
    args: [group.groupId],
  });
  assert.deepEqual(
    versions.rows.map(row => [Number(row.version), row.default_compensation, row.world_id_required]),
    [
      [1, "unpaid", false],
      [2, "paid", true],
    ],
  );
  assert.equal(
    versions.rows.some(row => String(row.policy_json).includes("retentionDays")),
    false,
  );

  await assert.rejects(
    () =>
      createPrivateGroupPolicyVersion({
        accountAddress: OUTSIDER,
        workspaceId,
        groupId: group.groupId,
        policy: {},
      }),
    /not found/i,
  );
});

test("Free workspaces cannot create a second active private group", async () => {
  const { workspaceId } = await fixture();
  await assert.rejects(
    () =>
      createPrivateGroup({
        accountAddress: OWNER,
        workspaceId,
        name: "Second active group",
        purpose: "This group would exceed the Free plan limit.",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "plan_limit_reached" &&
      "limitType" in error &&
      error.limitType === "active_private_groups",
  );
});

test("invitations persist only a hash, enforce verified bindings, and grant membership independent of invite expiry", async () => {
  const { workspaceId, group } = await fixture();
  const now = Date.now();
  const invitation = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
    intendedEmailDomain: "example.com",
    maximumRedemptions: 2,
    expiresAt: new Date(now + 60 * 60_000),
    membershipExpiresAt: new Date(now + 30 * 86_400_000),
  });
  const stored = await dbClient.execute({
    sql: `SELECT token_hash, token_prefix, intended_email_hash, intended_email_domain
          FROM tokenless_private_group_invitations WHERE invitation_id = ?`,
    args: [invitation.invitationId],
  });
  assert.equal(stored.rows[0]?.token_hash, createHash("sha256").update(invitation.token).digest("hex"));
  assert.equal(stored.rows[0]?.token_prefix, invitation.tokenPrefix);
  assert.equal(stored.rows[0]?.intended_email_hash, null);
  assert.equal(stored.rows[0]?.intended_email_domain, "example.com");
  assert.equal(JSON.stringify(stored.rows[0]).includes(invitation.token), false);

  await assert.rejects(
    () => previewPrivateGroupInvitation({ accountAddress: OUTSIDER, token: invitation.token }),
    /not available to this account/i,
  );
  const preview = await previewPrivateGroupInvitation({ accountAddress: REVIEWER, token: invitation.token });
  assert.equal(preview.groupId, group.groupId);

  const first = await redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: invitation.token });
  assert.equal(first.replay, false);
  const replay = await redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: invitation.token });
  assert.equal(replay.replay, true);
  await redeemPrivateGroupInvitation({ accountAddress: SECOND_REVIEWER, token: invitation.token });
  const replayAfterCap = await redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: invitation.token });
  assert.equal(replayAfterCap.replay, true);

  const membership = await requireActivePrivateGroupMembership({
    accountAddress: REVIEWER,
    groupId: group.groupId,
    now: new Date(now + 2 * 60 * 60_000),
  });
  assert.equal(membership.groupId, group.groupId);
  const count = await dbClient.execute({
    sql: "SELECT redemption_count FROM tokenless_private_group_invitations WHERE invitation_id = ?",
    args: [invitation.invitationId],
  });
  assert.equal(Number(count.rows[0]?.redemption_count), 2);
});

test("revocation and member removal are server-enforced and auditable", async () => {
  const { workspaceId, group } = await fixture();
  const revoked = await createPrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
  });
  await revokePrivateGroupInvitation({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
    invitationId: revoked.invitationId,
  });
  await assert.rejects(
    () => redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: revoked.token }),
    /no longer available/i,
  );

  const active = await createPrivateGroupInvitation({ accountAddress: OWNER, workspaceId, groupId: group.groupId });
  await redeemPrivateGroupInvitation({ accountAddress: REVIEWER, token: active.token });
  await removePrivateGroupMember({
    accountAddress: OWNER,
    workspaceId,
    groupId: group.groupId,
    principalAddress: REVIEWER,
    reason: "employment_ended",
  });
  await assert.rejects(
    () => requireActivePrivateGroupMembership({ accountAddress: REVIEWER, groupId: group.groupId }),
    /not found/i,
  );
  const events = await dbClient.execute({
    sql: `SELECT event_type, details_json FROM tokenless_private_group_events
          WHERE group_id = ? ORDER BY created_at`,
    args: [group.groupId],
  });
  assert.deepEqual(
    events.rows.map(row => row.event_type),
    [
      "group_created",
      "invitation_created",
      "invitation_revoked",
      "invitation_created",
      "invitation_redeemed",
      "membership_removed",
    ],
  );
  assert.equal(String(events.rows.at(-1)?.details_json).includes("employment_ended"), true);
  assert.equal(
    events.rows.some(row => String(row.details_json).includes(active.token)),
    false,
  );
});

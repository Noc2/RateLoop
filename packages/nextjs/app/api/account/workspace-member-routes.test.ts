import { NextRequest } from "next/server";
import { POST as redeemInvitation } from "./workspace-invitations/redeem/route";
import { DELETE as revokeInvitation } from "./workspaces/[workspaceId]/member-invitations/[inviteId]/route";
import { PATCH as changeRole, DELETE as removeMember } from "./workspaces/[workspaceId]/members/[principalId]/route";
import { POST as inviteMember, GET as listMembers } from "./workspaces/[workspaceId]/members/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function authenticatedPrincipal(label: string, email: string) {
  const now = new Date();
  const betterAuthUserId = `better_workspace_route_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id, name, email, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, true, ?, ?)`,
    args: [betterAuthUserId, `Route ${label}`, email, now, now],
  });
  const identity = await resolveBetterAuthPrincipal({ betterAuthUserId, method: "email-otp" });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function browserRequest(
  path: string,
  options: {
    body?: unknown;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    origin?: string;
    token?: string;
  } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

test("workspace member routes invite, redeem, change role, remove, and revoke without crossing into reviewers", async () => {
  const owner = await authenticatedPrincipal("owner", "route-owner@workspace.test");
  const member = await authenticatedPrincipal("member", "route-member@workspace.test");
  const { workspaceId } = await createWorkspace({ name: "Workspace routes", ownerAddress: owner.principalId });
  const membersPath = `/api/account/workspaces/${workspaceId}/members`;
  const membersContext = { params: Promise.resolve({ workspaceId }) };

  const crossOrigin = await inviteMember(
    browserRequest(membersPath, {
      body: { accessRole: "member", intendedEmail: "route-member@workspace.test" },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    membersContext,
  );
  assert.equal(crossOrigin.status, 403);

  const invited = await inviteMember(
    browserRequest(membersPath, {
      body: { accessRole: "member", intendedEmail: "route-member@workspace.test" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    membersContext,
  );
  assert.equal(invited.status, 201);
  assert.equal(invited.headers.get("cache-control"), NO_STORE);
  const invitation = (await invited.json()).invitation as { inviteId: string; token: string };
  assert.match(invitation.token, /^rlwi_/u);

  const pending = await listMembers(browserRequest(membersPath, { token: owner.token }), membersContext);
  assert.equal(pending.status, 200);
  assert.equal(pending.headers.get("cache-control"), NO_STORE);
  const pendingBody = await pending.json();
  assert.equal(pendingBody.viewerPrincipalId, owner.principalId);
  assert.equal(pendingBody.invitations[0].status, "pending");
  assert.equal(JSON.stringify(pendingBody).includes(invitation.token), false);

  const memberDenied = await listMembers(browserRequest(membersPath, { token: member.token }), membersContext);
  assert.equal(memberDenied.status, 404);

  const redeemed = await redeemInvitation(
    browserRequest("/api/account/workspace-invitations/redeem", {
      body: { token: invitation.token },
      method: "POST",
      origin: APP_ORIGIN,
      token: member.token,
    }),
  );
  assert.equal(redeemed.status, 200);

  const memberPath = `${membersPath}/${encodeURIComponent(member.principalId)}`;
  const memberContext = { params: Promise.resolve({ workspaceId, principalId: member.principalId }) };
  const changed = await changeRole(
    browserRequest(memberPath, {
      body: { accessRole: "billing" },
      method: "PATCH",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    memberContext,
  );
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).accessRole, "billing");

  const removed = await removeMember(
    browserRequest(memberPath, { method: "DELETE", origin: APP_ORIGIN, token: owner.token }),
    memberContext,
  );
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).removed, true);
  const reviewerRows = await Promise.all([
    dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_private_group_memberships"),
    dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_cohort_reviewers"),
  ]);
  assert.deepEqual(
    reviewerRows.map(result => Number(result.rows[0]?.count)),
    [0, 0],
  );

  const secondInviteResponse = await inviteMember(
    browserRequest(membersPath, {
      body: { accessRole: "member", intendedEmail: "route-member@workspace.test" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    membersContext,
  );
  const secondInvitation = (await secondInviteResponse.json()).invitation as { inviteId: string; token: string };
  const revokePath = `/api/account/workspaces/${workspaceId}/member-invitations/${secondInvitation.inviteId}`;
  const revoked = await revokeInvitation(
    browserRequest(revokePath, { method: "DELETE", origin: APP_ORIGIN, token: owner.token }),
    { params: Promise.resolve({ workspaceId, inviteId: secondInvitation.inviteId }) },
  );
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).revoked, true);
});

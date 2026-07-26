import { NextRequest } from "next/server";
import { DELETE as leaveReviewerAccess } from "./reviewer-access/[workspaceId]/route";
import { GET as listReviewerAccess } from "./reviewer-access/route";
import { POST as previewReviewerInvitation } from "./reviewer-invitations/preview/route";
import { POST as redeemReviewerInvitation } from "./reviewer-invitations/redeem/route";
import { DELETE as revokeReviewerInvitation } from "./workspaces/[workspaceId]/reviewer-invitations/[invitationId]/route";
import {
  POST as createReviewerInvitation,
  GET as listReviewerInvitations,
} from "./workspaces/[workspaceId]/reviewer-invitations/route";
import { DELETE as removeReviewer } from "./workspaces/[workspaceId]/reviewers/[principalAddress]/route";
import { GET as listReviewers } from "./workspaces/[workspaceId]/reviewers/route";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
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

async function browser(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_reviewer_route_${label}`,
    displayName: `Reviewer ${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function request(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST" | "DELETE"; origin?: string; token?: string } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("workspace reviewer reads are manager-scoped and never cached", () => {
  const reviewers = source("./workspaces/[workspaceId]/reviewers/route.ts");
  const invitations = source("./workspaces/[workspaceId]/reviewer-invitations/route.ts");

  assert.match(reviewers, /requireBrowserSession\(request\)/);
  assert.match(reviewers, /listWorkspaceReviewers/);
  assert.match(reviewers, /accountAddress: session\.principalId/);
  assert.match(reviewers, /workspaceId/);
  assert.match(reviewers, /private, no-store, max-age=0/);

  assert.match(invitations, /requireBrowserSession\(request\)/);
  assert.match(invitations, /listWorkspaceReviewerInvitations/);
  assert.match(invitations, /private, no-store, max-age=0/);
});

test("reviewer invitation creation is same-origin, strict, and preserves the material limit", () => {
  const invitations = source("./workspaces/[workspaceId]/reviewer-invitations/route.ts");

  assert.match(invitations, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(invitations, /Object\.keys\(body\)\.some\(key => !invitationKeys\.has\(key\)\)/);
  assert.match(invitations, /typeof body\.maxPrivateSensitivity !== "string"/);
  assert.match(invitations, /createWorkspaceReviewerInvitation/);
  assert.match(invitations, /maxPrivateSensitivity: body\.maxPrivateSensitivity/);
  assert.match(invitations, /status: 201/);
});

test("reviewer removal and invitation revocation require mutation authorization", () => {
  const reviewer = source("./workspaces/[workspaceId]/reviewers/[principalAddress]/route.ts");
  const invitation = source("./workspaces/[workspaceId]/reviewer-invitations/[invitationId]/route.ts");

  for (const route of [reviewer, invitation]) {
    assert.match(route, /export async function DELETE/);
    assert.match(route, /requireBrowserSession\(request, \{ mutation: true \}\)/);
    assert.match(route, /private, no-store, max-age=0/);
  }
  assert.match(reviewer, /removeWorkspaceReviewer/);
  assert.match(reviewer, /principalAddress/);
  assert.match(invitation, /revokeWorkspaceReviewerInvitation/);
  assert.match(invitation, /invitationId/);
});

test("account reviewer invitation routes delegate only rlri tokens to the workspace reviewer service", () => {
  const preview = source("./reviewer-invitations/preview/route.ts");
  const redeem = source("./reviewer-invitations/redeem/route.ts");

  for (const route of [preview, redeem]) {
    assert.match(route, /requireBrowserSession\(request, \{ mutation: true \}\)/);
    assert.match(route, /Object\.keys\(body\)\.some\(key => key !== "token"\)/);
    assert.match(route, /token: body\.token/);
    assert.match(route, /private, no-store, max-age=0/);
    assert.doesNotMatch(route, /privateGroups|rlgi_|rli_/);
  }
  assert.match(preview, /previewWorkspaceReviewerInvitation/);
  assert.match(redeem, /redeemWorkspaceReviewerInvitation/);
});

test("reviewers can inspect and leave their own workspace reviewer access", () => {
  const access = source("./reviewer-access/route.ts");
  const leave = source("./reviewer-access/[workspaceId]/route.ts");

  assert.match(access, /export async function GET/);
  assert.match(access, /requireBrowserSession\(request\)/);
  assert.match(access, /listMyWorkspaceReviewerAccess/);
  assert.match(access, /accountAddress: session\.principalId/);
  assert.match(access, /private, no-store, max-age=0/);

  assert.match(leave, /export async function DELETE/);
  assert.match(leave, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(leave, /leaveWorkspaceReviewer/);
  assert.match(leave, /accountAddress: session\.principalId/);
  assert.match(leave, /workspaceId/);
  assert.match(leave, /private, no-store, max-age=0/);
});

test("legacy private-group invitation endpoints are absent", () => {
  for (const relativePath of [
    "./private-groups/invitations/preview/route.ts",
    "./private-groups/invitations/redeem/route.ts",
    "./workspaces/[workspaceId]/private-groups/[groupId]/invitations/route.ts",
    "./workspaces/[workspaceId]/private-groups/[groupId]/invitations/[invitationId]/route.ts",
  ]) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, relativePath);
  }
});

test("reviewer routes enforce browser identity, origin, tenant scope, invitation lifecycle, and removal", async () => {
  const owner = await browser("owner");
  const reviewer = await browser("reviewer");
  const outsider = await browser("outsider");
  const { workspaceId } = await createWorkspace({ name: "Reviewer routes", ownerAddress: owner.principalId });
  const invitationsPath = `/api/account/workspaces/${workspaceId}/reviewer-invitations`;
  const reviewersPath = `/api/account/workspaces/${workspaceId}/reviewers`;
  const workspaceContext = { params: Promise.resolve({ workspaceId }) };

  const unauthenticated = await listReviewerInvitations(request(invitationsPath), workspaceContext);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), NO_STORE);

  const hidden = await listReviewers(request(reviewersPath, { token: outsider.token }), workspaceContext);
  assert.equal(hidden.status, 404);

  const crossOrigin = await createReviewerInvitation(
    request(invitationsPath, {
      body: { intendedAccountAddress: reviewer.principalId, maxPrivateSensitivity: "confidential" },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    workspaceContext,
  );
  assert.equal(crossOrigin.status, 403);

  const created = await createReviewerInvitation(
    request(invitationsPath, {
      body: { intendedAccountAddress: reviewer.principalId, maxPrivateSensitivity: "confidential" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    workspaceContext,
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), NO_STORE);
  const createdBody = (await created.json()) as {
    invitation: { invitationId: string; token: string; tokenPrefix: string };
  };
  assert.match(createdBody.invitation.token, /^rlri_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/u);

  const listedInvitations = await listReviewerInvitations(
    request(invitationsPath, { token: owner.token }),
    workspaceContext,
  );
  assert.equal(listedInvitations.status, 200);
  const invitationText = await listedInvitations.text();
  assert.equal(invitationText.includes(createdBody.invitation.token), false);
  assert.equal(invitationText.includes(createdBody.invitation.tokenPrefix), true);

  const outsiderPreview = await previewReviewerInvitation(
    request("/api/account/reviewer-invitations/preview", {
      body: { token: createdBody.invitation.token },
      method: "POST",
      origin: APP_ORIGIN,
      token: outsider.token,
    }),
  );
  assert.equal(outsiderPreview.status, 403);

  const previewed = await previewReviewerInvitation(
    request("/api/account/reviewer-invitations/preview", {
      body: { token: createdBody.invitation.token },
      method: "POST",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(previewed.status, 200);
  assert.equal(
    ((await previewed.json()) as { invitation: { workspaceId: string } }).invitation.workspaceId,
    workspaceId,
  );

  const redeemed = await redeemReviewerInvitation(
    request("/api/account/reviewer-invitations/redeem", {
      body: { token: createdBody.invitation.token },
      method: "POST",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(redeemed.status, 200);
  assert.equal(((await redeemed.json()) as { reviewer: { replay: boolean } }).reviewer.replay, false);

  const access = await listReviewerAccess(request("/api/account/reviewer-access", { token: reviewer.token }));
  assert.equal(access.status, 200);
  assert.equal(
    ((await access.json()) as { reviewerAccess: Array<{ workspaceId: string }> }).reviewerAccess[0]?.workspaceId,
    workspaceId,
  );

  const roster = await listReviewers(request(reviewersPath, { token: owner.token }), workspaceContext);
  assert.equal(roster.status, 200);
  assert.equal(
    ((await roster.json()) as { reviewers: Array<{ principalAddress: string }> }).reviewers[0]?.principalAddress,
    reviewer.principalId,
  );

  const unauthorizedRemoval = await removeReviewer(
    request(`${reviewersPath}/${encodeURIComponent(reviewer.principalId)}`, {
      method: "DELETE",
      origin: APP_ORIGIN,
      token: outsider.token,
    }),
    { params: Promise.resolve({ workspaceId, principalAddress: reviewer.principalId }) },
  );
  assert.equal(unauthorizedRemoval.status, 404);

  const removed = await removeReviewer(
    request(`${reviewersPath}/${encodeURIComponent(reviewer.principalId)}`, {
      method: "DELETE",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    { params: Promise.resolve({ workspaceId, principalAddress: reviewer.principalId }) },
  );
  assert.equal(removed.status, 200);

  const leftAfterRemoval = await leaveReviewerAccess(
    request(`/api/account/reviewer-access/${workspaceId}`, {
      method: "DELETE",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
    { params: Promise.resolve({ workspaceId }) },
  );
  assert.equal(leftAfterRemoval.status, 404);

  const secondInvitation = await createReviewerInvitation(
    request(invitationsPath, {
      body: { intendedAccountAddress: reviewer.principalId, maxPrivateSensitivity: "internal" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    workspaceContext,
  );
  assert.equal(secondInvitation.status, 201);
  const secondBody = (await secondInvitation.json()) as { invitation: { invitationId: string } };
  const revoked = await revokeReviewerInvitation(
    request(`${invitationsPath}/${secondBody.invitation.invitationId}`, {
      method: "DELETE",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    { params: Promise.resolve({ workspaceId, invitationId: secondBody.invitation.invitationId }) },
  );
  assert.equal(revoked.status, 200);
});

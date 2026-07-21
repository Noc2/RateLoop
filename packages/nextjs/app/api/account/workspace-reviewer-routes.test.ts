import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

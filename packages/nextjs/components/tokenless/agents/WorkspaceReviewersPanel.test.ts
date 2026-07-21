import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("./WorkspaceReviewersPanel.tsx", import.meta.url), "utf8");

test("reviewer management has one direct invitation path and states its access boundary", () => {
  assert.match(panel, /Invite reviewer/);
  assert.match(panel, /Reviewers can receive assigned private work\. They do not get workspace access\./);
  assert.match(panel, /Email \(optional\)/);
  assert.match(panel, /Private material limit/);
  assert.match(panel, /maxPrivateSensitivity/);
  assert.match(panel, /OneTimeSecretNotice/);
  assert.doesNotMatch(panel, /Create group|Choose a group|private-groups|PrivateGroupsPanel/);
});

test("reviewer management lists active reviewers and pending invitations with recovery controls", () => {
  assert.match(panel, /Active reviewers/);
  assert.match(panel, /Pending invitations/);
  assert.match(panel, /removeReviewer/);
  assert.match(panel, /revokeInvitation/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /reviewers\/\$\{encodeURIComponent\(reviewer\.principalAddress\)\}/);
  assert.match(panel, /reviewer-invitations\/\$\{encodeURIComponent\(invitation\.invitationId\)\}/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
});

test("reviewer requests are aborted when the workspace changes", () => {
  assert.match(panel, /WorkspaceRequestScope/);
  assert.match(panel, /workspaceRequests\.selectWorkspace\(workspaceId\)/);
  assert.match(panel, /request\.isCurrent\(\)/);
  assert.match(panel, /signal: request\.signal/);
});

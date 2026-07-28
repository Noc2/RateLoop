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
  assert.match(panel, /body: JSON\.stringify\(\{\s*agentId,/u);
  assert.doesNotMatch(panel, /Create group|Choose a group|PrivateGroupsPanel/);
});

test("reviewer management lists active reviewers and pending invitations with recovery controls", () => {
  assert.match(panel, /Active reviewers/);
  assert.match(panel, /Pending invitations/);
  assert.match(panel, /reviewer\.displayName/);
  assert.match(panel, /reviewer\.email/);
  assert.match(panel, /shortPrincipal\(reviewer\.principalAddress\)/);
  assert.match(panel, /removeReviewer/);
  assert.match(panel, /revokeInvitation/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /reviewers\/\$\{encodeURIComponent\(reviewer\.principalAddress\)\}/);
  assert.match(panel, /reviewer-invitations\/\$\{encodeURIComponent\(invitation\.invitationId\)\}/);
  assert.match(panel, /<ConfirmDialog/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
});

test("reviewer requests are aborted when the workspace changes", () => {
  assert.match(panel, /WorkspaceRequestScope/);
  assert.match(panel, /workspaceRequests\.selectWorkspace\(workspaceId\)/);
  assert.match(panel, /request\.isCurrent\(\)/);
  assert.match(panel, /signal: request\.signal/);
});

test("private-material sensitivity errors stay attached to the select", () => {
  assert.match(panel, /<SelectField[\s\S]*error=\{fieldErrors\.maxPrivateSensitivity\}/u);
  assert.match(panel, /clear\("maxPrivateSensitivity"\)/u);
});

test("owners can materialize exact specialist records for active invited reviewers", () => {
  assert.match(panel, /agents\/\$\{encodeURIComponent\(agentId\)\}\/human-review/u);
  assert.match(panel, /reviewer-expertise\/definitions/u);
  assert.match(panel, /confirmReviewerExpertise/u);
  assert.match(panel, /private-groups\/\$\{encodeURIComponent\(\s*expertiseContext\.groupId/u);
  assert.match(panel, /method: "PUT"/u);
  assert.match(panel, /Confirm specialist areas/u);
  assert.match(panel, /definitionVersion/u);
  assert.match(panel, /definitionHash/u);
});

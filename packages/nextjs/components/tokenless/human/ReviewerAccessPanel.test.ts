import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("reviewers can see and leave workspace reviewer access without group concepts", () => {
  const panel = source("./ReviewerAccessPanel.tsx");
  const profile = source("./HumanProfileContent.tsx");

  assert.match(panel, /\/api\/account\/reviewer-access/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /Workspaces you review/);
  assert.match(panel, /Stop reviewing/);
  assert.doesNotMatch(panel, /private.?group|membership/iu);
  assert.match(profile, /<ReviewerAccessPanel refreshKey=\{reviewerAccessRevision\} \/>/);
  assert.match(profile, /kind === "reviewer"/);
  assert.doesNotMatch(profile, /PrivateGroupMembershipsPanel/);
});

test("reviewer invitation routing previews exact access and rejects legacy group codes", () => {
  const invitations = source("../account/InvitationRouterPanel.tsx");

  assert.match(invitations, /reviewer-invitations\/preview/);
  assert.match(invitations, /reviewer-invitations\/redeem/);
  assert.match(invitations, /Invitation expires/);
  assert.match(invitations, /Reviewer access expires/);
  assert.doesNotMatch(invitations, /private-groups|rlgi_/);
  assert.doesNotMatch(invitations, /searchParams|location\.search|localStorage|sessionStorage/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("workspace managers can issue secret-once invitations and revoke access", () => {
  const panel = source("./PrivateGroupsPanel.tsx");

  assert.match(panel, /Purpose \(optional\)/);
  assert.match(panel, /purpose\.trim\(\) \|\| `Private reviews for \$\{name\.trim\(\)\}\.`/);
  assert.match(panel, /<summary[^>]*>Customize policy<\/summary>/);
  assert.ok(panel.indexOf("Customize policy") < panel.indexOf("Default compensation"));
  assert.match(panel, /Recipient email \(optional\)/);
  assert.match(panel, /Leave blank to create a one-use invitation code\./);
  assert.match(panel, /Invitation restrictions/);
  assert.match(panel, /initialWorkspaceId/);
  assert.match(panel, /showWorkspaceSelector/);
  assert.ok(panel.indexOf("Invitation restrictions") < panel.indexOf("Token lifetime \(days\)"));
  assert.match(panel, /Copy this invitation now\. It will not be shown again\./);
  assert.match(panel, /notifications\.success\("Invitation code copied to clipboard\."\)/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /maximumRedemptions/);
  assert.match(panel, /intendedAccountAddress/);
  assert.match(panel, /intendedEmailDomain/);
  assert.match(panel, /Require World ID assurance/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
});

test("workspace managers intend and confirm exact specialist definitions", () => {
  const panel = source("./PrivateGroupsPanel.tsx");

  assert.match(panel, /reviewer-expertise\/definitions/);
  assert.match(panel, /definitionVersion: definition\.version/);
  assert.match(panel, /definitionHash: definition\.hash/);
  assert.match(panel, /Intended specialist areas \(optional\)/);
  assert.match(panel, /required=\{invitationExpertiseIds\.length > 0\}/);
  assert.match(panel, /maximumRedemptions: selectedExpertiseDefinitions\.length > 0 \? 1/);
  assert.match(panel, /expertiseDefinitions: selectedExpertiseDefinitions/);
  assert.match(panel, /expertiseExpiresAt: expertiseExpiresAt\?\.toISOString\(\) \?\? null/);
  assert.match(panel, /365 \* 86_400_000/);
  assert.match(panel, /remain pending after redemption until you confirm the member&apos;s knowledge/);
  assert.match(panel, /pending owner confirmation/);

  assert.match(panel, /Confirm specialist knowledge/);
  assert.match(panel, /RateLoop has not independently verified/);
  assert.match(panel, /Saving replaces any current specialist confirmation/);
  assert.match(panel, /method: "PUT"/);
  assert.match(panel, /members\/\$\{encodeURIComponent\(member\.principalAddress\)\}\/expertise/);
  assert.match(panel, /body: JSON\.stringify\(\{\s+definitions,\s+expiresAt:/);
  assert.match(panel, /Confirmation expires/);
});

test("humans preview an invitation before redemption and can leave memberships", () => {
  const panel = source("../human/PrivateGroupMembershipsPanel.tsx");
  const invitations = source("../account/InvitationRouterPanel.tsx");
  const profile = source("../human/HumanProfileContent.tsx");

  assert.match(invitations, /private-groups\/invitations\/preview/);
  assert.match(invitations, /Accept invitation/);
  assert.match(invitations, /private-groups\/invitations\/redeem/);
  assert.match(invitations, /Invitation expires/);
  assert.match(invitations, /Membership expires/);
  assert.match(panel, /method: "DELETE"/);
  assert.doesNotMatch(invitations, /searchParams|location\.search|localStorage|sessionStorage/);
  assert.match(profile, /<InvitationRouterPanel/);
  assert.match(profile, /<PrivateGroupMembershipsPanel/);
});

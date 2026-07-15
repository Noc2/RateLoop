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
  assert.ok(panel.indexOf("Invitation restrictions") < panel.indexOf("Token lifetime \(days\)"));
  assert.match(panel, /Copy this invitation now\. It will not be shown again\./);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /maximumRedemptions/);
  assert.match(panel, /intendedAccountAddress/);
  assert.match(panel, /intendedEmailDomain/);
  assert.match(panel, /Require World ID assurance/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
});

test("humans preview an invitation before redemption and can leave memberships", () => {
  const panel = source("../human/PrivateGroupMembershipsPanel.tsx");
  const humanPage = source("../../../app/(app)/human/page.tsx");

  assert.match(panel, /private-groups\/invitations\/preview/);
  assert.match(panel, /Confirm membership/);
  assert.match(panel, /Accept and join group/);
  assert.match(panel, /private-groups\/invitations\/redeem/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /Tokens are\s+never\s+read from a URL/);
  assert.doesNotMatch(panel, /searchParams|location\.search|localStorage|sessionStorage/);
  assert.match(humanPage, /<PrivateGroupMembershipsPanel \/>/);
});

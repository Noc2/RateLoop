import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("workspace managers can issue secret-once invitations and revoke access", () => {
  const panel = source("./PrivateGroupsPanel.tsx");
  const agentsPage = source("../../../app/(app)/agents/page.tsx");

  assert.match(panel, /Copy this secret now\. RateLoop will not show it again\./);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /maximumRedemptions/);
  assert.match(panel, /intendedAccountAddress/);
  assert.match(panel, /intendedEmailDomain/);
  assert.match(panel, /Require World ID assurance/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(agentsPage, /tab === "groups" \? <PrivateGroupsPanel \/>/);
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

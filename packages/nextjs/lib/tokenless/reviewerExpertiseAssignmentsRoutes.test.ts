import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const memberRoute = readFileSync(
  new URL(
    "../../app/api/account/workspaces/[workspaceId]/private-groups/[groupId]/members/[principalAddress]/expertise/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const coverageRoute = readFileSync(
  new URL(
    "../../app/api/account/workspaces/[workspaceId]/private-groups/[groupId]/expertise-coverage/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("member expertise replacement requires a mutation-protected browser session", () => {
  assert.match(memberRoute, /export async function PUT/u);
  assert.match(memberRoute, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(memberRoute, /replacePrivateGroupMemberExpertise/u);
});

test("coverage is a private no-store read with requirements in the request body", () => {
  assert.match(coverageRoute, /export async function POST/u);
  assert.match(coverageRoute, /listPrivateGroupExpertiseCoverage/u);
  assert.match(coverageRoute, /requirements: body\.requirements/u);
  assert.match(coverageRoute, /private, no-store, max-age=0/u);
});

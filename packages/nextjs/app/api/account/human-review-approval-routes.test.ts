import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listRoute = readFileSync(
  new URL("./workspaces/[workspaceId]/human-review/approvals/route.ts", import.meta.url),
  "utf8",
);
const decisionRoute = readFileSync(
  new URL("./workspaces/[workspaceId]/human-review/approvals/[approvalId]/route.ts", import.meta.url),
  "utf8",
);

test("approval routes are owner-session, no-store resources and mutations require same-origin protection", () => {
  assert.match(listRoute, /requireBrowserSession\(request\)/);
  assert.match(decisionRoute, /requireBrowserSession\(request, \{ mutation: true \}\)/);
  assert.match(listRoute, /private, no-store, max-age=0/);
  assert.match(decisionRoute, /private, no-store, max-age=0/);
  assert.match(decisionRoute, /decideHumanReviewApprovalForOwner/);
});

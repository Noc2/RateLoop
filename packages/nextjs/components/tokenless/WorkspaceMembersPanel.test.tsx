import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceMembersPanel.tsx", import.meta.url), "utf8");

test("workspace members have a focused invite and management path", () => {
  assert.match(source, /Workspace access/);
  assert.match(source, />\s*Members\s*</);
  assert.match(source, /Invite member/);
  assert.match(source, /People with workspace access/);
  assert.match(source, /Pending invitations/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, />\s*Remove\s*</);
  assert.match(source, />\s*Revoke\s*</);
});

test("workspace member access stays distinct from reviewer management", () => {
  assert.doesNotMatch(source, /reviewer|private group|expertise/i);
  assert.match(source, /member\.accessRole === "owner"/);
  assert.match(source, /member\.managedBy !== null/);
  assert.match(source, /member\.principalId === viewerPrincipalId/);
  assert.match(source, /Managed by/);
});

test("member requests are workspace scoped and invitation secrets are shown once", () => {
  assert.match(source, /new WorkspaceRequestScope\(\)/);
  assert.match(source, /workspaceRequests\.selectWorkspace\(workspaceId\)/);
  assert.match(source, /workspaceRequests\.begin\(workspaceId, "members:load"\)/);
  assert.match(source, /workspaceRequests\.begin\(workspaceId, "members:action"\)/);
  assert.match(source, /OneTimeSecretNotice/);
  assert.match(source, /workspace invitation code/);
});

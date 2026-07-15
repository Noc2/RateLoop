import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const panelFiles = [
  "AgentConnectionPanel.tsx",
  "AgentPublishingPolicyPanel.tsx",
  "AgentRegistryPanel.tsx",
  "AgentReviewPolicyPanel.tsx",
];

test("Agents uses one shared workspace selector for every panel", () => {
  assert.match(source, /Manage one workspace at a time/);
  assert.match(source, /below all use this workspace/);
  assert.match(source, /<AgentConnectionPanel workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentRegistryPanel workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentReviewPolicyPanel workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentPublishingPolicyPanel workspaceId=\{workspaceId\}/);

  for (const file of panelFiles) {
    const panel = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(panel, /fetch\("\/api\/account\/workspaces"/);
  }
});

test("read-only workspaces retain registry access without rendering management panels", () => {
  assert.match(source, /const canManage = workspace\.role === "owner" \|\| workspace\.role === "admin"/);
  assert.match(source, /\{canManage \? <AgentConnectionPanel/);
  assert.match(source, /<AgentRegistryPanel workspaceId=\{workspaceId\} \/>/);
  assert.match(source, /\{canManage \? <AgentReviewPolicyPanel/);
  assert.match(source, /\{canManage \? <AgentPublishingPolicyPanel/);
  assert.match(source, /read-only access to the agent registry/);
});

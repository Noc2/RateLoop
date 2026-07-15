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
  assert.match(source, /<AgentConnectionPanel[\s\S]{0,160}workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentRegistryPanel[\s\S]{0,160}workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentReviewPolicyPanel workspaceId=\{workspaceId\}/);
  assert.match(source, /<AgentPublishingPolicyPanel[\s\S]{0,160}workspaceId=\{workspaceId\}/);

  for (const file of panelFiles) {
    const panel = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(panel, /fetch\("\/api\/account\/workspaces"/);
  }
});

test("read-only workspaces retain registry access without rendering management panels", () => {
  assert.match(source, /const canManage = workspace\.role === "owner" \|\| workspace\.role === "admin"/);
  assert.match(source, /\{canManage \? \([\s\S]{0,40}<AgentConnectionPanel/);
  assert.match(source, /<AgentRegistryPanel/);
  assert.match(source, /\{canManage \? <AgentReviewPolicyPanel/);
  assert.match(source, /\{canManage \? \([\s\S]{0,40}<AgentPublishingPolicyPanel/);
  assert.match(source, /read-only access to the agent registry/);
});

test("agent and publishing mutations refresh dependent panels", () => {
  assert.match(source, /const \[agentRevision, refreshAgents\] = useReducer/);
  assert.match(source, /const \[publishingRevision, refreshPublishingPolicies\] = useReducer/);
  assert.match(source, /onAgentApproved=\{refreshAgents\}/);
  assert.match(source, /onAgentsChanged=\{refreshAgents\}/);
  assert.match(source, /agentRevision=\{agentRevision\}/);
  assert.match(source, /onPoliciesChanged=\{refreshPublishingPolicies\}/);
  assert.match(source, /publishingRevision=\{publishingRevision\}/);
});

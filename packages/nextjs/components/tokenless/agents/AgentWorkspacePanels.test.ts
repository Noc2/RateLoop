import {
  connectedAgentTabs,
  isUsableAgentConnection,
  resolveAvailableAgentTab,
  selectRequestedWorkspace,
} from "./agentWorkspaceState";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelsSource = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../../app/(app)/agents/page.tsx", import.meta.url), "utf8");

test("the requested accessible workspace wins and invalid requests fail closed to the first workspace", () => {
  const workspaces = [
    { workspaceId: "workspace-a", name: "A" },
    { workspaceId: "workspace-b", name: "B" },
  ];

  assert.equal(selectRequestedWorkspace(workspaces, "workspace-b")?.workspaceId, "workspace-b");
  assert.equal(selectRequestedWorkspace(workspaces, "unknown")?.workspaceId, "workspace-a");
  assert.equal(selectRequestedWorkspace([], "workspace-b"), null);
});

test("only active, connected, unexpired integrations complete onboarding", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  assert.equal(isUsableAgentConnection({ status: "active", connectionStatus: "connected" }, now), true);
  assert.equal(isUsableAgentConnection({ status: null, connectionStatus: "connected" }, now), false);
  assert.equal(isUsableAgentConnection({ status: "revoked", connectionStatus: "connected" }, now), false);
  assert.equal(isUsableAgentConnection({ status: "active", connectionStatus: "testing" }, now), false);
  assert.equal(
    isUsableAgentConnection(
      { status: "active", connectionStatus: "connected", expiresAt: "2026-07-15T11:59:59.000Z" },
      now,
    ),
    false,
  );
});

test("connected navigation exposes only sections backed by relevant state", () => {
  assert.deepEqual(connectedAgentTabs(), ["overview", "agents"]);
  assert.deepEqual(connectedAgentTabs({ hasGroups: true }), ["overview", "agents", "groups"]);
  assert.deepEqual(connectedAgentTabs({ hasEvaluations: true }), ["overview", "agents", "evaluations"]);
  assert.equal(resolveAvailableAgentTab("groups", connectedAgentTabs()), "agents");
});

test("the server resolves onboarding before the client renders downstream panels", () => {
  assert.match(pageSource, /listProductWorkspaces\(session\.principalId\)/);
  assert.match(pageSource, /selectRequestedWorkspace\(workspaces, requestedWorkspaceId\)/);
  assert.match(pageSource, /isUsableAgentConnection\(integration\)/);
  assert.match(pageSource, /listPrivateGroups\(/);
  assert.match(pageSource, /getWorkspaceEvaluationDashboard\(/);
  assert.match(pageSource, /initialHasGroups=\{hasGroups\}/);
  assert.match(pageSource, /initialHasEvaluations=\{hasEvaluations\}/);
  assert.doesNotMatch(panelsSource, /fetch\("\/api\/account\/workspaces"/);
  assert.match(panelsSource, /workspaces\.length > 1/);
  assert.match(panelsSource, /return <WorkspaceSettingsClient \/>/);
  assert.match(panelsSource, /\{hasConnectedAgent \? \(/);
  assert.match(panelsSource, /workspaceId=\{workspaceId\}/);
  assert.match(panelsSource, /\{onboarding && canManage \? \(/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "agents"/);
  assert.match(panelsSource, /resolvedTab === "groups"/);
  assert.match(panelsSource, /resolvedTab === "evaluations"/);
});

test("read-only workspaces never render connection or policy mutations", () => {
  assert.match(panelsSource, /const canManage = workspace\.role === "owner" \|\| workspace\.role === "admin"/);
  assert.match(panelsSource, /onboarding && !canManage/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "agents" && canManage/);
});

test("review and autonomous controls render only after a contextual management action", () => {
  assert.match(panelsSource, /const \[managementPanel, setManagementPanel\] = useState/);
  assert.match(panelsSource, /activeManagementPanel=\{managementPanel\}/);
  assert.match(panelsSource, /onManagementPanelChange=\{setManagementPanel\}/);
  assert.match(panelsSource, /managementPanel === "review"/);
  assert.match(panelsSource, /managementPanel === "publishing"/);
});

test("agent and publishing mutations still refresh dependent panels", () => {
  assert.match(panelsSource, /const \[agentRevision, refreshAgents\] = useReducer/);
  assert.match(panelsSource, /const \[publishingRevision, refreshPublishingPolicies\] = useReducer/);
  assert.match(panelsSource, /onAgentApproved=\{refreshAgents\}/);
  assert.match(panelsSource, /onAgentsChanged=\{refreshAgents\}/);
  assert.match(panelsSource, /onPoliciesChanged=\{refreshPublishingPolicies\}/);
});

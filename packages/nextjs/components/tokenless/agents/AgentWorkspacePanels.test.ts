import {
  agentTabHref,
  connectedAgentTabs,
  isUsableAgentConnection,
  nextAgentTabIndex,
  resolveAgentTabParam,
  resolveAvailableAgentTab,
  selectRequestedWorkspace,
} from "./agentWorkspaceState";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelsSource = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const tabsSource = readFileSync(new URL("./AgentTabs.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
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

test("connected navigation splits the owner stack into URL-backed task tabs", () => {
  assert.deepEqual(connectedAgentTabs(), ["overview", "connect", "inbox", "registry", "evaluations", "evidence"]);
  assert.deepEqual(connectedAgentTabs({ canManage: false }), ["overview", "connect", "evaluations", "evidence"]);
  assert.equal(resolveAvailableAgentTab("connect", connectedAgentTabs({ canManage: false })), "connect");
  assert.equal(resolveAgentTabParam("agents"), "connect");
  assert.equal(resolveAgentTabParam("groups"), "registry");
  assert.equal(resolveAgentTabParam("unknown"), "overview");
  assert.equal(agentTabHref("inbox", "workspace one"), "/agents?tab=inbox&workspace=workspace+one");
  assert.match(tabsSource, /value: "overview", label: "Workspace"/);
  assert.match(tabsSource, /value: "connect", label: "Connection"/);
  assert.match(tabsSource, /value: "registry", label: "Reviews"/);
});

test("agent tabs use roving focus and arrow, Home, and End navigation", () => {
  assert.equal(nextAgentTabIndex(0, "ArrowLeft", 6), 5);
  assert.equal(nextAgentTabIndex(5, "ArrowRight", 6), 0);
  assert.equal(nextAgentTabIndex(3, "Home", 6), 0);
  assert.equal(nextAgentTabIndex(2, "End", 6), 5);
  assert.match(tabsSource, /role="tablist"/);
  assert.match(tabsSource, /role="tab"/);
  assert.match(tabsSource, /aria-selected=/);
  assert.match(tabsSource, /tabIndex=\{active === tab\.value \? 0 : -1\}/);
  assert.match(panelsSource, /role="tabpanel"/);
});

test("the active workspace selector shares the tab header and preserves the current tab", () => {
  assert.match(tabsSource, /<span className="sr-only">Active workspace<\/span>/);
  assert.match(tabsSource, /workspaces\.map\(workspace =>/);
  assert.match(tabsSource, /onWorkspaceChange\(event\.target\.value\)/);
  assert.match(panelsSource, /workspaces=\{workspaces\}/);
  assert.match(
    panelsSource,
    /`\/agents\?tab=\$\{encodeURIComponent\(resolvedTab\)\}&workspace=\$\{encodeURIComponent\(nextWorkspaceId\)\}`/,
  );
  assert.equal(panelsSource.match(/<select/g)?.length, 1);
});

test("the server resolves onboarding before the client renders downstream panels", () => {
  assert.match(pageSource, /listProductWorkspaces\(session\.principalId\)/);
  assert.match(pageSource, /selectRequestedWorkspace\(workspaces, requestedWorkspaceId\)/);
  assert.match(pageSource, /getWorkspaceAgentSetup\(/);
  assert.match(pageSource, /requestedStep/);
  assert.doesNotMatch(pageSource, /listPrivateGroups\(/);
  assert.doesNotMatch(pageSource, /getWorkspaceEvaluationDashboard\(/);
  assert.doesNotMatch(panelsSource, /fetch\("\/api\/account\/workspaces"/);
  assert.match(panelsSource, /workspaces\.length > 1/);
  assert.match(panelsSource, /return <WorkspaceSetupStart \/>/);
  assert.match(panelsSource, /initialSetup && !initialSetup\.complete/);
  assert.match(panelsSource, /<AgentSetupFlow initialSetup=\{initialSetup\} \/>/);
  assert.match(panelsSource, /\{hasConnectedAgent \? \(/);
  assert.match(panelsSource, /workspaceId=\{workspaceId\}/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "connect"/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "inbox"/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "registry"/);
  assert.doesNotMatch(panelsSource, /view="connection"|view="reviews"/);
  assert.match(panelsSource, /<AgentReviewsPanel workspaceId=\{workspaceId\} canManage=\{canManage\} \/>/);
  assert.match(panelsSource, /resolvedTab === "evaluations"/);
  assert.match(panelsSource, /resolvedTab === "evidence"/);
});

test("completed read-only workspaces never render connection or policy mutations", () => {
  assert.match(panelsSource, /const canManage = workspace\.role === "owner" \|\| workspace\.role === "admin"/);
  assert.match(panelsSource, /connectedAgentTabs\(\{ canManage \}\)/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "connect" && canManage/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "inbox" && canManage/);
});

test("workspace managers see the human-review approval inbox on the agent task path", () => {
  assert.match(panelsSource, /import \{ HumanReviewApprovalInbox \}/);
  assert.match(panelsSource, /<HumanReviewApprovalInbox workspaceId=\{workspaceId\} \/>/);
});

test("workspace managers see the human-only Feedback Bonus award inbox", () => {
  assert.match(panelsSource, /import \{ FeedbackBonusAwardInbox \}/);
  assert.match(panelsSource, /<FeedbackBonusAwardInbox workspaceId=\{workspaceId\} \/>/);
});

test("the overview starts with workspace settings instead of an evidence summary strip", () => {
  assert.doesNotMatch(panelsSource, /WorkspaceEvidenceSummaryStrip/);
  assert.doesNotMatch(panelsSource, /Last decision packet|Most conservative coverage stage|Latest packet anchor/);
});

test("the Reviews tab opens the canonical human-review editor directly", () => {
  assert.doesNotMatch(panelsSource, /reviewAgentId|onReviewAgentChange|activeReviewAgentId/);
  assert.match(panelsSource, /<AgentReviewsPanel/);
  assert.doesNotMatch(panelsSource, /AgentReviewPolicyPanel|AgentPublishingPolicyPanel/);
  assert.doesNotMatch(editorSource, /Back to reviews|onClose|>\s*Close\s*</);
});

test("review managers use the direct Reviews panel without groups", () => {
  assert.match(panelsSource, /<AgentReviewsPanel workspaceId=\{workspaceId\} canManage=\{canManage\} \/>/);
  assert.doesNotMatch(panelsSource, /PrivateGroupsPanel/);
});

test("agent and human-review mutations still refresh dependent panels", () => {
  assert.match(panelsSource, /const \[agentRevision, refreshAgents\] = useReducer/);
  assert.match(panelsSource, /onAgentApproved=\{refreshAgents\}/);
  assert.match(panelsSource, /onAgentsChanged=\{refreshAgents\}/);
});

test("connection events feed the shared audit history at the bottom of the connection view", () => {
  assert.match(panelsSource, /onConnectionHistoryChange=\{handleConnectionHistoryChange\}/);
  assert.match(panelsSource, /connectionHistory=\{connectionHistory\}/);
  assert.match(panelsSource, /connectionHistoryState\.workspaceId === workspaceId/);
});

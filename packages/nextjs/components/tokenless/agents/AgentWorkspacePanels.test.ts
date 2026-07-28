import {
  agentSignInReturnTo,
  agentTabForSection,
  agentTabHref,
  canStartAgentConnection,
  connectedAgentTabs,
  isUsableAgentConnection,
  legacyAgentRouteHref,
  resolveAgentTabParam,
  resolveAvailableAgentTab,
  selectReconnectableOAuthConnections,
  selectRequestedWorkspace,
} from "./agentWorkspaceState";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelsSource = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const tabsSource = readFileSync(new URL("./AgentTabs.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
const reviewerInvitationSource = readFileSync(new URL("./ReviewerInvitationStart.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../../app/(app)/agents/AgentsSectionPage.tsx", import.meta.url), "utf8");
const legacyPageSource = readFileSync(new URL("../../../app/(app)/agents/page.tsx", import.meta.url), "utf8");
const sectionPageSource = readFileSync(
  new URL("../../../app/(app)/agents/[section]/page.tsx", import.meta.url),
  "utf8",
);

test("the requested accessible workspace wins and invalid returning links require a choice", () => {
  const workspaces = [
    { workspaceId: "workspace-a", name: "A" },
    { workspaceId: "workspace-b", name: "B" },
  ];

  assert.equal(selectRequestedWorkspace(workspaces, "workspace-b")?.workspaceId, "workspace-b");
  assert.equal(selectRequestedWorkspace(workspaces, "unknown"), null);
  assert.equal(selectRequestedWorkspace(workspaces)?.workspaceId, "workspace-a");
  assert.equal(selectRequestedWorkspace([], "workspace-b"), null);
  assert.match(panelsSource, /The workspace in this link is unavailable/);
  assert.doesNotMatch(panelsSource, /find\(entry => entry\.workspaceId === workspaceId\) \?\? workspaces\[0\]/);
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

test("connected workspaces can start another connection when no attempt is pending", () => {
  assert.equal(
    canStartAgentConnection({ loading: false, activeConnectionIntentCount: 0, activePairingCount: 0 }),
    true,
  );
  assert.equal(
    canStartAgentConnection({ loading: false, activeConnectionIntentCount: 1, activePairingCount: 0 }),
    false,
  );
  assert.equal(
    canStartAgentConnection({ loading: false, activeConnectionIntentCount: 0, activePairingCount: 1 }),
    false,
  );
  assert.equal(
    canStartAgentConnection({ loading: true, activeConnectionIntentCount: 0, activePairingCount: 0 }),
    false,
  );
});

test("unusable OAuth integrations reconnect their saved agent unless another usable binding exists", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");
  const connection = (
    overrides: Partial<{
      agentId: string;
      connectionStatus: string;
      expiresAt: string | null;
      integrationId: string;
      oauthClientId: string;
      status: string;
    }> = {},
  ) => ({
    agentId: "agent-a",
    connectionStatus: "connected",
    expiresAt: "2026-07-15T13:00:00.000Z",
    integrationId: "integration-a",
    oauthClientId: "oauth-client",
    status: "active",
    ...overrides,
  });

  assert.deepEqual(
    selectReconnectableOAuthConnections([connection({ connectionStatus: "expired" })], now).map(
      item => item.integrationId,
    ),
    ["integration-a"],
  );
  assert.deepEqual(
    selectReconnectableOAuthConnections([connection({ connectionStatus: "cancelled" })], now).map(
      item => item.integrationId,
    ),
    ["integration-a"],
  );
  assert.deepEqual(
    selectReconnectableOAuthConnections([connection({ expiresAt: "2026-07-15T11:59:59.000Z" })], now).map(
      item => item.integrationId,
    ),
    ["integration-a"],
  );
  assert.deepEqual(selectReconnectableOAuthConnections([connection()], now), []);

  const connections = [
    connection({ connectionStatus: "expired", integrationId: "stale-newest" }),
    connection({ integrationId: "usable-older" }),
  ];
  assert.deepEqual(selectReconnectableOAuthConnections(connections, now), []);
});

test("connected navigation splits the owner stack into URL-backed task tabs", () => {
  assert.deepEqual(connectedAgentTabs(), [
    "overview",
    "connect",
    "inbox",
    "registry",
    "evaluations",
    "evidence",
    "billing",
  ]);
  assert.deepEqual(connectedAgentTabs({ canManage: false }), [
    "overview",
    "connect",
    "evaluations",
    "evidence",
    "billing",
  ]);
  assert.equal(resolveAvailableAgentTab("connect", connectedAgentTabs({ canManage: false })), "connect");
  assert.equal(resolveAgentTabParam("agents"), "connect");
  assert.equal(resolveAgentTabParam("groups"), "registry");
  assert.equal(resolveAgentTabParam("unknown"), "overview");
  assert.equal(agentTabHref("inbox", "workspace one"), "/agents/approvals?workspace=workspace+one");
  assert.equal(agentTabForSection("approvals"), "inbox");
  assert.equal(agentTabForSection("connect"), "connect");
  assert.equal(agentSignInReturnTo({}), "/agents/overview");
  assert.equal(
    agentSignInReturnTo({ returning: "oauth", tab: "evidence", workspaceId: "workspace one", step: "people" }),
    "/agents/evidence?returning=oauth&workspace=workspace+one&step=people",
  );
  assert.equal(
    agentSignInReturnTo({
      tab: "evidence",
      workspaceId: "workspace one",
      evidence: {
        query: "release",
        outcome: "fail",
        date: "30",
        runId: "run one",
        packetId: "packet one",
      },
    }),
    "/agents/evidence?workspace=workspace+one&q=release&outcome=fail&date=30&run=run+one&packet=packet+one",
  );
  assert.equal(
    legacyAgentRouteHref({
      billing: "success",
      date: "30",
      outcome: "fail",
      packet: "packet one",
      q: "release",
      returning: "oauth",
      run: "run one",
      step: "people",
      tab: "evidence",
      workspace: "workspace one",
    }),
    "/agents/evidence?billing=success&date=30&outcome=fail&packet=packet+one&q=release&returning=oauth&run=run+one&step=people&workspace=workspace+one",
  );
  assert.match(pageSource, /returning === "oauth" && !requestedWorkspaceId/);
  assert.match(legacyPageSource, /redirect\(legacyAgentRouteHref\(await searchParams\)\)/);
  assert.match(sectionPageSource, /section !== agentSectionForTab\(tab\)/);
  assert.match(tabsSource, /value: "overview", label: "Overview"/);
  assert.match(tabsSource, /value: "connect", label: "Connections"/);
  assert.match(tabsSource, /value: "inbox", label: "Approvals"/);
  assert.match(tabsSource, /value: "registry", label: "Review setup"/);
  assert.match(tabsSource, /value: "evaluations", label: "Results"/);
  assert.match(tabsSource, /value: "billing", label: "Billing & settings"/);
});

test("agent sections use normal route links instead of tab-widget semantics", () => {
  assert.match(tabsSource, /aria-current=\{active === tab\.value \? "page" : undefined\}/);
  assert.match(tabsSource, /href=\{agentTabHref\(/);
  assert.doesNotMatch(tabsSource, /role="tablist"|role="tab"|aria-selected=|tabIndex=/);
  assert.doesNotMatch(panelsSource, /role="tabpanel"|aria-labelledby=\{`agent-tab-/);
});

test("the active workspace selector keeps a stable row and preserves the current tab", () => {
  assert.match(tabsSource, /<SelectField/);
  assert.match(tabsSource, /label="Active workspace"/);
  assert.match(tabsSource, /labelClassName="sr-only"/);
  assert.match(tabsSource, /overflow-x-auto/);
  assert.match(tabsSource, /min-w-max/);
  assert.doesNotMatch(tabsSource, /flex flex-wrap gap-2/);
  assert.match(tabsSource, /workspaces\.map\(workspace =>/);
  assert.match(tabsSource, /onWorkspaceChange\(event\.target\.value\)/);
  assert.match(panelsSource, /workspaces=\{workspaces\}/);
  assert.match(
    panelsSource,
    /agentTabHref\(resolvedTab, nextWorkspaceId, new URLSearchParams\(searchParams\.toString\(\)\)\)/,
  );
  assert.equal(tabsSource.match(/<select/g)?.length, undefined);
});

test("the server resolves onboarding before the client renders downstream panels", () => {
  assert.match(pageSource, /listProductWorkspaces\(session\.principalId\)/);
  assert.match(pageSource, /selectRequestedWorkspace\(workspaces, requestedWorkspaceId\)/);
  assert.match(pageSource, /getWorkspaceAgentSetup\(/);
  assert.match(pageSource, /requestedStep/);
  assert.match(pageSource, /resolveAvailableAgentTab\(tab, visibleTabs\)/);
  assert.match(pageSource, /redirect\(agentTabHref\(resolvedTab, workspace\.workspaceId, searchParams\)\)/);
  assert.doesNotMatch(pageSource, /listPrivateGroups\(/);
  assert.doesNotMatch(pageSource, /getWorkspaceEvaluationDashboard\(/);
  assert.doesNotMatch(panelsSource, /fetch\("\/api\/account\/workspaces"/);
  assert.match(tabsSource, /workspaces\.map\(workspace =>/);
  assert.match(panelsSource, /return <WorkspaceSetupStart \/>/);
  assert.match(panelsSource, /const setupIncomplete = Boolean\(initialSetup && !initialSetup\.complete\)/);
  assert.match(panelsSource, /<AgentSetupFlow initialSetup=\{initialSetup\} \/>/);
  assert.ok(panelsSource.indexOf("<AgentSetupFlow") < panelsSource.indexOf("<AgentTabs"));
  assert.match(panelsSource, /<AgentTabs/);
  assert.match(panelsSource, /workspaceId=\{workspaceId\}/);
  assert.match(panelsSource, /resolvedTab === "connect" && canManage/);
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
  assert.match(panelsSource, /resolvedTab === "connect" && canManage/);
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

test("actionable oversight alerts live with approvals instead of obscuring results", () => {
  const inboxStart = panelsSource.indexOf('resolvedTab === "inbox"');
  const alerts = panelsSource.indexOf("<OversightAlertsPanel");
  const resultsStart = panelsSource.indexOf('resolvedTab === "evaluations"');

  assert.ok(inboxStart >= 0);
  assert.ok(alerts > inboxStart);
  assert.ok(resultsStart > alerts);
  assert.equal(panelsSource.slice(resultsStart).includes("<OversightAlertsPanel"), false);
});

test("billing has a direct destination and an unconnected workspace starts with connection", () => {
  assert.doesNotMatch(panelsSource, /WorkspaceEvidenceSummaryStrip/);
  assert.doesNotMatch(panelsSource, /Last decision packet|Most conservative coverage stage|Latest packet anchor/);
  assert.match(
    panelsSource,
    /resolvedTab === "billing" \? <WorkspaceSettingsClient initialWorkspaceId=\{workspaceId\} \/>/,
  );
  assert.doesNotMatch(panelsSource, /Connect another agent|Connect an agent/);
  assert.match(panelsSource, /\["connect", "billing"\]/);
});

test("incomplete setup keeps workspace management reachable beside guided setup", () => {
  assert.doesNotMatch(panelsSource, /if \(initialSetup && !initialSetup\.complete\) \{\s*return/);
  assert.match(panelsSource, /setupIncomplete && initialSetup \? <AgentSetupFlow/);
  assert.match(panelsSource, /resolvedTab === "billing"/);
  assert.match(panelsSource, /<WorkspaceSettingsClient initialWorkspaceId=\{workspaceId\} \/>/);
});

test("zero-agent managers can invite reviewers without exposing downstream management", () => {
  assert.match(panelsSource, /const noConnectedAgent = initialSetup \? initialSetup\.agent === null/);
  assert.match(
    panelsSource,
    /noConnectedAgent && canManage \? <ReviewerInvitationStart workspaceId=\{workspaceId\} \/>/,
  );
  assert.ok(panelsSource.indexOf("<AgentSetupFlow") < panelsSource.indexOf("<ReviewerInvitationStart"));
  assert.match(reviewerInvitationSource, /variant="secondary"/);
  assert.match(reviewerInvitationSource, /"Invite reviewers"/);
  assert.doesNotMatch(reviewerInvitationSource, /Invite member|Active reviewers|Pending invitations|private group/i);
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

test("agent versions open from a direct secondary action on the connection view", () => {
  assert.match(panelsSource, /Update agent version/);
  assert.doesNotMatch(panelsSource, /Manage agent versions/);
  assert.match(panelsSource, /aria-controls="agent-version-management"/);
  assert.match(panelsSource, /aria-expanded=\{showAgentManagement\}/);
  assert.match(panelsSource, /showAgentManagement \? \(/);
  assert.match(panelsSource, /<AgentRegistryPanel/);
});

test("connection events feed the shared audit history inside agent version management", () => {
  assert.match(panelsSource, /onConnectionHistoryChange=\{handleConnectionHistoryChange\}/);
  assert.match(panelsSource, /connectionHistory=\{connectionHistory\}/);
  assert.match(panelsSource, /connectionHistoryState\.workspaceId === workspaceId/);
});

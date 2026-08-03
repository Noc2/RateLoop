import {
  agentSignInReturnTo,
  agentSignInReturnToWithHash,
  agentTabForSection,
  agentTabHref,
  agentWorkspaceSwitchSearch,
  canStartAgentConnection,
  connectedAgentTabs,
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
const registrySource = readFileSync(new URL("./AgentRegistryPanel.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./AgentHumanReviewEditor.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(
  new URL("../../../app/[locale]/(app)/agents/AgentsSectionPage.tsx", import.meta.url),
  "utf8",
);
const legacyPageSource = readFileSync(new URL("../../../app/[locale]/(app)/agents/page.tsx", import.meta.url), "utf8");
const sectionPageSource = readFileSync(
  new URL("../../../app/[locale]/(app)/agents/[section]/page.tsx", import.meta.url),
  "utf8",
);
const englishAgents = JSON.parse(
  readFileSync(new URL("../../../messages/en/agents.json", import.meta.url), "utf8"),
) as {
  tabs: Record<string, string>;
};
const germanAgents = JSON.parse(readFileSync(new URL("../../../messages/de/agents.json", import.meta.url), "utf8")) as {
  tabs: Record<string, string>;
};

test("the requested accessible workspace wins and invalid returning links require a choice", () => {
  const workspaces = [
    { workspaceId: "workspace-a", name: "A" },
    { workspaceId: "workspace-b", name: "B" },
  ];

  assert.equal(selectRequestedWorkspace(workspaces, "workspace-b")?.workspaceId, "workspace-b");
  assert.equal(selectRequestedWorkspace(workspaces, "unknown"), null);
  assert.equal(selectRequestedWorkspace(workspaces)?.workspaceId, "workspace-a");
  assert.equal(selectRequestedWorkspace([], "workspace-b"), null);
  assert.match(panelsSource, /t\("chooseDescription"\)/);
  assert.doesNotMatch(panelsSource, /find\(entry => entry\.workspaceId === workspaceId\) \?\? workspaces\[0\]/);
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
  const connection = (
    overrides: Partial<{
      access: {
        credentialKind: "oauth" | "legacy";
        rateLoopAccessState: "active" | "inactive" | "recovery_required";
        hostToolReadiness: "unverified";
        canPublish: boolean;
        canSpend: boolean;
      };
      agentId: string;
      integrationId: string;
      oauthClientId: string;
    }> = {},
  ) => ({
    access: {
      credentialKind: "oauth" as const,
      rateLoopAccessState: "active" as const,
      hostToolReadiness: "unverified" as const,
      canPublish: false,
      canSpend: false,
    },
    agentId: "agent-a",
    integrationId: "integration-a",
    oauthClientId: "oauth-client",
    ...overrides,
  });
  const inactiveAccess = {
    credentialKind: "oauth" as const,
    rateLoopAccessState: "inactive" as const,
    hostToolReadiness: "unverified" as const,
    canPublish: false,
    canSpend: false,
  };

  assert.deepEqual(
    selectReconnectableOAuthConnections([connection({ access: inactiveAccess })]).map(item => item.integrationId),
    ["integration-a"],
  );
  assert.deepEqual(selectReconnectableOAuthConnections([connection()]), []);
  assert.deepEqual(
    selectReconnectableOAuthConnections([
      connection({ access: { ...inactiveAccess, rateLoopAccessState: "recovery_required" } }),
    ]),
    [],
  );

  const connections = [
    connection({ access: inactiveAccess, integrationId: "stale-newest" }),
    connection({
      access: { ...inactiveAccess, credentialKind: "legacy", rateLoopAccessState: "active" },
      integrationId: "usable-older",
      oauthClientId: "",
    }),
  ];
  assert.deepEqual(selectReconnectableOAuthConnections(connections), []);
});

test("connected navigation splits the owner stack into URL-backed task tabs", () => {
  assert.deepEqual(connectedAgentTabs(), ["overview", "connect", "inbox", "registry", "evaluations", "billing"]);
  assert.deepEqual(connectedAgentTabs({ canManage: false }), ["overview", "connect", "evaluations", "billing"]);
  assert.equal(resolveAvailableAgentTab("connect", connectedAgentTabs({ canManage: false })), "connect");
  assert.equal(resolveAgentTabParam("agents"), "connect");
  assert.equal(resolveAgentTabParam("groups"), "registry");
  assert.equal(resolveAgentTabParam("evidence"), "evaluations");
  assert.equal(resolveAgentTabParam("unknown"), "overview");
  assert.equal(agentTabHref("inbox", "workspace one"), "/agents/approvals?workspace=workspace+one");
  assert.equal(agentTabForSection("approvals"), "inbox");
  assert.equal(agentTabForSection("connect"), "connect");
  assert.equal(agentTabForSection("evidence"), "evaluations");
  assert.equal(agentSignInReturnTo({}), "/agents/overview");
  assert.equal(
    agentSignInReturnTo({ returning: "oauth", tab: "evidence", workspaceId: "workspace one", step: "people" }),
    "/agents/results?returning=oauth&workspace=workspace+one&step=people",
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
    "/agents/results?workspace=workspace+one&q=release&outcome=fail&date=30&run=run+one&packet=packet+one",
  );
  assert.equal(
    agentSignInReturnTo({
      tab: "connect",
      searchParams: {
        workspace: "workspace one",
        agent: "agent one",
        version: "version one",
      },
    }),
    "/agents/connections?workspace=workspace+one&agent=agent+one&version=version+one",
  );
  assert.equal(
    agentSignInReturnToWithHash("/agents/results?workspace=workspace+one", "#evidence-packets-heading"),
    "/agents/results?workspace=workspace+one#evidence-packets-heading",
  );
  assert.equal(
    agentSignInReturnToWithHash("/agents/results?workspace=workspace+one", "#private-fragment"),
    "/agents/results?workspace=workspace+one",
  );
  assert.equal(
    agentWorkspaceSwitchSearch(
      new URLSearchParams(
        "workspace=old&run=run-1&packet=packet-1&resultRun=run-1&resultProject=project-1&resultAgent=agent-1&resultWorkflow=checkout&q=release&outcome=fail&date=30",
      ),
    ).toString(),
    "workspace=old&q=release&outcome=fail&date=30",
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
    "/agents/results?billing=success&date=30&outcome=fail&packet=packet+one&q=release&returning=oauth&run=run+one&step=people&workspace=workspace+one",
  );
  assert.match(pageSource, /returning === "oauth" && !requestedWorkspaceId/);
  assert.match(legacyPageSource, /redirect\(\{ href: legacyAgentRouteHref\(requestedSearchParams\), locale \}\)/);
  assert.match(sectionPageSource, /section !== agentSectionForTab\(tab\)/);
  assert.match(
    tabsSource,
    /const tabs: AgentTab\[\] = \["overview", "connect", "inbox", "registry", "evaluations", "billing"\]/,
  );
  assert.match(tabsSource, /\{t\(tab\)\}/);
  assert.doesNotMatch(tabsSource, /value: "evidence"|label: "Evidence"/);
});

test("agent sections use normal route links instead of tab-widget semantics", () => {
  assert.match(tabsSource, /aria-current=\{active === tab \? "page" : undefined\}/);
  assert.match(tabsSource, /href=\{agentTabHref\(/);
  assert.doesNotMatch(tabsSource, /role="tablist"|role="tab"|aria-selected=|tabIndex=/);
  assert.doesNotMatch(panelsSource, /role="tabpanel"|aria-labelledby=\{`agent-tab-/);
});

test("registered-agent search links open and focus the exact workflow version", () => {
  assert.match(panelsSource, /searchParams\.get\("agent"\)/);
  assert.match(panelsSource, /searchParams\.get\("version"\)/);
  assert.match(panelsSource, /selectedAgentId=\{selectedAgentId\}/);
  assert.match(panelsSource, /selectedVersionId=\{selectedVersionId\}/);
  assert.match(registrySource, /agent\.versions\.find\(version => version\.versionId === selectedVersionId\)/);
  assert.match(registrySource, /registered-agent-\$\{selectedAgentId\}/);
  assert.match(registrySource, /<AgentText id="translated094" \/>/);
});

test("concise agent tabs and the workspace selector share one desktop row", () => {
  assert.equal(englishAgents.tabs.registry, "Review");
  assert.equal(englishAgents.tabs.billing, "Settings");
  assert.equal(germanAgents.tabs.registry, "Prüfung");
  assert.equal(germanAgents.tabs.billing, "Einstellungen");
  assert.match(tabsSource, /<SelectField/);
  assert.match(tabsSource, /label=\{t\("workspace"\)\}/);
  assert.match(tabsSource, /labelClassName="sr-only"/);
  assert.match(tabsSource, /space-y-3 lg:flex lg:items-center lg:gap-3 lg:space-y-0/);
  assert.match(tabsSource, /overflow-x-auto/);
  assert.match(tabsSource, /lg:flex-1/);
  assert.match(tabsSource, /min-w-max/);
  assert.doesNotMatch(tabsSource, /lg:flex-wrap/);
  assert.match(tabsSource, /<div className="flex justify-end lg:shrink-0">\s*<SelectField/s);
  assert.doesNotMatch(tabsSource, /flex flex-wrap gap-2/);
  assert.match(tabsSource, /workspaces\.map\(workspace =>/);
  assert.match(tabsSource, /onWorkspaceChange\(event\.target\.value\)/);
  assert.match(panelsSource, /workspaces=\{workspaces\}/);
  assert.match(
    panelsSource,
    /agentTabHref\(resolvedTab, nextWorkspaceId, agentWorkspaceSwitchSearch\(searchParams\)\)/,
  );
  assert.equal(tabsSource.match(/<select/g)?.length, undefined);
});

test("agent-version management is identified by its heading and action", () => {
  assert.match(panelsSource, /t\("versionsTitle"\)/);
  assert.match(panelsSource, /t\("updateVersion"\)/);
  assert.doesNotMatch(panelsSource, /versionsDescription/);
});

test("the server resolves onboarding before the client renders downstream panels", () => {
  assert.match(pageSource, /listProductWorkspaces\(session\.principalId\)/);
  assert.match(pageSource, /selectRequestedWorkspace\(workspaces, requestedWorkspaceId\)/);
  assert.match(pageSource, /getWorkspaceAgentSetup\(/);
  assert.match(pageSource, /requestedStep/);
  assert.match(pageSource, /resolveAvailableAgentTab\(tab, visibleTabs\)/);
  assert.match(
    pageSource,
    /redirect\(\{ href: agentTabHref\(resolvedTab, workspace\.workspaceId, searchParams\), locale \}\)/,
  );
  assert.doesNotMatch(pageSource, /listPrivateGroups\(/);
  assert.doesNotMatch(pageSource, /getWorkspaceEvaluationDashboard\(/);
  assert.doesNotMatch(panelsSource, /fetch\("\/api\/account\/workspaces"/);
  assert.match(tabsSource, /workspaces\.map\(workspace =>/);
  assert.match(panelsSource, /return <WorkspaceSetupStart \/>/);
  assert.match(panelsSource, /const setupIncomplete = Boolean\(initialSetup && !initialSetup\.complete\)/);
  assert.match(panelsSource, /<AgentSetupFlow initialSetup=\{initialSetup\} \/>/);
  assert.match(panelsSource, /<AfterGuidedAgentSetup setupIncomplete=\{setupIncomplete\}>/);
  assert.ok(panelsSource.indexOf("<AgentTabs") < panelsSource.indexOf("<WorkspaceStopBanner"));
  assert.ok(panelsSource.indexOf("<AgentTabs") < panelsSource.indexOf("<AgentSetupFlow"));
  assert.match(panelsSource, /<AgentTabs/);
  assert.match(panelsSource, /workspaceId=\{workspaceId\}/);
  assert.match(panelsSource, /resolvedTab === "connect" && canManage/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "inbox"/);
  assert.match(panelsSource, /hasConnectedAgent && resolvedTab === "registry"/);
  assert.doesNotMatch(panelsSource, /view="connection"|view="reviews"/);
  assert.match(panelsSource, /<AgentReviewsPanel workspaceId=\{workspaceId\} canManage=\{canManage\} \/>/);
  assert.match(panelsSource, /resolvedTab === "evaluations"/);
  assert.match(
    panelsSource,
    /resolvedTab === "evaluations"[\s\S]*<EvaluationDashboardPanel[\s\S]*<EvidenceWorkspacePanel/,
  );
  assert.doesNotMatch(panelsSource, /resolvedTab === "evidence"/);
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
  assert.match(panelsSource, /<AfterGuidedAgentSetup setupIncomplete=\{setupIncomplete\}>/);
  assert.match(panelsSource, /resolvedTab === "billing"/);
  assert.match(panelsSource, /<WorkspaceSettingsClient initialWorkspaceId=\{workspaceId\} \/>/);
});

test("zero-agent setup stays focused without a reviewer invitation banner above the route content", () => {
  assert.doesNotMatch(panelsSource, /ReviewerInvitationStart|You can invite reviewers now/);
});

test("agent tabs remain the visible route identity while every completed-workspace route has an accessible h1", () => {
  assert.doesNotMatch(pageSource, /PageHeading|agentPageTitle/);
  assert.match(panelsSource, /const tabLabels = useAgentTranslations\("tabs"\)/);
  assert.match(panelsSource, /!setupIncomplete \? <h1 className="sr-only">\{tabLabels\(resolvedTab\)\}<\/h1> : null/);
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
  assert.match(panelsSource, /t\("updateVersion"\)/);
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

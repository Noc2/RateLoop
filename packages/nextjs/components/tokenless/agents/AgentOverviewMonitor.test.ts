import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AgentOverviewMonitor.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../../../app/api/account/workspaces/[workspaceId]/agents/overview/route.ts", import.meta.url),
  "utf8",
);
const projectionSource = readFileSync(new URL("../../../lib/tokenless/agentOverview.ts", import.meta.url), "utf8");

test("the connected-agent overview mounts the fixed monitor", () => {
  assert.match(workspaceSource, /<AgentOverviewMonitor workspaceId=\{workspaceId\} \/>/);
  assert.match(source, /Completed decisions/);
  assert.match(source, /Reviewer endorsement/);
  assert.match(source, /Median time to decision/);
  assert.match(source, /Cost per decision/);
  assert.match(source, /overview\.window\.label/);
  assert.match(source, /Review outcome trend/);
  assert.match(source, /Decision-time trend/);
  assert.match(source, /Review quality/);
  assert.match(source, /Reviewer consensus/);
  assert.match(source, /Reviewer consistency \(α\)/);
  assert.match(source, /Panel-split distribution/);
  assert.match(source, /Workflow hotspots/);
  assert.match(source, /Risk-tier hotspots/);
  assert.match(source, /Time to decision/);
  assert.match(source, /overview\.reviewQuality/);
  assert.match(source, /overview\.attention\.periodLabel/);
  assert.match(source, /Low confidence/);
  assert.match(source, /Insufficient evidence/);
  assert.match(source, /onPageChange=\{page => updateQuery\(\{ page \}\)\}/);
  assert.match(source, /All workflows/);
  assert.match(source, /All risk tiers/);
  assert.match(source, /All stages/);
  assert.match(source, /All current versions/);
  assert.match(source, /agentOverviewApiSearch/);
  assert.match(source, /hasPreviousPage/);
  assert.match(source, /hasNextPage/);
  assert.match(routeSource, /parseAgentOverviewUrlState\(request\.nextUrl\.searchParams\)/);
  assert.match(routeSource, /workspaceId, query/);
});

test("overview parent and child records are bounded at the data source", () => {
  assert.match(projectionSource, /LIMIT \? OFFSET \?/);
  assert.match(projectionSource, /scope\.scope_rank<=\?/);
  assert.match(projectionSource, /MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT/);
  assert.match(projectionSource, /SELECT candidates\.\*,COUNT\(\*\) OVER\(\) AS total_item_count/);
  assert.match(projectionSource, /LIMIT 6/);
  assert.doesNotMatch(projectionSource, /listWorkspaceAgents/);
});

test("review quality loads only after workspace membership is authorized", () => {
  const access = projectionSource.indexOf("await requireAgentOverviewAccess");
  const quality = projectionSource.indexOf("loadAgentReviewQuality", access);
  assert.ok(access >= 0);
  assert.ok(quality > access);
});

test("production overview defaults to current versions with active assurance bindings and policies", () => {
  assert.match(projectionSource, /current_versions AS/);
  assert.match(projectionSource, /binding\.enabled=true AND binding\.superseded_at IS NULL/);
  assert.match(projectionSource, /policy\.enabled=true AND policy\.superseded_at IS NULL/);
  assert.match(projectionSource, /scope\.human_review_binding_id=review\.binding_id/);
  assert.match(projectionSource, /scope\.policy_id=review\.policy_id/);
});

test("agent-version parents disclose bounded scope evidence without reviewer axes or a scope average", () => {
  assert.match(source, /Parent rows show scope composition and the lowest observed scope\s*bound,\s*never an average/);
  assert.match(source, /overview\.agentVersions\.parents\.map/);
  assert.match(source, /parent\.lowestEndorsement\.lower95Bps/);
  assert.match(source, /parent\.scopes\.map/);
  assert.doesNotMatch(source, /reviewer(Id|Key|Email|Account)|reviewerPseudonym/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  agentOverviewApiSearch,
  parseAgentOverviewUrlState,
  updateAgentOverviewUrlSearch,
} from "~~/lib/tokenless/agentOverviewUrlState";

test("overview URL state defaults to 30 days and rejects malformed filters", () => {
  assert.deepEqual(parseAgentOverviewUrlState(""), {
    period: "30",
    workflow: null,
    riskTier: null,
    stage: null,
    versionId: null,
    page: 1,
  });
  assert.deepEqual(
    parseAgentOverviewUrlState(`period=14&overviewStage=unknown&overviewWorkflow=${"x".repeat(257)}&overviewPage=-2`),
    {
      period: "30",
      workflow: null,
      riskTier: null,
      stage: null,
      versionId: null,
      page: 1,
    },
  );
});

test("overview filters and period round-trip without dropping unrelated navigation state", () => {
  const search = updateAgentOverviewUrlSearch(
    "workspace=workspace-a&billing=success&overviewAgent=stale-agent&overviewScope=stale-scope",
    {
      period: "90",
      workflow: "refund-review",
      riskTier: "high",
      stage: "monitoring",
      versionId: "version-3",
      page: 2,
    },
  );
  const params = new URLSearchParams(search);
  assert.equal(params.get("workspace"), "workspace-a");
  assert.equal(params.get("billing"), "success");
  assert.equal(params.get("period"), "90");
  assert.equal(params.get("overviewPage"), "2");
  assert.equal(params.has("overviewAgent"), false);
  assert.equal(params.has("overviewScope"), false);
  assert.deepEqual(parseAgentOverviewUrlState(params), {
    period: "90",
    workflow: "refund-review",
    riskTier: "high",
    stage: "monitoring",
    versionId: "version-3",
    page: 2,
  });
});

test("overview API search contains only validated overview state and omits defaults", () => {
  assert.equal(agentOverviewApiSearch(parseAgentOverviewUrlState("workspace=workspace-a")), "");
  assert.equal(
    agentOverviewApiSearch(parseAgentOverviewUrlState("period=lifetime&overviewRisk=high&overviewPage=3")),
    "period=lifetime&overviewRisk=high&page=3",
  );
});

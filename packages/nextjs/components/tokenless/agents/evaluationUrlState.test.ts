import {
  DEFAULT_EVALUATION_URL_STATE,
  evaluationUrlHref,
  parseEvaluationUrlState,
  updateEvaluationUrlSearch,
} from "./evaluationUrlState";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("./EvaluationDashboardPanel.tsx", import.meta.url), "utf8");
const evidenceSource = readFileSync(new URL("./EvidenceWorkspacePanel.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../../../app/api/account/workspaces/[workspaceId]/evaluations/route.ts", import.meta.url),
  "utf8",
);

test("evaluation result URL state defaults invalid filters and bounds user input", () => {
  assert.deepEqual(parseEvaluationUrlState(""), DEFAULT_EVALUATION_URL_STATE);
  assert.deepEqual(
    parseEvaluationUrlState(
      `?resultQ=${"q".repeat(140)}&resultProject=project-1&resultAgent=agent-1&resultWorkflow=checkout&resultStatus=unknown&resultDate=365&resultRun=run-1`,
    ),
    {
      query: "q".repeat(120),
      projectId: "project-1",
      agentId: "agent-1",
      workflowKey: "checkout",
      status: "all",
      date: "all",
      runId: "run-1",
    },
  );
});

test("evaluation result URL updates preserve workspace and unrelated route state", () => {
  const search = updateEvaluationUrlSearch("?workspace=workspace-1&returning=oauth", {
    query: "release gate",
    projectId: "project-1",
    agentId: "agent-1",
    workflowKey: "checkout",
    status: "failed",
    date: "30",
    runId: "run-1",
  });

  assert.equal(
    search,
    "workspace=workspace-1&returning=oauth&resultQ=release+gate&resultProject=project-1&resultAgent=agent-1&resultWorkflow=checkout&resultStatus=failed&resultDate=30&resultRun=run-1",
  );
  assert.equal(
    evaluationUrlHref({
      pathname: "/agents/results",
      search,
      hash: "#run-1",
      patch: {
        query: "",
        projectId: "",
        agentId: "",
        workflowKey: "",
        status: "all",
        date: "all",
        runId: null,
      },
    }),
    "/agents/results?workspace=workspace-1&returning=oauth#run-1",
  );
});

test("addressable result and evidence views request an exact older run through the authorized route", () => {
  assert.match(dashboardSource, /requestedSelection\.set\("run", urlState\.runId\)/u);
  assert.match(dashboardSource, /requestedSelection\.set\("project", urlState\.projectId\)/u);
  assert.match(evidenceSource, /\?run=\$\{encodeURIComponent\(requestedRunId\)\}/u);
  assert.match(routeSource, /request\.nextUrl\.searchParams\.get\("run"\)/u);
  assert.match(routeSource, /request\.nextUrl\.searchParams\.get\("project"\)/u);
  assert.match(routeSource, /requestedRunId/u);
});

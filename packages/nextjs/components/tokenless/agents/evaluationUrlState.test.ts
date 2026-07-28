import {
  DEFAULT_EVALUATION_URL_STATE,
  evaluationUrlHref,
  parseEvaluationUrlState,
  updateEvaluationUrlSearch,
} from "./evaluationUrlState";
import assert from "node:assert/strict";
import test from "node:test";

test("evaluation result URL state defaults invalid filters and bounds user input", () => {
  assert.deepEqual(parseEvaluationUrlState(""), DEFAULT_EVALUATION_URL_STATE);
  assert.deepEqual(
    parseEvaluationUrlState(
      `?resultQ=${"q".repeat(140)}&resultAgent=agent-1&resultWorkflow=checkout&resultStatus=unknown&resultDate=365&resultRun=run-1`,
    ),
    {
      query: "q".repeat(120),
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
    agentId: "agent-1",
    workflowKey: "checkout",
    status: "failed",
    date: "30",
    runId: "run-1",
  });

  assert.equal(
    search,
    "workspace=workspace-1&returning=oauth&resultQ=release+gate&resultAgent=agent-1&resultWorkflow=checkout&resultStatus=failed&resultDate=30&resultRun=run-1",
  );
  assert.equal(
    evaluationUrlHref({
      pathname: "/agents/results",
      search,
      hash: "#run-1",
      patch: {
        query: "",
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

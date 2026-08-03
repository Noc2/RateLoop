import {
  evaluationRunNeedsDecision,
  evaluationRunPresentationStatus,
  evaluationRunResultState,
  evaluationRunTerminalOutcome,
} from "./evaluationRunPresentation";
import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRun } from "~~/lib/tokenless/evaluationDashboard";

function run(overrides: Partial<EvaluationRun> = {}): EvaluationRun {
  return {
    runId: "run-1",
    projectId: "project-1",
    projectName: "Release gate",
    suiteId: "suite-1",
    suiteVersion: 1,
    suiteName: "Support replies",
    status: "review_requested",
    workflowKey: null,
    riskTier: null,
    failureSummary: null,
    reviewerSource: "rateloop_network",
    compensation: "paid",
    caseCount: 1,
    calibrationCaseCount: 0,
    mechanismHealth: null,
    validResponses: 0,
    distinctReviewers: 0,
    minimumAggregationSize: 3,
    sampleStatus: "suppressed",
    candidateSelectionShareBps: null,
    candidateSelectionIntervalBps: null,
    choices: null,
    clientDecision: null,
    evidencePacketAvailable: false,
    evidencePacketDigest: null,
    explanationRequired: false,
    createdAt: "2026-08-03T00:00:00.000Z",
    completedAt: null,
    attribution: { status: "unattributed", agentId: null, versionId: null },
    ...overrides,
  };
}

test("terminal outcome classification covers every displayed run status", () => {
  assert.equal(evaluationRunTerminalOutcome("completed"), "completed");
  assert.equal(evaluationRunTerminalOutcome("cancelled"), "completed");
  assert.equal(evaluationRunTerminalOutcome("failed"), "failed");
  assert.equal(evaluationRunTerminalOutcome("dead"), "failed");
  assert.equal(evaluationRunTerminalOutcome("review_requested"), null);
});

test("presentation status and result state share the terminal classification", () => {
  assert.equal(evaluationRunPresentationStatus(run()), "waiting");
  assert.equal(evaluationRunResultState(run()), "waiting");

  assert.equal(evaluationRunPresentationStatus(run({ status: "cancelled" })), "completed");
  assert.equal(evaluationRunResultState(run({ status: "cancelled" })), "insufficient");

  assert.equal(evaluationRunPresentationStatus(run({ status: "dead" })), "failed");
  assert.equal(evaluationRunResultState(run({ status: "dead" })), "failed");

  const decidable = run({ status: "completed", evidencePacketAvailable: true });
  assert.equal(evaluationRunNeedsDecision(decidable), true);
  assert.equal(evaluationRunPresentationStatus(decidable), "needs_action");
  assert.equal(evaluationRunResultState(decidable), "insufficient");

  assert.equal(evaluationRunResultState(run({ candidateSelectionShareBps: 5_500 })), "candidate");
});

import type { EvaluationRun } from "~~/lib/tokenless/evaluationDashboard";

export type EvaluationRunTerminalOutcome = "completed" | "failed" | null;
export type EvaluationRunPresentationStatus = "needs_action" | "completed" | "failed" | "waiting";

export function evaluationRunTerminalOutcome(status: string): EvaluationRunTerminalOutcome {
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "failed" || status === "dead") return "failed";
  return null;
}

export function evaluationRunNeedsDecision(run: EvaluationRun) {
  return run.status === "completed" && run.evidencePacketAvailable && !run.clientDecision;
}

export function evaluationRunPresentationStatus(run: EvaluationRun): EvaluationRunPresentationStatus {
  if (evaluationRunNeedsDecision(run)) return "needs_action";
  return evaluationRunTerminalOutcome(run.status) ?? "waiting";
}

export function evaluationRunResultState(run: EvaluationRun): "candidate" | "insufficient" | "failed" | "waiting" {
  if (run.candidateSelectionShareBps !== null) return "candidate";
  const terminalOutcome = evaluationRunTerminalOutcome(run.status);
  if (terminalOutcome === "completed") return "insufficient";
  return terminalOutcome ?? "waiting";
}

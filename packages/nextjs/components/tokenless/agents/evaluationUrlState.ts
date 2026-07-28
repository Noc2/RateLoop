export type EvaluationStatusFilter = "all" | "needs_action" | "failed" | "completed" | "waiting";
export type EvaluationDateFilter = "all" | "7" | "30";

export type EvaluationUrlState = {
  query: string;
  projectId: string;
  agentId: string;
  workflowKey: string;
  status: EvaluationStatusFilter;
  date: EvaluationDateFilter;
  runId: string | null;
};

export const DEFAULT_EVALUATION_URL_STATE: EvaluationUrlState = {
  query: "",
  projectId: "",
  agentId: "",
  workflowKey: "",
  status: "all",
  date: "all",
  runId: null,
};

const statuses = new Set<EvaluationStatusFilter>(["all", "needs_action", "failed", "completed", "waiting"]);
const dates = new Set<EvaluationDateFilter>(["all", "7", "30"]);

function paramsFrom(search: string | URLSearchParams) {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function bounded(value: string | null, maximumLength: number) {
  return (value?.trim() ?? "").slice(0, maximumLength);
}

export function parseEvaluationUrlState(search: string | URLSearchParams): EvaluationUrlState {
  const params = paramsFrom(search);
  const requestedStatus = params.get("resultStatus") as EvaluationStatusFilter | null;
  const requestedDate = params.get("resultDate") as EvaluationDateFilter | null;
  const runId = bounded(params.get("resultRun"), 256);

  return {
    query: bounded(params.get("resultQ"), 120),
    projectId: bounded(params.get("resultProject"), 256),
    agentId: bounded(params.get("resultAgent"), 256),
    workflowKey: bounded(params.get("resultWorkflow"), 256),
    status: requestedStatus && statuses.has(requestedStatus) ? requestedStatus : "all",
    date: requestedDate && dates.has(requestedDate) ? requestedDate : "all",
    runId: runId || null,
  };
}

export function updateEvaluationUrlSearch(search: string | URLSearchParams, patch: Partial<EvaluationUrlState>) {
  const params = paramsFrom(search);
  const state = { ...parseEvaluationUrlState(params), ...patch };

  const query = bounded(state.query, 120);
  if (query) params.set("resultQ", query);
  else params.delete("resultQ");

  const projectId = bounded(state.projectId, 256);
  if (projectId) params.set("resultProject", projectId);
  else params.delete("resultProject");

  const agentId = bounded(state.agentId, 256);
  if (agentId) params.set("resultAgent", agentId);
  else params.delete("resultAgent");

  const workflowKey = bounded(state.workflowKey, 256);
  if (workflowKey) params.set("resultWorkflow", workflowKey);
  else params.delete("resultWorkflow");

  if (state.status === "all") params.delete("resultStatus");
  else params.set("resultStatus", state.status);

  if (state.date === "all") params.delete("resultDate");
  else params.set("resultDate", state.date);

  const runId = bounded(state.runId, 256);
  if (runId) params.set("resultRun", runId);
  else params.delete("resultRun");

  return params.toString();
}

export function evaluationUrlHref({
  pathname,
  search,
  hash = "",
  patch,
}: {
  pathname: string;
  search: string | URLSearchParams;
  hash?: string;
  patch: Partial<EvaluationUrlState>;
}) {
  const nextSearch = updateEvaluationUrlSearch(search, patch);
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`;
}

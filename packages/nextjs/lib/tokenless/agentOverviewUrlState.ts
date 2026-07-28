export const AGENT_OVERVIEW_PERIODS = ["7", "30", "90", "lifetime"] as const;
export const AGENT_OVERVIEW_STAGES = ["calibrating", "high_coverage", "medium_coverage", "monitoring"] as const;

export type AgentOverviewPeriod = (typeof AGENT_OVERVIEW_PERIODS)[number];
export type AgentOverviewStage = (typeof AGENT_OVERVIEW_STAGES)[number];

export type AgentOverviewUrlState = {
  period: AgentOverviewPeriod;
  workflow: string | null;
  riskTier: string | null;
  stage: AgentOverviewStage | null;
  versionId: string | null;
  page: number;
};

type SearchInput = string | URLSearchParams | Record<string, string | string[] | undefined>;

function paramsFrom(input: SearchInput) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

function boundedValue(params: URLSearchParams, key: string, maximumLength = 256) {
  const value = (params.get(key) ?? "").trim();
  return value && value.length <= maximumLength ? value : null;
}

function pageValue(params: URLSearchParams) {
  const value = Number(params.get("overviewPage") ?? params.get("page") ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function parseAgentOverviewUrlState(input: SearchInput): AgentOverviewUrlState {
  const params = paramsFrom(input);
  const requestedPeriod = params.get("period");
  const requestedStage = params.get("overviewStage");
  return {
    period: AGENT_OVERVIEW_PERIODS.includes(requestedPeriod as AgentOverviewPeriod)
      ? (requestedPeriod as AgentOverviewPeriod)
      : "30",
    workflow: boundedValue(params, "overviewWorkflow"),
    riskTier: boundedValue(params, "overviewRisk"),
    stage: AGENT_OVERVIEW_STAGES.includes(requestedStage as AgentOverviewStage)
      ? (requestedStage as AgentOverviewStage)
      : null,
    versionId: boundedValue(params, "overviewVersion"),
    page: pageValue(params),
  };
}

function setOptional(params: URLSearchParams, key: string, value: string | null) {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function updateAgentOverviewUrlSearch(input: SearchInput, patch: Partial<AgentOverviewUrlState>) {
  const params = paramsFrom(input);
  const state = { ...parseAgentOverviewUrlState(params), ...patch };
  if (state.period === "30") params.delete("period");
  else params.set("period", state.period);
  setOptional(params, "overviewWorkflow", state.workflow);
  setOptional(params, "overviewRisk", state.riskTier);
  setOptional(params, "overviewStage", state.stage);
  setOptional(params, "overviewVersion", state.versionId);
  params.delete("overviewAgent");
  params.delete("overviewScope");
  if (state.page === 1) params.delete("overviewPage");
  else params.set("overviewPage", String(state.page));
  params.delete("page");
  return params.toString();
}

export function agentOverviewApiSearch(state: AgentOverviewUrlState) {
  const params = new URLSearchParams();
  if (state.period !== "30") params.set("period", state.period);
  setOptional(params, "overviewWorkflow", state.workflow);
  setOptional(params, "overviewRisk", state.riskTier);
  setOptional(params, "overviewStage", state.stage);
  setOptional(params, "overviewVersion", state.versionId);
  if (state.page !== 1) params.set("page", String(state.page));
  return params.toString();
}

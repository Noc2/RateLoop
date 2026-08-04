type AgentTranslate = (key: string, values?: Record<string, number | string>) => string;

const ENVIRONMENT_KEYS = new Set(["production", "staging", "development"]);
const AGENT_STATUS_KEYS = new Set(["active", "inactive", "revoked"]);
const CONNECTION_STATUS_KEYS = new Set([
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "connected",
  "action_required",
  "cancelled",
  "expired",
  "rejected",
  "revoked",
  "superseded",
  "active",
]);
const ENFORCEMENT_KEYS = new Set(["host_enforced", "advisory"]);
const RISK_KEYS = new Set(["low", "normal", "medium", "high", "critical", "unknown"]);
const STAGE_KEYS = new Set(["calibrating", "high_coverage", "medium_coverage", "monitoring"]);

function enumLabel(group: string, values: ReadonlySet<string>, value: string, t: AgentTranslate) {
  return values.has(value) ? t(`${group}.${value}`) : t("unknown");
}

export function agentEnvironmentLabel(value: string, t: AgentTranslate) {
  return enumLabel("environment", ENVIRONMENT_KEYS, value, t);
}

export function agentStatusLabel(value: string, t: AgentTranslate) {
  return enumLabel("agentStatus", AGENT_STATUS_KEYS, value, t);
}

export function connectionStatusLabel(value: string, t: AgentTranslate) {
  return enumLabel("connectionStatus", CONNECTION_STATUS_KEYS, value, t);
}

export function enforcementModeLabel(value: string, t: AgentTranslate) {
  return enumLabel("enforcement", ENFORCEMENT_KEYS, value, t);
}

export function riskTierLabel(value: string, t: AgentTranslate) {
  return enumLabel("risk", RISK_KEYS, value, t);
}

export function assuranceStageLabel(value: string, t: AgentTranslate) {
  return enumLabel("stage", STAGE_KEYS, value, t);
}

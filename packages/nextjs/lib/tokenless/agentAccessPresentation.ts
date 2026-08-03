export type AgentCredentialKind = "oauth" | "legacy" | "unknown";
export type AgentRateLoopAccessState = "active" | "recovery_required" | "inactive";
export type AgentHostToolReadiness = "unverified";

export type AgentAccessPresentation = {
  credentialKind: AgentCredentialKind;
  rateLoopAccessState: AgentRateLoopAccessState;
  hostToolReadiness: AgentHostToolReadiness;
  canPublish: boolean;
  canSpend: boolean;
};

export type AgentAccessFacts = {
  activationMode: string | null;
  integrationStatus: string | null;
  connectionStatus: string | null;
  credentialExpiresAt: string | Date | null;
  tokenFamilyStatus: string | null;
  oauthRecoveryAvailable: boolean;
  grantedScopes: readonly string[];
};

const INACTIVE_ACCESS: AgentAccessPresentation = {
  credentialKind: "unknown",
  rateLoopAccessState: "inactive",
  hostToolReadiness: "unverified",
  canPublish: false,
  canSpend: false,
};

export function materialAgentCapabilities(scopes: readonly string[]) {
  return {
    canPublish: scopes.includes("panel:publish"),
    canSpend: scopes.includes("payment:submit"),
  };
}

function credentialKind(activationMode: string | null): AgentCredentialKind {
  if (activationMode === "legacy_pairing") return "legacy";
  if (activationMode === "preauthorized_safe" || activationMode === "owner_approved") return "oauth";
  return "unknown";
}

function futureTimestamp(value: string | Date | null, now: number) {
  if (!value) return false;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > now;
}

export function deriveAgentAccessPresentation(facts: AgentAccessFacts, now = Date.now()): AgentAccessPresentation {
  const kind = credentialKind(facts.activationMode);
  const integrationActive = facts.integrationStatus === "active";
  const credentialActive = futureTimestamp(facts.credentialExpiresAt, now);
  const recoveryRequired = kind === "oauth" && facts.oauthRecoveryAvailable;
  const accessActive =
    integrationActive &&
    credentialActive &&
    !recoveryRequired &&
    (kind === "legacy" ||
      (kind === "oauth" && facts.connectionStatus === "connected" && facts.tokenFamilyStatus === "active"));
  const capabilities = accessActive ? materialAgentCapabilities(facts.grantedScopes) : materialAgentCapabilities([]);

  return {
    credentialKind: kind,
    rateLoopAccessState: recoveryRequired ? "recovery_required" : accessActive ? "active" : "inactive",
    hostToolReadiness: "unverified",
    ...capabilities,
  };
}

export function normalizeAgentAccessPresentation(value: unknown): AgentAccessPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...INACTIVE_ACCESS };
  const row = value as Record<string, unknown>;
  const kind = row.credentialKind;
  const state = row.rateLoopAccessState;
  if (
    (kind !== "oauth" && kind !== "legacy") ||
    (state !== "active" && state !== "recovery_required" && state !== "inactive") ||
    row.hostToolReadiness !== "unverified"
  ) {
    return { ...INACTIVE_ACCESS };
  }
  const active = state === "active";
  return {
    credentialKind: kind,
    rateLoopAccessState: state,
    hostToolReadiness: "unverified",
    canPublish: active && row.canPublish === true,
    canSpend: active && row.canSpend === true,
  };
}

export function hasActiveAgentAccess(access: AgentAccessPresentation) {
  return access.rateLoopAccessState === "active";
}

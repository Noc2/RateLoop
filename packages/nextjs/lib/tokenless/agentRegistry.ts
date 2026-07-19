import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreateWorkspaceAgent } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import type { AdaptiveReviewStage } from "~~/lib/tokenless/adaptiveReview";
import type {
  HumanReviewAudience,
  HumanReviewAuthorityLevel,
  HumanReviewCompensationMode,
  HumanReviewContentBoundary,
} from "~~/lib/tokenless/reviewCapabilities";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";

export const AGENT_ENVIRONMENTS = ["staging", "production"] as const;
export type AgentEnvironment = (typeof AGENT_ENVIRONMENTS)[number];

export type AgentVersionInput = {
  displayName: string;
  description?: string | null;
  provider: string;
  model: string;
  modelVersion?: string | null;
  environment: AgentEnvironment;
};

export type AgentVersionSnapshot = {
  versionId: string;
  versionNumber: number;
  displayName: string;
  description: string | null;
  declaredProvider: string;
  declaredModel: string;
  declaredModelVersion: string | null;
  environment: AgentEnvironment;
  configurationCommitment: string;
  createdBy: string | null;
  createdAt: string;
};

export type AgentHumanReviewSummary = {
  status: "configuration_required" | "configured" | "disabled";
  configuration: {
    selection: {
      mode: "manual" | "always" | "rules" | "adaptive" | "fixed";
      fixedRateBps: number | null;
      maximumUnreviewedGap: number;
      effectiveRateRangeBps: { minimum: number; maximum: number } | null;
    };
    request: {
      questionAuthority: "owner_fixed" | "agent_per_request";
      resultSemantics: "assurance" | "feedback";
      criterion: string | null;
      positiveLabel: string | null;
      negativeLabel: string | null;
      rationaleMode: "off" | "optional" | "required";
      audience: HumanReviewAudience;
      contentBoundary: HumanReviewContentBoundary;
      privateSensitivity: "internal" | "confidential" | "restricted" | "regulated" | null;
      responseWindowSeconds: number | null;
      panelSize: number | null;
      compensationMode: HumanReviewCompensationMode;
      bountyPerSeatAtomic: string | null;
      feedbackBonusEnabled: boolean;
      feedbackBonusPoolAtomic: string | null;
      feedbackBonusAwarderKind: "requester" | "designated";
      feedbackBonusAwarderAccount: string | null;
    };
    authority: HumanReviewAuthorityLevel;
    enforcementMode: "advisory" | "host_enforced" | null;
    connected: boolean;
    killSwitchActive: boolean | null;
  } | null;
  activity: {
    lastDecisionAt: string | null;
    lastRequestAt: string | null;
    lastResultAt: string | null;
  };
  workload: {
    openCount: number;
    approvalRequiredCount: number;
    requestReadyCount: number;
    activeReviewCount: number;
    blockedCount: number;
    ownerActionCount: number;
  };
  lastTerminal: {
    state: "skipped" | "completed" | "inconclusive" | "failed_terminal" | "cancelled_before_commit";
    at: string;
  } | null;
  management: {
    binding: {
      id: string;
      version: number;
      canonicalHash: string;
      approvedAt: string;
    } | null;
    selectionPolicy: {
      id: string;
      version: number;
      agreementThresholdBps: number;
      productionFloorBps: number;
      requiredRiskTiers: string[];
      criticalRiskTiers: string[];
      minimumConfidenceBps: number | null;
      maximumLatencyMs: number | null;
    } | null;
    requestProfile: { id: string; version: number; hash: string } | null;
    privateGroup: { id: string; policyVersion: number; policyHash: string } | null;
    delegation: {
      integrationId: string;
      publishingPolicy: { id: string; version: number } | null;
      scopes: string[];
    } | null;
    lastTerminalDetails: { opportunityId: string; reasonCodes: string[] } | null;
    audit: {
      eventCount: number;
      latest: {
        type: "created" | "configuration_changed" | "disabled";
        bindingVersion: number;
        eventHash: string;
        createdAt: string;
      } | null;
    };
  } | null;
};

export type AgentExecutionModelProfile = {
  provider: string;
  requestedModel: string;
  resolvedModel: string | null;
  modelVersion: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
};

export type AgentExecutionProfile =
  | {
      available: true;
      orchestrationMode: "single_model" | "multi_model";
      primary: AgentExecutionModelProfile;
      contributors: AgentExecutionModelProfile[];
    }
  | {
      available: false;
      orchestrationMode: null;
      primary: null;
      contributors: [];
    };

export type AgentAssuranceScopeSummary = {
  scopeId: string;
  agentVersionId: string;
  policyId: string;
  policyVersion: number;
  workflowKey: string;
  riskTier: string;
  stage: AdaptiveReviewStage;
  reviewRateBps: number;
  completedComparableCases: number;
  stableCasesSinceStage: number;
  reviewedOpportunityCount: number;
  skippedOpportunityCount: number;
  comparableCount: number;
  agreementCount: number;
  humanAgreementBps: number | null;
  humanAgreementLower95Bps: number | null;
  executionProfileHash: string;
  executionProfile: AgentExecutionProfile;
  executionCount: number;
  averageTotalDurationMs: number | null;
  averageInputTokenTotal: number | null;
  averageOutputTokenTotal: number | null;
  averageReasoningOutputTokenTotal: number | null;
  nextReassessmentAfter: number;
  lastTransition: {
    eventType: "stage_changed" | "reset";
    fromStage: AdaptiveReviewStage | null;
    toStage: AdaptiveReviewStage | null;
    reasonCodes: string[];
    createdAt: string;
  } | null;
  updatedAt: string;
};

/**
 * Owner-stated capability card fields. These describe what the workspace
 * intends the agent for and where it must not be used; they complement the
 * host-reported declared metadata, which stays labeled as not independently
 * verified.
 */
export type AgentCapabilityStatement = {
  intendedPurpose: string | null;
  knownLimitations: string | null;
  doNotUseConditions: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type WorkspaceAgent = {
  agentId: string;
  workspaceId: string;
  externalId: string;
  ownerAccountAddress: string | null;
  status: "active" | "inactive";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  capabilityStatement: AgentCapabilityStatement;
  currentVersion: AgentVersionSnapshot;
  versions: AgentVersionSnapshot[];
  assuranceScopes: AgentAssuranceScopeSummary[];
  humanReview: AgentHumanReviewSummary;
};

export type AgentRegistry = {
  callerRole: TokenlessWorkspaceRole;
  canManage: boolean;
  agents: WorkspaceAgent[];
};

type QueryRow = Record<string, unknown>;

const MANAGEMENT_ROLES = new Set<TokenlessWorkspaceRole>(["owner", "admin"]);
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ASSURANCE_STAGE_RATES: Record<AdaptiveReviewStage, number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: 1_000,
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowOptionalInteger(row: QueryRow | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : rowInteger(row, key);
}

function rowNullableNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Database returned an invalid ${key}.`);
  return number;
}

function stringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function executionModelProfile(
  value: unknown,
  includeLegacyPartitionSettings: boolean,
): AgentExecutionModelProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (typeof profile.provider !== "string" || !profile.provider.trim()) return null;
  if (typeof profile.requestedModel !== "string" || !profile.requestedModel.trim()) return null;
  const optionalString = (field: string) => {
    const fieldValue = profile[field];
    return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue.trim() : null;
  };
  return {
    provider: profile.provider.trim(),
    requestedModel: profile.requestedModel.trim(),
    resolvedModel: optionalString("resolvedModel"),
    modelVersion: optionalString("modelVersion"),
    reasoningEffort: includeLegacyPartitionSettings ? optionalString("reasoningEffort") : null,
    serviceTier: includeLegacyPartitionSettings ? optionalString("serviceTier") : null,
  };
}

function executionProfile(value: unknown): AgentExecutionProfile {
  const unavailable: AgentExecutionProfile = {
    available: false,
    orchestrationMode: null,
    primary: null,
    contributors: [],
  };
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unavailable;
    const record = parsed as Record<string, unknown>;
    if (
      record.schemaVersion !== "rateloop.execution-profile.v1" &&
      record.schemaVersion !== "rateloop.execution-profile.v2"
    ) {
      return unavailable;
    }
    if (record.orchestrationMode !== "single_model" && record.orchestrationMode !== "multi_model") {
      return unavailable;
    }
    const includeLegacyPartitionSettings = record.schemaVersion === "rateloop.execution-profile.v1";
    const primary = executionModelProfile(record.primary, includeLegacyPartitionSettings);
    if (!primary || !Array.isArray(record.contributors)) return unavailable;
    const contributors = record.contributors.map(value => executionModelProfile(value, includeLegacyPartitionSettings));
    if (contributors.some(item => item === null)) return unavailable;
    const visibleContributors = includeLegacyPartitionSettings
      ? (contributors as AgentExecutionModelProfile[])
      : [
          ...new Map(
            (contributors as AgentExecutionModelProfile[]).map(contributor => [
              JSON.stringify({
                provider: contributor.provider,
                requestedModel: contributor.requestedModel,
                resolvedModel: contributor.resolvedModel,
                modelVersion: contributor.modelVersion,
              }),
              contributor,
            ]),
          ).values(),
        ];
    return {
      available: true,
      orchestrationMode: record.orchestrationMode,
      primary,
      contributors: visibleContributors,
    };
  } catch {
    return unavailable;
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${field}.`);
  return date.toISOString();
}

function bounded(value: unknown, name: string, maximum: number, options?: { optional?: boolean }) {
  if ((value === null || value === undefined || value === "") && options?.optional) return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${name} is required.`, 400, "invalid_agent");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TokenlessServiceError(`${name} must be 1-${maximum} characters.`, 400, "invalid_agent");
  }
  return normalized;
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function normalizeVersionInput(input: AgentVersionInput) {
  const environment = input.environment;
  if (!AGENT_ENVIRONMENTS.includes(environment)) {
    throw new TokenlessServiceError("Agent environment is invalid.", 400, "invalid_agent");
  }
  const normalized = {
    displayName: bounded(input.displayName, "Agent display name", 120) as string,
    description: bounded(input.description, "Agent description", 1_000, { optional: true }),
    provider: bounded(input.provider, "Declared provider", 120) as string,
    model: bounded(input.model, "Declared model", 160) as string,
    modelVersion: bounded(input.modelVersion, "Declared model version", 160, { optional: true }),
    environment,
  };
  return {
    ...normalized,
    configurationCommitment: createHash("sha256").update(stableJson(normalized)).digest("hex"),
  };
}

function normalizeExternalId(value: unknown) {
  if (typeof value !== "string" || !EXTERNAL_ID_PATTERN.test(value.trim())) {
    throw new TokenlessServiceError(
      "External agent ID must be 1-160 letters, numbers, dots, colons, underscores, or hyphens.",
      400,
      "invalid_agent",
    );
  }
  return value.trim();
}

async function requireWorkspaceAccess(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active'
          LIMIT 1`,
    args: [workspaceId, address],
  });
  const role = rowString(result.rows[0] as QueryRow | undefined, "role") as TokenlessWorkspaceRole | null;
  if (!role) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return { address, role, canManage: MANAGEMENT_ROLES.has(role) };
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
  const access = await requireWorkspaceAccess(accountAddress, workspaceId);
  if (!access.canManage) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return access;
}

function versionFromRow(row: QueryRow, canManage: boolean): AgentVersionSnapshot {
  const versionId = rowString(row, "version_id");
  const displayName = rowString(row, "display_name");
  const provider = rowString(row, "declared_provider");
  const model = rowString(row, "declared_model");
  const commitment = rowString(row, "configuration_commitment");
  const createdBy = rowString(row, "version_created_by");
  if (!versionId || !displayName || !provider || !model || !commitment || !createdBy) {
    throw new Error("Database returned an invalid agent version.");
  }
  const environment = rowString(row, "environment") as AgentEnvironment | null;
  if (!environment || !AGENT_ENVIRONMENTS.includes(environment)) {
    throw new Error("Database returned an invalid agent environment.");
  }
  const versionNumber = Number(row.version_number);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new Error("Database returned an invalid agent version number.");
  }
  return {
    versionId,
    versionNumber,
    displayName,
    description: rowString(row, "description"),
    declaredProvider: provider,
    declaredModel: model,
    declaredModelVersion: rowString(row, "declared_model_version"),
    environment,
    configurationCommitment: commitment,
    createdBy: canManage ? createdBy : null,
    createdAt: iso(row.version_created_at, "agent-version timestamp"),
  };
}

function nextReassessmentAfter(stage: AdaptiveReviewStage, completed: number, stable: number) {
  if (stage === "calibrating") return Math.max(0, 30 - completed);
  if (stage === "high_coverage") return Math.max(0, 50 - stable);
  if (stage === "medium_coverage") return Math.max(0, 100 - stable);
  return 0;
}

const REVIEW_POLICY_MODES = ["manual", "always", "rules", "adaptive", "fixed"] as const;
const REVIEW_RATIONALE_MODES = ["off", "optional", "required"] as const;
const REVIEW_AUDIENCES = ["private_invited", "public_network", "hybrid"] as const;
const REVIEW_CONTENT_BOUNDARIES = ["private_workspace", "public_or_test"] as const;
const REVIEW_COMPENSATION_MODES = ["unpaid", "usdc"] as const;
const REVIEW_AUTHORITIES = ["check_only", "prepare_for_approval", "ask_automatically"] as const;
const REVIEW_ENFORCEMENT_MODES = ["advisory", "host_enforced"] as const;
const REVIEW_PRIVATE_SENSITIVITIES = ["internal", "confidential", "restricted", "regulated"] as const;
const REVIEW_TERMINAL_STATES = [
  "skipped",
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
] as const;
const REVIEW_BINDING_EVENT_TYPES = ["created", "configuration_changed", "disabled"] as const;

type HumanReviewConfigurationRow = QueryRow & {
  binding_id: unknown;
  version: unknown;
  agent_id: unknown;
  agent_version_id: unknown;
};

type HumanReviewProjectionData = {
  configurations: Map<string, HumanReviewConfigurationRow>;
  integrations: Map<string, QueryRow[]>;
  workloads: Map<string, AgentHumanReviewSummary["workload"]>;
  terminals: Map<string, QueryRow>;
  audits: Map<string, { eventCount: number; latest: QueryRow }>;
};

function projectionKey(...parts: Array<string | number>) {
  return parts.join("\u0000");
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function rowEnum<const T extends readonly string[]>(row: QueryRow | undefined, key: string, allowed: T): T[number] {
  const value = rowString(row, key);
  if (!value || !allowed.includes(value)) throw new Error(`Database returned an invalid ${key}.`);
  return value as T[number];
}

function nullableIso(value: unknown, field: string) {
  return value === null || value === undefined ? null : iso(value, field);
}

function latestTimestamp(rows: QueryRow[], key: string, field: string) {
  let latest: string | null = null;
  for (const row of rows) {
    const value = nullableIso(row[key], field);
    if (value && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

function parseReviewRules(value: unknown) {
  let rules: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    rules = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Database returned invalid review rules.");
  }
  const riskTiers = (key: string) => {
    const entry = rules[key] ?? [];
    if (!Array.isArray(entry) || entry.some(item => typeof item !== "string")) {
      throw new Error("Database returned invalid review rules.");
    }
    return [...new Set(entry as string[])];
  };
  const optionalInteger = (key: string) => {
    const entry = rules[key];
    if (entry === null || entry === undefined) return null;
    const number = Number(entry);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Database returned invalid review rules.");
    return number;
  };
  return {
    requiredRiskTiers: riskTiers("requiredRiskTiers"),
    criticalRiskTiers: riskTiers("criticalRiskTiers"),
    minimumConfidenceBps: optionalInteger("minimumConfidenceBps"),
    maximumLatencyMs: optionalInteger("maximumLatencyMs"),
  };
}

function connectedIntegration(row: QueryRow) {
  if (rowString(row, "status") !== "active") return false;
  const activationMode = rowString(row, "activation_mode");
  return activationMode === "legacy_pairing" || rowString(row, "connection_status") === "connected";
}

function publishingGrantActive(row: QueryRow, now: Date) {
  if (!rowString(row, "publishing_policy_id") || !rowBoolean(row, "publishing_policy_enabled")) return false;
  if (row.publishing_policy_revoked_at !== null && row.publishing_policy_revoked_at !== undefined) return false;
  const effectiveAt = new Date(String(row.publishing_policy_effective_at));
  const expiresAt = row.publishing_policy_expires_at ? new Date(String(row.publishing_policy_expires_at)) : null;
  return (
    Number.isFinite(effectiveAt.getTime()) &&
    effectiveAt <= now &&
    (!expiresAt || (Number.isFinite(expiresAt.getTime()) && expiresAt > now))
  );
}

async function loadWorkspaceHumanReviewProjection(
  workspaceId: string,
  canManage: boolean,
): Promise<HumanReviewProjectionData> {
  const now = new Date();
  const [configurationResult, integrationResult, workloadResult, approvalResult, terminalResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT b.*, p.mode, p.agreement_threshold_bps, p.production_floor_bps, p.fixed_rate_bps,
                   p.maximum_unreviewed_gap, p.rules_json,
                   r.question_authority, r.result_semantics,
                   r.criterion, r.positive_label, r.negative_label, r.rationale_mode, r.audience,
                   r.content_boundary, r.private_sensitivity, r.private_group_id,
                   r.private_group_policy_version, r.private_group_policy_hash,
                   r.response_window_seconds, r.panel_size, r.compensation_mode, r.bounty_per_seat_atomic,
                   r.feedback_bonus_enabled, r.feedback_bonus_pool_atomic, r.feedback_bonus_awarder_kind,
                   r.feedback_bonus_awarder_account,
                   r.configuration_status
            FROM tokenless_agent_human_review_bindings b
            JOIN tokenless_agent_review_policies p
              ON p.workspace_id = b.workspace_id AND p.policy_id = b.selection_policy_id
             AND p.version = b.selection_policy_version
            JOIN tokenless_agent_review_request_profiles r
              ON r.workspace_id = b.workspace_id AND r.profile_id = b.request_profile_id
             AND r.version = b.request_profile_version AND r.profile_hash = b.request_profile_hash
            WHERE b.workspace_id = ? AND b.enabled = true AND b.superseded_at IS NULL`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT i.integration_id, i.agent_id, i.agent_version_id, i.status, i.activation_mode,
                   i.enforcement_mode, i.granted_scopes_json, i.human_review_binding_id,
                   i.human_review_binding_version, i.publishing_policy_id, i.publishing_policy_version,
                   i.last_decision_at, i.last_request_at, i.last_result_at, i.updated_at,
                   c.status AS connection_status, p.enabled AS publishing_policy_enabled,
                   p.revoked_at AS publishing_policy_revoked_at,
                   p.effective_at AS publishing_policy_effective_at,
                   p.expires_at AS publishing_policy_expires_at
            FROM tokenless_agent_integrations i
            LEFT JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
            LEFT JOIN tokenless_agent_publishing_policies p
              ON p.workspace_id = i.workspace_id AND p.policy_id = i.publishing_policy_id
             AND p.version = i.publishing_policy_version
            WHERE i.workspace_id = ?
            ORDER BY CASE WHEN i.status = 'active' THEN 0 ELSE 1 END, i.updated_at DESC, i.integration_id ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT o.agent_id,
                   SUM(CASE WHEN l.terminal_at IS NULL THEN 1 ELSE 0 END) AS open_count,
                   SUM(CASE WHEN l.state = 'approval_required' THEN 1 ELSE 0 END) AS approval_required_count,
                   SUM(CASE WHEN l.state = 'request_ready' THEN 1 ELSE 0 END) AS request_ready_count,
                   SUM(CASE WHEN l.state = 'pending' THEN 1 ELSE 0 END) AS active_review_count,
                   SUM(CASE WHEN l.state = 'blocked' THEN 1 ELSE 0 END) AS blocked_count
            FROM tokenless_agent_review_opportunity_lifecycles l
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id = l.workspace_id AND o.opportunity_id = l.opportunity_id
            WHERE l.workspace_id = ?
            GROUP BY o.agent_id`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT o.agent_id, COUNT(DISTINCT a.opportunity_id) AS owner_action_count
            FROM tokenless_agent_review_approval_requests a
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id = a.workspace_id AND o.opportunity_id = a.opportunity_id
            WHERE a.workspace_id = ? AND a.status = 'pending' AND a.expires_at > ?
            GROUP BY o.agent_id`,
      args: [workspaceId, now],
    }),
    dbClient.execute({
      sql: `SELECT o.agent_id, l.opportunity_id, l.state, l.reason_codes_json, l.terminal_at
            FROM tokenless_agent_review_opportunity_lifecycles l
            JOIN tokenless_agent_review_opportunities o
              ON o.workspace_id = l.workspace_id AND o.opportunity_id = l.opportunity_id
            WHERE l.workspace_id = ? AND l.terminal_at IS NOT NULL
            ORDER BY l.terminal_at DESC, l.opportunity_id ASC`,
      args: [workspaceId],
    }),
  ]);
  const auditResult = canManage
    ? await dbClient.execute({
        sql: `SELECT e.binding_id, e.binding_version, e.event_type, e.event_hash, e.created_at
              FROM tokenless_agent_human_review_binding_events e
              WHERE e.workspace_id = ?
              ORDER BY e.created_at DESC, e.event_id DESC`,
        args: [workspaceId],
      })
    : null;

  const configurations = new Map<string, HumanReviewConfigurationRow>();
  for (const value of configurationResult.rows) {
    const row = value as HumanReviewConfigurationRow;
    const agentId = rowString(row, "agent_id");
    const agentVersionId = rowString(row, "agent_version_id");
    if (!agentId || !agentVersionId) throw new Error("Database returned an invalid human-review binding.");
    configurations.set(projectionKey(agentId, agentVersionId), row);
  }

  const integrations = new Map<string, QueryRow[]>();
  for (const value of integrationResult.rows) {
    const row = value as QueryRow;
    const bindingId = rowString(row, "human_review_binding_id");
    const bindingVersion = rowOptionalInteger(row, "human_review_binding_version");
    if (!bindingId || bindingVersion === null) continue;
    const key = projectionKey(bindingId, bindingVersion);
    integrations.set(key, [...(integrations.get(key) ?? []), row]);
  }

  const workloads = new Map<string, AgentHumanReviewSummary["workload"]>();
  for (const value of workloadResult.rows) {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    if (!agentId) throw new Error("Database returned an invalid review workload.");
    workloads.set(agentId, {
      openCount: rowInteger(row, "open_count"),
      approvalRequiredCount: rowInteger(row, "approval_required_count"),
      requestReadyCount: rowInteger(row, "request_ready_count"),
      activeReviewCount: rowInteger(row, "active_review_count"),
      blockedCount: rowInteger(row, "blocked_count"),
      ownerActionCount: 0,
    });
  }
  for (const value of approvalResult.rows) {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    if (!agentId) throw new Error("Database returned an invalid review approval count.");
    const current = workloads.get(agentId) ?? {
      openCount: 0,
      approvalRequiredCount: 0,
      requestReadyCount: 0,
      activeReviewCount: 0,
      blockedCount: 0,
      ownerActionCount: 0,
    };
    workloads.set(agentId, { ...current, ownerActionCount: rowInteger(row, "owner_action_count") });
  }

  const terminals = new Map<string, QueryRow>();
  for (const value of terminalResult.rows) {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    if (!agentId) throw new Error("Database returned an invalid terminal review state.");
    if (!terminals.has(agentId)) terminals.set(agentId, row);
  }

  const audits = new Map<string, { eventCount: number; latest: QueryRow }>();
  for (const value of auditResult?.rows ?? []) {
    const row = value as QueryRow;
    const bindingId = rowString(row, "binding_id");
    if (!bindingId) throw new Error("Database returned an invalid binding event.");
    const current = audits.get(bindingId);
    audits.set(bindingId, { eventCount: (current?.eventCount ?? 0) + 1, latest: current?.latest ?? row });
  }
  return { configurations, integrations, workloads, terminals, audits };
}

function buildHumanReviewSummary(input: {
  agentId: string;
  agentStatus: "active" | "inactive";
  agentVersionId: string;
  assuranceScopes: AgentAssuranceScopeSummary[];
  canManage: boolean;
  projection: HumanReviewProjectionData;
}): AgentHumanReviewSummary {
  const configuration = input.projection.configurations.get(projectionKey(input.agentId, input.agentVersionId));
  const workload = input.projection.workloads.get(input.agentId) ?? {
    openCount: 0,
    approvalRequiredCount: 0,
    requestReadyCount: 0,
    activeReviewCount: 0,
    blockedCount: 0,
    ownerActionCount: 0,
  };
  const terminal = input.projection.terminals.get(input.agentId);
  const terminalState = terminal ? rowEnum(terminal, "state", REVIEW_TERMINAL_STATES) : null;
  const terminalAt = terminal ? iso(terminal.terminal_at, "terminal review timestamp") : null;
  const emptyManagement: NonNullable<AgentHumanReviewSummary["management"]> = {
    binding: null,
    selectionPolicy: null,
    requestProfile: null,
    privateGroup: null,
    delegation: null,
    lastTerminalDetails:
      terminal && terminalState
        ? {
            opportunityId: rowString(terminal, "opportunity_id")!,
            reasonCodes: stringArray(terminal.reason_codes_json, "terminal review reasons"),
          }
        : null,
    audit: { eventCount: 0, latest: null },
  };
  if (!configuration) {
    return {
      status: input.agentStatus === "inactive" ? "disabled" : "configuration_required",
      configuration: null,
      activity: { lastDecisionAt: null, lastRequestAt: null, lastResultAt: null },
      workload,
      lastTerminal: terminalState && terminalAt ? { state: terminalState, at: terminalAt } : null,
      management: input.canManage ? emptyManagement : null,
    };
  }

  const bindingId = rowString(configuration, "binding_id")!;
  const bindingVersion = rowInteger(configuration, "version");
  const exactIntegrations = input.projection.integrations.get(projectionKey(bindingId, bindingVersion)) ?? [];
  const activeIntegrations = exactIntegrations.filter(row => rowString(row, "status") === "active");
  const selectedIntegration =
    activeIntegrations.find(connectedIntegration) ?? activeIntegrations[0] ?? exactIntegrations[0];
  const connected = activeIntegrations.some(connectedIntegration);
  const authority = rowEnum(configuration, "authority", REVIEW_AUTHORITIES);
  const mode = rowEnum(configuration, "mode", REVIEW_POLICY_MODES);
  const configurationStatus = rowEnum(configuration, "configuration_status", ["ready", "action_required"] as const);
  const selectionPolicyId = rowString(configuration, "selection_policy_id")!;
  const selectionPolicyVersion = rowInteger(configuration, "selection_policy_version");
  const scopeRates = input.assuranceScopes
    .filter(
      scope =>
        scope.agentVersionId === input.agentVersionId &&
        scope.policyId === selectionPolicyId &&
        scope.policyVersion === selectionPolicyVersion,
    )
    .map(scope => scope.reviewRateBps);
  const fixedRateBps = rowOptionalInteger(configuration, "fixed_rate_bps");
  const effectiveRates =
    mode === "always"
      ? [10_000]
      : mode === "fixed" && fixedRateBps !== null
        ? [fixedRateBps]
        : mode === "adaptive"
          ? scopeRates.length > 0
            ? scopeRates
            : [10_000]
          : [];
  const rules = parseReviewRules(configuration.rules_json);
  const privateGroupId = rowString(configuration, "private_group_id");
  const privateGroupPolicyVersion = rowOptionalInteger(configuration, "private_group_policy_version");
  const privateGroupPolicyHash = rowString(configuration, "private_group_policy_hash");
  if (
    (privateGroupId === null) !== (privateGroupPolicyVersion === null) ||
    (privateGroupId === null) !== (privateGroupPolicyHash === null)
  ) {
    throw new Error("Database returned an invalid private-group review binding.");
  }
  const publishingPolicyId = rowString(configuration, "publishing_policy_id");
  const publishingPolicyVersion = rowOptionalInteger(configuration, "publishing_policy_version");
  if ((publishingPolicyId === null) !== (publishingPolicyVersion === null)) {
    throw new Error("Database returned an invalid publishing-policy review binding.");
  }
  const automaticGrantActive = Boolean(
    authority === "ask_automatically" &&
      selectedIntegration &&
      connectedIntegration(selectedIntegration) &&
      rowString(selectedIntegration, "publishing_policy_id") === publishingPolicyId &&
      rowOptionalInteger(selectedIntegration, "publishing_policy_version") === publishingPolicyVersion &&
      publishingGrantActive(selectedIntegration, new Date()),
  );
  const audit = input.projection.audits.get(bindingId);
  const latestAuditType = audit ? rowEnum(audit.latest, "event_type", REVIEW_BINDING_EVENT_TYPES) : null;
  const latestAuditHash = audit ? rowString(audit.latest, "event_hash") : null;
  const management: AgentHumanReviewSummary["management"] = input.canManage
    ? {
        binding: {
          id: bindingId,
          version: bindingVersion,
          canonicalHash: rowString(configuration, "canonical_hash")!,
          approvedAt: iso(configuration.approved_at, "binding approval timestamp"),
        },
        selectionPolicy: {
          id: selectionPolicyId,
          version: selectionPolicyVersion,
          agreementThresholdBps: rowInteger(configuration, "agreement_threshold_bps"),
          productionFloorBps: rowInteger(configuration, "production_floor_bps"),
          ...rules,
        },
        requestProfile: {
          id: rowString(configuration, "request_profile_id")!,
          version: rowInteger(configuration, "request_profile_version"),
          hash: rowString(configuration, "request_profile_hash")!,
        },
        privateGroup:
          privateGroupId && privateGroupPolicyVersion !== null && privateGroupPolicyHash
            ? { id: privateGroupId, policyVersion: privateGroupPolicyVersion, policyHash: privateGroupPolicyHash }
            : null,
        delegation: selectedIntegration
          ? {
              integrationId: rowString(selectedIntegration, "integration_id")!,
              publishingPolicy:
                publishingPolicyId && publishingPolicyVersion !== null
                  ? { id: publishingPolicyId, version: publishingPolicyVersion }
                  : null,
              scopes: stringArray(selectedIntegration.granted_scopes_json, "integration scopes"),
            }
          : null,
        lastTerminalDetails: emptyManagement.lastTerminalDetails,
        audit: {
          eventCount: audit?.eventCount ?? 0,
          latest:
            audit && latestAuditType && latestAuditHash
              ? {
                  type: latestAuditType,
                  bindingVersion: rowInteger(audit.latest, "binding_version"),
                  eventHash: latestAuditHash,
                  createdAt: iso(audit.latest.created_at, "binding event timestamp"),
                }
              : null,
        },
      }
    : null;
  const responseWindowSeconds = rowOptionalInteger(configuration, "response_window_seconds");
  const panelSize = rowOptionalInteger(configuration, "panel_size");
  if (configurationStatus === "ready" && (responseWindowSeconds === null || panelSize === null)) {
    throw new Error("Database returned an incomplete ready review request profile.");
  }
  return {
    status:
      input.agentStatus === "inactive"
        ? "disabled"
        : configurationStatus === "ready"
          ? "configured"
          : "configuration_required",
    configuration: {
      selection: {
        mode,
        fixedRateBps,
        maximumUnreviewedGap: rowInteger(configuration, "maximum_unreviewed_gap"),
        effectiveRateRangeBps:
          effectiveRates.length > 0
            ? { minimum: Math.min(...effectiveRates), maximum: Math.max(...effectiveRates) }
            : null,
      },
      request: {
        questionAuthority: rowEnum(configuration, "question_authority", ["owner_fixed", "agent_per_request"] as const),
        resultSemantics: rowEnum(configuration, "result_semantics", ["assurance", "feedback"] as const),
        criterion: rowString(configuration, "criterion"),
        positiveLabel: rowString(configuration, "positive_label"),
        negativeLabel: rowString(configuration, "negative_label"),
        rationaleMode: rowEnum(configuration, "rationale_mode", REVIEW_RATIONALE_MODES),
        audience: rowEnum(configuration, "audience", REVIEW_AUDIENCES),
        contentBoundary: rowEnum(configuration, "content_boundary", REVIEW_CONTENT_BOUNDARIES),
        privateSensitivity:
          configuration.private_sensitivity === null || configuration.private_sensitivity === undefined
            ? null
            : rowEnum(configuration, "private_sensitivity", REVIEW_PRIVATE_SENSITIVITIES),
        responseWindowSeconds,
        panelSize,
        compensationMode: rowEnum(configuration, "compensation_mode", REVIEW_COMPENSATION_MODES),
        bountyPerSeatAtomic: rowString(configuration, "bounty_per_seat_atomic"),
        feedbackBonusEnabled:
          configuration.feedback_bonus_enabled === true || configuration.feedback_bonus_enabled === "t",
        feedbackBonusPoolAtomic: rowString(configuration, "feedback_bonus_pool_atomic"),
        feedbackBonusAwarderKind:
          rowString(configuration, "feedback_bonus_awarder_kind") === "designated" ? "designated" : "requester",
        feedbackBonusAwarderAccount: rowString(configuration, "feedback_bonus_awarder_account"),
      },
      authority,
      enforcementMode: selectedIntegration
        ? rowEnum(selectedIntegration, "enforcement_mode", REVIEW_ENFORCEMENT_MODES)
        : null,
      connected,
      killSwitchActive: authority === "ask_automatically" ? !automaticGrantActive : null,
    },
    activity: {
      lastDecisionAt: latestTimestamp(activeIntegrations, "last_decision_at", "review decision timestamp"),
      lastRequestAt: latestTimestamp(activeIntegrations, "last_request_at", "review request timestamp"),
      lastResultAt: latestTimestamp(activeIntegrations, "last_result_at", "review result timestamp"),
    },
    workload,
    lastTerminal: terminalState && terminalAt ? { state: terminalState, at: terminalAt } : null,
    management,
  };
}

async function loadWorkspaceAssuranceScopes(workspaceId: string) {
  const [scopesResult, opportunitiesResult, observationsResult, eventsResult, executionsResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT s.scope_id, s.agent_id, s.agent_version_id, s.policy_id, s.policy_version,
                   s.workflow_key, s.risk_tier, s.stage, s.completed_comparable_cases,
                   s.stable_cases_since_stage, s.execution_profile_hash, s.execution_profile_json,
                   s.updated_at, p.mode, p.production_floor_bps, p.fixed_rate_bps
            FROM tokenless_agent_evaluation_scopes s
            JOIN tokenless_agent_review_policies p
              ON p.workspace_id = s.workspace_id AND p.policy_id = s.policy_id AND p.version = s.policy_version
            WHERE s.workspace_id = ?
            ORDER BY s.updated_at DESC, s.scope_id ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT scope_id,
                   SUM(CASE WHEN status IN ('review_requested', 'completed') THEN 1 ELSE 0 END) AS reviewed,
                   SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
            FROM tokenless_agent_review_opportunities
            WHERE workspace_id = ? GROUP BY scope_id`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT scope_id,
                   SUM(CASE WHEN comparable = true THEN 1 ELSE 0 END) AS comparable,
                   SUM(CASE WHEN comparable = true AND agreement = 'agree' THEN 1 ELSE 0 END) AS agreements
            FROM tokenless_agent_evaluation_observations
            WHERE workspace_id = ? GROUP BY scope_id`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT scope_id, event_type, from_stage, to_stage, reason_codes_json, created_at
            FROM tokenless_agent_review_policy_events
            WHERE workspace_id = ? AND event_type IN ('stage_changed', 'reset')
            ORDER BY created_at DESC, event_id DESC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT execution_scope.scope_id,
                   COUNT(*) AS execution_count,
                   AVG(execution_scope.total_duration_ms) AS average_total_duration_ms,
                   AVG(execution_scope.input_token_total) AS average_input_token_total,
                   AVG(execution_scope.output_token_total) AS average_output_token_total,
                   AVG(execution_scope.reasoning_output_token_total) AS average_reasoning_output_token_total
            FROM (
              SELECT DISTINCT o.scope_id, e.execution_id, e.total_duration_ms, e.input_token_total,
                              e.output_token_total, e.reasoning_output_token_total
              FROM tokenless_agent_review_opportunities o
              JOIN tokenless_agent_executions e
                ON e.workspace_id = o.workspace_id AND e.execution_id = o.execution_id
              WHERE o.workspace_id = ? AND o.execution_id IS NOT NULL
            ) execution_scope
            GROUP BY execution_scope.scope_id`,
      args: [workspaceId],
    }),
  ]);

  const opportunityCounts = new Map<string, { reviewed: number; skipped: number }>();
  for (const value of opportunitiesResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    if (!scopeId) throw new Error("Database returned an invalid assurance opportunity rollup.");
    opportunityCounts.set(scopeId, {
      reviewed: rowInteger(row, "reviewed"),
      skipped: rowInteger(row, "skipped"),
    });
  }

  const observationCounts = new Map<string, { comparable: number; agreements: number }>();
  for (const value of observationsResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    if (!scopeId) throw new Error("Database returned an invalid assurance observation rollup.");
    observationCounts.set(scopeId, {
      comparable: rowInteger(row, "comparable"),
      agreements: rowInteger(row, "agreements"),
    });
  }

  const latestTransition = new Map<string, QueryRow>();
  for (const value of eventsResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    if (!scopeId) throw new Error("Database returned an invalid assurance event.");
    if (!latestTransition.has(scopeId)) latestTransition.set(scopeId, row);
  }

  const executionMetrics = new Map<string, QueryRow>();
  for (const value of executionsResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    if (!scopeId) throw new Error("Database returned an invalid execution rollup.");
    executionMetrics.set(scopeId, row);
  }

  const byAgent = new Map<string, AgentAssuranceScopeSummary[]>();
  for (const value of scopesResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    const agentId = rowString(row, "agent_id");
    const agentVersionId = rowString(row, "agent_version_id");
    const policyId = rowString(row, "policy_id");
    const workflowKey = rowString(row, "workflow_key");
    const riskTier = rowString(row, "risk_tier");
    const stage = rowString(row, "stage") as AdaptiveReviewStage | null;
    const mode = rowString(row, "mode");
    const executionProfileHash = rowString(row, "execution_profile_hash");
    if (
      !scopeId ||
      !agentId ||
      !agentVersionId ||
      !policyId ||
      !workflowKey ||
      !riskTier ||
      !stage ||
      !(stage in ASSURANCE_STAGE_RATES) ||
      !mode ||
      !executionProfileHash
    ) {
      throw new Error("Database returned an invalid assurance scope.");
    }
    const completedComparableCases = rowInteger(row, "completed_comparable_cases");
    const stableCasesSinceStage = rowInteger(row, "stable_cases_since_stage");
    const productionFloorBps = rowInteger(row, "production_floor_bps");
    const fixedRateBps = rowOptionalInteger(row, "fixed_rate_bps");
    if (
      !["manual", "always", "rules", "adaptive", "fixed"].includes(mode) ||
      (mode === "fixed") !== (fixedRateBps !== null) ||
      (fixedRateBps !== null && (fixedRateBps < 1 || fixedRateBps > 10_000))
    ) {
      throw new Error("Database returned an invalid assurance policy mode.");
    }
    const opportunities = opportunityCounts.get(scopeId) ?? { reviewed: 0, skipped: 0 };
    const observations = observationCounts.get(scopeId) ?? { comparable: 0, agreements: 0 };
    const interval =
      observations.comparable > 0 ? wilsonIntervalBps(observations.agreements, observations.comparable) : null;
    const transition = latestTransition.get(scopeId);
    const metrics = executionMetrics.get(scopeId);
    const transitionType = rowString(transition, "event_type") as "stage_changed" | "reset" | null;
    const summary: AgentAssuranceScopeSummary = {
      scopeId,
      agentVersionId,
      policyId,
      policyVersion: rowInteger(row, "policy_version"),
      workflowKey,
      riskTier,
      stage,
      reviewRateBps:
        mode === "always"
          ? 10_000
          : mode === "adaptive"
            ? Math.max(ASSURANCE_STAGE_RATES[stage], productionFloorBps)
            : mode === "fixed"
              ? (fixedRateBps ?? 0)
              : 0,
      completedComparableCases,
      stableCasesSinceStage,
      reviewedOpportunityCount: opportunities.reviewed,
      skippedOpportunityCount: opportunities.skipped,
      comparableCount: observations.comparable,
      agreementCount: observations.agreements,
      humanAgreementBps:
        observations.comparable > 0 ? Math.floor((observations.agreements * 10_000) / observations.comparable) : null,
      humanAgreementLower95Bps: interval?.lower ?? null,
      executionProfileHash,
      executionProfile: executionProfile(row.execution_profile_json),
      executionCount: metrics ? rowInteger(metrics, "execution_count") : 0,
      averageTotalDurationMs: rowNullableNumber(metrics, "average_total_duration_ms"),
      averageInputTokenTotal: rowNullableNumber(metrics, "average_input_token_total"),
      averageOutputTokenTotal: rowNullableNumber(metrics, "average_output_token_total"),
      averageReasoningOutputTokenTotal: rowNullableNumber(metrics, "average_reasoning_output_token_total"),
      nextReassessmentAfter:
        mode === "adaptive" ? nextReassessmentAfter(stage, completedComparableCases, stableCasesSinceStage) : 0,
      lastTransition:
        transition && transitionType
          ? {
              eventType: transitionType,
              fromStage: rowString(transition, "from_stage") as AdaptiveReviewStage | null,
              toStage: rowString(transition, "to_stage") as AdaptiveReviewStage | null,
              reasonCodes: stringArray(transition.reason_codes_json, "assurance transition reasons"),
              createdAt: iso(transition.created_at, "assurance transition timestamp"),
            }
          : null,
      updatedAt: iso(row.updated_at, "assurance scope timestamp"),
    };
    byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), summary]);
  }
  return byAgent;
}

async function loadWorkspaceAgents(workspaceId: string, canManage: boolean): Promise<WorkspaceAgent[]> {
  const [agentsResult, versionsResult, assuranceByAgent, humanReviewProjection] = await Promise.all([
    dbClient.execute({
      sql: `SELECT agent_id, workspace_id, external_id, owner_account_address, status,
                   created_by, created_at, updated_at, deactivated_at,
                   intended_purpose, known_limitations, do_not_use_conditions,
                   capability_statement_updated_at, capability_statement_updated_by
            FROM tokenless_agents
            WHERE workspace_id = ?
            ORDER BY created_at DESC, agent_id ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT version_id, agent_id, version_number, display_name, description,
                   declared_provider, declared_model, declared_model_version,
                   environment, configuration_commitment, created_by AS version_created_by,
                   created_at AS version_created_at
            FROM tokenless_agent_versions
            WHERE workspace_id = ?
            ORDER BY agent_id ASC, version_number DESC`,
      args: [workspaceId],
    }),
    loadWorkspaceAssuranceScopes(workspaceId),
    loadWorkspaceHumanReviewProjection(workspaceId, canManage),
  ]);
  const versionsByAgent = new Map<string, AgentVersionSnapshot[]>();
  for (const value of versionsResult.rows) {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    if (!agentId) throw new Error("Database returned an invalid agent version binding.");
    versionsByAgent.set(agentId, [...(versionsByAgent.get(agentId) ?? []), versionFromRow(row, canManage)]);
  }
  return agentsResult.rows.map(value => {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    const storedWorkspaceId = rowString(row, "workspace_id");
    const externalId = rowString(row, "external_id");
    const ownerAccountAddress = rowString(row, "owner_account_address");
    const status = rowString(row, "status") as "active" | "inactive" | null;
    const createdBy = rowString(row, "created_by");
    const versions = agentId ? (versionsByAgent.get(agentId) ?? []) : [];
    if (
      !agentId ||
      !storedWorkspaceId ||
      !externalId ||
      !ownerAccountAddress ||
      !status ||
      !createdBy ||
      !versions[0]
    ) {
      throw new Error("Database returned an invalid agent.");
    }
    return {
      agentId,
      workspaceId: storedWorkspaceId,
      externalId,
      ownerAccountAddress: canManage ? ownerAccountAddress : null,
      status,
      createdBy: canManage ? createdBy : null,
      createdAt: iso(row.created_at, "agent creation timestamp"),
      updatedAt: iso(row.updated_at, "agent update timestamp"),
      deactivatedAt: row.deactivated_at ? iso(row.deactivated_at, "agent deactivation timestamp") : null,
      capabilityStatement: {
        intendedPurpose: rowString(row, "intended_purpose"),
        knownLimitations: rowString(row, "known_limitations"),
        doNotUseConditions: rowString(row, "do_not_use_conditions"),
        updatedAt: row.capability_statement_updated_at
          ? iso(row.capability_statement_updated_at, "capability statement timestamp")
          : null,
        updatedBy: canManage ? rowString(row, "capability_statement_updated_by") : null,
      },
      currentVersion: versions[0],
      versions,
      assuranceScopes: (assuranceByAgent.get(agentId) ?? []).sort((left, right) => {
        const leftCurrent = left.agentVersionId === versions[0]?.versionId ? 1 : 0;
        const rightCurrent = right.agentVersionId === versions[0]?.versionId ? 1 : 0;
        return rightCurrent - leftCurrent || right.updatedAt.localeCompare(left.updatedAt);
      }),
      humanReview: buildHumanReviewSummary({
        agentId,
        agentStatus: status,
        agentVersionId: versions[0].versionId,
        assuranceScopes: assuranceByAgent.get(agentId) ?? [],
        canManage,
        projection: humanReviewProjection,
      }),
    };
  });
}

export async function listWorkspaceAgents(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<AgentRegistry> {
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  return {
    callerRole: access.role,
    canManage: access.canManage,
    agents: await loadWorkspaceAgents(input.workspaceId, access.canManage),
  };
}

export async function createWorkspaceAgent(input: {
  accountAddress: string;
  workspaceId: string;
  externalId: string;
  version: AgentVersionInput;
}) {
  const access = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const externalId = normalizeExternalId(input.externalId);
  const version = normalizeVersionInput(input.version);
  const duplicate = await dbClient.execute({
    sql: "SELECT agent_id FROM tokenless_agents WHERE workspace_id = ? AND external_id = ? LIMIT 1",
    args: [input.workspaceId, externalId],
  });
  if (duplicate.rowCount) {
    throw new TokenlessServiceError("External agent ID already exists in this workspace.", 409, "agent_exists");
  }
  const agentId = `agt_${randomUUID().replaceAll("-", "")}`;
  const versionId = `agtv_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await assertCanCreateWorkspaceAgent(client, input.workspaceId, now);
    await client.query(
      `INSERT INTO tokenless_agents
       (agent_id, workspace_id, external_id, owner_account_address, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $4, $5, $5)`,
      [agentId, input.workspaceId, externalId, access.address, now],
    );
    await client.query(
      `INSERT INTO tokenless_agent_versions
       (version_id, agent_id, workspace_id, version_number, display_name, description,
        declared_provider, declared_model, declared_model_version,
        environment, configuration_commitment, created_by, created_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        versionId,
        agentId,
        input.workspaceId,
        version.displayName,
        version.description,
        version.provider,
        version.model,
        version.modelVersion,
        version.environment,
        version.configurationCommitment,
        access.address,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_audit_events
       (event_id, workspace_id, agent_id, version_id, event_type, actor_account_address, details_json, created_at)
       VALUES ($1, $2, $3, $4, 'agent.created', $5, $6, $7)`,
      [
        `agevt_${randomUUID().replaceAll("-", "")}`,
        input.workspaceId,
        agentId,
        versionId,
        access.address,
        JSON.stringify({ externalId, versionNumber: 1 }),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new TokenlessServiceError("External agent ID already exists in this workspace.", 409, "agent_exists");
    }
    throw error;
  } finally {
    client.release();
  }
  const agents = await loadWorkspaceAgents(input.workspaceId, true);
  const created = agents.find(agent => agent.agentId === agentId);
  if (!created) throw new Error("Created agent could not be loaded.");
  return created;
}

export async function createWorkspaceAgentVersion(input: {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
  version: AgentVersionInput;
}) {
  const access = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const version = normalizeVersionInput(input.version);
  const versionId = `agtv_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const agentResult = await client.query(
      `SELECT status FROM tokenless_agents
       WHERE workspace_id = $1 AND agent_id = $2
       FOR UPDATE`,
      [input.workspaceId, input.agentId],
    );
    const status = rowString(agentResult.rows[0] as QueryRow | undefined, "status");
    if (!status) throw new TokenlessServiceError("Agent not found.", 404, "agent_not_found");
    if (status !== "active") throw new TokenlessServiceError("Agent is inactive.", 409, "agent_inactive");
    const latestResult = await client.query(
      `SELECT version_number, configuration_commitment
       FROM tokenless_agent_versions
       WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY version_number DESC
       LIMIT 1`,
      [input.workspaceId, input.agentId],
    );
    const latest = latestResult.rows[0] as QueryRow | undefined;
    const currentVersion = Number(latest?.version_number ?? 0);
    if (!Number.isInteger(currentVersion) || currentVersion < 1) {
      throw new Error("Agent has no valid immutable version.");
    }
    if (rowString(latest, "configuration_commitment") === version.configurationCommitment) {
      throw new TokenlessServiceError("This agent configuration already exists.", 409, "agent_version_exists");
    }
    const nextVersion = currentVersion + 1;
    await client.query(
      `INSERT INTO tokenless_agent_versions
       (version_id, agent_id, workspace_id, version_number, display_name, description,
        declared_provider, declared_model, declared_model_version,
        environment, configuration_commitment, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        versionId,
        input.agentId,
        input.workspaceId,
        nextVersion,
        version.displayName,
        version.description,
        version.provider,
        version.model,
        version.modelVersion,
        version.environment,
        version.configurationCommitment,
        access.address,
        now,
      ],
    );
    await client.query("UPDATE tokenless_agents SET updated_at = $1 WHERE agent_id = $2", [now, input.agentId]);
    await client.query(
      `INSERT INTO tokenless_agent_audit_events
       (event_id, workspace_id, agent_id, version_id, event_type, actor_account_address, details_json, created_at)
       VALUES ($1, $2, $3, $4, 'agent.version_created', $5, $6, $7)`,
      [
        `agevt_${randomUUID().replaceAll("-", "")}`,
        input.workspaceId,
        input.agentId,
        versionId,
        access.address,
        JSON.stringify({ versionNumber: nextVersion }),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const agents = await loadWorkspaceAgents(input.workspaceId, true);
  const updated = agents.find(agent => agent.agentId === input.agentId);
  if (!updated) throw new Error("Updated agent could not be loaded.");
  return updated;
}

function normalizeCapabilityStatementField(value: unknown, field: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(
      `${field} must be text of at most 2000 characters.`,
      400,
      "invalid_capability_statement",
    );
  }
  const normalized = value.trim();
  if (normalized.length > 2_000) {
    throw new TokenlessServiceError(
      `${field} must be text of at most 2000 characters.`,
      400,
      "invalid_capability_statement",
    );
  }
  return normalized || null;
}

/**
 * Owner-editable capability card: intended purpose, known limitations, and
 * do-not-use conditions. Audited like every other registry change.
 */
export async function updateWorkspaceAgentCapabilityStatement(input: {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
  statement: {
    intendedPurpose?: unknown;
    knownLimitations?: unknown;
    doNotUseConditions?: unknown;
  };
  now?: Date;
}) {
  const access = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  if (!input.statement || typeof input.statement !== "object" || Array.isArray(input.statement)) {
    throw new TokenlessServiceError("A capability statement object is required.", 400, "invalid_capability_statement");
  }
  const unexpected = Object.keys(input.statement).filter(
    key => !["intendedPurpose", "knownLimitations", "doNotUseConditions"].includes(key),
  );
  if (unexpected.length > 0) {
    throw new TokenlessServiceError(
      "Capability statements carry only intendedPurpose, knownLimitations, and doNotUseConditions.",
      400,
      "invalid_capability_statement",
    );
  }
  const intendedPurpose = normalizeCapabilityStatementField(input.statement.intendedPurpose, "intendedPurpose");
  const knownLimitations = normalizeCapabilityStatementField(input.statement.knownLimitations, "knownLimitations");
  const doNotUseConditions = normalizeCapabilityStatementField(
    input.statement.doNotUseConditions,
    "doNotUseConditions",
  );
  const now = input.now ?? new Date();
  const updated = await dbClient.execute({
    sql: `UPDATE tokenless_agents
          SET intended_purpose = ?, known_limitations = ?, do_not_use_conditions = ?,
              capability_statement_updated_at = ?, capability_statement_updated_by = ?, updated_at = ?
          WHERE workspace_id = ? AND agent_id = ?`,
    args: [
      intendedPurpose,
      knownLimitations,
      doNotUseConditions,
      now,
      access.address,
      now,
      input.workspaceId,
      input.agentId,
    ],
  });
  if (!updated.rowCount) throw new TokenlessServiceError("Agent not found.", 404, "agent_not_found");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_audit_events
          (event_id, workspace_id, agent_id, event_type, actor_account_address, details_json, created_at)
          VALUES (?, ?, ?, 'agent.capability_statement_updated', ?, ?, ?)`,
    args: [
      `agevt_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.agentId,
      access.address,
      JSON.stringify({
        hasIntendedPurpose: intendedPurpose !== null,
        hasKnownLimitations: knownLimitations !== null,
        hasDoNotUseConditions: doNotUseConditions !== null,
      }),
      now,
    ],
  });
  const agents = await loadWorkspaceAgents(input.workspaceId, true);
  const agent = agents.find(entry => entry.agentId === input.agentId);
  if (!agent) throw new Error("Updated agent could not be loaded.");
  return agent;
}

export async function deactivateWorkspaceAgent(input: {
  accountAddress: string;
  workspaceId: string;
  agentId: string;
}) {
  const access = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT status FROM tokenless_agents
       WHERE workspace_id = $1 AND agent_id = $2
       FOR UPDATE`,
      [input.workspaceId, input.agentId],
    );
    const status = rowString(existing.rows[0] as QueryRow | undefined, "status");
    if (!status) throw new TokenlessServiceError("Agent not found.", 404, "agent_not_found");
    if (status === "active") {
      await client.query(
        `UPDATE tokenless_agents
         SET status = 'inactive', deactivated_at = $1, updated_at = $1
         WHERE workspace_id = $2 AND agent_id = $3`,
        [now, input.workspaceId, input.agentId],
      );
      await client.query(
        `INSERT INTO tokenless_agent_audit_events
         (event_id, workspace_id, agent_id, event_type, actor_account_address, details_json, created_at)
         VALUES ($1, $2, $3, 'agent.deactivated', $4, '{}', $5)`,
        [`agevt_${randomUUID().replaceAll("-", "")}`, input.workspaceId, input.agentId, access.address, now],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const agents = await loadWorkspaceAgents(input.workspaceId, true);
  const inactive = agents.find(agent => agent.agentId === input.agentId);
  if (!inactive) throw new Error("Deactivated agent could not be loaded.");
  return inactive;
}

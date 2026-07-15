import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreateWorkspaceAgent } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import type { AdaptiveReviewStage } from "~~/lib/tokenless/adaptiveReview";
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
  deploymentName?: string | null;
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
  declaredDeploymentName: string | null;
  environment: AgentEnvironment;
  configurationCommitment: string;
  createdBy: string;
  createdAt: string;
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

export type WorkspaceAgent = {
  agentId: string;
  workspaceId: string;
  externalId: string;
  ownerAccountAddress: string;
  status: "active" | "inactive";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  currentVersion: AgentVersionSnapshot;
  versions: AgentVersionSnapshot[];
  assuranceScopes: AgentAssuranceScopeSummary[];
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

function stringArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
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
    deploymentName: bounded(input.deploymentName, "Declared deployment name", 160, { optional: true }),
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

function versionFromRow(row: QueryRow): AgentVersionSnapshot {
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
    declaredDeploymentName: rowString(row, "declared_deployment_name"),
    environment,
    configurationCommitment: commitment,
    createdBy,
    createdAt: iso(row.version_created_at, "agent-version timestamp"),
  };
}

function nextReassessmentAfter(stage: AdaptiveReviewStage, completed: number, stable: number) {
  if (stage === "calibrating") return Math.max(0, 30 - completed);
  if (stage === "high_coverage") return Math.max(0, 50 - stable);
  if (stage === "medium_coverage") return Math.max(0, 100 - stable);
  return 0;
}

async function loadWorkspaceAssuranceScopes(workspaceId: string) {
  const [scopesResult, opportunitiesResult, observationsResult, eventsResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT s.scope_id, s.agent_id, s.agent_version_id, s.policy_id, s.policy_version,
                   s.workflow_key, s.risk_tier, s.stage, s.completed_comparable_cases,
                   s.stable_cases_since_stage, s.updated_at, p.mode, p.production_floor_bps
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
    if (
      !scopeId ||
      !agentId ||
      !agentVersionId ||
      !policyId ||
      !workflowKey ||
      !riskTier ||
      !stage ||
      !(stage in ASSURANCE_STAGE_RATES) ||
      !mode
    ) {
      throw new Error("Database returned an invalid assurance scope.");
    }
    const completedComparableCases = rowInteger(row, "completed_comparable_cases");
    const stableCasesSinceStage = rowInteger(row, "stable_cases_since_stage");
    const productionFloorBps = rowInteger(row, "production_floor_bps");
    const opportunities = opportunityCounts.get(scopeId) ?? { reviewed: 0, skipped: 0 };
    const observations = observationCounts.get(scopeId) ?? { comparable: 0, agreements: 0 };
    const interval =
      observations.comparable > 0 ? wilsonIntervalBps(observations.agreements, observations.comparable) : null;
    const transition = latestTransition.get(scopeId);
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
        mode === "always" ? 10_000 : mode === "manual" ? 0 : Math.max(ASSURANCE_STAGE_RATES[stage], productionFloorBps),
      completedComparableCases,
      stableCasesSinceStage,
      reviewedOpportunityCount: opportunities.reviewed,
      skippedOpportunityCount: opportunities.skipped,
      comparableCount: observations.comparable,
      agreementCount: observations.agreements,
      humanAgreementBps:
        observations.comparable > 0 ? Math.floor((observations.agreements * 10_000) / observations.comparable) : null,
      humanAgreementLower95Bps: interval?.lower ?? null,
      nextReassessmentAfter: nextReassessmentAfter(stage, completedComparableCases, stableCasesSinceStage),
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

async function loadWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]> {
  const [agentsResult, versionsResult, assuranceByAgent] = await Promise.all([
    dbClient.execute({
      sql: `SELECT agent_id, workspace_id, external_id, owner_account_address, status,
                   created_by, created_at, updated_at, deactivated_at
            FROM tokenless_agents
            WHERE workspace_id = ?
            ORDER BY created_at DESC, agent_id ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT version_id, agent_id, version_number, display_name, description,
                   declared_provider, declared_model, declared_model_version, declared_deployment_name,
                   environment, configuration_commitment, created_by AS version_created_by,
                   created_at AS version_created_at
            FROM tokenless_agent_versions
            WHERE workspace_id = ?
            ORDER BY agent_id ASC, version_number DESC`,
      args: [workspaceId],
    }),
    loadWorkspaceAssuranceScopes(workspaceId),
  ]);
  const versionsByAgent = new Map<string, AgentVersionSnapshot[]>();
  for (const value of versionsResult.rows) {
    const row = value as QueryRow;
    const agentId = rowString(row, "agent_id");
    if (!agentId) throw new Error("Database returned an invalid agent version binding.");
    versionsByAgent.set(agentId, [...(versionsByAgent.get(agentId) ?? []), versionFromRow(row)]);
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
      ownerAccountAddress,
      status,
      createdBy,
      createdAt: iso(row.created_at, "agent creation timestamp"),
      updatedAt: iso(row.updated_at, "agent update timestamp"),
      deactivatedAt: row.deactivated_at ? iso(row.deactivated_at, "agent deactivation timestamp") : null,
      currentVersion: versions[0],
      versions,
      assuranceScopes: (assuranceByAgent.get(agentId) ?? []).sort((left, right) => {
        const leftCurrent = left.agentVersionId === versions[0]?.versionId ? 1 : 0;
        const rightCurrent = right.agentVersionId === versions[0]?.versionId ? 1 : 0;
        return rightCurrent - leftCurrent || right.updatedAt.localeCompare(left.updatedAt);
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
    agents: await loadWorkspaceAgents(input.workspaceId),
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
        declared_provider, declared_model, declared_model_version, declared_deployment_name,
        environment, configuration_commitment, created_by, created_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        versionId,
        agentId,
        input.workspaceId,
        version.displayName,
        version.description,
        version.provider,
        version.model,
        version.modelVersion,
        version.deploymentName,
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
  const agents = await loadWorkspaceAgents(input.workspaceId);
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
        declared_provider, declared_model, declared_model_version, declared_deployment_name,
        environment, configuration_commitment, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
        version.deploymentName,
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
  const agents = await loadWorkspaceAgents(input.workspaceId);
  const updated = agents.find(agent => agent.agentId === input.agentId);
  if (!updated) throw new Error("Updated agent could not be loaded.");
  return updated;
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
  const agents = await loadWorkspaceAgents(input.workspaceId);
  const inactive = agents.find(agent => agent.agentId === input.agentId);
  if (!inactive) throw new Error("Deactivated agent could not be loaded.");
  return inactive;
}

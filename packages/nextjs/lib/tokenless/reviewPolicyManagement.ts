import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import type { AdaptiveReviewStage } from "~~/lib/tokenless/adaptiveReview";
import { listWorkspaceAgents } from "~~/lib/tokenless/agentRegistry";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const REVIEW_POLICY_MODES = ["manual", "always", "rules", "adaptive"] as const;
export type ReviewPolicyMode = (typeof REVIEW_POLICY_MODES)[number];
export const REVIEW_ENFORCEMENT_MODES = ["advisory", "host_enforced"] as const;
export type ReviewEnforcementMode = (typeof REVIEW_ENFORCEMENT_MODES)[number];
export const REVIEW_AUDIENCES = ["private_invited", "public_network", "hybrid"] as const;
export type ReviewAudience = (typeof REVIEW_AUDIENCES)[number];

type QueryRow = Record<string, unknown>;

export type ManagedReviewPolicyInput = {
  agentId: string;
  agentVersionId: string;
  mode: ReviewPolicyMode;
  enforcementMode: ReviewEnforcementMode;
  agreementThresholdBps: number;
  productionFloorBps: number;
  maximumUnreviewedGap: number;
  requiredRiskTiers: string[];
  criticalRiskTiers: string[];
  minimumConfidenceBps?: number | null;
  maximumLatencyMs?: number | null;
  audience: ReviewAudience;
  publishingPolicyId?: string | null;
};

export type ManagedReviewScope = {
  scopeId: string;
  workflowKey: string;
  riskTier: string;
  stage: AdaptiveReviewStage;
  completedComparableCases: number;
  stableCasesSinceStage: number;
  reviewRateBps: number;
  updatedAt: string;
};

export type ManagedReviewPolicy = {
  policyId: string;
  version: number;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  mode: ReviewPolicyMode;
  enforcementMode: ReviewEnforcementMode;
  enabled: boolean;
  agreementThresholdBps: number;
  productionFloorBps: number;
  maximumUnreviewedGap: number;
  requiredRiskTiers: string[];
  criticalRiskTiers: string[];
  minimumConfidenceBps: number | null;
  maximumLatencyMs: number | null;
  audience: ReviewAudience;
  audiencePolicyHash: string;
  publishingPolicyId: string | null;
  createdBy: string;
  approvedBy: string;
  createdAt: string;
  supersededAt: string | null;
  scopes: ManagedReviewScope[];
  safetyFloors: {
    criticalRiskRequiresReview: boolean;
    missingMetadataRequiresReview: boolean;
    minimumReviewRateBps: number;
  };
};

const RISK_TIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const STAGE_RATE_BPS: Record<AdaptiveReviewStage, number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: 1_000,
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Database returned an invalid ${field}.`);
  return date.toISOString();
}

function parseObject(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Database returned invalid ${field}.`);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function stringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) {
    throw new Error(`Database returned invalid ${field}.`);
  }
  return value as string[];
}

function bps(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw new TokenlessServiceError(`${field} must be an integer from 0 to 10000.`, 400, "invalid_review_policy");
  }
  return Number(value);
}

function optionalBps(value: unknown, field: string) {
  return value === null || value === undefined ? null : bps(value, field);
}

function normalizeRiskTiers(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || !RISK_TIER_PATTERN.test(entry))) {
    throw new TokenlessServiceError(
      `${field} must contain lowercase risk-tier identifiers.`,
      400,
      "invalid_review_policy",
    );
  }
  return [...new Set(value as string[])];
}

function normalizeInput(value: unknown): ManagedReviewPolicyInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Review policy body must be an object.", 400, "invalid_review_policy");
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "agentId",
    "agentVersionId",
    "mode",
    "enforcementMode",
    "agreementThresholdBps",
    "productionFloorBps",
    "maximumUnreviewedGap",
    "requiredRiskTiers",
    "criticalRiskTiers",
    "minimumConfidenceBps",
    "maximumLatencyMs",
    "audience",
    "publishingPolicyId",
  ]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) {
    throw new TokenlessServiceError("Review policy body contains unknown fields.", 400, "invalid_review_policy");
  }
  const mode = input.mode as ReviewPolicyMode;
  const enforcementMode = input.enforcementMode as ReviewEnforcementMode;
  const audience = input.audience as ReviewAudience;
  if (!REVIEW_POLICY_MODES.includes(mode)) {
    throw new TokenlessServiceError("Review policy mode is invalid.", 400, "invalid_review_policy");
  }
  if (!REVIEW_ENFORCEMENT_MODES.includes(enforcementMode)) {
    throw new TokenlessServiceError("Review enforcement mode is invalid.", 400, "invalid_review_policy");
  }
  if (!REVIEW_AUDIENCES.includes(audience)) {
    throw new TokenlessServiceError("Review audience is invalid.", 400, "invalid_review_policy");
  }
  if (mode === "manual" && enforcementMode === "host_enforced") {
    throw new TokenlessServiceError(
      "Manual handoffs are advisory. Choose always, rules, or adaptive for host enforcement.",
      400,
      "invalid_review_policy",
    );
  }
  if (typeof input.agentId !== "string" || !input.agentId || typeof input.agentVersionId !== "string") {
    throw new TokenlessServiceError("An exact agent version is required.", 400, "invalid_review_policy");
  }
  const agreementThresholdBps = bps(input.agreementThresholdBps, "agreementThresholdBps");
  const requestedProductionFloorBps = bps(input.productionFloorBps, "productionFloorBps");
  const productionFloorBps = mode === "adaptive" ? requestedProductionFloorBps : 0;
  if (mode === "adaptive" && productionFloorBps < 1_000) {
    throw new TokenlessServiceError(
      "Adaptive review cannot fall below the 10% production floor.",
      400,
      "invalid_review_policy",
    );
  }
  if (
    !Number.isSafeInteger(input.maximumUnreviewedGap) ||
    Number(input.maximumUnreviewedGap) < 1 ||
    Number(input.maximumUnreviewedGap) > 10_000
  ) {
    throw new TokenlessServiceError("maximumUnreviewedGap must be between 1 and 10000.", 400, "invalid_review_policy");
  }
  const maximumLatencyMs = input.maximumLatencyMs ?? null;
  if (maximumLatencyMs !== null && (!Number.isSafeInteger(maximumLatencyMs) || Number(maximumLatencyMs) < 1)) {
    throw new TokenlessServiceError("maximumLatencyMs must be a positive integer.", 400, "invalid_review_policy");
  }
  const publishingPolicyId = input.publishingPolicyId ?? null;
  if (publishingPolicyId !== null && (typeof publishingPolicyId !== "string" || !publishingPolicyId)) {
    throw new TokenlessServiceError("publishingPolicyId is invalid.", 400, "invalid_review_policy");
  }
  return {
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    mode,
    enforcementMode,
    agreementThresholdBps,
    productionFloorBps,
    maximumUnreviewedGap: Number(input.maximumUnreviewedGap),
    requiredRiskTiers: normalizeRiskTiers(input.requiredRiskTiers, "requiredRiskTiers"),
    criticalRiskTiers: normalizeRiskTiers(input.criticalRiskTiers, "criticalRiskTiers"),
    minimumConfidenceBps: optionalBps(input.minimumConfidenceBps, "minimumConfidenceBps"),
    maximumLatencyMs: maximumLatencyMs === null ? null : Number(maximumLatencyMs),
    audience,
    publishingPolicyId,
  };
}

async function requireManagement(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active'
            AND m.role IN ('owner', 'admin') LIMIT 1`,
    args: [workspaceId, address],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return address;
}

async function validateBindings(client: PoolClient, workspaceId: string, policy: ManagedReviewPolicyInput) {
  const agent = await client.query(
    `SELECT 1 FROM tokenless_agents a
     JOIN tokenless_agent_versions v
       ON v.workspace_id = a.workspace_id AND v.agent_id = a.agent_id
     WHERE a.workspace_id = $1 AND a.agent_id = $2 AND a.status = 'active' AND v.version_id = $3`,
    [workspaceId, policy.agentId, policy.agentVersionId],
  );
  if (agent.rowCount !== 1) {
    throw new TokenlessServiceError("Active agent version not found.", 404, "agent_version_not_found");
  }
  if (policy.publishingPolicyId) {
    const publishing = await client.query(
      `SELECT 1 FROM tokenless_agent_publishing_policies
       WHERE workspace_id = $1 AND policy_id = $2 AND enabled = true AND revoked_at IS NULL`,
      [workspaceId, policy.publishingPolicyId],
    );
    if (publishing.rowCount !== 1) {
      throw new TokenlessServiceError("Publishing policy not found.", 404, "publishing_policy_not_found");
    }
  }
}

function rulesJson(policy: ManagedReviewPolicyInput) {
  return JSON.stringify({
    enforcementMode: policy.enforcementMode,
    requiredRiskTiers: policy.requiredRiskTiers,
    criticalRiskTiers: policy.criticalRiskTiers,
    minimumConfidenceBps: policy.minimumConfidenceBps ?? null,
    maximumLatencyMs: policy.maximumLatencyMs ?? null,
  });
}

function audienceJson(policy: ManagedReviewPolicyInput) {
  return JSON.stringify({ reviewerSource: policy.audience });
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function scopeFromRow(row: QueryRow, mode: ReviewPolicyMode, floorBps: number): ManagedReviewScope {
  const stage = rowString(row, "stage") as AdaptiveReviewStage | null;
  const scopeId = rowString(row, "scope_id");
  const workflowKey = rowString(row, "workflow_key");
  const riskTier = rowString(row, "risk_tier");
  if (!stage || !scopeId || !workflowKey || !riskTier || !(stage in STAGE_RATE_BPS)) {
    throw new Error("Database returned an invalid adaptive review scope.");
  }
  return {
    scopeId,
    workflowKey,
    riskTier,
    stage,
    completedComparableCases: rowInteger(row, "completed_comparable_cases"),
    stableCasesSinceStage: rowInteger(row, "stable_cases_since_stage"),
    reviewRateBps:
      mode === "always"
        ? 10_000
        : mode === "manual"
          ? 0
          : Math.max(STAGE_RATE_BPS[stage], mode === "adaptive" ? floorBps : 0),
    updatedAt: iso(row.updated_at, "scope update timestamp"),
  };
}

function policyFromRow(row: QueryRow, scopeRows: QueryRow[]): ManagedReviewPolicy {
  const policyId = rowString(row, "policy_id");
  const workspaceId = rowString(row, "workspace_id");
  const agentId = rowString(row, "agent_id");
  const agentVersionId = rowString(row, "agent_version_id");
  const mode = rowString(row, "mode") as ReviewPolicyMode | null;
  const createdBy = rowString(row, "created_by");
  const approvedBy = rowString(row, "approved_by");
  if (!policyId || !workspaceId || !agentId || !agentVersionId || !mode || !createdBy || !approvedBy) {
    throw new Error("Database returned an invalid review policy.");
  }
  const rules = parseObject(row.rules_json, "review rules");
  const audiencePolicy = parseObject(row.audience_policy_json, "audience policy");
  const enforcementMode = (rules.enforcementMode ?? "advisory") as ReviewEnforcementMode;
  const audience = audiencePolicy.reviewerSource as ReviewAudience;
  if (!REVIEW_POLICY_MODES.includes(mode) || !REVIEW_ENFORCEMENT_MODES.includes(enforcementMode)) {
    throw new Error("Database returned an invalid review policy mode.");
  }
  if (!REVIEW_AUDIENCES.includes(audience)) throw new Error("Database returned an invalid review audience.");
  const productionFloorBps = rowInteger(row, "production_floor_bps");
  return {
    policyId,
    version: rowInteger(row, "version"),
    workspaceId,
    agentId,
    agentVersionId,
    mode,
    enforcementMode,
    enabled: rowBoolean(row, "enabled"),
    agreementThresholdBps: rowInteger(row, "agreement_threshold_bps"),
    productionFloorBps,
    maximumUnreviewedGap: rowInteger(row, "maximum_unreviewed_gap"),
    requiredRiskTiers: stringArray(rules.requiredRiskTiers ?? [], "required risk tiers"),
    criticalRiskTiers: stringArray(rules.criticalRiskTiers ?? [], "critical risk tiers"),
    minimumConfidenceBps:
      rules.minimumConfidenceBps === null || rules.minimumConfidenceBps === undefined
        ? null
        : Number(rules.minimumConfidenceBps),
    maximumLatencyMs:
      rules.maximumLatencyMs === null || rules.maximumLatencyMs === undefined ? null : Number(rules.maximumLatencyMs),
    audience,
    audiencePolicyHash: sha256(String(row.audience_policy_json)),
    publishingPolicyId: rowString(row, "publishing_policy_id"),
    createdBy,
    approvedBy,
    createdAt: iso(row.created_at, "policy creation timestamp"),
    supersededAt: row.superseded_at ? iso(row.superseded_at, "policy supersession timestamp") : null,
    scopes: scopeRows.map(scope => scopeFromRow(scope, mode, productionFloorBps)),
    safetyFloors: {
      criticalRiskRequiresReview: mode !== "manual",
      missingMetadataRequiresReview: mode !== "manual",
      minimumReviewRateBps: mode === "always" ? 10_000 : mode === "adaptive" ? Math.max(1_000, productionFloorBps) : 0,
    },
  };
}

async function loadPolicies(workspaceId: string) {
  const [policies, scopes] = await Promise.all([
    dbClient.execute({
      sql: `SELECT policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
                   agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
                   audience_policy_json, publishing_policy_id, created_by, approved_by, created_at, superseded_at
            FROM tokenless_agent_review_policies
            WHERE workspace_id = ? AND superseded_at IS NULL
            ORDER BY created_at DESC, policy_id ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT scope_id, policy_id, policy_version, workflow_key, risk_tier, stage,
                   completed_comparable_cases, stable_cases_since_stage, updated_at
            FROM tokenless_agent_evaluation_scopes WHERE workspace_id = ? ORDER BY updated_at DESC`,
      args: [workspaceId],
    }),
  ]);
  return policies.rows.map(value => {
    const row = value as QueryRow;
    return policyFromRow(
      row,
      scopes.rows.filter(
        scope =>
          rowString(scope as QueryRow, "policy_id") === rowString(row, "policy_id") &&
          rowInteger(scope as QueryRow, "policy_version") === rowInteger(row, "version"),
      ) as QueryRow[],
    );
  });
}

export async function listManagedReviewPolicies(input: { accountAddress: string; workspaceId: string }) {
  await requireManagement(input.accountAddress, input.workspaceId);
  const [registry, policies] = await Promise.all([listWorkspaceAgents(input), loadPolicies(input.workspaceId)]);
  return {
    canManage: registry.canManage,
    agents: registry.agents
      .filter(agent => agent.status === "active")
      .map(agent => ({
        agentId: agent.agentId,
        displayName: agent.currentVersion.displayName,
        versions: agent.versions.map(version => ({
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          displayName: version.displayName,
        })),
      })),
    policies,
  };
}

export async function createManagedReviewPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  policy: unknown;
}) {
  const actor = await requireManagement(input.accountAddress, input.workspaceId);
  const policy = normalizeInput(input.policy);
  const policyId = `rpol_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await validateBindings(client, input.workspaceId, policy);
    const duplicate = await client.query(
      `SELECT 1 FROM tokenless_agent_review_policies
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND enabled = true AND superseded_at IS NULL FOR SHARE`,
      [input.workspaceId, policy.agentId, policy.agentVersionId],
    );
    if (duplicate.rowCount) {
      throw new TokenlessServiceError(
        "This agent version already has an active review policy. Edit that policy instead.",
        409,
        "review_policy_exists",
      );
    }
    await client.query(
      `INSERT INTO tokenless_agent_review_policies
       (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
        agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
        audience_policy_json, publishing_policy_id, created_by, approved_by, created_at, superseded_at)
       VALUES ($1, 1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $12, $13, NULL)`,
      [
        policyId,
        input.workspaceId,
        policy.agentId,
        policy.agentVersionId,
        policy.mode,
        policy.agreementThresholdBps,
        policy.productionFloorBps,
        policy.maximumUnreviewedGap,
        rulesJson(policy),
        audienceJson(policy),
        policy.publishingPolicyId,
        actor,
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
  const policies = await loadPolicies(input.workspaceId);
  const created = policies.find(entry => entry.policyId === policyId);
  if (!created) throw new Error("Created review policy could not be loaded.");
  return created;
}

export async function updateManagedReviewPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  policyId: string;
  policy: unknown;
}) {
  const actor = await requireManagement(input.accountAddress, input.workspaceId);
  const policy = normalizeInput(input.policy);
  const now = new Date();
  const client = await dbPool.connect();
  let nextVersion = 0;
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT version, agent_id FROM tokenless_agent_review_policies
       WHERE workspace_id = $1 AND policy_id = $2 AND enabled = true AND superseded_at IS NULL
       FOR UPDATE`,
      [input.workspaceId, input.policyId],
    );
    if (current.rowCount !== 1) {
      throw new TokenlessServiceError("Review policy not found.", 404, "review_policy_not_found");
    }
    if (rowString(current.rows[0] as QueryRow, "agent_id") !== policy.agentId) {
      throw new TokenlessServiceError(
        "A review policy cannot be moved to a different agent.",
        409,
        "review_policy_agent_mismatch",
      );
    }
    nextVersion = rowInteger(current.rows[0] as QueryRow, "version") + 1;
    await validateBindings(client, input.workspaceId, policy);
    const duplicate = await client.query(
      `SELECT 1 FROM tokenless_agent_review_policies
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND policy_id <> $4 AND enabled = true AND superseded_at IS NULL FOR SHARE`,
      [input.workspaceId, policy.agentId, policy.agentVersionId, input.policyId],
    );
    if (duplicate.rowCount) {
      throw new TokenlessServiceError(
        "This agent version already has an active review policy.",
        409,
        "review_policy_exists",
      );
    }
    await client.query(
      `UPDATE tokenless_agent_review_policies SET enabled = false, superseded_at = $1
       WHERE workspace_id = $2 AND policy_id = $3 AND superseded_at IS NULL`,
      [now, input.workspaceId, input.policyId],
    );
    await client.query(
      `INSERT INTO tokenless_agent_review_policies
       (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
        agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
        audience_policy_json, publishing_policy_id, created_by, approved_by, created_at, superseded_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11, $12, $13, $13, $14, NULL)`,
      [
        input.policyId,
        nextVersion,
        input.workspaceId,
        policy.agentId,
        policy.agentVersionId,
        policy.mode,
        policy.agreementThresholdBps,
        policy.productionFloorBps,
        policy.maximumUnreviewedGap,
        rulesJson(policy),
        audienceJson(policy),
        policy.publishingPolicyId,
        actor,
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
  const policies = await loadPolicies(input.workspaceId);
  const updated = policies.find(entry => entry.policyId === input.policyId && entry.version === nextVersion);
  if (!updated) throw new Error("Updated review policy could not be loaded.");
  return updated;
}

export async function disableManagedReviewPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  policyId: string;
}) {
  await requireManagement(input.accountAddress, input.workspaceId);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies SET enabled = false, superseded_at = ?
          WHERE workspace_id = ? AND policy_id = ? AND enabled = true AND superseded_at IS NULL`,
    args: [now, input.workspaceId, input.policyId],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Review policy not found.", 404, "review_policy_not_found");
  }
}

export const __reviewPolicyManagementTestUtils = { normalizeInput };

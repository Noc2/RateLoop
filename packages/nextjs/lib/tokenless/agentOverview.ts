import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { type AgentAssuranceScopeSummary, type WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { type AgentReviewQuality, loadAgentReviewQuality } from "~~/lib/tokenless/agentReviewQuality";
import { type AssuranceMetricsSnapshot, collectWorkspaceAssuranceMetrics } from "~~/lib/tokenless/assuranceMetrics";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";

type QueryRow = Record<string, unknown>;

const OVERVIEW_WINDOW_DAYS = 30;
const OVERVIEW_WINDOW_MS = OVERVIEW_WINDOW_DAYS * 24 * 60 * 60_000;
export const AGENT_OVERVIEW_PARENT_PAGE_SIZE = 20;
export const MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT = 8;
export const MAX_AGENT_OVERVIEW_OBSERVATIONS = 10_000;

function rowText(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function rowNullableNumber(row: QueryRow | undefined, key: string) {
  const raw = row?.[key];
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function rowIso(row: QueryRow, key: string) {
  const value = row[key] instanceof Date ? row[key] : new Date(String(row[key] ?? ""));
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Database returned invalid ${key}.`);
  }
  return value.toISOString();
}

function wilsonLowerSql(agreementExpression: string, comparableExpression: string) {
  const z = "1.959963984540054";
  const zSquared = "3.8414588206941254";
  const p = `((${agreementExpression})::double precision / (${comparableExpression}))`;
  const denominator = `(1 + ${zSquared} / (${comparableExpression}))`;
  const center = `((${p} + ${zSquared} / (2 * (${comparableExpression}))) / ${denominator})`;
  const margin = `((${z} * SQRT((${p} * (1 - ${p})) / (${comparableExpression}) + ${zSquared} / (4 * (${comparableExpression}) * (${comparableExpression})))) / ${denominator})`;
  return `FLOOR(GREATEST(0, (${center} - ${margin}) * 10000))`;
}

type OverviewObservation = {
  agreement: "agree" | "disagree" | "abstain" | "inconclusive";
  comparable: boolean;
  latencyMs: number | null;
  costAtomic: string | null;
  finalizedAt: string;
};

export type AgentOverviewScope = Pick<
  AgentAssuranceScopeSummary,
  | "scopeId"
  | "workflowKey"
  | "riskTier"
  | "stage"
  | "reviewRateBps"
  | "comparableCount"
  | "agreementCount"
  | "humanAgreementBps"
  | "humanAgreementLower95Bps"
  | "averageTotalDurationMs"
  | "averageInputTokenTotal"
  | "averageOutputTokenTotal"
  | "lastTransition"
  | "updatedAt"
>;

export type AgentOverviewParent = {
  agentId: string;
  agentStatus: WorkspaceAgent["status"];
  versionId: string;
  versionNumber: number;
  displayName: string;
  environment: string;
  scopeCount: number;
  scopesTruncated: boolean;
  stageCounts: Record<AgentAssuranceScopeSummary["stage"], number>;
  lowestEndorsement: {
    lower95Bps: number;
    workflowKey: string;
    riskTier: string;
  } | null;
  scopes: AgentOverviewScope[];
};

export type AgentOverviewOutcomeTrendPoint = {
  date: string;
  completedCount: number;
  endorsedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
};

export type AgentOverviewDecisionTimeTrendPoint = {
  date: string;
  medianMilliseconds: number | null;
  sampleSize: number;
};

export type AgentOverviewAttentionItem =
  | {
      itemId: string;
      kind: "blocked";
      agentId: string;
      displayName: string;
      blockedCount: number;
    }
  | {
      itemId: string;
      kind: "low_confidence";
      agentId: string;
      displayName: string;
      scopeId: string;
      workflowKey: string;
      riskTier: string;
      comparableCount: number;
      rejectedCount: number;
      lower95Bps: number;
      policyThresholdBps: number;
    }
  | {
      itemId: string;
      kind: "insufficient";
      agentId: string;
      displayName: string;
      scopeId: string;
      workflowKey: string;
      riskTier: string;
      comparableCount: number;
      targetComparableCount: number;
    };

type AvailableEndorsement = {
  available: true;
  rateBps: number;
  intervalBps: { lower: number; upper: number };
  endorsedCount: number;
  sampleSize: number;
  limitedSample: boolean;
};

type UnavailableMetric = { available: false; reason: string };

export type AgentOverview = {
  window: { days: 30; label: "Last 30 days"; startsAt: string; endsAt: string };
  headline: {
    completedDecisions: number;
    reviewerEndorsement: AvailableEndorsement | UnavailableMetric;
    medianDecisionLatency: { available: true; milliseconds: number; sampleSize: number } | UnavailableMetric;
    costPerDecision:
      | { available: true; averageAtomic: string; sampleSize: number }
      | (UnavailableMetric & { recordedCount: number; decisionCount: number });
  };
  trends: {
    periodLabel: "Last 30 days";
    outcomes:
      | {
          available: true;
          points: AgentOverviewOutcomeTrendPoint[];
          completedCount: number;
          endorsedCount: number;
          rejectedCount: number;
          inconclusiveCount: number;
        }
      | UnavailableMetric;
    decisionTime:
      | {
          available: true;
          points: AgentOverviewDecisionTimeTrendPoint[];
          sampleSize: number;
        }
      | UnavailableMetric;
  };
  reviewQuality: AgentReviewQuality;
  agentVersions: {
    periodLabel: "Lifetime by scope";
    parents: AgentOverviewParent[];
    totalParentCount: number;
    page: number;
    pageSize: 20;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  attention: {
    periodLabel: "Current evidence state";
    items: AgentOverviewAttentionItem[];
    totalItemCount: number;
    itemsTruncated: boolean;
  };
};

type OverviewAgentSource = Pick<WorkspaceAgent, "agentId" | "status" | "currentVersion" | "assuranceScopes"> & {
  humanReview?: Pick<WorkspaceAgent["humanReview"], "workload" | "management"> & {
    configuration?: WorkspaceAgent["humanReview"]["configuration"];
  };
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : Math.round((ordered[middle - 1]! + ordered[middle]!) / 2);
}

function utcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function calendarDates(startsAt: Date, endsAt: Date) {
  const current = new Date(`${utcDate(startsAt)}T00:00:00.000Z`);
  const final = new Date(`${utcDate(endsAt)}T00:00:00.000Z`);
  const dates: string[] = [];
  while (current <= final) {
    dates.push(utcDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates.slice(-30);
}

function trendProjection(input: {
  observations: OverviewObservation[];
  observationsTruncated: boolean;
  startsAt: Date;
  endsAt: Date;
}): AgentOverview["trends"] {
  const unavailableReason = "More than 10,000 decisions fall in this window; use the evidence export for exact trends.";
  if (input.observationsTruncated) {
    return {
      periodLabel: "Last 30 days",
      outcomes: { available: false, reason: unavailableReason },
      decisionTime: { available: false, reason: unavailableReason },
    };
  }

  const byDate = new Map<
    string,
    {
      completedCount: number;
      endorsedCount: number;
      rejectedCount: number;
      inconclusiveCount: number;
      latencies: number[];
    }
  >(
    calendarDates(input.startsAt, input.endsAt).map(date => [
      date,
      {
        completedCount: 0,
        endorsedCount: 0,
        rejectedCount: 0,
        inconclusiveCount: 0,
        latencies: [],
      },
    ]),
  );
  for (const observation of input.observations) {
    const point = byDate.get(observation.finalizedAt.slice(0, 10));
    if (!point) continue;
    point.completedCount += 1;
    if (observation.comparable && observation.agreement === "agree") point.endorsedCount += 1;
    else if (observation.comparable && observation.agreement === "disagree") point.rejectedCount += 1;
    else point.inconclusiveCount += 1;
    if (observation.latencyMs !== null) point.latencies.push(observation.latencyMs);
  }

  const outcomes = [...byDate.entries()].map(([date, point]) => ({
    date,
    completedCount: point.completedCount,
    endorsedCount: point.endorsedCount,
    rejectedCount: point.rejectedCount,
    inconclusiveCount: point.inconclusiveCount,
  }));
  const decisionTime = [...byDate.entries()].map(([date, point]) => ({
    date,
    medianMilliseconds: median(point.latencies),
    sampleSize: point.latencies.length,
  }));
  const totals = outcomes.reduce(
    (sum, point) => ({
      completedCount: sum.completedCount + point.completedCount,
      endorsedCount: sum.endorsedCount + point.endorsedCount,
      rejectedCount: sum.rejectedCount + point.rejectedCount,
      inconclusiveCount: sum.inconclusiveCount + point.inconclusiveCount,
    }),
    { completedCount: 0, endorsedCount: 0, rejectedCount: 0, inconclusiveCount: 0 },
  );
  const timedSampleSize = decisionTime.reduce((sum, point) => sum + point.sampleSize, 0);

  return {
    periodLabel: "Last 30 days",
    outcomes:
      totals.completedCount > 0
        ? { available: true, points: outcomes, ...totals }
        : { available: false, reason: "No completed review outcomes in this window." },
    decisionTime:
      timedSampleSize > 0
        ? { available: true, points: decisionTime, sampleSize: timedSampleSize }
        : { available: false, reason: "No decision timing is available in this window." },
  };
}

function attentionProjection(agents: OverviewAgentSource[]): AgentOverview["attention"] {
  const candidates: Array<{ priority: number; severity: number; item: AgentOverviewAttentionItem }> = [];
  for (const agent of agents) {
    if (agent.humanReview?.configuration?.request.resultSemantics === "feedback") continue;
    const displayName = agent.currentVersion.displayName;
    const blockedCount = agent.humanReview?.workload.blockedCount ?? 0;
    if (agent.humanReview?.management && blockedCount > 0) {
      candidates.push({
        priority: 0,
        severity: blockedCount,
        item: {
          itemId: `blocked:${agent.agentId}`,
          kind: "blocked",
          agentId: agent.agentId,
          displayName,
          blockedCount,
        },
      });
    }

    const selectionPolicy = agent.humanReview?.management?.selectionPolicy ?? null;
    const scopes = agent.assuranceScopes.filter(
      scope =>
        scope.agentVersionId === agent.currentVersion.versionId &&
        selectionPolicy !== null &&
        scope.policyId === selectionPolicy.id &&
        scope.policyVersion === selectionPolicy.version,
    );
    for (const scope of scopes) {
      if (scope.comparableCount < 30) {
        candidates.push({
          priority: 2,
          severity: 30 - scope.comparableCount,
          item: {
            itemId: `insufficient:${scope.scopeId}`,
            kind: "insufficient",
            agentId: agent.agentId,
            displayName,
            scopeId: scope.scopeId,
            workflowKey: scope.workflowKey,
            riskTier: scope.riskTier,
            comparableCount: scope.comparableCount,
            targetComparableCount: 30,
          },
        });
        continue;
      }
      const thresholdApplies = selectionPolicy !== null && scope.humanAgreementLower95Bps !== null;
      if (thresholdApplies && scope.humanAgreementLower95Bps! < selectionPolicy.agreementThresholdBps) {
        candidates.push({
          priority: 1,
          severity: selectionPolicy.agreementThresholdBps - scope.humanAgreementLower95Bps!,
          item: {
            itemId: `low-confidence:${scope.scopeId}`,
            kind: "low_confidence",
            agentId: agent.agentId,
            displayName,
            scopeId: scope.scopeId,
            workflowKey: scope.workflowKey,
            riskTier: scope.riskTier,
            comparableCount: scope.comparableCount,
            rejectedCount: Math.max(0, scope.comparableCount - scope.agreementCount),
            lower95Bps: scope.humanAgreementLower95Bps!,
            policyThresholdBps: selectionPolicy.agreementThresholdBps,
          },
        });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      left.priority - right.priority ||
      right.severity - left.severity ||
      left.item.displayName.localeCompare(right.item.displayName) ||
      left.item.itemId.localeCompare(right.item.itemId),
  );
  const items = candidates.slice(0, 5).map(candidate => candidate.item);
  return {
    periodLabel: "Current evidence state",
    items,
    totalItemCount: candidates.length,
    itemsTruncated: candidates.length > items.length,
  };
}

function stageCounts(scopes: AgentAssuranceScopeSummary[]) {
  const counts: AgentOverviewParent["stageCounts"] = {
    calibrating: 0,
    high_coverage: 0,
    medium_coverage: 0,
    monitoring: 0,
  };
  for (const scope of scopes) counts[scope.stage] += 1;
  return counts;
}

function overviewParents(agents: OverviewAgentSource[]) {
  return agents.map(agent => {
    const scopes = agent.assuranceScopes
      .filter(scope => scope.agentVersionId === agent.currentVersion.versionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const lowestScope = scopes
      .filter(
        (
          scope,
        ): scope is AgentAssuranceScopeSummary & {
          humanAgreementLower95Bps: number;
        } => scope.humanAgreementLower95Bps !== null,
      )
      .sort(
        (left, right) =>
          left.humanAgreementLower95Bps - right.humanAgreementLower95Bps ||
          left.workflowKey.localeCompare(right.workflowKey),
      )[0];
    return {
      agentId: agent.agentId,
      agentStatus: agent.status,
      versionId: agent.currentVersion.versionId,
      versionNumber: agent.currentVersion.versionNumber,
      displayName: agent.currentVersion.displayName,
      environment: agent.currentVersion.environment,
      scopeCount: scopes.length,
      scopesTruncated: scopes.length > MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT,
      stageCounts: stageCounts(scopes),
      lowestEndorsement: lowestScope
        ? {
            lower95Bps: lowestScope.humanAgreementLower95Bps,
            workflowKey: lowestScope.workflowKey,
            riskTier: lowestScope.riskTier,
          }
        : null,
      scopes: scopes.slice(0, MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT).map(scope => ({
        scopeId: scope.scopeId,
        workflowKey: scope.workflowKey,
        riskTier: scope.riskTier,
        stage: scope.stage,
        reviewRateBps: scope.reviewRateBps,
        comparableCount: scope.comparableCount,
        agreementCount: scope.agreementCount,
        humanAgreementBps: scope.humanAgreementBps,
        humanAgreementLower95Bps: scope.humanAgreementLower95Bps,
        averageTotalDurationMs: scope.averageTotalDurationMs,
        averageInputTokenTotal: scope.averageInputTokenTotal,
        averageOutputTokenTotal: scope.averageOutputTokenTotal,
        lastTransition: scope.lastTransition,
        updatedAt: scope.updatedAt,
      })),
    } satisfies AgentOverviewParent;
  });
}

function agentVersionPage(input: {
  parents: AgentOverviewParent[];
  requestedPage: number;
  totalParentCount?: number;
  alreadyPaged?: boolean;
}): AgentOverview["agentVersions"] {
  const totalParentCount = input.totalParentCount ?? input.parents.length;
  const totalPages = Math.max(1, Math.ceil(totalParentCount / AGENT_OVERVIEW_PARENT_PAGE_SIZE));
  const page = Math.min(Math.max(1, input.requestedPage), totalPages);
  const parents = input.alreadyPaged
    ? input.parents
    : input.parents.slice((page - 1) * AGENT_OVERVIEW_PARENT_PAGE_SIZE, page * AGENT_OVERVIEW_PARENT_PAGE_SIZE);
  return {
    periodLabel: "Lifetime by scope",
    parents,
    totalParentCount,
    page,
    pageSize: AGENT_OVERVIEW_PARENT_PAGE_SIZE,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

const OVERVIEW_STAGE_RATES: Record<AgentAssuranceScopeSummary["stage"], number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: 1_000,
};

async function requireAgentOverviewAccess(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
          WHERE m.workspace_id=? AND m.account_address=? AND w.status='active'
          LIMIT 1`,
    args: [workspaceId, actor],
  });
  const role = rowText(result.rows[0] as QueryRow | undefined, "role");
  if (!role) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return { canManage: role === "owner" || role === "admin" };
}

async function countAgentOverviewParents(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT COUNT(DISTINCT agent.agent_id) AS total
          FROM tokenless_agents agent
          JOIN tokenless_agent_versions version
            ON version.workspace_id=agent.workspace_id AND version.agent_id=agent.agent_id
          WHERE agent.workspace_id=?`,
    args: [workspaceId],
  });
  return rowInteger(result.rows[0] as QueryRow | undefined, "total");
}

function overviewStage(value: unknown): AgentAssuranceScopeSummary["stage"] {
  const stage = String(value ?? "");
  if (!["calibrating", "high_coverage", "medium_coverage", "monitoring"].includes(stage)) {
    throw new Error("Database returned an invalid overview stage.");
  }
  return stage as AgentAssuranceScopeSummary["stage"];
}

function reasonCodes(value: unknown) {
  if (value === null || value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Database returned invalid overview transition reasons.");
  }
  if (!Array.isArray(parsed) || parsed.some(reason => typeof reason !== "string")) {
    throw new Error("Database returned invalid overview transition reasons.");
  }
  return parsed as string[];
}

function scopeReviewRate(row: QueryRow, stage: AgentAssuranceScopeSummary["stage"]) {
  const mode = rowText(row, "mode");
  const productionFloorBps = rowInteger(row, "production_floor_bps");
  if (mode === "always") return 10_000;
  if (mode === "adaptive") return Math.max(OVERVIEW_STAGE_RATES[stage], productionFloorBps);
  if (mode === "fixed") return rowInteger(row, "fixed_rate_bps");
  if (["manual", "rules"].includes(mode ?? "")) return 0;
  throw new Error("Database returned an invalid overview review mode.");
}

async function loadAgentOverviewParentPage(input: {
  workspaceId: string;
  page: number;
  totalParentCount: number;
}): Promise<AgentOverview["agentVersions"]> {
  const offset = (input.page - 1) * AGENT_OVERVIEW_PARENT_PAGE_SIZE;
  const parentResult = await dbClient.execute({
    sql: `WITH ranked_versions AS (
            SELECT agent.agent_id,agent.status,agent.created_at,
                   version.version_id,version.version_number,version.display_name,version.environment,
                   ROW_NUMBER() OVER (
                     PARTITION BY agent.agent_id
                     ORDER BY version.version_number DESC,version.version_id ASC
                   ) AS version_rank
            FROM tokenless_agents agent
            JOIN tokenless_agent_versions version
              ON version.workspace_id=agent.workspace_id AND version.agent_id=agent.agent_id
            WHERE agent.workspace_id=?
          )
          SELECT agent_id,status,version_id,version_number,display_name,environment
          FROM ranked_versions
          WHERE version_rank=1
          ORDER BY created_at DESC,agent_id ASC
          LIMIT ? OFFSET ?`,
    args: [input.workspaceId, AGENT_OVERVIEW_PARENT_PAGE_SIZE, offset],
  });
  const parents: AgentOverviewParent[] = (parentResult.rows as QueryRow[]).map(row => {
    const agentId = rowText(row, "agent_id");
    const status = rowText(row, "status");
    const versionId = rowText(row, "version_id");
    const displayName = rowText(row, "display_name");
    const environment = rowText(row, "environment");
    if (!agentId || !["active", "inactive"].includes(status ?? "") || !versionId || !displayName || !environment) {
      throw new Error("Database returned an invalid overview agent version.");
    }
    const parent: AgentOverviewParent = {
      agentId,
      agentStatus: status as AgentOverviewParent["agentStatus"],
      versionId,
      versionNumber: rowInteger(row, "version_number"),
      displayName,
      environment,
      scopeCount: 0,
      scopesTruncated: false,
      stageCounts: { calibrating: 0, high_coverage: 0, medium_coverage: 0, monitoring: 0 },
      lowestEndorsement: null,
      scopes: [],
    };
    return parent;
  });
  const versionIds = parents.map(parent => parent.versionId);
  if (versionIds.length === 0) {
    return agentVersionPage({
      parents,
      requestedPage: input.page,
      totalParentCount: input.totalParentCount,
      alreadyPaged: true,
    });
  }

  const lowerSql = wilsonLowerSql("e.agreements", "e.comparable");
  const [statsResult, scopesResult] = await Promise.all([
    dbClient.execute({
      sql: `WITH requested_versions AS (
              SELECT UNNEST(?::text[]) AS version_id
            ), scope_counts AS (
              SELECT scope.agent_version_id,
                     COUNT(*) AS scope_count,
                     COUNT(*) FILTER (WHERE scope.stage='calibrating') AS calibrating_count,
                     COUNT(*) FILTER (WHERE scope.stage='high_coverage') AS high_coverage_count,
                     COUNT(*) FILTER (WHERE scope.stage='medium_coverage') AS medium_coverage_count,
                     COUNT(*) FILTER (WHERE scope.stage='monitoring') AS monitoring_count
              FROM tokenless_agent_evaluation_scopes scope
              WHERE scope.workspace_id=? AND scope.agent_version_id=ANY(?::text[])
              GROUP BY scope.agent_version_id
            ), evidence AS (
              SELECT scope.agent_version_id,scope.scope_id,scope.workflow_key,scope.risk_tier,
                     COUNT(*) FILTER (WHERE observation.comparable=true) AS comparable,
                     COUNT(*) FILTER (WHERE observation.comparable=true AND observation.agreement='agree') AS agreements
              FROM tokenless_agent_evaluation_scopes scope
              LEFT JOIN tokenless_agent_evaluation_observations observation
                ON observation.workspace_id=scope.workspace_id AND observation.scope_id=scope.scope_id
              WHERE scope.workspace_id=? AND scope.agent_version_id=ANY(?::text[])
              GROUP BY scope.agent_version_id,scope.scope_id,scope.workflow_key,scope.risk_tier
            )
            SELECT requested.version_id,
                   COALESCE(counts.scope_count,0) AS scope_count,
                   COALESCE(counts.calibrating_count,0) AS calibrating_count,
                   COALESCE(counts.high_coverage_count,0) AS high_coverage_count,
                   COALESCE(counts.medium_coverage_count,0) AS medium_coverage_count,
                   COALESCE(counts.monitoring_count,0) AS monitoring_count,
                   lowest.workflow_key AS lowest_workflow_key,
                   lowest.risk_tier AS lowest_risk_tier,
                   lowest.agreements AS lowest_agreements,
                   lowest.comparable AS lowest_comparable
            FROM requested_versions requested
            LEFT JOIN scope_counts counts ON counts.agent_version_id=requested.version_id
            LEFT JOIN LATERAL (
              SELECT e.workflow_key,e.risk_tier,e.agreements,e.comparable,${lowerSql} AS lower_bps
              FROM evidence e
              WHERE e.agent_version_id=requested.version_id AND e.comparable>0
              ORDER BY lower_bps ASC,e.workflow_key ASC,e.scope_id ASC
              LIMIT 1
            ) lowest ON true`,
      args: [versionIds, input.workspaceId, versionIds, input.workspaceId, versionIds],
    }),
    dbClient.execute({
      sql: `WITH ranked_scopes AS (
              SELECT scope.scope_id,scope.agent_version_id,scope.workflow_key,scope.risk_tier,scope.stage,
                     scope.updated_at,policy.mode,policy.production_floor_bps,policy.fixed_rate_bps,
                     ROW_NUMBER() OVER (
                       PARTITION BY scope.agent_version_id
                       ORDER BY scope.updated_at DESC,scope.scope_id ASC
                     ) AS scope_rank
              FROM tokenless_agent_evaluation_scopes scope
              JOIN tokenless_agent_review_policies policy
                ON policy.workspace_id=scope.workspace_id
               AND policy.policy_id=scope.policy_id AND policy.version=scope.policy_version
              WHERE scope.workspace_id=? AND scope.agent_version_id=ANY(?::text[])
            )
            SELECT scope.*,
                   COALESCE(opportunities.reviewed,0) AS reviewed,
                   COALESCE(opportunities.skipped,0) AS skipped,
                   COALESCE(observations.comparable,0) AS comparable,
                   COALESCE(observations.agreements,0) AS agreements,
                   executions.average_total_duration_ms,
                   executions.average_input_token_total,
                   executions.average_output_token_total,
                   transition.event_type AS transition_event_type,
                   transition.from_stage AS transition_from_stage,
                   transition.to_stage AS transition_to_stage,
                   transition.reason_codes_json AS transition_reason_codes_json,
                   transition.created_at AS transition_created_at
            FROM ranked_scopes scope
            LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE opportunity.status IN ('review_requested','completed')) AS reviewed,
                     COUNT(*) FILTER (WHERE opportunity.status='skipped') AS skipped
              FROM tokenless_agent_review_opportunities opportunity
              WHERE opportunity.workspace_id=? AND opportunity.scope_id=scope.scope_id
            ) opportunities ON true
            LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE observation.comparable=true) AS comparable,
                     COUNT(*) FILTER (
                       WHERE observation.comparable=true AND observation.agreement='agree'
                     ) AS agreements
              FROM tokenless_agent_evaluation_observations observation
              WHERE observation.workspace_id=? AND observation.scope_id=scope.scope_id
            ) observations ON true
            LEFT JOIN LATERAL (
              SELECT AVG(value.total_duration_ms) AS average_total_duration_ms,
                     AVG(value.input_token_total) AS average_input_token_total,
                     AVG(value.output_token_total) AS average_output_token_total
              FROM (
                SELECT DISTINCT execution.execution_id,execution.total_duration_ms,
                                execution.input_token_total,execution.output_token_total
                FROM tokenless_agent_review_opportunities opportunity
                JOIN tokenless_agent_executions execution
                  ON execution.workspace_id=opportunity.workspace_id
                 AND execution.execution_id=opportunity.execution_id
                WHERE opportunity.workspace_id=? AND opportunity.scope_id=scope.scope_id
                  AND opportunity.execution_id IS NOT NULL
              ) value
            ) executions ON true
            LEFT JOIN LATERAL (
              SELECT event.event_type,event.from_stage,event.to_stage,event.reason_codes_json,event.created_at
              FROM tokenless_agent_review_policy_events event
              WHERE event.workspace_id=? AND event.scope_id=scope.scope_id
                AND event.event_type IN ('stage_changed','reset')
              ORDER BY event.created_at DESC,event.event_id DESC
              LIMIT 1
            ) transition ON true
            WHERE scope.scope_rank<=?
            ORDER BY scope.agent_version_id ASC,scope.updated_at DESC,scope.scope_id ASC`,
      args: [
        input.workspaceId,
        versionIds,
        input.workspaceId,
        input.workspaceId,
        input.workspaceId,
        input.workspaceId,
        MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT,
      ],
    }),
  ]);

  const parentsByVersion = new Map(parents.map(parent => [parent.versionId, parent] as const));
  for (const row of statsResult.rows as QueryRow[]) {
    const versionId = rowText(row, "version_id");
    const parent = versionId ? parentsByVersion.get(versionId) : null;
    if (!parent) throw new Error("Database returned an invalid overview parent rollup.");
    const comparable = rowInteger(row, "lowest_comparable");
    const agreements = rowInteger(row, "lowest_agreements");
    const lowestWorkflowKey = rowText(row, "lowest_workflow_key");
    const lowestRiskTier = rowText(row, "lowest_risk_tier");
    parent.scopeCount = rowInteger(row, "scope_count");
    parent.scopesTruncated = parent.scopeCount > MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT;
    parent.stageCounts = {
      calibrating: rowInteger(row, "calibrating_count"),
      high_coverage: rowInteger(row, "high_coverage_count"),
      medium_coverage: rowInteger(row, "medium_coverage_count"),
      monitoring: rowInteger(row, "monitoring_count"),
    };
    parent.lowestEndorsement =
      comparable > 0 && lowestWorkflowKey && lowestRiskTier
        ? {
            lower95Bps: wilsonIntervalBps(agreements, comparable).lower,
            workflowKey: lowestWorkflowKey,
            riskTier: lowestRiskTier,
          }
        : null;
  }
  for (const row of scopesResult.rows as QueryRow[]) {
    const versionId = rowText(row, "agent_version_id");
    const parent = versionId ? parentsByVersion.get(versionId) : null;
    const scopeId = rowText(row, "scope_id");
    const workflowKey = rowText(row, "workflow_key");
    const riskTier = rowText(row, "risk_tier");
    if (!parent || !scopeId || !workflowKey || !riskTier) {
      throw new Error("Database returned an invalid overview scope.");
    }
    const comparableCount = rowInteger(row, "comparable");
    const agreementCount = rowInteger(row, "agreements");
    const interval = comparableCount > 0 ? wilsonIntervalBps(agreementCount, comparableCount) : null;
    const stage = overviewStage(row.stage);
    const transitionEvent = rowText(row, "transition_event_type");
    const transitionFrom = rowText(row, "transition_from_stage");
    const transitionTo = rowText(row, "transition_to_stage");
    parent.scopes.push({
      scopeId,
      workflowKey,
      riskTier,
      stage,
      reviewRateBps: scopeReviewRate(row, stage),
      comparableCount,
      agreementCount,
      humanAgreementBps: comparableCount > 0 ? Math.floor((agreementCount * 10_000) / comparableCount) : null,
      humanAgreementLower95Bps: interval?.lower ?? null,
      averageTotalDurationMs: rowNullableNumber(row, "average_total_duration_ms"),
      averageInputTokenTotal: rowNullableNumber(row, "average_input_token_total"),
      averageOutputTokenTotal: rowNullableNumber(row, "average_output_token_total"),
      lastTransition:
        transitionEvent && row.transition_created_at
          ? {
              eventType: transitionEvent as "stage_changed" | "reset",
              fromStage: transitionFrom ? overviewStage(transitionFrom) : null,
              toStage: transitionTo ? overviewStage(transitionTo) : null,
              reasonCodes: reasonCodes(row.transition_reason_codes_json),
              createdAt: rowIso(row, "transition_created_at"),
            }
          : null,
      updatedAt: rowIso(row, "updated_at"),
    });
  }
  return agentVersionPage({
    parents,
    requestedPage: input.page,
    totalParentCount: input.totalParentCount,
    alreadyPaged: true,
  });
}

async function loadAgentOverviewAttention(input: {
  workspaceId: string;
  canManage: boolean;
}): Promise<AgentOverview["attention"]> {
  if (!input.canManage) {
    return {
      periodLabel: "Current evidence state",
      items: [],
      totalItemCount: 0,
      itemsTruncated: false,
    };
  }
  const lowerSql = wilsonLowerSql("e.agreements", "e.comparable");
  const result = await dbClient.execute({
    sql: `WITH current_versions AS (
            SELECT DISTINCT ON (agent.agent_id)
                   agent.agent_id,version.version_id,version.display_name
            FROM tokenless_agents agent
            JOIN tokenless_agent_versions version
              ON version.workspace_id=agent.workspace_id AND version.agent_id=agent.agent_id
            WHERE agent.workspace_id=?
            ORDER BY agent.agent_id,version.version_number DESC,version.version_id ASC
          ), active_review AS (
            SELECT binding.agent_id,binding.agent_version_id,
                   binding.selection_policy_id AS policy_id,
                   binding.selection_policy_version AS policy_version,
                   policy.agreement_threshold_bps
            FROM tokenless_agent_human_review_bindings binding
            JOIN tokenless_agent_review_policies policy
              ON policy.workspace_id=binding.workspace_id
             AND policy.policy_id=binding.selection_policy_id
             AND policy.version=binding.selection_policy_version
            JOIN tokenless_agent_review_request_profiles profile
              ON profile.workspace_id=binding.workspace_id
             AND profile.profile_id=binding.request_profile_id
             AND profile.version=binding.request_profile_version
             AND profile.profile_hash=binding.request_profile_hash
            WHERE binding.workspace_id=? AND binding.enabled=true
              AND binding.superseded_at IS NULL AND profile.result_semantics='assurance'
          ), blocked AS (
            SELECT current.agent_id,current.display_name,COUNT(*) AS blocked_count
            FROM current_versions current
            JOIN active_review review
              ON review.agent_id=current.agent_id AND review.agent_version_id=current.version_id
            JOIN tokenless_agent_review_opportunities opportunity
              ON opportunity.workspace_id=? AND opportunity.agent_id=current.agent_id
             AND opportunity.agent_version_id=current.version_id
             AND opportunity.policy_id=review.policy_id AND opportunity.policy_version=review.policy_version
            JOIN tokenless_agent_review_opportunity_lifecycles lifecycle
              ON lifecycle.workspace_id=opportunity.workspace_id
             AND lifecycle.opportunity_id=opportunity.opportunity_id
            WHERE lifecycle.state='blocked'
            GROUP BY current.agent_id,current.display_name
          ), evidence AS (
            SELECT current.agent_id,current.display_name,scope.scope_id,scope.workflow_key,scope.risk_tier,
                   review.agreement_threshold_bps,
                   COUNT(*) FILTER (WHERE observation.comparable=true) AS comparable,
                   COUNT(*) FILTER (
                     WHERE observation.comparable=true AND observation.agreement='agree'
                   ) AS agreements
            FROM current_versions current
            JOIN active_review review
              ON review.agent_id=current.agent_id AND review.agent_version_id=current.version_id
            JOIN tokenless_agent_evaluation_scopes scope
              ON scope.workspace_id=? AND scope.agent_id=current.agent_id
             AND scope.agent_version_id=current.version_id
             AND scope.policy_id=review.policy_id AND scope.policy_version=review.policy_version
            LEFT JOIN tokenless_agent_evaluation_observations observation
              ON observation.workspace_id=scope.workspace_id AND observation.scope_id=scope.scope_id
            GROUP BY current.agent_id,current.display_name,scope.scope_id,scope.workflow_key,scope.risk_tier,
                     review.agreement_threshold_bps
          ), candidates AS (
            SELECT 0 AS priority,blocked.blocked_count AS severity,'blocked' AS item_kind,
                   blocked.agent_id,blocked.display_name,NULL::text AS scope_id,
                   NULL::text AS workflow_key,NULL::text AS risk_tier,
                   0::bigint AS comparable,0::bigint AS agreements,0 AS agreement_threshold_bps,
                   blocked.blocked_count
            FROM blocked
            UNION ALL
            SELECT 1 AS priority,(e.agreement_threshold_bps-${lowerSql}) AS severity,
                   'low_confidence' AS item_kind,e.agent_id,e.display_name,e.scope_id,e.workflow_key,e.risk_tier,
                   e.comparable,e.agreements,e.agreement_threshold_bps,0::bigint AS blocked_count
            FROM evidence e
            WHERE e.comparable>=30 AND ${lowerSql}<e.agreement_threshold_bps
            UNION ALL
            SELECT 2 AS priority,(30-e.comparable) AS severity,'insufficient' AS item_kind,
                   e.agent_id,e.display_name,e.scope_id,e.workflow_key,e.risk_tier,
                   e.comparable,e.agreements,e.agreement_threshold_bps,0::bigint AS blocked_count
            FROM evidence e WHERE e.comparable<30
          )
          SELECT candidates.*,COUNT(*) OVER() AS total_item_count FROM candidates
          ORDER BY priority ASC,severity DESC,display_name ASC,
                   COALESCE(scope_id,agent_id) ASC
          LIMIT 6`,
    args: [input.workspaceId, input.workspaceId, input.workspaceId, input.workspaceId],
  });
  const candidates = (result.rows as QueryRow[]).map(row => {
    const kind = rowText(row, "item_kind");
    const agentId = rowText(row, "agent_id");
    const displayName = rowText(row, "display_name");
    if (!agentId || !displayName) throw new Error("Database returned an invalid overview attention item.");
    if (kind === "blocked") {
      return {
        itemId: `blocked:${agentId}`,
        kind,
        agentId,
        displayName,
        blockedCount: rowInteger(row, "blocked_count"),
      } satisfies AgentOverviewAttentionItem;
    }
    const scopeId = rowText(row, "scope_id");
    const workflowKey = rowText(row, "workflow_key");
    const riskTier = rowText(row, "risk_tier");
    if (!scopeId || !workflowKey || !riskTier) {
      throw new Error("Database returned an invalid overview scope attention item.");
    }
    const comparableCount = rowInteger(row, "comparable");
    const agreementCount = rowInteger(row, "agreements");
    if (kind === "low_confidence") {
      const lower95Bps = wilsonIntervalBps(agreementCount, comparableCount).lower;
      return {
        itemId: `low-confidence:${scopeId}`,
        kind,
        agentId,
        displayName,
        scopeId,
        workflowKey,
        riskTier,
        comparableCount,
        rejectedCount: Math.max(0, comparableCount - agreementCount),
        lower95Bps,
        policyThresholdBps: rowInteger(row, "agreement_threshold_bps"),
      } satisfies AgentOverviewAttentionItem;
    }
    if (kind === "insufficient") {
      return {
        itemId: `insufficient:${scopeId}`,
        kind,
        agentId,
        displayName,
        scopeId,
        workflowKey,
        riskTier,
        comparableCount,
        targetComparableCount: 30,
      } satisfies AgentOverviewAttentionItem;
    }
    throw new Error("Database returned an invalid overview attention kind.");
  });
  return {
    periodLabel: "Current evidence state",
    items: candidates.slice(0, 5),
    totalItemCount: rowInteger(result.rows[0] as QueryRow | undefined, "total_item_count"),
    itemsTruncated: rowInteger(result.rows[0] as QueryRow | undefined, "total_item_count") > 5,
  };
}

export function projectAgentOverview(input: {
  agents: OverviewAgentSource[];
  metrics: Pick<AssuranceMetricsSnapshot, "reviewsCompleted">;
  observations: OverviewObservation[];
  observationsTruncated?: boolean;
  parentPage?: number;
  agentVersionPage?: {
    parents: AgentOverviewParent[];
    totalParentCount: number;
    page: number;
  };
  attention?: AgentOverview["attention"];
  reviewQuality?: AgentReviewQuality;
  now: Date;
}): AgentOverview {
  const startsAt = new Date(input.now.getTime() - OVERVIEW_WINDOW_MS);
  const observations = input.observations.filter(observation => {
    const finalizedAt = new Date(observation.finalizedAt);
    return finalizedAt >= startsAt && finalizedAt <= input.now;
  });
  const parents = overviewParents(input.agents);
  const truncatedReason = "More than 10,000 decisions fall in this window; use the evidence export for exact metrics.";
  const comparable = observations.filter(
    observation => observation.comparable && ["agree", "disagree"].includes(observation.agreement),
  );
  const endorsedCount = comparable.filter(observation => observation.agreement === "agree").length;
  const interval = comparable.length > 0 ? wilsonIntervalBps(endorsedCount, comparable.length) : null;
  const latencyValues = observations
    .map(observation => observation.latencyMs)
    .filter((value): value is number => value !== null);
  const medianLatency = median(latencyValues);
  const knownCosts = observations
    .map(observation => observation.costAtomic)
    .filter((value): value is string => value !== null);
  const allCostsKnown = observations.length > 0 && knownCosts.length === observations.length;
  const totalCost = allCostsKnown ? knownCosts.reduce((total, value) => total + BigInt(value), 0n) : null;
  const averageCost = totalCost === null ? null : (totalCost / BigInt(Math.max(1, observations.length))).toString();

  return {
    window: {
      days: OVERVIEW_WINDOW_DAYS,
      label: "Last 30 days",
      startsAt: startsAt.toISOString(),
      endsAt: input.now.toISOString(),
    },
    headline: {
      completedDecisions: input.metrics.reviewsCompleted,
      reviewerEndorsement: input.observationsTruncated
        ? { available: false, reason: truncatedReason }
        : interval
          ? {
              available: true,
              rateBps: Math.floor((endorsedCount * 10_000) / comparable.length),
              intervalBps: interval,
              endorsedCount,
              sampleSize: comparable.length,
              limitedSample: comparable.length < 30,
            }
          : { available: false, reason: "No comparable decisions in this window." },
      medianDecisionLatency: input.observationsTruncated
        ? { available: false, reason: truncatedReason }
        : medianLatency === null
          ? { available: false, reason: "No decision timing is available in this window." }
          : { available: true, milliseconds: medianLatency, sampleSize: latencyValues.length },
      costPerDecision: input.observationsTruncated
        ? {
            available: false,
            reason: truncatedReason,
            recordedCount: knownCosts.length,
            decisionCount: observations.length,
          }
        : averageCost === null
          ? {
              available: false,
              reason:
                observations.length === 0
                  ? "No decisions in this window."
                  : `Cost is recorded for ${knownCosts.length} of ${observations.length} decisions.`,
              recordedCount: knownCosts.length,
              decisionCount: observations.length,
            }
          : { available: true, averageAtomic: averageCost, sampleSize: observations.length },
    },
    trends: trendProjection({
      observations,
      observationsTruncated: input.observationsTruncated === true,
      startsAt,
      endsAt: input.now,
    }),
    reviewQuality:
      input.reviewQuality ??
      ({
        periodLabel: "Last 30 days",
        availability: "empty",
        privacyThreshold: null,
        consensus: { available: false, reason: "No completed review cases in this window." },
        reviewerConsistency: { available: false, reason: "No completed review cases in this window." },
        panelSplit: { available: false, reason: "No completed review cases in this window." },
        hotspots: { workflows: [], riskTiers: [], cases: [] },
        decisionTime: { available: false, reason: "No completed review cases in this window." },
      } satisfies AgentReviewQuality),
    agentVersions: input.agentVersionPage
      ? agentVersionPage({
          parents: input.agentVersionPage.parents,
          requestedPage: input.agentVersionPage.page,
          totalParentCount: input.agentVersionPage.totalParentCount,
          alreadyPaged: true,
        })
      : agentVersionPage({ parents, requestedPage: input.parentPage ?? 1 }),
    attention: input.attention ?? attentionProjection(input.agents),
  };
}

function observationFromRow(row: QueryRow): OverviewObservation {
  const agreement = String(row.agreement ?? "");
  if (!["agree", "disagree", "abstain", "inconclusive"].includes(agreement)) {
    throw new Error("Database returned an invalid overview agreement.");
  }
  const latencyValue = row.latency_ms;
  const latencyMs =
    latencyValue === null || latencyValue === undefined
      ? null
      : typeof latencyValue === "number"
        ? latencyValue
        : Number(latencyValue);
  if (latencyMs !== null && (!Number.isSafeInteger(latencyMs) || latencyMs < 0)) {
    throw new Error("Database returned an invalid overview latency.");
  }
  const costAtomic = row.cost_atomic === null || row.cost_atomic === undefined ? null : String(row.cost_atomic);
  if (costAtomic !== null && !/^\d+$/u.test(costAtomic)) {
    throw new Error("Database returned an invalid overview cost.");
  }
  const finalized = row.finalized_at instanceof Date ? row.finalized_at : new Date(String(row.finalized_at ?? ""));
  if (!Number.isFinite(finalized.getTime())) {
    throw new Error("Database returned an invalid overview finalization timestamp.");
  }
  return {
    agreement: agreement as OverviewObservation["agreement"],
    comparable: row.comparable === true || row.comparable === "t" || row.comparable === 1,
    latencyMs,
    costAtomic,
    finalizedAt: finalized.toISOString(),
  };
}

export async function getAgentOverview(input: {
  accountAddress: string;
  workspaceId: string;
  page?: number;
  now?: Date;
}): Promise<AgentOverview> {
  const now = input.now ?? new Date();
  const requestedPage = input.page ?? 1;
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new TokenlessServiceError("Overview page is invalid.", 400, "invalid_overview_page", false, "page");
  }
  const access = await requireAgentOverviewAccess(input.accountAddress, input.workspaceId);
  const startsAt = new Date(now.getTime() - OVERVIEW_WINDOW_MS);
  const totalParentCountPromise = countAgentOverviewParents(input.workspaceId);
  const metricsPromise = collectWorkspaceAssuranceMetrics({ workspaceId: input.workspaceId, now });
  const reviewQualityPromise = loadAgentReviewQuality({
    workspaceId: input.workspaceId,
    startsAt,
    endsAt: now,
  });
  const observationPromise = dbClient.execute({
    sql: `SELECT ob.agreement,ob.comparable,ob.latency_ms,ob.cost_atomic,ob.finalized_at
            FROM tokenless_agent_evaluation_observations ob
            JOIN tokenless_agent_review_opportunities opportunity
              ON opportunity.workspace_id=ob.workspace_id AND opportunity.opportunity_id=ob.opportunity_id
            JOIN tokenless_agent_review_request_profiles profile
              ON profile.workspace_id=opportunity.workspace_id
             AND profile.profile_id=opportunity.request_profile_id
             AND profile.version=opportunity.request_profile_version
             AND profile.profile_hash=opportunity.request_profile_hash
            WHERE ob.workspace_id=? AND ob.finalized_at>=? AND ob.finalized_at<=?
              AND profile.result_semantics='assurance'
            ORDER BY ob.finalized_at DESC,ob.observation_id DESC
            LIMIT ?`,
    args: [input.workspaceId, startsAt, now, MAX_AGENT_OVERVIEW_OBSERVATIONS + 1],
  });
  const attentionPromise = loadAgentOverviewAttention({
    workspaceId: input.workspaceId,
    canManage: access.canManage,
  });
  const totalParentCount = await totalParentCountPromise;
  const totalPages = Math.max(1, Math.ceil(totalParentCount / AGENT_OVERVIEW_PARENT_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const [metrics, observationResult, parentPage, attention, reviewQuality] = await Promise.all([
    metricsPromise,
    observationPromise,
    loadAgentOverviewParentPage({ workspaceId: input.workspaceId, page, totalParentCount }),
    attentionPromise,
    reviewQualityPromise,
  ]);
  return projectAgentOverview({
    agents: [],
    metrics,
    observations: observationResult.rows
      .slice(0, MAX_AGENT_OVERVIEW_OBSERVATIONS)
      .map(row => observationFromRow(row as QueryRow)),
    observationsTruncated: observationResult.rows.length > MAX_AGENT_OVERVIEW_OBSERVATIONS,
    agentVersionPage: {
      parents: parentPage.parents,
      totalParentCount: parentPage.totalParentCount,
      page: parentPage.page,
    },
    attention,
    reviewQuality,
    now,
  });
}

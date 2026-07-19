import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import { ADAPTIVE_REVIEW_STAGE_RATE_BPS, type AdaptiveReviewStage } from "~~/lib/tokenless/adaptiveReview";
import { listWorkspaceAgents } from "~~/lib/tokenless/agentRegistry";
import { decisionExplanationRequired } from "~~/lib/tokenless/decisionPromptSampling";
import { listAgentPublishingPolicies } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";

type QueryRow = Record<string, unknown>;

export type EvaluationRun = {
  runId: string;
  projectId: string;
  projectName: string;
  suiteName: string;
  status: string;
  reviewerSource: string;
  compensation: string;
  caseCount: number;
  calibrationCaseCount: number;
  mechanismHealth: {
    unanimityRateBps: number | null;
    rbtsScoreVarianceBps2: string | null;
    goldFailureRateBps: number | null;
    comparableDriftBps: number | null;
  } | null;
  validResponses: number;
  distinctReviewers: number;
  minimumAggregationSize: number;
  sampleStatus: "suppressed" | "small" | "sufficient";
  candidateSelectionShareBps: number | null;
  candidateSelectionIntervalBps: { lower: number; upper: number } | null;
  choices: { baseline: number; candidate: number; tie: number } | null;
  clientDecision: "go" | "revise" | "stop" | null;
  evidencePacketAvailable: boolean;
  evidencePacketDigest: string | null;
  /** Deterministically sampled: this run requires written reasons even for go. */
  explanationRequired: boolean;
  createdAt: string;
  completedAt: string | null;
  attribution: { status: "unattributed"; agentId: null; versionId: null };
};

/**
 * The caller's own recent decision trend — shown beside the decision forms so
 * a decider sees their own acceptance pattern before signing off again.
 */
export type DeciderDecisionTrend = {
  clientDecisions: { total: number; goCount: number };
  overrides: { total: number; acceptedCount: number };
};

export const ADAPTIVE_COVERAGE_REASON_CODES = [
  "two_stable_windows",
  "fifty_stable_cases",
  "one_hundred_stable_cases",
  "safety_gates_unavailable",
  "agreement_below_threshold",
  "completion_gate_failed",
  "human_agreement_gate_failed",
  "latency_gate_failed",
  "drift_gate_failed",
  "missing_metadata",
  "severe_disagreement_open",
  "policy_evidence_changed",
] as const;

export type AdaptiveCoverageReasonCode = (typeof ADAPTIVE_COVERAGE_REASON_CODES)[number];

export type AdaptiveCoverageChange = {
  fromRateBps: number;
  toRateBps: number;
  reason: AdaptiveCoverageReasonCode;
  changedAt: string;
};

export type AdaptiveCoverageTile = {
  scopeId: string;
  workflowKey: string;
  riskTier: string;
  stage: AdaptiveReviewStage;
  reviewRateBps: number;
  changes: AdaptiveCoverageChange[];
};

export type EvaluationDashboard = {
  workspaceId: string;
  callerRole: TokenlessWorkspaceRole;
  canViewPublishingPolicies: boolean;
  attributionReady: false;
  summary: {
    totalRuns: number;
    completedRuns: number;
    evidenceBackedRuns: number;
    validResponses: number;
    attributedRuns: 0;
  };
  agents: Array<{
    agentId: string;
    externalId: string;
    status: "active" | "inactive";
    versionId: string;
    versionNumber: number;
    displayName: string;
    declaredProvider: string;
    declaredModel: string;
    environment: string;
    attributedRunCount: 0;
    adaptiveCoverage: AdaptiveCoverageTile[];
  }>;
  deciderTrend: DeciderDecisionTrend;
  runs: EvaluationRun[];
  publishingPolicies: Array<{
    policyId: string;
    name: string;
    version: number;
    enabled: boolean;
    revokedAt: string | null;
    expiresAt: string | null;
    allowedPaymentModes: string[];
    maxPanelAtomic: string;
    maxDailyAtomic: string;
    maxMonthlyAtomic: string;
    maxPanelSize: number;
    maxBountyAtomic: string;
    onPolicyMiss: string;
  }> | null;
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function iso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Database returned an invalid evaluation timestamp.");
  return date.toISOString();
}

function minimumAggregationSize(value: unknown) {
  if (typeof value !== "string") return 3;
  try {
    const parsed = JSON.parse(value) as { minimumAggregationSize?: unknown };
    const minimum = Number(parsed.minimumAggregationSize);
    return Number.isSafeInteger(minimum) && minimum >= 2 ? minimum : 3;
  } catch {
    throw new Error("Database returned an invalid buyer privacy policy.");
  }
}

const adaptiveCoverageReasonCodes = new Set<string>(ADAPTIVE_COVERAGE_REASON_CODES);

function adaptiveStage(value: unknown) {
  const stage = String(value ?? "") as AdaptiveReviewStage;
  if (!(stage in ADAPTIVE_REVIEW_STAGE_RATE_BPS)) {
    throw new Error("Database returned an invalid adaptive coverage stage.");
  }
  return stage;
}

function adaptiveReviewRateBps(stage: AdaptiveReviewStage, productionFloorBps: number) {
  if (productionFloorBps > 10_000) throw new Error("Database returned an invalid adaptive production floor.");
  return Math.max(ADAPTIVE_REVIEW_STAGE_RATE_BPS[stage], productionFloorBps);
}

function adaptiveCoverageReason(value: unknown): AdaptiveCoverageReasonCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "[]"));
  } catch {
    throw new Error("Database returned invalid adaptive coverage reasons.");
  }
  if (!Array.isArray(parsed) || parsed.some(reason => typeof reason !== "string")) {
    throw new Error("Database returned invalid adaptive coverage reasons.");
  }
  const reason = parsed[0];
  return reason && adaptiveCoverageReasonCodes.has(reason)
    ? (reason as AdaptiveCoverageReasonCode)
    : "policy_evidence_changed";
}

async function requireWorkspaceAccess(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, address],
  });
  const role = rowString(result.rows[0] as QueryRow | undefined, "role") as TokenlessWorkspaceRole | null;
  if (!role) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return { address, role, canManage: role === "owner" || role === "admin" };
}

export async function getWorkspaceEvaluationDashboard(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<EvaluationDashboard> {
  const access = await requireWorkspaceAccess(input.accountAddress, input.workspaceId);
  const [
    registry,
    runResult,
    responseResult,
    caseResult,
    policies,
    adaptiveScopeResult,
    adaptiveEventResult,
    trendDecisions,
    trendOverrides,
  ] = await Promise.all([
    listWorkspaceAgents(input),
    dbClient.execute({
      sql: `SELECT r.run_id, r.project_id, r.status, r.created_at, r.completed_at,
                   p.name AS project_name, s.name AS suite_name,
                   ap.reviewer_source, ap.compensation, ap.buyer_privacy_json,
                   d.decision AS client_decision, ep.packet_id, ep.packet_digest,
                   mh.non_gold_case_count,mh.unanimous_case_count,mh.rbts_score_variance_bps2,
                   mh.gold_outcome_count,mh.gold_failure_count,mh.comparable_drift_bps
            FROM tokenless_assurance_runs r
            JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
            JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
            JOIN tokenless_assurance_audience_policies ap
              ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
            LEFT JOIN tokenless_assurance_client_decisions d ON d.run_id = r.run_id
            LEFT JOIN tokenless_assurance_evidence_packets ep ON ep.run_id = r.run_id
            LEFT JOIN tokenless_assurance_mechanism_health mh ON mh.run_id = r.run_id
            WHERE p.workspace_id = ? AND p.status <> 'deleted'
            ORDER BY r.created_at DESC LIMIT 100`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `WITH selected_runs AS (
              SELECT r.run_id
              FROM tokenless_assurance_runs r
              JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
              WHERE p.workspace_id = ? AND p.status <> 'deleted'
              ORDER BY r.created_at DESC LIMIT 100
            )
            SELECT selected_runs.run_id,
                   COUNT(CASE WHEN resp.validity = 'valid' THEN 1 END) AS valid_responses,
                   COUNT(DISTINCT CASE WHEN resp.validity = 'valid' THEN resp.reviewer_key END) AS distinct_reviewers,
                   COUNT(CASE WHEN resp.validity = 'valid' AND resp.choice = 'baseline' THEN 1 END) AS baseline,
                   COUNT(CASE WHEN resp.validity = 'valid' AND resp.choice = 'candidate' THEN 1 END) AS candidate,
                   COUNT(CASE WHEN resp.validity = 'valid' AND resp.choice = 'tie' THEN 1 END) AS tie
            FROM selected_runs
            LEFT JOIN tokenless_assurance_responses resp ON resp.run_id = selected_runs.run_id
            LEFT JOIN tokenless_assurance_run_gold_items gold
              ON gold.run_id=resp.run_id AND gold.case_id=resp.case_id
            WHERE gold.case_id IS NULL
            GROUP BY selected_runs.run_id`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `WITH selected_runs AS (
              SELECT r.run_id
              FROM tokenless_assurance_runs r
              JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
              WHERE p.workspace_id = ? AND p.status <> 'deleted'
              ORDER BY r.created_at DESC LIMIT 100
            )
            SELECT selected_runs.run_id,
                   COUNT(rc.case_id) FILTER (WHERE gold.case_id IS NULL) AS case_count,
                   COUNT(gold.case_id) AS calibration_case_count
            FROM selected_runs
            LEFT JOIN tokenless_assurance_run_cases rc ON rc.run_id = selected_runs.run_id
            LEFT JOIN tokenless_assurance_run_gold_items gold
              ON gold.run_id=rc.run_id AND gold.case_id=rc.case_id
            GROUP BY selected_runs.run_id`,
      args: [input.workspaceId],
    }),
    access.canManage
      ? listAgentPublishingPolicies({ accountAddress: access.address, workspaceId: input.workspaceId })
      : Promise.resolve(null),
    dbClient.execute({
      sql: `SELECT s.scope_id,s.agent_id,s.agent_version_id,s.workflow_key,s.risk_tier,s.stage,
                   s.updated_at,p.production_floor_bps
            FROM tokenless_agent_evaluation_scopes s
            JOIN tokenless_agent_review_policies p
              ON p.workspace_id=s.workspace_id AND p.policy_id=s.policy_id AND p.version=s.policy_version
            WHERE s.workspace_id=? AND p.mode='adaptive'
            ORDER BY s.updated_at DESC,s.scope_id ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT scope_id,from_stage,to_stage,reason_codes_json,created_at
            FROM tokenless_agent_review_policy_events
            WHERE workspace_id=? AND event_type IN ('stage_changed','reset')
            ORDER BY created_at DESC,event_id DESC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT d.decision
            FROM tokenless_assurance_client_decisions d
            JOIN tokenless_assurance_runs r ON r.run_id = d.run_id
            JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
            WHERE p.workspace_id = ? AND d.decided_by = ?
            ORDER BY d.decided_at DESC LIMIT 50`,
      args: [input.workspaceId, access.address],
    }),
    dbClient.execute({
      sql: `SELECT outcome FROM tokenless_assurance_override_decisions
            WHERE workspace_id = ? AND decided_by = ?
            ORDER BY decided_at DESC LIMIT 50`,
      args: [input.workspaceId, access.address],
    }),
  ]);

  const responsesByRun = new Map(
    (responseResult.rows as QueryRow[]).map(row => [rowString(row, "run_id")!, row] as const),
  );
  const casesByRun = new Map((caseResult.rows as QueryRow[]).map(row => [rowString(row, "run_id")!, row] as const));
  const runs = (runResult.rows as QueryRow[]).map(row => {
    const runId = rowString(row, "run_id")!;
    const responses = responsesByRun.get(runId);
    const validResponses = rowNumber(responses, "valid_responses");
    const distinctReviewers = rowNumber(responses, "distinct_reviewers");
    const candidate = rowNumber(responses, "candidate");
    const minimum = minimumAggregationSize(row.buyer_privacy_json);
    const released = distinctReviewers >= minimum;
    const sampleStatus = !released ? "suppressed" : validResponses < 30 ? "small" : "sufficient";
    const nonGoldCaseCount = rowNumber(row, "non_gold_case_count");
    const goldOutcomeCount = rowNumber(row, "gold_outcome_count");
    const hasMechanismHealth = row.non_gold_case_count !== null && row.non_gold_case_count !== undefined;
    return {
      runId,
      projectId: rowString(row, "project_id")!,
      projectName: rowString(row, "project_name")!,
      suiteName: rowString(row, "suite_name")!,
      status: rowString(row, "status")!,
      reviewerSource: rowString(row, "reviewer_source")!,
      compensation: rowString(row, "compensation")!,
      caseCount: rowNumber(casesByRun.get(runId), "case_count"),
      calibrationCaseCount: rowNumber(casesByRun.get(runId), "calibration_case_count"),
      mechanismHealth:
        hasMechanismHealth && released
          ? {
              unanimityRateBps: nonGoldCaseCount
                ? Math.floor((rowNumber(row, "unanimous_case_count") * 10_000) / nonGoldCaseCount)
                : null,
              rbtsScoreVarianceBps2: rowString(row, "rbts_score_variance_bps2"),
              goldFailureRateBps:
                goldOutcomeCount >= minimum
                  ? Math.floor((rowNumber(row, "gold_failure_count") * 10_000) / goldOutcomeCount)
                  : null,
              comparableDriftBps:
                row.comparable_drift_bps === null || row.comparable_drift_bps === undefined
                  ? null
                  : rowNumber(row, "comparable_drift_bps"),
            }
          : null,
      validResponses,
      distinctReviewers,
      minimumAggregationSize: minimum,
      sampleStatus,
      candidateSelectionShareBps: released ? Math.floor((candidate * 10_000) / validResponses) : null,
      candidateSelectionIntervalBps: released ? wilsonIntervalBps(candidate, validResponses) : null,
      choices: released
        ? {
            baseline: rowNumber(responses, "baseline"),
            candidate,
            tie: rowNumber(responses, "tie"),
          }
        : null,
      clientDecision: rowString(row, "client_decision") as EvaluationRun["clientDecision"],
      evidencePacketAvailable: Boolean(rowString(row, "packet_id")),
      evidencePacketDigest: rowString(row, "packet_digest"),
      explanationRequired: decisionExplanationRequired(runId),
      createdAt: iso(row.created_at),
      completedAt: row.completed_at ? iso(row.completed_at) : null,
      attribution: { status: "unattributed" as const, agentId: null, versionId: null },
    } satisfies EvaluationRun;
  });

  const changesByScope = new Map<string, QueryRow[]>();
  for (const value of adaptiveEventResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    if (!scopeId) throw new Error("Database returned an invalid adaptive coverage event.");
    changesByScope.set(scopeId, [...(changesByScope.get(scopeId) ?? []), row]);
  }

  const coverageByAgentVersion = new Map<string, AdaptiveCoverageTile[]>();
  for (const value of adaptiveScopeResult.rows) {
    const row = value as QueryRow;
    const scopeId = rowString(row, "scope_id");
    const agentId = rowString(row, "agent_id");
    const agentVersionId = rowString(row, "agent_version_id");
    const workflowKey = rowString(row, "workflow_key");
    const riskTier = rowString(row, "risk_tier");
    if (!scopeId || !agentId || !agentVersionId || !workflowKey || !riskTier) {
      throw new Error("Database returned an invalid adaptive coverage scope.");
    }
    const stage = adaptiveStage(row.stage);
    const productionFloorBps = rowNumber(row, "production_floor_bps");
    const changes = (changesByScope.get(scopeId) ?? []).map(change => {
      const fromStage = adaptiveStage(change.from_stage);
      const toStage = adaptiveStage(change.to_stage);
      return {
        fromRateBps: adaptiveReviewRateBps(fromStage, productionFloorBps),
        toRateBps: adaptiveReviewRateBps(toStage, productionFloorBps),
        reason: adaptiveCoverageReason(change.reason_codes_json),
        changedAt: iso(change.created_at),
      } satisfies AdaptiveCoverageChange;
    });
    const key = `${agentId}\0${agentVersionId}`;
    const tile: AdaptiveCoverageTile = {
      scopeId,
      workflowKey,
      riskTier,
      stage,
      reviewRateBps: adaptiveReviewRateBps(stage, productionFloorBps),
      changes,
    };
    coverageByAgentVersion.set(key, [...(coverageByAgentVersion.get(key) ?? []), tile]);
  }

  return {
    workspaceId: input.workspaceId,
    callerRole: access.role,
    canViewPublishingPolicies: access.canManage,
    attributionReady: false,
    summary: {
      totalRuns: runs.length,
      completedRuns: runs.filter(run => run.status === "completed").length,
      evidenceBackedRuns: runs.filter(run => run.evidencePacketAvailable).length,
      validResponses: runs.reduce((total, run) => total + run.validResponses, 0),
      attributedRuns: 0,
    },
    agents: registry.agents.map(agent => ({
      agentId: agent.agentId,
      externalId: agent.externalId,
      status: agent.status,
      versionId: agent.currentVersion.versionId,
      versionNumber: agent.currentVersion.versionNumber,
      displayName: agent.currentVersion.displayName,
      declaredProvider: agent.currentVersion.declaredProvider,
      declaredModel: agent.currentVersion.declaredModel,
      environment: agent.currentVersion.environment,
      attributedRunCount: 0,
      adaptiveCoverage: coverageByAgentVersion.get(`${agent.agentId}\0${agent.currentVersion.versionId}`) ?? [],
    })),
    deciderTrend: {
      clientDecisions: {
        total: trendDecisions.rows.length,
        goCount: (trendDecisions.rows as QueryRow[]).filter(row => rowString(row, "decision") === "go").length,
      },
      overrides: {
        total: trendOverrides.rows.length,
        acceptedCount: (trendOverrides.rows as QueryRow[]).filter(row => rowString(row, "outcome") === "accepted")
          .length,
      },
    },
    runs,
    publishingPolicies:
      policies?.map(policy => ({
        policyId: policy.policyId!,
        name: policy.name!,
        version: policy.version,
        enabled: policy.enabled,
        revokedAt: policy.revokedAt,
        expiresAt: policy.expiresAt,
        allowedPaymentModes: policy.allowedPaymentModes,
        maxPanelAtomic: policy.maxPanelAtomic!,
        maxDailyAtomic: policy.maxDailyAtomic!,
        maxMonthlyAtomic: policy.maxMonthlyAtomic!,
        maxPanelSize: policy.maxPanelSize,
        maxBountyAtomic: policy.maxBountyAtomic!,
        onPolicyMiss: policy.onPolicyMiss!,
      })) ?? null,
  };
}

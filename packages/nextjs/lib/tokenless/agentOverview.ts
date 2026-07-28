import "server-only";
import { dbClient } from "~~/lib/db";
import {
  type AgentAssuranceScopeSummary,
  type AgentRegistry,
  type WorkspaceAgent,
  listWorkspaceAgents,
} from "~~/lib/tokenless/agentRegistry";
import { type AssuranceMetricsSnapshot, collectWorkspaceAssuranceMetrics } from "~~/lib/tokenless/assuranceMetrics";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";

type QueryRow = Record<string, unknown>;

const OVERVIEW_WINDOW_DAYS = 30;
const OVERVIEW_WINDOW_MS = OVERVIEW_WINDOW_DAYS * 24 * 60 * 60_000;
export const MAX_AGENT_OVERVIEW_PARENTS = 20;
export const MAX_AGENT_OVERVIEW_SCOPES_PER_PARENT = 8;
export const MAX_AGENT_OVERVIEW_OBSERVATIONS = 10_000;

type OverviewObservation = {
  agreement: "agree" | "disagree" | "inconclusive";
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
  agentVersions: {
    periodLabel: "Lifetime by scope";
    parents: AgentOverviewParent[];
    totalParentCount: number;
    parentsTruncated: boolean;
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

export function projectAgentOverview(input: {
  agents: OverviewAgentSource[];
  metrics: Pick<AssuranceMetricsSnapshot, "reviewsCompleted">;
  observations: OverviewObservation[];
  observationsTruncated?: boolean;
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
    agentVersions: {
      periodLabel: "Lifetime by scope",
      parents: parents.slice(0, MAX_AGENT_OVERVIEW_PARENTS),
      totalParentCount: parents.length,
      parentsTruncated: parents.length > MAX_AGENT_OVERVIEW_PARENTS,
    },
    attention: attentionProjection(input.agents),
  };
}

function observationFromRow(row: QueryRow): OverviewObservation {
  const agreement = String(row.agreement ?? "");
  if (!["agree", "disagree", "inconclusive"].includes(agreement)) {
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
  now?: Date;
}): Promise<AgentOverview> {
  const now = input.now ?? new Date();
  const registry: AgentRegistry = await listWorkspaceAgents(input);
  const [metrics, observationResult] = await Promise.all([
    collectWorkspaceAssuranceMetrics({ workspaceId: input.workspaceId, now }),
    dbClient.execute({
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
      args: [input.workspaceId, new Date(now.getTime() - OVERVIEW_WINDOW_MS), now, MAX_AGENT_OVERVIEW_OBSERVATIONS + 1],
    }),
  ]);
  return projectAgentOverview({
    agents: registry.agents,
    metrics,
    observations: observationResult.rows
      .slice(0, MAX_AGENT_OVERVIEW_OBSERVATIONS)
      .map(row => observationFromRow(row as QueryRow)),
    observationsTruncated: observationResult.rows.length > MAX_AGENT_OVERVIEW_OBSERVATIONS,
    now,
  });
}

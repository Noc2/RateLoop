import "server-only";
import { dbClient } from "~~/lib/db";

type QueryRow = Record<string, unknown>;

export const AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION = 5;

export type AgentReviewQualityHotspot = {
  key: string;
  label: string;
  caseCount: number;
  splitCaseCount: number;
  splitRateBps: number;
  dissentRateBps: number;
};

type UnavailableQualityMetric = { available: false; reason: string };

export type AgentReviewQuality = {
  periodLabel: string;
  availability: "available" | "empty" | "suppressed";
  privacyThreshold: { minimum: number; maximum: number } | null;
  consensus:
    | {
        available: true;
        unanimityRateBps: number;
        unanimousCaseCount: number;
        caseCount: number;
        limitedSample: boolean;
      }
    | UnavailableQualityMetric;
  reviewerConsistency:
    | {
        available: true;
        alphaMilli: number;
        caseCount: number;
        ratingCount: number;
        limitedSample: boolean;
      }
    | UnavailableQualityMetric;
  panelSplit:
    | {
        available: true;
        splitCaseCount: number;
        caseCount: number;
        buckets: Array<{
          key: "unanimous" | "low" | "moderate" | "high";
          label: string;
          caseCount: number;
          shareBps: number;
        }>;
      }
    | UnavailableQualityMetric;
  hotspots: {
    workflows: AgentReviewQualityHotspot[];
    riskTiers: AgentReviewQualityHotspot[];
    cases: AgentReviewQualityHotspot[];
  };
  decisionTime:
    | {
        available: true;
        medianMilliseconds: number;
        p95Milliseconds: number;
        sampleSize: number;
        limitedSample: boolean;
        buckets: Array<{
          key: "under_5m" | "5m_to_15m" | "15m_to_1h" | "1h_to_4h" | "over_4h";
          label: string;
          decisionCount: number;
          shareBps: number;
        }>;
      }
    | UnavailableQualityMetric;
};

export type AgentReviewQualityProjectionInput = {
  periodLabel?: string;
  sourceCaseCount: number;
  safeCaseCount: number;
  unanimousCaseCount: number;
  splitBuckets: {
    low: number;
    moderate: number;
    high: number;
  };
  privacyThreshold: { minimum: number; maximum: number } | null;
  nominalAlpha: {
    caseCount: number;
    ratingCount: number;
    baselineCount: number;
    candidateCount: number;
    tieCount: number;
    observedDisagreementCoincidences: number | null;
  };
  hotspots: Array<
    AgentReviewQualityHotspot & {
      dimension: "case" | "risk_tier" | "workflow";
    }
  >;
  timing: {
    medianMilliseconds: number | null;
    p95Milliseconds: number | null;
    sampleSize: number;
    buckets: {
      under5Minutes: number;
      fiveTo15Minutes: number;
      fifteenMinutesTo1Hour: number;
      oneTo4Hours: number;
      over4Hours: number;
    };
  };
};

function unavailableReason(availability: AgentReviewQuality["availability"]) {
  return availability === "empty"
    ? "No completed review cases in this window."
    : "No case met its frozen panel privacy threshold in this window.";
}

function shareBps(count: number, total: number) {
  return total > 0 ? Math.floor((count * 10_000) / total) : 0;
}

function projectNominalAlpha(
  availability: AgentReviewQuality["availability"],
  input: AgentReviewQualityProjectionInput["nominalAlpha"],
): AgentReviewQuality["reviewerConsistency"] {
  if (availability !== "available") {
    return { available: false, reason: unavailableReason(availability) };
  }
  if (input.baselineCount + input.candidateCount + input.tieCount !== input.ratingCount) {
    throw new Error("Review-quality nominal-alpha category counts are inconsistent.");
  }
  if (input.caseCount < 2 || input.ratingCount < 4 || input.observedDisagreementCoincidences === null) {
    return {
      available: false,
      reason: "At least two privacy-eligible, multi-reviewer cases are required for reviewer consistency.",
    };
  }
  if (
    !Number.isFinite(input.observedDisagreementCoincidences) ||
    input.observedDisagreementCoincidences < 0 ||
    input.observedDisagreementCoincidences > input.ratingCount
  ) {
    throw new Error("Review-quality nominal-alpha disagreement is invalid.");
  }
  const expectedDisagreementNumerator =
    input.ratingCount ** 2 - input.baselineCount ** 2 - input.candidateCount ** 2 - input.tieCount ** 2;
  if (expectedDisagreementNumerator <= 0) {
    return {
      available: false,
      reason: "Reviewer consistency is undefined because every eligible response used the same choice.",
    };
  }
  // Nominal Krippendorff alpha: 1 - observed disagreement / chance-expected disagreement.
  // Both terms come from category coincidences, so no reviewer identifier is required.
  const observedDisagreement = input.observedDisagreementCoincidences / input.ratingCount;
  const expectedDisagreement = expectedDisagreementNumerator / (input.ratingCount * (input.ratingCount - 1));
  const alpha = 1 - observedDisagreement / expectedDisagreement;
  if (!Number.isFinite(alpha)) {
    throw new Error("Review-quality nominal alpha is invalid.");
  }
  return {
    available: true,
    alphaMilli: Math.round(alpha * 1_000),
    caseCount: input.caseCount,
    ratingCount: input.ratingCount,
    limitedSample: input.caseCount < 30,
  };
}

export function projectAgentReviewQuality(input: AgentReviewQualityProjectionInput): AgentReviewQuality {
  const availability = input.sourceCaseCount === 0 ? "empty" : input.safeCaseCount === 0 ? "suppressed" : "available";
  const reason = availability === "available" ? null : unavailableReason(availability);
  const splitCaseCount = input.splitBuckets.low + input.splitBuckets.moderate + input.splitBuckets.high;
  if (
    input.unanimousCaseCount + splitCaseCount !== input.safeCaseCount ||
    input.unanimousCaseCount > input.safeCaseCount
  ) {
    throw new Error("Review-quality panel-split counts are inconsistent.");
  }
  const timingBucketTotal = Object.values(input.timing.buckets).reduce((total, count) => total + count, 0);
  if (timingBucketTotal !== input.timing.sampleSize) {
    throw new Error("Review-quality decision-time counts are inconsistent.");
  }

  return {
    periodLabel: input.periodLabel ?? "Last 30 days",
    availability,
    privacyThreshold: input.privacyThreshold,
    consensus:
      availability === "available"
        ? {
            available: true,
            unanimityRateBps: shareBps(input.unanimousCaseCount, input.safeCaseCount),
            unanimousCaseCount: input.unanimousCaseCount,
            caseCount: input.safeCaseCount,
            limitedSample: input.safeCaseCount < 30,
          }
        : { available: false, reason: reason! },
    reviewerConsistency: projectNominalAlpha(availability, input.nominalAlpha),
    panelSplit:
      availability === "available"
        ? {
            available: true,
            splitCaseCount,
            caseCount: input.safeCaseCount,
            buckets: [
              {
                key: "unanimous",
                label: "Unanimous",
                caseCount: input.unanimousCaseCount,
                shareBps: shareBps(input.unanimousCaseCount, input.safeCaseCount),
              },
              {
                key: "low",
                label: "Under 25% dissent",
                caseCount: input.splitBuckets.low,
                shareBps: shareBps(input.splitBuckets.low, input.safeCaseCount),
              },
              {
                key: "moderate",
                label: "25–50% dissent",
                caseCount: input.splitBuckets.moderate,
                shareBps: shareBps(input.splitBuckets.moderate, input.safeCaseCount),
              },
              {
                key: "high",
                label: "50%+ dissent",
                caseCount: input.splitBuckets.high,
                shareBps: shareBps(input.splitBuckets.high, input.safeCaseCount),
              },
            ],
          }
        : { available: false, reason: reason! },
    hotspots: {
      workflows:
        availability === "available"
          ? input.hotspots
              .filter(hotspot => hotspot.dimension === "workflow")
              .slice(0, AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION)
          : [],
      riskTiers:
        availability === "available"
          ? input.hotspots
              .filter(hotspot => hotspot.dimension === "risk_tier")
              .slice(0, AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION)
          : [],
      cases:
        availability === "available"
          ? input.hotspots
              .filter(hotspot => hotspot.dimension === "case")
              .slice(0, AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION)
          : [],
    },
    decisionTime:
      availability === "available" &&
      input.timing.sampleSize > 0 &&
      input.timing.medianMilliseconds !== null &&
      input.timing.p95Milliseconds !== null
        ? {
            available: true,
            medianMilliseconds: input.timing.medianMilliseconds,
            p95Milliseconds: input.timing.p95Milliseconds,
            sampleSize: input.timing.sampleSize,
            limitedSample: input.timing.sampleSize < 30,
            buckets: [
              {
                key: "under_5m",
                label: "Under 5 min",
                decisionCount: input.timing.buckets.under5Minutes,
                shareBps: shareBps(input.timing.buckets.under5Minutes, input.timing.sampleSize),
              },
              {
                key: "5m_to_15m",
                label: "5–15 min",
                decisionCount: input.timing.buckets.fiveTo15Minutes,
                shareBps: shareBps(input.timing.buckets.fiveTo15Minutes, input.timing.sampleSize),
              },
              {
                key: "15m_to_1h",
                label: "15–60 min",
                decisionCount: input.timing.buckets.fifteenMinutesTo1Hour,
                shareBps: shareBps(input.timing.buckets.fifteenMinutesTo1Hour, input.timing.sampleSize),
              },
              {
                key: "1h_to_4h",
                label: "1–4 hours",
                decisionCount: input.timing.buckets.oneTo4Hours,
                shareBps: shareBps(input.timing.buckets.oneTo4Hours, input.timing.sampleSize),
              },
              {
                key: "over_4h",
                label: "Over 4 hours",
                decisionCount: input.timing.buckets.over4Hours,
                shareBps: shareBps(input.timing.buckets.over4Hours, input.timing.sampleSize),
              },
            ],
          }
        : {
            available: false,
            reason:
              availability === "available"
                ? "No privacy-eligible decision timing is available in this window."
                : reason!,
          },
  };
}

const WINDOW_RUNS_SQL = `SELECT run.run_id,
                                GREATEST(
                                  1,
                                  LEAST(
                                    10000,
                                    COALESCE(
                                      NULLIF(policy.buyer_privacy_json::jsonb->>'minimumAggregationSize','')::integer,
                                      3
                                    )
                                  )
                                ) AS privacy_minimum,
                                scope.workflow_key,
                                scope.risk_tier
                         FROM tokenless_assurance_projects project
                         JOIN tokenless_assurance_runs run ON run.project_id=project.project_id
                         JOIN tokenless_assurance_audience_policies policy
                           ON policy.policy_id=run.audience_policy_id
                          AND policy.version=run.audience_policy_version
                         JOIN tokenless_agent_review_opportunities opportunity
                           ON opportunity.workspace_id=project.workspace_id AND opportunity.run_id=run.run_id
                         JOIN tokenless_agent_evaluation_scopes scope
                           ON scope.workspace_id=opportunity.workspace_id
                          AND scope.scope_id=opportunity.scope_id
                          AND scope.agent_id=opportunity.agent_id
                          AND scope.agent_version_id=opportunity.agent_version_id
                         JOIN tokenless_agent_human_review_bindings binding
                           ON binding.workspace_id=opportunity.workspace_id
                          AND binding.agent_id=opportunity.agent_id
                          AND binding.agent_version_id=opportunity.agent_version_id
                          AND binding.binding_id=opportunity.human_review_binding_id
                          AND binding.version=opportunity.human_review_binding_version
                          AND binding.enabled=true AND binding.superseded_at IS NULL
                          AND scope.human_review_binding_id=binding.binding_id
                          AND scope.human_review_binding_version=binding.version
                          AND scope.policy_id=binding.selection_policy_id
                          AND scope.policy_version=binding.selection_policy_version
                         JOIN tokenless_agent_review_policies review_policy
                           ON review_policy.workspace_id=binding.workspace_id
                          AND review_policy.policy_id=binding.selection_policy_id
                          AND review_policy.version=binding.selection_policy_version
                          AND review_policy.enabled=true AND review_policy.superseded_at IS NULL
                         JOIN tokenless_agent_review_request_profiles profile
                           ON profile.workspace_id=binding.workspace_id
                          AND profile.profile_id=binding.request_profile_id
                          AND profile.version=binding.request_profile_version
                          AND profile.profile_hash=binding.request_profile_hash
                          AND profile.result_semantics='assurance'
                         JOIN tokenless_agent_versions version
                           ON version.workspace_id=opportunity.workspace_id
                          AND version.agent_id=opportunity.agent_id
                          AND version.version_id=opportunity.agent_version_id
                         WHERE project.workspace_id=? AND project.status<>'deleted'
                           AND run.status='completed'
                           AND run.updated_at>=? AND run.updated_at<=?
                           AND run.completed_at>=? AND run.completed_at<=?
                           AND NOT EXISTS (
                             SELECT 1 FROM tokenless_agent_versions newer
                             WHERE newer.workspace_id=version.workspace_id
                               AND newer.agent_id=version.agent_id
                               AND newer.version_number>version.version_number
                           )
                           AND (?::text IS NULL OR scope.workflow_key=?)
                           AND (?::text IS NULL OR scope.risk_tier=?)
                           AND (?::text IS NULL OR scope.stage=?)
                           AND (?::text IS NULL OR opportunity.agent_version_id=?)
                           AND (?::text IS NULL OR opportunity.agent_id=?)
                           AND (?::text IS NULL OR opportunity.scope_id=?)`;

const QUALITY_CASE_CTES = `window_runs AS (${WINDOW_RUNS_SQL}),
                           source_cases AS (
                             SELECT window_runs.run_id,window_runs.privacy_minimum,
                                    window_runs.workflow_key,window_runs.risk_tier,
                                    run_case.case_id,case_record.title,
                                    COUNT(response.response_id) AS valid_response_count,
                                    COUNT(*) FILTER (WHERE response.choice='baseline') AS baseline_count,
                                    COUNT(*) FILTER (WHERE response.choice='candidate') AS candidate_count,
                                    COUNT(*) FILTER (WHERE response.choice='tie') AS tie_count
                             FROM window_runs
                             JOIN tokenless_assurance_run_cases run_case ON run_case.run_id=window_runs.run_id
                             JOIN tokenless_assurance_cases case_record ON case_record.case_id=run_case.case_id
                             LEFT JOIN tokenless_assurance_run_gold_items gold
                               ON gold.run_id=run_case.run_id AND gold.case_id=run_case.case_id
                             LEFT JOIN tokenless_assurance_responses response
                               ON response.run_id=run_case.run_id AND response.case_id=run_case.case_id
                              AND response.validity='valid'
                              AND response.choice IN ('baseline','candidate','tie')
                             WHERE gold.case_id IS NULL
                               AND run_case.round_status IN ('finalized','terminal','offchain_complete')
                             GROUP BY window_runs.run_id,window_runs.privacy_minimum,
                                      window_runs.workflow_key,window_runs.risk_tier,
                                      run_case.case_id,case_record.title
                           ),
                           safe_cases AS (
                             SELECT source_cases.*,
                                    valid_response_count - GREATEST(baseline_count,candidate_count,tie_count)
                                      AS dissent_count,
                                    FLOOR(
                                      (
                                        valid_response_count - GREATEST(baseline_count,candidate_count,tie_count)
                                      )::double precision * 10000 / valid_response_count
                                    ) AS dissent_bps
                             FROM source_cases
                             WHERE valid_response_count>=privacy_minimum
                           )`;

const QUALITY_SQL = `WITH ${QUALITY_CASE_CTES},
                     summary AS (
                       SELECT
                         (SELECT COUNT(*) FROM source_cases) AS source_case_count,
                         COUNT(*) AS safe_case_count,
                         COUNT(*) FILTER (WHERE dissent_count=0) AS unanimous_case_count,
                         COUNT(*) FILTER (WHERE dissent_bps>0 AND dissent_bps<2500) AS low_split_count,
                         COUNT(*) FILTER (WHERE dissent_bps>=2500 AND dissent_bps<5000) AS moderate_split_count,
                         COUNT(*) FILTER (WHERE dissent_bps>=5000) AS high_split_count,
                         COUNT(*) FILTER (WHERE valid_response_count>=2) AS alpha_case_count,
                         COALESCE(SUM(valid_response_count) FILTER (WHERE valid_response_count>=2),0)
                           AS alpha_rating_count,
                         COALESCE(SUM(baseline_count) FILTER (WHERE valid_response_count>=2),0)
                           AS alpha_baseline_count,
                         COALESCE(SUM(candidate_count) FILTER (WHERE valid_response_count>=2),0)
                           AS alpha_candidate_count,
                         COALESCE(SUM(tie_count) FILTER (WHERE valid_response_count>=2),0)
                           AS alpha_tie_count,
                         SUM(
                           (
                             valid_response_count::double precision * valid_response_count
                             - baseline_count::double precision * baseline_count
                             - candidate_count::double precision * candidate_count
                             - tie_count::double precision * tie_count
                           ) / NULLIF(valid_response_count - 1,0)
                         ) FILTER (WHERE valid_response_count>=2)
                           AS alpha_observed_disagreement_coincidences,
                         (SELECT MIN(privacy_minimum) FROM source_cases) AS privacy_minimum,
                         (SELECT MAX(privacy_minimum) FROM source_cases) AS privacy_maximum
                       FROM safe_cases
                     ),
                     dimension_cases AS (
                       SELECT 'workflow'::text AS dimension,workflow_key AS dimension_key,
                              workflow_key AS dimension_label,valid_response_count,dissent_count
                       FROM safe_cases WHERE workflow_key IS NOT NULL AND workflow_key<>''
                       UNION ALL
                       SELECT 'risk_tier',risk_tier,risk_tier,valid_response_count,dissent_count
                       FROM safe_cases WHERE risk_tier IS NOT NULL AND risk_tier<>''
                       UNION ALL
                       SELECT 'case',case_id,COALESCE(NULLIF(title,''),'Untitled case'),
                              valid_response_count,dissent_count
                       FROM safe_cases
                     ),
                     dimension_aggregates AS (
                       SELECT dimension,dimension_key,dimension_label,
                              COUNT(*) AS case_count,
                              COUNT(*) FILTER (WHERE dissent_count>0) AS split_case_count,
                              SUM(valid_response_count) AS response_count,
                              SUM(dissent_count) AS dissent_count
                       FROM dimension_cases
                       GROUP BY dimension,dimension_key,dimension_label
                       HAVING SUM(dissent_count)>0
                     ),
                     ranked_dimensions AS (
                       SELECT dimension_aggregates.*,
                              ROW_NUMBER() OVER (
                                PARTITION BY dimension
                                ORDER BY FLOOR(
                                  dissent_count::double precision * 10000 / response_count
                                ) DESC,case_count DESC,dimension_key ASC
                              ) AS dimension_rank
                       FROM dimension_aggregates
                     )
                     SELECT 'summary'::text AS row_kind,NULL::text AS dimension,
                            NULL::text AS dimension_key,NULL::text AS dimension_label,
                            NULL::bigint AS case_count,NULL::bigint AS split_case_count,
                            NULL::bigint AS response_count,NULL::bigint AS dissent_count,
                            summary.source_case_count,summary.safe_case_count,
                            summary.unanimous_case_count,summary.low_split_count,
                            summary.moderate_split_count,summary.high_split_count,
                            summary.alpha_case_count,summary.alpha_rating_count,
                            summary.alpha_baseline_count,summary.alpha_candidate_count,
                            summary.alpha_tie_count,
                            summary.alpha_observed_disagreement_coincidences,
                            summary.privacy_minimum,summary.privacy_maximum
                     FROM summary
                     UNION ALL
                     SELECT 'hotspot',dimension,dimension_key,dimension_label,
                            case_count,split_case_count,response_count,dissent_count,
                            NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,
                            NULL::bigint,NULL::bigint,NULL::bigint,NULL::bigint,
                            NULL::bigint,NULL::bigint,NULL::bigint,NULL::double precision,
                            NULL::integer,NULL::integer
                     FROM ranked_dimensions
                     WHERE dimension_rank<=${AGENT_REVIEW_QUALITY_MAX_HOTSPOTS_PER_DIMENSION}
                     ORDER BY row_kind DESC,dimension ASC,dissent_count DESC,dimension_key ASC`;

const TIMING_SQL = `WITH ${QUALITY_CASE_CTES},
                    safe_runs AS (
                      SELECT DISTINCT run_id FROM safe_cases
                    ),
                    timing AS (
                      SELECT observation.latency_ms
                      FROM safe_runs
                      JOIN tokenless_agent_review_opportunities opportunity
                        ON opportunity.workspace_id=? AND opportunity.run_id=safe_runs.run_id
                      JOIN tokenless_agent_evaluation_observations observation
                        ON observation.workspace_id=opportunity.workspace_id
                       AND observation.opportunity_id=opportunity.opportunity_id
                      WHERE observation.workspace_id=?
                        AND observation.finalized_at>=? AND observation.finalized_at<=?
                        AND observation.latency_ms IS NOT NULL
                    )
                    SELECT COUNT(*) AS sample_size,
                           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_milliseconds,
                           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_milliseconds,
                           COUNT(*) FILTER (WHERE latency_ms<300000) AS under_5m_count,
                           COUNT(*) FILTER (WHERE latency_ms>=300000 AND latency_ms<900000) AS five_to_15m_count,
                           COUNT(*) FILTER (WHERE latency_ms>=900000 AND latency_ms<3600000) AS fifteen_to_1h_count,
                           COUNT(*) FILTER (WHERE latency_ms>=3600000 AND latency_ms<14400000) AS one_to_4h_count,
                           COUNT(*) FILTER (WHERE latency_ms>=14400000) AS over_4h_count
                    FROM timing`;

function integer(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function nullableInteger(row: QueryRow | undefined, key: string) {
  const raw = row?.[key];
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return Math.round(value);
}

function nullableNumber(row: QueryRow | undefined, key: string) {
  const raw = row?.[key];
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function text(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

type AgentReviewQualityFilters = {
  workflow: string | null;
  riskTier: string | null;
  stage: string | null;
  versionId: string | null;
  agentId: string | null;
  scopeId: string | null;
};

function windowArgs(workspaceId: string, startsAt: Date, endsAt: Date, filters: AgentReviewQualityFilters) {
  return [
    workspaceId,
    startsAt,
    endsAt,
    startsAt,
    endsAt,
    filters.workflow,
    filters.workflow,
    filters.riskTier,
    filters.riskTier,
    filters.stage,
    filters.stage,
    filters.versionId,
    filters.versionId,
    filters.agentId,
    filters.agentId,
    filters.scopeId,
    filters.scopeId,
  ];
}

export async function loadAgentReviewQuality(input: {
  workspaceId: string;
  startsAt: Date;
  endsAt: Date;
  periodLabel?: string;
  filters?: Partial<AgentReviewQualityFilters>;
}): Promise<AgentReviewQuality> {
  const filters: AgentReviewQualityFilters = {
    workflow: input.filters?.workflow ?? null,
    riskTier: input.filters?.riskTier ?? null,
    stage: input.filters?.stage ?? null,
    versionId: input.filters?.versionId ?? null,
    agentId: input.filters?.agentId ?? null,
    scopeId: input.filters?.scopeId ?? null,
  };
  const args = windowArgs(input.workspaceId, input.startsAt, input.endsAt, filters);
  const [qualityResult, timingResult] = await Promise.all([
    dbClient.execute({ sql: QUALITY_SQL, args }),
    dbClient.execute({
      sql: TIMING_SQL,
      args: [...args, input.workspaceId, input.workspaceId, input.startsAt, input.endsAt],
    }),
  ]);
  const qualityRows = qualityResult.rows as QueryRow[];
  const summary = qualityRows.find(row => text(row, "row_kind") === "summary");
  if (!summary) throw new Error("Database returned no review-quality summary.");
  const safeCaseCount = integer(summary, "safe_case_count");
  const privacyMinimum = nullableInteger(summary, "privacy_minimum");
  const privacyMaximum = nullableInteger(summary, "privacy_maximum");
  if ((privacyMinimum === null) !== (privacyMaximum === null)) {
    throw new Error("Database returned an invalid review-quality privacy threshold.");
  }
  const hotspots = qualityRows
    .filter(row => text(row, "row_kind") === "hotspot")
    .map(row => {
      const dimension = text(row, "dimension");
      const key = text(row, "dimension_key");
      const label = text(row, "dimension_label");
      const caseCount = integer(row, "case_count");
      const splitCaseCount = integer(row, "split_case_count");
      const responseCount = integer(row, "response_count");
      const dissentCount = integer(row, "dissent_count");
      if (!["case", "risk_tier", "workflow"].includes(dimension ?? "") || !key || !label || responseCount === 0) {
        throw new Error("Database returned an invalid review-quality hotspot.");
      }
      return {
        dimension: dimension as "case" | "risk_tier" | "workflow",
        key,
        label,
        caseCount,
        splitCaseCount,
        splitRateBps: shareBps(splitCaseCount, caseCount),
        dissentRateBps: shareBps(dissentCount, responseCount),
      };
    });
  const timing = timingResult.rows[0] as QueryRow | undefined;
  return projectAgentReviewQuality({
    periodLabel: input.periodLabel,
    sourceCaseCount: integer(summary, "source_case_count"),
    safeCaseCount,
    unanimousCaseCount: integer(summary, "unanimous_case_count"),
    splitBuckets: {
      low: integer(summary, "low_split_count"),
      moderate: integer(summary, "moderate_split_count"),
      high: integer(summary, "high_split_count"),
    },
    privacyThreshold:
      privacyMinimum === null || privacyMaximum === null ? null : { minimum: privacyMinimum, maximum: privacyMaximum },
    nominalAlpha: {
      caseCount: integer(summary, "alpha_case_count"),
      ratingCount: integer(summary, "alpha_rating_count"),
      baselineCount: integer(summary, "alpha_baseline_count"),
      candidateCount: integer(summary, "alpha_candidate_count"),
      tieCount: integer(summary, "alpha_tie_count"),
      observedDisagreementCoincidences: nullableNumber(summary, "alpha_observed_disagreement_coincidences"),
    },
    hotspots,
    timing: {
      medianMilliseconds: nullableInteger(timing, "median_milliseconds"),
      p95Milliseconds: nullableInteger(timing, "p95_milliseconds"),
      sampleSize: integer(timing, "sample_size"),
      buckets: {
        under5Minutes: integer(timing, "under_5m_count"),
        fiveTo15Minutes: integer(timing, "five_to_15m_count"),
        fifteenMinutesTo1Hour: integer(timing, "fifteen_to_1h_count"),
        oneTo4Hours: integer(timing, "one_to_4h_count"),
        over4Hours: integer(timing, "over_4h_count"),
      },
    },
  });
}

export const __agentReviewQualityTestUtils = {
  qualitySql: QUALITY_SQL,
  timingSql: TIMING_SQL,
};

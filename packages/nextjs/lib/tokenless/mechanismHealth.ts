import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function scopeHash(row: Row) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        projectId: text(row, "project_id"),
        suiteId: text(row, "suite_id"),
        suiteVersion: integer(row, "suite_version"),
        rubricId: text(row, "rubric_id"),
        rubricVersion: integer(row, "rubric_version"),
      }),
    )
    .digest("hex")}`;
}

function aggregateInteger(value: unknown, field: string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Finalized ${field} is invalid.`);
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) throw new Error(`Finalized ${field} is invalid.`);
  return BigInt(value);
}

function rbtsAggregateFromEvidence(value: unknown) {
  let evidence: {
    revealCount?: unknown;
    scoring?: { totalRbtsScoreBps?: unknown; totalSquaredRbtsScoreBps2?: unknown };
  };
  try {
    evidence = JSON.parse(String(value)) as typeof evidence;
  } catch {
    throw new Error("Finalized transparency evidence is not valid JSON.");
  }
  if (
    evidence.revealCount === undefined ||
    evidence.scoring?.totalRbtsScoreBps === undefined ||
    evidence.scoring.totalSquaredRbtsScoreBps2 === undefined
  ) {
    // Historical finalized evidence predates the privacy-safe squared-score aggregate.
    return null;
  }
  const count = aggregateInteger(evidence.revealCount, "reveal count");
  const sum = aggregateInteger(evidence.scoring.totalRbtsScoreBps, "RBTS score sum");
  const squared = aggregateInteger(evidence.scoring.totalSquaredRbtsScoreBps2, "RBTS squared-score sum");
  if (count === 0n || sum > count * 10_000n || squared > count * 100_000_000n || squared * count < sum * sum) {
    throw new Error("Finalized RBTS aggregates are internally inconsistent.");
  }
  return { count, squared, sum };
}

export async function recordAssuranceMechanismHealth(client: PoolClient, runId: string, now: Date) {
  const runResult = await client.query(
    `SELECT r.run_id,r.project_id,r.suite_id,r.suite_version,s.rubric_id,s.rubric_version,p.workspace_id,
            ap.buyer_privacy_json
     FROM tokenless_assurance_runs r
     JOIN tokenless_assurance_projects p ON p.project_id=r.project_id
     JOIN tokenless_assurance_suites s ON s.suite_id=r.suite_id AND s.version=r.suite_version
     JOIN tokenless_assurance_audience_policies ap
       ON ap.policy_id=r.audience_policy_id AND ap.version=r.audience_policy_version
     WHERE r.run_id=$1 AND r.status='completed' LIMIT 1`,
    [runId],
  );
  const run = runResult.rows[0] as Row | undefined;
  if (!run) throw new Error("Mechanism health can be recorded only for a completed assurance run.");
  const scope = scopeHash(run);
  let quorum = 3;
  try {
    const privacy = JSON.parse(text(run, "buyer_privacy_json") ?? "{}") as { minimumAggregationSize?: unknown };
    const parsed = Number(privacy.minimumAggregationSize);
    if (Number.isSafeInteger(parsed) && parsed >= 2) quorum = parsed;
  } catch {
    throw new Error("Stored buyer privacy policy is invalid.");
  }
  const cases = await client.query(
    `SELECT rc.case_id,
            SUM(CASE WHEN resp.validity='valid' THEN 1 ELSE 0 END) AS valid_count,
            COUNT(DISTINCT CASE WHEN resp.validity='valid' THEN resp.choice END) AS distinct_choices,
            SUM(CASE WHEN resp.validity='valid' AND resp.choice='candidate' THEN 1 ELSE 0 END) AS candidate_count
     FROM tokenless_assurance_run_cases rc
     LEFT JOIN tokenless_assurance_run_gold_items gold ON gold.run_id=rc.run_id AND gold.case_id=rc.case_id
     LEFT JOIN tokenless_assurance_responses resp ON resp.run_id=rc.run_id AND resp.case_id=rc.case_id
     WHERE rc.run_id=$1 AND gold.case_id IS NULL
       AND rc.round_status IN ('finalized','terminal','offchain_complete')
     GROUP BY rc.case_id`,
    [runId],
  );
  let validResponseCount = 0;
  let candidateCount = 0;
  let unanimousCaseCount = 0;
  let qualifyingCaseCount = 0;
  for (const value of cases.rows as Row[]) {
    const valid = integer(value, "valid_count");
    if (valid < quorum) continue;
    qualifyingCaseCount += 1;
    validResponseCount += valid;
    candidateCount += integer(value, "candidate_count");
    if (valid > 0 && integer(value, "distinct_choices") === 1) unanimousCaseCount += 1;
  }
  const gold = await client.query(
    `SELECT COUNT(*) AS outcome_count,
            COALESCE(SUM(CASE WHEN correct=false THEN 1 ELSE 0 END),0) AS failure_count
     FROM tokenless_assurance_gold_outcomes WHERE run_id=$1`,
    [runId],
  );
  let rbtsScoreCount = 0n;
  let rbtsScoreSum = 0n;
  let rbtsSquaredScoreSum = 0n;
  const eligibleChainCases = await client.query(
    `SELECT COUNT(DISTINCT rc.case_id) AS case_count
     FROM tokenless_assurance_run_cases rc
     LEFT JOIN tokenless_assurance_run_gold_items gold ON gold.run_id=rc.run_id AND gold.case_id=rc.case_id
     JOIN tokenless_chain_executions ce ON ce.content_id=rc.content_id AND CAST(ce.round_id AS text)=rc.round_id
     WHERE rc.run_id=$1 AND gold.case_id IS NULL
       AND rc.round_status IN ('finalized','terminal')`,
    [runId],
  );
  const eligibleChainCaseCount = integer(eligibleChainCases.rows[0] as Row, "case_count");
  const indexed = await client.query(
    `SELECT DISTINCT ON (rc.case_id) rc.case_id,te.evidence_json
     FROM tokenless_assurance_run_cases rc
     LEFT JOIN tokenless_assurance_run_gold_items gold ON gold.run_id=rc.run_id AND gold.case_id=rc.case_id
     JOIN tokenless_chain_executions ce ON ce.content_id=rc.content_id AND CAST(ce.round_id AS text)=rc.round_id
     JOIN tokenless_transparency_events te ON te.operation_key=ce.operation_key AND te.event_type='finalized'
     WHERE rc.run_id=$1 AND gold.case_id IS NULL
       AND rc.round_status IN ('finalized','terminal')
     ORDER BY rc.case_id,te.sequence DESC`,
    [runId],
  );
  const indexedChainCaseCount = indexed.rowCount ?? indexed.rows.length;
  for (const value of indexed.rows as Row[]) {
    const aggregate = rbtsAggregateFromEvidence(text(value, "evidence_json") ?? "null");
    if (!aggregate) continue;
    rbtsScoreCount += aggregate.count;
    rbtsScoreSum += aggregate.sum;
    rbtsSquaredScoreSum += aggregate.squared;
  }
  if (rbtsScoreCount > 0n && rbtsSquaredScoreSum * rbtsScoreCount < rbtsScoreSum * rbtsScoreSum) {
    throw new Error("Accumulated RBTS aggregates are internally inconsistent.");
  }
  const rbtsMean = rbtsScoreCount ? Number(rbtsScoreSum / rbtsScoreCount) : null;
  const rbtsVariance = rbtsScoreCount
    ? (rbtsSquaredScoreSum * rbtsScoreCount - rbtsScoreSum * rbtsScoreSum) / (rbtsScoreCount * rbtsScoreCount)
    : null;
  const candidateShareBps = validResponseCount ? Math.floor((candidateCount * 10_000) / validResponseCount) : null;
  const previous = await client.query(
    `SELECT candidate_share_bps FROM tokenless_assurance_mechanism_health
     WHERE workspace_id=$1 AND scope_hash=$2 AND run_id<>$3 AND candidate_share_bps IS NOT NULL
     ORDER BY observed_at DESC LIMIT 1`,
    [text(run, "workspace_id"), scope, runId],
  );
  const previousShare = previous.rowCount ? integer(previous.rows[0] as Row, "candidate_share_bps") : null;
  const drift =
    candidateShareBps === null || previousShare === null ? null : Math.abs(candidateShareBps - previousShare);
  await client.query(
    `INSERT INTO tokenless_assurance_mechanism_health
     (run_id,workspace_id,project_id,scope_hash,non_gold_case_count,unanimous_case_count,
      valid_response_count,candidate_share_bps,rbts_score_count,eligible_chain_case_count,
      indexed_chain_case_count,rbts_score_mean_bps,
      rbts_score_variance_bps2,gold_outcome_count,gold_failure_count,comparable_drift_bps,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (run_id) DO UPDATE SET
       scope_hash=EXCLUDED.scope_hash,
       non_gold_case_count=EXCLUDED.non_gold_case_count,
       unanimous_case_count=EXCLUDED.unanimous_case_count,
       valid_response_count=EXCLUDED.valid_response_count,
       candidate_share_bps=EXCLUDED.candidate_share_bps,
       rbts_score_count=EXCLUDED.rbts_score_count,
       eligible_chain_case_count=EXCLUDED.eligible_chain_case_count,
       indexed_chain_case_count=EXCLUDED.indexed_chain_case_count,
       rbts_score_mean_bps=EXCLUDED.rbts_score_mean_bps,
       rbts_score_variance_bps2=EXCLUDED.rbts_score_variance_bps2,
       gold_outcome_count=EXCLUDED.gold_outcome_count,
       gold_failure_count=EXCLUDED.gold_failure_count,
       comparable_drift_bps=EXCLUDED.comparable_drift_bps,
       observed_at=EXCLUDED.observed_at`,
    [
      runId,
      text(run, "workspace_id"),
      text(run, "project_id"),
      scope,
      qualifyingCaseCount,
      unanimousCaseCount,
      validResponseCount,
      candidateShareBps,
      rbtsScoreCount.toString(),
      eligibleChainCaseCount,
      indexedChainCaseCount,
      rbtsMean,
      rbtsVariance?.toString() ?? null,
      integer(gold.rows[0] as Row, "outcome_count"),
      integer(gold.rows[0] as Row, "failure_count"),
      drift,
      now,
    ],
  );
}

const REFRESH_COMPLETED_MECHANISM_HEALTH_SQL = `WITH current_counts AS (
         SELECT r.run_id,r.completed_at,
                COUNT(DISTINCT CASE
                  WHEN gold.case_id IS NULL AND rc.round_status IN ('finalized','terminal')
                    AND ce.execution_id IS NOT NULL THEN rc.case_id
                END) AS eligible_chain_case_count,
                COUNT(DISTINCT CASE
                  WHEN gold.case_id IS NULL AND rc.round_status IN ('finalized','terminal')
                    AND ce.execution_id IS NOT NULL AND te.event_id IS NOT NULL THEN rc.case_id
                END) AS indexed_chain_case_count
         FROM tokenless_assurance_runs r
         LEFT JOIN tokenless_assurance_run_cases rc ON rc.run_id=r.run_id
         LEFT JOIN tokenless_assurance_run_gold_items gold
           ON gold.run_id=rc.run_id AND gold.case_id=rc.case_id
         LEFT JOIN tokenless_chain_executions ce
           ON ce.content_id=rc.content_id AND CAST(ce.round_id AS text)=rc.round_id
         LEFT JOIN tokenless_transparency_events te
           ON te.operation_key=ce.operation_key AND te.event_type='finalized'
         WHERE r.status='completed'
         GROUP BY r.run_id,r.completed_at
       )
       SELECT current_counts.run_id FROM current_counts
       LEFT JOIN tokenless_assurance_mechanism_health mh ON mh.run_id=current_counts.run_id
       WHERE mh.run_id IS NULL
          OR mh.eligible_chain_case_count<>current_counts.eligible_chain_case_count
          OR mh.indexed_chain_case_count<>current_counts.indexed_chain_case_count
       ORDER BY current_counts.completed_at ASC LIMIT $1`;

export async function refreshCompletedAssuranceMechanismHealth(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const client = await dbPool.connect();
  try {
    const runs = await client.query(REFRESH_COMPLETED_MECHANISM_HEALTH_SQL, [limit]);
    let refreshed = 0;
    for (const value of runs.rows as Row[]) {
      await client.query("BEGIN");
      try {
        await recordAssuranceMechanismHealth(client, text(value, "run_id")!, now);
        await client.query("COMMIT");
        refreshed += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { refreshed };
  } finally {
    client.release();
  }
}

export const __mechanismHealthTestUtils = {
  rbtsAggregateFromEvidence,
  refreshSelectionSql: REFRESH_COMPLETED_MECHANISM_HEALTH_SQL,
  scopeHash,
};

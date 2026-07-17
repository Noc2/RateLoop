import { type TokenlessResult, parseTokenlessResult } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown>;

export type AdaptiveReviewObservation = {
  observationId: string;
  workspaceId: string;
  scopeId: string;
  opportunityId: string;
  executionId: string | null;
  operationKey: string;
  evidenceReference: string;
  sourcePayloadHash: string;
  agentOutcomeCommitment: string;
  humanOutcomeCommitment: string;
  agreement: "agree" | "disagree" | "inconclusive";
  comparable: boolean;
  respondingHumanCount: number;
  humanHumanAgreementBps: number | null;
  latencyMs: number;
  costAtomic: string;
  finalizedAt: string;
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicObservationId(workspaceId: string, opportunityId: string) {
  return `aob_${createHash("sha256")
    .update(`adaptive-review-observation\0${workspaceId}\0${opportunityId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function parseStoredResult(value: unknown) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError("The human-review result is not ready.", 409, "result_not_ready", true);
  }
  try {
    return parseTokenlessResult(JSON.parse(value));
  } catch {
    throw new TokenlessServiceError("The stored human-review result is invalid.", 500, "stored_review_result_invalid");
  }
}

function realizedCostAtomic(result: TokenlessResult) {
  return (
    BigInt(result.economics.bounty.paidAtomic) +
    BigInt(result.economics.fee.paidAtomic) +
    BigInt(result.economics.attemptReserve.compensatedAtomic)
  ).toString();
}

function observationFromResult(input: {
  row: QueryRow;
  result: TokenlessResult;
  operationKey: string;
}): AdaptiveReviewObservation | null {
  const resultSemantics = rowString(input.row, "result_semantics");
  if (resultSemantics === "feedback") {
    if (
      rowString(input.row, "question_authority") !== "agent_per_request" ||
      !/^sha256:[0-9a-f]{64}$/u.test(rowString(input.row, "question_hash") ?? "")
    ) {
      throw new TokenlessServiceError(
        "The stored feedback question binding is invalid.",
        500,
        "stored_review_question_invalid",
      );
    }
    return null;
  }
  if (resultSemantics !== "assurance" || rowString(input.row, "question_authority") !== "owner_fixed") {
    throw new TokenlessServiceError(
      "The stored review-result semantics are invalid.",
      500,
      "stored_review_question_invalid",
    );
  }
  const workspaceId = rowString(input.row, "workspace_id")!;
  const opportunityId = rowString(input.row, "opportunity_id")!;
  const scopeId = rowString(input.row, "scope_id")!;
  const sourcePayloadHash = rowString(input.row, "source_evidence_hash")!;
  const agentOutcomeCommitment = rowString(input.row, "suggestion_commitment")!;
  const executionId = rowString(input.row, "execution_id");
  const createdAt = new Date(String(input.row.created_at));
  const finalizedAt = new Date(input.result.updatedAt);
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(finalizedAt.getTime())) {
    throw new TokenlessServiceError(
      "Stored adaptive-review timestamps are invalid.",
      500,
      "stored_review_result_invalid",
    );
  }

  const selected = input.result.verdict?.selected?.toLowerCase() ?? null;
  const comparable =
    input.result.terminal && input.result.verdictStatus === "publishable" && (selected === "yes" || selected === "no");
  const respondingHumanCount = input.result.audience.participantCount;
  const preferenceShareBps = comparable ? input.result.verdict?.preferenceShareBps : null;
  const humanHumanAgreementBps =
    comparable && respondingHumanCount > 1 && preferenceShareBps !== null && preferenceShareBps !== undefined
      ? Math.max(preferenceShareBps, 10_000 - preferenceShareBps)
      : null;

  return {
    observationId: deterministicObservationId(workspaceId, opportunityId),
    workspaceId,
    scopeId,
    opportunityId,
    executionId,
    operationKey: input.operationKey,
    evidenceReference: `tokenless-result/${input.operationKey}/${input.result.roundId}`,
    sourcePayloadHash,
    agentOutcomeCommitment,
    humanOutcomeCommitment: sha256(stableJson(input.result)),
    agreement: comparable ? (selected === "yes" ? "agree" : "disagree") : "inconclusive",
    comparable,
    respondingHumanCount,
    humanHumanAgreementBps,
    latencyMs: Math.max(0, finalizedAt.getTime() - createdAt.getTime()),
    costAtomic: realizedCostAtomic(input.result),
    finalizedAt: finalizedAt.toISOString(),
  };
}

/**
 * Rebuilds one adaptive observation exclusively from the server-stored terminal
 * result already bound to the opportunity. Caller-supplied verdicts or metrics
 * are intentionally unsupported.
 */
export async function finalizeAdaptiveReviewEvidence(input: {
  operationKey: string;
}): Promise<AdaptiveReviewObservation | null> {
  const operationKey = input.operationKey.trim();
  if (!/^op_[A-Za-z0-9]{16,160}$/.test(operationKey)) {
    throw new TokenlessServiceError("A valid operationKey is required.", 400, "invalid_operation_key");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT o.workspace_id, o.agent_id, o.agent_version_id, o.scope_id, o.opportunity_id,
              o.decision, o.status, o.operation_key, o.execution_id,
              o.source_evidence_hash, o.suggestion_commitment, o.created_at,
              e.integration_id,
              rp.question_authority, rp.result_semantics,
              opportunity_question.question_hash,
              a.result_json
       FROM tokenless_agent_review_opportunities o
       JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
       JOIN tokenless_agent_executions e
         ON e.workspace_id = o.workspace_id AND e.execution_id = o.execution_id
       JOIN tokenless_agent_review_request_profiles rp
         ON rp.workspace_id = o.workspace_id
        AND rp.profile_id = o.request_profile_id
        AND rp.version = o.request_profile_version
        AND rp.profile_hash = o.request_profile_hash
       LEFT JOIN tokenless_agent_review_opportunity_questions opportunity_question
         ON opportunity_question.workspace_id = o.workspace_id
        AND opportunity_question.opportunity_id = o.opportunity_id
       WHERE o.operation_key = $1
       FOR UPDATE`,
      [operationKey],
    );
    const row = result.rows[0] as QueryRow | undefined;
    if (!row) {
      throw new TokenlessServiceError("Bound review opportunity not found.", 404, "review_opportunity_not_found");
    }
    if (
      rowString(row, "decision") !== "required" ||
      !["review_requested", "completed"].includes(rowString(row, "status") ?? "") ||
      rowString(row, "operation_key") !== operationKey
    ) {
      throw new TokenlessServiceError(
        "The operation is not bound to a requestable adaptive review.",
        409,
        "review_binding_conflict",
      );
    }
    const storedResult = parseStoredResult(row.result_json);
    if (!storedResult.terminal || storedResult.operationKey !== operationKey) {
      throw new TokenlessServiceError("The human-review result is not ready.", 409, "result_not_ready", true);
    }
    const observation = observationFromResult({
      row,
      result: storedResult,
      operationKey,
    });
    const now = new Date();
    if (observation)
      await client.query(
        `INSERT INTO tokenless_agent_evaluation_observations
       (observation_id, workspace_id, scope_id, opportunity_id, execution_id, operation_key, run_id, evidence_reference,
        source_payload_hash, agent_outcome_commitment, human_outcome_commitment, agreement, comparable,
        responding_human_count, human_human_agreement_bps, latency_ms, cost_atomic, finalized_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (opportunity_id) DO UPDATE SET
         operation_key = EXCLUDED.operation_key,
         execution_id = EXCLUDED.execution_id,
         evidence_reference = EXCLUDED.evidence_reference,
         source_payload_hash = EXCLUDED.source_payload_hash,
         agent_outcome_commitment = EXCLUDED.agent_outcome_commitment,
         human_outcome_commitment = EXCLUDED.human_outcome_commitment,
         agreement = EXCLUDED.agreement,
         comparable = EXCLUDED.comparable,
         responding_human_count = EXCLUDED.responding_human_count,
         human_human_agreement_bps = EXCLUDED.human_human_agreement_bps,
         latency_ms = EXCLUDED.latency_ms,
         cost_atomic = EXCLUDED.cost_atomic,
         finalized_at = EXCLUDED.finalized_at`,
        [
          observation.observationId,
          observation.workspaceId,
          observation.scopeId,
          observation.opportunityId,
          observation.executionId,
          observation.operationKey,
          observation.evidenceReference,
          observation.sourcePayloadHash,
          observation.agentOutcomeCommitment,
          observation.humanOutcomeCommitment,
          observation.agreement,
          observation.comparable,
          observation.respondingHumanCount,
          observation.humanHumanAgreementBps,
          observation.latencyMs,
          observation.costAtomic,
          new Date(observation.finalizedAt),
          now,
        ],
      );
    else {
      const existing = await client.query(
        `SELECT observation_id FROM tokenless_agent_evaluation_observations
         WHERE workspace_id = $1 AND opportunity_id = $2`,
        [rowString(row, "workspace_id"), rowString(row, "opportunity_id")],
      );
      if (existing.rowCount !== 0) {
        throw new TokenlessServiceError(
          "Feedback results cannot be adaptive evidence.",
          409,
          "review_binding_conflict",
        );
      }
    }
    const finalizedAt = new Date(observation?.finalizedAt ?? storedResult.updatedAt);
    await client.query(
      `UPDATE tokenless_agent_review_opportunities
       SET status = 'completed', updated_at = $1
       WHERE opportunity_id = $2 AND operation_key = $3`,
      [finalizedAt, rowString(row, "opportunity_id"), operationKey],
    );
    const integrationId = rowString(row, "integration_id");
    if (rowString(row, "status") === "review_requested" && integrationId) {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET last_result_at = CASE
           WHEN last_result_at IS NULL OR last_result_at < $1 THEN $1
           ELSE last_result_at
         END,
         updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
         WHERE integration_id = $2 AND workspace_id = $3 AND agent_id = $4 AND agent_version_id = $5`,
        [
          finalizedAt,
          integrationId,
          rowString(row, "workspace_id"),
          rowString(row, "agent_id"),
          rowString(row, "agent_version_id"),
        ],
      );
    }
    await client.query("COMMIT");
    return observation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __adaptiveReviewEvidenceTestUtils = { observationFromResult, stableJson };

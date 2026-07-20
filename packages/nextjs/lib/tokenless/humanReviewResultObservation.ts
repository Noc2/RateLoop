import {
  type HumanReviewResultEnvelope,
  type HumanReviewResultLane,
  type HumanReviewResultOutcome,
  parseHumanReviewResultEnvelope,
} from "@rateloop/sdk";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type QueryableClient = Pick<PoolClient, "query">;

export type SelectionPolicySnapshot = {
  schemaVersion: "rateloop.human-review-selection-policy.v1";
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  version: number;
  mode: string;
  agreementThresholdBps: number;
  productionFloorBps: number;
  fixedRateBps: number | null;
  maximumUnreviewedGap: number;
  rules: Record<string, unknown>;
  audience: Record<string, unknown>;
  publishingPolicyId: string | null;
};

export type HumanReviewResultObservation = {
  observationId: string;
  workspaceId: string;
  opportunityId: string;
  integrationId: string;
  scopeId: string;
  resultEnvelopeCommitment: string;
  resultCommitment: string;
  lifecycle: { state: string; revision: number };
  frozen: {
    selectionPolicy: { id: string; version: number; hash: string };
    binding: { id: string; version: number; hash: string };
    requestProfile: { id: string; version: number; hash: string };
  };
  lane: HumanReviewResultLane;
  outcome: HumanReviewResultOutcome;
  resultSemantics: "assurance" | "feedback";
  calibrationComparable: boolean;
  responseCount: number;
  terminalEvidenceCommitment: string | null;
  adaptiveObservationId: string | null;
  resultObservedAt: string;
  createdAt: string;
  replayed: boolean;
};

type DerivedAdaptiveObservation = {
  observationId: string;
  workspaceId: string;
  scopeId: string;
  opportunityId: string;
  executionId: string | null;
  operationKey: string | null;
  runId: string | null;
  evidenceReference: string;
  sourcePayloadHash: string;
  agentOutcomeCommitment: string;
  humanOutcomeCommitment: string;
  agreement: "agree" | "disagree" | "inconclusive";
  comparable: boolean;
  respondingHumanCount: number;
  latencyMs: number;
  costAtomic: string;
  finalizedAt: Date;
};

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Human-review result is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function deterministicId(prefix: string, workspaceId: string, opportunityId: string) {
  return `${prefix}_${createHash("sha256")
    .update(`${prefix}\0${workspaceId}\0${opportunityId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function deterministicAdaptiveObservationId(workspaceId: string, opportunityId: string) {
  return `aob_${createHash("sha256")
    .update(`adaptive-review-observation\0${workspaceId}\0${opportunityId}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function string(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function boolean(row: Row | undefined, key: string) {
  if (row?.[key] === true || row?.[key] === "t" || row?.[key] === 1) return true;
  if (row?.[key] === false || row?.[key] === "f" || row?.[key] === 0) return false;
  throw new Error(`Stored ${key} is invalid.`);
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed;
}

function jsonObject(value: unknown, key: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Stored ${key} is invalid.`);
  }
}

function selectionPolicySnapshot(row: Row): SelectionPolicySnapshot {
  return {
    schemaVersion: "rateloop.human-review-selection-policy.v1",
    workspaceId: string(row, "workspace_id")!,
    agentId: string(row, "agent_id")!,
    agentVersionId: string(row, "agent_version_id")!,
    policyId: string(row, "policy_id")!,
    version: integer(row, "policy_version"),
    mode: string(row, "policy_mode")!,
    agreementThresholdBps: integer(row, "agreement_threshold_bps"),
    productionFloorBps: integer(row, "production_floor_bps"),
    fixedRateBps:
      row.fixed_rate_bps === null || row.fixed_rate_bps === undefined ? null : integer(row, "fixed_rate_bps"),
    maximumUnreviewedGap: integer(row, "maximum_unreviewed_gap"),
    rules: jsonObject(row.rules_json, "selection policy rules"),
    audience: jsonObject(row.audience_policy_json, "selection audience policy"),
    publishingPolicyId: string(row, "review_publishing_policy_id"),
  };
}

export function hashHumanReviewSelectionPolicySnapshot(snapshot: SelectionPolicySnapshot) {
  return sha256(snapshot);
}

function laneForProfile(row: Row): HumanReviewResultLane {
  const audience = string(row, "profile_audience");
  const compensation = string(row, "compensation_mode");
  if (audience === "public_network" && compensation === "usdc") return "public_paid";
  if (audience === "private_invited" && compensation === "usdc") return "private_paid";
  if (audience === "private_invited" && compensation === "unpaid") return "private_unpaid";
  if (audience === "hybrid") return "hybrid";
  throw new Error("Stored human-review lane configuration is invalid.");
}

function parseEnvelope(value: unknown) {
  try {
    return parseHumanReviewResultEnvelope(value);
  } catch {
    throw new TokenlessServiceError(
      "Human-review result envelope is invalid.",
      400,
      "invalid_human_review_result_envelope",
    );
  }
}

async function loadFrozenOpportunity(client: QueryableClient, envelope: HumanReviewResultEnvelope) {
  await client.query(
    `SELECT opportunity_id FROM tokenless_agent_review_opportunity_lifecycles
     WHERE workspace_id=$1 AND opportunity_id=$2 FOR UPDATE`,
    [envelope.workspaceId, envelope.opportunityId],
  );
  const result = await client.query(
    `SELECT o.workspace_id,o.opportunity_id,o.scope_id,o.agent_id,o.agent_version_id,
            o.policy_id,o.policy_version,o.human_review_binding_id,o.human_review_binding_version,
            o.request_profile_id,o.request_profile_version,o.request_profile_hash,
            o.source_evidence_hash,o.suggestion_commitment,o.execution_id,o.operation_key,o.run_id,o.created_at,
            l.state AS lifecycle_state,l.state_revision,l.state_entered_at,l.terminal_at,
            e.integration_id AS execution_integration_id,
            private_origin.integration_id AS private_integration_id,
            private_origin.response_deadline AS private_response_deadline,
            p.mode AS policy_mode,p.agreement_threshold_bps,p.production_floor_bps,p.fixed_rate_bps,
            p.maximum_unreviewed_gap,p.rules_json,p.audience_policy_json,
            p.publishing_policy_id AS review_publishing_policy_id,
            b.canonical_hash AS binding_hash,
            rp.profile_hash,rp.audience AS profile_audience,rp.compensation_mode,
            rp.question_authority,rp.result_semantics,
            opportunity_question.question_hash
     FROM tokenless_agent_review_opportunities o
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
     JOIN tokenless_agent_review_policies p
       ON p.workspace_id=o.workspace_id AND p.policy_id=o.policy_id AND p.version=o.policy_version
     JOIN tokenless_agent_human_review_bindings b
       ON b.workspace_id=o.workspace_id
      AND b.binding_id=o.human_review_binding_id AND b.version=o.human_review_binding_version
     JOIN tokenless_agent_review_request_profiles rp
       ON rp.workspace_id=o.workspace_id
      AND rp.profile_id=o.request_profile_id AND rp.version=o.request_profile_version
      AND rp.profile_hash=o.request_profile_hash
     LEFT JOIN tokenless_agent_review_opportunity_questions opportunity_question
       ON opportunity_question.workspace_id=o.workspace_id
      AND opportunity_question.opportunity_id=o.opportunity_id
     LEFT JOIN tokenless_agent_executions e ON e.execution_id=o.execution_id
     LEFT JOIN (
       SELECT d.workspace_id,d.opportunity_id,r.integration_id,r.response_deadline
       FROM tokenless_private_unpaid_review_deliveries d
       JOIN tokenless_private_review_requests r ON r.private_review_id=d.private_review_id
     ) private_origin
       ON private_origin.workspace_id=o.workspace_id AND private_origin.opportunity_id=o.opportunity_id
     WHERE o.workspace_id=$1 AND o.opportunity_id=$2`,
    [envelope.workspaceId, envelope.opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError(
      "Human-review opportunity was not found.",
      404,
      "human_review_result_opportunity_not_found",
    );
  }
  return row;
}

function assertExactFrozenResult(row: Row, envelope: HumanReviewResultEnvelope) {
  const expectedIntegrationId = string(row, "execution_integration_id") ?? string(row, "private_integration_id");
  const policyHash = hashHumanReviewSelectionPolicySnapshot(selectionPolicySnapshot(row));
  const expectedLane = laneForProfile(row);
  const exact =
    string(row, "workspace_id") === envelope.workspaceId &&
    string(row, "opportunity_id") === envelope.opportunityId &&
    expectedIntegrationId !== null &&
    expectedIntegrationId === envelope.integrationId &&
    string(row, "lifecycle_state") === envelope.lifecycle.state &&
    integer(row, "state_revision") === envelope.lifecycle.revision &&
    row.terminal_at !== null &&
    string(row, "policy_id") === envelope.frozen.selectionPolicy.id &&
    integer(row, "policy_version") === envelope.frozen.selectionPolicy.version &&
    policyHash === envelope.frozen.selectionPolicy.hash &&
    string(row, "human_review_binding_id") === envelope.frozen.binding.id &&
    integer(row, "human_review_binding_version") === envelope.frozen.binding.version &&
    string(row, "binding_hash") === envelope.frozen.binding.hash &&
    string(row, "request_profile_id") === envelope.frozen.requestProfile.id &&
    integer(row, "request_profile_version") === envelope.frozen.requestProfile.version &&
    string(row, "request_profile_hash") === envelope.frozen.requestProfile.hash &&
    string(row, "profile_hash") === envelope.frozen.requestProfile.hash &&
    expectedLane === envelope.lane &&
    date(row, "created_at").toISOString() === envelope.lifecycle.startedAt &&
    date(row, "state_entered_at").toISOString() === envelope.lifecycle.stateEnteredAt &&
    Date.parse(envelope.lifecycle.finalizedAt) >= date(row, "terminal_at").getTime();
  const privateDeadline =
    row.private_response_deadline === null || row.private_response_deadline === undefined
      ? null
      : date(row, "private_response_deadline").toISOString();
  if (!exact || (privateDeadline !== null && privateDeadline !== envelope.frozen.responseDeadline)) {
    throw new TokenlessServiceError(
      "Human-review result does not match its exact frozen opportunity.",
      409,
      "human_review_result_binding_conflict",
    );
  }
}

function realizedCostAtomic(envelope: HumanReviewResultEnvelope) {
  return (
    BigInt(envelope.economics.guaranteedBase.paidAtomic) +
    BigInt(envelope.economics.automaticQualityAllocation.awardedAtomic) +
    BigInt(envelope.economics.feedbackBonus.awardedAtomic)
  ).toString();
}

function deriveAdaptiveObservation(row: Row, envelope: HumanReviewResultEnvelope): DerivedAdaptiveObservation | null {
  const resultSemantics = string(row, "result_semantics");
  if (resultSemantics === "feedback") {
    if (
      string(row, "question_authority") !== "agent_per_request" ||
      !HASH_PATTERN.test(string(row, "question_hash") ?? "")
    ) {
      throw new Error("Stored feedback question binding is invalid.");
    }
    return null;
  }
  if (resultSemantics !== "assurance" || string(row, "question_authority") !== "owner_fixed") {
    throw new Error("Stored review-result semantics are invalid.");
  }
  if (envelope.outcome === "failed" || envelope.outcome === "cancelled") return null;
  const workspaceId = envelope.workspaceId;
  const opportunityId = envelope.opportunityId;
  const finalizedAt = new Date(envelope.lifecycle.finalizedAt);
  const startedAt = new Date(envelope.lifecycle.startedAt);
  const comparable = envelope.outcome === "positive" || envelope.outcome === "negative";
  return {
    observationId: deterministicAdaptiveObservationId(workspaceId, opportunityId),
    workspaceId,
    scopeId: string(row, "scope_id")!,
    opportunityId,
    executionId: string(row, "execution_id"),
    operationKey: string(row, "operation_key"),
    runId: string(row, "run_id"),
    evidenceReference: `human-review-result/${deterministicId("hrob", workspaceId, opportunityId)}`,
    sourcePayloadHash: string(row, "source_evidence_hash")!,
    agentOutcomeCommitment: string(row, "suggestion_commitment")!,
    humanOutcomeCommitment: envelope.commitments.result,
    agreement:
      envelope.outcome === "positive" ? "agree" : envelope.outcome === "negative" ? "disagree" : "inconclusive",
    comparable,
    respondingHumanCount: envelope.panel.responseCount,
    latencyMs: Math.max(0, finalizedAt.getTime() - startedAt.getTime()),
    costAtomic: realizedCostAtomic(envelope),
    finalizedAt,
  };
}

function adaptiveRowMatches(row: Row, expected: DerivedAdaptiveObservation) {
  return (
    string(row, "observation_id") === expected.observationId &&
    string(row, "workspace_id") === expected.workspaceId &&
    string(row, "scope_id") === expected.scopeId &&
    string(row, "opportunity_id") === expected.opportunityId &&
    string(row, "execution_id") === expected.executionId &&
    string(row, "operation_key") === expected.operationKey &&
    string(row, "run_id") === expected.runId &&
    string(row, "evidence_reference") === expected.evidenceReference &&
    string(row, "source_payload_hash") === expected.sourcePayloadHash &&
    string(row, "agent_outcome_commitment") === expected.agentOutcomeCommitment &&
    string(row, "human_outcome_commitment") === expected.humanOutcomeCommitment &&
    string(row, "agreement") === expected.agreement &&
    boolean(row, "comparable") === expected.comparable &&
    integer(row, "responding_human_count") === expected.respondingHumanCount &&
    row.human_human_agreement_bps === null &&
    integer(row, "latency_ms") === expected.latencyMs &&
    string(row, "cost_atomic") === expected.costAtomic &&
    date(row, "finalized_at").getTime() === expected.finalizedAt.getTime()
  );
}

async function appendAdaptiveObservation(client: QueryableClient, expected: DerivedAdaptiveObservation) {
  await client.query(
    `INSERT INTO tokenless_agent_evaluation_observations
     (observation_id,workspace_id,scope_id,opportunity_id,execution_id,operation_key,run_id,evidence_reference,
      source_payload_hash,agent_outcome_commitment,human_outcome_commitment,agreement,comparable,
      responding_human_count,human_human_agreement_bps,latency_ms,cost_atomic,finalized_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17,$18)
     ON CONFLICT (opportunity_id) DO NOTHING`,
    [
      expected.observationId,
      expected.workspaceId,
      expected.scopeId,
      expected.opportunityId,
      expected.executionId,
      expected.operationKey,
      expected.runId,
      expected.evidenceReference,
      expected.sourcePayloadHash,
      expected.agentOutcomeCommitment,
      expected.humanOutcomeCommitment,
      expected.agreement,
      expected.comparable,
      expected.respondingHumanCount,
      expected.latencyMs,
      expected.costAtomic,
      expected.finalizedAt,
      new Date(),
    ],
  );
  const stored = await client.query(
    `SELECT * FROM tokenless_agent_evaluation_observations
     WHERE workspace_id=$1 AND opportunity_id=$2`,
    [expected.workspaceId, expected.opportunityId],
  );
  const row = stored.rows[0] as Row | undefined;
  if (!row || !adaptiveRowMatches(row, expected)) {
    throw new TokenlessServiceError(
      "A different adaptive observation already exists for this opportunity.",
      409,
      "human_review_result_observation_conflict",
    );
  }
}

async function assertNoAdaptiveObservation(client: QueryableClient, envelope: HumanReviewResultEnvelope) {
  const stored = await client.query(
    `SELECT observation_id FROM tokenless_agent_evaluation_observations
     WHERE workspace_id=$1 AND opportunity_id=$2`,
    [envelope.workspaceId, envelope.opportunityId],
  );
  if (stored.rowCount !== 0) {
    throw new TokenlessServiceError(
      "This result cannot be calibration evidence.",
      409,
      "human_review_result_observation_conflict",
    );
  }
}

function observationFromRow(row: Row, replayed: boolean): HumanReviewResultObservation {
  const terminalEvidenceCommitment = string(row, "terminal_evidence_commitment");
  for (const [field, value] of [
    ["result envelope commitment", string(row, "result_envelope_commitment")],
    ["result commitment", string(row, "result_commitment")],
    ["selection policy hash", string(row, "selection_policy_hash")],
    ["binding hash", string(row, "human_review_binding_hash")],
    ["request profile hash", string(row, "request_profile_hash")],
    ["terminal evidence commitment", terminalEvidenceCommitment],
  ] as const) {
    if (value !== null && !HASH_PATTERN.test(value)) throw new Error(`Stored ${field} is invalid.`);
  }
  const resultSemantics = string(row, "result_semantics");
  if (resultSemantics !== "assurance" && resultSemantics !== "feedback") {
    throw new Error("Stored result_semantics is invalid.");
  }
  return {
    observationId: string(row, "observation_id")!,
    workspaceId: string(row, "workspace_id")!,
    opportunityId: string(row, "opportunity_id")!,
    integrationId: string(row, "integration_id")!,
    scopeId: string(row, "scope_id")!,
    resultEnvelopeCommitment: string(row, "result_envelope_commitment")!,
    resultCommitment: string(row, "result_commitment")!,
    lifecycle: {
      state: string(row, "lifecycle_state")!,
      revision: integer(row, "lifecycle_revision"),
    },
    frozen: {
      selectionPolicy: {
        id: string(row, "selection_policy_id")!,
        version: integer(row, "selection_policy_version"),
        hash: string(row, "selection_policy_hash")!,
      },
      binding: {
        id: string(row, "human_review_binding_id")!,
        version: integer(row, "human_review_binding_version"),
        hash: string(row, "human_review_binding_hash")!,
      },
      requestProfile: {
        id: string(row, "request_profile_id")!,
        version: integer(row, "request_profile_version"),
        hash: string(row, "request_profile_hash")!,
      },
    },
    lane: string(row, "lane") as HumanReviewResultLane,
    outcome: string(row, "outcome") as HumanReviewResultOutcome,
    resultSemantics,
    calibrationComparable: boolean(row, "calibration_comparable"),
    responseCount: integer(row, "response_count"),
    terminalEvidenceCommitment,
    adaptiveObservationId: string(row, "adaptive_observation_id"),
    resultObservedAt: date(row, "result_observed_at").toISOString(),
    createdAt: date(row, "created_at").toISOString(),
    replayed,
  };
}

function observationMatchesEnvelope(
  row: Row,
  envelope: HumanReviewResultEnvelope,
  envelopeCommitment: string,
  resultSemantics: "assurance" | "feedback",
) {
  return (
    string(row, "workspace_id") === envelope.workspaceId &&
    string(row, "opportunity_id") === envelope.opportunityId &&
    string(row, "integration_id") === envelope.integrationId &&
    string(row, "result_envelope_commitment") === envelopeCommitment &&
    string(row, "result_commitment") === envelope.commitments.result &&
    string(row, "lifecycle_state") === envelope.lifecycle.state &&
    integer(row, "lifecycle_revision") === envelope.lifecycle.revision &&
    string(row, "lane") === envelope.lane &&
    string(row, "outcome") === envelope.outcome &&
    string(row, "result_semantics") === resultSemantics
  );
}

let afterAdaptiveWriteForTests: (() => void | Promise<void>) | null = null;

/**
 * Records one privacy-safe terminal result. The database transaction is the
 * only side effect: this function never publishes a request or spends funds.
 */
export async function observeHumanReviewResult(input: { envelope: unknown }): Promise<HumanReviewResultObservation> {
  const envelope = parseEnvelope(input.envelope);
  const envelopeCommitment = sha256(envelope);
  const terminalEvidenceCommitment = envelope.terminalEvidence ? sha256(envelope.terminalEvidence) : null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await loadFrozenOpportunity(client, envelope);
    assertExactFrozenResult(opportunity, envelope);
    const resultSemantics = string(opportunity, "result_semantics");
    if (resultSemantics !== "assurance" && resultSemantics !== "feedback") {
      throw new Error("Stored review-result semantics are invalid.");
    }
    const adaptive = deriveAdaptiveObservation(opportunity, envelope);

    const existingResult = await client.query(
      `SELECT * FROM tokenless_agent_human_review_result_observations
       WHERE workspace_id=$1 AND opportunity_id=$2 FOR UPDATE`,
      [envelope.workspaceId, envelope.opportunityId],
    );
    const existing = existingResult.rows[0] as Row | undefined;
    if (existing) {
      if (!observationMatchesEnvelope(existing, envelope, envelopeCommitment, resultSemantics)) {
        throw new TokenlessServiceError(
          "A different terminal result is already recorded for this opportunity.",
          409,
          "human_review_result_observation_conflict",
        );
      }
      if (adaptive) await appendAdaptiveObservation(client, adaptive);
      else await assertNoAdaptiveObservation(client, envelope);
      await client.query("COMMIT");
      return observationFromRow(existing, true);
    }

    if (adaptive) {
      await appendAdaptiveObservation(client, adaptive);
      await afterAdaptiveWriteForTests?.();
    } else await assertNoAdaptiveObservation(client, envelope);
    const now = new Date();
    const observationId = deterministicId("hrob", envelope.workspaceId, envelope.opportunityId);
    const inserted = await client.query(
      `INSERT INTO tokenless_agent_human_review_result_observations
       (observation_id,workspace_id,opportunity_id,integration_id,scope_id,result_schema_version,
        result_envelope_commitment,result_commitment,lifecycle_state,lifecycle_revision,
        selection_policy_id,selection_policy_version,selection_policy_hash,
        human_review_binding_id,human_review_binding_version,human_review_binding_hash,
        request_profile_id,request_profile_version,request_profile_hash,lane,outcome,result_semantics,
        calibration_comparable,response_count,terminal_evidence_commitment,adaptive_observation_id,
        result_observed_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               $22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [
        observationId,
        envelope.workspaceId,
        envelope.opportunityId,
        envelope.integrationId,
        string(opportunity, "scope_id"),
        envelope.schemaVersion,
        envelopeCommitment,
        envelope.commitments.result,
        envelope.lifecycle.state,
        envelope.lifecycle.revision,
        envelope.frozen.selectionPolicy.id,
        envelope.frozen.selectionPolicy.version,
        envelope.frozen.selectionPolicy.hash,
        envelope.frozen.binding.id,
        envelope.frozen.binding.version,
        envelope.frozen.binding.hash,
        envelope.frozen.requestProfile.id,
        envelope.frozen.requestProfile.version,
        envelope.frozen.requestProfile.hash,
        envelope.lane,
        envelope.outcome,
        resultSemantics,
        adaptive?.comparable ?? false,
        envelope.panel.responseCount,
        terminalEvidenceCommitment,
        adaptive?.observationId ?? null,
        new Date(envelope.lifecycle.finalizedAt),
        now,
      ],
    );
    const stored = inserted.rows[0] as Row | undefined;
    if (!stored) throw new Error("Human-review result observation was not persisted.");
    await client.query("COMMIT");
    return observationFromRow(stored, false);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __humanReviewResultObservationTestUtils = {
  deriveAdaptiveObservation,
  selectionPolicySnapshot,
  sha256,
  stableJson,
  setAfterAdaptiveWriteForTests(value: (() => void | Promise<void>) | null) {
    afterAdaptiveWriteForTests = value;
  },
};

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import {
  type AdaptiveReviewDecisionRequest,
  evaluateAdaptiveReviewRequirement,
} from "~~/lib/tokenless/adaptiveReviewService";
import type { AgentExecutionProvenanceInput } from "~~/lib/tokenless/agentExecutionProvenance";
import {
  type ProductPrincipal,
  authenticateProductPrincipal,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION = "rateloop.automated-eval-receipt.v1" as const;
export const AUTOMATED_EVAL_INGEST_RESULT_SCHEMA_VERSION = "rateloop.automated-eval-ingest-result.v1" as const;
export const AUTOMATED_EVAL_LABELED_DATA_SCHEMA_VERSION = "rateloop.automated-eval-labeled-data.v1" as const;
export const AUTOMATED_EVAL_RESULT_SCHEMA_VERSION = "rateloop.automated-eval-result.v1" as const;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const RECEIPT_ID_PATTERN = /^aer_[0-9a-f]{40}$/u;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_RECEIPT_AGE_MS = 366 * 24 * 60 * 60_000;
const DEFAULT_EXPORT_WINDOW_MS = 30 * 24 * 60 * 60_000;
const MAX_EXPORT_WINDOW_MS = 366 * 24 * 60 * 60_000;
const MAX_LABELED_DATA_ROWS = 5_000;

type QueryRow = Record<string, unknown>;
type AutomatedEvalPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;
export type AutomatedEvalProvider = "promptfoo" | "nemo_guardrails" | "inspect" | "custom";
export type AutomatedEvalOutcome = "pass" | "fail" | "uncertain";

export type AutomatedEvalReviewContext = {
  policyId: string;
  policyVersion: number;
  workflowKey: string;
  riskTier: string;
  audiencePolicyHash: string;
  declaredConfidenceBps?: number | null;
  metadataComplete: boolean;
  execution: AgentExecutionProvenanceInput;
};

export type AutomatedEvalReceiptRequest = {
  schemaVersion: typeof AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION;
  provider: AutomatedEvalProvider;
  externalReceiptId: string;
  agentId: string;
  agentVersionId: string;
  evaluator: { name: string; version: string };
  evaluation: {
    checkName: string;
    outcome: AutomatedEvalOutcome;
    scoreBps?: number | null;
    thresholdBps?: number | null;
  };
  contentCommitment: string;
  observedAt: string;
  reviewContext?: AutomatedEvalReviewContext;
};

type NormalizedReceipt = Omit<AutomatedEvalReceiptRequest, "externalReceiptId" | "reviewContext"> & {
  externalReferenceHash: string;
  reviewContext: AutomatedEvalReviewContext | null;
};

export type AutomatedEvalIngestResult = {
  schemaVersion: typeof AUTOMATED_EVAL_INGEST_RESULT_SCHEMA_VERSION;
  receiptId: string;
  receiptHash: string;
  provider: AutomatedEvalProvider;
  automatedSignal: {
    sourceKind: "automated_evaluation";
    outcome: AutomatedEvalOutcome;
    scoreBps: number | null;
    thresholdBps: number | null;
    humanVerdict: null;
  };
  humanReview: null | {
    required: true;
    trigger: "guardrail_uncertain";
    opportunityId: string;
    decision: "required";
  };
  replayed: boolean;
};

export type AutomatedEvalLabeledDataItem = {
  receiptId: string;
  receiptHash: string;
  externalReferenceHash: string;
  provider: AutomatedEvalProvider;
  evaluator: { name: string; version: string };
  checkName: string;
  automatedOutcome: "uncertain";
  automatedScoreBps: number | null;
  automatedThresholdBps: number | null;
  contentCommitment: string;
  opportunityId: string;
  humanLabel: "positive" | "negative";
  humanResultCommitment: string;
  responseCount: number;
  observedAt: string;
  labeledAt: string;
};

export type AutomatedEvalResult = {
  schemaVersion: typeof AUTOMATED_EVAL_RESULT_SCHEMA_VERSION;
  receiptId: string;
  receiptHash: string;
  provider: AutomatedEvalProvider;
  evaluator: { name: string; version: string };
  checkName: string;
  contentCommitment: string;
  observedAt: string;
  automatedSignal: {
    sourceKind: "automated_evaluation";
    outcome: AutomatedEvalOutcome;
    scoreBps: number | null;
    thresholdBps: number | null;
    humanVerdict: null;
  };
  humanReview: null | {
    required: true;
    trigger: "guardrail_uncertain";
    opportunityId: string;
    state: "pending" | "completed";
    verdict: null | {
      label: "positive" | "negative" | "inconclusive";
      resultCommitment: string;
      responseCount: number;
      observedAt: string;
    };
  };
};

function invalid(message: string, code = "invalid_automated_eval_receipt", status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function exactObject(value: unknown, name: string, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  const result = value as Record<string, unknown>;
  const unsupported = Object.keys(result).filter(key => !allowed.includes(key));
  if (unsupported.length > 0) invalid(`${name} contains unsupported fields.`);
  return result;
}

function identifier(value: unknown, name: string) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    invalid(`${name} must be a privacy-safe opaque identifier.`);
  }
  return value;
}

function hash(value: unknown, name: string) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(`${name} must be a lowercase sha256 commitment.`);
  return value;
}

function bps(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    invalid(`${name} must be an integer from zero to 10000.`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(`${name} must be a positive integer.`);
  return Number(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) invalid("Receipt is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  const material = typeof value === "string" ? value : canonicalJson(value);
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

function deterministicId(prefix: "aer" | "aes", ...parts: string[]) {
  return `${prefix}_${createHash("sha256")
    .update([prefix, ...parts].join("\0"))
    .digest("hex")
    .slice(0, 40)}`;
}

function provider(value: unknown): AutomatedEvalProvider {
  if (value !== "promptfoo" && value !== "nemo_guardrails" && value !== "inspect" && value !== "custom") {
    invalid("provider is unsupported.");
  }
  return value;
}

function outcome(value: unknown): AutomatedEvalOutcome {
  if (value !== "pass" && value !== "fail" && value !== "uncertain") invalid("evaluation.outcome is unsupported.");
  return value;
}

function isoTimestamp(value: unknown, name: string, now: Date) {
  if (typeof value !== "string") invalid(`${name} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    invalid(`${name} must be a canonical ISO timestamp.`);
  if (parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS || parsed.getTime() < now.getTime() - MAX_RECEIPT_AGE_MS) {
    invalid(`${name} is outside the accepted ingest window.`);
  }
  return parsed.toISOString();
}

function parseReviewContext(value: unknown): AutomatedEvalReviewContext {
  const input = exactObject(value, "reviewContext", [
    "policyId",
    "policyVersion",
    "workflowKey",
    "riskTier",
    "audiencePolicyHash",
    "declaredConfidenceBps",
    "metadataComplete",
    "execution",
  ]);
  if (typeof input.metadataComplete !== "boolean") invalid("reviewContext.metadataComplete must be boolean.");
  if (!input.execution || typeof input.execution !== "object" || Array.isArray(input.execution)) {
    invalid("reviewContext.execution must be an object.");
  }
  return {
    policyId: identifier(input.policyId, "reviewContext.policyId"),
    policyVersion: positiveInteger(input.policyVersion, "reviewContext.policyVersion"),
    workflowKey: identifier(input.workflowKey, "reviewContext.workflowKey"),
    riskTier: identifier(input.riskTier, "reviewContext.riskTier"),
    audiencePolicyHash: hash(input.audiencePolicyHash, "reviewContext.audiencePolicyHash"),
    declaredConfidenceBps: bps(input.declaredConfidenceBps, "reviewContext.declaredConfidenceBps"),
    metadataComplete: input.metadataComplete,
    execution: input.execution as AgentExecutionProvenanceInput,
  };
}

export function parseAutomatedEvalReceipt(value: unknown, now = new Date()): NormalizedReceipt {
  const input = exactObject(value, "receipt", [
    "schemaVersion",
    "provider",
    "externalReceiptId",
    "agentId",
    "agentVersionId",
    "evaluator",
    "evaluation",
    "contentCommitment",
    "observedAt",
    "reviewContext",
  ]);
  if (input.schemaVersion !== AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION) invalid("schemaVersion is unsupported.");
  const parsedProvider = provider(input.provider);
  const externalReceiptId = identifier(input.externalReceiptId, "externalReceiptId");
  const evaluator = exactObject(input.evaluator, "evaluator", ["name", "version"]);
  const evaluation = exactObject(input.evaluation, "evaluation", ["checkName", "outcome", "scoreBps", "thresholdBps"]);
  const parsedOutcome = outcome(evaluation.outcome);
  const reviewContext = input.reviewContext === undefined ? null : parseReviewContext(input.reviewContext);
  if ((parsedOutcome === "uncertain") !== (reviewContext !== null)) {
    invalid("Exactly uncertain receipts must include reviewContext.");
  }
  return {
    schemaVersion: AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION,
    provider: parsedProvider,
    externalReferenceHash: sha256({
      provider: parsedProvider,
      agentId: identifier(input.agentId, "agentId"),
      agentVersionId: identifier(input.agentVersionId, "agentVersionId"),
      externalReceiptId,
    }),
    agentId: identifier(input.agentId, "agentId"),
    agentVersionId: identifier(input.agentVersionId, "agentVersionId"),
    evaluator: {
      name: identifier(evaluator.name, "evaluator.name"),
      version: identifier(evaluator.version, "evaluator.version"),
    },
    evaluation: {
      checkName: identifier(evaluation.checkName, "evaluation.checkName"),
      outcome: parsedOutcome,
      scoreBps: bps(evaluation.scoreBps, "evaluation.scoreBps"),
      thresholdBps: bps(evaluation.thresholdBps, "evaluation.thresholdBps"),
    },
    contentCommitment: hash(input.contentCommitment, "contentCommitment"),
    observedAt: isoTimestamp(input.observedAt, "observedAt", now),
    reviewContext,
  };
}

export async function authenticateAutomatedEvalPrincipal(
  authorization: string | null,
  scope: "telemetry:write" | "evaluation:read",
): Promise<AutomatedEvalPrincipal> {
  if (!authorization) invalid("A workspace API key is required.", "workspace_api_key_required", 401);
  const principal = await authenticateProductPrincipal({ authorization, sessionToken: undefined });
  if (principal.kind !== "api_key") invalid("A workspace API key is required.", "workspace_api_key_required", 401);
  requireProductPrincipalScope(principal, scope);
  return principal;
}

function text(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function optionalInteger(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored ${key} is invalid.`);
  return parsed;
}

function storedResult(row: QueryRow, replayed: boolean): AutomatedEvalIngestResult {
  const storedProvider = provider(row.provider);
  const storedOutcome = outcome(row.automated_outcome);
  const opportunityId = text(row, "opportunity_id");
  const decision = text(row, "decision");
  if (storedOutcome === "uncertain" && (!opportunityId || decision !== "required")) {
    throw new Error("Stored uncertain automated-eval receipt has no required human-review opportunity.");
  }
  if (storedOutcome !== "uncertain" && opportunityId) {
    throw new Error("Stored conclusive automated-eval receipt has an invalid escalation.");
  }
  return {
    schemaVersion: AUTOMATED_EVAL_INGEST_RESULT_SCHEMA_VERSION,
    receiptId: text(row, "receipt_id")!,
    receiptHash: text(row, "receipt_hash")!,
    provider: storedProvider,
    automatedSignal: {
      sourceKind: "automated_evaluation",
      outcome: storedOutcome,
      scoreBps: optionalInteger(row, "score_bps"),
      thresholdBps: optionalInteger(row, "threshold_bps"),
      humanVerdict: null,
    },
    humanReview:
      storedOutcome === "uncertain"
        ? { required: true, trigger: "guardrail_uncertain", opportunityId: opportunityId!, decision: "required" }
        : null,
    replayed,
  };
}

async function findExisting(
  client: PoolClient,
  input: {
    workspaceId: string;
    idempotencyKeyHash: string;
    provider: AutomatedEvalProvider;
    externalReferenceHash: string;
    checkName: string;
  },
) {
  const result = await client.query(
    `SELECT r.*,e.opportunity_id,o.decision
     FROM tokenless_assurance_automated_eval_receipts r
     LEFT JOIN tokenless_assurance_automated_eval_escalations e
       ON e.workspace_id=r.workspace_id AND e.receipt_id=r.receipt_id
     LEFT JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=e.workspace_id AND o.opportunity_id=e.opportunity_id
     WHERE r.workspace_id=$1 AND (
       r.idempotency_key_hash=$2
       OR (r.provider=$3 AND r.external_reference_hash=$4 AND r.check_name=$5)
     )
     ORDER BY CASE WHEN r.idempotency_key_hash=$2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [input.workspaceId, input.idempotencyKeyHash, input.provider, input.externalReferenceHash, input.checkName],
  );
  return result.rows[0] as QueryRow | undefined;
}

function assertReplay(row: QueryRow, receiptHash: string) {
  if (text(row, "receipt_hash") !== receiptHash) {
    throw new TokenlessServiceError(
      "Idempotency key or source receipt was reused with different evaluation evidence.",
      409,
      "automated_eval_receipt_conflict",
    );
  }
  return storedResult(row, true);
}

function reviewRequest(
  receiptId: string,
  receiptHash: string,
  receipt: NormalizedReceipt,
): AdaptiveReviewDecisionRequest {
  const context = receipt.reviewContext;
  if (!context) throw new Error("Uncertain receipt is missing review context.");
  return {
    externalOpportunityId: receiptId,
    agentId: receipt.agentId,
    agentVersionId: receipt.agentVersionId,
    policyId: context.policyId,
    policyVersion: context.policyVersion,
    workflowKey: context.workflowKey,
    riskTier: context.riskTier,
    audiencePolicyHash: context.audiencePolicyHash,
    suggestionCommitment: receipt.contentCommitment,
    sourceEvidence: { reference: `automated-eval-receipt/${receiptId}`, hash: receiptHash },
    declaredConfidenceBps: context.declaredConfidenceBps,
    criticalRisk: true,
    metadataComplete: context.metadataComplete,
    execution: context.execution,
  };
}

export async function ingestAutomatedEvalReceipt(input: {
  principal: AutomatedEvalPrincipal;
  idempotencyKey: string;
  request: unknown;
  now?: Date;
  evaluateReview?: typeof evaluateAdaptiveReviewRequirement;
}): Promise<AutomatedEvalIngestResult> {
  requireProductPrincipalScope(input.principal, "telemetry:write");
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    invalid("Idempotency-Key must be an opaque 8-200 character identifier.", "invalid_idempotency_key");
  }
  const now = input.now ?? new Date();
  const receipt = parseAutomatedEvalReceipt(input.request, now);
  const receiptHash = sha256(receipt);
  const receiptId = deterministicId(
    "aer",
    input.principal.workspaceId,
    receipt.provider,
    receipt.externalReferenceHash,
    receipt.evaluation.checkName,
  );
  const idempotencyKeyHash = sha256({ workspaceId: input.principal.workspaceId, key: input.idempotencyKey });
  const lockKeys = [
    `automated-eval-idempotency:${input.principal.workspaceId}:${idempotencyKeyHash}`,
    `automated-eval-source:${input.principal.workspaceId}:${receiptId}`,
  ].sort();
  const client = await dbPool.connect();
  try {
    for (const lockKey of lockKeys) await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    const existing = await findExisting(client, {
      workspaceId: input.principal.workspaceId,
      idempotencyKeyHash,
      provider: receipt.provider,
      externalReferenceHash: receipt.externalReferenceHash,
      checkName: receipt.evaluation.checkName,
    });
    if (existing && text(existing, "receipt_hash") !== receiptHash) {
      return assertReplay(existing, receiptHash);
    }

    if (!existing) {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tokenless_assurance_automated_eval_receipts
         (receipt_id,workspace_id,agent_id,agent_version_id,provider,external_reference_hash,
          idempotency_key_hash,evaluator_name,evaluator_version,check_name,automated_outcome,
          score_bps,threshold_bps,content_commitment,receipt_hash,normalized_receipt_json,observed_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          receiptId,
          input.principal.workspaceId,
          receipt.agentId,
          receipt.agentVersionId,
          receipt.provider,
          receipt.externalReferenceHash,
          idempotencyKeyHash,
          receipt.evaluator.name,
          receipt.evaluator.version,
          receipt.evaluation.checkName,
          receipt.evaluation.outcome,
          receipt.evaluation.scoreBps,
          receipt.evaluation.thresholdBps,
          receipt.contentCommitment,
          receiptHash,
          canonicalJson(receipt),
          new Date(receipt.observedAt),
          now,
        ],
      );
      await client.query("COMMIT");
    } else if (receipt.evaluation.outcome !== "uncertain" || text(existing, "opportunity_id")) {
      return assertReplay(existing, receiptHash);
    }

    let opportunityId: string | null = null;
    if (receipt.evaluation.outcome === "uncertain") {
      requireProductPrincipalScope(input.principal, "review:decide");
      const decision = await (input.evaluateReview ?? evaluateAdaptiveReviewRequirement)({
        principal: input.principal,
        request: reviewRequest(receiptId, receiptHash, receipt),
      });
      if (!decision.required || decision.decision !== "required") {
        throw new Error("Guardrail uncertainty did not produce a required human-review opportunity.");
      }
      opportunityId = decision.opportunityId;
    }

    if (opportunityId) {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tokenless_assurance_automated_eval_escalations
         (escalation_id,workspace_id,receipt_id,opportunity_id,trigger_kind,state,created_at)
         VALUES ($1,$2,$3,$4,'guardrail_uncertain','human_review_required',$5)`,
        [
          deterministicId("aes", input.principal.workspaceId, receiptId),
          input.principal.workspaceId,
          receiptId,
          opportunityId,
          now,
        ],
      );
      await client.query("COMMIT");
    }
    return {
      schemaVersion: AUTOMATED_EVAL_INGEST_RESULT_SCHEMA_VERSION,
      receiptId,
      receiptHash,
      provider: receipt.provider,
      automatedSignal: {
        sourceKind: "automated_evaluation",
        outcome: receipt.evaluation.outcome,
        scoreBps: receipt.evaluation.scoreBps ?? null,
        thresholdBps: receipt.evaluation.thresholdBps ?? null,
        humanVerdict: null,
      },
      humanReview: opportunityId
        ? { required: true, trigger: "guardrail_uncertain", opportunityId, decision: "required" }
        : null,
      replayed: Boolean(existing),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    for (const lockKey of [...lockKeys].reverse()) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
    }
    client.release();
  }
}

function exportBoundary(value: Date | undefined, name: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value.getTime())) invalid(`${name} must be a valid timestamp.`, "invalid_labeled_data_window");
  return value;
}

function rowDate(row: QueryRow, key: string) {
  const parsed = row[key] instanceof Date ? (row[key] as Date) : new Date(String(row[key]));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed.toISOString();
}

export async function getAutomatedEvalResult(input: {
  principal: AutomatedEvalPrincipal;
  receiptId: string;
}): Promise<AutomatedEvalResult> {
  requireProductPrincipalScope(input.principal, "evaluation:read");
  if (!RECEIPT_ID_PATTERN.test(input.receiptId)) {
    invalid("Automated-eval receipt ID is invalid.", "invalid_automated_eval_receipt_id");
  }
  const result = await dbPool.query(
    `SELECT r.receipt_id,r.receipt_hash,r.provider,r.evaluator_name,r.evaluator_version,
            r.check_name,r.automated_outcome,r.score_bps,r.threshold_bps,
            r.content_commitment,r.observed_at,e.opportunity_id,
            h.outcome AS human_outcome,h.result_commitment,h.response_count,h.result_observed_at
     FROM tokenless_assurance_automated_eval_receipts r
     LEFT JOIN tokenless_assurance_automated_eval_escalations e
       ON e.workspace_id=r.workspace_id AND e.receipt_id=r.receipt_id
     LEFT JOIN tokenless_agent_human_review_result_observations h
       ON h.workspace_id=e.workspace_id AND h.opportunity_id=e.opportunity_id
     WHERE r.workspace_id=$1 AND r.receipt_id=$2
     LIMIT 1`,
    [input.principal.workspaceId, input.receiptId],
  );
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) {
    invalid("Automated-eval receipt was not found.", "automated_eval_receipt_not_found", 404);
  }
  const automatedOutcome = outcome(row.automated_outcome);
  const opportunityId = text(row, "opportunity_id");
  if (automatedOutcome === "uncertain" && !opportunityId) {
    throw new Error("Stored uncertain automated-eval receipt has no required human-review opportunity.");
  }
  if (automatedOutcome !== "uncertain" && opportunityId) {
    throw new Error("Stored conclusive automated-eval receipt has an invalid escalation.");
  }
  const humanOutcome = text(row, "human_outcome");
  if (
    humanOutcome !== null &&
    humanOutcome !== "positive" &&
    humanOutcome !== "negative" &&
    humanOutcome !== "inconclusive"
  ) {
    throw new Error("Stored human-review outcome is invalid.");
  }
  const verdict: NonNullable<AutomatedEvalResult["humanReview"]>["verdict"] =
    humanOutcome === null
      ? null
      : {
          label: humanOutcome,
          resultCommitment: text(row, "result_commitment")!,
          responseCount: optionalInteger(row, "response_count")!,
          observedAt: rowDate(row, "result_observed_at"),
        };
  return {
    schemaVersion: AUTOMATED_EVAL_RESULT_SCHEMA_VERSION,
    receiptId: text(row, "receipt_id")!,
    receiptHash: text(row, "receipt_hash")!,
    provider: provider(row.provider),
    evaluator: {
      name: text(row, "evaluator_name")!,
      version: text(row, "evaluator_version")!,
    },
    checkName: text(row, "check_name")!,
    contentCommitment: text(row, "content_commitment")!,
    observedAt: rowDate(row, "observed_at"),
    automatedSignal: {
      sourceKind: "automated_evaluation",
      outcome: automatedOutcome,
      scoreBps: optionalInteger(row, "score_bps"),
      thresholdBps: optionalInteger(row, "threshold_bps"),
      humanVerdict: null,
    },
    humanReview:
      automatedOutcome === "uncertain"
        ? {
            required: true,
            trigger: "guardrail_uncertain",
            opportunityId: opportunityId!,
            state: verdict ? "completed" : "pending",
            verdict,
          }
        : null,
  };
}

export async function exportAutomatedEvalLabeledData(input: {
  principal: AutomatedEvalPrincipal;
  from?: Date;
  to?: Date;
  now?: Date;
}) {
  requireProductPrincipalScope(input.principal, "evaluation:read");
  const now = input.now ?? new Date();
  const to = exportBoundary(input.to, "to") ?? now;
  const from = exportBoundary(input.from, "from") ?? new Date(to.getTime() - DEFAULT_EXPORT_WINDOW_MS);
  if (from >= to || to.getTime() - from.getTime() > MAX_EXPORT_WINDOW_MS) {
    invalid("Labeled-data window must be positive and no longer than 366 days.", "invalid_labeled_data_window");
  }
  const result = await dbPool.query(
    `SELECT r.receipt_id,r.receipt_hash,r.external_reference_hash,r.provider,
            r.evaluator_name,r.evaluator_version,r.check_name,r.automated_outcome,
            r.score_bps,r.threshold_bps,r.content_commitment,r.observed_at,
            e.opportunity_id,h.outcome,h.result_commitment,h.response_count,h.result_observed_at
     FROM tokenless_assurance_automated_eval_receipts r
     JOIN tokenless_assurance_automated_eval_escalations e
       ON e.workspace_id=r.workspace_id AND e.receipt_id=r.receipt_id
     JOIN tokenless_agent_human_review_result_observations h
       ON h.workspace_id=e.workspace_id AND h.opportunity_id=e.opportunity_id
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id=h.workspace_id AND o.opportunity_id=h.opportunity_id
     JOIN tokenless_agent_review_request_profiles rp
       ON rp.workspace_id=o.workspace_id
      AND rp.profile_id=o.request_profile_id AND rp.version=o.request_profile_version
      AND rp.profile_hash=o.request_profile_hash
     WHERE r.workspace_id=$1 AND h.result_observed_at >= $2 AND h.result_observed_at < $3
       AND rp.result_semantics='assurance'
       AND h.outcome IN ('positive','negative')
     ORDER BY h.result_observed_at,e.opportunity_id
     LIMIT $4`,
    [input.principal.workspaceId, from, to, MAX_LABELED_DATA_ROWS + 1],
  );
  const truncated = result.rows.length > MAX_LABELED_DATA_ROWS;
  const items = result.rows.slice(0, MAX_LABELED_DATA_ROWS).map(
    (row): AutomatedEvalLabeledDataItem => ({
      receiptId: text(row, "receipt_id")!,
      receiptHash: text(row, "receipt_hash")!,
      externalReferenceHash: text(row, "external_reference_hash")!,
      provider: provider(row.provider),
      evaluator: { name: text(row, "evaluator_name")!, version: text(row, "evaluator_version")! },
      checkName: text(row, "check_name")!,
      automatedOutcome: "uncertain",
      automatedScoreBps: optionalInteger(row, "score_bps"),
      automatedThresholdBps: optionalInteger(row, "threshold_bps"),
      contentCommitment: text(row, "content_commitment")!,
      opportunityId: text(row, "opportunity_id")!,
      humanLabel: text(row, "outcome") as "positive" | "negative",
      humanResultCommitment: text(row, "result_commitment")!,
      responseCount: optionalInteger(row, "response_count")!,
      observedAt: rowDate(row, "observed_at"),
      labeledAt: rowDate(row, "result_observed_at"),
    }),
  );
  const body = {
    schemaVersion: AUTOMATED_EVAL_LABELED_DATA_SCHEMA_VERSION,
    workspaceId: input.principal.workspaceId,
    window: { from: from.toISOString(), to: to.toISOString(), semantics: "[from,to)" as const },
    privacy: {
      contentMode: "commitments_only" as const,
      reviewerIdentitiesIncluded: false,
      rawInputsIncluded: false,
      rawOutputsIncluded: false,
    },
    truncated,
    items,
  };
  const exported = { ...body, exportDigest: sha256(body) };
  await appendAuditEvent({
    workspaceId: input.principal.workspaceId,
    actorKind: "api_key",
    actorReference: input.principal.apiKeyId,
    assuranceMethod: "workspace_api_key",
    action: "automated_eval.labeled_data_exported",
    targetKind: "automated_eval_labeled_data",
    targetId: exported.exportDigest,
    purpose: "automated_evaluator_calibration",
    reason: "authorized_labeled_data_export",
    result: "success",
    metadata: {
      exportDigest: exported.exportDigest,
      fromInclusive: exported.window.from,
      toExclusive: exported.window.to,
      itemCount: exported.items.length,
      truncated: exported.truncated,
    },
    occurredAt: now,
  });
  return exported;
}

export const __automatedEvalReceiptTestUtils = { canonicalJson, sha256 };

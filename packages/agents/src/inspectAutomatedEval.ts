import { createHash } from "node:crypto";
import type {
  AutomatedEvalClient,
  AutomatedEvalOutcome,
  AutomatedEvalReceipt,
  AutomatedEvalReviewContext,
} from "./automatedEval";

type JsonRecord = Record<string, unknown>;
const MAX_INSPECT_SAMPLES_PER_BATCH = 500;

export type InspectRateLoopMetadata = {
  agentId: string;
  agentVersionId: string;
  contentCommitment: string;
  observedAt: string;
  evaluatorVersion: string;
  automatedOutcome?: AutomatedEvalOutcome;
  reviewContext?: AutomatedEvalReviewContext;
};

export type InspectAdapterOptions = {
  scorer: string;
  thresholdBps?: number | null;
  classify?: (value: unknown, sample: JsonRecord) => AutomatedEvalOutcome;
};

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object.`);
  return value as JsonRecord;
}

function defaultClassify(value: unknown): AutomatedEvalOutcome {
  if (value === true || value === 1 || value === "P" || value === "pass")
    return "pass";
  if (value === false || value === 0 || value === "F" || value === "fail")
    return "fail";
  return "uncertain";
}

function optionalScoreBps(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return Math.round(value * 10_000);
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000
    ? value
    : null;
}

function stableReceiptId(evalId: unknown, sampleId: unknown, scorer: string) {
  const digest = createHash("sha256")
    .update(`${String(evalId)}\0${String(sampleId)}\0${scorer}`)
    .digest("hex");
  return `inspect_${digest.slice(0, 40)}`;
}

/**
 * Converts an `inspect log dump` JSON object into commitment-only RateLoop
 * receipts. Sample input, output, target, explanation, and messages are never read.
 */
export function adaptInspectEvalLog(
  logValue: unknown,
  options: InspectAdapterOptions,
): AutomatedEvalReceipt[] {
  const log = record(logValue, "Inspect eval log");
  const evaluation = record(log.eval, "Inspect eval log.eval");
  const evalId = evaluation.eval_id ?? evaluation.evalId;
  if (
    (typeof evalId !== "string" && typeof evalId !== "number") ||
    !Array.isArray(log.samples)
  ) {
    throw new Error("Inspect eval log must contain eval.eval_id and samples.");
  }
  if (log.samples.length > MAX_INSPECT_SAMPLES_PER_BATCH) {
    throw new Error(
      `Inspect eval-log batch exceeds ${MAX_INSPECT_SAMPLES_PER_BATCH} samples.`,
    );
  }
  return log.samples.map((sampleValue, index) => {
    const sample = record(sampleValue, `Inspect sample ${index}`);
    const scores = record(sample.scores, `Inspect sample ${index}.scores`);
    const score = record(
      scores[options.scorer],
      `Inspect sample ${index}.scores.${options.scorer}`,
    );
    const metadata = record(
      sample.metadata,
      `Inspect sample ${index}.metadata`,
    );
    const rateloop = record(
      metadata.rateloop,
      `Inspect sample ${index}.metadata.rateloop`,
    ) as InspectRateLoopMetadata;
    const automatedOutcome =
      rateloop.automatedOutcome ??
      (options.classify ?? defaultClassify)(score.value, sample);
    if (automatedOutcome === "uncertain" && !rateloop.reviewContext) {
      throw new Error(
        `Inspect sample ${index} is uncertain but has no RateLoop reviewContext.`,
      );
    }
    if (automatedOutcome !== "uncertain" && rateloop.reviewContext) {
      throw new Error(
        `Inspect sample ${index} is conclusive but includes a RateLoop reviewContext.`,
      );
    }
    return {
      schemaVersion: "rateloop.automated-eval-receipt.v1",
      provider: "inspect",
      externalReceiptId: stableReceiptId(
        evalId,
        sample.id ?? sample.uuid ?? index,
        options.scorer,
      ),
      agentId: rateloop.agentId,
      agentVersionId: rateloop.agentVersionId,
      evaluator: { name: options.scorer, version: rateloop.evaluatorVersion },
      evaluation: {
        checkName: options.scorer,
        outcome: automatedOutcome,
        scoreBps: optionalScoreBps(score.value),
        thresholdBps: options.thresholdBps ?? null,
      },
      contentCommitment: rateloop.contentCommitment,
      observedAt: rateloop.observedAt,
      ...(rateloop.reviewContext
        ? { reviewContext: rateloop.reviewContext }
        : {}),
    };
  });
}

export async function ingestInspectEvalLog(
  client: AutomatedEvalClient,
  log: unknown,
  options: InspectAdapterOptions,
) {
  const receipts = adaptInspectEvalLog(log, options);
  const results = [];
  for (const receipt of receipts) {
    results.push(
      await client.ingest(receipt, {
        idempotencyKey: `inspect:${createHash("sha256")
          .update(
            `${receipt.externalReceiptId}\0${receipt.evaluation.checkName}`,
          )
          .digest("hex")}`,
      }),
    );
  }
  return results;
}

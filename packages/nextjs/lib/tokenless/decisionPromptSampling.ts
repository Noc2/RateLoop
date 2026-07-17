import { createHmac } from "node:crypto";
import "server-only";

/**
 * Deterministic "explain this decision" sampling — the anti-rubber-stamping
 * prompt. A low, deterministic share of runs requires written reasons even for
 * an accepting decision (`go`), using the same HMAC-bucket construction as
 * adaptive review sampling so the selection is reproducible and cannot be
 * re-rolled by retrying.
 */
export const DEFAULT_DECISION_EXPLANATION_RATE_BPS = 500;

const SAMPLING_DOMAIN = "rateloop-decision-explanation-v1";

function samplerKey(key?: string) {
  const configured = key ?? process.env.TOKENLESS_DECISION_EXPLANATION_SAMPLER_KEY?.trim();
  // The fallback keeps sampling deterministic without configuration; a
  // configured key additionally makes the bucket unpredictable to deciders.
  return configured || SAMPLING_DOMAIN;
}

function configuredRateBps(rateBps?: number) {
  const raw = rateBps ?? Number(process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS ?? NaN);
  if (Number.isSafeInteger(raw) && raw >= 0 && raw <= 10_000) return raw;
  return DEFAULT_DECISION_EXPLANATION_RATE_BPS;
}

export function decisionExplanationBucket(runId: string, key?: string) {
  if (!runId.trim()) throw new Error("Decision explanation sampling requires a run ID.");
  const digest = createHmac("sha256", samplerKey(key)).update(`${SAMPLING_DOMAIN}:${runId}`).digest("hex");
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % 10_000n);
}

export function decisionExplanationRequired(runId: string, options: { rateBps?: number; key?: string } = {}) {
  return decisionExplanationBucket(runId, options.key) < configuredRateBps(options.rateBps);
}

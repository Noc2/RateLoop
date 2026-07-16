import { createHmac } from "node:crypto";
import "server-only";

export const FIXED_REVIEW_SAMPLER_DOMAIN = "rateloop-fixed-sample-v1";

export type FixedReviewPolicy = {
  policyVersion: number;
  fixedRateBps: number;
  maximumUnreviewedGap: number;
};

export type FixedReviewState = {
  unreviewedSinceLastSample: number;
};

function assertValidPolicy(policy: FixedReviewPolicy) {
  if (
    !Number.isSafeInteger(policy.policyVersion) ||
    policy.policyVersion < 1 ||
    !Number.isSafeInteger(policy.fixedRateBps) ||
    policy.fixedRateBps < 1 ||
    policy.fixedRateBps > 10_000 ||
    !Number.isSafeInteger(policy.maximumUnreviewedGap) ||
    policy.maximumUnreviewedGap < 1
  ) {
    throw new Error("Fixed review policy is invalid.");
  }
}

export function decideFixedReview(input: {
  samplerKey: Buffer;
  samplerKeyVersion: string;
  opportunityId: string;
  scopeId: string;
  policy: FixedReviewPolicy;
  state: FixedReviewState;
  criticalRisk: boolean;
  metadataComplete: boolean;
  confidenceBelowMinimum: boolean;
}) {
  assertValidPolicy(input.policy);
  if (input.samplerKey.length < 32) throw new Error("The fixed sampler key must contain at least 32 bytes.");
  if (!input.opportunityId || !input.scopeId || !input.samplerKeyVersion) {
    throw new Error("Fixed review identity is incomplete.");
  }

  const manifest = [
    FIXED_REVIEW_SAMPLER_DOMAIN,
    input.samplerKeyVersion,
    String(input.policy.policyVersion),
    input.scopeId,
    input.opportunityId,
  ].join(":");
  const digest = createHmac("sha256", input.samplerKey).update(manifest).digest("hex");
  const bucket = Number(BigInt(`0x${digest.slice(0, 16)}`) % 10_000n);
  const sampled = bucket < input.policy.fixedRateBps;
  const forcedReasons: string[] = [];
  if (input.criticalRisk) forcedReasons.push("critical_risk");
  if (!input.metadataComplete) forcedReasons.push("missing_metadata");
  if (input.confidenceBelowMinimum) forcedReasons.push("low_confidence");
  if (input.state.unreviewedSinceLastSample >= input.policy.maximumUnreviewedGap) {
    forcedReasons.push("maximum_gap");
  }
  const forced = forcedReasons.length > 0;

  return {
    required: forced || sampled,
    reviewRateBps: input.policy.fixedRateBps,
    selectionProbabilityBps: forced ? 10_000 : input.policy.fixedRateBps,
    sampleBucket: bucket,
    samplerCommitment: digest,
    reasonCodes: forcedReasons.length > 0 ? forcedReasons : [sampled ? "sampled" : "not_sampled"],
  };
}

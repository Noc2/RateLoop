import { createHmac } from "node:crypto";
import "server-only";
import { wilsonIntervalBps } from "~~/lib/tokenless/transparency";

export const ADAPTIVE_REVIEW_STAGES = ["calibrating", "high_coverage", "medium_coverage", "monitoring"] as const;
export type AdaptiveReviewStage = (typeof ADAPTIVE_REVIEW_STAGES)[number];

export type AdaptiveReviewPolicy = {
  policyVersion: number;
  agreementThresholdBps: number;
  productionFloorBps: number;
  maximumUnreviewedGap: number;
};

export type AdaptiveObservationWindow = {
  comparable: number;
  agreements: number;
  completionGatePassed: boolean;
  humanAgreementGatePassed: boolean;
  latencyGatePassed: boolean;
  driftGatePassed: boolean;
  severeDisagreementOpen: boolean;
};

export type AdaptiveScopeState = {
  stage: AdaptiveReviewStage;
  completedComparableCases: number;
  stableCasesSinceStage: number;
  unreviewedSinceLastSample: number;
};

export const ADAPTIVE_REVIEW_STAGE_RATE_BPS: Record<AdaptiveReviewStage, number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: 1_000,
};

function validBps(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
}

function assertValidPolicy(policy: AdaptiveReviewPolicy) {
  if (
    !Number.isSafeInteger(policy.policyVersion) ||
    policy.policyVersion < 1 ||
    !validBps(policy.agreementThresholdBps) ||
    !validBps(policy.productionFloorBps) ||
    !Number.isSafeInteger(policy.maximumUnreviewedGap) ||
    policy.maximumUnreviewedGap < 1
  ) {
    throw new Error("Adaptive review policy is invalid.");
  }
}

function windowPasses(window: AdaptiveObservationWindow, thresholdBps: number, minimumSize: number) {
  if (
    !Number.isSafeInteger(window.comparable) ||
    !Number.isSafeInteger(window.agreements) ||
    window.comparable < minimumSize ||
    window.agreements < 0 ||
    window.agreements > window.comparable
  ) {
    return false;
  }
  const interval = wilsonIntervalBps(window.agreements, window.comparable);
  return (
    interval.lower >= thresholdBps &&
    window.completionGatePassed &&
    window.humanAgreementGatePassed &&
    window.latencyGatePassed &&
    window.driftGatePassed &&
    !window.severeDisagreementOpen
  );
}

function windowResetReason(window: AdaptiveObservationWindow, thresholdBps: number, minimumSize: number) {
  if (
    !Number.isSafeInteger(window.comparable) ||
    !Number.isSafeInteger(window.agreements) ||
    window.comparable < minimumSize ||
    window.agreements < 0 ||
    window.agreements > window.comparable
  ) {
    return null;
  }
  if (!window.completionGatePassed) return "completion_gate_failed";
  if (!window.humanAgreementGatePassed) return "human_agreement_gate_failed";
  if (!window.latencyGatePassed) return "latency_gate_failed";
  if (!window.driftGatePassed) return "drift_gate_failed";
  if (window.severeDisagreementOpen) return "severe_disagreement_open";
  const observedAgreementBps = Math.floor((window.agreements * 10_000) / window.comparable);
  return observedAgreementBps < thresholdBps ? "agreement_below_threshold" : null;
}

export function nextAdaptiveStage(input: {
  policy: AdaptiveReviewPolicy;
  state: AdaptiveScopeState;
  latestWindow: AdaptiveObservationWindow;
  previousWindow?: AdaptiveObservationWindow;
  resetReason?: string | null;
}) {
  const { policy, state } = input;
  assertValidPolicy(policy);
  if (input.resetReason) {
    return { stage: "calibrating" as const, reviewRateBps: 10_000, reason: input.resetReason };
  }
  const evidenceResetReason = windowResetReason(input.latestWindow, policy.agreementThresholdBps, 15);
  if (state.stage !== "calibrating" && evidenceResetReason) {
    return { stage: "calibrating" as const, reviewRateBps: 10_000, reason: evidenceResetReason };
  }
  const latestPasses = windowPasses(input.latestWindow, policy.agreementThresholdBps, 15);
  if (state.stage === "calibrating") {
    const priorPasses = input.previousWindow
      ? windowPasses(input.previousWindow, policy.agreementThresholdBps, 15)
      : false;
    if (state.completedComparableCases >= 30 && latestPasses && priorPasses) {
      return { stage: "high_coverage" as const, reviewRateBps: 5_000, reason: "two_stable_windows" };
    }
  } else if (state.stage === "high_coverage" && state.stableCasesSinceStage >= 50 && latestPasses) {
    return { stage: "medium_coverage" as const, reviewRateBps: 2_500, reason: "fifty_stable_cases" };
  } else if (state.stage === "medium_coverage" && state.stableCasesSinceStage >= 100 && latestPasses) {
    return {
      stage: "monitoring" as const,
      reviewRateBps: Math.max(1_000, policy.productionFloorBps),
      reason: "one_hundred_stable_cases",
    };
  }
  return {
    stage: state.stage,
    reviewRateBps: Math.max(ADAPTIVE_REVIEW_STAGE_RATE_BPS[state.stage], policy.productionFloorBps),
    reason: latestPasses ? "evidence_window_incomplete" : "quality_gate_not_met",
  };
}

export function decideAdaptiveReview(input: {
  samplerKey: Buffer;
  samplerKeyVersion: string;
  opportunityId: string;
  scopeId: string;
  policy: AdaptiveReviewPolicy;
  state: AdaptiveScopeState;
  criticalRisk: boolean;
  metadataComplete: boolean;
  policyResetPending?: boolean;
}) {
  assertValidPolicy(input.policy);
  if (input.samplerKey.length < 32) throw new Error("The adaptive sampler key must contain at least 32 bytes.");
  if (!input.opportunityId || !input.scopeId || !input.samplerKeyVersion) {
    throw new Error("Adaptive review identity is incomplete.");
  }
  const baseRate = Math.max(ADAPTIVE_REVIEW_STAGE_RATE_BPS[input.state.stage], input.policy.productionFloorBps);
  const forcedReasons: string[] = [];
  if (input.criticalRisk) forcedReasons.push("critical_risk");
  if (!input.metadataComplete) forcedReasons.push("missing_metadata");
  if (input.policyResetPending) forcedReasons.push("policy_reset");
  if (input.state.unreviewedSinceLastSample >= input.policy.maximumUnreviewedGap) {
    forcedReasons.push("maximum_gap");
  }
  if (input.state.stage === "calibrating") forcedReasons.push("calibrating");

  const manifest = [
    "rateloop-adaptive-sample-v1",
    input.samplerKeyVersion,
    String(input.policy.policyVersion),
    input.scopeId,
    input.opportunityId,
  ].join(":");
  const digest = createHmac("sha256", input.samplerKey).update(manifest).digest("hex");
  const bucket = Number(BigInt(`0x${digest.slice(0, 16)}`) % 10_000n);
  const sampled = bucket < baseRate;
  return {
    required: forcedReasons.length > 0 || sampled,
    reviewRateBps: baseRate,
    sampleBucket: bucket,
    samplerCommitment: digest,
    reasonCodes: forcedReasons.length > 0 ? forcedReasons : [sampled ? "sampled" : "not_sampled"],
  };
}

import { createHash } from "node:crypto";
import "server-only";

export const SURPRISE_BOUNTY_VERSION = "tokenless-sp-bounty-v1" as const;
export const DEFAULT_SURPRISE_MINIMUM_SAMPLE = 10;
export const DEFAULT_SURPRISE_THRESHOLD_BPS = 500;
export const DEFAULT_SURPRISE_SATURATION_BPS = 2_500;
export const SURPRISE_BOUNTY_MAXIMUM_OF_BASE_BPS = 1_250;

const BPS = 10_000;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export function maximumSurpriseBonusForBase(guaranteedBaseAtomic: bigint) {
  if (guaranteedBaseAtomic <= 0n) throw new Error("Guaranteed base must be positive.");
  return (guaranteedBaseAtomic * BigInt(SURPRISE_BOUNTY_MAXIMUM_OF_BASE_BPS)) / BigInt(BPS);
}

export type SurpriseBountyReport = {
  commitKey: `0x${string}`;
  vote: 0 | 1;
  predictedUpBps: number;
};

export type SurpriseBountyPolicy = {
  guaranteedBasePerReportAtomic: bigint;
  maximumBonusPerReportAtomic: bigint;
  minimumSampleSize?: number;
  qualificationThresholdBps?: number;
  saturationMarginBps?: number;
};

export type SurpriseBountyAllocation = {
  commitKey: `0x${string}`;
  vote: 0 | 1;
  leaveOneOutActualSideBps: number;
  leaveOneOutPredictedSideBps: number;
  leaveOneOutSurpriseMarginBps: number;
  surpriseScoreBps: number;
  bonusAtomic: string;
};

export type SurpriseBountyRound = {
  version: typeof SURPRISE_BOUNTY_VERSION;
  effect: "centralized_bonus";
  verdictEffect: "none";
  state: "insufficient_sample" | "no_qualifying_outcome" | "allocated";
  sampleSize: number;
  minimumSampleSize: number;
  qualificationThresholdBps: number;
  saturationMarginBps: number;
  guaranteedBasePerReportAtomic: string;
  maximumBonusPerReportAtomic: string;
  maximumRoundLiabilityAtomic: string;
  upVotes: number;
  actualUpBps: number | null;
  meanPredictedUpBps: number | null;
  surpriseMarginUpBps: number | null;
  majorityOutcome: "up" | "down" | "tie" | null;
  surprisinglyPopularOutcome: "up" | "down" | "tie" | null;
  differsFromMajority: boolean | null;
  totalBonusAtomic: string;
  allocations: SurpriseBountyAllocation[];
  limitationCodes: string[];
  allocationHash: `sha256:${string}`;
  evidenceHash: `sha256:${string}`;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Surprise-bounty evidence must be JSON serializable.");
  return encoded;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}` as const;
}

function integer(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return resolved;
}

function validateAndSort(reports: SurpriseBountyReport[]) {
  if (!Array.isArray(reports) || reports.length > 500) {
    throw new Error("Surprise bounties accept at most 500 reports.");
  }
  const normalized = reports.map(report => {
    if (
      !BYTES32.test(report.commitKey) ||
      (report.vote !== 0 && report.vote !== 1) ||
      !Number.isSafeInteger(report.predictedUpBps) ||
      report.predictedUpBps < 100 ||
      report.predictedUpBps > 9_900 ||
      report.predictedUpBps % 100 !== 0
    ) {
      throw new Error(
        "Surprise-bounty reports require a bytes32 commit key, binary vote, and frozen one-percent prediction grid.",
      );
    }
    return { ...report, commitKey: report.commitKey.toLowerCase() as `0x${string}` };
  });
  normalized.sort((left, right) => left.commitKey.localeCompare(right.commitKey));
  if (new Set(normalized.map(report => report.commitKey)).size !== normalized.length) {
    throw new Error("Surprise-bounty commit keys must be unique within a round.");
  }
  return normalized;
}

function majority(upVotes: number, sampleSize: number): "up" | "down" | "tie" {
  const doubled = upVotes * 2;
  return doubled === sampleSize ? "tie" : doubled > sampleSize ? "up" : "down";
}

function emptyRound(input: {
  reports: SurpriseBountyReport[];
  minimumSampleSize: number;
  qualificationThresholdBps: number;
  saturationMarginBps: number;
  guaranteedBasePerReportAtomic: bigint;
  maximumBonusPerReportAtomic: bigint;
}): SurpriseBountyRound {
  const base = {
    version: SURPRISE_BOUNTY_VERSION,
    effect: "centralized_bonus" as const,
    verdictEffect: "none" as const,
    state: "insufficient_sample" as const,
    sampleSize: input.reports.length,
    minimumSampleSize: input.minimumSampleSize,
    qualificationThresholdBps: input.qualificationThresholdBps,
    saturationMarginBps: input.saturationMarginBps,
    guaranteedBasePerReportAtomic: input.guaranteedBasePerReportAtomic.toString(),
    maximumBonusPerReportAtomic: input.maximumBonusPerReportAtomic.toString(),
    maximumRoundLiabilityAtomic: (input.maximumBonusPerReportAtomic * BigInt(input.reports.length)).toString(),
    upVotes: input.reports.reduce((sum, report) => sum + report.vote, 0),
    actualUpBps: null,
    meanPredictedUpBps: null,
    surpriseMarginUpBps: null,
    majorityOutcome: null,
    surprisinglyPopularOutcome: null,
    differsFromMajority: null,
    totalBonusAtomic: "0",
    allocations: [] as SurpriseBountyAllocation[],
    limitationCodes: ["minimum_sample_not_met", "centralized_platform_liability", "not_a_truth_oracle"],
    allocationHash: hash([]),
  };
  return { ...base, evidenceHash: hash(base) };
}

/**
 * Computes the versioned centralized Surprisingly Popular top-up.
 *
 * The raw majority remains the verdict input. Eligible reports receive an
 * independently funded, non-negative top-up; no report can lose base or RBTS
 * earnings and one rater's top-up never comes from another rater's allocation.
 */
export function computeSurpriseBountyRound(
  reportsInput: SurpriseBountyReport[],
  policy: SurpriseBountyPolicy,
): SurpriseBountyRound {
  const reports = validateAndSort(reportsInput);
  const minimumSampleSize = integer(
    policy.minimumSampleSize,
    DEFAULT_SURPRISE_MINIMUM_SAMPLE,
    3,
    500,
    "Surprise minimum sample size",
  );
  const qualificationThresholdBps = integer(
    policy.qualificationThresholdBps,
    DEFAULT_SURPRISE_THRESHOLD_BPS,
    1,
    5_000,
    "Surprise qualification threshold",
  );
  const saturationMarginBps = integer(
    policy.saturationMarginBps,
    DEFAULT_SURPRISE_SATURATION_BPS,
    qualificationThresholdBps,
    10_000,
    "Surprise saturation margin",
  );
  if (policy.guaranteedBasePerReportAtomic <= 0n) {
    throw new Error("Guaranteed base per report must be positive.");
  }
  if (
    policy.maximumBonusPerReportAtomic <= 0n ||
    policy.maximumBonusPerReportAtomic > policy.guaranteedBasePerReportAtomic
  ) {
    throw new Error("Maximum surprise bonus must be positive and no greater than the guaranteed base.");
  }
  const shared = {
    reports,
    minimumSampleSize,
    qualificationThresholdBps,
    saturationMarginBps,
    guaranteedBasePerReportAtomic: policy.guaranteedBasePerReportAtomic,
    maximumBonusPerReportAtomic: policy.maximumBonusPerReportAtomic,
  };
  if (reports.length < minimumSampleSize) return emptyRound(shared);

  const upVotes = reports.reduce((sum, report) => sum + report.vote, 0);
  const predictionSum = reports.reduce((sum, report) => sum + report.predictedUpBps, 0);
  const actualUpBps = Math.floor((upVotes * BPS) / reports.length);
  const meanPredictedUpBps = Math.floor(predictionSum / reports.length);
  const surpriseMarginUpBps = actualUpBps - meanPredictedUpBps;
  const majorityOutcome = majority(upVotes, reports.length);
  const unanimousPanel = upVotes === 0 || upVotes === reports.length;
  const surprisinglyPopularOutcome =
    Math.abs(surpriseMarginUpBps) < qualificationThresholdBps
      ? ("tie" as const)
      : surpriseMarginUpBps > 0
        ? ("up" as const)
        : ("down" as const);

  const allocations = reports.map(report => {
    const peerCount = reports.length - 1;
    const peerUpVotes = upVotes - report.vote;
    const peerPredictionSum = predictionSum - report.predictedUpBps;
    const leaveOneOutActualUpBps = Math.floor((peerUpVotes * BPS) / peerCount);
    const leaveOneOutPredictedUpBps = Math.floor(peerPredictionSum / peerCount);
    const leaveOneOutActualSideBps = report.vote === 1 ? leaveOneOutActualUpBps : BPS - leaveOneOutActualUpBps;
    const leaveOneOutPredictedSideBps = report.vote === 1 ? leaveOneOutPredictedUpBps : BPS - leaveOneOutPredictedUpBps;
    const leaveOneOutSurpriseMarginBps = leaveOneOutActualSideBps - leaveOneOutPredictedSideBps;
    const selectedOutcome = report.vote === 1 ? "up" : "down";
    const qualifies =
      !unanimousPanel &&
      selectedOutcome === surprisinglyPopularOutcome &&
      leaveOneOutSurpriseMarginBps >= qualificationThresholdBps;
    const surpriseScoreBps = qualifies
      ? Math.min(BPS, Math.floor((leaveOneOutSurpriseMarginBps * BPS) / saturationMarginBps))
      : 0;
    const bonusAtomic = (policy.maximumBonusPerReportAtomic * BigInt(surpriseScoreBps)) / BigInt(BPS);
    return {
      commitKey: report.commitKey,
      vote: report.vote,
      leaveOneOutActualSideBps,
      leaveOneOutPredictedSideBps,
      leaveOneOutSurpriseMarginBps,
      surpriseScoreBps,
      bonusAtomic: bonusAtomic.toString(),
    };
  });
  const totalBonusAtomic = allocations.reduce((sum, allocation) => sum + BigInt(allocation.bonusAtomic), 0n);
  const maximumRoundLiabilityAtomic = policy.maximumBonusPerReportAtomic * BigInt(reports.length);
  if (totalBonusAtomic > maximumRoundLiabilityAtomic) {
    throw new Error("Surprise-bounty allocation exceeds its frozen round liability.");
  }
  const allocationHash = hash(allocations);
  const state = totalBonusAtomic > 0n ? ("allocated" as const) : ("no_qualifying_outcome" as const);
  const base = {
    version: SURPRISE_BOUNTY_VERSION,
    effect: "centralized_bonus" as const,
    verdictEffect: "none" as const,
    state,
    sampleSize: reports.length,
    minimumSampleSize,
    qualificationThresholdBps,
    saturationMarginBps,
    guaranteedBasePerReportAtomic: policy.guaranteedBasePerReportAtomic.toString(),
    maximumBonusPerReportAtomic: policy.maximumBonusPerReportAtomic.toString(),
    maximumRoundLiabilityAtomic: maximumRoundLiabilityAtomic.toString(),
    upVotes,
    actualUpBps,
    meanPredictedUpBps,
    surpriseMarginUpBps,
    majorityOutcome,
    surprisinglyPopularOutcome,
    differsFromMajority: surprisinglyPopularOutcome === "tie" ? false : majorityOutcome !== surprisinglyPopularOutcome,
    totalBonusAtomic: totalBonusAtomic.toString(),
    allocations,
    limitationCodes: [
      ...(unanimousPanel ? ["unanimous_panel_no_bonus"] : []),
      "centralized_platform_liability",
      "binary_panel_only",
      "not_a_truth_oracle",
    ],
    allocationHash,
  };
  return { ...base, evidenceHash: hash(base) };
}

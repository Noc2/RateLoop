export const CROWD_FORECAST_INTEGRITY_VERSION = "rateloop.crowd-forecast-integrity.v1" as const;
const BPS = 10_000n;
const BPS_SQUARED = BPS * BPS;

export type ForecastCalibrationAccumulator = {
  observationCount: bigint;
  forecastSumBps: bigint;
  forecastSquareSum: bigint;
  squaredErrorSum: bigint;
  outcomePositiveCount: bigint;
  positiveOutcomeForecastSumBps: bigint;
  positiveOutcomeCount: bigint;
  negativeOutcomeForecastSumBps: bigint;
  negativeOutcomeCount: bigint;
  positiveVoteForecastSumBps: bigint;
  positiveVoteCount: bigint;
  negativeVoteForecastSumBps: bigint;
  negativeVoteCount: bigint;
};

export type ForecastPairAccumulator = {
  observationCount: bigint;
  exactMatchCount: bigint;
  expectedExactMatchBpsSum: bigint;
  distanceSumBps: bigint;
  distanceSquareSum: bigint;
};

export type ForecastIntegrityEvaluation = {
  schemaVersion: typeof CROWD_FORECAST_INTEGRITY_VERSION;
  observationCount: number;
  brierSkillScoreBps: number | null;
  forecastVarianceBpsSquared: number;
  outcomeDiscriminationBps: number | null;
  voteDiscriminationBps: number | null;
  reasonCodes: Array<"forecast_invariant" | "forecast_discrimination_absent" | "forecast_vote_decoupled">;
  softReasonCodes: Array<"forecast_vote_decoupled">;
  limitationCodes: [];
};

export type ForecastPairEvaluation = {
  schemaVersion: typeof CROWD_FORECAST_INTEGRITY_VERSION;
  observationCount: number;
  expectedExactMatchBps: number;
  observedExactMatchBps: number;
  distanceVarianceBpsSquared: number;
  reasonCodes: Array<"forecast_pair_lockstep">;
  limitationCodes: [];
};

export function emptyForecastCalibrationAccumulator(): ForecastCalibrationAccumulator {
  return {
    observationCount: 0n,
    forecastSumBps: 0n,
    forecastSquareSum: 0n,
    squaredErrorSum: 0n,
    outcomePositiveCount: 0n,
    positiveOutcomeForecastSumBps: 0n,
    positiveOutcomeCount: 0n,
    negativeOutcomeForecastSumBps: 0n,
    negativeOutcomeCount: 0n,
    positiveVoteForecastSumBps: 0n,
    positiveVoteCount: 0n,
    negativeVoteForecastSumBps: 0n,
    negativeVoteCount: 0n,
  };
}

export function emptyForecastPairAccumulator(): ForecastPairAccumulator {
  return {
    observationCount: 0n,
    exactMatchCount: 0n,
    expectedExactMatchBpsSum: 0n,
    distanceSumBps: 0n,
    distanceSquareSum: 0n,
  };
}

function forecast(value: number) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 9_900 || value % 100 !== 0) {
    throw new Error("Crowd forecast must use the one-percent grid from 1% to 99%.");
  }
  return BigInt(value);
}

function binary(value: number, label: string) {
  if (value !== 0 && value !== 1) throw new Error(`${label} must be binary.`);
  return BigInt(value);
}

function safeNumber(value: bigint, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe presentation range.`);
  return parsed;
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function meanDifference(leftSum: bigint, leftCount: bigint, rightSum: bigint, rightCount: bigint) {
  if (leftCount === 0n || rightCount === 0n) return null;
  return safeNumber(absolute(leftSum * rightCount - rightSum * leftCount) / (leftCount * rightCount), "Difference");
}

export function appendForecastCalibration(
  accumulator: ForecastCalibrationAccumulator,
  observation: { predictedPositiveBps: number; outcome: 0 | 1; vote: 0 | 1 },
): ForecastCalibrationAccumulator {
  const predicted = forecast(observation.predictedPositiveBps);
  const outcome = binary(observation.outcome, "Forecast outcome");
  const vote = binary(observation.vote, "Reviewer vote");
  const error = predicted - outcome * BPS;
  return {
    observationCount: accumulator.observationCount + 1n,
    forecastSumBps: accumulator.forecastSumBps + predicted,
    forecastSquareSum: accumulator.forecastSquareSum + predicted * predicted,
    squaredErrorSum: accumulator.squaredErrorSum + error * error,
    outcomePositiveCount: accumulator.outcomePositiveCount + outcome,
    positiveOutcomeForecastSumBps: accumulator.positiveOutcomeForecastSumBps + (outcome === 1n ? predicted : 0n),
    positiveOutcomeCount: accumulator.positiveOutcomeCount + outcome,
    negativeOutcomeForecastSumBps: accumulator.negativeOutcomeForecastSumBps + (outcome === 0n ? predicted : 0n),
    negativeOutcomeCount: accumulator.negativeOutcomeCount + (1n - outcome),
    positiveVoteForecastSumBps: accumulator.positiveVoteForecastSumBps + (vote === 1n ? predicted : 0n),
    positiveVoteCount: accumulator.positiveVoteCount + vote,
    negativeVoteForecastSumBps: accumulator.negativeVoteForecastSumBps + (vote === 0n ? predicted : 0n),
    negativeVoteCount: accumulator.negativeVoteCount + (1n - vote),
  };
}

export function evaluateForecastCalibration(accumulator: ForecastCalibrationAccumulator): ForecastIntegrityEvaluation {
  const n = accumulator.observationCount;
  if (n < 0n) throw new Error("Forecast observation count is invalid.");
  const variance =
    n === 0n
      ? 0n
      : (accumulator.forecastSquareSum * n - accumulator.forecastSumBps * accumulator.forecastSumBps) / (n * n);
  const outcomeDiscriminationBps = meanDifference(
    accumulator.positiveOutcomeForecastSumBps,
    accumulator.positiveOutcomeCount,
    accumulator.negativeOutcomeForecastSumBps,
    accumulator.negativeOutcomeCount,
  );
  const voteDiscriminationBps = meanDifference(
    accumulator.positiveVoteForecastSumBps,
    accumulator.positiveVoteCount,
    accumulator.negativeVoteForecastSumBps,
    accumulator.negativeVoteCount,
  );
  const positive = accumulator.outcomePositiveCount;
  const baselineSquaredError = n === 0n ? 0n : positive * BPS_SQUARED - (positive * BPS * (positive * BPS)) / n;
  const brierSkillScoreBps =
    baselineSquaredError === 0n
      ? null
      : safeNumber(
          ((baselineSquaredError - accumulator.squaredErrorSum) * BPS) / baselineSquaredError,
          "Brier skill score",
        );
  const reasonCodes: ForecastIntegrityEvaluation["reasonCodes"] = [];
  if (n >= 12n && variance <= 2_500n) reasonCodes.push("forecast_invariant");
  if (
    accumulator.positiveOutcomeCount >= 8n &&
    accumulator.negativeOutcomeCount >= 8n &&
    outcomeDiscriminationBps !== null &&
    outcomeDiscriminationBps < 500
  ) {
    reasonCodes.push("forecast_discrimination_absent");
  }
  if (
    accumulator.positiveVoteCount >= 8n &&
    accumulator.negativeVoteCount >= 8n &&
    voteDiscriminationBps !== null &&
    voteDiscriminationBps < 200
  ) {
    reasonCodes.push("forecast_vote_decoupled");
  }
  return {
    schemaVersion: CROWD_FORECAST_INTEGRITY_VERSION,
    observationCount: safeNumber(n, "Observation count"),
    brierSkillScoreBps,
    forecastVarianceBpsSquared: safeNumber(variance, "Forecast variance"),
    outcomeDiscriminationBps,
    voteDiscriminationBps,
    reasonCodes,
    softReasonCodes: reasonCodes.includes("forecast_vote_decoupled") ? ["forecast_vote_decoupled"] : [],
    limitationCodes: [],
  };
}

export function workspaceHistogramExpectedExactMatchBps(histogram: readonly bigint[]) {
  if (histogram.length !== 99 || histogram.some(count => count < 0n)) {
    throw new Error("Workspace forecast histogram must contain 99 non-negative buckets.");
  }
  const total = histogram.reduce((sum, count) => sum + count, 0n);
  if (total === 0n) return 101;
  const squared = histogram.reduce((sum, count) => sum + count * count, 0n);
  return safeNumber((squared * BPS) / (total * total), "Histogram collision probability");
}

export function appendForecastPair(
  accumulator: ForecastPairAccumulator,
  observation: { leftForecastBps: number; rightForecastBps: number; expectedExactMatchBps: number },
): ForecastPairAccumulator {
  const left = forecast(observation.leftForecastBps);
  const right = forecast(observation.rightForecastBps);
  if (
    !Number.isSafeInteger(observation.expectedExactMatchBps) ||
    observation.expectedExactMatchBps < 0 ||
    observation.expectedExactMatchBps > 10_000
  ) {
    throw new Error("Expected exact-match probability is invalid.");
  }
  const distance = absolute(left - right);
  return {
    observationCount: accumulator.observationCount + 1n,
    exactMatchCount: accumulator.exactMatchCount + (distance === 0n ? 1n : 0n),
    expectedExactMatchBpsSum: accumulator.expectedExactMatchBpsSum + BigInt(observation.expectedExactMatchBps),
    distanceSumBps: accumulator.distanceSumBps + distance,
    distanceSquareSum: accumulator.distanceSquareSum + distance * distance,
  };
}

export function evaluateForecastPair(accumulator: ForecastPairAccumulator): ForecastPairEvaluation {
  const n = accumulator.observationCount;
  const expected = n === 0n ? 0n : accumulator.expectedExactMatchBpsSum / n;
  const observed = n === 0n ? 0n : (accumulator.exactMatchCount * BPS) / n;
  const variance =
    n === 0n
      ? 0n
      : (accumulator.distanceSquareSum * n - accumulator.distanceSumBps * accumulator.distanceSumBps) / (n * n);
  const reasonCodes: ForecastPairEvaluation["reasonCodes"] = [];
  if (n >= 12n && observed >= expected + 3_000n && variance <= 10_000n) {
    reasonCodes.push("forecast_pair_lockstep");
  }
  return {
    schemaVersion: CROWD_FORECAST_INTEGRITY_VERSION,
    observationCount: safeNumber(n, "Pair observation count"),
    expectedExactMatchBps: safeNumber(expected, "Expected exact-match rate"),
    observedExactMatchBps: safeNumber(observed, "Observed exact-match rate"),
    distanceVarianceBpsSquared: safeNumber(variance, "Pair distance variance"),
    reasonCodes,
    limitationCodes: [],
  };
}

export function forecastConsequence(input: { reasonCodes: readonly string[]; hasOpenAppeal: boolean }) {
  const hardReasons = input.reasonCodes.filter(code => code !== "forecast_vote_decoupled");
  if (hardReasons.length === 0) return "none" as const;
  return input.hasOpenAppeal ? ("suspended_by_open_appeal" as const) : ("future_assignment_restriction" as const);
}

import { createHash } from "node:crypto";
import "server-only";

export const SURPRISE_SHADOW_VERSION = "tokenless-sp-shadow-v1" as const;
export const DEFAULT_SURPRISE_MINIMUM_SAMPLE = 10;

export type SurpriseShadowReport = {
  vote: 0 | 1;
  predictedUpBps: number;
};

export type SurpriseShadowDiagnostic = {
  version: typeof SURPRISE_SHADOW_VERSION;
  effect: "analytics_only";
  state: "available" | "insufficient_sample";
  sampleSize: number;
  minimumSampleSize: number;
  upVotes: number;
  actualUpBps: number | null;
  meanPredictedUpBps: number | null;
  surpriseMarginUpBps: number | null;
  majorityOutcome: "up" | "down" | "tie" | null;
  surprisinglyPopularOutcome: "up" | "down" | "tie" | null;
  differsFromMajority: boolean | null;
  limitationCodes: string[];
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
  if (encoded === undefined) throw new Error("Surprise diagnostics must be JSON serializable.");
  return encoded;
}

function hashDiagnostic(value: Omit<SurpriseShadowDiagnostic, "evidenceHash">) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}` as const;
}

function outcome(numerator: number, denominator: number): "up" | "down" | "tie" {
  const doubled = numerator * 2;
  return doubled === denominator ? "tie" : doubled > denominator ? "up" : "down";
}

function validateInput(reports: SurpriseShadowReport[], minimumSampleSize: number) {
  if (!Number.isSafeInteger(minimumSampleSize) || minimumSampleSize < 3 || minimumSampleSize > 500) {
    throw new Error("Surprise minimum sample size must be an integer from 3 to 500.");
  }
  if (!Array.isArray(reports) || reports.length > 500) {
    throw new Error("Surprise diagnostics accept at most 500 reports.");
  }
  for (const report of reports) {
    if (
      (report.vote !== 0 && report.vote !== 1) ||
      !Number.isSafeInteger(report.predictedUpBps) ||
      report.predictedUpBps < 100 ||
      report.predictedUpBps > 9_900 ||
      report.predictedUpBps % 100 !== 0
    ) {
      throw new Error("Surprise diagnostic reports must use a binary vote and the frozen one-percent prediction grid.");
    }
  }
}

export function computeSurpriseShadowDiagnostic(
  reports: SurpriseShadowReport[],
  minimumSampleSize = DEFAULT_SURPRISE_MINIMUM_SAMPLE,
): SurpriseShadowDiagnostic {
  validateInput(reports, minimumSampleSize);
  const upVotes = reports.reduce((total, report) => total + report.vote, 0);
  const base = {
    version: SURPRISE_SHADOW_VERSION,
    effect: "analytics_only" as const,
    sampleSize: reports.length,
    minimumSampleSize,
    upVotes,
  };
  if (reports.length < minimumSampleSize) {
    const diagnostic = {
      ...base,
      state: "insufficient_sample" as const,
      actualUpBps: null,
      meanPredictedUpBps: null,
      surpriseMarginUpBps: null,
      majorityOutcome: null,
      surprisinglyPopularOutcome: null,
      differsFromMajority: null,
      limitationCodes: ["minimum_sample_not_met", "shadow_only_not_validated"],
    };
    return { ...diagnostic, evidenceHash: hashDiagnostic(diagnostic) };
  }

  const predictionSum = reports.reduce((total, report) => total + report.predictedUpBps, 0);
  const actualUpBps = Math.floor((upVotes * 10_000) / reports.length);
  const meanPredictedUpBps = Math.floor(predictionSum / reports.length);
  const surpriseMarginUpBps = actualUpBps - meanPredictedUpBps;
  const majorityOutcome = outcome(upVotes, reports.length);
  const surprisinglyPopularOutcome: "up" | "down" | "tie" =
    surpriseMarginUpBps === 0 ? "tie" : surpriseMarginUpBps > 0 ? "up" : "down";
  const diagnostic = {
    ...base,
    state: "available" as const,
    actualUpBps,
    meanPredictedUpBps,
    surpriseMarginUpBps,
    majorityOutcome,
    surprisinglyPopularOutcome,
    differsFromMajority: majorityOutcome !== surprisinglyPopularOutcome,
    limitationCodes: ["binary_aggregate_only", "shadow_only_not_validated"],
  };
  return { ...diagnostic, evidenceHash: hashDiagnostic(diagnostic) };
}

export type PublicEvidenceSummary = {
  caseCount: number | null;
  generatedAt: string | null;
  outcome: "fail" | "insufficient" | "pass" | null;
  question: string | null;
  respondingReviewerCount: number | null;
  validJudgmentCount: number | null;
};

const SUPPORTED_SCHEMAS = new Set([
  "rateloop.human-assurance.evidence.v2",
  "rateloop.human-assurance.evidence.v3",
  "rateloop.human-assurance.evidence.v4",
]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function countValue(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000 ? Number(value) : null;
}

function questionValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= 500 ? normalized : null;
}

function generatedAtValue(value: unknown) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Projects only the small, decision-useful summary that a verified public
 * packet may show by default. IDs, rationales, owner notes, limitations, and
 * arbitrary manifest fields deliberately have no path into this value.
 */
export function publicEvidenceSummary(value: unknown): PublicEvidenceSummary | null {
  const packet = objectValue(value);
  const payload = objectValue(packet?.payload);
  if (!payload || typeof payload.schemaVersion !== "string" || !SUPPORTED_SCHEMAS.has(payload.schemaVersion)) {
    return null;
  }

  const frozen = objectValue(payload.frozen);
  const suiteManifest = objectValue(frozen?.suiteManifest);
  const rubric = objectValue(suiteManifest?.rubric);
  const aggregation = objectValue(payload.aggregation);
  const suite = objectValue(aggregation?.suite);
  const judgmentCoverage = objectValue(aggregation?.judgmentCoverage);
  const reviewerCoverage = objectValue(aggregation?.reviewerCoverage);
  const outcome = suite?.outcome;

  return {
    question: questionValue(rubric?.prompt),
    outcome: outcome === "pass" || outcome === "fail" || outcome === "insufficient" ? outcome : null,
    generatedAt: generatedAtValue(payload.generatedAt),
    caseCount: countValue(judgmentCoverage?.caseCount),
    respondingReviewerCount: countValue(reviewerCoverage?.respondingReviewerCount),
    validJudgmentCount: countValue(judgmentCoverage?.validJudgmentCount),
  };
}

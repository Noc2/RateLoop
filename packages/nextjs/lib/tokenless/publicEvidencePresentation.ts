export type PublicEvidenceSummary = {
  caseCount: number | null;
  generatedAt: string | null;
  limitations: PublicEvidenceLimitation[];
  outcome: "fail" | "insufficient" | "pass" | null;
  question: string | null;
  respondingReviewerCount: number | null;
  validJudgmentCount: number | null;
};

export type PublicEvidenceLimitation =
  | "chain_evidence_incomplete"
  | "incomplete_or_invalid_work"
  | "minimum_aggregation_not_met"
  | "no_onchain_settlement"
  | "small_source_cells_suppressed";

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

const PUBLIC_LIMITATIONS = new Set<PublicEvidenceLimitation>([
  "chain_evidence_incomplete",
  "incomplete_or_invalid_work",
  "minimum_aggregation_not_met",
  "no_onchain_settlement",
  "small_source_cells_suppressed",
]);

function limitationValues(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: PublicEvidenceLimitation[] = [];
  for (const entry of value.slice(0, 25)) {
    const code = objectValue(entry)?.code;
    if (typeof code === "string" && PUBLIC_LIMITATIONS.has(code as PublicEvidenceLimitation)) {
      result.push(code as PublicEvidenceLimitation);
    }
  }
  return [...new Set(result)].slice(0, 5);
}

/**
 * Projects only the small, decision-useful summary that a verified public
 * packet may show by default. IDs, rationales, owner notes, arbitrary
 * limitation messages, and manifest fields deliberately have no path into
 * this value. Known limitation codes map to fixed recipient copy in the UI.
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
    limitations: limitationValues(payload.limitations),
    caseCount: countValue(judgmentCoverage?.caseCount),
    respondingReviewerCount: countValue(reviewerCoverage?.respondingReviewerCount),
    validJudgmentCount: countValue(judgmentCoverage?.validJudgmentCount),
  };
}

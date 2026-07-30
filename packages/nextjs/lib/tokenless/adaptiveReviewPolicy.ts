export const ADAPTIVE_REVIEW_STAGES = ["calibrating", "high_coverage", "medium_coverage", "monitoring"] as const;
export type AdaptiveReviewStage = (typeof ADAPTIVE_REVIEW_STAGES)[number];

export const ADAPTIVE_MONITORING_FLOOR_BPS = 1_000;

export const ADAPTIVE_REVIEW_STAGE_RATE_BPS: Record<AdaptiveReviewStage, number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: ADAPTIVE_MONITORING_FLOOR_BPS,
};

export function adaptiveReviewRateBps(stage: AdaptiveReviewStage, productionFloorBps: number) {
  if (!Number.isSafeInteger(productionFloorBps) || productionFloorBps < 0 || productionFloorBps > 10_000) {
    throw new Error("Adaptive production floor must be an integer between 0 and 10000 basis points.");
  }
  return Math.max(ADAPTIVE_REVIEW_STAGE_RATE_BPS[stage], productionFloorBps);
}

ALTER TABLE "tokenless_agent_human_review_result_observations"
  ADD COLUMN "result_semantics" text;--> statement-breakpoint
UPDATE "tokenless_agent_human_review_result_observations"
SET "result_semantics" = 'assurance'
WHERE "result_semantics" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_human_review_result_observations"
  ALTER COLUMN "result_semantics" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_human_review_result_observations"
  DROP CONSTRAINT "tokenless_agent_human_review_result_observations_adaptive_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_human_review_result_observations"
  ADD CONSTRAINT "tokenless_agent_human_review_result_observations_semantics_check"
    CHECK ("result_semantics" IN ('assurance', 'feedback')),
  ADD CONSTRAINT "tokenless_agent_human_review_result_observations_adaptive_check" CHECK (
    (
      "result_semantics" = 'assurance'
      AND (
        (
          "outcome" IN ('positive', 'negative')
          AND "calibration_comparable" = true
          AND "adaptive_observation_id" IS NOT NULL
        )
        OR (
          "outcome" = 'inconclusive'
          AND "calibration_comparable" = false
          AND "adaptive_observation_id" IS NOT NULL
        )
        OR (
          "outcome" IN ('failed', 'cancelled')
          AND "calibration_comparable" = false
          AND "adaptive_observation_id" IS NULL
        )
      )
    )
    OR (
      "result_semantics" = 'feedback'
      AND "calibration_comparable" = false
      AND "adaptive_observation_id" IS NULL
    )
  );

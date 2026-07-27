ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  DROP CONSTRAINT "tokenless_private_unpaid_review_deliveries_result_check";--> statement-breakpoint

ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  ADD CONSTRAINT "tokenless_private_unpaid_review_deliveries_result_check" CHECK (
    (
      "result_envelope_json" IS NULL
      AND "result_commitment" IS NULL
      AND ("completed_at" IS NULL OR "status" IN ('completed','inconclusive','failed_terminal'))
    )
    OR (
      "status" IN ('completed','inconclusive','failed_terminal')
      AND "result_envelope_json" IS NOT NULL
      AND "result_commitment" ~ '^sha256:[0-9a-f]{64}$'
      AND "completed_at" IS NOT NULL
    )
    OR (
      "status" = 'failed_terminal'
      AND "result_envelope_json" IS NULL
      AND "result_commitment" IS NULL
      AND "completed_at" IS NOT NULL
    )
  );

ALTER TABLE "tokenless_private_review_responses"
  ADD COLUMN "predicted_positive_bps" integer,
  ADD CONSTRAINT "tokenless_private_review_responses_prediction_check" CHECK (
    "predicted_positive_bps" IS NULL
    OR (
      "predicted_positive_bps" BETWEEN 100 AND 9900
      AND "predicted_positive_bps" % 100 = 0
    )
  );

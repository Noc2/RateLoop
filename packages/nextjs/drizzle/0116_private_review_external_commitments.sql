ALTER TABLE "tokenless_private_review_requests"
  ADD COLUMN "external_source_evidence_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_private_review_requests"
  ADD COLUMN "external_suggestion_commitment" text;--> statement-breakpoint
ALTER TABLE "tokenless_private_review_requests"
  ADD CONSTRAINT "tokenless_private_review_requests_external_commitments_check" CHECK (
    (
      "external_source_evidence_hash" IS NULL
      AND "external_suggestion_commitment" IS NULL
    )
    OR (
      "external_source_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "external_suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
    )
  );

CREATE TABLE "tokenless_private_review_responses" (
  "response_id" text PRIMARY KEY NOT NULL,
  "assignment_id" text NOT NULL REFERENCES "tokenless_private_unpaid_review_assignments"("assignment_id") ON DELETE RESTRICT,
  "delivery_id" text NOT NULL REFERENCES "tokenless_private_unpaid_review_deliveries"("delivery_id") ON DELETE RESTRICT,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "private_review_id" text NOT NULL REFERENCES "tokenless_private_review_requests"("private_review_id") ON DELETE RESTRICT,
  "reviewer_key" text NOT NULL,
  "choice" text NOT NULL,
  "rationale_ciphertext" text,
  "rationale_key_ref" text,
  "rationale_digest" text,
  "response_commitment" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_review_responses_assignment_unique" UNIQUE ("assignment_id"),
  CONSTRAINT "tokenless_private_review_responses_delivery_assignment_unique" UNIQUE ("delivery_id", "assignment_id"),
  CONSTRAINT "tokenless_private_review_responses_choice_check" CHECK ("choice" IN ('positive','negative')),
  CONSTRAINT "tokenless_private_review_responses_rationale_check" CHECK (
    ("rationale_ciphertext" IS NULL AND "rationale_key_ref" IS NULL AND "rationale_digest" IS NULL)
    OR ("rationale_ciphertext" IS NOT NULL AND "rationale_key_ref" IS NOT NULL AND "rationale_digest" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_private_review_responses_hash_check" CHECK (
    "response_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND ("rationale_digest" IS NULL OR "rationale_digest" ~ '^sha256:[0-9a-f]{64}$')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_review_responses_delivery_idx"
  ON "tokenless_private_review_responses" USING btree ("delivery_id", "created_at");--> statement-breakpoint

ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  ADD COLUMN "result_envelope_json" text,
  ADD COLUMN "result_commitment" text,
  ADD COLUMN "completed_at" timestamp with time zone,
  ADD CONSTRAINT "tokenless_private_unpaid_review_deliveries_result_check" CHECK (
    (
      "result_envelope_json" IS NULL
      AND "result_commitment" IS NULL
      AND ("completed_at" IS NULL OR "status" IN ('completed','inconclusive','failed_terminal'))
    )
    OR (
      "status" IN ('completed','inconclusive')
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

ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "question_authority" text,
  ADD COLUMN "result_semantics" text;--> statement-breakpoint
UPDATE "tokenless_agent_review_request_profiles"
SET "question_authority" = 'owner_fixed',
    "result_semantics" = 'assurance'
WHERE "question_authority" IS NULL OR "result_semantics" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ALTER COLUMN "question_authority" SET NOT NULL,
  ALTER COLUMN "result_semantics" SET NOT NULL,
  ALTER COLUMN "criterion" DROP NOT NULL,
  ALTER COLUMN "positive_label" DROP NOT NULL,
  ALTER COLUMN "negative_label" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_criterion_check",
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_labels_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_question_policy_check" CHECK (
    (
      "question_authority" = 'owner_fixed'
      AND "result_semantics" = 'assurance'
      AND "criterion" IS NOT NULL
      AND char_length("criterion") BETWEEN 1 AND 500
      AND "positive_label" IS NOT NULL
      AND char_length("positive_label") BETWEEN 1 AND 40
      AND "negative_label" IS NOT NULL
      AND char_length("negative_label") BETWEEN 1 AND 40
      AND lower("positive_label") <> lower("negative_label")
    )
    OR (
      "question_authority" = 'agent_per_request'
      AND "result_semantics" = 'feedback'
      AND "criterion" IS NULL
      AND "positive_label" IS NULL
      AND "negative_label" IS NULL
    )
  );--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_opportunity_questions" (
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "question_authority" text NOT NULL,
  "result_semantics" text NOT NULL,
  "question_hash" text NOT NULL,
  "content_boundary" text NOT NULL,
  "question_json" text,
  "question_ciphertext" text,
  "question_key_ref" text,
  "submitted_by_integration_id" text NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunity_questions_pk"
    PRIMARY KEY ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_review_opportunity_questions_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_questions_integration_fk"
    FOREIGN KEY ("submitted_by_integration_id")
    REFERENCES "tokenless_agent_integrations" ("integration_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_questions_schema_check"
    CHECK ("schema_version" = 'rateloop.binary-review-question.v1'),
  CONSTRAINT "tokenless_agent_review_opportunity_questions_authority_check"
    CHECK ("question_authority" = 'agent_per_request' AND "result_semantics" = 'feedback'),
  CONSTRAINT "tokenless_agent_review_opportunity_questions_hash_check"
    CHECK ("question_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_agent_review_opportunity_questions_storage_check" CHECK (
    (
      "content_boundary" = 'public_or_test'
      AND "question_json" IS NOT NULL
      AND char_length("question_json") BETWEEN 1 AND 4096
      AND "question_ciphertext" IS NULL
      AND "question_key_ref" IS NULL
    )
    OR (
      "content_boundary" = 'private_workspace'
      AND "question_json" IS NULL
      AND "question_ciphertext" IS NOT NULL
      AND "question_key_ref" IS NOT NULL
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunity_questions_hash_idx"
  ON "tokenless_agent_review_opportunity_questions" USING btree
  ("workspace_id", "question_hash", "submitted_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_agent_review_opportunity_question_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent review opportunity questions are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_review_opportunity_questions_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_agent_review_opportunity_questions"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_agent_review_opportunity_question_mutation"();

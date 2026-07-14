ALTER TABLE "tokenless_question_records"
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'private',
  ADD COLUMN "data_classification" text NOT NULL DEFAULT 'internal',
  ADD COLUMN "redaction_summary" text,
  ADD COLUMN "confirmed_no_sensitive_data" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_visibility_check"
  CHECK ("visibility" IN ('public', 'private'));
--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_classification_check"
  CHECK ("data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted'));
--> statement-breakpoint
CREATE INDEX "tokenless_question_records_visibility_moderation_idx"
  ON "tokenless_question_records" USING btree ("visibility", "moderation_status", "updated_at");

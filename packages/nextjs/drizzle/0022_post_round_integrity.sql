ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "evaluation_schema_version" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "evaluation_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "aggregates_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "limitation_codes_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "remediation" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "effect" text;--> statement-breakpoint
ALTER TABLE "tokenless_analytics_reviews" ADD COLUMN "payout_effect" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_analytics_reviews_evaluation_hash_idx" ON "tokenless_analytics_reviews" USING btree ("operation_key", "evaluation_hash");--> statement-breakpoint
ALTER TABLE "tokenless_result_publications" ADD COLUMN "evaluation_hash" text;--> statement-breakpoint
CREATE TABLE "tokenless_post_round_integrity_inputs" (
  "input_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "evidence_hash" text NOT NULL,
  "input_version" integer NOT NULL,
  "input_hash" text NOT NULL,
  "policy_json" text NOT NULL,
  "reports_json" text NOT NULL,
  "inputs_complete" boolean NOT NULL,
  "limitation_codes_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_post_round_integrity_inputs_version_unique" UNIQUE("operation_key", "input_version"),
  CONSTRAINT "tokenless_post_round_integrity_inputs_hash_unique" UNIQUE("operation_key", "input_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_post_round_integrity_inputs_evidence_idx" ON "tokenless_post_round_integrity_inputs" USING btree ("operation_key", "evidence_hash", "input_version");--> statement-breakpoint
CREATE TABLE "tokenless_post_round_integrity_records" (
  "record_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "evaluation_hash" text NOT NULL,
  "record_type" text NOT NULL,
  "reason_code" text NOT NULL,
  "details_json" text NOT NULL,
  "record_hash" text NOT NULL,
  "submitted_by" text NOT NULL,
  "effect" text DEFAULT 'append_only_review' NOT NULL,
  "payout_effect" text DEFAULT 'none' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_post_round_integrity_records_hash_unique" UNIQUE("operation_key", "record_hash"),
  CONSTRAINT "tokenless_post_round_integrity_records_type_check" CHECK ("record_type" IN ('appeal', 'remediation')),
  CONSTRAINT "tokenless_post_round_integrity_records_effect_check" CHECK ("effect" = 'append_only_review' AND "payout_effect" = 'none')
);--> statement-breakpoint
CREATE INDEX "tokenless_post_round_integrity_records_operation_idx" ON "tokenless_post_round_integrity_records" USING btree ("operation_key", "created_at");

ALTER TABLE "tokenless_assurance_cases" ADD COLUMN "deterministic_checks_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TABLE "tokenless_assurance_run_cases" (
  "run_id" text NOT NULL REFERENCES "tokenless_assurance_runs"("run_id"),
  "case_id" text NOT NULL REFERENCES "tokenless_assurance_cases"("case_id"),
  "position" integer NOT NULL,
  "variant_a_artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "variant_b_artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "blinding_commitment" text NOT NULL,
  "blinding_secret_json" text NOT NULL,
  "deterministic_checks_json" text NOT NULL,
  "deterministic_checks_hash" text NOT NULL,
  "deterministic_checks_status" text DEFAULT 'pending' NOT NULL,
  "deterministic_checks_result_json" text,
  "content_id" text NOT NULL,
  "admission_policy_hash" text NOT NULL,
  "round_id" text,
  "round_status" text DEFAULT 'planned' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("run_id", "case_id"),
  CONSTRAINT "tokenless_assurance_run_cases_position_unique" UNIQUE("run_id", "position"),
  CONSTRAINT "tokenless_assurance_run_cases_content_unique" UNIQUE("run_id", "content_id"),
  CONSTRAINT "tokenless_assurance_run_cases_variants_check" CHECK ("variant_a_artifact_id" <> "variant_b_artifact_id"),
  CONSTRAINT "tokenless_assurance_run_cases_checks_status_check" CHECK ("deterministic_checks_status" IN ('not_applicable', 'pending', 'passed', 'failed')),
  CONSTRAINT "tokenless_assurance_run_cases_round_status_check" CHECK ("round_status" IN ('planned', 'submitted', 'open', 'revealable', 'settling', 'finalized', 'terminal', 'failed'))
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_run_cases_run_status_idx" ON "tokenless_assurance_run_cases" USING btree ("run_id", "round_status", "position");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_run_cases_round_idx" ON "tokenless_assurance_run_cases" USING btree ("round_id");

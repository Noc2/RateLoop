CREATE TABLE "tokenless_assurance_projects" (
  "project_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "name" text NOT NULL,
  "description" text,
  "data_classification" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "retention_days" integer NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_projects_workspace_status_idx" ON "tokenless_assurance_projects" USING btree ("workspace_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_artifacts" (
  "artifact_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "role" text NOT NULL,
  "label" text NOT NULL,
  "digest" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_ref" text NOT NULL,
  "redaction_status" text NOT NULL,
  "renderer_policy" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_artifacts_project_digest_unique" UNIQUE("project_id", "digest", "role")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_artifacts_project_idx" ON "tokenless_assurance_artifacts" USING btree ("project_id", "created_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_rubrics" (
  "rubric_id" text NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "version" integer NOT NULL,
  "prompt" text NOT NULL,
  "failure_tags_json" text NOT NULL,
  "rationale_json" text NOT NULL,
  "pass_rule_json" text NOT NULL,
  "rubric_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("rubric_id", "version")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_rubrics_project_idx" ON "tokenless_assurance_rubrics" USING btree ("project_id", "rubric_id", "version");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_suites" (
  "suite_id" text NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "name" text NOT NULL,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "rubric_id" text NOT NULL,
  "rubric_version" integer NOT NULL,
  "manifest_hash" text,
  "manifest_json" text,
  "frozen_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("suite_id", "version"),
  FOREIGN KEY ("rubric_id", "rubric_version") REFERENCES "tokenless_assurance_rubrics"("rubric_id", "version")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_suites_project_status_idx" ON "tokenless_assurance_suites" USING btree ("project_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_cases" (
  "case_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "suite_id" text NOT NULL,
  "suite_version" integer NOT NULL,
  "position" integer NOT NULL,
  "title" text NOT NULL,
  "instructions" text NOT NULL,
  "baseline_artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "candidate_artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "context_artifact_ids_json" text NOT NULL,
  "objective_reference" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  FOREIGN KEY ("suite_id", "suite_version") REFERENCES "tokenless_assurance_suites"("suite_id", "version"),
  CONSTRAINT "tokenless_assurance_cases_suite_position_unique" UNIQUE("suite_id", "suite_version", "position")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_cases_suite_idx" ON "tokenless_assurance_cases" USING btree ("suite_id", "suite_version", "status", "position");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_audience_policies" (
  "policy_id" text NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "version" integer NOT NULL,
  "reviewer_source" text NOT NULL,
  "compensation" text NOT NULL,
  "cohorts_json" text NOT NULL,
  "selection" text NOT NULL,
  "fallbacks_json" text NOT NULL,
  "required_qualifications_json" text NOT NULL,
  "assurance_json" text NOT NULL,
  "buyer_privacy_json" text NOT NULL,
  "legal_eligibility_required" boolean NOT NULL,
  "policy_hash" text NOT NULL,
  "policy_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("policy_id", "version"),
  CONSTRAINT "tokenless_assurance_audience_policy_hash_unique" UNIQUE("project_id", "policy_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_audience_policies_project_idx" ON "tokenless_assurance_audience_policies" USING btree ("project_id", "policy_id", "version");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "suite_id" text NOT NULL,
  "suite_version" integer NOT NULL,
  "audience_policy_id" text NOT NULL,
  "audience_policy_version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "policy_hash" text NOT NULL,
  "manifest_hash" text,
  "manifest_json" text,
  "previous_run_id" text REFERENCES "tokenless_assurance_runs"("run_id"),
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "frozen_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  FOREIGN KEY ("suite_id", "suite_version") REFERENCES "tokenless_assurance_suites"("suite_id", "version"),
  FOREIGN KEY ("audience_policy_id", "audience_policy_version") REFERENCES "tokenless_assurance_audience_policies"("policy_id", "version")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_runs_project_status_idx" ON "tokenless_assurance_runs" USING btree ("project_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_responses" (
  "response_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "tokenless_assurance_runs"("run_id"),
  "case_id" text NOT NULL REFERENCES "tokenless_assurance_cases"("case_id"),
  "reviewer_key" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "choice" text NOT NULL,
  "failure_tag_keys_json" text NOT NULL,
  "rationale_ciphertext" text,
  "rationale_key_ref" text,
  "qualification_keys_json" text NOT NULL,
  "assurance_capabilities_json" text NOT NULL,
  "response_digest" text NOT NULL,
  "settlement_reference" text,
  "validity" text DEFAULT 'pending' NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_responses_run_case_reviewer_unique" UNIQUE("run_id", "case_id", "reviewer_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_responses_run_validity_idx" ON "tokenless_assurance_responses" USING btree ("run_id", "validity", "submitted_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_evidence_packets" (
  "packet_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "tokenless_assurance_runs"("run_id"),
  "manifest_hash" text NOT NULL,
  "case_root" text NOT NULL,
  "response_root" text NOT NULL,
  "aggregation_version" text NOT NULL,
  "result_json" text NOT NULL,
  "limitations_json" text NOT NULL,
  "chain_references_json" text NOT NULL,
  "signature" text NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_evidence_packets_run_unique" UNIQUE("run_id")
);--> statement-breakpoint
CREATE TABLE "tokenless_assurance_client_decisions" (
  "decision_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "tokenless_assurance_runs"("run_id"),
  "evidence_packet_id" text NOT NULL REFERENCES "tokenless_assurance_evidence_packets"("packet_id"),
  "decision" text NOT NULL,
  "note" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_client_decisions_run_unique" UNIQUE("run_id")
);

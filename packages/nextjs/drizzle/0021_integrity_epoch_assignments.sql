ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "integrity_epoch_id" text REFERENCES "tokenless_integrity_epochs"("epoch_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "integrity_manifest_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "integrity_constraints_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "selection_batch_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "selection_seed_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "selection_commitment" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "selection_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels" ADD COLUMN "selected_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_epoch_id" text REFERENCES "tokenless_integrity_epochs"("epoch_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_manifest_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_reviewer_lookup" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_cluster_pseudonym" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_risk_band" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "provider_subject_hashes_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_provenance_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "integrity_provenance_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "selection_batch_id" text;--> statement-breakpoint
CREATE TABLE "tokenless_integrity_assignment_history" (
  "history_id" text PRIMARY KEY NOT NULL,
  "selection_batch_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "run_id" text NOT NULL REFERENCES "tokenless_assurance_runs"("run_id"),
  "subpanel_id" text NOT NULL REFERENCES "tokenless_assurance_run_subpanels"("subpanel_id"),
  "assignment_id" text NOT NULL REFERENCES "tokenless_assurance_assignments"("assignment_id"),
  "epoch_id" text NOT NULL REFERENCES "tokenless_integrity_epochs"("epoch_id"),
  "manifest_hash" text NOT NULL,
  "reviewer_lookup" text NOT NULL,
  "cluster_pseudonym" text NOT NULL,
  "provider_subject_hashes_json" text NOT NULL,
  "selected_at" timestamp with time zone NOT NULL,
  "response_window_closes_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_integrity_assignment_history_assignment_unique" UNIQUE("assignment_id"),
  CONSTRAINT "tokenless_integrity_assignment_history_run_reviewer_unique" UNIQUE("run_id", "reviewer_lookup")
);--> statement-breakpoint
CREATE INDEX "tokenless_integrity_assignment_history_recent_idx" ON "tokenless_integrity_assignment_history" USING btree ("workspace_id", "selected_at", "reviewer_lookup");--> statement-breakpoint
CREATE INDEX "tokenless_integrity_assignment_history_batch_idx" ON "tokenless_integrity_assignment_history" USING btree ("selection_batch_id", "selected_at");

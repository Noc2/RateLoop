ALTER TABLE "tokenless_workspaces" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD COLUMN "data_classification" text DEFAULT 'confidential' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD COLUMN "retention_policy_id" text DEFAULT 'retention-default-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD COLUMN "legal_hold_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD COLUMN "data_use_policy_version" text DEFAULT 'data-use-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD COLUMN "retention_policy_id" text DEFAULT 'retention-default-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD COLUMN "legal_hold_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD COLUMN "data_use_policy_version" text DEFAULT 'data-use-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "max_data_classification" text DEFAULT 'confidential' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "permitted_data_uses_json" text DEFAULT '["service_delivery"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ADD COLUMN "data_classification" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ADD COLUMN "data_use_policy_version" text DEFAULT 'data-use-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_question_records" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_question_records" ADD COLUMN "data_use_policy_version" text DEFAULT 'data-use-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_artifact_objects" ADD COLUMN "home_region" text DEFAULT 'eu' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD CONSTRAINT "tokenless_workspaces_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD CONSTRAINT "tokenless_assurance_projects_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD CONSTRAINT "tokenless_workspace_api_keys_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ADD CONSTRAINT "tokenless_content_records_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_question_records" ADD CONSTRAINT "tokenless_question_records_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_assurance_artifact_objects" ADD CONSTRAINT "tokenless_artifact_objects_home_region_check" CHECK ("home_region" = 'eu');--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ADD CONSTRAINT "tokenless_workspaces_legal_hold_check" CHECK ("legal_hold_state" IN ('none', 'active'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ADD CONSTRAINT "tokenless_assurance_projects_legal_hold_check" CHECK ("legal_hold_state" IN ('none', 'active'));--> statement-breakpoint
CREATE INDEX "tokenless_workspaces_region_classification_idx" ON "tokenless_workspaces" USING btree ("home_region", "data_classification", "status");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_projects_policy_idx" ON "tokenless_assurance_projects" USING btree ("workspace_id", "home_region", "data_classification", "status");

CREATE TABLE "tokenless_assurance_artifact_objects" (
  "object_id" text PRIMARY KEY NOT NULL,
  "artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "storage_provider" text NOT NULL,
  "storage_ref" text NOT NULL,
  "key_domain" text NOT NULL,
  "key_version" text NOT NULL,
  "content_nonce" text NOT NULL,
  "content_auth_tag" text NOT NULL,
  "wrapped_data_key" text NOT NULL,
  "wrap_nonce" text NOT NULL,
  "wrap_auth_tag" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "delete_after" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_artifact_objects_artifact_unique" UNIQUE("artifact_id"),
  CONSTRAINT "tokenless_assurance_artifact_objects_storage_ref_unique" UNIQUE("storage_ref")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_artifact_objects_retention_idx" ON "tokenless_assurance_artifact_objects" USING btree ("status", "delete_after");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_artifact_leases" (
  "lease_id" text PRIMARY KEY NOT NULL,
  "artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "account_address" text NOT NULL,
  "assignment_id" text,
  "purpose" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_artifact_leases_account_idx" ON "tokenless_assurance_artifact_leases" USING btree ("account_address", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_access_logs" (
  "log_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "artifact_id" text REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "lease_id" text REFERENCES "tokenless_assurance_artifact_leases"("lease_id"),
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "action" text NOT NULL,
  "purpose" text NOT NULL,
  "request_reference" text,
  "occurred_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_access_logs_project_idx" ON "tokenless_assurance_access_logs" USING btree ("project_id", "occurred_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_deletion_requests" (
  "request_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "requested_by" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "execute_after" timestamp with time zone NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_deletion_requests_due_idx" ON "tokenless_assurance_deletion_requests" USING btree ("status", "execute_after");

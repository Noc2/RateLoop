CREATE TABLE "tokenless_project_access_assignments" (
  "assignment_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "subject_kind" text NOT NULL,
  "subject_reference" text NOT NULL,
  "role" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone,
  "granted_by" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  CONSTRAINT "tokenless_project_access_assignment_kind_check" CHECK ("subject_kind" IN ('account', 'principal', 'api_key')),
  CONSTRAINT "tokenless_project_access_assignment_role_check" CHECK ("role" IN ('admin', 'contributor', 'auditor', 'reviewer')),
  CONSTRAINT "tokenless_project_access_assignment_status_check" CHECK ("status" IN ('active', 'revoked'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_project_access_assignments_active_unique" ON "tokenless_project_access_assignments" USING btree ("project_id", "subject_kind", "subject_reference") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "tokenless_project_access_assignments_lookup_idx" ON "tokenless_project_access_assignments" USING btree ("workspace_id", "project_id", "subject_kind", "subject_reference", "status");

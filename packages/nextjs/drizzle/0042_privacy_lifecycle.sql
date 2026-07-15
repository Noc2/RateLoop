CREATE TABLE "tokenless_retention_policies" (
  "policy_id" text PRIMARY KEY NOT NULL,
  "version" integer NOT NULL,
  "home_region" text NOT NULL,
  "schedule_json" text NOT NULL,
  "exceptions_json" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_retention_policies_status_check" CHECK ("status" IN ('draft', 'active', 'retired'))
);--> statement-breakpoint
INSERT INTO "tokenless_retention_policies"
  ("policy_id", "version", "home_region", "schedule_json", "exceptions_json", "status", "effective_at", "created_at")
VALUES
  ('retention-default-v1', 1, 'eu',
   '{"private_artifacts":{"action":"delete","days":90},"application_audit":{"action":"delete","days":365},"billing_legal":{"action":"review","days":3650},"backups":{"action":"expire","days":35}}',
   '{"legal_hold":"retain_until_release","public_chain":"unerasable","statutory_record":"retain_until_legal_expiry"}',
   'active', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');--> statement-breakpoint
CREATE TABLE "tokenless_legal_holds" (
  "hold_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text REFERENCES "tokenless_assurance_projects"("project_id"),
  "scope" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "review_at" timestamp with time zone NOT NULL,
  "released_by" text,
  "released_at" timestamp with time zone,
  "release_reason" text,
  CONSTRAINT "tokenless_legal_holds_status_check" CHECK ("status" IN ('active', 'released'))
);--> statement-breakpoint
CREATE INDEX "tokenless_legal_holds_scope_idx" ON "tokenless_legal_holds" USING btree ("workspace_id", "project_id", "status", "review_at");--> statement-breakpoint
CREATE TABLE "tokenless_subject_requests" (
  "request_id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id"),
  "request_type" text NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "scope_json" text NOT NULL,
  "identity_assurance" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tokenless_subject_requests_type_check" CHECK ("request_type" IN ('access','correction','restriction','objection','export','deletion')),
  CONSTRAINT "tokenless_subject_requests_status_check" CHECK ("status" IN ('received','identity_verified','in_progress','blocked_by_hold','completed','denied'))
);--> statement-breakpoint
CREATE INDEX "tokenless_subject_requests_principal_status_idx" ON "tokenless_subject_requests" USING btree ("principal_id", "status", "due_at");--> statement-breakpoint
CREATE TABLE "tokenless_subject_request_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "tokenless_subject_requests"("request_id"),
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_reference" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "tokenless_subject_request_completions" (
  "completion_id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "tokenless_subject_requests"("request_id"),
  "deleted_categories_json" text NOT NULL,
  "anonymized_categories_json" text NOT NULL,
  "retained_categories_json" text NOT NULL,
  "pending_backup_expiry_json" text NOT NULL,
  "public_chain_exceptions_json" text NOT NULL,
  "evidence_json" text NOT NULL,
  "completed_by" text NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_subject_request_completions_request_unique" UNIQUE("request_id")
);

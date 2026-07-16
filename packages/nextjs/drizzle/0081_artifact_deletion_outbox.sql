CREATE TABLE "tokenless_artifact_deletion_jobs" (
  "object_id" text PRIMARY KEY NOT NULL
    REFERENCES "tokenless_assurance_artifact_objects"("object_id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id") ON DELETE CASCADE,
  "artifact_id" text NOT NULL REFERENCES "tokenless_assurance_artifacts"("artifact_id") ON DELETE CASCADE,
  "storage_ref" text NOT NULL,
  "authorization_kind" text NOT NULL,
  "deletion_request_id" text REFERENCES "tokenless_assurance_deletion_requests"("request_id") ON DELETE RESTRICT,
  "retention_policy_version" integer,
  "state" text NOT NULL DEFAULT 'provider_pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "provider_deleted_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "audit_event_id" text REFERENCES "tokenless_audit_events"("event_id") ON DELETE RESTRICT,
  "audit_event_digest" text,
  "audited_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_artifact_deletion_jobs_policy_fk"
    FOREIGN KEY ("workspace_id", "retention_policy_version")
    REFERENCES "tokenless_workspace_evidence_retention_policies"("workspace_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_artifact_deletion_jobs_authorization_check"
    CHECK ("authorization_kind" IN ('deletion_request', 'retention_policy')),
  CONSTRAINT "tokenless_artifact_deletion_jobs_state_check"
    CHECK ("state" IN ('provider_pending', 'provider_deleting', 'provider_deleted', 'finalized', 'completed')),
  CONSTRAINT "tokenless_artifact_deletion_jobs_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "tokenless_artifact_deletion_jobs_authorization_basis_check" CHECK (
    ("authorization_kind" = 'deletion_request' AND "deletion_request_id" IS NOT NULL)
    OR ("authorization_kind" = 'retention_policy' AND "retention_policy_version" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_artifact_deletion_jobs_lease_check" CHECK (
    ("state" = 'provider_deleting' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("state" <> 'provider_deleting' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "tokenless_artifact_deletion_jobs_checkpoint_check" CHECK (
    ("state" IN ('provider_pending', 'provider_deleting')
      AND "provider_deleted_at" IS NULL AND "finalized_at" IS NULL
      AND "audit_event_id" IS NULL AND "audit_event_digest" IS NULL AND "audited_at" IS NULL)
    OR ("state" = 'provider_deleted'
      AND "provider_deleted_at" IS NOT NULL AND "finalized_at" IS NULL
      AND "audit_event_id" IS NULL AND "audit_event_digest" IS NULL AND "audited_at" IS NULL)
    OR ("state" = 'finalized'
      AND "provider_deleted_at" IS NOT NULL AND "finalized_at" IS NOT NULL
      AND "audit_event_id" IS NULL AND "audit_event_digest" IS NULL AND "audited_at" IS NULL)
    OR ("state" = 'completed'
      AND "provider_deleted_at" IS NOT NULL AND "finalized_at" IS NOT NULL
      AND "audit_event_id" IS NOT NULL AND "audit_event_digest" IS NOT NULL AND "audited_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_artifact_deletion_jobs_due_idx"
  ON "tokenless_artifact_deletion_jobs" ("state", "next_attempt_at", "lease_expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_artifact_deletion_jobs_workspace_idx"
  ON "tokenless_artifact_deletion_jobs" ("workspace_id", "project_id", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_audit_events_artifact_retention_unique"
  ON "tokenless_audit_events" ("workspace_id", "request_correlation")
  WHERE "action" = 'artifact.retention_delete'
    AND "target_kind" = 'artifact'
    AND "request_correlation" IS NOT NULL;

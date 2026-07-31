CREATE TABLE "tokenless_reviewer_engagement_subject_crosswalk" (
  "workspace_id" text NOT NULL,
  "reviewer_subject_id" text NOT NULL,
  "reviewer_account_address" text NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_pk"
    PRIMARY KEY ("workspace_id", "reviewer_subject_id"),
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_reviewer_unique"
    UNIQUE ("workspace_id", "reviewer_account_address"),
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_subject_check"
    CHECK ("reviewer_subject_id" ~ '^engsub_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_reviewer_check"
    CHECK (char_length(btrim("reviewer_account_address")) BETWEEN 1 AND 160),
  CONSTRAINT "tokenless_reviewer_engagement_subject_crosswalk_retention_check"
    CHECK ("retention_until" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_engagement_subject_crosswalk_retention_idx"
  ON "tokenless_reviewer_engagement_subject_crosswalk" USING btree
  ("retention_until", "workspace_id", "reviewer_subject_id");--> statement-breakpoint
CREATE TABLE "tokenless_reviewer_engagement_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_subject_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "employment_governance_version" integer NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_reviewer_engagement_events_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_reviewer_engagement_events_governance_fk"
    FOREIGN KEY ("workspace_id", "employment_governance_version")
    REFERENCES "tokenless_workspace_employment_data_governance_versions"("workspace_id", "version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_reviewer_engagement_events_scope_sequence_unique"
    UNIQUE ("workspace_id", "assignment_id", "reviewer_subject_id", "sequence"),
  CONSTRAINT "tokenless_reviewer_engagement_events_idempotency_unique"
    UNIQUE ("workspace_id", "assignment_id", "reviewer_subject_id", "idempotency_key_hash"),
  CONSTRAINT "tokenless_reviewer_engagement_events_id_check"
    CHECK ("event_id" ~ '^eng_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_reviewer_engagement_events_assignment_check"
    CHECK ("assignment_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'),
  CONSTRAINT "tokenless_reviewer_engagement_events_sequence_check"
    CHECK ("sequence" BETWEEN 1 AND 10000),
  CONSTRAINT "tokenless_reviewer_engagement_events_type_check"
    CHECK ("event_type" IN ('first_artifact_access', 'active_interaction', 'idle', 'reopened', 'submitted')),
  CONSTRAINT "tokenless_reviewer_engagement_events_hashes_check" CHECK (
    "idempotency_key_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_reviewer_engagement_events_governance_version_check"
    CHECK ("employment_governance_version" > 0),
  CONSTRAINT "tokenless_reviewer_engagement_events_server_time_check"
    CHECK ("occurred_at" = "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_engagement_events_assignment_idx"
  ON "tokenless_reviewer_engagement_events" USING btree
  ("workspace_id", "assignment_id", "reviewer_subject_id", "sequence");--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_engagement_events_window_idx"
  ON "tokenless_reviewer_engagement_events" USING btree
  ("workspace_id", "occurred_at", "assignment_id");--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_engagement_events_governance_idx"
  ON "tokenless_reviewer_engagement_events" USING btree
  ("workspace_id", "employment_governance_version", "occurred_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_reject_reviewer_engagement_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tokenless_workspaces WHERE workspace_id = OLD.workspace_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'reviewer engagement events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_reviewer_engagement_events_append_only
BEFORE UPDATE OR DELETE ON "tokenless_reviewer_engagement_events"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_reviewer_engagement_event_mutation();

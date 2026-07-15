CREATE TABLE "tokenless_audit_heads" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "last_sequence" integer DEFAULT 0 NOT NULL,
  "last_digest" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "tokenless_audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "sequence" integer NOT NULL,
  "previous_digest" text NOT NULL,
  "event_digest" text NOT NULL,
  "home_region" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "assurance_method" text NOT NULL,
  "action" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" text NOT NULL,
  "purpose" text NOT NULL,
  "reason" text NOT NULL,
  "request_correlation" text,
  "result" text NOT NULL,
  "metadata_json" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_audit_events_result_check" CHECK ("result" IN ('success','denied','failure')),
  CONSTRAINT "tokenless_audit_events_workspace_sequence_unique" UNIQUE("workspace_id", "sequence"),
  CONSTRAINT "tokenless_audit_events_workspace_digest_unique" UNIQUE("workspace_id", "event_digest")
);--> statement-breakpoint
CREATE INDEX "tokenless_audit_events_workspace_time_idx" ON "tokenless_audit_events" USING btree ("workspace_id", "occurred_at", "sequence");

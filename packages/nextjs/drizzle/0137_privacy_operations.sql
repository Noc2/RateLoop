ALTER TABLE "tokenless_subject_requests"
  DROP CONSTRAINT "tokenless_subject_requests_status_check";--> statement-breakpoint
ALTER TABLE "tokenless_subject_requests"
  ADD CONSTRAINT "tokenless_subject_requests_status_check"
  CHECK ("status" IN (
    'received','identity_verified','in_progress','blocked_by_hold','blocked_by_funds','completed','denied'
  ));--> statement-breakpoint

CREATE TABLE "tokenless_workspace_fund_resolution_requests" (
  "resolution_id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "tokenless_subject_requests"("request_id") ON DELETE RESTRICT,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "requested_by" text NOT NULL,
  "settled_atomic_snapshot" text NOT NULL,
  "reserved_atomic_snapshot" text NOT NULL,
  "available_atomic_snapshot" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "resolution_reference" text,
  "resolved_by" text,
  "requested_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_fund_resolution_request_unique" UNIQUE ("request_id"),
  CONSTRAINT "tokenless_workspace_fund_resolution_amount_check" CHECK (
    "settled_atomic_snapshot" ~ '^-?(0|[1-9][0-9]*)$'
    AND "reserved_atomic_snapshot" ~ '^(0|[1-9][0-9]*)$'
    AND "available_atomic_snapshot" ~ '^-?(0|[1-9][0-9]*)$'
  ),
  CONSTRAINT "tokenless_workspace_fund_resolution_status_check"
    CHECK ("status" IN ('pending','refunded','manual_review')),
  CONSTRAINT "tokenless_workspace_fund_resolution_terminal_check" CHECK (
    ("status" = 'pending' AND "resolution_reference" IS NULL
      AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
    OR
    ("status" <> 'pending' AND "resolution_reference" IS NOT NULL
      AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_fund_resolution_queue_idx"
  ON "tokenless_workspace_fund_resolution_requests" ("status","requested_at","resolution_id");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_fund_resolution_workspace_idx"
  ON "tokenless_workspace_fund_resolution_requests" ("workspace_id","status","updated_at");--> statement-breakpoint

CREATE TABLE "tokenless_subject_request_exports" (
  "request_id" text PRIMARY KEY NOT NULL
    REFERENCES "tokenless_subject_requests"("request_id") ON DELETE RESTRICT,
  "principal_id" text NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "payload_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  "delete_after" timestamp with time zone NOT NULL,
  "downloaded_at" timestamp with time zone,
  CONSTRAINT "tokenless_subject_request_exports_hash_check"
    CHECK ("payload_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_subject_request_exports_lifetime_check"
    CHECK ("schema_version" = 1 AND "delete_after" > "generated_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_subject_request_exports_expiry_idx"
  ON "tokenless_subject_request_exports" ("delete_after","request_id");--> statement-breakpoint

ALTER TABLE "tokenless_notification_email_deliveries"
  ADD COLUMN "recovery_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "next_recovery_at" timestamp with time zone;--> statement-breakpoint
UPDATE "tokenless_notification_email_deliveries"
SET "next_recovery_at"="updated_at" + INTERVAL '6 hours'
WHERE "state"='dead';--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_deliveries"
  ADD CONSTRAINT "tokenless_notification_email_deliveries_recovery_check"
  CHECK (
    "recovery_count" BETWEEN 0 AND 6
    AND (("state" = 'dead' AND (
          ("recovery_count" < 6 AND "next_recovery_at" IS NOT NULL)
          OR ("recovery_count" = 6 AND "next_recovery_at" IS NULL)
        ))
      OR ("state" <> 'dead' AND "next_recovery_at" IS NULL))
  );--> statement-breakpoint
CREATE INDEX "tokenless_notification_email_deliveries_recovery_due_idx"
  ON "tokenless_notification_email_deliveries" ("state","next_recovery_at","created_at");

CREATE TABLE "tokenless_privacy_worker_failures" (
  "failure_id" text PRIMARY KEY NOT NULL,
  "worker_kind" text NOT NULL,
  "work_item_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'retrying',
  "attempt_count" integer NOT NULL DEFAULT 1,
  "first_failed_at" timestamp with time zone NOT NULL,
  "last_failed_at" timestamp with time zone NOT NULL,
  "next_retry_at" timestamp with time zone,
  "last_error_code" text NOT NULL,
  "last_error_digest" text NOT NULL,
  "operator_alert_state" text NOT NULL DEFAULT 'pending',
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_privacy_worker_failures_item_unique"
    UNIQUE ("worker_kind","work_item_key"),
  CONSTRAINT "tokenless_privacy_worker_failures_worker_check"
    CHECK ("worker_kind" IN ('subject_request','workspace_retention')),
  CONSTRAINT "tokenless_privacy_worker_failures_status_check"
    CHECK ("status" IN ('retrying','dead','resolved')),
  CONSTRAINT "tokenless_privacy_worker_failures_attempt_check"
    CHECK ("attempt_count" BETWEEN 1 AND 5),
  CONSTRAINT "tokenless_privacy_worker_failures_digest_check"
    CHECK ("last_error_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_privacy_worker_failures_alert_check"
    CHECK ("operator_alert_state" IN ('pending','resolved')),
  CONSTRAINT "tokenless_privacy_worker_failures_state_check" CHECK (
    ("status" = 'retrying' AND "next_retry_at" IS NOT NULL
      AND "resolved_at" IS NULL AND "operator_alert_state" = 'pending')
    OR
    ("status" = 'dead' AND "next_retry_at" IS NULL
      AND "resolved_at" IS NULL AND "operator_alert_state" = 'pending')
    OR
    ("status" = 'resolved' AND "next_retry_at" IS NULL
      AND "resolved_at" IS NOT NULL AND "operator_alert_state" = 'resolved')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_privacy_worker_failures_retry_idx"
  ON "tokenless_privacy_worker_failures" ("worker_kind","status","next_retry_at","last_failed_at");--> statement-breakpoint
CREATE INDEX "tokenless_privacy_worker_failures_alert_idx"
  ON "tokenless_privacy_worker_failures" ("operator_alert_state","last_failed_at")
  WHERE "operator_alert_state" = 'pending';

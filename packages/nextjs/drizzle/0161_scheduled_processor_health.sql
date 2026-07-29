CREATE TABLE "tokenless_scheduled_processor_health" (
  "processor_name" text PRIMARY KEY NOT NULL,
  "configuration_state" text NOT NULL,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "first_failed_at" timestamp with time zone,
  "last_failed_at" timestamp with time zone,
  "last_succeeded_at" timestamp with time zone,
  "last_error_code" text,
  "last_error_digest" text,
  "disabled_reason" text,
  "operator_alert_state" text NOT NULL DEFAULT 'resolved',
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_scheduled_processor_health_name_check"
    CHECK ("processor_name" ~ '^[A-Za-z][A-Za-z0-9]{0,79}$'),
  CONSTRAINT "tokenless_scheduled_processor_health_configuration_check"
    CHECK ("configuration_state" IN ('enabled','disabled','broken')),
  CONSTRAINT "tokenless_scheduled_processor_health_failure_count_check"
    CHECK ("consecutive_failures" BETWEEN 0 AND 2147483647),
  CONSTRAINT "tokenless_scheduled_processor_health_error_code_check"
    CHECK ("last_error_code" IS NULL OR "last_error_code" ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  CONSTRAINT "tokenless_scheduled_processor_health_digest_check"
    CHECK ("last_error_digest" IS NULL OR "last_error_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_scheduled_processor_health_alert_check"
    CHECK ("operator_alert_state" IN ('pending','resolved')),
  CONSTRAINT "tokenless_scheduled_processor_health_state_check" CHECK (
    (
      "configuration_state" = 'enabled'
      AND "consecutive_failures" = 0
      AND "first_failed_at" IS NULL
      AND "last_error_code" IS NULL
      AND "last_error_digest" IS NULL
      AND "disabled_reason" IS NULL
      AND "operator_alert_state" = 'resolved'
      AND "last_succeeded_at" IS NOT NULL
    )
    OR
    (
      "configuration_state" = 'disabled'
      AND "consecutive_failures" = 0
      AND "first_failed_at" IS NULL
      AND "last_error_code" IS NULL
      AND "last_error_digest" IS NULL
      AND "disabled_reason" IS NOT NULL
      AND "operator_alert_state" = 'resolved'
    )
    OR
    (
      "configuration_state" = 'broken'
      AND "consecutive_failures" >= 1
      AND "first_failed_at" IS NOT NULL
      AND "last_failed_at" IS NOT NULL
      AND "last_error_code" IS NOT NULL
      AND "last_error_digest" IS NOT NULL
      AND "disabled_reason" IS NULL
      AND "operator_alert_state" = 'pending'
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_scheduled_processor_health_alert_idx"
  ON "tokenless_scheduled_processor_health" ("operator_alert_state","last_failed_at")
  WHERE "operator_alert_state" = 'pending';--> statement-breakpoint
CREATE INDEX "tokenless_scheduled_processor_health_state_idx"
  ON "tokenless_scheduled_processor_health" ("configuration_state","updated_at");

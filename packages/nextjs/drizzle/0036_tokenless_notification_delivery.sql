ALTER TABLE "tokenless_notifications"
  ADD COLUMN "preference_key" text,
  ADD COLUMN "source_type" text,
  ADD COLUMN "source_key" text;
--> statement-breakpoint
ALTER TABLE "tokenless_notifications"
  ADD CONSTRAINT "tokenless_notifications_preference_check" CHECK (
    "preference_key" IS NULL OR
    "preference_key" IN ('assignmentAvailable', 'assignmentCompleted', 'paymentUpdates', 'askResults', 'accountSecurity')
  ),
  ADD CONSTRAINT "tokenless_notifications_source_pair_check" CHECK (
    ("source_type" IS NULL AND "source_key" IS NULL) OR
    ("source_type" IS NOT NULL AND "source_key" IS NOT NULL)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_notifications_principal_source_unique"
  ON "tokenless_notifications" USING btree ("principal_address", "source_type", "source_key");
--> statement-breakpoint
CREATE TABLE "tokenless_notification_email_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "notification_id" text NOT NULL REFERENCES "tokenless_notifications"("notification_id") ON DELETE CASCADE,
  "principal_address" text NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "preference_key" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "provider_message_id" text,
  "last_error" text,
  "delivered_at" timestamp with time zone,
  "suppressed_at" timestamp with time zone,
  "dead_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_notification_email_deliveries_notification_unique" UNIQUE("notification_id"),
  CONSTRAINT "tokenless_notification_email_deliveries_preference_check" CHECK (
    "preference_key" IN ('assignmentAvailable', 'assignmentCompleted', 'paymentUpdates', 'askResults', 'accountSecurity')
  ),
  CONSTRAINT "tokenless_notification_email_deliveries_state_check" CHECK (
    "state" IN ('pending', 'retry', 'delivering', 'delivered', 'suppressed', 'dead')
  ),
  CONSTRAINT "tokenless_notification_email_deliveries_attempt_check" CHECK ("attempt_count" BETWEEN 0 AND 8),
  CONSTRAINT "tokenless_notification_email_deliveries_terminal_check" CHECK (
    ("state" = 'delivered' AND "delivered_at" IS NOT NULL AND "suppressed_at" IS NULL AND "dead_at" IS NULL)
    OR ("state" = 'suppressed' AND "delivered_at" IS NULL AND "suppressed_at" IS NOT NULL AND "dead_at" IS NULL)
    OR ("state" = 'dead' AND "delivered_at" IS NULL AND "suppressed_at" IS NULL AND "dead_at" IS NOT NULL)
    OR ("state" IN ('pending', 'retry', 'delivering') AND "delivered_at" IS NULL AND "suppressed_at" IS NULL AND "dead_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_notification_email_deliveries_due_idx"
  ON "tokenless_notification_email_deliveries" USING btree ("state", "next_attempt_at", "created_at");
--> statement-breakpoint
CREATE INDEX "tokenless_notification_email_deliveries_principal_idx"
  ON "tokenless_notification_email_deliveries" USING btree ("principal_address", "created_at");

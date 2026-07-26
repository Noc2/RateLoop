-- Park configuration failures without consuming retry attempts.
ALTER TABLE "tokenless_notification_email_deliveries"
  ADD COLUMN "parked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_deliveries"
  DROP CONSTRAINT "tokenless_notification_email_deliveries_state_check",
  DROP CONSTRAINT "tokenless_notification_email_deliveries_terminal_check";
--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_deliveries"
  ADD CONSTRAINT "tokenless_notification_email_deliveries_state_check" CHECK (
    "state" IN ('pending', 'retry', 'delivering', 'delivered', 'suppressed', 'parked', 'dead')
  ),
  ADD CONSTRAINT "tokenless_notification_email_deliveries_terminal_check" CHECK (
    ("state" = 'delivered' AND "delivered_at" IS NOT NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
    OR ("state" = 'suppressed' AND "delivered_at" IS NULL AND "suppressed_at" IS NOT NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
    OR ("state" = 'parked' AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NOT NULL AND "dead_at" IS NULL)
    OR ("state" = 'dead' AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NOT NULL)
    OR ("state" IN ('pending', 'retry', 'delivering') AND "delivered_at" IS NULL
      AND "suppressed_at" IS NULL AND "parked_at" IS NULL AND "dead_at" IS NULL)
  );

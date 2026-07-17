CREATE TABLE "tokenless_workspace_alert_preferences" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "gate_blocked" boolean NOT NULL DEFAULT true,
  "review_failed" boolean NOT NULL DEFAULT true,
  "workspace_stop" boolean NOT NULL DEFAULT true,
  "coverage_floor_hit" boolean NOT NULL DEFAULT true,
  "disagreement_spike_bps" integer DEFAULT 2500,
  "browser_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_alert_preferences_spike_check" CHECK (
    "disagreement_spike_bps" IS NULL
    OR ("disagreement_spike_bps" BETWEEN 1 AND 10000)
  )
);
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  DROP CONSTRAINT "tokenless_assurance_event_outbox_type_check";
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_outbox"
  ADD CONSTRAINT "tokenless_assurance_event_outbox_type_check"
    CHECK ("event_type" IN (
      'ai.rateloop.review.completed',
      'ai.rateloop.review.failed',
      'ai.rateloop.review.expired',
      'ai.rateloop.packet.anchored',
      'ai.rateloop.gate.blocked'
    ));
--> statement-breakpoint
ALTER TABLE "tokenless_notifications"
  DROP CONSTRAINT "tokenless_notifications_preference_check";
--> statement-breakpoint
ALTER TABLE "tokenless_notifications"
  ADD CONSTRAINT "tokenless_notifications_preference_check" CHECK (
    "preference_key" IS NULL OR
    "preference_key" IN (
      'assignmentAvailable', 'assignmentCompleted', 'paymentUpdates', 'askResults', 'accountSecurity',
      'oversightAlerts'
    )
  );
--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_deliveries"
  DROP CONSTRAINT "tokenless_notification_email_deliveries_preference_check";
--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_deliveries"
  ADD CONSTRAINT "tokenless_notification_email_deliveries_preference_check" CHECK (
    "preference_key" IN (
      'assignmentAvailable', 'assignmentCompleted', 'paymentUpdates', 'askResults', 'accountSecurity',
      'oversightAlerts'
    )
  );
--> statement-breakpoint
ALTER TABLE "tokenless_notification_preferences"
  ADD COLUMN "oversight_alerts" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "tokenless_notification_email_subscriptions"
  ADD COLUMN "oversight_alerts" boolean NOT NULL DEFAULT false;

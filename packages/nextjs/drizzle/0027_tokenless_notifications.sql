CREATE TABLE "tokenless_notification_preferences" (
  "principal_address" text PRIMARY KEY NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "assignment_available" boolean DEFAULT true NOT NULL,
  "assignment_completed" boolean DEFAULT true NOT NULL,
  "payment_updates" boolean DEFAULT true NOT NULL,
  "ask_results" boolean DEFAULT true NOT NULL,
  "account_security" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tokenless_notification_preferences_updated_at_idx"
  ON "tokenless_notification_preferences" USING btree ("updated_at");
--> statement-breakpoint
CREATE TABLE "tokenless_notification_email_subscriptions" (
  "principal_address" text PRIMARY KEY NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "email" text NOT NULL,
  "verified_at" timestamp with time zone,
  "verification_token_hash" text,
  "verification_expires_at" timestamp with time zone,
  "unsubscribe_token_hash" text,
  "assignment_available" boolean DEFAULT true NOT NULL,
  "assignment_completed" boolean DEFAULT true NOT NULL,
  "payment_updates" boolean DEFAULT true NOT NULL,
  "ask_results" boolean DEFAULT true NOT NULL,
  "account_security" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_notification_email_subscriptions_email_unique"
  ON "tokenless_notification_email_subscriptions" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "tokenless_notification_email_subscriptions_verification_token_idx"
  ON "tokenless_notification_email_subscriptions" USING btree ("verification_token_hash");
--> statement-breakpoint
CREATE INDEX "tokenless_notification_email_subscriptions_unsubscribe_token_idx"
  ON "tokenless_notification_email_subscriptions" USING btree ("unsubscribe_token_hash");
--> statement-breakpoint
CREATE TABLE "tokenless_notifications" (
  "notification_id" text PRIMARY KEY NOT NULL,
  "principal_address" text NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tokenless_notifications_principal_created_idx"
  ON "tokenless_notifications" USING btree ("principal_address", "created_at");

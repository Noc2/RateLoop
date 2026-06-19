-- Watchlist and notification rows reference ContentRegistry-local content IDs.
-- Keep legacy rows unscoped, and scope new rows to the active ContentRegistry
-- deployment so World Chain and Base content IDs can safely overlap.
ALTER TABLE "watched_content" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "watched_content" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "watched_content" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
DROP INDEX IF EXISTS "watched_content_wallet_content_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "watched_content_legacy_wallet_content_unique" ON "watched_content" USING btree ("wallet_address","content_id") WHERE "deployment_key" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watched_content_deployment_wallet_content_unique" ON "watched_content" USING btree ("deployment_key","wallet_address","content_id") WHERE "deployment_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "watched_content_deployment_wallet_created_at_idx" ON "watched_content" USING btree ("deployment_key","wallet_address","created_at");--> statement-breakpoint

ALTER TABLE "notification_email_deliveries" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "notification_email_deliveries" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "notification_email_deliveries" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
CREATE INDEX "notification_email_deliveries_deployment_content_idx" ON "notification_email_deliveries" USING btree ("deployment_key","content_id");

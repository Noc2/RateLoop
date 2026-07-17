ALTER TABLE "tokenless_webhook_deliveries"
  ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_webhook_deliveries"
  ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_webhook_deliveries"
  ADD CONSTRAINT "tokenless_webhook_deliveries_lease_generation_check"
  CHECK ("lease_generation" BETWEEN 0 AND 2147483647);--> statement-breakpoint
CREATE INDEX "tokenless_webhook_deliveries_lease_idx"
  ON "tokenless_webhook_deliveries" USING btree ("state", "lease_expires_at");

ALTER TABLE "tokenless_assurance_event_deliveries"
  ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_event_deliveries"
  ADD CONSTRAINT "tokenless_assurance_event_deliveries_lease_generation_check"
  CHECK ("lease_generation" BETWEEN 0 AND 2147483647);

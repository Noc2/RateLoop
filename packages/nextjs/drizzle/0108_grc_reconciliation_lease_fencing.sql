ALTER TABLE "tokenless_assurance_grc_reconciliation_jobs"
  ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_grc_reconciliation_jobs"
  ADD CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_lease_generation_check"
  CHECK ("lease_generation" BETWEEN 0 AND 2147483647);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_grc_reconciliation_jobs_lease_idx"
  ON "tokenless_assurance_grc_reconciliation_jobs" USING btree
  ("state", "lease_expires_at", "lease_generation");

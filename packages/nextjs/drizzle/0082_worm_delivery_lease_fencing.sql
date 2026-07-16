ALTER TABLE "tokenless_assurance_worm_export_jobs"
  ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_worm_export_jobs"
  ADD CONSTRAINT "tokenless_assurance_worm_export_jobs_lease_generation_check"
  CHECK ("lease_generation" BETWEEN 0 AND 2147483647);

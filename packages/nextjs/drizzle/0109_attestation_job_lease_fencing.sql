UPDATE "tokenless_assurance_attestation_jobs"
SET "state" = 'retry',
    "next_attempt_at" = "updated_at",
    "lease_expires_at" = NULL,
    "last_error" = 'attestation_lease_fencing_migration_recovered'
WHERE "state" = 'processing';--> statement-breakpoint
ALTER TABLE "tokenless_assurance_attestation_jobs"
  ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_attestation_jobs"
  ADD COLUMN "claim_signer_key_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_attestation_jobs"
  ADD CONSTRAINT "tokenless_assurance_attestation_jobs_lease_generation_check"
  CHECK ("lease_generation" BETWEEN 0 AND 2147483647);--> statement-breakpoint
ALTER TABLE "tokenless_assurance_attestation_jobs"
  ADD CONSTRAINT "tokenless_assurance_attestation_jobs_claim_signer_key_check"
  CHECK (
    ("state" = 'processing' AND "claim_signer_key_id" IS NOT NULL
      AND "claim_signer_key_id" ~ '^[A-Za-z0-9:._/-]{1,200}$')
    OR ("state" <> 'processing' AND "claim_signer_key_id" IS NULL)
  );--> statement-breakpoint
CREATE INDEX "tokenless_assurance_attestation_jobs_lease_generation_idx"
  ON "tokenless_assurance_attestation_jobs" USING btree
  ("state", "lease_expires_at", "lease_generation");

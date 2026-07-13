ALTER TABLE "tokenless_rater_profiles" ADD COLUMN "nullifier_key_domain" text;--> statement-breakpoint
ALTER TABLE "tokenless_eligibility_provider_handoffs" ADD COLUMN "provider_result_key_domain" text;--> statement-breakpoint
CREATE TABLE "tokenless_capability_eligibility" (
  "rater_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "provider_id" text NOT NULL,
  "provider_assertion_hash" text NOT NULL,
  "provider_assertion_id_hash" text NOT NULL,
  "provider_subject_hash" text NOT NULL,
  "capabilities_json" text NOT NULL,
  "provider_evidence_ciphertext" text NOT NULL,
  "provider_evidence_key_version" text NOT NULL,
  "provider_evidence_key_domain" text NOT NULL,
  "evidence_verified_at" timestamp with time zone NOT NULL,
  "evidence_expires_at" timestamp with time zone NOT NULL,
  "minimum_age_verified" integer,
  "document_issuing_country" text,
  "nationality_country" text,
  "verified_residence_country" text,
  "declared_residence_country" text NOT NULL,
  "tax_residence_country" text NOT NULL,
  "residence_tax_status" text NOT NULL,
  "tax_profile_status" text NOT NULL,
  "dac7_status" text NOT NULL,
  "tax_vault_ciphertext" text,
  "tax_vault_key_version" text,
  "tax_vault_key_domain" text,
  "sanctions_consent_at" timestamp with time zone NOT NULL,
  "sanctions_status" text NOT NULL,
  "sanctions_reference_hash" text NOT NULL,
  "sanctions_screened_at" timestamp with time zone NOT NULL,
  "sanctions_expires_at" timestamp with time zone NOT NULL,
  "payout_account" text NOT NULL,
  "payout_ownership_method" text NOT NULL,
  "payout_verified_at" timestamp with time zone NOT NULL,
  "reviewer_source" text NOT NULL,
  "cohort_ids_json" text NOT NULL,
  "qualification_keys_json" text NOT NULL,
  "eligibility_status" text NOT NULL,
  "blocked_reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_capability_eligibility_assertion_unique" UNIQUE("provider_id", "provider_assertion_id_hash"),
  CONSTRAINT "tokenless_capability_eligibility_subject_unique" UNIQUE("provider_id", "provider_subject_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_capability_eligibility_status_idx" ON "tokenless_capability_eligibility" USING btree ("eligibility_status", "evidence_expires_at", "sanctions_expires_at");--> statement-breakpoint
DROP TABLE "tokenless_paid_eligibility";--> statement-breakpoint
ALTER TABLE "tokenless_rater_profiles" DROP COLUMN "identity_subject_hash";--> statement-breakpoint
ALTER TABLE "tokenless_voucher_rounds" DROP COLUMN "required_tier_id";--> statement-breakpoint
ALTER TABLE "tokenless_voucher_rounds" ADD COLUMN "admission_policy_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_voucher_rounds" ADD COLUMN "admission_policy_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_voucher_rounds" ADD COLUMN "maximum_commits" integer;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" DROP COLUMN "identity_subject_hash";--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" DROP COLUMN "tier_id";--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" ADD COLUMN "admission_policy_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" ADD CONSTRAINT "tokenless_paid_vouchers_round_rater_unique" UNIQUE("chain_id", "panel_address", "round_id", "rater_id");

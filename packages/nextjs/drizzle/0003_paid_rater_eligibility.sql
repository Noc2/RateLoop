CREATE TABLE "tokenless_rater_profiles" (
  "rater_id" text PRIMARY KEY NOT NULL,
  "account_address" text NOT NULL,
  "identity_subject_hash" text NOT NULL,
  "nullifier_seed_ciphertext" text NOT NULL,
  "nullifier_key_version" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_rater_profiles_account_unique" UNIQUE("account_address"),
  CONSTRAINT "tokenless_rater_profiles_identity_subject_unique" UNIQUE("identity_subject_hash")
);--> statement-breakpoint
CREATE TABLE "tokenless_paid_eligibility" (
  "rater_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "provider_id" text NOT NULL,
  "provider_assertion_hash" text NOT NULL,
  "provider_assertion_id_hash" text NOT NULL,
  "identity_tier_id" integer NOT NULL,
  "identity_verified_at" timestamp with time zone NOT NULL,
  "identity_expires_at" timestamp with time zone NOT NULL,
  "adult_verified" boolean NOT NULL,
  "residence_country" text NOT NULL,
  "tax_residence_country" text NOT NULL,
  "tax_profile_status" text NOT NULL,
  "dac7_status" text NOT NULL,
  "dac7_vault_ciphertext" text,
  "dac7_key_version" text,
  "sanctions_consent_at" timestamp with time zone NOT NULL,
  "sanctions_status" text NOT NULL,
  "sanctions_reference_hash" text NOT NULL,
  "sanctions_screened_at" timestamp with time zone NOT NULL,
  "sanctions_expires_at" timestamp with time zone NOT NULL,
  "payout_account" text NOT NULL,
  "payout_ownership_method" text NOT NULL,
  "payout_verified_at" timestamp with time zone NOT NULL,
  "eligibility_status" text NOT NULL,
  "blocked_reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_eligibility_assertion_unique" UNIQUE("provider_id", "provider_assertion_id_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_status_idx" ON "tokenless_paid_eligibility" USING btree ("eligibility_status", "identity_expires_at", "sanctions_expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_eligibility_provider_handoffs" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "account_address" text NOT NULL,
  "provider_id" text NOT NULL,
  "status" text NOT NULL,
  "provider_result_ciphertext" text,
  "provider_result_key_version" text,
  "provider_result_expires_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "consumed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "tokenless_eligibility_provider_handoffs_account_status_idx" ON "tokenless_eligibility_provider_handoffs" USING btree ("account_address", "status", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_voucher_rounds" (
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "round_id" numeric(78, 0) NOT NULL,
  "content_id" text NOT NULL,
  "required_tier_id" integer NOT NULL,
  "voucher_not_before" timestamp with time zone NOT NULL,
  "voucher_deadline" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("chain_id", "panel_address", "round_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_voucher_rounds_status_deadline_idx" ON "tokenless_voucher_rounds" USING btree ("status", "voucher_deadline");--> statement-breakpoint
CREATE TABLE "tokenless_paid_vouchers" (
  "voucher_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "identity_subject_hash" text NOT NULL,
  "request_idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "issuer_address" text NOT NULL,
  "issuer_epoch" numeric(20, 0) NOT NULL,
  "signer_address" text NOT NULL,
  "round_id" numeric(78, 0) NOT NULL,
  "content_id" text NOT NULL,
  "vote_key" text NOT NULL,
  "nullifier" text NOT NULL,
  "tier_id" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "voucher_json" text NOT NULL,
  "voucher_signature" text NOT NULL,
  "status" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "committed_at" timestamp with time zone,
  CONSTRAINT "tokenless_paid_vouchers_rater_request_unique" UNIQUE("rater_id", "request_idempotency_key"),
  CONSTRAINT "tokenless_paid_vouchers_round_identity_unique" UNIQUE("chain_id", "panel_address", "round_id", "identity_subject_hash"),
  CONSTRAINT "tokenless_paid_vouchers_nullifier_unique" UNIQUE("chain_id", "panel_address", "nullifier"),
  CONSTRAINT "tokenless_paid_vouchers_vote_key_unique" UNIQUE("chain_id", "panel_address", "round_id", "vote_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_vouchers_round_status_idx" ON "tokenless_paid_vouchers" USING btree ("chain_id", "panel_address", "round_id", "status");

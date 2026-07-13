CREATE TABLE "tokenless_provider_subject_bindings" (
  "binding_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "provider_id" text NOT NULL,
  "provider_namespace" text NOT NULL,
  "subject_reference_hash" text NOT NULL,
  "subject_reference_scheme" text NOT NULL,
  "continuity_ciphertext" text,
  "continuity_key_version" text,
  "continuity_key_domain" text,
  "status" text NOT NULL,
  "bound_at" timestamp with time zone NOT NULL,
  "last_verified_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_provider_subject_bindings_subject_unique" UNIQUE("provider_id", "provider_namespace", "subject_reference_hash"),
  CONSTRAINT "tokenless_provider_subject_bindings_rater_namespace_unique" UNIQUE("rater_id", "provider_id", "provider_namespace"),
  CONSTRAINT "tokenless_provider_subject_bindings_scheme_check" CHECK ("subject_reference_scheme" IN ('hmac-sha256-v1', 'legacy-sha256-v2')),
  CONSTRAINT "tokenless_provider_subject_bindings_status_check" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "tokenless_provider_subject_bindings_continuity_check" CHECK (("continuity_ciphertext" IS NULL AND "continuity_key_version" IS NULL AND "continuity_key_domain" IS NULL) OR ("continuity_ciphertext" IS NOT NULL AND "continuity_key_version" IS NOT NULL AND "continuity_key_domain" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "tokenless_provider_subject_bindings_rater_status_idx" ON "tokenless_provider_subject_bindings" USING btree ("rater_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_assertions" (
  "assertion_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "binding_id" text NOT NULL REFERENCES "tokenless_provider_subject_bindings"("binding_id"),
  "provider_id" text NOT NULL,
  "provider_namespace" text NOT NULL,
  "provider_assertion_hash" text NOT NULL,
  "provider_assertion_id_hash" text NOT NULL,
  "provider_assertion_reference_scheme" text NOT NULL,
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
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_assertions_provider_assertion_unique" UNIQUE("provider_id", "provider_namespace", "provider_assertion_id_hash"),
  CONSTRAINT "tokenless_assurance_assertions_reference_scheme_check" CHECK ("provider_assertion_reference_scheme" IN ('hmac-sha256-v1', 'legacy-sha256-v2')),
  CONSTRAINT "tokenless_assurance_assertions_status_check" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "tokenless_assurance_assertions_minimum_age_check" CHECK ("minimum_age_verified" IS NULL OR ("minimum_age_verified" >= 0 AND "minimum_age_verified" <= 120)),
  CONSTRAINT "tokenless_assurance_assertions_lifetime_check" CHECK ("evidence_expires_at" > "evidence_verified_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_assertions_rater_status_expiry_idx" ON "tokenless_assurance_assertions" USING btree ("rater_id", "status", "evidence_expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_assertions_provider_status_idx" ON "tokenless_assurance_assertions" USING btree ("provider_id", "provider_namespace", "status");--> statement-breakpoint
CREATE TABLE "tokenless_legal_eligibility" (
  "rater_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "minimum_age_verified" integer,
  "age_evidence_verified_at" timestamp with time zone,
  "age_evidence_expires_at" timestamp with time zone,
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
  "eligibility_status" text NOT NULL,
  "blocked_reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_legal_eligibility_minimum_age_check" CHECK ("minimum_age_verified" IS NULL OR ("minimum_age_verified" >= 0 AND "minimum_age_verified" <= 120)),
  CONSTRAINT "tokenless_legal_eligibility_age_evidence_check" CHECK (("age_evidence_verified_at" IS NULL AND "age_evidence_expires_at" IS NULL) OR ("age_evidence_verified_at" IS NOT NULL AND "age_evidence_expires_at" > "age_evidence_verified_at")),
  CONSTRAINT "tokenless_legal_eligibility_tax_vault_check" CHECK (("tax_vault_ciphertext" IS NULL AND "tax_vault_key_version" IS NULL AND "tax_vault_key_domain" IS NULL) OR ("tax_vault_ciphertext" IS NOT NULL AND "tax_vault_key_version" IS NOT NULL AND "tax_vault_key_domain" IS NOT NULL)),
  CONSTRAINT "tokenless_legal_eligibility_sanctions_lifetime_check" CHECK ("sanctions_expires_at" > "sanctions_screened_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_legal_eligibility_status_expiry_idx" ON "tokenless_legal_eligibility" USING btree ("eligibility_status", "sanctions_expires_at", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_payout_eligibility" (
  "rater_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "payout_account" text NOT NULL,
  "payout_ownership_method" text NOT NULL,
  "payout_verified_at" timestamp with time zone NOT NULL,
  "payout_expires_at" timestamp with time zone,
  "eligibility_status" text NOT NULL,
  "blocked_reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_payout_eligibility_lifetime_check" CHECK ("payout_expires_at" IS NULL OR "payout_expires_at" > "payout_verified_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_payout_eligibility_status_expiry_idx" ON "tokenless_payout_eligibility" USING btree ("eligibility_status", "payout_expires_at", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_reviewer_qualifications" (
  "qualification_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "reviewer_source" text NOT NULL,
  "qualification_kind" text NOT NULL,
  "cohort_ids_json" text NOT NULL,
  "qualification_keys_json" text NOT NULL,
  "provenance_ciphertext" text,
  "provenance_key_version" text,
  "provenance_key_domain" text,
  "verified_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_reviewer_qualifications_kind_check" CHECK ("qualification_kind" IN ('cohort', 'gold', 'practice', 'task', 'invitation', 'legacy_snapshot')),
  CONSTRAINT "tokenless_reviewer_qualifications_status_check" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "tokenless_reviewer_qualifications_lifetime_check" CHECK ("expires_at" IS NULL OR "expires_at" > "verified_at"),
  CONSTRAINT "tokenless_reviewer_qualifications_provenance_check" CHECK (("provenance_ciphertext" IS NULL AND "provenance_key_version" IS NULL AND "provenance_key_domain" IS NULL) OR ("provenance_ciphertext" IS NOT NULL AND "provenance_key_version" IS NOT NULL AND "provenance_key_domain" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_qualifications_rater_status_expiry_idx" ON "tokenless_reviewer_qualifications" USING btree ("rater_id", "reviewer_source", "status", "expires_at");--> statement-breakpoint
INSERT INTO "tokenless_provider_subject_bindings"
  ("binding_id", "rater_id", "provider_id", "provider_namespace", "subject_reference_hash",
   "subject_reference_scheme", "status", "bound_at", "last_verified_at", "created_at", "updated_at")
SELECT 'bind_legacy_' || "rater_id", "rater_id", "provider_id", 'legacy:v2', "provider_subject_hash",
       'legacy-sha256-v2', 'active', "evidence_verified_at", "evidence_verified_at", "created_at", "updated_at"
FROM "tokenless_capability_eligibility";--> statement-breakpoint
INSERT INTO "tokenless_assurance_assertions"
  ("assertion_id", "rater_id", "binding_id", "provider_id", "provider_namespace",
   "provider_assertion_hash", "provider_assertion_id_hash", "provider_assertion_reference_scheme",
   "capabilities_json", "provider_evidence_ciphertext", "provider_evidence_key_version",
   "provider_evidence_key_domain", "evidence_verified_at", "evidence_expires_at",
   "minimum_age_verified", "document_issuing_country", "nationality_country",
   "verified_residence_country", "status", "created_at", "updated_at")
SELECT 'assert_legacy_' || "rater_id", "rater_id", 'bind_legacy_' || "rater_id", "provider_id", 'legacy:v2',
       "provider_assertion_hash", "provider_assertion_id_hash", 'legacy-sha256-v2',
       "capabilities_json", "provider_evidence_ciphertext", "provider_evidence_key_version",
       "provider_evidence_key_domain", "evidence_verified_at", "evidence_expires_at",
       "minimum_age_verified", "document_issuing_country", "nationality_country",
       "verified_residence_country", 'active', "created_at", "updated_at"
FROM "tokenless_capability_eligibility";--> statement-breakpoint
INSERT INTO "tokenless_legal_eligibility"
  ("rater_id", "minimum_age_verified", "age_evidence_verified_at", "age_evidence_expires_at",
   "verified_residence_country", "declared_residence_country", "tax_residence_country",
   "residence_tax_status", "tax_profile_status", "dac7_status", "tax_vault_ciphertext",
   "tax_vault_key_version", "tax_vault_key_domain", "sanctions_consent_at", "sanctions_status",
   "sanctions_reference_hash", "sanctions_screened_at", "sanctions_expires_at",
   "eligibility_status", "blocked_reason", "created_at", "updated_at")
SELECT "rater_id", "minimum_age_verified", "evidence_verified_at", "evidence_expires_at",
       "verified_residence_country", "declared_residence_country", "tax_residence_country",
       "residence_tax_status", "tax_profile_status", "dac7_status", "tax_vault_ciphertext",
       "tax_vault_key_version", "tax_vault_key_domain", "sanctions_consent_at", "sanctions_status",
       "sanctions_reference_hash", "sanctions_screened_at", "sanctions_expires_at",
       "eligibility_status", "blocked_reason", "created_at", "updated_at"
FROM "tokenless_capability_eligibility";--> statement-breakpoint
INSERT INTO "tokenless_payout_eligibility"
  ("rater_id", "payout_account", "payout_ownership_method", "payout_verified_at",
   "payout_expires_at", "eligibility_status", "blocked_reason", "created_at", "updated_at")
SELECT "rater_id", "payout_account", "payout_ownership_method", "payout_verified_at",
       NULL, 'ready', NULL, "created_at", "updated_at"
FROM "tokenless_capability_eligibility";--> statement-breakpoint
INSERT INTO "tokenless_reviewer_qualifications"
  ("qualification_id", "rater_id", "reviewer_source", "qualification_kind", "cohort_ids_json",
   "qualification_keys_json", "verified_at", "expires_at", "status", "created_at", "updated_at")
SELECT 'qual_legacy_' || "rater_id", "rater_id", "reviewer_source", 'legacy_snapshot', "cohort_ids_json",
       "qualification_keys_json", "evidence_verified_at", "evidence_expires_at", 'active', "created_at", "updated_at"
FROM "tokenless_capability_eligibility";

DROP INDEX "tokenless_legal_eligibility_status_expiry_idx";--> statement-breakpoint
ALTER TABLE "tokenless_legal_eligibility" RENAME TO "tokenless_legal_eligibility_legacy";--> statement-breakpoint
ALTER TABLE "tokenless_legal_eligibility_legacy"
  DROP CONSTRAINT "tokenless_legal_eligibility_pkey";--> statement-breakpoint

CREATE TABLE "tokenless_legal_eligibility" (
  "scope_id" text PRIMARY KEY NOT NULL
    REFERENCES "tokenless_paid_eligibility_scopes"("scope_id") ON DELETE RESTRICT,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "reviewer_source" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "sanctions_screening_id" text NOT NULL
    REFERENCES "tokenless_sanctions_screenings"("screening_id") ON DELETE RESTRICT,
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
  CONSTRAINT "tokenless_legal_eligibility_lane_check" CHECK (
    (
      "reviewer_source" = 'customer_invited'
      AND "workspace_id" IS NOT NULL
    )
    OR
    (
      "reviewer_source" = 'rateloop_network'
      AND "workspace_id" IS NULL
    )
  ),
  CONSTRAINT "tokenless_legal_eligibility_minimum_age_check"
    CHECK ("minimum_age_verified" IS NULL OR ("minimum_age_verified" >= 0 AND "minimum_age_verified" <= 120)),
  CONSTRAINT "tokenless_legal_eligibility_age_evidence_check" CHECK (
    ("age_evidence_verified_at" IS NULL AND "age_evidence_expires_at" IS NULL)
    OR
    ("age_evidence_verified_at" IS NOT NULL AND "age_evidence_expires_at" > "age_evidence_verified_at")
  ),
  CONSTRAINT "tokenless_legal_eligibility_tax_vault_check" CHECK (
    (
      "tax_vault_ciphertext" IS NULL
      AND "tax_vault_key_version" IS NULL
      AND "tax_vault_key_domain" IS NULL
    )
    OR
    (
      "tax_vault_ciphertext" IS NOT NULL
      AND "tax_vault_key_version" IS NOT NULL
      AND "tax_vault_key_domain" = 'tax_records'
    )
  ),
  CONSTRAINT "tokenless_legal_eligibility_sanctions_lifetime_check"
    CHECK ("sanctions_expires_at" > "sanctions_screened_at")
);--> statement-breakpoint

CREATE UNIQUE INDEX "tokenless_legal_eligibility_exact_lane_unique"
  ON "tokenless_legal_eligibility"
  ("rater_id", "reviewer_source", COALESCE("workspace_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_legal_eligibility_screening_unique"
  ON "tokenless_legal_eligibility" ("sanctions_screening_id");--> statement-breakpoint
CREATE INDEX "tokenless_legal_eligibility_status_expiry_idx"
  ON "tokenless_legal_eligibility"
  ("reviewer_source", "eligibility_status", "sanctions_expires_at", "updated_at");--> statement-breakpoint

INSERT INTO "tokenless_legal_eligibility"
  ("scope_id","rater_id","reviewer_source","workspace_id","sanctions_screening_id",
   "minimum_age_verified","age_evidence_verified_at","age_evidence_expires_at",
   "verified_residence_country","declared_residence_country","tax_residence_country",
   "residence_tax_status","tax_profile_status","dac7_status","tax_vault_ciphertext",
   "tax_vault_key_version","tax_vault_key_domain","sanctions_consent_at",
   "sanctions_status","sanctions_reference_hash","sanctions_screened_at",
   "sanctions_expires_at","eligibility_status","blocked_reason","created_at","updated_at")
SELECT scope."scope_id",legacy."rater_id",scope."reviewer_source",scope."workspace_id",
       scope."sanctions_screening_id",legacy."minimum_age_verified",
       legacy."age_evidence_verified_at",legacy."age_evidence_expires_at",
       CASE WHEN scope."reviewer_source" = 'rateloop_network'
            THEN legacy."verified_residence_country" ELSE NULL END,
       legacy."declared_residence_country",legacy."tax_residence_country",
       legacy."residence_tax_status",legacy."tax_profile_status",legacy."dac7_status",
       legacy."tax_vault_ciphertext",legacy."tax_vault_key_version",
       legacy."tax_vault_key_domain",legacy."sanctions_consent_at",
       screening."status",legacy."sanctions_reference_hash",legacy."sanctions_screened_at",
       legacy."sanctions_expires_at",scope."status",scope."blocked_reason",
       legacy."created_at",
       CASE WHEN legacy."updated_at" >= scope."updated_at"
            THEN legacy."updated_at" ELSE scope."updated_at" END
FROM "tokenless_legal_eligibility_legacy" legacy
JOIN "tokenless_paid_eligibility_scopes" scope ON scope."rater_id" = legacy."rater_id"
JOIN "tokenless_sanctions_screenings" screening
  ON screening."screening_id" = scope."sanctions_screening_id";--> statement-breakpoint

DROP TABLE "tokenless_legal_eligibility_legacy";

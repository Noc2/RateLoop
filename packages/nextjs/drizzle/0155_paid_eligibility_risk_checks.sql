CREATE TABLE "tokenless_paid_eligibility_risk_checks" (
  "risk_check_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "source_scope_reference" text NOT NULL,
  "edge_country" text NOT NULL,
  "edge_region" text,
  "locale_country" text,
  "geoblock_status" text NOT NULL,
  "plausibility_status" text NOT NULL,
  "plausibility_reason_codes_json" text NOT NULL,
  "wallet_reference_hash" text NOT NULL,
  "wallet_screening_provider" text NOT NULL,
  "wallet_screening_status" text NOT NULL,
  "wallet_screening_reference_hash" text NOT NULL,
  "wallet_list_snapshot_hash" text NOT NULL,
  "checked_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "delete_after" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_id_check"
    CHECK ("risk_check_id" ~ '^per_[0-9a-f]{32}$'),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_geo_check"
    CHECK ("edge_country" ~ '^[A-Z]{2}$' AND ("edge_region" IS NULL OR "edge_region" ~ '^[A-Z0-9-]{1,32}$')),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_locale_check"
    CHECK ("locale_country" IS NULL OR "locale_country" ~ '^[A-Z]{2}$'),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_geoblock_check"
    CHECK ("geoblock_status" = 'clear'),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_plausibility_check"
    CHECK ("plausibility_status" IN ('pass','review')),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_wallet_check"
    CHECK ("wallet_screening_status" IN ('clear','review','match')),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_hashes_check" CHECK (
    "wallet_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "wallet_screening_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "wallet_list_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_paid_eligibility_risk_checks_lifetime_check"
    CHECK ("expires_at" > "checked_at" AND "delete_after" >= "expires_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_risk_checks_rater_idx"
  ON "tokenless_paid_eligibility_risk_checks" ("rater_id", "checked_at");--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_risk_checks_retention_idx"
  ON "tokenless_paid_eligibility_risk_checks" ("delete_after", "risk_check_id");--> statement-breakpoint

ALTER TABLE "tokenless_legal_eligibility"
  ADD COLUMN "risk_check_id" text
    REFERENCES "tokenless_paid_eligibility_risk_checks"("risk_check_id") ON DELETE RESTRICT;

-- Retain the statutory DAC7 record separately from the operational profile.
CREATE TABLE "tokenless_dac7_records" (
  "record_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "source_scope_reference" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "workspace_reference" text,
  "reporting_year" integer NOT NULL,
  "dataset_schema_version" integer NOT NULL DEFAULT 2,
  "tax_vault_ciphertext" text NOT NULL,
  "tax_vault_key_version" text NOT NULL,
  "tax_vault_key_domain" text NOT NULL,
  "retention_basis" text NOT NULL,
  "collected_at" timestamp with time zone NOT NULL,
  "retained_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dac7_records_id_check"
    CHECK ("record_id" ~ '^dac7_[0-9a-f]{32}$'),
  CONSTRAINT "tokenless_dac7_records_source_check"
    CHECK ("reviewer_source" IN ('customer_invited','rateloop_network')),
  CONSTRAINT "tokenless_dac7_records_year_check"
    CHECK ("reporting_year" >= 2024 AND "reporting_year" <= 9999),
  CONSTRAINT "tokenless_dac7_records_schema_check"
    CHECK ("dataset_schema_version" = 2),
  CONSTRAINT "tokenless_dac7_records_vault_check"
    CHECK ("tax_vault_key_domain" = 'tax_records'),
  CONSTRAINT "tokenless_dac7_records_basis_check"
    CHECK ("retention_basis" = 'psttg_dac7_ao_147'),
  CONSTRAINT "tokenless_dac7_records_retention_check"
    CHECK ("retained_until" > "collected_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_dac7_records_retention_idx"
  ON "tokenless_dac7_records" ("retained_until", "record_id");--> statement-breakpoint
CREATE INDEX "tokenless_dac7_records_rater_idx"
  ON "tokenless_dac7_records" ("rater_id", "reporting_year", "record_id");--> statement-breakpoint

ALTER TABLE "tokenless_legal_eligibility"
  ADD COLUMN "dac7_record_id" text
    REFERENCES "tokenless_dac7_records"("record_id") ON DELETE RESTRICT;--> statement-breakpoint

INSERT INTO "tokenless_dac7_records"
  ("record_id","rater_id","source_scope_reference","reviewer_source","workspace_reference",
   "reporting_year","dataset_schema_version","tax_vault_ciphertext","tax_vault_key_version",
   "tax_vault_key_domain","retention_basis","collected_at","retained_until","created_at")
SELECT 'dac7_' || substr(md5(legal."scope_id" || ':' || legal."created_at"::text),1,32),
       legal."rater_id",legal."scope_id",legal."reviewer_source",legal."workspace_id",
       EXTRACT(YEAR FROM legal."created_at")::integer,2,legal."tax_vault_ciphertext",
       legal."tax_vault_key_version",legal."tax_vault_key_domain",'psttg_dac7_ao_147',
       legal."created_at",
       make_timestamptz(EXTRACT(YEAR FROM legal."created_at")::integer + 11,1,1,0,0,0,'UTC'),
       legal."created_at"
FROM "tokenless_legal_eligibility" legal
WHERE legal."dac7_status" = 'complete' AND legal."tax_vault_ciphertext" IS NOT NULL;--> statement-breakpoint

UPDATE "tokenless_legal_eligibility" legal
SET "dac7_record_id" = record."record_id",
    "tax_vault_ciphertext" = NULL,
    "tax_vault_key_version" = NULL,
    "tax_vault_key_domain" = NULL
FROM "tokenless_dac7_records" record
WHERE record."source_scope_reference" = legal."scope_id";--> statement-breakpoint

ALTER TABLE "tokenless_legal_eligibility"
  ADD CONSTRAINT "tokenless_legal_eligibility_dac7_record_check" CHECK (
    ("dac7_status" = 'complete' AND "dac7_record_id" IS NOT NULL)
    OR
    ("dac7_status" <> 'complete' AND "dac7_record_id" IS NULL)
  );--> statement-breakpoint

CREATE TABLE "tokenless_paid_eligibility_decisions" (
  "decision_id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "reviewer_source" text NOT NULL,
  "workspace_id" text,
  "decision" text NOT NULL,
  "notice_version" text NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  "delete_after" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_eligibility_decisions_id_check"
    CHECK ("decision_id" ~ '^ped_[0-9a-f]{32}$'),
  CONSTRAINT "tokenless_paid_eligibility_decisions_source_check"
    CHECK ("reviewer_source" IN ('customer_invited','rateloop_network')),
  CONSTRAINT "tokenless_paid_eligibility_decisions_lane_check" CHECK (
    ("reviewer_source" = 'customer_invited' AND "workspace_id" IS NOT NULL)
    OR
    ("reviewer_source" = 'rateloop_network' AND "workspace_id" IS NULL)
  ),
  CONSTRAINT "tokenless_paid_eligibility_decisions_value_check"
    CHECK ("decision" = 'declined_paid_data_collection'),
  CONSTRAINT "tokenless_paid_eligibility_decisions_notice_check"
    CHECK ("notice_version" = 'paid-eligibility-v2'),
  CONSTRAINT "tokenless_paid_eligibility_decisions_retention_check"
    CHECK ("delete_after" > "decided_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_decisions_principal_idx"
  ON "tokenless_paid_eligibility_decisions" ("principal_id", "decided_at");--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_decisions_retention_idx"
  ON "tokenless_paid_eligibility_decisions" ("delete_after", "decision_id");

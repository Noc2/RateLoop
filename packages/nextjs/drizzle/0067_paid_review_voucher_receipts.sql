CREATE TABLE "tokenless_paid_review_eligibility_snapshots" (
  "snapshot_id" text PRIMARY KEY NOT NULL,
  "snapshot_version" integer NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "rater_id" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "audience_binding_hash" text NOT NULL,
  "economics_hash" text NOT NULL,
  "paid_eligibility_preflight_ref" text NOT NULL,
  "paid_eligibility_preflight_hash" text NOT NULL,
  "snapshot_json" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_exact_unique"
    UNIQUE ("snapshot_id", "snapshot_version", "snapshot_hash"),
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_hash_unique"
    UNIQUE ("snapshot_hash"),
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_rater_fk"
    FOREIGN KEY ("rater_id") REFERENCES "tokenless_rater_profiles" ("rater_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_version_check"
    CHECK ("snapshot_version" = 1),
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_hashes_check" CHECK (
    "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audience_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "paid_eligibility_preflight_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_reference_check"
    CHECK (char_length("paid_eligibility_preflight_ref") BETWEEN 8 AND 512),
  CONSTRAINT "tokenless_paid_review_eligibility_snapshots_timestamps_check" CHECK (
    "verified_at" <= "created_at" AND "expires_at" > "created_at"
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_review_eligibility_snapshots_opportunity_idx"
  ON "tokenless_paid_review_eligibility_snapshots" USING btree
  ("workspace_id", "opportunity_id", "rater_id", "created_at");--> statement-breakpoint

CREATE TABLE "tokenless_paid_review_voucher_issuances" (
  "issuance_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "rater_id" text NOT NULL,
  "request_idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "snapshot_id" text NOT NULL,
  "snapshot_version" integer NOT NULL,
  "snapshot_hash" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "audience_binding_hash" text NOT NULL,
  "economics_hash" text NOT NULL,
  "paid_eligibility_preflight_ref" text NOT NULL,
  "paid_eligibility_preflight_hash" text NOT NULL,
  "voucher_id" text,
  "voucher_binding_hash" text,
  "status" text NOT NULL DEFAULT 'prepared',
  "issued_at" timestamp with time zone,
  "consumption_idempotency_key" text,
  "consumption_request_hash" text,
  "consumption_reference" text,
  "consumption_evidence_hash" text,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_rater_request_unique"
    UNIQUE ("rater_id", "request_idempotency_key"),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_opportunity_rater_unique"
    UNIQUE ("workspace_id", "opportunity_id", "rater_id"),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_voucher_unique" UNIQUE ("voucher_id"),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_consumption_unique" UNIQUE ("consumption_reference"),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_rater_fk"
    FOREIGN KEY ("rater_id") REFERENCES "tokenless_rater_profiles" ("rater_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_snapshot_fk"
    FOREIGN KEY ("snapshot_id", "snapshot_version", "snapshot_hash")
    REFERENCES "tokenless_paid_review_eligibility_snapshots"
      ("snapshot_id", "snapshot_version", "snapshot_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_voucher_fk"
    FOREIGN KEY ("voucher_id") REFERENCES "tokenless_paid_vouchers" ("voucher_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_issuances_hashes_check" CHECK (
    "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audience_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "paid_eligibility_preflight_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND ("voucher_binding_hash" IS NULL OR "voucher_binding_hash" ~ '^sha256:[0-9a-f]{64}$')
    AND ("consumption_request_hash" IS NULL OR "consumption_request_hash" ~ '^sha256:[0-9a-f]{64}$')
    AND ("consumption_evidence_hash" IS NULL OR "consumption_evidence_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_reference_check" CHECK (
    char_length("paid_eligibility_preflight_ref") BETWEEN 8 AND 512
    AND char_length("request_idempotency_key") BETWEEN 8 AND 160
    AND ("consumption_idempotency_key" IS NULL OR char_length("consumption_idempotency_key") BETWEEN 8 AND 160)
    AND ("consumption_reference" IS NULL OR char_length("consumption_reference") BETWEEN 8 AND 512)
  ),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_status_check"
    CHECK ("status" IN ('prepared', 'issued', 'consumed')),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_state_check" CHECK (
    (
      "status" = 'prepared' AND "voucher_id" IS NULL AND "voucher_binding_hash" IS NULL
      AND "issued_at" IS NULL AND "consumption_idempotency_key" IS NULL
      AND "consumption_request_hash" IS NULL AND "consumption_reference" IS NULL
      AND "consumption_evidence_hash" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'issued' AND "voucher_id" IS NOT NULL AND "voucher_binding_hash" IS NOT NULL
      AND "issued_at" IS NOT NULL AND "consumption_idempotency_key" IS NULL
      AND "consumption_request_hash" IS NULL AND "consumption_reference" IS NULL
      AND "consumption_evidence_hash" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'consumed' AND "voucher_id" IS NOT NULL AND "voucher_binding_hash" IS NOT NULL
      AND "issued_at" IS NOT NULL AND "consumption_idempotency_key" IS NOT NULL
      AND "consumption_request_hash" IS NOT NULL AND "consumption_reference" IS NOT NULL
      AND "consumption_evidence_hash" IS NOT NULL AND "consumed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_paid_review_voucher_issuances_timestamps_check" CHECK (
    "updated_at" >= "created_at"
    AND ("issued_at" IS NULL OR ("issued_at" >= "created_at" AND "issued_at" <= "updated_at"))
    AND ("consumed_at" IS NULL OR ("consumed_at" >= "issued_at" AND "consumed_at" <= "updated_at"))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_review_voucher_issuances_state_idx"
  ON "tokenless_paid_review_voucher_issuances" USING btree
  ("workspace_id", "status", "updated_at");--> statement-breakpoint

CREATE TABLE "tokenless_paid_review_voucher_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "issuance_id" text NOT NULL,
  "receipt_type" text NOT NULL,
  "receipt_version" integer NOT NULL,
  "receipt_json" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_review_voucher_receipts_issuance_type_unique"
    UNIQUE ("issuance_id", "receipt_type"),
  CONSTRAINT "tokenless_paid_review_voucher_receipts_hash_unique" UNIQUE ("receipt_hash"),
  CONSTRAINT "tokenless_paid_review_voucher_receipts_issuance_fk"
    FOREIGN KEY ("issuance_id")
    REFERENCES "tokenless_paid_review_voucher_issuances" ("issuance_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_review_voucher_receipts_type_check"
    CHECK ("receipt_type" IN ('voucher_issued', 'voucher_consumed')),
  CONSTRAINT "tokenless_paid_review_voucher_receipts_version_check"
    CHECK ("receipt_version" = 1),
  CONSTRAINT "tokenless_paid_review_voucher_receipts_hash_check"
    CHECK ("receipt_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_review_voucher_receipts_created_idx"
  ON "tokenless_paid_review_voucher_receipts" USING btree ("issuance_id", "created_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_paid_review_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'paid-review eligibility snapshots and voucher receipts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_review_eligibility_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_paid_review_eligibility_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_paid_review_receipt_mutation"();--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_review_voucher_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_paid_review_voucher_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_paid_review_receipt_mutation"();

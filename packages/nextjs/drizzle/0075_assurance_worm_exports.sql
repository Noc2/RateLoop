CREATE TABLE "tokenless_assurance_worm_destinations" (
  "destination_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "label" text NOT NULL,
  "endpoint_origin" text NOT NULL,
  "bucket_name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "region" text NOT NULL,
  "credential_reference" text NOT NULL,
  "retention_days" integer NOT NULL,
  "preflight_json" text NOT NULL,
  "preflight_hash" text NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'verified',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "superseded_at" timestamp with time zone,
  "disabled_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_worm_destinations_pk"
    PRIMARY KEY ("destination_id", "version"),
  CONSTRAINT "tokenless_assurance_worm_destinations_workspace_version_unique"
    UNIQUE ("workspace_id", "destination_id", "version"),
  CONSTRAINT "tokenless_assurance_worm_destinations_id_check"
    CHECK ("destination_id" ~ '^awd_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_worm_destinations_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_assurance_worm_destinations_label_check"
    CHECK (char_length("label") BETWEEN 1 AND 120),
  CONSTRAINT "tokenless_assurance_worm_destinations_endpoint_check"
    CHECK (char_length("endpoint_origin") BETWEEN 8 AND 512),
  CONSTRAINT "tokenless_assurance_worm_destinations_bucket_check"
    CHECK ("bucket_name" ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  CONSTRAINT "tokenless_assurance_worm_destinations_prefix_check"
    CHECK (char_length("key_prefix") BETWEEN 1 AND 240),
  CONSTRAINT "tokenless_assurance_worm_destinations_region_check"
    CHECK ("region" ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT "tokenless_assurance_worm_destinations_credential_reference_check"
    CHECK ("credential_reference" ~ '^sec_[0-9a-f]{48}$'),
  CONSTRAINT "tokenless_assurance_worm_destinations_retention_check"
    CHECK ("retention_days" BETWEEN 183 AND 3650),
  CONSTRAINT "tokenless_assurance_worm_destinations_preflight_hash_check"
    CHECK ("preflight_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_worm_destinations_status_check"
    CHECK ("status" IN ('verified', 'superseded', 'disabled')),
  CONSTRAINT "tokenless_assurance_worm_destinations_state_check" CHECK (
    ("status" = 'verified' AND "superseded_at" IS NULL AND "disabled_at" IS NULL)
    OR ("status" = 'superseded' AND "superseded_at" IS NOT NULL AND "disabled_at" IS NULL)
    OR ("status" = 'disabled' AND "superseded_at" IS NULL AND "disabled_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_assurance_worm_destinations_active_idx"
  ON "tokenless_assurance_worm_destinations" ("workspace_id")
  WHERE "status" = 'verified';--> statement-breakpoint

CREATE TABLE "tokenless_assurance_worm_export_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "destination_id" text NOT NULL,
  "destination_version" integer NOT NULL,
  "artifact_type" text NOT NULL,
  "source_id" text NOT NULL,
  "artifact_schema" text NOT NULL,
  "payload_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "object_key" text NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "retention_until" timestamp with time zone NOT NULL,
  "claims_money_or_settlement" boolean NOT NULL DEFAULT false,
  "settlement_receipt_reference" text,
  "settlement_receipt_hash" text,
  "state" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "last_error_code" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "delivered_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_worm_export_jobs_destination_fk"
    FOREIGN KEY ("workspace_id", "destination_id", "destination_version")
    REFERENCES "tokenless_assurance_worm_destinations" ("workspace_id", "destination_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_worm_export_jobs_workspace_job_unique"
    UNIQUE ("workspace_id", "job_id"),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_id_check"
    CHECK ("job_id" ~ '^awj_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_artifact_check"
    CHECK ("artifact_type" IN ('audit_export', 'coverage_export', 'supervision_report')),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_source_check"
    CHECK (char_length("source_id") BETWEEN 1 AND 240),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_schema_check"
    CHECK (char_length("artifact_schema") BETWEEN 1 AND 160),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_hash_check" CHECK (
    "payload_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND ("settlement_receipt_hash" IS NULL OR "settlement_receipt_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_object_key_check"
    CHECK (char_length("object_key") BETWEEN 1 AND 1024),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_idempotency_check"
    CHECK ("idempotency_key" ~ '^worm:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_claim_check" CHECK (
    (NOT "claims_money_or_settlement" AND "settlement_receipt_reference" IS NULL AND "settlement_receipt_hash" IS NULL)
    OR ("claims_money_or_settlement" AND "settlement_receipt_reference" IS NOT NULL AND "settlement_receipt_hash" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_attempt_check"
    CHECK ("attempt_count" BETWEEN 0 AND 8),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_state_check"
    CHECK ("state" IN ('pending', 'delivering', 'retry', 'delivered', 'dead')),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_lease_check" CHECK (
    ("state" = 'delivering' AND "lease_expires_at" IS NOT NULL)
    OR ("state" <> 'delivering' AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "tokenless_assurance_worm_export_jobs_delivered_check" CHECK (
    ("state" = 'delivered' AND "delivered_at" IS NOT NULL)
    OR ("state" <> 'delivered' AND "delivered_at" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_worm_export_jobs_due_idx"
  ON "tokenless_assurance_worm_export_jobs" ("state", "next_attempt_at", "lease_expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_worm_export_jobs_workspace_idx"
  ON "tokenless_assurance_worm_export_jobs" ("workspace_id", "created_at", "job_id");--> statement-breakpoint

CREATE TABLE "tokenless_assurance_worm_export_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL UNIQUE,
  "workspace_id" text NOT NULL,
  "object_version_id" text NOT NULL,
  "etag" text NOT NULL,
  "checksum_sha256" text NOT NULL,
  "object_lock_mode" text NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "provider_receipt_json" text NOT NULL,
  "provider_receipt_hash" text NOT NULL UNIQUE,
  "delivered_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_worm_export_receipts_job_fk"
    FOREIGN KEY ("workspace_id", "job_id")
    REFERENCES "tokenless_assurance_worm_export_jobs"("workspace_id", "job_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_worm_export_receipts_id_check"
    CHECK ("receipt_id" ~ '^awr_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_worm_export_receipts_version_check"
    CHECK (char_length("object_version_id") BETWEEN 1 AND 1024),
  CONSTRAINT "tokenless_assurance_worm_export_receipts_etag_check"
    CHECK (char_length("etag") BETWEEN 1 AND 256),
  CONSTRAINT "tokenless_assurance_worm_export_receipts_hashes_check" CHECK (
    "checksum_sha256" ~ '^sha256:[0-9a-f]{64}$'
    AND "provider_receipt_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_assurance_worm_export_receipts_lock_check"
    CHECK ("object_lock_mode" = 'COMPLIANCE')
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_worm_export_receipts_workspace_idx"
  ON "tokenless_assurance_worm_export_receipts" ("workspace_id", "delivered_at", "receipt_id");

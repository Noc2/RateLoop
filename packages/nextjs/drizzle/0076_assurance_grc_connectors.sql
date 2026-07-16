CREATE TABLE "tokenless_assurance_grc_connectors" (
  "connector_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1,
  "provider" text NOT NULL,
  "display_name" text NOT NULL,
  "credential_reference" text NOT NULL,
  "credential_reference_digest" text NOT NULL,
  "provider_config_json" text NOT NULL,
  "control_mappings_json" text NOT NULL,
  "status" text NOT NULL DEFAULT 'enabled',
  "next_reconcile_at" timestamp with time zone NOT NULL,
  "last_reconciled_at" timestamp with time zone,
  "last_delivery_status" text,
  "last_error_code" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_grc_connectors_workspace_unique"
    UNIQUE("workspace_id", "connector_id"),
  CONSTRAINT "tokenless_assurance_grc_connectors_provider_check"
    CHECK ("provider" IN ('drata', 'vanta')),
  CONSTRAINT "tokenless_assurance_grc_connectors_status_check"
    CHECK ("status" IN ('enabled', 'paused')),
  CONSTRAINT "tokenless_assurance_grc_connectors_version_check"
    CHECK ("version" >= 1),
  CONSTRAINT "tokenless_assurance_grc_connectors_credential_reference_check"
    CHECK ("credential_reference" ~ '^(vault|kms|secret)://rateloop/grc/[A-Za-z0-9._~:/-]{3,300}$'),
  CONSTRAINT "tokenless_assurance_grc_connectors_credential_digest_check"
    CHECK ("credential_reference_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_grc_connectors_last_status_check"
    CHECK ("last_delivery_status" IS NULL OR "last_delivery_status" IN ('succeeded', 'retry', 'failed'))
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_grc_connectors_due_idx"
  ON "tokenless_assurance_grc_connectors" ("status", "next_reconcile_at", "connector_id");--> statement-breakpoint

CREATE TABLE "tokenless_assurance_grc_reconciliation_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "connector_id" text NOT NULL,
  "connector_version" integer NOT NULL,
  "provider" text NOT NULL,
  "credential_reference" text NOT NULL,
  "credential_reference_digest" text NOT NULL,
  "provider_config_json" text NOT NULL,
  "control_mappings_json" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "idempotency_key" text NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "bundle_digest" text,
  "last_error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_connector_fk"
    FOREIGN KEY ("workspace_id", "connector_id")
    REFERENCES "tokenless_assurance_grc_connectors"("workspace_id", "connector_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_workspace_unique"
    UNIQUE("workspace_id", "connector_id", "job_id"),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_idempotency_unique"
    UNIQUE("workspace_id", "connector_id", "idempotency_key"),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_provider_check"
    CHECK ("provider" IN ('drata', 'vanta')),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_state_check"
    CHECK ("state" IN ('pending', 'processing', 'retry', 'succeeded', 'failed', 'superseded')),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_window_check"
    CHECK ("window_end" > "window_start"),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_attempt_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_lease_check"
    CHECK (("state" = 'processing' AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'processing' AND "lease_expires_at" IS NULL)),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_credential_reference_check"
    CHECK ("credential_reference" ~ '^(vault|kms|secret)://rateloop/grc/[A-Za-z0-9._~:/-]{3,300}$'),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_credential_digest_check"
    CHECK ("credential_reference_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_grc_reconciliation_jobs_bundle_digest_check"
    CHECK ("bundle_digest" IS NULL OR "bundle_digest" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_grc_reconciliation_jobs_due_idx"
  ON "tokenless_assurance_grc_reconciliation_jobs" ("state", "next_attempt_at", "created_at");--> statement-breakpoint

CREATE TABLE "tokenless_assurance_grc_delivery_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "connector_id" text NOT NULL,
  "job_id" text NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "state" text NOT NULL DEFAULT 'preparing',
  "external_reference" text,
  "record_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "delivered_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_job_fk"
    FOREIGN KEY ("workspace_id", "connector_id", "job_id")
    REFERENCES "tokenless_assurance_grc_reconciliation_jobs"("workspace_id", "connector_id", "job_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_artifact_unique"
    UNIQUE("job_id", "artifact_kind", "artifact_key"),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_idempotency_unique"
    UNIQUE("connector_id", "idempotency_key"),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_kind_check"
    CHECK ("artifact_kind" IN ('assurance_evidence_bundle')),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_state_check"
    CHECK ("state" IN ('preparing', 'delivered')),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_digest_check"
    CHECK ("request_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_count_check"
    CHECK ("record_count" >= 0),
  CONSTRAINT "tokenless_assurance_grc_delivery_receipts_terminal_check"
    CHECK (("state" = 'delivered' AND "external_reference" IS NOT NULL AND "delivered_at" IS NOT NULL)
      OR ("state" = 'preparing' AND "delivered_at" IS NULL))
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_grc_delivery_receipts_workspace_idx"
  ON "tokenless_assurance_grc_delivery_receipts" ("workspace_id", "connector_id", "created_at");

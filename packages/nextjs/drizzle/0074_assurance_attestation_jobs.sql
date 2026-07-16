CREATE TABLE "tokenless_assurance_attestation_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "artifact_kind" text NOT NULL,
  "artifact_schema_version" text NOT NULL,
  "artifact_digest" text NOT NULL,
  "boundary_at" timestamp with time zone NOT NULL,
  "statement_json" text NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "signer_key_id" text,
  "dsse_envelope_json" text,
  "rekor_entry_uuid" text,
  "rekor_log_index" text,
  "rekor_bundle_json" text,
  "tsa_token_base64" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_attestation_jobs_artifact_unique"
    UNIQUE("workspace_id", "artifact_kind", "artifact_digest"),
  CONSTRAINT "tokenless_assurance_attestation_jobs_id_check"
    CHECK ("job_id" ~ '^aat_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_attestation_jobs_kind_check"
    CHECK ("artifact_kind" IN ('decision_packet', 'audit_export_head', 'coverage_export_head')),
  CONSTRAINT "tokenless_assurance_attestation_jobs_digest_check"
    CHECK ("artifact_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_attestation_jobs_state_check"
    CHECK ("state" IN ('pending', 'processing', 'retry', 'completed', 'dead')),
  CONSTRAINT "tokenless_assurance_attestation_jobs_attempt_check"
    CHECK ("attempt_count" BETWEEN 0 AND 8),
  CONSTRAINT "tokenless_assurance_attestation_jobs_lease_check" CHECK (
    ("state" = 'processing' AND "lease_expires_at" IS NOT NULL)
    OR ("state" <> 'processing' AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "tokenless_assurance_attestation_jobs_completed_check" CHECK (
    ("state" = 'completed' AND "completed_at" IS NOT NULL AND "signer_key_id" IS NOT NULL
      AND "dsse_envelope_json" IS NOT NULL AND "rekor_entry_uuid" IS NOT NULL
      AND "rekor_log_index" IS NOT NULL AND "rekor_bundle_json" IS NOT NULL)
    OR ("state" <> 'completed' AND "completed_at" IS NULL)
  ),
  CONSTRAINT "tokenless_assurance_attestation_jobs_tsa_check" CHECK (
    "artifact_kind" = 'decision_packet' OR "state" <> 'completed' OR "tsa_token_base64" IS NOT NULL
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_attestation_jobs_due_idx"
  ON "tokenless_assurance_attestation_jobs" USING btree
  ("state", "next_attempt_at", "lease_expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_attestation_jobs_workspace_idx"
  ON "tokenless_assurance_attestation_jobs" USING btree
  ("workspace_id", "boundary_at", "job_id");

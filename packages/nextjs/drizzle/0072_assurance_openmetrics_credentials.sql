CREATE TABLE "tokenless_assurance_metrics_credentials" (
  "credential_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'active',
  "issued_by" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "rotated_from_credential_id" text REFERENCES "tokenless_assurance_metrics_credentials"("credential_id") ON DELETE RESTRICT,
  "rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_metrics_credentials_id_check"
    CHECK ("credential_id" ~ '^amc_[0-9a-f]{32}$'),
  CONSTRAINT "tokenless_assurance_metrics_credentials_label_check"
    CHECK (char_length("label") BETWEEN 1 AND 120),
  CONSTRAINT "tokenless_assurance_metrics_credentials_hash_check"
    CHECK ("token_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_metrics_credentials_status_check"
    CHECK ("status" IN ('active', 'rotated', 'revoked')),
  CONSTRAINT "tokenless_assurance_metrics_credentials_status_timestamps_check" CHECK (
    ("status" = 'active' AND "rotated_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'rotated' AND "rotated_at" IS NOT NULL AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "rotated_at" IS NULL AND "revoked_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_assurance_metrics_credentials_timestamps_check" CHECK (
    ("last_used_at" IS NULL OR "last_used_at" >= "issued_at")
    AND ("rotated_at" IS NULL OR "rotated_at" >= "issued_at")
    AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_metrics_credentials_workspace_status_idx"
  ON "tokenless_assurance_metrics_credentials" USING btree
  ("workspace_id", "status", "issued_at");

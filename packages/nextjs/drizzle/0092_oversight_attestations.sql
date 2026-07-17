CREATE TABLE "tokenless_oversight_attestations" (
  "attestation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "account_address" text NOT NULL,
  "competence_basis" text NOT NULL,
  "training_records_json" text NOT NULL DEFAULT '[]',
  "authority_scope" text NOT NULL,
  "attested_by" text NOT NULL,
  "attested_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_oversight_attestations_member_unique"
    UNIQUE ("workspace_id", "account_address"),
  CONSTRAINT "tokenless_oversight_attestations_authority_check"
    CHECK ("authority_scope" IN ('override', 'stop', 'both')),
  CONSTRAINT "tokenless_oversight_attestations_status_check"
    CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "tokenless_oversight_attestations_competence_check"
    CHECK (char_length("competence_basis") BETWEEN 1 AND 2000),
  CONSTRAINT "tokenless_oversight_attestations_expiry_check"
    CHECK ("expires_at" > "attested_at"),
  CONSTRAINT "tokenless_oversight_attestations_revocation_check" CHECK (
    ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_oversight_attestations_workspace_idx"
  ON "tokenless_oversight_attestations" USING btree
  ("workspace_id", "status", "expires_at");

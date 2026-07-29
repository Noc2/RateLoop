ALTER TABLE "tokenless_assurance_evidence_packets"
  ADD CONSTRAINT "tokenless_assurance_evidence_packets_run_packet_unique"
  UNIQUE ("run_id","packet_id");--> statement-breakpoint

CREATE TABLE "tokenless_assurance_evidence_share_grants" (
  "grant_id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "run_id" text NOT NULL,
  "packet_id" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "access_count" integer DEFAULT 0 NOT NULL,
  "last_accessed_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_evidence_share_grants_workspace_project_fk"
    FOREIGN KEY ("workspace_id","project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id","project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_evidence_share_grants_project_run_fk"
    FOREIGN KEY ("project_id","run_id")
    REFERENCES "tokenless_assurance_runs"("project_id","run_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_evidence_share_grants_run_packet_fk"
    FOREIGN KEY ("run_id","packet_id")
    REFERENCES "tokenless_assurance_evidence_packets"("run_id","packet_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_evidence_share_grants_id_check"
    CHECK ("grant_id" ~ '^esh_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT "tokenless_assurance_evidence_share_grants_token_hash_check"
    CHECK ("token_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_evidence_share_grants_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "tokenless_assurance_evidence_share_grants_revocation_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
  CONSTRAINT "tokenless_assurance_evidence_share_grants_access_count_check"
    CHECK ("access_count" >= 0),
  CONSTRAINT "tokenless_assurance_evidence_share_grants_access_time_check"
    CHECK (("access_count" = 0 AND "last_accessed_at" IS NULL)
      OR ("access_count" > 0 AND "last_accessed_at" IS NOT NULL))
);--> statement-breakpoint

CREATE INDEX "tokenless_assurance_evidence_share_grants_run_idx"
  ON "tokenless_assurance_evidence_share_grants"
  ("workspace_id","project_id","run_id","created_at");--> statement-breakpoint

CREATE INDEX "tokenless_assurance_evidence_share_grants_active_idx"
  ON "tokenless_assurance_evidence_share_grants" ("expires_at")
  WHERE "revoked_at" IS NULL;

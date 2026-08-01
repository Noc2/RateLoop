ALTER TABLE "tokenless_project_window_compliance_shares"
  ADD CONSTRAINT "tokenless_project_window_compliance_shares_issuance_binding_uq"
  UNIQUE ("workspace_id", "project_id", "share_id", "grant_hash", "issued_by", "issued_at");--> statement-breakpoint
ALTER TABLE "tokenless_benchmark_research_grants"
  ADD CONSTRAINT "tokenless_benchmark_research_grants_issuance_binding_uq"
  UNIQUE ("workspace_id", "project_id", "grant_id", "event_digest", "authorized_by", "issued_at");--> statement-breakpoint

CREATE TABLE "tokenless_project_window_compliance_share_issuances" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "issued_by" text NOT NULL,
  "idempotency_key_digest" text NOT NULL,
  "request_binding_hash" text NOT NULL,
  "share_id" text NOT NULL,
  "grant_hash" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_share_issuances_pk"
    PRIMARY KEY ("workspace_id", "project_id", "issued_by", "idempotency_key_digest"),
  CONSTRAINT "tokenless_project_window_compliance_share_issuances_share_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "grant_hash", "issued_by", "issued_at"),
  CONSTRAINT "tokenless_project_window_compliance_share_issuances_share_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "grant_hash", "issued_by", "issued_at")
    REFERENCES "tokenless_project_window_compliance_shares"
      ("workspace_id", "project_id", "share_id", "grant_hash", "issued_by", "issued_at")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_compliance_share_issuances_contract_check" CHECK (
    "idempotency_key_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "share_id" ~ '^pwcs_[A-Za-z0-9_-]{22}$'
    AND "grant_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_grant_issuances" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "authorized_by" text NOT NULL,
  "idempotency_key_digest" text NOT NULL,
  "request_binding_hash" text NOT NULL,
  "grant_id" text NOT NULL,
  "grant_event_digest" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_grant_issuances_pk"
    PRIMARY KEY ("workspace_id", "project_id", "authorized_by", "idempotency_key_digest"),
  CONSTRAINT "tokenless_benchmark_research_grant_issuances_grant_uq"
    UNIQUE ("workspace_id", "project_id", "grant_id", "grant_event_digest", "authorized_by", "issued_at"),
  CONSTRAINT "tokenless_benchmark_research_grant_issuances_grant_fk"
    FOREIGN KEY ("workspace_id", "project_id", "grant_id", "grant_event_digest", "authorized_by", "issued_at")
    REFERENCES "tokenless_benchmark_research_grants"
      ("workspace_id", "project_id", "grant_id", "event_digest", "authorized_by", "issued_at")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_grant_issuances_contract_check" CHECK (
    "idempotency_key_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "grant_id" ~ '^brg_[A-Za-z0-9_-]{22}$'
    AND "grant_event_digest" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE TRIGGER tokenless_project_window_compliance_share_issuances_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_share_issuances"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_grant_issuances_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_grant_issuances"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();

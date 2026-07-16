CREATE TABLE "tokenless_evidence_retention_enforcement_runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "policy_version" integer NOT NULL,
  "evidence_retention_months" integer NOT NULL,
  "audit_retention_months" integer NOT NULL,
  "evidence_cutoff_at" timestamp with time zone NOT NULL,
  "audit_cutoff_at" timestamp with time zone NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "objects_queued" integer NOT NULL DEFAULT 0,
  "access_logs_pruned" integer NOT NULL DEFAULT 0,
  "objects_held" integer NOT NULL DEFAULT 0,
  "access_logs_held" integer NOT NULL DEFAULT 0,
  "backlog_count" integer NOT NULL DEFAULT 0,
  "audit_events_preserved" integer NOT NULL DEFAULT 0,
  "evidence_packets_preserved" integer NOT NULL DEFAULT 0,
  "attestations_preserved" integer NOT NULL DEFAULT 0,
  "worm_receipts_preserved" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "pruned_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "dead_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_policy_fk"
    FOREIGN KEY ("workspace_id", "policy_version")
    REFERENCES "tokenless_workspace_evidence_retention_policies"("workspace_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_id_check"
    CHECK ("run_id" ~ '^eer_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_idempotency_check"
    CHECK ("idempotency_key" ~ '^retention:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_months_check" CHECK (
    "evidence_retention_months" BETWEEN 6 AND 120
    AND "audit_retention_months" BETWEEN 6 AND 120
  ),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_state_check"
    CHECK ("state" IN ('pending', 'processing', 'retry', 'completed', 'dead')),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_attempt_check"
    CHECK ("attempt_count" BETWEEN 0 AND 8),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_counts_check" CHECK (
    "objects_queued" >= 0 AND "access_logs_pruned" >= 0
    AND "objects_held" >= 0 AND "access_logs_held" >= 0 AND "backlog_count" >= 0
    AND "audit_events_preserved" >= 0 AND "evidence_packets_preserved" >= 0
    AND "attestations_preserved" >= 0 AND "worm_receipts_preserved" >= 0
  ),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_lease_check" CHECK (
    ("state" = 'processing' AND "lease_expires_at" IS NOT NULL)
    OR ("state" <> 'processing' AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "tokenless_evidence_retention_enforcement_runs_terminal_check" CHECK (
    ("state" = 'completed' AND "pruned_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "dead_at" IS NULL)
    OR ("state" = 'dead' AND "completed_at" IS NULL AND "dead_at" IS NOT NULL)
    OR ("state" NOT IN ('completed', 'dead') AND "completed_at" IS NULL AND "dead_at" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_evidence_retention_enforcement_runs_due_idx"
  ON "tokenless_evidence_retention_enforcement_runs" ("state", "next_attempt_at", "lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_evidence_retention_enforcement_runs_idempotency_key_unique"
  ON "tokenless_evidence_retention_enforcement_runs" ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_evidence_retention_enforcement_runs_active_idx"
  ON "tokenless_evidence_retention_enforcement_runs" ("workspace_id")
  WHERE "state" IN ('pending', 'processing', 'retry');--> statement-breakpoint
CREATE INDEX "tokenless_evidence_retention_enforcement_runs_workspace_idx"
  ON "tokenless_evidence_retention_enforcement_runs" ("workspace_id", "created_at", "run_id");

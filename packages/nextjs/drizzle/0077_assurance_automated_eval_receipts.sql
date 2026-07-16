CREATE TABLE "tokenless_assurance_automated_eval_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "provider" text NOT NULL,
  "external_reference_hash" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "evaluator_name" text NOT NULL,
  "evaluator_version" text NOT NULL,
  "check_name" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "score_bps" integer,
  "threshold_bps" integer,
  "content_commitment" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "normalized_receipt_json" text NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_agent_version_fk"
    FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_id_check"
    CHECK ("receipt_id" ~ '^aer_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_provider_check"
    CHECK ("provider" IN ('promptfoo', 'nemo_guardrails', 'inspect', 'custom')),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_outcome_check"
    CHECK ("automated_outcome" IN ('pass', 'fail', 'uncertain')),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_score_check" CHECK (
    ("score_bps" IS NULL OR "score_bps" BETWEEN 0 AND 10000)
    AND ("threshold_bps" IS NULL OR "threshold_bps" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_hashes_check" CHECK (
    "external_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "idempotency_key_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "content_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "receipt_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_idempotency_unique"
    UNIQUE ("workspace_id", "idempotency_key_hash"),
  CONSTRAINT "tokenless_assurance_automated_eval_receipts_source_unique"
    UNIQUE ("workspace_id", "provider", "external_reference_hash", "check_name")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_automated_eval_receipts_workspace_time_idx"
  ON "tokenless_assurance_automated_eval_receipts" USING btree
  ("workspace_id", "observed_at", "receipt_id");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_automated_eval_escalations" (
  "escalation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "receipt_id" text NOT NULL REFERENCES "tokenless_assurance_automated_eval_receipts"("receipt_id") ON DELETE RESTRICT,
  "opportunity_id" text NOT NULL,
  "trigger_kind" text NOT NULL,
  "state" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_id_check"
    CHECK ("escalation_id" ~ '^aes_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_trigger_check"
    CHECK ("trigger_kind" = 'guardrail_uncertain'),
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_state_check"
    CHECK ("state" = 'human_review_required'),
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_receipt_unique"
    UNIQUE ("workspace_id", "receipt_id"),
  CONSTRAINT "tokenless_assurance_automated_eval_escalations_opportunity_unique"
    UNIQUE ("workspace_id", "opportunity_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_automated_eval_escalations_workspace_time_idx"
  ON "tokenless_assurance_automated_eval_escalations" USING btree
  ("workspace_id", "created_at", "escalation_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_reject_automated_eval_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'automated-eval receipts and escalations are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_assurance_automated_eval_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_assurance_automated_eval_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_automated_eval_receipt_mutation"();--> statement-breakpoint
CREATE TRIGGER "tokenless_assurance_automated_eval_escalations_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_assurance_automated_eval_escalations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_automated_eval_receipt_mutation"();

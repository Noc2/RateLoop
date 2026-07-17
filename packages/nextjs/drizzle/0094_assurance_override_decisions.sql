CREATE TABLE "tokenless_assurance_override_decisions" (
  "record_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "project_id" text NOT NULL,
  "run_id" text NOT NULL,
  "supersedes_record_id" text REFERENCES "tokenless_assurance_override_decisions"("record_id"),
  "outcome" text NOT NULL,
  "reasons" text NOT NULL,
  "corrective_action" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  "record_digest" text NOT NULL,
  "record_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_override_decisions_outcome_check"
    CHECK ("outcome" IN ('accepted', 'disregarded', 'overridden', 'reversed')),
  CONSTRAINT "tokenless_assurance_override_decisions_reasons_check"
    CHECK (char_length("reasons") BETWEEN 10 AND 2000),
  CONSTRAINT "tokenless_assurance_override_decisions_corrective_check"
    CHECK ("corrective_action" IS NULL OR char_length("corrective_action") BETWEEN 1 AND 2000),
  CONSTRAINT "tokenless_assurance_override_decisions_digest_check"
    CHECK ("record_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_override_decisions_supersession_unique"
    UNIQUE ("supersedes_record_id"),
  FOREIGN KEY ("project_id", "run_id")
    REFERENCES "tokenless_assurance_runs"("project_id", "run_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_assurance_override_decisions_chain_root_unique"
  ON "tokenless_assurance_override_decisions" USING btree ("run_id")
  WHERE "supersedes_record_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "tokenless_assurance_override_decisions_workspace_idx"
  ON "tokenless_assurance_override_decisions" USING btree
  ("workspace_id", "run_id", "decided_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_reject_override_decision_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assurance override decisions are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tokenless_assurance_override_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_assurance_override_decisions"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_override_decision_mutation"();

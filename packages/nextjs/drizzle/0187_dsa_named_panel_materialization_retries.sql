CREATE TABLE "tokenless_dsa_named_panel_materialization_retries" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "state" text NOT NULL,
  "attempt_count" integer NOT NULL,
  "failure_count" integer NOT NULL,
  "failure_code" text,
  "next_retry_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id")
    REFERENCES "tokenless_dsa_named_panel_units" ("workspace_id","epoch_id","unit_id") ON DELETE RESTRICT,
  CHECK (
    "attempt_count">0 AND "failure_count" BETWEEN 0 AND "attempt_count"
    AND "updated_at"="last_attempt_at"
    AND (
      ("state"='retrying' AND "failure_count">0 AND mod("failure_count",8)<>0
        AND "failure_code"='response_evidence_materialization_failed'
        AND "next_retry_at"="last_attempt_at" AND "resolved_at" IS NULL)
      OR
      ("state"='cooldown' AND "failure_count">0 AND mod("failure_count",8)=0
        AND "failure_code"='response_evidence_materialization_failed'
        AND "next_retry_at"="last_attempt_at"+interval '15 minutes' AND "resolved_at" IS NULL)
      OR
      ("state"='resolved' AND "failure_code" IS NULL AND "next_retry_at" IS NULL
        AND "resolved_at"="last_attempt_at")
    )
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_dsa_named_panel_materialization_retries_due_idx"
  ON "tokenless_dsa_named_panel_materialization_retries"
    ("state","next_retry_at","failure_count","workspace_id","epoch_id","unit_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_materialization_retry_time()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'DSA named-panel materialization retry state is durable'
      USING ERRCODE='55000';
  END IF;
  IF NEW."last_attempt_at" IS DISTINCT FROM transaction_timestamp()
     OR NEW."updated_at" IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'DSA named-panel materialization retry time must be database-authored'
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NOT (
       (NEW."state"='retrying' AND NEW."attempt_count"=1 AND NEW."failure_count"=1)
       OR (NEW."state"='resolved' AND NEW."attempt_count"=1 AND NEW."failure_count"=0)
     ) THEN
    RAISE EXCEPTION 'DSA named-panel materialization retry must start at its first exact attempt'
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (
       NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
       OR NEW."epoch_id" IS DISTINCT FROM OLD."epoch_id"
       OR NEW."unit_id" IS DISTINCT FROM OLD."unit_id"
       OR NEW."attempt_count"<>OLD."attempt_count"+1
       OR (NEW."state"='resolved' AND NEW."failure_count"<>OLD."failure_count")
       OR (NEW."state" IN ('retrying','cooldown') AND NEW."failure_count"<>OLD."failure_count"+1)
     ) THEN
    RAISE EXCEPTION 'DSA named-panel materialization retry transition is not monotonic'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_materialization_retry_time_guard
BEFORE INSERT OR UPDATE OR DELETE ON "tokenless_dsa_named_panel_materialization_retries"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_materialization_retry_time();

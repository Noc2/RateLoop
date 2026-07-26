ALTER TABLE "tokenless_paid_vouchers"
  ADD COLUMN "network_assignment_id" text
  REFERENCES "tokenless_assurance_assignments" ("assignment_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD COLUMN "network_selection_binding_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD CONSTRAINT "tokenless_paid_vouchers_network_assignment_round_unique"
  UNIQUE ("network_assignment_id","round_id");--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD CONSTRAINT "tokenless_paid_vouchers_network_binding_check" CHECK (
    ("network_assignment_id" IS NULL AND "network_selection_binding_hash" IS NULL)
    OR (
      "network_assignment_id" IS NOT NULL
      AND "network_selection_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    )
  );--> statement-breakpoint

CREATE TABLE "tokenless_network_assignment_settlements" (
  "binding_id" text PRIMARY KEY NOT NULL,
  "assignment_id" text NOT NULL
    REFERENCES "tokenless_assurance_assignments" ("assignment_id") ON DELETE RESTRICT,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "operation_key" text NOT NULL
    REFERENCES "tokenless_agent_asks" ("operation_key") ON DELETE RESTRICT,
  "selection_batch_id" text NOT NULL,
  "selection_binding_hash" text NOT NULL,
  "integrity_provenance_hash" text NOT NULL,
  "integrity_reviewer_lookup" text NOT NULL,
  "deployment_key" text NOT NULL,
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "round_id" numeric(78,0) NOT NULL,
  "content_id" text NOT NULL,
  "admission_policy_hash" text NOT NULL,
  "round_terms_hash" text NOT NULL,
  "total_funded_atomic" numeric(78,0) NOT NULL,
  "maximum_commits" integer NOT NULL,
  "voucher_id" text REFERENCES "tokenless_paid_vouchers" ("voucher_id") ON DELETE RESTRICT,
  "state" text NOT NULL DEFAULT 'selected',
  "transition_revision" integer NOT NULL DEFAULT 1,
  "committed_at" timestamp with time zone,
  "terminal_outcome" text,
  "settlement_reference" text,
  "settlement_evidence_hash" text,
  "terminal_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  FOREIGN KEY ("run_id","case_id")
    REFERENCES "tokenless_assurance_run_cases" ("run_id","case_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_assignment_settlements_assignment_case_unique"
    UNIQUE ("assignment_id","case_id"),
  CONSTRAINT "tokenless_network_assignment_settlements_voucher_unique"
    UNIQUE ("voucher_id"),
  CONSTRAINT "tokenless_network_assignment_settlements_hashes_check" CHECK (
    "selection_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "integrity_provenance_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "round_terms_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "admission_policy_hash" ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_network_assignment_settlements_round_check" CHECK (
    "chain_id" > 0
    AND "panel_address" ~ '^0x[0-9a-f]{40}$'
    AND "round_id" >= 0
    AND "content_id" ~ '^0x[0-9a-f]{64}$'
    AND "total_funded_atomic" > 0
    AND "maximum_commits" > 0
  ),
  CONSTRAINT "tokenless_network_assignment_settlements_state_check"
    CHECK ("state" IN ('selected','voucher_issued','committed','terminal')),
  CONSTRAINT "tokenless_network_assignment_settlements_state_shape_check" CHECK (
    (
      "state" = 'selected'
      AND "voucher_id" IS NULL
      AND "committed_at" IS NULL
      AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL
      AND "settlement_evidence_hash" IS NULL
      AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'voucher_issued'
      AND "voucher_id" IS NOT NULL
      AND "committed_at" IS NULL
      AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL
      AND "settlement_evidence_hash" IS NULL
      AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'committed'
      AND "voucher_id" IS NOT NULL
      AND "committed_at" IS NOT NULL
      AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL
      AND "settlement_evidence_hash" IS NULL
      AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'terminal'
      AND "terminal_outcome" IN (
        'paid','compensated','no_payout','claim_expired','not_accepted','not_submitted'
      )
      AND char_length("settlement_reference") BETWEEN 8 AND 1024
      AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "terminal_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_network_assignment_settlements_time_check" CHECK (
    "updated_at" >= "created_at"
    AND ("committed_at" IS NULL OR "committed_at" BETWEEN "created_at" AND "updated_at")
    AND ("terminal_at" IS NULL OR "terminal_at" BETWEEN "created_at" AND "updated_at")
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_network_assignment_settlements_due_idx"
  ON "tokenless_network_assignment_settlements" ("state","updated_at","binding_id")
  WHERE "state" <> 'terminal';--> statement-breakpoint
CREATE INDEX "tokenless_network_assignment_settlements_operation_idx"
  ON "tokenless_network_assignment_settlements" ("operation_key","state","assignment_id");--> statement-breakpoint

CREATE TABLE "tokenless_network_assignment_settlement_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "binding_id" text NOT NULL
    REFERENCES "tokenless_network_assignment_settlements" ("binding_id") ON DELETE RESTRICT,
  "receipt_type" text NOT NULL,
  "transition_revision" integer NOT NULL,
  "receipt_json" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_network_assignment_settlement_receipts_revision_unique"
    UNIQUE ("binding_id","transition_revision"),
  CONSTRAINT "tokenless_network_assignment_settlement_receipts_hash_unique"
    UNIQUE ("receipt_hash"),
  CONSTRAINT "tokenless_network_assignment_settlement_receipts_type_check"
    CHECK ("receipt_type" IN ('selection_bound','voucher_issued','voucher_consumed','settlement_terminal')),
  CONSTRAINT "tokenless_network_assignment_settlement_receipts_values_check" CHECK (
    "transition_revision" > 0
    AND "receipt_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_network_settlement_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'network assignment settlement receipts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_network_assignment_settlement_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_network_assignment_settlement_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_network_settlement_receipt_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_network_assignment_settlement_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF ROW(
    NEW.assignment_id,NEW.run_id,NEW.case_id,NEW.operation_key,NEW.selection_batch_id,
    NEW.selection_binding_hash,NEW.integrity_provenance_hash,NEW.integrity_reviewer_lookup,
    NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,NEW.content_id,
    NEW.admission_policy_hash,NEW.round_terms_hash,NEW.total_funded_atomic,NEW.maximum_commits
  ) IS DISTINCT FROM ROW(
    OLD.assignment_id,OLD.run_id,OLD.case_id,OLD.operation_key,OLD.selection_batch_id,
    OLD.selection_binding_hash,OLD.integrity_provenance_hash,OLD.integrity_reviewer_lookup,
    OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,OLD.content_id,
    OLD.admission_policy_hash,OLD.round_terms_hash,OLD.total_funded_atomic,OLD.maximum_commits
  ) THEN
    RAISE EXCEPTION 'network assignment settlement bindings are immutable';
  END IF;
  old_rank := CASE OLD.state
    WHEN 'selected' THEN 1 WHEN 'voucher_issued' THEN 2
    WHEN 'committed' THEN 3 WHEN 'terminal' THEN 4 END;
  new_rank := CASE NEW.state
    WHEN 'selected' THEN 1 WHEN 'voucher_issued' THEN 2
    WHEN 'committed' THEN 3 WHEN 'terminal' THEN 4 END;
  IF NEW.state <> OLD.state THEN
    IF OLD.state = 'terminal' OR new_rank <= old_rank
       OR (new_rank > old_rank + 1 AND NEW.state <> 'terminal') THEN
      RAISE EXCEPTION 'network assignment settlement transitions are monotonic';
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'network assignment settlement revision must advance once';
    END IF;
  ELSIF NEW.transition_revision <> OLD.transition_revision THEN
    RAISE EXCEPTION 'network assignment settlement revision changed without a transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_network_assignment_settlements_guard"
  BEFORE UPDATE ON "tokenless_network_assignment_settlements"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_network_assignment_settlement_transition"();--> statement-breakpoint

ALTER TABLE "tokenless_assurance_responses"
  ADD COLUMN "settlement_evidence_hash" text;--> statement-breakpoint
-- Narrow deployability exception: 0140 introduces the validated pair constraint below,
-- so legacy references must receive deterministic evidence before that constraint is added.
UPDATE "tokenless_assurance_responses"
SET "settlement_evidence_hash" =
  'sha256:' || encode(digest(convert_to(
    'rateloop.legacy-assurance-settlement-reference.v1|' || "settlement_reference",
    'UTF8'
  ), 'sha256'), 'hex')
WHERE "settlement_reference" IS NOT NULL
  AND "settlement_evidence_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_responses"
  ADD CONSTRAINT "tokenless_assurance_responses_settlement_evidence_check" CHECK (
    ("settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL)
    OR (
      char_length("settlement_reference") BETWEEN 8 AND 1024
      AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    )
  );--> statement-breakpoint

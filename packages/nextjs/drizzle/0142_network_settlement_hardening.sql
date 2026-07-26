-- Rollout precondition: migrations 0140 and 0142 deploy together while the
-- network producer and advertised capability remain disabled. No selection or
-- append-only receipt may exist before raw reviewer lookup storage is removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tokenless_network_assignment_settlements")
     OR EXISTS (SELECT 1 FROM "tokenless_network_assignment_settlement_receipts") THEN
    RAISE EXCEPTION '0142 requires an unactivated network-assignment settlement rollout';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_paid_vouchers"
  ADD COLUMN "network_operation_key" text
  REFERENCES "tokenless_agent_asks" ("operation_key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD COLUMN "network_deployment_key" text;--> statement-breakpoint
UPDATE "tokenless_paid_vouchers"
SET "network_operation_key" = settlement."operation_key",
    "network_deployment_key" = settlement."deployment_key"
FROM "tokenless_network_assignment_settlements" settlement
WHERE settlement."voucher_id" = "tokenless_paid_vouchers"."voucher_id"
  AND "tokenless_paid_vouchers"."network_assignment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  DROP CONSTRAINT "tokenless_paid_vouchers_network_assignment_round_unique";--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  DROP CONSTRAINT "tokenless_paid_vouchers_network_binding_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD CONSTRAINT "tokenless_paid_vouchers_network_assignment_round_unique"
  UNIQUE (
    "network_assignment_id","network_operation_key","network_deployment_key",
    "chain_id","panel_address","round_id"
  );--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers"
  ADD CONSTRAINT "tokenless_paid_vouchers_network_binding_check" CHECK (
    (
      "network_assignment_id" IS NULL
      AND "network_selection_binding_hash" IS NULL
      AND "network_operation_key" IS NULL
      AND "network_deployment_key" IS NULL
    )
    OR (
      "network_assignment_id" IS NOT NULL
      AND "network_selection_binding_hash" IS NOT NULL
      AND "network_selection_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "network_operation_key" IS NOT NULL
      AND "network_deployment_key" IS NOT NULL
      AND char_length("network_deployment_key") BETWEEN 1 AND 256
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_assurance_run_cases"
  ADD COLUMN "network_operation_key" text
  REFERENCES "tokenless_agent_asks" ("operation_key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD COLUMN "network_deployment_key" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD COLUMN "network_chain_id" integer;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD COLUMN "network_panel_address" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD COLUMN "network_round_id" numeric(78,0);--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD CONSTRAINT "tokenless_assurance_run_cases_network_operation_unique"
  UNIQUE ("network_operation_key");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD CONSTRAINT "tokenless_assurance_run_cases_network_round_check" CHECK (
    (
      "network_operation_key" IS NULL AND "network_deployment_key" IS NULL
      AND "network_chain_id" IS NULL AND "network_panel_address" IS NULL
      AND "network_round_id" IS NULL
    )
    OR (
      "network_operation_key" IS NOT NULL
      AND "network_deployment_key" IS NOT NULL
      AND char_length("network_deployment_key") BETWEEN 1 AND 256
      AND "network_chain_id" IS NOT NULL
      AND "network_chain_id" > 0
      AND "network_panel_address" IS NOT NULL
      AND "network_panel_address" ~ '^0x[0-9a-f]{40}$'
      AND "network_round_id" IS NOT NULL
      AND "network_round_id" >= 0
      AND "round_id" IS NOT NULL
      AND "network_round_id" = CAST("round_id" AS numeric)
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_network_assignment_settlements"
  ADD COLUMN "integrity_reviewer_commitment" text;--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD COLUMN "reviewer_round_reservation_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD COLUMN "subpanel_id" text;--> statement-breakpoint
UPDATE "tokenless_network_assignment_settlements" settlement
SET "subpanel_id"=assignment."subpanel_id"
FROM "tokenless_assurance_assignments" assignment
WHERE assignment."assignment_id"=settlement."assignment_id";--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ALTER COLUMN "subpanel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_network_scope_unique"
  UNIQUE ("assignment_id","run_id","subpanel_id");--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD CONSTRAINT "tokenless_network_assignment_settlements_assignment_scope_fk"
  FOREIGN KEY ("assignment_id","run_id","subpanel_id")
  REFERENCES "tokenless_assurance_assignments" ("assignment_id","run_id","subpanel_id")
  ON DELETE RESTRICT;--> statement-breakpoint
UPDATE "tokenless_network_assignment_settlements"
SET "integrity_reviewer_commitment" =
  'sha256:' || encode(digest(convert_to(
    'rateloop.network-integrity-reviewer-commitment.v1|'
    || "assignment_id" || '|' || "run_id" || '|' || "integrity_reviewer_lookup",
    'UTF8'
  ), 'sha256'), 'hex')
WHERE "integrity_reviewer_commitment" IS NULL;--> statement-breakpoint
UPDATE "tokenless_network_assignment_settlements" settlement
SET "reviewer_round_reservation_hash" =
  'sha256:' || encode(digest(convert_to(
    'rateloop.network-reviewer-round-reservation.v1|'
    || assignment."rater_id" || '|' || settlement."deployment_key" || '|'
    || settlement."chain_id"::text || '|' || lower(settlement."panel_address")
    || '|' || settlement."round_id"::text,
    'UTF8'
  ), 'sha256'), 'hex')
FROM "tokenless_assurance_assignments" assignment
WHERE assignment."assignment_id"=settlement."assignment_id"
  AND settlement."reviewer_round_reservation_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ALTER COLUMN "integrity_reviewer_commitment" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ALTER COLUMN "reviewer_round_reservation_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD CONSTRAINT "tokenless_network_assignment_settlements_reviewer_commitment_check"
  CHECK (
    "integrity_reviewer_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "reviewer_round_reservation_hash" ~ '^sha256:[0-9a-f]{64}$'
  );--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD CONSTRAINT "tokenless_network_assignment_settlements_reviewer_round_unique"
  UNIQUE ("reviewer_round_reservation_hash");--> statement-breakpoint
ALTER TABLE "tokenless_network_assignment_settlements"
  ADD CONSTRAINT "tokenless_network_assignment_settlements_terminal_complete_check" CHECK (
    "state" <> 'terminal'
    OR (
      "terminal_outcome" IS NOT NULL
      AND "settlement_reference" IS NOT NULL
      AND "settlement_evidence_hash" IS NOT NULL
      AND "terminal_at" IS NOT NULL
    )
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_network_assignment_settlement_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'selected' OR NEW.transition_revision <> 1
     OR NEW.voucher_id IS NOT NULL OR NEW.committed_at IS NOT NULL
     OR NEW.terminal_outcome IS NOT NULL OR NEW.settlement_reference IS NOT NULL
     OR NEW.settlement_evidence_hash IS NOT NULL OR NEW.terminal_at IS NOT NULL THEN
    RAISE EXCEPTION 'network assignment settlements must begin as selected revision one';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_network_assignment_settlements_insert_guard"
  BEFORE INSERT ON "tokenless_network_assignment_settlements"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_network_assignment_settlement_insert"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_network_assignment_settlement_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF OLD.state = 'terminal' THEN
    RAISE EXCEPTION 'terminal network assignment settlements are immutable';
  END IF;
  IF ROW(
    NEW.assignment_id,NEW.run_id,NEW.case_id,NEW.operation_key,NEW.selection_batch_id,
    NEW.subpanel_id,
    NEW.selection_binding_hash,NEW.integrity_provenance_hash,NEW.integrity_reviewer_commitment,
    NEW.reviewer_round_reservation_hash,
    NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,NEW.content_id,
    NEW.admission_policy_hash,NEW.round_terms_hash,NEW.total_funded_atomic,NEW.maximum_commits,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.assignment_id,OLD.run_id,OLD.case_id,OLD.operation_key,OLD.selection_batch_id,
    OLD.subpanel_id,
    OLD.selection_binding_hash,OLD.integrity_provenance_hash,OLD.integrity_reviewer_commitment,
    OLD.reviewer_round_reservation_hash,
    OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,OLD.content_id,
    OLD.admission_policy_hash,OLD.round_terms_hash,OLD.total_funded_atomic,OLD.maximum_commits,
    OLD.created_at
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
    IF new_rank <= old_rank
       OR (new_rank > old_rank + 1 AND NEW.state <> 'terminal') THEN
      RAISE EXCEPTION 'network assignment settlement transitions are monotonic';
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'network assignment settlement revision must advance once';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "tokenless_network_assignment_settlement_receipts" receipt
      WHERE receipt.binding_id=OLD.binding_id
        AND receipt.transition_revision=NEW.transition_revision
        AND receipt.receipt_type=CASE NEW.state
          WHEN 'voucher_issued' THEN 'voucher_issued'
          WHEN 'committed' THEN 'voucher_consumed'
          WHEN 'terminal' THEN 'settlement_terminal'
        END
    ) THEN
      RAISE EXCEPTION 'network assignment settlement transition requires its append-only receipt';
    END IF;
  ELSE
    RAISE EXCEPTION 'network assignment settlement lifecycle changes require a state transition';
  END IF;
  IF NEW.state = 'voucher_issued' AND (
    OLD.state <> 'selected' OR OLD.voucher_id IS NOT NULL OR NEW.voucher_id IS NULL
    OR NEW.committed_at IS NOT NULL OR NEW.terminal_outcome IS NOT NULL
    OR NEW.settlement_reference IS NOT NULL OR NEW.settlement_evidence_hash IS NOT NULL
    OR NEW.terminal_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid network voucher-issued transition shape';
  END IF;
  IF NEW.state = 'committed' AND (
    OLD.state <> 'voucher_issued' OR NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
    OR NEW.committed_at IS NULL OR NEW.terminal_outcome IS NOT NULL
    OR NEW.settlement_reference IS NOT NULL OR NEW.settlement_evidence_hash IS NOT NULL
    OR NEW.terminal_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid network committed transition shape';
  END IF;
  IF NEW.state = 'terminal' AND (
    NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
    OR NEW.committed_at IS DISTINCT FROM OLD.committed_at
    OR NEW.terminal_outcome IS NULL OR NEW.settlement_reference IS NULL
    OR NEW.settlement_evidence_hash IS NULL OR NEW.terminal_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid network terminal transition shape';
  END IF;
  IF NEW.state = 'terminal' THEN
    IF NEW.terminal_outcome IN ('paid','compensated','no_payout','claim_expired')
       AND (OLD.state <> 'committed' OR OLD.voucher_id IS NULL OR OLD.committed_at IS NULL) THEN
      RAISE EXCEPTION 'financial network outcomes require a committed predecessor';
    END IF;
    IF NEW.terminal_outcome = 'not_accepted' AND (
      OLD.state <> 'selected'
      OR NOT EXISTS (
        SELECT 1 FROM "tokenless_assurance_assignments" assignment
        WHERE assignment.assignment_id=OLD.assignment_id
          AND assignment.confidentiality_accepted_at IS NULL
          AND assignment.status NOT IN ('accepted','completed')
      )
    ) THEN
      RAISE EXCEPTION 'not-accepted network outcomes require an uncommitted selection';
    END IF;
    IF NEW.terminal_outcome = 'not_submitted' AND (
      OLD.state NOT IN ('selected','voucher_issued')
      OR (
        OLD.state = 'selected'
        AND NOT EXISTS (
          SELECT 1 FROM "tokenless_assurance_assignments" assignment
          WHERE assignment.assignment_id=OLD.assignment_id
            AND assignment.status IN ('accepted','expired','released')
            AND assignment.confidentiality_accepted_at IS NOT NULL
        )
      )
    ) THEN
      RAISE EXCEPTION 'not-submitted network outcomes require accepted or voucher-issued work';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_network_assignment_settlements"
  DROP COLUMN "integrity_reviewer_lookup";
--> statement-breakpoint

CREATE TABLE "tokenless_network_settlement_failures" (
  "binding_id" text PRIMARY KEY
    REFERENCES "tokenless_network_assignment_settlements" ("binding_id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'retrying',
  "attempt_count" integer NOT NULL DEFAULT 1,
  "first_failed_at" timestamp with time zone NOT NULL,
  "last_failed_at" timestamp with time zone NOT NULL,
  "next_retry_at" timestamp with time zone,
  "last_error_code" text NOT NULL,
  "last_error_digest" text NOT NULL,
  "operator_alert_state" text NOT NULL DEFAULT 'pending',
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_network_settlement_failures_status_check"
    CHECK ("status" IN ('retrying','dead','resolved')),
  CONSTRAINT "tokenless_network_settlement_failures_attempt_check"
    CHECK ("attempt_count" BETWEEN 1 AND 5),
  CONSTRAINT "tokenless_network_settlement_failures_digest_check"
    CHECK ("last_error_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_network_settlement_failures_state_check" CHECK (
    (
      "status"='retrying' AND "next_retry_at" IS NOT NULL
      AND "resolved_at" IS NULL AND "operator_alert_state"='pending'
    )
    OR (
      "status"='dead' AND "next_retry_at" IS NULL
      AND "resolved_at" IS NULL AND "operator_alert_state"='pending'
    )
    OR (
      "status"='resolved' AND "next_retry_at" IS NULL
      AND "resolved_at" IS NOT NULL AND "operator_alert_state"='resolved'
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_network_settlement_failures_retry_idx"
  ON "tokenless_network_settlement_failures" ("status","next_retry_at","last_failed_at");--> statement-breakpoint
CREATE INDEX "tokenless_network_settlement_failures_alert_idx"
  ON "tokenless_network_settlement_failures" ("operator_alert_state","last_failed_at")
  WHERE "operator_alert_state"='pending';

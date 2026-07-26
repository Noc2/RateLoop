ALTER TABLE "tokenless_paid_assignment_operations"
  DROP CONSTRAINT "tokenless_paid_assignment_operations_state_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  DROP CONSTRAINT "tokenless_paid_assignment_operations_state_shape_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD COLUMN "terminal_outcome" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD COLUMN "settlement_reference" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD COLUMN "settlement_evidence_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD COLUMN "terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD CONSTRAINT "tokenless_paid_assignment_operations_state_check"
  CHECK ("state" IN (
    'prepared', 'quote_created', 'ask_prepared', 'ask_attached', 'round_bound',
    'active', 'settling', 'terminal'
  ));--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD CONSTRAINT "tokenless_paid_assignment_operations_terminal_check" CHECK (
    (
      "state" <> 'terminal'
      AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL
      AND "settlement_evidence_hash" IS NULL
      AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'terminal'
      AND "terminal_outcome" = 'all_seats_terminal'
      AND char_length("settlement_reference") BETWEEN 8 AND 1024
      AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "terminal_at" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_operations"
  ADD CONSTRAINT "tokenless_paid_assignment_operations_state_shape_check" CHECK (
    (
      "state" = 'prepared'
      AND "quote_id" IS NULL AND "quote_expires_at" IS NULL AND "ask_operation_key" IS NULL
      AND "prepaid_reservation_id" IS NULL AND "policy_reservation_id" IS NULL
      AND "deployment_key" IS NULL AND "chain_id" IS NULL AND "panel_address" IS NULL
      AND "round_id" IS NULL AND "content_id" IS NULL AND "terms_hash" IS NULL
      AND "round_terms_hash" IS NULL AND "payment_mode" IS NULL AND "payment_reference" IS NULL
      AND "commit_deadline" IS NULL AND "confirmed_at" IS NULL AND "bound_at" IS NULL
    )
    OR (
      "state" = 'quote_created'
      AND "quote_id" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "ask_operation_key" IS NULL
      AND "prepaid_reservation_id" IS NULL AND "policy_reservation_id" IS NULL
      AND "deployment_key" IS NULL AND "chain_id" IS NULL AND "panel_address" IS NULL
      AND "round_id" IS NULL AND "content_id" IS NULL AND "terms_hash" IS NULL
      AND "round_terms_hash" IS NULL AND "payment_mode" IS NULL AND "payment_reference" IS NULL
      AND "commit_deadline" IS NULL AND "confirmed_at" IS NULL AND "bound_at" IS NULL
    )
    OR (
      "state" = 'ask_prepared'
      AND "quote_id" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "ask_operation_key" IS NULL
      AND "prepaid_reservation_id" IS NOT NULL AND "policy_reservation_id" IS NOT NULL
      AND "deployment_key" IS NULL AND "chain_id" IS NULL AND "panel_address" IS NULL
      AND "round_id" IS NULL AND "content_id" IS NULL AND "terms_hash" IS NULL
      AND "round_terms_hash" IS NULL AND "payment_mode" IS NULL AND "payment_reference" IS NULL
      AND "commit_deadline" IS NULL AND "confirmed_at" IS NULL AND "bound_at" IS NULL
    )
    OR (
      "state" = 'ask_attached'
      AND "quote_id" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "ask_operation_key" IS NOT NULL
      AND "prepaid_reservation_id" IS NOT NULL AND "policy_reservation_id" IS NOT NULL
      AND "deployment_key" IS NULL AND "chain_id" IS NULL AND "panel_address" IS NULL
      AND "round_id" IS NULL AND "content_id" IS NULL AND "terms_hash" IS NULL
      AND "round_terms_hash" IS NULL AND "payment_mode" IS NULL AND "payment_reference" IS NULL
      AND "commit_deadline" IS NULL AND "confirmed_at" IS NULL AND "bound_at" IS NULL
    )
    OR (
      "state" IN ('round_bound','active','settling','terminal')
      AND "quote_id" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "ask_operation_key" IS NOT NULL
      AND "prepaid_reservation_id" IS NOT NULL AND "policy_reservation_id" IS NOT NULL
      AND "deployment_key" IS NOT NULL AND "chain_id" IS NOT NULL AND "panel_address" IS NOT NULL
      AND "round_id" IS NOT NULL AND "content_id" IS NOT NULL AND "terms_hash" IS NOT NULL
      AND "round_terms_hash" IS NOT NULL AND "payment_mode" = 'prepaid'
      AND "payment_reference" = "prepaid_reservation_id"
      AND "commit_deadline" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "bound_at" IS NOT NULL
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_paid_assignment_seats"
  DROP CONSTRAINT "tokenless_paid_assignment_seats_state_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  DROP CONSTRAINT "tokenless_paid_assignment_seats_state_shape_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "commit_id" text REFERENCES "tokenless_rater_commits" ("commit_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "revealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "terminal_outcome" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "settlement_reference" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "settlement_evidence_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD COLUMN "terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD CONSTRAINT "tokenless_paid_assignment_seats_commit_unique" UNIQUE ("commit_id");--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD CONSTRAINT "tokenless_paid_assignment_seats_state_check"
  CHECK ("state" IN ('planned','voucher_prepared','accepted','committed','revealed','terminal'));--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD CONSTRAINT "tokenless_paid_assignment_seats_state_shape_check" CHECK (
    (
      "state" = 'planned'
      AND "transition_revision" = CASE WHEN "identity_erased_at" IS NULL THEN 0 ELSE 1 END
      AND "assignment_id" IS NULL AND "voucher_issuance_id" IS NULL
      AND "commit_id" IS NULL AND "accepted_at" IS NULL AND "committed_at" IS NULL
      AND "revealed_at" IS NULL AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'voucher_prepared'
      AND "transition_revision" = CASE WHEN "identity_erased_at" IS NULL THEN 1 ELSE 2 END
      AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL
      AND "commit_id" IS NULL AND "accepted_at" IS NULL AND "committed_at" IS NULL
      AND "revealed_at" IS NULL AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'accepted'
      AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL
      AND "commit_id" IS NULL AND "accepted_at" IS NOT NULL AND "committed_at" IS NULL
      AND "revealed_at" IS NULL AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'committed'
      AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL
      AND "commit_id" IS NOT NULL AND "accepted_at" IS NOT NULL AND "committed_at" IS NOT NULL
      AND "revealed_at" IS NULL AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'revealed'
      AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL
      AND "commit_id" IS NOT NULL AND "accepted_at" IS NOT NULL AND "committed_at" IS NOT NULL
      AND "revealed_at" IS NOT NULL AND "terminal_outcome" IS NULL
      AND "settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL AND "terminal_at" IS NULL
    )
    OR (
      "state" = 'terminal'
      AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL
      AND "terminal_outcome" IN (
        'paid','compensated','no_payout','claim_expired','stale_refunded',
        'not_accepted','not_submitted','reveal_expired'
      )
      AND char_length("settlement_reference") BETWEEN 8 AND 1024
      AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "terminal_at" IS NOT NULL
    )
  );--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_seats"
  ADD CONSTRAINT "tokenless_paid_assignment_seats_timeline_check" CHECK (
    ("accepted_at" IS NULL OR "accepted_at" BETWEEN "created_at" AND "updated_at")
    AND ("committed_at" IS NULL OR "committed_at" BETWEEN "accepted_at" AND "updated_at")
    AND ("revealed_at" IS NULL OR "revealed_at" BETWEEN "committed_at" AND "updated_at")
    AND ("terminal_at" IS NULL OR "terminal_at" BETWEEN "created_at" AND "updated_at")
  );--> statement-breakpoint

ALTER TABLE "tokenless_paid_assignment_receipts"
  DROP CONSTRAINT "tokenless_paid_assignment_receipts_type_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_receipts"
  DROP CONSTRAINT "tokenless_paid_assignment_receipts_revision_shape_check";--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_receipts"
  ADD CONSTRAINT "tokenless_paid_assignment_receipts_type_check" CHECK (
    "receipt_type" IN (
      'operation_prepared','quote_created','ask_prepared','ask_attached','round_bound',
      'quote_expired_recovered','activation_failed','operation_active','operation_settling',
      'operation_terminal','seat_voucher_prepared','seat_accepted','seat_committed',
      'seat_revealed','seat_terminal','seat_identity_erased'
    )
  );--> statement-breakpoint
ALTER TABLE "tokenless_paid_assignment_receipts"
  ADD CONSTRAINT "tokenless_paid_assignment_receipts_revision_shape_check" CHECK (
    (
      "receipt_type" IN (
        'seat_voucher_prepared','seat_accepted','seat_committed','seat_revealed',
        'seat_terminal','seat_identity_erased'
      )
      AND "seat_id" IS NOT NULL AND "seat_revision" IS NOT NULL
      AND "operation_revision" IS NULL
    )
    OR (
      "receipt_type" NOT IN (
        'seat_voucher_prepared','seat_accepted','seat_committed','seat_revealed',
        'seat_terminal','seat_identity_erased'
      )
      AND "seat_id" IS NULL AND "operation_revision" IS NOT NULL AND "seat_revision" IS NULL
    )
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_paid_assignment_operation_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF ROW(NEW.workspace_id,NEW.opportunity_id,NEW.lane,NEW.api_key_id,
         NEW.publishing_policy_id,NEW.publishing_policy_version,NEW.request_idempotency_key,
         NEW.request_hash,NEW.prepared_request_hash,NEW.economics_hash,NEW.reviewer_set_hash,
         NEW.audience_policy_hash,NEW.chain_admission_policy_hash,NEW.admission_policy_json,
         NEW.artifact_commitments_json,NEW.artifact_binding_hash,NEW.expected_amount_atomic)
     IS DISTINCT FROM
     ROW(OLD.workspace_id,OLD.opportunity_id,OLD.lane,OLD.api_key_id,
         OLD.publishing_policy_id,OLD.publishing_policy_version,OLD.request_idempotency_key,
         OLD.request_hash,OLD.prepared_request_hash,OLD.economics_hash,OLD.reviewer_set_hash,
         OLD.audience_policy_hash,OLD.chain_admission_policy_hash,OLD.admission_policy_json,
         OLD.artifact_commitments_json,OLD.artifact_binding_hash,OLD.expected_amount_atomic) THEN
    RAISE EXCEPTION 'paid-assignment frozen terms are immutable';
  END IF;
  old_rank := CASE OLD.state
    WHEN 'prepared' THEN 1 WHEN 'quote_created' THEN 2 WHEN 'ask_prepared' THEN 3
    WHEN 'ask_attached' THEN 4 WHEN 'round_bound' THEN 5 WHEN 'active' THEN 6
    WHEN 'settling' THEN 7 WHEN 'terminal' THEN 8 END;
  new_rank := CASE NEW.state
    WHEN 'prepared' THEN 1 WHEN 'quote_created' THEN 2 WHEN 'ask_prepared' THEN 3
    WHEN 'ask_attached' THEN 4 WHEN 'round_bound' THEN 5 WHEN 'active' THEN 6
    WHEN 'settling' THEN 7 WHEN 'terminal' THEN 8 END;
  IF NEW.state <> OLD.state THEN
    IF NOT (
      new_rank = old_rank + 1
      OR (OLD.state IN ('quote_created','ask_prepared') AND NEW.state='prepared')
    ) THEN
      RAISE EXCEPTION 'invalid paid-assignment state transition % -> %', OLD.state, NEW.state;
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'paid-assignment state transitions require the next receipt revision';
    END IF;
  ELSIF NEW.transition_revision <> OLD.transition_revision THEN
    RAISE EXCEPTION 'paid-assignment receipt revision requires a state transition';
  END IF;
  IF (
    (OLD.quote_id IS NOT NULL AND NEW.quote_id IS DISTINCT FROM OLD.quote_id)
    OR (OLD.quote_expires_at IS NOT NULL AND NEW.quote_expires_at IS DISTINCT FROM OLD.quote_expires_at)
    OR (OLD.ask_operation_key IS NOT NULL AND NEW.ask_operation_key IS DISTINCT FROM OLD.ask_operation_key)
    OR (OLD.prepaid_reservation_id IS NOT NULL
        AND NEW.prepaid_reservation_id IS DISTINCT FROM OLD.prepaid_reservation_id)
    OR (OLD.policy_reservation_id IS NOT NULL
        AND NEW.policy_reservation_id IS DISTINCT FROM OLD.policy_reservation_id)
    OR (OLD.deployment_key IS NOT NULL AND NEW.deployment_key IS DISTINCT FROM OLD.deployment_key)
    OR (OLD.chain_id IS NOT NULL AND NEW.chain_id IS DISTINCT FROM OLD.chain_id)
    OR (OLD.panel_address IS NOT NULL AND NEW.panel_address IS DISTINCT FROM OLD.panel_address)
    OR (OLD.round_id IS NOT NULL AND NEW.round_id IS DISTINCT FROM OLD.round_id)
    OR (OLD.content_id IS NOT NULL AND NEW.content_id IS DISTINCT FROM OLD.content_id)
    OR (OLD.terms_hash IS NOT NULL AND NEW.terms_hash IS DISTINCT FROM OLD.terms_hash)
    OR (OLD.round_terms_hash IS NOT NULL AND NEW.round_terms_hash IS DISTINCT FROM OLD.round_terms_hash)
    OR (OLD.payment_mode IS NOT NULL AND NEW.payment_mode IS DISTINCT FROM OLD.payment_mode)
    OR (OLD.payment_reference IS NOT NULL AND NEW.payment_reference IS DISTINCT FROM OLD.payment_reference)
    OR (OLD.commit_deadline IS NOT NULL AND NEW.commit_deadline IS DISTINCT FROM OLD.commit_deadline)
    OR (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)
    OR (OLD.bound_at IS NOT NULL AND NEW.bound_at IS DISTINCT FROM OLD.bound_at)
  ) THEN
    RAISE EXCEPTION 'paid-assignment transition changed immutable prior evidence';
  END IF;
  IF OLD.state='terminal' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal paid-assignment operations are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_paid_assignment_seat_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.position IS DISTINCT FROM OLD.position
     OR NEW.identity_commitment IS DISTINCT FROM OLD.identity_commitment
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'paid-assignment seat commitment is immutable';
  END IF;
  IF OLD.identity_erased_at IS NULL AND NEW.identity_erased_at IS NOT NULL
     AND NEW.state=OLD.state
     AND NEW.assignment_id IS NOT DISTINCT FROM OLD.assignment_id
     AND NEW.voucher_issuance_id IS NOT DISTINCT FROM OLD.voucher_issuance_id
     AND NEW.commit_id IS NOT DISTINCT FROM OLD.commit_id
     AND OLD.reviewer_principal_id IS NOT NULL AND OLD.rater_id IS NOT NULL AND OLD.payout_account IS NOT NULL
     AND NEW.reviewer_principal_id IS NULL AND NEW.rater_id IS NULL AND NEW.payout_account IS NULL
     AND NEW.identity_erasure_receipt_hash IS NOT NULL
     AND NEW.transition_revision=OLD.transition_revision+1 THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.reviewer_principal_id,NEW.rater_id,NEW.payout_account,NEW.identity_erased_at,
         NEW.identity_erasure_receipt_hash)
     IS DISTINCT FROM ROW(OLD.reviewer_principal_id,OLD.rater_id,OLD.payout_account,OLD.identity_erased_at,
                          OLD.identity_erasure_receipt_hash) THEN
    RAISE EXCEPTION 'paid-assignment seat identity is immutable before erasure';
  END IF;
  old_rank := CASE OLD.state
    WHEN 'planned' THEN 0 WHEN 'voucher_prepared' THEN 1 WHEN 'accepted' THEN 2
    WHEN 'committed' THEN 3 WHEN 'revealed' THEN 4 WHEN 'terminal' THEN 5 END;
  new_rank := CASE NEW.state
    WHEN 'planned' THEN 0 WHEN 'voucher_prepared' THEN 1 WHEN 'accepted' THEN 2
    WHEN 'committed' THEN 3 WHEN 'revealed' THEN 4 WHEN 'terminal' THEN 5 END;
  IF OLD.state='terminal' OR new_rank <= old_rank OR NEW.transition_revision <> OLD.transition_revision+1 THEN
    RAISE EXCEPTION 'invalid paid-assignment seat transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_require_paid_assignment_seat_receipt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transition_revision > 0 AND NOT EXISTS (
    SELECT 1 FROM tokenless_paid_assignment_receipts r
    WHERE r.seat_id=NEW.seat_id AND r.seat_revision=NEW.transition_revision
      AND r.receipt_type=CASE
        WHEN NEW.identity_erased_at IS NOT NULL AND OLD.identity_erased_at IS NULL THEN 'seat_identity_erased'
        WHEN NEW.state='voucher_prepared' THEN 'seat_voucher_prepared'
        WHEN NEW.state='accepted' THEN 'seat_accepted'
        WHEN NEW.state='committed' THEN 'seat_committed'
        WHEN NEW.state='revealed' THEN 'seat_revealed'
        WHEN NEW.state='terminal' THEN 'seat_terminal'
      END
  ) THEN
    RAISE EXCEPTION 'paid-assignment seat state has no matching immutable receipt';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE INDEX "tokenless_paid_assignment_operations_settlement_idx"
  ON "tokenless_paid_assignment_operations" ("state","commit_deadline","operation_id")
  WHERE "state" IN ('round_bound','active','settling');--> statement-breakpoint
CREATE INDEX "tokenless_paid_assignment_seats_settlement_idx"
  ON "tokenless_paid_assignment_seats" ("operation_id","state","position")
  WHERE "state" <> 'terminal';--> statement-breakpoint

ALTER TABLE "tokenless_private_review_responses"
  ADD COLUMN "settlement_reference" text;--> statement-breakpoint
ALTER TABLE "tokenless_private_review_responses"
  ADD COLUMN "settlement_evidence_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_private_review_responses"
  ADD CONSTRAINT "tokenless_private_review_responses_settlement_check" CHECK (
    ("settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL)
    OR (
      char_length("settlement_reference") BETWEEN 8 AND 1024
      AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    )
  );--> statement-breakpoint

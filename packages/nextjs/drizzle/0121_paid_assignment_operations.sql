CREATE TABLE "tokenless_paid_assignment_operations" (
  "operation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "lane" text NOT NULL,
  "api_key_id" text NOT NULL,
  "publishing_policy_id" text NOT NULL,
  "publishing_policy_version" integer NOT NULL,
  "request_idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "prepared_request_hash" text NOT NULL,
  "economics_hash" text NOT NULL,
  "reviewer_set_hash" text NOT NULL,
  "audience_policy_hash" text NOT NULL,
  "chain_admission_policy_hash" text NOT NULL,
  "admission_policy_json" text NOT NULL,
  "artifact_commitments_json" text NOT NULL,
  "artifact_binding_hash" text NOT NULL,
  "expected_amount_atomic" numeric(78, 0) NOT NULL,
  "state" text NOT NULL DEFAULT 'prepared',
  "transition_revision" integer NOT NULL DEFAULT 1,
  "activation_owner" text,
  "activation_expires_at" timestamp with time zone,
  "activation_attempt_count" integer NOT NULL DEFAULT 0,
  "last_error_code" text,
  "quote_id" text,
  "quote_expires_at" timestamp with time zone,
  "ask_operation_key" text,
  "prepaid_reservation_id" text,
  "policy_reservation_id" text,
  "deployment_key" text,
  "chain_id" integer,
  "panel_address" text,
  "round_id" numeric(78, 0),
  "content_id" text,
  "terms_hash" text,
  "round_terms_hash" text,
  "payment_mode" text,
  "payment_reference" text,
  "commit_deadline" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "bound_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_assignment_operations_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_api_key_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "tokenless_workspace_api_keys" ("key_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_policy_fk"
    FOREIGN KEY ("workspace_id", "publishing_policy_id", "publishing_policy_version")
    REFERENCES "tokenless_agent_publishing_policies" ("workspace_id", "policy_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_quote_fk"
    FOREIGN KEY ("quote_id") REFERENCES "tokenless_agent_quotes" ("quote_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_ask_fk"
    FOREIGN KEY ("ask_operation_key") REFERENCES "tokenless_agent_asks" ("operation_key") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_prepaid_fk"
    FOREIGN KEY ("prepaid_reservation_id")
    REFERENCES "tokenless_prepaid_reservations" ("reservation_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_policy_reservation_fk"
    FOREIGN KEY ("policy_reservation_id")
    REFERENCES "tokenless_agent_policy_budget_reservations" ("reservation_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_operations_workspace_request_unique"
    UNIQUE ("workspace_id", "request_idempotency_key"),
  CONSTRAINT "tokenless_paid_assignment_operations_opportunity_lane_unique"
    UNIQUE ("workspace_id", "opportunity_id", "lane"),
  CONSTRAINT "tokenless_paid_assignment_operations_quote_unique" UNIQUE ("quote_id"),
  CONSTRAINT "tokenless_paid_assignment_operations_ask_unique" UNIQUE ("ask_operation_key"),
  CONSTRAINT "tokenless_paid_assignment_operations_lane_check"
    CHECK ("lane" IN ('private_invited_paid', 'public_paid_network', 'hybrid_public_safe')),
  CONSTRAINT "tokenless_paid_assignment_operations_state_check"
    CHECK ("state" IN ('prepared', 'quote_created', 'ask_prepared', 'ask_attached', 'round_bound')),
  CONSTRAINT "tokenless_paid_assignment_operations_version_check"
    CHECK ("publishing_policy_version" > 0 AND "transition_revision" > 0),
  CONSTRAINT "tokenless_paid_assignment_operations_activation_check" CHECK (
    ("activation_owner" IS NULL AND "activation_expires_at" IS NULL)
    OR ("activation_owner" IS NOT NULL AND "activation_expires_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_paid_assignment_operations_hashes_check" CHECK (
    "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "prepared_request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reviewer_set_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audience_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "chain_admission_policy_hash" ~ '^0x[0-9a-f]{64}$'
    AND "artifact_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_paid_assignment_operations_amount_check" CHECK ("expected_amount_atomic" > 0),
  CONSTRAINT "tokenless_paid_assignment_operations_state_shape_check" CHECK (
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
      "state" = 'round_bound'
      AND "quote_id" IS NOT NULL AND "quote_expires_at" IS NOT NULL AND "ask_operation_key" IS NOT NULL
      AND "prepaid_reservation_id" IS NOT NULL AND "policy_reservation_id" IS NOT NULL
      AND "deployment_key" IS NOT NULL AND "chain_id" IS NOT NULL AND "panel_address" IS NOT NULL
      AND "round_id" IS NOT NULL AND "content_id" IS NOT NULL AND "terms_hash" IS NOT NULL
      AND "round_terms_hash" IS NOT NULL AND "payment_mode" = 'prepaid'
      AND "payment_reference" = "prepaid_reservation_id"
      AND "commit_deadline" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "bound_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_paid_assignment_operations_round_values_check" CHECK (
    ("chain_id" IS NULL OR "chain_id" > 0)
    AND ("round_id" IS NULL OR "round_id" >= 0)
    AND ("panel_address" IS NULL OR "panel_address" ~ '^0x[0-9a-f]{40}$')
    AND ("content_id" IS NULL OR "content_id" ~ '^0x[0-9a-f]{64}$')
    AND ("terms_hash" IS NULL OR "terms_hash" ~ '^0x[0-9a-f]{64}$')
    AND ("round_terms_hash" IS NULL OR "round_terms_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_paid_assignment_operations_timestamps_check" CHECK (
    "updated_at" >= "created_at"
    AND ("quote_expires_at" IS NULL OR "quote_expires_at" > "created_at")
    AND ("confirmed_at" IS NULL OR "confirmed_at" BETWEEN "created_at" AND "updated_at")
    AND ("bound_at" IS NULL OR "bound_at" BETWEEN "confirmed_at" AND "updated_at")
    AND ("commit_deadline" IS NULL OR "commit_deadline" > "confirmed_at")
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_assignment_operations_state_idx"
  ON "tokenless_paid_assignment_operations" USING btree ("state", "updated_at", "operation_id");--> statement-breakpoint
CREATE INDEX "tokenless_paid_assignment_operations_activation_idx"
  ON "tokenless_paid_assignment_operations" USING btree ("activation_expires_at", "state", "operation_id");--> statement-breakpoint

CREATE TABLE "tokenless_paid_assignment_seats" (
  "seat_id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "position" integer NOT NULL,
  "reviewer_principal_id" text,
  "rater_id" text,
  "payout_account" text,
  "identity_commitment" text NOT NULL,
  "identity_erased_at" timestamp with time zone,
  "identity_erasure_receipt_hash" text,
  "assignment_id" text,
  "voucher_issuance_id" text,
  "state" text NOT NULL DEFAULT 'planned',
  "transition_revision" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_assignment_seats_operation_fk"
    FOREIGN KEY ("operation_id")
    REFERENCES "tokenless_paid_assignment_operations" ("operation_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_seats_principal_fk"
    FOREIGN KEY ("reviewer_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_seats_rater_fk"
    FOREIGN KEY ("rater_id") REFERENCES "tokenless_rater_profiles" ("rater_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_seats_assignment_fk"
    FOREIGN KEY ("assignment_id")
    REFERENCES "tokenless_private_unpaid_review_assignments" ("assignment_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_seats_voucher_issuance_fk"
    FOREIGN KEY ("voucher_issuance_id")
    REFERENCES "tokenless_paid_review_voucher_issuances" ("issuance_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_seats_operation_position_unique" UNIQUE ("operation_id", "position"),
  CONSTRAINT "tokenless_paid_assignment_seats_operation_principal_unique"
    UNIQUE ("operation_id", "reviewer_principal_id"),
  CONSTRAINT "tokenless_paid_assignment_seats_operation_payout_unique" UNIQUE ("operation_id", "payout_account"),
  CONSTRAINT "tokenless_paid_assignment_seats_assignment_unique" UNIQUE ("assignment_id"),
  CONSTRAINT "tokenless_paid_assignment_seats_voucher_issuance_unique" UNIQUE ("voucher_issuance_id"),
  CONSTRAINT "tokenless_paid_assignment_seats_position_check" CHECK ("position" >= 0),
  CONSTRAINT "tokenless_paid_assignment_seats_identity_check" CHECK (
    "identity_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND (
      ("reviewer_principal_id" IS NOT NULL AND "rater_id" IS NOT NULL AND "payout_account" IS NOT NULL
       AND "payout_account" ~ '^0x[0-9a-f]{40}$'
       AND "identity_erased_at" IS NULL AND "identity_erasure_receipt_hash" IS NULL)
      OR
      ("reviewer_principal_id" IS NULL AND "rater_id" IS NULL AND "payout_account" IS NULL
       AND "identity_erased_at" IS NOT NULL
       AND "identity_erasure_receipt_hash" ~ '^sha256:[0-9a-f]{64}$')
    )
  ),
  CONSTRAINT "tokenless_paid_assignment_seats_state_check" CHECK ("state" IN ('planned', 'voucher_prepared')),
  CONSTRAINT "tokenless_paid_assignment_seats_state_shape_check" CHECK (
    ("state" = 'planned'
        AND "transition_revision" = CASE WHEN "identity_erased_at" IS NULL THEN 0 ELSE 1 END
        AND "assignment_id" IS NULL AND "voucher_issuance_id" IS NULL)
    OR ("state" = 'voucher_prepared'
        AND "transition_revision" = CASE WHEN "identity_erased_at" IS NULL THEN 1 ELSE 2 END
        AND "assignment_id" IS NOT NULL AND "voucher_issuance_id" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_paid_assignment_seats_timestamps_check" CHECK (
    "updated_at" >= "created_at"
    AND ("identity_erased_at" IS NULL OR "identity_erased_at" BETWEEN "created_at" AND "updated_at")
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_assignment_seats_state_idx"
  ON "tokenless_paid_assignment_seats" USING btree ("operation_id", "state", "position");--> statement-breakpoint

CREATE TABLE "tokenless_paid_assignment_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "seat_id" text,
  "sequence" integer NOT NULL,
  "operation_revision" integer,
  "seat_revision" integer,
  "receipt_type" text NOT NULL,
  "receipt_version" integer NOT NULL,
  "receipt_json" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_assignment_receipts_operation_fk"
    FOREIGN KEY ("operation_id")
    REFERENCES "tokenless_paid_assignment_operations" ("operation_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_receipts_seat_fk"
    FOREIGN KEY ("seat_id") REFERENCES "tokenless_paid_assignment_seats" ("seat_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_paid_assignment_receipts_operation_sequence_unique" UNIQUE ("operation_id", "sequence"),
  CONSTRAINT "tokenless_paid_assignment_receipts_operation_revision_unique"
    UNIQUE ("operation_id", "operation_revision"),
  CONSTRAINT "tokenless_paid_assignment_receipts_seat_revision_unique" UNIQUE ("seat_id", "seat_revision"),
  CONSTRAINT "tokenless_paid_assignment_receipts_hash_unique" UNIQUE ("receipt_hash"),
  CONSTRAINT "tokenless_paid_assignment_receipts_type_check" CHECK (
    "receipt_type" IN (
      'operation_prepared', 'quote_created', 'ask_prepared', 'ask_attached', 'round_bound',
      'quote_expired_recovered', 'activation_failed', 'seat_voucher_prepared', 'seat_identity_erased'
    )
  ),
  CONSTRAINT "tokenless_paid_assignment_receipts_version_check" CHECK ("receipt_version" = 1),
  CONSTRAINT "tokenless_paid_assignment_receipts_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "tokenless_paid_assignment_receipts_hash_check"
    CHECK ("receipt_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_paid_assignment_receipts_revision_shape_check" CHECK (
    ("receipt_type" = 'seat_voucher_prepared' AND "seat_id" IS NOT NULL
      AND "seat_revision" = 1 AND "operation_revision" IS NULL)
    OR ("receipt_type" = 'seat_identity_erased' AND "seat_id" IS NOT NULL
      AND "seat_revision" IN (1,2) AND "operation_revision" IS NULL)
    OR ("receipt_type" NOT IN ('seat_voucher_prepared','seat_identity_erased') AND "seat_id" IS NULL
      AND "operation_revision" IS NOT NULL AND "seat_revision" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_paid_assignment_receipts_timeline_idx"
  ON "tokenless_paid_assignment_receipts" USING btree ("operation_id", "created_at", "sequence");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_paid_assignment_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'paid-assignment receipts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_assignment_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_paid_assignment_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_paid_assignment_receipt_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_paid_assignment_operation_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
  IF NEW.state <> OLD.state THEN
    IF NOT (
      (OLD.state='prepared' AND NEW.state='quote_created')
      OR (OLD.state='quote_created' AND NEW.state='ask_prepared')
      OR (OLD.state='ask_prepared' AND NEW.state='ask_attached')
      OR (OLD.state='ask_attached' AND NEW.state='round_bound')
      OR (OLD.state IN ('quote_created','ask_prepared') AND NEW.state='prepared')
    ) THEN
      RAISE EXCEPTION 'invalid paid-assignment state transition % -> %', OLD.state, NEW.state;
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'paid-assignment state transitions require the next receipt revision';
    END IF;
    IF OLD.state='prepared' AND NEW.state='quote_created' AND
       ROW(NEW.ask_operation_key,NEW.prepaid_reservation_id,NEW.policy_reservation_id,
           NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,NEW.content_id,NEW.terms_hash,
           NEW.round_terms_hash,NEW.payment_mode,NEW.payment_reference,NEW.commit_deadline,NEW.confirmed_at,NEW.bound_at)
       IS DISTINCT FROM
       ROW(OLD.ask_operation_key,OLD.prepaid_reservation_id,OLD.policy_reservation_id,
           OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,OLD.content_id,OLD.terms_hash,
           OLD.round_terms_hash,OLD.payment_mode,OLD.payment_reference,OLD.commit_deadline,OLD.confirmed_at,OLD.bound_at) THEN
      RAISE EXCEPTION 'quote transition changed unrelated paid-assignment evidence';
    ELSIF OLD.state='quote_created' AND NEW.state='ask_prepared' AND
       ROW(NEW.quote_id,NEW.quote_expires_at,NEW.ask_operation_key,
           NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,NEW.content_id,NEW.terms_hash,
           NEW.round_terms_hash,NEW.payment_mode,NEW.payment_reference,NEW.commit_deadline,NEW.confirmed_at,NEW.bound_at)
       IS DISTINCT FROM
       ROW(OLD.quote_id,OLD.quote_expires_at,OLD.ask_operation_key,
           OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,OLD.content_id,OLD.terms_hash,
           OLD.round_terms_hash,OLD.payment_mode,OLD.payment_reference,OLD.commit_deadline,OLD.confirmed_at,OLD.bound_at) THEN
      RAISE EXCEPTION 'ask preparation changed unrelated paid-assignment evidence';
    ELSIF OLD.state='ask_prepared' AND NEW.state='ask_attached' AND
       ROW(NEW.quote_id,NEW.quote_expires_at,NEW.prepaid_reservation_id,NEW.policy_reservation_id,
           NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,NEW.content_id,NEW.terms_hash,
           NEW.round_terms_hash,NEW.payment_mode,NEW.payment_reference,NEW.commit_deadline,NEW.confirmed_at,NEW.bound_at)
       IS DISTINCT FROM
       ROW(OLD.quote_id,OLD.quote_expires_at,OLD.prepaid_reservation_id,OLD.policy_reservation_id,
           OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,OLD.content_id,OLD.terms_hash,
           OLD.round_terms_hash,OLD.payment_mode,OLD.payment_reference,OLD.commit_deadline,OLD.confirmed_at,OLD.bound_at) THEN
      RAISE EXCEPTION 'ask attachment changed unrelated paid-assignment evidence';
    ELSIF OLD.state='ask_attached' AND NEW.state='round_bound' AND
       ROW(NEW.quote_id,NEW.quote_expires_at,NEW.ask_operation_key,
           NEW.prepaid_reservation_id,NEW.policy_reservation_id)
       IS DISTINCT FROM
       ROW(OLD.quote_id,OLD.quote_expires_at,OLD.ask_operation_key,
           OLD.prepaid_reservation_id,OLD.policy_reservation_id) THEN
      RAISE EXCEPTION 'round binding changed attached paid-assignment identity';
    END IF;
  ELSIF NEW.transition_revision <> OLD.transition_revision THEN
    RAISE EXCEPTION 'paid-assignment receipt revision requires a state transition';
  ELSIF ROW(NEW.quote_id,NEW.quote_expires_at,NEW.ask_operation_key,
            NEW.prepaid_reservation_id,NEW.policy_reservation_id,NEW.deployment_key,NEW.chain_id,
            NEW.panel_address,NEW.round_id,NEW.content_id,NEW.terms_hash,NEW.round_terms_hash,
            NEW.payment_mode,NEW.payment_reference,NEW.commit_deadline,NEW.confirmed_at,NEW.bound_at)
        IS DISTINCT FROM
        ROW(OLD.quote_id,OLD.quote_expires_at,OLD.ask_operation_key,
            OLD.prepaid_reservation_id,OLD.policy_reservation_id,OLD.deployment_key,OLD.chain_id,
            OLD.panel_address,OLD.round_id,OLD.content_id,OLD.terms_hash,OLD.round_terms_hash,
            OLD.payment_mode,OLD.payment_reference,OLD.commit_deadline,OLD.confirmed_at,OLD.bound_at) THEN
    RAISE EXCEPTION 'same-state paid-assignment updates may only change activation metadata';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_assignment_operation_transition_guard"
  BEFORE UPDATE ON "tokenless_paid_assignment_operations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_paid_assignment_operation_transition"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_require_paid_assignment_operation_receipt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_paid_assignment_receipts r
    WHERE r.operation_id=NEW.operation_id AND r.operation_revision=NEW.transition_revision
  ) THEN
    RAISE EXCEPTION 'paid-assignment state has no matching immutable receipt';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tokenless_paid_assignment_operation_receipt_required"
  AFTER INSERT OR UPDATE ON "tokenless_paid_assignment_operations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tokenless_require_paid_assignment_operation_receipt"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_paid_assignment_seat_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
     AND OLD.reviewer_principal_id IS NOT NULL AND OLD.rater_id IS NOT NULL AND OLD.payout_account IS NOT NULL
     AND NEW.reviewer_principal_id IS NULL AND NEW.rater_id IS NULL AND NEW.payout_account IS NULL
     AND NEW.identity_erasure_receipt_hash IS NOT NULL
     AND NEW.transition_revision=OLD.transition_revision+1 THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.reviewer_principal_id,NEW.rater_id,NEW.payout_account,NEW.identity_erased_at,
         NEW.identity_erasure_receipt_hash)
     IS DISTINCT FROM ROW(OLD.reviewer_principal_id,OLD.rater_id,OLD.payout_account,OLD.identity_erased_at,
                          OLD.identity_erasure_receipt_hash)
     OR NOT (OLD.state='planned' AND NEW.state='voucher_prepared'
             AND NEW.transition_revision=OLD.transition_revision+1) THEN
    RAISE EXCEPTION 'invalid paid-assignment seat transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_assignment_seat_transition_guard"
  BEFORE UPDATE ON "tokenless_paid_assignment_seats"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_paid_assignment_seat_transition"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_validate_paid_assignment_seat_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reviewer_principal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM tokenless_principals p
    JOIN tokenless_rater_profiles r ON r.principal_id=p.principal_id
    WHERE p.principal_id=NEW.reviewer_principal_id AND p.status='active'
      AND r.rater_id=NEW.rater_id AND r.deleted_at IS NULL
      AND lower(r.account_address)=NEW.payout_account
  ) THEN
    RAISE EXCEPTION 'paid-assignment seat requires one active matching reviewer identity';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_paid_assignment_seat_identity_validator"
  BEFORE INSERT OR UPDATE ON "tokenless_paid_assignment_seats"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_validate_paid_assignment_seat_identity"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_require_paid_assignment_seat_receipt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transition_revision > 0 AND NOT EXISTS (
    SELECT 1 FROM tokenless_paid_assignment_receipts r
    WHERE r.seat_id=NEW.seat_id AND r.seat_revision=NEW.transition_revision
      AND r.receipt_type=CASE
        WHEN NEW.identity_erased_at IS NULL THEN 'seat_voucher_prepared'
        ELSE 'seat_identity_erased'
      END
  ) THEN
    RAISE EXCEPTION 'paid-assignment seat state has no matching immutable receipt';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tokenless_paid_assignment_seat_receipt_required"
  AFTER INSERT OR UPDATE ON "tokenless_paid_assignment_seats"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tokenless_require_paid_assignment_seat_receipt"();

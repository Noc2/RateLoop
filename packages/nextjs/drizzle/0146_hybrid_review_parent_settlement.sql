CREATE TABLE "tokenless_hybrid_review_operations" (
  "hybrid_operation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "parent_binding_hash" text NOT NULL,
  "request_profile_hash" text NOT NULL,
  "audience_policy_hash" text NOT NULL,
  "source_commitment" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "state" text NOT NULL DEFAULT 'preparing',
  "transition_revision" integer NOT NULL DEFAULT 1,
  "preparation_evidence_hash" text,
  "result_evidence_hash" text,
  "cancellation_reason_code" text,
  "retention_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  FOREIGN KEY ("workspace_id","opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities" ("workspace_id","opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_hybrid_review_operations_opportunity_unique"
    UNIQUE ("workspace_id","opportunity_id"),
  CONSTRAINT "tokenless_hybrid_review_operations_parent_binding_unique"
    UNIQUE ("parent_binding_hash"),
  CONSTRAINT "tokenless_hybrid_review_operations_hashes_check" CHECK (
    "parent_binding_hash" IS NOT NULL AND "parent_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_profile_hash" IS NOT NULL AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audience_policy_hash" IS NOT NULL AND "audience_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_commitment" IS NOT NULL AND "source_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "suggestion_commitment" IS NOT NULL AND "suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_hybrid_review_operations_state_check"
    CHECK ("state" IN ('preparing','ready','active','terminal','cancelled')),
  CONSTRAINT "tokenless_hybrid_review_operations_state_shape_check" CHECK (
    (
      "state" IN ('preparing','ready','active')
      AND (
        "state" = 'preparing'
        OR (
          "preparation_evidence_hash" IS NOT NULL
          AND "preparation_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
      AND ("state" <> 'preparing' OR "preparation_evidence_hash" IS NULL)
      AND "result_evidence_hash" IS NULL
      AND "cancellation_reason_code" IS NULL
    )
    OR (
      "state" = 'terminal'
      AND "preparation_evidence_hash" IS NOT NULL
      AND "preparation_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "result_evidence_hash" IS NOT NULL
      AND "result_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "cancellation_reason_code" IS NULL
    )
    OR (
      "state" = 'cancelled'
      AND (
        "preparation_evidence_hash" IS NULL
        OR (
          "preparation_evidence_hash" IS NOT NULL
          AND "preparation_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
      AND "result_evidence_hash" IS NULL
      AND "cancellation_reason_code" IS NOT NULL
      AND char_length("cancellation_reason_code") BETWEEN 1 AND 128
    )
  ),
  CONSTRAINT "tokenless_hybrid_review_operations_values_check" CHECK (
    "transition_revision" > 0
    AND "updated_at" >= "created_at"
    AND "retention_until" > "created_at"
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_hybrid_review_children" (
  "child_id" text PRIMARY KEY NOT NULL,
  "hybrid_operation_id" text NOT NULL
    REFERENCES "tokenless_hybrid_review_operations" ("hybrid_operation_id") ON DELETE RESTRICT,
  "cohort" text NOT NULL,
  "child_binding_hash" text NOT NULL,
  "economics_hash" text NOT NULL,
  "expertise_hash" text NOT NULL,
  "admission_policy_hash" text NOT NULL,
  "chain_admission_policy_hash" text,
  "expected_amount_atomic" numeric(78,0) NOT NULL,
  "assignment_count" integer NOT NULL,
  "source_kind" text,
  "source_operation_reference" text,
  "source_run_id" text,
  "deployment_key" text,
  "chain_id" integer,
  "panel_address" text,
  "round_id" numeric(78,0),
  "assignment_evidence_hash" text,
  "voucher_preparation_hash" text,
  "settlement_binding_hash" text,
  "settlement_evidence_hash" text,
  "state" text NOT NULL DEFAULT 'preparing',
  "transition_revision" integer NOT NULL DEFAULT 1,
  "accepted_count" integer NOT NULL DEFAULT 0,
  "committed_count" integer NOT NULL DEFAULT 0,
  "terminal_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_hybrid_review_children_cohort_unique"
    UNIQUE ("hybrid_operation_id","cohort"),
  CONSTRAINT "tokenless_hybrid_review_children_binding_unique"
    UNIQUE ("child_binding_hash"),
  CONSTRAINT "tokenless_hybrid_review_children_parent_identity_unique"
    UNIQUE ("child_id","hybrid_operation_id"),
  CONSTRAINT "tokenless_hybrid_review_children_round_unique"
    UNIQUE ("hybrid_operation_id","deployment_key","chain_id","panel_address","round_id"),
  CONSTRAINT "tokenless_hybrid_review_children_cohort_check"
    CHECK ("cohort" IN ('invited','network')),
  CONSTRAINT "tokenless_hybrid_review_children_source_check"
    CHECK ("source_kind" IS NULL OR "source_kind" IN ('private_paid_assignment','public_network_assignment')),
  CONSTRAINT "tokenless_hybrid_review_children_hashes_check" CHECK (
    "child_binding_hash" IS NOT NULL AND "child_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "economics_hash" IS NOT NULL AND "economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "expertise_hash" IS NOT NULL AND "expertise_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "admission_policy_hash" IS NOT NULL AND "admission_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_hybrid_review_children_values_check" CHECK (
    "expected_amount_atomic" > 0
    AND "assignment_count" > 0
    AND "transition_revision" > 0
    AND "accepted_count" BETWEEN 0 AND "assignment_count"
    AND "committed_count" BETWEEN 0 AND "accepted_count"
    AND "terminal_count" BETWEEN 0 AND "assignment_count"
    AND "updated_at" >= "created_at"
  ),
  CONSTRAINT "tokenless_hybrid_review_children_state_check"
    CHECK ("state" IN ('preparing','ready','active','terminal','cancelled')),
  CONSTRAINT "tokenless_hybrid_review_children_state_shape_check" CHECK (
    (
      "state" = 'preparing'
      AND "source_kind" IS NULL
      AND "source_operation_reference" IS NULL
      AND "source_run_id" IS NULL
      AND "deployment_key" IS NULL
      AND "chain_id" IS NULL
      AND "panel_address" IS NULL
      AND "round_id" IS NULL
      AND "chain_admission_policy_hash" IS NULL
      AND "assignment_evidence_hash" IS NULL
      AND "voucher_preparation_hash" IS NULL
      AND "settlement_binding_hash" IS NULL
      AND "settlement_evidence_hash" IS NULL
      AND "accepted_count" = 0
      AND "committed_count" = 0
      AND "terminal_count" = 0
    )
    OR (
      "state" IN ('ready','active','terminal')
      AND "source_kind" IS NOT NULL
      AND "source_operation_reference" IS NOT NULL
      AND char_length("source_operation_reference") BETWEEN 1 AND 512
      AND "source_run_id" IS NOT NULL
      AND char_length("source_run_id") BETWEEN 1 AND 512
      AND "deployment_key" IS NOT NULL
      AND char_length("deployment_key") BETWEEN 1 AND 256
      AND "chain_id" IS NOT NULL
      AND "chain_id" > 0
      AND "panel_address" IS NOT NULL
      AND "panel_address" ~ '^0x[0-9a-f]{40}$'
      AND "round_id" IS NOT NULL
      AND "round_id" >= 0
      AND "chain_admission_policy_hash" IS NOT NULL
      AND "chain_admission_policy_hash" ~ '^0x[0-9a-f]{64}$'
      AND "assignment_evidence_hash" IS NOT NULL
      AND "assignment_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "voucher_preparation_hash" IS NOT NULL
      AND "voucher_preparation_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "settlement_binding_hash" IS NOT NULL
      AND "settlement_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND (
        ("state" IN ('ready','active') AND "settlement_evidence_hash" IS NULL)
        OR (
          "state" = 'terminal'
          AND "settlement_evidence_hash" IS NOT NULL
          AND "settlement_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
        )
      )
      AND ("state" <> 'ready' OR ("accepted_count" = 0 AND "committed_count" = 0 AND "terminal_count" = 0))
      AND ("state" <> 'active' OR ("accepted_count" > 0 OR "committed_count" > 0))
      AND ("state" <> 'terminal' OR "terminal_count" = "assignment_count")
    )
    OR (
      "state" = 'cancelled'
      AND "accepted_count" = 0
      AND "committed_count" = 0
      AND "terminal_count" = 0
      AND (
        (
          "source_kind" IS NULL
          AND "source_operation_reference" IS NULL
          AND "source_run_id" IS NULL
          AND "deployment_key" IS NULL
          AND "chain_id" IS NULL
          AND "panel_address" IS NULL
          AND "round_id" IS NULL
          AND "chain_admission_policy_hash" IS NULL
          AND "assignment_evidence_hash" IS NULL
          AND "voucher_preparation_hash" IS NULL
          AND "settlement_binding_hash" IS NULL
          AND "settlement_evidence_hash" IS NULL
        )
        OR (
          "source_kind" IS NOT NULL
          AND "source_operation_reference" IS NOT NULL
          AND "source_run_id" IS NOT NULL
          AND "deployment_key" IS NOT NULL
          AND "chain_id" IS NOT NULL
          AND "panel_address" IS NOT NULL
          AND "round_id" IS NOT NULL
          AND "chain_admission_policy_hash" IS NOT NULL
          AND "assignment_evidence_hash" IS NOT NULL
          AND "voucher_preparation_hash" IS NOT NULL
          AND "settlement_binding_hash" IS NOT NULL
          AND "settlement_evidence_hash" IS NULL
        )
      )
    )
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_hybrid_review_operations_state_idx"
  ON "tokenless_hybrid_review_operations" ("state","updated_at","hybrid_operation_id");--> statement-breakpoint
CREATE INDEX "tokenless_hybrid_review_children_state_idx"
  ON "tokenless_hybrid_review_children" ("state","updated_at","child_id");--> statement-breakpoint

ALTER TABLE "tokenless_evidence_retention_enforcement_runs"
  ADD COLUMN "hybrid_reviews_pruned" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tokenless_evidence_retention_enforcement_runs"
  ADD COLUMN "hybrid_reviews_held" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tokenless_evidence_retention_enforcement_runs"
  ADD COLUMN "hybrid_review_prune_digest" text;--> statement-breakpoint
ALTER TABLE "tokenless_evidence_retention_enforcement_runs"
  ADD CONSTRAINT "tokenless_evidence_retention_runs_hybrid_values_check"
  CHECK (
    "hybrid_reviews_pruned" >= 0
    AND "hybrid_reviews_held" >= 0
    AND (
      ("hybrid_reviews_pruned" = 0 AND "hybrid_review_prune_digest" IS NULL)
      OR (
        "hybrid_reviews_pruned" > 0
        AND "hybrid_review_prune_digest" ~ '^sha256:[0-9a-f]{64}$'
      )
    )
  );--> statement-breakpoint

CREATE TABLE "tokenless_hybrid_review_receipts" (
  "receipt_id" text PRIMARY KEY NOT NULL,
  "hybrid_operation_id" text NOT NULL
    REFERENCES "tokenless_hybrid_review_operations" ("hybrid_operation_id") ON DELETE RESTRICT,
  "child_id" text
    REFERENCES "tokenless_hybrid_review_children" ("child_id") ON DELETE RESTRICT,
  "receipt_type" text NOT NULL,
  "transition_revision" integer NOT NULL,
  "evidence_hash" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_hybrid_review_receipts_revision_unique"
    UNIQUE ("hybrid_operation_id","child_id","transition_revision"),
  CONSTRAINT "tokenless_hybrid_review_receipts_child_parent_fk"
    FOREIGN KEY ("child_id","hybrid_operation_id")
    REFERENCES "tokenless_hybrid_review_children" ("child_id","hybrid_operation_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_hybrid_review_receipts_hash_unique" UNIQUE ("receipt_hash"),
  CONSTRAINT "tokenless_hybrid_review_receipts_type_check" CHECK (
    "receipt_type" IN (
      'parent_prepared','child_ready','child_liability','child_terminal',
      'child_cancelled','parent_ready','parent_active','parent_terminal','parent_cancelled'
    )
  ),
  CONSTRAINT "tokenless_hybrid_review_receipts_scope_check" CHECK (
    (
      "child_id" IS NULL
      AND "receipt_type" IN ('parent_prepared','parent_ready','parent_active','parent_terminal','parent_cancelled')
    )
    OR (
      "child_id" IS NOT NULL
      AND "receipt_type" IN ('child_ready','child_liability','child_terminal','child_cancelled')
    )
  ),
  CONSTRAINT "tokenless_hybrid_review_receipts_values_check" CHECK (
    "transition_revision" > 0
    AND "evidence_hash" IS NOT NULL
    AND "evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "receipt_hash" IS NOT NULL
    AND "receipt_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_hybrid_review_receipts_parent_revision_unique"
  ON "tokenless_hybrid_review_receipts" ("hybrid_operation_id","transition_revision")
  WHERE "child_id" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_hybrid_review_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('rateloop.retention_erasure',true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'hybrid review receipts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_hybrid_review_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_hybrid_review_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_hybrid_review_receipt_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_hybrid_review_parent_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'preparing' OR NEW.transition_revision <> 1
     OR NEW.preparation_evidence_hash IS NOT NULL
     OR NEW.result_evidence_hash IS NOT NULL
     OR NEW.cancellation_reason_code IS NOT NULL THEN
    RAISE EXCEPTION 'hybrid review operations must begin as preparing revision one';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_hybrid_review_operations_insert_guard"
  BEFORE INSERT ON "tokenless_hybrid_review_operations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_hybrid_review_parent_insert"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_hybrid_review_child_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'preparing' OR NEW.transition_revision <> 1
     OR NEW.source_kind IS NOT NULL OR NEW.source_operation_reference IS NOT NULL
     OR NEW.source_run_id IS NOT NULL OR NEW.deployment_key IS NOT NULL
     OR NEW.chain_id IS NOT NULL OR NEW.panel_address IS NOT NULL OR NEW.round_id IS NOT NULL
     OR NEW.chain_admission_policy_hash IS NOT NULL
     OR NEW.assignment_evidence_hash IS NOT NULL OR NEW.voucher_preparation_hash IS NOT NULL
     OR NEW.settlement_binding_hash IS NOT NULL OR NEW.settlement_evidence_hash IS NOT NULL
     OR NEW.accepted_count <> 0 OR NEW.committed_count <> 0 OR NEW.terminal_count <> 0 THEN
    RAISE EXCEPTION 'hybrid review children must begin as preparing revision one';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_hybrid_review_children_insert_guard"
  BEFORE INSERT ON "tokenless_hybrid_review_children"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_hybrid_review_child_insert"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_hybrid_review_child_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF OLD.state IN ('terminal','cancelled') THEN
    RAISE EXCEPTION 'terminal hybrid review children are immutable';
  END IF;
  IF ROW(
    NEW.hybrid_operation_id,NEW.cohort,NEW.child_binding_hash,NEW.economics_hash,
    NEW.expertise_hash,NEW.admission_policy_hash,NEW.expected_amount_atomic,
    NEW.assignment_count,NEW.source_kind,NEW.source_operation_reference,
    NEW.source_run_id,NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,
    NEW.chain_admission_policy_hash,NEW.assignment_evidence_hash,NEW.voucher_preparation_hash,
    NEW.settlement_binding_hash,
    CASE WHEN NEW.state='terminal' THEN OLD.settlement_evidence_hash ELSE NEW.settlement_evidence_hash END,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.hybrid_operation_id,OLD.cohort,OLD.child_binding_hash,OLD.economics_hash,
    OLD.expertise_hash,OLD.admission_policy_hash,OLD.expected_amount_atomic,
    OLD.assignment_count,
    CASE WHEN OLD.state='preparing' THEN NEW.source_kind ELSE OLD.source_kind END,
    CASE WHEN OLD.state='preparing' THEN NEW.source_operation_reference ELSE OLD.source_operation_reference END,
    CASE WHEN OLD.state='preparing' THEN NEW.source_run_id ELSE OLD.source_run_id END,
    CASE WHEN OLD.state='preparing' THEN NEW.deployment_key ELSE OLD.deployment_key END,
    CASE WHEN OLD.state='preparing' THEN NEW.chain_id ELSE OLD.chain_id END,
    CASE WHEN OLD.state='preparing' THEN NEW.panel_address ELSE OLD.panel_address END,
    CASE WHEN OLD.state='preparing' THEN NEW.round_id ELSE OLD.round_id END,
    CASE WHEN OLD.state='preparing' THEN NEW.chain_admission_policy_hash ELSE OLD.chain_admission_policy_hash END,
    CASE WHEN OLD.state='preparing' THEN NEW.assignment_evidence_hash ELSE OLD.assignment_evidence_hash END,
    CASE WHEN OLD.state='preparing' THEN NEW.voucher_preparation_hash ELSE OLD.voucher_preparation_hash END,
    CASE WHEN OLD.state='preparing' THEN NEW.settlement_binding_hash ELSE OLD.settlement_binding_hash END,
    OLD.settlement_evidence_hash,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'hybrid review child bindings are immutable after preparation';
  END IF;
  IF NEW.accepted_count < OLD.accepted_count
     OR NEW.committed_count < OLD.committed_count
     OR NEW.terminal_count < OLD.terminal_count THEN
    RAISE EXCEPTION 'hybrid review child liability counters are monotonic';
  END IF;
  IF NEW.state = 'cancelled'
     AND (OLD.accepted_count > 0 OR OLD.committed_count > 0
          OR NEW.accepted_count > 0 OR NEW.committed_count > 0) THEN
    RAISE EXCEPTION 'hybrid review children cannot cancel after acceptance or commit';
  END IF;
  old_rank := CASE OLD.state
    WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'active' THEN 3
    WHEN 'terminal' THEN 4 WHEN 'cancelled' THEN 4 END;
  new_rank := CASE NEW.state
    WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'active' THEN 3
    WHEN 'terminal' THEN 4 WHEN 'cancelled' THEN 4 END;
  IF NEW.state <> OLD.state THEN
    IF (NEW.state <> 'cancelled' AND new_rank <= old_rank)
       OR (new_rank > old_rank + 1 AND NEW.state <> 'terminal') THEN
      RAISE EXCEPTION 'hybrid review child transitions are monotonic';
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'hybrid review child revision must advance once';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "tokenless_hybrid_review_receipts"
      WHERE hybrid_operation_id=OLD.hybrid_operation_id
        AND child_id=OLD.child_id
        AND transition_revision=NEW.transition_revision
        AND receipt_type=CASE NEW.state
          WHEN 'ready' THEN 'child_ready'
          WHEN 'active' THEN 'child_liability'
          WHEN 'terminal' THEN 'child_terminal'
          WHEN 'cancelled' THEN 'child_cancelled'
        END
    ) THEN
      RAISE EXCEPTION 'hybrid review child transition requires an exact receipt';
    END IF;
  ELSIF ROW(NEW.accepted_count,NEW.committed_count,NEW.terminal_count)
       IS DISTINCT FROM ROW(OLD.accepted_count,OLD.committed_count,OLD.terminal_count) THEN
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'hybrid review child liability revision must advance once';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "tokenless_hybrid_review_receipts"
      WHERE hybrid_operation_id=OLD.hybrid_operation_id
        AND child_id=OLD.child_id
        AND transition_revision=NEW.transition_revision
        AND receipt_type=CASE WHEN NEW.state='terminal' THEN 'child_terminal' ELSE 'child_liability' END
    ) THEN
      RAISE EXCEPTION 'hybrid review child counter transition requires an exact receipt';
    END IF;
  ELSIF NEW.transition_revision <> OLD.transition_revision THEN
    RAISE EXCEPTION 'hybrid review child revision changed without a transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_hybrid_review_children_guard"
  BEFORE UPDATE ON "tokenless_hybrid_review_children"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_hybrid_review_child_transition"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_hybrid_review_parent_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_count integer;
  ready_count integer;
  terminal_count integer;
  liability_count integer;
  old_rank integer;
  new_rank integer;
BEGIN
  IF OLD.state IN ('terminal','cancelled') THEN
    RAISE EXCEPTION 'terminal hybrid review operations are immutable';
  END IF;
  IF ROW(
    NEW.workspace_id,NEW.opportunity_id,NEW.parent_binding_hash,NEW.request_profile_hash,
    NEW.audience_policy_hash,NEW.source_commitment,NEW.suggestion_commitment,
    NEW.retention_until,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id,OLD.opportunity_id,OLD.parent_binding_hash,OLD.request_profile_hash,
    OLD.audience_policy_hash,OLD.source_commitment,OLD.suggestion_commitment,
    OLD.retention_until,OLD.created_at
  ) THEN
    RAISE EXCEPTION 'hybrid review parent bindings are immutable';
  END IF;
  IF OLD.preparation_evidence_hash IS NOT NULL
     AND NEW.preparation_evidence_hash IS DISTINCT FROM OLD.preparation_evidence_hash THEN
    RAISE EXCEPTION 'hybrid review preparation evidence is immutable';
  END IF;
  IF OLD.result_evidence_hash IS NOT NULL
     AND NEW.result_evidence_hash IS DISTINCT FROM OLD.result_evidence_hash THEN
    RAISE EXCEPTION 'hybrid review result evidence is immutable';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE state IN ('ready','active','terminal')),
         count(*) FILTER (WHERE state='terminal'),
         coalesce(sum(accepted_count + committed_count),0)
  INTO child_count,ready_count,terminal_count,liability_count
  FROM "tokenless_hybrid_review_children"
  WHERE hybrid_operation_id=OLD.hybrid_operation_id;
  IF child_count <> 2 THEN
    RAISE EXCEPTION 'hybrid review operations require exactly two children';
  END IF;
  IF NEW.state = 'ready' AND ready_count <> 2 THEN
    RAISE EXCEPTION 'hybrid review parent cannot become ready before both children';
  END IF;
  IF NEW.state = 'active' AND liability_count = 0 THEN
    RAISE EXCEPTION 'hybrid review parent cannot become active without liability';
  END IF;
  IF NEW.state = 'terminal' AND terminal_count <> 2 THEN
    RAISE EXCEPTION 'hybrid review parent cannot become terminal before both children';
  END IF;
  IF NEW.state = 'cancelled' AND liability_count > 0 THEN
    RAISE EXCEPTION 'hybrid review parent cannot cancel after child acceptance or commit';
  END IF;
  IF NEW.state <> OLD.state THEN
    old_rank := CASE OLD.state
      WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'active' THEN 3
      WHEN 'terminal' THEN 4 WHEN 'cancelled' THEN 4 END;
    new_rank := CASE NEW.state
      WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'active' THEN 3
      WHEN 'terminal' THEN 4 WHEN 'cancelled' THEN 4 END;
    IF (NEW.state <> 'cancelled' AND new_rank <= old_rank)
       OR (NEW.state = 'active' AND OLD.state <> 'ready')
       OR (NEW.state = 'ready' AND OLD.state <> 'preparing')
       OR (NEW.state = 'cancelled' AND OLD.state NOT IN ('preparing','ready')) THEN
      RAISE EXCEPTION 'hybrid review parent transitions are monotonic';
    END IF;
    IF NEW.transition_revision <> OLD.transition_revision + 1 THEN
      RAISE EXCEPTION 'hybrid review parent revision must advance once';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "tokenless_hybrid_review_receipts"
      WHERE hybrid_operation_id=OLD.hybrid_operation_id
        AND child_id IS NULL
        AND transition_revision=NEW.transition_revision
        AND receipt_type=CASE NEW.state
          WHEN 'ready' THEN 'parent_ready'
          WHEN 'active' THEN 'parent_active'
          WHEN 'terminal' THEN 'parent_terminal'
          WHEN 'cancelled' THEN 'parent_cancelled'
        END
    ) THEN
      RAISE EXCEPTION 'hybrid review parent transition requires an exact receipt';
    END IF;
  ELSIF NEW.transition_revision <> OLD.transition_revision THEN
    RAISE EXCEPTION 'hybrid review parent revision changed without a transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_hybrid_review_operations_guard"
  BEFORE UPDATE ON "tokenless_hybrid_review_operations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_hybrid_review_parent_transition"();--> statement-breakpoint

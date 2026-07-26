ALTER TABLE "tokenless_assurance_suites"
  ADD CONSTRAINT "tokenless_assurance_suites_project_suite_unique"
  UNIQUE ("project_id","suite_id","version");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_audience_policies"
  ADD CONSTRAINT "tokenless_assurance_audience_policies_project_policy_unique"
  UNIQUE ("project_id","policy_id","version");--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations"
  ADD CONSTRAINT "tokenless_agent_integrations_workspace_integration_unique"
  UNIQUE ("workspace_id","integration_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_cohort_reviewers"
  ADD COLUMN "network_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE "tokenless_public_network_review_bindings" (
  "binding_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL
    REFERENCES "tokenless_workspaces" ("workspace_id") ON DELETE RESTRICT,
  "opportunity_id" text NOT NULL,
  "integration_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "prepared_request_hash" text NOT NULL,
  "derived_economics_hash" text NOT NULL,
  "question_hash" text NOT NULL,
  "source_evidence_hash" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "exact_binding_hash" text NOT NULL,
  "project_id" text NOT NULL
    REFERENCES "tokenless_assurance_projects" ("project_id") ON DELETE RESTRICT,
  "audience_policy_id" text NOT NULL,
  "audience_policy_version" integer NOT NULL,
  "audience_policy_hash" text NOT NULL,
  "suite_id" text NOT NULL,
  "suite_version" integer NOT NULL,
  "case_id" text NOT NULL
    REFERENCES "tokenless_assurance_cases" ("case_id") ON DELETE RESTRICT,
  "run_id" text NOT NULL
    REFERENCES "tokenless_assurance_runs" ("run_id") ON DELETE RESTRICT,
  "product_question_id" text NOT NULL,
  "product_content_id" text NOT NULL,
  "orchestration_content_id" text,
  "admission_policy_hash" text NOT NULL,
  "confidentiality_terms_hash" text NOT NULL,
  "operation_key" text
    REFERENCES "tokenless_agent_asks" ("operation_key") ON DELETE RESTRICT,
  "deployment_key" text,
  "chain_id" integer,
  "panel_address" text,
  "round_id" numeric(78,0),
  "round_terms_hash" text,
  "total_funded_atomic" numeric(78,0),
  "maximum_commits" integer,
  "state" text NOT NULL DEFAULT 'foundation_preparing',
  "worker_attempt_count" integer NOT NULL DEFAULT 0,
  "worker_next_attempt_at" timestamp with time zone,
  "worker_last_error_code" text,
  "worker_dead_at" timestamp with time zone,
  "ask_bound_at" timestamp with time zone,
  "round_bound_at" timestamp with time zone,
  "audience_ready_at" timestamp with time zone,
  "abandoned_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  FOREIGN KEY ("workspace_id","opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities" ("workspace_id","opportunity_id")
    ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","integration_id")
    REFERENCES "tokenless_agent_integrations" ("workspace_id","integration_id")
    ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id","project_id")
    ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","audience_policy_id","audience_policy_version")
    REFERENCES "tokenless_assurance_audience_policies" ("project_id","policy_id","version")
    ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","suite_id","suite_version")
    REFERENCES "tokenless_assurance_suites" ("project_id","suite_id","version")
    ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","case_id")
    REFERENCES "tokenless_assurance_cases" ("project_id","case_id")
    ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","run_id")
    REFERENCES "tokenless_assurance_runs" ("project_id","run_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_public_network_review_bindings_opportunity_unique"
    UNIQUE ("workspace_id","opportunity_id"),
  CONSTRAINT "tokenless_public_network_review_bindings_idempotency_unique"
    UNIQUE ("workspace_id","idempotency_key"),
  CONSTRAINT "tokenless_public_network_review_bindings_operation_unique"
    UNIQUE ("operation_key"),
  CONSTRAINT "tokenless_public_network_review_bindings_run_unique"
    UNIQUE ("run_id"),
  CONSTRAINT "tokenless_public_network_review_bindings_case_unique"
    UNIQUE ("case_id"),
  CONSTRAINT "tokenless_public_network_review_bindings_profile_check" CHECK (
    "request_profile_version" > 0
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "prepared_request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "derived_economics_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "question_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "exact_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_policy_check" CHECK (
    "audience_policy_version" > 0
    AND "audience_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "admission_policy_hash" ~ '^0x[0-9a-f]{64}$'
    AND "confidentiality_terms_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_content_check" CHECK (
    "product_content_id" ~ '^0x[0-9a-f]{64}$'
    AND (
      "orchestration_content_id" IS NULL
      OR "orchestration_content_id" ~ '^0x[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_round_shape_check" CHECK (
    (
      "deployment_key" IS NULL
      AND "chain_id" IS NULL
      AND "panel_address" IS NULL
      AND "round_id" IS NULL
      AND "round_terms_hash" IS NULL
      AND "total_funded_atomic" IS NULL
      AND "maximum_commits" IS NULL
    )
    OR (
      "deployment_key" IS NOT NULL
      AND char_length("deployment_key") BETWEEN 1 AND 200
      AND "chain_id" IS NOT NULL
      AND "chain_id" > 0
      AND "panel_address" IS NOT NULL
      AND "panel_address" ~ '^0x[0-9a-f]{40}$'
      AND "round_id" IS NOT NULL
      AND "round_id" >= 0
      AND "round_terms_hash" IS NOT NULL
      AND "round_terms_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "total_funded_atomic" IS NOT NULL
      AND "total_funded_atomic" > 0
      AND "maximum_commits" IS NOT NULL
      AND "maximum_commits" > 0
    )
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_state_check" CHECK (
    "state" IN (
      'foundation_preparing','foundation_ready','ask_bound','round_bound',
      'audience_ready','abandoned','dead'
    )
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_state_shape_check" CHECK (
    (
      "state" = 'foundation_preparing'
      AND "orchestration_content_id" IS NULL
      AND "operation_key" IS NULL
      AND "ask_bound_at" IS NULL
      AND "round_bound_at" IS NULL
      AND "audience_ready_at" IS NULL
      AND "abandoned_at" IS NULL
      AND "deployment_key" IS NULL
    )
    OR (
      "state" = 'foundation_ready'
      AND "orchestration_content_id" IS NOT NULL
      AND "operation_key" IS NULL
      AND "ask_bound_at" IS NULL
      AND "round_bound_at" IS NULL
      AND "audience_ready_at" IS NULL
      AND "abandoned_at" IS NULL
      AND "deployment_key" IS NULL
    )
    OR (
      "state" = 'ask_bound'
      AND "orchestration_content_id" IS NOT NULL
      AND "operation_key" IS NOT NULL
      AND "ask_bound_at" IS NOT NULL
      AND "round_bound_at" IS NULL
      AND "audience_ready_at" IS NULL
      AND "abandoned_at" IS NULL
      AND "deployment_key" IS NULL
    )
    OR (
      "state" = 'round_bound'
      AND "orchestration_content_id" IS NOT NULL
      AND "operation_key" IS NOT NULL
      AND "ask_bound_at" IS NOT NULL
      AND "round_bound_at" IS NOT NULL
      AND "audience_ready_at" IS NULL
      AND "abandoned_at" IS NULL
      AND "deployment_key" IS NOT NULL
    )
    OR (
      "state" = 'audience_ready'
      AND "orchestration_content_id" IS NOT NULL
      AND "operation_key" IS NOT NULL
      AND "ask_bound_at" IS NOT NULL
      AND "round_bound_at" IS NOT NULL
      AND "audience_ready_at" IS NOT NULL
      AND "abandoned_at" IS NULL
      AND "deployment_key" IS NOT NULL
      AND "worker_dead_at" IS NULL
      AND "worker_next_attempt_at" IS NULL
      AND "worker_last_error_code" IS NULL
    )
    OR (
      "state" = 'abandoned'
      AND "operation_key" IS NULL
      AND "round_bound_at" IS NULL
      AND "audience_ready_at" IS NULL
      AND "abandoned_at" IS NOT NULL
      AND "deployment_key" IS NULL
      AND "worker_next_attempt_at" IS NULL
      AND "worker_last_error_code" IS NULL
    )
    OR (
      "state" = 'dead'
      AND "operation_key" IS NOT NULL
      AND "ask_bound_at" IS NOT NULL
      AND "audience_ready_at" IS NULL
      AND "worker_dead_at" IS NOT NULL
      AND "worker_next_attempt_at" IS NULL
      AND "worker_last_error_code" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_worker_check" CHECK (
    "worker_attempt_count" BETWEEN 0 AND 20
    AND (
      (
        "state" IN ('foundation_preparing','foundation_ready','audience_ready','abandoned')
        AND "worker_next_attempt_at" IS NULL
        AND "worker_last_error_code" IS NULL
        AND "worker_dead_at" IS NULL
      )
      OR (
        "state" IN ('ask_bound','round_bound')
        AND "worker_next_attempt_at" IS NOT NULL
        AND "worker_dead_at" IS NULL
      )
      OR (
        "state" = 'dead'
        AND "worker_next_attempt_at" IS NULL
        AND "worker_last_error_code" IS NOT NULL
        AND "worker_dead_at" IS NOT NULL
      )
    )
  ),
  CONSTRAINT "tokenless_public_network_review_bindings_time_check" CHECK (
    "updated_at" >= "created_at"
    AND ("ask_bound_at" IS NULL OR "ask_bound_at" BETWEEN "created_at" AND "updated_at")
    AND ("round_bound_at" IS NULL OR "round_bound_at" BETWEEN "created_at" AND "updated_at")
    AND ("audience_ready_at" IS NULL OR "audience_ready_at" BETWEEN "created_at" AND "updated_at")
    AND ("abandoned_at" IS NULL OR "abandoned_at" BETWEEN "created_at" AND "updated_at")
    AND ("worker_dead_at" IS NULL OR "worker_dead_at" BETWEEN "created_at" AND "updated_at")
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_public_network_review_bindings_worker_idx"
  ON "tokenless_public_network_review_bindings"
  ("state","worker_next_attempt_at","created_at","binding_id")
  WHERE "state" IN ('ask_bound','round_bound');--> statement-breakpoint
CREATE INDEX "tokenless_public_network_review_bindings_stale_foundation_idx"
  ON "tokenless_public_network_review_bindings" ("created_at","binding_id")
  WHERE "state" IN ('foundation_preparing','foundation_ready');--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_public_network_review_binding_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'foundation_preparing'
       OR NEW.orchestration_content_id IS NOT NULL
       OR NEW.operation_key IS NOT NULL
       OR NEW.deployment_key IS NOT NULL
       OR NEW.worker_attempt_count <> 0
       OR NEW.worker_next_attempt_at IS NOT NULL
       OR NEW.worker_last_error_code IS NOT NULL
       OR NEW.worker_dead_at IS NOT NULL
       OR NEW.ask_bound_at IS NOT NULL
       OR NEW.round_bound_at IS NOT NULL
       OR NEW.audience_ready_at IS NOT NULL
       OR NEW.abandoned_at IS NOT NULL THEN
      RAISE EXCEPTION 'public network review bindings must start at foundation_preparing';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('audience_ready','abandoned','dead') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal public network review bindings are immutable';
  END IF;
  IF NEW.worker_attempt_count < OLD.worker_attempt_count THEN
    RAISE EXCEPTION 'public network review worker attempts are monotonic';
  END IF;
  IF ROW(
    NEW.workspace_id,NEW.opportunity_id,NEW.integration_id,NEW.idempotency_key,
    NEW.request_profile_id,NEW.request_profile_version,NEW.request_profile_hash,
    NEW.prepared_request_hash,NEW.derived_economics_hash,NEW.question_hash,
    NEW.source_evidence_hash,NEW.suggestion_commitment,NEW.exact_binding_hash,
    NEW.project_id,NEW.audience_policy_id,NEW.audience_policy_version,
    NEW.audience_policy_hash,NEW.suite_id,NEW.suite_version,NEW.case_id,NEW.run_id,
    NEW.product_question_id,NEW.product_content_id,NEW.admission_policy_hash,
    NEW.confidentiality_terms_hash,NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id,OLD.opportunity_id,OLD.integration_id,OLD.idempotency_key,
    OLD.request_profile_id,OLD.request_profile_version,OLD.request_profile_hash,
    OLD.prepared_request_hash,OLD.derived_economics_hash,OLD.question_hash,
    OLD.source_evidence_hash,OLD.suggestion_commitment,OLD.exact_binding_hash,
    OLD.project_id,OLD.audience_policy_id,OLD.audience_policy_version,
    OLD.audience_policy_hash,OLD.suite_id,OLD.suite_version,OLD.case_id,OLD.run_id,
    OLD.product_question_id,OLD.product_content_id,OLD.admission_policy_hash,
    OLD.confidentiality_terms_hash,OLD.created_at
  ) THEN
    RAISE EXCEPTION 'public network review identity is immutable';
  END IF;
  IF NEW.orchestration_content_id IS DISTINCT FROM OLD.orchestration_content_id
     AND NOT (
       OLD.state = 'foundation_preparing' AND NEW.state = 'foundation_ready'
       AND OLD.orchestration_content_id IS NULL AND NEW.orchestration_content_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network orchestration content identity is immutable';
  END IF;
  IF NEW.operation_key IS DISTINCT FROM OLD.operation_key
     AND NOT (
       OLD.state = 'foundation_ready' AND NEW.state = 'ask_bound'
       AND OLD.operation_key IS NULL AND NEW.operation_key IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network operation identity is immutable';
  END IF;
  IF NEW.ask_bound_at IS DISTINCT FROM OLD.ask_bound_at
     AND NOT (
       OLD.state = 'foundation_ready' AND NEW.state = 'ask_bound'
       AND OLD.ask_bound_at IS NULL AND NEW.ask_bound_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network ask binding time is immutable';
  END IF;
  IF ROW(
    NEW.deployment_key,NEW.chain_id,NEW.panel_address,NEW.round_id,
    NEW.round_terms_hash,NEW.total_funded_atomic,NEW.maximum_commits
  ) IS DISTINCT FROM ROW(
    OLD.deployment_key,OLD.chain_id,OLD.panel_address,OLD.round_id,
    OLD.round_terms_hash,OLD.total_funded_atomic,OLD.maximum_commits
  ) AND NOT (
    OLD.state = 'ask_bound' AND NEW.state = 'round_bound'
    AND OLD.deployment_key IS NULL AND NEW.deployment_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'public network confirmed round identity is immutable';
  END IF;
  IF NEW.round_bound_at IS DISTINCT FROM OLD.round_bound_at
     AND NOT (
       OLD.state = 'ask_bound' AND NEW.state = 'round_bound'
       AND OLD.round_bound_at IS NULL AND NEW.round_bound_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network round binding time is immutable';
  END IF;
  IF NEW.audience_ready_at IS DISTINCT FROM OLD.audience_ready_at
     AND NOT (
       OLD.state = 'round_bound' AND NEW.state = 'audience_ready'
       AND OLD.audience_ready_at IS NULL AND NEW.audience_ready_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network audience readiness time is immutable';
  END IF;
  IF NEW.abandoned_at IS DISTINCT FROM OLD.abandoned_at
     AND NOT (
       OLD.state IN ('foundation_preparing','foundation_ready') AND NEW.state = 'abandoned'
       AND OLD.abandoned_at IS NULL AND NEW.abandoned_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network abandonment time is immutable';
  END IF;
  IF NEW.worker_dead_at IS DISTINCT FROM OLD.worker_dead_at
     AND NOT (
       OLD.state IN ('ask_bound','round_bound') AND NEW.state = 'dead'
       AND OLD.worker_dead_at IS NULL AND NEW.worker_dead_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'public network worker dead-letter time is immutable';
  END IF;
  old_rank := CASE OLD.state
    WHEN 'foundation_preparing' THEN 1
    WHEN 'foundation_ready' THEN 2
    WHEN 'ask_bound' THEN 3
    WHEN 'round_bound' THEN 4
    WHEN 'audience_ready' THEN 5
    WHEN 'abandoned' THEN 6
    WHEN 'dead' THEN 6 END;
  new_rank := CASE NEW.state
    WHEN 'foundation_preparing' THEN 1
    WHEN 'foundation_ready' THEN 2
    WHEN 'ask_bound' THEN 3
    WHEN 'round_bound' THEN 4
    WHEN 'audience_ready' THEN 5
    WHEN 'abandoned' THEN 6
    WHEN 'dead' THEN 6 END;
  IF NEW.state <> OLD.state THEN
    IF OLD.state IN ('audience_ready','abandoned','dead')
       OR (
         NEW.state NOT IN ('abandoned','dead')
         AND new_rank <> old_rank + 1
       )
       OR (
         NEW.state = 'abandoned'
         AND OLD.state NOT IN ('foundation_preparing','foundation_ready')
       )
       OR (
         NEW.state = 'dead'
         AND OLD.state NOT IN ('ask_bound','round_bound')
       ) THEN
      RAISE EXCEPTION 'public network review transition is not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_public_network_review_bindings_guard"
  BEFORE INSERT OR UPDATE ON "tokenless_public_network_review_bindings"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_public_network_review_binding_transition"();

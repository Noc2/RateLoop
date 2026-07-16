CREATE TABLE "tokenless_agent_human_review_result_observations" (
  "observation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "opportunity_id" text NOT NULL,
  "integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "scope_id" text NOT NULL,
  "result_schema_version" text NOT NULL,
  "result_envelope_commitment" text NOT NULL,
  "result_commitment" text NOT NULL,
  "lifecycle_state" text NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "selection_policy_id" text NOT NULL,
  "selection_policy_version" integer NOT NULL,
  "selection_policy_hash" text NOT NULL,
  "human_review_binding_id" text NOT NULL,
  "human_review_binding_version" integer NOT NULL,
  "human_review_binding_hash" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "lane" text NOT NULL,
  "outcome" text NOT NULL,
  "calibration_comparable" boolean NOT NULL,
  "response_count" integer NOT NULL,
  "terminal_evidence_commitment" text,
  "adaptive_observation_id" text REFERENCES "tokenless_agent_evaluation_observations"("observation_id") ON DELETE RESTRICT,
  "result_observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_human_review_result_observations_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_result_observations_scope_fk"
    FOREIGN KEY ("workspace_id", "scope_id")
    REFERENCES "tokenless_agent_evaluation_scopes"("workspace_id", "scope_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_result_observations_selection_policy_fk"
    FOREIGN KEY ("workspace_id", "selection_policy_id", "selection_policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_result_observations_binding_fk"
    FOREIGN KEY ("workspace_id", "human_review_binding_id", "human_review_binding_version")
    REFERENCES "tokenless_agent_human_review_bindings"("workspace_id", "binding_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_result_observations_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_result_observations_opportunity_unique"
    UNIQUE ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_human_review_result_observations_exact_subject_unique"
    UNIQUE ("workspace_id", "opportunity_id", "integration_id"),
  CONSTRAINT "tokenless_agent_human_review_result_observations_schema_check"
    CHECK ("result_schema_version" = 'rateloop.human-review-result.v1'),
  CONSTRAINT "tokenless_agent_human_review_result_observations_state_check"
    CHECK ("lifecycle_state" IN ('completed', 'inconclusive', 'failed_terminal', 'cancelled_before_commit')),
  CONSTRAINT "tokenless_agent_human_review_result_observations_lane_check"
    CHECK ("lane" IN ('public_paid', 'private_paid', 'private_unpaid', 'hybrid')),
  CONSTRAINT "tokenless_agent_human_review_result_observations_outcome_check"
    CHECK ("outcome" IN ('positive', 'negative', 'inconclusive', 'failed', 'cancelled')),
  CONSTRAINT "tokenless_agent_human_review_result_observations_state_outcome_check" CHECK (
    ("lifecycle_state" = 'completed' AND "outcome" IN ('positive', 'negative'))
    OR ("lifecycle_state" = 'inconclusive' AND "outcome" = 'inconclusive')
    OR ("lifecycle_state" = 'failed_terminal' AND "outcome" = 'failed')
    OR ("lifecycle_state" = 'cancelled_before_commit' AND "outcome" = 'cancelled')
  ),
  CONSTRAINT "tokenless_agent_human_review_result_observations_adaptive_check" CHECK (
    (
      "outcome" IN ('positive', 'negative')
      AND "calibration_comparable" = true
      AND "adaptive_observation_id" IS NOT NULL
    )
    OR (
      "outcome" = 'inconclusive'
      AND "calibration_comparable" = false
      AND "adaptive_observation_id" IS NOT NULL
    )
    OR (
      "outcome" IN ('failed', 'cancelled')
      AND "calibration_comparable" = false
      AND "adaptive_observation_id" IS NULL
    )
  ),
  CONSTRAINT "tokenless_agent_human_review_result_observations_counts_check"
    CHECK ("response_count" >= 0),
  CONSTRAINT "tokenless_agent_human_review_result_observations_revision_check"
    CHECK (
      "lifecycle_revision" >= 1
      AND "selection_policy_version" >= 1
      AND "human_review_binding_version" >= 1
      AND "request_profile_version" >= 1
    ),
  CONSTRAINT "tokenless_agent_human_review_result_observations_hashes_check" CHECK (
    "result_envelope_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "result_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "selection_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "human_review_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND (
      "terminal_evidence_commitment" IS NULL
      OR "terminal_evidence_commitment" ~ '^sha256:[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "tokenless_agent_human_review_result_observations_timestamps_check"
    CHECK ("created_at" >= "result_observed_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_human_review_result_observations_scope_result_idx"
  ON "tokenless_agent_human_review_result_observations" USING btree
  ("workspace_id", "scope_id", "result_observed_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_human_review_result_observations_integration_result_idx"
  ON "tokenless_agent_human_review_result_observations" USING btree
  ("integration_id", "result_observed_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_human_review_result_observation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'human-review result observations are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_human_review_result_observations_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_agent_human_review_result_observations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_human_review_result_observation_mutation"();

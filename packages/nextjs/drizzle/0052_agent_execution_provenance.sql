CREATE TABLE "tokenless_agent_executions" (
  "execution_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "integration_id" text REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "external_execution_id" text NOT NULL,
  "status" text NOT NULL,
  "metadata_source" text NOT NULL DEFAULT 'host_reported',
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "total_duration_ms" integer,
  "tool_call_count" integer,
  "tool_duration_ms" integer,
  "model_call_count" integer NOT NULL,
  "input_token_total" integer,
  "cached_input_token_total" integer,
  "output_token_total" integer,
  "reasoning_output_token_total" integer,
  "primary_span_id" text NOT NULL,
  "manifest_commitment" text NOT NULL,
  "execution_profile_hash" text NOT NULL,
  "execution_profile_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_executions_agent_version_fk"
    FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_executions_status_check" CHECK ("status" IN ('completed','failed')),
  CONSTRAINT "tokenless_agent_executions_metadata_source_check" CHECK ("metadata_source" = 'host_reported'),
  CONSTRAINT "tokenless_agent_executions_timing_check" CHECK (
    (
      "started_at" IS NULL
      AND "completed_at" IS NULL
      AND "total_duration_ms" IS NULL
    )
    OR (
      "started_at" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "total_duration_ms" IS NOT NULL
      AND "total_duration_ms" >= 0
    )
  ),
  CONSTRAINT "tokenless_agent_executions_counts_check" CHECK (
    ("tool_call_count" IS NULL OR "tool_call_count" >= 0)
    AND "model_call_count" >= 1
    AND ("tool_duration_ms" IS NULL OR "tool_duration_ms" >= 0)
  ),
  CONSTRAINT "tokenless_agent_executions_usage_check" CHECK (
    ("input_token_total" IS NULL OR "input_token_total" >= 0)
    AND ("cached_input_token_total" IS NULL OR "cached_input_token_total" >= 0)
    AND (
      "input_token_total" IS NULL
      OR "cached_input_token_total" IS NULL
      OR "cached_input_token_total" <= "input_token_total"
    )
    AND ("output_token_total" IS NULL OR "output_token_total" >= 0)
    AND ("reasoning_output_token_total" IS NULL OR "reasoning_output_token_total" >= 0)
    AND (
      "output_token_total" IS NULL
      OR "reasoning_output_token_total" IS NULL
      OR "reasoning_output_token_total" <= "output_token_total"
    )
  ),
  CONSTRAINT "tokenless_agent_executions_hashes_check" CHECK (
    "manifest_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "execution_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_executions_external_unique"
    UNIQUE ("workspace_id", "agent_id", "external_execution_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_executions_workspace_agent_created_idx"
  ON "tokenless_agent_executions" USING btree
  ("workspace_id", "agent_id", "agent_version_id", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_executions_profile_idx"
  ON "tokenless_agent_executions" USING btree
  ("workspace_id", "execution_profile_hash", "created_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_generation_spans" (
  "execution_id" text NOT NULL REFERENCES "tokenless_agent_executions"("execution_id") ON DELETE CASCADE,
  "span_id" text NOT NULL,
  "parent_span_id" text,
  "role" text NOT NULL,
  "provider" text NOT NULL,
  "requested_model" text NOT NULL,
  "resolved_model" text,
  "model_version" text,
  "reasoning_effort" text,
  "service_tier" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "duration_ms" integer,
  "time_to_first_output_ms" integer,
  "input_tokens" integer,
  "cached_input_tokens" integer,
  "output_tokens" integer,
  "reasoning_output_tokens" integer,
  "response_id_hash" text,
  "finish_reason" text,
  "metadata_source" text NOT NULL DEFAULT 'host_reported',
  PRIMARY KEY ("execution_id", "span_id"),
  CONSTRAINT "tokenless_agent_generation_spans_parent_fk"
    FOREIGN KEY ("execution_id", "parent_span_id")
    REFERENCES "tokenless_agent_generation_spans"("execution_id", "span_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_generation_spans_role_check"
    CHECK ("role" IN ('primary','subagent','supporting')),
  CONSTRAINT "tokenless_agent_generation_spans_metadata_source_check"
    CHECK ("metadata_source" = 'host_reported'),
  CONSTRAINT "tokenless_agent_generation_spans_timing_check" CHECK (
    (
      "started_at" IS NULL
      AND "completed_at" IS NULL
      AND "duration_ms" IS NULL
    )
    OR (
      "started_at" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "duration_ms" IS NOT NULL
      AND "duration_ms" >= 0
    )
  ),
  CONSTRAINT "tokenless_agent_generation_spans_metrics_check" CHECK (
    ("time_to_first_output_ms" IS NULL OR "time_to_first_output_ms" >= 0)
    AND (
      "duration_ms" IS NULL
      OR "time_to_first_output_ms" IS NULL
      OR "time_to_first_output_ms" <= "duration_ms"
    )
    AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
    AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
    AND (
      "input_tokens" IS NULL
      OR "cached_input_tokens" IS NULL
      OR "cached_input_tokens" <= "input_tokens"
    )
    AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
    AND ("reasoning_output_tokens" IS NULL OR "reasoning_output_tokens" >= 0)
    AND (
      "output_tokens" IS NULL
      OR "reasoning_output_tokens" IS NULL
      OR "reasoning_output_tokens" <= "output_tokens"
    )
  ),
  CONSTRAINT "tokenless_agent_generation_spans_response_hash_check" CHECK (
    "response_id_hash" IS NULL OR "response_id_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_generation_spans_execution_role_idx"
  ON "tokenless_agent_generation_spans" USING btree ("execution_id", "role", "span_id");--> statement-breakpoint

ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD COLUMN "execution_profile_hash" text,
  ADD COLUMN "execution_profile_json" text;--> statement-breakpoint
UPDATE "tokenless_agent_evaluation_scopes"
SET
  "execution_profile_hash" = 'sha256:63b18407425f52ad732101f9ffeb9c895782790554fce260de6e2cb1b93118ff',
  "execution_profile_json" = '{"schemaVersion":"rateloop.execution-profile.legacy"}';--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  ALTER COLUMN "execution_profile_hash" SET NOT NULL,
  ALTER COLUMN "execution_profile_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_profile_hash_check"
  CHECK ("execution_profile_hash" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  DROP CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique";--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique" UNIQUE (
    "agent_version_id", "policy_id", "policy_version", "workflow_key", "risk_tier",
    "audience_policy_hash", "execution_profile_hash"
  );--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_opportunities"
  ADD COLUMN "execution_id" text REFERENCES "tokenless_agent_executions"("execution_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunities_execution_idx"
  ON "tokenless_agent_review_opportunities" USING btree ("execution_id");--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_observations"
  ADD COLUMN "execution_id" text REFERENCES "tokenless_agent_executions"("execution_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "tokenless_agent_evaluation_observations_execution_idx"
  ON "tokenless_agent_evaluation_observations" USING btree ("execution_id");

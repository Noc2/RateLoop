CREATE TABLE "tokenless_agent_review_policies" (
  "policy_id" text NOT NULL,
  "version" integer NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "mode" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "agreement_threshold_bps" integer NOT NULL,
  "production_floor_bps" integer NOT NULL,
  "maximum_unreviewed_gap" integer NOT NULL,
  "rules_json" text NOT NULL DEFAULT '{}',
  "audience_policy_json" text NOT NULL,
  "publishing_policy_id" text REFERENCES "tokenless_agent_publishing_policies"("policy_id"),
  "created_by" text NOT NULL,
  "approved_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "superseded_at" timestamp with time zone,
  PRIMARY KEY ("policy_id", "version"),
  CONSTRAINT "tokenless_agent_review_policies_agent_version_fk" FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_review_policies_mode_check" CHECK ("mode" IN ('manual', 'always', 'rules', 'adaptive')),
  CONSTRAINT "tokenless_agent_review_policies_threshold_check" CHECK (
    "agreement_threshold_bps" BETWEEN 0 AND 10000
    AND "production_floor_bps" BETWEEN 0 AND 10000
    AND "maximum_unreviewed_gap" >= 1
  ),
  CONSTRAINT "tokenless_agent_review_policies_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_agent_review_policies_workspace_unique" UNIQUE ("workspace_id", "policy_id", "version")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_policies_workspace_agent_idx"
  ON "tokenless_agent_review_policies" USING btree ("workspace_id", "agent_id", "agent_version_id", "enabled");--> statement-breakpoint
CREATE TABLE "tokenless_agent_evaluation_scopes" (
  "scope_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_version" integer NOT NULL,
  "workflow_key" text NOT NULL,
  "risk_tier" text NOT NULL,
  "audience_policy_hash" text NOT NULL,
  "partition_commitment" text NOT NULL,
  "stage" text NOT NULL DEFAULT 'calibrating',
  "completed_comparable_cases" integer NOT NULL DEFAULT 0,
  "stable_cases_since_stage" integer NOT NULL DEFAULT 0,
  "unreviewed_since_last_sample" integer NOT NULL DEFAULT 0,
  "stage_entered_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_evaluation_scopes_agent_version_fk" FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_evaluation_scopes_policy_fk" FOREIGN KEY ("workspace_id", "policy_id", "policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version"),
  CONSTRAINT "tokenless_agent_evaluation_scopes_stage_check" CHECK ("stage" IN ('calibrating', 'high_coverage', 'medium_coverage', 'monitoring')),
  CONSTRAINT "tokenless_agent_evaluation_scopes_counters_check" CHECK (
    "completed_comparable_cases" >= 0 AND "stable_cases_since_stage" >= 0 AND "unreviewed_since_last_sample" >= 0
  ),
  CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique" UNIQUE (
    "agent_version_id", "policy_id", "policy_version", "workflow_key", "risk_tier", "audience_policy_hash"
  ),
  CONSTRAINT "tokenless_agent_evaluation_scopes_workspace_unique" UNIQUE ("workspace_id", "scope_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_evaluation_scopes_workspace_agent_idx"
  ON "tokenless_agent_evaluation_scopes" USING btree ("workspace_id", "agent_id", "agent_version_id", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_review_opportunities" (
  "opportunity_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "scope_id" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_version" integer NOT NULL,
  "external_opportunity_id" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "suggestion_ciphertext" text,
  "suggestion_key_ref" text,
  "declared_confidence_bps" integer,
  "metadata_commitment" text NOT NULL,
  "metadata_complete" boolean NOT NULL,
  "critical_risk" boolean NOT NULL DEFAULT false,
  "decision" text NOT NULL,
  "review_rate_bps" integer NOT NULL,
  "selection_probability_bps" integer NOT NULL,
  "sample_bucket" integer NOT NULL,
  "sampler_key_version" text NOT NULL,
  "sampler_commitment" text NOT NULL,
  "reason_codes_json" text NOT NULL,
  "status" text NOT NULL DEFAULT 'decided',
  "operation_key" text REFERENCES "tokenless_agent_asks"("operation_key"),
  "run_id" text REFERENCES "tokenless_assurance_runs"("run_id"),
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunities_agent_version_fk" FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_review_opportunities_policy_fk" FOREIGN KEY ("workspace_id", "policy_id", "policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version"),
  CONSTRAINT "tokenless_agent_review_opportunities_scope_fk" FOREIGN KEY ("workspace_id", "scope_id")
    REFERENCES "tokenless_agent_evaluation_scopes"("workspace_id", "scope_id"),
  CONSTRAINT "tokenless_agent_review_opportunities_decision_check" CHECK ("decision" IN ('required', 'recommended', 'skip')),
  CONSTRAINT "tokenless_agent_review_opportunities_status_check" CHECK ("status" IN ('decided', 'review_requested', 'skipped', 'completed', 'failed')),
  CONSTRAINT "tokenless_agent_review_opportunities_bps_check" CHECK (
    "review_rate_bps" BETWEEN 0 AND 10000
    AND "selection_probability_bps" BETWEEN 0 AND 10000
    AND "sample_bucket" BETWEEN 0 AND 9999
    AND ("declared_confidence_bps" IS NULL OR "declared_confidence_bps" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "tokenless_agent_review_opportunities_ciphertext_check" CHECK (
    ("suggestion_ciphertext" IS NULL AND "suggestion_key_ref" IS NULL)
    OR ("suggestion_ciphertext" IS NOT NULL AND "suggestion_key_ref" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_review_opportunities_external_unique" UNIQUE ("workspace_id", "agent_id", "external_opportunity_id"),
  CONSTRAINT "tokenless_agent_review_opportunities_workspace_unique" UNIQUE ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_review_opportunities_operation_unique" UNIQUE ("operation_key"),
  CONSTRAINT "tokenless_agent_review_opportunities_run_unique" UNIQUE ("run_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunities_scope_created_idx"
  ON "tokenless_agent_review_opportunities" USING btree ("scope_id", "created_at", "status");--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunities_workspace_agent_idx"
  ON "tokenless_agent_review_opportunities" USING btree ("workspace_id", "agent_id", "agent_version_id", "created_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_evaluation_observations" (
  "observation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "scope_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "operation_key" text REFERENCES "tokenless_agent_asks"("operation_key"),
  "run_id" text REFERENCES "tokenless_assurance_runs"("run_id"),
  "evidence_reference" text NOT NULL,
  "source_payload_hash" text NOT NULL,
  "agent_outcome_commitment" text NOT NULL,
  "human_outcome_commitment" text NOT NULL,
  "agreement" text NOT NULL,
  "comparable" boolean NOT NULL,
  "responding_human_count" integer NOT NULL,
  "human_human_agreement_bps" integer,
  "latency_ms" integer,
  "cost_atomic" numeric(78, 0),
  "finalized_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_evaluation_observations_scope_fk" FOREIGN KEY ("workspace_id", "scope_id")
    REFERENCES "tokenless_agent_evaluation_scopes"("workspace_id", "scope_id"),
  CONSTRAINT "tokenless_agent_evaluation_observations_opportunity_fk" FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities"("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_evaluation_observations_agreement_check" CHECK ("agreement" IN ('agree', 'disagree', 'abstain', 'inconclusive')),
  CONSTRAINT "tokenless_agent_evaluation_observations_metrics_check" CHECK (
    "responding_human_count" >= 0
    AND ("human_human_agreement_bps" IS NULL OR "human_human_agreement_bps" BETWEEN 0 AND 10000)
    AND ("latency_ms" IS NULL OR "latency_ms" >= 0)
    AND ("cost_atomic" IS NULL OR "cost_atomic" >= 0)
  ),
  CONSTRAINT "tokenless_agent_evaluation_observations_opportunity_unique" UNIQUE ("opportunity_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_evaluation_observations_scope_finalized_idx"
  ON "tokenless_agent_evaluation_observations" USING btree ("scope_id", "finalized_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_evaluation_rollups" (
  "rollup_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "scope_id" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "opportunity_count" integer NOT NULL,
  "reviewed_count" integer NOT NULL,
  "comparable_count" integer NOT NULL,
  "agreement_count" integer NOT NULL,
  "agreement_bps" integer,
  "agreement_lower_95_bps" integer,
  "metrics_json" text NOT NULL,
  "source_commitment" text NOT NULL,
  "rebuilt_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_evaluation_rollups_scope_fk" FOREIGN KEY ("workspace_id", "scope_id")
    REFERENCES "tokenless_agent_evaluation_scopes"("workspace_id", "scope_id"),
  CONSTRAINT "tokenless_agent_evaluation_rollups_counts_check" CHECK (
    "opportunity_count" >= 0 AND "reviewed_count" >= 0 AND "comparable_count" >= 0
    AND "agreement_count" >= 0 AND "agreement_count" <= "comparable_count"
  ),
  CONSTRAINT "tokenless_agent_evaluation_rollups_bps_check" CHECK (
    ("agreement_bps" IS NULL OR "agreement_bps" BETWEEN 0 AND 10000)
    AND ("agreement_lower_95_bps" IS NULL OR "agreement_lower_95_bps" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "tokenless_agent_evaluation_rollups_window_unique" UNIQUE ("scope_id", "window_start", "window_end")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_evaluation_rollups_workspace_window_idx"
  ON "tokenless_agent_evaluation_rollups" USING btree ("workspace_id", "window_end", "scope_id");--> statement-breakpoint
CREATE TABLE "tokenless_agent_review_policy_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "scope_id" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_version" integer NOT NULL,
  "event_type" text NOT NULL,
  "from_stage" text,
  "to_stage" text,
  "reason_codes_json" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "event_commitment" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_policy_events_policy_fk" FOREIGN KEY ("workspace_id", "policy_id", "policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version"),
  CONSTRAINT "tokenless_agent_review_policy_events_scope_fk" FOREIGN KEY ("workspace_id", "scope_id")
    REFERENCES "tokenless_agent_evaluation_scopes"("workspace_id", "scope_id"),
  CONSTRAINT "tokenless_agent_review_policy_events_type_check" CHECK ("event_type" IN ('created', 'stage_changed', 'reset', 'forced_review', 'policy_superseded')),
  CONSTRAINT "tokenless_agent_review_policy_events_actor_check" CHECK ("actor_type" IN ('account', 'service')),
  CONSTRAINT "tokenless_agent_review_policy_events_stage_check" CHECK (
    ("from_stage" IS NULL OR "from_stage" IN ('calibrating', 'high_coverage', 'medium_coverage', 'monitoring'))
    AND ("to_stage" IS NULL OR "to_stage" IN ('calibrating', 'high_coverage', 'medium_coverage', 'monitoring'))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_policy_events_scope_created_idx"
  ON "tokenless_agent_review_policy_events" USING btree ("scope_id", "created_at");

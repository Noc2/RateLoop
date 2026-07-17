CREATE TABLE "tokenless_assurance_mechanism_health" (
  "run_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "scope_hash" text NOT NULL,
  "non_gold_case_count" integer NOT NULL,
  "unanimous_case_count" integer NOT NULL,
  "valid_response_count" integer NOT NULL,
  "candidate_share_bps" integer,
  "rbts_score_count" bigint NOT NULL,
  "eligible_chain_case_count" integer NOT NULL,
  "indexed_chain_case_count" integer NOT NULL,
  "rbts_score_mean_bps" integer,
  "rbts_score_variance_bps2" numeric(20, 0),
  "gold_outcome_count" integer NOT NULL,
  "gold_failure_count" integer NOT NULL,
  "comparable_drift_bps" integer,
  "observed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_mechanism_health_scope_check"
    CHECK ("scope_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_mechanism_health_counts_check" CHECK (
    "non_gold_case_count" >= 0
    AND "unanimous_case_count" BETWEEN 0 AND "non_gold_case_count"
    AND "valid_response_count" >= 0
    AND "rbts_score_count" >= 0
    AND "eligible_chain_case_count" >= 0
    AND "indexed_chain_case_count" BETWEEN 0 AND "eligible_chain_case_count"
    AND "gold_outcome_count" >= 0
    AND "gold_failure_count" BETWEEN 0 AND "gold_outcome_count"
  ),
  CONSTRAINT "tokenless_assurance_mechanism_health_bps_check" CHECK (
    ("candidate_share_bps" IS NULL OR "candidate_share_bps" BETWEEN 0 AND 10000)
    AND ("rbts_score_mean_bps" IS NULL OR "rbts_score_mean_bps" BETWEEN 0 AND 10000)
    AND ("comparable_drift_bps" IS NULL OR "comparable_drift_bps" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "tokenless_assurance_mechanism_health_rbts_check" CHECK (
    ("rbts_score_count" = 0 AND "rbts_score_mean_bps" IS NULL AND "rbts_score_variance_bps2" IS NULL)
    OR (
      "rbts_score_count" > 0
      AND "rbts_score_mean_bps" IS NOT NULL
      AND "rbts_score_variance_bps2" IS NOT NULL
      AND "rbts_score_variance_bps2" >= 0
    )
  ),
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id"),
  FOREIGN KEY ("project_id", "run_id")
    REFERENCES "tokenless_assurance_runs"("project_id", "run_id")
);
--> statement-breakpoint
CREATE INDEX "tokenless_assurance_mechanism_health_scope_idx"
  ON "tokenless_assurance_mechanism_health" USING btree
  ("workspace_id", "scope_hash", "observed_at");

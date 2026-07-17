ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_workspace_project_unique"
  UNIQUE("workspace_id", "project_id");
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_cases"
  ADD CONSTRAINT "tokenless_assurance_cases_project_case_unique"
  UNIQUE("project_id", "case_id");
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_rubrics"
  ADD CONSTRAINT "tokenless_assurance_rubrics_project_rubric_unique"
  UNIQUE("project_id", "rubric_id", "version");
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_runs"
  ADD CONSTRAINT "tokenless_assurance_runs_project_run_unique"
  UNIQUE("project_id", "run_id");
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_scope_identity_unique"
  UNIQUE("workspace_id", "project_id", "run_id", "assignment_id");
--> statement-breakpoint
CREATE TABLE "tokenless_assurance_gold_items" (
  "gold_item_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "case_id" text NOT NULL,
  "rubric_id" text NOT NULL,
  "rubric_version" integer NOT NULL,
  "content_commitment" text NOT NULL,
  "expected_choice" text NOT NULL,
  "provenance" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "retired_at" timestamp with time zone,
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id"),
  FOREIGN KEY ("project_id", "case_id")
    REFERENCES "tokenless_assurance_cases"("project_id", "case_id"),
  FOREIGN KEY ("project_id", "rubric_id", "rubric_version")
    REFERENCES "tokenless_assurance_rubrics"("project_id", "rubric_id", "version"),
  CONSTRAINT "tokenless_assurance_gold_items_case_unique" UNIQUE("project_id", "case_id"),
  CONSTRAINT "tokenless_assurance_gold_items_identity_unique" UNIQUE("gold_item_id", "case_id"),
  CONSTRAINT "tokenless_assurance_gold_items_project_identity_unique" UNIQUE("project_id", "gold_item_id", "case_id"),
  CONSTRAINT "tokenless_assurance_gold_items_choice_check"
    CHECK ("expected_choice" IN ('baseline', 'candidate')),
  CONSTRAINT "tokenless_assurance_gold_items_provenance_check"
    CHECK ("provenance" IN ('owner_adjudicated', 'platform_synthetic')),
  CONSTRAINT "tokenless_assurance_gold_items_status_check"
    CHECK ("status" IN ('active', 'retired')),
  CONSTRAINT "tokenless_assurance_gold_items_commitment_check"
    CHECK ("content_commitment" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_gold_items_retirement_check" CHECK (
    ("status" = 'active' AND "retired_at" IS NULL)
    OR ("status" = 'retired' AND "retired_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_assurance_gold_items_selection_idx"
  ON "tokenless_assurance_gold_items" USING btree
  ("project_id", "rubric_id", "rubric_version", "status", "created_at");
--> statement-breakpoint
CREATE TABLE "tokenless_assurance_gold_settings" (
  "project_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "invited_injection_enabled" boolean DEFAULT false NOT NULL,
  "injection_rate_bps" integer DEFAULT 500 NOT NULL,
  "maximum_items_per_run" integer DEFAULT 2 NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_gold_settings_rate_check"
    CHECK ("injection_rate_bps" BETWEEN 100 AND 2000),
  CONSTRAINT "tokenless_assurance_gold_settings_maximum_check"
    CHECK ("maximum_items_per_run" BETWEEN 1 AND 5),
  CONSTRAINT "tokenless_assurance_gold_settings_project_unique"
    UNIQUE("workspace_id", "project_id"),
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id")
);
--> statement-breakpoint
CREATE TABLE "tokenless_assurance_run_gold_items" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "gold_item_id" text NOT NULL,
  "injection_ordinal" integer NOT NULL,
  "selection_seed_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("run_id", "case_id"),
  CONSTRAINT "tokenless_assurance_run_gold_items_item_unique" UNIQUE("run_id", "gold_item_id"),
  CONSTRAINT "tokenless_assurance_run_gold_items_case_item_unique" UNIQUE("run_id", "case_id", "gold_item_id"),
  CONSTRAINT "tokenless_assurance_run_gold_items_ordinal_unique" UNIQUE("run_id", "injection_ordinal"),
  CONSTRAINT "tokenless_assurance_run_gold_items_ordinal_check" CHECK ("injection_ordinal" >= 1),
  CONSTRAINT "tokenless_assurance_run_gold_items_seed_check"
    CHECK ("selection_seed_hash" ~ '^sha256:[0-9a-f]{64}$'),
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id"),
  FOREIGN KEY ("project_id", "run_id")
    REFERENCES "tokenless_assurance_runs"("project_id", "run_id"),
  FOREIGN KEY ("project_id", "gold_item_id", "case_id")
    REFERENCES "tokenless_assurance_gold_items"("project_id", "gold_item_id", "case_id")
);
--> statement-breakpoint
CREATE TABLE "tokenless_assurance_gold_outcomes" (
  "outcome_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "gold_item_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_key_lineage" text NOT NULL,
  "rater_id" text REFERENCES "tokenless_rater_profiles"("rater_id"),
  "reviewer_source" text NOT NULL,
  "gold_provenance" text NOT NULL,
  "choice" text NOT NULL,
  "correct" boolean NOT NULL,
  "qualification_state" text DEFAULT 'pending' NOT NULL,
  "scored_at" timestamp with time zone NOT NULL,
  "promoted_at" timestamp with time zone,
  CONSTRAINT "tokenless_assurance_gold_outcomes_unique"
    UNIQUE("run_id", "case_id", "reviewer_key_lineage"),
  FOREIGN KEY ("run_id", "case_id", "gold_item_id")
    REFERENCES "tokenless_assurance_run_gold_items"("run_id", "case_id", "gold_item_id"),
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id"),
  FOREIGN KEY ("project_id", "run_id")
    REFERENCES "tokenless_assurance_runs"("project_id", "run_id"),
  FOREIGN KEY ("workspace_id", "project_id", "run_id", "assignment_id")
    REFERENCES "tokenless_assurance_assignments"("workspace_id", "project_id", "run_id", "assignment_id"),
  CONSTRAINT "tokenless_assurance_gold_outcomes_choice_check"
    CHECK ("choice" IN ('baseline', 'candidate')),
  CONSTRAINT "tokenless_assurance_gold_outcomes_lineage_check"
    CHECK ("reviewer_key_lineage" ~ '^hmac-sha256:[A-Za-z0-9_-]{1,40}:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_gold_outcomes_source_check"
    CHECK ("reviewer_source" IN ('customer_invited', 'rateloop_network')),
  CONSTRAINT "tokenless_assurance_gold_outcomes_provenance_check"
    CHECK ("gold_provenance" IN ('owner_adjudicated', 'platform_synthetic')),
  CONSTRAINT "tokenless_assurance_gold_outcomes_state_check"
    CHECK ("qualification_state" IN ('pending', 'promoted', 'ineligible')),
  CONSTRAINT "tokenless_assurance_gold_outcomes_promotion_check" CHECK (
    ("qualification_state" = 'pending' AND "promoted_at" IS NULL)
    OR ("qualification_state" IN ('promoted', 'ineligible') AND "promoted_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_assurance_gold_outcomes_lineage_idx"
  ON "tokenless_assurance_gold_outcomes" USING btree
  ("reviewer_key_lineage", "qualification_state", "scored_at");
--> statement-breakpoint
CREATE INDEX "tokenless_assurance_gold_outcomes_rater_idx"
  ON "tokenless_assurance_gold_outcomes" USING btree
  ("rater_id", "qualification_state", "scored_at");
--> statement-breakpoint

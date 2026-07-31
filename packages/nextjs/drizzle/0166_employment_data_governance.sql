CREATE TABLE "tokenless_workspace_employment_data_governance_versions" (
  "workspace_id" text NOT NULL,
  "version" integer NOT NULL,
  "processing_mode" text NOT NULL DEFAULT 'aggregate_only',
  "controller_role" text,
  "processor_role" text,
  "lawful_basis_record_reference" text,
  "necessity_record_reference" text,
  "worker_notice_reference" text,
  "retention_policy_reference" text,
  "access_policy_reference" text,
  "dpia_status" text NOT NULL DEFAULT 'not_started',
  "dpia_reference" text,
  "data_subject_process_reference" text,
  "works_council_status" text NOT NULL DEFAULT 'blocked',
  "works_council_reference" text,
  "reviewer_analytics_activated_at" timestamp with time zone,
  "reviewer_analytics_activated_by" text,
  "effective_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_employment_data_governance_versions_pk"
    PRIMARY KEY ("workspace_id", "version"),
  CONSTRAINT "tokenless_workspace_employment_data_governance_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_workspace_employment_data_governance_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "tokenless_workspace_employment_data_governance_mode_check"
    CHECK ("processing_mode" IN ('aggregate_only', 'reviewer_analytics')),
  CONSTRAINT "tokenless_workspace_employment_data_governance_dpia_check"
    CHECK ("dpia_status" IN ('not_started', 'not_required', 'completed', 'blocked')),
  CONSTRAINT "tokenless_workspace_employment_data_governance_works_council_check"
    CHECK ("works_council_status" IN ('not_applicable', 'agreement_recorded', 'blocked')),
  CONSTRAINT "tokenless_workspace_employment_data_governance_activation_check"
    CHECK (
      (
        "processing_mode" = 'aggregate_only'
        AND "reviewer_analytics_activated_at" IS NULL
        AND "reviewer_analytics_activated_by" IS NULL
      )
      OR
      (
        "processing_mode" = 'reviewer_analytics'
        AND "controller_role" IS NOT NULL AND char_length(btrim("controller_role")) > 0
        AND "processor_role" IS NOT NULL AND char_length(btrim("processor_role")) > 0
        AND "lawful_basis_record_reference" IS NOT NULL
          AND char_length(btrim("lawful_basis_record_reference")) > 0
        AND "necessity_record_reference" IS NOT NULL
          AND char_length(btrim("necessity_record_reference")) > 0
        AND "worker_notice_reference" IS NOT NULL AND char_length(btrim("worker_notice_reference")) > 0
        AND "retention_policy_reference" IS NOT NULL
          AND char_length(btrim("retention_policy_reference")) > 0
        AND "access_policy_reference" IS NOT NULL AND char_length(btrim("access_policy_reference")) > 0
        AND "dpia_status" IN ('not_required', 'completed')
        AND "dpia_reference" IS NOT NULL AND char_length(btrim("dpia_reference")) > 0
        AND "data_subject_process_reference" IS NOT NULL
          AND char_length(btrim("data_subject_process_reference")) > 0
        AND "works_council_status" IN ('not_applicable', 'agreement_recorded')
        AND "works_council_reference" IS NOT NULL AND char_length(btrim("works_council_reference")) > 0
        AND "reviewer_analytics_activated_at" IS NOT NULL
        AND "reviewer_analytics_activated_by" IS NOT NULL
          AND char_length(btrim("reviewer_analytics_activated_by")) > 0
      )
    )
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_reject_employment_data_governance_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tokenless_workspaces WHERE workspace_id = OLD.workspace_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'employment data governance versions are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_workspace_employment_data_governance_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_workspace_employment_data_governance_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_employment_data_governance_version_mutation();--> statement-breakpoint
INSERT INTO "tokenless_workspace_employment_data_governance_versions"
  ("workspace_id", "version", "processing_mode", "dpia_status", "works_council_status",
   "effective_at", "created_by", "created_at")
SELECT "workspace_id", 1, 'aggregate_only', 'not_started', 'blocked',
       "created_at", 'system:migration:0166', "created_at"
FROM "tokenless_workspaces";

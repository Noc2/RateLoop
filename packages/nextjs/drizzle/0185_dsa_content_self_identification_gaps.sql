CREATE TABLE "tokenless_dsa_named_panel_content_self_identification_reports" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "report_id" text NOT NULL,
  "gap_reason" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_digest" text NOT NULL,
  "access_id" text NOT NULL,
  "accessed_at" timestamptz NOT NULL,
  "panel_deadline" timestamptz NOT NULL,
  "report_json" text NOT NULL,
  "report_hash" text NOT NULL,
  "reported_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id"),
  UNIQUE ("report_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id")
    REFERENCES "tokenless_dsa_named_panel_assignments"
      ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id") ON DELETE RESTRICT,
  FOREIGN KEY ("assignment_id","access_id","accessed_at")
    REFERENCES "tokenless_dsa_named_panel_artifact_accesses"
      ("assignment_id","access_id","accessed_at") ON DELETE RESTRICT,
  CHECK (
    "gap_reason"='content_self_identification'
    AND "artifact_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "accessed_at"<="reported_at" AND "reported_at"<="panel_deadline"
    AND "report_hash"='sha256:'||encode(digest(convert_to("report_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_dsa_named_panel_content_self_identification_reports_unit_idx"
  ON "tokenless_dsa_named_panel_content_self_identification_reports"
  ("workspace_id","epoch_id","unit_id","reported_at");--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_selections"
  ADD CONSTRAINT "tokenless_dsa_named_panel_selections_capacity_release_exact_unique"
  UNIQUE ("workspace_id","project_id","epoch_id","unit_id","assignment_id","subpanel_id","cohort_id",
          "reviewer_principal_id");--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_capacity_releases" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "subpanel_id" text NOT NULL,
  "cohort_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "prior_status" text NOT NULL,
  "released_status" text NOT NULL,
  "release_reason" text NOT NULL,
  "terminal_evidence_id" text NOT NULL,
  "released_at" timestamptz NOT NULL DEFAULT date_trunc('milliseconds',transaction_timestamp()),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id"),
  FOREIGN KEY ("workspace_id","project_id","epoch_id","unit_id","assignment_id","subpanel_id","cohort_id",
               "reviewer_principal_id")
    REFERENCES "tokenless_dsa_named_panel_selections"
      ("workspace_id","project_id","epoch_id","unit_id","assignment_id","subpanel_id","cohort_id",
       "reviewer_principal_id") ON DELETE RESTRICT,
  CHECK (
    "prior_status" IN ('reserved','accepted')
    AND "released_status" IN ('released','completed')
    AND "release_reason" IN (
      'content_self_identification_quarantine','reviewer_nonresponse_gap'
    )
    AND char_length("terminal_evidence_id") BETWEEN 1 AND 200
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_capacity_release_request()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  IF NOT FOUND OR NEW."released_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
     OR NOT EXISTS (
       SELECT 1 FROM "tokenless_assurance_assignments" assignment
       WHERE assignment."assignment_id"=NEW."assignment_id"
         AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
         AND assignment."subpanel_id"=NEW."subpanel_id" AND assignment."cohort_id"=NEW."cohort_id"
         AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
         AND assignment."paid_assignment"=false AND assignment."status"=NEW."prior_status"
     ) OR (NEW."release_reason"='content_self_identification_quarantine' AND NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
       WHERE report."workspace_id"=NEW."workspace_id" AND report."epoch_id"=NEW."epoch_id"
         AND report."unit_id"=NEW."unit_id" AND report."report_id"=NEW."terminal_evidence_id"
     )) OR (NEW."release_reason"<>'content_self_identification_quarantine' AND NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_gaps" gap
       WHERE gap."workspace_id"=NEW."workspace_id" AND gap."epoch_id"=NEW."epoch_id"
         AND gap."unit_id"=NEW."unit_id" AND gap."gap_evidence_id"=NEW."terminal_evidence_id"
     )) THEN
    RAISE EXCEPTION 'DSA named-panel capacity release requires the exact locked prior assignment and terminal evidence'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_capacity_release_request_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_capacity_releases"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_capacity_release_request();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_capacity_release()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exact_subpanel_count integer; exact_cohort_count integer; exact_reviewer_count integer;
        stored_subpanel_count integer; stored_cohort_count integer; stored_reviewer_count integer;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM "tokenless_assurance_assignments" assignment
       WHERE assignment."assignment_id"=NEW."assignment_id"
         AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
         AND assignment."subpanel_id"=NEW."subpanel_id" AND assignment."cohort_id"=NEW."cohort_id"
         AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
         AND assignment."paid_assignment"=false AND assignment."status"=NEW."released_status"
         AND assignment."lease_state"='expired'
     ) THEN
    RAISE EXCEPTION 'DSA named-panel capacity release requires exact terminal evidence and unpaid assignment state'
      USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO exact_subpanel_count FROM "tokenless_assurance_assignments"
   WHERE "subpanel_id"=NEW."subpanel_id" AND "status" IN ('reserved','accepted');
  SELECT "active_reservations" INTO stored_subpanel_count FROM "tokenless_assurance_run_subpanels"
   WHERE "subpanel_id"=NEW."subpanel_id";
  SELECT count(*) INTO exact_cohort_count FROM "tokenless_assurance_assignments"
   WHERE "project_id"=NEW."project_id" AND "cohort_id"=NEW."cohort_id" AND "status" IN ('reserved','accepted');
  SELECT "active_reservations" INTO stored_cohort_count FROM "tokenless_assurance_cohorts"
   WHERE "project_id"=NEW."project_id" AND "cohort_id"=NEW."cohort_id";
  SELECT count(*) INTO exact_reviewer_count FROM "tokenless_assurance_assignments"
   WHERE "project_id"=NEW."project_id" AND "cohort_id"=NEW."cohort_id"
     AND "reviewer_account_address"=NEW."reviewer_principal_id" AND "status" IN ('reserved','accepted');
  SELECT "active_reservations" INTO stored_reviewer_count FROM "tokenless_assurance_cohort_reviewers"
   WHERE "project_id"=NEW."project_id" AND "cohort_id"=NEW."cohort_id"
     AND "reviewer_account_address"=NEW."reviewer_principal_id";
  IF exact_subpanel_count IS DISTINCT FROM stored_subpanel_count
     OR exact_cohort_count IS DISTINCT FROM stored_cohort_count
     OR exact_reviewer_count IS DISTINCT FROM stored_reviewer_count THEN
    RAISE EXCEPTION 'DSA named-panel capacity release must reconcile every reservation counter'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_capacity_release_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_capacity_releases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_capacity_release();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_capacity_releases_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_capacity_releases"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_report()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  IF NOT FOUND OR NEW."reported_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
     OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
       WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
         AND outcome."unit_id"=NEW."unit_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_gaps" gap
       WHERE gap."workspace_id"=NEW."workspace_id" AND gap."epoch_id"=NEW."epoch_id"
         AND gap."unit_id"=NEW."unit_id"
     ) OR NOT EXISTS (
       SELECT 1
       FROM "tokenless_assurance_assignments" assignment
       JOIN "tokenless_dsa_named_panel_selections" selection
         ON selection."workspace_id"=assignment."workspace_id" AND selection."project_id"=assignment."project_id"
        AND selection."run_id"=assignment."run_id" AND selection."assignment_id"=assignment."assignment_id"
        AND selection."reviewer_principal_id"=assignment."reviewer_account_address"
       JOIN "tokenless_dsa_named_panel_artifact_accesses" access
         ON access."assignment_id"=NEW."assignment_id" AND access."access_id"=NEW."access_id"
        AND access."accessed_at"=NEW."accessed_at" AND access."workspace_id"=NEW."workspace_id"
        AND access."epoch_id"=NEW."epoch_id" AND access."unit_id"=NEW."unit_id"
        AND access."reviewer_principal_id"=NEW."reviewer_principal_id"
        AND access."artifact_id"=NEW."artifact_id" AND access."artifact_digest"=NEW."artifact_digest"
       WHERE assignment."assignment_id"=NEW."assignment_id"
         AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
         AND assignment."run_id"=NEW."run_id" AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
         AND assignment."source"='customer_invited' AND assignment."selection"='customer_named'
         AND assignment."status"='accepted' AND assignment."lease_state"='issued'
         AND assignment."paid_assignment"=false
         AND selection."epoch_id"=NEW."epoch_id" AND selection."unit_id"=NEW."unit_id"
         AND selection."case_id"=NEW."case_id" AND selection."mapping_commitment"=NEW."mapping_commitment"
         AND selection."panel_deadline"=NEW."panel_deadline"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_workspace_members" member
       WHERE member."workspace_id"=NEW."workspace_id" AND member."account_address"=NEW."reviewer_principal_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_project_access_assignments" access
       WHERE access."workspace_id"=NEW."workspace_id" AND access."project_id"=NEW."project_id"
         AND access."subject_kind"='principal' AND access."subject_reference"=NEW."reviewer_principal_id"
         AND access."status"='active'
         AND (access."expires_at" IS NULL OR access."expires_at">NEW."reported_at")
     ) OR NEW."report_json" IS NOT JSON OBJECT WITH UNIQUE KEYS
     OR NEW."report_json"::jsonb<>jsonb_build_object(
       'schemaVersion','rateloop.dsa-named-panel-content-self-identification-report.v1',
       'workspaceId',NEW."workspace_id",'projectId',NEW."project_id",'epochId',NEW."epoch_id",
       'unitId',NEW."unit_id",'runId',NEW."run_id",'caseId',NEW."case_id",
       'mappingCommitment',NEW."mapping_commitment",'reportId',NEW."report_id",
       'reason',NEW."gap_reason",'assignmentId',NEW."assignment_id",
       'reviewerPrincipalId',NEW."reviewer_principal_id",'artifactId',NEW."artifact_id",
       'artifactDigest',NEW."artifact_digest",'accessId',NEW."access_id",
       'accessedAt',to_char(NEW."accessed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'panelDeadline',to_char(NEW."panel_deadline" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'reportedAt',to_char(NEW."reported_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     ) THEN
    RAISE EXCEPTION 'DSA content self-identification report requires the exact active reviewer assignment and artifact access'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_content_self_identification_report_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_content_self_identification_reports"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_report();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_content_self_identification_reports_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_content_self_identification_reports"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_report_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "tokenless_assurance_assignments" assignment
    WHERE assignment."assignment_id"=NEW."assignment_id"
      AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
      AND assignment."run_id"=NEW."run_id" AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
      AND assignment."status"='completed' AND assignment."lease_state"='expired'
      AND assignment."paid_assignment"=false
  ) OR NOT EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_capacity_releases" release
    WHERE release."workspace_id"=NEW."workspace_id" AND release."epoch_id"=NEW."epoch_id"
      AND release."unit_id"=NEW."unit_id" AND release."assignment_id"=NEW."assignment_id"
      AND release."reviewer_principal_id"=NEW."reviewer_principal_id"
      AND release."release_reason"='content_self_identification_quarantine'
      AND release."terminal_evidence_id"=NEW."report_id" AND release."released_status"='completed'
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    JOIN "tokenless_assurance_assignments" assignment
      ON assignment."workspace_id"=selection."workspace_id" AND assignment."project_id"=selection."project_id"
     AND assignment."run_id"=selection."run_id" AND assignment."assignment_id"=selection."assignment_id"
     AND assignment."reviewer_account_address"=selection."reviewer_principal_id"
    WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
      AND selection."unit_id"=NEW."unit_id" AND assignment."status" IN ('reserved','accepted')
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    JOIN "tokenless_assurance_assignments" assignment
      ON assignment."workspace_id"=selection."workspace_id" AND assignment."project_id"=selection."project_id"
     AND assignment."run_id"=selection."run_id" AND assignment."assignment_id"=selection."assignment_id"
     AND assignment."reviewer_account_address"=selection."reviewer_principal_id"
    WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
      AND selection."unit_id"=NEW."unit_id" AND assignment."status"='released'
      AND NOT EXISTS (
        SELECT 1 FROM "tokenless_dsa_named_panel_capacity_releases" release
        WHERE release."workspace_id"=selection."workspace_id" AND release."epoch_id"=selection."epoch_id"
          AND release."unit_id"=selection."unit_id" AND release."assignment_id"=selection."assignment_id"
          AND release."release_reason"='content_self_identification_quarantine'
          AND release."terminal_evidence_id"=NEW."report_id" AND release."released_status"='released')
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    JOIN "tokenless_assurance_artifact_leases" lease
      ON lease."workspace_id"=selection."workspace_id" AND lease."project_id"=selection."project_id"
     AND lease."assignment_id"=selection."assignment_id"
     AND lease."account_address"=selection."reviewer_principal_id"
    WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
      AND selection."unit_id"=NEW."unit_id" AND lease."revoked_at" IS NULL
      AND lease."expires_at">NEW."reported_at"
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_assignment_response_bindings" binding
    WHERE binding."workspace_id"=NEW."workspace_id" AND binding."epoch_id"=NEW."epoch_id"
      AND binding."unit_id"=NEW."unit_id" AND binding."assignment_id"=NEW."assignment_id"
  ) THEN
    RAISE EXCEPTION 'A content self-identification report must terminally complete its unpaid assignment without a label'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_content_self_identification_report_terminal_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_content_self_identification_reports"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_report_terminal();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_gap_closes_assignments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."agreement_state"='gap' AND EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_unit_gaps" gap
    WHERE gap."workspace_id"=NEW."workspace_id" AND gap."epoch_id"=NEW."epoch_id"
      AND gap."unit_id"=NEW."unit_id" AND gap."gap_evidence_id"=NEW."gap_evidence_id"
      AND gap."gap_reason" IN ('reviewer_nonresponse','content_self_identification')
  ) AND (
    EXISTS (
      SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
      JOIN "tokenless_assurance_assignments" assignment
        ON assignment."workspace_id"=selection."workspace_id" AND assignment."project_id"=selection."project_id"
       AND assignment."run_id"=selection."run_id" AND assignment."assignment_id"=selection."assignment_id"
       AND assignment."reviewer_account_address"=selection."reviewer_principal_id"
      WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
        AND selection."unit_id"=NEW."unit_id" AND assignment."status" IN ('reserved','accepted')
    ) OR EXISTS (
      SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
      JOIN "tokenless_assurance_artifact_leases" lease
        ON lease."workspace_id"=selection."workspace_id" AND lease."project_id"=selection."project_id"
       AND lease."assignment_id"=selection."assignment_id"
       AND lease."account_address"=selection."reviewer_principal_id"
      WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
        AND selection."unit_id"=NEW."unit_id" AND lease."revoked_at" IS NULL
        AND lease."expires_at">NEW."frozen_at"
    ) OR EXISTS (
      SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
      JOIN "tokenless_assurance_assignments" assignment
        ON assignment."workspace_id"=selection."workspace_id" AND assignment."project_id"=selection."project_id"
       AND assignment."run_id"=selection."run_id" AND assignment."assignment_id"=selection."assignment_id"
       AND assignment."reviewer_account_address"=selection."reviewer_principal_id"
      JOIN "tokenless_dsa_named_panel_unit_gaps" gap
        ON gap."workspace_id"=selection."workspace_id" AND gap."epoch_id"=selection."epoch_id"
       AND gap."unit_id"=selection."unit_id" AND gap."gap_evidence_id"=NEW."gap_evidence_id"
      WHERE selection."workspace_id"=NEW."workspace_id" AND selection."epoch_id"=NEW."epoch_id"
        AND selection."unit_id"=NEW."unit_id" AND assignment."status"='released'
        AND NOT EXISTS (
          SELECT 1 FROM "tokenless_dsa_named_panel_capacity_releases" release
          WHERE release."workspace_id"=selection."workspace_id" AND release."epoch_id"=selection."epoch_id"
            AND release."unit_id"=selection."unit_id" AND release."assignment_id"=selection."assignment_id"
            AND release."released_status"='released' AND (
              (gap."gap_reason"='reviewer_nonresponse'
                AND release."release_reason"='reviewer_nonresponse_gap'
                AND release."terminal_evidence_id"=gap."gap_evidence_id")
              OR (gap."gap_reason"='content_self_identification'
                AND release."release_reason"='content_self_identification_quarantine'
                AND EXISTS (
                  SELECT 1 FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
                  WHERE report."workspace_id"=gap."workspace_id" AND report."epoch_id"=gap."epoch_id"
                    AND report."unit_id"=gap."unit_id"
                    AND report."report_id"=release."terminal_evidence_id")
                AND gap."content_self_identification_report_count">0
                AND gap."content_self_identification_report_root"=
                  tokenless_dsa_named_panel_content_self_identification_report_root(
                    gap."workspace_id",gap."epoch_id",gap."unit_id")))
            )
    )
  ) THEN
    RAISE EXCEPTION 'A terminal DSA named-panel gap must close every exact assignment, lease, and capacity release'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_content_self_identification_gap_closes_assignments_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_content_self_identification_gap_closes_assignments();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_completed_response_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_count integer; bound_count integer; self_identification_report_count integer;
BEGIN
  IF NEW."status"<>'completed' OR NOT EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    WHERE selection."assignment_id"=NEW."assignment_id"
      AND selection."workspace_id"=NEW."workspace_id" AND selection."project_id"=NEW."project_id"
      AND selection."run_id"=NEW."run_id" AND selection."reviewer_principal_id"=NEW."reviewer_account_address"
      AND selection."response_binding_required"=true
  ) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO expected_count FROM "tokenless_assurance_run_cases" run_case
   WHERE run_case."run_id"=NEW."run_id";
  SELECT count(*) INTO bound_count FROM "tokenless_dsa_named_panel_assignment_response_bindings" binding
   WHERE binding."assignment_id"=NEW."assignment_id" AND binding."workspace_id"=NEW."workspace_id"
     AND binding."project_id"=NEW."project_id" AND binding."run_id"=NEW."run_id"
     AND binding."reviewer_principal_id"=NEW."reviewer_account_address"
     AND binding."reviewer_source"=NEW."source" AND binding."response_validity"='valid';
  SELECT count(*) INTO self_identification_report_count
    FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
   WHERE report."assignment_id"=NEW."assignment_id" AND report."workspace_id"=NEW."workspace_id"
     AND report."project_id"=NEW."project_id" AND report."run_id"=NEW."run_id"
     AND report."reviewer_principal_id"=NEW."reviewer_account_address";
  IF expected_count=0 OR NOT (
    (bound_count=expected_count AND self_identification_report_count=0)
    OR (expected_count=1 AND bound_count=0 AND self_identification_report_count=1 AND NEW."paid_assignment"=false)
  ) THEN
    RAISE EXCEPTION 'A new DSA named-panel completion requires exact response bindings or one terminal self-identification report'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_response_binding_open_unit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR SHARE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
    WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
      AND outcome."unit_id"=NEW."unit_id"
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
    WHERE report."workspace_id"=NEW."workspace_id" AND report."epoch_id"=NEW."epoch_id"
      AND report."unit_id"=NEW."unit_id"
  ) THEN
    RAISE EXCEPTION 'A terminal DSA named-panel unit cannot accept a response binding'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_access_before_self_identification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR SHARE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
    WHERE report."workspace_id"=NEW."workspace_id" AND report."epoch_id"=NEW."epoch_id"
      AND report."unit_id"=NEW."unit_id"
  ) THEN
    RAISE EXCEPTION 'A quarantined DSA named-panel unit cannot issue further artifact access evidence'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_access_before_self_identification_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_artifact_accesses"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_access_before_self_identification();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_gap_transaction_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."declared_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp()) THEN
    RAISE EXCEPTION 'A DSA named-panel gap must use its database transaction time'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_gap_transaction_evidence_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_unit_gaps"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_gap_transaction_evidence();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_gap_outcome_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gap_reason text; stored_report_count integer; exact_report_count integer; exact_gap_found boolean;
BEGIN
  IF NEW."agreement_state"<>'gap' THEN RETURN NEW; END IF;
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  SELECT gap."gap_reason",gap."content_self_identification_report_count"
    INTO gap_reason,stored_report_count
    FROM "tokenless_dsa_named_panel_unit_gaps" gap
   WHERE gap."workspace_id"=NEW."workspace_id" AND gap."project_id"=NEW."project_id"
     AND gap."epoch_id"=NEW."epoch_id" AND gap."unit_id"=NEW."unit_id"
     AND gap."gap_evidence_id"=NEW."gap_evidence_id"
     AND gap."declared_by"=NEW."frozen_by" AND gap."declared_at"=NEW."frozen_at";
  exact_gap_found:=FOUND;
  SELECT count(*) INTO exact_report_count
    FROM "tokenless_dsa_named_panel_content_self_identification_reports" report
   WHERE report."workspace_id"=NEW."workspace_id" AND report."epoch_id"=NEW."epoch_id"
     AND report."unit_id"=NEW."unit_id";
  IF NOT exact_gap_found OR (gap_reason='reviewer_nonresponse' AND exact_report_count<>0)
     OR (gap_reason='content_self_identification' AND exact_report_count<>stored_report_count) THEN
    RAISE EXCEPTION 'A DSA named-panel gap outcome must freeze the exact gap authority and database time'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_gap_outcome_identity_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_gap_outcome_identity();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_response_binding_open_unit_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_assignment_response_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_response_binding_open_unit();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_selection_open_unit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
    WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
      AND outcome."unit_id"=NEW."unit_id"
  ) THEN
    RAISE EXCEPTION 'A terminal DSA named-panel unit cannot accept another reviewer selection'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER zz_tokenless_dsa_named_panel_selection_open_unit_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_selections"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_selection_open_unit();--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tokenless_dsa_named_panel_selections" selection
    JOIN "tokenless_assurance_assignments" assignment
      ON assignment."assignment_id"=selection."assignment_id"
     AND assignment."workspace_id"=selection."workspace_id"
     AND assignment."project_id"=selection."project_id"
     AND assignment."run_id"=selection."run_id"
     AND assignment."reviewer_account_address"=selection."reviewer_principal_id"
    WHERE assignment."paid_assignment"=true
  ) THEN
    RAISE EXCEPTION '0185 refuses existing paid DSA named-panel selections; audit and remove them before migration'
      USING ERRCODE='55000';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_unpaid_selection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "tokenless_assurance_assignments" assignment
    WHERE assignment."assignment_id"=NEW."assignment_id"
      AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
      AND assignment."run_id"=NEW."run_id"
      AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
      AND assignment."paid_assignment"=false
  ) THEN
    RAISE EXCEPTION 'The current DSA named-panel pilot accepts unpaid assignments only'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_unpaid_selection_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_selections"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_unpaid_selection();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_assignment_stays_unpaid()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."paid_assignment"=true AND EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    WHERE selection."assignment_id"=NEW."assignment_id"
      AND selection."workspace_id"=NEW."workspace_id" AND selection."project_id"=NEW."project_id"
      AND selection."run_id"=NEW."run_id"
      AND selection."reviewer_principal_id"=NEW."reviewer_account_address"
  ) THEN
    RAISE EXCEPTION 'A DSA named-panel assignment cannot become paid in the current pilot'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_assignment_stays_unpaid_guard
BEFORE UPDATE OF "paid_assignment" ON "tokenless_assurance_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_assignment_stays_unpaid();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_dsa_named_panel_content_self_identification_report_root(
  target_workspace text,target_epoch text,target_unit text
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'sha256:'||encode(digest(convert_to(
    'rateloop.dsa-named-panel-content-self-identification-report-root.v1'||chr(0)||
    COALESCE(string_agg(
      report.assignment_id||'|'||report.report_id||'|'||report.access_id||'|'||report.report_hash,
      E'\n' ORDER BY convert_to(report.assignment_id,'UTF8')
    ),'')||E'\n','UTF8'),'sha256'),'hex')
  FROM tokenless_dsa_named_panel_content_self_identification_reports report
  WHERE report.workspace_id=target_workspace AND report.epoch_id=target_epoch AND report.unit_id=target_unit
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"
  ADD COLUMN "content_self_identification_report_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "content_self_identification_report_root" text;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"
  ALTER COLUMN "content_self_identification_report_count" DROP DEFAULT,
  DROP CONSTRAINT "tokenless_dsa_named_panel_unit_gaps_check",
  ADD CONSTRAINT "tokenless_dsa_named_panel_unit_gaps_check" CHECK (
    "gap_reason" IN ('reviewer_nonresponse','content_self_identification')
    AND "required_reviewer_count" BETWEEN 2 AND 20
    AND "assignment_count"="required_reviewer_count"
    AND "accepted_assignment_count" BETWEEN 0 AND "required_reviewer_count"
    AND "response_count" BETWEEN 0 AND "required_reviewer_count"
    AND "access_count" BETWEEN 0 AND "required_reviewer_count"
    AND "response_count"<"required_reviewer_count"
    AND (
      ("gap_reason"='reviewer_nonresponse' AND "assignment_deadline"<"declared_at"
        AND "content_self_identification_report_count"=0
        AND "content_self_identification_report_root" IS NULL)
      OR ("gap_reason"='content_self_identification'
        AND "content_self_identification_report_count" BETWEEN 1 AND "accepted_assignment_count"
        AND "content_self_identification_report_root" ~ '^sha256:[0-9a-f]{64}$')
    )
    AND "partial_response_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "authority_kind"='project_auditor_without_workspace_membership'
    AND "gap_hash"='sha256:'||encode(digest(convert_to("gap_json",'UTF8'),'sha256'),'hex')
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_unit_gap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exact_assignment_count integer; exact_reviewer_count integer; exact_accepted_count integer;
        exact_response_count integer; exact_access_count integer; exact_deadline timestamptz;
        exact_response_root text; exact_self_identification_report_count integer;
        exact_self_identification_report_root text; expected_json jsonb;
BEGIN
  SELECT count(*),count(DISTINCT reviewer_principal_id),max(panel_deadline)
    INTO exact_assignment_count,exact_reviewer_count,exact_deadline
    FROM "tokenless_dsa_named_panel_selections"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(*) INTO exact_accepted_count FROM "tokenless_dsa_named_panel_assignments"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(*) INTO exact_response_count FROM "tokenless_dsa_named_panel_response_evidence"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(DISTINCT assignment_id) INTO exact_access_count FROM "tokenless_dsa_named_panel_artifact_accesses"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(*) INTO exact_self_identification_report_count
    FROM "tokenless_dsa_named_panel_content_self_identification_reports"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  exact_response_root:=tokenless_dsa_named_panel_response_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id);
  exact_self_identification_report_root:=CASE WHEN exact_self_identification_report_count>0 THEN
    tokenless_dsa_named_panel_content_self_identification_report_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id)
    ELSE NULL END;
  expected_json:=CASE WHEN NEW.gap_reason='reviewer_nonresponse' THEN jsonb_build_object(
    'schemaVersion','rateloop.dsa-named-panel-unit-gap.v1','workspaceId',NEW.workspace_id,
    'projectId',NEW.project_id,'epochId',NEW.epoch_id,'unitId',NEW.unit_id,
    'gapEvidenceId',NEW.gap_evidence_id,'reason',NEW.gap_reason,
    'referenceDefinitionVersion',NEW.reference_definition_version,
    'referenceDefinitionHash',NEW.reference_definition_hash,
    'referenceDefinitionQuestion',NEW.reference_definition_question,
    'requiredReviewerCount',NEW.required_reviewer_count,'assignmentCount',NEW.assignment_count,
    'acceptedAssignmentCount',NEW.accepted_assignment_count,'responseCount',NEW.response_count,
    'accessCount',NEW.access_count,
    'assignmentDeadline',to_char(NEW.assignment_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'partialResponseRoot',NEW.partial_response_root,'authorityKind',NEW.authority_kind,
    'auditorAccessAssignmentId',NEW.auditor_access_assignment_id,'declaredBy',NEW.declared_by,
    'declaredAt',to_char(NEW.declared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ELSE jsonb_build_object(
    'schemaVersion','rateloop.dsa-named-panel-unit-gap.v2','workspaceId',NEW.workspace_id,
    'projectId',NEW.project_id,'epochId',NEW.epoch_id,'unitId',NEW.unit_id,
    'gapEvidenceId',NEW.gap_evidence_id,'reason',NEW.gap_reason,
    'referenceDefinitionVersion',NEW.reference_definition_version,
    'referenceDefinitionHash',NEW.reference_definition_hash,
    'referenceDefinitionQuestion',NEW.reference_definition_question,
    'requiredReviewerCount',NEW.required_reviewer_count,'assignmentCount',NEW.assignment_count,
    'acceptedAssignmentCount',NEW.accepted_assignment_count,'responseCount',NEW.response_count,
    'accessCount',NEW.access_count,
    'assignmentDeadline',to_char(NEW.assignment_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'partialResponseRoot',NEW.partial_response_root,
    'contentSelfIdentificationReportCount',NEW.content_self_identification_report_count,
    'contentSelfIdentificationReportRoot',NEW.content_self_identification_report_root,
    'reportingMode','authenticated_reviewer_report_auditor_confirmed',
    'authorityKind',NEW.authority_kind,'auditorAccessAssignmentId',NEW.auditor_access_assignment_id,
    'declaredBy',NEW.declared_by,
    'declaredAt',to_char(NEW.declared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END;
  IF exact_assignment_count<>NEW.assignment_count OR exact_reviewer_count<>NEW.assignment_count
     OR exact_accepted_count<>NEW.accepted_assignment_count OR exact_response_count<>NEW.response_count
     OR exact_access_count<>NEW.access_count OR exact_deadline<>NEW.assignment_deadline
     OR NEW.partial_response_root<>exact_response_root
     OR exact_self_identification_report_count<>NEW.content_self_identification_report_count
     OR exact_self_identification_report_root IS DISTINCT FROM NEW.content_self_identification_report_root
     OR EXISTS (
       SELECT 1 FROM "tokenless_workspace_members" member
       WHERE member.workspace_id=NEW.workspace_id AND member.account_address=NEW.declared_by
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_project_access_assignments" access
       WHERE access.assignment_id=NEW.auditor_access_assignment_id
         AND access.workspace_id=NEW.workspace_id AND access.project_id=NEW.project_id
         AND access.subject_kind='principal' AND access.subject_reference=NEW.declared_by
         AND access.role='auditor' AND access.status='active'
         AND (access.expires_at IS NULL OR access.expires_at>NEW.declared_at)
     ) OR NEW.gap_json IS NOT JSON OBJECT WITH UNIQUE KEYS OR NEW.gap_json::jsonb<>expected_json THEN
    RAISE EXCEPTION 'DSA sampled-unit gap does not reproduce exact panel evidence, reviewer reports, or auditor authority'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_labels"
  DROP CONSTRAINT "tokenless_dsa_reference_labels_contract_check",
  ADD CONSTRAINT "tokenless_dsa_reference_labels_contract_check" CHECK (
    "unit_id" ~ '^rsu_[A-Za-z0-9_-]{22}$'
    AND "evaluation_id" ~ '^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "decision_version">0 AND "manifest_selected"=true
    AND "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_identity" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "automated_outcome" IN ('pass','fail') AND "evaluation_hash"="source_evaluation_hash"
    AND "evaluation_projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_row_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_label" IN ('pass','fail','uncertain')
    AND "agreement_state" IN ('agreed','adjudicated','gap')
    AND (("agreement_state"='agreed' AND "reference_label"<>'uncertain'
          AND "adjudicated_by" IS NULL AND "gap_reason" IS NULL)
      OR ("agreement_state"='adjudicated' AND char_length("adjudicated_by") BETWEEN 1 AND 200
          AND "gap_reason" IS NULL)
      OR ("agreement_state"='gap' AND "reference_label"='uncertain'
          AND "adjudicated_by" IS NULL
          AND "gap_reason" IN ('reviewer_nonresponse','content_self_identification')))
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_hash" ~ '^sha256:[0-9a-f]{64}$'
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_adjudications")
     OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_adjudication_artifact_leases") THEN
    RAISE EXCEPTION '0186 refuses previously self-selected adjudication evidence; audit it before migration'
      USING ERRCODE='55000';
  END IF;
END;
$$;--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_adjudicator_assignments" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "adjudicator_principal_id" text NOT NULL,
  "auditor_access_assignment_id" text NOT NULL,
  "language_evidence_kind" text NOT NULL,
  "language_evidence_version" text NOT NULL,
  "language_evidence_json" text NOT NULL,
  "language_evidence_hash" text NOT NULL,
  "category_evidence_kind" text NOT NULL,
  "category_evidence_version" text NOT NULL,
  "category_competence_evidence_json" text NOT NULL,
  "category_competence_evidence_hash" text NOT NULL,
  "qualification_expires_at" timestamptz NOT NULL,
  "adjudication_deadline" timestamptz NOT NULL,
  "assignment_reason" text NOT NULL,
  "assignment_json" text NOT NULL,
  "assignment_hash" text NOT NULL,
  "assigned_by" text NOT NULL,
  "assigned_at" timestamptz NOT NULL DEFAULT date_trunc('milliseconds',transaction_timestamp()),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  UNIQUE ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id"),
  UNIQUE ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id",
          "qualification_expires_at"),
  UNIQUE ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id",
          "language_evidence_json","language_evidence_hash","category_competence_evidence_json",
          "category_competence_evidence_hash","qualification_expires_at"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id")
    REFERENCES "tokenless_dsa_named_panel_units" ("workspace_id","epoch_id","unit_id") ON DELETE RESTRICT,
  FOREIGN KEY ("adjudicator_principal_id")
    REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  FOREIGN KEY ("assigned_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  FOREIGN KEY ("auditor_access_assignment_id")
    REFERENCES "tokenless_project_access_assignments" ("assignment_id") ON DELETE RESTRICT,
  CHECK (
    "assignment_reason"='separated_project_auditor_named_after_disagreement'
    AND char_length("language_evidence_kind") BETWEEN 1 AND 80
    AND char_length("language_evidence_version") BETWEEN 1 AND 80
    AND char_length("category_evidence_kind") BETWEEN 1 AND 80
    AND char_length("category_evidence_version") BETWEEN 1 AND 80
    AND tokenless_dsa_named_panel_qualification_evidence_valid(
      "language_evidence_json","language_evidence_json"::jsonb->>'key',
      "language_evidence_json"::jsonb->'value',"language_evidence_kind","language_evidence_version",
      "assigned_at","adjudication_deadline"
    )
    AND tokenless_dsa_named_panel_qualification_evidence_valid(
      "category_competence_evidence_json","category_competence_evidence_json"::jsonb->>'key','true'::jsonb,
      "category_evidence_kind","category_evidence_version","assigned_at","adjudication_deadline"
    )
    AND "assignment_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "language_evidence_hash"='sha256:'||encode(digest(convert_to("language_evidence_json",'UTF8'),'sha256'),'hex')
    AND "category_competence_evidence_hash"='sha256:'||encode(digest(convert_to("category_competence_evidence_json",'UTF8'),'sha256'),'hex')
    AND "assignment_hash"='sha256:'||encode(digest(convert_to("assignment_json",'UTF8'),'sha256'),'hex')
    AND ("language_evidence_json"::jsonb->>'verifiedAt')::timestamptz<="assigned_at"
    AND ("category_competence_evidence_json"::jsonb->>'verifiedAt')::timestamptz<="assigned_at"
    AND ("language_evidence_json"::jsonb->>'expiresAt')::timestamptz>="adjudication_deadline"
    AND ("category_competence_evidence_json"::jsonb->>'expiresAt')::timestamptz>="adjudication_deadline"
    AND "qualification_expires_at"=LEAST(
      ("language_evidence_json"::jsonb->>'expiresAt')::timestamptz,
      ("category_competence_evidence_json"::jsonb->>'expiresAt')::timestamptz
    )
    AND "assigned_at"<"adjudication_deadline"
    AND "assignment_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-adjudicator-assignment.v1',
      'workspaceId',"workspace_id",'projectId',"project_id",'epochId',"epoch_id",'unitId',"unit_id",
      'adjudicatorPrincipalId',"adjudicator_principal_id",
      'auditorAccessAssignmentId',"auditor_access_assignment_id",
      'languageEvidenceHash',"language_evidence_hash",
      'categoryCompetenceEvidenceHash',"category_competence_evidence_hash",
      'qualificationExpiresAt',to_char("qualification_expires_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'adjudicationDeadline',to_char("adjudication_deadline" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'assignmentReason',"assignment_reason",'assignedBy',"assigned_by",
      'assignedAt',to_char("assigned_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_adjudicator_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_count integer; response_count integer; distinct_label_count integer;
        unit_language text; unit_cefr text; unit_category text; unit_window integer;
        language_rank integer; required_rank integer;
BEGIN
  SELECT unit.required_reviewer_count,unit.language_tag,unit.required_cefr_level,
         unit.policy_category_code,unit.response_window_ms
    INTO required_count,unit_language,unit_cefr,unit_category,unit_window
    FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit.workspace_id=NEW.workspace_id AND unit.project_id=NEW.project_id
     AND unit.epoch_id=NEW.epoch_id AND unit.unit_id=NEW.unit_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The exact DSA named-panel unit is required for adjudicator assignment' USING ERRCODE='23514';
  END IF;
  SELECT count(*),count(DISTINCT derived_label) INTO response_count,distinct_label_count
    FROM "tokenless_dsa_named_panel_response_evidence" response
   WHERE response.workspace_id=NEW.workspace_id AND response.epoch_id=NEW.epoch_id
     AND response.unit_id=NEW.unit_id;
  language_rank:=CASE NEW.language_evidence_json::jsonb->>'value' WHEN 'B2' THEN 0 WHEN 'C1' THEN 1 WHEN 'C2' THEN 2 ELSE -1 END;
  required_rank:=CASE unit_cefr WHEN 'B2' THEN 0 WHEN 'C1' THEN 1 WHEN 'C2' THEN 2 ELSE 99 END;
  IF NEW.assigned_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
     OR response_count<>required_count OR distinct_label_count<2
     OR NEW.adjudication_deadline<>NEW.assigned_at+(unit_window*interval '1 millisecond')
     OR NEW.language_evidence_json::jsonb->>'key'<>'language:'||lower(unit_language)||':reading:cefr'
     OR NEW.language_evidence_json::jsonb->>'source'<>NEW.language_evidence_kind
     OR NEW.language_evidence_json::jsonb->>'evidenceVersion'<>NEW.language_evidence_version
     OR language_rank<required_rank
     OR NEW.category_competence_evidence_json::jsonb->>'key'<>'dsa-policy-category:'||unit_category
     OR NEW.category_competence_evidence_json::jsonb->'value'<>'true'::jsonb
     OR NEW.category_competence_evidence_json::jsonb->>'source'<>NEW.category_evidence_kind
     OR NEW.category_competence_evidence_json::jsonb->>'evidenceVersion'<>NEW.category_evidence_version
     OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
                WHERE outcome.workspace_id=NEW.workspace_id AND outcome.epoch_id=NEW.epoch_id
                  AND outcome.unit_id=NEW.unit_id)
     OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_adjudications" adjudication
                WHERE adjudication.workspace_id=NEW.workspace_id AND adjudication.epoch_id=NEW.epoch_id
                  AND adjudication.unit_id=NEW.unit_id)
     OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_adjudication_artifact_leases" lease
                WHERE lease.workspace_id=NEW.workspace_id AND lease.epoch_id=NEW.epoch_id
                  AND lease.unit_id=NEW.unit_id)
     OR EXISTS (SELECT 1 FROM "tokenless_workspace_members" member
                WHERE member.workspace_id=NEW.workspace_id
                  AND member.account_address IN (NEW.assigned_by,NEW.adjudicator_principal_id))
     OR EXISTS (SELECT 1 FROM "tokenless_project_access_assignments" access
                WHERE access.workspace_id=NEW.workspace_id AND access.project_id=NEW.project_id
                  AND access.subject_kind='principal' AND access.subject_reference=NEW.adjudicator_principal_id
                  AND access.status='active' AND (access.expires_at IS NULL OR access.expires_at>NEW.assigned_at))
     OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_selections" panel
                WHERE panel.workspace_id=NEW.workspace_id AND panel.epoch_id=NEW.epoch_id
                  AND panel.unit_id=NEW.unit_id AND panel.reviewer_principal_id=NEW.adjudicator_principal_id)
     OR NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_reference_definitions" definition
       JOIN "tokenless_project_access_assignments" access
         ON access.assignment_id=definition.auditor_access_assignment_id
        AND access.workspace_id=definition.workspace_id AND access.project_id=definition.project_id
        AND access.subject_kind='principal' AND access.subject_reference=NEW.assigned_by
        AND access.role='auditor' AND access.status='active'
        AND (access.expires_at IS NULL OR access.expires_at>NEW.assigned_at)
       WHERE definition.workspace_id=NEW.workspace_id AND definition.project_id=NEW.project_id
         AND definition.epoch_id=NEW.epoch_id AND definition.created_by=NEW.assigned_by
         AND definition.auditor_access_assignment_id=NEW.auditor_access_assignment_id
         AND definition.created_by<>NEW.adjudicator_principal_id
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_principals" principal
       JOIN "tokenless_workspace_reviewers" reviewer
         ON reviewer.principal_address=principal.principal_id AND reviewer.workspace_id=NEW.workspace_id
        AND reviewer.status='active'
       JOIN "tokenless_assurance_cohort_reviewers" cohort
         ON cohort.reviewer_account_address=principal.principal_id AND cohort.project_id=NEW.project_id
        AND cohort.status='active'
       WHERE principal.principal_id=NEW.adjudicator_principal_id AND principal.status='active'
     ) THEN
    RAISE EXCEPTION 'DSA adjudicator assignment requires one exact full disagreement, separated project auditor, and qualified non-panel principal'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudicator_assignment_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_adjudicator_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_adjudicator_assignment();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudicator_assignments_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_adjudicator_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_adjudication_artifact_leases"
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudication_leases_assignee_fk"
  FOREIGN KEY ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id","qualification_expires_at")
  REFERENCES "tokenless_dsa_named_panel_adjudicator_assignments"
    ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id","qualification_expires_at") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_adjudications"
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_assignee_fk"
  FOREIGN KEY ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id",
               "language_evidence_json","language_evidence_hash","category_competence_evidence_json",
               "category_competence_evidence_hash","qualification_expires_at")
  REFERENCES "tokenless_dsa_named_panel_adjudicator_assignments"
    ("workspace_id","project_id","epoch_id","unit_id","adjudicator_principal_id",
     "language_evidence_json","language_evidence_hash","category_competence_evidence_json",
     "category_competence_evidence_hash","qualification_expires_at") ON DELETE RESTRICT;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_adjudication_transaction_time()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."created_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp()) OR NOT EXISTS (
    SELECT 1
    FROM "tokenless_dsa_named_panel_adjudicator_assignments" assignment
    WHERE assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
      AND assignment."epoch_id"=NEW."epoch_id" AND assignment."unit_id"=NEW."unit_id"
      AND assignment."adjudicator_principal_id"=NEW."adjudicator_principal_id"
      AND assignment."adjudication_deadline">=NEW."created_at"
      AND assignment."qualification_expires_at">=NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'DSA named-panel adjudication requires current database time and an unexpired exact assignment'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudication_transaction_time_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_adjudications"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_adjudication_transaction_time();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_outcome_transaction_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."frozen_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
     OR (NEW."agreement_state" IN ('agreed','adjudicated') AND NOT EXISTS (
       SELECT 1
       FROM "tokenless_workspace_members" member
       JOIN "tokenless_assurance_projects" project
         ON project."workspace_id"=member."workspace_id" AND project."project_id"=NEW."project_id"
        AND project."status"='active'
       WHERE member."workspace_id"=NEW."workspace_id" AND member."account_address"=NEW."frozen_by"
         AND member."role" IN ('owner','admin')
     )) THEN
    RAISE EXCEPTION 'DSA named-panel outcomes require current database time and exact terminal authority'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_outcome_transaction_authority_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_outcome_transaction_authority();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_live_authority_grant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE principal_id text; target_workspace text; target_project text;
BEGIN
  IF TG_TABLE_NAME='tokenless_workspace_members' THEN
    principal_id:=NEW."account_address"; target_workspace:=NEW."workspace_id"; target_project:=NULL;
  ELSE
    IF NEW."subject_kind"<>'principal' OR NEW."status"<>'active'
       OR (NEW."expires_at" IS NOT NULL AND NEW."expires_at"<=transaction_timestamp()) THEN RETURN NEW; END IF;
    principal_id:=NEW."subject_reference"; target_workspace:=NEW."workspace_id"; target_project:=NEW."project_id";
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" panel
    JOIN "tokenless_dsa_named_panel_units" unit
      ON unit."workspace_id"=panel."workspace_id" AND unit."epoch_id"=panel."epoch_id" AND unit."unit_id"=panel."unit_id"
    LEFT JOIN "tokenless_dsa_named_panel_unit_outcomes" outcome
      ON outcome."workspace_id"=panel."workspace_id" AND outcome."epoch_id"=panel."epoch_id" AND outcome."unit_id"=panel."unit_id"
    WHERE panel."reviewer_principal_id"=principal_id AND panel."workspace_id"=target_workspace
      AND (target_project IS NULL OR panel."project_id"=target_project)
      AND outcome."unit_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_adjudicator_assignments" assignment
    LEFT JOIN "tokenless_dsa_named_panel_unit_outcomes" outcome
      ON outcome."workspace_id"=assignment."workspace_id" AND outcome."epoch_id"=assignment."epoch_id"
     AND outcome."unit_id"=assignment."unit_id"
    WHERE assignment."adjudicator_principal_id"=principal_id AND assignment."workspace_id"=target_workspace
      AND (target_project IS NULL OR assignment."project_id"=target_project)
      AND assignment."adjudication_deadline">transaction_timestamp()
      AND outcome."unit_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_adjudication_artifact_leases" marker
    LEFT JOIN "tokenless_dsa_named_panel_unit_outcomes" outcome
      ON outcome."workspace_id"=marker."workspace_id" AND outcome."epoch_id"=marker."epoch_id"
     AND outcome."unit_id"=marker."unit_id"
    WHERE marker."adjudicator_principal_id"=principal_id AND marker."workspace_id"=target_workspace
      AND (target_project IS NULL OR marker."project_id"=target_project)
      AND outcome."unit_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active DSA named-panel participants cannot receive workspace or project authority'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_terminal_closes_adjudication_lease()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tokenless_dsa_named_panel_adjudication_artifact_leases" marker
    JOIN "tokenless_assurance_artifact_leases" lease
      ON lease."lease_id"=marker."lease_id" AND lease."workspace_id"=marker."workspace_id"
     AND lease."project_id"=marker."project_id" AND lease."artifact_id"=marker."artifact_id"
     AND lease."account_address"=marker."adjudicator_principal_id"
     AND lease."purpose"='dsa_named_panel_adjudication'
    WHERE marker."workspace_id"=NEW."workspace_id" AND marker."project_id"=NEW."project_id"
      AND marker."epoch_id"=NEW."epoch_id" AND marker."unit_id"=NEW."unit_id"
      AND lease."revoked_at" IS NULL AND lease."expires_at">NEW."frozen_at"
  ) THEN
    RAISE EXCEPTION 'A terminal DSA named-panel outcome must close its exact adjudication artifact lease'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_terminal_closes_adjudication_lease_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_terminal_closes_adjudication_lease();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"
  ADD COLUMN "adjudicator_principal_id" text,
  ADD COLUMN "adjudicator_assignment_hash" text,
  DROP CONSTRAINT "tokenless_dsa_named_panel_unit_gaps_check",
  ADD CONSTRAINT "tokenless_dsa_named_panel_unit_gaps_check" CHECK (
    "gap_reason" IN ('reviewer_nonresponse','content_self_identification','adjudicator_nonresponse')
    AND "required_reviewer_count" BETWEEN 2 AND 20
    AND "assignment_count"="required_reviewer_count"
    AND "accepted_assignment_count" BETWEEN 0 AND "required_reviewer_count"
    AND "response_count" BETWEEN 0 AND "required_reviewer_count"
    AND "access_count" BETWEEN 0 AND "required_reviewer_count"
    AND (
      ("gap_reason"='reviewer_nonresponse' AND "response_count"<"required_reviewer_count"
        AND "assignment_deadline"<"declared_at" AND "content_self_identification_report_count"=0
        AND "content_self_identification_report_root" IS NULL AND "adjudicator_principal_id" IS NULL
        AND "adjudicator_assignment_hash" IS NULL)
      OR ("gap_reason"='content_self_identification' AND "response_count"<"required_reviewer_count"
        AND "content_self_identification_report_count" BETWEEN 1 AND "accepted_assignment_count"
        AND "content_self_identification_report_root" ~ '^sha256:[0-9a-f]{64}$'
        AND "adjudicator_principal_id" IS NULL AND "adjudicator_assignment_hash" IS NULL)
      OR ("gap_reason"='adjudicator_nonresponse' AND "response_count"="required_reviewer_count"
        AND "assignment_deadline"<"declared_at" AND "content_self_identification_report_count"=0
        AND "content_self_identification_report_root" IS NULL
        AND char_length("adjudicator_principal_id") BETWEEN 1 AND 200
        AND "adjudicator_assignment_hash" ~ '^sha256:[0-9a-f]{64}$')
    )
    AND "partial_response_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "authority_kind"='project_auditor_without_workspace_membership'
    AND "gap_hash"='sha256:'||encode(digest(convert_to("gap_json",'UTF8'),'sha256'),'hex')
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_unit_gap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exact_assignment_count integer; exact_reviewer_count integer; exact_accepted_count integer;
        exact_response_count integer; exact_access_count integer; exact_panel_deadline timestamptz;
        exact_response_root text; exact_self_identification_report_count integer;
        exact_self_identification_report_root text; exact_adjudicator text;
        exact_adjudicator_assignment_hash text; exact_adjudication_deadline timestamptz;
        expected_deadline timestamptz; expected_json jsonb;
BEGIN
  SELECT count(*),count(DISTINCT reviewer_principal_id),max(panel_deadline)
    INTO exact_assignment_count,exact_reviewer_count,exact_panel_deadline
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
  SELECT assignment.adjudicator_principal_id,assignment.assignment_hash,assignment.adjudication_deadline
    INTO exact_adjudicator,exact_adjudicator_assignment_hash,exact_adjudication_deadline
    FROM "tokenless_dsa_named_panel_adjudicator_assignments" assignment
   WHERE assignment.workspace_id=NEW.workspace_id AND assignment.project_id=NEW.project_id
     AND assignment.epoch_id=NEW.epoch_id AND assignment.unit_id=NEW.unit_id
     AND assignment.assigned_by=NEW.declared_by
     AND assignment.auditor_access_assignment_id=NEW.auditor_access_assignment_id;
  exact_response_root:=tokenless_dsa_named_panel_response_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id);
  exact_self_identification_report_root:=CASE WHEN exact_self_identification_report_count>0 THEN
    tokenless_dsa_named_panel_content_self_identification_report_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id)
    ELSE NULL END;
  expected_deadline:=CASE WHEN NEW.gap_reason='adjudicator_nonresponse'
    THEN exact_adjudication_deadline ELSE exact_panel_deadline END;
  expected_json:=CASE
    WHEN NEW.gap_reason='reviewer_nonresponse' THEN jsonb_build_object(
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
    WHEN NEW.gap_reason='content_self_identification' THEN jsonb_build_object(
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
      'declaredAt',to_char(NEW.declared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    ELSE jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-unit-gap.v3','workspaceId',NEW.workspace_id,
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
      'adjudicatorPrincipalId',NEW.adjudicator_principal_id,
      'adjudicatorAssignmentHash',NEW.adjudicator_assignment_hash,
      'reportingMode','separated_project_auditor_assignment_nonresponse',
      'authorityKind',NEW.authority_kind,'auditorAccessAssignmentId',NEW.auditor_access_assignment_id,
      'declaredBy',NEW.declared_by,
      'declaredAt',to_char(NEW.declared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END;
  IF exact_assignment_count<>NEW.assignment_count OR exact_reviewer_count<>NEW.assignment_count
     OR exact_accepted_count<>NEW.accepted_assignment_count OR exact_response_count<>NEW.response_count
     OR exact_access_count<>NEW.access_count OR expected_deadline IS DISTINCT FROM NEW.assignment_deadline
     OR NEW.partial_response_root<>exact_response_root
     OR exact_self_identification_report_count<>NEW.content_self_identification_report_count
     OR exact_self_identification_report_root IS DISTINCT FROM NEW.content_self_identification_report_root
     OR (NEW.gap_reason='adjudicator_nonresponse' AND (
       exact_adjudicator IS DISTINCT FROM NEW.adjudicator_principal_id
       OR exact_adjudicator_assignment_hash IS DISTINCT FROM NEW.adjudicator_assignment_hash
       OR EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_adjudications" adjudication
                  WHERE adjudication.workspace_id=NEW.workspace_id AND adjudication.epoch_id=NEW.epoch_id
                    AND adjudication.unit_id=NEW.unit_id)))
     OR EXISTS (SELECT 1 FROM "tokenless_workspace_members" member
                WHERE member.workspace_id=NEW.workspace_id AND member.account_address=NEW.declared_by)
     OR NOT EXISTS (
       SELECT 1 FROM "tokenless_project_access_assignments" access
       WHERE access.assignment_id=NEW.auditor_access_assignment_id
         AND access.workspace_id=NEW.workspace_id AND access.project_id=NEW.project_id
         AND access.subject_kind='principal' AND access.subject_reference=NEW.declared_by
         AND access.role='auditor' AND access.status='active'
         AND (access.expires_at IS NULL OR access.expires_at>NEW.declared_at)
     ) OR NEW.gap_json IS NOT JSON OBJECT WITH UNIQUE KEYS OR NEW.gap_json::jsonb<>expected_json THEN
    RAISE EXCEPTION 'DSA sampled-unit gap does not reproduce exact panel, adjudicator, reviewer-report, or auditor evidence'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_unit_outcomes"
  DROP CONSTRAINT "tokenless_dsa_named_panel_unit_outcomes_check",
  ADD CONSTRAINT "tokenless_dsa_named_panel_unit_outcomes_check" CHECK (
    "required_reviewer_count" BETWEEN 2 AND 20
    AND "response_count" BETWEEN 0 AND "required_reviewer_count"
    AND "reference_label" IN ('pass','fail','uncertain')
    AND "agreement_state" IN ('agreed','adjudicated','gap')
    AND (("agreement_state"='agreed' AND "response_count"="required_reviewer_count"
          AND "adjudication_id" IS NULL AND "gap_evidence_id" IS NULL)
      OR ("agreement_state"='adjudicated' AND "response_count"="required_reviewer_count"
          AND "adjudication_id" IS NOT NULL AND "gap_evidence_id" IS NULL)
      OR ("agreement_state"='gap' AND "reference_label"='uncertain' AND "adjudication_id" IS NULL
          AND "gap_evidence_id" IS NOT NULL))
    AND "response_evidence_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "outcome_hash"='sha256:'||encode(digest(convert_to("outcome_json",'UTF8'),'sha256'),'hex')
  );--> statement-breakpoint

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
          AND "gap_reason" IN ('reviewer_nonresponse','content_self_identification','adjudicator_nonresponse')))
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_hash" ~ '^sha256:[0-9a-f]{64}$'
  );

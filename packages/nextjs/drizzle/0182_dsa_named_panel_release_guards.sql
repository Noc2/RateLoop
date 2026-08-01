DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tokenless_dsa_named_panel_units") THEN
    RAISE EXCEPTION '0182 refuses legacy DSA named-panel evidence without authoritative source and policy bindings'
      USING ERRCODE='55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_part8_report_versions" report
    WHERE report."label_set_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "tokenless_dsa_named_panel_label_set_bridges" bridge
      WHERE bridge."workspace_id"=report."workspace_id"
        AND bridge."label_set_id"=report."label_set_id"
        AND bridge."epoch_id"=report."epoch_id"
        AND bridge."label_root"=report."label_root"
        AND bridge."label_set_hash"=report."label_set_hash"
    )
  ) THEN
    RAISE EXCEPTION '0182 refuses an existing Part 8 report without an exact named-panel bridge'
      USING ERRCODE='55000';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_units"
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_run_unique"
  UNIQUE ("workspace_id","project_id","run_id");--> statement-breakpoint

ALTER TABLE "tokenless_dsa_source_decision_versions"
  ADD CONSTRAINT "tokenless_dsa_source_decision_versions_named_exact_unique"
  UNIQUE ("workspace_id","provider_decision_id","decision_version","source_decision_hash");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_source_engagement_versions"
  ADD CONSTRAINT "tokenless_dsa_source_engagement_versions_named_exact_unique"
  UNIQUE ("workspace_id","engagement_id","engagement_version","engagement_hash");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_transparency_payload_versions"
  ADD CONSTRAINT "tokenless_dsa_transparency_payload_versions_named_exact_unique"
  UNIQUE ("workspace_id","provider_decision_id","decision_version","payload_version","puid","payload_hash");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_transparency_receipt_versions"
  ADD CONSTRAINT "tokenless_dsa_transparency_receipt_versions_named_exact_unique"
  UNIQUE ("workspace_id","provider_decision_id","decision_version","payload_version","receipt_version","attempt_id","receipt_hash");--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_units"
  ADD COLUMN "source_engagement_id" text NOT NULL,
  ADD COLUMN "source_engagement_version" integer NOT NULL,
  ADD COLUMN "source_engagement_hash" text NOT NULL,
  ADD COLUMN "source_decision_hash" text NOT NULL,
  ADD COLUMN "transparency_payload_version" integer,
  ADD COLUMN "transparency_puid" text,
  ADD COLUMN "transparency_payload_hash" text,
  ADD COLUMN "transparency_receipt_version" integer,
  ADD COLUMN "transparency_attempt_id" text,
  ADD COLUMN "transparency_receipt_hash" text,
  ADD COLUMN "reference_definition_version" integer NOT NULL,
  ADD COLUMN "reference_definition_hash" text NOT NULL,
  ADD COLUMN "reference_definition_question" text NOT NULL,
  ADD COLUMN "response_window_ms" integer NOT NULL,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_source_engagement_fk"
    FOREIGN KEY ("workspace_id","source_engagement_id","source_engagement_version","source_engagement_hash")
    REFERENCES "tokenless_dsa_source_engagement_versions"
      ("workspace_id","engagement_id","engagement_version","engagement_hash") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_source_decision_fk"
    FOREIGN KEY ("workspace_id","provider_decision_id","decision_version","source_decision_hash")
    REFERENCES "tokenless_dsa_source_decision_versions"
      ("workspace_id","provider_decision_id","decision_version","source_decision_hash") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_transparency_payload_fk"
    FOREIGN KEY ("workspace_id","provider_decision_id","decision_version","transparency_payload_version",
                 "transparency_puid","transparency_payload_hash")
    REFERENCES "tokenless_dsa_transparency_payload_versions"
      ("workspace_id","provider_decision_id","decision_version","payload_version","puid","payload_hash") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_transparency_receipt_fk"
    FOREIGN KEY ("workspace_id","provider_decision_id","decision_version","transparency_payload_version",
                 "transparency_receipt_version","transparency_attempt_id","transparency_receipt_hash")
    REFERENCES "tokenless_dsa_transparency_receipt_versions"
      ("workspace_id","provider_decision_id","decision_version","payload_version","receipt_version","attempt_id","receipt_hash") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_source_evidence_check" CHECK (
    "source_engagement_version">0 AND "source_engagement_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_decision_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_definition_version">0
    AND "reference_definition_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "response_window_ms" BETWEEN 86400000 AND 604800000
    AND char_length(btrim("reference_definition_question")) BETWEEN 1 AND 2000
    AND (("transparency_payload_version" IS NULL AND "transparency_puid" IS NULL
          AND "transparency_payload_hash" IS NULL AND "transparency_receipt_version" IS NULL
          AND "transparency_attempt_id" IS NULL AND "transparency_receipt_hash" IS NULL)
      OR ("transparency_payload_version">0 AND "transparency_puid" IS NOT NULL
          AND "transparency_payload_hash" ~ '^sha256:[0-9a-f]{64}$'
          AND (("transparency_receipt_version" IS NULL AND "transparency_attempt_id" IS NULL
                AND "transparency_receipt_hash" IS NULL)
            OR ("transparency_receipt_version">0 AND "transparency_attempt_id" IS NOT NULL
                AND "transparency_receipt_hash" ~ '^sha256:[0-9a-f]{64}$'))))
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_registered_before_delivery()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_case_count integer; assignment_count integer; response_count integer;
        subpanel_count integer; matching_subpanel_count integer; reviewer_target_count integer;
BEGIN
  SELECT count(*) INTO run_case_count
    FROM tokenless_assurance_run_cases run_case WHERE run_case.run_id=NEW.run_id;
  SELECT count(*) INTO assignment_count
    FROM tokenless_assurance_assignments assignment WHERE assignment.run_id=NEW.run_id;
  SELECT count(*) INTO response_count
    FROM tokenless_assurance_responses response WHERE response.run_id=NEW.run_id AND response.case_id=NEW.case_id;
  SELECT count(*),
         count(*) FILTER (
           WHERE subpanel.workspace_id=NEW.workspace_id AND subpanel.project_id=NEW.project_id
             AND subpanel.source='customer_invited' AND subpanel.selection='customer_named'
             AND EXISTS (
               SELECT 1 FROM tokenless_assurance_runs run
               WHERE run.run_id=subpanel.run_id AND run.project_id=NEW.project_id AND run.status='frozen'
                 AND run.manifest_hash=subpanel.run_manifest_hash AND run.policy_hash=subpanel.policy_hash
             )
         ),
         COALESCE(sum(subpanel.target_count),0)
    INTO subpanel_count,matching_subpanel_count,reviewer_target_count
    FROM tokenless_assurance_run_subpanels subpanel WHERE subpanel.run_id=NEW.run_id;
  IF run_case_count<>1 OR assignment_count<>0 OR response_count<>0
     OR subpanel_count=0 OR matching_subpanel_count<>subpanel_count
     OR reviewer_target_count<>NEW.required_reviewer_count THEN
    RAISE EXCEPTION 'DSA named-panel unit requires one undelivered case and one exact frozen customer-named audience'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_sampling_epochs"
  ADD CONSTRAINT "tokenless_dsa_reference_epochs_definition_scope_unique"
  UNIQUE ("workspace_id","epoch_id","project_id");--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_reference_definitions" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "version" integer NOT NULL,
  "question" text NOT NULL,
  "standard_id" text NOT NULL,
  "standard_version" text NOT NULL,
  "standard_hash" text NOT NULL,
  "authority_kind" text NOT NULL,
  "auditor_access_assignment_id" text NOT NULL,
  "definition_json" text NOT NULL,
  "definition_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id"),
  UNIQUE ("workspace_id","epoch_id","version","definition_hash"),
  UNIQUE ("workspace_id","epoch_id","version","definition_hash","question"),
  FOREIGN KEY ("workspace_id","epoch_id","project_id")
    REFERENCES "tokenless_dsa_reference_sampling_epochs" ("workspace_id","epoch_id","project_id") ON DELETE RESTRICT,
  FOREIGN KEY ("auditor_access_assignment_id")
    REFERENCES "tokenless_project_access_assignments" ("assignment_id") ON DELETE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK (
    "version">0 AND char_length(btrim("question")) BETWEEN 1 AND 2000
    AND char_length(btrim("standard_id")) BETWEEN 1 AND 160
    AND char_length(btrim("standard_version")) BETWEEN 1 AND 160
    AND "standard_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "authority_kind"='project_auditor_without_workspace_membership'
    AND "definition_hash"='sha256:'||encode(digest(convert_to("definition_json",'UTF8'),'sha256'),'hex')
    AND "definition_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "definition_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-reference-definition.v1',
      'workspaceId',"workspace_id",'projectId',"project_id",'epochId',"epoch_id",
      'version',"version",'question',"question",
      'standardId',"standard_id",'standardVersion',"standard_version",'standardHash',"standard_hash",
      'responsePolarity',jsonb_build_object('policyMatches','fail','policyDoesNotMatch','pass'),
      'uncertaintyRule','reviewers_binary_adjudicator_may_choose_uncertain',
      'adjudicationRule','qualified_non_panel_principal_required_on_disagreement',
      'authorityKind',"authority_kind",
      'auditorAccessAssignmentId',"auditor_access_assignment_id",'createdBy',"created_by"
    )
  )
);--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_units"
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_reference_definition_fk"
    FOREIGN KEY ("workspace_id","epoch_id","reference_definition_version","reference_definition_hash",
                 "reference_definition_question")
    REFERENCES "tokenless_dsa_named_panel_reference_definitions"
      ("workspace_id","epoch_id","version","definition_hash","question") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_units_exact_json_check" CHECK (
    "blinded_payload_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "unit_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "blinded_payload_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-blinded-case.v1',
      'blindedCaseId',"blinded_case_id",
      'content',jsonb_build_object(
        'artifactId',"content_artifact_id",'artifactVersion',1,'contentHash',"content_artifact_digest",
        'contentType',"content_type",'language',"language_tag"
      ),
      'policy',jsonb_build_object(
        'categoryCode',"policy_category_code",'policyHash',"reference_definition_hash",
        'policyVersion',"reference_definition_version",'question',"reference_definition_question"
      ),
      'reference',jsonb_build_object(
        'populationId',"population_id",'populationVersion',"population_version",'frameId',"frame_id",
        'frameVersion',1,'sampleId',"epoch_id",'sampleVersion',1,'position',"selection_rank"
      )
    )
    AND "unit_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-unit.v1',
      'workspaceId',"workspace_id",'projectId',"project_id",'epochId',"epoch_id",'unitId',"unit_id",
      'evaluationId',"evaluation_id",'runId',"run_id",'caseId',"case_id",
      'mappingCommitment',"mapping_commitment",'withheldSnapshotDigest',"withheld_snapshot_digest",
      'sourceEvidence',jsonb_build_object(
        'providerDecisionId',"provider_decision_id",'decisionVersion',"decision_version",
        'sourceDecisionHash',"source_decision_hash",'engagementId',"source_engagement_id",
        'engagementVersion',"source_engagement_version",'engagementHash',"source_engagement_hash",
        'transparencyPayloadVersion',"transparency_payload_version",'transparencyPuid',"transparency_puid",
        'transparencyPayloadHash',"transparency_payload_hash",
        'transparencyReceiptVersion',"transparency_receipt_version",
        'transparencyAttemptId',"transparency_attempt_id",'transparencyReceiptHash',"transparency_receipt_hash"
      ),
      'referenceDefinitionVersion',"reference_definition_version"::text,
      'referenceDefinitionHash',"reference_definition_hash",
      'requiredCefrLevel',"required_cefr_level",'requiredReviewerCount',"required_reviewer_count",
      'responseWindowMs',"response_window_ms",
      'createdBy',"created_by",
      'createdAt',to_char("created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_named_selection_exact_unique"
  UNIQUE ("workspace_id","project_id","run_id","assignment_id","subpanel_id","cohort_id",
          "reviewer_account_address","source","selection","assurance_snapshot_hash",
          "reservation_expires_at","created_at");--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_selections" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "assignment_id" text NOT NULL,
  "subpanel_id" text NOT NULL,
  "cohort_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "selection" text NOT NULL,
  "status_at_selection" text NOT NULL,
  "assurance_snapshot_hash" text NOT NULL,
  "acceptance_deadline" timestamptz NOT NULL,
  "response_window_ms" integer NOT NULL,
  "panel_deadline" timestamptz NOT NULL,
  "selection_snapshot_json" text NOT NULL,
  "selection_snapshot_hash" text NOT NULL,
  "selected_at" timestamptz NOT NULL,
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id"),
  UNIQUE ("workspace_id","epoch_id","unit_id","reviewer_principal_id"),
  UNIQUE ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id","panel_deadline"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","project_id","run_id","assignment_id","subpanel_id","cohort_id",
               "reviewer_principal_id","reviewer_source","selection","assurance_snapshot_hash",
               "acceptance_deadline","selected_at")
    REFERENCES "tokenless_assurance_assignments"
      ("workspace_id","project_id","run_id","assignment_id","subpanel_id","cohort_id",
       "reviewer_account_address","source","selection","assurance_snapshot_hash",
       "reservation_expires_at","created_at") ON DELETE RESTRICT,
  CHECK (
    "reviewer_source"='customer_invited' AND "selection"='customer_named' AND "status_at_selection"='reserved'
    AND "assurance_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "response_window_ms" BETWEEN 86400000 AND 604800000
    AND "acceptance_deadline">"selected_at" AND "acceptance_deadline"<="panel_deadline"
    AND "panel_deadline"="selected_at"+("response_window_ms"*interval '1 millisecond')
    AND "selection_snapshot_hash"='sha256:'||encode(digest(convert_to("selection_snapshot_json",'UTF8'),'sha256'),'hex')
    AND "selection_snapshot_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "selection_snapshot_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-selection.v1','workspaceId',"workspace_id",
      'projectId',"project_id",'epochId',"epoch_id",'unitId',"unit_id",'runId',"run_id",
      'caseId',"case_id",'mappingCommitment',"mapping_commitment",'assignmentId',"assignment_id",
      'subpanelId',"subpanel_id",'cohortId',"cohort_id",'reviewerPrincipalId',"reviewer_principal_id",
      'reviewerSource',"reviewer_source",'selection',"selection",'statusAtSelection',"status_at_selection",
      'assuranceSnapshotHash',"assurance_snapshot_hash",
      'acceptanceDeadline',to_char("acceptance_deadline" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'responseWindowMs',"response_window_ms",
      'panelDeadline',to_char("panel_deadline" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'selectedAt',to_char("selected_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_selection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_count integer; response_window integer; selected_count integer; selected_reviewer_count integer;
BEGIN
  SELECT unit.required_reviewer_count,unit.response_window_ms INTO required_count,response_window
    FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit.workspace_id=NEW.workspace_id AND unit.project_id=NEW.project_id
     AND unit.epoch_id=NEW.epoch_id AND unit.unit_id=NEW.unit_id AND unit.run_id=NEW.run_id
   FOR UPDATE;
  SELECT count(*),count(DISTINCT reviewer_principal_id)
    INTO selected_count,selected_reviewer_count
    FROM "tokenless_dsa_named_panel_selections"
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  IF required_count IS NULL OR response_window<>NEW.response_window_ms
     OR NEW.panel_deadline<>NEW.selected_at+(response_window*interval '1 millisecond')
     OR NOT EXISTS (
       SELECT 1 FROM "tokenless_assurance_assignments" assignment
       WHERE assignment."assignment_id"=NEW."assignment_id"
         AND assignment."workspace_id"=NEW."workspace_id" AND assignment."project_id"=NEW."project_id"
         AND assignment."run_id"=NEW."run_id" AND assignment."subpanel_id"=NEW."subpanel_id"
         AND assignment."cohort_id"=NEW."cohort_id"
         AND assignment."reviewer_account_address"=NEW."reviewer_principal_id"
         AND assignment."source"=NEW."reviewer_source" AND assignment."selection"=NEW."selection"
         AND assignment."status"='reserved'
         AND assignment."assurance_snapshot_hash"=NEW."assurance_snapshot_hash"
         AND assignment."reservation_expires_at"=NEW."acceptance_deadline"
         AND assignment."created_at"=NEW."selected_at"
     )
     OR selected_count>=required_count
     OR selected_reviewer_count<>selected_count THEN
    RAISE EXCEPTION 'DSA named-panel selection is frozen and cannot replace or exceed its exact reviewer seats'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_selection_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_selections"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_selection();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_selections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_selections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_reservation_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
    WHERE unit.workspace_id=NEW.workspace_id AND unit.project_id=NEW.project_id AND unit.run_id=NEW.run_id
  ) AND NOT EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    WHERE selection.workspace_id=NEW.workspace_id AND selection.project_id=NEW.project_id
      AND selection.run_id=NEW.run_id AND selection.assignment_id=NEW.assignment_id
      AND selection.reviewer_principal_id=NEW.reviewer_account_address
      AND selection.acceptance_deadline=NEW.reservation_expires_at
      AND selection.assurance_snapshot_hash=NEW.assurance_snapshot_hash
      AND selection.selected_at=NEW.created_at
  ) THEN
    RAISE EXCEPTION 'Every DSA named-panel reservation must freeze its exact reviewer seat in the same transaction'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_reservation_frozen_at_commit
AFTER INSERT ON "tokenless_assurance_assignments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_reservation_frozen();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_assignment_deadline()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('accepted','completed') AND EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_selections" selection
    WHERE selection."assignment_id"=NEW."assignment_id"
      AND selection."workspace_id"=NEW."workspace_id" AND selection."project_id"=NEW."project_id"
      AND selection."run_id"=NEW."run_id" AND selection."reviewer_principal_id"=NEW."reviewer_account_address"
      AND (NEW."assignment_expires_at" IS NULL OR NEW."assignment_expires_at"<>selection."panel_deadline")
  ) THEN
    RAISE EXCEPTION 'Accepted DSA named-panel work cannot extend its frozen selection deadline'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_assignment_deadline_guard
BEFORE UPDATE OF "status","assignment_expires_at" ON "tokenless_assurance_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_assignment_deadline();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_assignments"
  ADD CONSTRAINT "tokenless_dsa_named_panel_assignments_selection_fk"
  FOREIGN KEY ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id","assignment_expires_at")
  REFERENCES "tokenless_dsa_named_panel_selections"
    ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id","panel_deadline")
  ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_assignments"
  ADD CONSTRAINT "tokenless_dsa_named_panel_assignments_exact_json_check" CHECK (
    "language_evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "category_competence_evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "conflict_declaration_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "assignment_snapshot_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "language_evidence_json"::jsonb=jsonb_build_object(
      'key','language:'||lower("language_tag")||':reading:cefr',
      'value',"language_evidence_json"::jsonb->'value','source',"language_evidence_kind",
      'assertedBy',"language_evidence_json"::jsonb->'assertedBy',
      'verifiedAt',"language_evidence_json"::jsonb->'verifiedAt',
      'expiresAt',"language_evidence_json"::jsonb->'expiresAt',
      'evidenceReferenceHash',"language_evidence_json"::jsonb->'evidenceReferenceHash',
      'evidenceVersion',"language_evidence_version"
    )
    AND "category_competence_evidence_json"::jsonb=jsonb_build_object(
      'key','dsa-policy-category:'||"policy_category_code",'value',true,
      'source',"category_evidence_kind",
      'assertedBy',"category_competence_evidence_json"::jsonb->'assertedBy',
      'verifiedAt',"category_competence_evidence_json"::jsonb->'verifiedAt',
      'expiresAt',"category_competence_evidence_json"::jsonb->'expiresAt',
      'evidenceReferenceHash',"category_competence_evidence_json"::jsonb->'evidenceReferenceHash',
      'evidenceVersion',"category_evidence_version"
    )
    AND ("language_evidence_json"::jsonb->>'verifiedAt')::timestamptz<="assignment_expires_at"
    AND ("category_competence_evidence_json"::jsonb->>'verifiedAt')::timestamptz<="assignment_expires_at"
    AND ("language_evidence_json"::jsonb->>'expiresAt')::timestamptz>="assignment_expires_at"
    AND ("category_competence_evidence_json"::jsonb->>'expiresAt')::timestamptz>="assignment_expires_at"
    AND "qualification_expires_at"=LEAST(
      ("language_evidence_json"::jsonb->>'expiresAt')::timestamptz,
      ("category_competence_evidence_json"::jsonb->>'expiresAt')::timestamptz
    )
    AND jsonb_typeof("conflict_declaration_json"::jsonb->'relationships')='array'
    AND "conflict_declaration_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-conflict.v1','workspaceId',"workspace_id",
      'epochId',"epoch_id",'unitId',"unit_id",'assignmentId',"assignment_id",
      'reviewerPrincipalId',"reviewer_principal_id",'hasConflict',false,
      'relationships',"conflict_declaration_json"::jsonb->'relationships',
      'declaredAt',to_char("frozen_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    AND "assignment_snapshot_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-assignment.v1','workspaceId',"workspace_id",
      'epochId',"epoch_id",'unitId',"unit_id",'assignmentId',"assignment_id",
      'reviewerPrincipalId',"reviewer_principal_id",'runId',"run_id",'caseId',"case_id",
      'mappingCommitment',"mapping_commitment",
      'acceptedAt',to_char("accepted_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt',to_char("assignment_expires_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'frozenAt',to_char("frozen_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_artifact_accesses"
  ADD CONSTRAINT "tokenless_dsa_named_panel_artifact_accesses_exact_json_check" CHECK (
    "access_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "access_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-access.v1','workspaceId',"workspace_id",
      'projectId',"project_id",'epochId',"epoch_id",'unitId',"unit_id",
      'assignmentId',"assignment_id",'reviewerPrincipalId',"reviewer_principal_id",
      'artifactId',"artifact_id",'artifactDigest',"artifact_digest",'leaseId',"lease_id",
      'accessedAt',to_char("accessed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_response_evidence"
  ADD CONSTRAINT "tokenless_dsa_named_panel_response_evidence_exact_json_check" CHECK (
    "evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "evidence_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-response-evidence.v1','workspaceId',"workspace_id",
      'epochId',"epoch_id",'unitId',"unit_id",'assignmentId',"assignment_id",
      'reviewerPrincipalId',"reviewer_principal_id",'responseId',"response_id",
      'responseDigest',"response_digest",'responseChoice',"response_choice",
      'derivedLabel',"derived_label",'accessId',"access_id",
      'accessedAt',to_char("accessed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'responseSubmittedAt',to_char("response_submitted_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_label_set_bridges"
  ADD CONSTRAINT "tokenless_dsa_named_panel_label_set_bridges_unique_json_check" CHECK (
    "bridge_json" IS JSON OBJECT WITH UNIQUE KEYS
  );--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_adjudication_artifact_leases" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "adjudicator_principal_id" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_digest" text NOT NULL,
  "lease_id" text PRIMARY KEY NOT NULL,
  "qualification_expires_at" timestamptz NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id")
    REFERENCES "tokenless_dsa_named_panel_units" ("workspace_id","epoch_id","unit_id") ON DELETE RESTRICT,
  FOREIGN KEY ("lease_id") REFERENCES "tokenless_assurance_artifact_leases" ("lease_id") ON DELETE RESTRICT,
  FOREIGN KEY ("adjudicator_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK ("artifact_digest" ~ '^sha256:[0-9a-f]{64}$' AND "qualification_expires_at">"issued_at")
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_adjudication_artifact_lease()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  IF NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
       JOIN "tokenless_assurance_artifact_leases" lease
         ON lease."lease_id"=NEW."lease_id" AND lease."workspace_id"=unit."workspace_id"
        AND lease."project_id"=unit."project_id" AND lease."artifact_id"=unit."content_artifact_id"
        AND lease."account_address"=NEW."adjudicator_principal_id"
        AND lease."purpose"='dsa_named_panel_adjudication' AND lease."assignment_id" IS NULL
        AND lease."revoked_at" IS NULL AND lease."expires_at">NEW."issued_at"
       WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
         AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
         AND unit."content_artifact_id"=NEW."artifact_id"
         AND unit."content_artifact_digest"=NEW."artifact_digest"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_adjudications" adjudication
       WHERE adjudication."workspace_id"=NEW."workspace_id" AND adjudication."epoch_id"=NEW."epoch_id"
         AND adjudication."unit_id"=NEW."unit_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
       WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
         AND outcome."unit_id"=NEW."unit_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_selections" panel
       WHERE panel."workspace_id"=NEW."workspace_id" AND panel."epoch_id"=NEW."epoch_id"
         AND panel."unit_id"=NEW."unit_id" AND panel."reviewer_principal_id"=NEW."adjudicator_principal_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_workspace_members" member
       WHERE member."workspace_id"=NEW."workspace_id" AND member."account_address"=NEW."adjudicator_principal_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_project_access_assignments" access
       WHERE access."workspace_id"=NEW."workspace_id" AND access."project_id"=NEW."project_id"
         AND access."subject_kind"='principal' AND access."subject_reference"=NEW."adjudicator_principal_id"
         AND access."status"='active' AND (access."expires_at" IS NULL OR access."expires_at">NEW."issued_at")
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_reference_definitions" definition
       WHERE definition."workspace_id"=NEW."workspace_id" AND definition."epoch_id"=NEW."epoch_id"
         AND definition."created_by"=NEW."adjudicator_principal_id"
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_workspace_reviewers" reviewer
       JOIN "tokenless_principals" principal
         ON principal."principal_id"=reviewer."principal_address" AND principal."status"='active'
       JOIN "tokenless_assurance_cohort_reviewers" cohort
         ON cohort."reviewer_account_address"=reviewer."principal_address"
        AND cohort."project_id"=NEW."project_id" AND cohort."status"='active'
       WHERE reviewer."workspace_id"=NEW."workspace_id" AND reviewer."status"='active'
         AND reviewer."principal_address"=NEW."adjudicator_principal_id"
     ) THEN
    RAISE EXCEPTION 'DSA adjudication leases require an open unit and an eligible non-panel reviewer without workspace membership'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudication_artifact_lease_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_adjudication_artifact_leases"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_adjudication_artifact_lease();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudication_artifact_leases_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_adjudication_artifact_leases"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_adjudications"
  ADD COLUMN "artifact_id" text,
  ADD COLUMN "artifact_lease_id" text,
  ADD COLUMN "artifact_access_log_id" text,
  ADD COLUMN "artifact_accessed_at" timestamptz,
  ADD COLUMN "adjudicator_label_binding" text NOT NULL,
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_artifact_lease_fk"
    FOREIGN KEY ("artifact_lease_id") REFERENCES "tokenless_assurance_artifact_leases" ("lease_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_artifact_access_log_fk"
    FOREIGN KEY ("artifact_access_log_id") REFERENCES "tokenless_assurance_access_logs" ("log_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_artifact_access_shape_check" CHECK (
    ("artifact_id" IS NULL AND "artifact_lease_id" IS NULL AND "artifact_access_log_id" IS NULL AND "artifact_accessed_at" IS NULL)
    OR ("artifact_id" IS NOT NULL AND "artifact_lease_id" IS NOT NULL AND "artifact_access_log_id" IS NOT NULL
        AND "artifact_accessed_at" IS NOT NULL AND "artifact_accessed_at"<="created_at")
  ),
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_label_binding_check" CHECK (
    "adjudicator_label_binding" ~ '^hmac-sha256:v1:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_exact_json_check" CHECK (
    "language_evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "category_competence_evidence_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "conflict_declaration_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "adjudication_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND jsonb_typeof("conflict_declaration_json"::jsonb->'relationships')='array'
    AND "conflict_declaration_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-adjudicator-conflict.v1','workspaceId',"workspace_id",
      'epochId',"epoch_id",'unitId',"unit_id",'adjudicatorPrincipalId',"adjudicator_principal_id",
      'hasConflict',false,'relationships',"conflict_declaration_json"::jsonb->'relationships',
      'declaredAt',to_char("created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    AND "adjudication_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.dsa-named-panel-adjudication.v1','workspaceId',"workspace_id",
      'epochId',"epoch_id",'unitId',"unit_id",'adjudicatorPrincipalId',"adjudicator_principal_id",
      'artifactId',"artifact_id",'artifactLeaseId',"artifact_lease_id",
      'artifactAccessLogId',"artifact_access_log_id",
      'artifactAccessedAt',to_char("artifact_accessed_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'referenceLabel',"reference_label",'rationaleDigest',"rationale_digest",
      'createdAt',to_char("created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_reference_label_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
       WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
         AND outcome."unit_id"=NEW."unit_id" AND outcome."agreement_state"='adjudicated'
     ) AND NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
       JOIN "tokenless_dsa_named_panel_adjudications" adjudication
         ON adjudication."workspace_id"=outcome."workspace_id"
        AND adjudication."epoch_id"=outcome."epoch_id" AND adjudication."unit_id"=outcome."unit_id"
        AND adjudication."adjudication_id"=outcome."adjudication_id"
       WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
         AND outcome."unit_id"=NEW."unit_id"
         AND NEW."agreement_state"='adjudicated'
         AND NEW."adjudicated_by"=adjudication."adjudicator_label_binding"
     ) THEN
    RAISE EXCEPTION 'DSA reference label does not preserve its frozen adjudicator binding'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_reference_label_binding_guard
BEFORE INSERT ON "tokenless_dsa_reference_labels"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_reference_label_binding();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_adjudicator_artifact_access()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  IF NEW."artifact_id" IS NULL OR NEW."artifact_lease_id" IS NULL
     OR NEW."artifact_access_log_id" IS NULL OR NEW."artifact_accessed_at" IS NULL OR NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_adjudication_artifact_leases" marker
       JOIN "tokenless_assurance_artifact_leases" lease
         ON lease."lease_id"=marker."lease_id" AND lease."workspace_id"=marker."workspace_id"
        AND lease."project_id"=marker."project_id" AND lease."artifact_id"=marker."artifact_id"
        AND lease."account_address"=marker."adjudicator_principal_id"
        AND lease."purpose"='dsa_named_panel_adjudication'
       JOIN "tokenless_assurance_access_logs" log
         ON log."log_id"=NEW."artifact_access_log_id" AND log."workspace_id"=marker."workspace_id"
        AND log."project_id"=marker."project_id" AND log."artifact_id"=marker."artifact_id"
        AND log."lease_id"=marker."lease_id" AND log."actor_kind"='principal'
        AND log."action"='read' AND log."purpose"='dsa_named_panel_adjudication'
        AND log."occurred_at"=NEW."artifact_accessed_at" AND log."occurred_at">=marker."issued_at"
        AND log."occurred_at">=lease."created_at" AND log."occurred_at"<lease."expires_at"
        AND (lease."revoked_at" IS NULL OR log."occurred_at"<lease."revoked_at")
        AND log."occurred_at"<=NEW."created_at"
       WHERE marker."workspace_id"=NEW."workspace_id" AND marker."project_id"=NEW."project_id"
         AND marker."epoch_id"=NEW."epoch_id" AND marker."unit_id"=NEW."unit_id"
         AND marker."adjudicator_principal_id"=NEW."adjudicator_principal_id"
         AND marker."artifact_id"=NEW."artifact_id" AND marker."lease_id"=NEW."artifact_lease_id"
         AND marker."qualification_expires_at">=NEW."created_at"
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
       WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
         AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
         AND NEW."language_evidence_json"::jsonb=jsonb_build_object(
           'key','language:'||lower(unit."language_tag")||':reading:cefr',
           'value',NEW."language_evidence_json"::jsonb->'value',
           'source',NEW."language_evidence_json"::jsonb->'source',
           'assertedBy',NEW."language_evidence_json"::jsonb->'assertedBy',
           'verifiedAt',NEW."language_evidence_json"::jsonb->'verifiedAt',
           'expiresAt',NEW."language_evidence_json"::jsonb->'expiresAt',
           'evidenceReferenceHash',NEW."language_evidence_json"::jsonb->'evidenceReferenceHash',
           'evidenceVersion',NEW."language_evidence_json"::jsonb->'evidenceVersion')
         AND CASE unit."required_cefr_level"
               WHEN 'B2' THEN NEW."language_evidence_json"::jsonb->>'value' IN ('B2','C1','C2')
               WHEN 'C1' THEN NEW."language_evidence_json"::jsonb->>'value' IN ('C1','C2')
               WHEN 'C2' THEN NEW."language_evidence_json"::jsonb->>'value'='C2'
               ELSE false END
         AND NEW."category_competence_evidence_json"::jsonb=jsonb_build_object(
           'key','dsa-policy-category:'||unit."policy_category_code",'value',true,
           'source',NEW."category_competence_evidence_json"::jsonb->'source',
           'assertedBy',NEW."category_competence_evidence_json"::jsonb->'assertedBy',
           'verifiedAt',NEW."category_competence_evidence_json"::jsonb->'verifiedAt',
           'expiresAt',NEW."category_competence_evidence_json"::jsonb->'expiresAt',
           'evidenceReferenceHash',NEW."category_competence_evidence_json"::jsonb->'evidenceReferenceHash',
           'evidenceVersion',NEW."category_competence_evidence_json"::jsonb->'evidenceVersion')
         AND NEW."language_evidence_json"::jsonb->>'source'<>''
         AND NEW."language_evidence_json"::jsonb->>'assertedBy'<>''
         AND NEW."language_evidence_json"::jsonb->>'evidenceVersion'<>''
         AND NEW."language_evidence_json"::jsonb->>'evidenceReferenceHash' ~ '^sha256:[0-9a-f]{64}$'
         AND NEW."category_competence_evidence_json"::jsonb->>'source'<>''
         AND NEW."category_competence_evidence_json"::jsonb->>'assertedBy'<>''
         AND NEW."category_competence_evidence_json"::jsonb->>'evidenceVersion'<>''
         AND NEW."category_competence_evidence_json"::jsonb->>'evidenceReferenceHash' ~ '^sha256:[0-9a-f]{64}$'
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_unit_outcomes" outcome
       WHERE outcome."workspace_id"=NEW."workspace_id" AND outcome."epoch_id"=NEW."epoch_id"
         AND outcome."unit_id"=NEW."unit_id"
     ) THEN
    RAISE EXCEPTION 'DSA adjudication requires prior access to the exact artifact under its purpose-bound lease'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_adjudicator_artifact_access_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_adjudications"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_adjudicator_artifact_access();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_dsa_named_panel_unit_for_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "tokenless_dsa_named_panel_units" unit
   WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id"
     AND unit."epoch_id"=NEW."epoch_id" AND unit."unit_id"=NEW."unit_id"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DSA named-panel terminal outcome requires its exact unit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_outcome_unit_lock
BEFORE INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_dsa_named_panel_unit_for_terminal();--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_unit_gaps" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "gap_evidence_id" text NOT NULL,
  "gap_reason" text NOT NULL,
  "reference_definition_version" integer NOT NULL,
  "reference_definition_hash" text NOT NULL,
  "reference_definition_question" text NOT NULL,
  "required_reviewer_count" integer NOT NULL,
  "assignment_count" integer NOT NULL,
  "accepted_assignment_count" integer NOT NULL,
  "response_count" integer NOT NULL,
  "access_count" integer NOT NULL,
  "assignment_deadline" timestamptz NOT NULL,
  "partial_response_root" text NOT NULL,
  "authority_kind" text NOT NULL,
  "auditor_access_assignment_id" text NOT NULL,
  "gap_json" text NOT NULL,
  "gap_hash" text NOT NULL,
  "declared_by" text NOT NULL,
  "declared_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  UNIQUE ("gap_evidence_id"),
  UNIQUE ("workspace_id","epoch_id","unit_id","gap_evidence_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","epoch_id","reference_definition_version","reference_definition_hash",
               "reference_definition_question")
    REFERENCES "tokenless_dsa_named_panel_reference_definitions"
      ("workspace_id","epoch_id","version","definition_hash","question") ON DELETE RESTRICT,
  FOREIGN KEY ("auditor_access_assignment_id")
    REFERENCES "tokenless_project_access_assignments" ("assignment_id") ON DELETE RESTRICT,
  FOREIGN KEY ("declared_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK (
    "gap_reason"='reviewer_nonresponse'
    AND "required_reviewer_count" BETWEEN 2 AND 20
    AND "assignment_count"="required_reviewer_count"
    AND "accepted_assignment_count" BETWEEN 0 AND "required_reviewer_count"
    AND "response_count" BETWEEN 0 AND "required_reviewer_count"
    AND "access_count" BETWEEN 0 AND "required_reviewer_count"
    AND "response_count"<"required_reviewer_count"
    AND "assignment_deadline"<"declared_at"
    AND "partial_response_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "authority_kind"='project_auditor_without_workspace_membership'
    AND "gap_hash"='sha256:'||encode(digest(convert_to("gap_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_unit_gap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exact_assignment_count integer; exact_reviewer_count integer; exact_accepted_count integer;
        exact_response_count integer;
        exact_access_count integer; exact_deadline timestamptz; exact_response_root text;
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
  exact_response_root:=tokenless_dsa_named_panel_response_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id);
  IF exact_assignment_count<>NEW.assignment_count OR exact_reviewer_count<>NEW.assignment_count
     OR exact_accepted_count<>NEW.accepted_assignment_count
     OR exact_response_count<>NEW.response_count OR exact_access_count<>NEW.access_count
     OR exact_deadline<>NEW.assignment_deadline OR NEW.partial_response_root<>exact_response_root
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
     ) OR NEW.gap_json IS NOT JSON OBJECT WITH UNIQUE KEYS
     OR NEW.gap_json::jsonb<>jsonb_build_object(
       'schemaVersion','rateloop.dsa-named-panel-unit-gap.v1','workspaceId',NEW.workspace_id,
       'projectId',NEW.project_id,'epochId',NEW.epoch_id,'unitId',NEW.unit_id,
       'gapEvidenceId',NEW.gap_evidence_id,'reason',NEW.gap_reason,
       'referenceDefinitionVersion',NEW.reference_definition_version,
       'referenceDefinitionHash',NEW.reference_definition_hash,
       'referenceDefinitionQuestion',NEW.reference_definition_question,
       'requiredReviewerCount',NEW.required_reviewer_count,'assignmentCount',NEW.assignment_count,
       'acceptedAssignmentCount',NEW.accepted_assignment_count,
       'responseCount',NEW.response_count,'accessCount',NEW.access_count,
       'assignmentDeadline',to_char(NEW.assignment_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'partialResponseRoot',NEW.partial_response_root,'authorityKind',NEW.authority_kind,
       'auditorAccessAssignmentId',NEW.auditor_access_assignment_id,'declaredBy',NEW.declared_by,
       'declaredAt',to_char(NEW.declared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RAISE EXCEPTION 'DSA sampled-unit gap does not reproduce exact expired-panel evidence or auditor authority'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_unit_gap_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_unit_gaps"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_unit_gap();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_unit_gaps_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_unit_gaps"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_unit_outcomes"
  DROP CONSTRAINT "tokenless_dsa_named_panel_unit_outcomes_check",
  ADD COLUMN "gap_evidence_id" text,
  ADD CONSTRAINT "tokenless_dsa_named_panel_unit_outcomes_gap_fk"
    FOREIGN KEY ("workspace_id","epoch_id","unit_id","gap_evidence_id")
    REFERENCES "tokenless_dsa_named_panel_unit_gaps"
      ("workspace_id","epoch_id","unit_id","gap_evidence_id") ON DELETE RESTRICT,
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
          AND "gap_evidence_id" IS NOT NULL AND "response_count"<"required_reviewer_count"))
    AND "response_evidence_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "outcome_hash"='sha256:'||encode(digest(convert_to("outcome_json",'UTF8'),'sha256'),'hex')
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_outcome_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_count integer; response_count integer; access_count integer; reviewer_count integer;
        distinct_label_count integer; agreed_label text; adjudication_label text; adjudicator text;
        gap_hash text; gap_response_count integer; gap_response_root text; recomputed_response_root text;
BEGIN
  SELECT count(*),count(DISTINCT reviewer_principal_id) INTO assignment_count,reviewer_count
    FROM tokenless_dsa_named_panel_selections
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(*) INTO response_count FROM tokenless_dsa_named_panel_response_evidence
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(DISTINCT assignment_id) INTO access_count FROM tokenless_dsa_named_panel_artifact_accesses
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT count(DISTINCT derived_label),min(derived_label) INTO distinct_label_count,agreed_label
    FROM tokenless_dsa_named_panel_response_evidence
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT reference_label,adjudicator_principal_id INTO adjudication_label,adjudicator
    FROM tokenless_dsa_named_panel_adjudications
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND unit_id=NEW.unit_id;
  SELECT gap.gap_hash,gap.response_count,gap.partial_response_root
    INTO gap_hash,gap_response_count,gap_response_root
    FROM tokenless_dsa_named_panel_unit_gaps gap
   WHERE gap.workspace_id=NEW.workspace_id AND gap.epoch_id=NEW.epoch_id AND gap.unit_id=NEW.unit_id
     AND gap.gap_evidence_id=NEW.gap_evidence_id;
  recomputed_response_root:=tokenless_dsa_named_panel_response_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id);
  IF assignment_count<>NEW.required_reviewer_count OR reviewer_count<>NEW.required_reviewer_count
     OR response_count<>NEW.response_count OR NEW.response_evidence_root<>recomputed_response_root THEN
    RAISE EXCEPTION 'DSA named panel does not have exact assignment and response coverage' USING ERRCODE='23514';
  END IF;
  IF (NEW.agreement_state<>'gap' AND access_count<>NEW.required_reviewer_count)
     OR (NEW.agreement_state='agreed' AND (distinct_label_count<>1 OR agreed_label<>NEW.reference_label))
     OR (NEW.agreement_state='adjudicated' AND (distinct_label_count<2 OR adjudication_label<>NEW.reference_label
       OR EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_selections assignment
                   WHERE assignment.workspace_id=NEW.workspace_id AND assignment.epoch_id=NEW.epoch_id
                     AND assignment.unit_id=NEW.unit_id AND assignment.reviewer_principal_id=adjudicator)))
     OR (NEW.agreement_state='gap' AND (gap_hash IS NULL OR gap_hash<>NEW.adjudication_evidence_digest
         OR gap_response_count<>NEW.response_count OR gap_response_root<>NEW.response_evidence_root))
     OR NEW.outcome_json IS NOT JSON OBJECT WITH UNIQUE KEYS
     OR NEW.outcome_json::jsonb<>jsonb_build_object(
       'schemaVersion','rateloop.dsa-named-panel-outcome.v1','workspaceId',NEW.workspace_id,
       'epochId',NEW.epoch_id,'unitId',NEW.unit_id,'requiredReviewerCount',NEW.required_reviewer_count,
       'responseCount',NEW.response_count,'referenceLabel',NEW.reference_label,'agreementState',NEW.agreement_state,
       'adjudicationId',NEW.adjudication_id,'gapEvidenceId',NEW.gap_evidence_id,
       'responseEvidenceRoot',NEW.response_evidence_root,
       'adjudicationEvidenceDigest',NEW.adjudication_evidence_digest,'frozenBy',NEW.frozen_by,
       'frozenAt',to_char(NEW.frozen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RAISE EXCEPTION 'DSA named-panel outcome does not reproduce exact response, adjudication, or gap evidence'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_gap_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_named_panel_unit_outcomes outcome
    WHERE outcome.workspace_id=NEW.workspace_id AND outcome.epoch_id=NEW.epoch_id AND outcome.unit_id=NEW.unit_id
      AND outcome.gap_evidence_id=NEW.gap_evidence_id AND outcome.agreement_state='gap'
      AND outcome.reference_label='uncertain' AND outcome.adjudication_evidence_digest=NEW.gap_hash
      AND outcome.response_count=NEW.response_count AND outcome.response_evidence_root=NEW.partial_response_root
  ) THEN
    RAISE EXCEPTION 'DSA sampled-unit gap must reach its exact uncertain terminal outcome'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_gap_terminal_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_unit_gaps"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_gap_terminal();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_labels"
  DROP CONSTRAINT "tokenless_dsa_reference_labels_contract_check",
  ADD COLUMN "gap_reason" text,
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
          AND "adjudicated_by" IS NULL AND "gap_reason"='reviewer_nonresponse'))
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_hash" ~ '^sha256:[0-9a-f]{64}$'
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_reference_label_set_complete_at_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_count integer; label_count integer; pass_count integer; fail_count integer;
        uncertain_count integer; gap_count integer;
BEGIN
  SELECT count(*) INTO selected_count FROM tokenless_dsa_reference_sample_manifest
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND selected=true;
  SELECT count(*),count(*) FILTER (WHERE reference_label='pass'),count(*) FILTER (WHERE reference_label='fail'),
         count(*) FILTER (WHERE reference_label='uncertain'),count(*) FILTER (WHERE agreement_state='gap')
    INTO label_count,pass_count,fail_count,uncertain_count,gap_count
    FROM tokenless_dsa_reference_labels
   WHERE workspace_id=NEW.workspace_id AND label_set_id=NEW.label_set_id;
  IF selected_count<>NEW.expected_selected_count OR label_count<>NEW.expected_selected_count
     OR pass_count<>NEW.pass_label_count OR fail_count<>NEW.fail_label_count
     OR uncertain_count<>NEW.uncertain_label_count
     OR (gap_count>0 AND NEW.coverage_gap<>'uncertain_reference_labels') THEN
    RAISE EXCEPTION 'DSA reference label set does not exactly cover its selected manifest and sampled gaps'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_reference_definition_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM "tokenless_workspace_members" member
       WHERE member."workspace_id"=NEW."workspace_id" AND member."account_address"=NEW."created_by"
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_project_access_assignments" access
       WHERE access."assignment_id"=NEW."auditor_access_assignment_id"
         AND access."workspace_id"=NEW."workspace_id" AND access."project_id"=NEW."project_id"
         AND access."subject_kind"='principal' AND access."subject_reference"=NEW."created_by"
         AND access."role"='auditor' AND access."status"='active'
         AND (access."expires_at" IS NULL OR access."expires_at">NEW."created_at")
     ) THEN
    RAISE EXCEPTION 'DSA reference definitions require an active project auditor without workspace membership'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_reference_definition_authority_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_reference_definitions"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_reference_definition_authority();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_reference_definitions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_reference_definitions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_label_sets"
  ALTER COLUMN "derivation_source" DROP DEFAULT;--> statement-breakpoint

CREATE TABLE "tokenless_dsa_reference_label_set_quarantines" (
  "workspace_id" text NOT NULL,
  "label_set_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "label_root" text NOT NULL,
  "label_set_hash" text NOT NULL,
  "reason" text NOT NULL,
  "quarantined_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","label_set_id"),
  FOREIGN KEY ("workspace_id","label_set_id","epoch_id","label_root","label_set_hash")
    REFERENCES "tokenless_dsa_reference_label_sets"
      ("workspace_id","label_set_id","epoch_id","label_root","set_hash") ON DELETE RESTRICT,
  CHECK ("reason"='legacy_pre_0182_unverified')
);--> statement-breakpoint

INSERT INTO "tokenless_dsa_reference_label_set_quarantines"
  ("workspace_id","label_set_id","epoch_id","label_root","label_set_hash","reason")
SELECT labels."workspace_id",labels."label_set_id",labels."epoch_id",labels."label_root",labels."set_hash",
       'legacy_pre_0182_unverified'
FROM "tokenless_dsa_reference_label_sets" labels
WHERE labels."derivation_source"='independent_reference_panel';--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_reference_label_set_quarantines_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_label_set_quarantines"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_quarantine_consumption()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_reference_label_set_quarantines" quarantine
    WHERE quarantine."workspace_id"=NEW."workspace_id" AND quarantine."label_set_id"=NEW."label_set_id"
  ) THEN
    RAISE EXCEPTION 'Quarantined DSA reference labels cannot receive or consume a named-panel bridge'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_bridge_quarantine_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_label_set_bridges"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_quarantine_consumption();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_reference_definition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."derivation_source"<>'independent_reference_panel' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_reference_definitions" definition
       WHERE definition."workspace_id"=NEW."workspace_id" AND definition."epoch_id"=NEW."epoch_id"
         AND definition."version"::text=NEW."reference_definition_version"
         AND definition."definition_hash"=NEW."reference_definition_hash"
     ) OR NOT EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
       WHERE unit."workspace_id"=NEW."workspace_id" AND unit."epoch_id"=NEW."epoch_id"
     ) OR EXISTS (
       SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
       WHERE unit."workspace_id"=NEW."workspace_id" AND unit."epoch_id"=NEW."epoch_id"
         AND (unit."blinded_payload_json"::jsonb#>>'{policy,policyVersion}'<>NEW."reference_definition_version"
           OR unit."blinded_payload_json"::jsonb#>>'{policy,policyHash}'<>NEW."reference_definition_hash")
     ) THEN
    RAISE EXCEPTION 'Independent reference labels require one exact named-panel reference definition'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_reference_definition_at_commit
AFTER INSERT ON "tokenless_dsa_reference_label_sets"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_reference_definition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_reviewer_independence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_named_panel_units" unit
    WHERE unit."workspace_id"=NEW."workspace_id" AND unit."project_id"=NEW."project_id" AND unit."run_id"=NEW."run_id"
  ) THEN
    IF NEW."source"<>'customer_invited' OR NEW."selection"<>'customer_named'
       OR NEW."reviewer_account_address" IS NULL
       OR EXISTS (
         SELECT 1 FROM "tokenless_workspace_members" member
         WHERE member."workspace_id"=NEW."workspace_id"
           AND member."account_address"=NEW."reviewer_account_address"
       ) OR EXISTS (
         SELECT 1 FROM "tokenless_project_access_assignments" access
         WHERE access."workspace_id"=NEW."workspace_id" AND access."project_id"=NEW."project_id"
           AND access."subject_kind"='principal' AND access."subject_reference"=NEW."reviewer_account_address"
           AND access."status"='active'
           AND (access."expires_at" IS NULL OR access."expires_at">transaction_timestamp())
       ) OR EXISTS (
         SELECT 1 FROM "tokenless_dsa_named_panel_units" authored_unit
         JOIN "tokenless_dsa_named_panel_reference_definitions" definition
           ON definition."workspace_id"=authored_unit."workspace_id"
          AND definition."epoch_id"=authored_unit."epoch_id"
         WHERE authored_unit."workspace_id"=NEW."workspace_id"
           AND authored_unit."project_id"=NEW."project_id"
           AND authored_unit."run_id"=NEW."run_id"
           AND definition."created_by"=NEW."reviewer_account_address"
       ) THEN
      RAISE EXCEPTION 'DSA named-panel reviewers must be invited without workspace or project authority'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_reviewer_independence_guard
BEFORE INSERT OR UPDATE OF "workspace_id","project_id","run_id","source","selection","reviewer_account_address"
ON "tokenless_assurance_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_reviewer_independence();--> statement-breakpoint

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

CREATE TRIGGER tokenless_dsa_named_panel_workspace_authority_grant_guard
BEFORE INSERT OR UPDATE OF "workspace_id","account_address","role" ON "tokenless_workspace_members"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_live_authority_grant();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_project_authority_grant_guard
BEFORE INSERT OR UPDATE OF "workspace_id","project_id","subject_kind","subject_reference","role","status","expires_at"
ON "tokenless_project_access_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_live_authority_grant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_part8_independent_reference_panel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."label_set_id" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "tokenless_dsa_reference_label_sets" labels
    JOIN "tokenless_dsa_named_panel_label_set_bridges" bridge
      ON bridge."workspace_id"=labels."workspace_id" AND bridge."label_set_id"=labels."label_set_id"
     AND bridge."epoch_id"=labels."epoch_id" AND bridge."label_root"=labels."label_root"
     AND bridge."label_set_hash"=labels."set_hash"
    LEFT JOIN "tokenless_dsa_reference_label_set_quarantines" quarantine
      ON quarantine."workspace_id"=labels."workspace_id" AND quarantine."label_set_id"=labels."label_set_id"
    WHERE labels."workspace_id"=NEW."workspace_id" AND labels."label_set_id"=NEW."label_set_id"
      AND labels."epoch_id"=NEW."epoch_id" AND labels."label_root"=NEW."label_root"
      AND labels."set_hash"=NEW."label_set_hash"
      AND labels."derivation_source"='independent_reference_panel'
      AND quarantine."label_set_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Part 8 inferential accuracy requires an exact named-panel reference bridge'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_research_export_quarantine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reference_derivation_source"='independent_reference_panel' AND EXISTS (
    SELECT 1 FROM "tokenless_dsa_reference_label_set_quarantines" quarantine
    WHERE quarantine."workspace_id"=NEW."workspace_id" AND quarantine."label_set_id"=NEW."label_set_id"
  ) THEN
    RAISE EXCEPTION 'Quarantined DSA reference labels cannot be consumed by research exports'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_research_export_quarantine_guard
BEFORE INSERT ON "tokenless_benchmark_research_approved_exports"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_research_export_quarantine();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_research_grant_quarantine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tokenless_benchmark_research_approved_exports" export
    JOIN "tokenless_dsa_reference_label_set_quarantines" quarantine
      ON quarantine."workspace_id"=export."workspace_id" AND quarantine."label_set_id"=export."label_set_id"
    WHERE export."workspace_id"=NEW."workspace_id" AND export."export_id"=NEW."export_id"
      AND export."reference_derivation_source"='independent_reference_panel'
  ) THEN
    RAISE EXCEPTION 'Quarantined DSA reference labels cannot be consumed by research grants'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_research_grant_quarantine_guard
BEFORE INSERT ON "tokenless_benchmark_research_grants"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_research_grant_quarantine();

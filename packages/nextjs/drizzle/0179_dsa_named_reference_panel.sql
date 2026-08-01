ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_dsa_named_exact_unique"
  UNIQUE ("workspace_id","project_id","run_id","assignment_id","reviewer_account_address","source");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_artifacts"
  ADD CONSTRAINT "tokenless_assurance_artifacts_dsa_named_exact_unique"
  UNIQUE ("project_id","artifact_id","digest","content_type");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_artifact_leases"
  ADD CONSTRAINT "tokenless_assurance_artifact_leases_dsa_named_exact_unique"
  UNIQUE ("lease_id","artifact_id","workspace_id","project_id","account_address","assignment_id","expires_at");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD CONSTRAINT "tokenless_dsa_reference_label_sets_named_bridge_exact_unique"
  UNIQUE ("workspace_id","label_set_id","epoch_id","label_root","set_hash");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_sampling_epochs"
  ADD CONSTRAINT "tokenless_dsa_reference_epochs_named_mapping_exact_unique"
  UNIQUE ("workspace_id","epoch_id","population_id","population_version","frame_id");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_sample_manifest"
  ADD CONSTRAINT "tokenless_dsa_reference_manifest_named_mapping_exact_unique"
  UNIQUE ("workspace_id","epoch_id","unit_id","selected","source_decision_binding","source_evaluation_binding",
          "source_evaluation_hash","system_identity","automated_outcome","manifest_row_hash","selection_rank");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_responses"
  ADD CONSTRAINT "tokenless_assurance_responses_dsa_named_time_exact_unique"
  UNIQUE ("response_id","run_id","case_id","reviewer_key","reviewer_source","response_digest","validity","submitted_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_reject_dsa_named_panel_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DSA named-panel evidence is append-only' USING ERRCODE='55000';
END;
$$;--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_units" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "frame_id" text NOT NULL,
  "selection_rank" integer NOT NULL,
  "evaluation_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "manifest_selected" boolean NOT NULL,
  "source_decision_binding" text NOT NULL,
  "source_evaluation_binding" text NOT NULL,
  "source_evaluation_hash" text NOT NULL,
  "system_identity" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "evaluation_hash" text NOT NULL,
  "evaluation_projection_hash" text NOT NULL,
  "manifest_row_hash" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "baseline_artifact_id" text NOT NULL,
  "candidate_artifact_id" text NOT NULL,
  "variant_a_artifact_id" text NOT NULL,
  "variant_b_artifact_id" text NOT NULL,
  "blinding_commitment" text NOT NULL,
  "blinded_case_id" text NOT NULL,
  "blinded_payload_json" text NOT NULL,
  "blinded_payload_hash" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "withheld_snapshot_digest" text NOT NULL,
  "content_artifact_id" text NOT NULL,
  "content_artifact_digest" text NOT NULL,
  "content_type" text NOT NULL,
  "language_tag" text NOT NULL,
  "policy_category_code" text NOT NULL,
  "required_cefr_level" text NOT NULL,
  "required_reviewer_count" integer NOT NULL,
  "unit_json" text NOT NULL,
  "unit_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  UNIQUE ("workspace_id","epoch_id","evaluation_id"),
  UNIQUE ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment"),
  UNIQUE ("workspace_id","project_id","epoch_id","unit_id","content_artifact_id","content_artifact_digest"),
  FOREIGN KEY ("workspace_id","project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id","project_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","epoch_id","population_id","population_version","frame_id")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id","epoch_id","population_id","population_version","frame_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","manifest_selected","source_decision_binding",
               "source_evaluation_binding","source_evaluation_hash","system_identity","automated_outcome","manifest_row_hash","selection_rank")
    REFERENCES "tokenless_dsa_reference_sample_manifest"
      ("workspace_id","epoch_id","unit_id","selected","source_decision_binding",
       "source_evaluation_binding","source_evaluation_hash","system_identity","automated_outcome","manifest_row_hash","selection_rank")
    ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","epoch_id","evaluation_id","unit_id","provider_decision_id","decision_version",
               "source_decision_binding","source_evaluation_binding","source_evaluation_hash","system_identity",
               "system_id","system_version","automated_outcome","evaluation_hash","evaluation_projection_hash")
    REFERENCES "tokenless_dsa_reference_evaluation_projections"
      ("workspace_id","epoch_id","evaluation_id","unit_id","provider_decision_id","decision_version",
       "source_decision_binding","source_evaluation_binding","source_evaluation_hash","system_identity",
       "system_id","system_version","automated_outcome","evaluation_hash","projection_hash") ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","case_id","baseline_artifact_id","candidate_artifact_id")
    REFERENCES "tokenless_assurance_cases" ("project_id","case_id","baseline_artifact_id","candidate_artifact_id")
    ON DELETE RESTRICT,
  FOREIGN KEY ("run_id","case_id","variant_a_artifact_id","variant_b_artifact_id","blinding_commitment")
    REFERENCES "tokenless_assurance_run_cases"
      ("run_id","case_id","variant_a_artifact_id","variant_b_artifact_id","blinding_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("project_id","content_artifact_id","content_artifact_digest","content_type")
    REFERENCES "tokenless_assurance_artifacts" ("project_id","artifact_id","digest","content_type") ON DELETE RESTRICT,
  FOREIGN KEY ("created_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK (
    "manifest_selected"=true AND "selection_rank">0 AND "population_version">0 AND "evaluation_hash"="source_evaluation_hash"
    AND "automated_outcome" IN ('pass','fail')
    AND "blinded_case_id" ~ '^dsa_case_[a-z0-9]{16,80}$'
    AND "blinded_payload_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "blinded_payload_hash"='sha256:'||encode(digest(convert_to("blinded_payload_json",'UTF8'),'sha256'),'hex')
    AND "mapping_commitment"="blinded_payload_hash"
    AND "withheld_snapshot_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "content_artifact_id"="candidate_artifact_id"
    AND "blinded_payload_json"::jsonb#>>'{content,artifactId}'="content_artifact_id"
    AND "blinded_payload_json"::jsonb#>>'{content,contentHash}'="content_artifact_digest"
    AND "blinded_payload_json"::jsonb#>>'{content,contentType}'="content_type"
    AND "blinded_payload_json"::jsonb#>>'{content,language}'="language_tag"
    AND "blinded_payload_json"::jsonb#>>'{policy,categoryCode}'="policy_category_code"
    AND "blinded_payload_json"::jsonb#>>'{reference,populationId}'="population_id"
    AND "blinded_payload_json"::jsonb#>>'{reference,populationVersion}'="population_version"::text
    AND "blinded_payload_json"::jsonb#>>'{reference,frameId}'="frame_id"
    AND "blinded_payload_json"::jsonb#>>'{reference,sampleId}'="epoch_id"
    AND "blinded_payload_json"::jsonb#>>'{reference,sampleVersion}'='1'
    AND "blinded_payload_json"::jsonb#>>'{reference,position}'="selection_rank"::text
    AND "required_cefr_level" IN ('B2','C1','C2')
    AND "required_reviewer_count" BETWEEN 2 AND 20
    AND "unit_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "unit_hash"='sha256:'||encode(digest(convert_to("unit_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_registered_before_delivery()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM tokenless_assurance_run_cases run_case WHERE run_case.run_id=NEW.run_id)<>1
     OR EXISTS (SELECT 1 FROM tokenless_assurance_assignments assignment WHERE assignment.run_id=NEW.run_id)
     OR EXISTS (SELECT 1 FROM tokenless_assurance_responses response
                WHERE response.run_id=NEW.run_id AND response.case_id=NEW.case_id) THEN
    RAISE EXCEPTION 'DSA named-panel unit must be registered before reviewer delivery evidence exists'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_registered_before_delivery_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_units"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_registered_before_delivery();--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_assignments" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "language_tag" text NOT NULL,
  "required_language_activity" text NOT NULL,
  "required_cefr_level" text NOT NULL,
  "language_evidence_kind" text NOT NULL,
  "language_evidence_version" text NOT NULL,
  "language_evidence_json" text NOT NULL,
  "language_evidence_hash" text NOT NULL,
  "policy_category_code" text NOT NULL,
  "category_evidence_kind" text NOT NULL,
  "category_evidence_version" text NOT NULL,
  "category_competence_evidence_json" text NOT NULL,
  "category_competence_evidence_hash" text NOT NULL,
  "conflict_declaration_json" text NOT NULL,
  "conflict_declaration_hash" text NOT NULL,
  "conflict_status" text NOT NULL,
  "qualification_expires_at" timestamptz NOT NULL,
  "assignment_snapshot_json" text NOT NULL,
  "assignment_snapshot_hash" text NOT NULL,
  "accepted_at" timestamptz NOT NULL,
  "assignment_expires_at" timestamptz NOT NULL,
  "frozen_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id"),
  UNIQUE ("workspace_id","epoch_id","unit_id","reviewer_principal_id"),
  UNIQUE ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","project_id","run_id","assignment_id","reviewer_principal_id","reviewer_source")
    REFERENCES "tokenless_assurance_assignments"
      ("workspace_id","project_id","run_id","assignment_id","reviewer_account_address","source") ON DELETE RESTRICT,
  FOREIGN KEY ("reviewer_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK (
    "reviewer_source"='customer_invited' AND "conflict_status"='cleared'
    AND "required_language_activity"='reading'
    AND "required_cefr_level" IN ('B2','C1','C2')
    AND char_length("language_evidence_kind") BETWEEN 1 AND 80
    AND char_length("language_evidence_version") BETWEEN 1 AND 80
    AND char_length("category_evidence_kind") BETWEEN 1 AND 80
    AND char_length("category_evidence_version") BETWEEN 1 AND 80
    AND "language_evidence_hash"='sha256:'||encode(digest(convert_to("language_evidence_json",'UTF8'),'sha256'),'hex')
    AND "category_competence_evidence_hash"='sha256:'||encode(digest(convert_to("category_competence_evidence_json",'UTF8'),'sha256'),'hex')
    AND "conflict_declaration_hash"='sha256:'||encode(digest(convert_to("conflict_declaration_json",'UTF8'),'sha256'),'hex')
    AND "assignment_snapshot_hash"='sha256:'||encode(digest(convert_to("assignment_snapshot_json",'UTF8'),'sha256'),'hex')
    AND "accepted_at"<="frozen_at" AND "frozen_at"<"assignment_expires_at"
    AND "qualification_expires_at">="assignment_expires_at"
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_artifact_accesses" (
  "access_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_digest" text NOT NULL,
  "lease_id" text NOT NULL,
  "lease_expires_at" timestamptz NOT NULL,
  "lease_revoked_at" timestamptz,
  "access_json" text NOT NULL,
  "access_hash" text NOT NULL,
  "accessed_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE ("assignment_id","access_id"),
  UNIQUE ("assignment_id","access_id","accessed_at"),
  FOREIGN KEY ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id")
    REFERENCES "tokenless_dsa_named_panel_assignments"
      ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id") ON DELETE RESTRICT,
  FOREIGN KEY ("lease_id","artifact_id","workspace_id","project_id","reviewer_principal_id","assignment_id","lease_expires_at")
    REFERENCES "tokenless_assurance_artifact_leases"
      ("lease_id","artifact_id","workspace_id","project_id","account_address","assignment_id","expires_at") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id","project_id","epoch_id","unit_id","artifact_id","artifact_digest")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","project_id","epoch_id","unit_id","content_artifact_id","content_artifact_digest") ON DELETE RESTRICT,
  CHECK ("lease_revoked_at" IS NULL AND "lease_expires_at">"accessed_at"
    AND "access_hash"='sha256:'||encode(digest(convert_to("access_json",'UTF8'),'sha256'),'hex'))
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_response_evidence" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "response_id" text NOT NULL,
  "reviewer_key" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "response_digest" text NOT NULL,
  "response_validity" text NOT NULL,
  "response_choice" text NOT NULL,
  "derived_label" text NOT NULL,
  "access_id" text NOT NULL,
  "accessed_at" timestamptz NOT NULL,
  "response_submitted_at" timestamptz NOT NULL,
  "evidence_json" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "observed_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id"),
  UNIQUE ("workspace_id","epoch_id","unit_id","response_id"),
  FOREIGN KEY ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id")
    REFERENCES "tokenless_dsa_named_panel_assignments"
      ("assignment_id","workspace_id","epoch_id","unit_id","reviewer_principal_id") ON DELETE RESTRICT,
  FOREIGN KEY ("response_id","run_id","case_id","reviewer_key","reviewer_source","response_digest","response_validity","response_submitted_at")
    REFERENCES "tokenless_assurance_responses"
      ("response_id","run_id","case_id","reviewer_key","reviewer_source","response_digest","validity","submitted_at") ON DELETE RESTRICT,
  FOREIGN KEY ("assignment_id","access_id","accessed_at")
    REFERENCES "tokenless_dsa_named_panel_artifact_accesses" ("assignment_id","access_id","accessed_at") ON DELETE RESTRICT,
  CHECK ("reviewer_source"='customer_invited' AND "response_validity"='valid'
    AND "response_choice" IN ('baseline','candidate') AND "derived_label" IN ('pass','fail')
    AND (("response_choice"='candidate' AND "derived_label"='pass')
      OR ("response_choice"='baseline' AND "derived_label"='fail'))
    AND "accessed_at"<="response_submitted_at" AND "response_submitted_at"<="observed_at"
    AND "evidence_hash"='sha256:'||encode(digest(convert_to("evidence_json",'UTF8'),'sha256'),'hex'))
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_adjudications" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "adjudication_id" text NOT NULL,
  "adjudicator_principal_id" text NOT NULL,
  "reference_label" text NOT NULL,
  "language_evidence_json" text NOT NULL,
  "language_evidence_hash" text NOT NULL,
  "category_competence_evidence_json" text NOT NULL,
  "category_competence_evidence_hash" text NOT NULL,
  "conflict_declaration_json" text NOT NULL,
  "conflict_declaration_hash" text NOT NULL,
  "qualification_expires_at" timestamptz NOT NULL,
  "rationale_digest" text NOT NULL,
  "adjudication_json" text NOT NULL,
  "adjudication_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  UNIQUE ("adjudication_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("adjudicator_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK ("reference_label" IN ('pass','fail','uncertain')
    AND "language_evidence_hash"='sha256:'||encode(digest(convert_to("language_evidence_json",'UTF8'),'sha256'),'hex')
    AND "category_competence_evidence_hash"='sha256:'||encode(digest(convert_to("category_competence_evidence_json",'UTF8'),'sha256'),'hex')
    AND "conflict_declaration_hash"='sha256:'||encode(digest(convert_to("conflict_declaration_json",'UTF8'),'sha256'),'hex')
    AND "qualification_expires_at">="created_at"
    AND "rationale_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_hash"='sha256:'||encode(digest(convert_to("adjudication_json",'UTF8'),'sha256'),'hex'))
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_unit_outcomes" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "mapping_commitment" text NOT NULL,
  "required_reviewer_count" integer NOT NULL,
  "response_count" integer NOT NULL,
  "reference_label" text NOT NULL,
  "agreement_state" text NOT NULL,
  "adjudication_id" text,
  "response_evidence_root" text NOT NULL,
  "adjudication_evidence_digest" text NOT NULL,
  "outcome_json" text NOT NULL,
  "outcome_hash" text NOT NULL,
  "frozen_by" text NOT NULL,
  "frozen_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  FOREIGN KEY ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment")
    REFERENCES "tokenless_dsa_named_panel_units"
      ("workspace_id","epoch_id","unit_id","project_id","run_id","case_id","mapping_commitment") ON DELETE RESTRICT,
  FOREIGN KEY ("adjudication_id") REFERENCES "tokenless_dsa_named_panel_adjudications" ("adjudication_id") ON DELETE RESTRICT,
  FOREIGN KEY ("frozen_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CHECK ("required_reviewer_count" BETWEEN 2 AND 20 AND "response_count"="required_reviewer_count"
    AND "reference_label" IN ('pass','fail','uncertain') AND "agreement_state" IN ('agreed','adjudicated')
    AND (("agreement_state"='agreed' AND "adjudication_id" IS NULL)
      OR ("agreement_state"='adjudicated' AND "adjudication_id" IS NOT NULL))
    AND "response_evidence_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "outcome_hash"='sha256:'||encode(digest(convert_to("outcome_json",'UTF8'),'sha256'),'hex'))
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_label_set_bridges" (
  "workspace_id" text NOT NULL,
  "label_set_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "label_root" text NOT NULL,
  "label_set_hash" text NOT NULL,
  "unit_outcome_count" integer NOT NULL,
  "unit_outcome_root" text NOT NULL,
  "reporting_mode" text NOT NULL,
  "population_claim" boolean NOT NULL,
  "operational_rollup_eligible" boolean NOT NULL,
  "adaptive_reuse_allowed" boolean NOT NULL,
  "bridge_json" text NOT NULL,
  "bridge_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY ("workspace_id","label_set_id"),
  UNIQUE ("workspace_id","label_set_id","bridge_hash"),
  FOREIGN KEY ("workspace_id","label_set_id","epoch_id","label_root","label_set_hash")
    REFERENCES "tokenless_dsa_reference_label_sets"
      ("workspace_id","label_set_id","epoch_id","label_root","set_hash") ON DELETE RESTRICT,
  CHECK (
    "unit_outcome_count" BETWEEN 1 AND 50000
    AND "unit_outcome_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "reporting_mode"='independent_reference_panel_research_only'
    AND "population_claim"=false
    AND "operational_rollup_eligible"=false
    AND "adaptive_reuse_allowed"=false
    AND "bridge_hash"='sha256:'||encode(digest(convert_to("bridge_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_dsa_named_panel_response_root(p_workspace_id text,p_epoch_id text,p_unit_id text)
RETURNS text LANGUAGE sql STABLE STRICT AS $$
  SELECT 'sha256:'||encode(digest(
    convert_to('rateloop.dsa-named-panel-response-root.v1','UTF8')||decode('00','hex')||
    convert_to(COALESCE(string_agg(
      response.assignment_id||'|'||response.reviewer_principal_id||'|'||response.response_id||'|'||
      response.response_digest||'|'||response.derived_label||'|'||response.evidence_hash||E'\n',''
      ORDER BY encode(convert_to(response.assignment_id,'UTF8'),'hex')),''),'UTF8'),'sha256'),'hex')
  FROM tokenless_dsa_named_panel_response_evidence response
  WHERE response.workspace_id=p_workspace_id AND response.epoch_id=p_epoch_id AND response.unit_id=p_unit_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_outcome_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_count integer; response_count integer; access_count integer; reviewer_count integer;
        distinct_label_count integer; agreed_label text; adjudication_label text; adjudicator text;
        recomputed_response_root text;
BEGIN
  SELECT count(*),count(DISTINCT reviewer_principal_id) INTO assignment_count,reviewer_count
    FROM tokenless_dsa_named_panel_assignments
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
  recomputed_response_root:=tokenless_dsa_named_panel_response_root(NEW.workspace_id,NEW.epoch_id,NEW.unit_id);
  IF assignment_count<>NEW.required_reviewer_count OR reviewer_count<>NEW.required_reviewer_count
     OR response_count<>NEW.response_count OR access_count<>NEW.required_reviewer_count THEN
    RAISE EXCEPTION 'DSA named panel does not have exact assignment, access, and response coverage' USING ERRCODE='23514';
  END IF;
  IF NEW.response_evidence_root<>recomputed_response_root
     OR (NEW.agreement_state='agreed' AND (distinct_label_count<>1 OR agreed_label<>NEW.reference_label))
     OR (NEW.agreement_state='adjudicated' AND (distinct_label_count<2 OR adjudication_label<>NEW.reference_label
       OR EXISTS (SELECT 1 FROM tokenless_dsa_named_panel_assignments assignment
                   WHERE assignment.workspace_id=NEW.workspace_id AND assignment.epoch_id=NEW.epoch_id
                     AND assignment.unit_id=NEW.unit_id AND assignment.reviewer_principal_id=adjudicator)))
     OR NEW.outcome_json::jsonb<>jsonb_build_object(
       'schemaVersion','rateloop.dsa-named-panel-outcome.v1','workspaceId',NEW.workspace_id,
       'epochId',NEW.epoch_id,'unitId',NEW.unit_id,'requiredReviewerCount',NEW.required_reviewer_count,
       'responseCount',NEW.response_count,'referenceLabel',NEW.reference_label,'agreementState',NEW.agreement_state,
       'adjudicationId',NEW.adjudication_id,'responseEvidenceRoot',NEW.response_evidence_root,
       'adjudicationEvidenceDigest',NEW.adjudication_evidence_digest,'frozenBy',NEW.frozen_by,
       'frozenAt',to_char(NEW.frozen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RAISE EXCEPTION 'DSA named-panel outcome does not reproduce exact response/adjudication evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_outcome_complete_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_unit_outcomes"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_outcome_complete();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_label_set()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_count integer; unit_count integer; outcome_count integer; label_match_count integer;
        bridge_count integer; identity_leak_count integer;
BEGIN
  IF NEW.derivation_source<>'independent_reference_panel' THEN RETURN NEW; END IF;
  SELECT count(*) INTO selected_count FROM tokenless_dsa_reference_sample_manifest
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND selected=true;
  SELECT count(*) INTO unit_count FROM tokenless_dsa_named_panel_units
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id;
  SELECT count(*) INTO outcome_count FROM tokenless_dsa_named_panel_unit_outcomes
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id;
  SELECT count(*) INTO label_match_count
    FROM tokenless_dsa_reference_labels l
    JOIN tokenless_dsa_named_panel_unit_outcomes o
      ON o.workspace_id=l.workspace_id AND o.epoch_id=l.epoch_id AND o.unit_id=l.unit_id
     AND o.reference_label=l.reference_label AND o.agreement_state=l.agreement_state
     AND o.adjudication_evidence_digest=l.adjudication_evidence_digest
   WHERE l.workspace_id=NEW.workspace_id AND l.label_set_id=NEW.label_set_id;
  SELECT count(*) INTO bridge_count FROM tokenless_dsa_named_panel_label_set_bridges
   WHERE workspace_id=NEW.workspace_id AND label_set_id=NEW.label_set_id;
  SELECT count(*) INTO identity_leak_count
    FROM tokenless_dsa_reference_labels l
    JOIN tokenless_dsa_named_panel_assignments a
      ON a.workspace_id=l.workspace_id AND a.epoch_id=l.epoch_id AND a.unit_id=l.unit_id
   WHERE l.workspace_id=NEW.workspace_id AND l.label_set_id=NEW.label_set_id
     AND (position(a.reviewer_principal_id in l.label_json)>0 OR position(a.reviewer_principal_id in NEW.set_json)>0);
  SELECT identity_leak_count + count(*) INTO identity_leak_count
    FROM tokenless_dsa_named_panel_adjudications a
   WHERE a.workspace_id=NEW.workspace_id AND a.epoch_id=NEW.epoch_id
     AND (position(a.adjudicator_principal_id in NEW.set_json)>0 OR EXISTS (
       SELECT 1 FROM tokenless_dsa_reference_labels l WHERE l.workspace_id=NEW.workspace_id
        AND l.label_set_id=NEW.label_set_id AND l.unit_id=a.unit_id
        AND position(a.adjudicator_principal_id in l.label_json)>0));
  IF selected_count=0 OR unit_count<>selected_count OR outcome_count<>selected_count
     OR label_match_count<>selected_count OR bridge_count<>1 OR identity_leak_count<>0 THEN
    RAISE EXCEPTION 'independent reference labels do not exactly consume persisted named-panel evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_label_set_complete_at_commit
AFTER INSERT ON "tokenless_dsa_reference_label_sets"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_label_set();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_dsa_named_panel_outcome_root(p_workspace_id text,p_epoch_id text)
RETURNS text LANGUAGE sql STABLE STRICT AS $$
  SELECT 'sha256:'||encode(digest(
    convert_to('rateloop.dsa-named-panel-unit-outcome-root.v1','UTF8')||decode('00','hex')||
    convert_to(COALESCE(string_agg(
      outcome.unit_id||'|'||outcome.outcome_hash||'|'||outcome.response_evidence_root||'|'||
      outcome.adjudication_evidence_digest||E'\n','' ORDER BY encode(convert_to(outcome.unit_id,'UTF8'),'hex')),''),'UTF8'),
    'sha256'),'hex')
  FROM tokenless_dsa_named_panel_unit_outcomes outcome
  WHERE outcome.workspace_id=p_workspace_id AND outcome.epoch_id=p_epoch_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_bridge_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE outcome_count integer; expected_count integer; recomputed_root text;
BEGIN
  SELECT count(*) INTO outcome_count FROM tokenless_dsa_named_panel_unit_outcomes
   WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id;
  SELECT expected_selected_count INTO expected_count FROM tokenless_dsa_reference_label_sets
   WHERE workspace_id=NEW.workspace_id AND label_set_id=NEW.label_set_id;
  recomputed_root:=tokenless_dsa_named_panel_outcome_root(NEW.workspace_id,NEW.epoch_id);
  IF outcome_count<>NEW.unit_outcome_count OR expected_count<>NEW.unit_outcome_count
     OR NEW.unit_outcome_root<>recomputed_root
     OR NEW.bridge_json::jsonb<>jsonb_build_object(
       'schemaVersion','rateloop.dsa-named-panel-label-set-bridge.v1',
       'workspaceId',NEW.workspace_id,'labelSetId',NEW.label_set_id,'epochId',NEW.epoch_id,
       'labelRoot',NEW.label_root,'labelSetHash',NEW.label_set_hash,
       'unitOutcomeCount',NEW.unit_outcome_count,'unitOutcomeRoot',NEW.unit_outcome_root,
       'reportingMode',NEW.reporting_mode,'populationClaim',NEW.population_claim,
       'operationalRollupEligible',NEW.operational_rollup_eligible,'adaptiveReuseAllowed',NEW.adaptive_reuse_allowed) THEN
    RAISE EXCEPTION 'named-panel bridge does not exactly cover the frozen label set' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_bridge_complete_at_commit
AFTER INSERT ON "tokenless_dsa_named_panel_label_set_bridges"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_bridge_complete();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_units_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_units"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_assignments_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_accesses_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_artifact_accesses"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_responses_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_response_evidence"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_adjudications_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_adjudications"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_outcomes_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_unit_outcomes"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_named_panel_bridges_append_only BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_label_set_bridges"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_mutation();

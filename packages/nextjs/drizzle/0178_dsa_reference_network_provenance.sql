ALTER TABLE "tokenless_dsa_reference_sampling_epochs"
  ADD CONSTRAINT "tokenless_dsa_reference_sampling_epochs_network_bridge_exact_unique"
  UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key", "epoch_id");--> statement-breakpoint
ALTER TABLE "tokenless_network_benchmark_execution_bindings"
  ADD CONSTRAINT "tokenless_network_benchmark_execution_bindings_reference_exact_unique"
  UNIQUE ("workspace_id", "binding_id", "project_id", "benchmark_id", "activation_reference",
          "opportunity_id", "run_id", "deployment_key");--> statement-breakpoint
ALTER TABLE "tokenless_public_network_review_bindings"
  ADD CONSTRAINT "tokenless_public_network_review_bindings_reference_round_exact_unique"
  UNIQUE ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id", "case_id",
          "deployment_key", "chain_id", "panel_address", "round_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_responses"
  ADD CONSTRAINT "tokenless_assurance_responses_reference_exact_unique"
  UNIQUE ("response_id", "run_id", "case_id", "reviewer_key", "reviewer_source", "response_digest", "validity");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_cases"
  ADD CONSTRAINT "tokenless_assurance_cases_reference_network_mapping_exact_unique"
  UNIQUE ("project_id","case_id","baseline_artifact_id","candidate_artifact_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_cases"
  ADD CONSTRAINT "tokenless_assurance_run_cases_reference_network_mapping_exact_unique"
  UNIQUE ("run_id","case_id","variant_a_artifact_id","variant_b_artifact_id","blinding_commitment");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD COLUMN "derivation_source" text NOT NULL DEFAULT 'independent_reference_panel';--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD CONSTRAINT "tokenless_dsa_reference_label_sets_derivation_source_check"
  CHECK ("derivation_source" IN ('independent_reference_panel','rateloop_network'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_dsa_reference_network_root(root_domain text, root_rows text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'sha256:' || encode(digest(
    convert_to(root_domain,'UTF8') || decode('00','hex') || convert_to(root_rows,'UTF8'),
    'sha256'
  ),'hex')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_reject_dsa_reference_network_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'DSA reference-network provenance is append-only' USING ERRCODE='55000';
END;
$$;--> statement-breakpoint

CREATE TABLE "tokenless_dsa_reference_network_units" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "deployment_key" text NOT NULL,
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "round_id" numeric(78,0) NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "manifest_selected" boolean NOT NULL,
  "source_decision_binding" text NOT NULL,
  "source_evaluation_binding" text NOT NULL,
  "source_evaluation_hash" text NOT NULL,
  "system_identity" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "manifest_row_hash" text NOT NULL,
  "choice_mapping" text NOT NULL,
  "baseline_artifact_id" text NOT NULL,
  "candidate_artifact_id" text NOT NULL,
  "variant_a_artifact_id" text NOT NULL,
  "variant_b_artifact_id" text NOT NULL,
  "blinding_commitment" text NOT NULL,
  "choice_mapping_json" text NOT NULL,
  "choice_mapping_hash" text NOT NULL,
  "required_completed_response_count" integer NOT NULL,
  "response_deadline_at" timestamp with time zone NOT NULL,
  "schema_version" text NOT NULL,
  "unit_json" text NOT NULL,
  "unit_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_dsa_reference_network_units_pk"
    PRIMARY KEY ("workspace_id", "epoch_id", "unit_id"),
  CONSTRAINT "tokenless_dsa_reference_network_units_binding_unique"
    UNIQUE ("workspace_id", "binding_id"),
  CONSTRAINT "tokenless_dsa_reference_network_units_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference", "opportunity_id",
            "binding_id", "run_id", "case_id", "deployment_key", "chain_id", "panel_address", "round_id",
            "epoch_id", "unit_id"),
  CONSTRAINT "tokenless_dsa_reference_network_units_epoch_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key", "epoch_id")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key", "epoch_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_execution_fk"
    FOREIGN KEY ("workspace_id", "binding_id", "project_id", "benchmark_id", "activation_reference",
                 "opportunity_id", "run_id", "deployment_key")
    REFERENCES "tokenless_network_benchmark_execution_bindings"
      ("workspace_id", "binding_id", "project_id", "benchmark_id", "activation_reference",
       "opportunity_id", "run_id", "deployment_key") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_round_fk"
    FOREIGN KEY ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id", "case_id",
                 "deployment_key", "chain_id", "panel_address", "round_id")
    REFERENCES "tokenless_public_network_review_bindings"
      ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id", "case_id",
       "deployment_key", "chain_id", "panel_address", "round_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_manifest_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "unit_id", "manifest_selected", "source_decision_binding",
                 "source_evaluation_binding", "source_evaluation_hash", "system_identity",
                 "automated_outcome", "manifest_row_hash")
    REFERENCES "tokenless_dsa_reference_sample_manifest"
      ("workspace_id", "epoch_id", "unit_id", "selected", "source_decision_binding",
       "source_evaluation_binding", "source_evaluation_hash", "system_identity",
       "automated_outcome", "manifest_row_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_actor_fk"
    FOREIGN KEY ("created_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_case_mapping_fk"
    FOREIGN KEY ("project_id","case_id","baseline_artifact_id","candidate_artifact_id")
    REFERENCES "tokenless_assurance_cases"
      ("project_id","case_id","baseline_artifact_id","candidate_artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_blinded_mapping_fk"
    FOREIGN KEY ("run_id","case_id","variant_a_artifact_id","variant_b_artifact_id","blinding_commitment")
    REFERENCES "tokenless_assurance_run_cases"
      ("run_id","case_id","variant_a_artifact_id","variant_b_artifact_id","blinding_commitment") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_units_contract_check" CHECK (
    "manifest_selected"=true
    AND "schema_version"='rateloop.dsa-reference-network-unit.v1'
    AND "choice_mapping"='candidate_pass_baseline_fail_tie_uncertain_v1'
    AND "baseline_artifact_id"<>"candidate_artifact_id"
    AND "variant_a_artifact_id"<>"variant_b_artifact_id"
    AND ARRAY["variant_a_artifact_id","variant_b_artifact_id"] @>
        ARRAY["baseline_artifact_id","candidate_artifact_id"]
    AND "choice_mapping_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "choice_mapping_hash"='sha256:' || encode(digest(convert_to("choice_mapping_json",'UTF8'),'sha256'),'hex')
    AND "required_completed_response_count" BETWEEN 1 AND 100
    AND "response_deadline_at">"created_at"
    AND "chain_id">0 AND "panel_address" ~ '^0x[0-9a-f]{40}$' AND "round_id">=0
    AND "unit_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "unit_hash"='sha256:' || encode(digest(convert_to("unit_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_dsa_reference_network_lifecycle_events" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "deployment_key" text NOT NULL,
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "round_id" numeric(78,0) NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "event_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "asserted_by_kind" text NOT NULL,
  "asserted_by_principal_id" text NOT NULL,
  "assignment_id" text,
  "reviewer_key" text,
  "response_id" text,
  "response_digest" text,
  "response_reviewer_source" text,
  "response_validity" text,
  "response_label" text,
  "terminal_state" text,
  "timeout_stage" text,
  "event_json" text NOT NULL,
  "event_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_pk"
    PRIMARY KEY ("workspace_id", "invitation_id", "sequence"),
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_id_unique" UNIQUE ("event_id"),
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_type_unique"
    UNIQUE ("workspace_id", "epoch_id", "unit_id", "invitation_id", "event_type"),
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_unit_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference", "opportunity_id",
                 "binding_id", "run_id", "case_id", "deployment_key", "chain_id", "panel_address", "round_id",
                 "epoch_id", "unit_id")
    REFERENCES "tokenless_dsa_reference_network_units"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference", "opportunity_id",
       "binding_id", "run_id", "case_id", "deployment_key", "chain_id", "panel_address", "round_id",
       "epoch_id", "unit_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_principal_fk"
    FOREIGN KEY ("reviewer_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_asserted_by_fk"
    FOREIGN KEY ("asserted_by_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_assignment_fk"
    FOREIGN KEY ("workspace_id", "project_id", "run_id", "assignment_id")
    REFERENCES "tokenless_assurance_assignments" ("workspace_id", "project_id", "run_id", "assignment_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_response_fk"
    FOREIGN KEY ("response_id", "run_id", "case_id", "reviewer_key", "response_reviewer_source",
                 "response_digest", "response_validity")
    REFERENCES "tokenless_assurance_responses"
      ("response_id", "run_id", "case_id", "reviewer_key", "reviewer_source",
       "response_digest", "validity") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_lifecycle_events_contract_check" CHECK (
    "event_id" ~ '^dsan_evt_[0-9a-f]{40}$'
    AND "sequence" BETWEEN 1 AND 5
    AND "event_type" IN ('invited','accepted','declined','assigned','opened','completed','timed_out')
    AND (("event_type" IN ('accepted','declined','opened','completed') AND "asserted_by_kind"='reviewer'
          AND "asserted_by_principal_id"="reviewer_principal_id")
      OR ("event_type" IN ('invited','assigned','timed_out') AND "asserted_by_kind"='allocator'
          AND "asserted_by_principal_id"<>"reviewer_principal_id"))
    AND "event_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_hash"='sha256:' || encode(digest(convert_to("event_json",'UTF8'),'sha256'),'hex')
    AND (
      ("event_type" IN ('invited','accepted') AND "assignment_id" IS NULL AND "reviewer_key" IS NULL
       AND "response_id" IS NULL AND "response_digest" IS NULL AND "response_reviewer_source" IS NULL
       AND "response_validity" IS NULL AND "response_label" IS NULL
       AND "terminal_state" IS NULL)
      OR
      ("event_type"='declined' AND "assignment_id" IS NULL AND "reviewer_key" IS NULL
       AND "response_id" IS NULL AND "response_digest" IS NULL AND "response_reviewer_source" IS NULL
       AND "response_validity" IS NULL AND "response_label" IS NULL
       AND "terminal_state"='declined')
      OR
      ("event_type" IN ('assigned','opened') AND "assignment_id" IS NOT NULL AND "reviewer_key" IS NOT NULL
       AND "response_id" IS NULL AND "response_digest" IS NULL AND "response_reviewer_source" IS NULL
       AND "response_validity" IS NULL AND "response_label" IS NULL
       AND "terminal_state" IS NULL)
      OR
      ("event_type"='completed' AND "assignment_id" IS NOT NULL AND "reviewer_key" IS NOT NULL
       AND "response_id" IS NOT NULL AND "response_digest" ~ '^sha256:[0-9a-f]{64}$'
       AND "response_reviewer_source"='rateloop_network' AND "response_validity"='valid'
       AND "response_label" IN ('pass','fail','uncertain') AND "terminal_state"='completed')
      OR
      ("event_type"='timed_out'
       AND "response_id" IS NULL AND "response_digest" IS NULL AND "response_reviewer_source" IS NULL
       AND "response_validity" IS NULL AND "response_label" IS NULL
       AND "terminal_state"='timed_out' AND "timeout_stage" IN ('invited','accepted','assigned','opened')
       AND (("timeout_stage" IN ('invited','accepted') AND "assignment_id" IS NULL AND "reviewer_key" IS NULL)
         OR ("timeout_stage" IN ('assigned','opened') AND "assignment_id" IS NOT NULL AND "reviewer_key" IS NOT NULL)))
    )
    AND (("event_type"='timed_out' AND "timeout_stage" IS NOT NULL)
      OR ("event_type"<>'timed_out' AND "timeout_stage" IS NULL))
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_dsa_reference_network_unit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_json jsonb;
BEGIN
  NEW."created_at" := date_trunc('milliseconds', tokenless_dsa_evidence_transaction_timestamp());
  expected_json := jsonb_build_object(
    'schemaVersion',NEW."schema_version",'workspaceId',NEW."workspace_id",'projectId',NEW."project_id",
    'benchmarkId',NEW."benchmark_id",'activationReference',NEW."activation_reference",
    'opportunityId',NEW."opportunity_id",'bindingId',NEW."binding_id",'runId',NEW."run_id",
    'caseId',NEW."case_id",'deploymentKey',NEW."deployment_key",'chainId',NEW."chain_id",
    'panelAddress',NEW."panel_address",'roundId',NEW."round_id"::text,'epochId',NEW."epoch_id",
    'unitId',NEW."unit_id",'manifestSelected',NEW."manifest_selected",
    'sourceDecisionBinding',NEW."source_decision_binding",
    'sourceEvaluationBinding',NEW."source_evaluation_binding",
    'sourceEvaluationHash',NEW."source_evaluation_hash",'systemIdentity',NEW."system_identity",
    'automatedOutcome',NEW."automated_outcome",'manifestRowHash',NEW."manifest_row_hash",
    'choiceMapping',NEW."choice_mapping",'baselineArtifactId',NEW."baseline_artifact_id",
    'candidateArtifactId',NEW."candidate_artifact_id",'variantAArtifactId',NEW."variant_a_artifact_id",
    'variantBArtifactId',NEW."variant_b_artifact_id",'blindingCommitment',NEW."blinding_commitment",
    'choiceMappingHash',NEW."choice_mapping_hash",
    'requiredCompletedResponseCount',NEW."required_completed_response_count",
    'responseDeadlineAt',to_char(NEW."response_deadline_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBy',NEW."created_by",'createdAt',to_char(NEW."created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF NEW."unit_json"::jsonb <> expected_json THEN
    RAISE EXCEPTION 'reference-network unit JSON does not exactly match its selected-unit and network identity';
  END IF;
  IF NEW."choice_mapping_json"::jsonb <> jsonb_build_object(
    'choiceMapping',NEW."choice_mapping",'baselineArtifactId',NEW."baseline_artifact_id",
    'candidateArtifactId',NEW."candidate_artifact_id",'variantAArtifactId',NEW."variant_a_artifact_id",
    'variantBArtifactId',NEW."variant_b_artifact_id",'blindingCommitment',NEW."blinding_commitment") THEN
    RAISE EXCEPTION 'reference-network blinded choice mapping is not exact';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_units_lock
BEFORE INSERT ON "tokenless_dsa_reference_network_units"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_dsa_reference_network_unit();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_dsa_reference_network_lifecycle_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unit_record "tokenless_dsa_reference_network_units"%ROWTYPE;
  previous_record "tokenless_dsa_reference_network_lifecycle_events"%ROWTYPE;
  assignment_record record;
  response_record record;
  expected_json jsonb;
  expected_label text;
BEGIN
  NEW."occurred_at" := date_trunc('milliseconds', tokenless_dsa_evidence_transaction_timestamp());
  SELECT * INTO unit_record FROM "tokenless_dsa_reference_network_units"
  WHERE "workspace_id"=NEW."workspace_id" AND "epoch_id"=NEW."epoch_id" AND "unit_id"=NEW."unit_id"
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reference-network unit does not exist'; END IF;

  SELECT * INTO previous_record FROM "tokenless_dsa_reference_network_lifecycle_events"
  WHERE "workspace_id"=NEW."workspace_id" AND "invitation_id"=NEW."invitation_id"
  ORDER BY "sequence" DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    IF NEW."sequence"<>1 OR NEW."event_type"<>'invited' THEN
      RAISE EXCEPTION 'reference-network invitation must begin with invited';
    END IF;
  ELSE
    IF NEW."sequence"<>previous_record."sequence"+1
       OR ROW(NEW."project_id",NEW."benchmark_id",NEW."activation_reference",NEW."opportunity_id",
              NEW."binding_id",NEW."run_id",NEW."case_id",NEW."deployment_key",NEW."chain_id",
              NEW."panel_address",NEW."round_id",NEW."epoch_id",NEW."unit_id",NEW."reviewer_principal_id")
          IS DISTINCT FROM
          ROW(previous_record."project_id",previous_record."benchmark_id",previous_record."activation_reference",
              previous_record."opportunity_id",previous_record."binding_id",previous_record."run_id",
              previous_record."case_id",previous_record."deployment_key",previous_record."chain_id",
              previous_record."panel_address",previous_record."round_id",previous_record."epoch_id",
              previous_record."unit_id",previous_record."reviewer_principal_id") THEN
      RAISE EXCEPTION 'reference-network lifecycle identity or sequence changed';
    END IF;
    IF NOT ((previous_record."event_type"='invited' AND NEW."event_type" IN ('accepted','declined','timed_out'))
         OR (previous_record."event_type"='accepted' AND NEW."event_type" IN ('assigned','timed_out'))
         OR (previous_record."event_type"='assigned' AND NEW."event_type" IN ('opened','timed_out'))
         OR (previous_record."event_type"='opened' AND NEW."event_type" IN ('completed','timed_out'))) THEN
      RAISE EXCEPTION 'invalid reference-network lifecycle transition';
    END IF;
    IF (NEW."event_type" IN ('opened','completed')
        OR (NEW."event_type"='timed_out' AND NEW."timeout_stage" IN ('assigned','opened')))
       AND ROW(NEW."assignment_id",NEW."reviewer_key") IS DISTINCT FROM
           ROW(previous_record."assignment_id",previous_record."reviewer_key") THEN
      RAISE EXCEPTION 'reference-network assignment provenance changed';
    END IF;
    IF NEW."event_type"='timed_out' AND NEW."timeout_stage"<>previous_record."event_type" THEN
      RAISE EXCEPTION 'reference-network timeout stage does not match the frozen lifecycle stage';
    END IF;
  END IF;

  IF NEW."event_type" IN ('assigned','opened','completed')
     OR (NEW."event_type"='timed_out' AND NEW."timeout_stage" IN ('assigned','opened')) THEN
    SELECT a."source",a."reviewer_account_address",a."rater_id",a."paid_assignment",
           a."paid_eligibility_checked_at",a."status",p."principal_id"
    INTO assignment_record
    FROM "tokenless_assurance_assignments" a
    LEFT JOIN "tokenless_rater_profiles" p ON p."rater_id"=a."rater_id"
    WHERE a."workspace_id"=NEW."workspace_id" AND a."project_id"=NEW."project_id"
      AND a."run_id"=NEW."run_id" AND a."assignment_id"=NEW."assignment_id"
    FOR SHARE OF a;
    IF NOT FOUND OR assignment_record."source"<>'rateloop_network'
       OR assignment_record."paid_assignment"<>true OR assignment_record."paid_eligibility_checked_at" IS NULL
       OR NOT (assignment_record."reviewer_account_address"=NEW."reviewer_principal_id"
               OR assignment_record."principal_id"=NEW."reviewer_principal_id") THEN
      RAISE EXCEPTION 'assignment is not bound to the exact network reviewer principal';
    END IF;
    IF (NEW."event_type"='completed' AND assignment_record."status"<>'completed')
       OR (NEW."event_type" IN ('assigned','opened') AND assignment_record."status" NOT IN ('accepted','completed'))
       OR (NEW."event_type"='timed_out' AND assignment_record."status" NOT IN ('expired','released')) THEN
      RAISE EXCEPTION 'assignment status does not match the asserted network lifecycle event';
    END IF;
  END IF;

  IF NEW."asserted_by_kind"='allocator' THEN
    PERFORM 1 FROM "tokenless_workspace_members" m
    JOIN "tokenless_workspaces" w ON w."workspace_id"=m."workspace_id" AND w."status"='active'
    JOIN "tokenless_assurance_projects" p
      ON p."workspace_id"=m."workspace_id" AND p."project_id"=NEW."project_id" AND p."status"='active'
    JOIN "tokenless_principals" principal
      ON principal."principal_id"=m."account_address" AND principal."status"='active'
    WHERE m."workspace_id"=NEW."workspace_id" AND m."account_address"=NEW."asserted_by_principal_id"
      AND m."role" IN ('owner','admin');
    IF NOT FOUND THEN RAISE EXCEPTION 'allocator is not an active manager for the exact project'; END IF;
  ELSE
    PERFORM 1 FROM "tokenless_principals" WHERE "principal_id"=NEW."asserted_by_principal_id" AND "status"='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'reviewer principal is not active'; END IF;
  END IF;

  IF NEW."event_type"='completed' THEN
    SELECT r."reviewer_source",r."validity",r."choice",r."response_digest"
    INTO response_record FROM "tokenless_assurance_responses" r
    WHERE r."response_id"=NEW."response_id" AND r."run_id"=NEW."run_id"
      AND r."case_id"=NEW."case_id" AND r."reviewer_key"=NEW."reviewer_key"
      AND r."reviewer_source"=NEW."response_reviewer_source"
      AND r."response_digest"=NEW."response_digest" AND r."validity"=NEW."response_validity"
    FOR SHARE;
    IF NOT FOUND OR response_record."reviewer_source"<>'rateloop_network' OR response_record."validity"<>'valid' THEN
      RAISE EXCEPTION 'completed response provenance is not exact and valid';
    END IF;
    expected_label := CASE response_record."choice" WHEN 'candidate' THEN 'pass'
      WHEN 'baseline' THEN 'fail' WHEN 'tie' THEN 'uncertain' ELSE NULL END;
    IF expected_label IS NULL OR expected_label<>NEW."response_label" THEN
      RAISE EXCEPTION 'completed response label does not follow the frozen choice mapping';
    END IF;
  ELSIF NEW."event_type"='timed_out' AND NEW."occurred_at"<unit_record."response_deadline_at" THEN
    RAISE EXCEPTION 'reference-network invitation cannot time out before its deadline';
  END IF;

  expected_json := jsonb_build_object(
    'workspaceId',NEW."workspace_id",'projectId',NEW."project_id",'benchmarkId',NEW."benchmark_id",
    'activationReference',NEW."activation_reference",'opportunityId',NEW."opportunity_id",
    'bindingId',NEW."binding_id",'runId',NEW."run_id",'caseId',NEW."case_id",
    'deploymentKey',NEW."deployment_key",'chainId',NEW."chain_id",'panelAddress',NEW."panel_address",
    'roundId',NEW."round_id"::text,'epochId',NEW."epoch_id",'unitId',NEW."unit_id",
    'invitationId',NEW."invitation_id",'eventId',NEW."event_id",'sequence',NEW."sequence",
    'eventType',NEW."event_type",'reviewerPrincipalId',NEW."reviewer_principal_id",
    'assertedByKind',NEW."asserted_by_kind",'assertedByPrincipalId',NEW."asserted_by_principal_id",
    'assignmentId',NEW."assignment_id",'reviewerKey',NEW."reviewer_key",'responseId',NEW."response_id",
    'responseDigest',NEW."response_digest",'responseReviewerSource',NEW."response_reviewer_source",
    'responseValidity',NEW."response_validity",'responseLabel',NEW."response_label",
    'terminalState',NEW."terminal_state",'timeoutStage',NEW."timeout_stage",
    'occurredAt',to_char(NEW."occurred_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF NEW."event_json"::jsonb<>expected_json THEN
    RAISE EXCEPTION 'reference-network lifecycle JSON is not exact';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_lifecycle_events_lock
BEFORE INSERT ON "tokenless_dsa_reference_network_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_dsa_reference_network_lifecycle_event();--> statement-breakpoint

CREATE TABLE "tokenless_dsa_reference_network_adjudications" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "deployment_key" text NOT NULL,
  "chain_id" integer NOT NULL,
  "panel_address" text NOT NULL,
  "round_id" numeric(78,0) NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "invited_count" integer NOT NULL,
  "accepted_count" integer NOT NULL,
  "declined_count" integer NOT NULL,
  "assigned_count" integer NOT NULL,
  "opened_count" integer NOT NULL,
  "completed_count" integer NOT NULL,
  "timed_out_count" integer NOT NULL,
  "lifecycle_root" text NOT NULL,
  "response_root" text NOT NULL,
  "final_label" text NOT NULL,
  "agreement_state" text NOT NULL,
  "adjudicated_by" text,
  "schema_version" text NOT NULL,
  "adjudication_json" text NOT NULL,
  "adjudication_hash" text NOT NULL,
  "adjudicated_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_dsa_reference_network_adjudications_pk" PRIMARY KEY ("workspace_id","epoch_id","unit_id"),
  CONSTRAINT "tokenless_dsa_reference_network_adjudications_exact_unique"
    UNIQUE ("workspace_id","project_id","benchmark_id","activation_reference","opportunity_id","binding_id",
            "run_id","case_id","deployment_key","chain_id","panel_address","round_id","epoch_id","unit_id","adjudication_hash"),
  CONSTRAINT "tokenless_dsa_reference_network_adjudications_unit_fk"
    FOREIGN KEY ("workspace_id","project_id","benchmark_id","activation_reference","opportunity_id","binding_id",
                 "run_id","case_id","deployment_key","chain_id","panel_address","round_id","epoch_id","unit_id")
    REFERENCES "tokenless_dsa_reference_network_units"
      ("workspace_id","project_id","benchmark_id","activation_reference","opportunity_id","binding_id",
       "run_id","case_id","deployment_key","chain_id","panel_address","round_id","epoch_id","unit_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_adjudications_actor_fk"
    FOREIGN KEY ("adjudicated_by") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_adjudications_contract_check" CHECK (
    "schema_version"='rateloop.dsa-reference-network-adjudication.v1'
    AND "invited_count">=1 AND "accepted_count">=0 AND "declined_count">=0 AND "assigned_count">=0
    AND "opened_count">=0 AND "completed_count">=0 AND "timed_out_count">=0
    AND "invited_count">="accepted_count" AND "accepted_count">="assigned_count"
    AND "assigned_count">="opened_count" AND "opened_count">="completed_count"
    AND "invited_count"="declined_count"+"completed_count"+"timed_out_count"
    AND "lifecycle_root" ~ '^sha256:[0-9a-f]{64}$' AND "response_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "final_label" IN ('pass','fail','uncertain') AND "agreement_state" IN ('agreed','adjudicated')
    AND (("agreement_state"='agreed' AND "adjudicated_by" IS NULL)
      OR ("agreement_state"='adjudicated' AND "adjudicated_by" IS NOT NULL))
    AND "adjudication_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_hash"='sha256:' || encode(digest(convert_to("adjudication_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_dsa_reference_network_adjudication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  required_count integer;
  actual_invited integer;
  actual_accepted integer;
  actual_declined integer;
  actual_assigned integer;
  actual_opened integer;
  actual_completed integer;
  actual_timed_out integer;
  actual_lifecycle_root text;
  actual_response_root text;
  distinct_labels integer;
  agreed_label text;
  expected_json jsonb;
BEGIN
  NEW."adjudicated_at" := date_trunc('milliseconds', tokenless_dsa_evidence_transaction_timestamp());
  SELECT "required_completed_response_count" INTO required_count
  FROM "tokenless_dsa_reference_network_units"
  WHERE "workspace_id"=NEW."workspace_id" AND "epoch_id"=NEW."epoch_id" AND "unit_id"=NEW."unit_id" FOR SHARE;
  SELECT COUNT(*) FILTER (WHERE "event_type"='invited')::integer,
         COUNT(*) FILTER (WHERE "event_type"='accepted')::integer,
         COUNT(*) FILTER (WHERE "event_type"='declined')::integer,
         COUNT(*) FILTER (WHERE "event_type"='assigned')::integer,
         COUNT(*) FILTER (WHERE "event_type"='opened')::integer,
         COUNT(*) FILTER (WHERE "event_type"='completed')::integer,
         COUNT(*) FILTER (WHERE "event_type"='timed_out')::integer,
         tokenless_dsa_reference_network_root('rateloop.dsa-reference-network-lifecycle.v1',
           COALESCE(string_agg("invitation_id"||'|'||"sequence"::text||'|'||"event_hash",E'\n'
             ORDER BY encode(convert_to("invitation_id",'UTF8'),'hex'),"sequence"),'')),
         tokenless_dsa_reference_network_root('rateloop.dsa-reference-network-responses.v1',
           COALESCE(string_agg("invitation_id"||'|'||"response_id"||'|'||"response_digest"||'|'||"response_label"||'|'||"event_hash",E'\n'
             ORDER BY encode(convert_to("invitation_id",'UTF8'),'hex')) FILTER (WHERE "event_type"='completed'),'')),
         COUNT(DISTINCT "response_label") FILTER (WHERE "event_type"='completed')::integer,
         MIN("response_label") FILTER (WHERE "event_type"='completed')
  INTO actual_invited,actual_accepted,actual_declined,actual_assigned,actual_opened,actual_completed,
       actual_timed_out,actual_lifecycle_root,actual_response_root,distinct_labels,agreed_label
  FROM "tokenless_dsa_reference_network_lifecycle_events"
  WHERE "workspace_id"=NEW."workspace_id" AND "epoch_id"=NEW."epoch_id" AND "unit_id"=NEW."unit_id";
  IF actual_invited<1 OR actual_completed<required_count
     OR actual_invited<actual_accepted OR actual_accepted<actual_assigned
     OR actual_assigned<actual_opened OR actual_opened<actual_completed
     OR actual_invited<>actual_declined+actual_completed+actual_timed_out
     OR ROW(NEW."invited_count",NEW."accepted_count",NEW."declined_count",NEW."assigned_count",NEW."opened_count",
            NEW."completed_count",NEW."timed_out_count",NEW."lifecycle_root",NEW."response_root") IS DISTINCT FROM
        ROW(actual_invited,actual_accepted,actual_declined,actual_assigned,actual_opened,actual_completed,
            actual_timed_out,actual_lifecycle_root,actual_response_root) THEN
    RAISE EXCEPTION 'reference-network adjudication lifecycle coverage or roots are incomplete';
  END IF;
  IF (distinct_labels=1 AND (NEW."agreement_state"<>'agreed' OR NEW."final_label"<>agreed_label))
     OR (distinct_labels<>1 AND NEW."agreement_state"<>'adjudicated') THEN
    RAISE EXCEPTION 'reference-network adjudication does not follow terminal responses';
  END IF;
  IF NEW."adjudicated_by" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "tokenless_dsa_reference_network_lifecycle_events" e
    WHERE e."workspace_id"=NEW."workspace_id" AND e."epoch_id"=NEW."epoch_id"
      AND e."unit_id"=NEW."unit_id" AND e."reviewer_principal_id"=NEW."adjudicated_by") THEN
    RAISE EXCEPTION 'a network reviewer cannot adjudicate the same unit';
  END IF;
  expected_json := jsonb_build_object(
    'schemaVersion',NEW."schema_version",'workspaceId',NEW."workspace_id",'epochId',NEW."epoch_id",
    'unitId',NEW."unit_id",'invitedCount',NEW."invited_count",'acceptedCount',NEW."accepted_count",
    'declinedCount',NEW."declined_count",'assignedCount',NEW."assigned_count",'openedCount',NEW."opened_count",
    'completedCount',NEW."completed_count",'timedOutCount',NEW."timed_out_count",
    'lifecycleRoot',NEW."lifecycle_root",'responseRoot',NEW."response_root",
    'finalLabel',NEW."final_label",'agreementState',NEW."agreement_state",
    'adjudicatedBy',NEW."adjudicated_by",
    'adjudicatedAt',to_char(NEW."adjudicated_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF NEW."adjudication_json"::jsonb<>expected_json THEN RAISE EXCEPTION 'reference-network adjudication JSON is not exact'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_adjudications_lock
BEFORE INSERT ON "tokenless_dsa_reference_network_adjudications"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_dsa_reference_network_adjudication();--> statement-breakpoint

CREATE TABLE "tokenless_dsa_reference_network_label_set_bridges" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "epoch_id" text NOT NULL,
  "label_set_id" text NOT NULL,
  "label_root" text NOT NULL,
  "set_hash" text NOT NULL,
  "selected_unit_count" integer NOT NULL,
  "invited_count" integer NOT NULL,
  "accepted_count" integer NOT NULL,
  "declined_count" integer NOT NULL,
  "assigned_count" integer NOT NULL,
  "opened_count" integer NOT NULL,
  "completed_count" integer NOT NULL,
  "timed_out_count" integer NOT NULL,
  "lifecycle_root" text NOT NULL,
  "response_root" text NOT NULL,
  "adjudication_root" text NOT NULL,
  "reporting_mode" text NOT NULL,
  "population_claim" boolean NOT NULL,
  "operational_rollup_eligible" boolean NOT NULL,
  "adaptive_reuse_allowed" boolean NOT NULL,
  "schema_version" text NOT NULL,
  "bridge_json" text NOT NULL,
  "bridge_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_pk" PRIMARY KEY ("workspace_id","label_set_id"),
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_epoch_unique" UNIQUE ("workspace_id","epoch_id"),
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_epoch_fk"
    FOREIGN KEY ("workspace_id","project_id","benchmark_id","activation_reference","deployment_key","epoch_id")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id","project_id","benchmark_id","activation_reference","deployment_key","epoch_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_set_fk"
    FOREIGN KEY ("workspace_id","label_set_id","epoch_id","label_root","set_hash")
    REFERENCES "tokenless_dsa_reference_label_sets"
      ("workspace_id","label_set_id","epoch_id","label_root","set_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_actor_fk"
    FOREIGN KEY ("created_by") REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_network_label_set_bridges_contract_check" CHECK (
    "schema_version"='rateloop.dsa-reference-network-label-set-bridge.v1'
    AND "selected_unit_count" >= 1 AND "invited_count" >= "selected_unit_count"
    AND "accepted_count" >= 0 AND "declined_count" >= 0 AND "assigned_count" >= 0 AND "opened_count" >= 0
    AND "completed_count" >= "selected_unit_count" AND "timed_out_count" >= 0
    AND "invited_count" >= "accepted_count" AND "accepted_count" >= "assigned_count"
    AND "assigned_count" >= "opened_count" AND "opened_count" >= "completed_count"
    AND "invited_count" = "declined_count" + "completed_count" + "timed_out_count"
    AND "lifecycle_root" ~ '^sha256:[0-9a-f]{64}$' AND "response_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "reporting_mode"='descriptive_panel_vs_network_only' AND "population_claim"=false
    AND "operational_rollup_eligible"=false AND "adaptive_reuse_allowed"=false
    AND "bridge_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "bridge_hash"='sha256:' || encode(digest(convert_to("bridge_json",'UTF8'),'sha256'),'hex')
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_validate_dsa_reference_network_label_set(
  p_workspace_id text,p_epoch_id text,p_label_set_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  bridge_record "tokenless_dsa_reference_network_label_set_bridges"%ROWTYPE;
  set_record "tokenless_dsa_reference_label_sets"%ROWTYPE;
  selected_count integer;
  unit_count integer;
  label_count integer;
  mismatch_count integer;
  identity_count integer;
  actual_invited integer;
  actual_accepted integer;
  actual_declined integer;
  actual_assigned integer;
  actual_opened integer;
  actual_completed integer;
  actual_timed_out integer;
  actual_lifecycle_root text;
  actual_response_root text;
  actual_adjudication_root text;
  expected_json jsonb;
BEGIN
  SELECT * INTO bridge_record FROM "tokenless_dsa_reference_network_label_set_bridges"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id AND "label_set_id"=p_label_set_id;
  SELECT * INTO set_record FROM "tokenless_dsa_reference_label_sets"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id AND "label_set_id"=p_label_set_id;
  IF bridge_record."label_set_id" IS NULL OR set_record."label_set_id" IS NULL
     OR set_record."derivation_source"<>'rateloop_network' THEN
    RAISE EXCEPTION 'network-derived label set requires an exact provenance bridge';
  END IF;
  SELECT COUNT(*)::integer INTO selected_count FROM "tokenless_dsa_reference_sample_manifest"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id AND "selected"=true;
  SELECT COUNT(*)::integer INTO unit_count FROM "tokenless_dsa_reference_network_units"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id;
  SELECT COUNT(*)::integer INTO label_count FROM "tokenless_dsa_reference_labels"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id AND "label_set_id"=p_label_set_id;
  SELECT COUNT(*)::integer INTO mismatch_count
  FROM "tokenless_dsa_reference_network_units" u
  LEFT JOIN "tokenless_dsa_reference_network_adjudications" a
    ON a."workspace_id"=u."workspace_id" AND a."epoch_id"=u."epoch_id" AND a."unit_id"=u."unit_id"
  LEFT JOIN "tokenless_dsa_reference_labels" l
    ON l."workspace_id"=u."workspace_id" AND l."epoch_id"=u."epoch_id" AND l."unit_id"=u."unit_id"
   AND l."label_set_id"=p_label_set_id
  WHERE u."workspace_id"=p_workspace_id AND u."epoch_id"=p_epoch_id
    AND (a."unit_id" IS NULL OR l."unit_id" IS NULL OR l."reference_label" IS DISTINCT FROM a."final_label"
      OR l."agreement_state" IS DISTINCT FROM a."agreement_state"
      OR l."adjudication_evidence_digest" IS DISTINCT FROM a."adjudication_hash");
  SELECT COUNT(*) FILTER (WHERE ROW("project_id","benchmark_id","activation_reference","deployment_key")
    IS DISTINCT FROM ROW(bridge_record."project_id",bridge_record."benchmark_id",
                         bridge_record."activation_reference",bridge_record."deployment_key"))::integer
  INTO identity_count FROM "tokenless_dsa_reference_network_units"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id;
  SELECT SUM("invited_count")::integer,SUM("accepted_count")::integer,SUM("declined_count")::integer,
         SUM("assigned_count")::integer,SUM("opened_count")::integer,SUM("completed_count")::integer,
         SUM("timed_out_count")::integer,
         tokenless_dsa_reference_network_root('rateloop.dsa-reference-network-label-set-lifecycle.v1',
           COALESCE(string_agg("unit_id"||'|'||"lifecycle_root",E'\n' ORDER BY encode(convert_to("unit_id",'UTF8'),'hex')),'')),
         tokenless_dsa_reference_network_root('rateloop.dsa-reference-network-label-set-responses.v1',
           COALESCE(string_agg("unit_id"||'|'||"response_root",E'\n' ORDER BY encode(convert_to("unit_id",'UTF8'),'hex')),'')),
         tokenless_dsa_reference_network_root('rateloop.dsa-reference-network-label-set-adjudications.v1',
           COALESCE(string_agg("unit_id"||'|'||"adjudication_hash",E'\n' ORDER BY encode(convert_to("unit_id",'UTF8'),'hex')),''))
  INTO actual_invited,actual_accepted,actual_declined,actual_assigned,actual_opened,actual_completed,
       actual_timed_out,actual_lifecycle_root,actual_response_root,actual_adjudication_root
  FROM "tokenless_dsa_reference_network_adjudications"
  WHERE "workspace_id"=p_workspace_id AND "epoch_id"=p_epoch_id;
  IF selected_count<>set_record."expected_selected_count" OR unit_count<>selected_count OR label_count<>selected_count
     OR mismatch_count<>0 OR identity_count<>0 OR bridge_record."selected_unit_count"<>selected_count
     OR ROW(bridge_record."invited_count",bridge_record."accepted_count",bridge_record."declined_count",
            bridge_record."assigned_count",bridge_record."opened_count",bridge_record."completed_count",
            bridge_record."timed_out_count",bridge_record."lifecycle_root",bridge_record."response_root",
            bridge_record."adjudication_root") IS DISTINCT FROM
        ROW(actual_invited,actual_accepted,actual_declined,actual_assigned,actual_opened,actual_completed,
            actual_timed_out,actual_lifecycle_root,actual_response_root,actual_adjudication_root) THEN
    RAISE EXCEPTION 'network-derived label set coverage or exact provenance is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_reference_network_lifecycle_events" e
    JOIN "tokenless_dsa_reference_labels" l ON l."workspace_id"=e."workspace_id" AND l."epoch_id"=e."epoch_id"
      AND l."unit_id"=e."unit_id" AND l."label_set_id"=p_label_set_id
    WHERE e."workspace_id"=p_workspace_id AND e."epoch_id"=p_epoch_id
      AND (l."adjudicated_by"=e."reviewer_principal_id" OR position(e."reviewer_principal_id" in l."label_json")>0
        OR position(e."reviewer_principal_id" in set_record."set_json")>0
        OR set_record."created_by"=e."reviewer_principal_id")
  ) THEN RAISE EXCEPTION 'reviewer identity leaked into a public/export label artifact'; END IF;
  expected_json := jsonb_build_object(
    'schemaVersion',bridge_record."schema_version",'workspaceId',bridge_record."workspace_id",
    'projectId',bridge_record."project_id",'benchmarkId',bridge_record."benchmark_id",
    'activationReference',bridge_record."activation_reference",'deploymentKey',bridge_record."deployment_key",
    'epochId',bridge_record."epoch_id",'labelSetId',bridge_record."label_set_id",
    'labelRoot',bridge_record."label_root",'setHash',bridge_record."set_hash",
    'selectedUnitCount',bridge_record."selected_unit_count",'invitedCount',bridge_record."invited_count",
    'acceptedCount',bridge_record."accepted_count",'declinedCount',bridge_record."declined_count",
    'assignedCount',bridge_record."assigned_count",'openedCount',bridge_record."opened_count",
    'completedCount',bridge_record."completed_count",'timedOutCount',bridge_record."timed_out_count",
    'lifecycleRoot',bridge_record."lifecycle_root",'responseRoot',bridge_record."response_root",
    'adjudicationRoot',bridge_record."adjudication_root",'reportingMode',bridge_record."reporting_mode",
    'populationClaim',bridge_record."population_claim",'operationalRollupEligible',bridge_record."operational_rollup_eligible",
    'adaptiveReuseAllowed',bridge_record."adaptive_reuse_allowed",'createdBy',bridge_record."created_by",
    'createdAt',to_char(bridge_record."created_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF bridge_record."bridge_json"::jsonb<>expected_json THEN RAISE EXCEPTION 'reference-network bridge JSON is not exact'; END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_dsa_reference_network_label_set_bridge()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."created_at" := date_trunc('milliseconds', tokenless_dsa_evidence_transaction_timestamp());
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_label_set_bridges_lock
BEFORE INSERT ON "tokenless_dsa_reference_network_label_set_bridges"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_dsa_reference_network_label_set_bridge();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_validate_dsa_reference_network_label_set_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='tokenless_dsa_reference_label_sets' AND NEW."derivation_source"<>'rateloop_network' THEN RETURN NEW; END IF;
  PERFORM tokenless_validate_dsa_reference_network_label_set(NEW."workspace_id",NEW."epoch_id",NEW."label_set_id");
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_network_label_sets_complete_at_commit
AFTER INSERT ON "tokenless_dsa_reference_label_sets" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_validate_dsa_reference_network_label_set_trigger();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_network_bridges_complete_at_commit
AFTER INSERT ON "tokenless_dsa_reference_network_label_set_bridges" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_validate_dsa_reference_network_label_set_trigger();--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_reference_network_units_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_network_units"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_reference_network_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_lifecycle_events_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_network_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_reference_network_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_adjudications_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_network_adjudications"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_reference_network_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_network_label_set_bridges_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_network_label_set_bridges"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_reference_network_mutation();--> statement-breakpoint

CREATE INDEX "tokenless_dsa_reference_network_events_unit_idx"
  ON "tokenless_dsa_reference_network_lifecycle_events" USING btree
  ("workspace_id","epoch_id","unit_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_network_events_principal_idx"
  ON "tokenless_dsa_reference_network_lifecycle_events" USING btree
  ("reviewer_principal_id","event_type","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_dsa_reference_network_events_assignment_once"
  ON "tokenless_dsa_reference_network_lifecycle_events" USING btree ("workspace_id","assignment_id")
  WHERE "event_type"='assigned';--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_dsa_reference_network_events_response_once"
  ON "tokenless_dsa_reference_network_lifecycle_events" USING btree ("response_id")
  WHERE "event_type"='completed';

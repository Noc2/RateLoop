ALTER TABLE "tokenless_dsa_named_panel_selections"
  ADD COLUMN "response_binding_required" boolean;--> statement-breakpoint
UPDATE "tokenless_dsa_named_panel_selections" SET "response_binding_required"=false;--> statement-breakpoint
ALTER TABLE "tokenless_dsa_named_panel_selections"
  ALTER COLUMN "response_binding_required" SET DEFAULT true,
  ALTER COLUMN "response_binding_required" SET NOT NULL,
  ADD CONSTRAINT "tokenless_dsa_named_panel_selections_response_binding_exact_unique"
    UNIQUE ("workspace_id","project_id","epoch_id","unit_id","run_id","case_id",
            "assignment_id","reviewer_principal_id","response_binding_required","panel_deadline");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_new_selection_binding_marker()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."response_binding_required" IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Post-0184 DSA named-panel selections require durable assignment-response binding'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_new_selection_binding_marker_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_selections"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_new_selection_binding_marker();--> statement-breakpoint

ALTER TABLE "tokenless_assurance_responses"
  ADD CONSTRAINT "tokenless_assurance_responses_dsa_binding_exact_unique"
  UNIQUE ("response_id","run_id","case_id","reviewer_key","reviewer_source",
          "response_digest","validity","choice","submitted_at");--> statement-breakpoint

CREATE TABLE "tokenless_dsa_named_panel_assignment_response_bindings" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "reviewer_principal_id" text NOT NULL,
  "response_binding_required" boolean NOT NULL,
  "panel_deadline" timestamptz NOT NULL,
  "response_id" text NOT NULL,
  "reviewer_key" text NOT NULL,
  "reviewer_source" text NOT NULL,
  "response_digest" text NOT NULL,
  "response_validity" text NOT NULL,
  "response_choice" text NOT NULL,
  "response_submitted_at" timestamptz NOT NULL,
  "bound_at" timestamptz NOT NULL DEFAULT date_trunc('milliseconds',transaction_timestamp()),
  PRIMARY KEY ("workspace_id","epoch_id","unit_id","assignment_id","case_id"),
  UNIQUE ("response_id"),
  FOREIGN KEY ("workspace_id","project_id","epoch_id","unit_id","run_id","case_id",
               "assignment_id","reviewer_principal_id","response_binding_required","panel_deadline")
    REFERENCES "tokenless_dsa_named_panel_selections"
      ("workspace_id","project_id","epoch_id","unit_id","run_id","case_id",
       "assignment_id","reviewer_principal_id","response_binding_required","panel_deadline") ON DELETE RESTRICT,
  FOREIGN KEY ("response_id","run_id","case_id","reviewer_key","reviewer_source",
               "response_digest","response_validity","response_choice","response_submitted_at")
    REFERENCES "tokenless_assurance_responses"
      ("response_id","run_id","case_id","reviewer_key","reviewer_source",
       "response_digest","validity","choice","submitted_at") ON DELETE RESTRICT,
  CHECK (
    "reviewer_source"='customer_invited' AND "response_validity"='valid'
    AND "response_choice" IN ('baseline','candidate')
    AND (("response_binding_required"=true AND "bound_at"="response_submitted_at")
      OR ("response_binding_required"=false AND "bound_at">="response_submitted_at"))
    AND "response_submitted_at"<="panel_deadline"
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_dsa_named_panel_assignment_response_bindings_unit_idx"
  ON "tokenless_dsa_named_panel_assignment_response_bindings"
  ("workspace_id","epoch_id","unit_id","response_validity","response_submitted_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_reject_dsa_named_panel_response_binding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DSA named-panel assignment-response bindings are append-only' USING ERRCODE='55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_assignment_response_bindings_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_named_panel_assignment_response_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_named_panel_response_binding_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_response_binding_transaction()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."response_binding_required"=true
     AND NEW."bound_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp()) THEN
    RAISE EXCEPTION 'A required DSA assignment-response binding must be recorded in its response transaction'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_named_panel_assignment_response_binding_transaction_guard
BEFORE INSERT ON "tokenless_dsa_named_panel_assignment_response_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_named_panel_response_binding_transaction();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_named_panel_completed_response_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_count integer; bound_count integer;
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
  IF expected_count=0 OR bound_count<>expected_count THEN
    RAISE EXCEPTION 'A new DSA named-panel completion requires every response bound to its exact assignment'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_dsa_named_panel_completed_response_binding_at_commit
AFTER INSERT OR UPDATE ON "tokenless_assurance_assignments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_dsa_named_panel_completed_response_binding();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_dsa_named_panel_qualification_evidence_valid(
  evidence_json text,
  expected_key text,
  expected_value jsonb,
  expected_kind text,
  expected_version text,
  verified_at_through timestamptz,
  expires_through timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    evidence_json IS JSON OBJECT WITH UNIQUE KEYS
    AND jsonb_typeof(evidence_json::jsonb->'key')='string'
    AND expected_value IS NOT NULL
    AND jsonb_typeof(evidence_json::jsonb->'value') IS NOT NULL
    AND jsonb_typeof(evidence_json::jsonb->'source')='string'
    AND jsonb_typeof(evidence_json::jsonb->'assertedBy')='string'
    AND jsonb_typeof(evidence_json::jsonb->'verifiedAt')='string'
    AND jsonb_typeof(evidence_json::jsonb->'expiresAt')='string'
    AND jsonb_typeof(evidence_json::jsonb->'evidenceReferenceHash')='string'
    AND jsonb_typeof(evidence_json::jsonb->'evidenceVersion')='string'
    AND char_length(evidence_json::jsonb->>'source') BETWEEN 1 AND 80
    AND char_length(evidence_json::jsonb->>'assertedBy') BETWEEN 1 AND 200
    AND char_length(evidence_json::jsonb->>'evidenceVersion') BETWEEN 1 AND 80
    AND evidence_json::jsonb->>'evidenceReferenceHash' ~ '^sha256:[0-9a-f]{64}$'
    AND evidence_json::jsonb=jsonb_build_object(
      'key',expected_key,'value',expected_value,'source',expected_kind,
      'assertedBy',evidence_json::jsonb->'assertedBy',
      'verifiedAt',evidence_json::jsonb->'verifiedAt',
      'expiresAt',evidence_json::jsonb->'expiresAt',
      'evidenceReferenceHash',evidence_json::jsonb->'evidenceReferenceHash',
      'evidenceVersion',expected_version
    )
    AND (evidence_json::jsonb->>'verifiedAt')::timestamptz<=verified_at_through
    AND (evidence_json::jsonb->>'expiresAt')::timestamptz>=expires_through,
    false
  )
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_named_panel_assignments"
  DROP CONSTRAINT "tokenless_dsa_named_panel_assignments_exact_json_check",
  ADD CONSTRAINT "tokenless_dsa_named_panel_assignments_exact_json_check" CHECK (
    tokenless_dsa_named_panel_qualification_evidence_valid(
      "language_evidence_json",'language:'||lower("language_tag")||':reading:cefr',
      "language_evidence_json"::jsonb->'value',"language_evidence_kind","language_evidence_version",
      "frozen_at","assignment_expires_at"
    )
    AND tokenless_dsa_named_panel_qualification_evidence_valid(
      "category_competence_evidence_json",'dsa-policy-category:'||"policy_category_code",'true'::jsonb,
      "category_evidence_kind","category_evidence_version","frozen_at","assignment_expires_at"
    )
    AND "conflict_declaration_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "assignment_snapshot_json" IS JSON OBJECT WITH UNIQUE KEYS
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
  );

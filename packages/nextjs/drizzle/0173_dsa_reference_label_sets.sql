ALTER TABLE "tokenless_dsa_reference_samples"
  ADD CONSTRAINT "tokenless_dsa_ref_samples_label_bind_uq"
  UNIQUE ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_sample_manifest"
  ADD CONSTRAINT "tokenless_dsa_ref_manifest_selected_label_bind_uq"
  UNIQUE ("workspace_id", "epoch_id", "unit_id", "selected", "source_decision_binding",
          "source_evaluation_binding", "source_evaluation_hash", "system_identity",
          "automated_outcome", "manifest_row_hash");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_evaluation_projections"
  ADD CONSTRAINT "tokenless_dsa_ref_evaluations_label_bind_uq"
  UNIQUE ("workspace_id", "epoch_id", "evaluation_id", "unit_id", "provider_decision_id",
          "decision_version", "source_decision_binding", "source_evaluation_binding",
          "source_evaluation_hash", "system_identity", "system_id", "system_version",
          "automated_outcome", "evaluation_hash", "projection_hash");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_label_sets" (
  "workspace_id" text NOT NULL,
  "label_set_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "commitment_digest" text NOT NULL,
  "sample_digest" text NOT NULL,
  "manifest_root" text NOT NULL,
  "reference_definition_version" text NOT NULL,
  "reference_definition_hash" text NOT NULL,
  "expected_selected_count" integer NOT NULL,
  "selected_manifest_root" text NOT NULL,
  "label_root" text NOT NULL,
  "adjudication_evidence_root" text NOT NULL,
  "pass_label_count" integer NOT NULL,
  "fail_label_count" integer NOT NULL,
  "uncertain_label_count" integer NOT NULL,
  "coverage_gap" text,
  "set_json" text NOT NULL,
  "set_hash" text NOT NULL,
  "source_frozen_at" timestamp with time zone NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_label_sets_pk"
    PRIMARY KEY ("workspace_id", "label_set_id"),
  CONSTRAINT "tokenless_dsa_reference_label_sets_epoch_unique"
    UNIQUE ("workspace_id", "epoch_id"),
  CONSTRAINT "tokenless_dsa_reference_label_sets_scope_unique"
    UNIQUE ("workspace_id", "label_set_id", "epoch_id"),
  CONSTRAINT "tokenless_dsa_reference_label_sets_sample_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root")
    REFERENCES "tokenless_dsa_reference_samples"
      ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_label_sets_contract_check" CHECK (
    "label_set_id" ~ '^rsls_[0-9a-f]{40}$'
    AND "epoch_id" ~ '^rse_[0-9a-f]{40}$'
    AND "schema_version" = 'rateloop.dsa-reference-label-set.v1'
    AND "commitment_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "sample_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_definition_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "reference_definition_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "selected_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "adjudication_evidence_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "set_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "expected_selected_count" BETWEEN 1 AND 50000
    AND "pass_label_count" BETWEEN 0 AND 50000
    AND "fail_label_count" BETWEEN 0 AND 50000
    AND "uncertain_label_count" BETWEEN 0 AND 50000
    AND "pass_label_count" + "fail_label_count" + "uncertain_label_count" = "expected_selected_count"
    AND (("uncertain_label_count" = 0 AND "coverage_gap" IS NULL)
         OR ("uncertain_label_count" > 0 AND "coverage_gap" = 'uncertain_reference_labels'))
    AND "source_frozen_at" <= "frozen_at"
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_labels" (
  "workspace_id" text NOT NULL,
  "label_set_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
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
  "reference_label" text NOT NULL,
  "agreement_state" text NOT NULL,
  "adjudication_evidence_digest" text NOT NULL,
  "label_json" text NOT NULL,
  "label_hash" text NOT NULL,
  "adjudicated_by" text,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_labels_pk"
    PRIMARY KEY ("workspace_id", "label_set_id", "unit_id"),
  CONSTRAINT "tokenless_dsa_reference_labels_evaluation_unique"
    UNIQUE ("workspace_id", "epoch_id", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_reference_labels_set_fk"
    FOREIGN KEY ("workspace_id", "label_set_id", "epoch_id")
    REFERENCES "tokenless_dsa_reference_label_sets" ("workspace_id", "label_set_id", "epoch_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_labels_selected_manifest_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "unit_id", "manifest_selected", "source_decision_binding",
                 "source_evaluation_binding", "source_evaluation_hash", "system_identity",
                 "automated_outcome", "manifest_row_hash")
    REFERENCES "tokenless_dsa_reference_sample_manifest"
      ("workspace_id", "epoch_id", "unit_id", "selected", "source_decision_binding",
       "source_evaluation_binding", "source_evaluation_hash", "system_identity",
       "automated_outcome", "manifest_row_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_labels_evaluation_projection_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "evaluation_id", "unit_id", "provider_decision_id",
                 "decision_version", "source_decision_binding", "source_evaluation_binding",
                 "source_evaluation_hash", "system_identity", "system_id", "system_version",
                 "automated_outcome", "evaluation_hash", "evaluation_projection_hash")
    REFERENCES "tokenless_dsa_reference_evaluation_projections"
      ("workspace_id", "epoch_id", "evaluation_id", "unit_id", "provider_decision_id",
       "decision_version", "source_decision_binding", "source_evaluation_binding",
       "source_evaluation_hash", "system_identity", "system_id", "system_version",
       "automated_outcome", "evaluation_hash", "projection_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_labels_contract_check" CHECK (
    "unit_id" ~ '^rsu_[A-Za-z0-9_-]{22}$'
    AND "evaluation_id" ~ '^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "decision_version" > 0
    AND "manifest_selected" = true
    AND "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_identity" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "automated_outcome" IN ('pass', 'fail')
    AND "evaluation_hash" = "source_evaluation_hash"
    AND "evaluation_projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_row_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_label" IN ('pass', 'fail', 'uncertain')
    AND "agreement_state" IN ('agreed', 'adjudicated')
    AND ("reference_label" <> 'uncertain' OR "agreement_state" = 'adjudicated')
    AND (("agreement_state" = 'agreed' AND "adjudicated_by" IS NULL)
         OR ("agreement_state" = 'adjudicated' AND char_length("adjudicated_by") BETWEEN 1 AND 200))
    AND "adjudication_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_labels_system_idx"
  ON "tokenless_dsa_reference_labels" USING btree
  ("workspace_id", "label_set_id", "system_identity", "reference_label", "unit_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_reference_label_set_complete_at_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_count integer;
  label_count integer;
  pass_count integer;
  fail_count integer;
  uncertain_count integer;
BEGIN
  SELECT count(*) INTO selected_count
  FROM tokenless_dsa_reference_sample_manifest
  WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id AND selected=true;

  SELECT count(*),
         count(*) FILTER (WHERE reference_label='pass'),
         count(*) FILTER (WHERE reference_label='fail'),
         count(*) FILTER (WHERE reference_label='uncertain')
    INTO label_count,pass_count,fail_count,uncertain_count
  FROM tokenless_dsa_reference_labels
  WHERE workspace_id=NEW.workspace_id AND label_set_id=NEW.label_set_id;

  IF selected_count <> NEW.expected_selected_count
     OR label_count <> NEW.expected_selected_count
     OR pass_count <> NEW.pass_label_count
     OR fail_count <> NEW.fail_label_count
     OR uncertain_count <> NEW.uncertain_label_count THEN
    RAISE EXCEPTION 'DSA reference label set does not exactly cover its selected manifest'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_label_set_complete_at_commit
AFTER INSERT ON "tokenless_dsa_reference_label_sets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_reference_label_set_complete_at_commit();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_label_sets_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_label_sets"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_labels_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_labels"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

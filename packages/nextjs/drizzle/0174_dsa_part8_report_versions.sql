ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD CONSTRAINT "tokenless_dsa_reference_label_sets_report_bind_uq"
  UNIQUE ("workspace_id", "label_set_id", "epoch_id", "label_root", "set_hash");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_external_method_evidence" (
  "workspace_id" text NOT NULL,
  "method_evidence_id" text NOT NULL,
  "method_evidence_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "method_version" text NOT NULL,
  "review_outcome" text NOT NULL,
  "reviewer_organisation_digest" text NOT NULL,
  "independence_declaration" text NOT NULL,
  "acceptance_statement_digest" text NOT NULL,
  "evidence_bytes" bytea NOT NULL,
  "evidence_byte_length" integer NOT NULL,
  "evidence_digest" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_external_method_evidence_pk"
    PRIMARY KEY ("workspace_id", "method_evidence_id", "method_evidence_version"),
  CONSTRAINT "tokenless_dsa_part8_external_method_evidence_exact_unique"
    UNIQUE ("workspace_id", "method_evidence_id", "method_evidence_version", "evidence_digest"),
  CONSTRAINT "tokenless_dsa_part8_external_method_evidence_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces" ("workspace_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_external_method_evidence_contract_check" CHECK (
    "method_evidence_id" ~ '^dsa8m_[0-9a-f]{40}$'
    AND "method_evidence_version" > 0
    AND "schema_version" = 'rateloop.dsa-part8-external-method-evidence.v1'
    AND "method_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "review_outcome" = 'accepted'
    AND "reviewer_organisation_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "independence_declaration" = 'external_independent_method_reviewer'
    AND "acceptance_statement_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_byte_length" BETWEEN 1 AND 10485760
    AND octet_length("evidence_bytes") = "evidence_byte_length"
    AND "evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_digest" = 'sha256:' || encode(digest("evidence_bytes", 'sha256'), 'hex')
    AND "accepted_at" <= "recorded_at"
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_report_versions" (
  "workspace_id" text NOT NULL,
  "report_id" text NOT NULL,
  "report_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "contract_id" text NOT NULL,
  "count_result_digest" text NOT NULL,
  "inventory_id" text NOT NULL,
  "inventory_root" text NOT NULL,
  "inventory_digest" text NOT NULL,
  "service_id" text NOT NULL,
  "reporting_period_start" timestamp with time zone NOT NULL,
  "reporting_period_end" timestamp with time zone NOT NULL,
  "source_frozen_at" timestamp with time zone NOT NULL,
  "epoch_id" text,
  "commitment_digest" text,
  "sample_digest" text,
  "manifest_root" text,
  "label_set_id" text,
  "label_root" text,
  "label_set_hash" text,
  "artifact_designation" text NOT NULL,
  "method_review_status" text NOT NULL,
  "method_evidence_id" text,
  "method_evidence_version" integer,
  "method_evidence_digest" text,
  "transform_version" text NOT NULL,
  "official_template_sha256" text NOT NULL,
  "expected_cell_count" integer NOT NULL,
  "cell_root" text NOT NULL,
  "public_file_digest" text NOT NULL,
  "confidential_file_digest" text NOT NULL,
  "supersedes_report_version" integer,
  "supersedes_report_digest" text,
  "correction_reason" text,
  "change_summary_json" text,
  "method_declaration" text NOT NULL,
  "complete_transparency_report" boolean NOT NULL,
  "publication_eligible" boolean NOT NULL,
  "report_json" text NOT NULL,
  "report_digest" text NOT NULL,
  "created_by" text NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_report_versions_pk"
    PRIMARY KEY ("workspace_id", "report_id", "report_version"),
  CONSTRAINT "tokenless_dsa_part8_report_versions_exact_unique"
    UNIQUE ("workspace_id", "report_id", "report_version", "report_digest"),
  CONSTRAINT "tokenless_dsa_part8_report_versions_scope_unique"
    UNIQUE ("workspace_id", "contract_id", "report_version"),
  CONSTRAINT "tokenless_dsa_part8_report_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces" ("workspace_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_count_result_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "count_result_digest")
    REFERENCES "tokenless_dsa_part8_count_results" ("workspace_id", "contract_id", "result_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_inventory_fk"
    FOREIGN KEY ("workspace_id", "inventory_id", "inventory_root", "inventory_digest")
    REFERENCES "tokenless_dsa_classifier_inventories"
      ("workspace_id", "inventory_id", "inventory_root", "inventory_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_sample_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root")
    REFERENCES "tokenless_dsa_reference_samples"
      ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_label_set_fk"
    FOREIGN KEY ("workspace_id", "label_set_id", "epoch_id", "label_root", "label_set_hash")
    REFERENCES "tokenless_dsa_reference_label_sets"
      ("workspace_id", "label_set_id", "epoch_id", "label_root", "set_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_method_evidence_fk"
    FOREIGN KEY ("workspace_id", "method_evidence_id", "method_evidence_version", "method_evidence_digest")
    REFERENCES "tokenless_dsa_part8_external_method_evidence"
      ("workspace_id", "method_evidence_id", "method_evidence_version", "evidence_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_previous_fk"
    FOREIGN KEY ("workspace_id", "report_id", "supersedes_report_version", "supersedes_report_digest")
    REFERENCES "tokenless_dsa_part8_report_versions"
      ("workspace_id", "report_id", "report_version", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_versions_identity_check" CHECK (
    "report_id" ~ '^dsa8r_[0-9a-f]{40}$'
    AND "report_version" > 0
    AND "schema_version" = 'rateloop.dsa-part8-report-version.v1'
    AND "contract_id" ~ '^dsa8c_[0-9a-f]{40}$'
    AND "count_result_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_id" ~ '^dci_[0-9a-f]{40}$'
    AND "inventory_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "service_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "reporting_period_end" > "reporting_period_start"
    AND "reporting_period_end" <= "source_frozen_at"
    AND "source_frozen_at" <= "frozen_at"
    AND "transform_version" = 'rateloop.dsa-part8-section-1.6-csv-transform.v2'
    AND "official_template_sha256" = 'sha256:1a687f468468b25b214f505c4a6cb906d6ee8cc80d20f5a60eca383cc1bea71d'
    AND "expected_cell_count" BETWEEN 1 AND 5500
    AND "cell_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "public_file_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "confidential_file_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "report_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "report_digest" = 'sha256:' || encode(digest(convert_to("report_json", 'UTF8'), 'sha256'), 'hex')
    AND "complete_transparency_report" = false
  ),
  CONSTRAINT "tokenless_dsa_part8_report_versions_reference_check" CHECK (
    (("epoch_id" IS NULL AND "commitment_digest" IS NULL AND "sample_digest" IS NULL
      AND "manifest_root" IS NULL AND "label_set_id" IS NULL AND "label_root" IS NULL
      AND "label_set_hash" IS NULL)
     OR
     ("epoch_id" ~ '^rse_[0-9a-f]{40}$'
      AND "commitment_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "sample_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "manifest_root" ~ '^sha256:[0-9a-f]{64}$'
      AND "label_set_id" ~ '^rsls_[0-9a-f]{40}$'
      AND "label_root" ~ '^sha256:[0-9a-f]{64}$'
      AND "label_set_hash" ~ '^sha256:[0-9a-f]{64}$'))
  ),
  CONSTRAINT "tokenless_dsa_part8_report_versions_method_check" CHECK (
    (("artifact_designation" = 'section_1_6_draft_only'
      AND "method_review_status" = 'pending_external_method_review'
      AND "method_declaration" = 'pending_external_method_review'
      AND "method_evidence_id" IS NULL AND "method_evidence_version" IS NULL
      AND "method_evidence_digest" IS NULL AND "publication_eligible" = false)
     OR
     ("artifact_designation" = 'section_1_6_method_accepted'
      AND "method_review_status" = 'accepted_external_method_review'
      AND "method_declaration" = 'accepted_external_method_v1'
      AND "method_evidence_id" ~ '^dsa8m_[0-9a-f]{40}$'
      AND "method_evidence_version" > 0
      AND "method_evidence_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "publication_eligible" = true))
  ),
  CONSTRAINT "tokenless_dsa_part8_report_versions_correction_check" CHECK (
    (("report_version" = 1 AND "supersedes_report_version" IS NULL
      AND "supersedes_report_digest" IS NULL AND "correction_reason" IS NULL
      AND "change_summary_json" IS NULL)
     OR
     ("report_version" > 1 AND "supersedes_report_version" = "report_version" - 1
      AND "supersedes_report_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND char_length(btrim("correction_reason")) BETWEEN 1 AND 500
      AND char_length("change_summary_json") BETWEEN 2 AND 2000))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_part8_report_versions_scope_idx"
  ON "tokenless_dsa_part8_report_versions" USING btree
  ("workspace_id", "service_id", "reporting_period_start", "reporting_period_end", "report_id", "report_version");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_report_cells" (
  "workspace_id" text NOT NULL,
  "report_id" text NOT NULL,
  "report_version" integer NOT NULL,
  "contract_id" text NOT NULL,
  "row_number" integer NOT NULL,
  "applicability" text NOT NULL,
  "service" text NOT NULL,
  "reporting_period" text NOT NULL,
  "section" text NOT NULL,
  "indicator" text NOT NULL,
  "scope" text NOT NULL,
  "value" text NOT NULL,
  "context_json" text NOT NULL,
  "calculation_kind" text NOT NULL,
  "count_indicator" text,
  "count_scope" text,
  "count_cell_hash" text,
  "calculation_binding_json" text NOT NULL,
  "calculation_binding_hash" text NOT NULL,
  "cell_json" text NOT NULL,
  "cell_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_report_cells_pk"
    PRIMARY KEY ("workspace_id", "report_id", "report_version", "row_number"),
  CONSTRAINT "tokenless_dsa_part8_report_cells_exact_unique"
    UNIQUE ("workspace_id", "report_id", "report_version", "row_number", "cell_hash"),
  CONSTRAINT "tokenless_dsa_part8_report_cells_calculation_unique"
    UNIQUE ("workspace_id", "report_id", "report_version", "calculation_binding_hash"),
  CONSTRAINT "tokenless_dsa_part8_report_cells_report_fk"
    FOREIGN KEY ("workspace_id", "report_id", "report_version")
    REFERENCES "tokenless_dsa_part8_report_versions" ("workspace_id", "report_id", "report_version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_cells_count_cell_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "count_indicator", "count_scope", "count_cell_hash")
    REFERENCES "tokenless_dsa_part8_count_cells"
      ("workspace_id", "contract_id", "indicator", "scope", "cell_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_cells_contract_check" CHECK (
    "row_number" BETWEEN 1 AND 5500
    AND "section" = 'Use of automated means for content moderation'
    AND char_length("applicability") BETWEEN 1 AND 500
    AND char_length("service") BETWEEN 1 AND 200
    AND char_length("reporting_period") BETWEEN 1 AND 50
    AND char_length("indicator") BETWEEN 1 AND 200
    AND char_length("scope") BETWEEN 1 AND 100
    AND char_length("value") <= 32
    AND char_length("context_json") BETWEEN 2 AND 10000
    AND char_length("calculation_binding_json") BETWEEN 2 AND 10000
    AND "calculation_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "calculation_binding_hash" = 'sha256:'
        || encode(digest(convert_to("calculation_binding_json", 'UTF8'), 'sha256'), 'hex')
    AND "cell_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "cell_hash" = 'sha256:' || encode(digest(convert_to("cell_json", 'UTF8'), 'sha256'), 'hex')
    AND "value" ~ '^(|0|[1-9][0-9]*|0\.[0-9]{1,8}|1\.0{1,8})$'
    AND NOT ("applicability" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("service" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("reporting_period" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("section" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("indicator" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("scope" ~ '^[[:space:]]*[=+@-]')
    AND NOT ("value" ~ '^[[:space:]]*[=+@-]')
    AND NOT (concat_ws(E'\n',"applicability","service","reporting_period","section","indicator",
                       "scope","value","context_json")
      ~* '(provider[_ ]?decision|evaluation_[A-Za-z0-9]|dsaobj_|workspace[_ ]?id|reviewer[_ ]?id|account[_ ]?address|0x[0-9a-f]{40})')
    AND (("calculation_kind"='count' AND "count_indicator" IS NOT NULL
          AND "count_scope" IS NOT NULL AND "count_cell_hash" ~ '^sha256:[0-9a-f]{64}$')
         OR ("calculation_kind"='accuracy' AND "count_indicator" IS NULL
             AND "count_scope" IS NULL AND "count_cell_hash" IS NULL))
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_report_files" (
  "workspace_id" text NOT NULL,
  "report_id" text NOT NULL,
  "report_version" integer NOT NULL,
  "file_kind" text NOT NULL,
  "media_type" text NOT NULL,
  "file_bytes" bytea NOT NULL,
  "byte_length" integer NOT NULL,
  "file_digest" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_report_files_pk"
    PRIMARY KEY ("workspace_id", "report_id", "report_version", "file_kind"),
  CONSTRAINT "tokenless_dsa_part8_report_files_exact_unique"
    UNIQUE ("workspace_id", "report_id", "report_version", "file_kind", "file_digest"),
  CONSTRAINT "tokenless_dsa_part8_report_files_report_fk"
    FOREIGN KEY ("workspace_id", "report_id", "report_version")
    REFERENCES "tokenless_dsa_part8_report_versions" ("workspace_id", "report_id", "report_version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_files_contract_check" CHECK (
    (("file_kind" = 'public_csv' AND "media_type" = 'text/csv; charset=utf-8')
     OR ("file_kind" = 'confidential_evidence_json' AND "media_type" = 'application/json'))
    AND "byte_length" BETWEEN 1 AND 20971520
    AND octet_length("file_bytes") = "byte_length"
    AND "file_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "file_digest" = 'sha256:' || encode(digest("file_bytes", 'sha256'), 'hex')
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_report_publications" (
  "workspace_id" text NOT NULL,
  "publication_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "report_id" text NOT NULL,
  "report_version" integer NOT NULL,
  "report_digest" text NOT NULL,
  "public_file_kind" text NOT NULL,
  "public_file_digest" text NOT NULL,
  "audit_head_digest" text NOT NULL,
  "audit_event_id" text NOT NULL,
  "attestation_job_id" text NOT NULL,
  "attestation_artifact_kind" text NOT NULL,
  "public_path" text NOT NULL,
  "complete_transparency_report" boolean NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "retain_until" timestamp with time zone NOT NULL,
  "publication_json" text NOT NULL,
  "publication_digest" text NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_report_publications_pk"
    PRIMARY KEY ("workspace_id", "publication_id"),
  CONSTRAINT "tokenless_dsa_part8_report_publications_report_unique"
    UNIQUE ("workspace_id", "report_id", "report_version"),
  CONSTRAINT "tokenless_dsa_part8_report_publications_path_unique"
    UNIQUE ("public_path"),
  CONSTRAINT "tokenless_dsa_part8_report_publications_report_fk"
    FOREIGN KEY ("workspace_id", "report_id", "report_version", "report_digest")
    REFERENCES "tokenless_dsa_part8_report_versions"
      ("workspace_id", "report_id", "report_version", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_publications_public_file_fk"
    FOREIGN KEY ("workspace_id", "report_id", "report_version", "public_file_kind", "public_file_digest")
    REFERENCES "tokenless_dsa_part8_report_files"
      ("workspace_id", "report_id", "report_version", "file_kind", "file_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_publications_attestation_fk"
    FOREIGN KEY ("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest")
    REFERENCES "tokenless_assurance_attestation_jobs"
      ("workspace_id", "job_id", "artifact_kind", "artifact_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_publications_audit_event_fk"
    FOREIGN KEY ("workspace_id", "audit_event_id", "audit_head_digest")
    REFERENCES "tokenless_audit_events" ("workspace_id", "event_id", "event_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_report_publications_contract_check" CHECK (
    "publication_id" ~ '^dsa8p_[0-9a-f]{40}$'
    AND "schema_version" = 'rateloop.dsa-part8-report-publication.v1'
    AND "report_version" > 0
    AND "report_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "public_file_kind" = 'public_csv'
    AND "public_file_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_head_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_event_id" ~ '^audit_[0-9a-f]{32}$'
    AND "attestation_job_id" ~ '^aat_[0-9a-f]{40}$'
    AND "attestation_artifact_kind" = 'audit_export_head'
    AND "public_path" ~ '^/rate/dsa/part8/reports/dsa8r_[0-9a-f]{40}/versions/[1-9][0-9]*/section-1-6\.csv$'
    AND "public_path" !~* 'latest'
    AND "complete_transparency_report" = false
    AND "retain_until" >= "published_at" + interval '5 years'
    AND "publication_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "publication_digest" = 'sha256:'
        || encode(digest(convert_to("publication_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_dsa_part8_csv_quote(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE WHEN value ~ '[",\r\n]'
    THEN '"' || replace(value, '"', '""') || '"'
    ELSE value END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_dsa_part8_authoritative_accuracy_value(
  target_workspace_id text,
  target_epoch_id text,
  target_label_set_id text,
  target_system_id text,
  target_system_version text,
  target_machine_class text,
  target_scope text,
  target_metric text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  population_count bigint;
  selected_count bigint;
  completed_count bigint;
  tp numeric;
  fp numeric;
  tn numeric;
  fn numeric;
  result_value numeric;
  rendered text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE manifest.selected),
         count(*) FILTER (WHERE manifest.selected AND label.reference_label IN ('pass','fail')),
         coalesce(sum(manifest.probability_denominator::numeric / manifest.probability_numerator)
           FILTER (WHERE manifest.selected AND manifest.automated_outcome='fail'
                    AND label.reference_label='fail'),0),
         coalesce(sum(manifest.probability_denominator::numeric / manifest.probability_numerator)
           FILTER (WHERE manifest.selected AND manifest.automated_outcome='fail'
                    AND label.reference_label='pass'),0),
         coalesce(sum(manifest.probability_denominator::numeric / manifest.probability_numerator)
           FILTER (WHERE manifest.selected AND manifest.automated_outcome='pass'
                    AND label.reference_label='pass'),0),
         coalesce(sum(manifest.probability_denominator::numeric / manifest.probability_numerator)
           FILTER (WHERE manifest.selected AND manifest.automated_outcome='pass'
                    AND label.reference_label='fail'),0)
    INTO population_count,selected_count,completed_count,tp,fp,tn,fn
  FROM tokenless_dsa_reference_sample_manifest manifest
  JOIN tokenless_dsa_reference_evaluation_projections evaluation
    ON evaluation.workspace_id=manifest.workspace_id AND evaluation.epoch_id=manifest.epoch_id
   AND evaluation.unit_id=manifest.unit_id
  JOIN tokenless_dsa_reference_decision_projections decision
    ON decision.workspace_id=evaluation.workspace_id AND decision.epoch_id=evaluation.epoch_id
   AND decision.provider_decision_id=evaluation.provider_decision_id
   AND decision.decision_version=evaluation.decision_version
  LEFT JOIN tokenless_dsa_reference_labels label
    ON label.workspace_id=manifest.workspace_id AND label.label_set_id=target_label_set_id
   AND label.unit_id=manifest.unit_id
  WHERE manifest.workspace_id=target_workspace_id AND manifest.epoch_id=target_epoch_id
    AND manifest.system_id=target_system_id AND manifest.system_version=target_system_version
    AND manifest.machine_class=target_machine_class
    AND (target_scope='Total number'
      OR (target_scope='Own-initiative' AND decision.origin='own_initiative')
      OR (target_scope='NAM Total' AND decision.origin='article16_notice')
      OR (target_scope='NAM Trusted Flagger' AND decision.origin='article16_notice'
          AND decision.notifier_class='trusted_flagger')
      OR (target_scope IN ('bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','it','lt','lv',
                           'mt','nl','pl','pt','ro','sk','sl','sv')
          AND decision.language_codes_json::jsonb ? target_scope));

  IF population_count=0 OR selected_count=0 OR completed_count<>selected_count THEN RETURN NULL; END IF;
  IF target_metric='accuracy' THEN
    result_value := (tp+tn)/population_count;
  ELSIF target_metric='precision' THEN
    IF tp+fp=0 THEN RETURN NULL; END IF;
    result_value := tp/(tp+fp);
  ELSIF target_metric='recall' THEN
    IF tp+fn=0 THEN RETURN NULL; END IF;
    result_value := tp/(tp+fn);
  ELSE
    RETURN NULL;
  END IF;
  IF result_value<0 OR result_value>1 THEN RETURN NULL; END IF;
  rendered := round(result_value,8)::text;
  rendered := regexp_replace(rendered, '0+$', '');
  rendered := regexp_replace(rendered, '\.$', '');
  RETURN rendered;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_part8_report_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  existing_count bigint;
BEGIN
  SELECT report.expected_cell_count INTO expected_count
  FROM tokenless_dsa_part8_report_versions report
  WHERE report.workspace_id=NEW.workspace_id AND report.report_id=NEW.report_id
    AND report.report_version=NEW.report_version
  FOR UPDATE;
  IF TG_TABLE_NAME='tokenless_dsa_part8_report_cells' THEN
    SELECT count(*) INTO existing_count FROM tokenless_dsa_part8_report_cells cell
    WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
      AND cell.report_version=NEW.report_version;
  ELSE
    SELECT count(*) INTO existing_count FROM tokenless_dsa_part8_report_files file
    WHERE file.workspace_id=NEW.workspace_id AND file.report_id=NEW.report_id
      AND file.report_version=NEW.report_version;
    expected_count := 2;
  END IF;
  IF expected_count IS NULL OR existing_count >= expected_count THEN
    RAISE EXCEPTION 'A frozen DSA Part 8 report cannot accept additional children'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_cells_insert_guard
BEFORE INSERT ON "tokenless_dsa_part8_report_cells"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_part8_report_child_insert();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_files_insert_guard
BEFORE INSERT ON "tokenless_dsa_part8_report_files"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_part8_report_child_insert();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_enforce_dsa_part8_report_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cell_count bigint;
  public_file_count bigint;
  confidential_file_count bigint;
  inventory_system_count integer;
  count_expected_cell_count integer;
  count_cell_count bigint;
  accuracy_cell_count bigint;
  expected_accuracy_cell_count integer;
  expected_report_cell_count integer;
  provider_type text;
  invalid_cell_binding_count bigint;
  invalid_count_cell_count bigint;
  invalid_accuracy_cell_count bigint;
  publication_gap_cell_count bigint;
  recomputed_cell_root text;
  reconstructed_public_bytes bytea;
  reconstructed_confidential_json jsonb;
  expected_report_json jsonb;
BEGIN
  SELECT contract.provider_type,result.expected_cell_count
    INTO provider_type,count_expected_cell_count
    FROM tokenless_dsa_part8_count_contracts contract
    JOIN tokenless_dsa_part8_count_results result
      ON result.workspace_id=contract.workspace_id AND result.contract_id=contract.contract_id
    WHERE contract.workspace_id=NEW.workspace_id AND contract.contract_id=NEW.contract_id
      AND result.result_digest=NEW.count_result_digest
      AND contract.inventory_id=NEW.inventory_id AND contract.inventory_root=NEW.inventory_root
      AND contract.inventory_digest=NEW.inventory_digest AND contract.service_id=NEW.service_id
      AND contract.reporting_period_start=NEW.reporting_period_start
      AND contract.reporting_period_end=NEW.reporting_period_end
      AND contract.source_frozen_at=NEW.source_frozen_at
  ;
  IF provider_type IS NULL OR count_expected_cell_count IS NULL THEN
    RAISE EXCEPTION 'Part 8 report has a non-exact count, inventory, service, period, or source binding'
      USING ERRCODE='23514';
  END IF;

  SELECT inventory.expected_system_count INTO inventory_system_count
  FROM tokenless_dsa_classifier_inventories inventory
  WHERE inventory.workspace_id=NEW.workspace_id AND inventory.inventory_id=NEW.inventory_id
    AND inventory.inventory_root=NEW.inventory_root AND inventory.inventory_digest=NEW.inventory_digest;
  IF inventory_system_count IS NULL
     OR (inventory_system_count=0 AND NEW.epoch_id IS NOT NULL)
     OR (inventory_system_count>0 AND NEW.epoch_id IS NULL) THEN
    RAISE EXCEPTION 'Part 8 report reference evidence must exist exactly when the inventory has classifiers'
      USING ERRCODE='23514';
  END IF;
  expected_accuracy_cell_count := inventory_system_count * 3 * CASE provider_type
    WHEN 'vlop' THEN 28
    WHEN 'online_platform' THEN 4
    WHEN 'hosting_service' THEN 3
    ELSE 2
  END;
  expected_report_cell_count := count_expected_cell_count + expected_accuracy_cell_count;
  IF NEW.expected_cell_count<>expected_report_cell_count THEN
    RAISE EXCEPTION 'Part 8 report does not contain the complete Section 1.6 cell set'
      USING ERRCODE='23514';
  END IF;

  expected_report_json := jsonb_build_object(
    'workspaceId',NEW.workspace_id,
    'reportId',NEW.report_id,
    'reportVersion',NEW.report_version,
    'schemaVersion',NEW.schema_version,
    'contractId',NEW.contract_id,
    'countResultDigest',NEW.count_result_digest,
    'inventoryId',NEW.inventory_id,
    'inventoryRoot',NEW.inventory_root,
    'inventoryDigest',NEW.inventory_digest,
    'serviceId',NEW.service_id,
    'reportingPeriodStart',to_char(NEW.reporting_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reportingPeriodEnd',to_char(NEW.reporting_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceFrozenAt',to_char(NEW.source_frozen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reference',CASE WHEN NEW.epoch_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'epochId',NEW.epoch_id,
      'commitmentDigest',NEW.commitment_digest,
      'sampleDigest',NEW.sample_digest,
      'manifestRoot',NEW.manifest_root,
      'labelSetId',NEW.label_set_id,
      'labelRoot',NEW.label_root,
      'labelSetHash',NEW.label_set_hash
    ) END,
    'artifactDesignation',NEW.artifact_designation,
    'methodReviewStatus',NEW.method_review_status,
    'methodEvidence',CASE WHEN NEW.method_evidence_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'methodEvidenceId',NEW.method_evidence_id,
      'methodEvidenceVersion',NEW.method_evidence_version,
      'evidenceDigest',NEW.method_evidence_digest
    ) END,
    'transformVersion',NEW.transform_version,
    'officialTemplateSha256',NEW.official_template_sha256,
    'expectedCellCount',NEW.expected_cell_count,
    'cellRoot',NEW.cell_root,
    'publicFileDigest',NEW.public_file_digest,
    'confidentialFileDigest',NEW.confidential_file_digest,
    'supersedesReportVersion',to_jsonb(NEW.supersedes_report_version),
    'supersedesReportDigest',to_jsonb(NEW.supersedes_report_digest),
    'correctionReason',to_jsonb(NEW.correction_reason),
    'changeSummary',coalesce(NEW.change_summary_json::jsonb,'null'::jsonb),
    'methodDeclaration',NEW.method_declaration,
    'completeTransparencyReport',NEW.complete_transparency_report,
    'publicationEligible',NEW.publication_eligible,
    'createdBy',NEW.created_by,
    'frozenAt',to_char(NEW.frozen_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  IF NEW.report_json::jsonb <> expected_report_json THEN
    RAISE EXCEPTION 'Part 8 report JSON does not exactly bind its immutable relational evidence'
      USING ERRCODE='23514';
  END IF;

  IF NEW.label_set_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tokenless_dsa_reference_label_sets labels
    WHERE labels.workspace_id=NEW.workspace_id AND labels.label_set_id=NEW.label_set_id
      AND labels.coverage_gap IS NOT NULL AND NEW.publication_eligible=true
  ) THEN
    RAISE EXCEPTION 'Part 8 report with incomplete reference labels cannot be publication eligible'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO cell_count FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version;
  SELECT count(*) FILTER (WHERE cell.calculation_kind='count'),
         count(*) FILTER (WHERE cell.calculation_kind='accuracy')
    INTO count_cell_count,accuracy_cell_count
  FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version;
  SELECT count(*) INTO invalid_cell_binding_count FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version AND (
      cell.contract_id<>NEW.contract_id
      OR cell.cell_json::jsonb <> jsonb_build_object(
        'rowNumber',cell.row_number,
        'columns',jsonb_build_array(cell.applicability,cell.service,cell.reporting_period,cell.section,
                                    cell.indicator,cell.scope,cell.value,cell.context_json),
        'calculationBindingHash',cell.calculation_binding_hash
      )
      OR cell.calculation_binding_json::jsonb <> CASE WHEN cell.calculation_kind='count' THEN
        jsonb_build_object(
          'kind','count','indicator',cell.count_indicator,'scope',cell.count_scope,
          'countCellHash',cell.count_cell_hash
        )
      ELSE
        jsonb_build_object(
          'kind','accuracy',
          'systemId',cell.calculation_binding_json::jsonb ->> 'systemId',
          'systemVersion',cell.calculation_binding_json::jsonb ->> 'systemVersion',
          'machineClass',cell.calculation_binding_json::jsonb ->> 'machineClass',
          'metric',cell.calculation_binding_json::jsonb ->> 'metric',
          'scope',cell.scope,
          'estimatorVersion','horvitz-thompson-system-stratified-point-estimate-v3',
          'frameRoot',cell.calculation_binding_json::jsonb ->> 'frameRoot',
          'sampleDigest',NEW.sample_digest,
          'labelSetRoot',NEW.label_root
        )
      END
      OR cell.context_json::jsonb #>> '{methodology,artifactDesignation}' IS DISTINCT FROM NEW.artifact_designation
      OR cell.context_json::jsonb #>> '{methodology,methodReviewStatus}' IS DISTINCT FROM NEW.method_review_status
      OR (NEW.method_evidence_digest IS NULL
          AND cell.context_json::jsonb #> '{methodology,externalMethodEvidenceDigest}' IS NOT NULL)
      OR (NEW.method_evidence_digest IS NOT NULL
          AND cell.context_json::jsonb #>> '{methodology,externalMethodEvidenceDigest}'
              IS DISTINCT FROM NEW.method_evidence_digest)
    );
  SELECT count(*) INTO invalid_count_cell_count
  FROM tokenless_dsa_part8_report_cells cell
  LEFT JOIN tokenless_dsa_part8_count_cells source
    ON source.workspace_id=cell.workspace_id AND source.contract_id=cell.contract_id
   AND source.indicator=cell.count_indicator AND source.scope=cell.count_scope
   AND source.cell_hash=cell.count_cell_hash
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version AND cell.calculation_kind='count'
    AND (source.cell_hash IS NULL
      OR source.result_digest<>NEW.count_result_digest
      OR cell.indicator<>CASE source.indicator
          WHEN 'measures_solely_automated' THEN 'Number of measures solely taken by automated means'
          WHEN 'measures_not_automated' THEN 'Number of measures not taken by automated means'
          WHEN 'notices_solely_automated' THEN 'Number of notices solely processed by automated means'
          WHEN 'notices_not_automated' THEN 'Number of notices not processed by automated means'
        END
      OR (source.result_kind='count'
          AND (cell.value<>source.count_value::text OR cell.context_json::jsonb ? 'gap'))
      OR (source.result_kind='coverage_gap'
          AND (cell.value<>'' OR NOT (cell.context_json::jsonb ? 'gap')
               OR cell.context_json::jsonb #>> '{gap,code}' IS DISTINCT FROM source.gap_code
               OR cell.context_json::jsonb #> '{gap,affectedNoticeCount}'
                    IS DISTINCT FROM to_jsonb(source.affected_notice_count))));
  SELECT count(*) INTO invalid_accuracy_cell_count
  FROM tokenless_dsa_part8_report_cells cell
  JOIN tokenless_dsa_reference_sampling_epochs epoch
    ON epoch.workspace_id=NEW.workspace_id AND epoch.epoch_id=NEW.epoch_id
  LEFT JOIN tokenless_dsa_classifier_inventory_entries inventory_entry
    ON inventory_entry.workspace_id=NEW.workspace_id AND inventory_entry.inventory_id=NEW.inventory_id
   AND inventory_entry.system_id=cell.calculation_binding_json::jsonb ->> 'systemId'
   AND inventory_entry.system_version=cell.calculation_binding_json::jsonb ->> 'systemVersion'
   AND inventory_entry.machine_class=cell.calculation_binding_json::jsonb ->> 'machineClass'
  CROSS JOIN LATERAL (
    SELECT tokenless_dsa_part8_authoritative_accuracy_value(
      NEW.workspace_id,NEW.epoch_id,NEW.label_set_id,
      cell.calculation_binding_json::jsonb ->> 'systemId',
      cell.calculation_binding_json::jsonb ->> 'systemVersion',
      cell.calculation_binding_json::jsonb ->> 'machineClass',
      cell.scope,cell.calculation_binding_json::jsonb ->> 'metric'
    ) AS value
  ) authoritative
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version AND cell.calculation_kind='accuracy'
    AND (inventory_entry.system_id IS NULL
      OR cell.calculation_binding_json::jsonb ->> 'kind'<>'accuracy'
      OR cell.calculation_binding_json::jsonb ->> 'estimatorVersion'
          <> 'horvitz-thompson-system-stratified-point-estimate-v3'
      OR cell.calculation_binding_json::jsonb ->> 'scope'<>cell.scope
      OR cell.calculation_binding_json::jsonb ->> 'sampleDigest'<>NEW.sample_digest
      OR cell.calculation_binding_json::jsonb ->> 'labelSetRoot'<>NEW.label_root
      OR cell.calculation_binding_json::jsonb ->> 'frameRoot'<>epoch.frame_root
      OR cell.indicator<>CASE cell.calculation_binding_json::jsonb ->> 'metric'
          WHEN 'accuracy' THEN 'Accuracy of the automated means - Accuracy'
          WHEN 'precision' THEN 'Accuracy of the automated means - Precision'
          WHEN 'recall' THEN 'Accuracy of the automated means - Recall'
        END
      OR (authoritative.value IS NULL
          AND (cell.value<>'' OR NOT (cell.context_json::jsonb ? 'gap')))
      OR (authoritative.value IS NOT NULL
          AND (cell.value<>authoritative.value OR cell.context_json::jsonb ? 'gap')));
  SELECT count(*) INTO publication_gap_cell_count
  FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version AND NEW.publication_eligible=true
    AND (cell.value='' OR cell.context_json::jsonb ? 'gap'
         OR cell.calculation_binding_json::jsonb ? 'gap');
  SELECT count(*) INTO public_file_count FROM tokenless_dsa_part8_report_files file
  WHERE file.workspace_id=NEW.workspace_id AND file.report_id=NEW.report_id
    AND file.report_version=NEW.report_version AND file.file_kind='public_csv'
    AND file.file_digest=NEW.public_file_digest;
  SELECT count(*) INTO confidential_file_count FROM tokenless_dsa_part8_report_files file
  WHERE file.workspace_id=NEW.workspace_id AND file.report_id=NEW.report_id
    AND file.report_version=NEW.report_version AND file.file_kind='confidential_evidence_json'
    AND file.file_digest=NEW.confidential_file_digest;
  SELECT 'sha256:' || encode(digest(
           convert_to('rateloop.dsa-part8-report-cells.v1','UTF8') || decode('00','hex')
           || convert_to(coalesce(string_agg(cell.cell_json || E'\n','' ORDER BY cell.row_number),''),'UTF8'),
           'sha256'), 'hex')
    INTO recomputed_cell_root
  FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version;
  SELECT convert_to(
    'Applicability,Service,Reporting period,Section,Indicator,Scope,Value,Contextual Information' || E'\r\n'
    || string_agg(
      tokenless_dsa_part8_csv_quote(cell.applicability) || ','
      || tokenless_dsa_part8_csv_quote(cell.service) || ','
      || tokenless_dsa_part8_csv_quote(cell.reporting_period) || ','
      || tokenless_dsa_part8_csv_quote(cell.section) || ','
      || tokenless_dsa_part8_csv_quote(cell.indicator) || ','
      || tokenless_dsa_part8_csv_quote(cell.scope) || ','
      || tokenless_dsa_part8_csv_quote(cell.value) || ','
      || tokenless_dsa_part8_csv_quote(cell.context_json) || E'\r\n',
      '' ORDER BY cell.row_number), 'UTF8')
    INTO reconstructed_public_bytes
  FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version;
  SELECT jsonb_build_object(
    'schemaVersion','rateloop.dsa-part8-confidential-evidence.v1',
    'reportId',NEW.report_id,
    'reportVersion',NEW.report_version,
    'bindings',jsonb_build_object(
      'contractId',NEW.contract_id,
      'countResultDigest',NEW.count_result_digest,
      'inventoryId',NEW.inventory_id,
      'inventoryRoot',NEW.inventory_root,
      'inventoryDigest',NEW.inventory_digest,
      'reference',CASE WHEN NEW.epoch_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
        'epochId',NEW.epoch_id,
        'commitmentDigest',NEW.commitment_digest,
        'sampleDigest',NEW.sample_digest,
        'manifestRoot',NEW.manifest_root,
        'labelSetId',NEW.label_set_id,
        'labelRoot',NEW.label_root,
        'labelSetHash',NEW.label_set_hash
      ) END
    ),
    'cellRoot',NEW.cell_root,
    'cells',coalesce(jsonb_agg(jsonb_build_object(
      'rowNumber',cell.row_number,
      'columns',jsonb_build_array(cell.applicability,cell.service,cell.reporting_period,cell.section,
                                  cell.indicator,cell.scope,cell.value,cell.context_json),
      'calculation',cell.calculation_binding_json::jsonb,
      'calculationBindingHash',cell.calculation_binding_hash,
      'cellHash',cell.cell_hash
    ) ORDER BY cell.row_number),'[]'::jsonb)
  ) INTO reconstructed_confidential_json
  FROM tokenless_dsa_part8_report_cells cell
  WHERE cell.workspace_id=NEW.workspace_id AND cell.report_id=NEW.report_id
    AND cell.report_version=NEW.report_version;
  IF cell_count <> NEW.expected_cell_count OR invalid_cell_binding_count <> 0
     OR count_cell_count<>count_expected_cell_count OR accuracy_cell_count<>expected_accuracy_cell_count
     OR invalid_count_cell_count <> 0 OR invalid_accuracy_cell_count <> 0
     OR publication_gap_cell_count <> 0 OR recomputed_cell_root<>NEW.cell_root
     OR public_file_count <> 1 OR confidential_file_count <> 1 THEN
    RAISE EXCEPTION 'Part 8 report cells and exact files are incomplete'
      USING ERRCODE='23514', DETAIL=format(
        'cells=%s/%s count=%s/%s accuracy=%s/%s binding=%s count_invalid=%s accuracy_invalid=%s gaps=%s root_match=%s public=%s confidential=%s',
        cell_count,NEW.expected_cell_count,count_cell_count,count_expected_cell_count,
        accuracy_cell_count,expected_accuracy_cell_count,invalid_cell_binding_count,invalid_count_cell_count,
        invalid_accuracy_cell_count,publication_gap_cell_count,recomputed_cell_root=NEW.cell_root,
        public_file_count,confidential_file_count
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_part8_report_files file
    WHERE file.workspace_id=NEW.workspace_id AND file.report_id=NEW.report_id
      AND file.report_version=NEW.report_version AND file.file_kind='public_csv'
      AND file.file_bytes=reconstructed_public_bytes
  ) THEN
    RAISE EXCEPTION 'Part 8 public CSV bytes do not reconstruct from the immutable cells'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_part8_report_files file
    WHERE file.workspace_id=NEW.workspace_id AND file.report_id=NEW.report_id
      AND file.report_version=NEW.report_version AND file.file_kind='confidential_evidence_json'
      AND convert_from(file.file_bytes,'UTF8')::jsonb=reconstructed_confidential_json
  ) THEN
    RAISE EXCEPTION 'Part 8 confidential bytes do not reconstruct their immutable evidence bindings'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_part8_report_complete_at_commit
AFTER INSERT ON "tokenless_dsa_part8_report_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_enforce_dsa_part8_report_complete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_part8_report_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_part8_report_versions report
    JOIN tokenless_audit_events audit
      ON audit.workspace_id=NEW.workspace_id AND audit.event_id=NEW.audit_event_id
     AND audit.event_digest=NEW.audit_head_digest
     AND audit.actor_kind='account' AND audit.actor_reference=NEW.created_by
     AND audit.assurance_method='workspace_manager_session'
     AND audit.action='dsa_part8_report_publication_enqueued'
     AND audit.target_kind='dsa_part8_report_version'
     AND audit.target_id=NEW.report_id || ':' || NEW.report_version::text
     AND audit.purpose='dsa_part8_reporting' AND audit.result='success'
     AND audit.occurred_at=NEW.published_at
     AND audit.metadata_json::jsonb=jsonb_build_object(
       'reportId',NEW.report_id,'reportVersion',NEW.report_version,
       'reportDigest',NEW.report_digest,'publicPath',NEW.public_path
     )
    JOIN tokenless_assurance_attestation_jobs attestation
      ON attestation.workspace_id=NEW.workspace_id AND attestation.job_id=NEW.attestation_job_id
     AND attestation.artifact_kind=NEW.attestation_artifact_kind
     AND attestation.artifact_digest=NEW.audit_head_digest
     AND attestation.artifact_schema_version='rateloop-audit-v1'
     AND attestation.boundary_at=NEW.published_at
    WHERE report.workspace_id=NEW.workspace_id AND report.report_id=NEW.report_id
      AND report.report_version=NEW.report_version AND report.report_digest=NEW.report_digest
      AND report.artifact_designation='section_1_6_method_accepted'
      AND report.method_review_status='accepted_external_method_review'
      AND report.method_evidence_id IS NOT NULL AND report.publication_eligible=true
      AND report.complete_transparency_report=false
      AND NEW.publication_json::jsonb=jsonb_build_object(
        'schemaVersion',NEW.schema_version,
        'publicationId',NEW.publication_id,
        'reportId',NEW.report_id,
        'reportVersion',NEW.report_version,
        'reportDigest',NEW.report_digest,
        'publicFileDigest',NEW.public_file_digest,
        'auditEventId',NEW.audit_event_id,
        'auditHeadDigest',NEW.audit_head_digest,
        'attestationJobId',NEW.attestation_job_id,
        'publicPath',NEW.public_path,
        'completeTransparencyReport',NEW.complete_transparency_report,
        'publishedAt',to_char(NEW.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'retainUntil',to_char(NEW.retain_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
      AND NOT EXISTS (
        SELECT 1 FROM tokenless_dsa_part8_report_cells cell
        WHERE cell.workspace_id=report.workspace_id AND cell.report_id=report.report_id
          AND cell.report_version=report.report_version
          AND (cell.value='' OR cell.context_json::jsonb ? 'gap'
               OR cell.calculation_binding_json::jsonb ? 'gap')
      )
      AND (report.label_set_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM tokenless_dsa_reference_label_sets labels
        WHERE labels.workspace_id=report.workspace_id AND labels.label_set_id=report.label_set_id
          AND labels.coverage_gap IS NOT NULL
      ))
  ) THEN
    RAISE EXCEPTION 'Only an externally accepted, exactly attested Section 1.6 artifact may be published'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_publication_guard
BEFORE INSERT ON "tokenless_dsa_part8_report_publications"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_part8_report_publication();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_external_method_evidence_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_external_method_evidence"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_report_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_cells_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_report_cells"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_files_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_report_files"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_report_publications_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_report_publications"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

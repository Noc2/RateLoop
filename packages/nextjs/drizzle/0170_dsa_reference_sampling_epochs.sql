CREATE OR REPLACE FUNCTION tokenless_dsa_evidence_commit_timestamp()
RETURNS timestamp with time zone
LANGUAGE sql
VOLATILE
AS $$
  SELECT clock_timestamp()
$$;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_attestation_jobs"
  ADD CONSTRAINT "tokenless_assurance_attestation_jobs_reference_binding_unique"
  UNIQUE ("workspace_id", "job_id", "artifact_kind", "artifact_digest");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_sampling_epochs" (
  "epoch_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "context_authority" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "purpose" text NOT NULL,
  "sample_size_plan_id" text NOT NULL,
  "sample_size_plan_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "frame_id" text NOT NULL,
  "method_version" text NOT NULL,
  "request_json" text NOT NULL,
  "request_hash" text NOT NULL,
  "population_contract_hash" text NOT NULL,
  "population_root" text NOT NULL,
  "population_frozen_at" timestamp with time zone NOT NULL,
  "reporting_window_start" timestamp with time zone NOT NULL,
  "reporting_window_end" timestamp with time zone NOT NULL,
  "population_count" integer NOT NULL,
  "eligible_draw_unit_count" integer NOT NULL,
  "evaluated_decision_count" integer NOT NULL,
  "not_automated_decision_count" integer NOT NULL,
  "excluded_decision_count" integer NOT NULL,
  "strata_json" text NOT NULL,
  "strata_hash" text NOT NULL,
  "beacon_network" text NOT NULL,
  "beacon_round" bigint NOT NULL,
  "beacon_available_at" timestamp with time zone NOT NULL,
  "source_frozen_at" timestamp with time zone NOT NULL,
  "committed_at" timestamp with time zone NOT NULL,
  "frame_root" text NOT NULL,
  "commitment_digest" text NOT NULL,
  "commitment_json" text NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_scope_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "purpose"),
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_workspace_epoch_unique"
    UNIQUE ("workspace_id", "epoch_id"),
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_population_binding_unique"
    UNIQUE ("workspace_id", "epoch_id", "population_id", "population_version"),
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_workspace_frame_unique"
    UNIQUE ("workspace_id", "frame_id"),
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_sample_binding_unique"
    UNIQUE ("workspace_id", "epoch_id", "commitment_digest", "beacon_network", "beacon_round"),
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions" ("workspace_id", "population_id", "version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sampling_epochs_contract_check" CHECK (
    "epoch_id" ~ '^rse_[0-9a-f]{40}$'
    AND "frame_id" ~ '^rsf_[0-9a-f]{40}$'
    AND "schema_version" = 'rateloop.reference-sampling-frame.v3'
    AND "method_version" = 'stratified-sha256-rank-without-replacement-v1'
    AND "context_authority" = 'workspace_manager_asserted_context'
    AND "purpose" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    AND "sample_size_plan_version" > 0
    AND "population_version" > 0
    AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "population_contract_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "population_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "frame_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "commitment_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "strata_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reporting_window_end" > "reporting_window_start"
    AND "population_frozen_at" <= "source_frozen_at"
    AND "source_frozen_at" <= "committed_at"
    AND "beacon_available_at" >= "committed_at" + interval '5 minutes'
    AND "beacon_network" IN ('quicknet', 'quicknet-t')
    AND "beacon_round" > 0
    AND "population_count" BETWEEN 1 AND 50000
    AND "eligible_draw_unit_count" BETWEEN 1 AND 50000
    AND "evaluated_decision_count" BETWEEN 0 AND 50000
    AND "not_automated_decision_count" BETWEEN 0 AND 50000
    AND "excluded_decision_count" BETWEEN 0 AND 50000
    AND "evaluated_decision_count" + "not_automated_decision_count"
        + "excluded_decision_count" = "population_count"
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_sampling_epochs_context_idx"
  ON "tokenless_dsa_reference_sampling_epochs" USING btree
  ("workspace_id", "project_id", "benchmark_id", "purpose", "committed_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_reference_beacon_lead_at_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.beacon_available_at < clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'DSA reference-sampling beacon must remain at least five minutes in the future at commit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_beacon_lead_at_commit
AFTER INSERT ON "tokenless_dsa_reference_sampling_epochs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_reference_beacon_lead_at_commit();--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_decision_projections" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "engagement_id" text NOT NULL,
  "engagement_version" integer NOT NULL,
  "source_decision_binding" text NOT NULL,
  "source_decision_hash" text NOT NULL,
  "engagement_hash" text NOT NULL,
  "measure_taken" boolean NOT NULL,
  "moderation_measure_id" text,
  "part8_fact_json" text NOT NULL,
  "part8_fact_hash" text NOT NULL,
  "origin" text NOT NULL,
  "article16_notice_id" text,
  "notifier_class" text,
  "decision_at" timestamp with time zone NOT NULL,
  "source_eligibility_status" text NOT NULL,
  "source_exclusion_reason" text,
  "automation_processing" text NOT NULL,
  "expected_evaluation_count" integer NOT NULL,
  "evaluation_set_root" text NOT NULL,
  "language_codes_json" text NOT NULL,
  "no_language_reason" text,
  "disposition" text NOT NULL,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_decision_projections_pk"
    PRIMARY KEY ("workspace_id", "epoch_id", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_reference_decision_projections_epoch_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id", "epoch_id", "population_id", "population_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_decision_projections_population_binding_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version", "provider_decision_id", "decision_version",
                 "engagement_id", "engagement_version")
    REFERENCES "tokenless_dsa_engagement_versions"
      ("workspace_id", "population_id", "population_version", "provider_decision_id", "decision_version",
       "engagement_id", "engagement_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_decision_projections_part8_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_content_moderation_decision_facts"
      ("workspace_id", "provider_decision_id", "decision_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_decision_projections_contract_check" CHECK (
    "source_decision_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "engagement_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND ((("measure_taken" = true
           AND "moderation_measure_id" ~ '^measure_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$')
          OR ("measure_taken" = false AND "moderation_measure_id" IS NULL))) IS TRUE
    AND "part8_fact_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_eligibility_status" IN ('eligible', 'excluded')
    AND "origin" IN ('authority_order', 'article16_notice', 'own_initiative')
    AND ((("origin" = 'article16_notice'
          AND "article16_notice_id" ~ '^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
          AND "notifier_class" IN ('trusted_flagger', 'other'))
         OR ("origin" <> 'article16_notice' AND "article16_notice_id" IS NULL AND "notifier_class" IS NULL))) IS TRUE
    AND "automation_processing" IN ('solely_automated', 'partially_automated', 'not_automated')
    AND "expected_evaluation_count" >= 0
    AND "evaluation_set_root" ~ '^sha256:[0-9a-f]{64}$'
    AND tokenless_dsa_part8_language_codes_are_canonical("language_codes_json")
    AND ((("language_codes_json" <> '[]' AND "no_language_reason" IS NULL)
         OR ("language_codes_json" = '[]'
             AND "no_language_reason" IN ('no_linguistic_content', 'language_undetermined', 'not_applicable')))) IS TRUE
    AND ((
      ("source_eligibility_status" = 'excluded'
       AND "source_exclusion_reason" ~ '^[a-z][a-z0-9_]{2,79}$'
       AND "disposition" = 'excluded')
      OR
      ("source_eligibility_status" = 'eligible' AND "source_exclusion_reason" IS NULL
       AND ((("automation_processing" = 'not_automated' AND "disposition" = 'not_automated')
             OR ("automation_processing" IN ('solely_automated', 'partially_automated')
                 AND "disposition" = 'evaluated'))) IS TRUE)
    )) IS TRUE
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_decision_projections_disposition_idx"
  ON "tokenless_dsa_reference_decision_projections" USING btree
  ("workspace_id", "epoch_id", "disposition", "provider_decision_id", "decision_version");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_evaluation_projections" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "evaluation_id" text NOT NULL,
  "unit_id" text,
  "source_decision_binding" text NOT NULL,
  "source_evaluation_binding" text NOT NULL,
  "source_evaluation_hash" text NOT NULL,
  "evaluation_json" text NOT NULL,
  "evaluation_hash" text NOT NULL,
  "decision_at" timestamp with time zone NOT NULL,
  "source_eligibility_status" text NOT NULL,
  "source_exclusion_reason" text,
  "automation_processing" text NOT NULL,
  "system_identity" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "machine_class" text NOT NULL,
  "public_designation" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "disposition" text NOT NULL,
  "reference_label_state" text NOT NULL,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_pk"
    PRIMARY KEY ("workspace_id", "epoch_id", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_source_unique"
    UNIQUE ("workspace_id", "epoch_id", "provider_decision_id", "decision_version", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_unit_unique"
    UNIQUE ("workspace_id", "epoch_id", "unit_id"),
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_manifest_binding_unique"
    UNIQUE ("workspace_id", "epoch_id", "unit_id", "source_decision_binding", "source_evaluation_binding",
            "source_evaluation_hash", "decision_at", "automation_processing", "system_identity", "automated_outcome"),
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_epoch_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id", "epoch_id", "population_id", "population_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_decision_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_reference_decision_projections"
      ("workspace_id", "epoch_id", "provider_decision_id", "decision_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_source_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "evaluation_id")
    REFERENCES "tokenless_dsa_automated_means_evaluations"
      ("workspace_id", "provider_decision_id", "decision_version", "evaluation_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_contract_check" CHECK (
    "evaluation_id" ~ '^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND ("unit_id" IS NULL OR "unit_id" ~ '^rsu_[A-Za-z0-9_-]{22}$')
  ),
  CONSTRAINT "tokenless_dsa_reference_evaluation_projections_evidence_check" CHECK (
    "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "evaluation_hash" = "source_evaluation_hash"
    AND "evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "automation_processing" IN ('solely_automated', 'partially_automated')
    AND "system_identity" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "machine_class" IN (
      'text_classifier', 'image_classifier', 'audio_classifier', 'video_classifier',
      'multimodal_classifier', 'rules_engine', 'other_machine_class'
    )
    AND char_length("public_designation") BETWEEN 1 AND 160
    AND "public_designation" = btrim("public_designation")
    AND NOT ("public_designation" ~ '^[=+@-]')
    AND "automated_outcome" IN ('pass', 'fail')
    AND "source_eligibility_status" IN ('eligible', 'excluded')
    AND "reference_label_state" = 'unlabeled'
    AND ((
      ("source_eligibility_status" = 'excluded'
       AND "source_exclusion_reason" ~ '^[a-z][a-z0-9_]{2,79}$'
       AND "disposition" = 'excluded' AND "unit_id" IS NULL)
      OR
      ("source_eligibility_status" = 'eligible' AND "source_exclusion_reason" IS NULL
       AND "disposition" = 'eligible_draw' AND "unit_id" ~ '^rsu_[A-Za-z0-9_-]{22}$')
    )) IS TRUE
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_evaluation_projections_disposition_idx"
  ON "tokenless_dsa_reference_evaluation_projections" USING btree
  ("workspace_id", "epoch_id", "disposition", "system_identity", "automated_outcome", "unit_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_reference_epoch_complete_at_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_count integer;
  evaluated_count integer;
  not_automated_count integer;
  excluded_count integer;
  projected_evaluation_count integer;
  eligible_evaluation_count integer;
  source_evaluation_count integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE disposition = 'evaluated'),
         count(*) FILTER (WHERE disposition = 'not_automated'),
         count(*) FILTER (WHERE disposition = 'excluded')
    INTO decision_count,evaluated_count,not_automated_count,excluded_count
  FROM tokenless_dsa_reference_decision_projections
  WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id;

  SELECT count(*),count(*) FILTER (WHERE disposition = 'eligible_draw')
    INTO projected_evaluation_count,eligible_evaluation_count
  FROM tokenless_dsa_reference_evaluation_projections
  WHERE workspace_id=NEW.workspace_id AND epoch_id=NEW.epoch_id;

  SELECT count(*) INTO source_evaluation_count
  FROM tokenless_dsa_engagement_versions e
  JOIN tokenless_dsa_automated_means_evaluations ev
    ON ev.workspace_id=e.workspace_id
   AND ev.provider_decision_id=e.provider_decision_id
   AND ev.decision_version=e.decision_version
  WHERE e.workspace_id=NEW.workspace_id
    AND e.population_id=NEW.population_id
    AND e.population_version=NEW.population_version;

  IF decision_count <> NEW.population_count
     OR evaluated_count <> NEW.evaluated_decision_count
     OR not_automated_count <> NEW.not_automated_decision_count
     OR excluded_count <> NEW.excluded_decision_count
     OR eligible_evaluation_count <> NEW.eligible_draw_unit_count
     OR projected_evaluation_count <> source_evaluation_count THEN
    RAISE EXCEPTION 'DSA reference-sampling epoch does not contain its complete decision and evaluation projections'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_epoch_complete_at_commit
AFTER INSERT ON "tokenless_dsa_reference_sampling_epochs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_reference_epoch_complete_at_commit();--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_samples" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "commitment_digest" text NOT NULL,
  "beacon_network" text NOT NULL,
  "beacon_chain_hash" text NOT NULL,
  "beacon_round" bigint NOT NULL,
  "beacon_randomness" text NOT NULL,
  "beacon_signature" text NOT NULL,
  "beacon_evidence_json" text NOT NULL,
  "beacon_evidence_hash" text NOT NULL,
  "seed_digest" text NOT NULL,
  "manifest_root" text NOT NULL,
  "sample_digest" text NOT NULL,
  "sample_json" text NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_samples_pk" PRIMARY KEY ("workspace_id", "epoch_id"),
  CONSTRAINT "tokenless_dsa_reference_samples_epoch_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "commitment_digest", "beacon_network", "beacon_round")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id", "epoch_id", "commitment_digest", "beacon_network", "beacon_round") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_samples_contract_check" CHECK (
    "schema_version" = 'rateloop.reference-sample.v2'
    AND "commitment_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "beacon_network" IN ('quicknet', 'quicknet-t')
    AND "beacon_round" > 0
    AND "beacon_chain_hash" ~ '^[0-9a-f]{64}$'
    AND "beacon_randomness" ~ '^0x[0-9a-f]{64}$'
    AND "beacon_signature" ~ '^0x[0-9a-f]+$'
    AND "beacon_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "seed_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "sample_digest" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_sample_manifest" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "unit_id" text NOT NULL,
  "source_decision_binding" text NOT NULL,
  "source_evaluation_binding" text NOT NULL,
  "source_evaluation_hash" text NOT NULL,
  "decision_at" timestamp with time zone NOT NULL,
  "automation_processing" text NOT NULL,
  "system_identity" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "machine_class" text NOT NULL,
  "public_designation" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "selected" boolean NOT NULL,
  "selection_rank" integer NOT NULL,
  "probability_numerator" integer NOT NULL,
  "probability_denominator" integer NOT NULL,
  "manifest_row_json" text NOT NULL,
  "manifest_row_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_sample_manifest_pk"
    PRIMARY KEY ("workspace_id", "epoch_id", "unit_id"),
  CONSTRAINT "tokenless_dsa_reference_sample_manifest_sample_fk"
    FOREIGN KEY ("workspace_id", "epoch_id")
    REFERENCES "tokenless_dsa_reference_samples" ("workspace_id", "epoch_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sample_manifest_projection_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "unit_id", "source_decision_binding", "source_evaluation_binding",
                 "source_evaluation_hash", "decision_at", "automation_processing", "system_identity", "automated_outcome")
    REFERENCES "tokenless_dsa_reference_evaluation_projections"
      ("workspace_id", "epoch_id", "unit_id", "source_decision_binding", "source_evaluation_binding",
       "source_evaluation_hash", "decision_at", "automation_processing", "system_identity", "automated_outcome")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sample_manifest_contract_check" CHECK (
    "unit_id" ~ '^rsu_[A-Za-z0-9_-]{22}$'
    AND "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "automation_processing" IN ('solely_automated', 'partially_automated')
    AND "system_identity" ~ '^sha256:[0-9a-f]{64}$'
    AND "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "machine_class" IN (
      'text_classifier', 'image_classifier', 'audio_classifier', 'video_classifier',
      'multimodal_classifier', 'rules_engine', 'other_machine_class'
    )
    AND char_length("public_designation") BETWEEN 1 AND 160
    AND "public_designation" = btrim("public_designation")
    AND NOT ("public_designation" ~ '^[=+@-]')
    AND "automated_outcome" IN ('pass', 'fail')
    AND "selection_rank" > 0
    AND "probability_numerator" BETWEEN 1 AND "probability_denominator"
    AND "manifest_row_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_sample_manifest_selected_idx"
  ON "tokenless_dsa_reference_sample_manifest" USING btree
  ("workspace_id", "epoch_id", "selected", "system_identity", "automated_outcome", "selection_rank");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_reference_sampling_events" (
  "workspace_id" text NOT NULL,
  "epoch_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "schema_version" text NOT NULL,
  "witness_id" text NOT NULL,
  "transition_json" text NOT NULL,
  "transition_hash" text NOT NULL,
  "audit_head_digest" text NOT NULL,
  "attestation_job_id" text NOT NULL,
  "attestation_artifact_kind" text NOT NULL,
  "attestation_requirement" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_reference_sampling_events_pk"
    PRIMARY KEY ("workspace_id", "epoch_id", "sequence"),
  CONSTRAINT "tokenless_dsa_reference_sampling_events_type_unique"
    UNIQUE ("workspace_id", "epoch_id", "event_type"),
  CONSTRAINT "tokenless_dsa_reference_sampling_events_epoch_fk"
    FOREIGN KEY ("workspace_id", "epoch_id")
    REFERENCES "tokenless_dsa_reference_sampling_epochs" ("workspace_id", "epoch_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sampling_events_attestation_fk"
    FOREIGN KEY ("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest")
    REFERENCES "tokenless_assurance_attestation_jobs"
      ("workspace_id", "job_id", "artifact_kind", "artifact_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_reference_sampling_events_contract_check" CHECK (
    "schema_version" = 'rateloop.reference-sampling-transition.v1'
    AND "witness_id" ~ '^rsw_[0-9a-f]{40}$'
    AND "transition_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_head_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "attestation_job_id" ~ '^aat_[0-9a-f]{40}$'
    AND "attestation_artifact_kind" = 'audit_export_head'
    AND "attestation_requirement" = 'enqueued_audit_export_head'
    AND (("sequence" = 1 AND "event_type" = 'committed')
         OR ("sequence" = 2 AND "event_type" = 'frozen'))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_reference_sampling_events_time_idx"
  ON "tokenless_dsa_reference_sampling_events" USING btree
  ("workspace_id", "recorded_at", "epoch_id", "sequence");--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_sampling_epochs_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_sampling_epochs"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_decision_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_decision_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_evaluation_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_evaluation_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_samples_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_samples"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_sample_manifest_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_sample_manifest"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_reference_sampling_events_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_reference_sampling_events"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

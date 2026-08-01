ALTER TABLE "tokenless_audit_events"
  ADD CONSTRAINT "tokenless_audit_events_part8_count_binding_unique"
  UNIQUE ("workspace_id", "event_id", "event_digest");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_contracts" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "population_root" text NOT NULL,
  "population_frozen_at" timestamp with time zone NOT NULL,
  "reconciliation_version" integer NOT NULL,
  "reconciliation_hash" text NOT NULL,
  "inventory_id" text NOT NULL,
  "inventory_root" text NOT NULL,
  "inventory_digest" text NOT NULL,
  "service_id" text NOT NULL,
  "provider_type" text NOT NULL,
  "reporting_period_start" timestamp with time zone NOT NULL,
  "reporting_period_end" timestamp with time zone NOT NULL,
  "schema_version" text NOT NULL,
  "algorithm_version" text NOT NULL,
  "expected_decision_count" integer NOT NULL,
  "expected_measure_count" integer NOT NULL,
  "expected_evaluation_count" integer NOT NULL,
  "expected_notice_count" integer NOT NULL,
  "decision_projection_root" text NOT NULL,
  "measure_projection_root" text NOT NULL,
  "evaluation_projection_root" text NOT NULL,
  "notice_projection_root" text NOT NULL,
  "source_frozen_at" timestamp with time zone NOT NULL,
  "committed_at" timestamp with time zone NOT NULL,
  "audit_event_id" text NOT NULL,
  "audit_head_digest" text NOT NULL,
  "attestation_job_id" text NOT NULL,
  "attestation_artifact_kind" text NOT NULL,
  "attestation_requirement" text NOT NULL,
  "engine_contract_json" text NOT NULL,
  "engine_contract_digest" text NOT NULL,
  "contract_json" text NOT NULL,
  "contract_digest" text NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_pk"
    PRIMARY KEY ("workspace_id", "contract_id"),
  CONSTRAINT "tokenless_dsa_part8_count_contracts_scope_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "service_id"),
  CONSTRAINT "tokenless_dsa_part8_count_contracts_population_binding_unique"
    UNIQUE ("workspace_id", "contract_id", "population_id", "population_version"),
  CONSTRAINT "tokenless_dsa_part8_count_contracts_projection_binding_unique"
    UNIQUE ("workspace_id", "contract_id", "decision_projection_root", "measure_projection_root",
            "evaluation_projection_root", "notice_projection_root", "contract_digest"),
  CONSTRAINT "tokenless_dsa_part8_count_contracts_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions" ("workspace_id", "population_id", "version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_reconciliation_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version", "reconciliation_version")
    REFERENCES "tokenless_dsa_population_reconciliation_versions"
      ("workspace_id", "population_id", "population_version", "reconciliation_version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_inventory_fk"
    FOREIGN KEY ("workspace_id", "inventory_id", "inventory_root", "inventory_digest")
    REFERENCES "tokenless_dsa_classifier_inventories"
      ("workspace_id", "inventory_id", "inventory_root", "inventory_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_attestation_fk"
    FOREIGN KEY ("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest")
    REFERENCES "tokenless_assurance_attestation_jobs"
      ("workspace_id", "job_id", "artifact_kind", "artifact_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_audit_event_fk"
    FOREIGN KEY ("workspace_id", "audit_event_id", "audit_head_digest")
    REFERENCES "tokenless_audit_events" ("workspace_id", "event_id", "event_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_contracts_contract_check" CHECK (
    "contract_id" ~ '^dsa8c_[0-9a-f]{40}$'
    AND "population_version" > 0
    AND "reconciliation_version" > 0
    AND "service_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "provider_type" IN ('intermediary_service','hosting_service','online_platform','vlop','vlose')
    AND "schema_version" = 'rateloop.dsa-part8-witnessed-count-contract.v1'
    AND "algorithm_version" = 'rateloop.dsa-part8-exact-census.v2'
    AND "reporting_period_end" > "reporting_period_start"
    AND "population_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "reconciliation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "decision_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "measure_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "evaluation_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "notice_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "engine_contract_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "contract_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_head_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_event_id" ~ '^audit_[0-9a-f]{32}$'
    AND "attestation_job_id" ~ '^aat_[0-9a-f]{40}$'
    AND "attestation_artifact_kind" = 'audit_export_head'
    AND "attestation_requirement" = 'enqueued_audit_export_head'
    AND "expected_decision_count" BETWEEN 0 AND 50000
    AND "expected_measure_count" BETWEEN 0 AND "expected_decision_count"
    AND "expected_evaluation_count" BETWEEN 0 AND 50000
    AND "expected_notice_count" BETWEEN 0 AND 50000
    AND "population_frozen_at" <= "source_frozen_at"
    AND "reporting_period_end" <= "source_frozen_at"
    AND "source_frozen_at" <= "committed_at"
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_part8_count_contracts_scope_idx"
  ON "tokenless_dsa_part8_count_contracts" USING btree
  ("workspace_id", "population_id", "population_version", "service_id", "committed_at");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_decision_projections" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "source_decision_binding" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "engagement_id" text NOT NULL,
  "engagement_version" integer NOT NULL,
  "source_decision_hash" text NOT NULL,
  "engagement_hash" text NOT NULL,
  "part8_fact_hash" text NOT NULL,
  "decision_at" timestamp with time zone NOT NULL,
  "measure_taken" boolean NOT NULL,
  "moderation_measure_id" text,
  "automation_processing" text NOT NULL,
  "expected_evaluation_count" integer NOT NULL,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_pk"
    PRIMARY KEY ("workspace_id", "contract_id", "source_decision_binding"),
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_source_unique"
    UNIQUE ("workspace_id", "contract_id", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_exact_unique"
    UNIQUE ("workspace_id", "contract_id", "source_decision_binding", "projection_hash"),
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_identity_unique"
    UNIQUE ("workspace_id", "contract_id", "source_decision_binding", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_measure_unique"
    UNIQUE ("workspace_id", "contract_id", "moderation_measure_id"),
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_contract_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_part8_count_contracts"
      ("workspace_id", "contract_id", "population_id", "population_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_source_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_content_moderation_decision_facts"
      ("workspace_id", "provider_decision_id", "decision_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_population_binding_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version", "provider_decision_id",
                 "decision_version", "engagement_id", "engagement_version")
    REFERENCES "tokenless_dsa_engagement_versions"
      ("workspace_id", "population_id", "population_version", "provider_decision_id",
       "decision_version", "engagement_id", "engagement_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_decision_projections_contract_check" CHECK (
    "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_decision_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "engagement_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "part8_fact_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "population_version" > 0 AND "decision_version" > 0 AND "engagement_version" > 0
    AND "expected_evaluation_count" >= 0
    AND "automation_processing" IN ('solely_automated','partially_automated','not_automated')
    AND (("measure_taken" AND "moderation_measure_id" IS NOT NULL)
         OR (NOT "measure_taken" AND "moderation_measure_id" IS NULL))
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_measure_projections" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "source_decision_binding" text NOT NULL,
  "moderation_measure_id" text NOT NULL,
  "decision_projection_hash" text NOT NULL,
  "automation_processing" text NOT NULL,
  "origin" text NOT NULL,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_measure_projections_pk"
    PRIMARY KEY ("workspace_id", "contract_id", "source_decision_binding"),
  CONSTRAINT "tokenless_dsa_part8_count_measure_projections_measure_unique"
    UNIQUE ("workspace_id", "contract_id", "moderation_measure_id"),
  CONSTRAINT "tokenless_dsa_part8_count_measure_projections_decision_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "source_decision_binding", "decision_projection_hash")
    REFERENCES "tokenless_dsa_part8_count_decision_projections"
      ("workspace_id", "contract_id", "source_decision_binding", "projection_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_measure_projections_contract_check" CHECK (
    "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "decision_projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "automation_processing" IN ('solely_automated','partially_automated','not_automated')
    AND "origin" IN ('authority_order','article16_notice','own_initiative')
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_evaluation_projections" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "source_evaluation_binding" text NOT NULL,
  "source_decision_binding" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "evaluation_id" text NOT NULL,
  "source_evaluation_hash" text NOT NULL,
  "decision_at" timestamp with time zone NOT NULL,
  "automation_processing" text NOT NULL,
  "inventory_id" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "machine_class" text NOT NULL,
  "public_designation" text NOT NULL,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_pk"
    PRIMARY KEY ("workspace_id", "contract_id", "source_evaluation_binding"),
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_source_unique"
    UNIQUE ("workspace_id", "contract_id", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_contract_fk"
    FOREIGN KEY ("workspace_id", "contract_id") REFERENCES "tokenless_dsa_part8_count_contracts"
      ("workspace_id", "contract_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_decision_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "source_decision_binding", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_part8_count_decision_projections"
      ("workspace_id", "contract_id", "source_decision_binding", "provider_decision_id", "decision_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_source_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "evaluation_id")
    REFERENCES "tokenless_dsa_automated_means_evaluations"
      ("workspace_id", "provider_decision_id", "decision_version", "evaluation_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_inventory_fk"
    FOREIGN KEY ("workspace_id", "inventory_id", "system_id", "system_version")
    REFERENCES "tokenless_dsa_classifier_inventory_entries"
      ("workspace_id", "inventory_id", "system_id", "system_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_evaluation_projections_contract_check" CHECK (
    "source_evaluation_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_decision_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "decision_version" > 0
    AND "automation_processing" IN ('solely_automated','partially_automated')
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_notice_projections" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "notice_id" text NOT NULL,
  "fact_version" integer NOT NULL,
  "source_notice_binding" text NOT NULL,
  "source_fact_hash" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "processing_status" text NOT NULL,
  "automation_processing" text,
  "notifier_class" text NOT NULL,
  "coverage_gap" text,
  "projection_json" text NOT NULL,
  "projection_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_notice_projections_pk"
    PRIMARY KEY ("workspace_id", "contract_id", "notice_id"),
  CONSTRAINT "tokenless_dsa_part8_count_notice_projections_source_binding_unique"
    UNIQUE ("workspace_id", "contract_id", "source_notice_binding"),
  CONSTRAINT "tokenless_dsa_part8_count_notice_projections_contract_fk"
    FOREIGN KEY ("workspace_id", "contract_id") REFERENCES "tokenless_dsa_part8_count_contracts"
      ("workspace_id", "contract_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_notice_projections_source_fk"
    FOREIGN KEY ("workspace_id", "notice_id", "fact_version")
    REFERENCES "tokenless_dsa_notice_processing_fact_versions"
      ("workspace_id", "notice_id", "fact_version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_notice_projections_contract_check" CHECK (
    "fact_version" > 0
    AND "source_notice_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_fact_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "projection_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "notifier_class" IN ('trusted_flagger','other')
    AND (("processing_status" = 'processed_final'
          AND "automation_processing" IN ('solely_automated','partially_automated','not_automated')
          AND "coverage_gap" IS NULL)
         OR ("processing_status" = 'processing_incomplete'
             AND "automation_processing" IS NULL
             AND "coverage_gap" = 'incomplete_notice_processing'))
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_results" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "contract_digest" text NOT NULL,
  "decision_projection_root" text NOT NULL,
  "measure_projection_root" text NOT NULL,
  "evaluation_projection_root" text NOT NULL,
  "notice_projection_root" text NOT NULL,
  "expected_cell_count" integer NOT NULL,
  "cell_root" text NOT NULL,
  "partially_automated_decision_count" integer NOT NULL,
  "partially_automated_measure_count" integer NOT NULL,
  "partially_automated_notice_count" integer NOT NULL,
  "incomplete_notice_count" integer NOT NULL,
  "publication_eligible" boolean NOT NULL,
  "engine_result_json" text NOT NULL,
  "engine_result_digest" text NOT NULL,
  "result_json" text NOT NULL,
  "result_digest" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_results_pk" PRIMARY KEY ("workspace_id", "contract_id"),
  CONSTRAINT "tokenless_dsa_part8_count_results_exact_unique"
    UNIQUE ("workspace_id", "contract_id", "result_digest"),
  CONSTRAINT "tokenless_dsa_part8_count_results_contract_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "decision_projection_root", "measure_projection_root",
                 "evaluation_projection_root", "notice_projection_root", "contract_digest")
    REFERENCES "tokenless_dsa_part8_count_contracts"
      ("workspace_id", "contract_id", "decision_projection_root", "measure_projection_root",
       "evaluation_projection_root", "notice_projection_root", "contract_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_results_contract_check" CHECK (
    "schema_version" = 'rateloop.dsa-part8-witnessed-count-result.v1'
    AND "decision_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "measure_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "evaluation_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "notice_projection_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "cell_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "contract_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "engine_result_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "result_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "partially_automated_decision_count" >= 0
    AND "partially_automated_measure_count" >= 0
    AND "partially_automated_notice_count" >= 0
    AND "incomplete_notice_count" >= 0
    AND "expected_cell_count" IN (4,6,8,56)
    AND "publication_eligible" = false
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_part8_count_cells" (
  "workspace_id" text NOT NULL,
  "contract_id" text NOT NULL,
  "result_digest" text NOT NULL,
  "indicator" text NOT NULL,
  "scope" text NOT NULL,
  "result_kind" text NOT NULL,
  "count_value" integer,
  "gap_code" text,
  "affected_notice_count" integer,
  "publication_eligible" boolean NOT NULL,
  "cell_json" text NOT NULL,
  "cell_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_part8_count_cells_pk"
    PRIMARY KEY ("workspace_id", "contract_id", "indicator", "scope"),
  CONSTRAINT "tokenless_dsa_part8_count_cells_exact_unique"
    UNIQUE ("workspace_id", "contract_id", "indicator", "scope", "cell_hash"),
  CONSTRAINT "tokenless_dsa_part8_count_cells_result_fk"
    FOREIGN KEY ("workspace_id", "contract_id", "result_digest")
    REFERENCES "tokenless_dsa_part8_count_results" ("workspace_id", "contract_id", "result_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_part8_count_cells_contract_check" CHECK (
    "indicator" IN ('measures_solely_automated','measures_not_automated',
                    'notices_solely_automated','notices_not_automated')
    AND "scope" IN ('Total number','Own-initiative','NAM Total','NAM Trusted Flagger',
                    'bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','it','lt','lv',
                    'mt','nl','pl','pt','ro','sk','sl','sv')
    AND "cell_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "publication_eligible"=false
    AND (("result_kind"='count' AND "count_value" >= 0
          AND "gap_code" IS NULL AND "affected_notice_count" IS NULL)
         OR ("result_kind"='coverage_gap' AND "count_value" IS NULL
             AND "gap_code"='incomplete_notice_processing' AND "affected_notice_count" > 0))
  )
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_enforce_dsa_part8_count_contract_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_binding_count bigint;
  source_count bigint;
  projection_count bigint;
  latest_notice_count bigint;
  result_count bigint;
  expected_cell_count integer;
  expected_value bigint;
  gap_count bigint;
  cell_record record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM tokenless_dsa_population_versions population
    JOIN tokenless_dsa_population_reconciliation_versions reconciliation
      ON reconciliation.workspace_id=population.workspace_id
     AND reconciliation.population_id=population.population_id
     AND reconciliation.population_version=population.version
     AND reconciliation.reconciliation_version=population.frozen_reconciliation_version
    WHERE population.workspace_id=NEW.workspace_id
      AND population.population_id=NEW.population_id
      AND population.version=NEW.population_version
      AND population.status='frozen'
      AND population.frozen_root=NEW.population_root
      AND population.frozen_at=NEW.population_frozen_at
      AND population.period_start=NEW.reporting_period_start
      AND population.period_end=NEW.reporting_period_end
      AND population.frozen_reconciliation_version=NEW.reconciliation_version
      AND reconciliation.status='reconciled'
      AND reconciliation.reconciliation_hash=NEW.reconciliation_hash
      AND reconciliation.computed_root=NEW.population_root
  ) THEN
    RAISE EXCEPTION 'Part 8 count contract has a non-exact frozen population or reconciliation binding'
      USING ERRCODE='23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_classifier_inventories inventory
    WHERE inventory.workspace_id=NEW.workspace_id AND inventory.inventory_id=NEW.inventory_id
      AND inventory.population_id=NEW.population_id AND inventory.population_version=NEW.population_version
      AND inventory.service_id=NEW.service_id AND inventory.inventory_root=NEW.inventory_root
      AND inventory.inventory_digest=NEW.inventory_digest
      AND inventory.source_frozen_at <= NEW.source_frozen_at
      AND inventory.frozen_at <= NEW.source_frozen_at
  ) THEN
    RAISE EXCEPTION 'Part 8 count contract has a non-exact classifier inventory binding'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO source_count
  FROM tokenless_dsa_engagement_versions engagement
  JOIN tokenless_dsa_source_engagement_versions source_engagement
    ON source_engagement.workspace_id=engagement.workspace_id
   AND source_engagement.engagement_id=engagement.engagement_id
   AND source_engagement.engagement_version=engagement.engagement_version
  JOIN tokenless_dsa_source_decision_versions source_decision
    ON source_decision.workspace_id=engagement.workspace_id
   AND source_decision.provider_decision_id=engagement.provider_decision_id
   AND source_decision.decision_version=engagement.decision_version
  WHERE engagement.workspace_id=NEW.workspace_id
    AND engagement.population_id=NEW.population_id AND engagement.population_version=NEW.population_version
    AND source_engagement.engagement_json::jsonb ->> 'service'=NEW.service_id
    AND source_engagement.created_at <= NEW.source_frozen_at
    AND source_decision.created_at <= NEW.source_frozen_at;
  SELECT count(*) INTO projection_count FROM tokenless_dsa_part8_count_decision_projections
   WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id;
  IF source_count <> NEW.expected_decision_count OR projection_count <> source_count THEN
    RAISE EXCEPTION 'Part 8 decision projection is incomplete' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO invalid_binding_count
  FROM tokenless_dsa_part8_count_decision_projections projection
  JOIN tokenless_dsa_part8_count_contracts contract
    ON contract.workspace_id=projection.workspace_id AND contract.contract_id=projection.contract_id
  JOIN tokenless_dsa_source_engagement_versions source_engagement
    ON source_engagement.workspace_id=projection.workspace_id
   AND source_engagement.engagement_id=projection.engagement_id
   AND source_engagement.engagement_version=projection.engagement_version
  JOIN tokenless_dsa_source_decision_versions source_decision
    ON source_decision.workspace_id=projection.workspace_id
   AND source_decision.provider_decision_id=projection.provider_decision_id
   AND source_decision.decision_version=projection.decision_version
  JOIN tokenless_dsa_content_moderation_decision_facts fact
    ON fact.workspace_id=projection.workspace_id
   AND fact.provider_decision_id=projection.provider_decision_id
   AND fact.decision_version=projection.decision_version
  WHERE projection.workspace_id=NEW.workspace_id AND projection.contract_id=NEW.contract_id
    AND (projection.population_id <> NEW.population_id
         OR projection.population_version <> NEW.population_version
         OR source_engagement.engagement_json::jsonb ->> 'service' <> NEW.service_id
         OR source_engagement.engagement_hash <> projection.engagement_hash
         OR source_decision.source_decision_hash <> projection.source_decision_hash
         OR fact.fact_hash <> projection.part8_fact_hash
         OR fact.measure_taken <> projection.measure_taken
         OR fact.moderation_measure_id IS DISTINCT FROM projection.moderation_measure_id
         OR source_engagement.created_at > NEW.source_frozen_at
         OR source_decision.created_at > NEW.source_frozen_at OR fact.created_at > NEW.source_frozen_at);
  IF invalid_binding_count <> 0 THEN
    RAISE EXCEPTION 'Part 8 decision projection does not exactly bind its source facts' USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO projection_count FROM tokenless_dsa_part8_count_measure_projections
   WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id;
  IF projection_count <> NEW.expected_measure_count OR EXISTS (
    (SELECT source_decision_binding,moderation_measure_id
       FROM tokenless_dsa_part8_count_decision_projections
      WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id AND measure_taken=true
     EXCEPT
     SELECT source_decision_binding,moderation_measure_id
       FROM tokenless_dsa_part8_count_measure_projections
      WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id)
    UNION ALL
    (SELECT source_decision_binding,moderation_measure_id
       FROM tokenless_dsa_part8_count_measure_projections
      WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id
     EXCEPT
     SELECT source_decision_binding,moderation_measure_id
       FROM tokenless_dsa_part8_count_decision_projections
      WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id AND measure_taken=true)
  ) THEN
    RAISE EXCEPTION 'Part 8 measure projection is not the exact taken-measure subset' USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO source_count
  FROM tokenless_dsa_engagement_versions engagement
  JOIN tokenless_dsa_source_engagement_versions source_engagement
    ON source_engagement.workspace_id=engagement.workspace_id
   AND source_engagement.engagement_id=engagement.engagement_id
   AND source_engagement.engagement_version=engagement.engagement_version
  JOIN tokenless_dsa_automated_means_evaluations evaluation
    ON evaluation.workspace_id=engagement.workspace_id
   AND evaluation.provider_decision_id=engagement.provider_decision_id
   AND evaluation.decision_version=engagement.decision_version
  WHERE engagement.workspace_id=NEW.workspace_id
    AND engagement.population_id=NEW.population_id AND engagement.population_version=NEW.population_version
    AND source_engagement.engagement_json::jsonb ->> 'service'=NEW.service_id
    AND source_engagement.created_at <= NEW.source_frozen_at AND evaluation.created_at <= NEW.source_frozen_at;
  SELECT count(*) INTO projection_count FROM tokenless_dsa_part8_count_evaluation_projections
   WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id;
  SELECT count(*) INTO invalid_binding_count
  FROM tokenless_dsa_part8_count_evaluation_projections projection
  JOIN tokenless_dsa_automated_means_evaluations evaluation
    ON evaluation.workspace_id=projection.workspace_id AND evaluation.evaluation_id=projection.evaluation_id
  JOIN tokenless_dsa_classifier_inventory_entries inventory
    ON inventory.workspace_id=projection.workspace_id AND inventory.inventory_id=projection.inventory_id
   AND inventory.system_id=projection.system_id AND inventory.system_version=projection.system_version
  WHERE projection.workspace_id=NEW.workspace_id AND projection.contract_id=NEW.contract_id
    AND (evaluation.evaluation_hash <> projection.source_evaluation_hash
         OR evaluation.created_at > NEW.source_frozen_at
         OR inventory.machine_class <> projection.machine_class
         OR inventory.public_designation <> projection.public_designation);
  IF source_count <> NEW.expected_evaluation_count OR projection_count <> source_count OR invalid_binding_count <> 0 THEN
    RAISE EXCEPTION 'Part 8 evaluation projection is incomplete or conflicts with its inventory'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO latest_notice_count FROM (
    SELECT DISTINCT ON (notice.notice_id) notice.notice_id,notice.fact_version
    FROM tokenless_dsa_notice_processing_fact_versions notice
    WHERE notice.workspace_id=NEW.workspace_id AND notice.service_id=NEW.service_id
      AND notice.received_at >= NEW.reporting_period_start AND notice.received_at < NEW.reporting_period_end
      AND notice.created_at <= NEW.source_frozen_at
    ORDER BY notice.notice_id,notice.fact_version DESC
  ) latest;
  SELECT count(*) INTO projection_count FROM tokenless_dsa_part8_count_notice_projections
   WHERE workspace_id=NEW.workspace_id AND contract_id=NEW.contract_id;
  SELECT count(*) INTO invalid_binding_count
  FROM tokenless_dsa_part8_count_notice_projections projection
  JOIN tokenless_dsa_notice_processing_fact_versions notice
    ON notice.workspace_id=projection.workspace_id AND notice.notice_id=projection.notice_id
   AND notice.fact_version=projection.fact_version
  WHERE projection.workspace_id=NEW.workspace_id AND projection.contract_id=NEW.contract_id
    AND (notice.service_id <> NEW.service_id OR notice.source_notice_binding <> projection.source_notice_binding
         OR notice.fact_hash <> projection.source_fact_hash OR notice.created_at > NEW.source_frozen_at
         OR projection.fact_version <> (SELECT max(latest.fact_version)
             FROM tokenless_dsa_notice_processing_fact_versions latest
             WHERE latest.workspace_id=projection.workspace_id AND latest.notice_id=projection.notice_id
               AND latest.created_at <= NEW.source_frozen_at));
  IF latest_notice_count <> NEW.expected_notice_count OR projection_count <> latest_notice_count
     OR invalid_binding_count <> 0 THEN
    RAISE EXCEPTION 'Part 8 notice projection is not the exact latest-version census'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO result_count FROM tokenless_dsa_part8_count_results result
  WHERE result.workspace_id=NEW.workspace_id AND result.contract_id=NEW.contract_id
    AND result.contract_digest=NEW.contract_digest
    AND result.decision_projection_root=NEW.decision_projection_root
    AND result.measure_projection_root=NEW.measure_projection_root
    AND result.evaluation_projection_root=NEW.evaluation_projection_root
    AND result.notice_projection_root=NEW.notice_projection_root
    AND result.incomplete_notice_count=(SELECT count(*) FROM tokenless_dsa_part8_count_notice_projections notice
      WHERE notice.workspace_id=NEW.workspace_id AND notice.contract_id=NEW.contract_id
        AND notice.coverage_gap='incomplete_notice_processing');
  IF result_count <> 1 THEN
    RAISE EXCEPTION 'Part 8 count result is absent or does not bind the complete projection'
      USING ERRCODE='23514';
  END IF;

  expected_cell_count := CASE NEW.provider_type
    WHEN 'intermediary_service' THEN 4 WHEN 'hosting_service' THEN 6
    WHEN 'online_platform' THEN 8 WHEN 'vlop' THEN 56 WHEN 'vlose' THEN 4 END;
  IF NOT EXISTS (
    SELECT 1 FROM tokenless_dsa_part8_count_results result
    WHERE result.workspace_id=NEW.workspace_id AND result.contract_id=NEW.contract_id
      AND result.expected_cell_count=expected_cell_count
  ) OR (SELECT count(*) FROM tokenless_dsa_part8_count_cells cell
         WHERE cell.workspace_id=NEW.workspace_id AND cell.contract_id=NEW.contract_id) <> expected_cell_count THEN
    RAISE EXCEPTION 'Part 8 count-cell universe is incomplete' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tokenless_dsa_part8_count_cells cell
    WHERE cell.workspace_id=NEW.workspace_id AND cell.contract_id=NEW.contract_id
      AND NOT (
        (cell.indicator IN ('measures_solely_automated','measures_not_automated')
         AND (cell.scope IN ('Total number','Own-initiative')
              OR (NEW.provider_type='vlop' AND cell.scope IN
                 ('bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','it','lt','lv',
                  'mt','nl','pl','pt','ro','sk','sl','sv'))))
        OR (cell.indicator IN ('notices_solely_automated','notices_not_automated')
            AND cell.scope='NAM Total' AND NEW.provider_type IN ('hosting_service','online_platform','vlop'))
        OR (cell.indicator IN ('notices_solely_automated','notices_not_automated')
            AND cell.scope='NAM Trusted Flagger' AND NEW.provider_type IN ('online_platform','vlop'))
      )
  ) THEN
    RAISE EXCEPTION 'Part 8 count-cell universe contains an inapplicable indicator or scope'
      USING ERRCODE='23514';
  END IF;
  FOR cell_record IN
    SELECT * FROM tokenless_dsa_part8_count_cells cell
    WHERE cell.workspace_id=NEW.workspace_id AND cell.contract_id=NEW.contract_id
  LOOP
    IF cell_record.indicator LIKE 'measures_%' THEN
      SELECT count(*) INTO expected_value
      FROM tokenless_dsa_part8_count_decision_projections decision
      WHERE decision.workspace_id=NEW.workspace_id AND decision.contract_id=NEW.contract_id
        AND decision.measure_taken=true
        AND decision.automation_processing=CASE cell_record.indicator
          WHEN 'measures_solely_automated' THEN 'solely_automated' ELSE 'not_automated' END
        AND (cell_record.scope='Total number'
             OR (cell_record.scope='Own-initiative' AND decision.projection_json::jsonb -> 'part8Fact' ->> 'origin'='own_initiative')
             OR (cell_record.scope NOT IN ('Total number','Own-initiative')
                 AND decision.projection_json::jsonb -> 'part8Fact' -> 'languageAttribution' -> 'languageCodes'
                     ? cell_record.scope));
      IF cell_record.result_kind <> 'count' OR cell_record.count_value <> expected_value THEN
        RAISE EXCEPTION 'Part 8 measure count cell does not equal its exact projection' USING ERRCODE='23514';
      END IF;
    ELSE
      SELECT count(*) FILTER (WHERE notice.processing_status='processing_incomplete'),
             count(*) FILTER (WHERE notice.processing_status='processed_final'
               AND notice.automation_processing=CASE cell_record.indicator
                 WHEN 'notices_solely_automated' THEN 'solely_automated' ELSE 'not_automated' END)
        INTO gap_count,expected_value
      FROM tokenless_dsa_part8_count_notice_projections notice
      WHERE notice.workspace_id=NEW.workspace_id AND notice.contract_id=NEW.contract_id
        AND (cell_record.scope='NAM Total' OR notice.notifier_class='trusted_flagger');
      IF (gap_count > 0 AND (cell_record.result_kind <> 'coverage_gap'
            OR cell_record.gap_code <> 'incomplete_notice_processing'
            OR cell_record.affected_notice_count <> gap_count))
         OR (gap_count=0 AND (cell_record.result_kind <> 'count' OR cell_record.count_value <> expected_value)) THEN
        RAISE EXCEPTION 'Part 8 notice count cell does not preserve its typed completeness state'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_part8_count_contract_complete_at_commit
AFTER INSERT ON "tokenless_dsa_part8_count_contracts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_enforce_dsa_part8_count_contract_complete();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_contracts_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_contracts"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_decision_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_decision_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_measure_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_measure_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_evaluation_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_evaluation_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_notice_projections_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_notice_projections"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_results_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_results"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_part8_count_cells_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_part8_count_cells"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

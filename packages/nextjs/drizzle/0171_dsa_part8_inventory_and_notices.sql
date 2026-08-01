CREATE TABLE "tokenless_dsa_classifier_inventories" (
  "workspace_id" text NOT NULL,
  "inventory_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "service_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "expected_system_count" integer NOT NULL,
  "source_registry_digest" text NOT NULL,
  "inventory_root" text NOT NULL,
  "inventory_json" text NOT NULL,
  "inventory_digest" text NOT NULL,
  "source_frozen_at" timestamp with time zone NOT NULL,
  "frozen_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL,
  CONSTRAINT "tokenless_dsa_classifier_inventories_pk"
    PRIMARY KEY ("workspace_id", "inventory_id"),
  CONSTRAINT "tokenless_dsa_classifier_inventories_scope_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "service_id"),
  CONSTRAINT "tokenless_dsa_classifier_inventories_exact_unique"
    UNIQUE ("workspace_id", "inventory_id", "inventory_root", "inventory_digest"),
  CONSTRAINT "tokenless_dsa_classifier_inventories_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions" ("workspace_id", "population_id", "version")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_classifier_inventories_contract_check" CHECK (
    "inventory_id" ~ '^dci_[0-9a-f]{40}$'
    AND "population_version" > 0
    AND "service_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "schema_version" = 'rateloop.dsa-part8-classifier-inventory.v1'
    AND "expected_system_count" BETWEEN 0 AND 64
    AND "source_registry_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "inventory_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_frozen_at" <= "frozen_at"
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_classifier_inventories_scope_idx"
  ON "tokenless_dsa_classifier_inventories" USING btree
  ("workspace_id", "population_id", "population_version", "service_id", "frozen_at");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_classifier_inventory_entries" (
  "workspace_id" text NOT NULL,
  "inventory_id" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "schema_version" text NOT NULL,
  "machine_class" text NOT NULL,
  "public_designation" text NOT NULL,
  "observed_evaluation_count" integer NOT NULL,
  "observation_state" text NOT NULL,
  "gap_code" text,
  "entry_json" text NOT NULL,
  "entry_hash" text NOT NULL,
  CONSTRAINT "tokenless_dsa_classifier_inventory_entries_pk"
    PRIMARY KEY ("workspace_id", "inventory_id", "system_id", "system_version"),
  CONSTRAINT "tokenless_dsa_classifier_inventory_entries_inventory_fk"
    FOREIGN KEY ("workspace_id", "inventory_id")
    REFERENCES "tokenless_dsa_classifier_inventories" ("workspace_id", "inventory_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_classifier_inventory_entries_identity_check" CHECK (
    "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "schema_version" = 'rateloop.dsa-part8-classifier-inventory-entry.v1'
    AND "machine_class" IN (
      'text_classifier', 'image_classifier', 'audio_classifier', 'video_classifier',
      'multimodal_classifier', 'rules_engine', 'other_machine_class'
    )
    AND char_length("public_designation") BETWEEN 1 AND 160
    AND "public_designation" = btrim("public_designation")
    AND NOT ("public_designation" ~ '[[:cntrl:]]')
    AND NOT ("public_designation" ~ '^[=+@-]')
    AND "observed_evaluation_count" >= 0
    AND "entry_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_dsa_classifier_inventory_entries_observation_check" CHECK (
    (("observation_state" = 'observed'
      AND "observed_evaluation_count" > 0
      AND "gap_code" IS NULL)
     OR
     ("observation_state" = 'unobserved'
      AND "observed_evaluation_count" = 0
      AND "gap_code" = 'zero_observations'))
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_dsa_classifier_inventory_entries_designation_unique"
  ON "tokenless_dsa_classifier_inventory_entries"
  ("workspace_id", "inventory_id", lower("public_designation"));--> statement-breakpoint
CREATE INDEX "tokenless_dsa_classifier_inventory_entries_observation_idx"
  ON "tokenless_dsa_classifier_inventory_entries" USING btree
  ("workspace_id", "inventory_id", "observation_state", "system_id", "system_version");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_classifier_inventory_entry_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  existing_count bigint;
BEGIN
  SELECT inventory.expected_system_count INTO expected_count
  FROM tokenless_dsa_classifier_inventories inventory
  WHERE inventory.workspace_id = NEW.workspace_id
    AND inventory.inventory_id = NEW.inventory_id
  FOR UPDATE;

  SELECT count(*) INTO existing_count
  FROM tokenless_dsa_classifier_inventory_entries entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.inventory_id = NEW.inventory_id;

  IF expected_count IS NULL OR existing_count >= expected_count THEN
    RAISE EXCEPTION 'A frozen DSA classifier inventory cannot accept additional systems'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_classifier_inventory_entry_insert_guard
BEFORE INSERT ON "tokenless_dsa_classifier_inventory_entries"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_classifier_inventory_entry_insert();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_enforce_dsa_classifier_inventory_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  population_status text;
  population_frozen_at timestamp with time zone;
  entry_count bigint;
  missing_or_conflicting_system_count bigint;
  incorrect_observation_count bigint;
BEGIN
  SELECT population.status,population.frozen_at
    INTO population_status,population_frozen_at
  FROM tokenless_dsa_population_versions population
  WHERE population.workspace_id = NEW.workspace_id
    AND population.population_id = NEW.population_id
    AND population.version = NEW.population_version;

  SELECT count(*) INTO entry_count
  FROM tokenless_dsa_classifier_inventory_entries entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.inventory_id = NEW.inventory_id;

  SELECT count(*) INTO missing_or_conflicting_system_count
  FROM tokenless_dsa_engagement_versions engagement
  JOIN tokenless_dsa_source_engagement_versions source_engagement
    ON source_engagement.workspace_id = engagement.workspace_id
   AND source_engagement.engagement_id = engagement.engagement_id
   AND source_engagement.engagement_version = engagement.engagement_version
  JOIN tokenless_dsa_automated_means_evaluations evaluation
    ON evaluation.workspace_id = engagement.workspace_id
   AND evaluation.provider_decision_id = engagement.provider_decision_id
   AND evaluation.decision_version = engagement.decision_version
  LEFT JOIN tokenless_dsa_classifier_inventory_entries entry
    ON entry.workspace_id = NEW.workspace_id
   AND entry.inventory_id = NEW.inventory_id
   AND entry.system_id = evaluation.system_id
   AND entry.system_version = evaluation.system_version
   AND entry.machine_class = evaluation.machine_class
   AND entry.public_designation = evaluation.public_designation
  WHERE engagement.workspace_id = NEW.workspace_id
    AND engagement.population_id = NEW.population_id
    AND engagement.population_version = NEW.population_version
    AND source_engagement.created_at <= NEW.source_frozen_at
    AND evaluation.created_at <= NEW.source_frozen_at
    AND source_engagement.engagement_json::jsonb ->> 'service' = NEW.service_id
    AND entry.inventory_id IS NULL;

  SELECT count(*) INTO incorrect_observation_count
  FROM tokenless_dsa_classifier_inventory_entries entry
  WHERE entry.workspace_id = NEW.workspace_id
    AND entry.inventory_id = NEW.inventory_id
    AND entry.observed_evaluation_count <> (
      SELECT count(*)
      FROM tokenless_dsa_engagement_versions engagement
      JOIN tokenless_dsa_source_engagement_versions source_engagement
        ON source_engagement.workspace_id = engagement.workspace_id
       AND source_engagement.engagement_id = engagement.engagement_id
       AND source_engagement.engagement_version = engagement.engagement_version
      JOIN tokenless_dsa_automated_means_evaluations evaluation
        ON evaluation.workspace_id = engagement.workspace_id
       AND evaluation.provider_decision_id = engagement.provider_decision_id
       AND evaluation.decision_version = engagement.decision_version
      WHERE engagement.workspace_id = NEW.workspace_id
        AND engagement.population_id = NEW.population_id
        AND engagement.population_version = NEW.population_version
        AND source_engagement.created_at <= NEW.source_frozen_at
        AND evaluation.created_at <= NEW.source_frozen_at
        AND source_engagement.engagement_json::jsonb ->> 'service' = NEW.service_id
        AND evaluation.system_id = entry.system_id
        AND evaluation.system_version = entry.system_version
        AND evaluation.machine_class = entry.machine_class
        AND evaluation.public_designation = entry.public_designation
    );

  IF population_status <> 'frozen'
     OR population_frozen_at IS NULL
     OR population_frozen_at > NEW.source_frozen_at
     OR NEW.source_frozen_at > NEW.frozen_at
     OR entry_count <> NEW.expected_system_count
     OR missing_or_conflicting_system_count <> 0
     OR incorrect_observation_count <> 0 THEN
    RAISE EXCEPTION 'DSA classifier inventory is not complete for its frozen population and service snapshot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_classifier_inventory_complete_at_commit
AFTER INSERT ON "tokenless_dsa_classifier_inventories"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_enforce_dsa_classifier_inventory_complete();--> statement-breakpoint
CREATE TABLE "tokenless_dsa_notice_processing_fact_versions" (
  "workspace_id" text NOT NULL,
  "notice_id" text NOT NULL,
  "fact_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "service_id" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "source_notice_binding" text NOT NULL,
  "processing_status" text NOT NULL,
  "automation_processing" text,
  "notifier_class" text NOT NULL,
  "supersedes_fact_version" integer,
  "correction_reason" text,
  "fact_json" text NOT NULL,
  "fact_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_pk"
    PRIMARY KEY ("workspace_id", "notice_id", "fact_version"),
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_exact_unique"
    UNIQUE ("workspace_id", "notice_id", "fact_version", "fact_hash"),
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_identity_unique"
    UNIQUE ("workspace_id", "notice_id", "fact_version", "service_id", "received_at",
            "source_notice_binding", "notifier_class"),
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces" ("workspace_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_previous_fk"
    FOREIGN KEY ("workspace_id", "notice_id", "supersedes_fact_version", "service_id", "received_at",
                 "source_notice_binding", "notifier_class")
    REFERENCES "tokenless_dsa_notice_processing_fact_versions"
      ("workspace_id", "notice_id", "fact_version", "service_id", "received_at",
       "source_notice_binding", "notifier_class") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_identity_check" CHECK (
    "notice_id" ~ '^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "fact_version" > 0
    AND "schema_version" = 'rateloop.dsa-part8-notice-processing-fact.v3'
    AND "service_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "source_notice_binding" ~ '^sha256:[0-9a-f]{64}$'
    AND "fact_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "received_at" <= "created_at"
  ),
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_state_check" CHECK (
    "notifier_class" IN ('trusted_flagger', 'other')
    AND (("processing_status" = 'processed_final'
          AND "automation_processing" IN ('solely_automated', 'partially_automated', 'not_automated'))
         OR
         ("processing_status" = 'processing_incomplete' AND "automation_processing" IS NULL))
  ),
  CONSTRAINT "tokenless_dsa_notice_processing_fact_versions_correction_check" CHECK (
    (("fact_version" = 1
      AND "supersedes_fact_version" IS NULL
      AND "correction_reason" IS NULL)
     OR
     ("fact_version" > 1
      AND "supersedes_fact_version" = "fact_version" - 1
      AND char_length(btrim("correction_reason")) BETWEEN 1 AND 500))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_notice_processing_fact_versions_service_time_idx"
  ON "tokenless_dsa_notice_processing_fact_versions" USING btree
  ("workspace_id", "service_id", "received_at", "notice_id", "fact_version");--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_classifier_inventories_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_classifier_inventories"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_classifier_inventory_entries_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_classifier_inventory_entries"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_notice_processing_fact_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_notice_processing_fact_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

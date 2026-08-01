DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tokenless_benchmark_research_approved_exports") THEN
    RAISE EXCEPTION
      '0180 requires an empty approved-export relation; legacy exports have no exact derivation bridge and cannot be backfilled safely'
      USING ERRCODE='55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tokenless_dsa_part8_report_versions" report
    JOIN "tokenless_dsa_reference_label_sets" labels
      ON labels."workspace_id"=report."workspace_id" AND labels."label_set_id"=report."label_set_id"
    WHERE labels."derivation_source"<>'independent_reference_panel'
  ) THEN
    RAISE EXCEPTION
      '0180 refuses an existing Part 8 report derived from non-independent labels'
      USING ERRCODE='55000';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD CONSTRAINT "tokenless_dsa_reference_label_sets_derivation_export_unique"
  UNIQUE ("workspace_id","label_set_id","epoch_id","commitment_digest","sample_digest",
          "manifest_root","label_root","set_hash","derivation_source");--> statement-breakpoint

ALTER TABLE "tokenless_dsa_reference_network_label_set_bridges"
  ADD CONSTRAINT "tokenless_dsa_reference_network_bridges_export_unique"
  UNIQUE ("workspace_id","label_set_id","bridge_hash");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_dsa_part8_independent_reference_panel()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stored_derivation_source text;
BEGIN
  IF NEW."label_set_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "derivation_source" INTO stored_derivation_source
    FROM "tokenless_dsa_reference_label_sets"
   WHERE "workspace_id"=NEW."workspace_id" AND "label_set_id"=NEW."label_set_id"
     AND "epoch_id"=NEW."epoch_id" AND "label_root"=NEW."label_root"
     AND "set_hash"=NEW."label_set_hash";
  IF stored_derivation_source IS DISTINCT FROM 'independent_reference_panel' THEN
    RAISE EXCEPTION 'Part 8 inferential accuracy requires independent reference-panel labels'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tokenless_dsa_part8_independent_reference_panel_guard
BEFORE INSERT ON "tokenless_dsa_part8_report_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_part8_independent_reference_panel();--> statement-breakpoint

ALTER TABLE "tokenless_benchmark_research_approved_exports"
  ADD COLUMN "reference_derivation_source" text NOT NULL,
  ADD COLUMN "reference_bridge_hash" text NOT NULL,
  ADD COLUMN "reference_network_bridge_hash" text,
  ADD COLUMN "reference_named_panel_bridge_hash" text,
  ADD COLUMN "reference_reporting_mode" text NOT NULL,
  ADD COLUMN "reference_population_claim" boolean NOT NULL,
  ADD COLUMN "reference_operational_rollup_eligible" boolean NOT NULL,
  ADD COLUMN "reference_adaptive_reuse_allowed" boolean NOT NULL,
  ADD COLUMN "reference_provenance_json" text NOT NULL,
  ADD COLUMN "reference_provenance_hash" text NOT NULL;--> statement-breakpoint

ALTER TABLE "tokenless_benchmark_research_approved_exports"
  ADD CONSTRAINT "tokenless_benchmark_research_exports_derivation_fk"
  FOREIGN KEY ("workspace_id","label_set_id","epoch_id","commitment_digest","sample_digest",
               "manifest_root","label_root","label_set_hash","reference_derivation_source")
  REFERENCES "tokenless_dsa_reference_label_sets"
    ("workspace_id","label_set_id","epoch_id","commitment_digest","sample_digest",
     "manifest_root","label_root","set_hash","derivation_source") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_benchmark_research_approved_exports"
  ADD CONSTRAINT "tokenless_benchmark_research_exports_network_bridge_fk"
  FOREIGN KEY ("workspace_id","label_set_id","reference_network_bridge_hash")
  REFERENCES "tokenless_dsa_reference_network_label_set_bridges"
    ("workspace_id","label_set_id","bridge_hash") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_benchmark_research_approved_exports"
  ADD CONSTRAINT "tokenless_benchmark_research_exports_named_panel_bridge_fk"
  FOREIGN KEY ("workspace_id","label_set_id","reference_named_panel_bridge_hash")
  REFERENCES "tokenless_dsa_named_panel_label_set_bridges"
    ("workspace_id","label_set_id","bridge_hash") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_benchmark_research_approved_exports"
  ADD CONSTRAINT "tokenless_benchmark_research_exports_reference_provenance_check" CHECK (
    "reference_bridge_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_provenance_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "reference_provenance_hash"='sha256:' ||
      encode(digest(convert_to("reference_provenance_json",'UTF8'),'sha256'),'hex')
    AND "reference_provenance_json" IS JSON OBJECT WITH UNIQUE KEYS
    AND "reference_population_claim"=false
    AND "reference_operational_rollup_eligible"=false
    AND "reference_adaptive_reuse_allowed"=false
    AND (
      ("reference_derivation_source"='rateloop_network'
       AND "reference_reporting_mode"='descriptive_panel_vs_network_only'
       AND "reference_network_bridge_hash"="reference_bridge_hash"
       AND "reference_named_panel_bridge_hash" IS NULL)
      OR
      ("reference_derivation_source"='independent_reference_panel'
       AND "reference_reporting_mode"='independent_reference_panel_research_only'
       AND "reference_named_panel_bridge_hash"="reference_bridge_hash"
       AND "reference_network_bridge_hash" IS NULL)
    )
    AND "reference_provenance_json"::jsonb=jsonb_build_object(
      'schemaVersion','rateloop.benchmark-research-reference-provenance.v1',
      'derivationSource',"reference_derivation_source",
      'labelSetId',"label_set_id",
      'labelSetHash',"label_set_hash",
      'bridgeHash',"reference_bridge_hash",
      'reportingMode',"reference_reporting_mode",
      'populationClaim',"reference_population_claim",
      'operationalRollupEligible',"reference_operational_rollup_eligible",
      'adaptiveReuseAllowed',"reference_adaptive_reuse_allowed"
    )
  );

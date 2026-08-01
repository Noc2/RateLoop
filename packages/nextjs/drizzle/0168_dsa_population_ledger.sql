CREATE OR REPLACE FUNCTION tokenless_dsa_evidence_transaction_timestamp()
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
AS $$
  SELECT transaction_timestamp()
$$;--> statement-breakpoint
CREATE TABLE "tokenless_dsa_population_versions" (
  "workspace_id" text NOT NULL,
  "population_id" text NOT NULL,
  "version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "source_systems_json" text NOT NULL,
  "partition_dimensions_json" text NOT NULL,
  "declared_source_totals_json" text NOT NULL,
  "declared_partition_totals_json" text NOT NULL,
  "declared_source_manifest_root" text NOT NULL,
  "declared_contract_hash" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "expected_row_count" integer NOT NULL,
  "expected_page_count" integer NOT NULL,
  "status" text NOT NULL,
  "frozen_reconciliation_version" integer,
  "frozen_root" text,
  "frozen_row_count" integer,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "frozen_at" timestamp with time zone,
  CONSTRAINT "tokenless_dsa_population_versions_pk"
    PRIMARY KEY ("workspace_id", "population_id", "version"),
  CONSTRAINT "tokenless_dsa_population_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_population_versions_id_check"
    CHECK ("population_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'),
  CONSTRAINT "tokenless_dsa_population_versions_contract_check" CHECK (
    "version" > 0
    AND "schema_version" = 'rateloop.dsa-population.v1'
    AND "period_end" > "period_start"
    AND "expected_row_count" BETWEEN 1 AND 50000
    AND "expected_page_count" BETWEEN 1 AND 50000
    AND "declared_source_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "declared_contract_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "status" IN ('ingesting', 'frozen')
    AND (
      ("status" = 'ingesting' AND "frozen_reconciliation_version" IS NULL AND "frozen_root" IS NULL
       AND "frozen_row_count" IS NULL AND "frozen_at" IS NULL)
      OR
      ("status" = 'frozen' AND "frozen_reconciliation_version" > 0
       AND "frozen_root" ~ '^sha256:[0-9a-f]{64}$'
       AND "frozen_row_count" = "expected_row_count" AND "frozen_at" IS NOT NULL
       AND "frozen_at" >= "period_end")
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_population_versions_period_idx"
  ON "tokenless_dsa_population_versions" USING btree
  ("workspace_id", "period_start", "period_end", "population_id", "version");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_source_decision_versions" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "source_system" text NOT NULL,
  "source_decision_json" text NOT NULL,
  "source_decision_hash" text NOT NULL,
  "decision_at" timestamp with time zone NOT NULL,
  "sor_applicability" text NOT NULL,
  "non_required_basis" text,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_source_decision_versions_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_source_decision_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_source_decision_versions_id_check" CHECK (
    "provider_decision_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "decision_version" > 0
    AND "schema_version" = 'rateloop.dsa-source-decision.v1'
    AND char_length(btrim("source_system")) BETWEEN 1 AND 160
    AND "source_decision_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_dsa_source_decision_versions_applicability_check" CHECK (
    "sor_applicability" IN (
      'required',
      'no_recipient_electronic_contact',
      'deceptive_high_volume_commercial_content',
      'article_9_order',
      'service_not_online_platform',
      'restriction_outside_article_17',
      'other_documented_exclusion'
    )
    AND (
      ("sor_applicability" = 'required' AND "non_required_basis" IS NULL)
      OR
      ("sor_applicability" <> 'required' AND "non_required_basis" = "sor_applicability")
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_source_decision_versions_time_idx"
  ON "tokenless_dsa_source_decision_versions" USING btree
  ("workspace_id", "decision_at", "source_system", "provider_decision_id", "decision_version");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_source_engagement_versions" (
  "workspace_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "engagement_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "engagement_json" text NOT NULL,
  "engagement_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_source_engagement_versions_pk"
    PRIMARY KEY ("workspace_id", "engagement_id", "engagement_version"),
  CONSTRAINT "tokenless_dsa_source_engagement_versions_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_source_engagement_versions_contract_check" CHECK (
    "engagement_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "engagement_version" > 0
    AND "schema_version" = 'rateloop.dsa-engagement.v1'
    AND "engagement_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_engagement_versions" (
  "workspace_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "engagement_id" text NOT NULL,
  "engagement_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "transparency_payload_version" integer,
  "partition_key" text NOT NULL,
  "partition_values_json" text NOT NULL,
  "ingest_page_number" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_engagement_versions_pk"
    PRIMARY KEY ("workspace_id", "population_id", "population_version", "engagement_id", "engagement_version"),
  CONSTRAINT "tokenless_dsa_engagement_versions_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions"("workspace_id", "population_id", "version") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_engagement_versions_engagement_fk"
    FOREIGN KEY ("workspace_id", "engagement_id", "engagement_version")
    REFERENCES "tokenless_dsa_source_engagement_versions"("workspace_id", "engagement_id", "engagement_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_engagement_versions_decision_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_source_decision_versions"("workspace_id", "provider_decision_id", "decision_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_engagement_versions_decision_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "provider_decision_id"),
  CONSTRAINT "tokenless_dsa_engagement_versions_engagement_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "engagement_id"),
  CONSTRAINT "tokenless_dsa_engagement_versions_population_binding_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "provider_decision_id", "decision_version",
            "engagement_id", "engagement_version"),
  CONSTRAINT "tokenless_dsa_engagement_versions_id_check" CHECK (
    "engagement_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "engagement_version" > 0
    AND "schema_version" = 'rateloop.dsa-engagement.v1'
    AND char_length(btrim("partition_key")) BETWEEN 1 AND 1000
    AND "ingest_page_number" > 0
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_engagement_versions_partition_idx"
  ON "tokenless_dsa_engagement_versions" USING btree
  ("workspace_id", "population_id", "population_version", "partition_key", "engagement_id");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_population_ingest_pages" (
  "workspace_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "page_number" integer NOT NULL,
  "schema_version" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "page_root" text NOT NULL,
  "row_count" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_population_ingest_pages_pk"
    PRIMARY KEY ("workspace_id", "population_id", "population_version", "page_number"),
  CONSTRAINT "tokenless_dsa_population_ingest_pages_idempotency_unique"
    UNIQUE ("workspace_id", "population_id", "population_version", "idempotency_key_hash"),
  CONSTRAINT "tokenless_dsa_population_ingest_pages_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions"("workspace_id", "population_id", "version") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_population_ingest_pages_contract_check" CHECK (
    "page_number" > 0
    AND "schema_version" = 'rateloop.dsa-population-ingest-page.v1'
    AND "idempotency_key_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "page_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "row_count" BETWEEN 1 AND 1000
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_population_reconciliation_versions" (
  "workspace_id" text NOT NULL,
  "population_id" text NOT NULL,
  "population_version" integer NOT NULL,
  "reconciliation_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "status" text NOT NULL,
  "computed_row_count" integer NOT NULL,
  "computed_root" text NOT NULL,
  "computed_source_totals_json" text NOT NULL,
  "computed_partition_totals_json" text NOT NULL,
  "blockers_json" text NOT NULL,
  "reconciliation_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_population_reconciliation_versions_pk"
    PRIMARY KEY ("workspace_id", "population_id", "population_version", "reconciliation_version"),
  CONSTRAINT "tokenless_dsa_population_reconciliation_versions_population_fk"
    FOREIGN KEY ("workspace_id", "population_id", "population_version")
    REFERENCES "tokenless_dsa_population_versions"("workspace_id", "population_id", "version") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_population_reconciliation_versions_contract_check" CHECK (
    "reconciliation_version" > 0
    AND "schema_version" = 'rateloop.dsa-population-reconciliation.v1'
    AND "status" IN ('blocked', 'reconciled')
    AND "computed_row_count" BETWEEN 0 AND 50000
    AND "computed_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "reconciliation_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_transparency_payload_versions" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "payload_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "commission_schema_version" text NOT NULL,
  "puid" text NOT NULL,
  "payload_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "server_generated_text_only" boolean NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_transparency_payload_versions_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version"),
  CONSTRAINT "tokenless_dsa_transparency_payload_versions_puid_unique"
    UNIQUE ("workspace_id", "puid"),
  CONSTRAINT "tokenless_dsa_transparency_payload_versions_scope_puid_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "puid"),
  CONSTRAINT "tokenless_dsa_transparency_payload_versions_decision_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_source_decision_versions"("workspace_id", "provider_decision_id", "decision_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_transparency_payload_versions_contract_check" CHECK (
    "payload_version" > 0
    AND "schema_version" = 'rateloop.dsa-transparency-payload.v1'
    AND "commission_schema_version" = 'dsa-transparency-database-api-v2-2025-07-01'
    AND "puid" ~ '^[A-Za-z0-9_-]{1,500}$'
    AND "payload_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "server_generated_text_only" = true
  )
);--> statement-breakpoint
ALTER TABLE "tokenless_dsa_engagement_versions"
  ADD CONSTRAINT "tokenless_dsa_engagement_versions_payload_fk"
  FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "transparency_payload_version")
  REFERENCES "tokenless_dsa_transparency_payload_versions"
    ("workspace_id", "provider_decision_id", "decision_version", "payload_version")
  ON DELETE CASCADE;--> statement-breakpoint
CREATE TABLE "tokenless_dsa_transparency_private_crosswalks" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "payload_version" integer NOT NULL,
  "puid" text NOT NULL,
  "internal_reference_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_transparency_private_crosswalks_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version"),
  CONSTRAINT "tokenless_dsa_transparency_private_crosswalks_payload_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "puid")
    REFERENCES "tokenless_dsa_transparency_payload_versions"
      ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "puid") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_transparency_private_crosswalks_contract_check" CHECK (
    "puid" ~ '^[A-Za-z0-9_-]{1,500}$'
    AND "internal_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_dsa_transparency_delivery_attempts" (
  "attempt_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "payload_version" integer NOT NULL,
  "attempt_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "operation" text NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "http_status" integer NOT NULL,
  "outcome" text NOT NULL,
  "result_json" text NOT NULL,
  "result_hash" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_transparency_delivery_attempts_version_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "attempt_version"),
  CONSTRAINT "tokenless_dsa_transparency_delivery_attempts_scope_unique"
    UNIQUE ("attempt_id", "workspace_id", "provider_decision_id", "decision_version", "payload_version"),
  CONSTRAINT "tokenless_dsa_transparency_delivery_attempts_idempotency_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "idempotency_key_hash"),
  CONSTRAINT "tokenless_dsa_transparency_delivery_attempts_payload_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version")
    REFERENCES "tokenless_dsa_transparency_payload_versions"
      ("workspace_id", "provider_decision_id", "decision_version", "payload_version") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_transparency_delivery_attempts_contract_check" CHECK (
    "attempt_id" ~ '^dsaa_[0-9a-f]{40}$'
    AND "attempt_version" > 0
    AND "schema_version" = 'rateloop.dsa-transparency-attempt.v1'
    AND "operation" IN ('submit', 'puid_lookup')
    AND "idempotency_key_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "http_status" BETWEEN 100 AND 599
    AND "outcome" IN (
      'created', 'invalid_creation_receipt', 'validation_rejected', 'failed',
      'unknown_pending_puid_lookup', 'puid_exists_verified',
      'puid_absent_retry_allowed', 'puid_lookup_unknown'
    )
    AND "result_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "completed_at" >= "started_at"
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_transparency_delivery_attempts_payload_idx"
  ON "tokenless_dsa_transparency_delivery_attempts" USING btree
  ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "attempt_version");--> statement-breakpoint
CREATE TABLE "tokenless_dsa_transparency_receipt_versions" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "payload_version" integer NOT NULL,
  "receipt_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "receipt_source" text NOT NULL,
  "attempt_id" text NOT NULL,
  "commission_uuid" text,
  "commission_id" text,
  "commission_created_at" timestamp with time zone,
  "commission_permalink" text,
  "commission_self" text,
  "receipt_json" text NOT NULL,
  "receipt_hash" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version", "receipt_version"),
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_payload_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "payload_version"),
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_attempt_unique" UNIQUE ("attempt_id"),
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_payload_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version", "payload_version")
    REFERENCES "tokenless_dsa_transparency_payload_versions"
      ("workspace_id", "provider_decision_id", "decision_version", "payload_version") ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_attempt_fk"
    FOREIGN KEY ("attempt_id", "workspace_id", "provider_decision_id", "decision_version", "payload_version")
    REFERENCES "tokenless_dsa_transparency_delivery_attempts"
      ("attempt_id", "workspace_id", "provider_decision_id", "decision_version", "payload_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_transparency_receipt_versions_contract_check" CHECK (
    "receipt_version" > 0
    AND "schema_version" = 'rateloop.dsa-transparency-receipt.v1'
    AND "receipt_source" IN ('creation_201', 'verified_puid_lookup_302')
    AND (
      ("receipt_source" = 'creation_201'
       AND char_length(btrim("commission_uuid")) BETWEEN 1 AND 500
       AND char_length(btrim("commission_id")) BETWEEN 1 AND 500
       AND "commission_created_at" IS NOT NULL
       AND "commission_permalink" IS NOT NULL
       AND "commission_self" IS NOT NULL)
      OR
      ("receipt_source" = 'verified_puid_lookup_302'
       AND "commission_uuid" IS NULL AND "commission_id" IS NULL
       AND "commission_created_at" IS NULL AND "commission_permalink" IS NULL AND "commission_self" IS NULL)
    )
    AND "receipt_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_reject_dsa_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tokenless_workspaces WHERE workspace_id = OLD.workspace_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'DSA population and Transparency Database evidence is append-only';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_population_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tokenless_workspaces WHERE workspace_id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'DSA population contracts are append-only';
  END IF;

  IF OLD.status = 'ingesting'
     AND NEW.status = 'frozen'
     AND OLD.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
     AND OLD.population_id IS NOT DISTINCT FROM NEW.population_id
     AND OLD.version IS NOT DISTINCT FROM NEW.version
     AND OLD.schema_version IS NOT DISTINCT FROM NEW.schema_version
     AND OLD.source_systems_json IS NOT DISTINCT FROM NEW.source_systems_json
     AND OLD.partition_dimensions_json IS NOT DISTINCT FROM NEW.partition_dimensions_json
     AND OLD.declared_source_totals_json IS NOT DISTINCT FROM NEW.declared_source_totals_json
     AND OLD.declared_partition_totals_json IS NOT DISTINCT FROM NEW.declared_partition_totals_json
     AND OLD.declared_source_manifest_root IS NOT DISTINCT FROM NEW.declared_source_manifest_root
     AND OLD.declared_contract_hash IS NOT DISTINCT FROM NEW.declared_contract_hash
     AND OLD.period_start IS NOT DISTINCT FROM NEW.period_start
     AND OLD.period_end IS NOT DISTINCT FROM NEW.period_end
     AND OLD.expected_row_count IS NOT DISTINCT FROM NEW.expected_row_count
     AND OLD.expected_page_count IS NOT DISTINCT FROM NEW.expected_page_count
     AND OLD.created_by IS NOT DISTINCT FROM NEW.created_by
     AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
     AND EXISTS (
       SELECT 1 FROM tokenless_dsa_population_reconciliation_versions reconciliation
       WHERE reconciliation.workspace_id = NEW.workspace_id
         AND reconciliation.population_id = NEW.population_id
         AND reconciliation.population_version = NEW.version
         AND reconciliation.reconciliation_version = NEW.frozen_reconciliation_version
         AND reconciliation.status = 'reconciled'
         AND reconciliation.computed_root = NEW.frozen_root
         AND reconciliation.computed_row_count = NEW.frozen_row_count
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DSA population contracts permit only one validated freeze transition';
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_population_versions_controlled_transition
BEFORE UPDATE OR DELETE ON "tokenless_dsa_population_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_population_version_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_source_decision_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_source_decision_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_source_engagement_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_source_engagement_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_engagement_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_engagement_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_population_ingest_pages_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_population_ingest_pages"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_population_reconciliations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_population_reconciliation_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_transparency_payload_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_transparency_payload_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_transparency_private_crosswalks_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_transparency_private_crosswalks"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_transparency_delivery_attempts_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_transparency_delivery_attempts"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_transparency_receipt_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_transparency_receipt_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

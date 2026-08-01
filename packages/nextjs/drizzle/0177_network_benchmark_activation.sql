ALTER TABLE "tokenless_agent_review_opportunities"
  ADD CONSTRAINT "tokenless_agent_review_opportunities_network_activation_exact_unique"
  UNIQUE ("workspace_id", "opportunity_id", "request_profile_id", "request_profile_version",
          "request_profile_hash", "source_evidence_hash", "suggestion_commitment");--> statement-breakpoint
ALTER TABLE "tokenless_public_network_review_bindings"
  ADD CONSTRAINT "tokenless_public_network_review_bindings_network_activation_exact_unique"
  UNIQUE ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id",
          "request_profile_id", "request_profile_version", "request_profile_hash",
          "source_evidence_hash", "suggestion_commitment");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_reject_network_benchmark_activation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'network benchmark activation evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_set_network_benchmark_evidence_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."recorded_at" := date_trunc('milliseconds', transaction_timestamp());
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_set_network_benchmark_activation_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."activated_at" := date_trunc('milliseconds', transaction_timestamp());
  NEW."authorization_not_before" := NEW."activated_at";
  NEW."authorization_expires_at" := NEW."activated_at" + make_interval(secs => NEW."authorization_duration_seconds");
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_activation_evidence" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "evidence_id" text NOT NULL,
  "evidence_type" text NOT NULL,
  "evidence_outcome" text NOT NULL,
  "counterparty_reference_hash" text NOT NULL,
  "artifact_digest" text NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "evidence_json" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_pk"
    PRIMARY KEY ("workspace_id", "evidence_id"),
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference", "evidence_window_start",
            "evidence_window_end", "method_version", "deployment_key", "evidence_id", "evidence_type",
            "evidence_hash"),
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_actor_fk"
    FOREIGN KEY ("recorded_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "activation_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "method_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "deployment_key" ~ '^tokenless-v4:[A-Za-z0-9:._-]{1,239}$'
    AND "evidence_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "evidence_window_end" > "evidence_window_start"
    AND "evidence_type" IN (
      'audit_partner_method_acceptance',
      'provider_pilot_acceptance',
      'hosted_end_to_end_exercise',
      'keeper_recovery_exercise',
      'indexer_recovery_exercise',
      'paid_eligibility_payout_tax_dac7_readiness',
      'sanctions_screening_readiness',
      'reviewer_contract_worker_information_appeal_readiness',
      'worker_data_privacy_governance_readiness'
    )
    AND (
      ("evidence_type" IN ('audit_partner_method_acceptance','provider_pilot_acceptance')
       AND "evidence_outcome" = 'accepted')
      OR
      ("evidence_type" IN ('hosted_end_to_end_exercise','keeper_recovery_exercise','indexer_recovery_exercise')
       AND "evidence_outcome" = 'passed')
      OR
      ("evidence_type" IN (
         'paid_eligibility_payout_tax_dac7_readiness','sanctions_screening_readiness',
         'reviewer_contract_worker_information_appeal_readiness','worker_data_privacy_governance_readiness'
       ) AND "evidence_outcome" = 'documented_ready')
    )
    AND "counterparty_reference_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "artifact_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_hash" = 'sha256:' || encode(digest(convert_to("evidence_json", 'UTF8'), 'sha256'), 'hex')
    AND "completed_at" <= "recorded_at"
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_activations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "status" text NOT NULL,
  "activation_scope" text NOT NULL,
  "public_safe_only" boolean NOT NULL,
  "unrelated_opportunity_authority" text NOT NULL,
  "expected_evidence_count" integer NOT NULL,
  "evidence_manifest_root" text NOT NULL,
  "expected_opportunity_count" integer NOT NULL,
  "opportunity_manifest_root" text NOT NULL,
  "authorization_duration_seconds" integer NOT NULL,
  "authorization_not_before" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  "authorization_expires_at" timestamp with time zone NOT NULL,
  "activation_json" text NOT NULL,
  "activation_hash" text NOT NULL,
  "activated_by" text NOT NULL,
  "activated_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_network_benchmark_activations_pk"
    PRIMARY KEY ("workspace_id", "activation_reference"),
  CONSTRAINT "tokenless_network_benchmark_activations_scope_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference",
            "evidence_window_start", "evidence_window_end", "method_version", "deployment_key"),
  CONSTRAINT "tokenless_network_benchmark_activations_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference",
            "evidence_window_start", "evidence_window_end", "method_version", "deployment_key",
            "status", "activation_hash"),
  CONSTRAINT "tokenless_network_benchmark_activations_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activations_actor_fk"
    FOREIGN KEY ("activated_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activations_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "activation_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "method_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "deployment_key" ~ '^tokenless-v4:[A-Za-z0-9:._-]{1,239}$'
    AND "evidence_window_end" > "evidence_window_start"
    AND "status" = 'active'
    AND "activation_scope" = 'exact_public_safe_benchmark_network_execution'
    AND "public_safe_only" = true
    AND "unrelated_opportunity_authority" = 'none'
    AND "expected_evidence_count" >= 10
    AND "expected_opportunity_count" >= 1
    AND "evidence_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "opportunity_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_duration_seconds" BETWEEN 1 AND 2592000
    AND "authorization_not_before" = "activated_at"
    AND "authorization_expires_at" = "activated_at" + make_interval(secs => "authorization_duration_seconds")
    AND "activation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "activation_hash" = 'sha256:' || encode(digest(convert_to("activation_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_activation_evidence_database_time
BEFORE INSERT ON "tokenless_network_benchmark_activation_evidence"
FOR EACH ROW EXECUTE FUNCTION tokenless_set_network_benchmark_evidence_time();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_activations_database_time
BEFORE INSERT ON "tokenless_network_benchmark_activations"
FOR EACH ROW EXECUTE FUNCTION tokenless_set_network_benchmark_activation_time();--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_activation_evidence_bindings" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "evidence_id" text NOT NULL,
  "evidence_type" text NOT NULL,
  "evidence_hash" text NOT NULL,
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_bindings_pk"
    PRIMARY KEY ("workspace_id", "activation_reference", "manifest_position"),
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_bindings_one_evidence"
    UNIQUE ("workspace_id", "activation_reference", "evidence_id"),
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_bindings_activation_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference",
                 "evidence_window_start", "evidence_window_end", "method_version", "deployment_key")
    REFERENCES "tokenless_network_benchmark_activations"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference",
       "evidence_window_start", "evidence_window_end", "method_version", "deployment_key")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_bindings_evidence_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference", "evidence_window_start",
                 "evidence_window_end", "method_version", "deployment_key", "evidence_id", "evidence_type",
                 "evidence_hash")
    REFERENCES "tokenless_network_benchmark_activation_evidence"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference", "evidence_window_start",
       "evidence_window_end", "method_version", "deployment_key", "evidence_id", "evidence_type",
       "evidence_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_evidence_bindings_contract_check" CHECK (
    "manifest_position" >= 1
    AND "evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_opportunity_authorizations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "opportunity_id" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "source_evidence_hash" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "authorization_json" text NOT NULL,
  "authorization_hash" text NOT NULL,
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_pk"
    PRIMARY KEY ("workspace_id", "activation_reference", "manifest_position"),
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_one_activation_opportunity"
    UNIQUE ("workspace_id", "activation_reference", "opportunity_id"),
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_one_lifetime_opportunity"
    UNIQUE ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_exact_unique"
    UNIQUE ("workspace_id", "activation_reference", "project_id", "opportunity_id", "authorization_hash"),
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_activation_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference",
                 "evidence_window_start", "evidence_window_end", "method_version", "deployment_key")
    REFERENCES "tokenless_network_benchmark_activations"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference",
       "evidence_window_start", "evidence_window_end", "method_version", "deployment_key")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id", "request_profile_id", "request_profile_version",
                 "request_profile_hash", "source_evidence_hash", "suggestion_commitment")
    REFERENCES "tokenless_agent_review_opportunities"
      ("workspace_id", "opportunity_id", "request_profile_id", "request_profile_version",
       "request_profile_hash", "source_evidence_hash", "suggestion_commitment")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_contract_check" CHECK (
    "manifest_position" >= 1
    AND "request_profile_version" >= 1
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_hash" = 'sha256:' || encode(digest(convert_to("authorization_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_activation_deactivations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "activation_status" text NOT NULL,
  "activation_hash" text NOT NULL,
  "reason" text NOT NULL,
  "superseded_by_activation_reference" text,
  "deactivation_json" text NOT NULL,
  "deactivation_hash" text NOT NULL,
  "deactivated_by" text NOT NULL,
  "deactivated_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_network_benchmark_activation_deactivations_pk"
    PRIMARY KEY ("workspace_id", "activation_reference"),
  CONSTRAINT "tokenless_network_benchmark_activation_deactivations_activation_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference",
                 "evidence_window_start", "evidence_window_end", "method_version", "deployment_key",
                 "activation_status", "activation_hash")
    REFERENCES "tokenless_network_benchmark_activations"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference",
       "evidence_window_start", "evidence_window_end", "method_version", "deployment_key",
       "status", "activation_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_deactivations_replacement_fk"
    FOREIGN KEY ("workspace_id", "superseded_by_activation_reference")
    REFERENCES "tokenless_network_benchmark_activations" ("workspace_id", "activation_reference")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_deactivations_actor_fk"
    FOREIGN KEY ("deactivated_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_activation_deactivations_contract_check" CHECK (
    "activation_status" = 'active'
    AND "reason" IN ('manual_deactivation','release_gate_failure','superseded')
    AND (
      ("reason" = 'superseded' AND "superseded_by_activation_reference" IS NOT NULL
       AND "superseded_by_activation_reference" <> "activation_reference")
      OR
      ("reason" IN ('manual_deactivation','release_gate_failure')
       AND "superseded_by_activation_reference" IS NULL)
    )
    AND "deactivation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "deactivation_hash" = 'sha256:' || encode(digest(convert_to("deactivation_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_network_benchmark_execution_bindings" (
  "workspace_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "run_id" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "source_evidence_hash" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "authorization_hash" text NOT NULL,
  "method_version" text NOT NULL,
  "deployment_key" text NOT NULL,
  "bound_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_network_benchmark_execution_bindings_pk"
    PRIMARY KEY ("workspace_id", "binding_id"),
  CONSTRAINT "tokenless_network_benchmark_execution_bindings_run_unique"
    UNIQUE ("workspace_id", "run_id"),
  CONSTRAINT "tokenless_network_benchmark_execution_bindings_public_binding_fk"
    FOREIGN KEY ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id",
                 "request_profile_id", "request_profile_version", "request_profile_hash",
                 "source_evidence_hash", "suggestion_commitment")
    REFERENCES "tokenless_public_network_review_bindings"
      ("workspace_id", "binding_id", "project_id", "opportunity_id", "run_id",
       "request_profile_id", "request_profile_version", "request_profile_hash",
       "source_evidence_hash", "suggestion_commitment")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_execution_bindings_authorization_fk"
    FOREIGN KEY ("workspace_id", "activation_reference", "project_id", "opportunity_id", "authorization_hash")
    REFERENCES "tokenless_network_benchmark_opportunity_authorizations"
      ("workspace_id", "activation_reference", "project_id", "opportunity_id", "authorization_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_network_benchmark_execution_bindings_contract_check" CHECK (
    "request_profile_version" >= 1
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "authorization_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_validate_network_benchmark_activation(p_workspace_id text, p_activation_reference text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  activation_record "tokenless_network_benchmark_activations"%ROWTYPE;
  actual_evidence_count integer;
  actual_evidence_root text;
  actual_opportunity_count integer;
  actual_opportunity_root text;
  audit_count integer;
  provider_count integer;
  hosted_count integer;
  keeper_count integer;
  indexer_count integer;
  paid_readiness_count integer;
  sanctions_readiness_count integer;
  worker_contract_readiness_count integer;
  worker_privacy_readiness_count integer;
BEGIN
  SELECT * INTO activation_record
  FROM "tokenless_network_benchmark_activations"
  WHERE "workspace_id"=p_workspace_id AND "activation_reference"=p_activation_reference;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*)::integer,
         'sha256:' || encode(digest(convert_to(COALESCE(string_agg(
           b."manifest_position"::text || '|' || b."evidence_type" || '|' || b."evidence_id" || '|' || b."evidence_hash",
           E'\n' ORDER BY b."manifest_position"), ''), 'UTF8'), 'sha256'), 'hex'),
         COUNT(*) FILTER (WHERE b."evidence_type"='audit_partner_method_acceptance')::integer,
         COUNT(DISTINCT e."counterparty_reference_hash") FILTER (WHERE b."evidence_type"='provider_pilot_acceptance')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='hosted_end_to_end_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='keeper_recovery_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='indexer_recovery_exercise')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='paid_eligibility_payout_tax_dac7_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='sanctions_screening_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='reviewer_contract_worker_information_appeal_readiness')::integer,
         COUNT(*) FILTER (WHERE b."evidence_type"='worker_data_privacy_governance_readiness')::integer
  INTO actual_evidence_count,actual_evidence_root,audit_count,provider_count,hosted_count,keeper_count,indexer_count,
       paid_readiness_count,sanctions_readiness_count,worker_contract_readiness_count,worker_privacy_readiness_count
  FROM "tokenless_network_benchmark_activation_evidence_bindings" b
  JOIN "tokenless_network_benchmark_activation_evidence" e
    ON e."workspace_id"=b."workspace_id" AND e."evidence_id"=b."evidence_id"
  WHERE b."workspace_id"=p_workspace_id AND b."activation_reference"=p_activation_reference;

  SELECT COUNT(*)::integer,
         'sha256:' || encode(digest(convert_to(COALESCE(string_agg(
           "manifest_position"::text || '|' || "opportunity_id" || '|' || "authorization_hash",
           E'\n' ORDER BY "manifest_position"), ''), 'UTF8'), 'sha256'), 'hex')
  INTO actual_opportunity_count,actual_opportunity_root
  FROM "tokenless_network_benchmark_opportunity_authorizations"
  WHERE "workspace_id"=p_workspace_id AND "activation_reference"=p_activation_reference;

  IF actual_evidence_count <> activation_record."expected_evidence_count"
     OR actual_evidence_root <> activation_record."evidence_manifest_root"
     OR audit_count < 1 OR provider_count < 2 OR hosted_count < 1 OR keeper_count < 1 OR indexer_count < 1
     OR paid_readiness_count < 1 OR sanctions_readiness_count < 1
     OR worker_contract_readiness_count < 1 OR worker_privacy_readiness_count < 1 THEN
    RAISE EXCEPTION 'network benchmark activation evidence is incomplete or unrelated';
  END IF;
  IF actual_opportunity_count <> activation_record."expected_opportunity_count"
     OR actual_opportunity_root <> activation_record."opportunity_manifest_root" THEN
    RAISE EXCEPTION 'network benchmark opportunity authorization is incomplete';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_validate_network_benchmark_activation_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM tokenless_validate_network_benchmark_activation(NEW."workspace_id", NEW."activation_reference");
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tokenless_network_benchmark_activations_complete
AFTER INSERT ON "tokenless_network_benchmark_activations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_validate_network_benchmark_activation_trigger();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_network_benchmark_evidence_bindings_complete
AFTER INSERT ON "tokenless_network_benchmark_activation_evidence_bindings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_validate_network_benchmark_activation_trigger();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_network_benchmark_opportunity_authorizations_complete
AFTER INSERT ON "tokenless_network_benchmark_opportunity_authorizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_validate_network_benchmark_activation_trigger();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_lock_network_benchmark_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  replacement_project text;
  replacement_benchmark text;
BEGIN
  PERFORM 1 FROM "tokenless_network_benchmark_activations"
  WHERE "workspace_id"=NEW."workspace_id" AND "activation_reference"=NEW."activation_reference"
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'network benchmark activation does not exist'; END IF;
  IF NEW."reason"='superseded' THEN
    SELECT "project_id","benchmark_id" INTO replacement_project,replacement_benchmark
    FROM "tokenless_network_benchmark_activations"
    WHERE "workspace_id"=NEW."workspace_id"
      AND "activation_reference"=NEW."superseded_by_activation_reference"
    FOR SHARE;
    IF replacement_project IS DISTINCT FROM NEW."project_id"
       OR replacement_benchmark IS DISTINCT FROM NEW."benchmark_id" THEN
      RAISE EXCEPTION 'network benchmark supersession must preserve the exact project and benchmark';
    END IF;
  END IF;
  NEW."deactivated_at" := date_trunc('milliseconds', transaction_timestamp());
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_deactivations_lock
BEFORE INSERT ON "tokenless_network_benchmark_activation_deactivations"
FOR EACH ROW EXECUTE FUNCTION tokenless_lock_network_benchmark_deactivation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_bind_network_benchmark_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authorization_record record;
BEGIN
  SELECT a."benchmark_id",a."activation_reference",a."method_version",a."deployment_key",
         o."authorization_hash"
  INTO authorization_record
  FROM "tokenless_network_benchmark_opportunity_authorizations" o
  JOIN "tokenless_network_benchmark_activations" a
    ON a."workspace_id"=o."workspace_id" AND a."activation_reference"=o."activation_reference"
  WHERE o."workspace_id"=NEW."workspace_id"
    AND o."project_id"=NEW."project_id"
    AND o."opportunity_id"=NEW."opportunity_id"
    AND o."request_profile_id"=NEW."request_profile_id"
    AND o."request_profile_version"=NEW."request_profile_version"
    AND o."request_profile_hash"=NEW."request_profile_hash"
    AND o."source_evidence_hash"=NEW."source_evidence_hash"
    AND o."suggestion_commitment"=NEW."suggestion_commitment"
    AND a."status"='active'
    AND transaction_timestamp() >= a."authorization_not_before"
    AND transaction_timestamp() < a."authorization_expires_at"
    AND NOT EXISTS (
      SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations" d
      WHERE d."workspace_id"=a."workspace_id" AND d."activation_reference"=a."activation_reference"
    )
  FOR SHARE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public network work requires one exact active benchmark activation';
  END IF;
  INSERT INTO "tokenless_network_benchmark_execution_bindings"
    ("workspace_id","binding_id","project_id","benchmark_id","activation_reference",
     "opportunity_id","run_id","request_profile_id","request_profile_version","request_profile_hash",
     "source_evidence_hash","suggestion_commitment","authorization_hash","method_version","deployment_key")
  VALUES
    (NEW."workspace_id",NEW."binding_id",NEW."project_id",authorization_record."benchmark_id",
     authorization_record."activation_reference",NEW."opportunity_id",NEW."run_id",NEW."request_profile_id",
     NEW."request_profile_version",NEW."request_profile_hash",NEW."source_evidence_hash",
     NEW."suggestion_commitment",authorization_record."authorization_hash",authorization_record."method_version",
     authorization_record."deployment_key");
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_public_network_review_bindings_benchmark_activation
AFTER INSERT ON "tokenless_public_network_review_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_bind_network_benchmark_publication();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_require_active_network_benchmark_for_run(
  p_workspace_id text, p_project_id text, p_run_id text, p_deployment_key text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  active_reference text;
BEGIN
  SELECT a."activation_reference" INTO active_reference
  FROM "tokenless_network_benchmark_execution_bindings" x
  JOIN "tokenless_network_benchmark_activations" a
    ON a."workspace_id"=x."workspace_id" AND a."activation_reference"=x."activation_reference"
  WHERE x."workspace_id"=p_workspace_id AND x."project_id"=p_project_id AND x."run_id"=p_run_id
    AND x."deployment_key"=p_deployment_key AND a."deployment_key"=p_deployment_key
    AND a."status"='active'
    AND transaction_timestamp() >= a."authorization_not_before"
    AND transaction_timestamp() < a."authorization_expires_at"
    AND NOT EXISTS (
      SELECT 1 FROM "tokenless_network_benchmark_activation_deactivations" d
      WHERE d."workspace_id"=a."workspace_id" AND d."activation_reference"=a."activation_reference"
    )
  FOR SHARE OF a;
  IF active_reference IS NULL THEN
    RAISE EXCEPTION 'network assignment requires its exact active benchmark activation';
  END IF;
  RETURN active_reference;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_network_benchmark_round_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."deployment_key" IS NOT NULL
     AND (OLD."deployment_key" IS DISTINCT FROM NEW."deployment_key" OR OLD."state" IS DISTINCT FROM NEW."state") THEN
    PERFORM tokenless_require_active_network_benchmark_for_run(
      NEW."workspace_id",NEW."project_id",NEW."run_id",NEW."deployment_key"
    );
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_public_network_review_bindings_benchmark_round_guard
BEFORE UPDATE ON "tokenless_public_network_review_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_network_benchmark_round_binding();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_network_benchmark_assignment_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exact_deployment_key text;
BEGIN
  IF NEW."source" <> 'rateloop_network' THEN RETURN NEW; END IF;
  SELECT "deployment_key" INTO exact_deployment_key
  FROM "tokenless_public_network_review_bindings"
  WHERE "workspace_id"=NEW."workspace_id" AND "project_id"=NEW."project_id" AND "run_id"=NEW."run_id"
    AND "state" IN ('round_bound','audience_ready')
  FOR SHARE;
  IF exact_deployment_key IS NULL THEN
    RAISE EXCEPTION 'network assignment is not bound to a funded public benchmark round';
  END IF;
  PERFORM tokenless_require_active_network_benchmark_for_run(
    NEW."workspace_id",NEW."project_id",NEW."run_id",exact_deployment_key
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_assurance_assignments_network_benchmark_guard
BEFORE INSERT ON "tokenless_assurance_assignments"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_network_benchmark_assignment_reservation();--> statement-breakpoint

CREATE TRIGGER tokenless_network_benchmark_activation_evidence_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_activation_evidence"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_activations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_activations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_activation_evidence_bindings_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_activation_evidence_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_opportunity_authorizations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_opportunity_authorizations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_activation_deactivations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_activation_deactivations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_network_benchmark_execution_bindings_append_only
BEFORE UPDATE OR DELETE ON "tokenless_network_benchmark_execution_bindings"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_network_benchmark_activation_mutation();

CREATE OR REPLACE FUNCTION tokenless_dsa_part8_language_codes_are_canonical(candidate text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  parsed jsonb;
  code_count integer;
  distinct_code_count integer;
  allowed_code_count integer;
  canonical text;
BEGIN
  parsed := candidate::jsonb;
  IF jsonb_typeof(parsed) <> 'array' THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(parsed) AS elements(item)
    WHERE jsonb_typeof(item) <> 'string'
  ) THEN
    RETURN false;
  END IF;
  SELECT
    count(*),
    count(DISTINCT code),
    count(*) FILTER (WHERE code IN (
      'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr',
      'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'
    )),
    COALESCE('["' || string_agg(code, '","' ORDER BY code) || '"]', '[]')
  INTO code_count, distinct_code_count, allowed_code_count, canonical
  FROM (
    SELECT item #>> '{}' AS code
    FROM jsonb_array_elements(parsed) AS elements(item)
  ) AS codes;
  RETURN code_count = distinct_code_count
    AND code_count = allowed_code_count
    AND candidate = canonical;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;--> statement-breakpoint
CREATE TABLE "tokenless_dsa_content_moderation_decision_facts" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "measure_taken" boolean NOT NULL,
  "moderation_measure_id" text,
  "origin" text NOT NULL,
  "automation_processing" text NOT NULL,
  "expected_evaluation_count" integer NOT NULL,
  "evaluation_set_root" text NOT NULL,
  "article16_notice_id" text,
  "notifier_class" text,
  "language_codes_json" text NOT NULL,
  "no_language_reason" text,
  "fact_json" text NOT NULL,
  "fact_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_measure_unique"
    UNIQUE ("workspace_id", "moderation_measure_id"),
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_decision_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_source_decision_versions"
      ("workspace_id", "provider_decision_id", "decision_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_identity_check" CHECK (
    "decision_version" > 0
    AND "schema_version" = 'rateloop.dsa-part8-content-moderation-decision.v3'
    AND ((("measure_taken" = true
           AND "moderation_measure_id" ~ '^measure_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$')
          OR ("measure_taken" = false AND "moderation_measure_id" IS NULL))) IS TRUE
    AND "provider_decision_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "fact_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_origin_check" CHECK (
    "origin" IN ('authority_order', 'article16_notice', 'own_initiative')
    AND ((
      ("origin" = 'article16_notice'
       AND "article16_notice_id" ~ '^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
       AND "notifier_class" IN ('trusted_flagger', 'other'))
      OR
      ("origin" <> 'article16_notice' AND "article16_notice_id" IS NULL AND "notifier_class" IS NULL)
    )) IS TRUE
  ),
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_automation_check" CHECK (
    "automation_processing" IN ('solely_automated', 'partially_automated', 'not_automated')
    AND "expected_evaluation_count" >= 0
    AND "evaluation_set_root" ~ '^sha256:[0-9a-f]{64}$'
    AND ((
      ("automation_processing" = 'not_automated'
       AND "expected_evaluation_count" = 0
       AND "evaluation_set_root" = 'sha256:e3f1da82a82df5b2c5466b458c9a6ede3b16e04a660746464270ca44c26d6363')
      OR
      ("automation_processing" IN ('solely_automated', 'partially_automated')
       AND "expected_evaluation_count" > 0)
    )) IS TRUE
  ),
  CONSTRAINT "tokenless_dsa_content_moderation_decision_facts_language_check" CHECK (
    tokenless_dsa_part8_language_codes_are_canonical("language_codes_json")
    AND ((
      ("language_codes_json" <> '[]' AND "no_language_reason" IS NULL)
      OR
      ("language_codes_json" = '[]'
       AND "no_language_reason" IN ('no_linguistic_content', 'language_undetermined', 'not_applicable'))
    )) IS TRUE
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_content_moderation_decision_facts_origin_idx"
  ON "tokenless_dsa_content_moderation_decision_facts" USING btree
  ("workspace_id", "origin", "automation_processing", "measure_taken", "moderation_measure_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_no_measure_non_required_basis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.measure_taken = false AND NOT EXISTS (
    SELECT 1
    FROM tokenless_dsa_source_decision_versions d
    WHERE d.workspace_id = NEW.workspace_id
      AND d.provider_decision_id = NEW.provider_decision_id
      AND d.decision_version = NEW.decision_version
      AND d.sor_applicability <> 'required'
      AND d.non_required_basis = d.sor_applicability
  ) THEN
    RAISE EXCEPTION 'A no-measure evaluation requires a coded non-required statement-of-reasons basis'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_content_moderation_decision_facts_basis_guard
BEFORE INSERT ON "tokenless_dsa_content_moderation_decision_facts"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_no_measure_non_required_basis();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_content_moderation_decision_facts_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_content_moderation_decision_facts"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE TABLE "tokenless_dsa_automated_means_evaluations" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "evaluation_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "system_id" text NOT NULL,
  "system_version" text NOT NULL,
  "machine_class" text NOT NULL,
  "public_designation" text NOT NULL,
  "automated_outcome" text NOT NULL,
  "evaluation_json" text NOT NULL,
  "evaluation_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_automated_means_evaluations_pk"
    PRIMARY KEY ("workspace_id", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_automated_means_evaluations_exact_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "evaluation_id"),
  CONSTRAINT "tokenless_dsa_automated_means_evaluations_system_unique"
    UNIQUE ("workspace_id", "provider_decision_id", "decision_version", "system_id", "system_version"),
  CONSTRAINT "tokenless_dsa_automated_means_evaluations_decision_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_content_moderation_decision_facts"
      ("workspace_id", "provider_decision_id", "decision_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_automated_means_evaluations_identity_check" CHECK (
    "decision_version" > 0
    AND "evaluation_id" ~ '^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "schema_version" = 'rateloop.dsa-part8-automated-means-evaluation.v1'
    AND "system_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "system_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "machine_class" IN (
      'text_classifier', 'image_classifier', 'audio_classifier', 'video_classifier',
      'multimodal_classifier', 'rules_engine', 'other_machine_class'
    )
    AND "public_designation" = btrim("public_designation")
    AND char_length("public_designation") BETWEEN 1 AND 160
    AND NOT ("public_designation" ~ '[[:cntrl:]]')
    AND NOT ("public_designation" ~ '^[=+@-]')
    AND "automated_outcome" IN ('pass', 'fail')
    AND "evaluation_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_automated_means_evaluations_decision_idx"
  ON "tokenless_dsa_automated_means_evaluations" USING btree
  ("workspace_id", "provider_decision_id", "decision_version", "automated_outcome");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_dsa_automated_means_evaluation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM tokenless_dsa_content_moderation_decision_facts d
    WHERE d.workspace_id = NEW.workspace_id
      AND d.provider_decision_id = NEW.provider_decision_id
      AND d.decision_version = NEW.decision_version
      AND d.automation_processing IN ('solely_automated', 'partially_automated')
  ) THEN
    RAISE EXCEPTION 'Automated-means evaluations require an automated or partially automated decision fact'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_automated_means_evaluations_decision_guard
BEFORE INSERT ON "tokenless_dsa_automated_means_evaluations"
FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_automated_means_evaluation();--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_automated_means_evaluations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_automated_means_evaluations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_enforce_dsa_evaluation_set_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace_id text;
  target_provider_decision_id text;
  target_decision_version integer;
  expected_count integer;
  actual_count bigint;
  processing text;
BEGIN
  target_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  target_provider_decision_id := COALESCE(NEW.provider_decision_id, OLD.provider_decision_id);
  target_decision_version := COALESCE(NEW.decision_version, OLD.decision_version);

  SELECT d.expected_evaluation_count, d.automation_processing
    INTO expected_count, processing
  FROM tokenless_dsa_content_moderation_decision_facts d
  WHERE d.workspace_id = target_workspace_id
    AND d.provider_decision_id = target_provider_decision_id
    AND d.decision_version = target_decision_version;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO actual_count
  FROM tokenless_dsa_automated_means_evaluations e
  WHERE e.workspace_id = target_workspace_id
    AND e.provider_decision_id = target_provider_decision_id
    AND e.decision_version = target_decision_version;

  IF (processing = 'not_automated' AND (expected_count <> 0 OR actual_count <> 0))
     OR (processing IN ('solely_automated', 'partially_automated')
         AND (expected_count < 1 OR actual_count <> expected_count)) THEN
    RAISE EXCEPTION 'Automated-means evaluation set is incomplete or exceeds its immutable decision bound'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_decision_evaluation_set_completeness
AFTER INSERT OR UPDATE ON "tokenless_dsa_content_moderation_decision_facts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_enforce_dsa_evaluation_set_completeness();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_dsa_evaluation_set_completeness
AFTER INSERT OR UPDATE OR DELETE ON "tokenless_dsa_automated_means_evaluations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION tokenless_enforce_dsa_evaluation_set_completeness();

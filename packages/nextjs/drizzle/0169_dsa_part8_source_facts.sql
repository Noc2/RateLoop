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
CREATE TABLE "tokenless_dsa_moderation_measure_facts" (
  "workspace_id" text NOT NULL,
  "provider_decision_id" text NOT NULL,
  "decision_version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "moderation_measure_id" text NOT NULL,
  "origin" text NOT NULL,
  "automation_processing" text NOT NULL,
  "article16_notice_id" text,
  "notifier_class" text,
  "automatic_removal" boolean NOT NULL,
  "classifier_system_id" text,
  "classifier_version" text,
  "classifier_machine_class" text,
  "language_codes_json" text NOT NULL,
  "no_language_reason" text,
  "fact_json" text NOT NULL,
  "fact_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_pk"
    PRIMARY KEY ("workspace_id", "provider_decision_id", "decision_version"),
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_measure_unique"
    UNIQUE ("workspace_id", "moderation_measure_id"),
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_decision_fk"
    FOREIGN KEY ("workspace_id", "provider_decision_id", "decision_version")
    REFERENCES "tokenless_dsa_source_decision_versions"
      ("workspace_id", "provider_decision_id", "decision_version")
    ON DELETE CASCADE,
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_identity_check" CHECK (
    "decision_version" > 0
    AND "schema_version" = 'rateloop.dsa-part8-moderation-measure.v1'
    AND "moderation_measure_id" ~ '^measure_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "provider_decision_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
    AND "fact_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_origin_check" CHECK (
    "origin" IN ('authority_order', 'article16_notice', 'own_initiative')
    AND (
      ("origin" = 'article16_notice'
       AND "article16_notice_id" ~ '^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
       AND "notifier_class" IN ('trusted_flagger', 'other'))
      OR
      ("origin" <> 'article16_notice' AND "article16_notice_id" IS NULL AND "notifier_class" IS NULL)
    )
  ),
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_automation_check" CHECK (
    "automation_processing" IN ('solely_automated', 'not_solely_automated')
    AND (
      ("automation_processing" = 'solely_automated'
       AND "classifier_system_id" ~ '^classifier_[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$'
       AND "classifier_version" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
       AND "classifier_machine_class" IN (
         'text_classifier', 'image_classifier', 'audio_classifier', 'video_classifier',
         'multimodal_classifier', 'rules_engine', 'other_machine_class'
       ))
      OR
      ("automation_processing" = 'not_solely_automated'
       AND "classifier_system_id" IS NULL AND "classifier_version" IS NULL
       AND "classifier_machine_class" IS NULL)
    )
  ),
  CONSTRAINT "tokenless_dsa_moderation_measure_facts_language_check" CHECK (
    tokenless_dsa_part8_language_codes_are_canonical("language_codes_json")
    AND (
      ("language_codes_json" <> '[]' AND "no_language_reason" IS NULL)
      OR
      ("language_codes_json" = '[]'
       AND "no_language_reason" IN ('no_linguistic_content', 'language_undetermined', 'not_applicable'))
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_dsa_moderation_measure_facts_origin_idx"
  ON "tokenless_dsa_moderation_measure_facts" USING btree
  ("workspace_id", "origin", "automation_processing", "moderation_measure_id");--> statement-breakpoint
CREATE TRIGGER tokenless_dsa_moderation_measure_facts_append_only
BEFORE UPDATE OR DELETE ON "tokenless_dsa_moderation_measure_facts"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_dsa_immutable_mutation();

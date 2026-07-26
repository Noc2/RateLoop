UPDATE "tokenless_agent_review_request_profiles"
SET "semantic_schema_version" = 4
WHERE "audience" = 'hybrid';--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_semantic_schema_check";--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_expertise_requirements_check";--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_semantic_schema_check" CHECK (
    "semantic_schema_version" IN (1, 2, 3, 4)
    AND (
      (
        "semantic_schema_version" IN (1, 2)
        AND "audience" <> 'hybrid'
      )
      OR (
        "semantic_schema_version" = 3
        AND "audience" <> 'hybrid'
      )
      OR (
        "semantic_schema_version" = 4
        AND "audience" = 'hybrid'
      )
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_expertise_requirements_check" CHECK (
    jsonb_typeof("expertise_requirements_json"::jsonb) = 'array'
    AND (
      (
        "semantic_schema_version" IN (1, 2)
        AND "expertise_requirements_json" = '[]'
      )
      OR (
        "semantic_schema_version" = 3
        AND "required_expertise_keys_json" = '[]'
      )
      OR (
        "semantic_schema_version" = 4
        AND "required_expertise_keys_json" = '[]'
        AND NOT (
          "expertise_requirements_json"::jsonb @? '$[*] ? (@.sourceScope != "customer_invited" && @.sourceScope != "rateloop_network")'
        )
      )
    )
  );

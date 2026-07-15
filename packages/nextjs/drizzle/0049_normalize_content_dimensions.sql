ALTER TABLE "tokenless_workspaces"
  ADD CONSTRAINT "tokenless_workspaces_legacy_classification_check"
  CHECK ("data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_legacy_classification_check"
  CHECK ("data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys"
  ADD CONSTRAINT "tokenless_workspace_api_keys_legacy_classification_check"
  CHECK ("max_data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD CONSTRAINT "tokenless_content_records_legacy_classification_check"
  CHECK ("data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  DROP CONSTRAINT "tokenless_question_records_classification_check";--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_legacy_classification_check"
  CHECK ("data_classification" IN ('public', 'synthetic', 'redacted', 'internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions"
  ADD CONSTRAINT "tokenless_private_group_policy_versions_legacy_classifications_check"
  CHECK (
    jsonb_typeof("data_classifications_json"::jsonb) = 'array'
    AND jsonb_array_length("data_classifications_json"::jsonb) > 0
    AND "data_classifications_json"::jsonb <@ '["internal","confidential","restricted","regulated"]'::jsonb
  );--> statement-breakpoint
ALTER TABLE "tokenless_agent_publishing_policies"
  ADD CONSTRAINT "tokenless_agent_publishing_policies_legacy_classifications_check"
  CHECK (
    jsonb_typeof("allowed_data_classifications_json"::jsonb) = 'array'
    AND "allowed_data_classifications_json"::jsonb <@ '["public","synthetic","redacted","internal","confidential","restricted","regulated"]'::jsonb
  );--> statement-breakpoint

ALTER TABLE "tokenless_workspaces"
  ADD COLUMN "max_private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD COLUMN "visibility" text,
  ADD COLUMN "material_kind" text,
  ADD COLUMN "private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys"
  ADD COLUMN "allow_public_lane" boolean,
  ADD COLUMN "max_private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD COLUMN "visibility" text,
  ADD COLUMN "material_kind" text,
  ADD COLUMN "private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD COLUMN "material_kind" text,
  ADD COLUMN "private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions"
  ADD COLUMN "max_private_sensitivity" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_publishing_policies"
  ADD COLUMN "allow_public_lane" boolean,
  ADD COLUMN "max_private_sensitivity" text;--> statement-breakpoint

UPDATE "tokenless_workspaces"
SET "max_private_sensitivity" = CASE "data_classification"
  WHEN 'internal' THEN 'internal'
  WHEN 'confidential' THEN 'confidential'
  WHEN 'restricted' THEN 'restricted'
  WHEN 'regulated' THEN 'regulated'
  ELSE NULL
END;--> statement-breakpoint
UPDATE "tokenless_assurance_projects"
SET
  "visibility" = CASE
    WHEN "data_classification" IN ('public', 'synthetic', 'redacted') THEN 'public'
    WHEN "data_classification" IN ('internal', 'confidential', 'restricted', 'regulated') THEN 'private'
  END,
  "material_kind" = CASE
    WHEN "data_classification" IN ('public', 'synthetic', 'redacted') THEN "data_classification"
    ELSE NULL
  END,
  "private_sensitivity" = CASE
    WHEN "data_classification" IN ('internal', 'confidential', 'restricted', 'regulated') THEN "data_classification"
    ELSE NULL
  END;--> statement-breakpoint
UPDATE "tokenless_workspace_api_keys"
SET
  "allow_public_lane" = true,
  "max_private_sensitivity" = CASE "max_data_classification"
    WHEN 'internal' THEN 'internal'
    WHEN 'confidential' THEN 'confidential'
    WHEN 'restricted' THEN 'restricted'
    WHEN 'regulated' THEN 'regulated'
    ELSE NULL
  END;--> statement-breakpoint
UPDATE "tokenless_content_records"
SET
  "visibility" = CASE
    WHEN "data_classification" IN ('public', 'synthetic', 'redacted') THEN 'public'
    WHEN "data_classification" IN ('internal', 'confidential', 'restricted', 'regulated') THEN 'private'
  END,
  "material_kind" = CASE
    WHEN "data_classification" IN ('public', 'synthetic', 'redacted') THEN "data_classification"
    ELSE NULL
  END,
  "private_sensitivity" = CASE
    WHEN "data_classification" IN ('internal', 'confidential', 'restricted', 'regulated') THEN "data_classification"
    ELSE NULL
  END;--> statement-breakpoint
UPDATE "tokenless_question_records"
SET
  "material_kind" = CASE
    WHEN "data_classification" IN ('public', 'synthetic', 'redacted') THEN "data_classification"
    ELSE NULL
  END,
  "private_sensitivity" = CASE
    WHEN "data_classification" IN ('internal', 'confidential', 'restricted', 'regulated') THEN "data_classification"
    ELSE NULL
  END;--> statement-breakpoint
UPDATE "tokenless_private_group_policy_versions"
SET "max_private_sensitivity" = CASE
  WHEN "data_classifications_json"::jsonb @> '["regulated"]'::jsonb THEN 'regulated'
  WHEN "data_classifications_json"::jsonb @> '["restricted"]'::jsonb THEN 'restricted'
  WHEN "data_classifications_json"::jsonb @> '["confidential"]'::jsonb THEN 'confidential'
  WHEN "data_classifications_json"::jsonb @> '["internal"]'::jsonb THEN 'internal'
END;--> statement-breakpoint
UPDATE "tokenless_agent_publishing_policies"
SET
  "allow_public_lane" = (
    "allowed_data_classifications_json"::jsonb @> '["public"]'::jsonb
    OR "allowed_data_classifications_json"::jsonb @> '["synthetic"]'::jsonb
    OR "allowed_data_classifications_json"::jsonb @> '["redacted"]'::jsonb
  ),
  "max_private_sensitivity" = CASE
    WHEN "allowed_data_classifications_json"::jsonb @> '["regulated"]'::jsonb THEN 'regulated'
    WHEN "allowed_data_classifications_json"::jsonb @> '["restricted"]'::jsonb THEN 'restricted'
    WHEN "allowed_data_classifications_json"::jsonb @> '["confidential"]'::jsonb THEN 'confidential'
    WHEN "allowed_data_classifications_json"::jsonb @> '["internal"]'::jsonb THEN 'internal'
    ELSE NULL
  END;--> statement-breakpoint

ALTER TABLE "tokenless_assurance_projects" ALTER COLUMN "visibility" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects" ALTER COLUMN "visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ALTER COLUMN "allow_public_lane" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ALTER COLUMN "allow_public_lane" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ALTER COLUMN "visibility" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_content_records" ALTER COLUMN "visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions" ALTER COLUMN "max_private_sensitivity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions" ALTER COLUMN "max_private_sensitivity" SET DEFAULT 'confidential';--> statement-breakpoint
ALTER TABLE "tokenless_agent_publishing_policies" ALTER COLUMN "allow_public_lane" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_publishing_policies" ALTER COLUMN "allow_public_lane" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "tokenless_workspaces" ALTER COLUMN "max_private_sensitivity" SET DEFAULT 'confidential';--> statement-breakpoint

ALTER TABLE "tokenless_workspaces"
  ADD CONSTRAINT "tokenless_workspaces_private_sensitivity_check"
  CHECK ("max_private_sensitivity" IS NULL OR "max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_visibility_check"
  CHECK ("visibility" IN ('public', 'private'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_material_kind_check"
  CHECK ("material_kind" IS NULL OR "material_kind" IN ('public', 'synthetic', 'redacted'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_private_sensitivity_check"
  CHECK ("private_sensitivity" IS NULL OR "private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_assurance_projects"
  ADD CONSTRAINT "tokenless_assurance_projects_dimensions_check"
  CHECK (
    ("visibility" = 'public' AND "private_sensitivity" IS NULL)
    OR ("visibility" = 'private' AND "material_kind" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys"
  ADD CONSTRAINT "tokenless_workspace_api_keys_private_sensitivity_check"
  CHECK ("max_private_sensitivity" IS NULL OR "max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD CONSTRAINT "tokenless_content_records_visibility_check"
  CHECK ("visibility" IN ('public', 'private'));--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD CONSTRAINT "tokenless_content_records_material_kind_check"
  CHECK ("material_kind" IS NULL OR "material_kind" IN ('public', 'synthetic', 'redacted'));--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD CONSTRAINT "tokenless_content_records_private_sensitivity_check"
  CHECK ("private_sensitivity" IS NULL OR "private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_content_records"
  ADD CONSTRAINT "tokenless_content_records_dimensions_check"
  CHECK (
    ("visibility" = 'public' AND "private_sensitivity" IS NULL)
    OR ("visibility" = 'private' AND "material_kind" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_material_kind_check"
  CHECK ("material_kind" IS NULL OR "material_kind" IN ('public', 'synthetic', 'redacted'));--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_private_sensitivity_check"
  CHECK ("private_sensitivity" IS NULL OR "private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_dimensions_check"
  CHECK (
    ("material_kind" IS NULL AND "private_sensitivity" IS NULL)
    OR ("visibility" = 'public' AND "material_kind" IS NOT NULL AND "private_sensitivity" IS NULL)
    OR ("visibility" = 'private' AND "material_kind" IS NULL AND "private_sensitivity" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "tokenless_question_records"
  ADD CONSTRAINT "tokenless_question_records_legacy_dimensions_check"
  CHECK (
    ("material_kind" IS NULL AND "private_sensitivity" IS NULL)
    OR ("data_classification" IN ('public', 'synthetic', 'redacted')
      AND "visibility" = 'public' AND "material_kind" = "data_classification" AND "private_sensitivity" IS NULL)
    OR ("data_classification" IN ('internal', 'confidential', 'restricted', 'regulated')
      AND "visibility" = 'private' AND "material_kind" IS NULL AND "private_sensitivity" = "data_classification")
  );--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions"
  ADD CONSTRAINT "tokenless_private_group_policy_versions_private_sensitivity_check"
  CHECK ("max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_publishing_policies"
  ADD CONSTRAINT "tokenless_agent_publishing_policies_private_sensitivity_check"
  CHECK ("max_private_sensitivity" IS NULL OR "max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated'));--> statement-breakpoint

CREATE INDEX "tokenless_workspaces_region_sensitivity_idx"
  ON "tokenless_workspaces" USING btree ("home_region", "max_private_sensitivity", "status");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_projects_dimensions_idx"
  ON "tokenless_assurance_projects" USING btree ("workspace_id", "visibility", "private_sensitivity", "status");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_api_keys_content_policy_idx"
  ON "tokenless_workspace_api_keys" USING btree ("workspace_id", "allow_public_lane", "max_private_sensitivity", "revoked_at");--> statement-breakpoint
CREATE INDEX "tokenless_content_records_dimensions_moderation_idx"
  ON "tokenless_content_records" USING btree ("workspace_id", "visibility", "material_kind", "private_sensitivity", "moderation_status");--> statement-breakpoint
CREATE INDEX "tokenless_question_records_dimensions_moderation_idx"
  ON "tokenless_question_records" USING btree ("visibility", "material_kind", "private_sensitivity", "moderation_status", "updated_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_publishing_policies_content_policy_idx"
  ON "tokenless_agent_publishing_policies" USING btree ("workspace_id", "enabled", "allow_public_lane", "max_private_sensitivity", "expires_at");

CREATE TABLE "tokenless_workspace_agent_setups" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "schema_version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'in_progress',
  "current_step" text NOT NULL DEFAULT 'connect',
  "primary_connection_intent_id" text REFERENCES "tokenless_agent_connection_intents"("intent_id") ON DELETE RESTRICT,
  "primary_integration_id" text REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "confirmed_agent_version_id" text REFERENCES "tokenless_agent_versions"("version_id") ON DELETE RESTRICT,
  "agent_confirmed_at" timestamp with time zone,
  "agent_confirmed_by" text,
  "review_draft_json" text NOT NULL DEFAULT '{}',
  "review_policy_id" text,
  "review_policy_version" integer,
  "reviews_confirmed_at" timestamp with time zone,
  "reviews_confirmed_by" text,
  "publishing_policy_id" text REFERENCES "tokenless_agent_publishing_policies"("policy_id") ON DELETE RESTRICT,
  "publishing_policy_version" integer,
  "people_decision" text,
  "private_group_id" text REFERENCES "tokenless_private_groups"("group_id") ON DELETE RESTRICT,
  "people_decided_at" timestamp with time zone,
  "people_decided_by" text,
  "revision" integer NOT NULL DEFAULT 1,
  "completed_at" timestamp with time zone,
  "completed_by" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_agent_setups_status_check"
    CHECK ("status" IN ('in_progress','completed','grandfathered')),
  CONSTRAINT "tokenless_workspace_agent_setups_step_check"
    CHECK ("current_step" IN ('connect','agent','reviews','people','complete')),
  CONSTRAINT "tokenless_workspace_agent_setups_people_check"
    CHECK ("people_decision" IS NULL OR "people_decision" IN ('invited','later','not_required')),
  CONSTRAINT "tokenless_workspace_agent_setups_schema_check" CHECK ("schema_version" >= 1),
  CONSTRAINT "tokenless_workspace_agent_setups_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "tokenless_workspace_agent_setups_review_pair_check" CHECK (
    ("review_policy_id" IS NULL AND "review_policy_version" IS NULL)
    OR ("review_policy_id" IS NOT NULL AND "review_policy_version" >= 1)
  ),
  CONSTRAINT "tokenless_workspace_agent_setups_publishing_pair_check" CHECK (
    ("publishing_policy_id" IS NULL AND "publishing_policy_version" IS NULL)
    OR ("publishing_policy_id" IS NOT NULL AND "publishing_policy_version" >= 1)
  ),
  CONSTRAINT "tokenless_workspace_agent_setups_completion_check" CHECK (
    ("status" = 'in_progress' AND "completed_at" IS NULL AND "completed_by" IS NULL)
    OR ("status" = 'completed' AND "current_step" = 'complete'
      AND "completed_at" IS NOT NULL AND "completed_by" IS NOT NULL)
    OR ("status" = 'grandfathered' AND "current_step" = 'complete' AND "completed_by" IS NULL)
  ),
  CONSTRAINT "tokenless_workspace_agent_setups_review_policy_fk"
    FOREIGN KEY ("workspace_id", "review_policy_id", "review_policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_agent_setups_status_step_idx"
  ON "tokenless_workspace_agent_setups" USING btree ("status", "current_step", "updated_at");--> statement-breakpoint

INSERT INTO "tokenless_workspace_agent_setups"
  ("workspace_id", "schema_version", "status", "current_step", "revision", "created_at", "updated_at")
SELECT "workspace_id", 1, 'in_progress', 'connect', 1, "created_at", "updated_at"
FROM "tokenless_workspaces";--> statement-breakpoint

UPDATE "tokenless_workspace_agent_setups"
SET "status" = 'grandfathered',
    "current_step" = 'complete',
    "completed_at" = "tokenless_workspace_agent_setups"."updated_at"
WHERE "workspace_id" IN (
  SELECT ai."workspace_id"
  FROM "tokenless_agent_integrations" ai
  LEFT JOIN "tokenless_agent_connection_intents" ci ON ci."intent_id" = ai."connection_intent_id"
  LEFT JOIN "tokenless_workspace_api_keys" ak ON ak."key_id" = ai."api_key_id"
  WHERE ai."status" = 'active'
    AND (
      (ai."activation_mode" IN ('preauthorized_safe','owner_approved') AND ci."status" = 'connected')
      OR (
        ai."activation_mode" = 'legacy_pairing'
        AND ai."credential_expires_at" > now()
        AND ak."revoked_at" IS NULL
        AND (ak."expires_at" IS NULL OR ak."expires_at" > now())
      )
    )
);

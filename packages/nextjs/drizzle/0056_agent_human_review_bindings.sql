ALTER TABLE "tokenless_agent_publishing_policies"
  ADD CONSTRAINT "tokenless_agent_publishing_policies_exact_tuple_unique"
  UNIQUE ("workspace_id", "policy_id", "version");--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_exact_hash_unique"
  UNIQUE ("workspace_id", "profile_id", "version", "profile_hash");--> statement-breakpoint

CREATE TABLE "tokenless_agent_human_review_bindings" (
  "binding_id" text NOT NULL,
  "version" integer NOT NULL,
  "workspace_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "selection_policy_id" text NOT NULL,
  "selection_policy_version" integer NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "publishing_policy_id" text,
  "publishing_policy_version" integer,
  "authority" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "canonical_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "approved_by" text,
  "approved_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_human_review_bindings_pk" PRIMARY KEY ("binding_id", "version"),
  CONSTRAINT "tokenless_agent_human_review_bindings_workspace_unique"
    UNIQUE ("workspace_id", "binding_id", "version"),
  CONSTRAINT "tokenless_agent_human_review_bindings_hash_unique"
    UNIQUE ("workspace_id", "canonical_hash"),
  CONSTRAINT "tokenless_agent_human_review_bindings_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_agent_human_review_bindings_authority_check"
    CHECK ("authority" IN ('check_only', 'prepare_for_approval', 'ask_automatically')),
  CONSTRAINT "tokenless_agent_human_review_bindings_publishing_pair_check" CHECK (
    ("publishing_policy_id" IS NULL AND "publishing_policy_version" IS NULL)
    OR ("publishing_policy_id" IS NOT NULL AND "publishing_policy_version" >= 1)
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_automatic_grant_check" CHECK (
    "authority" <> 'ask_automatically'
    OR ("publishing_policy_id" IS NOT NULL AND "publishing_policy_version" >= 1)
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_hash_check" CHECK (
    "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "canonical_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_approval_tuple_check" CHECK (
    ("approved_by" IS NULL AND "approved_at" IS NULL)
    OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_enabled_approval_check" CHECK (
    NOT "enabled" OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_lifecycle_check" CHECK (
    ("approved_at" IS NULL OR "approved_at" >= "created_at")
    AND ("superseded_at" IS NULL OR "superseded_at" >= COALESCE("approved_at", "created_at"))
  ),
  CONSTRAINT "tokenless_agent_human_review_bindings_agent_version_fk"
    FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions" ("workspace_id", "agent_id", "version_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_bindings_selection_policy_fk"
    FOREIGN KEY ("workspace_id", "selection_policy_id", "selection_policy_version")
    REFERENCES "tokenless_agent_review_policies" ("workspace_id", "policy_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_bindings_request_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_bindings_publishing_policy_fk"
    FOREIGN KEY ("workspace_id", "publishing_policy_id", "publishing_policy_version")
    REFERENCES "tokenless_agent_publishing_policies" ("workspace_id", "policy_id", "version") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_human_review_bindings_active_agent_idx"
  ON "tokenless_agent_human_review_bindings" USING btree ("workspace_id", "agent_id", "agent_version_id")
  WHERE "enabled" = true AND "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tokenless_agent_human_review_bindings_workspace_created_idx"
  ON "tokenless_agent_human_review_bindings" USING btree ("workspace_id", "created_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_human_review_binding_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "binding_version" integer NOT NULL,
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "event_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_human_review_binding_events_binding_fk"
    FOREIGN KEY ("workspace_id", "binding_id", "binding_version")
    REFERENCES "tokenless_agent_human_review_bindings" ("workspace_id", "binding_id", "version") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_human_review_binding_events_type_check"
    CHECK ("event_type" IN ('created', 'configuration_changed', 'disabled')),
  CONSTRAINT "tokenless_agent_human_review_binding_events_actor_check"
    CHECK ("actor_type" IN ('account', 'service')),
  CONSTRAINT "tokenless_agent_human_review_binding_events_hash_check"
    CHECK ("event_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_human_review_binding_events_binding_created_idx"
  ON "tokenless_agent_human_review_binding_events" USING btree ("binding_id", "created_at");--> statement-breakpoint

ALTER TABLE "tokenless_agent_integrations"
  ADD COLUMN "human_review_binding_id" text,
  ADD COLUMN "human_review_binding_version" integer;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations"
  ADD CONSTRAINT "tokenless_agent_integrations_human_review_binding_pair_check" CHECK (
    ("human_review_binding_id" IS NULL AND "human_review_binding_version" IS NULL)
    OR ("human_review_binding_id" IS NOT NULL AND "human_review_binding_version" >= 1)
  );--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations"
  ADD CONSTRAINT "tokenless_agent_integrations_human_review_binding_fk"
  FOREIGN KEY ("workspace_id", "human_review_binding_id", "human_review_binding_version")
  REFERENCES "tokenless_agent_human_review_bindings" ("workspace_id", "binding_id", "version") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_workspace_agent_setups"
  ADD COLUMN "human_review_binding_id" text,
  ADD COLUMN "human_review_binding_version" integer;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_agent_setups"
  ADD CONSTRAINT "tokenless_workspace_agent_setups_human_review_binding_pair_check" CHECK (
    ("human_review_binding_id" IS NULL AND "human_review_binding_version" IS NULL)
    OR ("human_review_binding_id" IS NOT NULL AND "human_review_binding_version" >= 1)
  );--> statement-breakpoint
ALTER TABLE "tokenless_workspace_agent_setups"
  ADD CONSTRAINT "tokenless_workspace_agent_setups_human_review_binding_fk"
  FOREIGN KEY ("workspace_id", "human_review_binding_id", "human_review_binding_version")
  REFERENCES "tokenless_agent_human_review_bindings" ("workspace_id", "binding_id", "version") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD COLUMN "human_review_binding_id" text,
  ADD COLUMN "human_review_binding_version" integer,
  ADD COLUMN "request_profile_id" text,
  ADD COLUMN "request_profile_version" integer,
  ADD COLUMN "request_profile_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_evaluation_scopes"
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_review_binding_pair_check" CHECK (
    ("human_review_binding_id" IS NULL AND "human_review_binding_version" IS NULL)
    OR ("human_review_binding_id" IS NOT NULL AND "human_review_binding_version" >= 1)
  ),
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_request_profile_tuple_check" CHECK (
    ("request_profile_id" IS NULL AND "request_profile_version" IS NULL AND "request_profile_hash" IS NULL)
    OR (
      "request_profile_id" IS NOT NULL
      AND "request_profile_version" >= 1
      AND "request_profile_hash" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_request_profile_hash_check"
    CHECK ("request_profile_hash" IS NULL OR "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_review_binding_fk"
    FOREIGN KEY ("workspace_id", "human_review_binding_id", "human_review_binding_version")
    REFERENCES "tokenless_agent_human_review_bindings" ("workspace_id", "binding_id", "version") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_agent_evaluation_scopes_request_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_opportunities"
  ADD COLUMN "human_review_binding_id" text,
  ADD COLUMN "human_review_binding_version" integer,
  ADD COLUMN "request_profile_id" text,
  ADD COLUMN "request_profile_version" integer,
  ADD COLUMN "request_profile_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_opportunities"
  ADD CONSTRAINT "tokenless_agent_review_opportunities_review_binding_pair_check" CHECK (
    ("human_review_binding_id" IS NULL AND "human_review_binding_version" IS NULL)
    OR ("human_review_binding_id" IS NOT NULL AND "human_review_binding_version" >= 1)
  ),
  ADD CONSTRAINT "tokenless_agent_review_opportunities_request_profile_tuple_check" CHECK (
    ("request_profile_id" IS NULL AND "request_profile_version" IS NULL AND "request_profile_hash" IS NULL)
    OR (
      "request_profile_id" IS NOT NULL
      AND "request_profile_version" >= 1
      AND "request_profile_hash" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "tokenless_agent_review_opportunities_request_profile_hash_check"
    CHECK ("request_profile_hash" IS NULL OR "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "tokenless_agent_review_opportunities_review_binding_fk"
    FOREIGN KEY ("workspace_id", "human_review_binding_id", "human_review_binding_version")
    REFERENCES "tokenless_agent_human_review_bindings" ("workspace_id", "binding_id", "version") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_agent_review_opportunities_request_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunities_request_profile_idx"
  ON "tokenless_agent_review_opportunities" USING btree
  ("workspace_id", "agent_id", "request_profile_hash", "created_at");

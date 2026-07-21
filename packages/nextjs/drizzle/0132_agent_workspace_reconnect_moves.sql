ALTER TABLE "tokenless_agent_connection_intents"
  ADD COLUMN "reconnect_integration_id" text
  REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_connection_intents_active_reconnect_unique"
  ON "tokenless_agent_connection_intents" ("reconnect_integration_id")
  WHERE "reconnect_integration_id" IS NOT NULL
    AND "status" IN ('issued','install_required','authorizing','approval_required','testing','action_required');--> statement-breakpoint

ALTER TABLE "tokenless_agent_connection_intents"
  DROP CONSTRAINT "tokenless_agent_connection_intents_status_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_connection_intents"
  ADD CONSTRAINT "tokenless_agent_connection_intents_status_check" CHECK (
    "status" IN (
      'issued','install_required','authorizing','approval_required','testing','connected',
      'action_required','rejected','expired','cancelled','superseded'
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_agent_integrations"
  DROP CONSTRAINT "tokenless_agent_integrations_credential_source_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations"
  ADD CONSTRAINT "tokenless_agent_integrations_credential_source_check" CHECK (
    ("activation_mode" = 'legacy_pairing' AND "pairing_id" IS NOT NULL AND "api_key_id" IS NOT NULL)
    OR (
      "activation_mode" IN ('preauthorized_safe','owner_approved')
      AND "connection_intent_id" IS NOT NULL
      AND "oauth_client_id" IS NOT NULL
      AND "oauth_subject_principal_id" IS NOT NULL
      AND (("status" = 'active' AND "token_family_id" IS NOT NULL) OR "status" = 'revoked')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_mcp_sessions"
  DROP CONSTRAINT "tokenless_mcp_sessions_integration_binding_fk";--> statement-breakpoint
ALTER TABLE "tokenless_mcp_sessions"
  ADD CONSTRAINT "tokenless_mcp_sessions_integration_fk"
  FOREIGN KEY ("integration_id")
  REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE CASCADE;--> statement-breakpoint

CREATE TABLE "tokenless_agent_workspace_moves" (
  "move_id" text PRIMARY KEY NOT NULL,
  "target_intent_id" text NOT NULL UNIQUE
    REFERENCES "tokenless_agent_connection_intents"("intent_id") ON DELETE RESTRICT,
  "source_token_family_id" text NOT NULL
    REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE RESTRICT,
  "source_integration_id" text
    REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "source_workspace_id" text
    REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "target_integration_id" text NOT NULL
    REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "target_workspace_id" text NOT NULL
    REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "target_prior_token_family_id" text NOT NULL
    REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE RESTRICT,
  "target_prior_connection_intent_id" text NOT NULL
    REFERENCES "tokenless_agent_connection_intents"("intent_id") ON DELETE RESTRICT,
  "completed_integration_id" text
    REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "oauth_client_id" text NOT NULL
    REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "oauth_subject_principal_id" text NOT NULL
    REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "initiating_mcp_session_hash" text NOT NULL,
  "target_binding_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'source_confirmation_required',
  "source_confirmed_at" timestamp with time zone,
  "target_approved_at" timestamp with time zone,
  "target_approved_by" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_workspace_moves_status_check" CHECK (
    "status" IN ('source_confirmation_required','owner_approval_required','completed','expired','cancelled')
  ),
  CONSTRAINT "tokenless_agent_workspace_moves_source_tuple_check" CHECK (
    ("source_integration_id" IS NULL AND "source_workspace_id" IS NULL)
    OR ("source_integration_id" IS NOT NULL AND "source_workspace_id" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_workspace_moves_hash_check" CHECK (
    "initiating_mcp_session_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "target_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_workspace_moves_time_check" CHECK (
    "expires_at" > "created_at"
    AND ("source_confirmed_at" IS NULL OR "source_confirmed_at" >= "created_at")
    AND ("target_approved_at" IS NULL OR "target_approved_at" >= "created_at")
    AND ("completed_at" IS NULL OR "completed_at" >= "created_at")
  ),
  CONSTRAINT "tokenless_agent_workspace_moves_state_check" CHECK (
    ("status" = 'source_confirmation_required' AND "source_confirmed_at" IS NULL
      AND "target_approved_at" IS NULL AND "completed_at" IS NULL AND "completed_integration_id" IS NULL)
    OR ("status" = 'owner_approval_required' AND "source_confirmed_at" IS NOT NULL
      AND "target_approved_at" IS NULL AND "completed_at" IS NULL AND "completed_integration_id" IS NULL)
    OR ("status" = 'completed' AND "source_confirmed_at" IS NOT NULL
      AND "target_approved_at" IS NOT NULL AND "target_approved_by" IS NOT NULL
      AND "completed_at" IS NOT NULL AND "completed_integration_id" IS NOT NULL)
    OR ("status" IN ('expired','cancelled') AND "completed_at" IS NULL AND "completed_integration_id" IS NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_workspace_moves_active_family_unique"
  ON "tokenless_agent_workspace_moves" ("source_token_family_id")
  WHERE "status" IN ('source_confirmation_required','owner_approval_required');--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_workspace_moves_active_target_unique"
  ON "tokenless_agent_workspace_moves" ("target_integration_id")
  WHERE "status" IN ('source_confirmation_required','owner_approval_required');--> statement-breakpoint
CREATE INDEX "tokenless_agent_workspace_moves_target_status_idx"
  ON "tokenless_agent_workspace_moves" ("target_workspace_id","status","created_at");

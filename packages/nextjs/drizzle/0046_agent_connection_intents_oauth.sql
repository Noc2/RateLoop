CREATE TABLE "tokenless_agent_oauth_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "client_secret_hash" text,
  "client_name" text NOT NULL,
  "client_uri" text,
  "logo_uri" text,
  "redirect_uris_json" text NOT NULL,
  "redirect_uris_digest" text NOT NULL,
  "token_endpoint_auth_method" text NOT NULL,
  "grant_types_json" text NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  "response_types_json" text NOT NULL DEFAULT '["code"]',
  "allowed_scopes_json" text NOT NULL,
  "registration_source" text NOT NULL,
  "client_id_metadata_url" text,
  "metadata_document_digest" text,
  "metadata_fetched_at" timestamp with time zone,
  "software_id" text,
  "software_version" text,
  "registered_by_principal_id" text REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  CONSTRAINT "tokenless_agent_oauth_clients_auth_method_check" CHECK (
    "token_endpoint_auth_method" IN ('none','client_secret_basic','client_secret_post')
  ),
  CONSTRAINT "tokenless_agent_oauth_clients_secret_check" CHECK (
    ("token_endpoint_auth_method" = 'none' AND "client_secret_hash" IS NULL)
    OR ("token_endpoint_auth_method" <> 'none' AND "client_secret_hash" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_oauth_clients_source_check" CHECK (
    "registration_source" IN ('pre_registered','client_id_metadata','dynamic')
  ),
  CONSTRAINT "tokenless_agent_oauth_clients_status_check" CHECK ("status" IN ('active','revoked','expired')),
  CONSTRAINT "tokenless_agent_oauth_clients_redirect_digest_unique" UNIQUE ("client_id", "redirect_uris_digest")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_clients_status_idx"
  ON "tokenless_agent_oauth_clients" USING btree ("status", "expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_clients_metadata_idx"
  ON "tokenless_agent_oauth_clients" USING btree ("client_id_metadata_url", "metadata_fetched_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_oauth_token_families" (
  "token_family_id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "subject_principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "audience" text NOT NULL,
  "resource" text NOT NULL,
  "granted_scopes_json" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL,
  "absolute_expires_at" timestamp with time zone NOT NULL,
  "last_rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "revocation_reason" text,
  CONSTRAINT "tokenless_agent_oauth_token_families_status_check" CHECK ("status" IN ('active','revoked','expired')),
  CONSTRAINT "tokenless_agent_oauth_token_families_expiry_check" CHECK ("absolute_expires_at" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_token_families_client_subject_idx"
  ON "tokenless_agent_oauth_token_families" USING btree ("client_id", "subject_principal_id", "status");--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_token_families_expiry_idx"
  ON "tokenless_agent_oauth_token_families" USING btree ("status", "absolute_expires_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_oauth_authorization_codes" (
  "authorization_code_id" text PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "token_family_id" text NOT NULL REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "subject_principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "redirect_uri" text NOT NULL,
  "redirect_uri_digest" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL DEFAULT 'S256',
  "state_hash" text,
  "audience" text NOT NULL,
  "resource" text NOT NULL,
  "granted_scopes_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_oauth_authorization_codes_hash_unique" UNIQUE ("code_hash"),
  CONSTRAINT "tokenless_agent_oauth_authorization_codes_family_unique" UNIQUE ("token_family_id"),
  CONSTRAINT "tokenless_agent_oauth_authorization_codes_challenge_check" CHECK (
    "code_challenge_method" = 'S256'
  ),
  CONSTRAINT "tokenless_agent_oauth_authorization_codes_expiry_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_authorization_codes_expiry_idx"
  ON "tokenless_agent_oauth_authorization_codes" USING btree ("expires_at", "consumed_at", "revoked_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_oauth_refresh_tokens" (
  "refresh_token_id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "token_family_id" text NOT NULL REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "subject_principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "audience" text NOT NULL,
  "resource" text NOT NULL,
  "granted_scopes_json" text NOT NULL,
  "generation" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "replaced_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  CONSTRAINT "tokenless_agent_oauth_refresh_tokens_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "tokenless_agent_oauth_refresh_tokens_generation_unique" UNIQUE ("token_family_id", "generation"),
  CONSTRAINT "tokenless_agent_oauth_refresh_tokens_generation_check" CHECK ("generation" >= 1),
  CONSTRAINT "tokenless_agent_oauth_refresh_tokens_expiry_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_refresh_tokens_family_status_idx"
  ON "tokenless_agent_oauth_refresh_tokens" USING btree ("token_family_id", "generation", "revoked_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_refresh_tokens_expiry_idx"
  ON "tokenless_agent_oauth_refresh_tokens" USING btree ("expires_at", "revoked_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_oauth_access_tokens" (
  "access_token_id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "token_family_id" text NOT NULL REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE CASCADE,
  "refresh_token_id" text REFERENCES "tokenless_agent_oauth_refresh_tokens"("refresh_token_id") ON DELETE SET NULL,
  "client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "subject_principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "audience" text NOT NULL,
  "resource" text NOT NULL,
  "granted_scopes_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  CONSTRAINT "tokenless_agent_oauth_access_tokens_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "tokenless_agent_oauth_access_tokens_expiry_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_access_tokens_family_status_idx"
  ON "tokenless_agent_oauth_access_tokens" USING btree ("token_family_id", "expires_at", "revoked_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_access_tokens_refresh_idx"
  ON "tokenless_agent_oauth_access_tokens" USING btree ("refresh_token_id", "expires_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_connection_intents" (
  "intent_id" text PRIMARY KEY NOT NULL,
  "claim_nonce_hash" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "created_by" text NOT NULL,
  "status" text NOT NULL DEFAULT 'issued',
  "profile_key" text NOT NULL,
  "profile_version" integer NOT NULL,
  "maximum_scopes_json" text NOT NULL,
  "allowed_workflow_keys_json" text NOT NULL DEFAULT '[]',
  "review_preset_json" text NOT NULL DEFAULT '{}',
  "preferred_host_family" text,
  "allowed_host_families_json" text NOT NULL DEFAULT '[]',
  "auto_activate" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL,
  "claim_expires_at" timestamp with time zone NOT NULL,
  "hard_expires_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "tested_at" timestamp with time zone,
  "connected_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "claimed_token_family_id" text REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE RESTRICT,
  "claimed_oauth_client_id" text REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "claimed_subject_principal_id" text REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "client_name" text,
  "client_version" text,
  "client_capabilities_json" text NOT NULL DEFAULT '[]',
  "last_transition_at" timestamp with time zone NOT NULL,
  "last_transition_reason" text,
  "last_diagnostic_code" text,
  "last_diagnostic_at" timestamp with time zone,
  "recovery_action" text,
  CONSTRAINT "tokenless_agent_connection_intents_nonce_unique" UNIQUE ("claim_nonce_hash"),
  CONSTRAINT "tokenless_agent_connection_intents_family_unique" UNIQUE ("claimed_token_family_id"),
  CONSTRAINT "tokenless_agent_connection_intents_status_check" CHECK (
    "status" IN (
      'issued','install_required','authorizing','approval_required','testing','connected',
      'action_required','rejected','expired','cancelled'
    )
  ),
  CONSTRAINT "tokenless_agent_connection_intents_profile_version_check" CHECK ("profile_version" >= 1),
  CONSTRAINT "tokenless_agent_connection_intents_deadline_order_check" CHECK (
    "claim_expires_at" > "created_at" AND "hard_expires_at" >= "claim_expires_at"
  ),
  CONSTRAINT "tokenless_agent_connection_intents_claim_deadline_check" CHECK (
    "claim_expires_at" = "created_at" + INTERVAL '30 minutes'
  ),
  CONSTRAINT "tokenless_agent_connection_intents_hard_deadline_check" CHECK (
    "hard_expires_at" = "created_at" + INTERVAL '45 minutes'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_connection_intents_workspace_status_idx"
  ON "tokenless_agent_connection_intents" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_connection_intents_expiry_idx"
  ON "tokenless_agent_connection_intents" USING btree ("status", "claim_expires_at", "hard_expires_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_connection_intent_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "intent_id" text NOT NULL REFERENCES "tokenless_agent_connection_intents"("intent_id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "reason" text NOT NULL,
  "diagnostic_code" text,
  "details_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_connection_intent_events_actor_check" CHECK (
    "actor_type" IN ('account','principal','oauth_client','service')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_connection_intent_events_intent_created_idx"
  ON "tokenless_agent_connection_intent_events" USING btree ("intent_id", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_connection_intent_events_workspace_created_idx"
  ON "tokenless_agent_connection_intent_events" USING btree ("workspace_id", "created_at");--> statement-breakpoint

ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "pairing_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "publishing_policy_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "publishing_policy_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ALTER COLUMN "credential_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "connection_intent_id" text
  REFERENCES "tokenless_agent_connection_intents"("intent_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "token_family_id" text
  REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "activation_mode" text NOT NULL DEFAULT 'legacy_pairing';--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "granted_scopes_json" text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "oauth_client_id" text
  REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "oauth_subject_principal_id" text
  REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "last_initialize_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "last_context_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "last_connection_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "last_diagnostic_code" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "last_diagnostic_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD COLUMN "recovery_action" text;--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD CONSTRAINT "tokenless_agent_integrations_connection_intent_unique"
  UNIQUE ("connection_intent_id");--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD CONSTRAINT "tokenless_agent_integrations_token_family_unique"
  UNIQUE ("token_family_id");--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD CONSTRAINT "tokenless_agent_integrations_activation_mode_check"
  CHECK ("activation_mode" IN ('preauthorized_safe','owner_approved','legacy_pairing'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_integrations" ADD CONSTRAINT "tokenless_agent_integrations_credential_source_check"
  CHECK (
    ("activation_mode" = 'legacy_pairing' AND "pairing_id" IS NOT NULL AND "api_key_id" IS NOT NULL)
    OR (
      "activation_mode" IN ('preauthorized_safe','owner_approved')
      AND "connection_intent_id" IS NOT NULL
      AND "token_family_id" IS NOT NULL
      AND "oauth_client_id" IS NOT NULL
      AND "oauth_subject_principal_id" IS NOT NULL
    )
  );--> statement-breakpoint
CREATE INDEX "tokenless_agent_integrations_oauth_client_idx"
  ON "tokenless_agent_integrations" USING btree ("oauth_client_id", "oauth_subject_principal_id", "status");--> statement-breakpoint

ALTER TABLE "tokenless_agent_integration_events"
  DROP CONSTRAINT "tokenless_agent_integration_events_type_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_integration_events"
  ADD CONSTRAINT "tokenless_agent_integration_events_type_check" CHECK (
    "event_type" IN (
      'approved','connected','credential_rotated','oauth_token_rotated',
      'connection_test_failed','scope_upgraded','revoked'
    )
  );--> statement-breakpoint
ALTER TABLE "tokenless_agent_integration_events"
  DROP CONSTRAINT "tokenless_agent_integration_events_actor_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_integration_events"
  ADD CONSTRAINT "tokenless_agent_integration_events_actor_check" CHECK (
    "actor_type" IN ('account','service','oauth_client')
  );

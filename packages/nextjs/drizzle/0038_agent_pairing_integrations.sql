CREATE TABLE "tokenless_agent_pairing_sessions" (
  "pairing_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "api_key_id" text NOT NULL,
  "credential_hash" text NOT NULL,
  "credential_prefix" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "external_id" text,
  "display_name" text,
  "description" text,
  "declared_provider" text,
  "declared_model" text,
  "declared_model_version" text,
  "declared_deployment_name" text,
  "environment" text,
  "client_name" text,
  "client_version" text,
  "client_capabilities_json" text NOT NULL DEFAULT '[]',
  "requested_workflow_keys_json" text NOT NULL DEFAULT '[]',
  "created_by" text NOT NULL,
  "resolved_by" text,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_pairing_sessions_status_check" CHECK ("status" IN ('open', 'claimed', 'approved', 'rejected', 'expired', 'revoked')),
  CONSTRAINT "tokenless_agent_pairing_sessions_environment_check" CHECK ("environment" IS NULL OR "environment" IN ('sandbox', 'staging', 'production')),
  CONSTRAINT "tokenless_agent_pairing_sessions_credential_unique" UNIQUE ("credential_hash"),
  CONSTRAINT "tokenless_agent_pairing_sessions_api_key_unique" UNIQUE ("api_key_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_pairing_sessions_workspace_status_idx"
  ON "tokenless_agent_pairing_sessions" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_pairing_sessions_expiry_idx"
  ON "tokenless_agent_pairing_sessions" USING btree ("status", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_integrations" (
  "integration_id" text PRIMARY KEY NOT NULL,
  "pairing_id" text NOT NULL REFERENCES "tokenless_agent_pairing_sessions"("pairing_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "review_policy_id" text NOT NULL,
  "review_policy_version" integer NOT NULL,
  "publishing_policy_id" text NOT NULL REFERENCES "tokenless_agent_publishing_policies"("policy_id"),
  "publishing_policy_version" integer NOT NULL,
  "api_key_id" text NOT NULL REFERENCES "tokenless_workspace_api_keys"("key_id"),
  "status" text NOT NULL DEFAULT 'active',
  "enforcement_mode" text NOT NULL,
  "allowed_workflow_keys_json" text NOT NULL DEFAULT '[]',
  "client_name" text,
  "client_version" text,
  "client_capabilities_json" text NOT NULL DEFAULT '[]',
  "host_enforcement_evidence_reference" text,
  "credential_expires_at" timestamp with time zone NOT NULL,
  "credential_rotated_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "last_decision_at" timestamp with time zone,
  "last_request_at" timestamp with time zone,
  "last_result_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_integrations_agent_version_fk" FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_integrations_review_policy_fk" FOREIGN KEY ("workspace_id", "review_policy_id", "review_policy_version")
    REFERENCES "tokenless_agent_review_policies"("workspace_id", "policy_id", "version"),
  CONSTRAINT "tokenless_agent_integrations_status_check" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "tokenless_agent_integrations_enforcement_check" CHECK ("enforcement_mode" IN ('host_enforced', 'advisory')),
  CONSTRAINT "tokenless_agent_integrations_review_policy_version_check" CHECK ("review_policy_version" >= 1),
  CONSTRAINT "tokenless_agent_integrations_publishing_policy_version_check" CHECK ("publishing_policy_version" >= 1),
  CONSTRAINT "tokenless_agent_integrations_host_evidence_check" CHECK (
    "enforcement_mode" <> 'host_enforced' OR "host_enforcement_evidence_reference" IS NOT NULL
  ),
  CONSTRAINT "tokenless_agent_integrations_pairing_unique" UNIQUE ("pairing_id"),
  CONSTRAINT "tokenless_agent_integrations_api_key_unique" UNIQUE ("api_key_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_integrations_workspace_status_idx"
  ON "tokenless_agent_integrations" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_integrations_agent_version_idx"
  ON "tokenless_agent_integrations" USING btree ("workspace_id", "agent_id", "agent_version_id", "status");--> statement-breakpoint
CREATE TABLE "tokenless_agent_integration_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"("integration_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_integration_events_type_check" CHECK ("event_type" IN ('approved', 'credential_rotated', 'revoked')),
  CONSTRAINT "tokenless_agent_integration_events_actor_check" CHECK ("actor_type" IN ('account', 'service'))
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_integration_events_integration_created_idx"
  ON "tokenless_agent_integration_events" USING btree ("integration_id", "created_at");

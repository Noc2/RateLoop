CREATE TABLE "tokenless_agents" (
  "agent_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "external_id" text NOT NULL,
  "owner_account_address" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "deactivated_at" timestamp with time zone,
  CONSTRAINT "tokenless_agents_status_check" CHECK ("status" IN ('active', 'inactive')),
  CONSTRAINT "tokenless_agents_external_id_unique" UNIQUE ("workspace_id", "external_id"),
  CONSTRAINT "tokenless_agents_workspace_agent_unique" UNIQUE ("workspace_id", "agent_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agents_workspace_status_idx"
  ON "tokenless_agents" USING btree ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_versions" (
  "version_id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "version_number" integer NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "declared_provider" text NOT NULL,
  "declared_model" text NOT NULL,
  "declared_model_version" text,
  "declared_deployment_name" text,
  "environment" text NOT NULL,
  "configuration_commitment" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_versions_number_check" CHECK ("version_number" >= 1),
  CONSTRAINT "tokenless_agent_versions_environment_check" CHECK ("environment" IN ('sandbox', 'staging', 'production')),
  CONSTRAINT "tokenless_agent_versions_number_unique" UNIQUE ("agent_id", "version_number"),
  CONSTRAINT "tokenless_agent_versions_commitment_unique" UNIQUE ("agent_id", "configuration_commitment"),
  CONSTRAINT "tokenless_agent_versions_workspace_agent_unique" UNIQUE ("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_versions_workspace_agent_fk" FOREIGN KEY ("workspace_id", "agent_id")
    REFERENCES "tokenless_agents"("workspace_id", "agent_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_versions_workspace_agent_idx"
  ON "tokenless_agent_versions" USING btree ("workspace_id", "agent_id", "version_number");--> statement-breakpoint
CREATE TABLE "tokenless_agent_audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "agent_id" text NOT NULL,
  "version_id" text,
  "event_type" text NOT NULL,
  "actor_account_address" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_audit_events_type_check" CHECK ("event_type" IN ('agent.created', 'agent.version_created', 'agent.deactivated')),
  CONSTRAINT "tokenless_agent_audit_events_workspace_agent_fk" FOREIGN KEY ("workspace_id", "agent_id")
    REFERENCES "tokenless_agents"("workspace_id", "agent_id"),
  CONSTRAINT "tokenless_agent_audit_events_workspace_version_fk" FOREIGN KEY ("workspace_id", "agent_id", "version_id")
    REFERENCES "tokenless_agent_versions"("workspace_id", "agent_id", "version_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_audit_events_workspace_agent_idx"
  ON "tokenless_agent_audit_events" USING btree ("workspace_id", "agent_id", "created_at");

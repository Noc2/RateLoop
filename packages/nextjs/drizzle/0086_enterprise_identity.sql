ALTER TABLE "tokenless_better_auth_users"
  ADD COLUMN "role" text,
  ADD COLUMN "banned" boolean DEFAULT false,
  ADD COLUMN "ban_reason" text,
  ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_better_auth_sessions"
  ADD COLUMN "impersonated_by" text,
  ADD COLUMN "authentication_method" text;--> statement-breakpoint

CREATE TABLE "tokenless_better_auth_sso_providers" (
  "id" text PRIMARY KEY NOT NULL,
  "issuer" text NOT NULL,
  "oidc_config" text,
  "saml_config" text,
  "user_id" text NOT NULL REFERENCES "tokenless_better_auth_users"("id") ON DELETE CASCADE,
  "provider_id" text NOT NULL,
  "organization_id" text,
  "domain" text NOT NULL,
  "domain_verified" boolean DEFAULT false,
  CONSTRAINT "tokenless_better_auth_sso_provider_id_unique" UNIQUE ("provider_id"),
  CONSTRAINT "tokenless_better_auth_sso_provider_domain_unique" UNIQUE ("provider_id", "domain"),
  CONSTRAINT "tokenless_better_auth_sso_protocol_check" CHECK (
    ("oidc_config" IS NOT NULL AND "saml_config" IS NULL)
    OR ("oidc_config" IS NULL AND "saml_config" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_better_auth_sso_domain_check" CHECK (
    lower("domain") = "domain" AND char_length("domain") BETWEEN 3 AND 253
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_sso_user_idx"
  ON "tokenless_better_auth_sso_providers" ("user_id");--> statement-breakpoint

CREATE TABLE "tokenless_better_auth_scim_providers" (
  "id" text PRIMARY KEY NOT NULL,
  "provider_id" text NOT NULL,
  "scim_token" text NOT NULL,
  "organization_id" text,
  "user_id" text NOT NULL REFERENCES "tokenless_better_auth_users"("id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_better_auth_scim_provider_id_unique" UNIQUE ("provider_id"),
  CONSTRAINT "tokenless_better_auth_scim_token_unique" UNIQUE ("scim_token")
);--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_scim_user_idx"
  ON "tokenless_better_auth_scim_providers" ("user_id");--> statement-breakpoint

CREATE TABLE "tokenless_enterprise_identity_providers" (
  "provider_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "protocol" text NOT NULL,
  "domain" text NOT NULL,
  "enforce_sso" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "last_sso_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_enterprise_identity_provider_workspace_unique" UNIQUE ("workspace_id", "provider_id"),
  CONSTRAINT "tokenless_enterprise_identity_provider_protocol_check" CHECK ("protocol" IN ('oidc','saml')),
  CONSTRAINT "tokenless_enterprise_identity_provider_status_check" CHECK ("status" IN ('active','disabled')),
  CONSTRAINT "tokenless_enterprise_identity_provider_domain_check" CHECK (lower("domain") = "domain")
  ,FOREIGN KEY ("provider_id", "domain")
    REFERENCES "tokenless_better_auth_sso_providers"("provider_id", "domain") ON UPDATE CASCADE ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_enterprise_identity_provider_domain_unique"
  ON "tokenless_enterprise_identity_providers" (lower("domain"));--> statement-breakpoint
CREATE INDEX "tokenless_enterprise_identity_provider_workspace_idx"
  ON "tokenless_enterprise_identity_providers" ("workspace_id", "status");--> statement-breakpoint

CREATE TABLE "tokenless_enterprise_scim_connections" (
  "provider_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_better_auth_scim_providers"("provider_id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "last_sync_at" timestamp with time zone,
  "last_sync_result" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_enterprise_scim_workspace_unique" UNIQUE ("workspace_id"),
  CONSTRAINT "tokenless_enterprise_scim_status_check" CHECK ("status" IN ('active','revoked')),
  CONSTRAINT "tokenless_enterprise_scim_result_check" CHECK (
    "last_sync_result" IS NULL OR "last_sync_result" IN ('success','failure')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_enterprise_managed_members" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "provider_id" text NOT NULL,
  -- Keep the provider subject after SCIM DELETE removes the Better Auth user so
  -- the workspace-local deprovision projection and its audit trail survive.
  "better_auth_user_id" text NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "source" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "last_synced_at" timestamp with time zone NOT NULL,
  "deactivated_at" timestamp with time zone,
  PRIMARY KEY ("workspace_id", "provider_id", "better_auth_user_id"),
  CONSTRAINT "tokenless_enterprise_managed_member_principal_unique" UNIQUE ("workspace_id", "principal_id"),
  CONSTRAINT "tokenless_enterprise_managed_member_source_check" CHECK ("source" IN ('sso','scim')),
  CONSTRAINT "tokenless_enterprise_managed_member_status_check" CHECK ("status" IN ('active','deactivated')),
  CONSTRAINT "tokenless_enterprise_managed_member_deactivation_check" CHECK (
    ("status" = 'active' AND "deactivated_at" IS NULL)
    OR ("status" = 'deactivated' AND "deactivated_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_enterprise_managed_member_user_idx"
  ON "tokenless_enterprise_managed_members" ("better_auth_user_id", "status");--> statement-breakpoint

CREATE TABLE "tokenless_enterprise_identity_audit_outbox" (
  "event_key" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "assurance_method" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" text NOT NULL,
  "purpose" text NOT NULL,
  "reason" text NOT NULL,
  "result" text NOT NULL,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "delivery_state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "delivered_at" timestamp with time zone,
  CONSTRAINT "tokenless_enterprise_identity_audit_actor_kind_check"
    CHECK ("actor_kind" IN ('principal','system')),
  CONSTRAINT "tokenless_enterprise_identity_audit_result_check"
    CHECK ("result" IN ('success','denied','failure')),
  CONSTRAINT "tokenless_enterprise_identity_audit_delivery_check"
    CHECK ("delivery_state" IN ('reserved','pending','delivered')),
  CONSTRAINT "tokenless_enterprise_identity_audit_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "tokenless_enterprise_identity_audit_delivery_time_check" CHECK (
    ("delivery_state" IN ('reserved','pending') AND "delivered_at" IS NULL)
    OR ("delivery_state" = 'delivered' AND "delivered_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_enterprise_identity_audit_due_idx"
  ON "tokenless_enterprise_identity_audit_outbox" ("delivery_state", "next_attempt_at", "occurred_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_guard_scim_single_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tokenless_enterprise_managed_members e
    WHERE e.principal_id = NEW.account_address AND e.source = 'scim' AND e.status = 'active'
      AND e.workspace_id <> NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'SCIM-managed identities cannot join another workspace';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_workspace_members_scim_single_workspace_guard
  BEFORE INSERT OR UPDATE ON "tokenless_workspace_members"
  FOR EACH ROW EXECUTE FUNCTION tokenless_guard_scim_single_workspace();

CREATE TABLE "tokenless_private_groups" (
  "group_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "name" text NOT NULL,
  "purpose" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "current_policy_version" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_groups_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "tokenless_private_groups_policy_version_check" CHECK ("current_policy_version" >= 1),
  CONSTRAINT "tokenless_private_groups_workspace_name_unique" UNIQUE("workspace_id", "name")
);--> statement-breakpoint
CREATE INDEX "tokenless_private_groups_workspace_status_idx"
  ON "tokenless_private_groups" USING btree ("workspace_id", "status", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_private_group_policy_versions" (
  "group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "version" integer NOT NULL,
  "default_compensation" text NOT NULL,
  "world_id_required" boolean DEFAULT false NOT NULL,
  "allowed_project_ids_json" text DEFAULT '[]' NOT NULL,
  "data_classifications_json" text DEFAULT '["internal","confidential"]' NOT NULL,
  "retention_days" integer DEFAULT 30 NOT NULL,
  "export_allowed" boolean DEFAULT false NOT NULL,
  "notification_defaults_json" text DEFAULT '{"assignmentAvailable":true}' NOT NULL,
  "policy_hash" text NOT NULL,
  "policy_json" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("group_id", "version"),
  CONSTRAINT "tokenless_private_group_policy_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_private_group_policy_compensation_check" CHECK ("default_compensation" IN ('unpaid', 'paid')),
  CONSTRAINT "tokenless_private_group_policy_retention_check" CHECK ("retention_days" BETWEEN 1 AND 3650),
  CONSTRAINT "tokenless_private_group_policy_hash_unique" UNIQUE("group_id", "policy_hash")
);--> statement-breakpoint
CREATE TABLE "tokenless_private_group_invitations" (
  "invitation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "role" text DEFAULT 'reviewer' NOT NULL,
  "allowed_project_ids_json" text DEFAULT '[]' NOT NULL,
  "intended_account_address" text,
  "intended_email_hash" text,
  "intended_email_domain" text,
  "membership_expires_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "maximum_redemptions" integer DEFAULT 1 NOT NULL,
  "redemption_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_group_invitations_token_unique" UNIQUE("token_hash"),
  CONSTRAINT "tokenless_private_group_invitations_role_check" CHECK ("role" = 'reviewer'),
  CONSTRAINT "tokenless_private_group_invitations_redemption_check" CHECK (
    "maximum_redemptions" BETWEEN 1 AND 1000 AND "redemption_count" BETWEEN 0 AND "maximum_redemptions"
  ),
  CONSTRAINT "tokenless_private_group_invitations_lifetime_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_invitations_group_state_idx"
  ON "tokenless_private_group_invitations" USING btree ("workspace_id", "group_id", "expires_at", "revoked_at");--> statement-breakpoint
CREATE INDEX "tokenless_private_group_invitations_prefix_idx"
  ON "tokenless_private_group_invitations" USING btree ("token_prefix");--> statement-breakpoint
CREATE TABLE "tokenless_private_group_memberships" (
  "group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "principal_address" text NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "role" text DEFAULT 'reviewer' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "allowed_project_ids_json" text DEFAULT '[]' NOT NULL,
  "source_invitation_id" text REFERENCES "tokenless_private_group_invitations"("invitation_id"),
  "membership_expires_at" timestamp with time zone,
  "joined_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "end_reason" text,
  "created_by" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("group_id", "principal_address"),
  CONSTRAINT "tokenless_private_group_memberships_role_check" CHECK ("role" = 'reviewer'),
  CONSTRAINT "tokenless_private_group_memberships_status_check" CHECK ("status" IN ('active', 'removed', 'left', 'expired')),
  CONSTRAINT "tokenless_private_group_memberships_terminal_check" CHECK (
    ("status" = 'active' AND "ended_at" IS NULL AND "end_reason" IS NULL)
    OR ("status" <> 'active' AND "ended_at" IS NOT NULL AND "end_reason" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_memberships_principal_status_idx"
  ON "tokenless_private_group_memberships" USING btree ("principal_address", "status", "membership_expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_private_group_invitation_redemptions" (
  "invitation_id" text NOT NULL REFERENCES "tokenless_private_group_invitations"("invitation_id"),
  "principal_address" text NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "redeemed_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("invitation_id", "principal_address")
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_invitation_redemptions_group_idx"
  ON "tokenless_private_group_invitation_redemptions" USING btree ("group_id", "redeemed_at");--> statement-breakpoint
CREATE TABLE "tokenless_private_group_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "invitation_id" text REFERENCES "tokenless_private_group_invitations"("invitation_id"),
  "principal_address" text,
  "event_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_group_events_type_check" CHECK (
    "event_type" IN ('group_created', 'policy_version_created', 'invitation_created', 'invitation_redeemed',
      'invitation_revoked', 'membership_removed', 'membership_left')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_events_group_created_idx"
  ON "tokenless_private_group_events" USING btree ("workspace_id", "group_id", "created_at");

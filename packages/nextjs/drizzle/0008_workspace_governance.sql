CREATE TABLE "tokenless_workspace_governance" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "default_retention_days" integer DEFAULT 30 NOT NULL,
  "trader_status" text DEFAULT 'unverified' NOT NULL,
  "trader_legal_name" text,
  "trader_registration_number" text,
  "trader_registered_address" text,
  "vat_country_code" text,
  "vat_id" text,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_governance_retention_check" CHECK ("default_retention_days" BETWEEN 1 AND 3650),
  CONSTRAINT "tokenless_workspace_governance_trader_status_check" CHECK ("trader_status" IN ('unverified', 'verified', 'not_applicable'))
);--> statement-breakpoint
CREATE TABLE "tokenless_workspace_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "dpa_status" text DEFAULT 'not_started' NOT NULL,
  "dpa_reference" text,
  "dpa_effective_at" timestamp with time zone,
  "retention_days" integer,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_clients_workspace_client_unique" UNIQUE("workspace_id", "client_id"),
  CONSTRAINT "tokenless_workspace_clients_dpa_status_check" CHECK ("dpa_status" IN ('not_started', 'pending', 'signed', 'not_required')),
  CONSTRAINT "tokenless_workspace_clients_retention_check" CHECK ("retention_days" IS NULL OR "retention_days" BETWEEN 1 AND 3650)
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_clients_workspace_status_idx" ON "tokenless_workspace_clients" USING btree ("workspace_id", "status", "name");--> statement-breakpoint
CREATE TABLE "tokenless_workspace_member_governance" (
  "workspace_id" text NOT NULL,
  "account_address" text NOT NULL,
  "governance_role" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "account_address"),
  FOREIGN KEY ("workspace_id", "account_address") REFERENCES "tokenless_workspace_members"("workspace_id", "account_address"),
  CONSTRAINT "tokenless_workspace_member_governance_role_check" CHECK ("governance_role" IN ('consultant', 'end_client', 'decision_owner', 'billing'))
);--> statement-breakpoint
CREATE TABLE "tokenless_workspace_member_clients" (
  "workspace_id" text NOT NULL,
  "client_id" text NOT NULL,
  "account_address" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "client_id", "account_address"),
  FOREIGN KEY ("workspace_id", "client_id") REFERENCES "tokenless_workspace_clients"("workspace_id", "client_id"),
  FOREIGN KEY ("workspace_id", "account_address") REFERENCES "tokenless_workspace_members"("workspace_id", "account_address")
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_member_clients_account_idx" ON "tokenless_workspace_member_clients" USING btree ("workspace_id", "account_address", "client_id");--> statement-breakpoint
CREATE TABLE "tokenless_workspace_member_invites" (
  "invite_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "client_id" text,
  "invite_token_hash" text NOT NULL,
  "intended_account_address" text,
  "access_role" text NOT NULL,
  "governance_role" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "redeemed_at" timestamp with time zone,
  "redeemed_by_account_address" text,
  "revoked_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_member_invites_token_hash_unique" UNIQUE("invite_token_hash"),
  FOREIGN KEY ("workspace_id", "client_id") REFERENCES "tokenless_workspace_clients"("workspace_id", "client_id"),
  CONSTRAINT "tokenless_workspace_member_invites_access_role_check" CHECK ("access_role" IN ('admin', 'member', 'billing')),
  CONSTRAINT "tokenless_workspace_member_invites_governance_role_check" CHECK ("governance_role" IN ('consultant', 'end_client', 'decision_owner', 'billing'))
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_member_invites_workspace_state_idx" ON "tokenless_workspace_member_invites" USING btree ("workspace_id", "expires_at", "redeemed_at", "revoked_at");--> statement-breakpoint
CREATE TABLE "tokenless_workspace_cost_centers" (
  "cost_center_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "client_id" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_cost_centers_workspace_code_unique" UNIQUE("workspace_id", "code"),
  FOREIGN KEY ("workspace_id", "client_id") REFERENCES "tokenless_workspace_clients"("workspace_id", "client_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_cost_centers_client_idx" ON "tokenless_workspace_cost_centers" USING btree ("workspace_id", "client_id", "status", "code");

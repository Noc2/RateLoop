CREATE TABLE "tokenless_agent_publishing_policies" (
  "policy_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "name" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "enabled" boolean NOT NULL DEFAULT true,
  "effective_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "allowed_payment_modes_json" text NOT NULL,
  "payer_address" text,
  "max_panel_atomic" numeric(78, 0) NOT NULL,
  "max_daily_atomic" numeric(78, 0) NOT NULL,
  "max_monthly_atomic" numeric(78, 0) NOT NULL,
  "max_panel_size" integer NOT NULL,
  "max_bounty_atomic" numeric(78, 0) NOT NULL,
  "max_fee_bps" integer NOT NULL,
  "max_attempt_reserve_atomic" numeric(78, 0) NOT NULL,
  "allowed_project_ids_json" text NOT NULL DEFAULT '[]',
  "allowed_reviewer_sources_json" text NOT NULL,
  "allowed_admission_policy_hashes_json" text NOT NULL,
  "allowed_data_classifications_json" text NOT NULL DEFAULT '[]',
  "max_retention_days" integer,
  "allow_public_urls" boolean NOT NULL DEFAULT false,
  "allowed_webhook_endpoint_ids_json" text NOT NULL DEFAULT '[]',
  "allowed_prompt_templates_json" text NOT NULL DEFAULT '[]',
  "on_policy_miss" text NOT NULL DEFAULT 'deny',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_publishing_policies_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_agent_publishing_policies_caps_check" CHECK (
    "max_panel_atomic" > 0 AND "max_daily_atomic" > 0 AND "max_monthly_atomic" > 0
    AND "max_panel_size" BETWEEN 3 AND 500 AND "max_bounty_atomic" > 0
    AND "max_fee_bps" BETWEEN 0 AND 2000 AND "max_attempt_reserve_atomic" > 0
  ),
  CONSTRAINT "tokenless_agent_publishing_policies_miss_check" CHECK ("on_policy_miss" IN ('handoff', 'deny'))
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_publishing_policies_workspace_idx"
  ON "tokenless_agent_publishing_policies" USING btree ("workspace_id", "enabled", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_agent_policy_budget_reservations" (
  "reservation_id" text PRIMARY KEY NOT NULL,
  "policy_id" text NOT NULL REFERENCES "tokenless_agent_publishing_policies"("policy_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "api_key_id" text NOT NULL REFERENCES "tokenless_workspace_api_keys"("key_id"),
  "idempotency_key" text NOT NULL,
  "quote_id" text NOT NULL,
  "operation_key" text,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "payment_mode" text NOT NULL,
  "policy_version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'reserved',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "settled_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_policy_budget_reservations_amount_check" CHECK ("amount_atomic" > 0),
  CONSTRAINT "tokenless_agent_policy_budget_reservations_mode_check" CHECK ("payment_mode" IN ('prepaid', 'x402')),
  CONSTRAINT "tokenless_agent_policy_budget_reservations_status_check" CHECK ("status" IN ('reserved', 'spent', 'released')),
  CONSTRAINT "tokenless_agent_policy_budget_reservations_idempotency_unique" UNIQUE ("policy_id", "idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_policy_budget_reservations_policy_created_idx"
  ON "tokenless_agent_policy_budget_reservations" USING btree ("policy_id", "created_at", "status");--> statement-breakpoint
CREATE TABLE "tokenless_agent_policy_audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "policy_id" text NOT NULL REFERENCES "tokenless_agent_publishing_policies"("policy_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "api_key_id" text NOT NULL REFERENCES "tokenless_workspace_api_keys"("key_id"),
  "policy_version" integer NOT NULL,
  "event_type" text NOT NULL,
  "quote_id" text,
  "operation_key" text,
  "idempotency_key" text NOT NULL,
  "amount_atomic" numeric(78, 0),
  "payment_mode" text,
  "request_hash" text,
  "final_round_id" text,
  "details_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_policy_audit_events_idempotency_unique" UNIQUE ("policy_id", "idempotency_key", "event_type")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_policy_audit_events_policy_created_idx"
  ON "tokenless_agent_policy_audit_events" USING btree ("policy_id", "created_at");--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys"
  ADD COLUMN "scopes_json" text NOT NULL DEFAULT '["quote:read","panel:publish","payment:submit","result:read","webhook:use"]';--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "policy_id" text REFERENCES "tokenless_agent_publishing_policies"("policy_id");--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_workspace_api_keys_policy_unique" ON "tokenless_workspace_api_keys" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_api_keys_policy_expiry_idx"
  ON "tokenless_workspace_api_keys" USING btree ("policy_id", "expires_at", "revoked_at");

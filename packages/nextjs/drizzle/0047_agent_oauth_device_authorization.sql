CREATE TABLE "tokenless_agent_oauth_device_authorizations" (
  "device_authorization_id" text PRIMARY KEY NOT NULL,
  "device_code_hash" text NOT NULL,
  "user_code_hash" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "tokenless_agent_oauth_clients"("client_id") ON DELETE RESTRICT,
  "audience" text NOT NULL,
  "resource" text NOT NULL,
  "requested_scopes_json" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "interval_seconds" integer NOT NULL DEFAULT 5,
  "poll_count" integer NOT NULL DEFAULT 0,
  "last_polled_at" timestamp with time zone,
  "approved_by_principal_id" text REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "approved_at" timestamp with time zone,
  "denied_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "token_family_id" text REFERENCES "tokenless_agent_oauth_token_families"("token_family_id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_device_hash_unique" UNIQUE ("device_code_hash"),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_user_hash_unique" UNIQUE ("user_code_hash"),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_family_unique" UNIQUE ("token_family_id"),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_status_check" CHECK (
    "status" IN ('pending','approved','denied','consumed','expired')
  ),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_interval_check" CHECK (
    "interval_seconds" >= 5 AND "interval_seconds" <= 60
  ),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_poll_count_check" CHECK ("poll_count" >= 0),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_expiry_check" CHECK (
    "expires_at" = "created_at" + INTERVAL '10 minutes'
  ),
  CONSTRAINT "tokenless_agent_oauth_device_authorizations_state_check" CHECK (
    ("status" = 'pending' AND "approved_by_principal_id" IS NULL AND "approved_at" IS NULL
      AND "denied_at" IS NULL AND "consumed_at" IS NULL AND "token_family_id" IS NULL)
    OR ("status" = 'approved' AND "approved_by_principal_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND "denied_at" IS NULL AND "consumed_at" IS NULL AND "token_family_id" IS NULL)
    OR ("status" = 'denied' AND "approved_by_principal_id" IS NULL AND "approved_at" IS NULL
      AND "denied_at" IS NOT NULL AND "consumed_at" IS NULL AND "token_family_id" IS NULL)
    OR ("status" = 'consumed' AND "approved_by_principal_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND "denied_at" IS NULL AND "consumed_at" IS NOT NULL AND "token_family_id" IS NOT NULL)
    OR ("status" = 'expired' AND "consumed_at" IS NULL AND "token_family_id" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_device_authorizations_status_expiry_idx"
  ON "tokenless_agent_oauth_device_authorizations" USING btree ("status", "expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_oauth_device_authorizations_client_created_idx"
  ON "tokenless_agent_oauth_device_authorizations" USING btree ("client_id", "created_at");

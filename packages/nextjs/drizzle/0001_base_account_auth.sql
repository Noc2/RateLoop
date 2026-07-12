CREATE TABLE "tokenless_auth_nonces" (
  "nonce_hash" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_auth_nonces_expires_at_idx" ON "tokenless_auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_auth_sessions" (
  "session_hash" text PRIMARY KEY NOT NULL,
  "account_address" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_auth_sessions_account_address_idx" ON "tokenless_auth_sessions" USING btree ("account_address");--> statement-breakpoint
CREATE INDEX "tokenless_auth_sessions_expires_at_idx" ON "tokenless_auth_sessions" USING btree ("expires_at");

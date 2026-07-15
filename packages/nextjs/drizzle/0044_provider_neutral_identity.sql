CREATE TABLE "tokenless_principals" (
  "principal_id" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "disabled_at" timestamp with time zone,
  CONSTRAINT "tokenless_principals_status_check" CHECK ("status" IN ('active','disabled','deleted'))
);--> statement-breakpoint
CREATE TABLE "tokenless_identity_bindings" (
  "binding_id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_subject" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_identity_bindings_provider_subject_unique" UNIQUE("provider", "provider_subject"),
  CONSTRAINT "tokenless_identity_bindings_status_check" CHECK ("status" IN ('active','revoked'))
);--> statement-breakpoint
CREATE INDEX "tokenless_identity_bindings_principal_idx"
  ON "tokenless_identity_bindings" USING btree ("principal_id", "status");--> statement-breakpoint

CREATE TABLE "tokenless_better_auth_users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_better_auth_users_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE TABLE "tokenless_better_auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "tokenless_better_auth_users"("id") ON DELETE CASCADE,
  CONSTRAINT "tokenless_better_auth_sessions_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_sessions_user_idx"
  ON "tokenless_better_auth_sessions" USING btree ("user_id", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_better_auth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "tokenless_better_auth_users"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_better_auth_accounts_provider_unique"
  ON "tokenless_better_auth_accounts" USING btree ("provider_id", "account_id");--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_accounts_user_idx"
  ON "tokenless_better_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "tokenless_better_auth_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_verifications_identifier_idx"
  ON "tokenless_better_auth_verifications" USING btree ("identifier", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_better_auth_passkeys" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "public_key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "tokenless_better_auth_users"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL,
  "counter" integer NOT NULL,
  "device_type" text NOT NULL,
  "backed_up" boolean NOT NULL,
  "transports" text,
  "created_at" timestamp with time zone,
  "aaguid" text,
  CONSTRAINT "tokenless_better_auth_passkeys_credential_unique" UNIQUE("credential_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_better_auth_passkeys_user_idx"
  ON "tokenless_better_auth_passkeys" USING btree ("user_id");--> statement-breakpoint

ALTER TABLE "tokenless_auth_sessions" ADD COLUMN "principal_id" text;--> statement-breakpoint
ALTER TABLE "tokenless_auth_sessions" ALTER COLUMN "account_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_auth_sessions"
  ADD CONSTRAINT "tokenless_auth_sessions_principal_fk"
  FOREIGN KEY ("principal_id") REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tokenless_auth_sessions"
  ADD CONSTRAINT "tokenless_auth_sessions_subject_check"
  CHECK ("principal_id" IS NOT NULL OR "account_address" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "tokenless_auth_sessions_principal_idx"
  ON "tokenless_auth_sessions" USING btree ("principal_id", "expires_at");--> statement-breakpoint

CREATE TABLE "tokenless_thirdweb_wallet_jtis" (
  "jti_hash" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE,
  "audience" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_thirdweb_wallet_jtis_principal_idx"
  ON "tokenless_thirdweb_wallet_jtis" USING btree ("principal_id", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_wallet_binding_challenges" (
  "challenge_id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "wallet_address" text NOT NULL,
  "wallet_source" text NOT NULL,
  "chain_id" integer NOT NULL,
  "nonce_hash" text NOT NULL,
  "message_hash" text NOT NULL,
  "thirdweb_jti_hash" text REFERENCES "tokenless_thirdweb_wallet_jtis"("jti_hash") ON DELETE RESTRICT,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_wallet_binding_challenges_purpose_check" CHECK ("purpose" IN ('funding','payout','recovery')),
  CONSTRAINT "tokenless_wallet_binding_challenges_source_check" CHECK ("wallet_source" IN ('thirdweb','self_custodial'))
);--> statement-breakpoint
CREATE INDEX "tokenless_wallet_binding_challenges_principal_idx"
  ON "tokenless_wallet_binding_challenges" USING btree ("principal_id", "expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_wallet_bindings" (
  "binding_id" text PRIMARY KEY NOT NULL,
  "principal_id" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "wallet_address" text NOT NULL,
  "wallet_source" text NOT NULL,
  "chain_id" integer NOT NULL,
  "proof_message_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "tokenless_wallet_bindings_purpose_check" CHECK ("purpose" IN ('funding','payout','recovery')),
  CONSTRAINT "tokenless_wallet_bindings_source_check" CHECK ("wallet_source" IN ('thirdweb','self_custodial'))
);--> statement-breakpoint
CREATE INDEX "tokenless_wallet_bindings_principal_idx"
  ON "tokenless_wallet_bindings" USING btree ("principal_id", "purpose", "revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_wallet_bindings_active_principal_purpose_unique"
  ON "tokenless_wallet_bindings" ("principal_id", "purpose") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_wallet_bindings_active_address_purpose_unique"
  ON "tokenless_wallet_bindings" (lower("wallet_address"), "purpose") WHERE "revoked_at" IS NULL;

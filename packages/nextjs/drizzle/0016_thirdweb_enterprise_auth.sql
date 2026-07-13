ALTER TABLE "tokenless_auth_sessions" ADD COLUMN "auth_provider" text DEFAULT 'base_account' NOT NULL;--> statement-breakpoint
CREATE TABLE "tokenless_browser_identities" (
  "principal_address" text PRIMARY KEY NOT NULL,
  "thirdweb_user_id" text,
  "auth_provider" text NOT NULL,
  "primary_email" text,
  "email_verified" boolean DEFAULT false NOT NULL,
  "email_domain" text,
  "display_name" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "last_login_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_browser_identities_thirdweb_user_id_unique" UNIQUE("thirdweb_user_id")
);--> statement-breakpoint
CREATE INDEX "tokenless_browser_identities_email_domain_idx" ON "tokenless_browser_identities" USING btree ("email_domain");--> statement-breakpoint
INSERT INTO "tokenless_browser_identities"
  ("principal_address", "auth_provider", "email_verified", "created_at", "updated_at", "last_login_at")
SELECT lower("account_address"), 'base_account', false, min("created_at"), max("created_at"), max("created_at")
FROM "tokenless_auth_sessions"
GROUP BY lower("account_address")
ON CONFLICT ("principal_address") DO NOTHING;

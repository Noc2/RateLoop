CREATE TABLE "tokenless_account_profiles" (
  "principal_address" text PRIMARY KEY NOT NULL REFERENCES "tokenless_browser_identities"("principal_address") ON DELETE CASCADE,
  "display_name" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tokenless_account_profiles_updated_at_idx"
  ON "tokenless_account_profiles" USING btree ("updated_at");

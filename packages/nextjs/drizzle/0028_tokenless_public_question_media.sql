CREATE TABLE "tokenless_public_question_media" (
  "asset_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "owner_account_address" text NOT NULL,
  "client_request_id" text NOT NULL,
  "question_id" text REFERENCES "tokenless_question_records"("question_id"),
  "digest" text NOT NULL,
  "storage_ref" text NOT NULL,
  "content_type" text NOT NULL,
  "original_filename" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "technical_status" text NOT NULL DEFAULT 'ready',
  "moderation_status" text NOT NULL DEFAULT 'pending',
  "moderation_reason" text,
  "expires_at" timestamp with time zone NOT NULL,
  "bound_at" timestamp with time zone,
  "moderated_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_public_question_media_technical_status_check"
    CHECK ("technical_status" IN ('ready', 'deleted', 'failed')),
  CONSTRAINT "tokenless_public_question_media_moderation_status_check"
    CHECK ("moderation_status" IN ('pending', 'approved', 'rejected', 'delisted')),
  CONSTRAINT "tokenless_public_question_media_dimensions_check"
    CHECK ("width" > 0 AND "height" > 0 AND "size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_public_question_media_owner_request_unique"
  ON "tokenless_public_question_media" USING btree ("workspace_id", "owner_account_address", "client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_public_question_media_question_asset_unique"
  ON "tokenless_public_question_media" USING btree ("question_id", "asset_id");
--> statement-breakpoint
CREATE INDEX "tokenless_public_question_media_owner_status_idx"
  ON "tokenless_public_question_media" USING btree ("workspace_id", "owner_account_address", "technical_status", "created_at");
--> statement-breakpoint
CREATE INDEX "tokenless_public_question_media_expiry_idx"
  ON "tokenless_public_question_media" USING btree ("technical_status", "expires_at");
--> statement-breakpoint
CREATE TABLE "tokenless_public_media_daily_quotas" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "owner_account_address" text NOT NULL,
  "day_key" text NOT NULL,
  "upload_count" integer NOT NULL DEFAULT 0,
  "upload_bytes" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_public_media_daily_quotas_pk"
    PRIMARY KEY ("workspace_id", "owner_account_address", "day_key"),
  CONSTRAINT "tokenless_public_media_daily_quotas_nonnegative_check"
    CHECK ("upload_count" >= 0 AND "upload_bytes" >= 0)
);

CREATE TABLE "question_details" (
  "id" text PRIMARY KEY NOT NULL,
  "uploader_kind" text NOT NULL,
  "owner_wallet_address" text,
  "agent_id" text,
  "client_request_id" text,
  "content_id" text,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "sha256" text NOT NULL,
  "normalized_text" text,
  "status" text NOT NULL,
  "moderation_status" text DEFAULT 'pending' NOT NULL,
  "moderation_provider" text,
  "moderation_result" text,
  "error" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX "question_details_owner_status_created_idx" ON "question_details" USING btree ("owner_wallet_address","status","created_at");

CREATE INDEX "question_details_agent_status_created_idx" ON "question_details" USING btree ("agent_id","status","created_at");

CREATE INDEX "question_details_client_request_idx" ON "question_details" USING btree ("client_request_id");

CREATE INDEX "question_details_content_idx" ON "question_details" USING btree ("content_id");

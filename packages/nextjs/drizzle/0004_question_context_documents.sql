CREATE TABLE "question_context_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"uploader_kind" text NOT NULL,
	"owner_wallet_address" text,
	"agent_id" text,
	"client_request_id" text,
	"content_id" text,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
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
--> statement-breakpoint
CREATE INDEX "question_context_documents_owner_status_created_idx" ON "question_context_documents" USING btree ("owner_wallet_address","status","created_at");
--> statement-breakpoint
CREATE INDEX "question_context_documents_agent_status_created_idx" ON "question_context_documents" USING btree ("agent_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "question_context_documents_client_request_idx" ON "question_context_documents" USING btree ("client_request_id");
--> statement-breakpoint
CREATE INDEX "question_context_documents_content_idx" ON "question_context_documents" USING btree ("content_id");

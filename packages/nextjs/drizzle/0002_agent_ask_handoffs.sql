CREATE TABLE "agent_ask_handoff_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"chain_id" integer,
	"client_request_id" text,
	"payment_mode" text NOT NULL,
	"wallet_address" text,
	"operation_key" text,
	"payload_hash" text,
	"request_body" text NOT NULL,
	"transaction_plan" text,
	"transaction_hashes" text,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_ask_handoff_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"handoff_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"status" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"image_base64" text NOT NULL,
	"image_url" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ask_handoff_intents_token_hash_unique" ON "agent_ask_handoff_intents" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "agent_ask_handoff_intents_status_expires_idx" ON "agent_ask_handoff_intents" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX "agent_ask_handoff_intents_operation_key_idx" ON "agent_ask_handoff_intents" USING btree ("operation_key");
--> statement-breakpoint
CREATE INDEX "agent_ask_handoff_assets_handoff_idx" ON "agent_ask_handoff_assets" USING btree ("handoff_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ask_handoff_assets_attachment_unique" ON "agent_ask_handoff_assets" USING btree ("attachment_id");
--> statement-breakpoint
CREATE INDEX "agent_ask_handoff_assets_status_created_idx" ON "agent_ask_handoff_assets" USING btree ("status","created_at");

CREATE TABLE "agent_callback_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"event_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"event_type" text NOT NULL,
	"callback_url" text NOT NULL,
	"secret" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_callback_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"callback_url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_signing_intents" (
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
	"transaction_hashes" text,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_wallet_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_wallet_address" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_wallet_address" text NOT NULL,
	"status" text NOT NULL,
	"scopes" text NOT NULL,
	"categories" text,
	"daily_budget_atomic" text NOT NULL,
	"per_ask_limit_atomic" text NOT NULL,
	"token_hash" text,
	"token_issued_at" timestamp with time zone,
	"token_revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_wallet_policy_audit_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"owner_wallet_address" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_wallet_address" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_rate_limit_maintenance" (
	"name" text PRIMARY KEY NOT NULL,
	"last_cleanup_started_at" bigint NOT NULL,
	"lease_expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"request_count" integer NOT NULL,
	"window_started_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"round_id" text,
	"chain_id" integer,
	"author_address" text NOT NULL,
	"feedback_type" text NOT NULL,
	"body" text NOT NULL,
	"source_url" text,
	"feedback_hash" text,
	"commit_key" text,
	"client_nonce" text,
	"payload_signature" text,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"publication_tx_hash" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "free_transaction_quotas" (
	"identity_key" text PRIMARY KEY NOT NULL,
	"voter_id_token_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"environment" text NOT NULL,
	"last_wallet_address" text NOT NULL,
	"free_tx_limit" integer NOT NULL,
	"free_tx_used" integer NOT NULL,
	"exhausted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "free_transaction_reservations" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"identity_key" text NOT NULL,
	"voter_id_token_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"environment" text NOT NULL,
	"wallet_address" text NOT NULL,
	"status" text NOT NULL,
	"tx_hashes" text,
	"reserved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_agent_ask_audit_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_key" text NOT NULL,
	"agent_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"chain_id" integer NOT NULL,
	"category_id" text NOT NULL,
	"payment_amount" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"content_id" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_agent_budget_reservations" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"chain_id" integer NOT NULL,
	"category_id" text NOT NULL,
	"payment_amount" text NOT NULL,
	"status" text NOT NULL,
	"content_id" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_agent_daily_budget_usage" (
	"budget_key" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"budget_date" text NOT NULL,
	"reserved_amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_email_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"email" text NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"content_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_email_delivery_leases" (
	"event_key" text PRIMARY KEY NOT NULL,
	"lease_expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_email_subscriptions" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_token" text,
	"verification_expires_at" timestamp with time zone,
	"round_resolved" boolean NOT NULL,
	"settling_soon_hour" boolean NOT NULL,
	"settling_soon_day" boolean NOT NULL,
	"followed_submission" boolean NOT NULL,
	"followed_resolution" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"round_resolved" boolean NOT NULL,
	"settling_soon_hour" boolean NOT NULL,
	"settling_soon_day" boolean NOT NULL,
	"followed_submission" boolean NOT NULL,
	"followed_resolution" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_image_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"uploader_kind" text NOT NULL,
	"owner_wallet_address" text,
	"agent_id" text,
	"client_request_id" text,
	"operation_key" text,
	"content_id" text,
	"original_blob_pathname" text,
	"original_blob_url" text,
	"normalized_blob_pathname" text,
	"normalized_blob_url" text,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text,
	"status" text NOT NULL,
	"moderation_status" text DEFAULT 'pending' NOT NULL,
	"moderation_provider" text,
	"moderation_result" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signed_action_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_read_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_write_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"content_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_question_submissions" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"client_request_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"chain_id" integer NOT NULL,
	"payer_address" text,
	"payment_asset" text NOT NULL,
	"payment_amount" text NOT NULL,
	"bounty_amount" text NOT NULL,
	"status" text NOT NULL,
	"bundle_id" text,
	"content_id" text,
	"content_ids" text,
	"question_count" integer DEFAULT 1 NOT NULL,
	"reward_pool_id" text,
	"transaction_hashes" text,
	"payment_receipt" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_callback_events_event_key_unique" ON "agent_callback_events" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_callback_events_subscription_event_unique" ON "agent_callback_events" USING btree ("subscription_id","event_id");--> statement-breakpoint
CREATE INDEX "agent_callback_events_status_next_attempt_idx" ON "agent_callback_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "agent_callback_events_lease_expires_idx" ON "agent_callback_events" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "agent_callback_events_agent_event_idx" ON "agent_callback_events" USING btree ("agent_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_callback_subscriptions_agent_url_unique" ON "agent_callback_subscriptions" USING btree ("agent_id","callback_url");--> statement-breakpoint
CREATE INDEX "agent_callback_subscriptions_agent_status_idx" ON "agent_callback_subscriptions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_signing_intents_token_hash_unique" ON "agent_signing_intents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_signing_intents_status_expires_idx" ON "agent_signing_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_signing_intents_operation_key_idx" ON "agent_signing_intents" USING btree ("operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wallet_policies_owner_agent_unique" ON "agent_wallet_policies" USING btree ("owner_wallet_address","agent_id");--> statement-breakpoint
CREATE INDEX "agent_wallet_policies_owner_status_idx" ON "agent_wallet_policies" USING btree ("owner_wallet_address","status","updated_at");--> statement-breakpoint
CREATE INDEX "agent_wallet_policies_agent_wallet_idx" ON "agent_wallet_policies" USING btree ("agent_wallet_address","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wallet_policies_token_hash_unique" ON "agent_wallet_policies" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_wallet_policy_audit_policy_created_idx" ON "agent_wallet_policy_audit_records" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_wallet_policy_audit_owner_created_idx" ON "agent_wallet_policy_audit_records" USING btree ("owner_wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "api_rate_limits_expires_at_idx" ON "api_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "content_feedback_content_created_at_idx" ON "content_feedback" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_feedback_content_round_idx" ON "content_feedback" USING btree ("content_id","round_id");--> statement-breakpoint
CREATE INDEX "content_feedback_author_created_at_idx" ON "content_feedback" USING btree ("author_address","created_at");--> statement-breakpoint
CREATE INDEX "content_feedback_commit_key_idx" ON "content_feedback" USING btree ("commit_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_feedback_feedback_hash_unique" ON "content_feedback" USING btree ("feedback_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "content_feedback_active_author_round_unique" ON "content_feedback" USING btree ("content_id","round_id","author_address") WHERE "content_feedback"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "free_transaction_quotas_token_chain_env_unique" ON "free_transaction_quotas" USING btree ("voter_id_token_id","chain_id","environment");--> statement-breakpoint
CREATE INDEX "free_transaction_quotas_chain_updated_at_idx" ON "free_transaction_quotas" USING btree ("chain_id","updated_at");--> statement-breakpoint
CREATE INDEX "free_transaction_reservations_identity_status_expires_idx" ON "free_transaction_reservations" USING btree ("identity_key","status","expires_at");--> statement-breakpoint
CREATE INDEX "free_transaction_reservations_wallet_status_updated_idx" ON "free_transaction_reservations" USING btree ("wallet_address","status","updated_at");--> statement-breakpoint
CREATE INDEX "mcp_agent_ask_audit_records_agent_created_idx" ON "mcp_agent_ask_audit_records" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_agent_ask_audit_records_operation_created_idx" ON "mcp_agent_ask_audit_records" USING btree ("operation_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_agent_budget_reservations_client_request_unique" ON "mcp_agent_budget_reservations" USING btree ("agent_id","chain_id","client_request_id");--> statement-breakpoint
CREATE INDEX "mcp_agent_budget_reservations_agent_status_created_idx" ON "mcp_agent_budget_reservations" USING btree ("agent_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mcp_agent_daily_budget_usage_agent_day_idx" ON "mcp_agent_daily_budget_usage" USING btree ("agent_id","budget_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_email_deliveries_event_key_unique" ON "notification_email_deliveries" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_email_subscriptions_email_unique" ON "notification_email_subscriptions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_email_subscriptions_token_unique" ON "notification_email_subscriptions" USING btree ("verification_token");--> statement-breakpoint
CREATE INDEX "question_image_attachments_owner_status_created_idx" ON "question_image_attachments" USING btree ("owner_wallet_address","status","created_at");--> statement-breakpoint
CREATE INDEX "question_image_attachments_agent_status_created_idx" ON "question_image_attachments" USING btree ("agent_id","status","created_at");--> statement-breakpoint
CREATE INDEX "question_image_attachments_operation_idx" ON "question_image_attachments" USING btree ("operation_key");--> statement-breakpoint
CREATE INDEX "question_image_attachments_content_idx" ON "question_image_attachments" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "signed_action_challenges_expires_at_idx" ON "signed_action_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "signed_action_challenges_wallet_action_idx" ON "signed_action_challenges" USING btree ("wallet_address","action");--> statement-breakpoint
CREATE INDEX "signed_read_sessions_wallet_scope_expires_idx" ON "signed_read_sessions" USING btree ("wallet_address","scope","expires_at");--> statement-breakpoint
CREATE INDEX "signed_write_sessions_wallet_scope_expires_idx" ON "signed_write_sessions" USING btree ("wallet_address","scope","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_content_wallet_content_unique" ON "watched_content" USING btree ("wallet_address","content_id");--> statement-breakpoint
CREATE INDEX "watched_content_wallet_created_at_idx" ON "watched_content" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_question_submissions_client_request_unique" ON "x402_question_submissions" USING btree ("chain_id","client_request_id");--> statement-breakpoint
CREATE INDEX "x402_question_submissions_status_updated_idx" ON "x402_question_submissions" USING btree ("status","updated_at");

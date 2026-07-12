CREATE TABLE "tokenless_workspaces" (
  "workspace_id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "tokenless_workspace_members" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "account_address" text NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "account_address")
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_members_account_idx" ON "tokenless_workspace_members" USING btree ("account_address");--> statement-breakpoint
CREATE TABLE "tokenless_workspace_api_keys" (
  "key_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_api_keys_hash_unique" UNIQUE("key_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_api_keys_workspace_idx" ON "tokenless_workspace_api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE TABLE "tokenless_prepaid_ledger_entries" (
  "entry_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "delta_atomic" numeric(78, 0) NOT NULL,
  "settlement_status" text NOT NULL,
  "source" text NOT NULL,
  "external_reference" text,
  "created_at" timestamp with time zone NOT NULL,
  "settled_at" timestamp with time zone,
  CONSTRAINT "tokenless_prepaid_ledger_external_reference_unique" UNIQUE("external_reference")
);--> statement-breakpoint
CREATE INDEX "tokenless_prepaid_ledger_workspace_status_idx" ON "tokenless_prepaid_ledger_entries" USING btree ("workspace_id", "settlement_status");--> statement-breakpoint
CREATE TABLE "tokenless_prepaid_reservations" (
  "reservation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "idempotency_key" text NOT NULL,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "status" text NOT NULL,
  "operation_key" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_prepaid_reservations_workspace_idempotency_unique" UNIQUE("workspace_id", "idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_prepaid_reservations_workspace_status_idx" ON "tokenless_prepaid_reservations" USING btree ("workspace_id", "status");--> statement-breakpoint
CREATE TABLE "tokenless_content_records" (
  "content_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "content_hash" text NOT NULL,
  "content_json" text NOT NULL,
  "moderation_status" text DEFAULT 'pending' NOT NULL,
  "moderation_reason" text,
  "moderated_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_content_records_workspace_moderation_idx" ON "tokenless_content_records" USING btree ("workspace_id", "moderation_status");--> statement-breakpoint
CREATE TABLE "tokenless_question_records" (
  "question_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "content_id" text NOT NULL REFERENCES "tokenless_content_records"("content_id"),
  "quote_id" text NOT NULL REFERENCES "tokenless_agent_quotes"("quote_id"),
  "terms_hash" text NOT NULL,
  "terms_json" text NOT NULL,
  "moderation_status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_question_records_workspace_moderation_idx" ON "tokenless_question_records" USING btree ("workspace_id", "moderation_status");--> statement-breakpoint
CREATE TABLE "tokenless_payment_intents" (
  "payment_intent_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "idempotency_key" text NOT NULL,
  "mode" text NOT NULL,
  "payer_address" text NOT NULL,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "payload_hash" text NOT NULL,
  "payload_json" text NOT NULL,
  "state" text NOT NULL,
  "operation_key" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_payment_intents_workspace_idempotency_unique" UNIQUE("workspace_id", "idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_payment_intents_state_idx" ON "tokenless_payment_intents" USING btree ("state", "updated_at");--> statement-breakpoint
CREATE TABLE "tokenless_ask_ownership" (
  "operation_key" text PRIMARY KEY NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "owner_account_address" text,
  "api_key_id" text REFERENCES "tokenless_workspace_api_keys"("key_id"),
  "question_id" text NOT NULL REFERENCES "tokenless_question_records"("question_id"),
  "payment_mode" text NOT NULL,
  "payment_state" text NOT NULL,
  "payment_reference" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_ask_ownership_workspace_idempotency_unique" UNIQUE("workspace_id", "idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_ask_ownership_workspace_idx" ON "tokenless_ask_ownership" USING btree ("workspace_id", "created_at");

CREATE TABLE "tokenless_agent_quotes" (
  "quote_id" text PRIMARY KEY NOT NULL,
  "request_hash" text NOT NULL,
  "request_json" text NOT NULL,
  "response_json" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_quotes_expires_at_idx" ON "tokenless_agent_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_agent_quotes_request_hash_idx" ON "tokenless_agent_quotes" USING btree ("request_hash");--> statement-breakpoint
CREATE TABLE "tokenless_agent_asks" (
  "operation_key" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "quote_id" text NOT NULL,
  "request_json" text NOT NULL,
  "economics_json" text NOT NULL,
  "status" text NOT NULL,
  "verdict_status" text,
  "round_id" text,
  "result_json" text,
  "sandbox" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_asks_idempotency_key_unique" UNIQUE("idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_asks_status_updated_idx" ON "tokenless_agent_asks" USING btree ("status","updated_at");

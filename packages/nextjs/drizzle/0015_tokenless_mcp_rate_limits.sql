CREATE TABLE "tokenless_mcp_rate_limits" (
  "client_hash" text PRIMARY KEY,
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_mcp_rate_limits_request_count_check" CHECK ("request_count" >= 1)
);--> statement-breakpoint
CREATE INDEX "tokenless_mcp_rate_limits_updated_at_idx" ON "tokenless_mcp_rate_limits" USING btree ("updated_at");

CREATE TABLE "tokenless_transparency_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "deployment_key" text NOT NULL,
  "round_id" numeric(78, 0) NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "evidence_json" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_transparency_events_sequence_unique" UNIQUE("operation_key", "sequence"),
  CONSTRAINT "tokenless_transparency_events_evidence_unique" UNIQUE("operation_key", "evidence_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_transparency_events_round_idx" ON "tokenless_transparency_events" USING btree ("deployment_key", "round_id", "sequence");--> statement-breakpoint
CREATE INDEX "tokenless_transparency_events_workspace_idx" ON "tokenless_transparency_events" USING btree ("workspace_id", "recorded_at");--> statement-breakpoint
CREATE TABLE "tokenless_analytics_reviews" (
  "review_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "review_version" integer NOT NULL,
  "decision" text NOT NULL,
  "evidence_root" text NOT NULL,
  "tier_mix_json" text NOT NULL,
  "diversity_json" text NOT NULL,
  "metrics_json" text NOT NULL,
  "reason_codes_json" text NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_analytics_reviews_version_unique" UNIQUE("operation_key", "review_version")
);--> statement-breakpoint
CREATE INDEX "tokenless_analytics_reviews_decision_idx" ON "tokenless_analytics_reviews" USING btree ("decision", "reviewed_at");--> statement-breakpoint
CREATE TABLE "tokenless_result_publications" (
  "publication_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "publication_version" integer NOT NULL,
  "verdict_status" text NOT NULL,
  "evidence_root" text NOT NULL,
  "result_json" text NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_result_publications_version_unique" UNIQUE("operation_key", "publication_version")
);--> statement-breakpoint
CREATE INDEX "tokenless_result_publications_status_idx" ON "tokenless_result_publications" USING btree ("verdict_status", "published_at");--> statement-breakpoint
CREATE TABLE "tokenless_webhook_endpoints" (
  "endpoint_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "url" text NOT NULL,
  "event_types_json" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "secret_key_version" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_webhook_endpoints_workspace_url_unique" UNIQUE("workspace_id", "url")
);--> statement-breakpoint
CREATE INDEX "tokenless_webhook_endpoints_workspace_idx" ON "tokenless_webhook_endpoints" USING btree ("workspace_id", "active");--> statement-breakpoint
CREATE TABLE "tokenless_ask_webhook_subscriptions" (
  "subscription_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "endpoint_id" text NOT NULL REFERENCES "tokenless_webhook_endpoints"("endpoint_id"),
  "event_types_json" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_ask_webhook_subscription_unique" UNIQUE("operation_key", "endpoint_id")
);--> statement-breakpoint
CREATE TABLE "tokenless_webhook_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "publication_id" text NOT NULL REFERENCES "tokenless_result_publications"("publication_id"),
  "endpoint_id" text NOT NULL REFERENCES "tokenless_webhook_endpoints"("endpoint_id"),
  "event_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload_json" text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "response_status" integer,
  "last_error" text,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_webhook_deliveries_idempotency_unique" UNIQUE("idempotency_key")
);--> statement-breakpoint
CREATE INDEX "tokenless_webhook_deliveries_retry_idx" ON "tokenless_webhook_deliveries" USING btree ("state", "next_attempt_at");

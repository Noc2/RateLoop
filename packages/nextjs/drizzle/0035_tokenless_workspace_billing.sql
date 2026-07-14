CREATE TABLE "tokenless_workspace_billing_customers" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_customer_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_billing_customers_provider_check" CHECK ("provider" = 'stripe'),
  CONSTRAINT "tokenless_workspace_billing_customers_provider_customer_unique" UNIQUE("provider", "provider_customer_id")
);--> statement-breakpoint
CREATE TABLE "tokenless_workspace_subscriptions" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "plan_key" text DEFAULT 'free' NOT NULL,
  "price_version" text DEFAULT 'free_2026_07' NOT NULL,
  "provider_subscription_id" text UNIQUE,
  "provider_price_id" text,
  "provider_status" text DEFAULT 'free' NOT NULL,
  "provider_event_created_at" timestamp with time zone,
  "provider_event_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_subscriptions_plan_check" CHECK ("plan_key" IN ('free', 'early_access')),
  CONSTRAINT "tokenless_workspace_subscriptions_status_check" CHECK (
    "provider_status" IN ('free', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_subscriptions_status_period_idx"
  ON "tokenless_workspace_subscriptions" USING btree ("provider_status", "current_period_end");--> statement-breakpoint
CREATE TABLE "tokenless_billing_webhook_events" (
  "provider_event_id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "event_created_at" timestamp with time zone NOT NULL,
  "processing_status" text DEFAULT 'processing' NOT NULL,
  "error_code" text,
  "received_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "tokenless_billing_webhook_events_status_check" CHECK ("processing_status" IN ('processing', 'processed', 'failed'))
);--> statement-breakpoint
CREATE INDEX "tokenless_billing_webhook_events_processing_idx"
  ON "tokenless_billing_webhook_events" USING btree ("processing_status", "received_at");--> statement-breakpoint
CREATE TABLE "tokenless_workspace_usage_allocations" (
  "allocation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "run_id" text NOT NULL,
  "case_id" text NOT NULL,
  "plan_key" text NOT NULL,
  "price_version" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "state" text DEFAULT 'reserved' NOT NULL,
  "reserved_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  CONSTRAINT "tokenless_workspace_usage_allocations_run_case_unique" UNIQUE("workspace_id", "run_id", "case_id"),
  CONSTRAINT "tokenless_workspace_usage_allocations_run_case_fk" FOREIGN KEY ("run_id", "case_id")
    REFERENCES "tokenless_assurance_run_cases"("run_id", "case_id"),
  CONSTRAINT "tokenless_workspace_usage_allocations_plan_check" CHECK ("plan_key" IN ('free', 'early_access')),
  CONSTRAINT "tokenless_workspace_usage_allocations_state_check" CHECK ("state" IN ('reserved', 'consumed', 'released')),
  CONSTRAINT "tokenless_workspace_usage_allocations_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "tokenless_workspace_usage_allocations_lifecycle_check" CHECK (
    ("state" = 'reserved' AND "consumed_at" IS NULL AND "released_at" IS NULL)
    OR ("state" = 'consumed' AND "consumed_at" IS NOT NULL AND "released_at" IS NULL)
    OR ("state" = 'released' AND "consumed_at" IS NULL AND "released_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_usage_allocations_period_state_idx"
  ON "tokenless_workspace_usage_allocations" USING btree ("workspace_id", "period_start", "period_end", "state");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_usage_allocations_run_idx"
  ON "tokenless_workspace_usage_allocations" USING btree ("run_id", "state");--> statement-breakpoint
INSERT INTO "tokenless_workspace_subscriptions"
  ("workspace_id", "plan_key", "price_version", "provider_status", "cancel_at_period_end", "created_at", "updated_at")
SELECT "workspace_id", 'free', 'free_2026_07', 'free', false, NOW(), NOW()
FROM "tokenless_workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;

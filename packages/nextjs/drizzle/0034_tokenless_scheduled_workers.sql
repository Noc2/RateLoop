CREATE TABLE "tokenless_scheduled_worker_runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "trigger" text NOT NULL,
  "status" text NOT NULL,
  "summary_json" text,
  "last_error" text,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tokenless_scheduled_worker_runs_idempotency_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "tokenless_scheduled_worker_runs_health_idx"
  ON "tokenless_scheduled_worker_runs" USING btree ("status", "started_at");
--> statement-breakpoint
CREATE TABLE "tokenless_scheduled_work_items" (
  "item_id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "subject_key" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "dead_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_scheduled_work_items_subject_unique" UNIQUE("kind", "subject_key")
);
--> statement-breakpoint
CREATE INDEX "tokenless_scheduled_work_items_due_idx"
  ON "tokenless_scheduled_work_items" USING btree ("state", "next_attempt_at", "created_at");

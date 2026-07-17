CREATE TABLE "tokenless_prepaid_topup_audit_outbox" (
  "outbox_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "topup_id" text NOT NULL REFERENCES "tokenless_prepaid_topup_intents"("topup_id") ON DELETE RESTRICT,
  "event_type" text NOT NULL,
  "event_sequence" integer NOT NULL,
  "actor_reference" text NOT NULL,
  "event_occurred_at" timestamp with time zone NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_error_code" text,
  "audit_event_id" text,
  "audit_event_digest" text,
  "created_at" timestamp with time zone NOT NULL,
  "delivered_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_prepaid_topup_audit_event_unique" UNIQUE ("topup_id", "event_type"),
  CONSTRAINT "tokenless_prepaid_topup_audit_sequence_unique" UNIQUE ("topup_id", "event_sequence"),
  CONSTRAINT "tokenless_prepaid_topup_audit_event_check" CHECK (
    "event_type" IN ('requested','issued','paid','credited','failed')
  ),
  CONSTRAINT "tokenless_prepaid_topup_audit_state_check" CHECK ("state" IN ('pending','delivered')),
  CONSTRAINT "tokenless_prepaid_topup_audit_sequence_check" CHECK ("event_sequence" BETWEEN 1 AND 5),
  CONSTRAINT "tokenless_prepaid_topup_audit_delivery_check" CHECK (
    ("state" = 'pending' AND "delivered_at" IS NULL AND "audit_event_id" IS NULL AND "audit_event_digest" IS NULL)
    OR ("state" = 'delivered' AND "delivered_at" IS NOT NULL AND "audit_event_id" IS NOT NULL AND "audit_event_digest" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_prepaid_topup_audit_pending_idx"
  ON "tokenless_prepaid_topup_audit_outbox" ("state", "next_attempt_at", "topup_id", "event_sequence");

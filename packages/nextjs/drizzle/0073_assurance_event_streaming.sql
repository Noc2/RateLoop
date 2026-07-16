CREATE TABLE "tokenless_assurance_event_outbox" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "source_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "subject" text NOT NULL,
  "packet_hash" text NOT NULL,
  "evidence_chain_json" text NOT NULL,
  "cloud_event_json" text NOT NULL,
  "ocsf_event_json" text NOT NULL,
  "payload_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_event_outbox_source_unique"
    UNIQUE("workspace_id", "event_type", "source_event_id"),
  CONSTRAINT "tokenless_assurance_event_outbox_id_check"
    CHECK ("event_id" ~ '^aev_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_event_outbox_source_check"
    CHECK (char_length("source_event_id") BETWEEN 1 AND 200),
  CONSTRAINT "tokenless_assurance_event_outbox_subject_check"
    CHECK ("subject" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  CONSTRAINT "tokenless_assurance_event_outbox_type_check"
    CHECK ("event_type" IN (
      'ai.rateloop.review.completed',
      'ai.rateloop.packet.anchored',
      'ai.rateloop.gate.blocked'
    )),
  CONSTRAINT "tokenless_assurance_event_outbox_packet_hash_check"
    CHECK ("packet_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_assurance_event_outbox_payload_hash_check"
    CHECK ("payload_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_event_outbox_workspace_time_idx"
  ON "tokenless_assurance_event_outbox" USING btree
  ("workspace_id", "occurred_at", "event_id");--> statement-breakpoint
CREATE TABLE "tokenless_assurance_event_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "event_id" text NOT NULL REFERENCES "tokenless_assurance_event_outbox"("event_id") ON DELETE CASCADE,
  "endpoint_id" text NOT NULL REFERENCES "tokenless_webhook_endpoints"("endpoint_id") ON DELETE RESTRICT,
  "idempotency_key" text NOT NULL UNIQUE,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL DEFAULT 'pending',
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "response_status" integer,
  "last_error" text,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_assurance_event_deliveries_event_endpoint_unique"
    UNIQUE("event_id", "endpoint_id"),
  CONSTRAINT "tokenless_assurance_event_deliveries_id_check"
    CHECK ("delivery_id" ~ '^aed_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_event_deliveries_idempotency_check"
    CHECK ("idempotency_key" ~ '^aed_[0-9a-f]{40}$'),
  CONSTRAINT "tokenless_assurance_event_deliveries_attempt_check"
    CHECK ("attempt_count" BETWEEN 0 AND 8),
  CONSTRAINT "tokenless_assurance_event_deliveries_state_check"
    CHECK ("state" IN ('pending', 'delivering', 'retry', 'delivered', 'dead')),
  CONSTRAINT "tokenless_assurance_event_deliveries_lease_check" CHECK (
    ("state" = 'delivering' AND "lease_expires_at" IS NOT NULL)
    OR ("state" <> 'delivering' AND "lease_expires_at" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_assurance_event_deliveries_due_idx"
  ON "tokenless_assurance_event_deliveries" USING btree
  ("state", "next_attempt_at", "lease_expires_at");

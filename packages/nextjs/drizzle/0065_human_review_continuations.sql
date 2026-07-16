CREATE TABLE "tokenless_agent_review_continuations" (
  "continuation_id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"("integration_id") ON DELETE RESTRICT,
  "opportunity_id" text NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "allowed_operation" text NOT NULL,
  "caller_credential_kind" text NOT NULL,
  "caller_credential_id" text NOT NULL,
  "issuance_key_hash" text NOT NULL,
  "consumption_key_hash" text,
  "status" text NOT NULL DEFAULT 'active',
  "predecessor_continuation_id" text REFERENCES "tokenless_agent_review_continuations"("continuation_id") ON DELETE RESTRICT,
  "successor_continuation_id" text REFERENCES "tokenless_agent_review_continuations"("continuation_id") ON DELETE RESTRICT,
  "retry_after_ms" integer NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "expired_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_review_continuations_lifecycle_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"("workspace_id", "opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_continuations_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "tokenless_agent_review_continuations_revision_check" CHECK ("lifecycle_revision" >= 1),
  CONSTRAINT "tokenless_agent_review_continuations_operation_check" CHECK (
    "allowed_operation" IN ('request_review', 'wait_for_review')
  ),
  CONSTRAINT "tokenless_agent_review_continuations_credential_check" CHECK (
    "caller_credential_kind" IN ('api_key', 'oauth_token_family')
    AND "caller_credential_id" <> ''
  ),
  CONSTRAINT "tokenless_agent_review_continuations_hashes_check" CHECK (
    "token_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "issuance_key_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND ("consumption_key_hash" IS NULL OR "consumption_key_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_agent_review_continuations_retry_check" CHECK (
    "retry_after_ms" BETWEEN 250 AND 60000
  ),
  CONSTRAINT "tokenless_agent_review_continuations_time_check" CHECK (
    "expires_at" > "issued_at"
    AND ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
    AND ("rotated_at" IS NULL OR "rotated_at" >= "issued_at")
    AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
    AND ("expired_at" IS NULL OR "expired_at" >= "issued_at")
  ),
  CONSTRAINT "tokenless_agent_review_continuations_status_check" CHECK (
    "status" IN ('active', 'consumed', 'rotated', 'revoked', 'expired')
  ),
  CONSTRAINT "tokenless_agent_review_continuations_state_tuple_check" CHECK (
    (
      "status" = 'active'
      AND "consumption_key_hash" IS NULL
      AND "consumed_at" IS NULL AND "rotated_at" IS NULL
      AND "revoked_at" IS NULL AND "expired_at" IS NULL
      AND "successor_continuation_id" IS NULL
    )
    OR (
      "status" = 'consumed'
      AND "consumption_key_hash" IS NOT NULL AND "consumed_at" IS NOT NULL
      AND "rotated_at" IS NULL AND "revoked_at" IS NULL AND "expired_at" IS NULL
      AND "successor_continuation_id" IS NULL
    )
    OR (
      "status" = 'rotated'
      AND "consumption_key_hash" IS NOT NULL AND "consumed_at" IS NOT NULL
      AND "rotated_at" IS NOT NULL AND "revoked_at" IS NULL AND "expired_at" IS NULL
      AND "successor_continuation_id" IS NOT NULL
    )
    OR (
      "status" = 'revoked'
      AND "consumption_key_hash" IS NULL AND "consumed_at" IS NULL AND "rotated_at" IS NULL
      AND "revoked_at" IS NOT NULL AND "expired_at" IS NULL
      AND "successor_continuation_id" IS NULL
    )
    OR (
      "status" = 'expired'
      AND "consumption_key_hash" IS NULL AND "consumed_at" IS NULL AND "rotated_at" IS NULL
      AND "revoked_at" IS NULL AND "expired_at" IS NOT NULL
      AND "successor_continuation_id" IS NULL
    )
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_review_continuations_active_revision_operation_unique"
  ON "tokenless_agent_review_continuations" USING btree
  ("workspace_id", "integration_id", "opportunity_id", "lifecycle_revision", "allowed_operation")
  WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_continuations_expiry_idx"
  ON "tokenless_agent_review_continuations" USING btree ("status", "expires_at")
  WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_continuations_binding_idx"
  ON "tokenless_agent_review_continuations" USING btree
  ("workspace_id", "integration_id", "opportunity_id", "issued_at");--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_continuation_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "continuation_id" text NOT NULL REFERENCES "tokenless_agent_review_continuations"("continuation_id") ON DELETE RESTRICT,
  "workspace_id" text NOT NULL,
  "integration_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "event_type" text NOT NULL,
  "allowed_operation" text NOT NULL,
  "actor_credential_kind" text NOT NULL,
  "actor_credential_commitment" text NOT NULL,
  "related_continuation_id" text REFERENCES "tokenless_agent_review_continuations"("continuation_id") ON DELETE RESTRICT,
  "reason_code" text NOT NULL,
  "event_commitment" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_continuation_events_lifecycle_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"("workspace_id", "opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_continuation_events_revision_check" CHECK ("lifecycle_revision" >= 1),
  CONSTRAINT "tokenless_agent_review_continuation_events_type_check" CHECK (
    "event_type" IN (
      'issued', 'issue_replaced', 'consumed', 'consume_replayed', 'rotated',
      'rotation_replaced', 'terminal_completed', 'revoked', 'expired'
    )
  ),
  CONSTRAINT "tokenless_agent_review_continuation_events_operation_check" CHECK (
    "allowed_operation" IN ('request_review', 'wait_for_review')
  ),
  CONSTRAINT "tokenless_agent_review_continuation_events_actor_check" CHECK (
    "actor_credential_kind" IN ('api_key', 'oauth_token_family')
    AND "actor_credential_commitment" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_review_continuation_events_reason_check" CHECK (
    "reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,95}$'
  ),
  CONSTRAINT "tokenless_agent_review_continuation_events_commitment_check" CHECK (
    "event_commitment" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_continuation_events_timeline_idx"
  ON "tokenless_agent_review_continuation_events" USING btree
  ("workspace_id", "opportunity_id", "occurred_at", "event_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_continuation_event_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'human-review continuation events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_review_continuation_events_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_agent_review_continuation_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_continuation_event_mutation"();

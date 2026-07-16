CREATE TABLE "tokenless_agent_review_opportunity_transition_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "transition_key" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "reason_codes_json" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "transition_commitment" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_lifecycle_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles" ("workspace_id", "opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_key_unique"
    UNIQUE ("workspace_id", "opportunity_id", "transition_key"),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_revision_unique"
    UNIQUE ("workspace_id", "opportunity_id", "to_revision"),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_revision_check" CHECK (
    "from_revision" >= 1 AND "to_revision" = "from_revision" + 1
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_key_check" CHECK (
    char_length("transition_key") BETWEEN 8 AND 200
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_actor_check" CHECK (
    "actor_kind" IN ('agent', 'host', 'lane_adapter', 'owner', 'service', 'system')
    AND char_length("actor_reference") BETWEEN 1 AND 256
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_commitment_check" CHECK (
    "transition_commitment" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_transition_events_edge_check" CHECK (
    ("from_state" = 'evaluating' AND "to_state" IN ('skipped', 'approval_required', 'request_ready', 'blocked'))
    OR ("from_state" = 'approval_required' AND "to_state" IN ('request_ready', 'blocked', 'cancelled_before_commit'))
    OR ("from_state" = 'request_ready' AND "to_state" IN ('pending', 'blocked', 'cancelled_before_commit'))
    OR ("from_state" = 'pending' AND "to_state" IN ('completed', 'inconclusive', 'failed_terminal'))
    OR ("from_state" = 'blocked' AND "to_state" IN ('approval_required', 'request_ready'))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunity_transition_events_timeline_idx"
  ON "tokenless_agent_review_opportunity_transition_events" USING btree
  ("workspace_id", "opportunity_id", "to_revision");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_review_transition_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'human-review opportunity transition events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_review_opportunity_transition_events_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_agent_review_opportunity_transition_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_review_transition_event_mutation"();

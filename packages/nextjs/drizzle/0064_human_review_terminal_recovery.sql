ALTER TABLE "tokenless_agent_review_opportunity_transition_events"
  DROP CONSTRAINT "tokenless_agent_review_opportunity_transition_events_edge_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_opportunity_transition_events"
  ADD CONSTRAINT "tokenless_agent_review_opportunity_transition_events_edge_check" CHECK (
    ("from_state" = 'evaluating' AND "to_state" IN ('skipped', 'approval_required', 'request_ready', 'blocked'))
    OR ("from_state" = 'approval_required' AND "to_state" IN ('request_ready', 'blocked', 'cancelled_before_commit'))
    OR ("from_state" = 'request_ready' AND "to_state" IN ('pending', 'blocked', 'cancelled_before_commit'))
    OR ("from_state" = 'pending' AND "to_state" IN ('blocked', 'completed', 'inconclusive', 'failed_terminal'))
    OR ("from_state" = 'blocked' AND "to_state" IN (
      'approval_required', 'request_ready', 'pending', 'completed', 'inconclusive',
      'failed_terminal', 'cancelled_before_commit'
    ))
  );--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_opportunity_recovery_states" (
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "status" text NOT NULL,
  "resume_state" text,
  "failure_count" integer NOT NULL DEFAULT 0,
  "maximum_failures" integer NOT NULL DEFAULT 3,
  "last_signal" text NOT NULL,
  "last_error_code" text,
  "first_failure_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "next_retry_at" timestamp with time zone,
  "terminal_state" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_pk"
    PRIMARY KEY ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_lifecycle_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles" ("workspace_id", "opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_status_check"
    CHECK ("status" IN ('recovery_required', 'recovered', 'terminal')),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_resume_check"
    CHECK ("resume_state" IS NULL OR "resume_state" IN ('approval_required', 'request_ready', 'pending')),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_failure_check"
    CHECK ("maximum_failures" = 3 AND "failure_count" BETWEEN 0 AND "maximum_failures"),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_signal_check"
    CHECK ("last_signal" IN (
      'response_deadline_elapsed', 'all_assignments_expired', 'owner_policy_disabled',
      'adapter_failure', 'infrastructure_failure', 'retry_succeeded'
    )),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_terminal_check" CHECK (
    ("status" = 'terminal' AND "terminal_state" IN ('inconclusive', 'failed_terminal', 'cancelled_before_commit')
      AND "next_retry_at" IS NULL)
    OR ("status" = 'recovery_required' AND "terminal_state" IS NULL AND "resume_state" IS NOT NULL
      AND "next_retry_at" IS NOT NULL AND "failure_count" BETWEEN 1 AND 2)
    OR ("status" = 'recovered' AND "terminal_state" IS NULL AND "next_retry_at" IS NULL)
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_states_failure_timestamps_check" CHECK (
    ("failure_count" = 0 AND "first_failure_at" IS NULL AND "last_failure_at" IS NULL)
    OR ("failure_count" > 0 AND "first_failure_at" IS NOT NULL AND "last_failure_at" IS NOT NULL
      AND "last_failure_at" >= "first_failure_at")
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunity_recovery_states_due_idx"
  ON "tokenless_agent_review_opportunity_recovery_states" USING btree
  ("status", "next_retry_at") WHERE "status" = 'recovery_required';--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_opportunity_recovery_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "transition_key" text NOT NULL,
  "request_commitment" text NOT NULL,
  "signal" text NOT NULL,
  "action" text NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "failure_count" integer NOT NULL,
  "accepted_work_count" integer NOT NULL,
  "committed_work_count" integer NOT NULL,
  "response_count" integer NOT NULL,
  "reason_codes_json" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_state_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_recovery_states" ("workspace_id", "opportunity_id")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_key_unique"
    UNIQUE ("workspace_id", "opportunity_id", "transition_key"),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_commitment_check"
    CHECK ("request_commitment" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_key_check"
    CHECK (char_length("transition_key") BETWEEN 8 AND 200),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_signal_check"
    CHECK ("signal" IN (
      'response_deadline_elapsed', 'all_assignments_expired', 'owner_policy_disabled',
      'adapter_failure', 'infrastructure_failure', 'retry_succeeded'
    )),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_action_check"
    CHECK ("action" IN (
      'blocked_for_retry', 'retry_remains_blocked', 'retry_resumed',
      'terminal_inconclusive', 'terminal_failed', 'cancelled_before_commit'
    )),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_state_check" CHECK (
    "from_state" IN ('approval_required', 'request_ready', 'pending', 'blocked')
    AND "to_state" IN (
      'approval_required', 'request_ready', 'pending', 'blocked', 'inconclusive',
      'failed_terminal', 'cancelled_before_commit'
    )
    AND "from_revision" >= 1
    AND "to_revision" IN ("from_revision", "from_revision" + 1)
    AND (("from_state" = "to_state" AND "to_revision" = "from_revision")
      OR ("from_state" <> "to_state" AND "to_revision" = "from_revision" + 1))
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_counts_check" CHECK (
    "failure_count" BETWEEN 0 AND 3
    AND "accepted_work_count" >= 0
    AND "committed_work_count" >= 0
    AND "response_count" >= 0
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_recovery_events_cancellation_origin_check" CHECK (
    "action" <> 'cancelled_before_commit'
    OR "from_state" IN ('approval_required', 'request_ready', 'blocked')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunity_recovery_events_timeline_idx"
  ON "tokenless_agent_review_opportunity_recovery_events" USING btree
  ("workspace_id", "opportunity_id", "occurred_at", "event_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_review_recovery_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'human-review recovery events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_agent_review_opportunity_recovery_events_append_only"
  BEFORE UPDATE OR DELETE ON "tokenless_agent_review_opportunity_recovery_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_review_recovery_event_mutation"();

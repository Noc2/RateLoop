CREATE TABLE "tokenless_expertise_verification_requests" (
  "request_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "expertise_keys_json" text NOT NULL,
  "evidence_reference_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "decision_reason" text,
  "expires_at" timestamp with time zone,
  CONSTRAINT "tokenless_expertise_verification_requests_evidence_unique"
    UNIQUE("rater_id", "evidence_reference_hash"),
  CONSTRAINT "tokenless_expertise_verification_requests_evidence_check"
    CHECK ("evidence_reference_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_expertise_verification_requests_status_check"
    CHECK ("status" IN ('pending', 'verified', 'rejected', 'revoked')),
  CONSTRAINT "tokenless_expertise_verification_requests_decision_check" CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "decision_reason" IS NULL)
    OR ("status" <> 'pending' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "decision_reason" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_expertise_verification_requests_expiry_check"
    CHECK ("expires_at" IS NULL OR "expires_at" > "submitted_at")
);
--> statement-breakpoint
CREATE INDEX "tokenless_expertise_verification_requests_queue_idx"
  ON "tokenless_expertise_verification_requests" USING btree
  ("status", "submitted_at", "request_id");
--> statement-breakpoint
CREATE TABLE "tokenless_expertise_verification_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "tokenless_expertise_verification_requests"("request_id"),
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text NOT NULL,
  "previous_event_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_expertise_verification_events_sequence_unique" UNIQUE("request_id", "sequence"),
  CONSTRAINT "tokenless_expertise_verification_events_type_check"
    CHECK ("event_type" IN ('submitted', 'verified', 'rejected', 'revoked')),
  CONSTRAINT "tokenless_expertise_verification_events_actor_check"
    CHECK ("actor_kind" IN ('rater', 'operator')),
  CONSTRAINT "tokenless_expertise_verification_events_previous_hash_check"
    CHECK ("previous_event_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_expertise_verification_events_hash_check"
    CHECK ("event_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "tokenless_expertise_verification_events_request_idx"
  ON "tokenless_expertise_verification_events" USING btree ("request_id", "sequence");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_expertise_verification_events_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'expertise verification events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tokenless_expertise_verification_events_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "tokenless_expertise_verification_events"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_expertise_verification_events_append_only"();

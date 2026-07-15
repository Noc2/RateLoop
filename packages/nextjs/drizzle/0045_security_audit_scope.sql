CREATE TABLE "tokenless_security_audit_heads" (
  "scope_kind" text NOT NULL,
  "scope_id" text NOT NULL,
  "last_sequence" integer DEFAULT 0 NOT NULL,
  "last_digest" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_security_audit_heads_scope_check" CHECK ("scope_kind" IN ('identity','system')),
  CONSTRAINT "tokenless_security_audit_heads_pk" PRIMARY KEY("scope_kind", "scope_id")
);--> statement-breakpoint
CREATE TABLE "tokenless_security_audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "previous_digest" text NOT NULL,
  "event_digest" text NOT NULL,
  "home_region" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_reference" text NOT NULL,
  "assurance_method" text NOT NULL,
  "action" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" text NOT NULL,
  "purpose" text NOT NULL,
  "reason" text NOT NULL,
  "request_correlation" text,
  "result" text NOT NULL,
  "metadata_json" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_security_audit_events_scope_check" CHECK ("scope_kind" IN ('identity','system')),
  CONSTRAINT "tokenless_security_audit_events_result_check" CHECK ("result" IN ('success','denied','failure')),
  CONSTRAINT "tokenless_security_audit_events_scope_sequence_unique" UNIQUE("scope_kind", "scope_id", "sequence"),
  CONSTRAINT "tokenless_security_audit_events_scope_digest_unique" UNIQUE("scope_kind", "scope_id", "event_digest"),
  CONSTRAINT "tokenless_security_audit_events_head_fk"
    FOREIGN KEY ("scope_kind", "scope_id")
    REFERENCES "tokenless_security_audit_heads"("scope_kind", "scope_id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "tokenless_security_audit_events_scope_time_idx"
  ON "tokenless_security_audit_events" USING btree ("scope_kind", "scope_id", "occurred_at", "sequence");

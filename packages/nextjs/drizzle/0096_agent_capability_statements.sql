ALTER TABLE "tokenless_agents"
  ADD COLUMN "intended_purpose" text,
  ADD COLUMN "known_limitations" text,
  ADD COLUMN "do_not_use_conditions" text,
  ADD COLUMN "capability_statement_updated_at" timestamp with time zone,
  ADD COLUMN "capability_statement_updated_by" text;
--> statement-breakpoint
ALTER TABLE "tokenless_agents"
  ADD CONSTRAINT "tokenless_agents_capability_statement_length_check" CHECK (
    ("intended_purpose" IS NULL OR char_length("intended_purpose") BETWEEN 1 AND 2000)
    AND ("known_limitations" IS NULL OR char_length("known_limitations") BETWEEN 1 AND 2000)
    AND ("do_not_use_conditions" IS NULL OR char_length("do_not_use_conditions") BETWEEN 1 AND 2000)
  );
--> statement-breakpoint
ALTER TABLE "tokenless_agent_audit_events"
  DROP CONSTRAINT "tokenless_agent_audit_events_type_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_audit_events"
  ADD CONSTRAINT "tokenless_agent_audit_events_type_check" CHECK (
    "event_type" IN ('agent.created', 'agent.version_created', 'agent.deactivated', 'agent.capability_statement_updated')
  );

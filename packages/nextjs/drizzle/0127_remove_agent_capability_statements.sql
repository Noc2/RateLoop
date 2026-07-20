ALTER TABLE "tokenless_agents"
  DROP CONSTRAINT IF EXISTS "tokenless_agents_capability_statement_length_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agents"
  DROP COLUMN IF EXISTS "intended_purpose",
  DROP COLUMN IF EXISTS "known_limitations",
  DROP COLUMN IF EXISTS "do_not_use_conditions",
  DROP COLUMN IF EXISTS "capability_statement_updated_at",
  DROP COLUMN IF EXISTS "capability_statement_updated_by";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_audit_events"
  DROP CONSTRAINT IF EXISTS "tokenless_agent_audit_events_type_check";
--> statement-breakpoint
DELETE FROM "tokenless_agent_audit_events"
  WHERE "event_type" = 'agent.capability_statement_updated';
--> statement-breakpoint
ALTER TABLE "tokenless_agent_audit_events"
  ADD CONSTRAINT "tokenless_agent_audit_events_type_check" CHECK (
    "event_type" IN ('agent.created', 'agent.version_created', 'agent.deactivated')
  );

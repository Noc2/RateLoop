ALTER TABLE "tokenless_agent_integration_events"
  DROP CONSTRAINT "tokenless_agent_integration_events_type_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_integration_events"
  ADD CONSTRAINT "tokenless_agent_integration_events_type_check" CHECK (
    "event_type" IN (
      'approved','connected','credential_rotated','oauth_token_rotated',
      'connection_test_failed','scope_upgraded','scope_downgraded','revoked'
    )
  );

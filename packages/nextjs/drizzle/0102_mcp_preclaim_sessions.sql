ALTER TABLE "tokenless_mcp_sessions"
  ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_mcp_sessions"
  ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_mcp_sessions"
  ADD CONSTRAINT "tokenless_mcp_sessions_binding_state_check"
  CHECK (
    ("workspace_id" IS NULL AND "integration_id" IS NULL)
    OR ("workspace_id" IS NOT NULL AND "integration_id" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "tokenless_mcp_sessions"
  DROP CONSTRAINT "tokenless_mcp_sessions_elicitation_mode_check";--> statement-breakpoint
ALTER TABLE "tokenless_mcp_sessions"
  ADD CONSTRAINT "tokenless_mcp_sessions_elicitation_mode_check"
  CHECK (
    "elicitation_mode" IN ('none','form') AND
    ("elicitation_mode" = 'none' OR "protocol_version" IN ('2025-06-18','2025-11-25'))
  );

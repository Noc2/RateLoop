ALTER TABLE "tokenless_workspace_agent_setups"
  ADD COLUMN "finalization_idempotency_key_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_agent_setups"
  ADD COLUMN "finalization_request_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_workspace_agent_setups"
  ADD COLUMN "people_invitation_id" text
  REFERENCES "tokenless_private_group_invitations"("invitation_id") ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_workspace_agent_setups"
  ADD CONSTRAINT "tokenless_workspace_agent_setups_finalization_hashes_check" CHECK (
    (
      "finalization_idempotency_key_hash" IS NULL
      AND "finalization_request_hash" IS NULL
      AND "people_invitation_id" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "finalization_idempotency_key_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND "finalization_request_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND ("people_invitation_id" IS NULL OR "people_decision" = 'invited')
    )
  );

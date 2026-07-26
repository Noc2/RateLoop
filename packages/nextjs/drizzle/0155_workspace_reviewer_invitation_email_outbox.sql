-- Queue encrypted reviewer invitations for durable, bounded delivery.
CREATE TABLE "tokenless_workspace_reviewer_invitation_email_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "invitation_id" text NOT NULL REFERENCES "tokenless_workspace_reviewer_invitations"("invitation_id") ON DELETE CASCADE,
  "payload_ciphertext" text,
  "payload_key_version" text,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "provider_message_id" text,
  "last_error" text,
  "delivered_at" timestamp with time zone,
  "suppressed_at" timestamp with time zone,
  "parked_at" timestamp with time zone,
  "dead_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_reviewer_invitation_email_invitation_unique" UNIQUE("invitation_id"),
  CONSTRAINT "tokenless_workspace_reviewer_invitation_email_state_check" CHECK (
    "state" IN ('pending','retry','delivering','delivered','suppressed','parked','dead')
  ),
  CONSTRAINT "tokenless_workspace_reviewer_invitation_email_attempt_check" CHECK (
    "attempt_count" BETWEEN 0 AND 8
  ),
  CONSTRAINT "tokenless_workspace_reviewer_invitation_email_lifecycle_check" CHECK (
    ("state" IN ('pending','retry')
      AND "payload_ciphertext" IS NOT NULL AND "payload_key_version" IS NOT NULL
      AND "next_attempt_at" IS NOT NULL
      AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
    OR ("state"='delivering'
      AND "payload_ciphertext" IS NOT NULL AND "payload_key_version" IS NOT NULL
      AND "next_attempt_at" IS NULL
      AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
    OR ("state"='parked'
      AND "payload_ciphertext" IS NOT NULL AND "payload_key_version" IS NOT NULL
      AND "next_attempt_at" IS NULL
      AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NOT NULL AND "dead_at" IS NULL)
    OR ("state"='dead'
      AND "payload_ciphertext" IS NOT NULL AND "payload_key_version" IS NOT NULL
      AND "next_attempt_at" IS NULL
      AND "delivered_at" IS NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NOT NULL)
    OR ("state"='delivered'
      AND "payload_ciphertext" IS NULL AND "payload_key_version" IS NULL
      AND "next_attempt_at" IS NULL
      AND "delivered_at" IS NOT NULL AND "suppressed_at" IS NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
    OR ("state"='suppressed'
      AND "payload_ciphertext" IS NULL AND "payload_key_version" IS NULL
      AND "next_attempt_at" IS NULL
      AND "delivered_at" IS NULL AND "suppressed_at" IS NOT NULL
      AND "parked_at" IS NULL AND "dead_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_invitation_email_due_idx"
  ON "tokenless_workspace_reviewer_invitation_email_deliveries"
  ("state","next_attempt_at","created_at","delivery_id");
--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_invitation_email_workspace_idx"
  ON "tokenless_workspace_reviewer_invitation_email_deliveries"
  ("workspace_id","created_at");

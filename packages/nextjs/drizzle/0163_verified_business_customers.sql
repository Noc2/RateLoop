ALTER TABLE "tokenless_workspace_governance"
  DROP CONSTRAINT "tokenless_workspace_governance_trader_status_check";--> statement-breakpoint

ALTER TABLE "tokenless_workspace_governance"
  ADD COLUMN "trader_verification_method" text,
  ADD COLUMN "trader_verification_reference_hash" text,
  ADD COLUMN "trader_verified_at" timestamp with time zone,
  ADD COLUMN "trader_verification_expires_at" timestamp with time zone,
  ADD COLUMN "trader_verified_by" text;--> statement-breakpoint

CREATE TABLE "tokenless_business_verification_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "prior_status" text NOT NULL,
  "next_status" text NOT NULL,
  "action" text NOT NULL,
  "verification_method" text,
  "verification_reference_hash" text,
  "verified_at" timestamp with time zone,
  "verification_expires_at" timestamp with time zone,
  "actor_reference" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_business_verification_events_status_check" CHECK (
    "prior_status" IN ('unverified', 'self_declared', 'verified', 'not_applicable')
    AND "next_status" IN ('unverified', 'self_declared', 'verified', 'not_applicable')
  ),
  CONSTRAINT "tokenless_business_verification_events_action_check" CHECK (
    "action" IN ('legacy_verification_demoted', 'profile_changed', 'operator_verified', 'operator_revoked')
  ),
  CONSTRAINT "tokenless_business_verification_events_method_check" CHECK (
    "verification_method" IS NULL
    OR "verification_method" IN ('commercial_register', 'tax_registration', 'contractual_due_diligence', 'other_documentary')
  ),
  CONSTRAINT "tokenless_business_verification_events_reference_check" CHECK (
    "verification_reference_hash" IS NULL OR "verification_reference_hash" ~ '^[0-9a-f]{64}$'
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_business_verification_events_workspace_created_idx"
  ON "tokenless_business_verification_events" ("workspace_id", "created_at" DESC);--> statement-breakpoint

INSERT INTO "tokenless_business_verification_events"
  ("event_id", "workspace_id", "prior_status", "next_status", "action",
   "actor_reference", "reason", "created_at")
SELECT
  'bve_migration_0163_' || "workspace_id",
  "workspace_id",
  'verified',
  'self_declared',
  'legacy_verification_demoted',
  'migration:0163',
  'Legacy verified state had no independent verification evidence and was fail-closed.',
  NOW()
FROM "tokenless_workspace_governance"
WHERE "trader_status" = 'verified';--> statement-breakpoint

UPDATE "tokenless_workspace_governance"
SET
  "trader_status" = 'self_declared',
  "trader_verification_method" = NULL,
  "trader_verification_reference_hash" = NULL,
  "trader_verified_at" = NULL,
  "trader_verification_expires_at" = NULL,
  "trader_verified_by" = NULL
WHERE "trader_status" = 'verified';--> statement-breakpoint

ALTER TABLE "tokenless_workspace_governance"
  ADD CONSTRAINT "tokenless_workspace_governance_trader_status_check" CHECK (
    "trader_status" IN ('unverified', 'self_declared', 'verified', 'not_applicable')
  ),
  ADD CONSTRAINT "tokenless_workspace_governance_verification_method_check" CHECK (
    "trader_verification_method" IS NULL
    OR "trader_verification_method" IN ('commercial_register', 'tax_registration', 'contractual_due_diligence', 'other_documentary')
  ),
  ADD CONSTRAINT "tokenless_workspace_governance_verification_reference_check" CHECK (
    "trader_verification_reference_hash" IS NULL OR "trader_verification_reference_hash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "tokenless_workspace_governance_verified_evidence_check" CHECK (
    (
      "trader_status" = 'verified'
      AND "trader_legal_name" IS NOT NULL
      AND "trader_registered_address" IS NOT NULL
      AND "trader_verification_method" IS NOT NULL
      AND "trader_verification_reference_hash" IS NOT NULL
      AND "trader_verified_at" IS NOT NULL
      AND "trader_verification_expires_at" IS NOT NULL
      AND "trader_verification_expires_at" > "trader_verified_at"
      AND "trader_verified_by" IS NOT NULL
    )
    OR (
      "trader_status" <> 'verified'
      AND "trader_verification_method" IS NULL
      AND "trader_verification_reference_hash" IS NULL
      AND "trader_verified_at" IS NULL
      AND "trader_verification_expires_at" IS NULL
      AND "trader_verified_by" IS NULL
    )
  );--> statement-breakpoint

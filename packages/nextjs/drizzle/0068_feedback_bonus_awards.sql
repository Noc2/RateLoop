ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "feedback_bonus_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "feedback_bonus_pool_atomic" numeric(78, 0),
  ADD COLUMN "feedback_bonus_awarder_kind" text NOT NULL DEFAULT 'requester',
  ADD COLUMN "feedback_bonus_awarder_account" text,
  ADD COLUMN "feedback_bonus_award_window_seconds" integer;
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_compensation_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_ready_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_compensation_check" CHECK (
    ("compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL)
    OR (
      "compensation_mode" = 'usdc'
      AND (
        ("configuration_status" = 'action_required' AND "bounty_per_seat_atomic" IS NULL)
        OR ("bounty_per_seat_atomic" IS NOT NULL AND "bounty_per_seat_atomic" > 0)
      )
    )
  ),
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_feedback_bonus_check" CHECK (
    (
      "feedback_bonus_enabled" = false
      AND "feedback_bonus_pool_atomic" IS NULL
      AND "feedback_bonus_award_window_seconds" IS NULL
    )
    OR (
      "feedback_bonus_enabled" = true
      AND "feedback_bonus_pool_atomic" IS NOT NULL
      AND "feedback_bonus_pool_atomic" > 0
      AND "feedback_bonus_award_window_seconds" BETWEEN 3600 AND 31536000
      AND "rationale_mode" IN ('optional', 'required')
    )
  ),
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_feedback_bonus_awarder_check" CHECK (
    ("feedback_bonus_awarder_kind" = 'requester' AND "feedback_bonus_awarder_account" IS NULL)
    OR (
      "feedback_bonus_awarder_kind" = 'designated'
      AND "feedback_bonus_awarder_account" IS NOT NULL
      AND char_length("feedback_bonus_awarder_account") BETWEEN 1 AND 320
    )
  ),
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_ready_check" CHECK (
    "configuration_status" = 'action_required'
    OR (
      "approved_by" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "response_window_seconds" BETWEEN 1200 AND 86400
      AND "panel_size" BETWEEN 1 AND 100
      AND ("audience" = 'private_invited' OR "panel_size" >= 3)
      AND (
        ("audience" = 'private_invited' AND "private_group_id" IS NOT NULL)
        OR (
          "audience" = 'public_network'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NULL
        )
        OR (
          "audience" = 'hybrid'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NOT NULL
        )
      )
      AND (
        ("compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL)
        OR ("compensation_mode" = 'usdc' AND "bounty_per_seat_atomic" IS NOT NULL AND "bounty_per_seat_atomic" > 0)
      )
      AND ("audience" = 'private_invited' OR "compensation_mode" = 'usdc')
    )
  );
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_approval_requests"
  ADD COLUMN "feedback_bonus_maximum_atomic" numeric(78, 0) NOT NULL DEFAULT 0,
  ADD COLUMN "maximum_consent_atomic" numeric(78, 0) NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "tokenless_agent_review_approval_requests"
SET "maximum_consent_atomic" = "maximum_charge_atomic";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_approval_requests"
  ADD CONSTRAINT "tokenless_agent_review_approval_requests_bonus_consent_check" CHECK (
    "feedback_bonus_maximum_atomic" >= 0
    AND "maximum_consent_atomic" = "maximum_charge_atomic" + "feedback_bonus_maximum_atomic"
  );
--> statement-breakpoint
CREATE TABLE "tokenless_feedback_bonus_pools" (
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "chain_id" bigint NOT NULL,
  "contract_address" text NOT NULL,
  "pool_id" numeric(78, 0) NOT NULL,
  "review_id" text NOT NULL,
  "content_id" text NOT NULL,
  "awarder_account" text NOT NULL,
  "deposited_amount_atomic" numeric(78, 0) NOT NULL,
  "awarded_amount_atomic" numeric(78, 0) NOT NULL DEFAULT 0,
  "feedback_deadline" timestamp with time zone NOT NULL,
  "award_deadline" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "projection_revision" integer NOT NULL DEFAULT 1,
  "synced_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_feedback_bonus_pools_profile_fk" FOREIGN KEY (
    "request_profile_id", "request_profile_version", "workspace_id", "request_profile_hash"
  ) REFERENCES "tokenless_agent_review_request_profiles" (
    "profile_id", "version", "workspace_id", "profile_hash"
  ) ON DELETE RESTRICT,
  CONSTRAINT "tokenless_feedback_bonus_pools_lifecycle_fk" FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_feedback_bonus_pools_amount_check" CHECK (
    "deposited_amount_atomic" > 0
    AND "awarded_amount_atomic" >= 0
    AND "awarded_amount_atomic" <= "deposited_amount_atomic"
  ),
  CONSTRAINT "tokenless_feedback_bonus_pools_deadline_check" CHECK ("award_deadline" > "feedback_deadline"),
  CONSTRAINT "tokenless_feedback_bonus_pools_status_check" CHECK ("status" IN ('funded','award_open','exhausted','refunded','closed')),
  CONSTRAINT "tokenless_feedback_bonus_pools_revision_check" CHECK ("projection_revision" >= 1),
  UNIQUE ("chain_id", "contract_address", "pool_id")
);
--> statement-breakpoint
CREATE INDEX "tokenless_feedback_bonus_pools_awarder_idx"
  ON "tokenless_feedback_bonus_pools" ("workspace_id", "awarder_account", "status", "award_deadline");
--> statement-breakpoint
CREATE TABLE "tokenless_feedback_bonus_feedback" (
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "feedback_id" text NOT NULL,
  "response_hash" text NOT NULL,
  "vote_key" text NOT NULL,
  "payout_commitment" text NOT NULL,
  "body_reference" text NOT NULL,
  "eligibility_status" text NOT NULL,
  "registered_at" timestamp with time zone NOT NULL,
  "awarded_at" timestamp with time zone,
  PRIMARY KEY ("workspace_id", "opportunity_id", "feedback_id"),
  CONSTRAINT "tokenless_feedback_bonus_feedback_pool_fk" FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_feedback_bonus_pools" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_feedback_bonus_feedback_hash_check" CHECK (
    "response_hash" ~ '^0x[0-9a-f]{64}$' AND "payout_commitment" ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_feedback_bonus_feedback_eligibility_check" CHECK (
    "eligibility_status" IN ('eligible','moderation_pending','ineligible')
  ),
  UNIQUE ("workspace_id", "opportunity_id", "response_hash")
);
--> statement-breakpoint
CREATE INDEX "tokenless_feedback_bonus_feedback_eligible_idx"
  ON "tokenless_feedback_bonus_feedback" ("workspace_id", "opportunity_id", "eligibility_status", "registered_at");
--> statement-breakpoint
CREATE TABLE "tokenless_feedback_bonus_award_intents" (
  "intent_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "feedback_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "awarder_account" text NOT NULL,
  "payout_commitment" text NOT NULL,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "status" text NOT NULL,
  "failure_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  UNIQUE ("workspace_id", "idempotency_key"),
  UNIQUE ("workspace_id", "opportunity_id", "feedback_id"),
  CONSTRAINT "tokenless_feedback_bonus_award_intents_feedback_fk" FOREIGN KEY (
    "workspace_id", "opportunity_id", "feedback_id"
  ) REFERENCES "tokenless_feedback_bonus_feedback" (
    "workspace_id", "opportunity_id", "feedback_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "tokenless_feedback_bonus_award_intents_amount_check" CHECK ("amount_atomic" > 0),
  CONSTRAINT "tokenless_feedback_bonus_award_intents_status_check" CHECK (
    "status" IN ('prepared','submitted','confirmed','failed')
  )
);
--> statement-breakpoint
CREATE TABLE "tokenless_feedback_bonus_award_receipts" (
  "receipt_id" text PRIMARY KEY,
  "intent_id" text NOT NULL UNIQUE REFERENCES "tokenless_feedback_bonus_award_intents" ("intent_id") ON DELETE RESTRICT,
  "chain_id" bigint NOT NULL,
  "contract_address" text NOT NULL,
  "transaction_hash" text NOT NULL,
  "pool_id" numeric(78, 0) NOT NULL,
  "response_hash" text NOT NULL,
  "payout_commitment" text NOT NULL,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_feedback_bonus_award_receipts_hash_check" CHECK (
    "transaction_hash" ~ '^0x[0-9a-f]{64}$'
    AND "response_hash" ~ '^0x[0-9a-f]{64}$'
    AND "payout_commitment" ~ '^0x[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_feedback_bonus_award_receipts_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'feedback bonus award receipts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_feedback_bonus_award_receipts_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "tokenless_feedback_bonus_award_receipts"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_feedback_bonus_award_receipts_append_only"();

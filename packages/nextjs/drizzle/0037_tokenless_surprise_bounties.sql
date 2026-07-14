CREATE TABLE "tokenless_surprise_bounty_rounds" (
  "bounty_round_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key") ON DELETE CASCADE,
  "deployment_key" text NOT NULL,
  "round_id" numeric(78, 0),
  "version" text NOT NULL,
  "state" text DEFAULT 'reserved' NOT NULL,
  "policy_json" text NOT NULL,
  "guaranteed_base_per_report_atomic" numeric(78, 0) NOT NULL,
  "maximum_bonus_per_report_atomic" numeric(78, 0) NOT NULL,
  "reserved_report_capacity" integer NOT NULL,
  "maximum_liability_atomic" numeric(78, 0) NOT NULL,
  "sample_size" integer,
  "actual_up_bps" integer,
  "mean_predicted_up_bps" integer,
  "surprisingly_popular_outcome" text,
  "allocation_hash" text,
  "evidence_hash" text,
  "total_bonus_atomic" numeric(78, 0),
  "paid_bonus_atomic" numeric(78, 0) DEFAULT 0 NOT NULL,
  "finalized_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_surprise_bounty_rounds_operation_unique" UNIQUE("operation_key"),
  CONSTRAINT "tokenless_surprise_bounty_rounds_round_unique" UNIQUE("deployment_key", "round_id"),
  CONSTRAINT "tokenless_surprise_bounty_rounds_state_check" CHECK (
    "state" IN ('reserved', 'insufficient_sample', 'no_qualifying_outcome', 'allocated', 'complete')
  ),
  CONSTRAINT "tokenless_surprise_bounty_rounds_amounts_check" CHECK (
    "guaranteed_base_per_report_atomic" > 0 AND
    "maximum_bonus_per_report_atomic" > 0 AND
    "maximum_bonus_per_report_atomic" <= "guaranteed_base_per_report_atomic" AND
    "reserved_report_capacity" BETWEEN 1 AND 500 AND
    "maximum_liability_atomic" = "maximum_bonus_per_report_atomic" * "reserved_report_capacity" AND
    "paid_bonus_atomic" >= 0 AND
    ("total_bonus_atomic" IS NULL OR ("total_bonus_atomic" >= 0 AND "total_bonus_atomic" <= "maximum_liability_atomic")) AND
    ("total_bonus_atomic" IS NULL OR "paid_bonus_atomic" <= "total_bonus_atomic")
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_surprise_bounty_rounds_state_idx"
  ON "tokenless_surprise_bounty_rounds" USING btree ("state", "updated_at");
--> statement-breakpoint
CREATE TABLE "tokenless_surprise_bounty_entitlements" (
  "entitlement_id" text PRIMARY KEY NOT NULL,
  "bounty_round_id" text NOT NULL REFERENCES "tokenless_surprise_bounty_rounds"("bounty_round_id") ON DELETE CASCADE,
  "operation_key" text NOT NULL,
  "commit_key" text NOT NULL,
  "vote" integer NOT NULL,
  "leave_one_out_actual_side_bps" integer NOT NULL,
  "leave_one_out_predicted_side_bps" integer NOT NULL,
  "leave_one_out_surprise_margin_bps" integer NOT NULL,
  "surprise_score_bps" integer NOT NULL,
  "bonus_atomic" numeric(78, 0) NOT NULL,
  "state" text DEFAULT 'pending_claim' NOT NULL,
  "payout_address" text,
  "claim_transaction_hash" text,
  "transfer_nonce" numeric(78, 0),
  "transfer_transaction_hash" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_surprise_bounty_entitlements_commit_unique" UNIQUE("bounty_round_id", "commit_key"),
  CONSTRAINT "tokenless_surprise_bounty_entitlements_transfer_tx_unique" UNIQUE("transfer_transaction_hash"),
  CONSTRAINT "tokenless_surprise_bounty_entitlements_state_check" CHECK (
    "state" IN ('pending_claim', 'ready', 'paying', 'retry', 'paid', 'reconciliation_required')
  ),
  CONSTRAINT "tokenless_surprise_bounty_entitlements_values_check" CHECK (
    "vote" IN (0, 1) AND
    "surprise_score_bps" BETWEEN 1 AND 10000 AND
    "bonus_atomic" > 0 AND
    "attempt_count" BETWEEN 0 AND 20
  ),
  CONSTRAINT "tokenless_surprise_bounty_entitlements_paid_check" CHECK (
    ("state" = 'paid' AND "payout_address" IS NOT NULL AND "claim_transaction_hash" IS NOT NULL AND
      "transfer_nonce" IS NOT NULL AND "transfer_transaction_hash" IS NOT NULL AND "paid_at" IS NOT NULL)
    OR "state" <> 'paid'
  )
);
--> statement-breakpoint
CREATE INDEX "tokenless_surprise_bounty_entitlements_due_idx"
  ON "tokenless_surprise_bounty_entitlements" USING btree ("state", "next_attempt_at", "created_at");
--> statement-breakpoint
CREATE INDEX "tokenless_surprise_bounty_entitlements_operation_idx"
  ON "tokenless_surprise_bounty_entitlements" USING btree ("operation_key", "created_at");
